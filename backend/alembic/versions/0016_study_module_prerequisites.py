"""Study track prerequisites (M-A7).

Revision ID: 0016_study_module_prerequisites
Revises: 0015_timezone_aware_timestamps
Create Date: 2026-09-29 13:00:00

Adds ``study_modules.prerequisite_codes`` (JSON list of module codes of the same
certification). The values (and the Security+ module -> SY0-701 domain mapping) are
data: they are applied by the ingest from ``app/data/study_track_metadata.json`` on the
next ingest run. Idempotent.
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0016_study_module_prerequisites"
down_revision = "0015_timezone_aware_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    h.add_column("study_modules", sa.Column("prerequisite_codes", sa.JSON(), nullable=True))


def downgrade() -> None:
    h.drop_column("study_modules", "prerequisite_codes")
