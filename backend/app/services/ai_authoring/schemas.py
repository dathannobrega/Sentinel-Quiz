"""Structured output the model must return (mirrors PLANO §12.3, MVP-0 types)."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

AI_ITEM_TYPES = ("single_choice", "multi_choice", "true_false", "type_answer")


class _Loose(BaseModel):
    model_config = ConfigDict(extra="ignore")


class LlmOption(_Loose):
    key: str = Field(pattern=r"^[A-Fa-f]$")
    text: str = Field(min_length=1, max_length=160)
    why_wrong: Optional[str] = Field(default=None, max_length=400)


class LlmItem(_Loose):
    type: Literal["single_choice", "multi_choice", "true_false", "type_answer"]
    prompt: str = Field(min_length=5, max_length=500)
    language: Optional[str] = None
    domain: Optional[str] = Field(default=None, max_length=255)
    difficulty: Optional[Literal["Easy", "Medium", "Hard"]] = None
    options: List[LlmOption] = Field(default_factory=list, max_length=6)
    correct_keys: List[str] = Field(default_factory=list, max_length=6)
    accepted_answers: List[str] = Field(default_factory=list, max_length=10)
    rationale: str = Field(default="", max_length=1200)
    time_limit_s: Optional[int] = None


class LlmItems(_Loose):
    items: List[dict] = Field(default_factory=list, max_length=40)


class LlmCriticAnswer(_Loose):
    index: int
    solved_keys: List[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    defensible_keys: List[str] = Field(default_factory=list)
    factual_issues: List[str] = Field(default_factory=list)


class LlmCritic(_Loose):
    answers: List[LlmCriticAnswer] = Field(default_factory=list)


class LlmProposal(_Loose):
    prompt: Optional[str] = Field(default=None, max_length=500)
    options: Optional[List[LlmOption]] = Field(default=None, max_length=6)
    explanation: Optional[str] = Field(default=None, max_length=1200)


# JSON schema hints embedded in the prompts (the provider also requests JSON mode).
ITEMS_SCHEMA_HINT = {
    "items": [
        {
            "type": "single_choice | multi_choice | true_false | type_answer",
            "prompt": "string (<= 400 chars)",
            "language": "pt-BR | en",
            "domain": "string (one of the allowed domains, when given)",
            "difficulty": "Easy | Medium | Hard",
            "options": [{"key": "A..F", "text": "string (<= 120 chars)", "why_wrong": "string, empty for correct"}],
            "correct_keys": ["A"],
            "accepted_answers": ["type_answer only: 1..5 short answers"],
            "rationale": "why the correct answer is correct (<= 800 chars)",
            "time_limit_s": "integer 10..120",
        }
    ]
}
CRITIC_SCHEMA_HINT = {
    "answers": [
        {"index": 0, "solved_keys": ["B"], "confidence": 0.9, "defensible_keys": ["B"], "factual_issues": []}
    ]
}
PROPOSAL_SCHEMA_HINT = {
    "prompt": "string (rewrite only)",
    "options": [{"key": "A..F", "text": "string"}],
    "explanation": "string (explain only)",
}
