"""
Entity detection with Microsoft Presidio.

NER runs either on a HuggingFace token-classification model (NER_MODEL, default
dslim/bert-base-NER, via Presidio's TransformersNlpEngine) or on spaCy alone
when NER_MODEL is empty. Presidio results are mapped onto PromptGuard's own
categories and severities so the backend can merge them with regex hits.
"""

from __future__ import annotations

import logging
import re

from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider

from .config import settings
from .schemas import Entity

log = logging.getLogger(__name__)

# Entities regex rules cannot find. DATE_TIME is kept only as a date of birth.
AI_ENTITIES = ["PERSON", "LOCATION", "ORGANIZATION", "DATE_TIME", "MEDICAL_CONDITION"]

# Structured entities Presidio also knows; requested only in AI-only mode
STRUCTURED_ENTITIES = [
    "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "IBAN_CODE", "US_SSN",
    "IP_ADDRESS", "US_BANK_NUMBER", "US_PASSPORT", "IN_AADHAAR", "IN_PAN",
]

# Presidio entity -> (PromptGuard category, severity)
CATEGORY_MAP = {
    "PERSON": ("PERSON", "MEDIUM"),
    "LOCATION": ("LOCATION", "LOW"),
    "ORGANIZATION": ("ORGANIZATION", "LOW"),
    "DATE_OF_BIRTH": ("DATE_OF_BIRTH", "HIGH"),
    "MEDICAL_CONDITION": ("MEDICAL", "HIGH"),
    "EMAIL_ADDRESS": ("EMAIL", "LOW"),
    "PHONE_NUMBER": ("PHONE", "MEDIUM"),
    "CREDIT_CARD": ("CREDIT_CARD", "CRITICAL"),
    "IBAN_CODE": ("BANK_ACCOUNT", "HIGH"),
    "US_BANK_NUMBER": ("BANK_ACCOUNT", "HIGH"),
    "US_SSN": ("SSN", "CRITICAL"),
    "IP_ADDRESS": ("IP_ADDRESS", "MEDIUM"),
    "US_PASSPORT": ("PASSPORT", "CRITICAL"),
    "IN_AADHAAR": ("AADHAAR", "HIGH"),
    "IN_PAN": ("PAN", "HIGH"),
}

ENTITY_MAPPING = {
    "PER": "PERSON", "PERSON": "PERSON",
    "LOC": "LOCATION", "LOCATION": "LOCATION", "GPE": "LOCATION", "FAC": "LOCATION",
    "ORG": "ORGANIZATION", "ORGANIZATION": "ORGANIZATION",
    "DATE": "DATE_TIME", "TIME": "DATE_TIME",
    "NORP": "NRP",
}

# HuggingFace NER models (e.g. dslim/bert-base-NER) have no DATE label, so dates
# come from patterns; DOB_CONTEXT then decides whether a date is a date of birth
_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
DATE_PATTERNS = [
    Pattern("day_month_year", rf"(?i)\b\d{{1,2}}(?:st|nd|rd|th)?\s+{_MONTH},?\s+\d{{4}}\b", 0.6),
    Pattern("month_day_year", rf"(?i)\b{_MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}\b", 0.6),
    Pattern("numeric", r"\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}\b", 0.5),
    Pattern("iso", r"\b(?:19|20)\d{2}-\d{2}-\d{2}\b", 0.5),
]

# NER models often tag ID labels ("Aadhaar", "PAN") as names or organisations
NOT_ENTITIES = {
    "aadhaar", "aadhar", "pan", "ssn", "iban", "ifsc", "upi", "uidai", "passport",
    "visa", "mastercard", "amex", "rupay", "dob", "otp", "pin", "cvv", "email", "phone",
}

# NER models trained on Western news text often cut Indian names short
# ("Priya" instead of "Priya Sharma"); following capitalised words are folded in
NAME_CONTINUATION = re.compile(r"(?:[ ]+[A-Z][a-z]+){1,2}")


def extend_person_span(text: str, end: int) -> int:
    m = NAME_CONTINUATION.match(text, end)
    if not m:
        return end
    new_end = end
    for word in m.group().split():
        if word.lower() in NOT_ENTITIES:
            break
        new_end = text.index(word, new_end) + len(word)
    return new_end


DOB_CONTEXT = re.compile(r"\b(born|dob|d\.o\.b|date of birth|birth ?date|birthday)\b", re.IGNORECASE)
DOB_WINDOW = 40

MEDICAL_TERMS = [
    "diabetes", "type 1 diabetes", "type 2 diabetes", "hypertension", "cancer", "leukemia",
    "lymphoma", "tumor", "tumour", "HIV", "AIDS", "asthma", "COPD", "depression",
    "anxiety disorder", "bipolar disorder", "schizophrenia", "PTSD", "ADHD", "autism",
    "tuberculosis", "hepatitis", "hepatitis B", "hepatitis C", "epilepsy", "dementia",
    "Alzheimer's", "Parkinson's", "multiple sclerosis", "stroke", "heart attack",
    "heart disease", "kidney disease", "chronic kidney disease", "cirrhosis", "arthritis",
    "thyroid", "hypothyroidism", "hyperthyroidism", "COVID-19", "chemotherapy", "dialysis",
    "insulin", "antidepressants", "miscarriage", "infertility", "STD", "herpes",
]
MEDICAL_CONTEXT = ["diagnosed", "suffering", "patient", "treatment", "medication",
                   "prescribed", "condition", "disease", "history", "therapy"]


def _nlp_configuration() -> dict:
    ner_config = {
        "model_to_presidio_entity_mapping": ENTITY_MAPPING,
        "labels_to_ignore": ["O", "MISC", "CARDINAL", "ORDINAL", "QUANTITY", "MONEY", "PERCENT"],
        "low_confidence_score_multiplier": 0.4,
        "low_score_entity_names": [],
    }
    if settings.ner_model:
        return {
            "nlp_engine_name": "transformers",
            "models": [{
                "lang_code": "en",
                "model_name": {"spacy": settings.spacy_model, "transformers": settings.ner_model},
            }],
            "ner_model_configuration": {**ner_config, "aggregation_strategy": "simple", "alignment_mode": "expand"},
        }
    return {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "en", "model_name": settings.spacy_model}],
        "ner_model_configuration": ner_config,
    }


class Detector:
    def __init__(self) -> None:
        nlp_engine = NlpEngineProvider(nlp_configuration=_nlp_configuration()).create_engine()

        registry = RecognizerRegistry(supported_languages=["en"])
        registry.load_predefined_recognizers(languages=["en"], nlp_engine=nlp_engine)
        registry.add_recognizer(PatternRecognizer(
            supported_entity="MEDICAL_CONDITION",
            name="MedicalConditionRecognizer",
            deny_list=MEDICAL_TERMS,
            deny_list_score=0.6,
            context=MEDICAL_CONTEXT,
        ))
        registry.add_recognizer(PatternRecognizer(
            supported_entity="DATE_TIME",
            name="DatePatternRecognizer",
            patterns=DATE_PATTERNS,
        ))

        self.analyzer = AnalyzerEngine(nlp_engine=nlp_engine, registry=registry, supported_languages=["en"])
        supported = set(self.analyzer.get_supported_entities(language="en"))
        self.ai_entities = [e for e in AI_ENTITIES if e in supported]
        self.all_entities = self.ai_entities + [e for e in STRUCTURED_ENTITIES if e in supported]
        self.model_name = settings.ner_model or settings.spacy_model
        log.info("Detector ready (model=%s, entities=%s)", self.model_name, self.all_entities)

    def detect(self, text: str, entities: str = "ai", threshold: float = 0.5) -> list[Entity]:
        wanted = self.all_entities if entities == "all" else self.ai_entities
        results = self.analyzer.analyze(text=text, language="en", entities=wanted, score_threshold=threshold)

        found: list[Entity] = []
        for r in results:
            entity_type = r.entity_type
            score = r.score

            if entity_type == "DATE_TIME":
                # A bare date is not sensitive; a date of birth is
                window = text[max(0, r.start - DOB_WINDOW):r.start]
                if not DOB_CONTEXT.search(window):
                    continue
                entity_type, score = "DATE_OF_BIRTH", max(score, 0.85)

            if entity_type not in CATEGORY_MAP:
                continue
            if text[r.start:r.end].strip(" .,:;").lower() in NOT_ENTITIES:
                continue
            end = extend_person_span(text, r.end) if entity_type == "PERSON" else r.end
            category, severity = CATEGORY_MAP[entity_type]
            found.append(Entity(
                entityType=entity_type,
                category=category,
                severity=severity,
                match=text[r.start:end],
                start=r.start,
                end=end,
                confidence=round(min(score, 1.0), 3),
                recognizer=(r.recognition_metadata or {}).get("recognizer_name", "unknown"),
            ))

        return dedupe_spans(found)


def dedupe_spans(entities: list[Entity]) -> list[Entity]:
    """Drops entities inside an earlier, longer one (an extended name can swallow a split surname)."""
    entities.sort(key=lambda e: (e.start, -(e.end - e.start)))
    kept: list[Entity] = []
    for e in entities:
        if kept and e.start >= kept[-1].start and e.end <= kept[-1].end:
            continue
        kept.append(e)
    return kept
