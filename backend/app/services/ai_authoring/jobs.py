"""AI job lifecycle (PLANO §12.1).

create → (reserve credits, commit) → dispatch → claim (CAS / SKIP LOCKED) → pipeline →
succeeded | degraded | failed (+ refunds) → apply (drafts into the quiz as needs_review).

Runners: ``thread`` executes in a bounded pool inside the API process; ``worker`` leaves
jobs queued for ``python -m app.services.ai_authoring.worker`` (``FOR UPDATE SKIP
LOCKED``, so several workers never take the same job). Stale jobs (process died
mid-run) are failed and refunded by :func:`sweep`.
"""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import api_error
from app.live.db import live_db
from app.models import AiJob, LiveQuiz, LiveQuizItem, User
from app.services import licensing
from app.services import live_items as registry
from app.services import live_quiz
from app.services.ai_authoring import pipeline, quota
from app.services.ai_authoring.provider import ProviderError, get_provider

logger = logging.getLogger("app.ai_authoring.jobs")

ACTIVE = ("queued", "running")
FINAL = ("succeeded", "failed", "degraded")
STAGE_PCT = {"queued": 5, "generating": 30, "validating": 65, "critic": 85, "done": 100}
_POOL: ThreadPoolExecutor | None = None
_POOL_LOCK = threading.Lock()


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def serialize(job: AiJob, *, include_result: bool = True) -> dict[str, Any]:
    result = None
    if include_result and job.status in FINAL and job.output_json:
        result = dict(job.output_json)
        applied = set(job.applied_json or [])
        if result.get("type") == "drafts":
            result["items"] = [{**item, "applied": item["index"] in applied} for item in result.get("items") or []]
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "quiz_id": job.quiz_id,
        "item_id": job.item_id,
        "created_at": _iso(job.created_at),
        "started_at": _iso(job.started_at),
        "finished_at": _iso(job.finished_at),
        "progress": {"stage": job.stage, "pct": STAGE_PCT.get(job.stage, 0)},
        "credits": round(float(job.credits or 0.0), 2),
        "model": job.model,
        "error_code": job.error_code,
        "error_message": job.error_message,
        "injection_suspected": bool(job.injection_suspected),
        "result": result,
    }


# ----------------------------------------------------------------------------- create

def _active_jobs(db: Session, user_id: str) -> int:
    return int(
        db.execute(
            select(func.count()).select_from(AiJob).where(AiJob.owner_user_id == user_id, AiJob.status.in_(ACTIVE))
        ).scalar_one()
    )


def create_job(
    db: Session,
    user: User,
    *,
    kind: str,
    quiz_id: str,
    item_id: str | None,
    input_json: dict[str, Any],
    credits: float,
) -> AiJob:
    live_quiz.get_owned_quiz(db, user, quiz_id)  # ownership (404 otherwise)
    sweep(db, user_id=user.id)
    if _active_jobs(db, user.id) >= max(int(settings.ai_max_concurrent_jobs), 1):
        raise api_error(429, "ai_too_many_jobs", "Wait for your current AI jobs to finish.")
    job = AiJob(
        owner_user_id=user.id,
        quiz_id=quiz_id,
        item_id=item_id,
        kind=kind,
        status="queued",
        stage="queued",
        input_json=input_json,
        credits=credits,
        model=settings.effective_ai_model() if settings.ai_provider != "fake" else "fake",
        critic_model=settings.effective_ai_critic_model() if settings.ai_critic_enabled else None,
        tokens_in=0,
        tokens_out=0,
        injection_suspected=False,
        attempts=0,
        created_at=utcnow(),
    )
    db.add(job)
    db.flush()
    quota.reserve(db, user, credits=credits, feature=kind, job_id=job.id)
    db.commit()
    db.refresh(job)
    logger.info("AI job created", extra={"event": "ai_job_created", "job_id": job.id, "kind": kind, "credits": credits})
    dispatch(job.id)
    return job


def dispatch(job_id: str) -> None:
    if str(settings.ai_job_runner).lower() != "thread":
        return
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            _POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ai-job")
        _POOL.submit(run_job, job_id)


# ----------------------------------------------------------------------------- run

def _claim(db: Session, job_id: str | None) -> AiJob | None:
    now = utcnow()
    if job_id is None:
        stmt = select(AiJob).where(AiJob.status == "queued").order_by(AiJob.created_at).limit(1)
        if db.bind is not None and db.bind.dialect.name != "sqlite":
            stmt = stmt.with_for_update(skip_locked=True)
        job = db.execute(stmt).scalar_one_or_none()
        if job is None:
            db.rollback()
            return None
        job_id = job.id
    result = db.execute(
        update(AiJob)
        .where(AiJob.id == job_id, AiJob.status == "queued")
        .values(status="running", stage="generating", started_at=now, attempts=AiJob.attempts + 1)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    if result.rowcount != 1:
        return None
    return db.get(AiJob, job_id, populate_existing=True)


def _set_stage(job_id: str, stage: str) -> None:
    with live_db() as db:
        db.execute(update(AiJob).where(AiJob.id == job_id).values(stage=stage).execution_options(synchronize_session=False))
        db.commit()


def _item_payload(db: Session, item_id: str) -> dict[str, Any] | None:
    item = db.get(LiveQuizItem, item_id)
    return live_quiz.serialize_item(item) if item else None


def run_job(job_id: str | None = None) -> str | None:
    """Claim and execute one job. Returns the job id that ran (None when nothing to do)."""
    with live_db() as db:
        job = _claim(db, job_id)
        if job is None:
            return None
        job_id, kind, owner, request = job.id, job.kind, job.owner_user_id, dict(job.input_json or {})
        item = _item_payload(db, job.item_id) if job.item_id else None
        language = request.get("language") or "pt-BR"
        if kind == "improve":
            quiz = db.get(LiveQuiz, job.quiz_id)
            language = "en" if quiz and quiz.language == "en" else "pt-BR"
    # No database connection is held from here until the provider answers (M-B5).
    provider = get_provider()
    status, output, error_code, error_message = "succeeded", None, None, None
    result: pipeline.PipelineResult | None = None
    try:
        if kind == "improve":
            if item is None:
                raise ProviderError("item_missing", "The item no longer exists.")
            result = pipeline.improve(
                provider, action=request["action"], item=item, instructions=request.get("instructions"),
                language=language, stage=lambda s: _set_stage(job_id, s),
            )
        else:
            result = pipeline.generate(
                provider,
                {k: v for k, v in request.items() if k not in {"topic", "source_text"}},
                topic=request.get("topic"),
                source_text=request.get("source_text"),
                stage=lambda s: _set_stage(job_id, s),
            )
        output = result.output
    except ProviderError as exc:
        logger.warning("AI provider failed", extra={"event": "ai_job_provider_error", "job_id": job_id, "code": exc.code})
        error_code, error_message = "ai_unavailable", str(exc)[:300]
        status = "failed"
        if kind == "generate":
            fallback = _bank_fallback(request)
            if fallback:
                status, output = "degraded", {"type": "degraded", "reason": "ai_unavailable", "bank_question_ids": fallback}
    except Exception:
        logger.exception("AI job crashed", extra={"event": "ai_job_error", "job_id": job_id})
        status, error_code, error_message = "failed", "ai_internal_error", "Unexpected error while generating."
    _finish(job_id, owner, kind, status=status, output=output, result=result, error_code=error_code, error_message=error_message)
    return job_id


def _bank_fallback(request: dict[str, Any]) -> list[str]:
    try:
        with live_db() as db:
            sample = live_quiz.bank_sample(
                db,
                certification=request.get("certification"),
                domains=request.get("domains") or [],
                difficulty=None,
                n=int(request.get("n") or 5),
                strategy="coverage",
                only_guest_eligible=False,
                exclude_quiz_id=None,
            )
        return sample["question_ids"]
    except Exception:  # pragma: no cover - fallback must never mask the original failure
        logger.exception("AI bank fallback failed")
        return []


def _finish(
    job_id: str,
    owner: str,
    kind: str,
    *,
    status: str,
    output: dict[str, Any] | None,
    result: pipeline.PipelineResult | None,
    error_code: str | None,
    error_message: str | None,
) -> None:
    with live_db() as db:
        job = db.get(AiJob, job_id)
        if job is None:
            return
        reserved = float(job.credits or 0.0)
        if status == "succeeded" and result is not None:
            unit = quota.CREDITS[kind]
            used = min(reserved, unit * (result.produced if kind != "improve" else max(result.produced, 1)))
        else:
            used = 0.0
        refund = round(reserved - used, 2)
        job.status = status
        job.stage = "done"
        job.output_json = output
        job.error_code = error_code
        job.error_message = error_message
        job.finished_at = utcnow()
        job.credits = used
        if result is not None:
            job.tokens_in, job.tokens_out = result.usage.tokens_in, result.usage.tokens_out
            job.injection_suspected = result.injection
            job.prompt_id = result.prompt_id
        # Retention: pasted documents are not kept after the job (PLANO §11.2).
        if "source_text" in (job.input_json or {}):
            job.input_json = {**job.input_json, "source_text": f"[{len(job.input_json['source_text'])} caracteres removidos]"}
        quota.refund(
            db, user_id=owner, job_id=job_id, credits=refund, feature=kind,
            tokens_in=job.tokens_in, tokens_out=job.tokens_out,
        )
        db.commit()
    logger.info("AI job finished", extra={"event": "ai_job_finished", "job_id": job_id, "status": status, "credits": used})


def sweep(db: Session, *, user_id: str | None = None, now: datetime | None = None) -> int:
    """Fail + refund jobs stuck in `running` (process died); re-dispatch orphaned `queued`
    jobs in thread mode."""
    now = now or utcnow()
    stale = now - timedelta(minutes=max(int(settings.ai_job_stale_minutes), 1))
    stmt = select(AiJob).where(AiJob.status == "running", AiJob.started_at < stale)
    if user_id:
        stmt = stmt.where(AiJob.owner_user_id == user_id)
    count = 0
    for job in db.execute(stmt).scalars().all():
        job.status, job.stage, job.error_code = "failed", "done", "ai_timeout"
        job.error_message = "The job took too long and was cancelled."
        job.finished_at = now
        quota.refund(db, user_id=job.owner_user_id, job_id=job.id, credits=float(job.credits or 0.0), feature=job.kind)
        job.credits = 0.0
        count += 1
    if count:
        db.commit()
    if str(settings.ai_job_runner).lower() == "thread":
        orphan = now - timedelta(seconds=30)
        q = select(AiJob.id).where(AiJob.status == "queued", AiJob.created_at < orphan)
        if user_id:
            q = q.where(AiJob.owner_user_id == user_id)
        for (job_id,) in db.execute(q).all():
            dispatch(job_id)
    return count


# ----------------------------------------------------------------------------- read/apply

def get_owned_job(db: Session, user: User, job_id: str) -> AiJob:
    job = db.get(AiJob, job_id, populate_existing=True)
    if job is None or job.owner_user_id != user.id:
        raise api_error(404, "ai_job_not_found", "AI job not found.")
    return job


def list_jobs(db: Session, user: User, *, quiz_id: str | None, limit: int) -> list[dict[str, Any]]:
    sweep(db, user_id=user.id)
    stmt = select(AiJob).where(AiJob.owner_user_id == user.id)
    if quiz_id:
        stmt = stmt.where(AiJob.quiz_id == quiz_id)
    jobs = db.execute(stmt.order_by(AiJob.created_at.desc()).limit(limit)).scalars().all()
    return [serialize(job, include_result=False) for job in jobs]


def _ai_meta(job: AiJob, draft: dict[str, Any] | None) -> dict[str, Any]:
    critic = (draft or {}).get("critic")
    flags = set((critic or {}).get("flags") or [])
    return {
        "job_id": job.id,
        "model": job.model,
        "issues": list((draft or {}).get("issues") or []),
        "critic": critic,
        "requires_key_confirmation": bool(flags & {"key_mismatch", "ambiguous"}),
    }


def apply(db: Session, user: User, job_id: str, *, quiz_id: str, expected_version: int, indexes: list[int], force: bool) -> LiveQuiz:
    job = get_owned_job(db, user, job_id)
    if job.quiz_id != quiz_id:
        raise api_error(404, "ai_job_not_found", "AI job not found for this quiz.")
    if job.status != "succeeded" or not job.output_json:
        raise api_error(409, "ai_job_not_ready", "The AI job has no result to apply.")
    output = job.output_json
    applied = set(job.applied_json or [])
    quiz = live_quiz.get_owned_quiz(db, user, quiz_id, for_update=True)
    live_quiz.check_version(quiz, expected_version)
    now = utcnow()

    if output.get("type") == "improvement":
        if 0 in applied:
            raise api_error(409, "ai_already_applied", "This proposal was already applied.")
        proposal = output.get("proposal") or {}
        item = next((it for it in quiz.items if it.id == output.get("item_id")), None)
        if item is None:
            raise api_error(404, "item_not_found", "Item not found.")
        fields: dict[str, Any] = {}
        if "prompt" in proposal:
            fields["prompt"] = proposal["prompt"]
        if "options" in proposal:
            fields["options"] = proposal["options"]
        if "explanation" in proposal:
            fields["explanation"] = proposal["explanation"]
        try:
            values = registry.apply_write(item.item_type, fields, payload=item.payload_json or {}, answer=item.answer_json or {})
        except registry.ItemInputError as exc:
            raise api_error(422, "item_invalid", exc.message) from None
        for key, value in values.items():
            setattr(item, key, value)
        item.review_state = "needs_review"
        item.origin_meta_json = _ai_meta(job, None)
        item.updated_at = now
        job.applied_json = [0]
    else:
        drafts = {d["index"]: d for d in output.get("items") or []}
        wanted = list(dict.fromkeys(int(i) for i in indexes))
        if not wanted or any(i not in drafts for i in wanted):
            raise api_error(422, "item_invalid", "Unknown draft index.")
        if any(i in applied for i in wanted):
            raise api_error(409, "ai_already_applied", "Some drafts were already added.")
        blocked = [i for i in wanted if drafts[i].get("blocked")]
        if blocked and not force:
            exc = api_error(422, "ai_draft_blocked", "Some drafts have blocking problems.")
            exc.detail["details"] = {"indexes": blocked}  # type: ignore[index]
            raise exc
        live_quiz.ensure_capacity(quiz, len(wanted))
        position = len(quiz.items)
        for offset, index in enumerate(wanted):
            draft = drafts[index]
            payload, answer = registry.default_payload(draft["item_type"])
            write = {
                "prompt": draft["prompt"][: registry.PROMPT_MAX],
                "explanation": draft.get("explanation") or None,
                "time_limit_s": max(registry.TIME_LIMIT_MIN, min(registry.TIME_LIMIT_MAX, int(draft.get("time_limit_s") or 20))),
                "points_multiplier": 1,
            }
            if draft["item_type"] == "type_answer":
                write["accepted_answers"] = draft.get("accepted_answers") or []
            else:
                write["options"] = [
                    {"key": o["key"], "text": o["text"][: registry.OPTION_MAX], "correct": bool(o["correct"])}
                    for o in draft["options"]
                ][: registry.OPTIONS_MAX]
            try:
                values = registry.apply_write(draft["item_type"], write, payload=payload, answer=answer)
            except registry.ItemInputError as exc:
                raise api_error(422, "item_invalid", exc.message) from None
            db.add(
                LiveQuizItem(
                    quiz_id=quiz.id,
                    position=position + offset,
                    item_type=draft["item_type"],
                    source_kind="ai",
                    prompt=values.pop("prompt"),
                    license_scope=licensing.OWN,
                    review_state="needs_review",
                    domain=draft.get("domain"),
                    certification=draft.get("certification"),
                    difficulty=draft.get("difficulty") if draft.get("difficulty") in {"Easy", "Medium", "Hard"} else None,
                    origin_meta_json=_ai_meta(job, draft),
                    created_at=now,
                    updated_at=now,
                    **values,
                )
            )
        job.applied_json = sorted(applied | set(wanted))
    live_quiz.touch(quiz)
    db.commit()
    logger.info("AI job applied", extra={"event": "ai_job_applied", "job_id": job.id, "quiz_id": quiz_id})
    return live_quiz.get_owned_quiz(db, user, quiz_id)
