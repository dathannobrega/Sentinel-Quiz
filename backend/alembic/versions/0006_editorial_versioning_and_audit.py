"""Add editorial versioning and audit workflow.

Revision ID: 0006_editorial_versioning_and_audit
Revises: 0005_exam_strategy_and_srs_state
Create Date: 2026-03-02 22:15:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0006_editorial_versioning_and_audit"
down_revision = "0005_exam_strategy_and_srs_state"
branch_labels = None
depends_on = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "question_bank" not in tables:
        op.create_table(
            "question_bank",
            sa.Column("stable_question_id", sa.String(length=128), primary_key=True),
            sa.Column("published_version_id", sa.Integer(), nullable=True),
            sa.Column("draft_version_id", sa.Integer(), nullable=True),
            sa.Column("review_status", sa.String(length=24), nullable=False, server_default=sa.text("'published'")),
            sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
            sa.Column("updated_by_user_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_question_bank_review_status", "question_bank", ["review_status"], unique=False)
        op.create_index("ix_question_bank_created_by_user_id", "question_bank", ["created_by_user_id"], unique=False)
        op.create_index("ix_question_bank_updated_by_user_id", "question_bank", ["updated_by_user_id"], unique=False)

    inspector = sa.inspect(bind)
    tables = _table_names(inspector)
    if "question_versions" not in tables:
        op.create_table(
            "question_versions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("question_bank_id", sa.String(length=128), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'draft'")),
            sa.Column("exam_id", sa.String(length=128), nullable=False),
            sa.Column("prompt", sa.Text(), nullable=False),
            sa.Column("multi_select", sa.Boolean(), nullable=False, server_default=sa.text("0")),
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
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("published_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["question_bank_id"], ["question_bank.stable_question_id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("question_bank_id", "version_number", name="uq_question_versions_bank_version"),
        )
        op.create_index("ix_question_versions_question_bank_id", "question_versions", ["question_bank_id"], unique=False)
        op.create_index("ix_question_versions_status", "question_versions", ["status"], unique=False)
        op.create_index("ix_question_versions_created_by_user_id", "question_versions", ["created_by_user_id"], unique=False)
        op.create_index("ix_question_versions_updated_by_user_id", "question_versions", ["updated_by_user_id"], unique=False)
        op.create_index("ix_question_versions_approved_by_user_id", "question_versions", ["approved_by_user_id"], unique=False)
        op.create_index("ix_question_versions_published_at", "question_versions", ["published_at"], unique=False)

    inspector = sa.inspect(bind)
    tables = _table_names(inspector)
    if "question_version_options" not in tables:
        op.create_table(
            "question_version_options",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("version_id", sa.Integer(), nullable=False),
            sa.Column("key", sa.String(length=8), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("is_correct", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.ForeignKeyConstraint(["version_id"], ["question_versions.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("version_id", "key", name="uq_question_version_options_version_key"),
        )
        op.create_index("ix_question_version_options_version_id", "question_version_options", ["version_id"], unique=False)

    inspector = sa.inspect(bind)
    tables = _table_names(inspector)
    if "editorial_audit_log" not in tables:
        op.create_table(
            "editorial_audit_log",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("question_bank_id", sa.String(length=128), nullable=True),
            sa.Column("question_version_id", sa.Integer(), nullable=True),
            sa.Column("actor_user_id", sa.String(length=36), nullable=True),
            sa.Column("actor_role", sa.String(length=32), nullable=True),
            sa.Column("action", sa.String(length=32), nullable=False),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_editorial_audit_log_question_bank_id", "editorial_audit_log", ["question_bank_id"], unique=False)
        op.create_index("ix_editorial_audit_log_question_version_id", "editorial_audit_log", ["question_version_id"], unique=False)
        op.create_index("ix_editorial_audit_log_actor_user_id", "editorial_audit_log", ["actor_user_id"], unique=False)
        op.create_index("ix_editorial_audit_log_action", "editorial_audit_log", ["action"], unique=False)
        op.create_index("ix_editorial_audit_log_created_at", "editorial_audit_log", ["created_at"], unique=False)


def downgrade() -> None:
    raise RuntimeError("This migration is intentionally irreversible.")
