"""Facade for the study services (M-C6).

The former 2.9k-line module was split into cohesive modules; this facade keeps
``app.services.study`` importable with the same public names:

* :mod:`app.services.study_state` - bookmarks/notes, overview, device claim
* :mod:`app.services.review_queue` - SM-2 review queue policy and snapshot
* :mod:`app.services.study_plan` - study plan, placement and study modules (track)
* :mod:`app.services.study_analytics` - weekly analytics and history
* :mod:`app.services.study_session` - session lifecycle (pool, answers, results, review)
* shared with the exam flow: :mod:`app.services.owner_scope`,
  :mod:`app.services.question_pool`, :mod:`app.services.serialization`,
  :mod:`app.services.option_order`
"""
from __future__ import annotations

from app.services.review_queue import (
    REVIEW_FORECAST_DAYS,
    build_review_queue_snapshot,
    schedule_exam_answer_for_review,
)
from app.services.serialization import SAFE_FEEDBACK_MAX_CHARS, feedback_explanation
from app.services.study_analytics import (
    WEEKLY_ANALYTICS_DEFAULT_WEEKS,
    build_weekly_study_analytics,
    list_study_history,
)
from app.services.study_plan import (
    PLACEMENT_MIN_QUESTION_COUNT,
    build_study_plan,
    list_study_modules,
    placement_completed_by_session,
)
from app.services.study_session import (
    answer_study_question,
    compute_study_result,
    create_placement_session,
    create_study_session,
    get_question_for_study_session,
    get_study_session_review,
    serialize_study_session,
)
from app.services.study_state import (
    NOTE_MAX_LENGTH,
    QUEUE_PREVIEW_LIMIT,
    RECENT_ITEM_LIMIT,
    build_study_overview,
    claim_client_study_state,
    count_due_review_items,
    get_question_state,
    set_question_state,
)

__all__ = [
    "NOTE_MAX_LENGTH",
    "PLACEMENT_MIN_QUESTION_COUNT",
    "QUEUE_PREVIEW_LIMIT",
    "RECENT_ITEM_LIMIT",
    "REVIEW_FORECAST_DAYS",
    "SAFE_FEEDBACK_MAX_CHARS",
    "WEEKLY_ANALYTICS_DEFAULT_WEEKS",
    "answer_study_question",
    "build_review_queue_snapshot",
    "build_study_overview",
    "build_study_plan",
    "build_weekly_study_analytics",
    "claim_client_study_state",
    "compute_study_result",
    "count_due_review_items",
    "create_placement_session",
    "create_study_session",
    "feedback_explanation",
    "get_question_for_study_session",
    "get_question_state",
    "get_study_session_review",
    "list_study_history",
    "list_study_modules",
    "placement_completed_by_session",
    "schedule_exam_answer_for_review",
    "serialize_study_session",
    "set_question_state",
]
