"""Add issue workflow metadata and placement state.

Revision ID: 0013_issue_workflow_and_placement
Revises: 0012_exam_runtime_and_issue_reporting
Create Date: 2026-03-04 10:30:00
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402


revision = "0013_issue_workflow_and_placement"
down_revision = "0012_exam_runtime_and_issue_reporting"
branch_labels = None
depends_on = None

# Idempotent: revision 0008 runs create_all with the current models, so on an empty
# database everything below may already exist. Every operation checks the live
# schema first (see alembic/sq_migration_helpers.py).


def upgrade() -> None:
    h.add_column("question_issues", sa.Column("internal_note", sa.Text(), nullable=True))
    h.add_column("question_issues", sa.Column("triaged_by_user_id", sa.String(length=36), nullable=True))
    h.add_column("question_issues", sa.Column("triaged_at", sa.DateTime(), nullable=True))
    h.add_column("question_issues", sa.Column("resolved_version_id", sa.Integer(), nullable=True))
    h.add_column("question_issues", sa.Column("resolved_by_user_id", sa.String(length=36), nullable=True))
    h.add_column("question_issues", sa.Column("resolved_at", sa.DateTime(), nullable=True))
    h.create_foreign_key(
        "fk_question_issues_triaged_by_user_id",
        "question_issues",
        "users",
        ["triaged_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    h.create_foreign_key(
        "fk_question_issues_resolved_by_user_id",
        "question_issues",
        "users",
        ["resolved_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    h.create_foreign_key(
        "fk_question_issues_resolved_version_id",
        "question_issues",
        "question_versions",
        ["resolved_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    h.create_index("ix_question_issues_triaged_by_user_id", "question_issues", ["triaged_by_user_id"], unique=False)
    h.create_index("ix_question_issues_triaged_at", "question_issues", ["triaged_at"], unique=False)
    h.create_index("ix_question_issues_resolved_version_id", "question_issues", ["resolved_version_id"], unique=False)
    h.create_index("ix_question_issues_resolved_by_user_id", "question_issues", ["resolved_by_user_id"], unique=False)
    h.create_index("ix_question_issues_resolved_at", "question_issues", ["resolved_at"], unique=False)

    h.create_table(
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
    h.create_index("ix_placement_state_user_id", "placement_state", ["user_id"], unique=False)
    h.create_index("ix_placement_state_client_key", "placement_state", ["client_key"], unique=False)
    h.create_index("ix_placement_state_placement_completed_at", "placement_state", ["placement_completed_at"], unique=False)
    h.create_index("ix_placement_state_placement_exam_id", "placement_state", ["placement_exam_id"], unique=False)


def downgrade() -> None:
    h.drop_index("ix_placement_state_placement_exam_id", "placement_state")
    h.drop_index("ix_placement_state_placement_completed_at", "placement_state")
    h.drop_index("ix_placement_state_client_key", "placement_state")
    h.drop_index("ix_placement_state_user_id", "placement_state")
    h.drop_table("placement_state")

    h.drop_index("ix_question_issues_resolved_at", "question_issues")
    h.drop_index("ix_question_issues_resolved_by_user_id", "question_issues")
    h.drop_index("ix_question_issues_resolved_version_id", "question_issues")
    h.drop_index("ix_question_issues_triaged_at", "question_issues")
    h.drop_index("ix_question_issues_triaged_by_user_id", "question_issues")
    # Constraint names differ between migrated and create_all databases: look them up.
    h.drop_foreign_key("question_issues", ["resolved_version_id"], "question_versions")
    h.drop_foreign_key("question_issues", ["resolved_by_user_id"], "users")
    h.drop_foreign_key("question_issues", ["triaged_by_user_id"], "users")
    h.drop_column("question_issues", "resolved_at")
    h.drop_column("question_issues", "resolved_by_user_id")
    h.drop_column("question_issues", "resolved_version_id")
    h.drop_column("question_issues", "triaged_at")
    h.drop_column("question_issues", "triaged_by_user_id")
    h.drop_column("question_issues", "internal_note")
