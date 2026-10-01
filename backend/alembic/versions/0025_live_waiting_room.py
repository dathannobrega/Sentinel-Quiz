"""Sentinel Arena waiting room (Incremento 7: RF-545 approval, DC-16 overflow).

Revision ID: 0025_live_waiting_room
Revises: 0024_live_self_paced
Create Date: 2026-10-02 10:00:00

- live_session.require_approval.
- live_join_request: people waiting for approval or for a seat above the room cap.

Idempotent (see sq_migration_helpers).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0025_live_waiting_room"
down_revision = "0024_live_self_paced"
branch_labels = None
depends_on = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    h.add_column("live_session", sa.Column("require_approval", sa.Boolean(), nullable=False, server_default=sa.false()))
    h.create_table(
        "live_join_request",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("display_name", sa.String(24), nullable=False),
        sa.Column("nickname_norm", sa.String(48), nullable=False),
        sa.Column("avatar_seed", sa.String(16), nullable=False),
        sa.Column("dev_hash", sa.String(64), nullable=True),
        sa.Column("consent_version", sa.String(16), nullable=True),
        sa.Column("reason", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("wait_token_hash", sa.String(64), nullable=False),
        sa.Column("participant_id", sa.String(36), sa.ForeignKey("live_participant.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("last_seen_at", TZ, nullable=False),
        sa.Column("decided_at", TZ, nullable=True),
        sa.Column("delivered_at", TZ, nullable=True),
        sa.CheckConstraint("reason IN ('approval', 'capacity')", name="ck_live_join_request_reason"),
        sa.CheckConstraint(
            "status IN ('waiting', 'admitted', 'rejected', 'expired', 'withdrawn')", name="ck_live_join_request_status"
        ),
    )
    h.create_index("ix_live_join_request_queue", "live_join_request", ["session_id", "status", "created_at"])
    h.create_index(
        "uq_live_join_request_waiting_name", "live_join_request", ["session_id", "nickname_norm"], unique=True,
        postgresql_where=sa.text("status = 'waiting'"), sqlite_where=sa.text("status = 'waiting'"),
    )


def downgrade() -> None:
    h.drop_index("uq_live_join_request_waiting_name", "live_join_request")
    h.drop_index("ix_live_join_request_queue", "live_join_request")
    h.drop_table("live_join_request")
    h.drop_column("live_session", "require_approval")
