"""Sentinel Reader words (docs/reading/CONTRATO-INCREMENTO-2.md §3.2): spaced-repetition cards.

Cards are born from assessments (words read badly), from the glossary or by hand, always from
corpus text resolved on the server (a client names a character range of a block, never a word).
Scheduling is a simplified SM-2; a card is *due* when ``due_at <= now`` and *learned* once its
interval reaches 21 days.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import as_utc, utcnow
from app.core.errors import api_error
from app.models import READING_WORD_KINDS, ReadingWord, User
from app.services import reading
from app.services.material_corpus import CorpusSection, sentence_spans

DEFAULT_EASE = 2.5
MIN_EASE = 1.3
AGAIN_DELAY = timedelta(minutes=10)
LEARNED_DAYS = 21.0
MAX_AUTO_CARDS = 8           # new/lapsed cards per assessment
WEAK_PHONEME_THRESHOLD = 0.6  # a `weak` word below this becomes a card
GOOD_PHONEME_THRESHOLD = 0.8  # an `ok` word at/above this reviews a due card as "good"
CONTEXT_MAX = 400
WORD_MAX = 64
IPA_MAX = 128
MAX_LIST_LIMIT = 200

# A word starts and ends with a letter/digit and may contain apostrophes and hyphens inside
# ("organization's", "Wi-Fi"). Pure numbers are not words for the deck or the glossary.
_WORD_TOKEN = re.compile(r"[^\W_](?:[\w'’-]*[^\W_])?", re.UNICODE)
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def normalize_word(word: str) -> str:
    """Key of a card / glossary entry: NFKC, lowercase, typographic apostrophe folded."""
    value = unicodedata.normalize("NFKC", str(word or "")).lower().replace("’", "'").replace("‘", "'")
    value = re.sub(r"[^\w'-]", "", value).strip("'-")
    return value[:WORD_MAX]


# ---------------------------------------------------------------------------- locating words
@dataclass(frozen=True)
class WordSpot:
    section: CorpusSection
    part_id: str
    block_index: int
    text: str        # the block text
    start: int       # word offsets in the block
    end: int
    display: str
    norm: str
    context: str     # the sentence containing the word (<= CONTEXT_MAX chars)


def expand_word(text: str, char_start: int, char_end: int) -> tuple[int, int] | None:
    """The whole word overlapping ``[char_start, char_end)`` (the first one, if several)."""
    if char_start < 0 or char_end <= char_start or char_start >= len(text):
        return None
    char_end = min(char_end, len(text))
    for match in _WORD_TOKEN.finditer(text):
        if match.end() <= char_start:
            continue
        if match.start() >= char_end:
            return None
        if _LETTER.search(match.group(0)):
            return match.start(), match.end()
    return None


def context_for(text: str, start: int, end: int, limit: int = CONTEXT_MAX) -> str:
    """The sentence holding ``text[start:end]``, trimmed to ``limit`` chars around the word."""
    sentence = (0, len(text))
    for span in sentence_spans(text):
        if span[0] <= start < span[1]:
            sentence = span
            break
    s_start, s_end = sentence
    if s_end - s_start <= limit:
        return text[s_start:s_end].strip()
    half = max((limit - (end - start)) // 2, 0)
    w_start = max(s_start, start - half)
    w_end = min(s_end, w_start + limit)
    w_start = max(s_start, w_end - limit)
    window = text[w_start:w_end]
    # Do not cut words in half at the edges.
    if w_start > s_start and " " in window:
        window = window[window.index(" ") + 1:]
    if w_end < s_end and " " in window:
        window = window[: window.rindex(" ")]
    return window.strip()[:limit]


def locate_word(section_id: str, part_id: str, block_index: int, char_start: int, char_end: int) -> WordSpot:
    resolved = reading.resolve_block(section_id, part_id, block_index)
    if resolved is None:
        raise api_error(404, "block_not_found", "Block not found.")
    section, _part, text = resolved
    span = expand_word(text, char_start, char_end)
    if span is None:
        raise api_error(400, "word_invalid", "No word at that position.")
    start, end = span
    display = text[start:end][:WORD_MAX]
    norm = normalize_word(display)
    if not norm:
        raise api_error(400, "word_invalid", "No word at that position.")
    return WordSpot(
        section=section, part_id=part_id, block_index=block_index, text=text, start=start, end=end,
        display=display, norm=norm, context=context_for(text, start, end),
    )


# ---------------------------------------------------------------------------- scheduling
def is_due(card: ReadingWord, now: datetime | None = None) -> bool:
    return as_utc(card.due_at) <= (now or utcnow())


def schedule(card: ReadingWord, grade: str, *, now: datetime | None = None, score: float | None = None) -> ReadingWord:
    """Simplified SM-2 (contract §3.2).

    - again: lapses+1, reps=0, due in 10 minutes, ease −0.2 (min 1.3);
    - hard: interval max(1, i·1.2) days, ease −0.15;
    - good: reps+1, interval 1, then 3, then i·ease;
    - easy: interval i·ease·1.3, ease +0.15 (reps+1 too, so a following "good" never shrinks
      the interval; a brand-new card counts i as 1 day so "easy" is not due immediately).
    """
    now = now or utcnow()
    interval = float(card.interval_days or 0.0)
    ease = float(card.ease or DEFAULT_EASE)
    reps = int(card.reps or 0)
    if grade == "again":
        card.lapses = int(card.lapses or 0) + 1
        card.reps = 0
        card.ease = max(MIN_EASE, ease - 0.2)
        card.interval_days = 0.0
        card.due_at = now + AGAIN_DELAY
    else:
        if grade == "hard":
            interval = max(1.0, interval * 1.2)
            ease = max(MIN_EASE, ease - 0.15)
        elif grade == "good":
            reps += 1
            interval = 1.0 if reps == 1 else 3.0 if reps == 2 else max(interval, 1.0) * ease
        elif grade == "easy":
            reps += 1
            interval = max(interval, 1.0) * ease * 1.3
            ease = ease + 0.15
        else:  # pragma: no cover - guarded by the request schema
            raise ValueError(f"unknown grade {grade!r}")
        card.reps = reps
        card.ease = round(ease, 4)
        card.interval_days = round(interval, 4)
        card.due_at = now + timedelta(days=interval)
    card.ease = round(float(card.ease), 4)
    card.last_reviewed_at = now
    if score is not None:
        card.last_score = round(float(score), 3)
    card.updated_at = now
    return card


def grade_for_overall(overall: float) -> str:
    """Grade of a recorded word review: ≥ 0.85 good, ≥ 0.7 hard, otherwise again."""
    if overall >= 0.85:
        return "good"
    if overall >= 0.7:
        return "hard"
    return "again"


# ---------------------------------------------------------------------------- serialization
def serialize_card(card: ReadingWord) -> dict[str, Any]:
    return {
        "id": card.id,
        "word": card.display,
        "kind": card.kind,
        "ipa": card.ipa,
        "meaning_pt": card.meaning_pt,
        "context": card.context,
        "section_id": card.section_id,
        "source": card.source,
        "reps": int(card.reps or 0),
        "lapses": int(card.lapses or 0),
        "ease": round(float(card.ease or DEFAULT_EASE), 3),
        "interval_days": round(float(card.interval_days or 0.0), 3),
        "due_at": reading._iso(card.due_at),
        "last_score": round(card.last_score, 3) if card.last_score is not None else None,
        "last_reviewed_at": reading._iso(card.last_reviewed_at),
        "created_at": reading._iso(card.created_at),
    }


# ---------------------------------------------------------------------------- queries
def get_card(db: Session, user: User, card_id: str) -> ReadingWord:
    """The user's card or 404 (another user's card is indistinguishable from a missing one)."""
    card = None
    if card_id and len(card_id) <= 36:
        card = db.execute(
            select(ReadingWord).where(ReadingWord.id == card_id, ReadingWord.user_id == user.id)
        ).scalar_one_or_none()
    if card is None:
        raise api_error(404, "word_not_found", "Word not found.")
    return card


def find_card(db: Session, user: User, word_norm: str, kind: str) -> ReadingWord | None:
    return db.execute(
        select(ReadingWord).where(ReadingWord.user_id == user.id, ReadingWord.word_norm == word_norm, ReadingWord.kind == kind)
    ).scalar_one_or_none()


def cards_for_word(db: Session, user: User, word_norm: str) -> list[ReadingWord]:
    return list(db.execute(
        select(ReadingWord).where(ReadingWord.user_id == user.id, ReadingWord.word_norm == word_norm)
    ).scalars())


def list_cards(
    db: Session, user: User, *, status: str = "all", kind: str | None = None, limit: int = 50, offset: int = 0
) -> dict[str, Any]:
    now = utcnow()
    limit = max(1, min(int(limit), MAX_LIST_LIMIT))
    offset = max(int(offset), 0)
    base = [ReadingWord.user_id == user.id]
    if kind:
        base.append(ReadingWord.kind == kind)
    filters = list(base)
    if status == "due":
        filters.append(ReadingWord.due_at <= now)
    # Due cards first (oldest due first), then the rest by their next due date.
    rows = db.execute(
        select(ReadingWord).where(*filters).order_by(ReadingWord.due_at.asc(), ReadingWord.created_at.asc()).limit(limit).offset(offset)
    ).scalars().all()
    total = db.execute(select(func.count(ReadingWord.id)).where(*filters)).scalar() or 0
    due = db.execute(select(func.count(ReadingWord.id)).where(*base, ReadingWord.due_at <= now)).scalar() or 0
    return {"items": [serialize_card(row) for row in rows], "total": int(total), "due": int(due)}


def summary(db: Session, user: User) -> dict[str, Any]:
    now = utcnow()
    total, due, learned = db.execute(
        select(
            func.count(ReadingWord.id),
            func.coalesce(func.sum(case((ReadingWord.due_at <= now, 1), else_=0)), 0),
            func.coalesce(func.sum(case((ReadingWord.interval_days >= LEARNED_DAYS, 1), else_=0)), 0),
        ).where(ReadingWord.user_id == user.id)
    ).one()
    by_kind = {kind: 0 for kind in READING_WORD_KINDS}
    for kind, count in db.execute(
        select(ReadingWord.kind, func.count(ReadingWord.id)).where(ReadingWord.user_id == user.id).group_by(ReadingWord.kind)
    ).all():
        by_kind[kind] = int(count)
    return {"total": int(total or 0), "due": int(due or 0), "learned": int(learned or 0), "by_kind": by_kind}


def due_count(db: Session, user: User) -> int:
    value = db.execute(
        select(func.count(ReadingWord.id)).where(ReadingWord.user_id == user.id, ReadingWord.due_at <= utcnow())
    ).scalar()
    return int(value or 0)


# ---------------------------------------------------------------------------- mutations
def _new_card(user: User, *, norm: str, display: str, kind: str, source: str, now: datetime, **fields: Any) -> ReadingWord:
    return ReadingWord(
        user_id=user.id, word_norm=norm, display=display[:WORD_MAX], kind=kind, source=source,
        reps=0, lapses=0, ease=DEFAULT_EASE, interval_days=0.0, due_at=now,
        created_at=now, updated_at=now, **fields,
    )


def add_card(
    db: Session, user: User, spot: WordSpot, *, kind: str, source: str, ipa: str | None = None, meaning_pt: str | None = None
) -> tuple[ReadingWord, bool]:
    """``(card, created)``: an existing card of the same word and kind is returned untouched
    (only missing IPA/meaning are filled in)."""
    existing = find_card(db, user, spot.norm, kind)
    if existing is not None:
        changed = False
        if ipa and not existing.ipa:
            existing.ipa, changed = ipa[:IPA_MAX], True
        if meaning_pt and not existing.meaning_pt:
            existing.meaning_pt, changed = meaning_pt, True
        if changed:
            existing.updated_at = utcnow()
            db.commit()
        return existing, False
    now = utcnow()
    card = _new_card(
        user, norm=spot.norm, display=spot.display, kind=kind, source=source, now=now,
        ipa=(ipa or None) and ipa[:IPA_MAX], meaning_pt=meaning_pt, context=spot.context[:CONTEXT_MAX],
        section_id=spot.section.id, part_id=spot.part_id, block_index=spot.block_index,
    )
    db.add(card)
    try:
        db.commit()
    except IntegrityError:  # concurrent add of the same word
        db.rollback()
        existing = find_card(db, user, spot.norm, kind)
        if existing is None:
            raise
        return existing, False
    db.refresh(card)
    return card, True


def delete_card(db: Session, user: User, card_id: str) -> None:
    card = get_card(db, user, card_id)
    db.delete(card)
    db.commit()


def grade_card(db: Session, user: User, card_id: str, grade: str, *, score: float | None = None) -> ReadingWord:
    card = get_card(db, user, card_id)
    schedule(card, grade, score=score)
    db.commit()
    db.refresh(card)
    return card


def fill_meaning(db: Session, user: User, word_norm: str, meaning_pt: str | None) -> None:
    """Give the user's cards of this word the glossary translation when they have none yet."""
    if not meaning_pt:
        return
    changed = False
    for card in cards_for_word(db, user, word_norm):
        if not card.meaning_pt:
            card.meaning_pt = meaning_pt
            card.updated_at = utcnow()
            changed = True
    if changed:
        db.commit()


# ---------------------------------------------------------------------------- after an assessment
def _word_reference(reference_text: str, word: dict[str, Any]) -> tuple[int, int, str] | None:
    """Offsets and text of an assessed word, read back from OUR reference text (the speech
    service's ``text`` is only used when its offsets do not line up)."""
    try:
        start, end = int(word.get("char_start")), int(word.get("char_end"))
    except (TypeError, ValueError):
        return None
    if 0 <= start < end <= len(reference_text):
        return start, end, reference_text[start:end]
    return None


def _is_problem(word: dict[str, Any]) -> bool:
    status = word.get("status")
    score = word.get("phoneme_score")
    if status == "mispronounced":
        return True
    return status == "weak" and isinstance(score, (int, float)) and score < WEAK_PHONEME_THRESHOLD


def _is_good(word: dict[str, Any]) -> bool:
    if word.get("status") != "ok":
        return False
    score = word.get("phoneme_score")
    return score is None or (isinstance(score, (int, float)) and score >= GOOD_PHONEME_THRESHOLD)


def _word_score(word: dict[str, Any]) -> float | None:
    score = word.get("phoneme_score")
    if isinstance(score, (int, float)):
        return float(score)
    return {"ok": 1.0, "weak": 0.5, "mispronounced": 0.0}.get(str(word.get("status")))


def apply_assessment(
    db: Session,
    user: User,
    assessment: dict[str, Any],
    *,
    reference_text: str,
    section_id: str,
    part_id: str,
    block_index: int,
) -> dict[str, int]:
    """Feed the pronunciation deck with one assessment (§3.2) → ``{"added", "reviewed"}``.

    Problem words (``mispronounced``, or ``weak`` with ``phoneme_score < 0.6``) become cards (at
    most 8 per assessment); a problem word already in the deck and due counts as "again". Deck
    words read well (``ok``, ``phoneme_score ≥ 0.8`` when present) and due count as "good".
    """
    now = utcnow()
    problems: dict[str, tuple[str, dict[str, Any], int, int]] = {}
    good: dict[str, dict[str, Any]] = {}
    for word in assessment.get("words") or []:
        if not isinstance(word, dict):
            continue
        located = _word_reference(reference_text, word)
        if located is None:
            continue
        start, end, display = located
        norm = normalize_word(display)
        if not norm or not _LETTER.search(norm):
            continue
        if _is_problem(word):
            problems.setdefault(norm, (display, word, start, end))
        elif _is_good(word):
            good.setdefault(norm, word)
    for norm in problems:
        good.pop(norm, None)  # read badly anywhere in the passage: not a success

    added = reviewed = 0
    norms = list(problems) + list(good)
    existing = {
        card.word_norm: card
        for card in db.execute(
            select(ReadingWord).where(
                ReadingWord.user_id == user.id, ReadingWord.kind == "pronunciation", ReadingWord.word_norm.in_(norms)
            )
        ).scalars()
    } if norms else {}
    budget = MAX_AUTO_CARDS
    for norm, (display, word, start, end) in problems.items():
        if budget <= 0:
            break
        card = existing.get(norm)
        if card is not None:
            if is_due(card, now):
                schedule(card, "again", now=now, score=_word_score(word))
                reviewed += 1
                budget -= 1
            continue
        ipa = word.get("expected_ipa")
        db.add(_new_card(
            user, norm=norm, display=display, kind="pronunciation", source="assessment", now=now,
            ipa=str(ipa)[:IPA_MAX] if ipa else None, context=context_for(reference_text, start, end),
            section_id=section_id, part_id=part_id, block_index=block_index, last_score=_word_score(word),
        ))
        added += 1
        budget -= 1
    for norm, word in good.items():
        card = existing.get(norm)
        if card is not None and is_due(card, now):
            schedule(card, "good", now=now, score=_word_score(word))
            reviewed += 1
    if added or reviewed:
        try:
            db.commit()
        except IntegrityError:  # a concurrent assessment added the same word: keep the attempt
            db.rollback()
            return {"added": 0, "reviewed": 0}
    return {"added": added, "reviewed": reviewed}
