"""Sentinel Arena administration (PLANO §7.11): overview, moderation queue, forced end,
filter terms, audited access to nominal reports and the retention job.

Moderators (``reviewer``) work the queue; policy and destructive actions (forced end,
terms, unblock, retention, reports of other owners) need ``admin``. Every action is
audited in ``live_audit_event``.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.admin import require_platform_admin, require_reviewer
from app.core.errors import api_error
from app.db.session import get_db
from app.live.db import live_db
from app.live.gateway import get_hub
from app.models import LiveSession, User
from app.services import live_admin, live_results, live_retention

router = APIRouter(prefix="/api/admin/live", tags=["admin-live"])


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReasonIn(_Strict):
    reason: str = Field(min_length=5, max_length=500)


class ResolveIn(_Strict):
    action: Literal["dismiss", "approve", "remove_item", "end_session", "block_quiz"]
    note: Optional[str] = Field(default=None, max_length=500)


class TermIn(_Strict):
    term: str = Field(min_length=2, max_length=64)
    match: Literal["substring", "token"] = "token"
    kind: Literal["block", "allow"] = "block"
    scope: Literal["names", "content", "all"] = "all"
    note: Optional[str] = Field(default=None, max_length=200)


@router.get("/overview")
def overview(db: Session = Depends(get_db), _: User = Depends(require_reviewer)) -> dict[str, Any]:
    return live_admin.overview(db)


@router.get("/cases")
def list_cases(
    status: Optional[Literal["open", "dismissed", "actioned", "all"]] = Query(default="open"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_reviewer),
) -> dict[str, Any]:
    return live_admin.list_cases(db, status=None if status == "all" else status, limit=limit, offset=offset)


@router.post("/cases/{case_id}/resolve")
async def resolve_case(request: Request, case_id: str, body: ResolveIn, user: User = Depends(require_reviewer)) -> dict[str, Any]:
    if body.action in {"end_session", "block_quiz"} and user.role != "admin":
        raise api_error(403, "admin_required", "Only administrators can end sessions or block quizzes.")

    def _resolve() -> list[tuple[str, Any]]:
        with live_db() as db:
            return live_admin.resolve_case(db, db.get(User, user.id), case_id, action=body.action, note=body.note)

    outcomes = await run_in_threadpool(_resolve)
    hub = get_hub(request.app)
    for session_id, outcome in outcomes:
        await hub.publish_outcome(session_id, outcome)
    return {"resolved": True, "sessions_affected": [sid for sid, _ in outcomes]}


@router.post("/sessions/{session_id}/end")
async def force_end(request: Request, session_id: str, body: ReasonIn, user: User = Depends(require_platform_admin)) -> dict[str, Any]:
    def _end() -> Any:
        with live_db() as db:
            return live_admin.force_end(db, db.get(User, user.id), session_id, reason=body.reason)

    outcome = await run_in_threadpool(_end)
    await get_hub(request.app).publish_outcome(session_id, outcome)
    return {"ended": True}


@router.get("/sessions/{session_id}/report")
def session_report(
    session_id: str,
    reason: str = Query(min_length=5, max_length=500),
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> dict[str, Any]:
    """RF-1110: an admin opens someone else's nominal report only with a stated reason."""
    session = db.get(LiveSession, session_id)
    if session is None:
        raise api_error(404, "session_not_found", "Session not found.")
    live_admin.audit(db, actor=user, action="admin_report_view", session_id=session.id, quiz_id=session.quiz_id, reason=reason)
    db.commit()
    return live_results.session_report(db, session)


@router.post("/quizzes/{quiz_id}/unblock")
def unblock_quiz(quiz_id: str, body: ReasonIn, db: Session = Depends(get_db), user: User = Depends(require_platform_admin)) -> dict[str, Any]:
    live_admin.unblock_quiz(db, user, quiz_id, reason=body.reason)
    return {"unblocked": True}


@router.get("/terms")
def list_terms(db: Session = Depends(get_db), _: User = Depends(require_reviewer)) -> dict[str, Any]:
    return {"items": live_admin.list_terms(db)}


@router.post("/terms", status_code=201)
def add_term(body: TermIn, db: Session = Depends(get_db), user: User = Depends(require_platform_admin)) -> dict[str, Any]:
    return live_admin.add_term(db, user, term=body.term, match=body.match, kind=body.kind, scope=body.scope, note=body.note)


@router.delete("/terms/{term_id}", status_code=204)
def delete_term(term_id: str, db: Session = Depends(get_db), user: User = Depends(require_platform_admin)) -> None:
    live_admin.delete_term(db, user, term_id)


@router.get("/audit")
def audit_log(
    session_id: Optional[str] = Query(default=None, max_length=36),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> dict[str, Any]:
    return {"items": live_admin.list_audit(db, session_id=session_id, limit=limit)}


@router.post("/retention/run")
def run_retention(db: Session = Depends(get_db), user: User = Depends(require_platform_admin)) -> dict[str, Any]:
    summary = live_retention.run(db)
    live_admin.audit(db, actor=user, action="retention_manual_run", meta=summary)
    db.commit()
    return summary
