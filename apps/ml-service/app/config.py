import os


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    # spaCy is used for tokenisation; with NER_MODEL set, a HuggingFace model does the NER
    spacy_model: str = os.getenv("SPACY_MODEL", "en_core_web_sm")
    ner_model: str = os.getenv("NER_MODEL", "dslim/bert-base-NER")
    injection_model: str = os.getenv("INJECTION_MODEL", "protectai/deberta-v3-base-prompt-injection-v2")
    enable_injection_model: bool = _flag("ENABLE_INJECTION_MODEL", True)
    # Tests set this to false to start the API without loading any model
    load_models: bool = _flag("LOAD_MODELS", True)
    max_text_length: int = int(os.getenv("MAX_TEXT_LENGTH", "50000"))
    # Smart-rewrite mappings (in memory only); TTL slides on each use
    mapping_ttl_seconds: int = int(os.getenv("MAPPING_TTL_SECONDS", "3600"))
    max_mappings: int = int(os.getenv("MAX_MAPPINGS", "1000"))
    # Ollama (optional): rule generator and LLM explanations. The first model in
    # the list that is pulled locally is used; OLLAMA_MODEL goes first.
    ollama_url: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    ollama_models: list[str] = list(dict.fromkeys(
        m.strip()
        for m in os.getenv("OLLAMA_MODEL", "qwen2.5-coder:3b").split(",") + ["qwen2.5-coder:3b", "gemma3:4b", "llama3"]
        if m.strip()
    ))
    ollama_timeout: float = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "60"))
    # Retries stop once this much time has passed (keep below the backend's ML_LLM_TIMEOUT_MS)
    rule_generation_budget_seconds: float = float(os.getenv("RULE_GENERATION_BUDGET_SECONDS", "90"))


settings = Settings()
