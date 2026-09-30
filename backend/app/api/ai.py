"""AI authoring API (``/api/ai/*``, contract docs/live-quiz/CONTRATO-INCREMENTO-2.md §3).

Hosts only (same policy as Sentinel Arena authoring) and AI_AUTHORING_ENABLED. Job
creation reserves credits and returns 202 immediately; clients poll ``GET /jobs/{id}``.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_optional, get_current_user_required
from app.core.config import settings
from app.core.errors import api_error
from app.db.session import get_db
from app.models import DomainBlueprint, User
from app.schemas_ai import ApplyIn, FromSourceIn, GenerateIn, ImproveIn, SuggestFormatIn
from app.services import live_quiz
from app.services.ai_authoring import jobs, quota
from app.services.ai_authoring.schemas import AI_ITEM_TYPES
from app.services.ai_authoring.suggest import suggest_time_limit

router = APIRouter(prefix="/api/ai", tags=["ai"])


def ai_user(current_user: User = Depends(get_current_user_required)) -> User:
    user = live_quiz.require_host(current_user)
    if not settings.ai_authoring_enabled:
        raise api_error(404, "ai_disabled", "AI authoring is not enabled.")
    return user


def _certifications(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(
        select(DomainBlueprint.certification, DomainBlueprint.domain)
        .where(DomainBlueprint.weight.is_not(None))
        .order_by(DomainBlueprint.certification, DomainBlueprint.domain)
    ).all()
    result: dict[str, list[str]] = {}
    for certification, domain in rows:
        if certification and domain and domain not in result.setdefault(certification, []):
            result[certification].append(domain)
    return [{"id": cert, "label": cert, "domains": domains} for cert, domains in result.items()]


@router.get("/capabilities")
def capabilities(db: Session = Depends(get_db), current_user: User | None = Depends(get_current_user_optional)) -> dict[str, Any]:
    can_host, _reason = live_quiz.host_capability(current_user)
    enabled = bool(settings.ai_authoring_enabled) and can_host
    reason = None if enabled else ("ai_disabled" if not settings.ai_authoring_enabled else "not_allowed")
    credits = quota.summary(db, current_user) if current_user is not None else {"daily_limit": 0, "used_today": 0, "remaining": 0}
    return {
        "enabled": enabled,
        "reason": reason,
        "provider": "fake" if settings.ai_provider == "fake" else "gemini",
        "model": "fake" if settings.ai_provider == "fake" else settings.effective_ai_model(),
        "critic_enabled": bool(settings.ai_critic_enabled),
        "credits": credits,
        "limits": {"max_items": 20, "source_max_chars": 20000, "topic_max_chars": 500},
        "item_types": list(AI_ITEM_TYPES),
        "certifications": _certifications(db),
    }


def _accepted(job) -> JSONResponse:
    return JSONResponse(status_code=202, content=jobs.serialize(job))


@router.post("/quiz-drafts/generate", status_code=202)
def generate(body: GenerateIn, db: Session = Depends(get_db), user: User = Depends(ai_user)) -> JSONResponse:
    request = body.model_dump(exclude={"quiz_id"})
    request["types"] = list(dict.fromkeys(body.types))
    job = jobs.create_job(
        db, user, kind="generate", quiz_id=body.quiz_id, item_id=None, input_json=request,
        credits=quota.CREDITS["generate"] * body.n,
    )
    return _accepted(job)


@router.post("/quiz-drafts/from-source", status_code=202)
def from_source(body: FromSourceIn, db: Session = Depends(get_db), user: User = Depends(ai_user)) -> JSONResponse:
    request = body.model_dump(exclude={"quiz_id"})
    request["types"] = list(dict.fromkeys(body.types))
    job = jobs.create_job(
        db, user, kind="from_source", quiz_id=body.quiz_id, item_id=None, input_json=request,
        credits=quota.CREDITS["from_source"] * body.n,
    )
    return _accepted(job)


@router.post("/items/suggest-format")
def suggest_format(body: SuggestFormatIn, _user: User = Depends(ai_user)) -> dict[str, Any]:
    seconds, rationale = suggest_time_limit(body.item_type, body.prompt, body.options)
    return {"time_limit_s": seconds, "rationale": rationale}


@router.post("/items/{item_id}/improve", status_code=202)
def improve(item_id: str, body: ImproveIn, db: Session = Depends(get_db), user: User = Depends(ai_user)) -> JSONResponse:
    quiz = live_quiz.get_owned_quiz(db, user, body.quiz_id)
    item = next((it for it in quiz.items if it.id == item_id), None)
    if item is None:
        raise api_error(404, "item_not_found", "Item not found.")
    if item.item_type in {"leaderboard"} or (body.action == "distractors" and item.item_type not in {"single_choice", "multi_choice"}):
        raise api_error(422, "item_invalid", "This action does not apply to this item type.")
    job = jobs.create_job(
        db, user, kind="improve", quiz_id=body.quiz_id, item_id=item_id,
        input_json=body.model_dump(exclude={"quiz_id"}), credits=quota.CREDITS["improve"],
    )
    return _accepted(job)


@router.get("/jobs")
def list_jobs(
    quiz_id: Optional[str] = Query(default=None, max_length=36),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    user: User = Depends(ai_user),
) -> dict[str, Any]:
    return {"items": jobs.list_jobs(db, user, quiz_id=quiz_id, limit=limit)}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(ai_user)) -> dict[str, Any]:
    jobs.sweep(db, user_id=user.id)
    return jobs.serialize(jobs.get_owned_job(db, user, job_id))


@router.post("/jobs/{job_id}/apply")
def apply_job(job_id: str, body: ApplyIn, db: Session = Depends(get_db), user: User = Depends(ai_user)) -> dict[str, Any]:
    quiz = jobs.apply(
        db, user, job_id, quiz_id=body.quiz_id, expected_version=body.expected_version, indexes=body.indexes, force=body.force
    )
    return live_quiz.serialize_detail(db, quiz)
