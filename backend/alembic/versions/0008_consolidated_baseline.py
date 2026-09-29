"""Baseline schema (frozen snapshot of the pre-0009 schema).

Revision ID: 0008_question_stats_snapshot
Revises:
Create Date: 2026-03-03 01:05:00

This baseline used to call ``Base.metadata.create_all`` with the *current* models,
which made the result of ``upgrade head`` depend on whatever models.py looked like
at the time and forced every later revision to be idempotent. It is now an explicit,
frozen definition of the schema as it was at this revision (reconstructed from a
database migrated to head and downgraded back to 0008 on PostgreSQL). Later revisions
(0009+) add everything else. They keep their idempotent helpers, which is harmless and
still lets databases created by the old create_all baseline (already at head) upgrade.

NEVER import app.models here: this file must not change when the models change.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import context, op


# The revision id from the previous head is preserved so local databases already
# stamped at the latest pre-consolidation revision remain compatible.
revision = "0008_question_stats_snapshot"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind() if not context.is_offline_mode() else None
    if bind is not None and sa.inspect(bind).has_table("users"):
        # Database bootstrapped out of band (e.g. BOOTSTRAP_SCHEMA=true create_all):
        # nothing to create; later revisions are idempotent.
        return
    op.create_table(
        "exams",
        sa.Column("id", sa.String(length=128), primary_key=True, nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("source", sa.String(length=255), nullable=True),
        sa.Column("question_count", sa.Integer(), nullable=True),
    )

    op.create_table(
        "import_state",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("imported_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("file_name", "file_sha256", name="uq_import_file_hash"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("email"),
    )

    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash"),
    )

    op.create_table(
        "editorial_audit_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("question_bank_id", sa.String(length=128), nullable=True),
        sa.Column("question_version_id", sa.Integer(), nullable=True),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column("actor_role", sa.String(length=32), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "exam_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("exam_id", sa.String(length=128), nullable=True),
        sa.Column("selection_strategy", sa.String(length=24), nullable=False),
        sa.Column("selection_mix_json", sa.Text(), nullable=True),
        sa.Column("total_questions", sa.Integer(), nullable=False),
        sa.Column("current_index", sa.Integer(), nullable=False),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("wrong_count", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_exam_sessions_owner_scope_xor"),
    )

    op.create_table(
        "question_bank",
        sa.Column("stable_question_id", sa.String(length=128), primary_key=True, nullable=False),
        sa.Column("published_version_id", sa.Integer(), nullable=True),
        sa.Column("draft_version_id", sa.Integer(), nullable=True),
        sa.Column("review_status", sa.String(length=24), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("updated_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "questions",
        sa.Column("id", sa.String(length=128), primary_key=True, nullable=False),
        sa.Column("exam_id", sa.String(length=128), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("multi_select", sa.Boolean(), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=True),
        sa.Column("difficulty", sa.String(length=64), nullable=True),
        sa.Column("certification", sa.String(length=64), nullable=True),
        sa.Column("tags_json", sa.Text(), nullable=True),
        sa.Column("citations_json", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "study_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("exam_id", sa.String(length=128), nullable=True),
        sa.Column("selection_strategy", sa.String(length=24), nullable=False),
        sa.Column("selection_mix_json", sa.Text(), nullable=True),
        sa.Column("total_questions", sa.Integer(), nullable=False),
        sa.Column("current_index", sa.Integer(), nullable=False),
        sa.Column("answered_count", sa.Integer(), nullable=False),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("wrong_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_study_sessions_owner_scope_xor"),
    )

    op.create_table(
        "explanations",
        sa.Column("question_id", sa.String(length=128), primary_key=True, nullable=False),
        sa.Column("justification", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "options",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("key", sa.String(length=8), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("question_id", "key", name="uq_option_question_key"),
    )

    op.create_table(
        "question_versions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("question_bank_id", sa.String(length=128), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("exam_id", sa.String(length=128), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("multi_select", sa.Boolean(), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=True),
        sa.Column("difficulty", sa.String(length=64), nullable=True),
        sa.Column("certification", sa.String(length=64), nullable=True),
        sa.Column("tags_json", sa.Text(), nullable=True),
        sa.Column("citations_json", sa.Text(), nullable=True),
        sa.Column("justification", sa.Text(), nullable=True),
        sa.Column("change_summary", sa.Text(), nullable=True),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("updated_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("approved_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["question_bank_id"], ["question_bank.stable_question_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("question_bank_id", "version_number", name="uq_question_versions_bank_version"),
    )

    op.create_table(
        "review_queue",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=False),
        sa.Column("interval_days", sa.Integer(), nullable=False),
        sa.Column("repetition_count", sa.Integer(), nullable=False),
        sa.Column("lapse_count", sa.Integer(), nullable=False),
        sa.Column("ease_factor", sa.Float(), nullable=False),
        sa.Column("stability_score", sa.Float(), nullable=False),
        sa.Column("last_quality", sa.Integer(), nullable=False),
        sa.Column("last_outcome", sa.String(length=16), nullable=False),
        sa.Column("confidence_level", sa.String(length=16), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("client_key", "question_id", name="uq_review_queue_client_question"),
        sa.UniqueConstraint("user_id", "question_id", name="uq_review_queue_user_question"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_review_queue_owner_scope_xor"),
    )

    op.create_table(
        "session_answers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("selected_keys", sa.String(length=255), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("answered_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["exam_sessions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("session_id", "question_id", name="uq_session_question_answer"),
    )

    op.create_table(
        "session_questions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["exam_sessions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("session_id", "position", name="uq_session_position"),
    )

    op.create_table(
        "study_attempts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("selected_keys", sa.String(length=255), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("confidence_level", sa.String(length=16), nullable=False),
        sa.Column("elapsed_seconds", sa.Integer(), nullable=True),
        sa.Column("answered_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["study_sessions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("session_id", "question_id", name="uq_study_attempt_session_question"),
    )

    op.create_table(
        "study_session_questions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["study_sessions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("session_id", "position", name="uq_study_session_position"),
    )

    op.create_table(
        "user_bookmarks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("client_key", "question_id", name="uq_user_bookmarks_client_question"),
        sa.UniqueConstraint("user_id", "question_id", name="uq_user_bookmarks_user_question"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_user_bookmarks_owner_scope_xor"),
    )

    op.create_table(
        "user_notes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("note_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("client_key", "question_id", name="uq_user_notes_client_question"),
        sa.UniqueConstraint("user_id", "question_id", name="uq_user_notes_user_question"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_user_notes_owner_scope_xor"),
    )

    op.create_table(
        "user_question_progress",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("total_attempts", sa.Integer(), nullable=False),
        sa.Column("exam_attempts", sa.Integer(), nullable=False),
        sa.Column("study_attempts", sa.Integer(), nullable=False),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("wrong_count", sa.Integer(), nullable=False),
        sa.Column("correct_streak", sa.Integer(), nullable=False),
        sa.Column("wrong_streak", sa.Integer(), nullable=False),
        sa.Column("mastery_score", sa.Float(), nullable=False),
        sa.Column("last_mode", sa.String(length=16), nullable=False),
        sa.Column("last_confidence_level", sa.String(length=16), nullable=True),
        sa.Column("last_is_correct", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("client_key", "question_id", name="uq_user_question_progress_client_question"),
        sa.UniqueConstraint("user_id", "question_id", name="uq_user_question_progress_user_question"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_user_question_progress_owner_scope_xor"),
    )

    op.create_table(
        "question_stats_snapshot",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("capture_batch_id", sa.String(length=36), nullable=False),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("question_version_id", sa.Integer(), nullable=True),
        sa.Column("exam_id", sa.String(length=128), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=True),
        sa.Column("certification", sa.String(length=64), nullable=True),
        sa.Column("attempts_total", sa.Integer(), nullable=False),
        sa.Column("exam_attempts", sa.Integer(), nullable=False),
        sa.Column("study_attempts", sa.Integer(), nullable=False),
        sa.Column("wrong_count", sa.Integer(), nullable=False),
        sa.Column("wrong_rate_percent", sa.Float(), nullable=False),
        sa.Column("low_confidence_count", sa.Integer(), nullable=False),
        sa.Column("low_confidence_rate_percent", sa.Float(), nullable=False),
        sa.Column("review_pressure_count", sa.Integer(), nullable=False),
        sa.Column("avg_study_elapsed_seconds", sa.Float(), nullable=True),
        sa.Column("difficulty_score", sa.Float(), nullable=False),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_version_id"], ["question_versions.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "question_version_options",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=8), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["version_id"], ["question_versions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("version_id", "key", name="uq_question_version_options_version_key"),
    )

    op.create_table(
        "review_schedule",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("review_queue_id", sa.Integer(), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(), nullable=False),
        sa.Column("interval_days", sa.Integer(), nullable=False),
        sa.Column("trigger_reason", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["review_queue_id"], ["review_queue.id"], ondelete="CASCADE"),
    )

    op.create_index("ix_auth_tokens_expires_at", "auth_tokens", ["expires_at"], unique=False)
    op.create_index("ix_auth_tokens_revoked_at", "auth_tokens", ["revoked_at"], unique=False)
    op.create_index("ix_auth_tokens_user_id", "auth_tokens", ["user_id"], unique=False)
    op.create_index("ix_editorial_audit_log_action", "editorial_audit_log", ["action"], unique=False)
    op.create_index("ix_editorial_audit_log_actor_user_id", "editorial_audit_log", ["actor_user_id"], unique=False)
    op.create_index("ix_editorial_audit_log_created_at", "editorial_audit_log", ["created_at"], unique=False)
    op.create_index("ix_editorial_audit_log_question_bank_id", "editorial_audit_log", ["question_bank_id"], unique=False)
    op.create_index("ix_editorial_audit_log_question_version_id", "editorial_audit_log", ["question_version_id"], unique=False)
    op.create_index("ix_exam_sessions_client_key", "exam_sessions", ["client_key"], unique=False)
    op.create_index("ix_exam_sessions_completed_at", "exam_sessions", ["completed_at"], unique=False)
    op.create_index("ix_exam_sessions_selection_strategy", "exam_sessions", ["selection_strategy"], unique=False)
    op.create_index("ix_exam_sessions_user_id", "exam_sessions", ["user_id"], unique=False)
    op.create_index("ix_question_bank_created_by_user_id", "question_bank", ["created_by_user_id"], unique=False)
    op.create_index("ix_question_bank_review_status", "question_bank", ["review_status"], unique=False)
    op.create_index("ix_question_bank_updated_by_user_id", "question_bank", ["updated_by_user_id"], unique=False)
    op.create_index("ix_study_sessions_client_key", "study_sessions", ["client_key"], unique=False)
    op.create_index("ix_study_sessions_completed_at", "study_sessions", ["completed_at"], unique=False)
    op.create_index("ix_study_sessions_selection_strategy", "study_sessions", ["selection_strategy"], unique=False)
    op.create_index("ix_study_sessions_user_id", "study_sessions", ["user_id"], unique=False)
    op.create_index("ix_question_versions_approved_by_user_id", "question_versions", ["approved_by_user_id"], unique=False)
    op.create_index("ix_question_versions_created_by_user_id", "question_versions", ["created_by_user_id"], unique=False)
    op.create_index("ix_question_versions_published_at", "question_versions", ["published_at"], unique=False)
    op.create_index("ix_question_versions_question_bank_id", "question_versions", ["question_bank_id"], unique=False)
    op.create_index("ix_question_versions_status", "question_versions", ["status"], unique=False)
    op.create_index("ix_question_versions_updated_by_user_id", "question_versions", ["updated_by_user_id"], unique=False)
    op.create_index("ix_review_queue_client_key", "review_queue", ["client_key"], unique=False)
    op.create_index("ix_review_queue_due_at", "review_queue", ["due_at"], unique=False)
    op.create_index("ix_review_queue_question_id", "review_queue", ["question_id"], unique=False)
    op.create_index("ix_review_queue_user_id", "review_queue", ["user_id"], unique=False)
    op.create_index("ix_study_attempts_answered_at", "study_attempts", ["answered_at"], unique=False)
    op.create_index("ix_study_attempts_question_id", "study_attempts", ["question_id"], unique=False)
    op.create_index("ix_study_attempts_session_id", "study_attempts", ["session_id"], unique=False)
    op.create_index("ix_user_bookmarks_client_key", "user_bookmarks", ["client_key"], unique=False)
    op.create_index("ix_user_bookmarks_question_id", "user_bookmarks", ["question_id"], unique=False)
    op.create_index("ix_user_bookmarks_user_id", "user_bookmarks", ["user_id"], unique=False)
    op.create_index("ix_user_notes_client_key", "user_notes", ["client_key"], unique=False)
    op.create_index("ix_user_notes_question_id", "user_notes", ["question_id"], unique=False)
    op.create_index("ix_user_notes_user_id", "user_notes", ["user_id"], unique=False)
    op.create_index("ix_user_question_progress_client_key", "user_question_progress", ["client_key"], unique=False)
    op.create_index("ix_user_question_progress_last_seen_at", "user_question_progress", ["last_seen_at"], unique=False)
    op.create_index("ix_user_question_progress_question_id", "user_question_progress", ["question_id"], unique=False)
    op.create_index("ix_user_question_progress_user_id", "user_question_progress", ["user_id"], unique=False)
    op.create_index("ix_question_stats_snapshot_capture_batch_id", "question_stats_snapshot", ["capture_batch_id"], unique=False)
    op.create_index("ix_question_stats_snapshot_captured_at", "question_stats_snapshot", ["captured_at"], unique=False)
    op.create_index("ix_question_stats_snapshot_certification", "question_stats_snapshot", ["certification"], unique=False)
    op.create_index("ix_question_stats_snapshot_domain", "question_stats_snapshot", ["domain"], unique=False)
    op.create_index("ix_question_stats_snapshot_exam_id", "question_stats_snapshot", ["exam_id"], unique=False)
    op.create_index("ix_question_stats_snapshot_question_id", "question_stats_snapshot", ["question_id"], unique=False)
    op.create_index("ix_question_stats_snapshot_question_version_id", "question_stats_snapshot", ["question_version_id"], unique=False)
    op.create_index("ix_question_version_options_version_id", "question_version_options", ["version_id"], unique=False)
    op.create_index("ix_review_schedule_review_queue_id", "review_schedule", ["review_queue_id"], unique=False)
    op.create_index("ix_review_schedule_scheduled_for", "review_schedule", ["scheduled_for"], unique=False)


def downgrade() -> None:
    if context.is_offline_mode():
        raise RuntimeError("Offline SQL generation is not supported for the baseline downgrade.")
    bind = op.get_bind()
    # Drop what actually exists (reflected): later downgrades may already have removed
    # objects, and databases created by the old create_all baseline may have more.
    reflected = sa.MetaData()
    reflected.reflect(bind=bind)
    if bind.dialect.name == "postgresql":
        for name in reflected.tables:
            if name != "alembic_version":
                op.execute(sa.text(f'DROP TABLE IF EXISTS "{name}" CASCADE'))
        return
    for table in reversed(reflected.sorted_tables):
        if table.name != "alembic_version":
            op.execute(sa.text(f'DROP TABLE IF EXISTS "{table.name}"'))
