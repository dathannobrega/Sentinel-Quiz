"""Near-duplicate detection against the question bank and within a batch (PLANO §12.4).

The bank corpus includes ``personal_use`` questions (to catch reproduced dumps) but they
are never sent to the model. Candidates are pre-filtered by shared rare tokens, then
compared with SequenceMatcher (0.9, the import pipeline threshold).
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Question
from app.services.live_items import normalize_text_answer

THRESHOLD = 0.9
_TOKEN = re.compile(r"[a-z0-9à-ú]{4,}")
_CORPUS_CACHE: dict[str | None, tuple[int, list[tuple[str, str, set[str]]]]] = {}


def _norm(text: str) -> str:
    return normalize_text_answer(re.sub(r"\s+", " ", text or ""))


def _tokens(text: str) -> set[str]:
    return set(_TOKEN.findall(text))


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _norm(a), _norm(b), autojunk=False).ratio()


def _corpus(db: Session, certification: str | None) -> list[tuple[str, str, set[str]]]:
    stmt = select(Question.id, Question.prompt).where(Question.is_active.is_(True))
    if certification:
        stmt = stmt.where(Question.certification == certification)
    rows = db.execute(stmt).all()
    cached = _CORPUS_CACHE.get(certification)
    if cached and cached[0] == len(rows):
        return cached[1]
    corpus = [(qid, _norm(prompt), _tokens(_norm(prompt))) for qid, prompt in rows]
    if len(_CORPUS_CACHE) > 16:
        _CORPUS_CACHE.clear()
    _CORPUS_CACHE[certification] = (len(rows), corpus)
    return corpus


def bank_matches(db: Session, prompts: Iterable[str], *, certification: str | None) -> list[tuple[str, float] | None]:
    corpus = _corpus(db, certification)
    results: list[tuple[str, float] | None] = []
    for prompt in prompts:
        norm = _norm(prompt)
        tokens = _tokens(norm)
        best: tuple[str, float] | None = None
        for qid, text, other in corpus:
            if len(tokens & other) < max(2, len(tokens) // 3):
                continue
            ratio = SequenceMatcher(None, norm, text, autojunk=False).ratio()
            if ratio >= THRESHOLD and (best is None or ratio > best[1]):
                best = (qid, ratio)
        results.append(best)
    return results


def batch_duplicates(prompts: list[str]) -> set[int]:
    """Indexes that duplicate an earlier prompt of the same batch."""
    dupes: set[int] = set()
    for i, prompt in enumerate(prompts):
        for j in range(i):
            if j not in dupes and similarity(prompt, prompts[j]) >= THRESHOLD:
                dupes.add(i)
                break
    return dupes
