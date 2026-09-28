"""Add navigable exam runtime fields and question issue reporting.

Revision ID: 0012_exam_runtime_and_issue_reporting
Revises: 0011_auth_recovery_and_verification
Create Date: 2026-03-03 11:20:00
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402


revision = "0012_exam_runtime_and_issue_reporting"
down_revision = "0011_auth_recovery_and_verification"
branch_labels = None
depends_on = None

# Idempotent: revision 0008 runs create_all with the current models, so on an empty
# database everything below may already exist. Every operation checks the live
# schema first (see alembic/sq_migration_helpers.py).


def upgrade() -> None:
    h.add_column(
        "exam_sessions",
        sa.Column("experience_mode", sa.String(length=16), nullable=False, server_default="standard"),
    )
    h.add_column(
        "exam_sessions",
        sa.Column("current_position", sa.Integer(), nullable=False, server_default="0"),
    )
    h.create_index("ix_exam_sessions_experience_mode", "exam_sessions", ["experience_mode"], unique=False)

    h.add_column(
        "session_questions",
        sa.Column("marked_for_review", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    h.add_column(
        "session_questions",
        sa.Column("last_viewed_at", sa.DateTime(), nullable=True),
    )
    h.create_index("ix_session_questions_last_viewed_at", "session_questions", ["last_viewed_at"], unique=False)

    h.add_column(
        "session_answers",
        sa.Column("elapsed_seconds", sa.Integer(), nullable=True),
    )

    h.create_table(
        "question_issues",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("question_id", sa.String(length=128), nullable=False),
        sa.Column("question_version_id", sa.Integer(), nullable=True),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="exam"),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_question_issues_owner_scope_xor"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_version_id"], ["question_versions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    h.create_index("ix_question_issues_question_id", "question_issues", ["question_id"], unique=False)
    h.create_index("ix_question_issues_question_version_id", "question_issues", ["question_version_id"], unique=False)
    h.create_index("ix_question_issues_session_id", "question_issues", ["session_id"], unique=False)
    h.create_index("ix_question_issues_user_id", "question_issues", ["user_id"], unique=False)
    h.create_index("ix_question_issues_client_key", "question_issues", ["client_key"], unique=False)
    h.create_index("ix_question_issues_mode", "question_issues", ["mode"], unique=False)
    h.create_index("ix_question_issues_category", "question_issues", ["category"], unique=False)
    h.create_index("ix_question_issues_status", "question_issues", ["status"], unique=False)
    h.create_index("ix_question_issues_created_at", "question_issues", ["created_at"], unique=False)

    h.clear_server_default("exam_sessions", "experience_mode")
    h.clear_server_default("exam_sessions", "current_position")
    h.clear_server_default("session_questions", "marked_for_review")
    h.clear_server_default("question_issues", "mode")
    h.clear_server_default("question_issues", "status")


def downgrade() -> None:
    h.drop_index("ix_question_issues_created_at", "question_issues")
    h.drop_index("ix_question_issues_status", "question_issues")
    h.drop_index("ix_question_issues_category", "question_issues")
    h.drop_index("ix_question_issues_mode", "question_issues")
    h.drop_index("ix_question_issues_client_key", "question_issues")
    h.drop_index("ix_question_issues_user_id", "question_issues")
    h.drop_index("ix_question_issues_session_id", "question_issues")
    h.drop_index("ix_question_issues_question_version_id", "question_issues")
    h.drop_index("ix_question_issues_question_id", "question_issues")
    h.drop_table("question_issues")

    h.drop_column("session_answers", "elapsed_seconds")

    h.drop_index("ix_session_questions_last_viewed_at", "session_questions")
    h.drop_column("session_questions", "last_viewed_at")
    h.drop_column("session_questions", "marked_for_review")

    h.drop_index("ix_exam_sessions_experience_mode", "exam_sessions")
    h.drop_column("exam_sessions", "current_position")
    h.drop_column("exam_sessions", "experience_mode")
