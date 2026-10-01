"""Request models of the Sentinel Arena REST API (contract §4–§5).

Responses are plain dicts built by the services (the contract documents their shape;
web/types/api/live.ts mirrors it). Kept apart from schemas.py (DC-19).
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

ThemeKey = Literal["sentinel", "terminal", "neon_soc", "aurora", "high_contrast"]
ItemType = Literal[
    "single_choice", "multi_choice", "true_false", "type_answer", "poll", "content", "leaderboard",
    "ordering", "numeric", "word_cloud",
]
Scoring = Literal["speed", "fixed", "none"]
Preset = Literal["turma", "evento"]
Audience = Literal["adulto", "misto", "infantojuvenil"]
Uuid = Annotated[str, Field(min_length=1, max_length=36)]

THEME_KEYS: tuple[str, ...] = ("sentinel", "terminal", "neon_soc", "aurora", "high_contrast")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuizSettingsIn(_Strict):
    scoring: Optional[Scoring] = None
    reading_phase_s: Optional[int] = Field(default=None, ge=0, le=10)
    grace_ms: Optional[int] = Field(default=None, ge=0, le=1500)
    streak_bonus: Optional[bool] = None
    show_live_distribution: Optional[bool] = None
    show_correct_on_device: Optional[bool] = None
    show_explanation: Optional[bool] = None
    leaderboard_every: Optional[int] = Field(default=None, ge=0, le=20)
    music: Optional[bool] = None


class QuizCreateIn(_Strict):
    title: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    language: Literal["pt-BR", "en"] = "pt-BR"
    theme_key: ThemeKey = "sentinel"
    settings: Optional[QuizSettingsIn] = None


class QuizUpdateIn(_Strict):
    expected_version: int = Field(ge=1)
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    language: Optional[Literal["pt-BR", "en"]] = None
    theme_key: Optional[ThemeKey] = None
    settings: Optional[QuizSettingsIn] = None


class OptionIn(_Strict):
    key: Optional[str] = Field(default=None, max_length=2)
    text: str = Field(default="", max_length=120)
    correct: bool = False


class ItemWriteIn(_Strict):
    expected_version: int = Field(ge=1)
    item_type: Optional[ItemType] = None
    position: Optional[int] = Field(default=None, ge=0, le=1000)
    prompt: Optional[str] = Field(default=None, max_length=400)
    options: Optional[List[OptionIn]] = Field(default=None, max_length=6)
    accepted_answers: Optional[List[Annotated[str, Field(max_length=60)]]] = Field(default=None, max_length=10)
    allow_multiple: Optional[bool] = None
    all_or_nothing: Optional[bool] = None
    body: Optional[str] = Field(default=None, max_length=1000)
    time_limit_s: Optional[int] = None
    points_multiplier: Optional[Literal[0, 1, 2]] = None
    explanation: Optional[str] = Field(default=None, max_length=2000)
    presenter_notes: Optional[str] = Field(default=None, max_length=2000)
    # GA types (Incremento 5). Numbers also accept pt-BR text ("1.234,5").
    order_method: Optional[Literal["kendall", "exact"]] = None
    min: Optional[Union[float, Annotated[str, Field(max_length=32)]]] = None
    max: Optional[Union[float, Annotated[str, Field(max_length=32)]]] = None
    step: Optional[Union[float, Annotated[str, Field(max_length=32)]]] = None
    unit: Optional[str] = Field(default=None, max_length=12)
    value: Optional[Union[float, Annotated[str, Field(max_length=32)]]] = None
    tolerance: Optional[Union[float, Annotated[str, Field(max_length=32)]]] = None
    partial: Optional[bool] = None
    max_words: Optional[int] = Field(default=None, ge=1, le=3)

    def write_fields(self) -> dict[str, Any]:
        """Only the fields the client actually sent (partial update semantics)."""
        data = self.model_dump(exclude_unset=True, exclude={"expected_version", "item_type", "position"})
        if "options" in data and data["options"] is not None:
            data["options"] = [option for option in data["options"]]
        return data


class ExpectedVersionIn(_Strict):
    expected_version: int = Field(ge=1)


class ReviewIn(_Strict):
    expected_version: int = Field(ge=1)
    # Required for AI items flagged by the blind critic (key_mismatch / ambiguous).
    confirm_key: bool = False


class ReorderIn(_Strict):
    expected_version: int = Field(ge=1)
    item_ids: List[Uuid] = Field(max_length=1000)


class FromBankIn(_Strict):
    expected_version: int = Field(ge=1)
    question_ids: List[Annotated[str, Field(max_length=128)]] = Field(min_length=1, max_length=50)


class SessionCreateIn(_Strict):
    quiz_id: Uuid
    allow_guests: bool = True
    max_participants: Optional[int] = Field(default=None, ge=1, le=10000)
    preset: Preset = "turma"
    audience: Audience = "adulto"
    # Rehearsal (RF-513): a private dry run, optionally with bots that answer.
    rehearsal: bool = False
    bots: int = Field(default=0, ge=0, le=200)


class ChallengeCreateIn(_Strict):
    """Self-paced challenge (E1.10, RF-801). ``feedback`` defaults to ``after_close`` with a
    leaderboard (RF-813) and to ``end`` without one."""

    quiz_id: Uuid
    opens_at: Optional[datetime] = None
    closes_at: datetime
    attempts: int = Field(default=1, ge=1, le=5)
    time_mode: Literal["per_item", "total", "none"] = "per_item"
    total_time_s: Optional[int] = Field(default=None, ge=60, le=14400)
    feedback: Optional[Literal["each", "end", "after_close", "never"]] = None
    leaderboard: bool = False
    shuffle_items: bool = True
    allow_guests: bool = True
    audience: Audience = "adulto"
    max_participants: Optional[int] = Field(default=None, ge=1, le=10000)


class ChallengeUpdateIn(_Strict):
    closes_at: Optional[datetime] = None
    close_now: bool = False


class ChallengeAnswerIn(_Strict):
    answer_id: str = Field(min_length=8, max_length=36)
    qi: int = Field(ge=0, le=10000)
    choice: Optional[List[Annotated[str, Field(max_length=16)]]] = Field(default=None, max_length=6)
    text: Optional[str] = Field(default=None, max_length=120)
    words: Optional[List[Annotated[str, Field(max_length=25)]]] = Field(default=None, max_length=3)
    number: Optional[float] = Field(default=None, allow_inf_nan=False, ge=-1e12, le=1e12)


class AdvanceIn(_Strict):
    index: int = Field(ge=0, le=10000)


class JoinIn(_Strict):
    display_name: str = Field(default="", max_length=64)
    consent: bool = False
    avatar_seed: Optional[str] = Field(default=None, max_length=16, pattern=r"^[a-z0-9]*$")
    dev_h: Optional[str] = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]*$")


class RejoinIn(_Strict):
    display_name: str = Field(max_length=64)
    return_code: str = Field(min_length=4, max_length=8)


class ReportIn(_Strict):
    target: Literal["session", "item"] = "item"
    qi: Optional[int] = Field(default=None, ge=0, le=10000)
    reason: Literal["offensive", "spam", "cheating", "copyright", "privacy", "other"]
    note: Optional[str] = Field(default=None, max_length=500)


class AccessIn(_Strict):
    session_id: Uuid
    display_name: str = Field(min_length=1, max_length=64)
    return_code: str = Field(min_length=4, max_length=12)


class ClaimIn(_Strict):
    # In the body: the Authorization header carries the signed-in user's session.
    token: str = Field(min_length=10, max_length=1024)
