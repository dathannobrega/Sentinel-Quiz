"""Pre-event check (RF-1115): is this room ready for its audience?

Each check is ``ok``, ``warn`` or ``fail`` with a short code the UI translates:

* database and realtime bus reachable, with latency;
* rate limiting on the shared (Redis) backend in production;
* participant tokens signed with configured keys in production;
* capacity: the room's limit against the platform limit, and people already in;
* event loop responsiveness of this process (RNF-108);
* content: moderation pending for guests, blocked quiz, items still needing review.

Overall ``ready`` when nothing fails and nothing warns, else ``attention``. A failure is
logged as ``live_preflight_failed`` so the on-call alerting can pick it up (§17.7).
"""
from __future__ import annotations

import logging
import time
from typing import Any

from sqlalchemy import func, select, text
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.live.db import live_db
from app.live.metrics import metrics
from app.models import LiveParticipant, LiveQuiz, LiveQuizVersion, LiveSession

logger = logging.getLogger("app.live.preflight")

LARGE_ROOM = 300


def _check(key: str, status: str, detail: str = "", **values: Any) -> dict[str, Any]:
    return {"key": key, "status": status, "detail": detail, **({"values": values} if values else {})}


def _db_checks(session_id: str) -> list[dict[str, Any]]:
    checks = []
    with live_db() as db:
        started = time.perf_counter()
        db.execute(text("SELECT 1"))
        ms = round((time.perf_counter() - started) * 1000, 1)
        checks.append(_check("database", "ok" if ms < 50 else "warn", "slow" if ms >= 50 else "", latency_ms=ms))
        session = db.get(LiveSession, session_id)
        version = db.get(LiveQuizVersion, session.quiz_version_id) if session else None
        quiz = db.get(LiveQuiz, session.quiz_id) if session else None
        people = int(
            db.execute(
                select(func.count()).select_from(LiveParticipant).where(
                    LiveParticipant.session_id == session_id, LiveParticipant.kicked_at.is_(None),
                    LiveParticipant.is_bot.is_(False), LiveParticipant.is_preview.is_(False),
                )
            ).scalar_one()
        )
        if session is not None:
            limit = int(session.max_participants)
            platform = int(settings.live_max_participants)
            status = "ok"
            detail = ""
            if people >= 0.8 * limit:
                status, detail = "warn", "near_limit"
            if limit > platform:
                status, detail = "fail", "above_platform_limit"
            checks.append(_check("capacity", status, detail, participants=people, max_participants=limit, platform_limit=platform))
        if quiz is not None and version is not None:
            if quiz.blocked_at is not None or version.moderation_state == "blocked":
                checks.append(_check("content", "fail", "quiz_blocked"))
            elif version.moderation_state == "flagged":
                checks.append(_check("content", "fail" if session.allow_guests else "warn", "moderation_pending"))
            else:
                checks.append(_check("content", "ok"))
    return checks


async def run(hub: Any, session: LiveSession) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    try:
        checks.extend(await run_in_threadpool(_db_checks, session.id))
    except Exception:  # the database itself is the problem
        logger.exception("live preflight database check failed", extra={"event": "live_preflight_db_error"})
        checks.append(_check("database", "fail", "unreachable"))

    started = time.perf_counter()
    try:
        bus_ok = bool(await hub.bus.ping())
    except Exception:
        bus_ok = False
    bus_ms = round((time.perf_counter() - started) * 1000, 1)
    backend = str(settings.live_bus_backend or "memory")
    if not bus_ok:
        checks.append(_check("realtime_bus", "fail", "unreachable", backend=backend))
    elif backend != "redis" and int(getattr(settings, "uvicorn_workers", 1) or 1) > 1:
        checks.append(_check("realtime_bus", "fail", "memory_bus_with_workers", backend=backend))
    else:
        checks.append(_check("realtime_bus", "ok", "", backend=backend, latency_ms=bus_ms))

    production = settings.is_production()
    limiter = settings.normalized_rate_limit_backend()
    checks.append(
        _check("rate_limit", "ok" if limiter == "redis" or not production else "warn", "" if limiter == "redis" else "memory_backend",
               backend=limiter)
    )
    keys_ok = bool(str(settings.live_token_keys or "").strip())
    checks.append(_check("token_keys", "ok" if keys_ok or not production else "fail", "" if keys_ok else "dev_key"))

    lag = metrics.summary()["histograms"].get("live_event_loop_lag_seconds") or {}
    p95 = lag.get("p95_ms")
    checks.append(_check("event_loop", "warn" if p95 is not None and p95 > 100 else "ok", "lagging" if p95 and p95 > 100 else "",
                         p95_ms=p95))

    large = int(session.max_participants) >= LARGE_ROOM
    worst = "fail" if any(c["status"] == "fail" for c in checks) else "warn" if any(c["status"] == "warn" for c in checks) else "ok"
    if worst == "fail":
        logger.error(
            "live preflight failed",
            extra={"event": "live_preflight_failed", "session_id": session.id,
                   "failed": [c["key"] for c in checks if c["status"] == "fail"], "large_room": large},
        )
    return {"status": "ready" if worst == "ok" else "attention", "large_room": large, "checks": checks}
