"""API smoke tests: health, save round-trip, leaderboard ordering, worldgen."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["GTA_DATABASE_URL"] = "sqlite:///:memory:"

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_save_roundtrip():
    assert client.get("/api/save/testp").status_code == 404
    snap = {"version": 1, "ts": 123, "player": {"money": 5000}}
    r = client.post("/api/save/testp", json={"data": snap, "reason": "test"})
    assert r.status_code == 200
    r = client.get("/api/save/testp")
    assert r.status_code == 200
    assert r.json()["data"]["player"]["money"] == 5000
    # overwrite
    snap["player"]["money"] = 7777
    client.post("/api/save/testp", json={"data": snap})
    assert client.get("/api/save/testp").json()["data"]["player"]["money"] == 7777


def test_leaderboard_best_time_and_order():
    client.post("/api/leaderboard/innenstadt", json={"profile": "a", "ms": 90000})
    client.post("/api/leaderboard/innenstadt", json={"profile": "b", "ms": 80000})
    # worse time for b must not overwrite
    r = client.post("/api/leaderboard/innenstadt", json={"profile": "b", "ms": 95000})
    assert r.json()["improved"] is False
    top = client.get("/api/leaderboard/innenstadt").json()["entries"]
    assert [e["profile"] for e in top] == ["b", "a"]
    assert top[0]["ms"] == 80000


def test_worldgen_deterministic():
    a = client.get("/api/world", params={"seed": 42}).json()
    b = client.get("/api/world", params={"seed": 42}).json()
    assert a == b
    assert a["meta"]["seed"] == 42
    assert len(a["nav"]["nodes"]) > 100
    assert len(a["chunks"]) == 64
    assert a["pois"]["bank"]["door"]


def test_assets_manifest():
    r = client.get("/api/assets/manifest")
    assert r.status_code == 200
    assert "models" in r.json()
