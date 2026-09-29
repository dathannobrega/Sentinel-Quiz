"""Performance-based questions (PBQ).

Revision ID: 0017_performance_based_questions
Revises: 0016_study_module_prerequisites
Create Date: 2026-09-29 18:00:00

- questions.question_format ("mcq" default | "pbq", CHECK + index),
  questions.pbq_payload_json (public payload) and questions.pbq_answer_json (private
  answer key: solutions, scoring, explanations).
- question_versions.pbq_payload_json / pbq_answer_json (editorial versioning; the
  existing question_versions.question_format column holds "pbq" for these versions).
- session_questions / study_session_questions.pbq_order_json: per-session shuffle of
  the PBQ items ({task_id: [item ids in display order]}).
- session_answers / study_attempts.response_json (learner response, JSON) and score
  (partial credit 0..1, NULL for multiple-choice answers).

Idempotent (see sq_migration_helpers). Downgrade drops the columns; PBQ questions are
deactivated first (0016 code cannot serve them) and their answers keep only the
is_correct verdict.
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0017_performance_based_questions"
down_revision = "0016_study_module_prerequisites"
branch_labels = None
depends_on = None

# Frozen copy (a migration must not depend on application constants).
QUESTION_FORMATS = ("mcq", "pbq")
CHECK_NAME = "ck_questions_question_format"
INDEX_NAME = "ix_questions_question_format"


def upgrade() -> None:
    h.add_column(
        "questions",
        sa.Column("question_format", sa.String(length=8), nullable=False, server_default=sa.text("'mcq'")),
    )
    h.add_column("questions", sa.Column("pbq_payload_json", sa.Text(), nullable=True))
    h.add_column("questions", sa.Column("pbq_answer_json", sa.Text(), nullable=True))
    h.create_index(INDEX_NAME, "questions", ["question_format"])
    allowed = ", ".join(f"'{value}'" for value in QUESTION_FORMATS)
    h.create_check("questions", CHECK_NAME, f"question_format IN ({allowed})")

    h.add_column("question_versions", sa.Column("pbq_payload_json", sa.Text(), nullable=True))
    h.add_column("question_versions", sa.Column("pbq_answer_json", sa.Text(), nullable=True))

    for table in ("session_questions", "study_session_questions"):
        h.add_column(table, sa.Column("pbq_order_json", sa.Text(), nullable=True))

    for table in ("session_answers", "study_attempts"):
        h.add_column(table, sa.Column("response_json", sa.Text(), nullable=True))
        h.add_column(table, sa.Column("score", sa.Float(), nullable=True))


def downgrade() -> None:
    if h.has_column("questions", "question_format") and h.has_column("questions", "is_active"):
        h.execute(
            "UPDATE questions SET is_active = :f, deactivated_reason = COALESCE(deactivated_reason, 'deleted') "
            "WHERE question_format = 'pbq'",
            f=False,
        )
    for table in ("session_answers", "study_attempts"):
        h.drop_column(table, "score")
        h.drop_column(table, "response_json")
    for table in ("session_questions", "study_session_questions"):
        h.drop_column(table, "pbq_order_json")
    h.drop_column("question_versions", "pbq_answer_json")
    h.drop_column("question_versions", "pbq_payload_json")
    h.drop_check("questions", CHECK_NAME)
    h.drop_index(INDEX_NAME, "questions")
    h.drop_column("questions", "pbq_answer_json")
    h.drop_column("questions", "pbq_payload_json")
    h.drop_column("questions", "question_format")
