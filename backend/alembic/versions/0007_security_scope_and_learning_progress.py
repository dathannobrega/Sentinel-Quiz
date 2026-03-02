"""Add scoped ownership constraints and learning-centric question progress.

Revision ID: 0007_security_scope_and_learning_progress
Revises: 0006_editorial_versioning_and_audit
Create Date: 2026-03-02 23:25:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0007_security_scope_and_learning_progress"
down_revision = "0006_editorial_versioning_and_audit"
branch_labels = None
depends_on = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _check_constraint_names(inspector, table_name: str) -> set[str]:
    try:
        constraints = inspector.get_check_constraints(table_name)
    except NotImplementedError:
        return set()
    return {item.get("name") for item in constraints if item.get("name")}


def _create_scope_constraint(inspector, table_name: str, constraint_name: str) -> None:
    if table_name not in _table_names(inspector):
        return
    if constraint_name in _check_constraint_names(inspector, table_name):
        return
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        return
    op.create_check_constraint(
        constraint_name,
        table_name,
        "(user_id IS NULL) <> (client_key IS NULL)",
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "user_question_progress" not in tables:
        op.create_table(
            "user_question_progress",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("client_key", sa.String(length=64), nullable=True),
            sa.Column("question_id", sa.String(length=128), nullable=False),
            sa.Column("first_seen_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("last_seen_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("total_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("exam_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("study_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("correct_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("wrong_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("correct_streak", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("wrong_streak", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("mastery_score", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("last_mode", sa.String(length=16), nullable=False, server_default=sa.text("'exam'")),
            sa.Column("last_confidence_level", sa.String(length=16), nullable=True),
            sa.Column("last_is_correct", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
            sa.CheckConstraint(
                "(user_id IS NULL) <> (client_key IS NULL)",
                name="ck_user_question_progress_owner_scope_xor",
            ),
            sa.UniqueConstraint("user_id", "question_id", name="uq_user_question_progress_user_question"),
            sa.UniqueConstraint("client_key", "question_id", name="uq_user_question_progress_client_question"),
        )
        op.create_index("ix_user_question_progress_user_id", "user_question_progress", ["user_id"], unique=False)
        op.create_index("ix_user_question_progress_client_key", "user_question_progress", ["client_key"], unique=False)
        op.create_index("ix_user_question_progress_question_id", "user_question_progress", ["question_id"], unique=False)
        op.create_index("ix_user_question_progress_last_seen_at", "user_question_progress", ["last_seen_at"], unique=False)

    inspector = sa.inspect(bind)
    _create_scope_constraint(inspector, "user_bookmarks", "ck_user_bookmarks_owner_scope_xor")
    inspector = sa.inspect(bind)
    _create_scope_constraint(inspector, "user_notes", "ck_user_notes_owner_scope_xor")
    inspector = sa.inspect(bind)
    _create_scope_constraint(inspector, "exam_sessions", "ck_exam_sessions_owner_scope_xor")
    inspector = sa.inspect(bind)
    _create_scope_constraint(inspector, "study_sessions", "ck_study_sessions_owner_scope_xor")
    inspector = sa.inspect(bind)
    _create_scope_constraint(inspector, "review_queue", "ck_review_queue_owner_scope_xor")


def downgrade() -> None:
    raise RuntimeError("This migration is intentionally irreversible.")
