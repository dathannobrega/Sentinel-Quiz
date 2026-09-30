"""Sentinel Arena: live interactive quizzes (PLANO §11.2, Incremento 1).

Revision ID: 0019_live_quiz
Revises: 0018_license_scope
Create Date: 2026-09-30 12:30:00

Tables: live_quiz, live_quiz_item, live_quiz_version, live_session, live_session_item,
live_participant, live_answer_event.

- live_session.join_code is unique only among active sessions (partial unique index,
  same pattern as uq_domain_blueprint_weighted_domain).
- live_answer_event is append-only: on PostgreSQL a trigger rejects UPDATE (rows are
  still removed by ON DELETE CASCADE for retention/erasure).

Idempotent (see sq_migration_helpers). Downgrade drops the tables (live data is lost).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0019_live_quiz"
down_revision = "0018_license_scope"
branch_labels = None
depends_on = None

# Frozen copies (a migration must not depend on application constants).
ITEM_TYPES = ("single_choice", "multi_choice", "true_false", "type_answer", "poll", "content", "leaderboard")
SOURCE_KINDS = ("custom", "bank", "ai")
REVIEW_STATES = ("ok", "needs_review")
LICENSE_SCOPES = ("own", "platform", "pending_audit", "personal_use")
SESSION_STATUSES = ("lobby", "live", "finished")
SESSION_PHASES = ("lobby", "question", "locked", "reveal", "leaderboard", "content", "podium", "finished")
EVENT_TYPES = ("submitted", "host_accepted")

TZ = sa.DateTime(timezone=True)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    h.create_table(
        "live_quiz",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("theme_key", sa.String(32), nullable=False),
        sa.Column("settings_json", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("published_version_no", sa.Integer(), nullable=True),
        sa.Column("published_at_version", sa.Integer(), nullable=True),
        sa.Column("forked_from_id", sa.String(36), sa.ForeignKey("live_quiz.id", ondelete="SET NULL"), nullable=True),
        sa.Column("archived_at", TZ, nullable=True),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("updated_at", TZ, nullable=False),
    )
    h.create_index("ix_live_quiz_owner_updated", "live_quiz", ["owner_user_id", "updated_at"])

    h.create_table(
        "live_quiz_item",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("quiz_id", sa.String(36), sa.ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("item_type", sa.String(24), nullable=False),
        sa.Column("source_kind", sa.String(8), nullable=False),
        sa.Column("source_question_id", sa.String(128), sa.ForeignKey("questions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_version_id", sa.Integer(), sa.ForeignKey("question_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("answer_json", sa.JSON(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("presenter_notes", sa.Text(), nullable=True),
        sa.Column("time_limit_s", sa.Integer(), nullable=True),
        sa.Column("points_multiplier", sa.Integer(), nullable=False),
        sa.Column("license_scope", sa.String(24), nullable=False),
        sa.Column("review_state", sa.String(16), nullable=False),
        sa.Column("domain", sa.String(255), nullable=True),
        sa.Column("certification", sa.String(64), nullable=True),
        sa.Column("difficulty", sa.String(64), nullable=True),
        sa.Column("objective_code", sa.String(64), nullable=True),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("updated_at", TZ, nullable=False),
        sa.UniqueConstraint("quiz_id", "position", name="uq_live_quiz_item_position"),
        sa.CheckConstraint(_in("item_type", ITEM_TYPES), name="ck_live_quiz_item_type"),
        sa.CheckConstraint(_in("source_kind", SOURCE_KINDS), name="ck_live_quiz_item_source_kind"),
        sa.CheckConstraint(_in("review_state", REVIEW_STATES), name="ck_live_quiz_item_review_state"),
        sa.CheckConstraint(_in("license_scope", LICENSE_SCOPES), name="ck_live_quiz_item_license_scope"),
        sa.CheckConstraint("points_multiplier IN (0, 1, 2)", name="ck_live_quiz_item_multiplier"),
    )
    h.create_index("ix_live_quiz_item_source_question", "live_quiz_item", ["source_question_id"])

    h.create_table(
        "live_quiz_version",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("quiz_id", sa.String(36), sa.ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("theme_key", sa.String(32), nullable=False),
        sa.Column("settings_json", sa.JSON(), nullable=False),
        sa.Column("items_snapshot_json", sa.JSON(), nullable=False),
        sa.Column("snapshot_hash", sa.String(64), nullable=False),
        sa.Column("published_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("published_at", TZ, nullable=False),
        sa.UniqueConstraint("quiz_id", "version_no", name="uq_live_quiz_version_no"),
    )

    h.create_table(
        "live_session",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("quiz_id", sa.String(36), sa.ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "quiz_version_id", sa.String(36), sa.ForeignKey("live_quiz_version.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("phase", sa.String(16), nullable=False),
        sa.Column("state_seq", sa.Integer(), nullable=False),
        sa.Column("current_position", sa.Integer(), nullable=True),
        sa.Column("answers_open_at", TZ, nullable=True),
        sa.Column("deadline_at", TZ, nullable=True),
        sa.Column("join_code", sa.String(8), nullable=False),
        sa.Column("allow_guests", sa.Boolean(), nullable=False),
        sa.Column("room_locked", sa.Boolean(), nullable=False),
        sa.Column("max_participants", sa.Integer(), nullable=False),
        sa.Column("preset", sa.String(16), nullable=False),
        sa.Column("audience", sa.String(16), nullable=False),
        sa.Column("theme_key", sa.String(32), nullable=False),
        sa.Column("settings_json", sa.JSON(), nullable=False),
        sa.Column("consent_version", sa.String(16), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("started_at", TZ, nullable=True),
        sa.Column("ended_at", TZ, nullable=True),
        sa.Column("updated_at", TZ, nullable=False),
        sa.CheckConstraint(_in("status", SESSION_STATUSES), name="ck_live_session_status"),
        sa.CheckConstraint(_in("phase", SESSION_PHASES), name="ck_live_session_phase"),
    )
    active = sa.text("status IN ('lobby', 'live')")
    h.create_index(
        "uq_live_session_active_code", "live_session", ["join_code"], unique=True,
        postgresql_where=active, sqlite_where=active,
    )
    h.create_index("ix_live_session_owner_created", "live_session", ["owner_user_id", "created_at"])
    h.create_index("ix_live_session_quiz_created", "live_session", ["quiz_id", "created_at"])

    h.create_table(
        "live_session_item",
        sa.Column(
            "session_id", sa.String(36), sa.ForeignKey("live_session.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("position", sa.Integer(), primary_key=True),
        sa.Column("state", sa.String(12), nullable=False),
        sa.Column("opened_at", TZ, nullable=False),
        sa.Column("answers_open_at", TZ, nullable=True),
        sa.Column("deadline_at", TZ, nullable=True),
        sa.Column("locked_at", TZ, nullable=True),
        sa.Column("lock_reason", sa.String(16), nullable=True),
        sa.Column("revealed_at", TZ, nullable=True),
    )

    h.create_table(
        "live_participant",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("display_name", sa.String(24), nullable=False),
        sa.Column("nickname_norm", sa.String(48), nullable=False),
        sa.Column("avatar_seed", sa.String(16), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("return_code_hash", sa.String(64), nullable=True),
        sa.Column("dev_hash", sa.String(64), nullable=True),
        sa.Column("consent_version", sa.String(16), nullable=True),
        sa.Column("joined_at", TZ, nullable=False),
        sa.Column("last_seen_at", TZ, nullable=True),
        sa.Column("kicked_at", TZ, nullable=True),
        sa.Column("banned", sa.Boolean(), nullable=False),
        sa.Column("final_score", sa.Integer(), nullable=True),
        sa.Column("final_rank", sa.Integer(), nullable=True),
        sa.UniqueConstraint("session_id", "nickname_norm", name="uq_live_participant_nickname"),
    )
    with_user = sa.text("user_id IS NOT NULL")
    h.create_index(
        "uq_live_participant_session_user", "live_participant", ["session_id", "user_id"], unique=True,
        postgresql_where=with_user, sqlite_where=with_user,
    )
    h.create_index("ix_live_participant_user", "live_participant", ["user_id"])

    h.create_table(
        "live_answer_event",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "participant_id", sa.String(36), sa.ForeignKey("live_participant.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("event_type", sa.String(16), nullable=False),
        sa.Column("response_json", sa.JSON(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("score_fraction", sa.Float(), nullable=True),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("server_ms", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("client_elapsed_ms", sa.Integer(), nullable=True),
        sa.Column("suspicious", sa.Boolean(), nullable=False),
        sa.Column("idempotency_key", sa.String(36), nullable=False, unique=True),
        sa.Column("received_at", TZ, nullable=False),
        sa.UniqueConstraint(
            "session_id", "position", "participant_id", "event_type", name="uq_live_answer_event_once"
        ),
        sa.CheckConstraint(_in("event_type", EVENT_TYPES), name="ck_live_answer_event_type"),
    )
    h.create_index("ix_live_answer_event_session_position", "live_answer_event", ["session_id", "position"])
    h.create_index("ix_live_answer_event_received", "live_answer_event", ["received_at"])

    if not h.is_sqlite():
        h.execute(
            """
            CREATE OR REPLACE FUNCTION live_answer_event_immutable() RETURNS trigger AS $$
            BEGIN
              RAISE EXCEPTION 'live_answer_event is append-only';
            END;
            $$ LANGUAGE plpgsql
            """
        )
        h.execute("DROP TRIGGER IF EXISTS trg_live_answer_event_immutable ON live_answer_event")
        h.execute(
            "CREATE TRIGGER trg_live_answer_event_immutable BEFORE UPDATE ON live_answer_event "
            "FOR EACH ROW EXECUTE FUNCTION live_answer_event_immutable()"
        )


def downgrade() -> None:
    if h.has_table("live_answer_event") and not h.is_sqlite():
        h.execute("DROP TRIGGER IF EXISTS trg_live_answer_event_immutable ON live_answer_event")
        h.execute("DROP FUNCTION IF EXISTS live_answer_event_immutable()")
    for table in (
        "live_answer_event",
        "live_participant",
        "live_session_item",
        "live_session",
        "live_quiz_version",
        "live_quiz_item",
        "live_quiz",
    ):
        h.drop_table(table)
