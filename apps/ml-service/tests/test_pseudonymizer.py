import re
import time

import pytest

from app.pseudonymizer import MappingStore, Session, fake_value
from app.validators import aadhaar_valid, digits_only, iban_valid, luhn_valid, pan_valid, ssn_valid


def entity(text, category, match):
    start = text.index(match)
    return {"category": category, "match": match, "start": start, "end": start + len(match)}


# ── Fakes keep format and validity ───────────────────────────────────────────

@pytest.mark.parametrize("_", range(20))
def test_fake_credit_card_is_luhn_valid_and_same_shape(_):
    fake = fake_value("CREDIT_CARD", "4111 1111 1111 1111")
    assert re.fullmatch(r"4\d{3} \d{4} \d{4} \d{4}", fake)
    assert luhn_valid(digits_only(fake))


@pytest.mark.parametrize("_", range(20))
def test_fake_aadhaar_is_verhoeff_valid(_):
    fake = fake_value("AADHAAR", "2345 6789 0124")
    assert re.fullmatch(r"\d{4} \d{4} \d{4}", fake)
    assert aadhaar_valid(digits_only(fake))


@pytest.mark.parametrize("_", range(20))
def test_fake_iban_is_mod97_valid_and_keeps_country(_):
    fake = fake_value("BANK_ACCOUNT", "GB29NWBK60161331926819")
    assert fake.startswith("GB") and len(fake) == 22
    assert iban_valid(fake)


def test_fake_iban_keeps_spacing():
    fake = fake_value("BANK_ACCOUNT", "GB29 NWBK 6016 1331 9268 19")
    assert re.fullmatch(r"GB\d{2} [A-Z]{4} \d{4} \d{4} \d{4} \d{2}", fake)
    assert iban_valid(fake)


def test_fake_ssn_pan_phone_api_key():
    assert ssn_valid(digits_only(fake_value("SSN", "123-45-6789")))
    assert re.fullmatch(r"\d{3}-\d{2}-\d{4}", fake_value("SSN", "123-45-6789"))
    pan = fake_value("PAN", "ABCPE1234F")
    assert pan_valid(pan) and pan[3] == "P"
    phone = fake_value("PHONE", "+91 98765 43210")
    assert re.fullmatch(r"\+91 9\d{4} \d{5}", phone)
    key = fake_value("API_KEY", "AKIAIOSFODNN7EXAMPLE")
    assert key.startswith("AKIA") and len(key) == 20


def test_fake_person_keeps_word_count():
    assert len(fake_value("PERSON", "Priya Sharma").split()) == 2
    assert len(fake_value("PERSON", "Priya").split()) == 1


def test_unknown_category_keeps_shape():
    fake = fake_value("CUSTOM", "EMP-4821-X")
    assert re.fullmatch(r"[A-Z]{3}-\d{4}-[A-Z]", fake)


# ── Session: consistency and round trip ──────────────────────────────────────

PROMPT = "Priya Sharma from Chennai paid with 4111 1111 1111 1111. Ask Priya Sharma to confirm."


def prompt_entities():
    first = entity(PROMPT, "PERSON", "Priya Sharma")
    second = {**first, "start": PROMPT.rindex("Priya Sharma"), "end": PROMPT.rindex("Priya Sharma") + 12}
    return [first, entity(PROMPT, "LOCATION", "Chennai"), entity(PROMPT, "CREDIT_CARD", "4111 1111 1111 1111"), second]


def test_pseudonymize_replaces_every_span_consistently():
    s = Session(id="t")
    text, reps = s.pseudonymize(PROMPT, prompt_entities())

    assert "Priya" not in text and "Chennai" not in text and "4111 1111" not in text
    names = [r.fake for r in reps if r.category == "PERSON"]
    assert len(names) == 2 and names[0] == names[1]
    # fake offsets point into the rewritten text
    for r in reps:
        assert text[r.fakeStart:r.fakeEnd] == r.fake


def test_round_trip_restores_original_values():
    s = Session(id="t")
    text, _ = s.pseudonymize(PROMPT, prompt_entities())
    restored, counts = s.restore(text)
    assert restored == PROMPT
    assert sum(counts.values()) == 4


def test_restore_handles_first_name_only_and_unspaced_numbers():
    s = Session(id="t")
    _, reps = s.pseudonymize(PROMPT, prompt_entities())
    fake_name = next(r.fake for r in reps if r.category == "PERSON")
    fake_card = next(r.fake for r in reps if r.category == "CREDIT_CARD")

    reply = f"Sure, {fake_name.split()[0]}! The card ending {fake_card.replace(' ', '')} is noted."
    restored, _ = s.restore(reply)
    assert restored == "Sure, Priya! The card ending 4111111111111111 is noted."


def test_restore_does_not_touch_partial_words():
    s = Session(id="t")
    text = "Call Ravi now"
    s.pseudonymize(text, [entity(text, "PERSON", "Ravi")])
    fake = s.forward[("PERSON", "Ravi")]
    restored, _ = s.restore(f"{fake}x and x{fake} stay, {fake} goes")
    assert restored == f"{fake}x and x{fake} stay, Ravi goes"


def test_different_originals_get_different_fakes():
    s = Session(id="t")
    fakes = {s.fake_for("PERSON", f"Person{i}", "") for i in range(50)}
    assert len(fakes) == 50


def test_fake_never_appears_in_prompt():
    s = Session(id="t")
    text = "Rahul and Amit"
    for _ in range(30):
        s.forward.clear()
        s.reverse.clear()
        assert s.fake_for("PERSON", "Rahul", text).lower() not in text.lower()


def test_skips_overlapping_and_mismatched_spans():
    s = Session(id="t")
    text = "card 4111 1111 1111 1111"
    good = entity(text, "CREDIT_CARD", "4111 1111 1111 1111")
    overlap = {**good, "start": good["start"] + 2}
    wrong = {**good, "match": "9999"}
    _, reps = s.pseudonymize(text, [good, overlap, wrong])
    assert len(reps) == 1


# ── Store ────────────────────────────────────────────────────────────────────

def test_store_reuses_and_expires_sessions():
    store = MappingStore(ttl_seconds=60, max_sessions=10)
    s = store.get_or_create(None)
    assert store.get_or_create(s.id) is s

    s.last_used = time.monotonic() - 61
    assert store.get(s.id) is None


def test_store_evicts_oldest_at_capacity():
    store = MappingStore(ttl_seconds=60, max_sessions=2)
    a = store.get_or_create(None)
    a.last_used -= 10
    store.get_or_create(None)
    store.get_or_create(None)
    assert store.get(a.id) is None
    assert len(store) == 2


# ── API ──────────────────────────────────────────────────────────────────────

def test_api_round_trip(client):
    body = {"text": PROMPT, "entities": prompt_entities()}
    res = client.post("/pseudonymize", json=body).json()
    assert res["mappingId"] and len(res["replacements"]) == 4

    restored = client.post("/restore", json={"mappingId": res["mappingId"], "text": res["text"]}).json()
    assert restored["text"] == PROMPT and restored["restoredCount"] == 4


def test_api_reuses_mapping_across_prompts(client):
    text = "Email Priya Sharma"
    ent = [entity(text, "PERSON", "Priya Sharma")]
    first = client.post("/pseudonymize", json={"text": text, "entities": ent}).json()
    second = client.post("/pseudonymize", json={"text": text, "entities": ent, "mappingId": first["mappingId"]}).json()
    assert second["mappingId"] == first["mappingId"]
    assert second["text"] == first["text"]


def test_api_restore_unknown_mapping_is_404(client):
    assert client.post("/restore", json={"mappingId": "nope", "text": "hi"}).status_code == 404


def test_api_forget_mapping(client):
    res = client.post("/pseudonymize", json={"text": "hi Ravi", "entities": [entity("hi Ravi", "PERSON", "Ravi")]}).json()
    assert client.delete(f"/mappings/{res['mappingId']}").status_code == 204
    assert client.post("/restore", json={"mappingId": res["mappingId"], "text": "x"}).status_code == 404


# ── No leaks through shared words ────────────────────────────────────────────

@pytest.mark.parametrize("_", range(50))
def test_fake_person_never_reuses_a_real_name_part(_):
    s = Session(id="t")
    text = "Write to Priya Sharma"
    fake = s.fake_for("PERSON", "Priya Sharma", text)
    assert not {"priya", "sharma"} & {w.lower() for w in fake.split()}


def test_name_parts_are_unique_across_people():
    s = Session(id="t")
    text = "Priya Sharma met Rahul Verma"
    a = s.fake_for("PERSON", "Priya Sharma", text)
    b = s.fake_for("PERSON", "Rahul Verma", text)
    assert not set(a.split()) & set(b.split())
