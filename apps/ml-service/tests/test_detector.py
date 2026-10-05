"""Runs Presidio with spaCy only (no HuggingFace download), so it stays fast."""
import importlib.util

import pytest

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("en_core_web_sm") is None, reason="spaCy model en_core_web_sm not installed"
)


@pytest.fixture(scope="module")
def detector():
    from app.config import settings
    from app.detector import Detector

    settings.ner_model = ""
    settings.spacy_model = "en_core_web_sm"
    return Detector()


def categories(entities):
    return {e.category for e in entities}


def test_person_and_location(detector):
    found = detector.detect("John Smith moved to London last year.")
    assert {"PERSON", "LOCATION"} <= categories(found)


def test_date_of_birth_needs_context(detector):
    assert "DATE_OF_BIRTH" in categories(detector.detect("He was born on 14 March 1990."))
    assert "DATE_OF_BIRTH" not in categories(detector.detect("The meeting is on 14 March 1990."))


def test_medical_condition(detector):
    found = detector.detect("The patient was diagnosed with diabetes.")
    assert "MEDICAL" in categories(found)


def test_all_mode_includes_structured(detector):
    found = detector.detect("Email me at jane@example.com", entities="all")
    assert "EMAIL" in categories(found)
    assert "EMAIL" not in categories(detector.detect("Email me at jane@example.com"))


def test_id_labels_are_not_entities(detector):
    found = detector.detect("Priya gave her Aadhaar and PAN details.")
    assert not any(e.match in ("Aadhaar", "PAN") for e in found)


def test_dob_numeric_format(detector):
    found = detector.detect("DOB: 14/03/1990")
    assert [e.match for e in found if e.category == "DATE_OF_BIRTH"] == ["14/03/1990"]


def test_extend_person_span():
    from app.detector import extend_person_span

    text = "Priya Sharma Rao from Chennai gave her Aadhaar Card"
    assert text[:extend_person_span(text, 5)] == "Priya Sharma Rao"
    assert extend_person_span("Priya from Chennai", 5) == 5
    assert extend_person_span("Priya Aadhaar", 5) == 5
