"""Consolidated baseline schema from the current source-of-truth models.

Revision ID: 0008_question_stats_snapshot
Revises:
Create Date: 2026-03-03 01:05:00
"""
from __future__ import annotations

from alembic import context, op

from app.db.base import Base
import app.models  # noqa: F401


# The revision id from the previous head is preserved so local databases already
# stamped at the latest pre-consolidation revision remain compatible.
revision = "0008_question_stats_snapshot"
down_revision = None
branch_labels = None
depends_on = None


def _require_online_mode() -> None:
    if context.is_offline_mode():
        raise RuntimeError(
            "Offline SQL generation is not supported for the consolidated baseline migration. "
            "Run Alembic in online mode against the target database."
        )


def upgrade() -> None:
    _require_online_mode()
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    _require_online_mode()
    Base.metadata.drop_all(bind=op.get_bind())
