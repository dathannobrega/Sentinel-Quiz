"""Content licence of questions (Sentinel Arena prerequisite, PLANO §11.1).

Revision ID: 0018_license_scope
Revises: 0017_performance_based_questions
Create Date: 2026-09-30 12:00:00

- questions.license_scope (own | platform | pending_audit | personal_use, CHECK + index,
  default "pending_audit") and questions.source_license.
- Backfill: every existing row starts as "pending_audit" (fail closed: the provenance
  is not in the database yet). The next ingest classifies each question by provenance
  (services/licensing.classify_license_scope) and a hash-identical file is re-processed
  because _needs_metadata_refresh compares the scope.

Idempotent (see sq_migration_helpers).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0018_license_scope"
down_revision = "0017_performance_based_questions"
branch_labels = None
depends_on = None

# Frozen copy (a migration must not depend on application constants).
LICENSE_SCOPES = ("own", "platform", "pending_audit", "personal_use")
CHECK_NAME = "ck_questions_license_scope"
INDEX_NAME = "ix_questions_license_scope"


def upgrade() -> None:
    h.add_column(
        "questions",
        sa.Column("license_scope", sa.String(length=24), nullable=False, server_default=sa.text("'pending_audit'")),
    )
    h.add_column("questions", sa.Column("source_license", sa.String(length=64), nullable=True))
    h.create_index(INDEX_NAME, "questions", ["license_scope"])
    allowed = ", ".join(f"'{value}'" for value in LICENSE_SCOPES)
    h.create_check("questions", CHECK_NAME, f"license_scope IN ({allowed})")


def downgrade() -> None:
    h.drop_check("questions", CHECK_NAME)
    h.drop_index(INDEX_NAME, "questions")
    h.drop_column("questions", "source_license")
    h.drop_column("questions", "license_scope")
