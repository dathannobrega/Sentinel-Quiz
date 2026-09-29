"""Exam (simulado) sessions - thin facade (M-C6).

The implementation is split into cohesive modules; this module re-exports their
public (and a few historically imported private) names so existing imports keep
working:

- :mod:`app.services.exam_timing` - session config, timer/pause metadata, serialization.
- :mod:`app.services.exam_session_create` - question pool selection and session creation.
- :mod:`app.services.exam_results` - grading analysis and read-only results.
- :mod:`app.services.exam_finalize` - lifecycle (sync/expiry/lock/complete/pause/resume)
  and the one-time finalization of progress/metrics/SRS (M-C2).
- :mod:`app.services.weak_areas` - domain catalog and weak-area snapshot.
"""
from __future__ import annotations

from app.services.exam_finalize import (  # noqa: F401
    _claim_completion,
    complete_exam_session,
    exam_session_expired,
    expire_exam_session_if_due,
    finalize_exam_session,
    lock_exam_session,
    pause_exam_session,
    resume_exam_session,
    sync_exam_session_state,
)
from app.services.exam_results import (  # noqa: F401
    PASS_THRESHOLD,
    _analyze_session,
    _get_session_rows,
    _pass_threshold_from_rows,
    compute_result,
)
from app.services.exam_session_create import (  # noqa: F401
    _build_exam_question_pool,
    create_session,
    get_question_for_session,
    session_option_mapping,
)
from app.services.exam_timing import (  # noqa: F401
    DEFAULT_EXAM_MAX_PAUSE_SECONDS,
    DEFAULT_EXAM_PAUSE_LIMIT,
    DEFAULT_EXAM_SECONDS_PER_QUESTION,
    MIN_EXAM_TIME_LIMIT_SECONDS,
    _build_exam_timing_metadata,
    exam_answers_are_hidden,
    serialize_exam_session,
)
from app.services.weak_areas import (  # noqa: F401
    WEAK_AREA_LOW_ACCURACY_PERCENT,
    WEAK_AREA_ON_TRACK_PERCENT,
    build_domain_catalog,
    build_weak_area_snapshot,
    build_weak_area_snapshot_for_owner,
)

__all__ = [
    "PASS_THRESHOLD",
    "build_domain_catalog",
    "build_weak_area_snapshot",
    "build_weak_area_snapshot_for_owner",
    "complete_exam_session",
    "compute_result",
    "create_session",
    "exam_answers_are_hidden",
    "exam_session_expired",
    "expire_exam_session_if_due",
    "finalize_exam_session",
    "get_question_for_session",
    "lock_exam_session",
    "pause_exam_session",
    "resume_exam_session",
    "serialize_exam_session",
    "session_option_mapping",
    "sync_exam_session_state",
]
