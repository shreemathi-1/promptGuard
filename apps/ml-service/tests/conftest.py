import os
import sys
from pathlib import Path

# Start the API without loading models; detector tests build their own
os.environ.setdefault("LOAD_MODELS", "false")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c
