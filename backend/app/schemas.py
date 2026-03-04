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
    total_questions: int = Field(default=90, ge=1, le=180)
    domains: Optional[List[str]] = Field(default=None, description="Optional domain filters.")
    difficulties: Optional[List[str]] = Field(default=None, description="Optional difficulty filters.")
    tags: Optional[List[str]] = Field(default=None, description="Optional tag filters.")
    bookmarked_only: bool = False
    notes_only: bool = False
    incorrect_only: bool = False
    unseen_only: bool = False
    low_confidence_only: bool = False
    strategy: str = Field(default="standard", description="standard or adaptive.")
    time_limit_minutes: Optional[int] = Field(default=None, ge=1, le=360)
    experience_mode: str = Field(default="standard", description="standard or exam_day.")

class SessionOut(BaseModel):
    id: str
    exam_id: Optional[str]
    selection_strategy: str = "standard"
    selection_mix: Dict[str, int] = Field(default_factory=dict)
    active_filters: Dict[str, Any] = Field(default_factory=dict)
    total_questions: int
    current_index: int
    current_position: int = 0
    answered_count: int = 0
    correct_count: int
    wrong_count: int
    marked_for_review_count: int = 0
    experience_mode: str = "standard"
    time_limit_seconds: Optional[int] = None
    remaining_seconds: Optional[int] = None
    expires_at: Optional[str] = None
    paused: bool = False
    pause_count: int = 0
    auto_submitted: bool = False
    finished: bool = False

class SessionStateOut(BaseModel):
    id: str
    exam_id: Optional[str]
    selection_strategy: str = "standard"
    selection_mix: Dict[str, int] = Field(default_factory=dict)
    active_filters: Dict[str, Any] = Field(default_factory=dict)
    total_questions: int
    current_index: int
    current_position: int = 0
    answered_count: int = 0
    correct_count: int
    wrong_count: int
    marked_for_review_count: int = 0
    experience_mode: str = "standard"
    time_limit_seconds: Optional[int] = None
    remaining_seconds: Optional[int] = None
    expires_at: Optional[str] = None
    paused: bool = False
    pause_count: int = 0
    auto_submitted: bool = False
    finished: bool

class AnswerIn(BaseModel):
    question_id: str
    selected_keys: List[str]
    elapsed_seconds: Optional[int] = Field(default=None, ge=0, le=86400)


class PedagogicalReferenceOut(BaseModel):
    source_kind: str
    label: str
    reference: Optional[str] = None
    material_path: Optional[str] = None
    locator: Optional[str] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    is_official: bool = False


class QuestionHintOut(BaseModel):
    question_id: str
    level: int
    available_levels: List[int] = Field(default_factory=list)
    title: str
    hint_kind: str
    message: str
    caution: str
    references: List[PedagogicalReferenceOut] = Field(default_factory=list)


class WeakDomainOut(BaseModel):
    label: str
    total: int
    wrong: int
    score_percent: float


class StudyPlanItemOut(BaseModel):
    domain: str
    wrong: int
    total: int
    score_percent: float
    topics: List[str] = Field(default_factory=list)
    resources: List[str] = Field(default_factory=list)
    reason: str
    action: str


class TimingBreakdownOut(BaseModel):
    duration_seconds: Optional[float] = None
    avg_seconds_per_question: Optional[float] = None
    fastest_seconds: Optional[float] = None
    slowest_seconds: Optional[float] = None


class ReadinessDomainOut(BaseModel):
    domain: str
    score_percent: float
    accuracy_percent: float = 0.0
    attempts: int = 0
    avg_elapsed_seconds: Optional[float] = None
    low_confidence_count: int = 0


class ReadinessScoreOut(BaseModel):
    score_percent: float
    projected_score_percent: float
    band: str
    recommended_minutes: int
    tracked_questions: int = 0
    factors: List[str] = Field(default_factory=list)
    domain_scores: List[ReadinessDomainOut] = Field(default_factory=list)
    weakest_domains: List[ReadinessDomainOut] = Field(default_factory=list)


class LiveInsightOut(BaseModel):
    accuracy_percent: float = 0.0
    remaining_questions: int = 0
    current_correct_streak: int = 0
    weakest_area: Optional[Dict[str, Any]] = None
    message: str = ""


class ResultInsightOut(BaseModel):
    summary: Dict[str, Any] = Field(default_factory=dict)
    by_type: Dict[str, Any] = Field(default_factory=dict)
    by_domain: List[Dict[str, Any]] = Field(default_factory=list)
    by_difficulty: List[Dict[str, Any]] = Field(default_factory=list)
    by_certification: List[Dict[str, Any]] = Field(default_factory=list)
    by_exam: List[Dict[str, Any]] = Field(default_factory=list)
    weakest_domains: List[WeakDomainOut] = Field(default_factory=list)
    strongest_domains: List[Dict[str, Any]] = Field(default_factory=list)
    patterns: List[str] = Field(default_factory=list)
    focus: List[str] = Field(default_factory=list)
    study_plan: List[StudyPlanItemOut] = Field(default_factory=list)
    readiness: Optional[ReadinessScoreOut] = None
    timing: Optional[TimingBreakdownOut] = None
    recommendation: Optional[str] = None
    missed_sample: List[Dict[str, Any]] = Field(default_factory=list)
    live: Optional[LiveInsightOut] = None


class ExamRuntimeQuestionOut(BaseModel):
    id: str
    exam_id: str
    prompt: str
    multi_select: bool
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    tags: Optional[List[str]] = None
    options: List[OptionOut]
    selected_keys: List[str] = Field(default_factory=list)
    is_answered: bool = False
    marked_for_review: bool = False
    elapsed_seconds: Optional[int] = None


class ExamQuestionStateOut(BaseModel):
    finished: bool
    question: Optional[ExamRuntimeQuestionOut] = None
    progress_index: Optional[int] = None
    current_position: Optional[int] = None
    total_questions: Optional[int] = None
    answered_count: Optional[int] = None
    marked_for_review_count: Optional[int] = None
    experience_mode: Optional[str] = None


class ExamNavigationIn(BaseModel):
    position: int = Field(..., ge=0)


class ReviewScreenQuestionStatusOut(BaseModel):
    position: int
    question_id: str
    answered: bool
    selected_keys: List[str] = Field(default_factory=list)
    marked_for_review: bool = False
    is_current: bool = False


class ExamReviewScreenOut(BaseModel):
    session_id: str
    total_questions: int
    answered_count: int
    unanswered_count: int
    marked_for_review_count: int
    current_position: int
    items: List[ReviewScreenQuestionStatusOut] = Field(default_factory=list)


class QuestionIssueIn(BaseModel):
    session_id: Optional[str] = None
    mode: str = Field(default="exam", max_length=16)
    category: str = Field(..., max_length=32)
    message: str = Field(..., min_length=8, max_length=2000)
    question_version_id: Optional[int] = None


class QuestionIssueOut(BaseModel):
    id: int
    question_id: str
    question_version_id: Optional[int] = None
    session_id: Optional[str] = None
    mode: str
    category: str
    status: str
    message: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    certification: Optional[str] = None
    domain: Optional[str] = None
    prompt_excerpt: Optional[str] = None


class AnswerFeedbackOut(BaseModel):
    is_correct: bool
    justification: Optional[str] = None
    feedback_summary: Optional[str] = None
    progress_index: int
    current_position: Optional[int] = None
    total_questions: int
    answered_count: int = 0
    correct_count: int
    wrong_count: int
    marked_for_review_count: int = 0
    finished: bool
    official_references: List[PedagogicalReferenceOut] = Field(default_factory=list)
    insight: Optional[LiveInsightOut] = None

class ResultOut(BaseModel):
    session_id: str
    total_questions: int
    correct_count: int
    wrong_count: int
    score_percent: float
    passed: bool
    pass_threshold_percent: float
    strategy: str = "standard"
    selection_mix: Dict[str, int] = Field(default_factory=dict)
    time_limit_seconds: Optional[int] = None
    time_spent_seconds: Optional[int] = None
    timed_out: bool = False
    insight: ResultInsightOut

class SessionHistoryOut(BaseModel):
    id: str
    exam_id: Optional[str]
    exam_title: Optional[str] = None
    created_at: Optional[str] = None
    completed_at: Optional[str] = None
    selection_strategy: str = "standard"
    selection_mix: Dict[str, int] = Field(default_factory=dict)
    total_questions: int
    correct_count: int
    wrong_count: int
    score_percent: float


class ActiveSessionOut(BaseModel):
    id: str
    mode: str
    exam_id: Optional[str] = None
    exam_title: Optional[str] = None
    created_at: Optional[str] = None
    current_index: int = 0
    answered_count: int = 0
    total_questions: int
    progress_percent: float = 0.0
    selection_strategy: str = "standard"


class QuestionSearchItemOut(BaseModel):
    id: str
    exam_id: str
    exam_title: Optional[str] = None
    prompt_excerpt: str
    domain: Optional[str] = None
    certification: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    keywords: List[str] = Field(default_factory=list)
    is_bookmarked: bool = False
    has_note: bool = False


class QuestionSearchOut(BaseModel):
    items: List[QuestionSearchItemOut] = Field(default_factory=list)
    total: int = 0
    limit: int = 0
    offset: int = 0
    applied_filters: Dict[str, Any] = Field(default_factory=dict)

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


class StudyStateIn(BaseModel):
    bookmarked: bool = False
    note_text: Optional[str] = Field(default=None, max_length=4000)


class StudyStateOut(BaseModel):
    question_id: str
    bookmarked: bool
    note_text: Optional[str] = None
    updated_at: Optional[str] = None
    scope: str


class StudyOverviewItemOut(BaseModel):
    question_id: str
    prompt: str
    updated_at: Optional[str] = None
    excerpt: Optional[str] = None


class StudyOverviewOut(BaseModel):
    scope: str
    bookmark_count: int
    note_count: int
    due_review_count: int = 0
    next_due_at: Optional[str] = None
    recent_bookmarks: List[StudyOverviewItemOut]
    recent_notes: List[StudyOverviewItemOut]
    due_reviews: List[StudyOverviewItemOut] = Field(default_factory=list)


class StudySessionCreateIn(BaseModel):
    exam_id: Optional[str] = Field(default=None, description="If null, mixes all exams")
    total_questions: int = Field(default=30, ge=1, le=120)
    domains: Optional[List[str]] = Field(default=None, description="Optional domain filters.")
    difficulties: Optional[List[str]] = Field(default=None, description="Optional difficulty filters.")
    tags: Optional[List[str]] = Field(default=None, description="Optional tag filters.")
    bookmarked_only: bool = False
    notes_only: bool = False
    incorrect_only: bool = False
    unseen_only: bool = False
    low_confidence_only: bool = False
    strategy: str = Field(default="standard", description="standard, review, or adaptive.")
    queue_only: bool = Field(default=False, description="If true, use only due review items as the pool.")
    review_states: Optional[List[str]] = Field(default=None, description="Optional review queue states for review sessions.")


class StudySessionOut(BaseModel):
    id: str
    exam_id: Optional[str]
    selection_strategy: str = "standard"
    selection_mix: Dict[str, int] = Field(default_factory=dict)
    total_questions: int
    current_index: int
    answered_count: int
    correct_count: int
    wrong_count: int
    finished: bool = False


class StudySessionStateOut(BaseModel):
    id: str
    exam_id: Optional[str]
    selection_strategy: str = "standard"
    selection_mix: Dict[str, int] = Field(default_factory=dict)
    total_questions: int
    current_index: int
    answered_count: int
    correct_count: int
    wrong_count: int
    finished: bool


class StudyAnswerIn(BaseModel):
    question_id: str
    selected_keys: List[str]
    confidence_level: str = Field(default="not_sure")
    elapsed_seconds: Optional[int] = Field(default=None, ge=0, le=86400)


class StudyAnswerFeedbackOut(BaseModel):
    is_correct: bool
    justification: Optional[str] = None
    feedback_summary: Optional[str] = None
    progress_index: int
    total_questions: int
    answered_count: int
    correct_count: int
    wrong_count: int
    finished: bool
    confidence_level: str
    confidence_signal: str
    uncertain_correct: bool = False
    next_review_at: Optional[str] = None
    review_due_count: int = 0
    official_references: List[PedagogicalReferenceOut] = Field(default_factory=list)
    insight: Optional[LiveInsightOut] = None


class StudyResultOut(BaseModel):
    session_id: str
    total_questions: int
    answered_count: int
    correct_count: int
    wrong_count: int
    score_percent: float
    mode: str = "study"
    strategy: str = "standard"
    selection_mix: Dict[str, int] = Field(default_factory=dict)
    review_due_count: int = 0
    insight: ResultInsightOut


class StudyHistoryOut(BaseModel):
    id: str
    exam_id: Optional[str]
    exam_title: Optional[str] = None
    created_at: Optional[str] = None
    completed_at: Optional[str] = None
    selection_strategy: str = "standard"
    selection_mix: Dict[str, int] = Field(default_factory=dict)
    total_questions: int
    answered_count: int
    correct_count: int
    wrong_count: int
    score_percent: float
    avg_seconds_per_question: Optional[float] = None
    confidence_low: int = 0
    confidence_medium: int = 0
    confidence_high: int = 0
    weakest_domains: List[str] = Field(default_factory=list)


class ReviewQueueEntryOut(BaseModel):
    question_id: str
    prompt: str
    due_at: Optional[str] = None
    state: str
    is_overdue: bool = False
    overdue_days: int = 0
    domain: Optional[str] = None
    certification: Optional[str] = None
    repetition_count: int = 0
    stability_score: float = 0.0
    ease_factor: float = 2.5
    bookmarked: bool = False
    has_note: bool = False


class ReviewQueueStateBreakdownOut(BaseModel):
    due_now: int = 0
    overdue: int = 0
    at_risk: int = 0
    scheduled: int = 0
    mastered: int = 0


class ReviewQueueForecastDayOut(BaseModel):
    date: str
    label: str
    due_count: int = 0
    at_risk_count: int = 0


class ReviewQueueGoalOut(BaseModel):
    daily_review_target: int = 0
    weekly_review_target: int = 0
    new_question_budget: int = 0


class ReviewQueueSnapshotOut(BaseModel):
    due_count: int
    total_count: int
    next_due_at: Optional[str] = None
    recommended_batch_size: int = 0
    state_breakdown: ReviewQueueStateBreakdownOut = Field(default_factory=ReviewQueueStateBreakdownOut)
    upcoming_load: List[ReviewQueueForecastDayOut] = Field(default_factory=list)
    goals: ReviewQueueGoalOut = Field(default_factory=ReviewQueueGoalOut)
    applied_filters: Dict[str, Any] = Field(default_factory=dict)
    items: List[ReviewQueueEntryOut] = Field(default_factory=list)


class StudyWeeklyMetricOut(BaseModel):
    week_start: str
    week_end: str
    label: str
    study_questions: int = 0
    review_questions: int = 0
    scheduled_reviews: int = 0
    completed_sessions: int = 0
    review_sessions: int = 0
    accuracy_percent: float = 0.0
    low_confidence: int = 0


class StudyWeeklyAnalyticsOut(BaseModel):
    weeks: List[StudyWeeklyMetricOut] = Field(default_factory=list)
    summary: Dict[str, Any] = Field(default_factory=dict)


class EngagementGoalOut(BaseModel):
    target: int
    completed: int
    remaining: int
    progress_percent: float
    reached: bool


class EngagementStreakOut(BaseModel):
    current_days: int
    best_days: int
    total_active_days: int
    last_activity_at: Optional[str] = None
    goal_completed_today: bool = False


class EngagementAdaptiveProfileOut(BaseModel):
    recovery_mode: bool = False
    low_confidence_bias: float = 0.0
    variety_floor_percent: float = 0.0
    focus_domains: List[Dict[str, Any]] = Field(default_factory=list)
    last_recomputed_at: Optional[str] = None


class EngagementSnapshotOut(BaseModel):
    daily_goal: EngagementGoalOut
    daily_review_goal: EngagementGoalOut
    weekly_goal: EngagementGoalOut
    weekly_review_goal: EngagementGoalOut
    streak: EngagementStreakOut
    adaptive_profile: EngagementAdaptiveProfileOut
    review_backlog_due: int = 0
    recommended_next_action: str


class StudyReviewQuestionOut(BaseModel):
    id: str
    question_number: int
    prompt: str
    multi_select: bool
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    options: List[OptionOut]
    correct_keys: List[str]
    selected_keys: List[str]
    is_correct: Optional[bool] = None
    confidence_level: Optional[str] = None
    elapsed_seconds: Optional[int] = None
    answered_at: Optional[str] = None
    justification: Optional[str] = None
    tags: Optional[List[str]] = None
    citations: Optional[List[Dict[str, Any]]] = None


class StudySessionReviewOut(BaseModel):
    session: StudyHistoryOut
    result: StudyResultOut
    questions: List[StudyReviewQuestionOut]
