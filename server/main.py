"""GRAND THEFT AUDI — backend entrypoint.

Serves save-game persistence, race leaderboards, the asset manifest and the
procedural world generator. Optionally serves the built client from
client/dist so a single `uvicorn main:app` runs the whole game.

    cd server && uvicorn main:app --port 8177
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from db import Base, engine
from routes import assets, leaderboard, saves, world

Base.metadata.create_all(engine)

app = FastAPI(title="Grand Theft Audi API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(saves.router)
app.include_router(leaderboard.router)
app.include_router(assets.router)
app.include_router(world.router)


@app.get("/api/health")
def health():
    return {"ok": True, "game": "grand-theft-audi", "city": "Neustadt Bay"}


# serve the built client if present (production single-process mode)
_dist = Path(__file__).resolve().parent.parent / "client" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="client")
