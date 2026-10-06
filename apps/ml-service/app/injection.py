"""
Prompt-injection / jailbreak detection.

Two signals: the ProtectAI DeBERTa-v3 classifier (CPU) and keyword heuristics.

On its own the classifier fires on short, ordinary text ("Order ID 1234 5678
9012 has shipped" scores 0.996), so a prompt is only reported as an injection
when both agree. A model-only hit is damped to at most MODEL_ONLY_CAP: still
visible in the response, but below the threshold. If the model is disabled or
fails to load, the heuristics are used alone (model="heuristic").
"""

from __future__ import annotations

import logging
import re

from .config import settings

log = logging.getLogger(__name__)

CHUNK_CHARS = 1800      # ~512 tokens; long prompts are scored chunk by chunk
CHUNK_OVERLAP = 200
INJECTION_THRESHOLD = 0.5
MODEL_ONLY_CAP = 0.4

# (pattern, weight) — weights combine as independent probabilities
HEURISTICS = [
    (r"\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|any)\b.{0,20}\b(instructions?|prompts?|rules|directions|guidelines)\b", 0.90),
    (r"\b(reveal|print|show|repeat|output|leak)\b.{0,30}\b(system|hidden|initial)\s+(prompt|instructions?|message)\b", 0.85),
    (r"\byou are now\b.{0,40}\b(DAN|unrestricted|jailbroken|developer mode|evil)\b", 0.90),
    (r"\b(developer|god|jailbreak|DAN)\s+mode\b", 0.75),
    (r"\bpretend\b.{0,30}\b(no|without)\b.{0,20}\b(rules|restrictions|limits|filters|guidelines)\b", 0.80),
    (r"\b(bypass|disable|turn off|circumvent)\b.{0,30}\b(safety|filters?|guardrails|restrictions|content policy|moderation)\b", 0.80),
    (r"\bdo anything now\b", 0.85),
    (r"\bact as\b.{0,40}\b(without|no)\b.{0,20}\b(restrictions|limits|filters)\b", 0.75),
    (r"<\s*/?\s*(system|im_start|im_end)\s*>|\[/?INST\]", 0.70),
    (r"\b(forget|ignore|disregard)\b.{0,15}\b(everything|all)\b.{0,15}\b(above|before|so far|you were told)\b", 0.80),
    (r"\byou are now\b|\bfrom now on,? you (are|will|must)\b", 0.50),
    (r"\b(new|updated|real)\s+(instructions|system prompt|rules)\b", 0.50),
    (r"\b(system prompt|hidden instructions|initial instructions)\b", 0.40),
]
_COMPILED = [(re.compile(p, re.IGNORECASE | re.DOTALL), w) for p, w in HEURISTICS]


def heuristic_score(text: str) -> float:
    safe_prob = 1.0
    for pattern, weight in _COMPILED:
        if pattern.search(text):
            safe_prob *= 1.0 - weight
    return round(1.0 - safe_prob, 4)


def chunk_text(text: str) -> list[str]:
    if len(text) <= CHUNK_CHARS:
        return [text]
    step = CHUNK_CHARS - CHUNK_OVERLAP
    return [text[i:i + CHUNK_CHARS] for i in range(0, len(text) - CHUNK_OVERLAP, step)]


class InjectionClassifier:
    def __init__(self, use_model: bool = True) -> None:
        self.pipeline = None
        self.model_name = "heuristic"
        self.load_error: str | None = None

        if not use_model:
            return
        try:
            from transformers import pipeline

            self.pipeline = pipeline(
                "text-classification",
                model=settings.injection_model,
                truncation=True,
                max_length=512,
                device=-1,
            )
            self.model_name = settings.injection_model
        except Exception as exc:  # noqa: BLE001 — any load failure falls back to heuristics
            self.load_error = str(exc)
            log.warning("Injection model unavailable, using heuristics: %s", exc)

    def model_score(self, text: str) -> float | None:
        if self.pipeline is None:
            return None
        best = 0.0
        for output in self.pipeline(chunk_text(text)):
            prob = output["score"] if output["label"].upper() == "INJECTION" else 1.0 - output["score"]
            best = max(best, prob)
        return round(best, 4)

    def score(self, text: str) -> dict:
        heuristic = heuristic_score(text)
        model = self.model_score(text)
        return {"score": combine_scores(model, heuristic), "modelScore": model, "heuristicScore": heuristic}


def combine_scores(model: float | None, heuristic: float) -> float:
    if model is None:
        return heuristic
    if heuristic > 0:
        return round(max(model, heuristic), 4)
    return round(model * MODEL_ONLY_CAP, 4)
