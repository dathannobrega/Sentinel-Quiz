"""Per-question study state (bookmarks/notes), study overview and device claim."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func, select  # noqa: F401
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import Question, ReviewQueueItem, StudySession, User, UserBookmark, UserNote
from app.services.auth import normalize_client_key
from app.services.owner_scope import require_owner_filters
from app.services.question_pool import active_question_clause
from app.services.question_pool import count_due_review_items as _count_due_review_items
from app.services.serialization import truncate_text


NOTE_MAX_LENGTH = 4000


RECENT_ITEM_LIMIT = 3


QUEUE_PREVIEW_LIMIT = 5


def _scope_label(owner_user_id: Optional[str], owner_client_key: Optional[str]) -> str:
    return "user" if owner_user_id else "device"


def _normalize_note_text(note_text: str | None) -> str | None:
    raw = str(note_text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not raw:
        return None
    if len(raw) > NOTE_MAX_LENGTH:
        raise ValueError(f"Note must be at most {NOTE_MAX_LENGTH} characters.")
    return raw


def _question_or_error(db: Session, question_id: str) -> Question:
    question = db.get(Question, question_id)
    if not question:
        raise ValueError("Question not found.")
    return question


def _state_query(db: Session, model, question_id: str, owner_user_id: Optional[str], owner_client_key: Optional[str]):
    stmt = select(model).where(model.question_id == question_id)
    stmt = require_owner_filters(stmt, model, owner_user_id, owner_client_key)
    return db.execute(stmt).scalar_one_or_none()


def _serialize_state(
    question_id: str,
    bookmark: UserBookmark | None,
    note: UserNote | None,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> dict[str, Any]:
    candidates = [item.updated_at for item in (bookmark, note) if item and item.updated_at]
    updated_at = max(candidates).isoformat() if candidates else None
    return {
        "question_id": question_id,
        "bookmarked": bool(bookmark),
        "note_text": note.note_text if note else None,
        "updated_at": updated_at,
        "scope": _scope_label(owner_user_id, owner_client_key),
    }


def get_question_state(
    db: Session,
    question_id: str,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> dict[str, Any]:
    _question_or_error(db, question_id)
    bookmark = _state_query(db, UserBookmark, question_id, owner_user_id, owner_client_key)
    note = _state_query(db, UserNote, question_id, owner_user_id, owner_client_key)
    return _serialize_state(question_id, bookmark, note, owner_user_id, owner_client_key)


def set_question_state(
    db: Session,
    question_id: str,
    *,
    bookmarked: bool,
    note_text: str | None = None,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> dict[str, Any]:
    _question_or_error(db, question_id)
    normalized_client_key = normalize_client_key(owner_client_key)
    normalized_note = _normalize_note_text(note_text)
    now = utcnow()

    bookmark = _state_query(db, UserBookmark, question_id, owner_user_id, normalized_client_key)
    note = _state_query(db, UserNote, question_id, owner_user_id, normalized_client_key)
    changed = False

    if bookmarked:
        if not bookmark:
            bookmark = UserBookmark(
                user_id=owner_user_id,
                client_key=None if owner_user_id else normalized_client_key,
                question_id=question_id,
                created_at=now,
                updated_at=now,
            )
            db.add(bookmark)
        else:
            bookmark.updated_at = now
        changed = True
    elif bookmark:
        db.delete(bookmark)
        bookmark = None
        changed = True

    if normalized_note:
        if not note:
            note = UserNote(
                user_id=owner_user_id,
                client_key=None if owner_user_id else normalized_client_key,
                question_id=question_id,
                note_text=normalized_note,
                created_at=now,
                updated_at=now,
            )
            db.add(note)
        else:
            note.note_text = normalized_note
            note.updated_at = now
        changed = True
    elif note:
        db.delete(note)
        note = None
        changed = True

    if changed:
        db.commit()

    return _serialize_state(question_id, bookmark, note, owner_user_id, normalized_client_key)


def _due_review_items_query(owner_user_id: Optional[str], owner_client_key: Optional[str]):
    stmt = (
        select(ReviewQueueItem.question_id, ReviewQueueItem.due_at, Question.prompt)
        .join(Question, Question.id == ReviewQueueItem.question_id)
        .where(active_question_clause())
        .order_by(ReviewQueueItem.due_at.asc())
    )
    return require_owner_filters(stmt, ReviewQueueItem, owner_user_id, owner_client_key)


def count_due_review_items(
    db: Session,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
    due_at_or_before: Optional[datetime] = None,
) -> int:
    """Due review items (active questions only); raises without an owner scope."""
    return _count_due_review_items(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        due_at_or_before=due_at_or_before,
        required=True,
    )


def build_study_overview(
    db: Session,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> dict[str, Any]:
    bookmark_count_stmt = select(func.count()).select_from(UserBookmark)
    bookmark_count_stmt = require_owner_filters(bookmark_count_stmt, UserBookmark, owner_user_id, owner_client_key)
    bookmark_count = int(db.execute(bookmark_count_stmt).scalar_one() or 0)

    note_count_stmt = select(func.count()).select_from(UserNote)
    note_count_stmt = require_owner_filters(note_count_stmt, UserNote, owner_user_id, owner_client_key)
    note_count = int(db.execute(note_count_stmt).scalar_one() or 0)

    recent_bookmarks_stmt = (
        select(UserBookmark.question_id, UserBookmark.updated_at, Question.prompt)
        .join(Question, Question.id == UserBookmark.question_id)
        .order_by(UserBookmark.updated_at.desc())
        .limit(RECENT_ITEM_LIMIT)
    )
    recent_bookmarks_stmt = require_owner_filters(recent_bookmarks_stmt, UserBookmark, owner_user_id, owner_client_key)
    recent_bookmarks = [
        {
            "question_id": question_id,
            "prompt": truncate_text(prompt, 120),
            "updated_at": updated_at.isoformat() if updated_at else None,
            "excerpt": None,
        }
        for question_id, updated_at, prompt in db.execute(recent_bookmarks_stmt).all()
    ]

    recent_notes_stmt = (
        select(UserNote.question_id, UserNote.updated_at, UserNote.note_text, Question.prompt)
        .join(Question, Question.id == UserNote.question_id)
        .order_by(UserNote.updated_at.desc())
        .limit(RECENT_ITEM_LIMIT)
    )
    recent_notes_stmt = require_owner_filters(recent_notes_stmt, UserNote, owner_user_id, owner_client_key)
    recent_notes = [
        {
            "question_id": question_id,
            "prompt": truncate_text(prompt, 120),
            "updated_at": updated_at.isoformat() if updated_at else None,
            "excerpt": truncate_text(note_text, 120),
        }
        for question_id, updated_at, note_text, prompt in db.execute(recent_notes_stmt).all()
    ]

    due_now = utcnow()
    due_review_count = count_due_review_items(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        due_at_or_before=due_now,
    )
    due_reviews_stmt = _due_review_items_query(owner_user_id, owner_client_key).limit(QUEUE_PREVIEW_LIMIT)
    due_reviews = []
    next_due_at = None
    for question_id, due_at, prompt in db.execute(due_reviews_stmt).all():
        if next_due_at is None and due_at:
            next_due_at = due_at.isoformat()
        if due_at and due_at > due_now:
            continue
        due_reviews.append({
            "question_id": question_id,
            "prompt": truncate_text(prompt, 120),
            "updated_at": due_at.isoformat() if due_at else None,
            "excerpt": "Revisao vencida" if due_at and due_at <= due_now else "Proxima revisao agendada",
        })

    return {
        "scope": _scope_label(owner_user_id, owner_client_key),
        "bookmark_count": bookmark_count,
        "note_count": note_count,
        "due_review_count": due_review_count,
        "next_due_at": next_due_at,
        "recent_bookmarks": recent_bookmarks,
        "recent_notes": recent_notes,
        "due_reviews": due_reviews,
    }


def _merge_note_text(existing_text: str, incoming_text: str) -> str:
    existing = _normalize_note_text(existing_text) or ""
    incoming = _normalize_note_text(incoming_text) or ""
    if not incoming:
        return existing
    if not existing:
        return incoming
    if incoming == existing or incoming in existing:
        return existing

    merged = f"{existing}\n\n[Nota importada do dispositivo]\n{incoming}"
    if len(merged) <= NOTE_MAX_LENGTH:
        return merged

    budget = max(NOTE_MAX_LENGTH - len(existing) - len("\n\n[Nota importada do dispositivo]\n"), 0)
    if budget <= 0:
        return existing[:NOTE_MAX_LENGTH]
    trimmed_incoming = incoming[:budget].rstrip()
    return f"{existing}\n\n[Nota importada do dispositivo]\n{trimmed_incoming}"


def claim_client_study_state(db: Session, *, user: User, client_key: str | None) -> dict[str, int]:
    normalized_client_key = normalize_client_key(client_key)
    if not normalized_client_key:
        return {"bookmarks": 0, "notes": 0, "study_sessions": 0, "review_items": 0}

    claimed_bookmarks = 0
    claimed_notes = 0
    claimed_study_sessions = 0
    claimed_review_items = 0
    changed = False

    bookmark_rows = db.execute(
        select(UserBookmark).where(
            UserBookmark.user_id.is_(None),
            UserBookmark.client_key == normalized_client_key,
        )
    ).scalars().all()
    for bookmark in bookmark_rows:
        target = db.execute(
            select(UserBookmark).where(
                UserBookmark.user_id == user.id,
                UserBookmark.question_id == bookmark.question_id,
            )
        ).scalar_one_or_none()
        if target:
            db.delete(bookmark)
            changed = True
            continue
        bookmark.user_id = user.id
        bookmark.client_key = None
        bookmark.updated_at = utcnow()
        claimed_bookmarks += 1
        changed = True

    note_rows = db.execute(
        select(UserNote).where(
            UserNote.user_id.is_(None),
            UserNote.client_key == normalized_client_key,
        )
    ).scalars().all()
    for note in note_rows:
        target = db.execute(
            select(UserNote).where(
                UserNote.user_id == user.id,
                UserNote.question_id == note.question_id,
            )
        ).scalar_one_or_none()
        if target:
            target.note_text = _merge_note_text(target.note_text, note.note_text)
            target.updated_at = max(target.updated_at, note.updated_at) if target.updated_at and note.updated_at else utcnow()
            db.delete(note)
            changed = True
            continue
        note.user_id = user.id
        note.client_key = None
        note.updated_at = utcnow()
        claimed_notes += 1
        changed = True

    session_rows = db.execute(
        select(StudySession).where(
            StudySession.user_id.is_(None),
            StudySession.client_key == normalized_client_key,
        )
    ).scalars().all()
    for session in session_rows:
        session.user_id = user.id
        session.client_key = None
        claimed_study_sessions += 1
        changed = True

    queue_rows = db.execute(
        select(ReviewQueueItem).where(
            ReviewQueueItem.user_id.is_(None),
            ReviewQueueItem.client_key == normalized_client_key,
        )
    ).scalars().all()
    for item in queue_rows:
        target = db.execute(
            select(ReviewQueueItem).where(
                ReviewQueueItem.user_id == user.id,
                ReviewQueueItem.question_id == item.question_id,
            )
        ).scalar_one_or_none()
        if target:
            if item.due_at < target.due_at:
                target.due_at = item.due_at
                target.interval_days = item.interval_days
                target.last_outcome = item.last_outcome
                target.confidence_level = item.confidence_level
                target.last_attempt_at = item.last_attempt_at
                target.updated_at = utcnow()
            db.delete(item)
            changed = True
            continue
        item.user_id = user.id
        item.client_key = None
        item.updated_at = utcnow()
        claimed_review_items += 1
        changed = True

    if changed:
        db.commit()

    return {
        "bookmarks": claimed_bookmarks,
        "notes": claimed_notes,
        "study_sessions": claimed_study_sessions,
        "review_items": claimed_review_items,
    }
