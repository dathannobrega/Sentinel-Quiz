"""Sentinel Arena sessions and participants (PLANO §13, contract §4–§5).

- Session creation from the latest published version, with the licence gate (§15.4):
  rooms open to guests only show items whose licence allows it.
- 6-digit PIN, unique among active sessions (partial unique index + retry).
- Guest join with just a name (+ consent), signed participant token, one-time return
  code (hashed) to recover a lost tab; logged-in users are linked to their account.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import api_error
from app.models import LIVE_ACTIVE_SESSION_STATUSES, LiveParticipant, LiveQuiz, LiveQuizVersion, LiveSession, User
from app.services import licensing
from app.services import live_names
from app.services.live_quiz import get_owned_quiz, latest_version
from app.services.live_tokens import issue_token, jti_hash

RETURN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
RETURN_CODE_LENGTH = 6
CODE_ATTEMPTS = 20


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def join_url(code: str) -> str:
    return f"{settings.public_web_origin.rstrip('/')}/j/{code}"


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def participant_count(db: Session, session_id: str) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(LiveParticipant)
            .where(LiveParticipant.session_id == session_id, LiveParticipant.kicked_at.is_(None))
        ).scalar_one()
    )


def serialize_session(db: Session, session: LiveSession, *, quiz_title: str | None = None, version: LiveQuizVersion | None = None) -> dict[str, Any]:
    version = version or db.get(LiveQuizVersion, session.quiz_version_id)
    if quiz_title is None:
        quiz = db.get(LiveQuiz, session.quiz_id)
        quiz_title = version.title if version else (quiz.title if quiz else "")
    return {
        "id": session.id,
        "quiz_id": session.quiz_id,
        "quiz_title": quiz_title,
        "version_no": version.version_no if version else 0,
        "status": session.status,
        "phase": session.phase,
        "join_code": session.join_code,
        "join_url": join_url(session.join_code),
        "allow_guests": session.allow_guests,
        "max_participants": session.max_participants,
        "preset": session.preset,
        "audience": session.audience,
        "theme_key": session.theme_key,
        "item_count": len(version.items_snapshot_json or []) if version else 0,
        "participant_count": participant_count(db, session.id),
        "created_at": _iso(session.created_at),
        "started_at": _iso(session.started_at),
        "ended_at": _iso(session.ended_at),
    }


# ----------------------------------------------------------------------------- host side

def _new_code() -> str:
    length = max(6, min(8, int(settings.live_join_code_length)))
    first = secrets.choice("123456789")  # no leading zero: easier to read aloud and type
    return first + "".join(secrets.choice("0123456789") for _ in range(length - 1))


def license_blockers(snapshot: list[dict[str, Any]], *, allow_guests: bool) -> list[dict[str, Any]]:
    allowed = licensing.allowed_scopes(allow_guests=allow_guests, platform_guest_ok=settings.live_platform_guest_ok)
    return [
        {"position": item.get("position"), "item_id": item.get("item_id"), "license_scope": item.get("license_scope")}
        for item in snapshot
        if item.get("license_scope", licensing.OWN) not in allowed
    ]


def create_session(
    db: Session,
    user: User,
    *,
    quiz_id: str,
    allow_guests: bool,
    max_participants: int | None,
    preset: str,
    audience: str,
) -> LiveSession:
    quiz = get_owned_quiz(db, user, quiz_id)
    version = latest_version(db, quiz.id)
    if version is None:
        raise api_error(409, "quiz_not_published", "Publish the quiz before presenting it.")
    blockers = license_blockers(list(version.items_snapshot_json or []), allow_guests=allow_guests)
    if blockers:
        exc = api_error(
            422,
            "license_requires_login" if allow_guests else "license_blocked",
            "Some items cannot be shown to guests; require login or remove them.",
        )
        exc.detail["details"] = {"items": blockers}  # type: ignore[index]
        raise exc
    cap = min(int(max_participants or settings.live_max_participants), int(settings.live_max_participants))
    session_settings = dict(version.settings_json or {})
    if preset == "evento" and "streak_bonus" not in (quiz.settings_json or {}):
        session_settings["streak_bonus"] = True
    now = utcnow()
    for _attempt in range(CODE_ATTEMPTS):
        code = _new_code()
        taken = db.execute(
            select(LiveSession.id).where(
                LiveSession.join_code == code, LiveSession.status.in_(LIVE_ACTIVE_SESSION_STATUSES)
            )
        ).first()
        if taken:
            continue
        session = LiveSession(
            quiz_id=quiz.id,
            quiz_version_id=version.id,
            owner_user_id=user.id,
            mode="live",
            status="lobby",
            phase="lobby",
            state_seq=1,
            join_code=code,
            allow_guests=allow_guests,
            room_locked=False,
            max_participants=max(1, cap),
            preset=preset,
            audience=audience,
            theme_key=version.theme_key,
            settings_json=session_settings,
            consent_version=settings.live_consent_version,
            created_at=now,
            updated_at=now,
        )
        db.add(session)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        db.refresh(session)
        return session
    raise api_error(503, "join_code_exhausted", "Could not allocate a room code; try again.")


def get_owned_session(db: Session, user: User, session_id: str) -> LiveSession:
    session = db.get(LiveSession, session_id)
    if session is None or (session.owner_user_id != user.id and user.role != "admin"):
        raise api_error(404, "session_not_found", "Session not found.")
    return session


def list_sessions(db: Session, user: User, *, quiz_id: str | None) -> list[dict[str, Any]]:
    stmt = select(LiveSession).where(LiveSession.owner_user_id == user.id)
    if quiz_id:
        stmt = stmt.where(LiveSession.quiz_id == quiz_id)
    sessions = db.execute(stmt.order_by(LiveSession.created_at.desc()).limit(200)).scalars().all()
    return [serialize_session(db, session) for session in sessions]


def display_token(session: LiveSession) -> dict[str, Any]:
    ttl = int(settings.live_display_token_ttl_hours) * 3600
    token, claims = issue_token(session_id=session.id, role="display", ttl_seconds=ttl)
    return {"token": token, "expires_at": datetime.fromtimestamp(claims.exp, tz=timezone.utc).isoformat()}


# ----------------------------------------------------------------------------- participant side

def find_active_session(db: Session, code: str) -> LiveSession | None:
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if not 6 <= len(code) <= 8:
        return None
    return db.execute(
        select(LiveSession).where(LiveSession.join_code == code, LiveSession.status.in_(LIVE_ACTIVE_SESSION_STATUSES))
    ).scalar_one_or_none()


def room_info(db: Session, code: str) -> dict[str, Any]:
    session = find_active_session(db, code)
    if session is None:
        raise api_error(404, "room_not_found", "No active room with this code.")
    version = db.get(LiveQuizVersion, session.quiz_version_id)
    count = participant_count(db, session.id)
    return {
        "session_id": session.id,
        "code": session.join_code,
        "title": version.title if version else "",
        "status": session.status,
        "phase": session.phase,
        "allow_guests": session.allow_guests,
        "requires_login": not session.allow_guests,
        "accepting_joins": (not session.room_locked) and count < session.max_participants,
        "theme_key": session.theme_key,
        "participant_count": count,
        "consent_version": session.consent_version,
    }


def _issue_participant_token(participant: LiveParticipant) -> tuple[str, str]:
    ttl = int(settings.live_participant_token_ttl_hours) * 3600
    token, claims = issue_token(
        session_id=participant.session_id, role="participant", ttl_seconds=ttl, participant_id=participant.id
    )
    participant.token_hash = jti_hash(claims.jti)
    return token, datetime.fromtimestamp(claims.exp, tz=timezone.utc).isoformat()


def _join_result(participant: LiveParticipant, token: str, expires_at: str, return_code: str | None) -> dict[str, Any]:
    return {
        "session_id": participant.session_id,
        "participant_id": participant.id,
        "token": token,
        "expires_at": expires_at,
        "return_code": return_code,
        "display_name": participant.display_name,
        "avatar_seed": participant.avatar_seed,
    }


def _name_error(code: str) -> Exception:
    exc = api_error(422, "name_rejected", "Choose another name.")
    exc.detail["details"] = {"reason": code}  # type: ignore[index]
    return exc


def join(
    db: Session,
    code: str,
    *,
    user: User | None,
    display_name: str,
    consent: bool,
    avatar_seed: str | None,
    dev_h: str | None,
) -> dict[str, Any]:
    session = find_active_session(db, code)
    if session is None:
        raise api_error(404, "room_not_found", "No active room with this code.")
    if not session.allow_guests and user is None:
        raise api_error(401, "login_required", "This room requires signing in.")
    if not consent:
        raise api_error(422, "consent_required", "Consent is required to join.")

    if user is not None:
        existing = db.execute(
            select(LiveParticipant).where(LiveParticipant.session_id == session.id, LiveParticipant.user_id == user.id)
        ).scalar_one_or_none()
        if existing is not None:
            if existing.banned:
                raise api_error(403, "banned", "You were removed from this room.")
            existing.kicked_at = None  # kicked (not banned) people may come back
            token, expires_at = _issue_participant_token(existing)
            db.commit()
            return _join_result(existing, token, expires_at, None)

    if session.room_locked:
        raise api_error(423, "room_locked", "The host locked this room.")
    if participant_count(db, session.id) >= session.max_participants:
        raise api_error(409, "room_full", "This room is full.")

    if session.audience == "infantojuvenil":
        # Minors: only generated nicknames (RF-515).
        name, key = "", ""
        for _ in range(12):
            name, key = live_names.validate_display_name(live_names.suggest_name())
            if not _nickname_taken(db, session.id, key):
                break
    else:
        try:
            name, key = live_names.validate_display_name(display_name or (user.display_name if user else ""))
        except live_names.NameRejected as exc:
            raise _name_error(exc.code) from None
        if _nickname_taken(db, session.id, key):
            exc = api_error(409, "name_taken", "This name is already in use in the room.")
            exc.detail["details"] = {"suggestion": live_names.suggest_name()}  # type: ignore[index]
            raise exc

    return_code = None if user is not None else "".join(secrets.choice(RETURN_CODE_ALPHABET) for _ in range(RETURN_CODE_LENGTH))
    participant = LiveParticipant(
        session_id=session.id,
        user_id=user.id if user else None,
        display_name=name,
        nickname_norm=key,
        avatar_seed=avatar_seed or live_names.avatar_seed(),
        return_code_hash=_hash(f"{session.id}:{return_code}") if return_code else None,
        dev_hash=_hash(dev_h) if dev_h else None,
        consent_version=session.consent_version,
        joined_at=utcnow(),
        banned=False,
    )
    db.add(participant)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "name_taken", "This name is already in use in the room.") from None
    token, expires_at = _issue_participant_token(participant)
    db.commit()
    return _join_result(participant, token, expires_at, return_code)


def _nickname_taken(db: Session, session_id: str, key: str) -> bool:
    return (
        db.execute(
            select(LiveParticipant.id).where(LiveParticipant.session_id == session_id, LiveParticipant.nickname_norm == key)
        ).first()
        is not None
    )


def rejoin(db: Session, code: str, *, display_name: str, return_code: str) -> dict[str, Any]:
    session = find_active_session(db, code)
    if session is None:
        raise api_error(404, "room_not_found", "No active room with this code.")
    key = live_names.nickname_key(live_names.clean_display_name(display_name))
    participant = db.execute(
        select(LiveParticipant).where(LiveParticipant.session_id == session.id, LiveParticipant.nickname_norm == key)
    ).scalar_one_or_none()
    expected = _hash(f"{session.id}:{str(return_code or '').strip().upper()}")
    if participant is None or not participant.return_code_hash or not secrets.compare_digest(participant.return_code_hash, expected):
        raise api_error(403, "invalid_return_code", "Name or return code does not match.")
    if participant.banned:
        raise api_error(403, "banned", "You were removed from this room.")
    participant.kicked_at = None
    token, expires_at = _issue_participant_token(participant)  # the old tab's token stops working
    db.commit()
    return _join_result(participant, token, expires_at, None)


def participant_from_token(db: Session, token: str) -> LiveParticipant:
    from app.services.live_tokens import LiveTokenError, verify_token

    try:
        claims = verify_token(token)
    except LiveTokenError as exc:
        raise api_error(401, "token_" + exc.code, "Invalid participant token.") from None
    if claims.role != "participant":
        raise api_error(401, "token_invalid", "Invalid participant token.")
    participant = db.get(LiveParticipant, claims.participant_id)
    if participant is None or participant.token_hash != jti_hash(claims.jti):
        raise api_error(401, "token_invalid", "Invalid participant token.")
    return participant
