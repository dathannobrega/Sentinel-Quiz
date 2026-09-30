"""Sentinel Arena REST API (``/api/live/*``, contract §4–§5 and §7).

Authoring and session management are for hosts (see live_quiz.host_capability);
``/rooms/*``, ``/names/suggest`` and ``/me/results`` are public (participant token).
Endpoints that change what a connected room sees (join, rejoin, end) publish the
resulting events on the live bus.
"""
from __future__ import annotations

import io
import secrets
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_current_user_optional, get_current_user_required
from app.core.config import settings
from app.core.errors import api_error
from app.db.session import get_db
from app.live.db import live_db
from app.live import runtime
from app.live.gateway import get_hub
from app.live.metrics import metrics
from app.models import User
from app.schemas_live import (
    ExpectedVersionIn,
    FromBankIn,
    ItemWriteIn,
    JoinIn,
    QuizCreateIn,
    QuizUpdateIn,
    RejoinIn,
    ReorderIn,
    AccessIn,
    ClaimIn,
    ReportIn,
    ReviewIn,
    SessionCreateIn,
)
from app.schemas_ai import BankSampleIn
from app.services import live_admin, live_names, live_preflight, live_quiz, live_results, live_rights, live_session
from app.services.auth import parse_bearer_token

router = APIRouter(prefix="/api/live", tags=["live"])

ACCESS_MAX_FAILURES = 10  # wrong return codes per (session, name) per 15 min


async def _enabled() -> None:  # async: no threadpool hop on the public hot paths
    if not settings.live_enabled:
        raise api_error(404, "live_disabled", "Live quizzes are not enabled.")


def host_user(current_user: User = Depends(get_current_user_required)) -> User:
    return live_quiz.require_host(current_user)


# ----------------------------------------------------------------------------- capabilities

@router.get("/capabilities")
def get_capabilities(current_user: User | None = Depends(get_current_user_optional)) -> dict[str, Any]:
    return live_quiz.capabilities(current_user)


# ----------------------------------------------------------------------------- quizzes

@router.get("/quizzes")
def list_quizzes(db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    return {"items": live_quiz.list_quizzes(db, user)}


@router.post("/quizzes", status_code=201)
def create_quiz(body: QuizCreateIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    quiz = live_quiz.create_quiz(
        db,
        user,
        title=body.title,
        description=body.description,
        language=body.language,
        theme_key=body.theme_key,
        settings_patch=body.settings.model_dump(exclude_none=True) if body.settings else None,
    )
    return live_quiz.serialize_detail(db, live_quiz.get_owned_quiz(db, user, quiz.id))


@router.get("/quizzes/{quiz_id}")
def get_quiz(quiz_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    return live_quiz.serialize_detail(db, live_quiz.get_owned_quiz(db, user, quiz_id))


@router.patch("/quizzes/{quiz_id}")
def update_quiz(quiz_id: str, body: QuizUpdateIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    fields = body.model_dump(exclude_unset=True, exclude={"expected_version", "settings"})
    if body.settings is not None:
        fields["settings"] = body.settings.model_dump(exclude_none=True)
    quiz = live_quiz.update_quiz(db, user, quiz_id, expected_version=body.expected_version, fields=fields)
    return live_quiz.serialize_detail(db, quiz)


@router.delete("/quizzes/{quiz_id}", status_code=204)
def archive_quiz(quiz_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> Response:
    live_quiz.archive_quiz(db, user, quiz_id)
    return Response(status_code=204)


@router.post("/quizzes/{quiz_id}/duplicate", status_code=201)
def duplicate_quiz(quiz_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    return live_quiz.serialize_detail(db, live_quiz.duplicate_quiz(db, user, quiz_id))


@router.post("/quizzes/{quiz_id}/items", status_code=201)
def add_item(quiz_id: str, body: ItemWriteIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    if body.item_type is None:
        raise api_error(422, "item_invalid", "item_type is required.")
    quiz = live_quiz.add_item(
        db, user, quiz_id,
        expected_version=body.expected_version, item_type=body.item_type, position=body.position, fields=body.write_fields(),
    )
    return live_quiz.serialize_detail(db, quiz)


@router.post("/quizzes/{quiz_id}/items/reorder")
def reorder_items(quiz_id: str, body: ReorderIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    quiz = live_quiz.reorder_items(db, user, quiz_id, expected_version=body.expected_version, item_ids=body.item_ids)
    return live_quiz.serialize_detail(db, quiz)


@router.post("/quizzes/{quiz_id}/items/from-bank")
def add_from_bank(quiz_id: str, body: FromBankIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    quiz, rejected = live_quiz.add_items_from_bank(
        db, user, quiz_id, expected_version=body.expected_version, question_ids=body.question_ids
    )
    return {"quiz": live_quiz.serialize_detail(db, quiz), "rejected": rejected}


@router.patch("/quizzes/{quiz_id}/items/{item_id}")
def update_item(quiz_id: str, item_id: str, body: ItemWriteIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    quiz = live_quiz.update_item(
        db, user, quiz_id, item_id,
        expected_version=body.expected_version, item_type=body.item_type, fields=body.write_fields(),
    )
    return live_quiz.serialize_detail(db, quiz)


@router.delete("/quizzes/{quiz_id}/items/{item_id}")
def delete_item(
    quiz_id: str,
    item_id: str,
    expected_version: int = Query(ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(host_user),
) -> dict[str, Any]:
    quiz = live_quiz.delete_item(db, user, quiz_id, item_id, expected_version=expected_version)
    return live_quiz.serialize_detail(db, quiz)


@router.post("/quizzes/{quiz_id}/items/{item_id}/review")
def review_item(quiz_id: str, item_id: str, body: ReviewIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    quiz = live_quiz.mark_item_reviewed(
        db, user, quiz_id, item_id, expected_version=body.expected_version, confirm_key=body.confirm_key
    )
    return live_quiz.serialize_detail(db, quiz)


@router.post("/quizzes/{quiz_id}/publish")
def publish_quiz(quiz_id: str, body: ExpectedVersionIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    return live_quiz.publish_quiz(db, user, quiz_id, expected_version=body.expected_version)


# ----------------------------------------------------------------------------- bank

@router.get("/bank/facets")
def bank_facets(db: Session = Depends(get_db), _user: User = Depends(host_user)) -> dict[str, Any]:
    return live_quiz.bank_facets(db)


@router.get("/bank/search")
def bank_search(
    q: Optional[str] = Query(default=None, max_length=100),
    certification: Optional[str] = Query(default=None, max_length=64),
    domain: Optional[str] = Query(default=None, max_length=255),
    difficulty: Optional[str] = Query(default=None, max_length=16),
    only_guest_eligible: bool = False,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=100000),
    db: Session = Depends(get_db),
    _user: User = Depends(host_user),
) -> dict[str, Any]:
    return live_quiz.bank_search(
        db, q=q, certification=certification, domain=domain, difficulty=difficulty,
        only_guest_eligible=only_guest_eligible, limit=limit, offset=offset,
    )


@router.post("/bank/sample")
def bank_sample(body: BankSampleIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    if body.exclude_quiz_id:
        live_quiz.get_owned_quiz(db, user, body.exclude_quiz_id)
    return live_quiz.bank_sample(
        db, certification=body.certification, domains=body.domains, difficulty=body.difficulty, n=body.n,
        strategy=body.strategy, only_guest_eligible=body.only_guest_eligible, exclude_quiz_id=body.exclude_quiz_id,
    )


# ----------------------------------------------------------------------------- sessions (host)

@router.post("/sessions", status_code=201)
def create_session(body: SessionCreateIn, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    session = live_session.create_session(
        db, user,
        quiz_id=body.quiz_id, allow_guests=body.allow_guests, max_participants=body.max_participants,
        preset=body.preset, audience=body.audience, rehearsal=body.rehearsal, bots=body.bots,
    )
    return live_session.serialize_session(db, session)


@router.get("/sessions")
def list_sessions(
    quiz_id: Optional[str] = Query(default=None, max_length=36),
    db: Session = Depends(get_db),
    user: User = Depends(host_user),
) -> dict[str, Any]:
    return {"items": live_session.list_sessions(db, user, quiz_id=quiz_id)}


@router.get("/sessions/{session_id}")
def get_session(session_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    return live_session.serialize_session(db, live_session.get_owned_session(db, user, session_id))


@router.post("/sessions/{session_id}/display-token")
def display_token(session_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    return live_session.display_token(live_session.get_owned_session(db, user, session_id))


@router.post("/sessions/{session_id}/end")
async def end_session(request: Request, session_id: str, user: User = Depends(host_user)) -> dict[str, Any]:
    def _end() -> tuple[runtime.Outcome, dict[str, Any]]:
        with live_db() as db:
            live_session.get_owned_session(db, user, session_id)
            outcome = runtime.end_session(db, session_id)
            return outcome, live_session.serialize_session(db, live_session.get_owned_session(db, user, session_id))

    outcome, data = await run_in_threadpool(_end)
    if not outcome.error:
        await get_hub(request.app).publish_outcome(session_id, outcome)
    return data


@router.get("/sessions/{session_id}/qr.svg")
def session_qr(session_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> Response:
    import segno

    session = live_session.get_owned_session(db, user, session_id)
    qr = segno.make(live_session.join_url(session.join_code), error="m", micro=False)
    buffer = io.BytesIO()
    qr.save(buffer, kind="svg", scale=10, border=4, dark="#0b1220", light="#ffffff", xmldecl=False)
    return Response(
        content=buffer.getvalue(),
        media_type="image/svg+xml",
        headers={"Content-Disposition": f'inline; filename="sala-{session.join_code}.svg"', "Cache-Control": "private, max-age=300"},
    )


@router.get("/sessions/{session_id}/report")
def session_report(session_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    session = live_session.get_owned_session(db, user, session_id)
    live_admin.audit_access(db, user, action="report_view", session=session)  # RF-1110
    return live_results.session_report(db, session)


@router.get("/sessions/{session_id}/export.csv")
def session_export(session_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> StreamingResponse:
    session = live_session.get_owned_session(db, user, session_id)
    live_admin.audit_access(db, user, action="export_csv", session=session)  # RF-1110
    rows = list(live_results.iter_csv(db, session))  # built before the DB session closes
    return StreamingResponse(
        iter(rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="sentinel-arena-{session.join_code}-{session.id[:8]}.csv"'},
    )


# ----------------------------------------------------------------------------- participants (public)

# Public hot paths (a whole audience at once) open and close their DB session inside ONE
# worker-thread call. A sync ``Depends(get_db)`` would keep the pooled connection until its
# teardown gets a thread of its own, and under a burst the teardowns queue behind the new
# requests while those wait for the pool (pool starvation, RNF-205/RNF-109).

@router.get("/rooms/{code}", dependencies=[Depends(_enabled)])
async def get_room(code: str) -> dict[str, Any]:
    def _room() -> dict[str, Any]:
        with live_db() as db:
            return live_session.room_info(db, code)

    return await run_in_threadpool(_room)


async def _publish_lobby(request: Request, session_id: str) -> None:
    # Coalesced by the room loop (at most one lobby.update per LOBBY_INTERVAL_S).
    await get_hub(request.app).mark_lobby_dirty(session_id)


@router.post("/rooms/{code}/join", status_code=201, dependencies=[Depends(_enabled)])
async def join_room(
    request: Request,
    code: str,
    body: JoinIn,
    current_user: User | None = Depends(get_current_user_optional),
) -> dict[str, Any]:
    def _join() -> dict[str, Any]:
        with live_db() as db:
            return live_session.join(
                db, code, user=current_user, display_name=body.display_name, consent=body.consent,
                avatar_seed=body.avatar_seed, dev_h=body.dev_h,
            )

    result = await run_in_threadpool(_join)
    await _publish_lobby(request, result["session_id"])
    return result


@router.post("/rooms/{code}/rejoin", dependencies=[Depends(_enabled)])
async def rejoin_room(request: Request, code: str, body: RejoinIn) -> dict[str, Any]:
    def _rejoin() -> dict[str, Any]:
        with live_db() as db:
            return live_session.rejoin(db, code, display_name=body.display_name, return_code=body.return_code)

    result = await run_in_threadpool(_rejoin)
    await _publish_lobby(request, result["session_id"])
    return result


@router.get("/names/suggest", dependencies=[Depends(_enabled)])
def suggest_name(lang: Optional[str] = Query(default="pt-BR", max_length=8)) -> dict[str, str]:
    return {"name": live_names.suggest_name(lang)}


@router.get("/me/results", dependencies=[Depends(_enabled)])
async def my_results(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    token = parse_bearer_token(authorization)
    if not token:
        raise api_error(401, "token_invalid", "Participant token required.")

    def _results() -> dict[str, Any]:
        with live_db() as db:
            return live_results.my_results(db, live_session.participant_from_token(db, token))

    return await run_in_threadpool(_results)


@router.get("/metrics", include_in_schema=False)
def live_metrics(request: Request, format: str = Query(default="prometheus", pattern="^(prometheus|json)$"),
                 authorization: Optional[str] = Header(default=None)) -> Any:
    """RNF-1001. Bearer LIVE_METRICS_TOKEN. Without a token: loopback only, and never in
    production (behind proxy headers the client address is only as good as the proxy)."""
    expected = str(settings.live_metrics_token or "")
    if expected:
        allowed = secrets.compare_digest(parse_bearer_token(authorization) or "", expected)
    else:
        allowed = not settings.is_production() and (request.client.host if request.client else "") in {"127.0.0.1", "::1"}
    if not allowed:
        raise api_error(404, "not_found", "Not found.")
    if format == "json":
        return metrics.summary()
    return PlainTextResponse(metrics.prometheus(), media_type="text/plain; version=0.0.4")


def _participant(token: str) -> Any:
    with live_db() as db:
        return live_session.participant_from_token(db, token)


def _bearer(authorization: Optional[str]) -> str:
    token = parse_bearer_token(authorization)
    if not token:
        raise api_error(401, "token_invalid", "Participant token required.")
    return token


@router.get("/me", dependencies=[Depends(_enabled)])
async def my_data(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    """RF-650: what the room keeps about me."""
    token = _bearer(authorization)

    def _data() -> dict[str, Any]:
        with live_db() as db:
            return live_rights.my_data(db, live_session.participant_from_token(db, token))

    return await run_in_threadpool(_data)


@router.delete("/me", dependencies=[Depends(_enabled)])
async def erase_me(request: Request, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    """RF-650: anonymize me now (leaves rankings and reports; the socket is closed)."""
    token = _bearer(authorization)

    def _erase() -> tuple[str, runtime.Outcome]:
        with live_db() as db:
            participant = live_session.participant_from_token(db, token)
            return participant.session_id, live_rights.erase(db, participant)

    session_id, outcome = await run_in_threadpool(_erase)
    await get_hub(request.app).publish_outcome(session_id, outcome)
    return {"erased": True}


@router.post("/me/access", dependencies=[Depends(_enabled)])
async def access_with_return_code(request: Request, body: AccessIn) -> dict[str, Any]:
    """A fresh token from name + return code (expired token, finished session)."""
    store = getattr(request.app.state, "rate_limit_store", None)
    guard_key = f"live-access:{body.session_id}:{live_names.nickname_key(live_names.clean_display_name(body.display_name))}"
    if store is not None:
        failures = await store.peek_counter(key=guard_key)
        if failures is not None and failures >= ACCESS_MAX_FAILURES:
            raise api_error(429, "too_many_attempts", "Too many attempts. Try again later.")

    def _access() -> dict[str, Any]:
        with live_db() as db:
            return live_rights.access_with_return_code(
                db, session_id=body.session_id, display_name=body.display_name, return_code=body.return_code
            )

    try:
        return await run_in_threadpool(_access)
    except Exception as exc:
        if store is not None and getattr(exc, "status_code", None) == 403:
            await store.increment_counter(key=guard_key, ttl_seconds=900)
        raise


@router.post("/me/claim", dependencies=[Depends(_enabled)])
async def claim_me(body: ClaimIn, user: User = Depends(get_current_user_required)) -> dict[str, Any]:
    """RF-633: link this participation (participant token in the body) to the signed-in account."""
    token = body.token

    def _claim() -> dict[str, Any]:
        with live_db() as db:
            participant = live_session.participant_from_token(db, token)
            account = db.get(User, user.id)
            return live_rights.claim(db, participant, account)

    return await run_in_threadpool(_claim)


@router.post("/me/report", status_code=202, dependencies=[Depends(_enabled)])
async def report_content(body: ReportIn, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    """RF-1104: a participant reports the session or one item."""
    token = _bearer(authorization)
    if body.target == "item" and body.qi is None:
        raise api_error(422, "invalid_item", "Tell which item you are reporting.")

    def _report() -> dict[str, Any]:
        with live_db() as db:
            participant = live_session.participant_from_token(db, token)
            case = live_admin.report(db, participant, target=body.target, qi=body.qi, reason=body.reason, note=body.note)
            return {"report_id": case.id}

    return await run_in_threadpool(_report)


@router.post("/sessions/{session_id}/preview", status_code=201)
def create_preview(session_id: str, db: Session = Depends(get_db), user: User = Depends(host_user)) -> dict[str, Any]:
    """RF-514: the host's phone preview in a rehearsal (the same participant client)."""
    return live_session.preview_participant(db, live_session.get_owned_session(db, user, session_id))


@router.get("/sessions/{session_id}/preflight")
async def preflight(request: Request, session_id: str, user: User = Depends(host_user)) -> dict[str, Any]:
    """RF-1115: is everything ready for this room?"""

    def _owned() -> Any:
        with live_db() as db:
            return live_session.get_owned_session(db, user, session_id)

    session = await run_in_threadpool(_owned)
    return await live_preflight.run(get_hub(request.app), session)


@router.get("/healthz")
async def live_health(request: Request) -> dict[str, Any]:
    hub = get_hub(request.app)
    return {"enabled": bool(settings.live_enabled), "bus": await hub.bus.ping(), "connections": hub.connection_count()}
