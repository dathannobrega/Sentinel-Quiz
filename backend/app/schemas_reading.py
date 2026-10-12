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

# Speeds offered by the UI; any value in [0.5, 1.5] is accepted by the API.
READING_SPEEDS: tuple[float, ...] = (0.75, 0.9, 1.0, 1.1, 1.25)
MAX_BLOCK_INDEX = 500


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TtsIn(_Strict):
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
