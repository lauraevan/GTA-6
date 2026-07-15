"""Persistence models: save slots and race leaderboard times."""

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SaveGame(Base):
    __tablename__ = "saves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    profile: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    data: Mapped[dict] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(32), default="auto")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class RaceTime(Base):
    __tablename__ = "race_times"
    __table_args__ = (UniqueConstraint("race_id", "profile", name="uq_race_profile"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    race_id: Mapped[str] = mapped_column(String(64), index=True)
    profile: Mapped[str] = mapped_column(String(64))
    ms: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
