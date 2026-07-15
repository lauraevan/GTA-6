"""Race leaderboard: best time per profile per race."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db import get_db
from models import RaceTime

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


class TimeBody(BaseModel):
    profile: str = Field(max_length=64)
    ms: int = Field(gt=0, lt=1000 * 60 * 60)


@router.get("/{race_id}")
def top(race_id: str, limit: int = 10, db: Session = Depends(get_db)):
    rows = (
        db.query(RaceTime)
        .filter_by(race_id=race_id)
        .order_by(RaceTime.ms.asc())
        .limit(min(max(limit, 1), 50))
        .all()
    )
    return {
        "race": race_id,
        "entries": [
            {"profile": r.profile, "ms": r.ms, "at": r.updated_at.isoformat()} for r in rows
        ],
    }


@router.post("/{race_id}")
def submit(race_id: str, body: TimeBody, db: Session = Depends(get_db)):
    if len(race_id) > 64:
        raise HTTPException(400, "race id too long")
    row = db.query(RaceTime).filter_by(race_id=race_id, profile=body.profile).first()
    improved = False
    if row is None:
        db.add(RaceTime(race_id=race_id, profile=body.profile, ms=body.ms))
        improved = True
    elif body.ms < row.ms:
        row.ms = body.ms
        improved = True
    db.commit()
    return {"ok": True, "improved": improved}
