from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_client_key, get_current_user_optional
from app.db.session import get_db
from app.models import StudySession, User
from app.schemas import (
    ActiveSessionOut,
    QuestionHintOut,
    ReviewQueueSnapshotOut,
    StudyAnswerFeedbackOut,
    StudyAnswerIn,
    MAX_FILTER_ITEMS,
    StudyHistoryOut,
    StudyNextQuestionOut,
    StudyOverviewOut,
    StudyPlanOut,
    StudyResultOut,
    StudySessionReviewOut,
    StudySessionCreateIn,
    StudySessionOut,
    StudySessionStateOut,
    StudyStateIn,
    StudyStateOut,
    StudyWeeklyAnalyticsOut,
)
from app.services.discovery import list_active_study_sessions
from app.services.pedagogy import build_question_hint
from app.services.study import (
    answer_study_question,
    build_study_overview,
    build_review_queue_snapshot,
    build_study_plan,
    build_weekly_study_analytics,
    compute_study_result,
    create_placement_session,
    create_study_session,
    get_study_session_review,
    get_question_for_study_session,
    get_question_state,
    list_study_history,
    serialize_study_session,
    set_question_state,
)


router = APIRouter(prefix="/api/study", tags=["study"])


def _owner_scope(current_user: User | None, client_key: str | None) -> tuple[str | None, str | None]:
    if current_user:
        return current_user.id, None
    if client_key:
        return None, client_key
    raise HTTPException(
        status_code=400,
        detail="Study state requires authentication or the X-Client-Key header.",
    )


def _get_study_session(
    db: Session,
    session_id: str,
    current_user: User | None,
    client_key: str | None,
) -> StudySession:
    session = db.get(StudySession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Study session not found.")
    if session.user_id:
        if not current_user or session.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Study session not found.")
    elif session.client_key:
        if not client_key or session.client_key != client_key:
            raise HTTPException(status_code=404, detail="Study session not found.")
    else:
        # Sessions without any owner are never readable (deny by default).
        raise HTTPException(status_code=404, detail="Study session not found.")
    return session


def _check_filter_list(values: list[str] | None, name: str) -> None:
    if values and len(values) > MAX_FILTER_ITEMS:
        raise HTTPException(status_code=400, detail=f"Too many values for '{name}' (max {MAX_FILTER_ITEMS}).")
    for value in values or []:
        if len(str(value)) > 200:
            raise HTTPException(status_code=400, detail=f"Value too long for '{name}'.")


@router.get("/overview", response_model=StudyOverviewOut)
def study_overview(
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    return StudyOverviewOut(
        **build_study_overview(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
    )


@router.get("/plan", response_model=StudyPlanOut)
def study_plan(
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    return StudyPlanOut(
        **build_study_plan(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
    )


@router.get("/sessions/active", response_model=list[ActiveSessionOut])
def active_study_sessions(
    limit: int = Query(default=6, ge=1, le=12),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    return [
        ActiveSessionOut(**item)
        for item in list_active_study_sessions(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            limit=limit,
        )
    ]


@router.get("/questions/{question_id}/state", response_model=StudyStateOut)
def question_state(
    question_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    try:
        state = get_question_state(
            db,
            question_id,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return StudyStateOut(**state)


@router.put("/questions/{question_id}/state", response_model=StudyStateOut)
def update_question_state(
    question_id: str,
    payload: StudyStateIn,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    try:
        state = set_question_state(
            db,
            question_id,
            bookmarked=payload.bookmarked,
            note_text=payload.note_text,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return StudyStateOut(**state)


@router.get("/sessions/{session_id}/questions/{question_id}/hint", response_model=QuestionHintOut)
def study_question_hint(
    session_id: str,
    question_id: str,
    level: int = Query(default=1, ge=1, le=3),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_study_session(db, session_id, current_user, client_key)
    current_question = get_question_for_study_session(db, session, session.current_index)
    if not current_question or current_question.get("id") != question_id:
        raise HTTPException(
            status_code=409,
            detail="Hints are only available for the current active study question.",
        )
    try:
        payload = build_question_hint(db, question_id, level=level)
    except ValueError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    db.commit()
    return QuestionHintOut(**payload)


@router.post("/sessions", response_model=StudySessionOut)
def start_study_session(
    payload: StudySessionCreateIn,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    try:
        session = create_study_session(
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
            payload.queue_only,
            payload.review_states,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return StudySessionOut(**serialize_study_session(session))


@router.post("/placement/session", response_model=StudySessionOut)
def start_placement_session(
    exam_id: str | None = Query(default=None),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    try:
        session = create_placement_session(
            db,
            exam_id=exam_id.strip() if exam_id else None,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return StudySessionOut(**serialize_study_session(session))


@router.post("/review/sessions", response_model=StudySessionOut)
def start_daily_review_session(
    payload: StudySessionCreateIn,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    try:
        session = create_study_session(
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
            "review",
            True,
            payload.review_states,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return StudySessionOut(**serialize_study_session(session))


@router.get("/review/queue", response_model=ReviewQueueSnapshotOut)
def review_queue_snapshot(
    exam_id: str | None = None,
    domains: list[str] | None = Query(default=None),
    review_states: list[str] | None = Query(default=None),
    bookmarked_only: bool = Query(default=False),
    notes_only: bool = Query(default=False),
    limit: int = Query(12, ge=1, le=100),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    _check_filter_list(domains, "domains")
    _check_filter_list(review_states, "review_states")
    normalized_exam_id = exam_id.strip() if exam_id else None
    return ReviewQueueSnapshotOut(
        **build_review_queue_snapshot(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=normalized_exam_id or None,
            domains=domains,
            review_states=review_states,
            bookmarked_only=bookmarked_only,
            notes_only=notes_only,
            limit=limit,
        )
    )


@router.get("/history", response_model=list[StudyHistoryOut])
def study_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    return [
        StudyHistoryOut(**item)
        for item in list_study_history(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            limit=limit,
            offset=offset,
        )
    ]


@router.get("/analytics/weekly", response_model=StudyWeeklyAnalyticsOut)
def study_weekly_analytics(
    weeks: int = Query(8, ge=2, le=24),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    return StudyWeeklyAnalyticsOut(
        **build_weekly_study_analytics(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            weeks=weeks,
        )
    )


@router.get("/sessions/{session_id}", response_model=StudySessionStateOut)
def study_session_state(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_study_session(db, session_id, current_user, client_key)
    return StudySessionStateOut(**serialize_study_session(session))


@router.get(
    "/sessions/{session_id}/next",
    response_model=StudyNextQuestionOut,
    response_model_exclude_unset=True,
)
def next_study_question(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_study_session(db, session_id, current_user, client_key)
    payload = get_question_for_study_session(db, session, session.current_index)
    if payload is None:
        return {"finished": True}
    return {
        "finished": False,
        "question": payload,
        "progress_index": session.current_index,
        "total_questions": session.total_questions,
        "answered_count": session.answered_count,
    }


@router.post("/sessions/{session_id}/answer", response_model=StudyAnswerFeedbackOut)
def submit_study_answer(
    session_id: str,
    payload: StudyAnswerIn,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_study_session(db, session_id, current_user, client_key)
    try:
        feedback = answer_study_question(
            db,
            session,
            payload.question_id,
            payload.selected_keys,
            payload.confidence_level,
            payload.elapsed_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return StudyAnswerFeedbackOut(**feedback)


@router.get("/sessions/{session_id}/result", response_model=StudyResultOut, deprecated=True)
def study_result(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_study_session(db, session_id, current_user, client_key)
    try:
        result = compute_study_result(db, session)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    response = StudyResultOut(**result)
    db.commit()
    return response


@router.get("/sessions/{session_id}/review", response_model=StudySessionReviewOut)
def study_session_review(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_study_session(db, session_id, current_user, client_key)
    try:
        review = get_study_session_review(db, session)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    response = StudySessionReviewOut(**review)
    db.commit()
    return response
