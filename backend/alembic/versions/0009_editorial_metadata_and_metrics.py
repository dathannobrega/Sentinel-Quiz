"""Extend editorial metadata and persistent analytics snapshots.

Revision ID: 0009_editorial_metadata_and_metrics
Revises: 0008_question_stats_snapshot
Create Date: 2026-03-03 03:30:00
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402


revision = "0009_editorial_metadata_and_metrics"
down_revision = "0008_question_stats_snapshot"
branch_labels = None
depends_on = None

# Idempotent: revision 0008 runs create_all with the current models, so on an empty
# database everything below may already exist. Every operation checks the live
# schema first (see alembic/sq_migration_helpers.py).


def upgrade() -> None:
    h.add_column("question_versions", sa.Column("subject", sa.String(length=255), nullable=True))
    h.add_column("question_versions", sa.Column("subtopic", sa.String(length=255), nullable=True))
    h.add_column("question_versions", sa.Column("subdomain", sa.String(length=255), nullable=True))
    h.add_column("question_versions", sa.Column("objective_code", sa.String(length=64), nullable=True))
    h.add_column("question_versions", sa.Column("blueprint_code", sa.String(length=64), nullable=True))
    h.add_column("question_versions", sa.Column("keywords_json", sa.Text(), nullable=True))
    h.add_column("question_versions", sa.Column("trap_patterns_json", sa.Text(), nullable=True))
    h.add_column(
        "question_versions",
        sa.Column("question_format", sa.String(length=32), nullable=False, server_default="single_choice"),
    )
    h.add_column("question_versions", sa.Column("correct_rationale", sa.Text(), nullable=True))
    h.add_column("question_versions", sa.Column("incorrect_rationales_json", sa.Text(), nullable=True))
    h.add_column("question_versions", sa.Column("avg_time_seconds", sa.Float(), nullable=True))
    h.add_column("question_versions", sa.Column("global_accuracy_percent", sa.Float(), nullable=True))
    h.create_index("ix_question_versions_objective_code", "question_versions", ["objective_code"], unique=False)
    h.create_index("ix_question_versions_blueprint_code", "question_versions", ["blueprint_code"], unique=False)
    h.create_index("ix_question_versions_question_format", "question_versions", ["question_format"], unique=False)

    h.create_table(
        "domain_catalog",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("certification", sa.String(length=64), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=False),
        sa.Column("subdomain", sa.String(length=255), nullable=True),
        sa.Column("subject", sa.String(length=255), nullable=True),
        sa.Column("objective_code", sa.String(length=64), nullable=True),
        sa.Column("blueprint_code", sa.String(length=64), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "certification",
            "domain",
            "subdomain",
            "objective_code",
            "blueprint_code",
            name="uq_domain_catalog_identity",
        ),
    )
    h.create_index("ix_domain_catalog_certification", "domain_catalog", ["certification"], unique=False)
    h.create_index("ix_domain_catalog_domain", "domain_catalog", ["domain"], unique=False)
    h.create_index("ix_domain_catalog_subdomain", "domain_catalog", ["subdomain"], unique=False)
    h.create_index("ix_domain_catalog_objective_code", "domain_catalog", ["objective_code"], unique=False)
    h.create_index("ix_domain_catalog_blueprint_code", "domain_catalog", ["blueprint_code"], unique=False)
    h.create_index("ix_domain_catalog_is_active", "domain_catalog", ["is_active"], unique=False)

    h.create_table(
        "domain_blueprint",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("certification", sa.String(length=64), nullable=False),
        sa.Column("blueprint_code", sa.String(length=64), nullable=False),
        sa.Column("objective_code", sa.String(length=64), nullable=True),
        sa.Column("domain", sa.String(length=255), nullable=True),
        sa.Column("subdomain", sa.String(length=255), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "certification",
            "blueprint_code",
            "objective_code",
            name="uq_domain_blueprint_identity",
        ),
    )
    h.create_index("ix_domain_blueprint_certification", "domain_blueprint", ["certification"], unique=False)
    h.create_index("ix_domain_blueprint_blueprint_code", "domain_blueprint", ["blueprint_code"], unique=False)
    h.create_index("ix_domain_blueprint_objective_code", "domain_blueprint", ["objective_code"], unique=False)
    h.create_index("ix_domain_blueprint_domain", "domain_blueprint", ["domain"], unique=False)
    h.create_index("ix_domain_blueprint_subdomain", "domain_blueprint", ["subdomain"], unique=False)

    h.create_table(
        "question_references",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("question_version_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=255), nullable=True),
        sa.Column("reference", sa.Text(), nullable=True),
        sa.Column("chapter", sa.String(length=255), nullable=True),
        sa.Column("locator", sa.String(length=255), nullable=True),
        sa.Column("material_path", sa.String(length=255), nullable=True),
        sa.Column("page_start", sa.Integer(), nullable=True),
        sa.Column("page_end", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_version_id"], ["question_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    h.create_index("ix_question_references_question_version_id", "question_references", ["question_version_id"], unique=False)

    h.create_table(
        "user_domain_metrics_daily",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("metric_date", sa.DateTime(), nullable=False),
        sa.Column("exam_id", sa.String(length=128), nullable=True),
        sa.Column("certification", sa.String(length=64), nullable=True),
        sa.Column("domain", sa.String(length=255), nullable=False),
        sa.Column("attempts_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("exam_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("study_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("low_confidence_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_elapsed_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("timed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_user_domain_metrics_daily_owner_scope_xor"),
        sa.UniqueConstraint("user_id", "metric_date", "exam_id", "domain", name="uq_user_domain_metrics_daily_user"),
        sa.UniqueConstraint("client_key", "metric_date", "exam_id", "domain", name="uq_user_domain_metrics_daily_client"),
    )
    h.create_index("ix_user_domain_metrics_daily_user_id", "user_domain_metrics_daily", ["user_id"], unique=False)
    h.create_index("ix_user_domain_metrics_daily_client_key", "user_domain_metrics_daily", ["client_key"], unique=False)
    h.create_index("ix_user_domain_metrics_daily_metric_date", "user_domain_metrics_daily", ["metric_date"], unique=False)
    h.create_index("ix_user_domain_metrics_daily_exam_id", "user_domain_metrics_daily", ["exam_id"], unique=False)
    h.create_index("ix_user_domain_metrics_daily_certification", "user_domain_metrics_daily", ["certification"], unique=False)
    h.create_index("ix_user_domain_metrics_daily_domain", "user_domain_metrics_daily", ["domain"], unique=False)

    h.create_table(
        "user_exam_metrics_snapshot",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="exam"),
        sa.Column("exam_id", sa.String(length=128), nullable=True),
        sa.Column("selection_strategy", sa.String(length=24), nullable=True),
        sa.Column("total_questions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("answered_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("score_percent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("weakest_domains_json", sa.Text(), nullable=True),
        sa.Column("review_due_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("review_total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_user_exam_metrics_snapshot_owner_scope_xor"),
        sa.UniqueConstraint("session_id"),
    )
    h.create_index("ix_user_exam_metrics_snapshot_user_id", "user_exam_metrics_snapshot", ["user_id"], unique=False)
    h.create_index("ix_user_exam_metrics_snapshot_client_key", "user_exam_metrics_snapshot", ["client_key"], unique=False)
    h.create_index("ix_user_exam_metrics_snapshot_session_id", "user_exam_metrics_snapshot", ["session_id"], unique=False)
    h.create_index("ix_user_exam_metrics_snapshot_mode", "user_exam_metrics_snapshot", ["mode"], unique=False)
    h.create_index("ix_user_exam_metrics_snapshot_exam_id", "user_exam_metrics_snapshot", ["exam_id"], unique=False)
    h.create_index("ix_user_exam_metrics_snapshot_completed_at", "user_exam_metrics_snapshot", ["completed_at"], unique=False)

    h.create_table(
        "weekly_progress_snapshot",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("week_start", sa.DateTime(), nullable=False),
        sa.Column("questions_answered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("review_questions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("scheduled_reviews", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("low_confidence_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_exam_sessions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_study_sessions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_review_sessions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("review_due_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("review_total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_weekly_progress_snapshot_owner_scope_xor"),
        sa.UniqueConstraint("user_id", "week_start", name="uq_weekly_progress_snapshot_user"),
        sa.UniqueConstraint("client_key", "week_start", name="uq_weekly_progress_snapshot_client"),
    )
    h.create_index("ix_weekly_progress_snapshot_user_id", "weekly_progress_snapshot", ["user_id"], unique=False)
    h.create_index("ix_weekly_progress_snapshot_client_key", "weekly_progress_snapshot", ["client_key"], unique=False)
    h.create_index("ix_weekly_progress_snapshot_week_start", "weekly_progress_snapshot", ["week_start"], unique=False)

    h.clear_server_default("question_versions", "question_format")


def downgrade() -> None:
    h.drop_index("ix_weekly_progress_snapshot_week_start", "weekly_progress_snapshot")
    h.drop_index("ix_weekly_progress_snapshot_client_key", "weekly_progress_snapshot")
    h.drop_index("ix_weekly_progress_snapshot_user_id", "weekly_progress_snapshot")
    h.drop_table("weekly_progress_snapshot")

    h.drop_index("ix_user_exam_metrics_snapshot_completed_at", "user_exam_metrics_snapshot")
    h.drop_index("ix_user_exam_metrics_snapshot_exam_id", "user_exam_metrics_snapshot")
    h.drop_index("ix_user_exam_metrics_snapshot_mode", "user_exam_metrics_snapshot")
    h.drop_index("ix_user_exam_metrics_snapshot_session_id", "user_exam_metrics_snapshot")
    h.drop_index("ix_user_exam_metrics_snapshot_client_key", "user_exam_metrics_snapshot")
    h.drop_index("ix_user_exam_metrics_snapshot_user_id", "user_exam_metrics_snapshot")
    h.drop_table("user_exam_metrics_snapshot")

    h.drop_index("ix_user_domain_metrics_daily_domain", "user_domain_metrics_daily")
    h.drop_index("ix_user_domain_metrics_daily_certification", "user_domain_metrics_daily")
    h.drop_index("ix_user_domain_metrics_daily_exam_id", "user_domain_metrics_daily")
    h.drop_index("ix_user_domain_metrics_daily_metric_date", "user_domain_metrics_daily")
    h.drop_index("ix_user_domain_metrics_daily_client_key", "user_domain_metrics_daily")
    h.drop_index("ix_user_domain_metrics_daily_user_id", "user_domain_metrics_daily")
    h.drop_table("user_domain_metrics_daily")

    h.drop_index("ix_question_references_question_version_id", "question_references")
    h.drop_table("question_references")

    h.drop_index("ix_domain_blueprint_subdomain", "domain_blueprint")
    h.drop_index("ix_domain_blueprint_domain", "domain_blueprint")
    h.drop_index("ix_domain_blueprint_objective_code", "domain_blueprint")
    h.drop_index("ix_domain_blueprint_blueprint_code", "domain_blueprint")
    h.drop_index("ix_domain_blueprint_certification", "domain_blueprint")
    h.drop_table("domain_blueprint")

    h.drop_index("ix_domain_catalog_is_active", "domain_catalog")
    h.drop_index("ix_domain_catalog_blueprint_code", "domain_catalog")
    h.drop_index("ix_domain_catalog_objective_code", "domain_catalog")
    h.drop_index("ix_domain_catalog_subdomain", "domain_catalog")
    h.drop_index("ix_domain_catalog_domain", "domain_catalog")
    h.drop_index("ix_domain_catalog_certification", "domain_catalog")
    h.drop_table("domain_catalog")

    h.drop_index("ix_question_versions_question_format", "question_versions")
    h.drop_index("ix_question_versions_blueprint_code", "question_versions")
    h.drop_index("ix_question_versions_objective_code", "question_versions")
    h.drop_column("question_versions", "global_accuracy_percent")
    h.drop_column("question_versions", "avg_time_seconds")
    h.drop_column("question_versions", "incorrect_rationales_json")
    h.drop_column("question_versions", "correct_rationale")
    h.drop_column("question_versions", "question_format")
    h.drop_column("question_versions", "trap_patterns_json")
    h.drop_column("question_versions", "keywords_json")
    h.drop_column("question_versions", "blueprint_code")
    h.drop_column("question_versions", "objective_code")
    h.drop_column("question_versions", "subdomain")
    h.drop_column("question_versions", "subtopic")
    h.drop_column("question_versions", "subject")
