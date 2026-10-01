"""Sentinel Arena self-paced challenges (contract CONTRATO-INCREMENTO-6.md).

Owner: ``POST /challenges``, ``GET/PATCH /sessions/{id}/challenge``.
Participant (public link ``/q/{slug}``): metadata, join, access with the return code,
attempts, answers, content slides, hand-in and leaderboard. Participant calls carry the
participant token (``Authorization: Bearer``) and open/close their DB session inside one
worker-thread call, like the live public paths.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_current_user_optional
from app.api.live import _enabled, host_user
from app.core.errors import api_error
from app.db.session import get_db
from app.live.db import live_db
from app.models import LiveParticipant, User
from app.schemas_live import AdvanceIn, ChallengeAnswerIn, ChallengeCreateIn, ChallengeUpdateIn, JoinIn, RejoinIn
from app.services import live_challenge, live_session
from app.services.auth import parse_bearer_token

router = APIRouter(prefix="/api/live", tags=["live-challenge"], dependencies=[Depends(_enabled)])


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


# ----------------------------------------------------------------------------- owner

@router.post("/challenges", status_code=201)
def create_challenge(body: ChallengeCreateIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    session = live_challenge.create_challenge(
        db, user,
        quiz_id=body.quiz_id, opens_at=_utc(body.opens_at), closes_at=_utc(body.closes_at),  # type: ignore[arg-type]
        attempts=body.attempts, time_mode=body.time_mode, total_time_s=body.total_time_s, feedback=body.feedback,
        leaderboard=body.leaderboard, shuffle_items=body.shuffle_items, allow_guests=body.allow_guests,
        audience=body.audience, max_participants=body.max_participants,
    )
    return live_session.serialize_session(db, session)


def _owned_challenge(db: Session, user: User, session_id: str):
    session = live_session.get_owned_session(db, user, session_id)
    if not live_challenge.is_challenge(session):
        raise api_error(404, "challenge_not_found", "This session is not a self-paced challenge.")
    return session


@router.get("/sessions/{session_id}/challenge")
def challenge_progress(session_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    return live_challenge.progress(db, _owned_challenge(db, user, session_id))


@router.patch("/sessions/{session_id}/challenge")
def update_challenge(
    session_id: str, body: ChallengeUpdateIn, db: Session = Depends(get_db), user: User = Depends(host_user)
) -> dict[str, Any]:
    session = _owned_challenge(db, user, session_id)
    live_challenge.update_window(db, session, closes_at=_utc(body.closes_at), close_now=body.close_now)
    return live_challenge.progress(db, session)


# ----------------------------------------------------------------------------- participant

async def _public(fn: Callable[..., Any], *args: Any) -> Any:
    def _call() -> Any:
        with live_db() as db:
            # Each call reads what it needs and commits; keeping the loaded rows after a
            # commit avoids re-reading the session, attempt and participant (CPU per answer).
            db.expire_on_commit = False
            return fn(db, *args)

    return await run_in_threadpool(_call)


def _token(authorization: Optional[str]) -> str:
    token = parse_bearer_token(authorization)
    if not token:
        raise api_error(401, "token_invalid", "Participant token required.")
    return token


def _participant(db: Session, slug: str, token: str) -> LiveParticipant:
    session = live_challenge.find_by_slug(db, slug)
    participant = live_session.participant_from_token(db, token)
    if participant.session_id != session.id:
        raise api_error(401, "token_invalid", "This token belongs to another room.")
    if participant.banned or participant.kicked_at is not None:
        raise api_error(403, "banned", "You were removed from this challenge.")
    return participant


@router.get("/q/{slug}")
async def challenge_info(slug: str, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    # Opening the link counts once per visit without a token (funnel "opened", RF-1029).
    return await _public(lambda db: live_challenge.public_info(db, slug, count_view=not parse_bearer_token(authorization)))


@router.post("/q/{slug}/join", status_code=201)
async def join_challenge(
    slug: str, body: JoinIn, current_user: User | None = Depends(get_current_user_optional)
) -> dict[str, Any]:
    def _join(db: Session) -> dict[str, Any]:
        session = live_challenge.find_by_slug(db, slug)
        live_challenge.ensure_joinable(db, session)
        return live_session.join_session(
            db, session, user=current_user, display_name=body.display_name, consent=body.consent,
            avatar_seed=body.avatar_seed, dev_h=body.dev_h, token_ttl=live_challenge.token_ttl_seconds(session),
        )

    return await _public(_join)


@router.post("/q/{slug}/access")
async def access_challenge(slug: str, body: RejoinIn) -> dict[str, Any]:
    """Recover a lost token with name + return code (also after the challenge closed)."""

    def _access(db: Session) -> dict[str, Any]:
        session = live_challenge.find_by_slug(db, slug)
        return live_session.rejoin_session(
            db, session, display_name=body.display_name, return_code=body.return_code,
            token_ttl=live_challenge.token_ttl_seconds(session),
        )

    return await _public(_access)


@router.post("/q/{slug}/attempts", status_code=201)
async def start_attempt(slug: str, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    token = _token(authorization)
    return await _public(lambda db: live_challenge.start_attempt(db, _participant(db, slug, token)))


@router.get("/q/{slug}/attempts/current")
async def current_attempt(slug: str, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    token = _token(authorization)
    return await _public(lambda db: live_challenge.current_attempt(db, _participant(db, slug, token)))


@router.post("/q/{slug}/attempts/{attempt_id}/answers")
async def answer(
    slug: str, attempt_id: str, body: ChallengeAnswerIn, authorization: Optional[str] = Header(default=None)
) -> dict[str, Any]:
    token = _token(authorization)
    return await _public(lambda db: live_challenge.answer(
        db, _participant(db, slug, token), attempt_id[:36], answer_id=body.answer_id, qi=body.qi,
        choice=body.choice, text=body.text, words=body.words, number=body.number,
    ))


@router.post("/q/{slug}/attempts/{attempt_id}/advance")
async def advance(
    slug: str, attempt_id: str, body: AdvanceIn, authorization: Optional[str] = Header(default=None)
) -> dict[str, Any]:
    token = _token(authorization)
    return await _public(lambda db: live_challenge.advance(db, _participant(db, slug, token), attempt_id[:36], index=body.index))


@router.post("/q/{slug}/attempts/{attempt_id}/finish")
async def finish(slug: str, attempt_id: str, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    token = _token(authorization)
    return await _public(lambda db: live_challenge.finish(db, _participant(db, slug, token), attempt_id[:36]))


@router.get("/q/{slug}/leaderboard")
async def challenge_leaderboard(slug: str, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    token = _token(authorization)
    return await _public(lambda db: live_challenge.participant_leaderboard(db, _participant(db, slug, token)))
