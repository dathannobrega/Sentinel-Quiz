"""Request models of the Sentinel Reader API (docs/reading/CONTRATO-INCREMENTO-1.md §4).

Responses are plain dicts built by ``app.services.reading`` (the contract documents their shape;
``web/types/api/reading.ts`` mirrors it).
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

SectionId = Annotated[str, Field(min_length=1, max_length=256)]
BookSlug = Annotated[str, Field(min_length=1, max_length=128)]
ReadingMode = Literal["listen", "read", "shadow"]

# Speeds offered by the UI; any value in [0.5, 1.5] is accepted by the API (Increment 3 §3.4 adds
# 0.5 and 0.6 for learners who shadow slowly).
READING_SPEEDS: tuple[float, ...] = (0.5, 0.6, 0.75, 0.9, 1.0, 1.1, 1.25)
MAX_BLOCK_INDEX = 500


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TtsIn(_Strict):
    part_id: SectionId
    block_index: int = Field(ge=0, le=MAX_BLOCK_INDEX)
    voice: Optional[Annotated[str, Field(max_length=32, pattern=r"^[a-z]{2}_[a-z]{2,24}$")]] = None
    speed: Optional[float] = Field(default=None, ge=0.5, le=1.5)


class WarmIn(_Strict):
    """``POST /sections/{id}/warm`` (Increment 3 §3.2): the reader's current position."""

    part_id: SectionId
    block_index: int = Field(ge=0, le=MAX_BLOCK_INDEX)
    voice: Optional[Annotated[str, Field(max_length=32, pattern=r"^[a-z]{2}_[a-z]{2,24}$")]] = None
    speed: Optional[float] = Field(default=None, ge=0.5, le=1.5)


class ProgressIn(_Strict):
    book_slug: BookSlug
    section_id: SectionId
    part_id: SectionId
    block_index: int = Field(ge=0, le=MAX_BLOCK_INDEX)
    mode: ReadingMode = "listen"
    # Increments since the previous update (added to the running totals).
    words_read: int = Field(default=0, ge=0, le=100_000)
    seconds_listened: int = Field(default=0, ge=0, le=86_400)


# ---------------------------------------------------------------------------- Increment 2
# docs/reading/CONTRATO-INCREMENTO-2.md §3.1-3.4. A word is always named by a character range of
# a block; the server expands it to the whole word and reads the text from the corpus.
MAX_SENTENCE_INDEX = 500
MAX_CHAR_OFFSET = 50_000
WordKind = Literal["pronunciation", "vocabulary"]
WordGrade = Literal["again", "hard", "good", "easy"]
QuizChoice = Literal["A", "B", "C", "D"]


class _BlockRange(_Strict):
    section_id: SectionId
    part_id: SectionId
    block_index: int = Field(ge=0, le=MAX_BLOCK_INDEX)
    char_start: int = Field(ge=0, le=MAX_CHAR_OFFSET)
    char_end: int = Field(ge=1, le=MAX_CHAR_OFFSET)


class WordIn(_BlockRange):
    kind: WordKind = "vocabulary"


class GlossaryIn(_BlockRange):
    pass


class WordTtsIn(_Strict):
    voice: Optional[Annotated[str, Field(max_length=32, pattern=r"^[a-z]{2}_[a-z]{2,24}$")]] = None
    speed: Optional[float] = Field(default=None, ge=0.5, le=1.5)


class GradeIn(_Strict):
    grade: WordGrade


class QuizAnswerIn(_Strict):
    question_index: int = Field(ge=0, le=9)
    choice: QuizChoice
