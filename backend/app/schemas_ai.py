"""Request models of the AI authoring API (contract docs/live-quiz/CONTRATO-INCREMENTO-2.md §3)."""
from __future__ import annotations

from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

AiItemType = Literal["single_choice", "multi_choice", "true_false", "type_answer"]
Level = Literal["Easy", "Medium", "Hard", "mixed"]
Language = Literal["pt-BR", "en"]
Uuid = Annotated[str, Field(min_length=1, max_length=36)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateIn(_Strict):
    quiz_id: Uuid
    topic: Optional[str] = Field(default=None, max_length=500)
    certification: Optional[str] = Field(default=None, max_length=64)
    domains: List[Annotated[str, Field(max_length=255)]] = Field(default_factory=list, max_length=10)
    level: Level = "mixed"
    n: int = Field(default=5, ge=1, le=20)
    types: List[AiItemType] = Field(default_factory=lambda: ["single_choice"], min_length=1, max_length=4)
    language: Language = "pt-BR"
    audience_note: Optional[str] = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _topic_or_certification(self) -> "GenerateIn":
        if not (self.topic or "").strip() and not self.certification:
            raise ValueError("Provide a topic or a certification.")
        return self


class FromSourceIn(_Strict):
    quiz_id: Uuid
    source_text: str = Field(min_length=200, max_length=20000)
    n: int = Field(default=5, ge=1, le=20)
    types: List[AiItemType] = Field(default_factory=lambda: ["single_choice"], min_length=1, max_length=4)
    level: Level = "mixed"
    language: Language = "pt-BR"
    title_hint: Optional[str] = Field(default=None, max_length=120)


class ImproveIn(_Strict):
    quiz_id: Uuid
    action: Literal["rewrite", "distractors", "explain"]
    instructions: Optional[str] = Field(default=None, max_length=300)


class ApplyIn(_Strict):
    quiz_id: Uuid
    expected_version: int = Field(ge=1)
    indexes: List[int] = Field(min_length=1, max_length=20)
    force: bool = False


class SuggestFormatIn(_Strict):
    item_type: Literal["single_choice", "multi_choice", "true_false", "type_answer", "poll", "content", "leaderboard"]
    prompt: str = Field(default="", max_length=400)
    options: List[Annotated[str, Field(max_length=120)]] = Field(default_factory=list, max_length=6)


class BankSampleIn(_Strict):
    certification: Optional[str] = Field(default=None, max_length=64)
    domains: List[Annotated[str, Field(max_length=255)]] = Field(default_factory=list, max_length=20)
    difficulty: Optional[Literal["Easy", "Medium", "Hard"]] = None
    n: int = Field(default=10, ge=1, le=50)
    strategy: Literal["coverage", "random"] = "coverage"
    only_guest_eligible: bool = False
    exclude_quiz_id: Optional[Uuid] = None
