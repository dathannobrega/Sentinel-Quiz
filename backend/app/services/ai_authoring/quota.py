"""Credits per user and day (PLANO §12.7). The ledger in PostgreSQL is the source of
truth: credits are reserved when a job is created (fail-closed: no ledger row, no job)
and refunded for work that was not delivered."""
from __future__ import annotations

from datetime import datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import api_error
from app.models import AiUsageLedger, User

CREDITS = {"generate": 1.0, "from_source": 1.0, "improve": 0.5}


def daily_limit(user: User) -> float | None:
    if user.role == "admin":
        return None
    return max(float(settings.ai_daily_quota_credits or 0.0), 0.0)


def _day_start(now: datetime) -> datetime:
    return datetime.combine(now.astimezone(timezone.utc).date(), time.min, tzinfo=timezone.utc)


def used_today(db: Session, user_id: str, *, now: datetime | None = None) -> float:
    start = _day_start(now or utcnow())
    value = db.execute(
        select(func.coalesce(func.sum(AiUsageLedger.credits), 0.0)).where(
            AiUsageLedger.owner_user_id == user_id, AiUsageLedger.at >= start
        )
    ).scalar_one()
    return round(float(value or 0.0), 2)


def summary(db: Session, user: User) -> dict:
    limit = daily_limit(user)
    used = used_today(db, user.id)
    return {"daily_limit": limit, "used_today": used, "remaining": None if limit is None else round(max(limit - used, 0.0), 2)}


def reserve(db: Session, user: User, *, credits: float, feature: str, job_id: str) -> None:
    """Reserve credits inside the caller's transaction (row lock on the user serializes
    concurrent requests of the same person on PostgreSQL)."""
    db.execute(select(User.id).where(User.id == user.id).with_for_update())
    limit = daily_limit(user)
    if limit is not None:
        remaining = limit - used_today(db, user.id)
        if credits > remaining + 1e-9:
            exc = api_error(429, "ai_quota_exceeded", "Daily AI credits exhausted.")
            exc.detail["details"] = {"remaining": round(max(remaining, 0.0), 2), "required": credits}  # type: ignore[index]
            raise exc
    db.add(AiUsageLedger(owner_user_id=user.id, job_id=job_id, feature=feature, credits=credits, at=utcnow()))


def refund(db: Session, *, user_id: str, job_id: str, credits: float, feature: str, tokens_in: int = 0, tokens_out: int = 0) -> None:
    if credits <= 0 and not (tokens_in or tokens_out):
        return
    db.add(
        AiUsageLedger(
            owner_user_id=user_id, job_id=job_id, feature=feature, credits=-abs(credits),
            tokens_in=tokens_in, tokens_out=tokens_out, at=utcnow(),
        )
    )
