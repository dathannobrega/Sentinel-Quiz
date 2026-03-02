"""Add explicit study session strategy metadata.

Revision ID: 0004_study_session_strategy_and_mix
Revises: 0003_study_mode_and_review_queue
Create Date: 2026-03-02 15:40:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0004_study_session_strategy_and_mix"
down_revision = "0003_study_mode_and_review_queue"
branch_labels = None
depends_on = None


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "study_sessions" not in table_names:
        return

    columns = _column_names(inspector, "study_sessions")
    if "selection_strategy" not in columns:
        op.add_column(
            "study_sessions",
            sa.Column(
                "selection_strategy",
                sa.String(length=24),
                nullable=False,
                server_default=sa.text("'standard'"),
            ),
        )
    if "selection_mix_json" not in columns:
        op.add_column(
            "study_sessions",
            sa.Column("selection_mix_json", sa.Text(), nullable=True),
        )

    inspector = sa.inspect(bind)
    indexes = _index_names(inspector, "study_sessions")
    if "ix_study_sessions_selection_strategy" not in indexes:
        op.create_index(
            "ix_study_sessions_selection_strategy",
            "study_sessions",
            ["selection_strategy"],
            unique=False,
        )


def downgrade() -> None:
    raise RuntimeError("This migration is intentionally irreversible.")
