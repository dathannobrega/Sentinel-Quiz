"""Sentinel Reader (docs/reading/CONTRATO-INCREMENTO-1.md): library, reading order, progress and attempts.

Everything textual comes straight from the normalized corpus (``material_corpus``), so no copy of
the licensed books is stored. A *block* (one paragraph of a section, identified by
``(part_id, block_index)``) is the unit of synthesis and of shadowing.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import ReadingAttempt, ReadingProgress, User
from app.services.material_corpus import CorpusBook, CorpusSection, MaterialCorpus, get_corpus
from app.services.study_links import section_detail

READABLE_KINDS = frozenset({"teach", "summary"})
MIN_READABLE_WORDS = 20
WORDS_PER_MINUTE = 150
MAX_ATTEMPT_LIMIT = 100

_EXT_RE = re.compile(r"\.(x?html?|json)$", re.IGNORECASE)


def chapter_stem(chapter_file: str) -> str:
    """``c04.xhtml`` -> ``c04`` (the public chapter id; the corpus keeps the file name)."""
    return _EXT_RE.sub("", str(chapter_file or ""))


def minutes_for(words: int) -> int:
    return int(math.ceil(max(int(words), 0) / WORDS_PER_MINUTE)) if words else 0


def is_readable(section: CorpusSection) -> bool:
    return section.kind in READABLE_KINDS and section.word_count >= MIN_READABLE_WORDS


def readable_sections(corpus: MaterialCorpus, book: CorpusBook) -> list[CorpusSection]:
    """Reading order of a book: document order, teaching text only."""
    out: list[CorpusSection] = []
    for section_id in book.section_ids:
        section = corpus.get(section_id)
        if section is not None and is_readable(section):
            out.append(section)
    return out


def _book_words(sections: list[CorpusSection]) -> int:
    return sum(section.word_count for section in sections)


def _chapters(sections: list[CorpusSection]) -> list[dict[str, Any]]:
    chapters: dict[str, dict[str, Any]] = {}
    for section in sections:
        stem = chapter_stem(section.chapter_file)
        entry = chapters.setdefault(
            stem,
            {"file": stem, "index": section.chapter_index, "title": section.chapter_title, "sections": 0, "words": 0},
        )
        entry["sections"] += 1
        entry["words"] += section.word_count
    result = sorted(chapters.values(), key=lambda item: (item["index"], item["file"]))
    for entry in result:
        entry["minutes"] = minutes_for(entry["words"])
    return result


def _progress_rows(db: Session, user: User) -> dict[str, ReadingProgress]:
    rows = db.execute(select(ReadingProgress).where(ReadingProgress.user_id == user.id)).scalars().all()
    return {row.book_slug: row for row in rows}


def _position(sections: list[CorpusSection], section_id: str) -> int:
    for index, section in enumerate(sections):
        if section.id == section_id:
            return index
    return -1


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def serialize_progress(row: ReadingProgress, corpus: MaterialCorpus | None) -> dict[str, Any]:
    section = corpus.get(row.section_id) if corpus else None
    book = corpus.books.get(row.book_slug) if corpus else None
    percent = None
    if corpus is not None and book is not None:
        order = readable_sections(corpus, book)
        index = _position(order, row.section_id)
        if index >= 0 and order:
            percent = round(index / len(order) * 100, 1)
    return {
        "book_slug": row.book_slug,
        "book_title": book.title if book else None,
        "section_id": row.section_id,
        "section_title": section.title if section else None,
        "part_id": row.part_id,
        "block_index": row.block_index,
        "mode": row.mode,
        "percent": percent,
        "words_read": row.words_read,
        "seconds_listened": row.seconds_listened,
        "updated_at": _iso(row.updated_at),
    }


# ---------------------------------------------------------------------------- library
def build_library(db: Session, user: User) -> dict[str, Any]:
    corpus = get_corpus()
    if corpus is None:
        return {"books": []}
    progress = _progress_rows(db, user)
    books: list[dict[str, Any]] = []
    for book in corpus.books.values():
        sections = readable_sections(corpus, book)
        if not sections:
            continue
        words = _book_words(sections)
        row = progress.get(book.slug)
        books.append({
            "slug": book.slug,
            "title": book.title,
            "certification": book.certification,
            "words": words,
            "minutes": minutes_for(words),
            "sections": len(sections),
            "chapters": _chapters(sections),
            "progress": serialize_progress(row, corpus) if row else None,
        })
    books.sort(key=lambda item: (item["certification"], item["title"]))
    return {"books": books}


def build_chapter(db: Session, user: User, slug: str, chapter_file: str) -> dict[str, Any] | None:
    corpus = get_corpus()
    book = corpus.books.get(slug) if corpus else None
    if corpus is None or book is None:
        return None
    stem = chapter_stem(chapter_file)
    order = readable_sections(corpus, book)
    in_chapter = [section for section in order if chapter_stem(section.chapter_file) == stem]
    if not in_chapter:
        return None
    row = _progress_rows(db, user).get(slug)
    current = _position(order, row.section_id) if row else -1
    words = _book_words(in_chapter)
    sections = []
    for section in in_chapter:
        index = _position(order, section.id)
        sections.append({
            "id": section.id,
            "title": section.title,
            "level": section.level,
            "kind": section.kind,
            "words": section.word_count,
            "minutes": minutes_for(section.word_count),
            "parent_id": section.parent_id,
            "completed": bool(row) and 0 <= index < current,
        })
    first = in_chapter[0]
    return {
        "book": {"slug": book.slug, "title": book.title, "certification": book.certification},
        "chapter": {"file": stem, "index": first.chapter_index, "title": first.chapter_title, "words": words, "minutes": minutes_for(words)},
        "sections": sections,
    }


def build_section(db: Session, user: User, section_id: str) -> dict[str, Any] | None:
    corpus = get_corpus()
    section = corpus.get(section_id) if corpus else None
    if corpus is None or section is None:
        return None
    detail = section_detail(section_id)
    if detail is None:
        return None
    book = corpus.books.get(section.book_slug)
    order = readable_sections(corpus, book) if book else []
    index = _position(order, section.id)
    row = _progress_rows(db, user).get(section.book_slug)
    progress = None
    if row is not None and row.section_id == section.id:
        progress = {"part_id": row.part_id, "block_index": row.block_index, "mode": row.mode, "updated_at": _iso(row.updated_at)}
    detail.update({
        "book_slug": section.book_slug,
        "chapter_file": chapter_stem(section.chapter_file),
        "chapter_index": section.chapter_index,
        "position": {"index": index, "total": len(order)},
        "progress": progress,
    })
    return detail


# ---------------------------------------------------------------------------- blocks
def resolve_block(section_id: str, part_id: str, block_index: int) -> tuple[CorpusSection, CorpusSection, str] | None:
    """``(section, part, text)`` for a block shown by the reader; ``None`` when it does not exist.

    The part must be the section itself or one of its descendants (what ``section_detail`` renders),
    so a client cannot synthesize or score arbitrary corpus text under another section's id.
    """
    corpus = get_corpus()
    if corpus is None:
        return None
    section = corpus.get(section_id)
    part = corpus.get(part_id)
    if section is None or part is None:
        return None
    cursor: CorpusSection | None = part
    while cursor is not None and cursor.id != section.id:
        cursor = corpus.get(cursor.parent_id) if cursor.parent_id else None
    if cursor is None:
        return None
    if block_index < 0 or block_index >= len(part.blocks):
        return None
    text = part.blocks[block_index].text.strip()
    if not text:
        return None
    return section, part, text


# ---------------------------------------------------------------------------- progress
def upsert_progress(db: Session, user: User, payload: dict[str, Any]) -> ReadingProgress:
    row = db.execute(
        select(ReadingProgress).where(ReadingProgress.user_id == user.id, ReadingProgress.book_slug == payload["book_slug"])
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = ReadingProgress(user_id=user.id, book_slug=payload["book_slug"], created_at=now)
        db.add(row)
    row.section_id = payload["section_id"]
    row.part_id = payload["part_id"]
    row.block_index = int(payload.get("block_index") or 0)
    row.mode = str(payload.get("mode") or "listen")
    row.words_read = int(row.words_read or 0) + int(payload.get("words_read") or 0)
    row.seconds_listened = int(row.seconds_listened or 0) + int(payload.get("seconds_listened") or 0)
    row.updated_at = now
    db.commit()
    db.refresh(row)
    return row


def list_progress(db: Session, user: User) -> list[dict[str, Any]]:
    corpus = get_corpus()
    rows = db.execute(
        select(ReadingProgress).where(ReadingProgress.user_id == user.id).order_by(ReadingProgress.updated_at.desc())
    ).scalars().all()
    return [serialize_progress(row, corpus) for row in rows]


# ---------------------------------------------------------------------------- attempts
def _today_start(now: datetime | None = None) -> datetime:
    now = now or utcnow()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def attempts_today(db: Session, user: User) -> int:
    value = db.execute(
        select(func.count(ReadingAttempt.id)).where(ReadingAttempt.user_id == user.id, ReadingAttempt.created_at >= _today_start())
    ).scalar()
    return int(value or 0)


def record_attempt(
    db: Session, user: User, *, section: CorpusSection, part_id: str, block_index: int, assessment: dict[str, Any]
) -> ReadingAttempt:
    scores = dict(assessment.get("scores") or {})
    metrics = dict(assessment.get("metrics") or {})
    kept = {
        key: assessment.get(key)
        for key in ("transcript", "words", "extras", "scores", "metrics", "tips", "speech_seconds", "duration_seconds")
    }
    row = ReadingAttempt(
        user_id=user.id,
        book_slug=section.book_slug,
        section_id=section.id,
        part_id=part_id,
        block_index=int(block_index),
        reference_words=int(metrics.get("reference_words") or len(assessment.get("words") or [])),
        accuracy=float(scores.get("accuracy") or 0.0),
        completeness=float(scores.get("completeness") or 0.0),
        fluency=float(scores.get("fluency") or 0.0),
        overall=float(scores.get("overall") or 0.0),
        wpm=_float_or_none(metrics.get("wpm")),
        duration_seconds=_float_or_none(assessment.get("duration_seconds")),
        engine=str(assessment.get("engine") or "")[:32] or None,
        model=str(assessment.get("model") or "")[:64] or None,
        result_json=json.dumps(kept, ensure_ascii=False),
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def serialize_attempt(row: ReadingAttempt) -> dict[str, Any]:
    return {
        "id": row.id,
        "section_id": row.section_id,
        "part_id": row.part_id,
        "block_index": row.block_index,
        "overall": round(row.overall, 3),
        "accuracy": round(row.accuracy, 3),
        "completeness": round(row.completeness, 3),
        "fluency": round(row.fluency, 3),
        "wpm": round(row.wpm, 1) if row.wpm is not None else None,
        "created_at": _iso(row.created_at),
    }


def list_attempts(db: Session, user: User, section_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), MAX_ATTEMPT_LIMIT))
    rows = db.execute(
        select(ReadingAttempt)
        .where(ReadingAttempt.user_id == user.id, ReadingAttempt.section_id == section_id)
        .order_by(ReadingAttempt.created_at.desc())
        .limit(limit)
    ).scalars().all()
    return [serialize_attempt(row) for row in rows]


def block_summary(db: Session, user: User, section_id: str, part_id: str, block_index: int) -> dict[str, Any]:
    best, count = db.execute(
        select(func.max(ReadingAttempt.overall), func.count(ReadingAttempt.id)).where(
            ReadingAttempt.user_id == user.id,
            ReadingAttempt.section_id == section_id,
            ReadingAttempt.part_id == part_id,
            ReadingAttempt.block_index == int(block_index),
        )
    ).one()
    return {"best_overall": round(float(best), 3) if best is not None else None, "attempts_for_block": int(count or 0)}


def build_stats(db: Session, user: User) -> dict[str, Any]:
    now = utcnow()
    totals = db.execute(
        select(func.count(ReadingAttempt.id), func.avg(ReadingAttempt.overall), func.max(ReadingAttempt.overall)).where(
            ReadingAttempt.user_id == user.id
        )
    ).one()
    progress = db.execute(
        select(func.coalesce(func.sum(ReadingProgress.words_read), 0), func.coalesce(func.sum(ReadingProgress.seconds_listened), 0)).where(
            ReadingProgress.user_id == user.id
        )
    ).one()
    since_30 = _today_start(now) - timedelta(days=29)
    rows = db.execute(
        select(ReadingAttempt.created_at, ReadingAttempt.overall).where(
            ReadingAttempt.user_id == user.id, ReadingAttempt.created_at >= since_30
        )
    ).all()
    by_day: dict[str, list[float]] = {}
    for created_at, overall in rows:
        stamp = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        by_day.setdefault(stamp.astimezone(timezone.utc).date().isoformat(), []).append(float(overall))
    recent = []
    for offset in range(6, -1, -1):
        day = (_today_start(now) - timedelta(days=offset)).date().isoformat()
        values = by_day.get(day, [])
        recent.append({"date": day, "attempts": len(values), "avg_overall": round(sum(values) / len(values), 3) if values else None})
    count = int(totals[0] or 0)
    return {
        "attempts": count,
        "avg_overall": round(float(totals[1]), 3) if totals[1] is not None else None,
        "best_overall": round(float(totals[2]), 3) if totals[2] is not None else None,
        "words_read": int(progress[0] or 0),
        "seconds_listened": int(progress[1] or 0),
        "active_days_30": len(by_day),
        "recent": recent,
    }
