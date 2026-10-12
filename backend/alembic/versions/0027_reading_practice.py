"""Sentinel Reader practice (docs/reading/CONTRATO-INCREMENTO-2.md §4): drill, words, glossary, quiz.

Revision ID: 0027_reading_practice
Revises: 0026_reading
Create Date: 2026-10-12 18:00:00

- reading_attempt.sentence_index: the sentence read in the drill (NULL = whole paragraph).
- reading_word: spaced-repetition cards (pronunciation / vocabulary) per user.
- reading_glossary_entry: AI glossary cache per (word, context sentence), shared.
- reading_section_quiz / reading_quiz_answer: comprehension questions per section and answers.
- reading_ai_call: usage ledger of metered calls (AI quota and word reviews), no content.

Idempotent (see sq_migration_helpers).
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0027_reading_practice"
down_revision = "0026_reading"
branch_labels = None
depends_on = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    h.add_column("reading_attempt", sa.Column("sentence_index", sa.Integer(), nullable=True))

    h.create_table(
        "reading_word",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("word_norm", sa.String(64), nullable=False),
        sa.Column("display", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("ipa", sa.String(128), nullable=True),
        sa.Column("meaning_pt", sa.Text(), nullable=True),
        sa.Column("context", sa.String(400), nullable=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("section_id", sa.String(256), nullable=True),
        sa.Column("part_id", sa.String(256), nullable=True),
        sa.Column("block_index", sa.Integer(), nullable=True),
        sa.Column("reps", sa.Integer(), nullable=False),
        sa.Column("lapses", sa.Integer(), nullable=False),
        sa.Column("ease", sa.Float(), nullable=False),
        sa.Column("interval_days", sa.Float(), nullable=False),
        sa.Column("due_at", TZ, nullable=False),
        sa.Column("last_score", sa.Float(), nullable=True),
        sa.Column("last_reviewed_at", TZ, nullable=True),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("updated_at", TZ, nullable=False),
        sa.UniqueConstraint("user_id", "word_norm", "kind", name="uq_reading_word_user_word_kind"),
        sa.CheckConstraint("kind IN ('pronunciation', 'vocabulary')", name="ck_reading_word_kind"),
        sa.CheckConstraint("source IN ('assessment', 'glossary', 'manual')", name="ck_reading_word_source"),
    )
    h.create_index("ix_reading_word_user_due", "reading_word", ["user_id", "due_at"])

    h.create_table(
        "reading_glossary_entry",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("word_norm", sa.String(64), nullable=False),
        sa.Column("context_hash", sa.String(64), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.UniqueConstraint("word_norm", "context_hash", name="uq_reading_glossary_entry_word_context"),
    )

    h.create_table(
        "reading_section_quiz",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("section_id", sa.String(256), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("questions_json", sa.Text(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.UniqueConstraint("section_id", name="uq_reading_section_quiz_section_id"),
    )

    h.create_table(
        "reading_quiz_answer",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quiz_id", sa.String(36), sa.ForeignKey("reading_section_quiz.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_index", sa.Integer(), nullable=False),
        sa.Column("choice", sa.String(1), nullable=False),
        sa.Column("correct", sa.Boolean(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.UniqueConstraint("user_id", "quiz_id", "question_index", name="uq_reading_quiz_answer_user_quiz_question"),
    )

    h.create_table(
        "reading_ai_call",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
    )
    h.create_index("ix_reading_ai_call_user_created", "reading_ai_call", ["user_id", "created_at"])


def downgrade() -> None:
    h.drop_table("reading_ai_call")
    h.drop_table("reading_quiz_answer")
    h.drop_table("reading_section_quiz")
    h.drop_table("reading_glossary_entry")
    h.drop_table("reading_word")
    h.drop_column("reading_attempt", "sentence_index")
