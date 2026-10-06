from typing import Literal, Optional

from pydantic import BaseModel, Field

from .config import settings

Text = Field(..., min_length=1, max_length=settings.max_text_length)


class DetectRequest(BaseModel):
    text: str = Text
    # "ai": only entities regex cannot find (names, places, ...); "all": every Presidio entity
    entities: Literal["ai", "all"] = "ai"
    threshold: float = Field(0.5, ge=0.0, le=1.0)


class Entity(BaseModel):
    entityType: str
    category: str
    severity: str
    match: str
    start: int
    end: int
    confidence: float
    recognizer: str


class DetectResponse(BaseModel):
    entities: list[Entity]
    model: str
    durationMs: int


class Hit(BaseModel):
    category: str
    match: str
    start: int = Field(..., ge=0)
    end: int = Field(..., ge=0)


class ValidateRequest(BaseModel):
    text: str = Text
    hits: list[Hit] = Field(..., max_length=5000)


class HitAssessment(BaseModel):
    index: int
    confidence: float
    checksum: Optional[bool]
    reasons: list[str]


class ValidateResponse(BaseModel):
    results: list[HitAssessment]


class InjectionRequest(BaseModel):
    text: str = Text


class PseudonymizeEntity(BaseModel):
    category: str
    match: str = Field(..., min_length=1)
    start: int = Field(..., ge=0)
    end: int = Field(..., ge=0)


class PseudonymizeRequest(BaseModel):
    text: str = Text
    entities: list[PseudonymizeEntity] = Field(..., max_length=5000)
    # Pass the id from an earlier rewrite to keep the same fakes across prompts
    mappingId: Optional[str] = Field(None, max_length=64)


class PseudonymReplacement(BaseModel):
    category: str
    original: str
    fake: str
    start: int
    end: int
    fakeStart: int
    fakeEnd: int


class PseudonymizeResponse(BaseModel):
    text: str
    mappingId: str
    replacements: list[PseudonymReplacement]
    ttlSeconds: int
    durationMs: int


class RestoreRequest(BaseModel):
    mappingId: str = Field(..., min_length=1, max_length=64)
    text: str = Text


class RestoreResponse(BaseModel):
    text: str
    restoredCount: int
    # fake text → how many times it was swapped back
    restored: dict[str, int]
    durationMs: int


class InjectionResponse(BaseModel):
    score: float
    modelScore: Optional[float]   # None when the model is not loaded
    heuristicScore: float
    label: Literal["INJECTION", "SAFE"]
    isInjection: bool
    model: str
    durationMs: int
