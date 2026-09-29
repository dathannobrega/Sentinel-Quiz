"""Timezone-aware timestamps (L-A2).

Revision ID: 0015_timezone_aware_timestamps
Revises: 0014_content_lifecycle_and_integrity
Create Date: 2026-09-29 12:00:00

Every DateTime column becomes ``TIMESTAMP WITH TIME ZONE`` on PostgreSQL. Existing
values were written as naive UTC (``datetime.utcnow()``), so they are converted with
``USING col AT TIME ZONE 'UTC'`` (the instant is preserved, independent of the server
or session TimeZone). One ``ALTER TABLE`` per table, so each table is rewritten once.

SQLite has no timestamp-with-time-zone storage: nothing changes on disk there; the
application type (``app.db.types.UTCDateTime``) stores naive UTC and reads aware UTC.

Idempotent: columns that are already ``timestamptz`` (or missing) are skipped.
Downgrade converts the columns this revision changed back to ``timestamp without time
zone`` holding UTC (``questions.deactivated_at`` and ``study_modules.created_at/
updated_at`` were already ``timestamptz`` in 0014 and are left alone).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa
from alembic import op

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0015_timezone_aware_timestamps"
down_revision = "0014_content_lifecycle_and_integrity"
branch_labels = None
depends_on = None


# Frozen list (do not derive from the models): naive DateTime columns as of 0014.
NAIVE_TIMESTAMP_COLUMNS: dict[str, tuple[str, ...]] = {
    "adaptive_profile": ("last_recomputed_at", "created_at", "updated_at"),
    "auth_challenges": ("created_at", "expires_at", "consumed_at"),
    "auth_tokens": ("created_at", "expires_at", "last_used_at", "revoked_at"),
    "domain_blueprint": ("created_at", "updated_at"),
    "domain_catalog": ("created_at", "updated_at"),
    "editorial_audit_log": ("created_at",),
    "exam_sessions": ("created_at", "completed_at"),
    "import_state": ("imported_at",),
    "placement_state": ("placement_completed_at", "created_at", "updated_at"),
    "question_bank": ("created_at", "updated_at"),
    "question_hints": ("created_at", "updated_at"),
    "question_issues": ("triaged_at", "resolved_at", "created_at", "updated_at"),
    "question_references": ("created_at",),
    "question_stats_snapshot": ("captured_at",),
    "question_versions": ("created_at", "updated_at", "published_at"),
    "reference_catalog": ("created_at", "updated_at"),
    "review_queue": ("due_at", "last_attempt_at", "created_at", "updated_at"),
    "review_schedule": ("scheduled_for", "created_at"),
    "session_answers": ("answered_at",),
    "session_questions": ("last_viewed_at",),
    "study_attempts": ("answered_at",),
    "study_sessions": ("created_at", "completed_at"),
    "user_bookmarks": ("created_at", "updated_at"),
    "user_domain_metrics_daily": ("metric_date", "updated_at"),
    "user_exam_metrics_snapshot": ("completed_at", "created_at", "updated_at"),
    "user_goals": ("created_at", "updated_at"),
    "user_notes": ("created_at", "updated_at"),
    "user_question_progress": ("first_seen_at", "last_seen_at", "created_at", "updated_at"),
    "user_streaks": ("last_activity_date", "last_goal_completed_date", "created_at", "updated_at"),
    "users": ("email_verified_at", "created_at", "updated_at"),
    "weekly_progress_snapshot": ("week_start", "updated_at"),
}


def _columns_with_timezone(table: str, columns: tuple[str, ...], *, timezone: bool) -> list[str]:
    """Columns of ``table`` (among ``columns``) that are timestamps with/without tz."""
    if not h.has_table(table):
        return []
    live = {col["name"]: col["type"] for col in h.inspector().get_columns(table)}
    found = []
    for name in columns:
        col_type = live.get(name)
        if isinstance(col_type, sa.DateTime) and bool(getattr(col_type, "timezone", False)) == timezone:
            found.append(name)
    return found


def _alter(table: str, columns: list[str], target: str) -> None:
    clauses = ", ".join(
        f'ALTER COLUMN "{name}" TYPE {target} USING "{name}" AT TIME ZONE \'UTC\'' for name in columns
    )
    op.execute(sa.text(f'ALTER TABLE "{table}" {clauses}'))


def upgrade() -> None:
    if h.dialect() != "postgresql":
        return
    for table, columns in NAIVE_TIMESTAMP_COLUMNS.items():
        pending = _columns_with_timezone(table, columns, timezone=False)
        if pending:
            _alter(table, pending, "TIMESTAMP WITH TIME ZONE")


def downgrade() -> None:
    if h.dialect() != "postgresql":
        return
    for table, columns in NAIVE_TIMESTAMP_COLUMNS.items():
        pending = _columns_with_timezone(table, columns, timezone=True)
        if pending:
            _alter(table, pending, "TIMESTAMP WITHOUT TIME ZONE")
