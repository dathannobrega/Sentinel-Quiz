"""Sentinel Arena live operations (Incremento 3).

Revision ID: 0021_live_operations
Revises: 0020_ai_authoring
Create Date: 2026-09-30 18:00:00

- live_session.paused_at: host pause (the timer is frozen; resume shifts it).
- live_participant.time_multiplier: extended time per participant (RF-622): 1, 1.5, 2
  or 0 (untimed).
- live_participant.is_bot: rehearsal bots (RF-513), never counted in reports.

Rehearsals reuse live_session.mode ("rehearsal"). Idempotent (see sq_migration_helpers).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0021_live_operations"
down_revision = "0020_ai_authoring"
branch_labels = None
depends_on = None


def upgrade() -> None:
    h.add_column("live_session", sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True))
    h.add_column(
        "live_participant",
        sa.Column("time_multiplier", sa.Float(), nullable=False, server_default=sa.text("1.0")),
    )
    h.add_column("live_participant", sa.Column("is_bot", sa.Boolean(), nullable=False, server_default=sa.false()))
    h.create_check(
        "live_participant", "ck_live_participant_time_multiplier", "time_multiplier IN (0, 1, 1.5, 2)"
    )


def downgrade() -> None:
    h.drop_check("live_participant", "ck_live_participant_time_multiplier")
    h.drop_column("live_participant", "is_bot")
    h.drop_column("live_participant", "time_multiplier")
    h.drop_column("live_session", "paused_at")
