from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_client_key, get_current_user_optional
from app.db.session import get_db
from app.models import StudySession, User
from app.schemas import (
    ReviewQueueSnapshotOut,
    StudyAnswerFeedbackOut,
    StudyAnswerIn,
    StudyHistoryOut,
    StudyOverviewOut,
    StudyResultOut,
    StudySessionReviewOut,
    StudySessionCreateIn,
    StudySessionOut,
    StudySessionStateOut,
    StudyStateIn,
    StudyStateOut,
    StudyWeeklyAnalyticsOut,
)
from app.services.study import (
    answer_study_question,
    build_study_overview,
    build_review_queue_snapshot,
    build_weekly_study_analytics,
    compute_study_result,
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
    return session


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
    review_states: list[str] | None = Query(default=None),
    bookmarked_only: bool = Query(default=False),
    notes_only: bool = Query(default=False),
    limit: int = Query(12, ge=1, le=100),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    owner_user_id, owner_client_key = _owner_scope(current_user, client_key)
    normalized_exam_id = exam_id.strip() if exam_id else None
    return ReviewQueueSnapshotOut(
        **build_review_queue_snapshot(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=normalized_exam_id or None,
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


@router.get("/sessions/{session_id}/next")
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


@router.get("/sessions/{session_id}/result", response_model=StudyResultOut)
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
    return StudyResultOut(**result)


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
    return StudySessionReviewOut(**review)
