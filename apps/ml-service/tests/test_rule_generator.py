import pytest

from app import main
from app.explainer import evidence, llm_explanation, template_explanation
from app.llm import LlmResponseError, LlmUnavailableError, parse_json_object
from app.rule_generator import check_syntax, evaluate, generate_rule, infer_pattern, plausible_category


class FakeLlm:
    """Stands in for OllamaClient: returns scripted replies and records the conversation."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def chat_json(self, messages, temperature=0.2, max_tokens=500):
        self.calls.append([dict(m) for m in messages])
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply, "fake-model"


EMP = {"pattern": r"\bEMP-\d{6}\b", "name": "Employee ID", "category": "CUSTOM",
       "severity": "MEDIUM", "explanation": "EMP- followed by 6 digits"}


# ── JSON parsing ─────────────────────────────────────────────────────────────

def test_parse_json_tolerates_fences_and_unescaped_backslashes():
    assert parse_json_object('```json\n{"pattern": "\\d{4}"}\n```')["pattern"] == r"\d{4}"
    assert parse_json_object(r'{"pattern": "\d{4}-\\d{2}"}')["pattern"] == r"\d{4}-\d{2}"
    with pytest.raises(LlmResponseError):
        parse_json_object("no json here")


def test_backspace_from_json_becomes_word_boundary():
    # "\b" is a valid JSON escape (backspace); in a regex it means a word boundary
    attempt = evaluate(parse_json_object('{"pattern": "\\bEMP-\\\\d{6}\\b"}'), ["EMP-123456"], [])
    assert attempt.pattern == r"\bEMP-\d{6}\b"
    assert attempt.ok


def test_slash_wrapped_pattern_is_unwrapped():
    assert evaluate({"pattern": r"/EMP-\d{6}/gi"}, ["EMP-123456"], []).pattern == r"EMP-\d{6}"


# ── Syntax and safety checks ─────────────────────────────────────────────────

@pytest.mark.parametrize("pattern, problem", [
    (r"(?P<id>\d+)", "named groups"),
    (r"(?i)emp-\d+", "inline flags"),
    (r"\AEMP\Z", "anchors"),
    (r"(\d+)+x", "nests"),
    (r"(a|b+)*", "nests"),
    (r"\d*", "empty string"),
    (r"[unclosed", "does not compile"),
])
def test_check_syntax_rejects(pattern, problem):
    _, problems = check_syntax(pattern)
    assert any(problem in p for p in problems), problems


def test_check_syntax_accepts_js_safe_pattern():
    compiled, problems = check_syntax(r"\b[A-Z]{3}-\d{4}(?:-[A-Z])?\b")
    assert compiled is not None and problems == []


def test_positive_must_match_whole_value_and_negatives_must_not_match():
    attempt = evaluate({"pattern": r"\d{4}"}, ["EMP-123456"], ["order 9999"])
    by_text = {r.text: r for r in attempt.results}
    assert by_text["EMP-123456"].matched == "1234" and not by_text["EMP-123456"].passed
    assert not by_text["order 9999"].passed
    assert not attempt.ok


def test_broad_pattern_gets_a_warning():
    attempt = evaluate({"pattern": r"\b[a-z]+\b"}, ["hello"], [])
    assert attempt.warnings and "too broad" in attempt.warnings[0]


def test_unknown_category_and_severity_fall_back():
    attempt = evaluate({"pattern": r"EMP-\d{6}", "category": "WIDGET", "severity": "huge"}, ["EMP-123456"], [])
    assert attempt.category == "CUSTOM" and attempt.severity == "HIGH"


# ── Generation loop ──────────────────────────────────────────────────────────

def test_first_good_answer_is_returned_without_retries():
    llm = FakeLlm(EMP)
    best, attempts, model = generate_rule(llm, "employee ids", ["EMP-123456"], ["EMP-12"])
    assert best.ok and best.pattern == r"\bEMP-\d{6}\b"
    assert len(attempts) == 1 and model == "fake-model"


def test_failures_are_fed_back_and_retried():
    llm = FakeLlm({"pattern": r"\d{6}"}, EMP)
    best, attempts, _ = generate_rule(llm, "employee ids", ["EMP-123456"], [])
    assert len(attempts) == 2 and best.ok
    feedback = llm.calls[1][-1]["content"]
    assert 'matched only "123456"' in feedback


def test_best_attempt_wins_when_none_pass():
    llm = FakeLlm({"pattern": r"(\d+)+"}, {"pattern": r"EMP-\d{6}"}, {"pattern": r"\d{3}"})
    # Examples of different shapes, so no pattern can be inferred from them
    best, attempts, _ = generate_rule(llm, "ids", ["EMP-123456", "123456-EMP"], ["EMP-1234567"])
    assert len(attempts) == 3
    assert best.pattern == r"EMP-\d{6}"


def test_invalid_json_counts_as_an_attempt():
    llm = FakeLlm(LlmResponseError("bad"), EMP)
    best, attempts, _ = generate_rule(llm, "ids", ["EMP-123456"], [])
    assert best.ok and len(attempts) == 1


def test_llm_unavailable_propagates_when_nothing_can_be_inferred():
    with pytest.raises(LlmUnavailableError):
        generate_rule(FakeLlm(LlmUnavailableError("down")), "emails", ["a@b.com", "x.y@z.org"], [])


def test_llm_unavailable_falls_back_to_inferred_pattern():
    best, attempts, model = generate_rule(FakeLlm(LlmUnavailableError("down")), "ids", ["EMP-123456"], [])
    assert best.strategy == "EXAMPLES" and best.ok
    assert attempts == [] and model == ""


def test_inferred_pattern_beats_a_failing_llm():
    llm = FakeLlm({"pattern": r"\bSEC-42\b", "name": "Jira key", "severity": "LOW"}, {"pattern": r"\bSEC-42\b"}, {"pattern": r"SEC"})
    best, _, _ = generate_rule(llm, "Jira keys for SEC", ["SEC-42", "SEC-1093"], ["SECRET-42"])
    assert best.strategy == "EXAMPLES" and best.pattern == r"\bSEC-\d{2,4}\b"
    # naming still comes from the LLM
    assert best.name == "Jira key" and best.severity == "LOW"


def test_llm_wins_ties_with_inferred_pattern():
    llm = FakeLlm({"pattern": r"\bEMP-\d{6,8}\b"})
    best, _, _ = generate_rule(llm, "EMP ids with 6 to 8 digits", ["EMP-123456"], [])
    assert best.strategy == "LLM" and best.pattern == r"\bEMP-\d{6,8}\b"


def test_llm_prompt_includes_inferred_hint():
    llm = FakeLlm(EMP)
    generate_rule(llm, "ids", ["EMP-123456"], [])
    assert r"\bEMP-\d{6}\b" in llm.calls[0][1]["content"]


@pytest.mark.parametrize("examples, expected", [
    (["EMP-123456", "EMP-000981", "emp-554433"], r"\bEMP-\d{6}\b"),
    (["MH 12 AB 1234", "KA01MJ2020", "TN-09-BC-4567"], r"\b[A-Z]{2}[-\s]?\d{2}[-\s]?[A-Z]{2}[-\s]?\d{4}\b"),
    (["SEC-42", "SEC-1093"], r"\bSEC-\d{2,4}\b"),
    (["INV/2024/0001"], r"\bINV/\d{4}/\d{4}\b"),
    (["a@b.com", "x.y@z.org"], None),        # different shapes
    (["-12"], None),                          # leading separator
    (["AB--12"], None),                       # multi-char separator
])
def test_infer_pattern(examples, expected):
    assert infer_pattern(examples) == expected


def test_inferred_vehicle_pattern_rejects_unrelated_text():
    pattern = infer_pattern(["MH 12 AB 1234", "KA01MJ2020", "TN-09-BC-4567"])
    attempt = evaluate({"pattern": pattern}, ["GJ-05-KL-9876"], ["Room 12 floor 3"])
    assert attempt.ok
    assert infer_pattern(["MH 12 AB 1234", "KA01MJ2020"]) == r"\b[A-Z]{2}\s?\d{2}\s?[A-Z]{2}\s?\d{4}\b"


def test_category_kept_only_when_request_mentions_it():
    assert plausible_category("PHONE", "Indian vehicle registration numbers MH 12 AB 1234") == "CUSTOM"
    assert plausible_category("PHONE", "office phone extensions") == "PHONE"
    assert plausible_category("CUSTOM", "anything") == "CUSTOM"


def test_category_hint_overrides_model_choice():
    best, _, _ = generate_rule(FakeLlm(EMP), "ids", ["EMP-123456"], [], category_hint="api_key")
    assert best.category == "API_KEY"


# ── Explainer ────────────────────────────────────────────────────────────────

def test_template_exists_for_ai_and_regex_categories():
    for category in ["AADHAAR", "CREDIT_CARD", "PERSON", "MEDICAL", "IBAN", "SOMETHING_NEW"]:
        t = template_explanation(category)
        assert t["summary"] and t["risks"] and t["recommendation"]


def test_evidence_is_plain_language():
    facts = evidence("HYBRID", 0.97, ["verhoeff_valid", "context:aadhaar"], None)
    assert facts == [
        "matched a regex rule and was verified by the ML validator",
        "verhoeff check passed",
        'the word "aadhaar" appears nearby',
        "confidence 97%",
    ]


def test_llm_never_sees_or_echoes_the_value():
    llm = FakeLlm({"summary": "The number 2345 6789 0124 is an Aadhaar.", "risks": ["fraud"], "recommendation": "mask it"})
    explanation, _ = llm_explanation(llm, "AADHAAR", "my aadhaar is 2345 6789 0124 ok", "2345 6789 0124", [])
    sent = llm.calls[0][-1]["content"]
    assert "2345 6789 0124" not in sent and "[VALUE]" in sent
    assert "2345 6789 0124" not in explanation["summary"]


def test_llm_explanation_fills_missing_fields_from_template():
    explanation, _ = llm_explanation(FakeLlm({"summary": "Risky."}), "PERSON", "", "", [])
    assert explanation["risks"] == template_explanation("PERSON")["risks"]


# ── API ──────────────────────────────────────────────────────────────────────

def test_api_explain_template_needs_no_llm(client):
    res = client.post("/explain", json={"category": "AADHAAR", "source": "HYBRID", "reasons": ["verhoeff_valid"]})
    body = res.json()
    assert res.status_code == 200 and body["source"] == "TEMPLATE"
    assert "verhoeff check passed" in body["evidence"]


def test_api_generate_rule_with_fake_llm(client, monkeypatch):
    monkeypatch.setattr(main, "ollama", FakeLlm(EMP))
    body = client.post("/generate-rule", json={"description": "employee ids", "examples": ["EMP-123456"]}).json()
    assert body["rule"]["allPassed"] and body["rule"]["pattern"] == r"\bEMP-\d{6}\b"


def test_api_llm_unavailable_is_503_with_code(client, monkeypatch):
    monkeypatch.setattr(main, "ollama", FakeLlm(LlmUnavailableError("Ollama unreachable")))
    res = client.post("/generate-rule", json={"description": "emails", "examples": ["a@b.com", "x.y@z.org"]})
    assert res.status_code == 503 and res.json()["detail"]["code"] == "LLM_UNAVAILABLE"


def test_api_falls_back_to_inferred_pattern_without_llm(client, monkeypatch):
    monkeypatch.setattr(main, "ollama", FakeLlm(LlmUnavailableError("Ollama unreachable")))
    body = client.post("/generate-rule", json={"description": "employee ids", "examples": ["EMP-123456"]}).json()
    assert body["rule"]["strategy"] == "EXAMPLES" and body["model"] is None and body["attempts"] == 0
