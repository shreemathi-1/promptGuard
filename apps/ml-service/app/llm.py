"""
Minimal client for a local Ollama server (https://ollama.com).

Generative features (rule generator, LLM explanations) are optional: when
Ollama isn't running, or no suitable model is pulled, callers get
LlmUnavailableError and the API answers 503 with code LLM_UNAVAILABLE, while
detection keeps working.

Uses only the standard library, so the service has no extra dependency.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.request
from typing import Optional

from .config import settings

log = logging.getLogger("ml-service.llm")

TAGS_CACHE_SECONDS = 30


class LlmUnavailableError(Exception):
    """Ollama is unreachable, or none of the configured models is pulled."""


class LlmResponseError(Exception):
    """Ollama answered, but not with the JSON we asked for."""


def repair_json_escapes(raw: str) -> str:
    r"""
    Small models often write regexes into JSON without escaping backslashes
    ("\\d" written as "\d"), which is invalid JSON. Escape any backslash that
    doesn't start a valid JSON escape.
    """
    # Walk backslash pairs left to right, so an already-escaped "\\d" stays as it is
    return re.sub(
        r"\\(.)",
        lambda m: m.group(0) if m.group(1) in '"\\/bfnrtu' else "\\\\" + m.group(1),
        raw,
        flags=re.S,
    )


# JSON escapes that are valid but never what a regex author meant
_CONTROL_TO_REGEX = {"\b": r"\b", "\f": r"\f", "\t": r"\t", "\n": r"\n", "\r": r"\r"}


def restore_regex_escapes(value: str) -> str:
    """"\b" in JSON decodes to a backspace; in a regex the author meant a word boundary."""
    return "".join(_CONTROL_TO_REGEX.get(ch, ch) for ch in value)


def parse_json_object(raw: str) -> dict:
    """Parses the model's reply, tolerating code fences and unescaped backslashes."""
    text = raw.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise LlmResponseError("model reply contained no JSON object")
    text = text[start:end + 1]
    for candidate in (text, repair_json_escapes(text)):
        try:
            data = json.loads(candidate)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            continue
    raise LlmResponseError("model reply was not valid JSON")


class OllamaClient:
    def __init__(self, base_url: str, preferred_models: list[str], timeout: float):
        self.base_url = base_url.rstrip("/")
        self.preferred = [m for m in preferred_models if m]
        self.timeout = timeout
        self._tags: Optional[list[str]] = None
        self._tags_at = 0.0

    # ── HTTP ─────────────────────────────────────────────────────────────────

    def _request(self, method: str, path: str, body: Optional[dict] = None, timeout: Optional[float] = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as exc:
            raise LlmUnavailableError(f"Ollama {path} returned {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise LlmUnavailableError(f"Ollama unreachable at {self.base_url}: {exc}") from exc

    # ── Models ───────────────────────────────────────────────────────────────

    def pulled_models(self, refresh: bool = False) -> list[str]:
        now = time.monotonic()
        if refresh or self._tags is None or now - self._tags_at > TAGS_CACHE_SECONDS:
            try:
                tags = self._request("GET", "/api/tags", timeout=3)
                self._tags = [m["name"] for m in tags.get("models", [])]
            except LlmUnavailableError:
                self._tags = None
                raise
            finally:
                self._tags_at = now
        return self._tags

    def resolve_model(self) -> str:
        """First preferred model that is pulled ("gemma3" also matches "gemma3:latest")."""
        pulled = self.pulled_models()
        for wanted in self.preferred:
            for name in pulled:
                if name == wanted or name == f"{wanted}:latest":
                    return name
        raise LlmUnavailableError(
            f"none of the models {self.preferred} is pulled in Ollama — run `ollama pull {self.preferred[0]}`"
        )

    def status(self) -> dict:
        try:
            pulled = self.pulled_models()
        except LlmUnavailableError as exc:
            return {"reachable": False, "model": None, "pulled": [], "error": str(exc)}
        try:
            model, error = self.resolve_model(), None
        except LlmUnavailableError as exc:
            model, error = None, str(exc)
        return {"reachable": True, "model": model, "pulled": pulled, "error": error}

    # ── Generation ───────────────────────────────────────────────────────────

    def chat_json(self, messages: list[dict], temperature: float = 0.2, max_tokens: int = 500) -> tuple[dict, str]:
        """Runs a chat completion in JSON mode → (parsed object, model name)."""
        model = self.resolve_model()
        res = self._request("POST", "/api/chat", {
            "model": model,
            "messages": messages,
            "format": "json",
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        })
        content = res.get("message", {}).get("content", "")
        return parse_json_object(content), model


ollama = OllamaClient(settings.ollama_url, settings.ollama_models, settings.ollama_timeout)
