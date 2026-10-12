"""Sentinel Reader "Seus dados" (docs/reading/CONTRATO-INCREMENTO-2.md §3.5): export and erase.

Everything personal of the reader is covered: progress, attempts (scores and per-word results;
recordings are never stored), word cards and comprehension answers. The shared caches (glossary,
section quizzes) hold no personal data and stay.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import ReadingAiCall, ReadingAttempt, ReadingProgress, ReadingQuizAnswer, ReadingSectionQuiz, ReadingWord, User
from app.services import reading, reading_words


def export_user_data(db: Session, user: User) -> dict[str, Any]:
    attempts = []
    for row in db.execute(
        select(ReadingAttempt).where(ReadingAttempt.user_id == user.id).order_by(ReadingAttempt.created_at.asc())
    ).scalars():
        try:
            result = json.loads(row.result_json or "{}")
        except ValueError:
            result = {}
        attempts.append({**reading.serialize_attempt(row), "book_slug": row.book_slug, "engine": row.engine,
                         "model": row.model, "duration_seconds": row.duration_seconds, "result": result})
    words = [
        reading_words.serialize_card(card)
        for card in db.execute(select(ReadingWord).where(ReadingWord.user_id == user.id).order_by(ReadingWord.created_at.asc())).scalars()
    ]
    answers = [
        {"quiz_id": answer.quiz_id, "section_id": section_id, "question_index": answer.question_index,
         "choice": answer.choice, "correct": bool(answer.correct), "created_at": reading._iso(answer.created_at)}
        for answer, section_id in db.execute(
            select(ReadingQuizAnswer, ReadingSectionQuiz.section_id)
            .join(ReadingSectionQuiz, ReadingSectionQuiz.id == ReadingQuizAnswer.quiz_id)
            .where(ReadingQuizAnswer.user_id == user.id)
            .order_by(ReadingQuizAnswer.created_at.asc())
        ).all()
    ]
    return {
        "exported_at": reading._iso(utcnow()),
        "progress": reading.list_progress(db, user),
        "attempts": attempts,
        "words": words,
        "quiz_answers": answers,
    }


def delete_user_data(db: Session, user: User) -> dict[str, int]:
    """Erase the reader data of ``user``.

    The usage ledger keeps only today's rows (kind + timestamp, no content): erasing them would
    reset the daily AI quota; older rows go.
    """
    counts = {}
    for key, model in (
        ("progress", ReadingProgress), ("attempts", ReadingAttempt), ("words", ReadingWord), ("quiz_answers", ReadingQuizAnswer),
    ):
        result = db.execute(delete(model).where(model.user_id == user.id))
        counts[key] = int(result.rowcount or 0)
    db.execute(delete(ReadingAiCall).where(ReadingAiCall.user_id == user.id, ReadingAiCall.created_at < reading._today_start()))
    db.commit()
    return counts
