"""Sentinel Reader (docs/reading/CONTRATO-INCREMENTO-1.md §6): reading progress and shadowing attempts.

Revision ID: 0026_reading
Revises: 0025_live_waiting_room
Create Date: 2026-10-12 12:00:00

- reading_progress: one row per (user, book) with the last position and running totals.
- reading_attempt: one row per scored recording (result only, never the audio).

Idempotent (see sq_migration_helpers).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0026_reading"
down_revision = "0025_live_waiting_room"
branch_labels = None
depends_on = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    h.create_table(
        "reading_progress",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("book_slug", sa.String(128), nullable=False),
        sa.Column("section_id", sa.String(256), nullable=False),
        sa.Column("part_id", sa.String(256), nullable=False),
        sa.Column("block_index", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("words_read", sa.Integer(), nullable=False),
        sa.Column("seconds_listened", sa.Integer(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("updated_at", TZ, nullable=False),
        sa.UniqueConstraint("user_id", "book_slug", name="uq_reading_progress_user_book"),
        sa.CheckConstraint("mode IN ('listen', 'read', 'shadow')", name="ck_reading_progress_mode"),
    )
    h.create_index("ix_reading_progress_user_id", "reading_progress", ["user_id"])

    h.create_table(
        "reading_attempt",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("book_slug", sa.String(128), nullable=False),
        sa.Column("section_id", sa.String(256), nullable=False),
        sa.Column("part_id", sa.String(256), nullable=False),
        sa.Column("block_index", sa.Integer(), nullable=False),
        sa.Column("reference_words", sa.Integer(), nullable=False),
        sa.Column("accuracy", sa.Float(), nullable=False),
        sa.Column("completeness", sa.Float(), nullable=False),
        sa.Column("fluency", sa.Float(), nullable=False),
        sa.Column("overall", sa.Float(), nullable=False),
        sa.Column("wpm", sa.Float(), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("engine", sa.String(32), nullable=True),
        sa.Column("model", sa.String(64), nullable=True),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
    )
    h.create_index("ix_reading_attempt_user_id", "reading_attempt", ["user_id"])
    h.create_index("ix_reading_attempt_user_created", "reading_attempt", ["user_id", "created_at"])
    h.create_index("ix_reading_attempt_section", "reading_attempt", ["user_id", "section_id"])


def downgrade() -> None:
    h.drop_table("reading_attempt")
    h.drop_table("reading_progress")
