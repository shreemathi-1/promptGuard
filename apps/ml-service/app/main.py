"""PromptGuard ML service: local AI detection for the PromptGuard backend."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version

from fastapi import FastAPI, HTTPException

from .config import settings
from .injection import INJECTION_THRESHOLD, InjectionClassifier
from .pseudonymizer import MappingStore
from .schemas import (
    DetectRequest, DetectResponse, HitAssessment, InjectionRequest,
    InjectionResponse, PseudonymizeRequest, PseudonymizeResponse,
    PseudonymReplacement, RestoreRequest, RestoreResponse,
    ValidateRequest, ValidateResponse,
)
from .validators import assess_hit

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
log = logging.getLogger("ml-service")

state: dict = {"detector": None, "detector_error": None, "injection": None}
mappings = MappingStore(settings.mapping_ttl_seconds, settings.max_mappings)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Models load once, before the server accepts requests
    if settings.load_models:
        try:
            from .detector import Detector
            state["detector"] = Detector()
        except Exception as exc:  # noqa: BLE001 — report in /health instead of crashing
            state["detector_error"] = str(exc)
            log.exception("Detector failed to load")
    state["injection"] = InjectionClassifier(use_model=settings.load_models and settings.enable_injection_model)
    yield


app = FastAPI(title="PromptGuard ML Service", version="1.0.0", lifespan=lifespan)


def _elapsed_ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def _pkg_version(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


@app.get("/health")
def health():
    detector = state["detector"]
    injection = state["injection"]
    return {
        "status": "ok" if detector else "degraded",
        "detector": {
            "loaded": detector is not None,
            "model": detector.model_name if detector else None,
            "entities": detector.all_entities if detector else [],
            "error": state["detector_error"],
        },
        "injection": {
            "model": injection.model_name if injection else None,
            "error": injection.load_error if injection else None,
        },
        "pseudonymizer": {"activeMappings": len(mappings), "ttlSeconds": settings.mapping_ttl_seconds},
        "versions": {
            "presidio-analyzer": _pkg_version("presidio-analyzer"),
            "transformers": _pkg_version("transformers"),
            "spacy": _pkg_version("spacy"),
        },
    }


@app.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    detector = state["detector"]
    if detector is None:
        raise HTTPException(status_code=503, detail="Entity detector is not loaded")
    start = time.perf_counter()
    entities = detector.detect(req.text, req.entities, req.threshold)
    return DetectResponse(entities=entities, model=detector.model_name, durationMs=_elapsed_ms(start))


@app.post("/validate", response_model=ValidateResponse)
def validate(req: ValidateRequest):
    results = []
    for i, hit in enumerate(req.hits):
        a = assess_hit(req.text, hit.category, hit.match, hit.start, hit.end)
        results.append(HitAssessment(index=i, confidence=a.confidence, checksum=a.checksum, reasons=a.reasons))
    return ValidateResponse(results=results)


@app.post("/pseudonymize", response_model=PseudonymizeResponse)
def pseudonymize(req: PseudonymizeRequest):
    start = time.perf_counter()
    session = mappings.get_or_create(req.mappingId)
    with session.lock:
        text, replacements = session.pseudonymize(req.text, [e.model_dump() for e in req.entities])
    return PseudonymizeResponse(
        text=text,
        mappingId=session.id,
        replacements=[PseudonymReplacement(**r.__dict__) for r in replacements],
        ttlSeconds=settings.mapping_ttl_seconds,
        durationMs=_elapsed_ms(start),
    )


@app.post("/restore", response_model=RestoreResponse)
def restore(req: RestoreRequest):
    start = time.perf_counter()
    session = mappings.get(req.mappingId)
    if session is None:
        raise HTTPException(status_code=404, detail="Mapping not found or expired")
    with session.lock:
        text, counts = session.restore(req.text)
    return RestoreResponse(text=text, restoredCount=sum(counts.values()), restored=counts, durationMs=_elapsed_ms(start))


@app.delete("/mappings/{mapping_id}", status_code=204)
def forget_mapping(mapping_id: str):
    if not mappings.delete(mapping_id):
        raise HTTPException(status_code=404, detail="Mapping not found or expired")


@app.post("/injection", response_model=InjectionResponse)
def injection(req: InjectionRequest):
    classifier = state["injection"]
    start = time.perf_counter()
    scores = classifier.score(req.text)
    is_injection = scores["score"] >= INJECTION_THRESHOLD
    return InjectionResponse(
        **scores,
        label="INJECTION" if is_injection else "SAFE",
        isInjection=is_injection,
        model=classifier.model_name,
        durationMs=_elapsed_ms(start),
    )
