"""Add exam selection strategy and richer SRS state.

Revision ID: 0005_exam_strategy_and_srs_state
Revises: 0004_study_session_strategy_and_mix
Create Date: 2026-03-02 19:10:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0005_exam_strategy_and_srs_state"
down_revision = "0004_study_session_strategy_and_mix"
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

    if "exam_sessions" in table_names:
        columns = _column_names(inspector, "exam_sessions")
        if "selection_strategy" not in columns:
            op.add_column(
                "exam_sessions",
                sa.Column(
                    "selection_strategy",
                    sa.String(length=24),
                    nullable=False,
                    server_default=sa.text("'standard'"),
                ),
            )
        if "selection_mix_json" not in columns:
            op.add_column(
                "exam_sessions",
                sa.Column("selection_mix_json", sa.Text(), nullable=True),
            )

        inspector = sa.inspect(bind)
        indexes = _index_names(inspector, "exam_sessions")
        if "ix_exam_sessions_selection_strategy" not in indexes:
            op.create_index(
                "ix_exam_sessions_selection_strategy",
                "exam_sessions",
                ["selection_strategy"],
                unique=False,
            )

    if "review_queue" in table_names:
        inspector = sa.inspect(bind)
        columns = _column_names(inspector, "review_queue")
        additions = [
            ("repetition_count", sa.Integer(), "0"),
            ("lapse_count", sa.Integer(), "0"),
            ("ease_factor", sa.Float(), "2.5"),
            ("stability_score", sa.Float(), "0"),
            ("last_quality", sa.Integer(), "0"),
        ]
        for name, column_type, default_value in additions:
            if name in columns:
                continue
            op.add_column(
                "review_queue",
                sa.Column(
                    name,
                    column_type,
                    nullable=False,
                    server_default=sa.text(default_value),
                ),
            )


def downgrade() -> None:
    raise RuntimeError("This migration is intentionally irreversible.")
