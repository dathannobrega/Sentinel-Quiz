"""Sentinel Arena waiting room (Incremento 7).

Two reasons to wait, one queue (``live_join_request``):

- ``approval`` (RF-545): the room requires the host's approval; the host admits or
  rejects each person (or everyone) from the presenter view.
- ``capacity`` (DC-16): the room is full; people queue in arrival order and are admitted
  as seats free up (a kick, an erasure, the host raising the cap or turning approval off).

Waiting people are not participants: counts, rankings, reports and the lobby never see
them. Admission creates the ``live_participant``; the waiting phone receives its
participant token on its next poll (``GET /api/live/queue/{id}`` with the wait token),
so the join result is delivered exactly like a normal join (with the return code on the
first delivery). Polling is paced by the server (``retry_after_ms`` grows with the
queue), and a phone that stops polling for ``LIVE_WAITING_STALE_SECONDS`` loses its turn
when seats are filled (it closed the tab), so seats only go to people still there.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import api_error
from app.models import LiveJoinRequest, LiveParticipant, LiveSession, User

logger = logging.getLogger(__name__)

POLL_MIN_MS = 3000
POLL_MAX_MS = 15000
HOST_LIST_LIMIT = 100
ADMIT_BATCH_MAX = 500


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def seats_taken(db: Session, session_id: str) -> int:
    return int(
        db.execute(
            select(func.count()).select_from(LiveParticipant)
            .where(LiveParticipant.session_id == session_id, LiveParticipant.kicked_at.is_(None))
        ).scalar_one()
    )


def waiting_counts(db: Session, session_id: str) -> dict[str, int]:
    rows = db.execute(
        select(LiveJoinRequest.reason, func.count())
        .where(LiveJoinRequest.session_id == session_id, LiveJoinRequest.status == "waiting")
        .group_by(LiveJoinRequest.reason)
    ).all()
    counts = {"approval": 0, "capacity": 0}
    for reason, count in rows:
        counts[str(reason)] = int(count)
    return counts


def retry_after_ms(waiting: int) -> int:
    """Polling pace: 3 s for a short queue, up to 15 s for a long one (2,000 phones
    polling every 15 s is ~130 requests/s, cheap)."""
    return int(min(POLL_MAX_MS, POLL_MIN_MS + 6 * max(0, waiting)))


def name_waiting(db: Session, session_id: str, key: str) -> bool:
    return db.execute(
        select(LiveJoinRequest.id).where(
            LiveJoinRequest.session_id == session_id, LiveJoinRequest.nickname_norm == key, LiveJoinRequest.status == "waiting"
        )
    ).first() is not None


# ----------------------------------------------------------------------------- joining the queue

# Concurrent joins (several workers x threadpool) all read the count before any inserts:
# within this many seats of the cap the decision is taken under a row lock on the room,
# so the cap is exact; far from it the join storm stays lock-free.
CAP_LOCK_MARGIN = 128


def lock_room(db: Session, session_id: str) -> None:
    """Serialize seat decisions of one room until the caller's commit (PostgreSQL)."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(select(LiveSession.id).where(LiveSession.id == session_id).with_for_update())


def needs_waiting(db: Session, session: LiveSession, user: User | None) -> str | None:
    """``approval`` | ``capacity`` | None (join directly). The host joining their own room
    never waits. Challenges never queue: the caller applies their hard cap with the same
    lock (see ``at_capacity``)."""
    if session.mode == "self_paced":
        return None
    if session.require_approval and not (user is not None and user.id == session.owner_user_id):
        return "approval"
    return "capacity" if at_capacity(db, session) else None


def at_capacity(db: Session, session: LiveSession) -> bool:
    taken = seats_taken(db, session.id)
    if taken < int(session.max_participants) - CAP_LOCK_MARGIN:
        return False
    lock_room(db, session.id)
    return seats_taken(db, session.id) >= int(session.max_participants)


def enqueue(
    db: Session,
    session: LiveSession,
    *,
    user: User | None,
    name: str,
    key: str,
    avatar_seed: str,
    dev_h: str | None,
    reason: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or utcnow()
    counts = waiting_counts(db, session.id)
    if counts["approval"] + counts["capacity"] >= int(settings.live_waiting_room_max):
        raise api_error(409, "room_full", "This room and its waiting room are full.")
    token = secrets.token_urlsafe(24)
    request = LiveJoinRequest(
        id=str(uuid.uuid4()),
        session_id=session.id,
        user_id=user.id if user else None,
        display_name=name,
        nickname_norm=key,
        avatar_seed=avatar_seed,
        dev_hash=_hash(dev_h) if dev_h else None,
        consent_version=session.consent_version,
        reason=reason,
        status="waiting",
        wait_token_hash=_hash(token),
        created_at=now,
        last_seen_at=now,
    )
    db.add(request)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "name_taken", "This name is already in use in the room.") from None
    logger.info("live waiting room join", extra={"event": "live_waiting_join", "session_id": session.id, "reason": reason})
    return _waiting_view(db, request, token=token, counts=waiting_counts(db, session.id))


def rejoin_waiting(db: Session, session: LiveSession, user: User) -> dict[str, Any] | None:
    """A signed-in person already waiting gets a fresh wait token (new tab or device)."""
    request = db.execute(
        select(LiveJoinRequest).where(
            LiveJoinRequest.session_id == session.id, LiveJoinRequest.user_id == user.id, LiveJoinRequest.status == "waiting"
        )
    ).scalar_one_or_none()
    if request is None:
        return None
    token = secrets.token_urlsafe(24)
    request.wait_token_hash = _hash(token)
    request.last_seen_at = utcnow()
    db.commit()
    return _waiting_view(db, request, token=token)


def _position(db: Session, request: LiveJoinRequest) -> int | None:
    """Place in the capacity queue (1 = next). Approval has no order: the host decides."""
    if request.reason != "capacity":
        return None
    ahead = db.execute(
        select(func.count()).select_from(LiveJoinRequest).where(
            LiveJoinRequest.session_id == request.session_id,
            LiveJoinRequest.status == "waiting",
            LiveJoinRequest.reason == "capacity",
            LiveJoinRequest.created_at < request.created_at,
        )
    ).scalar_one()
    return int(ahead) + 1


def _waiting_view(db: Session, request: LiveJoinRequest, *, token: str | None = None, counts: dict[str, int] | None = None) -> dict[str, Any]:
    counts = counts or waiting_counts(db, request.session_id)
    data: dict[str, Any] = {
        "status": "waiting",
        "reason": request.reason,
        "request_id": request.id,
        "session_id": request.session_id,
        "display_name": request.display_name,
        "avatar_seed": request.avatar_seed,
        "position": _position(db, request),
        "waiting": counts["approval"] + counts["capacity"],
        "retry_after_ms": retry_after_ms(counts["approval"] + counts["capacity"]),
    }
    if token is not None:
        data["wait_token"] = token
    return data


# ----------------------------------------------------------------------------- the waiting phone

def _own_request(db: Session, request_id: str, token: str) -> LiveJoinRequest:
    request = db.get(LiveJoinRequest, str(request_id)[:36])
    if request is None or not token or not secrets.compare_digest(request.wait_token_hash, _hash(token)):
        raise api_error(403, "invalid_wait_token", "This waiting-room ticket is not valid.")
    return request


def poll(db: Session, request_id: str, token: str, *, now: datetime | None = None) -> dict[str, Any]:
    """The waiting phone asks how it is going; once admitted it gets the join result."""
    from app.services import live_session  # local: live_session imports this module

    now = now or utcnow()
    request = _own_request(db, request_id, token)
    session = db.get(LiveSession, request.session_id)
    if request.status == "waiting":
        if session is None or session.status == "finished":
            request.status, request.decided_at = "expired", now
            db.commit()
        else:
            request.last_seen_at = now
            db.commit()
            # Seats may have freed up without a host action reaching this process.
            if request.reason == "capacity" and not session.room_locked:
                fill_seats(db, session, now=now)
                db.refresh(request)
    if request.status == "waiting":
        return _waiting_view(db, request)
    if request.status != "admitted" or request.participant_id is None:
        return {"status": request.status, "request_id": request.id, "session_id": request.session_id}
    participant = db.get(LiveParticipant, request.participant_id)
    if participant is None or participant.kicked_at is not None:
        return {"status": "rejected", "request_id": request.id, "session_id": request.session_id}
    # Every delivery issues a fresh token (the previous tab's stops working); the return
    # code is created and shown only on the first one, like a normal join.
    return_code = None
    if request.delivered_at is None and participant.user_id is None:
        return_code = "".join(secrets.choice(live_session.RETURN_CODE_ALPHABET) for _ in range(live_session.RETURN_CODE_LENGTH))
        participant.return_code_hash = live_session._hash(f"{participant.session_id}:{return_code}")  # noqa: SLF001
    token_value, expires_at = live_session._issue_participant_token(participant)  # noqa: SLF001
    request.delivered_at = request.delivered_at or now
    db.commit()
    return {
        "status": "admitted",
        "request_id": request.id,
        "session_id": request.session_id,
        "join": live_session._join_result(participant, token_value, expires_at, return_code),  # noqa: SLF001
    }


def withdraw(db: Session, request_id: str, token: str) -> dict[str, Any]:
    request = _own_request(db, request_id, token)
    if request.status == "waiting":
        request.status, request.decided_at = "withdrawn", utcnow()
        db.commit()
    return {"status": request.status, "request_id": request.id}


# ----------------------------------------------------------------------------- admission

def _admit(db: Session, session: LiveSession, request: LiveJoinRequest, now: datetime) -> bool:
    """Create the participant for a waiting request (savepoint: a name clash only skips it)."""
    participant = LiveParticipant(
        id=str(uuid.uuid4()),
        session_id=session.id,
        user_id=request.user_id,
        display_name=request.display_name,
        nickname_norm=request.nickname_norm,
        avatar_seed=request.avatar_seed,
        return_code_hash=None,
        dev_hash=request.dev_hash,
        consent_version=request.consent_version,
        joined_at=now,
        banned=False,
    )
    try:
        with db.begin_nested():
            db.add(participant)
            db.flush()
    except IntegrityError:
        request.status, request.decided_at = "rejected", now  # the name (or account) is in the room already
        return False
    request.status, request.decided_at, request.participant_id = "admitted", now, participant.id
    return True


def _waiting(db: Session, session_id: str, *, reason: str | None = None, ids: Iterable[str] | None = None, limit: int | None = None) -> list[LiveJoinRequest]:
    stmt = select(LiveJoinRequest).where(LiveJoinRequest.session_id == session_id, LiveJoinRequest.status == "waiting")
    if reason:
        stmt = stmt.where(LiveJoinRequest.reason == reason)
    if ids is not None:
        stmt = stmt.where(LiveJoinRequest.id.in_(list(ids)))
    stmt = stmt.order_by(LiveJoinRequest.created_at, LiveJoinRequest.id)
    if limit:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt.with_for_update(skip_locked=True) if db.bind.dialect.name == "postgresql" else stmt).scalars())


def fill_seats(db: Session, session: LiveSession, *, now: datetime | None = None) -> int:
    """Admit the capacity queue, in arrival order, into the free seats. People who stopped
    polling lose their turn. Safe across workers (row locks skip what another one took)."""
    now = now or utcnow()
    if session.status == "finished" or session.room_locked:
        return 0
    lock_room(db, session.id)  # two workers filling at once must not overshoot the cap
    free = int(session.max_participants) - seats_taken(db, session.id)
    if free <= 0:
        db.commit()
        return 0
    stale_before = now - timedelta(seconds=int(settings.live_waiting_stale_seconds))
    admitted = 0
    for request in _waiting(db, session.id, reason="capacity", limit=min(free * 2 + 20, ADMIT_BATCH_MAX)):
        if admitted >= free:
            break
        if request.last_seen_at < stale_before:
            request.status, request.decided_at = "expired", now
            continue
        admitted += 1 if _admit(db, session, request, now) else 0
    db.commit()
    if admitted:
        logger.info("live waiting room admitted", extra={"event": "live_waiting_admitted", "session_id": session.id, "count": admitted})
    return admitted


def admit(db: Session, session_id: str, *, request_ids: list[str] | None, now: datetime | None = None) -> int:
    """Host approves people (``None`` = everyone waiting for approval). Without a free seat
    an approved person moves to the capacity queue, keeping their arrival time."""
    now = now or utcnow()
    session = db.get(LiveSession, session_id)
    if session is None or session.status == "finished":
        return 0
    lock_room(db, session_id)
    free = int(session.max_participants) - seats_taken(db, session.id)
    admitted = 0
    for request in _waiting(db, session_id, reason="approval", ids=request_ids, limit=ADMIT_BATCH_MAX):
        if free - admitted > 0:
            admitted += 1 if _admit(db, session, request, now) else 0
        else:
            request.reason = "capacity"
    db.commit()
    return admitted


def reject(db: Session, session_id: str, *, request_id: str, now: datetime | None = None) -> bool:
    request = db.get(LiveJoinRequest, str(request_id)[:36])
    if request is None or request.session_id != session_id or request.status != "waiting":
        return False
    request.status, request.decided_at = "rejected", now or utcnow()
    db.commit()
    return True


def set_capacity(db: Session, session_id: str, *, max_participants: int, now: datetime | None = None) -> int:
    """Host changes the cap (never above the platform's); raising it admits the queue."""
    session = db.get(LiveSession, session_id)
    if session is None or session.status == "finished":
        return 0
    cap = max(1, min(int(max_participants), int(settings.live_max_participants)))
    session.max_participants = cap
    db.commit()
    return fill_seats(db, session, now=now)


def set_approval(db: Session, session_id: str, *, required: bool, now: datetime | None = None) -> int:
    """Turning approval off lets everyone waiting for it in (capacity permitting)."""
    session = db.get(LiveSession, session_id)
    if session is None or session.status == "finished":
        return 0
    session.require_approval = bool(required)
    db.commit()
    if required:
        return 0
    return admit(db, session_id, request_ids=None, now=now) + fill_seats(db, session, now=now)


def expire_all(db: Session, session_id: str, *, now: datetime | None = None) -> int:
    """The room ended: nobody is waiting for it any more."""
    now = now or utcnow()
    count = 0
    for request in _waiting(db, session_id):
        request.status, request.decided_at = "expired", now
        count += 1
    db.commit()
    return count


# ----------------------------------------------------------------------------- host view

def host_view(db: Session, session: LiveSession, *, now: datetime | None = None) -> dict[str, Any]:
    """``waiting_room`` block of the host snapshot and of ``waiting_room.update``."""
    now = now or utcnow()
    counts = waiting_counts(db, session.id)
    stale_before = now - timedelta(seconds=int(settings.live_waiting_stale_seconds))

    def row(request: LiveJoinRequest) -> dict[str, Any]:
        return {
            "request_id": request.id,
            "display_name": request.display_name,
            "avatar_seed": request.avatar_seed,
            "signed_in": request.user_id is not None,
            "created_at": _iso(request.created_at),
            "connected": request.last_seen_at >= stale_before,
        }

    approval = list(db.execute(
        select(LiveJoinRequest).where(
            LiveJoinRequest.session_id == session.id, LiveJoinRequest.status == "waiting", LiveJoinRequest.reason == "approval"
        ).order_by(LiveJoinRequest.created_at).limit(HOST_LIST_LIMIT)
    ).scalars())
    return {
        "require_approval": bool(session.require_approval),
        "max_participants": int(session.max_participants),
        "platform_max": int(settings.live_max_participants),
        "approval_count": counts["approval"],
        "capacity_count": counts["capacity"],
        "approval": [row(r) for r in approval],
    }
