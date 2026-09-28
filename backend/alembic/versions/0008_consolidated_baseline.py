"""Consolidated baseline schema from the current source-of-truth models.

Revision ID: 0008_question_stats_snapshot
Revises:
Create Date: 2026-03-03 01:05:00

NOTE: this baseline calls ``Base.metadata.create_all`` with the *current*
models, so on an empty database it already creates the final schema. Every
later revision must therefore be idempotent (skip objects that already exist);
see ``alembic/sq_migration_helpers.py``.
"""
from __future__ import annotations

import sqlalchemy as sa
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
    bind = op.get_bind()
    # Drop what actually exists (reflected), not what the current models describe:
    # later downgrades may already have removed columns/constraints the models still
    # declare, which would make metadata.drop_all emit invalid DROP CONSTRAINTs.
    reflected = sa.MetaData()
    reflected.reflect(bind=bind)
    if bind.dialect.name == "postgresql":
        for name in reflected.tables:
            if name != "alembic_version":
                op.execute(sa.text(f'DROP TABLE IF EXISTS "{name}" CASCADE'))
        return
    for table in reversed(reflected.sorted_tables):
        if table.name != "alembic_version":
            op.execute(sa.text(f'DROP TABLE IF EXISTS "{table.name}"'))
