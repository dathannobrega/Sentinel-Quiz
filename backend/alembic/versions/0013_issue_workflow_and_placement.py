"""Add issue workflow metadata and placement state.

Revision ID: 0013_issue_workflow_and_placement
Revises: 0012_exam_runtime_and_issue_reporting
Create Date: 2026-03-04 10:30:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0013_issue_workflow_and_placement"
down_revision = "0012_exam_runtime_and_issue_reporting"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("question_issues", sa.Column("internal_note", sa.Text(), nullable=True))
    op.add_column("question_issues", sa.Column("triaged_by_user_id", sa.String(length=36), nullable=True))
    op.add_column("question_issues", sa.Column("triaged_at", sa.DateTime(), nullable=True))
    op.add_column("question_issues", sa.Column("resolved_version_id", sa.Integer(), nullable=True))
    op.add_column("question_issues", sa.Column("resolved_by_user_id", sa.String(length=36), nullable=True))
    op.add_column("question_issues", sa.Column("resolved_at", sa.DateTime(), nullable=True))
    op.create_foreign_key(
        "fk_question_issues_triaged_by_user_id",
        "question_issues",
        "users",
        ["triaged_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_question_issues_resolved_by_user_id",
        "question_issues",
        "users",
        ["resolved_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_question_issues_resolved_version_id",
        "question_issues",
        "question_versions",
        ["resolved_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_question_issues_triaged_by_user_id", "question_issues", ["triaged_by_user_id"], unique=False)
    op.create_index("ix_question_issues_triaged_at", "question_issues", ["triaged_at"], unique=False)
    op.create_index("ix_question_issues_resolved_version_id", "question_issues", ["resolved_version_id"], unique=False)
    op.create_index("ix_question_issues_resolved_by_user_id", "question_issues", ["resolved_by_user_id"], unique=False)
    op.create_index("ix_question_issues_resolved_at", "question_issues", ["resolved_at"], unique=False)

    op.create_table(
        "placement_state",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("placement_completed_at", sa.DateTime(), nullable=True),
        sa.Column("placement_exam_id", sa.String(length=128), nullable=True),
        sa.Column("placement_question_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_placement_state_owner_scope_xor"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_placement_state_user"),
        sa.UniqueConstraint("client_key", name="uq_placement_state_client"),
    )
    op.create_index("ix_placement_state_user_id", "placement_state", ["user_id"], unique=False)
    op.create_index("ix_placement_state_client_key", "placement_state", ["client_key"], unique=False)
    op.create_index("ix_placement_state_placement_completed_at", "placement_state", ["placement_completed_at"], unique=False)
    op.create_index("ix_placement_state_placement_exam_id", "placement_state", ["placement_exam_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_placement_state_placement_exam_id", table_name="placement_state")
    op.drop_index("ix_placement_state_placement_completed_at", table_name="placement_state")
    op.drop_index("ix_placement_state_client_key", table_name="placement_state")
    op.drop_index("ix_placement_state_user_id", table_name="placement_state")
    op.drop_table("placement_state")

    op.drop_index("ix_question_issues_resolved_at", table_name="question_issues")
    op.drop_index("ix_question_issues_resolved_by_user_id", table_name="question_issues")
    op.drop_index("ix_question_issues_resolved_version_id", table_name="question_issues")
    op.drop_index("ix_question_issues_triaged_at", table_name="question_issues")
    op.drop_index("ix_question_issues_triaged_by_user_id", table_name="question_issues")
    op.drop_constraint("fk_question_issues_resolved_version_id", "question_issues", type_="foreignkey")
    op.drop_constraint("fk_question_issues_resolved_by_user_id", "question_issues", type_="foreignkey")
    op.drop_constraint("fk_question_issues_triaged_by_user_id", "question_issues", type_="foreignkey")
    op.drop_column("question_issues", "resolved_at")
    op.drop_column("question_issues", "resolved_by_user_id")
    op.drop_column("question_issues", "resolved_version_id")
    op.drop_column("question_issues", "triaged_at")
    op.drop_column("question_issues", "triaged_by_user_id")
    op.drop_column("question_issues", "internal_note")
