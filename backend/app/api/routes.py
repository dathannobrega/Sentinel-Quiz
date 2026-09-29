from __future__ import annotations

import logging
from html import escape

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_client_key, get_current_user_optional, get_current_user_required
from app.core.config import settings
from app.core.errors import api_error
from app.db.session import get_db
from app.models import Exam, ExamSession, User
from app.schemas import (
    ActiveSessionOut,
    AnswerFeedbackOut,
    AnswerIn,
    CreateSessionIn,
    DomainCatalogOut,
    EngagementSnapshotOut,
    ExamOut,
    ExamQuestionStateOut,
    ExamReviewScreenOut,
    HealthOut,
    MarkReviewOut,
    QuestionIssueIn,
    QuestionIssueOut,
    QuestionSearchOut,
    ReadinessScoreOut,
    ResultOut,
    ReviewQuestionOut,
    SessionHistoryOut,
    SessionOut,
    SessionReviewOut,
    SessionStateOut,
    TutorRequest,
    TutorResponse,
    WeakAreaSnapshotOut,
)
from app.services.discovery import list_active_exam_sessions, search_questions
from app.services.engagement import build_engagement_snapshot
from app.services.exam_runtime import (
    build_exam_review_screen,
    get_exam_question_state,
    save_exam_response,
    submit_exam_session,
    toggle_mark_for_review,
)
from app.services.issue_reporting import create_question_issue
from app.services.quiz import (
    create_session,
    compute_result,
    build_domain_catalog,
    build_weak_area_snapshot_for_owner,
    pause_exam_session,
    resume_exam_session,
    expire_exam_session_if_due,
    serialize_exam_session,
)
from app.services.gemini import ask_gemini, GeminiDisabled, GeminiError
from app.services.materials import build_material_preview
from app.services.owner_scope import session_belongs_to
from app.services.readiness import build_readiness_snapshot
from app.services.review_api import (
    build_exam_review_questions,
    build_exam_session_meta,
    list_completed_session_history,
)
from app.services.tutor import (
    TutorRequestError,
    build_tutor_context,
    ensure_tutor_allowed,
    seconds_until_utc_midnight,
    tutor_daily_quota,
    tutor_quota_key,
)

router = APIRouter(prefix="/api", tags=["api"])

logger = logging.getLogger("app.tutor")


@router.get("/health", response_model=HealthOut)
def health():
    ai_enabled = bool(settings.gemini_enable and settings.gemini_api_key and settings.gemini_api_key.strip())
    return HealthOut(ok=True, ai_enabled=ai_enabled, ai_model=settings.gemini_model)

@router.get("/exams", response_model=list[ExamOut])
def list_exams(db: Session = Depends(get_db)):
    exams = db.execute(select(Exam).order_by(Exam.title.asc())).scalars().all()
    return [ExamOut(id=e.id, title=e.title, source=e.source, question_count=e.question_count) for e in exams]


@router.get("/domains", response_model=DomainCatalogOut)
def list_domains(exam_id: str | None = Query(default=None), db: Session = Depends(get_db)):
    normalized_exam_id = exam_id.strip() if exam_id else None
    return build_domain_catalog(db, normalized_exam_id or None)


@router.get("/analytics/weak-areas", response_model=WeakAreaSnapshotOut)
def weak_area_snapshot(
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    return build_weak_area_snapshot_for_owner(
        db,
        owner_user_id=current_user.id if current_user else None,
        owner_client_key=None if current_user else client_key,
    )


@router.get("/analytics/engagement", response_model=EngagementSnapshotOut)
def engagement_snapshot(
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    if not current_user and not client_key:
        raise HTTPException(status_code=400, detail="Engagement analytics require authentication or X-Client-Key.")
    payload = build_engagement_snapshot(
        db,
        owner_user_id=current_user.id if current_user else None,
        owner_client_key=None if current_user else client_key,
    )
    # Read-only (M-B7): goals/streak/profile are persisted by the answer/submit flows.
    return EngagementSnapshotOut(**payload)


@router.get("/analytics/readiness", response_model=ReadinessScoreOut)
def readiness_snapshot(
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    if not current_user and not client_key:
        raise HTTPException(status_code=400, detail="Readiness analytics require authentication or X-Client-Key.")
    payload = build_readiness_snapshot(
        db,
        owner_user_id=current_user.id if current_user else None,
        owner_client_key=None if current_user else client_key,
    )
    # Read-only: no commit (M-B7).
    return ReadinessScoreOut(**payload)


@router.get("/questions/search", response_model=QuestionSearchOut)
def question_search(
    query: str | None = Query(default=None, max_length=160),
    exam_id: str | None = Query(default=None),
    domain: str | None = Query(default=None),
    tag: str | None = Query(default=None, max_length=80),
    bookmarked_only: bool = Query(default=False),
    notes_only: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    try:
        payload = search_questions(
            db,
            query=query,
            exam_id=exam_id,
            domain=domain,
            tag=tag,
            bookmarked_only=bookmarked_only,
            notes_only=notes_only,
            owner_user_id=current_user.id if current_user else None,
            owner_client_key=None if current_user else client_key,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return QuestionSearchOut(**payload)


@router.get("/sessions/active", response_model=list[ActiveSessionOut])
def active_exam_sessions(
    limit: int = Query(default=6, ge=1, le=12),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    return [
        ActiveSessionOut(**item)
        for item in list_active_exam_sessions(
            db,
            owner_user_id=current_user.id if current_user else None,
            owner_client_key=None if current_user else client_key,
            limit=limit,
        )
    ]


@router.post("/sessions", response_model=SessionOut)
def start_session(
    payload: CreateSessionIn,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    if not current_user and not client_key:
        raise HTTPException(
            status_code=400,
            detail="Anonymous sessions require the X-Client-Key header.",
        )
    try:
        session = create_session(
            db,
            payload.exam_id,
            payload.total_questions,
            None,
            payload.domains,
            payload.difficulties,
            payload.tags,
            payload.bookmarked_only,
            payload.notes_only,
            payload.incorrect_only,
            payload.unseen_only,
            payload.low_confidence_only,
            payload.strategy,
            payload.time_limit_minutes,
            payload.experience_mode,
            owner_user_id=current_user.id if current_user else None,
            owner_client_key=None if current_user else client_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return SessionOut(**serialize_exam_session(session))

@router.get("/sessions/history", response_model=list[SessionHistoryOut])
def get_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db)
):
    return [
        SessionHistoryOut(**item)
        for item in list_completed_session_history(
            db,
            owner_user_id=current_user.id if current_user else None,
            owner_client_key=None if current_user else client_key,
            limit=limit,
            offset=offset,
        )
    ]


def _get_session(
    db: Session,
    session_id: str,
    current_user: User | None = None,
    client_key: str | None = None,
) -> ExamSession:
    session = db.get(ExamSession, session_id)
    # Sessions without any owner are never readable (deny by default).
    if not session_belongs_to(session, user_id=current_user.id if current_user else None, client_key=client_key):
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@router.get("/sessions/{session_id}", response_model=SessionStateOut)
def get_session_state(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    # Only write allowed on this GET: auto-submit an exam whose timer ran out.
    expire_exam_session_if_due(db, session)
    return SessionStateOut(**serialize_exam_session(session))


@router.get("/sessions/{session_id}/questions/{position}", response_model=ExamQuestionStateOut)
def get_question_at_position(
    session_id: str,
    position: int,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    return ExamQuestionStateOut(**get_exam_question_state(db, session, position=position))


@router.post("/sessions/{session_id}/pause", response_model=SessionStateOut)
def pause_session(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    try:
        updated = pause_exam_session(db, session)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return SessionStateOut(**serialize_exam_session(updated))


@router.post("/sessions/{session_id}/resume", response_model=SessionStateOut)
def resume_session(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    try:
        updated = resume_exam_session(db, session)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return SessionStateOut(**serialize_exam_session(updated))


@router.put("/sessions/{session_id}/questions/{question_id}/response", response_model=AnswerFeedbackOut)
def save_answer_without_advancing(
    session_id: str,
    question_id: str,
    payload: AnswerIn,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    if payload.question_id != question_id:
        raise HTTPException(status_code=400, detail="Payload question_id does not match the URL.")
    try:
        result = save_exam_response(
            db,
            session,
            question_id=question_id,
            selected_keys=payload.selected_keys,
            elapsed_seconds=payload.elapsed_seconds,
        )
    except ValueError as exc:
        detail = str(exc)
        if "auto-submitted" in detail or "paused" in detail.lower():
            raise HTTPException(status_code=409, detail=detail)
        raise HTTPException(status_code=400, detail=detail)
    return AnswerFeedbackOut(**result)


@router.post("/sessions/{session_id}/questions/{question_id}/mark-review", response_model=MarkReviewOut)
def mark_question_for_review(
    session_id: str,
    question_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    try:
        return toggle_mark_for_review(db, session, question_id=question_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/sessions/{session_id}/review-screen", response_model=ExamReviewScreenOut)
def exam_review_screen(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    return ExamReviewScreenOut(**build_exam_review_screen(db, session))


@router.post("/sessions/{session_id}/submit", response_model=ResultOut)
def submit_exam(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    return ResultOut(**submit_exam_session(db, session))


@router.post("/questions/{question_id}/issues", response_model=QuestionIssueOut)
def report_question_issue(
    question_id: str,
    payload: QuestionIssueIn,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id = current_user.id if current_user else None
    owner_client_key = None if current_user else client_key
    try:
        item = create_question_issue(
            db,
            question_id=question_id,
            session_id=payload.session_id,
            mode=payload.mode,
            category=payload.category,
            message=payload.message,
            question_version_id=payload.question_version_id,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return QuestionIssueOut(**item)

@router.get("/sessions/{session_id}/review", response_model=SessionReviewOut)
def get_review(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    expire_exam_session_if_due(db, session)
    if session.completed_at is None:
        raise HTTPException(status_code=400, detail="Session not completed.")
    session_meta = SessionHistoryOut(**build_exam_session_meta(db, session))
    questions = [ReviewQuestionOut(**item) for item in build_exam_review_questions(db, session)]

    # Read-only (M-B7): compute_result persists nothing.
    return SessionReviewOut(
        session=session_meta,
        result=ResultOut(**compute_result(db, session)),
        questions=questions,
    )


@router.get("/materials/preview", response_class=HTMLResponse)
def material_preview(
    material_path: str = Query(..., max_length=512),
    locator: str | None = Query(default=None, max_length=512),
    page_start: str | None = Query(default=None, max_length=16),
    page_end: str | None = Query(default=None, max_length=16),
    _: User = Depends(get_current_user_required),
):
    try:
        preview = build_material_preview(material_path, locator)
    except FileNotFoundError:
        return HTMLResponse(
            "<html><body><h1>Material nao encontrado</h1><p>Verifique se o arquivo existe no servidor.</p></body></html>",
            status_code=404,
        )
    except Exception:
        return HTMLResponse(
            "<html><body><h1>Nao foi possivel abrir o material</h1><p>O preview deste arquivo falhou.</p></body></html>",
            status_code=500,
        )

    page_label = ""
    if page_start and page_end and page_start != page_end:
        page_label = f"pp. {page_start}-{page_end}"
    elif page_start:
        page_label = f"p. {page_start}"

    subtitle_parts = [preview.get("chapter"), page_label, preview.get("locator")]
    subtitle = " | ".join([str(part).strip() for part in subtitle_parts if str(part or "").strip()])

    title = escape(str(preview.get("title") or "Preview de material"))
    subtitle_html = escape(str(subtitle or preview.get("material_name") or ""))
    body_html = str(preview.get("body_html") or "<p>Sem conteudo suficiente.</p>")

    html = f"""<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <style>
    body {{ margin: 0; font-family: Georgia, 'Times New Roman', serif; background: #f5f1e8; color: #1f2937; }}
    main {{ max-width: 920px; margin: 0 auto; padding: 32px 18px 48px; }}
    .eyebrow {{ font: 700 12px/1.4 sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #7c5d2c; }}
    h1 {{ margin: 8px 0 10px; font-size: clamp(26px, 4vw, 40px); line-height: 1.1; }}
    .meta {{ color: #6b7280; font: 500 14px/1.5 sans-serif; }}
    .card {{ margin-top: 22px; background: rgba(255,255,255,.76); border: 1px solid rgba(124,93,44,.14); border-radius: 18px; padding: 22px; box-shadow: 0 16px 40px rgba(31,41,55,.08); }}
    .body p, .body li {{ font-size: 18px; line-height: 1.75; margin: 0 0 16px; }}
    .body ul {{ margin: 0 0 18px 18px; padding: 0; }}
    a {{ color: #0f766e; font: 600 14px/1.4 sans-serif; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Trecho do material</div>
    <h1>{title}</h1>
    <div class="meta">{subtitle_html}</div>
    <div class="card body">{body_html}</div>
  </main>
</body>
</html>"""
    return HTMLResponse(
        html,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            # The web app embeds this page in an iframe: allow our own origin and the
            # configured web origins as frame ancestors.
            "Content-Security-Policy": (
                "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors "
                + " ".join(["'self'", *[o for o in settings.cors_origin_list() if o != "*"]])
            ),
        },
    )

@router.post("/sessions/{session_id}/questions/{question_id}/tutor", response_model=TutorResponse)
def tutor_question(
    session_id: str,
    question_id: str,
    payload: TutorRequest,
    request: Request,
    current_user: User = Depends(get_current_user_required),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    expire_exam_session_if_due(db, session)
    user_id = current_user.id
    try:
        ensure_tutor_allowed(session)
        context = build_tutor_context(
            db,
            session_id=session_id,
            question_id=question_id,
            mode=payload.mode,
            user_message=payload.user_message,
        )
    except TutorRequestError as exc:
        if exc.code:
            raise api_error(exc.status_code, exc.code, exc.message)
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    if context.short_circuit_message is not None:
        return TutorResponse(
            message=context.short_circuit_message,
            blocked=context.short_circuit_blocked,
            model=settings.gemini_model,
        )

    # Release the pooled connection before the slow external call (M-B5).
    db.commit()

    quota = tutor_daily_quota()
    if quota > 0:
        store = getattr(request.app.state, "rate_limit_store", None)
        used = None
        if store is not None:
            used = anyio.from_thread.run(
                _increment_tutor_counter, store, tutor_quota_key(user_id), seconds_until_utc_midnight()
            )
        if used is not None and used > quota:
            raise api_error(
                429,
                "tutor_quota_exceeded",
                "Daily AI tutor quota reached. Try again tomorrow.",
                headers={"Retry-After": str(seconds_until_utc_midnight())},
            )

    try:
        result = ask_gemini(
            question_prompt=context.question_prompt,
            options=context.options,
            multi_select=context.multi_select,
            user_message=context.user_message,
            mode=context.mode,
            selected_keys=context.selected_keys,
            is_correct=context.is_correct,
            justification=context.justification,
        )
    except GeminiDisabled:
        raise api_error(503, "tutor_disabled", "AI tutor is not configured.")
    except GeminiError:
        logger.warning(
            "AI tutor upstream failure",
            extra={"event": "tutor_upstream_error", "session_id": session_id, "question_id": question_id},
        )
        raise api_error(502, "tutor_upstream_error", "AI tutor is temporarily unavailable.")

    return TutorResponse(message=result.message, blocked=result.blocked, model=result.model)


async def _increment_tutor_counter(store, key: str, ttl_seconds: int) -> int | None:
    return await store.increment_counter(key=key, ttl_seconds=ttl_seconds)
