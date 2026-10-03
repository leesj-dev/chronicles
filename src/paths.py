"""Source assets and private data have separate, working-directory-independent roots."""
from pathlib import Path

SRC = Path(__file__).resolve().parent
ROOT = SRC.parent
