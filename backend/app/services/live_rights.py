"""Participant rights and account linking (PLANO §13.7, §15.3; RF-606, RF-633, RF-650).

* ``my_data``: everything the room keeps about the person (LGPD art. 18, access).
* ``erase``: anonymization on request; the person leaves every nominal view and ranking,
  the answers stay only as anonymous statistics.
* ``claim``: a guest links the participation to their account up to 7 days after the
  session ends; answers to Question Bank items enter their study progress (DC-18).
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.errors import api_error
from app.live import runtime
from app.models import LiveAnswerEvent, LiveParticipant, LiveSession, Question, User
from app.services import live_admin
from app.services import live_scoring as scoring

logger = logging.getLogger("app.live.rights")

CLAIM_WINDOW = timedelta(days=7)


def _iso(value: Any) -> str | None:
    return value.isoformat() if value else None


def my_data(db: Session, participant: LiveParticipant) -> dict[str, Any]:
    session = db.get(LiveSession, participant.session_id)
    room = runtime.load_room(db, participant.session_id)
    events = db.execute(
        select(LiveAnswerEvent)
        .where(LiveAnswerEvent.session_id == participant.session_id, LiveAnswerEvent.participant_id == participant.id)
        .order_by(LiveAnswerEvent.id)
    ).scalars()
    answers = []
    for event in events:
        item = room.item(event.position) or {}
        answers.append(
            {
                "position": event.position, "prompt": item.get("prompt") or "", "event_type": event.event_type,
                "response": event.response_json or {}, "correct": event.is_correct, "points": event.points,
                "server_ms": event.server_ms, "received_at": _iso(event.received_at),
            }
        )
    return {
        "participant": {
            "participant_id": participant.id, "display_name": participant.display_name, "avatar_seed": participant.avatar_seed,
            "joined_at": _iso(participant.joined_at), "last_seen_at": _iso(participant.last_seen_at),
            "consent_version": participant.consent_version, "linked_account": participant.user_id is not None,
            "claimed_at": _iso(participant.claimed_at), "time_multiplier": float(participant.time_multiplier),
            "final_score": participant.final_score, "final_rank": participant.final_rank,
        },
        "session": {
            "session_id": session.id if session else None, "title": room.title, "status": session.status if session else None,
            "started_at": _iso(session.started_at) if session else None, "ended_at": _iso(session.ended_at) if session else None,
        },
        "answers": answers,
        "retention": {
            "note": "Answers are kept as anonymous statistics; names are anonymized by the retention policy.",
        },
        "claim": claim_status(db, participant, session),
    }


def claim_status(db: Session, participant: LiveParticipant, session: LiveSession | None) -> dict[str, Any]:
    if session is None or session.audience == "infantojuvenil":
        return {"available": False, "reason": "not_available"}
    if participant.user_id is not None:
        return {"available": False, "reason": "already_linked"}
    if session.status != "finished" or session.ended_at is None:
        return {"available": False, "reason": "session_active"}
    deadline = session.ended_at + CLAIM_WINDOW
    if utcnow() > deadline:
        return {"available": False, "reason": "expired"}
    return {"available": True, "reason": None, "until": _iso(deadline)}


def erase(db: Session, participant: LiveParticipant) -> runtime.Outcome:
    """RF-650: anonymize now; the open socket (if any) is closed by the returned outcome."""
    session_id = participant.session_id
    was_active = participant.kicked_at is None
    runtime.erase_participant(db, participant)
    live_admin.audit(db, action="participant_erased", actor_kind="participant", session_id=session_id, target=participant.id)
    db.commit()
    logger.info("live participant erased", extra={"event": "live_participant_erased", "session_id": session_id})
    outcome = runtime.Outcome()
    if was_active:
        outcome.kicked_participant = (participant.id, False)
        outcome.broadcasts.append(runtime.Broadcast("lobby.update", runtime.lobby_state(db, session_id)))
    return outcome


def claim(db: Session, participant: LiveParticipant, user: User) -> dict[str, Any]:
    """RF-633: link a guest participation to the signed-in account and record the answers
    to Question Bank items in the user's study progress. Idempotent per participant."""
    session = db.get(LiveSession, participant.session_id)
    status = claim_status(db, participant, session)
    if not status["available"]:
        raise api_error(409, f"claim_{status['reason']}", "This participation cannot be linked to an account.")
    already = db.execute(
        select(LiveParticipant.id).where(LiveParticipant.session_id == session.id, LiveParticipant.user_id == user.id)
    ).first()
    if already:
        raise api_error(409, "claim_already_in_session", "Your account already has a participation in this session.")
    room = runtime.load_room(db, session.id)
    events = db.execute(
        select(LiveAnswerEvent)
        .where(LiveAnswerEvent.session_id == session.id, LiveAnswerEvent.participant_id == participant.id)
        .order_by(LiveAnswerEvent.id)
    ).scalars()
    answers = scoring.effective_answers(events)
    recorded = 0
    from app.services.learning import upsert_question_progress
    from app.services.metrics import record_question_attempt_metrics

    for (position, _pid), answer in sorted(answers.items()):
        item = room.item(position) or {}
        question_id = item.get("source_question_id")
        if not question_id or answer.fraction is None or item.get("removed"):
            continue
        question = db.get(Question, question_id)
        if question is None:
            continue
        correct = answer.fraction >= 1
        attempted_at = session.started_at or session.ended_at
        upsert_question_progress(
            db, question_id=question.id, mode="exam", is_correct=correct, owner_user_id=user.id, owner_client_key=None,
            attempted_at=attempted_at,
        )
        record_question_attempt_metrics(
            db, question_id=question.id, mode="exam", exam_id=question.exam_id, certification=question.certification,
            domain=question.domain, is_correct=correct, owner_user_id=user.id, owner_client_key=None,
            elapsed_seconds=int((answer.server_ms or 0) / 1000) or None, attempted_at=attempted_at,
            selection_strategy="live",
        )
        recorded += 1
    participant.user_id = user.id
    participant.claimed_at = utcnow()
    live_admin.audit(
        db, action="participant_claimed", actor=user, session_id=session.id, target=participant.id, meta={"bank_answers": recorded}
    )
    db.commit()
    return {"claimed": True, "bank_answers_recorded": recorded}


def access_with_return_code(db: Session, *, session_id: str, display_name: str, return_code: str) -> dict[str, Any]:
    """A guest whose token expired proves who they are with the name + return code shown
    at join (RF-613) and gets a fresh token for "my data", "my results" and the claim.
    Works for finished sessions too (join codes are reused, so the session id is used)."""
    from app.services import live_names
    from app.services.live_session import _hash, _issue_participant_token, _join_result

    key = live_names.nickname_key(live_names.clean_display_name(display_name))
    participant = db.execute(
        select(LiveParticipant).where(LiveParticipant.session_id == session_id, LiveParticipant.nickname_norm == key)
    ).scalar_one_or_none()
    expected = _hash(f"{session_id}:{str(return_code or '').strip().upper()}")
    import secrets

    if (
        participant is None
        or participant.erased_at is not None
        or not participant.return_code_hash
        or not secrets.compare_digest(participant.return_code_hash, expected)
    ):
        raise api_error(403, "invalid_return_code", "Name or return code does not match.")
    if participant.banned:
        raise api_error(403, "banned", "You were removed from this room.")
    token, expires_at = _issue_participant_token(participant)
    result = _join_result(participant, token, expires_at, None)
    db.commit()
    return result
