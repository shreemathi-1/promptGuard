"""
AI rule generator: plain-English description + examples → a tested regex.

The local LLM proposes a pattern; this module never trusts it blindly:

1. Syntax  — must compile, and must use only syntax that also works in
             JavaScript, because the backend scanner runs `new RegExp(p, 'gi')`
2. Safety  — no nested quantifiers (catastrophic backtracking), no empty
             matches, bounded length
3. Tests   — every "should match" example must be matched exactly, and no
             "should not match" example may be matched at all

Small local models are unreliable at regex, so a deterministic step helps:
the examples' structure is analysed ("EMP-123456" → letters, "-", 6 digits)
into a candidate pattern. The LLM gets it as a starting hint and competes
with it; the best-tested candidate wins (the LLM on ties, since it read the
description). With Ollama down, the inferred pattern is still returned.

Failures are fed back to the model for another attempt. The best attempt is
returned with per-example results, so the UI can show exactly what passed.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional

from .llm import LlmResponseError, LlmUnavailableError, OllamaClient, restore_regex_escapes

MAX_ATTEMPTS = 3
MAX_PATTERN_LENGTH = 500

CATEGORIES = [
    "CREDIT_CARD", "PHONE", "SSN", "BANK_ACCOUNT", "EMAIL", "PASSPORT", "API_KEY",
    "AADHAAR", "PAN", "IFSC", "IP_ADDRESS", "MAC_ADDRESS", "CUSTOM",
]
SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]

# Everyday text with no sensitive data; a pattern that matches here is too broad
BENIGN_CORPUS = [
    "The quarterly meeting is scheduled for next Monday in Conference Room B.",
    "Please review the attached slides before the call.",
    "Our team shipped version 2 of the dashboard last week.",
    "Lunch will be served at noon in the cafeteria.",
    "Thanks for the update, let's sync again tomorrow morning.",
    "The weather in the hills is lovely this time of year.",
]

# Python-only or unsupported-in-JS constructs
JS_INCOMPATIBLE = [
    (re.compile(r"\(\?P[<=>]"), "Python named groups (?P<name>…) — use (?<name>…) instead"),
    (re.compile(r"\(\?[aiLmsux]+[):]"), "inline flags like (?i) — the scanner is already case-insensitive"),
    (re.compile(r"\\[AZz]"), r"\A / \Z anchors — JavaScript doesn't support them"),
    (re.compile(r"\(\?>"), "atomic groups (?>…)"),
    (re.compile(r"[*+?}]\+"), "possessive quantifiers like ++ or *+"),
    (re.compile(r"\(\?#"), "inline comments (?#…)"),
]

# A group containing a quantifier, itself quantified: (a+)+, (\d+\s?)*, (x|y+){2,}
NESTED_QUANTIFIER = re.compile(r"\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\})")

SYSTEM_PROMPT = f"""You write regular expressions for a data-loss-prevention scanner.
The scanner compiles each pattern with JavaScript: new RegExp(pattern, "gi"), and searches inside larger text.

Rules for the pattern:
- JavaScript syntax only. No (?P<name>), no inline flags like (?i), no \\A or \\Z, no possessive quantifiers.
- Do not use ^ or $ anchors. Use \\b word boundaries so it doesn't match inside longer tokens.
- Prefer exact character classes and bounded counts ({{n}} or {{n,m}}). Avoid .* and .+
- Never put a quantified group inside another quantifier, like (\\d+)+.
- In JSON, escape every backslash: write "\\\\d" for \\d and "\\\\b" for \\b.

Reply with one JSON object only:
{{"pattern": "...", "name": "short rule name (max 60 chars)", "category": one of {CATEGORIES},
 "severity": one of {SEVERITIES}, "explanation": "one sentence describing what the pattern matches"}}"""


# A model's category is kept only when the request mentions it
CATEGORY_KEYWORDS = {
    "CREDIT_CARD": ["card", "visa", "mastercard", "amex", "rupay"],
    "PHONE": ["phone", "mobile", "telephone", "cell", "contact number"],
    "SSN": ["ssn", "social security"],
    "BANK_ACCOUNT": ["bank", "account", "iban", "routing"],
    "EMAIL": ["email", "e-mail", "mail"],
    "PASSPORT": ["passport"],
    "API_KEY": ["key", "token", "secret", "credential", "password"],
    "AADHAAR": ["aadhaar", "aadhar", "uid"],
    "PAN": ["pan", "income tax", "permanent account"],
    "IFSC": ["ifsc"],
    "IP_ADDRESS": ["ip address", "ipv4", "ipv6", " ip "],
    "MAC_ADDRESS": ["mac address", "mac "],
}


def plausible_category(category: str, request_text: str) -> str:
    if category == "CUSTOM":
        return category
    text = f" {request_text.lower()} "
    return category if any(k in text for k in CATEGORY_KEYWORDS.get(category, [])) else "CUSTOM"


@dataclass
class ExampleResult:
    text: str
    expected: bool          # True = should match
    matched: Optional[str]  # the matched substring, if any
    passed: bool


@dataclass
class Attempt:
    pattern: str
    name: str
    category: str
    severity: str
    explanation: str
    problems: list[str] = field(default_factory=list)   # syntax / safety problems
    results: list[ExampleResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    strategy: str = "LLM"   # LLM | EXAMPLES (inferred from the examples' structure)

    @property
    def passed_count(self) -> int:
        return sum(r.passed for r in self.results)

    @property
    def ok(self) -> bool:
        return not self.problems and all(r.passed for r in self.results)

    def score(self) -> tuple[int, int, int]:
        # Rank attempts: usable syntax first, then tests passed, then fewer warnings
        return (0 if self.problems else 1, self.passed_count, -len(self.warnings))


# ── Checks (also used by tests, no LLM needed) ───────────────────────────────

def check_syntax(pattern: str) -> tuple[Optional[re.Pattern], list[str]]:
    problems = []
    if not pattern:
        return None, ["the pattern is empty"]
    if len(pattern) > MAX_PATTERN_LENGTH:
        problems.append(f"the pattern is longer than {MAX_PATTERN_LENGTH} characters")
    for rx, message in JS_INCOMPATIBLE:
        if rx.search(pattern):
            problems.append(f"uses {message}")
    if NESTED_QUANTIFIER.search(pattern):
        problems.append("nests a quantified group inside another quantifier, which can hang the scanner")
    try:
        compiled = re.compile(pattern, re.IGNORECASE)
    except re.error as exc:
        return None, problems + [f"does not compile: {exc}"]
    if compiled.search("") is not None:
        problems.append("can match an empty string")
    return compiled, problems


def run_examples(compiled: re.Pattern, positives: list[str], negatives: list[str]) -> list[ExampleResult]:
    results = []
    for text in positives:
        found = [m.group() for m in compiled.finditer(text) if m.group()]
        exact = text.strip() in found
        results.append(ExampleResult(text, True, found[0] if found else None, exact))
    for text in negatives:
        m = compiled.search(text)
        results.append(ExampleResult(text, False, m.group() if m else None, m is None))
    return results


def benign_warnings(compiled: re.Pattern) -> list[str]:
    hits = [m.group() for line in BENIGN_CORPUS for m in compiled.finditer(line) if m.group()]
    if not hits:
        return []
    sample = ", ".join(f'"{h}"' for h in hits[:3])
    return [f"also matches ordinary text ({sample}) — it may be too broad"]


def evaluate(raw: dict, positives: list[str], negatives: list[str]) -> Attempt:
    pattern = restore_regex_escapes(str(raw.get("pattern", ""))).strip()
    # Models sometimes wrap the pattern in /…/flags
    m = re.fullmatch(r"/(.+)/[a-z]*", pattern, re.S)
    if m:
        pattern = m.group(1)

    category = str(raw.get("category", "CUSTOM")).upper()
    severity = str(raw.get("severity", "HIGH")).upper()
    attempt = Attempt(
        pattern=pattern,
        name=str(raw.get("name") or "AI generated rule")[:100],
        category=category if category in CATEGORIES else "CUSTOM",
        severity=severity if severity in SEVERITIES else "HIGH",
        explanation=str(raw.get("explanation", ""))[:500],
    )
    compiled, attempt.problems = check_syntax(pattern)
    if compiled is not None:
        attempt.results = run_examples(compiled, positives, negatives)
        attempt.warnings = benign_warnings(compiled)
    return attempt


def feedback(attempt: Attempt) -> str:
    lines = ["That pattern is not right yet:"]
    lines += [f"- It {p}." for p in attempt.problems]
    for r in attempt.results:
        if r.passed:
            continue
        if r.expected and r.matched is None:
            lines.append(f'- It does not match "{r.text}" at all, but it should.')
        elif r.expected:
            lines.append(f'- On "{r.text}" it matched only "{r.matched}"; it must match the whole value.')
        else:
            lines.append(f'- It matches "{r.matched}" inside "{r.text}", which must NOT match.')
    lines += [f"- Warning: it {w}." for w in attempt.warnings]
    lines.append("Return a corrected JSON object.")
    return "\n".join(lines)


# ── Structure inference ──────────────────────────────────────────────────────

_RUN = re.compile(r"[A-Za-z]+|\d+|[^A-Za-z\d]+")


def _runs(value: str) -> tuple[list[tuple[str, str]], list[str]]:
    """'MH 12AB' → ([('L','MH'), ('D','12'), ('L','AB')], [' ', '']): letter/digit runs and the separators between them."""
    core: list[tuple[str, str]] = []
    seps: list[str] = []
    pending = None
    for m in _RUN.finditer(value):
        text = m.group()
        if text[0].isalpha() or text[0].isdigit():
            if core:
                seps.append(pending or "")
            core.append(("L" if text[0].isalpha() else "D", text))
            pending = None
        else:
            if not core:
                raise ValueError("leading separator")
            pending = text
    if pending is not None:
        raise ValueError("trailing separator")
    return core, seps


def _count(lengths: list[int]) -> str:
    lo, hi = min(lengths), max(lengths)
    return f"{{{lo}}}" if lo == hi else f"{{{lo},{hi}}}"


def _separator(options: set[str]) -> Optional[str]:
    if options == {""}:
        return ""
    if any(len(o) > 1 for o in options):
        return None
    chars = sorted({r"\s" if o.isspace() else "-" if o == "-" else re.escape(o) for o in options if o})
    optional = "" in options
    if len(chars) == 1:
        return chars[0] + ("?" if optional else "")
    # "-" first so it is literal inside the class
    chars.sort(key=lambda c: c != "-")
    return f"[{''.join(chars)}]" + ("?" if optional else "")


def infer_pattern(positives: list[str]) -> Optional[str]:
    r"""
    A regex from the examples' shared shape, or None when they don't share one.
    Letter runs that are identical in every example stay literal (the "EMP" in
    EMP-123456); others become [A-Z]{n,m}. Digit runs become \d{n,m}.
    """
    try:
        parsed = [_runs(p.strip()) for p in positives if p.strip()]
    except ValueError:
        return None
    if not parsed:
        return None
    kinds = [k for k, _ in parsed[0][0]]
    if any([k for k, _ in core] != kinds for core, _ in parsed):
        return None

    parts = []
    for i, kind in enumerate(kinds):
        if i > 0:
            sep = _separator({seps[i - 1] for _, seps in parsed})
            if sep is None:
                return None
            parts.append(sep)
        texts = [core[i][1] for core, _ in parsed]
        if kind == "D":
            parts.append(r"\d" + _count([len(t) for t in texts]))
        elif len({t.lower() for t in texts}) == 1:
            parts.append(re.escape(texts[0].upper()))
        else:
            parts.append("[A-Z]" + _count([len(t) for t in texts]))
    return r"\b" + "".join(parts) + r"\b"


# ── Generation ───────────────────────────────────────────────────────────────

def generate_rule(
    client: OllamaClient,
    description: str,
    positives: list[str],
    negatives: list[str],
    category_hint: Optional[str] = None,
    budget_seconds: float = 100.0,
) -> tuple[Attempt, list[Attempt], str]:
    """
    → (best attempt, all attempts, model name). Raises LlmUnavailableError.
    No new attempt starts once budget_seconds have passed; the best so far is returned.
    """
    deadline = time.monotonic() + budget_seconds
    request_text = " ".join([description, *positives])

    seed = None
    inferred = infer_pattern(positives)
    if inferred:
        seed = evaluate({"pattern": inferred, "name": description[:60], "category": category_hint or "CUSTOM",
                         "explanation": "Matches values with the same structure as the examples."},
                        positives, negatives)
        seed.strategy = "EXAMPLES"
        if seed.problems:
            seed = None

    request = [f"Description: {description}"]
    if category_hint:
        request.append(f"Category: {category_hint}")
    request.append("Must match each of these values exactly:")
    request += [f"- {p}" for p in positives]
    if negatives:
        request.append("Must NOT match anything in these:")
        request += [f"- {n}" for n in negatives]
    if seed:
        request.append(
            f"A pattern inferred from the examples' structure is: {seed.pattern} "
            f"(it passes {seed.passed_count} of {len(seed.results)} tests). Start from it, and widen it "
            "only if the description clearly implies more formats. Don't hard-code the example values."
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n".join(request)},
    ]
    attempts: list[Attempt] = []
    model = ""

    for _ in range(MAX_ATTEMPTS):
        if attempts and time.monotonic() > deadline:
            break
        try:
            raw, model = client.chat_json(messages)
        except LlmUnavailableError:
            # Without the LLM the inferred pattern is still useful; otherwise give up
            if seed is None and not attempts:
                raise
            break
        except LlmResponseError:
            # Bad JSON counts as a failed attempt; LlmUnavailableError propagates
            messages.append({"role": "user", "content": "Your reply was not a valid JSON object. Reply with JSON only."})
            continue

        attempt = evaluate(raw, positives, negatives)
        if category_hint and category_hint.upper() in CATEGORIES:
            attempt.category = category_hint.upper()
        else:
            attempt.category = plausible_category(attempt.category, request_text)
        attempts.append(attempt)
        if attempt.ok and not attempt.warnings:
            break
        messages.append({"role": "assistant", "content": json.dumps(raw)})
        messages.append({"role": "user", "content": feedback(attempt)})

    candidates = attempts + ([seed] if seed else [])
    if not candidates:
        raise LlmResponseError("the model did not return a usable pattern")

    # max() keeps the first of equal scores, so the LLM wins ties
    best = max(candidates, key=Attempt.score)
    if best is seed and attempts:
        # Keep the LLM's naming and severity for the inferred pattern
        named = max(attempts, key=Attempt.score)
        best.name, best.severity = named.name, named.severity
        if category_hint is None:
            best.category = named.category
    return best, attempts, model
