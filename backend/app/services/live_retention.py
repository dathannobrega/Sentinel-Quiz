"""Retention of live sessions (RF-1109, PLANO §14.8).

Two steps, oldest data first, both idempotent and audited:

1. ``LIVE_RETENTION_NAMES_DAYS`` after a session ends, participants become
   "Participante N" (tokens, return codes and device hashes are dropped). Links to an
   account the person created themselves (claim) are kept.
2. ``LIVE_RETENTION_EVENTS_DAYS`` after it ends, the raw answer log is deleted. The report
   is first frozen into ``live_session.report_snapshot_json``, so owners keep their
   aggregated results (names in it are already anonymized, because step 1 always runs
   first: the names window can never be longer than the events window).

Run as ``python -m app.services.live_retention`` (``live-cleanup`` in the entrypoint).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.models import LiveAnswerEvent, LiveParticipant, LiveSession
from app.services import live_admin, live_results

logger = logging.getLogger("app.live.retention")

BATCH = 50


def windows() -> tuple[timedelta, timedelta]:
    events_days = max(30, min(int(settings.live_retention_events_days), 730))
    names_days = max(1, min(int(settings.live_retention_names_days), events_days))
    return timedelta(days=names_days), timedelta(days=events_days)


def anonymize_session(db: Session, session: LiveSession, now: datetime) -> int:
    participants = db.execute(
        select(LiveParticipant).where(LiveParticipant.session_id == session.id).order_by(LiveParticipant.joined_at)
    ).scalars()
    count = 0
    for index, participant in enumerate(participants, start=1):
        participant.display_name = f"Participante {index}"[:24]
        participant.nickname_norm = f"anon{index}x{participant.id.replace('-', '')[:10]}"
        participant.avatar_seed = "anon"
        participant.token_hash = None
        participant.return_code_hash = None
        participant.dev_hash = None
        count += 1
    session.names_anonymized_at = now
    return count


def purge_session(db: Session, session: LiveSession, now: datetime) -> int:
    snapshot = live_results.build_report(db, session)
    session.report_snapshot_json = snapshot
    result = db.execute(delete(LiveAnswerEvent).where(LiveAnswerEvent.session_id == session.id))
    session.events_purged_at = now
    return int(result.rowcount or 0)


def run(db: Session, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or utcnow()
    from app.services import live_challenge  # local: live_challenge imports the runtime lazily

    challenges_closed = live_challenge.close_due_challenges(db, now=now)  # RF-810 for untouched links
    names_window, events_window = windows()
    anonymized = purged = events = 0
    while True:
        batch = list(
            db.execute(
                select(LiveSession).where(
                    LiveSession.status == "finished", LiveSession.ended_at.is_not(None),
                    LiveSession.ended_at < now - names_window, LiveSession.names_anonymized_at.is_(None),
                ).limit(BATCH)
            ).scalars()
        )
        if not batch:
            break
        for session in batch:
            people = anonymize_session(db, session, now)
            live_admin.audit(db, action="retention_anonymize", actor_kind="system", session_id=session.id,
                             quiz_id=session.quiz_id, meta={"participants": people})
            anonymized += 1
        db.commit()
    while True:
        batch = list(
            db.execute(
                select(LiveSession).where(
                    LiveSession.status == "finished", LiveSession.ended_at.is_not(None),
                    LiveSession.ended_at < now - events_window, LiveSession.events_purged_at.is_(None),
                    LiveSession.names_anonymized_at.is_not(None),
                ).limit(BATCH)
            ).scalars()
        )
        if not batch:
            break
        for session in batch:
            removed = purge_session(db, session, now)
            live_admin.audit(db, action="retention_purge", actor_kind="system", session_id=session.id,
                             quiz_id=session.quiz_id, meta={"events": removed})
            purged += 1
            events += removed
        db.commit()
    summary = {"challenges_closed": challenges_closed, "sessions_anonymized": anonymized, "sessions_purged": purged, "events_deleted": events,
               "names_days": names_window.days, "events_days": events_window.days}
    logger.info("live retention run", extra={"event": "live_retention_run", **summary})
    return summary


def main() -> None:  # pragma: no cover - thin CLI wrapper
    import json

    from app.core.logging import configure_logging
    from app.db.session import SessionLocal

    configure_logging(settings)
    with SessionLocal() as db:
        print(json.dumps(run(db)))


if __name__ == "__main__":  # pragma: no cover
    main()
