"""Add pedagogy and engagement persistence.

Revision ID: 0010_pedagogy_and_engagement
Revises: 0009_editorial_metadata_and_metrics
Create Date: 2026-03-02 18:20:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0010_pedagogy_and_engagement"
down_revision = "0009_editorial_metadata_and_metrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "question_hints",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("question_version_id", sa.Integer(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("hint_text", sa.Text(), nullable=False),
        sa.Column("hint_kind", sa.String(length=32), nullable=False, server_default="concept"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_version_id"], ["question_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("level >= 1 AND level <= 3", name="ck_question_hints_level_range"),
        sa.UniqueConstraint("question_version_id", "level", name="uq_question_hints_version_level"),
    )
    op.create_index("ix_question_hints_question_version_id", "question_hints", ["question_version_id"], unique=False)

    op.create_table(
        "reference_catalog",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("question_version_id", sa.Integer(), nullable=True),
        sa.Column("certification", sa.String(length=64), nullable=True),
        sa.Column("domain", sa.String(length=255), nullable=True),
        sa.Column("subdomain", sa.String(length=255), nullable=True),
        sa.Column("objective_code", sa.String(length=64), nullable=True),
        sa.Column("blueprint_code", sa.String(length=64), nullable=True),
        sa.Column("source_kind", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("reference_text", sa.Text(), nullable=True),
        sa.Column("material_path", sa.String(length=255), nullable=True),
        sa.Column("locator", sa.String(length=255), nullable=True),
        sa.Column("page_start", sa.Integer(), nullable=True),
        sa.Column("page_end", sa.Integer(), nullable=True),
        sa.Column("is_official", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["question_version_id"], ["question_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reference_catalog_question_version_id", "reference_catalog", ["question_version_id"], unique=False)
    op.create_index("ix_reference_catalog_certification", "reference_catalog", ["certification"], unique=False)
    op.create_index("ix_reference_catalog_domain", "reference_catalog", ["domain"], unique=False)
    op.create_index("ix_reference_catalog_subdomain", "reference_catalog", ["subdomain"], unique=False)
    op.create_index("ix_reference_catalog_objective_code", "reference_catalog", ["objective_code"], unique=False)
    op.create_index("ix_reference_catalog_blueprint_code", "reference_catalog", ["blueprint_code"], unique=False)
    op.create_index("ix_reference_catalog_source_kind", "reference_catalog", ["source_kind"], unique=False)
    op.create_index("ix_reference_catalog_is_official", "reference_catalog", ["is_official"], unique=False)

    op.create_table(
        "user_goals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("daily_question_target", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("daily_review_target", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("weekly_question_target", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("weekly_review_target", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("stretch_question_target", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_user_goals_owner_scope_xor"),
        sa.UniqueConstraint("user_id", name="uq_user_goals_user"),
        sa.UniqueConstraint("client_key", name="uq_user_goals_client"),
    )
    op.create_index("ix_user_goals_user_id", "user_goals", ["user_id"], unique=False)
    op.create_index("ix_user_goals_client_key", "user_goals", ["client_key"], unique=False)

    op.create_table(
        "user_streaks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("current_streak_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("best_streak_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_active_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_activity_date", sa.DateTime(), nullable=True),
        sa.Column("last_goal_completed_date", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_user_streaks_owner_scope_xor"),
        sa.UniqueConstraint("user_id", name="uq_user_streaks_user"),
        sa.UniqueConstraint("client_key", name="uq_user_streaks_client"),
    )
    op.create_index("ix_user_streaks_user_id", "user_streaks", ["user_id"], unique=False)
    op.create_index("ix_user_streaks_client_key", "user_streaks", ["client_key"], unique=False)
    op.create_index("ix_user_streaks_last_activity_date", "user_streaks", ["last_activity_date"], unique=False)
    op.create_index("ix_user_streaks_last_goal_completed_date", "user_streaks", ["last_goal_completed_date"], unique=False)

    op.create_table(
        "adaptive_profile",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("client_key", sa.String(length=64), nullable=True),
        sa.Column("weak_domain_focus_json", sa.Text(), nullable=True),
        sa.Column("low_confidence_bias", sa.Float(), nullable=False, server_default="0"),
        sa.Column("variety_floor_percent", sa.Float(), nullable=False, server_default="30"),
        sa.Column("recovery_mode", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_recomputed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("(user_id IS NULL) <> (client_key IS NULL)", name="ck_adaptive_profile_owner_scope_xor"),
        sa.UniqueConstraint("user_id", name="uq_adaptive_profile_user"),
        sa.UniqueConstraint("client_key", name="uq_adaptive_profile_client"),
    )
    op.create_index("ix_adaptive_profile_user_id", "adaptive_profile", ["user_id"], unique=False)
    op.create_index("ix_adaptive_profile_client_key", "adaptive_profile", ["client_key"], unique=False)
    op.create_index("ix_adaptive_profile_last_recomputed_at", "adaptive_profile", ["last_recomputed_at"], unique=False)

    op.alter_column("question_hints", "hint_kind", server_default=None)
    op.alter_column("reference_catalog", "is_official", server_default=None)
    op.alter_column("user_goals", "daily_question_target", server_default=None)
    op.alter_column("user_goals", "daily_review_target", server_default=None)
    op.alter_column("user_goals", "weekly_question_target", server_default=None)
    op.alter_column("user_goals", "weekly_review_target", server_default=None)
    op.alter_column("user_goals", "stretch_question_target", server_default=None)
    op.alter_column("user_streaks", "current_streak_days", server_default=None)
    op.alter_column("user_streaks", "best_streak_days", server_default=None)
    op.alter_column("user_streaks", "total_active_days", server_default=None)
    op.alter_column("adaptive_profile", "low_confidence_bias", server_default=None)
    op.alter_column("adaptive_profile", "variety_floor_percent", server_default=None)
    op.alter_column("adaptive_profile", "recovery_mode", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_adaptive_profile_last_recomputed_at", table_name="adaptive_profile")
    op.drop_index("ix_adaptive_profile_client_key", table_name="adaptive_profile")
    op.drop_index("ix_adaptive_profile_user_id", table_name="adaptive_profile")
    op.drop_table("adaptive_profile")

    op.drop_index("ix_user_streaks_last_goal_completed_date", table_name="user_streaks")
    op.drop_index("ix_user_streaks_last_activity_date", table_name="user_streaks")
    op.drop_index("ix_user_streaks_client_key", table_name="user_streaks")
    op.drop_index("ix_user_streaks_user_id", table_name="user_streaks")
    op.drop_table("user_streaks")

    op.drop_index("ix_user_goals_client_key", table_name="user_goals")
    op.drop_index("ix_user_goals_user_id", table_name="user_goals")
    op.drop_table("user_goals")

    op.drop_index("ix_reference_catalog_is_official", table_name="reference_catalog")
    op.drop_index("ix_reference_catalog_source_kind", table_name="reference_catalog")
    op.drop_index("ix_reference_catalog_blueprint_code", table_name="reference_catalog")
    op.drop_index("ix_reference_catalog_objective_code", table_name="reference_catalog")
    op.drop_index("ix_reference_catalog_subdomain", table_name="reference_catalog")
    op.drop_index("ix_reference_catalog_domain", table_name="reference_catalog")
    op.drop_index("ix_reference_catalog_certification", table_name="reference_catalog")
    op.drop_index("ix_reference_catalog_question_version_id", table_name="reference_catalog")
    op.drop_table("reference_catalog")

    op.drop_index("ix_question_hints_question_version_id", table_name="question_hints")
    op.drop_table("question_hints")
