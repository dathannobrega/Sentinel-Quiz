"""Add user bookmarks and notes for persistent study state.

Revision ID: 0002_user_study_state
Revises: 0001_auth_and_session_scope
Create Date: 2026-03-02 11:20:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0002_user_study_state"
down_revision = "0001_auth_and_session_scope"
branch_labels = None
depends_on = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = _table_names(inspector)

    if "user_bookmarks" not in table_names:
        op.create_table(
            "user_bookmarks",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("client_key", sa.String(length=64), nullable=True),
            sa.Column("question_id", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "question_id", name="uq_user_bookmarks_user_question"),
            sa.UniqueConstraint("client_key", "question_id", name="uq_user_bookmarks_client_question"),
        )
        table_names.add("user_bookmarks")

    if "user_notes" not in table_names:
        op.create_table(
            "user_notes",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("client_key", sa.String(length=64), nullable=True),
            sa.Column("question_id", sa.String(length=128), nullable=False),
            sa.Column("note_text", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "question_id", name="uq_user_notes_user_question"),
            sa.UniqueConstraint("client_key", "question_id", name="uq_user_notes_client_question"),
        )
        table_names.add("user_notes")

    inspector = sa.inspect(bind)
    if "user_bookmarks" in _table_names(inspector):
        bookmark_indexes = _index_names(inspector, "user_bookmarks")
        if "ix_user_bookmarks_user_id" not in bookmark_indexes:
            op.create_index("ix_user_bookmarks_user_id", "user_bookmarks", ["user_id"], unique=False)
        if "ix_user_bookmarks_client_key" not in bookmark_indexes:
            op.create_index("ix_user_bookmarks_client_key", "user_bookmarks", ["client_key"], unique=False)
        if "ix_user_bookmarks_question_id" not in bookmark_indexes:
            op.create_index("ix_user_bookmarks_question_id", "user_bookmarks", ["question_id"], unique=False)

    inspector = sa.inspect(bind)
    if "user_notes" in _table_names(inspector):
        note_indexes = _index_names(inspector, "user_notes")
        if "ix_user_notes_user_id" not in note_indexes:
            op.create_index("ix_user_notes_user_id", "user_notes", ["user_id"], unique=False)
        if "ix_user_notes_client_key" not in note_indexes:
            op.create_index("ix_user_notes_client_key", "user_notes", ["client_key"], unique=False)
        if "ix_user_notes_question_id" not in note_indexes:
            op.create_index("ix_user_notes_question_id", "user_notes", ["question_id"], unique=False)


def downgrade() -> None:
    raise RuntimeError("This migration is intentionally irreversible.")
