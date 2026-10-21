from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'datos'
DB_PATH = DATA_DIR / 'puntos.sqlite3'
CAPTURE_DIR = DATA_DIR / 'capturas'
WEB_DIR = ROOT / 'web'
MAX_UPLOAD = 35 * 1024 * 1024
MAX_CAPTURE_UPLOAD = 17 * 1024 * 1024
for path in (DATA_DIR, CAPTURE_DIR):
    path.mkdir(parents=True, exist_ok=True)
