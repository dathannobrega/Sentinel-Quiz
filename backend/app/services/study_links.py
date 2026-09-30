"""Runtime side of "study the exact section behind a mistake".

app/data/study_links.json (built offline by scripts/build_study_links.py, ids only) maps each
question to the book sections that explain it and each wrong option to the section that defines
that option's concept. Here those ids are resolved against the normalized corpus
(material_corpus) to produce short, attributed excerpts for the answer feedback, the section
reader and the "sections you miss most" view. Without mounted books everything returns empty and
the existing references keep working.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.models import Question
from app.services.material_corpus import CorpusSection, MaterialCorpus, get_corpus

LINKS_PATH = Path(__file__).resolve().parents[1] / "data" / "study_links.json"
EXCERPT_WORDS = 90
SECTION_READER_MAX_WORDS = 3000
MAX_STUDY_SECTIONS = 3

_links_lock = threading.Lock()
_links_cache: tuple[float, dict[str, Any]] | None = None


def load_links(path: Path | None = None) -> dict[str, Any]:
    global _links_cache
    path = path or LINKS_PATH  # resolved at call time (tests and tools may repoint LINKS_PATH)
    try:
        stamp = path.stat().st_mtime
    except OSError:
        return {}
    with _links_lock:
        if _links_cache and _links_cache[0] == stamp:
            return _links_cache[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8")).get("questions", {})
    except (OSError, ValueError):
        data = {}
    with _links_lock:
        _links_cache = (stamp, data)
    return data


def clear_links_cache() -> None:
    global _links_cache
    with _links_lock:
        _links_cache = None


def question_links(question_id: str) -> dict[str, Any]:
    return load_links().get(str(question_id), {})


def primary_section_ids(question_id: str) -> list[str]:
    return [str(entry[0]) for entry in question_links(question_id).get("sections", []) if entry]


def option_section_id(question_id: str, original_key: str) -> str | None:
    entry = question_links(question_id).get("options", {}).get(str(original_key))
    return str(entry[0]) if entry else None


def _excerpt(corpus: MaterialCorpus, section: CorpusSection, words: int = EXCERPT_WORDS) -> tuple[str, bool]:
    """First ~words words of the section; sections that are mostly a heading borrow from their
    first subsection so the excerpt always says something."""
    text = section.text
    if len(text.split()) < 40:
        for child_id in section.child_ids:
            child = corpus.get(child_id)
            if child is not None and child.text:
                text = f"{text} {child.text}".strip()
                break
    tokens = text.split()
    if len(tokens) <= words:
        return text, False
    cut = " ".join(tokens[:words])
    last_stop = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    if last_stop > len(cut) * 0.6:
        cut = cut[: last_stop + 1]
    return cut, True


def describe_section(corpus: MaterialCorpus, section: CorpusSection, *, reason: str, option_key: str | None = None) -> dict[str, Any]:
    excerpt, truncated = _excerpt(corpus, section)
    return {
        "section_id": section.id,
        "book_title": section.book_title,
        "chapter_title": section.chapter_title,
        "title": section.title,
        "breadcrumb": list(section.path[-3:]),
        "page_start": section.page_start,
        "page_end": section.page_end,
        "excerpt": excerpt,
        "excerpt_truncated": truncated,
        "reason": reason,
        "option_key": option_key,
    }


def _cited_section(db: Session, corpus: MaterialCorpus, question_id: str) -> CorpusSection | None:
    question = db.get(Question, question_id)
    if question is None or not question.citations_json:
        return None
    try:
        citations = json.loads(question.citations_json)
    except ValueError:
        return None
    for citation in citations if isinstance(citations, list) else []:
        if isinstance(citation, dict):
            section = corpus.resolve_locator(citation.get("material_path"), citation.get("locator"))
            if section is not None:
                return section
    return None


def build_study_sections(
    db: Session,
    question_id: str,
    *,
    selected_original: Iterable[str] = (),
    correct_original: Iterable[str] = (),
    is_correct: bool | None,
    to_display: Callable[[list[str]], list[str]] | None = None,
    limit: int = MAX_STUDY_SECTIONS,
) -> list[dict[str, Any]]:
    """Sections to study after answering. Wrong answer: first the section behind the option the
    student picked ("why this choice is wrong"), then the sections that explain the question."""
    corpus = get_corpus()
    if corpus is None:
        return []
    correct = {str(key) for key in correct_original}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(section: CorpusSection | None, reason: str, option_key: str | None = None) -> None:
        if section is None or section.id in seen or len(out) >= limit:
            return
        seen.add(section.id)
        out.append(describe_section(corpus, section, reason=reason, option_key=option_key))

    if is_correct is False:
        for original_key in selected_original:
            if str(original_key) in correct:
                continue
            section_id = option_section_id(question_id, str(original_key))
            if section_id:
                display = to_display([str(original_key)])[0] if to_display else str(original_key)
                add(corpus.get(section_id), "your_choice", display)
                break  # one "why your choice is wrong" is enough; the rest explain the question

    explanation_ids = primary_section_ids(question_id)
    if explanation_ids:
        for section_id in explanation_ids:  # add() stops at the limit
            add(corpus.get(section_id), "explanation")
    else:
        add(_cited_section(db, corpus, question_id), "explanation")
    return out


def section_detail(section_id: str, *, max_words: int = SECTION_READER_MAX_WORDS) -> dict[str, Any] | None:
    """Section plus its subsections (reading order) for the reader, with navigation."""
    corpus = get_corpus()
    section = corpus.get(section_id) if corpus else None
    if corpus is None or section is None:
        return None

    parts: list[dict[str, Any]] = []
    budget = max_words
    truncated = False

    def walk(current: CorpusSection, depth: int) -> None:
        nonlocal budget, truncated
        if budget <= 0:
            truncated = True
            return
        blocks = []
        for block in current.blocks:
            if budget <= 0:
                truncated = True
                break
            blocks.append({"text": block.text, "label": block.label})
            budget -= len(block.text.split())
        parts.append({"id": current.id, "title": current.title, "depth": depth, "blocks": blocks})
        for child_id in current.child_ids:
            child = corpus.get(child_id)
            if child is not None:
                walk(child, depth + 1)

    walk(section, 0)

    book = corpus.books.get(section.book_slug)
    order = book.section_ids if book else []
    position = order.index(section.id) if section.id in order else -1

    def neighbour(step: int) -> dict[str, str] | None:
        index = position + step
        while 0 <= index < len(order):
            candidate = corpus.get(order[index])
            if candidate is not None and candidate.level <= section.level and candidate.kind in ("teach", "summary"):
                return {"id": candidate.id, "title": candidate.title}
            index += step
        return None

    parent = corpus.get(section.parent_id) if section.parent_id else None
    return {
        "section_id": section.id,
        "book_title": section.book_title,
        "certification": section.certification,
        "chapter_title": section.chapter_title,
        "title": section.title,
        "breadcrumb": list(section.path),
        "page_start": section.page_start,
        "page_end": section.page_end,
        "objectives": list(section.objectives),
        "parts": parts,
        "truncated": truncated,
        "parent": {"id": parent.id, "title": parent.title} if parent else None,
        "previous": neighbour(-1) if position >= 0 else None,
        "next": neighbour(1) if position >= 0 else None,
    }


def section_summary(section_id: str) -> dict[str, Any] | None:
    corpus = get_corpus()
    section = corpus.get(section_id) if corpus else None
    if corpus is None or section is None:
        return None
    return describe_section(corpus, section, reason="explanation")


def _subtree_ids(corpus: MaterialCorpus, section_id: str) -> set[str]:
    seen: set[str] = set()
    pending = [section_id]
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        node = corpus.get(current)
        if node is not None:
            pending.extend(node.child_ids)
    return seen


def questions_for_section(section_id: str) -> list[str]:
    """Questions whose explanation lives in this section or its subsections ("practice this section")."""
    corpus = get_corpus()
    if corpus is None or corpus.get(section_id) is None:
        return []
    subtree = _subtree_ids(corpus, section_id)
    return [
        question_id
        for question_id, entry in load_links().items()
        if any(item and item[0] in subtree for item in entry.get("sections", []))
    ]


def weak_sections(db: Session, *, owner_user_id: str | None, owner_client_key: str | None, limit: int = 8) -> list[dict[str, Any]]:
    """Sections behind the owner's mistakes, most urgent first: questions still answered wrong,
    then total mistakes, then recency. Built from user_question_progress (no extra state)."""
    from sqlalchemy import select

    from app.models import UserQuestionProgress
    from app.services.owner_scope import require_owner_filters

    corpus = get_corpus()
    if corpus is None:
        return []
    stmt = select(
        UserQuestionProgress.question_id,
        UserQuestionProgress.wrong_count,
        UserQuestionProgress.last_is_correct,
        UserQuestionProgress.last_seen_at,
    ).where(UserQuestionProgress.wrong_count > 0)
    stmt = require_owner_filters(stmt, UserQuestionProgress, owner_user_id, owner_client_key)

    buckets: dict[str, dict[str, Any]] = {}
    for question_id, wrong_count, last_is_correct, last_seen_at in db.execute(stmt):
        section_ids = primary_section_ids(question_id)
        if not section_ids or corpus.get(section_ids[0]) is None:
            continue
        bucket = buckets.setdefault(
            section_ids[0], {"mistakes": 0, "open_questions": 0, "questions": set(), "last_mistake_at": None}
        )
        bucket["mistakes"] += int(wrong_count or 0)
        bucket["questions"].add(question_id)
        if not last_is_correct:
            bucket["open_questions"] += 1
        if last_seen_at and (bucket["last_mistake_at"] is None or last_seen_at > bucket["last_mistake_at"]):
            bucket["last_mistake_at"] = last_seen_at

    ranked = sorted(
        buckets.items(),
        key=lambda item: (item[1]["open_questions"], item[1]["mistakes"], item[1]["last_mistake_at"] or 0),
        reverse=True,
    )
    out: list[dict[str, Any]] = []
    for section_id, bucket in ranked[:limit]:
        section = corpus.get(section_id)
        out.append(
            {
                **describe_section(corpus, section, reason="explanation"),
                "mistakes": bucket["mistakes"],
                "open_questions": bucket["open_questions"],
                "missed_questions": len(bucket["questions"]),
                "practice_questions": len(questions_for_section(section_id)),
                "last_mistake_at": bucket["last_mistake_at"].isoformat() if bucket["last_mistake_at"] else None,
            }
        )
    return out


def tutor_grounding(question_id: str, *, max_chars: int = 1500) -> str | None:
    """Top explanatory section text for the AI tutor, attributed to its book."""
    corpus = get_corpus()
    if corpus is None:
        return None
    for section_id in primary_section_ids(question_id):
        section = corpus.get(section_id)
        if section is None:
            continue
        text, _ = _excerpt(corpus, section, words=260)
        return f"{section.book_title} — {' > '.join(section.path[-3:])}:\n{text}"[:max_chars]
    return None
