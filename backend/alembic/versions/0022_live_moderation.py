"""Sentinel Arena moderation, rights and retention (Incremento 4).

Revision ID: 0022_live_moderation
Revises: 0021_live_operations
Create Date: 2026-10-01 10:00:00

- live_moderation_term: admin-managed filter terms (RF-1107).
- live_moderation_case: queue of participant reports and filter flags (RF-1104/1112/1114).
- live_audit_event: audit trail (force end, removals, nominal report access, LGPD).
- live_quiz.blocked_at; live_quiz_version.moderation_state/moderation_json.
- live_session.hidden_positions, names_anonymized_at, events_purged_at,
  report_snapshot_json (retention, RF-1109).
- live_participant.is_preview (RF-514), erased_at (RF-650), claimed_at (RF-633).

Idempotent (see sq_migration_helpers).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0022_live_moderation"
down_revision = "0021_live_operations"
branch_labels = None
depends_on = None

TZ = sa.DateTime(timezone=True)
MODERATION_STATES = ("clear", "flagged", "approved", "blocked")
CASE_SOURCES = ("participant", "filter", "admin")
CASE_STATUSES = ("open", "dismissed", "actioned")
CASE_REASONS = ("offensive", "spam", "cheating", "copyright", "privacy", "other", "filter_match")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    h.add_column("live_quiz", sa.Column("blocked_at", TZ, nullable=True))
    h.add_column(
        "live_quiz_version",
        sa.Column("moderation_state", sa.String(16), nullable=False, server_default="clear"),
    )
    h.add_column("live_quiz_version", sa.Column("moderation_json", sa.JSON(), nullable=True))
    if not h.is_sqlite():
        # SQLite would rebuild live_quiz_version, which changes the order of the ON DELETE
        # cascades from live_quiz (sessions RESTRICT their version). The application
        # validates the state; PostgreSQL enforces it.
        h.create_check("live_quiz_version", "ck_live_quiz_version_moderation_state", _in("moderation_state", MODERATION_STATES))

    h.add_column("live_session", sa.Column("hidden_positions", sa.JSON(), nullable=True))
    h.add_column("live_session", sa.Column("names_anonymized_at", TZ, nullable=True))
    h.add_column("live_session", sa.Column("events_purged_at", TZ, nullable=True))
    h.add_column("live_session", sa.Column("report_snapshot_json", sa.JSON(), nullable=True))

    h.add_column("live_participant", sa.Column("is_preview", sa.Boolean(), nullable=False, server_default=sa.false()))
    h.add_column("live_participant", sa.Column("erased_at", TZ, nullable=True))
    h.add_column("live_participant", sa.Column("claimed_at", TZ, nullable=True))

    h.create_table(
        "live_moderation_term",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("term", sa.String(64), nullable=False),
        sa.Column("match", sa.String(16), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("scope", sa.String(8), nullable=False),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", TZ, nullable=False),
        sa.UniqueConstraint("term", "kind", "scope", name="uq_live_moderation_term"),
        sa.CheckConstraint("match IN ('substring', 'token')", name="ck_live_moderation_term_match"),
        sa.CheckConstraint("kind IN ('block', 'allow')", name="ck_live_moderation_term_kind"),
        sa.CheckConstraint("scope IN ('names', 'content', 'all')", name="ck_live_moderation_term_scope"),
    )

    h.create_table(
        "live_moderation_case",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(16), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("excerpt", sa.String(500), nullable=True),
        sa.Column("details_json", sa.JSON(), nullable=True),
        sa.Column("quiz_id", sa.String(36), sa.ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=True),
        sa.Column("quiz_version_id", sa.String(36), sa.ForeignKey("live_quiz_version.id", ondelete="CASCADE"), nullable=True),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("live_session.id", ondelete="SET NULL"), nullable=True),
        sa.Column("position", sa.Integer(), nullable=True),
        sa.Column(
            "reporter_participant_id", sa.String(36), sa.ForeignKey("live_participant.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("resolved_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_at", TZ, nullable=True),
        sa.Column("resolution", sa.String(24), nullable=True),
        sa.Column("resolution_note", sa.String(500), nullable=True),
        sa.CheckConstraint(_in("source", CASE_SOURCES), name="ck_live_moderation_case_source"),
        sa.CheckConstraint(_in("status", CASE_STATUSES), name="ck_live_moderation_case_status"),
        sa.CheckConstraint(_in("reason", CASE_REASONS), name="ck_live_moderation_case_reason"),
    )
    h.create_index("ix_live_moderation_case_status_created", "live_moderation_case", ["status", "created_at"])
    h.create_index("ix_live_moderation_case_session", "live_moderation_case", ["session_id"])

    h.create_table(
        "live_audit_event",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_kind", sa.String(16), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("session_id", sa.String(36), nullable=True),
        sa.Column("quiz_id", sa.String(36), nullable=True),
        sa.Column("target", sa.String(64), nullable=True),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("meta_json", sa.JSON(), nullable=True),
        sa.Column("created_at", TZ, nullable=False),
    )
    h.create_index("ix_live_audit_event_session", "live_audit_event", ["session_id", "created_at"])
    h.create_index("ix_live_audit_event_created", "live_audit_event", ["created_at"])


def downgrade() -> None:
    h.drop_table("live_audit_event")
    h.drop_table("live_moderation_case")
    h.drop_table("live_moderation_term")
    for column in ("claimed_at", "erased_at", "is_preview"):
        h.drop_column("live_participant", column)
    for column in ("report_snapshot_json", "events_purged_at", "names_anonymized_at", "hidden_positions"):
        h.drop_column("live_session", column)
    if not h.is_sqlite():
        h.drop_check("live_quiz_version", "ck_live_quiz_version_moderation_state")
    h.drop_column("live_quiz_version", "moderation_json")
    h.drop_column("live_quiz_version", "moderation_state")
    h.drop_column("live_quiz", "blocked_at")
