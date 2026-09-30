"""Sentinel Arena GA item types (Incremento 5).

Revision ID: 0023_live_ga_item_types
Revises: 0022_live_moderation
Create Date: 2026-10-02 10:00:00

- ck_live_quiz_item_type accepts ordering, numeric and word_cloud.
- live_session.hidden_words: word-cloud words the host hid from the projector.

Idempotent (see sq_migration_helpers): the check is replaced only when its
definition does not already list the new types.
"""
from __future__ import annotations

import os
import sys

import sqlalchemy as sa

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402

revision = "0023_live_ga_item_types"
down_revision = "0022_live_moderation"
branch_labels = None
depends_on = None

CHECK = "ck_live_quiz_item_type"
MVP0_TYPES = ("single_choice", "multi_choice", "true_false", "type_answer", "poll", "content", "leaderboard")
GA_TYPES = MVP0_TYPES + ("ordering", "numeric", "word_cloud")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _check_sql() -> str:
    for check in h.inspector().get_check_constraints("live_quiz_item"):
        if check.get("name") == CHECK:
            return str(check.get("sqltext") or "")
    return ""


def _replace(values: tuple[str, ...]) -> None:
    if not h.has_table("live_quiz_item"):
        return
    if h.is_sqlite():
        # One rebuild for drop + create (live_quiz_item is only referenced with SET NULL).
        with h.batch("live_quiz_item", recreate="always") as b:
            if h.has_check("live_quiz_item", CHECK):
                b.drop_constraint(CHECK, type_="check")
            b.create_check_constraint(CHECK, sa.text(_in("item_type", values)))
        return
    h.drop_check("live_quiz_item", CHECK)
    h.create_check("live_quiz_item", CHECK, _in("item_type", values))


def upgrade() -> None:
    h.add_column("live_session", sa.Column("hidden_words", sa.JSON(), nullable=True))
    if "word_cloud" not in _check_sql():
        _replace(GA_TYPES)


def downgrade() -> None:
    # Rows of the GA types would violate the narrower check: they must be removed first.
    h.execute("DELETE FROM live_quiz_item WHERE item_type IN ('ordering', 'numeric', 'word_cloud')")
    _replace(MVP0_TYPES)
    h.drop_column("live_session", "hidden_words")
