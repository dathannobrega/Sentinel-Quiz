"""Add email verification and password reset challenges.

Revision ID: 0011_auth_recovery_and_verification
Revises: 0010_pedagogy_and_engagement
Create Date: 2026-03-02 20:15:00
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402


revision = "0011_auth_recovery_and_verification"
down_revision = "0010_pedagogy_and_engagement"
branch_labels = None
depends_on = None

# Idempotent: revision 0008 runs create_all with the current models, so on an empty
# database everything below may already exist. Every operation checks the live
# schema first (see alembic/sq_migration_helpers.py).


def upgrade() -> None:
    h.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    h.add_column("users", sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    h.create_index("ix_users_email_verified_at", "users", ["email_verified_at"], unique=False)

    h.create_table(
        "auth_challenges",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("challenge_type", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("delivery_target", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    h.create_index("ix_auth_challenges_user_id", "auth_challenges", ["user_id"], unique=False)
    h.create_index("ix_auth_challenges_challenge_type", "auth_challenges", ["challenge_type"], unique=False)
    h.create_index("ix_auth_challenges_expires_at", "auth_challenges", ["expires_at"], unique=False)
    h.create_index("ix_auth_challenges_consumed_at", "auth_challenges", ["consumed_at"], unique=False)

    h.clear_server_default("users", "email_verified")


def downgrade() -> None:
    h.drop_index("ix_auth_challenges_consumed_at", "auth_challenges")
    h.drop_index("ix_auth_challenges_expires_at", "auth_challenges")
    h.drop_index("ix_auth_challenges_challenge_type", "auth_challenges")
    h.drop_index("ix_auth_challenges_user_id", "auth_challenges")
    h.drop_table("auth_challenges")

    h.drop_index("ix_users_email_verified_at", "users")
    h.drop_column("users", "email_verified_at")
    h.drop_column("users", "email_verified")
