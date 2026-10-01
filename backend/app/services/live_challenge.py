"""Sentinel Arena self-paced challenges (E1.10, PLANO J5 and RF-801..RF-813).

A challenge is a ``live_session`` with ``mode = "self_paced"``: a permanent link
``/q/{share_slug}``, an answering window (``opens_at``..``closes_at``) and per-participant
attempts (``live_attempt``). Nothing here uses the real-time room machine: every
participant walks the items at their own pace over REST, and every deadline is lazy
(evaluated when the participant or the owner next touches the challenge, the same
pattern as ``expire_exam_session_if_due``):

- per item (RF-803): ``item_started_at + time_limit × the participant's multiplier``;
- total (RF-804): ``attempt.deadline_at``, capped at ``closes_at``;
- the challenge itself (RF-810): the first access after ``closes_at`` closes it, finishes
  the open attempts and freezes final scores; ``live-cleanup`` does the same for
  challenges nobody touched.

Answers reuse ``live_answer_event`` with ``attempt_no`` and the item registry's grading.
Ranking and reports count one attempt per participant: the best finished one (score,
then correct answers, then faster correct answers, then who joined first, RF-807).
"""
from __future__ import annotations

import hashlib
import logging
import random
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Iterable

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import api_error
from app.models import LiveAnswerEvent, LiveAttempt, LiveParticipant, LiveQuizVersion, LiveSession, User
from app.services import live_items as registry
from app.services import live_scoring as scoring

logger = logging.getLogger(__name__)

MODE = "self_paced"
SLUG_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford Base32: no I, L, O, U
SLUG_LENGTH = 8
FEEDBACK_POLICIES = ("each", "end", "after_close", "never")
TIME_MODES = ("per_item", "total", "none")
ATTEMPTS_MAX = 5
TOTAL_TIME_MIN_S, TOTAL_TIME_MAX_S = 60, 4 * 3600
WINDOW_MAX_DAYS = 90
ITEM_GRACE_MS = 1500  # network slack on the per-item deadline
LEADERBOARD_TOP = 10
TOKEN_TTL_MAX_DAYS = 31


# ----------------------------------------------------------------------------- settings

def challenge_settings(session: LiveSession) -> dict[str, Any]:
    raw = dict((session.settings_json or {}).get("challenge") or {})
    leaderboard = bool(raw.get("leaderboard", False))
    return {
        "attempts": int(raw.get("attempts", 1)),
        "time_mode": raw.get("time_mode", "per_item"),
        "total_time_s": raw.get("total_time_s"),
        "feedback": raw.get("feedback") or ("after_close" if leaderboard else "end"),
        "leaderboard": leaderboard,
        "shuffle_items": bool(raw.get("shuffle_items", True)),
    }


def normalize_settings(
    *, attempts: int, time_mode: str, total_time_s: int | None, feedback: str | None, leaderboard: bool, shuffle_items: bool
) -> dict[str, Any]:
    if not 1 <= int(attempts) <= ATTEMPTS_MAX:
        raise api_error(422, "invalid_attempts", f"Attempts must be between 1 and {ATTEMPTS_MAX}.")
    if time_mode not in TIME_MODES:
        raise api_error(422, "invalid_time_mode", "time_mode must be per_item, total or none.")
    if time_mode == "total":
        if total_time_s is None or not TOTAL_TIME_MIN_S <= int(total_time_s) <= TOTAL_TIME_MAX_S:
            raise api_error(
                422, "invalid_total_time", f"total_time_s must be between {TOTAL_TIME_MIN_S} and {TOTAL_TIME_MAX_S}."
            )
    else:
        total_time_s = None
    # RF-813: with a leaderboard the key stays hidden until the deadline unless the owner
    # explicitly chooses otherwise.
    policy = feedback or ("after_close" if leaderboard else "end")
    if policy not in FEEDBACK_POLICIES:
        raise api_error(422, "invalid_feedback", "feedback must be each, end, after_close or never.")
    return {
        "attempts": int(attempts),
        "time_mode": time_mode,
        "total_time_s": int(total_time_s) if total_time_s is not None else None,
        "feedback": policy,
        "leaderboard": bool(leaderboard),
        "shuffle_items": bool(shuffle_items),
    }


def is_challenge(session: LiveSession | None) -> bool:
    return session is not None and session.mode == MODE


def state_of(session: LiveSession, now: datetime | None = None) -> str:
    """``scheduled`` | ``open`` | ``closed``."""
    now = now or utcnow()
    if session.status == "finished" or (session.closes_at is not None and now >= session.closes_at):
        return "closed"
    if session.opens_at is not None and now < session.opens_at:
        return "scheduled"
    return "open"


def share_url(slug: str) -> str:
    return f"{settings.public_web_origin.rstrip('/')}/q/{slug}"


def _new_slug() -> str:
    while True:
        slug = "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_LENGTH))
        if not slug.isdigit():  # never mistaken for a live PIN
            return slug


def _feedback_visible(session: LiveSession, attempt_finished: bool, now: datetime) -> bool:
    """Whether the key (correct answers, explanations) may be shown for finished items."""
    policy = challenge_settings(session)["feedback"]
    closed = state_of(session, now) == "closed"
    if policy == "each":
        return True
    if policy == "end":
        return attempt_finished or closed
    if policy == "after_close":
        return closed
    return False


# ----------------------------------------------------------------------------- owner side

def create_challenge(
    db: Session,
    user: User,
    *,
    quiz_id: str,
    opens_at: datetime | None,
    closes_at: datetime,
    attempts: int,
    time_mode: str,
    total_time_s: int | None,
    feedback: str | None,
    leaderboard: bool,
    shuffle_items: bool,
    allow_guests: bool,
    audience: str,
    max_participants: int | None,
) -> LiveSession:
    from app.services import live_admin, live_session  # local: avoid import cycles
    from app.services.live_quiz import get_owned_quiz, latest_version

    now = utcnow()
    opens_at = opens_at or now
    if closes_at <= now + timedelta(minutes=1) or closes_at <= opens_at:
        raise api_error(422, "invalid_window", "closes_at must be in the future and after opens_at.")
    if closes_at - opens_at > timedelta(days=WINDOW_MAX_DAYS):
        raise api_error(422, "invalid_window", f"A challenge stays open for at most {WINDOW_MAX_DAYS} days.")
    config = normalize_settings(
        attempts=attempts, time_mode=time_mode, total_time_s=total_time_s, feedback=feedback,
        leaderboard=leaderboard, shuffle_items=shuffle_items,
    )
    quiz = get_owned_quiz(db, user, quiz_id)
    version = latest_version(db, quiz.id)
    if version is None:
        raise api_error(409, "quiz_not_published", "Publish the quiz before sharing it.")
    live_admin.session_gate(quiz, version, allow_guests=allow_guests)
    blockers = live_session.license_blockers(list(version.items_snapshot_json or []), allow_guests=allow_guests)
    if blockers:
        exc = api_error(
            422, "license_requires_login" if allow_guests else "license_blocked",
            "Some items cannot be shown to guests; require login or remove them.",
        )
        exc.detail["details"] = {"items": blockers}  # type: ignore[index]
        raise exc
    if not playable_positions(list(version.items_snapshot_json or []), set()):
        raise api_error(422, "no_interactive", "The quiz needs at least one question.")
    cap = min(int(max_participants or settings.live_max_participants), int(settings.live_max_participants))
    session_settings = dict(version.settings_json or {})
    session_settings["challenge"] = config
    for _ in range(20):
        slug = _new_slug()
        session = LiveSession(
            quiz_id=quiz.id,
            quiz_version_id=version.id,
            owner_user_id=user.id,
            mode=MODE,
            status="live",
            phase="lobby",
            state_seq=1,
            join_code=slug,
            share_slug=slug,
            opens_at=opens_at,
            closes_at=closes_at,
            view_count=0,
            allow_guests=allow_guests,
            room_locked=False,
            max_participants=max(1, cap),
            preset="turma",
            audience=audience,
            theme_key=version.theme_key,
            settings_json=session_settings,
            hidden_positions=live_admin.version_hidden_positions(version) or None,
            consent_version=settings.live_consent_version,
            created_at=now,
            started_at=opens_at,
            updated_at=now,
        )
        db.add(session)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        db.refresh(session)
        logger.info("live challenge created", extra={"event": "live_challenge_created", "session_id": session.id})
        return session
    raise api_error(503, "slug_exhausted", "Could not allocate a link; try again.")


def update_window(db: Session, session: LiveSession, *, closes_at: datetime | None, close_now: bool) -> LiveSession:
    now = utcnow()
    close_if_due(db, session, now=now)
    if session.status == "finished":
        raise api_error(409, "challenge_closed", "This challenge is already closed.")
    if close_now:
        session.closes_at = now
        db.commit()
        close_if_due(db, session, now=now)
        return session
    if closes_at is not None:
        start = session.opens_at or session.created_at
        if closes_at <= now or closes_at <= start or closes_at - start > timedelta(days=WINDOW_MAX_DAYS):
            raise api_error(422, "invalid_window", "closes_at must be in the future, within the allowed window.")
        session.closes_at = closes_at
        session.updated_at = now
        # Open attempts keep their own total deadline, capped at the new close.
        for attempt in _attempts(db, session.id, status="in_progress"):
            attempt.deadline_at = _attempt_deadline(session, attempt.started_at)
        db.commit()
    return session


def serialize_challenge(session: LiveSession, now: datetime | None = None) -> dict[str, Any]:
    config = challenge_settings(session)
    return {
        "slug": session.share_slug,
        "share_url": share_url(session.share_slug or ""),
        "state": state_of(session, now),
        "opens_at": _iso(session.opens_at),
        "closes_at": _iso(session.closes_at),
        **config,
    }


def progress(db: Session, session: LiveSession, now: datetime | None = None) -> dict[str, Any]:
    """Owner panel (RF-809) and the report funnel (RF-1029)."""
    now = now or utcnow()
    close_if_due(db, session, now=now)
    participants = _real_participants(db, session.id)
    ids = {p.id for p in participants}
    attempts = [a for a in _attempts(db, session.id) if a.participant_id in ids]
    started = {a.participant_id for a in attempts}
    finished = {a.participant_id for a in attempts if a.status == "finished"}
    per_person: dict[str, int] = {}
    for attempt in attempts:
        per_person[attempt.participant_id] = per_person.get(attempt.participant_id, 0) + 1
    distribution: dict[str, int] = {}
    for count in per_person.values():
        distribution[str(count)] = distribution.get(str(count), 0) + 1
    names = {p.id: p.display_name for p in participants}
    recent = sorted((a for a in attempts if a.status == "finished"), key=lambda a: a.finished_at or now, reverse=True)[:10]
    durations = [
        int((a.finished_at - a.started_at).total_seconds() * 1000)
        for a in attempts if a.status == "finished" and a.finished_at
    ]
    durations.sort()
    return {
        "challenge": serialize_challenge(session, now),
        "funnel": {
            "opened": int(session.view_count or 0),
            "joined": len(participants),
            "started": len(started),
            "finished": len(finished),
        },
        "in_progress": sum(1 for a in attempts if a.status == "in_progress"),
        "attempts": len(attempts),
        "attempts_per_person": distribution,
        "repeat_suspects": sum(1 for a in attempts if a.repeat_suspect),
        "median_duration_ms": durations[len(durations) // 2] if durations else None,
        "recent": [
            {
                "participant_id": a.participant_id, "display_name": names.get(a.participant_id, ""),
                "attempt_no": a.attempt_no, "score": a.score, "correct": a.correct,
                "finished_at": _iso(a.finished_at), "finish_reason": a.finish_reason, "repeat_suspect": a.repeat_suspect,
            }
            for a in recent
        ],
        "leaderboard": leaderboard(db, session, limit=LEADERBOARD_TOP)["top"],
        "generated_at": now.isoformat(),
    }


# ----------------------------------------------------------------------------- closing

def close_if_due(db: Session, session: LiveSession, *, now: datetime | None = None) -> bool:
    """Lazy close (RF-810): idempotent and safe across workers (conditional UPDATE)."""
    now = now or utcnow()
    if not is_challenge(session) or session.status == "finished":
        return False
    if session.closes_at is None or now < session.closes_at:
        return False
    for attempt in _attempts(db, session.id, status="in_progress"):
        _finish(attempt, session.closes_at, "closed")
    claimed = db.execute(
        update(LiveSession)
        .where(LiveSession.id == session.id, LiveSession.status != "finished")
        .values(status="finished", phase="finished", ended_at=session.closes_at, updated_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount
    if claimed:
        board = {s["participant_id"]: s for s in _standings(db, session, fresh=True)}
        for participant in _real_participants(db, session.id):
            row = board.get(participant.id)
            participant.final_score = row["score"] if row else 0
            participant.final_rank = row["rank"] if row else None
        logger.info("live challenge closed", extra={"event": "live_challenge_closed", "session_id": session.id})
    db.commit()
    db.refresh(session)
    return bool(claimed)


def close_due_challenges(db: Session, *, now: datetime | None = None) -> int:
    """Job hook (``live-cleanup``): close every challenge past its deadline."""
    now = now or utcnow()
    due = db.execute(
        select(LiveSession).where(LiveSession.mode == MODE, LiveSession.status != "finished", LiveSession.closes_at <= now)
    ).scalars().all()
    return sum(1 for session in due if close_if_due(db, session, now=now))


# ----------------------------------------------------------------------------- participant: entry

def find_by_slug(db: Session, slug: str) -> LiveSession:
    clean = "".join(ch for ch in str(slug or "").upper() if ch.isalnum())
    # Crockford decoding: people type O for 0 and I/L for 1.
    clean = clean.translate(str.maketrans({"O": "0", "I": "1", "L": "1"}))
    session = None
    if len(clean) == SLUG_LENGTH:
        session = db.execute(
            select(LiveSession).where(LiveSession.share_slug == clean, LiveSession.mode == MODE)
        ).scalar_one_or_none()
    if session is None:
        raise api_error(404, "challenge_not_found", "No challenge with this link.")
    return session


def public_info(db: Session, slug: str, *, count_view: bool) -> dict[str, Any]:
    session = find_by_slug(db, slug)
    now = utcnow()
    close_if_due(db, session, now=now)
    if count_view and state_of(session, now) != "closed":
        db.execute(
            update(LiveSession).where(LiveSession.id == session.id).values(view_count=LiveSession.view_count + 1)
            .execution_options(synchronize_session=False)
        )
        db.commit()
    version = db.get(LiveQuizVersion, session.quiz_version_id)
    items = list(version.items_snapshot_json or []) if version else []
    hidden = {int(p) for p in (session.hidden_positions or [])}
    positions = playable_positions(items, hidden)
    config = challenge_settings(session)
    return {
        "session_id": session.id,
        "slug": session.share_slug,
        "title": version.title if version else "",
        "theme_key": session.theme_key,
        "state": state_of(session, now),
        "opens_at": _iso(session.opens_at),
        "closes_at": _iso(session.closes_at),
        "server_now": now.isoformat(),
        "item_count": sum(1 for p in positions if items[p]["item_type"] in registry.INTERACTIVE_TYPES),
        "attempts": config["attempts"],
        "time_mode": config["time_mode"],
        "total_time_s": config["total_time_s"],
        "feedback": config["feedback"],
        "leaderboard": config["leaderboard"],
        "requires_login": not session.allow_guests,
        "allow_guests": session.allow_guests,
        "audience": session.audience,
        "consent_version": session.consent_version,
    }


def ensure_joinable(db: Session, session: LiveSession) -> None:
    now = utcnow()
    close_if_due(db, session, now=now)
    state = state_of(session, now)
    if state == "scheduled":
        raise api_error(409, "challenge_not_open", "This challenge has not opened yet.")
    if state == "closed":
        raise api_error(410, "challenge_closed", "This challenge is closed.")


def token_ttl_seconds(session: LiveSession) -> int:
    """Participant tokens of a challenge last until it closes (+1 day), up to 31 days."""
    base = int(settings.live_participant_token_ttl_hours) * 3600
    if session.closes_at is None:
        return base
    until_close = int((session.closes_at - utcnow()).total_seconds()) + 86400
    return max(base, min(until_close, TOKEN_TTL_MAX_DAYS * 86400))


# ----------------------------------------------------------------------------- attempts

def playable_positions(items: list[dict[str, Any]], hidden: set[int]) -> list[int]:
    """Positions a participant walks: questions and content slides (no leaderboards, no
    items removed by moderation)."""
    return [
        index for index, item in enumerate(items)
        if index not in hidden and not item.get("removed")
        and (item["item_type"] in registry.INTERACTIVE_TYPES or item["item_type"] == "content")
    ]


def item_order(positions: list[int], items: list[dict[str, Any]], *, shuffle: bool, seed: str) -> list[int]:
    """Per-attempt order (RF-805): questions are shuffled among the question slots; content
    slides stay where the author put them (they introduce what follows)."""
    if not shuffle:
        return list(positions)
    questions = [p for p in positions if items[p]["item_type"] != "content"]
    rng = random.Random(int(hashlib.sha256(f"items:{seed}".encode("utf-8")).hexdigest()[:16], 16))
    rng.shuffle(questions)
    shuffled = iter(questions)
    return [p if items[p]["item_type"] == "content" else next(shuffled) for p in positions]


def _attempts(db: Session, session_id: str, *, status: str | None = None, participant_id: str | None = None) -> list[LiveAttempt]:
    stmt = select(LiveAttempt).where(LiveAttempt.session_id == session_id)
    if status:
        stmt = stmt.where(LiveAttempt.status == status)
    if participant_id:
        stmt = stmt.where(LiveAttempt.participant_id == participant_id)
    return list(db.execute(stmt.order_by(LiveAttempt.started_at, LiveAttempt.attempt_no)).scalars())


def _attempt_deadline(session: LiveSession, started_at: datetime) -> datetime | None:
    config = challenge_settings(session)
    deadline = session.closes_at
    if config["time_mode"] == "total" and config["total_time_s"]:
        total = started_at + timedelta(seconds=int(config["total_time_s"]))
        deadline = min(total, deadline) if deadline else total
    return deadline


def _room(db: Session, session: LiveSession):
    from app.live import runtime  # local: the runtime imports the services package

    return runtime.room_from_session(db, session)


def start_attempt(db: Session, participant: LiveParticipant, *, now: datetime | None = None) -> dict[str, Any]:
    """Start (or resume, RF-808) the participant's attempt."""
    now = now or utcnow()
    session = db.get(LiveSession, participant.session_id)
    if not is_challenge(session):
        raise api_error(404, "challenge_not_found", "No challenge for this token.")
    ensure_joinable(db, session)
    current = _open_attempt(db, participant, now)
    if current is not None:
        _serve(db, current, now)
        return attempt_state(db, current, now=now)
    mine = _attempts(db, session.id, participant_id=participant.id)
    config = challenge_settings(session)
    if len(mine) >= config["attempts"]:
        raise api_error(409, "attempts_exhausted", "You have used every attempt of this challenge.")
    room = _room(db, session)
    hidden = {int(p) for p in (session.hidden_positions or [])}
    attempt_id = str(uuid.uuid4())
    order = item_order(playable_positions(room.items, hidden), room.items, shuffle=config["shuffle_items"], seed=attempt_id)
    if not order:
        raise api_error(409, "challenge_empty", "This challenge has no questions left.")
    attempt = LiveAttempt(
        id=attempt_id,
        session_id=session.id,
        participant_id=participant.id,
        attempt_no=len(mine) + 1,
        status="in_progress",
        item_order_json=order,
        current_index=0,
        item_started_at=now,
        started_at=now,
        deadline_at=_attempt_deadline(session, now),
        score=0, correct=0, answered=0, correct_ms=0,
        repeat_suspect=_repeat_suspect(db, session, participant),
    )
    db.add(attempt)
    try:
        db.commit()
    except IntegrityError:  # a double click started the same attempt number twice
        db.rollback()
        current = _open_attempt(db, participant, now)
        if current is None:
            raise api_error(409, "attempts_exhausted", "You have used every attempt of this challenge.") from None
        return attempt_state(db, current, now=now)
    return attempt_state(db, attempt, now=now)


def _repeat_suspect(db: Session, session: LiveSession, participant: LiveParticipant) -> bool:
    """RF-813: another participant joined from the same device and already played."""
    if not participant.dev_hash:
        return False
    other = db.execute(
        select(LiveAttempt.id)
        .join(LiveParticipant, LiveParticipant.id == LiveAttempt.participant_id)
        .where(
            LiveAttempt.session_id == session.id,
            LiveParticipant.dev_hash == participant.dev_hash,
            LiveParticipant.id != participant.id,
        )
        .limit(1)
    ).first()
    return other is not None


def _open_attempt(db: Session, participant: LiveParticipant, now: datetime) -> LiveAttempt | None:
    for attempt in _attempts(db, participant.session_id, status="in_progress", participant_id=participant.id):
        session = db.get(LiveSession, attempt.session_id)
        _expire(db, session, attempt, now)
        if attempt.status == "in_progress":
            return attempt
    return None


def _serve(db: Session, attempt: LiveAttempt, now: datetime) -> None:
    """Reveal the pending item (after a per-item correction): its clock starts now."""
    if attempt.status == "in_progress" and attempt.item_started_at is None:
        attempt.item_started_at = now
        db.commit()


def current_attempt(db: Session, participant: LiveParticipant, *, now: datetime | None = None) -> dict[str, Any]:
    """The open attempt, else the latest finished one (with its summary), else 404."""
    now = now or utcnow()
    session = db.get(LiveSession, participant.session_id)
    if not is_challenge(session):
        raise api_error(404, "challenge_not_found", "No challenge for this token.")
    close_if_due(db, session, now=now)
    attempt = _open_attempt(db, participant, now)
    if attempt is None:
        mine = _attempts(db, session.id, participant_id=participant.id)
        if not mine:
            raise api_error(404, "attempt_not_found", "No attempt yet.")
        attempt = mine[-1]
    _serve(db, attempt, now)
    return attempt_state(db, attempt, now=now)


def _get_attempt(db: Session, participant: LiveParticipant, attempt_id: str, *, lock: bool = False) -> LiveAttempt:
    stmt = select(LiveAttempt).where(LiveAttempt.id == attempt_id, LiveAttempt.participant_id == participant.id)
    if lock:  # the row as the database has it now (another tab may have answered)
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    attempt = db.execute(stmt).scalar_one_or_none()
    if attempt is None:
        raise api_error(404, "attempt_not_found", "Attempt not found.")
    return attempt


def _item_limit_ms(item: dict[str, Any], session: LiveSession, participant: LiveParticipant | None) -> int | None:
    """Per-item answer window in ms (None = untimed): per_item mode, timed questions,
    scaled by the participant's extended-time multiplier (0 = untimed, RF-622)."""
    if challenge_settings(session)["time_mode"] != "per_item":
        return None
    if item["item_type"] not in registry.INTERACTIVE_TYPES or not item.get("time_limit_s"):
        return None
    multiplier = 1.0 if participant is None or participant.time_multiplier is None else float(participant.time_multiplier)
    if multiplier == 0:
        return None
    return int(float(item["time_limit_s"]) * multiplier * 1000)


def _expire(db: Session, session: LiveSession, attempt: LiveAttempt, now: datetime) -> None:
    """Apply every lazy deadline to an open attempt (and persist what changed)."""
    if attempt.status != "in_progress":
        return
    changed = False
    if attempt.deadline_at is not None and now >= attempt.deadline_at:
        reason = "closed" if session.closes_at is not None and attempt.deadline_at >= session.closes_at else "time_up"
        _finish(attempt, attempt.deadline_at, reason)
        db.commit()
        return
    room = _room(db, session)
    participant = db.get(LiveParticipant, attempt.participant_id)
    order = list(attempt.item_order_json or [])
    while attempt.current_index < len(order):
        item = room.items[order[attempt.current_index]]
        limit = _item_limit_ms(item, session, participant)
        started = attempt.item_started_at or now
        if limit is None or now <= started + timedelta(milliseconds=limit + ITEM_GRACE_MS):
            break
        # Timed out: the item stays unanswered; the next one starts now (the participant
        # may have been away; only the item they were on is lost).
        attempt.current_index += 1
        attempt.item_started_at = now
        changed = True
    if attempt.current_index >= len(order):
        _finish(attempt, now, "completed")
        changed = True
    if changed:
        db.commit()


def _finish(attempt: LiveAttempt, when: datetime, reason: str) -> None:
    if attempt.status == "finished":
        return
    attempt.status = "finished"
    attempt.finished_at = when
    attempt.finish_reason = reason
    attempt.item_started_at = None


def answer(
    db: Session,
    participant: LiveParticipant,
    attempt_id: str,
    *,
    answer_id: str,
    qi: int,
    choice: list[str] | None,
    text: str | None,
    words: list[str] | None,
    number: float | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or utcnow()
    session = db.get(LiveSession, participant.session_id)
    attempt = _get_attempt(db, participant, attempt_id, lock=True)
    if db.execute(select(LiveAnswerEvent.id).where(LiveAnswerEvent.idempotency_key == answer_id)).first():
        db.commit()
        return {"status": "duplicate", "state": attempt_state(db, attempt, now=now)}
    if close_if_due(db, session, now=now):  # closing committed (and released the lock): read it again
        attempt = _get_attempt(db, participant, attempt_id, lock=True)
    order = list(attempt.item_order_json or [])
    position_at_entry = order[attempt.current_index] if attempt.current_index < len(order) else None
    _expire(db, session, attempt, now)
    if attempt.status != "in_progress":
        status = "late" if position_at_entry == qi else "closed"
        return {"status": status, "state": attempt_state(db, attempt, now=now)}
    position = order[attempt.current_index]
    if qi != position:
        status = "late" if position_at_entry == qi else ("already_answered" if qi in order[: attempt.current_index] else "stale")
        db.commit()
        return {"status": status, "state": attempt_state(db, attempt, now=now)}
    room = _room(db, session)
    item = room.items[position]
    if attempt.item_started_at is None:  # not shown yet (it would be answered with no clock)
        db.commit()
        return {"status": "stale", "state": attempt_state(db, attempt, now=now)}
    if item["item_type"] not in registry.INTERACTIVE_TYPES:
        db.commit()
        return {"status": "invalid", "state": attempt_state(db, attempt, now=now)}
    try:
        graded = registry.grade(session.id, position, item, choice=choice, text=text, words=words, number=number)
    except registry.InvalidAnswer:
        db.commit()
        return {"status": "invalid", "state": attempt_state(db, attempt, now=now)}
    elapsed = max(0, int((now - (attempt.item_started_at or now)).total_seconds() * 1000))
    config = challenge_settings(session)
    scoring_mode = room.settings.get("scoring", "speed")
    if config["time_mode"] != "per_item" and scoring_mode == "speed":
        scoring_mode = "fixed"  # speed only means something with a per-item clock
    limit = _item_limit_ms(item, session, participant)
    points = scoring.points_for(
        fraction=graded.fraction, scoring=scoring_mode, multiplier=int(item.get("points_multiplier", 1)),
        elapsed_ms=elapsed, time_limit_s=(limit / 1000.0) if limit else None,
    ) if registry.is_scored(item["item_type"], int(item.get("points_multiplier", 1))) else 0
    db.add(
        LiveAnswerEvent(
            session_id=session.id,
            position=position,
            participant_id=participant.id,
            attempt_no=attempt.attempt_no,
            event_type="submitted",
            response_json=graded.response,
            is_correct=graded.is_correct,
            score_fraction=graded.fraction,
            points=points,
            server_ms=elapsed,
            latency_ms=elapsed,
            client_elapsed_ms=None,
            suspicious=False,
            idempotency_key=answer_id,
            received_at=now,
        )
    )
    attempt.answered += 1
    attempt.score += points
    if graded.fraction is not None and graded.fraction >= 1:
        attempt.correct += 1
        attempt.correct_ms += elapsed
    attempt.current_index += 1
    # With a correction after each item, the next item is revealed (and its clock starts)
    # only when the participant asks for it: reading the correction costs no time.
    attempt.item_started_at = None if config["feedback"] == "each" else now
    if attempt.current_index >= len(order):
        _finish(attempt, now, "completed")
    try:
        db.commit()
    except IntegrityError:  # the same item twice in a race (two tabs)
        db.rollback()
        attempt = _get_attempt(db, participant, attempt_id)
        return {"status": "already_answered", "state": attempt_state(db, attempt, now=now)}
    result: dict[str, Any] = {"status": "accepted", "state": attempt_state(db, attempt, now=now)}
    if config["feedback"] == "each":
        result["feedback"] = item_feedback(session.id, position, item, graded.response, graded.fraction, points)
    return result


def advance(db: Session, participant: LiveParticipant, attempt_id: str, *, index: int, now: datetime | None = None) -> dict[str, Any]:
    """Leave a content slide (``index`` = the slide being left, idempotent)."""
    now = now or utcnow()
    session = db.get(LiveSession, participant.session_id)
    close_if_due(db, session, now=now)
    attempt = _get_attempt(db, participant, attempt_id, lock=True)
    _expire(db, session, attempt, now)
    order = list(attempt.item_order_json or [])
    if attempt.status == "in_progress" and attempt.current_index == index and index < len(order):
        room = _room(db, session)
        if room.items[order[index]]["item_type"] == "content":
            attempt.current_index += 1
            attempt.item_started_at = now
            if attempt.current_index >= len(order):
                _finish(attempt, now, "completed")
    db.commit()
    return attempt_state(db, attempt, now=now)


def finish(db: Session, participant: LiveParticipant, attempt_id: str, *, now: datetime | None = None) -> dict[str, Any]:
    """Hand in early: the remaining items stay unanswered."""
    now = now or utcnow()
    session = db.get(LiveSession, participant.session_id)
    close_if_due(db, session, now=now)
    attempt = _get_attempt(db, participant, attempt_id, lock=True)
    _expire(db, session, attempt, now)
    if attempt.status == "in_progress":
        _finish(attempt, now, "handed_in")
    db.commit()
    return attempt_state(db, attempt, now=now)


# ----------------------------------------------------------------------------- views

def shuffled_question(session_id: str, position: int, item: dict[str, Any], attempt_id: str) -> dict[str, Any]:
    """The public question with this attempt's option order (RF-805). Ids stay the
    session's opaque ids, so grading and reports are unchanged; true/false keeps its order."""
    question = registry.public_question(session_id, position, item)
    options = list(question.get("options") or [])
    if len(options) > 1 and item["item_type"] != "true_false":
        rng = random.Random(int(hashlib.sha256(f"options:{attempt_id}:{position}".encode("utf-8")).hexdigest()[:16], 16))
        rng.shuffle(options)
        if item["item_type"] == "ordering":
            correct = [registry.option_public_id(session_id, position, str(o["key"])) for o in (item.get("payload") or {}).get("options") or []]
            if [o["id"] for o in options] == correct:
                options = options[1:] + options[:1]
        options = [{**option, "index": index} for index, option in enumerate(options)]
    question["options"] = options
    return question


def item_feedback(
    session_id: str, position: int, item: dict[str, Any], response: dict[str, Any] | None,
    fraction: float | None, points: int | None,
) -> dict[str, Any]:
    """Correction of one item: your result plus the key, in the reveal's vocabulary."""
    answer = item.get("answer") or {}
    payload = item.get("payload") or {}
    key_to_id = {key: oid for oid, key in registry.option_id_map(session_id, position, item).items()}
    item_type = item["item_type"]
    data: dict[str, Any] = {
        "qi": position,
        "item_type": item_type,
        "answered": response is not None,
        "correct": (fraction >= 1) if fraction is not None else None,
        "fraction": fraction,
        "points": points,
        "correct_option_ids": (
            [key_to_id[k] for k in sorted(answer.get("correct_keys") or []) if k in key_to_id]
            if item_type in registry.CHOICE_TYPES else []
        ),
        "accepted_answers": list(answer.get("accepted_answers") or []) if item_type == "type_answer" else [],
        "explanation": item.get("explanation"),
    }
    if item_type == "ordering":
        data["correct_order_ids"] = [key_to_id[str(o["key"])] for o in payload.get("options") or [] if str(o["key"]) in key_to_id]
    if item_type == "numeric":
        data["numeric"] = {
            "value": answer.get("value"), "tolerance": float(answer.get("tolerance") or 0.0), "unit": payload.get("unit") or "",
        }
    if response is not None:
        data["your_answer"] = _response_view(response, key_to_id)
    return data


def _response_view(response: dict[str, Any], key_to_id: dict[str, str]) -> dict[str, Any]:
    if "order" in response:
        return {"order": [key_to_id[k] for k in response.get("order") or [] if k in key_to_id]}
    if "number" in response:
        return {"number": response.get("number")}
    if "words" in response:
        return {"words": list(response.get("words") or [])}
    if "text" in response:
        return {"text": response.get("text")}
    return {"choice": [key_to_id[k] for k in response.get("keys") or [] if k in key_to_id]}


def attempt_state(db: Session, attempt: LiveAttempt, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or utcnow()
    session = db.get(LiveSession, attempt.session_id)
    room = _room(db, session)
    participant = db.get(LiveParticipant, attempt.participant_id)
    order = list(attempt.item_order_json or [])
    config = challenge_settings(session)
    data: dict[str, Any] = {
        "attempt_id": attempt.id,
        "attempt_no": attempt.attempt_no,
        "attempts_allowed": config["attempts"],
        "status": attempt.status,
        "index": min(attempt.current_index, len(order)),
        "total": len(order),
        "questions_total": sum(1 for p in order if room.items[p]["item_type"] in registry.INTERACTIVE_TYPES),
        "started_at": _iso(attempt.started_at),
        "deadline_at": _iso(attempt.deadline_at) if config["time_mode"] == "total" else None,
        "closes_at": _iso(session.closes_at),
        "server_now": now.isoformat(),
        "feedback": config["feedback"],
        "leaderboard": config["leaderboard"],
        "item": None,
        "item_deadline_at": None,
        "next_pending": False,
        # Running score only where every item is corrected anyway (it would leak the key).
        "score": attempt.score if config["feedback"] == "each" else None,
        "attempts_used": len(_attempts(db, session.id, participant_id=attempt.participant_id)),
    }
    if attempt.status == "in_progress" and attempt.current_index < len(order) and attempt.item_started_at is None:
        data["next_pending"] = True  # GET attempts/current reveals it
    elif attempt.status == "in_progress" and attempt.current_index < len(order):
        position = order[attempt.current_index]
        item = room.items[position]
        data["item"] = shuffled_question(session.id, position, item, attempt.id)
        limit = _item_limit_ms(item, session, participant)
        if limit is not None and attempt.item_started_at is not None:
            item_deadline = attempt.item_started_at + timedelta(milliseconds=limit)
            if attempt.deadline_at is not None:
                item_deadline = min(item_deadline, attempt.deadline_at)
            data["item_deadline_at"] = item_deadline.isoformat()
        data["item_started_at"] = _iso(attempt.item_started_at)
    if attempt.status == "finished":
        data["summary"] = attempt_summary(db, session, attempt, room=room, now=now)
    return data


def attempt_summary(db: Session, session: LiveSession, attempt: LiveAttempt, *, room=None, now: datetime | None = None) -> dict[str, Any]:
    now = now or utcnow()
    room = room or _room(db, session)
    config = challenge_settings(session)
    order = list(attempt.item_order_json or [])
    questions = [p for p in order if room.items[p]["item_type"] in registry.INTERACTIVE_TYPES]
    scored = [p for p in questions if registry.is_scored(room.items[p]["item_type"], int(room.items[p].get("points_multiplier", 1)))]
    mine = _attempts(db, session.id, participant_id=attempt.participant_id)
    summary: dict[str, Any] = {
        "score": attempt.score,
        "correct": attempt.correct,
        "answered": attempt.answered,
        "questions": len(questions),
        "scored_questions": len(scored),
        "duration_ms": int(((attempt.finished_at or now) - attempt.started_at).total_seconds() * 1000),
        "finish_reason": attempt.finish_reason,
        "attempts_left": max(0, config["attempts"] - len(mine)) if state_of(session, now) == "open" else 0,
        "best_score": max((a.score for a in mine if a.status == "finished"), default=attempt.score),
        "rank": None,
        "ranked": 0,
        "corrections_visible": _feedback_visible(session, True, now),
        "corrections_at": _iso(session.closes_at) if config["feedback"] == "after_close" else None,
        "items": [],
    }
    if config["leaderboard"]:
        summary["rank"], summary["ranked"] = _rank_of(db, session, attempt.participant_id)
    if summary["corrections_visible"]:
        events = db.execute(
            select(LiveAnswerEvent).where(
                LiveAnswerEvent.session_id == session.id,
                LiveAnswerEvent.participant_id == attempt.participant_id,
                LiveAnswerEvent.attempt_no == attempt.attempt_no,
            )
        ).scalars().all()
        by_position = {e.position: e for e in events}
        for position in questions:
            item = room.items[position]
            event = by_position.get(position)
            feedback = item_feedback(
                session.id, position, item, event.response_json if event else None,
                event.score_fraction if event else None, event.points if event else 0,
            )
            feedback["prompt"] = item.get("prompt") or ""
            feedback["question"] = registry.public_question(session.id, position, item)
            summary["items"].append(feedback)
    return summary


# ----------------------------------------------------------------------------- ranking

def counted_attempts(db: Session, session: LiveSession) -> dict[str, LiveAttempt]:
    """participant -> the attempt that counts (best finished one)."""
    best: dict[str, LiveAttempt] = {}
    for attempt in _attempts(db, session.id, status="finished"):
        current = best.get(attempt.participant_id)
        if current is None or (attempt.score, attempt.correct, -attempt.correct_ms) > (current.score, current.correct, -current.correct_ms):
            best[attempt.participant_id] = attempt
    return best


def _real_participants(db: Session, session_id: str) -> list[LiveParticipant]:
    return list(
        db.execute(
            select(LiveParticipant).where(
                LiveParticipant.session_id == session_id,
                LiveParticipant.kicked_at.is_(None),
                LiveParticipant.erased_at.is_(None),
                LiveParticipant.is_bot.is_(False),
                LiveParticipant.is_preview.is_(False),
            ).order_by(LiveParticipant.joined_at)
        ).scalars()
    )


_BOARD_LOCK = threading.Lock()
_BOARD_CACHE: dict[str, tuple[tuple[Any, ...], float, list[dict[str, Any]]]] = {}
BOARD_STALE_S = 2.0  # while a challenge is open, a burst of finishes shares one table


def _board_signature(db: Session, session_id: str) -> tuple[Any, ...]:
    attempts = db.execute(
        select(func.count(), func.max(LiveAttempt.finished_at)).where(
            LiveAttempt.session_id == session_id, LiveAttempt.status == "finished"
        )
    ).one()
    roster = db.execute(
        select(func.count(LiveParticipant.kicked_at), func.count(LiveParticipant.erased_at), func.max(LiveParticipant.kicked_at))
        .where(LiveParticipant.session_id == session_id)
    ).one()
    return tuple(attempts) + tuple(roster)


def _standings(db: Session, session: LiveSession, *, fresh: bool = False) -> list[dict[str, Any]]:
    """The ranking (RF-807), cached per process: exact when nothing changed, and at most
    ``BOARD_STALE_S`` old while people keep finishing an open challenge."""
    signature = _board_signature(db, session.id)
    now = time.monotonic()
    with _BOARD_LOCK:
        hit = _BOARD_CACHE.get(session.id)
    if hit is not None and not fresh:
        same = hit[0] == signature
        if same or (session.status != "finished" and now - hit[1] < BOARD_STALE_S):
            return hit[2]
    rows = _compute_standings(db, session)
    with _BOARD_LOCK:
        if len(_BOARD_CACHE) > 256:
            _BOARD_CACHE.clear()
        _BOARD_CACHE[session.id] = (signature, now, rows)
    return rows


def _rank_of(db: Session, session: LiveSession, participant_id: str) -> tuple[int | None, int]:
    """(provisional rank, people ranked) of one participant with two aggregate queries,
    for the end-of-attempt screen (no full table per finishing person)."""
    eligible = (
        select(LiveParticipant.id).where(
            LiveParticipant.session_id == session.id, LiveParticipant.kicked_at.is_(None),
            LiveParticipant.erased_at.is_(None), LiveParticipant.is_bot.is_(False), LiveParticipant.is_preview.is_(False),
        )
    )
    finished = select(LiveAttempt).where(
        LiveAttempt.session_id == session.id, LiveAttempt.status == "finished", LiveAttempt.participant_id.in_(eligible)
    ).subquery()
    ranked = int(db.execute(select(func.count(func.distinct(finished.c.participant_id)))).scalar_one())
    mine = [a for a in _attempts(db, session.id, status="finished", participant_id=participant_id)]
    if not mine:
        return None, ranked
    best = max(mine, key=lambda a: (a.score, a.correct, -a.correct_ms))
    better = (
        (finished.c.score > best.score)
        | ((finished.c.score == best.score) & (finished.c.correct > best.correct))
        | ((finished.c.score == best.score) & (finished.c.correct == best.correct) & (finished.c.correct_ms < best.correct_ms))
    )
    ahead = int(db.execute(
        select(func.count(func.distinct(finished.c.participant_id))).where(better, finished.c.participant_id != participant_id)
    ).scalar_one())
    return ahead + 1, ranked


def _compute_standings(db: Session, session: LiveSession) -> list[dict[str, Any]]:
    """RF-807: score, correct answers, faster correct answers, joined first."""
    counted = counted_attempts(db, session)
    rows = []
    for participant in _real_participants(db, session.id):
        attempt = counted.get(participant.id)
        if attempt is None:
            continue
        rows.append({
            "participant_id": participant.id, "display_name": participant.display_name,
            "avatar_seed": participant.avatar_seed, "score": attempt.score, "correct": attempt.correct,
            "correct_ms": attempt.correct_ms, "joined_at": participant.joined_at, "attempt_no": attempt.attempt_no,
            "repeat_suspect": attempt.repeat_suspect,
        })
    rows.sort(key=lambda r: (-r["score"], -r["correct"], r["correct_ms"], r["joined_at"], r["participant_id"]))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def leaderboard(db: Session, session: LiveSession, *, participant_id: str | None = None, limit: int = LEADERBOARD_TOP) -> dict[str, Any]:
    board = _standings(db, session)

    def public(row: dict[str, Any]) -> dict[str, Any]:
        return {k: row[k] for k in ("rank", "participant_id", "display_name", "avatar_seed", "score", "correct")}

    me = next((row for row in board if row["participant_id"] == participant_id), None) if participant_id else None
    return {
        "top": [public(row) for row in board[:limit]],
        "total": len(board),
        "me": public(me) if me else None,
        "final": state_of(session) == "closed",
    }


def participant_leaderboard(db: Session, participant: LiveParticipant) -> dict[str, Any]:
    session = db.get(LiveSession, participant.session_id)
    if not is_challenge(session):
        raise api_error(404, "challenge_not_found", "No challenge for this token.")
    close_if_due(db, session)
    if not challenge_settings(session)["leaderboard"]:
        raise api_error(404, "leaderboard_disabled", "This challenge has no leaderboard.")
    return leaderboard(db, session, participant_id=participant.id)


# ----------------------------------------------------------------------------- reports

def report_filter(db: Session, session: LiveSession, events: Iterable[LiveAnswerEvent]) -> tuple[list[LiveAnswerEvent], set[str]]:
    """Events of the counted attempts, and the participants that have one."""
    counted = {pid: attempt.attempt_no for pid, attempt in counted_attempts(db, session).items()}
    kept = [e for e in events if counted.get(e.participant_id) == int(e.attempt_no or 1)]
    return kept, set(counted)


def report_block(db: Session, session: LiveSession) -> dict[str, Any]:
    data = progress(db, session)
    return {
        "challenge": data["challenge"],
        "funnel": data["funnel"],
        "attempts": data["attempts"],
        "attempts_per_person": data["attempts_per_person"],
        "repeat_suspects": data["repeat_suspects"],
        "median_duration_ms": data["median_duration_ms"],
        "repeat_participants": sorted({r["participant_id"] for r in _standings(db, session, fresh=True) if r["repeat_suspect"]}),
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def my_results(db: Session, participant: LiveParticipant, *, room=None) -> dict[str, Any]:
    """``/me/results`` for a challenge, in the live shape: the counted attempt (or the
    latest finished one), with the key only where the feedback policy allows it."""
    from app.services import live_results

    now = utcnow()
    session = db.get(LiveSession, participant.session_id)
    close_if_due(db, session, now=now)
    room = room or _room(db, session)
    mine = [a for a in _attempts(db, session.id, participant_id=participant.id) if a.status == "finished"]
    attempt = counted_attempts(db, session).get(participant.id) or (mine[-1] if mine else None)
    rank, ranked = _rank_of(db, session, participant.id)
    visible = _feedback_visible(session, attempt is not None, now)
    items: list[dict[str, Any]] = []
    total_scored = 0
    events: dict[int, LiveAnswerEvent] = {}
    if attempt is not None:
        events = {
            e.position: e for e in db.execute(
                select(LiveAnswerEvent).where(
                    LiveAnswerEvent.session_id == session.id,
                    LiveAnswerEvent.participant_id == participant.id,
                    LiveAnswerEvent.attempt_no == attempt.attempt_no,
                )
            ).scalars()
        }
        for position in attempt.item_order_json or []:
            item = room.items[position]
            if item["item_type"] not in registry.INTERACTIVE_TYPES:
                continue
            scored = registry.is_scored(item["item_type"], int(item.get("points_multiplier", 1)))
            total_scored += 1 if scored else 0
            event = events.get(position)
            effective = scoring.effective_answers([event]).get((position, participant.id)) if event else None
            items.append({
                "position": position,
                "prompt": item.get("prompt") or "",
                "item_type": item["item_type"],
                "correct": (event.score_fraction is not None and event.score_fraction >= 1) if (event and scored and visible) else None,
                "fraction": event.score_fraction if (event and scored and visible) else None,
                "points": (event.points or 0) if event else 0,
                "your_answer": live_results._answer_view(item, effective),  # noqa: SLF001
                "correct_answer": live_results._correct_view(item) if visible else None,  # noqa: SLF001
                "explanation": item.get("explanation") if visible else None,
            })
    return {
        "session_id": session.id,
        "title": room.title,
        "display_name": participant.display_name,
        "rank": rank if challenge_settings(session)["leaderboard"] or state_of(session, now) == "closed" else None,
        "participant_count": ranked,
        "score": attempt.score if attempt else 0,
        "correct": attempt.correct if (attempt and visible) else 0,
        "answered": attempt.answered if attempt else 0,
        "total_scored": total_scored,
        "items": items,
        "mode": MODE,
        "corrections_visible": visible,
        "corrections_at": _iso(session.closes_at) if challenge_settings(session)["feedback"] == "after_close" else None,
    }

