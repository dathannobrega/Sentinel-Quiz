from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Exam,
    ExamSession,
    Question,
    QuestionBank,
    QuestionVersion,
    StudySession,
    UserBookmark,
    UserNote,
)
from app.services.auth import normalize_client_key


def _parse_json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        payload = json.loads(value)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    items: list[str] = []
    for entry in payload:
        text = str(entry or "").strip()
        if text:
            items.append(text)
    return items


def _owner_scope(
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    normalized_user_id = str(owner_user_id or "").strip() or None
    normalized_client_key = None if normalized_user_id else normalize_client_key(owner_client_key)
    return normalized_user_id, normalized_client_key


def _apply_owner_filter(stmt, model, owner_user_id: Optional[str], owner_client_key: Optional[str]):
    if owner_user_id:
        return stmt.where(model.user_id == owner_user_id)
    if owner_client_key:
        return stmt.where(model.user_id.is_(None), model.client_key == owner_client_key)
    return stmt.where(False)


def search_questions(
    db: Session,
    *,
    query: str | None = None,
    exam_id: str | None = None,
    domain: str | None = None,
    tag: str | None = None,
    bookmarked_only: bool = False,
    notes_only: bool = False,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    owner_user_id, owner_client_key = _owner_scope(owner_user_id, owner_client_key)
    if (bookmarked_only or notes_only) and not (owner_user_id or owner_client_key):
        raise ValueError("Bookmark and note filters require authentication or X-Client-Key.")

    safe_limit = min(max(int(limit), 1), 50)
    safe_offset = max(int(offset), 0)
    raw_query = str(query or "").strip()
    raw_exam_id = str(exam_id or "").strip() or None
    raw_domain = str(domain or "").strip() or None
    raw_tag = str(tag or "").strip() or None

    version_subquery = (
        select(
            QuestionVersion.question_bank_id.label("question_id"),
            QuestionVersion.keywords_json.label("keywords_json"),
        )
        .join(QuestionBank, QuestionBank.published_version_id == QuestionVersion.id)
        .subquery()
    )

    stmt = (
        select(
            Question.id,
            Question.exam_id,
            Exam.title,
            Question.prompt,
            Question.domain,
            Question.certification,
            Question.tags_json,
            version_subquery.c.keywords_json,
            UserBookmark.id.is_not(None).label("is_bookmarked"),
            UserNote.id.is_not(None).label("has_note"),
        )
        .join(Exam, Exam.id == Question.exam_id)
        .outerjoin(version_subquery, version_subquery.c.question_id == Question.id)
    )

    if owner_user_id or owner_client_key:
        if owner_user_id:
            bookmark_join = and_(
                UserBookmark.question_id == Question.id,
                UserBookmark.user_id == owner_user_id,
            )
            note_join = and_(
                UserNote.question_id == Question.id,
                UserNote.user_id == owner_user_id,
            )
        else:
            bookmark_join = and_(
                UserBookmark.question_id == Question.id,
                UserBookmark.user_id.is_(None),
                UserBookmark.client_key == owner_client_key,
            )
            note_join = and_(
                UserNote.question_id == Question.id,
                UserNote.user_id.is_(None),
                UserNote.client_key == owner_client_key,
            )
        stmt = stmt.outerjoin(UserBookmark, bookmark_join).outerjoin(UserNote, note_join)
    else:
        stmt = stmt.outerjoin(UserBookmark, and_(UserBookmark.question_id == Question.id, false())).outerjoin(
            UserNote,
            and_(UserNote.question_id == Question.id, false()),
        )

    if raw_exam_id:
        stmt = stmt.where(Question.exam_id == raw_exam_id)
    if raw_domain:
        stmt = stmt.where(Question.domain == raw_domain)
    if raw_tag:
        stmt = stmt.where(func.lower(Question.tags_json).like(f"%{raw_tag.lower()}%"))
    if bookmarked_only:
        stmt = stmt.where(UserBookmark.id.is_not(None))
    if notes_only:
        stmt = stmt.where(UserNote.id.is_not(None))
    if raw_query:
        lowered = raw_query.lower()
        pattern = f"%{lowered}%"
        stmt = stmt.where(
            or_(
                func.lower(Question.prompt).like(pattern),
                func.lower(func.coalesce(Question.domain, "")).like(pattern),
                func.lower(func.coalesce(Question.tags_json, "")).like(pattern),
                func.lower(func.coalesce(version_subquery.c.keywords_json, "")).like(pattern),
                func.lower(func.coalesce(Question.certification, "")).like(pattern),
            )
        )

    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one() or 0)

    rows = db.execute(
        stmt.order_by(Question.exam_id.asc(), Question.id.asc()).offset(safe_offset).limit(safe_limit)
    ).all()

    items: list[dict[str, Any]] = []
    for question_id, question_exam_id, exam_title, prompt, question_domain, certification, tags_json, keywords_json, is_bookmarked, has_note in rows:
        tags = _parse_json_list(tags_json)
        keywords = _parse_json_list(keywords_json)
        prompt_text = str(prompt or "").strip()
        excerpt = prompt_text if len(prompt_text) <= 220 else f"{prompt_text[:217].rstrip()}..."
        items.append(
            {
                "id": question_id,
                "exam_id": question_exam_id,
                "exam_title": exam_title,
                "prompt_excerpt": excerpt,
                "domain": question_domain,
                "certification": certification,
                "tags": tags[:6],
                "keywords": keywords[:6],
                "is_bookmarked": bool(is_bookmarked),
                "has_note": bool(has_note),
            }
        )

    return {
        "items": items,
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "applied_filters": {
            "query": raw_query or None,
            "exam_id": raw_exam_id,
            "domain": raw_domain,
            "tag": raw_tag,
            "bookmarked_only": bool(bookmarked_only),
            "notes_only": bool(notes_only),
        },
    }


def list_active_exam_sessions(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    limit: int = 6,
) -> list[dict[str, Any]]:
    owner_user_id, owner_client_key = _owner_scope(owner_user_id, owner_client_key)
    if not owner_user_id and not owner_client_key:
        return []

    stmt = (
        select(ExamSession, Exam.title)
        .outerjoin(Exam, Exam.id == ExamSession.exam_id)
        .where(ExamSession.completed_at.is_(None))
        .order_by(ExamSession.created_at.desc())
        .limit(min(max(int(limit), 1), 12))
    )
    stmt = _apply_owner_filter(stmt, ExamSession, owner_user_id, owner_client_key)
    rows = db.execute(stmt).all()

    items: list[dict[str, Any]] = []
    for session, exam_title in rows:
        progress_percent = round((max(int(session.current_index or 0), 0) / max(int(session.total_questions or 1), 1)) * 100.0, 2)
        items.append(
            {
                "id": session.id,
                "mode": "exam",
                "exam_id": session.exam_id,
                "exam_title": exam_title,
                "created_at": session.created_at.isoformat() if session.created_at else None,
                "current_index": int(session.current_index or 0),
                "answered_count": int((session.correct_count or 0) + (session.wrong_count or 0)),
                "total_questions": int(session.total_questions or 0),
                "progress_percent": progress_percent,
                "selection_strategy": session.selection_strategy or "standard",
            }
        )
    return items


def list_active_study_sessions(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    limit: int = 6,
) -> list[dict[str, Any]]:
    owner_user_id, owner_client_key = _owner_scope(owner_user_id, owner_client_key)
    if not owner_user_id and not owner_client_key:
        return []

    stmt = (
        select(StudySession, Exam.title)
        .outerjoin(Exam, Exam.id == StudySession.exam_id)
        .where(StudySession.completed_at.is_(None))
        .order_by(StudySession.created_at.desc())
        .limit(min(max(int(limit), 1), 12))
    )
    stmt = _apply_owner_filter(stmt, StudySession, owner_user_id, owner_client_key)
    rows = db.execute(stmt).all()

    items: list[dict[str, Any]] = []
    for session, exam_title in rows:
        progress_percent = round((max(int(session.answered_count or 0), 0) / max(int(session.total_questions or 1), 1)) * 100.0, 2)
        items.append(
            {
                "id": session.id,
                "mode": "study",
                "exam_id": session.exam_id,
                "exam_title": exam_title,
                "created_at": session.created_at.isoformat() if session.created_at else None,
                "current_index": int(session.current_index or 0),
                "answered_count": int(session.answered_count or 0),
                "total_questions": int(session.total_questions or 0),
                "progress_percent": progress_percent,
                "selection_strategy": session.selection_strategy or "standard",
            }
        )
    return items
