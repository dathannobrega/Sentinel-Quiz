"""Sentinel Arena self-paced challenges (Incremento 6, E1.10).

Revision ID: 0024_live_self_paced
Revises: 0023_live_ga_item_types
Create Date: 2026-10-01 10:00:00

- live_session.share_slug (UNIQUE), opens_at, closes_at, view_count.
- live_answer_event.attempt_no (1 for live sessions); uq_live_answer_event_once gains it,
  so each attempt answers every item once.
- live_attempt: one run of a challenge by a participant.

Idempotent (see sq_migration_helpers).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0024_live_self_paced"
down_revision = "0023_live_ga_item_types"
branch_labels = None
depends_on = None

TZ = sa.DateTime(timezone=True)
ONCE = "uq_live_answer_event_once"
ONCE_V1 = ["session_id", "position", "participant_id", "event_type"]
ONCE_V2 = ONCE_V1 + ["attempt_no"]


def _unique_columns(table: str, name: str) -> list[str] | None:
    for constraint in h.inspector().get_unique_constraints(table):
        if constraint.get("name") == name:
            return list(constraint.get("column_names") or [])
    return None


def _replace_once(columns: list[str]) -> None:
    current = _unique_columns("live_answer_event", ONCE)
    if current == columns:
        return
    if h.is_sqlite():
        with h.batch("live_answer_event", recreate="always") as b:
            if current is not None:
                b.drop_constraint(ONCE, type_="unique")
            b.create_unique_constraint(ONCE, columns)
        return
    from alembic import op

    if current is not None:
        op.drop_constraint(ONCE, "live_answer_event", type_="unique")
    op.create_unique_constraint(ONCE, "live_answer_event", columns)


def upgrade() -> None:
    h.add_column("live_session", sa.Column("share_slug", sa.String(16), nullable=True))
    h.add_column("live_session", sa.Column("opens_at", TZ, nullable=True))
    h.add_column("live_session", sa.Column("closes_at", TZ, nullable=True))
    h.add_column("live_session", sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"))
    h.create_index("uq_live_session_share_slug", "live_session", ["share_slug"], unique=True)

    h.add_column("live_answer_event", sa.Column("attempt_no", sa.Integer(), nullable=False, server_default="1"))
    _replace_once(ONCE_V2)

    h.create_table(
        "live_attempt",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False),
        sa.Column("participant_id", sa.String(36), sa.ForeignKey("live_participant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("item_order_json", sa.JSON(), nullable=False),
        sa.Column("current_index", sa.Integer(), nullable=False),
        sa.Column("item_started_at", TZ, nullable=True),
        sa.Column("started_at", TZ, nullable=False),
        sa.Column("deadline_at", TZ, nullable=True),
        sa.Column("finished_at", TZ, nullable=True),
        sa.Column("finish_reason", sa.String(16), nullable=True),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("correct", sa.Integer(), nullable=False),
        sa.Column("answered", sa.Integer(), nullable=False),
        sa.Column("correct_ms", sa.Integer(), nullable=False),
        sa.Column("repeat_suspect", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("session_id", "participant_id", "attempt_no", name="uq_live_attempt_no"),
        sa.CheckConstraint("status IN ('in_progress', 'finished')", name="ck_live_attempt_status"),
    )
    h.create_index("ix_live_attempt_session_status", "live_attempt", ["session_id", "status"])


def downgrade() -> None:
    h.drop_index("ix_live_attempt_session_status", "live_attempt")
    h.drop_table("live_attempt")
    # Later attempts would violate the narrower unique key: keep only the first.
    if h.has_column("live_answer_event", "attempt_no"):
        h.execute("DELETE FROM live_answer_event WHERE attempt_no <> 1")  # the trigger only blocks UPDATE
        _replace_once(ONCE_V1)
        h.drop_column("live_answer_event", "attempt_no")
    h.drop_index("uq_live_session_share_slug", "live_session")
    for column in ("view_count", "closes_at", "opens_at", "share_slug"):
        h.drop_column("live_session", column)
