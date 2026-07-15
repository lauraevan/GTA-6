"""Procedural world endpoint: generate a city layout for any seed on demand.
The client's bundled city.json is this generator's output for seed 1337."""

from functools import lru_cache

from fastapi import APIRouter

from worldgen.citygen import generate_city

router = APIRouter(prefix="/api", tags=["world"])


@lru_cache(maxsize=8)
def _cached(seed: int) -> dict:
    return generate_city(seed)


@router.get("/world")
def world(seed: int = 1337):
    return _cached(int(seed) & 0x7FFFFFFF)
