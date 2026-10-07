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


class GenerateRuleRequest(BaseModel):
    description: str = Field(..., min_length=3, max_length=500)
    examples: list[str] = Field(..., min_length=1, max_length=20)
    negatives: list[str] = Field(default_factory=list, max_length=20)
    category: Optional[str] = Field(None, max_length=50)


class ExampleResultOut(BaseModel):
    text: str
    expected: bool
    matched: Optional[str]
    passed: bool


class GeneratedRule(BaseModel):
    pattern: str
    name: str
    category: str
    severity: str
    explanation: str
    problems: list[str]
    warnings: list[str]
    results: list[ExampleResultOut]
    allPassed: bool
    # LLM, or EXAMPLES when the pattern inferred from the examples' structure won
    strategy: Literal["LLM", "EXAMPLES"]


class GenerateRuleResponse(BaseModel):
    rule: GeneratedRule
    attempts: int
    model: Optional[str]   # None when Ollama was unavailable
    durationMs: int


class ExplainRequest(BaseModel):
    category: str = Field(..., min_length=1, max_length=50)
    match: str = Field("", max_length=1000)
    # Text around the match; the value is hidden before it reaches the LLM
    context: str = Field("", max_length=2000)
    source: Optional[str] = None
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list, max_length=20)
    recognizer: Optional[str] = None
    useLlm: bool = False


class Explanation(BaseModel):
    summary: str
    risks: list[str]
    recommendation: str


class ExplainResponse(BaseModel):
    category: str
    explanation: Explanation
    evidence: list[str]
    source: Literal["TEMPLATE", "LLM"]
    model: Optional[str]
    durationMs: int


class InjectionResponse(BaseModel):
    score: float
    modelScore: Optional[float]   # None when the model is not loaded
    heuristicScore: float
    label: Literal["INJECTION", "SAFE"]
    isInjection: bool
    model: str
    durationMs: int
