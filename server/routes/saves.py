"""Save-game persistence endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import get_db
from models import SaveGame

router = APIRouter(prefix="/api/save", tags=["saves"])


class SaveBody(BaseModel):
    data: dict
    reason: str = "auto"


@router.get("/{profile}")
def load(profile: str, db: Session = Depends(get_db)):
    row = db.query(SaveGame).filter_by(profile=profile).first()
    if not row:
        raise HTTPException(404, "no save for profile")
    return {"profile": row.profile, "data": row.data, "updated_at": row.updated_at.isoformat()}


@router.post("/{profile}")
def store(profile: str, body: SaveBody, db: Session = Depends(get_db)):
    if len(profile) > 64:
        raise HTTPException(400, "profile name too long")
    row = db.query(SaveGame).filter_by(profile=profile).first()
    if row:
        row.data = body.data
        row.reason = body.reason
    else:
        row = SaveGame(profile=profile, data=body.data, reason=body.reason)
        db.add(row)
    db.commit()
    return {"ok": True, "profile": profile}
