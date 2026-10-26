"""Download every model at image build time so containers start offline."""
from transformers import pipeline

from .config import settings

if settings.ner_model:
    pipeline("token-classification", model=settings.ner_model)
pipeline("text-classification", model=settings.injection_model)
print("Models downloaded")
