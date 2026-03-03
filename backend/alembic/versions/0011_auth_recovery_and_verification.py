"""Add email verification and password reset challenges.

Revision ID: 0011_auth_recovery_and_verification
Revises: 0010_pedagogy_and_engagement
Create Date: 2026-03-02 20:15:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0011_auth_recovery_and_verification"
down_revision = "0010_pedagogy_and_engagement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    op.create_index("ix_users_email_verified_at", "users", ["email_verified_at"], unique=False)

    op.create_table(
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
    op.create_index("ix_auth_challenges_user_id", "auth_challenges", ["user_id"], unique=False)
    op.create_index("ix_auth_challenges_challenge_type", "auth_challenges", ["challenge_type"], unique=False)
    op.create_index("ix_auth_challenges_expires_at", "auth_challenges", ["expires_at"], unique=False)
    op.create_index("ix_auth_challenges_consumed_at", "auth_challenges", ["consumed_at"], unique=False)

    op.alter_column("users", "email_verified", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_auth_challenges_consumed_at", table_name="auth_challenges")
    op.drop_index("ix_auth_challenges_expires_at", table_name="auth_challenges")
    op.drop_index("ix_auth_challenges_challenge_type", table_name="auth_challenges")
    op.drop_index("ix_auth_challenges_user_id", table_name="auth_challenges")
    op.drop_table("auth_challenges")

    op.drop_index("ix_users_email_verified_at", table_name="users")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "email_verified")
