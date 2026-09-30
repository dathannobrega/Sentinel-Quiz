"""Sentinel Arena AI authoring (PLANO §12, Incremento 2).

Revision ID: 0020_ai_authoring
Revises: 0019_live_quiz
Create Date: 2026-09-30 16:00:00

- ai_job: asynchronous AI jobs (queue for the in-process runner or the ai-worker).
- ai_usage_ledger: credits reserved/refunded per job (daily quota source of truth).
- live_quiz_item.origin_meta_json (AI provenance: issues, critic flags) and the human
  review trail (reviewed_by_user_id, reviewed_at).

Idempotent (see sq_migration_helpers).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0020_ai_authoring"
down_revision = "0019_live_quiz"
branch_labels = None
depends_on = None

JOB_KINDS = ("generate", "from_source", "improve")
JOB_STATUSES = ("queued", "running", "succeeded", "failed", "degraded")
TZ = sa.DateTime(timezone=True)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    h.add_column("live_quiz_item", sa.Column("origin_meta_json", sa.JSON(), nullable=True))
    h.add_column("live_quiz_item", sa.Column("reviewed_by_user_id", sa.String(36), nullable=True))
    h.add_column("live_quiz_item", sa.Column("reviewed_at", TZ, nullable=True))
    h.create_foreign_key(
        "fk_live_quiz_item_reviewed_by_user_id_users", "live_quiz_item", "users",
        ["reviewed_by_user_id"], ["id"], ondelete="SET NULL",
    )

    h.create_table(
        "ai_job",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quiz_id", sa.String(36), sa.ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=True),
        sa.Column("item_id", sa.String(36), sa.ForeignKey("live_quiz_item.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("stage", sa.String(16), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=False),
        sa.Column("output_json", sa.JSON(), nullable=True),
        sa.Column("applied_json", sa.JSON(), nullable=True),
        sa.Column("prompt_id", sa.String(48), nullable=True),
        sa.Column("model", sa.String(64), nullable=True),
        sa.Column("critic_model", sa.String(64), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=False),
        sa.Column("tokens_out", sa.Integer(), nullable=False),
        sa.Column("credits", sa.Float(), nullable=False),
        sa.Column("error_code", sa.String(48), nullable=True),
        sa.Column("error_message", sa.String(300), nullable=True),
        sa.Column("injection_suspected", sa.Boolean(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("started_at", TZ, nullable=True),
        sa.Column("finished_at", TZ, nullable=True),
        sa.CheckConstraint(_in("kind", JOB_KINDS), name="ck_ai_job_kind"),
        sa.CheckConstraint(_in("status", JOB_STATUSES), name="ck_ai_job_status"),
    )
    h.create_index("ix_ai_job_status_created", "ai_job", ["status", "created_at"])
    h.create_index("ix_ai_job_owner_created", "ai_job", ["owner_user_id", "created_at"])
    h.create_index("ix_ai_job_quiz_created", "ai_job", ["quiz_id", "created_at"])

    h.create_table(
        "ai_usage_ledger",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("ai_job.id", ondelete="SET NULL"), nullable=True),
        sa.Column("feature", sa.String(24), nullable=False),
        sa.Column("credits", sa.Float(), nullable=False),
        sa.Column("tokens_in", sa.Integer(), nullable=False),
        sa.Column("tokens_out", sa.Integer(), nullable=False),
        sa.Column("at", TZ, nullable=False),
    )
    h.create_index("ix_ai_usage_ledger_owner_at", "ai_usage_ledger", ["owner_user_id", "at"])


def downgrade() -> None:
    h.drop_table("ai_usage_ledger")
    h.drop_table("ai_job")
    h.drop_foreign_key("live_quiz_item", ["reviewed_by_user_id"], "users")
    h.drop_column("live_quiz_item", "reviewed_at")
    h.drop_column("live_quiz_item", "reviewed_by_user_id")
    h.drop_column("live_quiz_item", "origin_meta_json")
