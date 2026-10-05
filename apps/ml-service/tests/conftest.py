import os
import sys
from pathlib import Path

# Start the API without loading models; detector tests build their own
os.environ.setdefault("LOAD_MODELS", "false")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
