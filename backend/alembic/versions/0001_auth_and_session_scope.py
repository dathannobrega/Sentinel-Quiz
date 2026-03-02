"""Baseline auth and session ownership support.

Revision ID: 0001_auth_and_session_scope
Revises:
Create Date: 2026-03-02 09:30:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0001_auth_and_session_scope"
down_revision = None
branch_labels = None
depends_on = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _foreign_key_names(inspector, table_name: str) -> set[str]:
    names = set()
    for foreign_key in inspector.get_foreign_keys(table_name):
        name = foreign_key.get("name")
        if name:
            names.add(name)
    return names


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = _table_names(inspector)

    if "users" not in table_names:
        op.create_table(
            "users",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=True),
            sa.Column("password_hash", sa.Text(), nullable=False),
            sa.Column("role", sa.String(length=32), nullable=False, server_default=sa.text("'student'")),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("email", name="uq_users_email"),
        )
        table_names.add("users")

    if "auth_tokens" not in table_names:
        op.create_table(
            "auth_tokens",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash", name="uq_auth_tokens_token_hash"),
        )
        table_names.add("auth_tokens")

    inspector = sa.inspect(bind)
    table_names = _table_names(inspector)

    if "exam_sessions" in table_names:
        session_columns = _column_names(inspector, "exam_sessions")
        if "user_id" not in session_columns:
            op.add_column("exam_sessions", sa.Column("user_id", sa.String(length=36), nullable=True))
        if "client_key" not in session_columns:
            op.add_column("exam_sessions", sa.Column("client_key", sa.String(length=64), nullable=True))

        inspector = sa.inspect(bind)
        session_foreign_keys = _foreign_key_names(inspector, "exam_sessions")
        if bind.dialect.name != "sqlite" and "fk_exam_sessions_user_id_users" not in session_foreign_keys:
            op.create_foreign_key(
                "fk_exam_sessions_user_id_users",
                "exam_sessions",
                "users",
                ["user_id"],
                ["id"],
                ondelete="SET NULL",
            )

        session_indexes = _index_names(inspector, "exam_sessions")
        if "ix_exam_sessions_user_id" not in session_indexes:
            op.create_index("ix_exam_sessions_user_id", "exam_sessions", ["user_id"], unique=False)
        if "ix_exam_sessions_client_key" not in session_indexes:
            op.create_index("ix_exam_sessions_client_key", "exam_sessions", ["client_key"], unique=False)
        if "ix_exam_sessions_completed_at" not in session_indexes:
            op.create_index("ix_exam_sessions_completed_at", "exam_sessions", ["completed_at"], unique=False)

    inspector = sa.inspect(bind)
    if "auth_tokens" in _table_names(inspector):
        auth_indexes = _index_names(inspector, "auth_tokens")
        if "ix_auth_tokens_user_id" not in auth_indexes:
            op.create_index("ix_auth_tokens_user_id", "auth_tokens", ["user_id"], unique=False)
        if "ix_auth_tokens_expires_at" not in auth_indexes:
            op.create_index("ix_auth_tokens_expires_at", "auth_tokens", ["expires_at"], unique=False)
        if "ix_auth_tokens_revoked_at" not in auth_indexes:
            op.create_index("ix_auth_tokens_revoked_at", "auth_tokens", ["revoked_at"], unique=False)


def downgrade() -> None:
    raise RuntimeError("This baseline migration is intentionally irreversible.")
