from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class ExamOut(BaseModel):
    id: str
    title: str
    source: Optional[str] = None
    question_count: Optional[int] = None

class OptionOut(BaseModel):
    key: str
    text: str

class QuestionOut(BaseModel):
    id: str
    exam_id: str
    prompt: str
    multi_select: bool
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    tags: Optional[List[str]] = None
    options: List[OptionOut]

class CreateSessionIn(BaseModel):
    exam_id: Optional[str] = Field(default=None, description="If null, mixes all exams")
    total_questions: int = Field(default=90, ge=1, le=2000)
    domains: Optional[List[str]] = Field(default=None, description="Optional domain filters.")
    question_ids: Optional[List[str]] = Field(default=None, description="Optional explicit question IDs to use (keeps order).")

class SessionOut(BaseModel):
    id: str
    exam_id: Optional[str]
    total_questions: int
    current_index: int
    correct_count: int
    wrong_count: int

class SessionStateOut(BaseModel):
    id: str
    exam_id: Optional[str]
    total_questions: int
    current_index: int
    correct_count: int
    wrong_count: int
    finished: bool

class AnswerIn(BaseModel):
    question_id: str
    selected_keys: List[str]

class AnswerFeedbackOut(BaseModel):
    is_correct: bool
    correct_keys: List[str]
    justification: Optional[str] = None
    progress_index: int
    total_questions: int
    correct_count: int
    wrong_count: int
    finished: bool
    insight: Optional[dict] = None

class ResultOut(BaseModel):
    session_id: str
    total_questions: int
    correct_count: int
    wrong_count: int
    score_percent: float
    passed: bool
    pass_threshold_percent: float
    insight: dict

class SessionHistoryOut(BaseModel):
    id: str
    exam_id: Optional[str]
    exam_title: Optional[str] = None
    created_at: Optional[str] = None
    completed_at: Optional[str] = None
    total_questions: int
    correct_count: int
    wrong_count: int
    score_percent: float

class ReviewQuestionOut(BaseModel):
    id: str
    prompt: str
    multi_select: bool
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    options: List[OptionOut]
    correct_keys: List[str]
    selected_keys: List[str]
    is_correct: Optional[bool] = None
    justification: Optional[str] = None
    tags: Optional[List[str]] = None
    citations: Optional[List[Dict[str, Any]]] = None

class SessionReviewOut(BaseModel):
    session: SessionHistoryOut
    result: ResultOut
    questions: List[ReviewQuestionOut]

class TutorRequest(BaseModel):
    user_message: Optional[str] = Field(default=None, max_length=800)
    mode: Optional[str] = Field(default="help")

class TutorResponse(BaseModel):
    message: str
    blocked: bool = False
    model: Optional[str] = None
