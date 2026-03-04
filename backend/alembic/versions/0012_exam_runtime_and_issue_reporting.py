"""Add navigable exam runtime fields and question issue reporting.

Revision ID: 0012_exam_runtime_and_issue_reporting
Revises: 0011_auth_recovery_and_verification
Create Date: 2026-03-03 11:20:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0012_exam_runtime_and_issue_reporting"
down_revision = "0011_auth_recovery_and_verification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "exam_sessions",
        sa.Column("experience_mode", sa.String(length=16), nullable=False, server_default="standard"),
    )
    op.add_column(
        "exam_sessions",
        sa.Column("current_position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_exam_sessions_experience_mode", "exam_sessions", ["experience_mode"], unique=False)

    op.add_column(
        "session_questions",
        sa.Column("marked_for_review", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "session_questions",
        sa.Column("last_viewed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_session_questions_last_viewed_at", "session_questions", ["last_viewed_at"], unique=False)

    op.add_column(
        "session_answers",
        sa.Column("elapsed_seconds", sa.Integer(), nullable=True),
    )

    op.create_table(
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
    op.create_index("ix_question_issues_question_id", "question_issues", ["question_id"], unique=False)
    op.create_index("ix_question_issues_question_version_id", "question_issues", ["question_version_id"], unique=False)
    op.create_index("ix_question_issues_session_id", "question_issues", ["session_id"], unique=False)
    op.create_index("ix_question_issues_user_id", "question_issues", ["user_id"], unique=False)
    op.create_index("ix_question_issues_client_key", "question_issues", ["client_key"], unique=False)
    op.create_index("ix_question_issues_mode", "question_issues", ["mode"], unique=False)
    op.create_index("ix_question_issues_category", "question_issues", ["category"], unique=False)
    op.create_index("ix_question_issues_status", "question_issues", ["status"], unique=False)
    op.create_index("ix_question_issues_created_at", "question_issues", ["created_at"], unique=False)

    op.alter_column("exam_sessions", "experience_mode", server_default=None)
    op.alter_column("exam_sessions", "current_position", server_default=None)
    op.alter_column("session_questions", "marked_for_review", server_default=None)
    op.alter_column("question_issues", "mode", server_default=None)
    op.alter_column("question_issues", "status", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_question_issues_created_at", table_name="question_issues")
    op.drop_index("ix_question_issues_status", table_name="question_issues")
    op.drop_index("ix_question_issues_category", table_name="question_issues")
    op.drop_index("ix_question_issues_mode", table_name="question_issues")
    op.drop_index("ix_question_issues_client_key", table_name="question_issues")
    op.drop_index("ix_question_issues_user_id", table_name="question_issues")
    op.drop_index("ix_question_issues_session_id", table_name="question_issues")
    op.drop_index("ix_question_issues_question_version_id", table_name="question_issues")
    op.drop_index("ix_question_issues_question_id", table_name="question_issues")
    op.drop_table("question_issues")

    op.drop_column("session_answers", "elapsed_seconds")

    op.drop_index("ix_session_questions_last_viewed_at", table_name="session_questions")
    op.drop_column("session_questions", "last_viewed_at")
    op.drop_column("session_questions", "marked_for_review")

    op.drop_index("ix_exam_sessions_experience_mode", table_name="exam_sessions")
    op.drop_column("exam_sessions", "current_position")
    op.drop_column("exam_sessions", "experience_mode")
