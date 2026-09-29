"""Small question/option lookups shared by the exam and study services (M-C6).

Single implementations of what used to be duplicated as ``_option_rows``,
``_get_correct_keys``/``_correct_keys_for_question`` and ``_published_version_id``
in ``quiz.py``, ``exam_runtime.py`` and ``study_session.py``.
"""
from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Option, QuestionBank


def option_rows(db: Session, question_id: str) -> list[dict[str, Any]]:
    """Options of one question ordered by (original) key."""
    rows = db.execute(
        select(Option.key, Option.text, Option.is_correct)
        .where(Option.question_id == question_id)
        .order_by(Option.key.asc())
    ).all()
    return [{"key": key, "text": text, "is_correct": bool(is_correct)} for key, text, is_correct in rows]


def correct_option_keys(db: Session, question_id: str) -> list[str]:
    """Original keys of the correct options, sorted."""
    rows = db.execute(
        select(Option.key)
        .where(Option.question_id == question_id, Option.is_correct.is_(True))
        .order_by(Option.key.asc())
    ).all()
    return [key for (key,) in rows]


def published_version_id(db: Session, question_id: str) -> int | None:
    bank = db.get(QuestionBank, question_id)
    return bank.published_version_id if bank else None


def published_version_ids(db: Session, question_ids: Iterable[str]) -> dict[str, int | None]:
    ids = sorted({str(item) for item in question_ids if item})
    if not ids:
        return {}
    return {
        stable_id: version_id
        for stable_id, version_id in db.execute(
            select(QuestionBank.stable_question_id, QuestionBank.published_version_id).where(
                QuestionBank.stable_question_id.in_(ids)
            )
        ).all()
    }
