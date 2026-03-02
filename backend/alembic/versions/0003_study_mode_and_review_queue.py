"""Add dedicated study sessions, attempts, and review queue.

Revision ID: 0003_study_mode_and_review_queue
Revises: 0002_user_study_state
Create Date: 2026-03-02 12:05:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0003_study_mode_and_review_queue"
down_revision = "0002_user_study_state"
branch_labels = None
depends_on = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = _table_names(inspector)

    if "study_sessions" not in table_names:
        op.create_table(
            "study_sessions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("client_key", sa.String(length=64), nullable=True),
            sa.Column("exam_id", sa.String(length=128), nullable=True),
            sa.Column("total_questions", sa.Integer(), nullable=False, server_default=sa.text("30")),
            sa.Column("current_index", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("answered_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("correct_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("wrong_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        table_names.add("study_sessions")

    if "study_session_questions" not in table_names:
        op.create_table(
            "study_session_questions",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=False),
            sa.Column("question_id", sa.String(length=128), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["session_id"], ["study_sessions.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("session_id", "position", name="uq_study_session_position"),
        )
        table_names.add("study_session_questions")

    if "study_attempts" not in table_names:
        op.create_table(
            "study_attempts",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=False),
            sa.Column("question_id", sa.String(length=128), nullable=False),
            sa.Column("selected_keys", sa.String(length=255), nullable=False),
            sa.Column("is_correct", sa.Boolean(), nullable=False),
            sa.Column("confidence_level", sa.String(length=16), nullable=False, server_default=sa.text("'medium'")),
            sa.Column("elapsed_seconds", sa.Integer(), nullable=True),
            sa.Column("answered_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["session_id"], ["study_sessions.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("session_id", "question_id", name="uq_study_attempt_session_question"),
        )
        table_names.add("study_attempts")

    if "review_queue" not in table_names:
        op.create_table(
            "review_queue",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("client_key", sa.String(length=64), nullable=True),
            sa.Column("question_id", sa.String(length=128), nullable=False),
            sa.Column("due_at", sa.DateTime(), nullable=False),
            sa.Column("interval_days", sa.Integer(), nullable=False, server_default=sa.text("1")),
            sa.Column("last_outcome", sa.String(length=16), nullable=False, server_default=sa.text("'wrong'")),
            sa.Column("confidence_level", sa.String(length=16), nullable=False, server_default=sa.text("'low'")),
            sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "question_id", name="uq_review_queue_user_question"),
            sa.UniqueConstraint("client_key", "question_id", name="uq_review_queue_client_question"),
        )
        table_names.add("review_queue")

    if "review_schedule" not in table_names:
        op.create_table(
            "review_schedule",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("review_queue_id", sa.Integer(), nullable=False),
            sa.Column("scheduled_for", sa.DateTime(), nullable=False),
            sa.Column("interval_days", sa.Integer(), nullable=False),
            sa.Column("trigger_reason", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["review_queue_id"], ["review_queue.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        table_names.add("review_schedule")

    inspector = sa.inspect(bind)

    for table_name, indexes in {
        "study_sessions": {
            "ix_study_sessions_completed_at": ["completed_at"],
            "ix_study_sessions_user_id": ["user_id"],
            "ix_study_sessions_client_key": ["client_key"],
        },
        "study_attempts": {
            "ix_study_attempts_session_id": ["session_id"],
            "ix_study_attempts_question_id": ["question_id"],
            "ix_study_attempts_answered_at": ["answered_at"],
        },
        "review_queue": {
            "ix_review_queue_user_id": ["user_id"],
            "ix_review_queue_client_key": ["client_key"],
            "ix_review_queue_question_id": ["question_id"],
            "ix_review_queue_due_at": ["due_at"],
        },
        "review_schedule": {
            "ix_review_schedule_review_queue_id": ["review_queue_id"],
            "ix_review_schedule_scheduled_for": ["scheduled_for"],
        },
    }.items():
        if table_name not in _table_names(inspector):
            continue
        existing_indexes = _index_names(inspector, table_name)
        for index_name, columns in indexes.items():
            if index_name not in existing_indexes:
                op.create_index(index_name, table_name, columns, unique=False)
        inspector = sa.inspect(bind)


def downgrade() -> None:
    raise RuntimeError("This migration is intentionally irreversible.")
