"""Asset manifest endpoint: reports which GLB hero assets are present so
clients (or tools) can check availability without hard-coding paths."""

from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api/assets", tags=["assets"])

MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "client" / "public" / "models"


@router.get("/manifest")
def manifest():
    files = []
    if MODELS_DIR.exists():
        for p in sorted(MODELS_DIR.glob("*.glb")):
            files.append({"name": p.stem, "file": p.name, "bytes": p.stat().st_size})
    return {"models": files, "dir": str(MODELS_DIR)}
