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


class InjectionResponse(BaseModel):
    score: float
    modelScore: Optional[float]   # None when the model is not loaded
    heuristicScore: float
    label: Literal["INJECTION", "SAFE"]
    isInjection: bool
    model: str
    durationMs: int
