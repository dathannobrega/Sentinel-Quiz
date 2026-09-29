"""Content lifecycle (soft delete, import provenance), study modules, domain weights
and referential integrity fixes.

Revision ID: 0014_content_lifecycle_and_integrity
Revises: 0013_issue_workflow_and_placement
Create Date: 2026-09-28 12:00:00

- M-A1: exam_sessions/study_sessions.user_id ON DELETE CASCADE (SET NULL violated the
  owner XOR check, so users with sessions could not be deleted).
- M-A2: questions.is_active/deactivated_*; question_versions.import_hash and
  question_bank.last_import_hash (ingest never overwrites editorial versions).
- M-A3: history tables -> questions.id ON DELETE RESTRICT (questions are soft deleted);
  session_answers/study_attempts.question_version_id; per-session option order columns.
- M-A6: domain_blueprint.weight + official weights (CISSP / Security+ SY0-701).
- M-A7: study_modules table.
- L-A1: missing indexes. L-A2: FKs for question_bank version pointers and exam ids,
  CHECK constraints for closed value sets (only when existing data conforms).
- L-A3: user_exam_metrics_snapshot.session_id converged to a single unique index.

Idempotent like 0009-0013 (0008 used to run create_all with the current models).

Downgrade is lossy by nature (the 0013 schema has no soft delete, import provenance,
question versions per answer, option order or weights):
- questions.is_active/deactivated_* are dropped, so every soft-deleted question
  (editor delete or "removed from source") becomes visible again to 0013 code. The
  downgrade prints a WARNING with the counts before dropping them; re-run the upgrade
  (or hard-delete those questions yourself) if they must stay hidden.
- The domain_blueprint weight rows INSERTED by this revision (or by the 0014 ingest),
  recognisable by the "Official <cert> exam domain weight" description with no
  objective_code/subdomain, are deleted; pre-existing rows that only received a
  weight keep their row and just lose the column.
- ON DELETE rules go back to CASCADE/SET NULL; question_versions.exam_id gets NOT NULL
  again (NULLs filled from the question, or 'unknown').
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sq_migration_helpers as h  # noqa: E402
from sq_migration_helpers import FKSpec  # noqa: E402


revision = "0014_content_lifecycle_and_integrity"
down_revision = "0013_issue_workflow_and_placement"
branch_labels = None
depends_on = None


# Frozen copies (a migration must not depend on application constants that may change).
USER_ROLES = ("student", "editor", "reviewer", "admin")
DIFFICULTIES = ("Easy", "Medium", "Hard")
VERSION_STATUSES = ("draft", "in_review", "approved", "published", "archived")
ISSUE_STATUSES = ("open", "triaged", "fix_in_progress", "verified", "released", "dismissed")

OFFICIAL_DOMAIN_WEIGHTS = {
    "CISSP": [
        ("CISSP-D1", "Security and Risk Management", 16.0),
        ("CISSP-D2", "Asset Security", 10.0),
        ("CISSP-D3", "Security Architecture and Engineering", 13.0),
        ("CISSP-D4", "Communication and Network Security", 13.0),
        ("CISSP-D5", "Identity and Access Management (IAM)", 13.0),
        ("CISSP-D6", "Security Assessment and Testing", 12.0),
        ("CISSP-D7", "Security Operations", 13.0),
        ("CISSP-D8", "Software Development Security", 10.0),
    ],
    "Security+": [
        ("SY0-701-D1", "General Security Concepts", 12.0),
        ("SY0-701-D2", "Threats, Vulnerabilities and Mitigations", 22.0),
        ("SY0-701-D3", "Security Architecture", 18.0),
        ("SY0-701-D4", "Security Operations", 28.0),
        ("SY0-701-D5", "Security Program Management and Oversight", 20.0),
    ],
}

QUESTION_HISTORY_TABLES = (
    "session_answers",
    "study_attempts",
    "review_queue",
    "user_question_progress",
    "session_questions",
    "study_session_questions",
)

NEW_QUESTION_INDEXES = (
    ("ix_questions_exam_id", ["exam_id"]),
    ("ix_questions_domain", ["domain"]),
    ("ix_questions_certification", ["certification"]),
    ("ix_questions_difficulty", ["difficulty"]),
    ("ix_questions_certification_domain", ["certification", "domain"]),
    ("ix_questions_is_active", ["is_active"]),
    ("ix_questions_needs_review", ["needs_review"]),
    ("ix_questions_explanation_missing", ["explanation_missing"]),
)

OTHER_NEW_INDEXES = (
    ("ix_session_answers_question_id", "session_answers", ["question_id"]),
    ("ix_session_answers_question_version_id", "session_answers", ["question_version_id"]),
    ("ix_study_attempts_question_version_id", "study_attempts", ["question_version_id"]),
    ("ix_session_questions_question_id", "session_questions", ["question_id"]),
    ("ix_study_session_questions_question_id", "study_session_questions", ["question_id"]),
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


CHECKS = (
    ("users", "ck_users_role_allowed", _in("role", USER_ROLES)),
    ("question_bank", "ck_question_bank_review_status", _in("review_status", VERSION_STATUSES)),
    ("question_versions", "ck_question_versions_status", _in("status", VERSION_STATUSES)),
    ("question_versions", "ck_question_versions_difficulty", "difficulty IS NULL OR " + _in("difficulty", DIFFICULTIES)),
    ("questions", "ck_questions_difficulty", "difficulty IS NULL OR " + _in("difficulty", DIFFICULTIES)),
    ("question_issues", "ck_question_issues_status", _in("status", ISSUE_STATUSES)),
)


def _log(message: str) -> None:
    print(f"[0014] {message}")


# --------------------------------------------------------------------------- upgrade steps

def _add_columns() -> None:
    h.add_column("questions", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    h.add_column("questions", sa.Column("deactivated_reason", sa.String(length=32), nullable=True))
    h.add_column("questions", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))
    h.add_column("questions", sa.Column("language", sa.String(length=8), nullable=True))
    h.add_column("questions", sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()))
    h.add_column("questions", sa.Column("explanation_missing", sa.Boolean(), nullable=False, server_default=sa.false()))

    h.add_column("question_bank", sa.Column("last_import_hash", sa.String(length=64), nullable=True))
    h.add_column("question_versions", sa.Column("import_hash", sa.String(length=64), nullable=True))
    h.add_column("domain_blueprint", sa.Column("weight", sa.Float(), nullable=True))

    # FKs for these two are created in _ensure_foreign_keys (one table rebuild on SQLite).
    h.add_column("session_answers", sa.Column("question_version_id", sa.Integer(), nullable=True))
    h.add_column("study_attempts", sa.Column("question_version_id", sa.Integer(), nullable=True))
    h.add_column("session_questions", sa.Column("option_order_json", sa.Text(), nullable=True))
    h.add_column("study_session_questions", sa.Column("option_order_json", sa.Text(), nullable=True))


def _create_study_modules() -> None:
    h.create_table(
        "study_modules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("certification", sa.String(length=64), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("domain", sa.String(length=255), nullable=True),
        sa.Column("source_file", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("certification", "code", name="uq_study_modules_certification_code"),
    )
    h.create_index("ix_study_modules_certification_position", "study_modules", ["certification", "position"])


def _create_indexes() -> None:
    for name, columns in NEW_QUESTION_INDEXES:
        h.create_index(name, "questions", columns)
    for name, table, columns in OTHER_NEW_INDEXES:
        h.create_index(name, table, columns)
    h.create_index(
        "uq_domain_blueprint_weighted_domain",
        "domain_blueprint",
        ["certification", "domain"],
        unique=True,
        postgresql_where=sa.text("weight IS NOT NULL"),
        sqlite_where=sa.text("weight IS NOT NULL"),
    )


def _clean_dangling_references() -> None:
    h.execute(
        "UPDATE question_bank SET published_version_id = NULL WHERE published_version_id IS NOT NULL "
        "AND published_version_id NOT IN (SELECT id FROM question_versions)"
    )
    h.execute(
        "UPDATE question_bank SET draft_version_id = NULL WHERE draft_version_id IS NOT NULL "
        "AND draft_version_id NOT IN (SELECT id FROM question_versions)"
    )

    exam_id_col = h.get_column("question_versions", "exam_id")
    if exam_id_col is not None and not exam_id_col.get("nullable", True):
        if h.is_sqlite():
            with h.batch("question_versions", recreate="always") as b:
                b.alter_column("exam_id", existing_type=sa.String(length=128), nullable=True)
        else:
            op.alter_column("question_versions", "exam_id", existing_type=sa.String(length=128), nullable=True)

    for table in ("question_versions", "exam_sessions"):
        orphans = h.scalar(
            f"SELECT COUNT(*) FROM {table} WHERE exam_id IS NOT NULL AND exam_id NOT IN (SELECT id FROM exams)"
        )
        if orphans:
            _log(f"{table}: {orphans} row(s) reference a missing exam; exam_id set to NULL before adding the FK.")
            h.execute(
                f"UPDATE {table} SET exam_id = NULL WHERE exam_id IS NOT NULL AND exam_id NOT IN (SELECT id FROM exams)"
            )

    # Normalize difficulty spelling so the CHECK constraint can be added.
    for table in ("questions", "question_versions"):
        h.execute(f"UPDATE {table} SET difficulty = NULL WHERE difficulty IS NOT NULL AND TRIM(difficulty) = ''")
        for value in DIFFICULTIES:
            h.execute(
                f"UPDATE {table} SET difficulty = :value WHERE difficulty IS NOT NULL "
                f"AND LOWER(TRIM(difficulty)) = :lowered AND difficulty <> :value",
                value=value,
                lowered=value.lower(),
            )


def _ensure_foreign_keys() -> None:
    h.ensure_foreign_keys("exam_sessions", [
        FKSpec("user_id", "users", ondelete="CASCADE"),
        FKSpec("exam_id", "exams", ondelete="SET NULL"),
    ])
    h.ensure_foreign_keys("study_sessions", [FKSpec("user_id", "users", ondelete="CASCADE")])
    for table in QUESTION_HISTORY_TABLES:
        specs = [FKSpec("question_id", "questions", ondelete="RESTRICT")]
        if table in {"session_answers", "study_attempts"}:
            specs.append(FKSpec("question_version_id", "question_versions", ondelete="SET NULL"))
        h.ensure_foreign_keys(table, specs)
    h.ensure_foreign_keys("question_versions", [FKSpec("exam_id", "exams", ondelete="SET NULL")])
    h.ensure_foreign_keys("question_bank", [
        FKSpec("published_version_id", "question_versions", ondelete="SET NULL",
               name="fk_question_bank_published_version_id"),
        FKSpec("draft_version_id", "question_versions", ondelete="SET NULL",
               name="fk_question_bank_draft_version_id"),
    ])


def _ensure_checks() -> None:
    for table, name, condition in CHECKS:
        if not h.has_table(table) or h.has_check(table, name):
            continue
        violations = h.scalar(f"SELECT COUNT(*) FROM {table} WHERE NOT ({condition})")
        if violations:
            _log(
                f"WARNING: {violations} row(s) in {table} violate {name}; constraint NOT created. "
                "Fix the data and re-run the check manually."
            )
            continue
        h.create_check(table, name, condition)


def _converge_metrics_snapshot_session_unique() -> None:
    table = "user_exam_metrics_snapshot"
    if not h.has_table(table):
        return
    index_name = "ix_user_exam_metrics_snapshot_session_id"
    for uq in h.inspector().get_unique_constraints(table):
        if list(uq.get("column_names") or []) != ["session_id"]:
            continue
        name = uq.get("name") or "uq_user_exam_metrics_snapshot_session_id"
        if h.is_sqlite():
            with h.batch(table, recreate="always") as b:
                b.drop_constraint(name, type_="unique")
        else:
            op.drop_constraint(name, table, type_="unique")
    existing = h.index_map(table).get(index_name)
    if existing and not existing.get("unique"):
        op.drop_index(index_name, table_name=table)
        existing = None
    if not existing:
        op.create_index(index_name, table, ["session_id"], unique=True)


# 0009 created these columns with server defaults but never removed them, while the
# models declare Python-side defaults only (drift reported by `alembic check`).
LEGACY_SERVER_DEFAULTS = {
    "domain_catalog": ("is_active",),
    "user_domain_metrics_daily": (
        "attempts_total", "exam_attempts", "study_attempts", "correct_count", "wrong_count",
        "low_confidence_count", "total_elapsed_seconds", "timed_attempts",
    ),
    "user_exam_metrics_snapshot": (
        "mode", "total_questions", "answered_count", "correct_count", "wrong_count", "score_percent",
        "review_due_count", "review_total_count",
    ),
    "weekly_progress_snapshot": (
        "questions_answered", "review_questions", "scheduled_reviews", "correct_count", "wrong_count",
        "low_confidence_count", "completed_exam_sessions", "completed_study_sessions",
        "completed_review_sessions", "review_due_count", "review_total_count",
    ),
}


def _clear_legacy_server_defaults() -> None:
    for table, columns in LEGACY_SERVER_DEFAULTS.items():
        h.clear_server_defaults(table, columns)


def _backfill_import_provenance() -> None:
    editorial_actions = "('draft_saved','draft_updated','review_requested','approved','published','rolled_back')"
    h.execute(
        "UPDATE question_versions SET import_hash = 'legacy-import' "
        "WHERE import_hash IS NULL AND ("
        "  id IN (SELECT question_version_id FROM editorial_audit_log "
        "         WHERE question_version_id IS NOT NULL AND action IN ('import_published','seed_published'))"
        "  OR (created_by_user_id IS NULL AND approved_by_user_id IS NULL "
        "      AND status IN ('published','archived') "
        f"      AND id NOT IN (SELECT question_version_id FROM editorial_audit_log "
        f"                     WHERE question_version_id IS NOT NULL AND action IN {editorial_actions}))"
        ")"
    )
    h.execute(
        "UPDATE question_bank SET last_import_hash = 'legacy-import' "
        "WHERE last_import_hash IS NULL AND EXISTS ("
        "  SELECT 1 FROM question_versions v "
        "  WHERE v.question_bank_id = question_bank.stable_question_id AND v.import_hash IS NOT NULL)"
    )


def _seed_domain_weights() -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC (columns are naive at 0014)
    for certification, rows in OFFICIAL_DOMAIN_WEIGHTS.items():
        for blueprint_code, domain, weight in rows:
            existing = h.scalar(
                "SELECT id FROM domain_blueprint WHERE certification = :c AND domain = :d AND weight IS NOT NULL",
                c=certification,
                d=domain,
            )
            if existing:
                continue
            by_code = h.scalar(
                "SELECT id FROM domain_blueprint WHERE certification = :c AND blueprint_code = :b "
                "AND objective_code IS NULL",
                c=certification,
                b=blueprint_code,
            )
            if by_code:
                h.execute(
                    "UPDATE domain_blueprint SET domain = :d, weight = :w, updated_at = :now WHERE id = :id",
                    d=domain,
                    w=weight,
                    now=now,
                    id=by_code,
                )
                continue
            h.execute(
                "INSERT INTO domain_blueprint (certification, blueprint_code, objective_code, domain, subdomain, "
                "title, description, weight, created_at, updated_at) "
                "VALUES (:c, :b, NULL, :d, NULL, :d, :desc, :w, :now, :now)",
                c=certification,
                b=blueprint_code,
                d=domain,
                desc=f"Official {certification} exam domain weight ({weight:g}%).",
                w=weight,
                now=now,
            )


def upgrade() -> None:
    _add_columns()
    _create_study_modules()
    _clean_dangling_references()
    _ensure_foreign_keys()
    _create_indexes()
    _ensure_checks()
    _converge_metrics_snapshot_session_unique()
    _clear_legacy_server_defaults()
    _backfill_import_provenance()
    _seed_domain_weights()


# --------------------------------------------------------------------------- downgrade

def _warn_about_soft_deleted_questions() -> None:
    if not h.has_column("questions", "is_active"):
        return
    inactive = int(h.scalar("SELECT COUNT(*) FROM questions WHERE is_active = :f", f=False) or 0)
    if not inactive:
        return
    removed = int(
        h.scalar(
            "SELECT COUNT(*) FROM questions WHERE is_active = :f AND deactivated_reason = :r",
            f=False,
            r="removed_from_source",
        )
        or 0
    )
    _log(
        f"WARNING: {inactive} soft-deleted question(s) ({inactive - removed} deleted by editors, "
        f"{removed} removed from the source JSON) will become ACTIVE again: the 0013 schema has no "
        "questions.is_active. Re-run `alembic upgrade head` or hard-delete them if they must stay hidden."
    )


SEEDED_WEIGHT_DESCRIPTION_LIKE = "Official % exam domain weight (%"


def _remove_seeded_domain_weights() -> None:
    """Delete the domain-level weight rows this revision (or the 0014 ingest) inserted."""
    if not h.has_column("domain_blueprint", "weight"):
        return
    removed = 0
    for certification, rows in OFFICIAL_DOMAIN_WEIGHTS.items():
        for blueprint_code, domain, _weight in rows:
            params = dict(c=certification, b=blueprint_code, d=domain, pattern=SEEDED_WEIGHT_DESCRIPTION_LIKE)
            where = (
                "certification = :c AND blueprint_code = :b AND domain = :d AND weight IS NOT NULL "
                "AND objective_code IS NULL AND subdomain IS NULL AND description LIKE :pattern"
            )
            count = int(h.scalar(f"SELECT COUNT(*) FROM domain_blueprint WHERE {where}", **params) or 0)
            if count:
                h.execute(f"DELETE FROM domain_blueprint WHERE {where}", **params)
                removed += count
    if removed:
        _log(f"removed {removed} seeded domain weight row(s) from domain_blueprint.")


def downgrade() -> None:
    _warn_about_soft_deleted_questions()
    _remove_seeded_domain_weights()

    for table, name, _condition in CHECKS:
        h.drop_check(table, name)

    # Restore the pre-0014 ON DELETE rules and drop the FKs this revision introduced.
    h.drop_foreign_key("question_bank", ["published_version_id"], "question_versions")
    h.drop_foreign_key("question_bank", ["draft_version_id"], "question_versions")
    h.drop_foreign_key("question_versions", ["exam_id"], "exams")
    h.drop_foreign_key("exam_sessions", ["exam_id"], "exams")
    h.ensure_foreign_keys("exam_sessions", [FKSpec("user_id", "users", ondelete="SET NULL")])
    h.ensure_foreign_keys("study_sessions", [FKSpec("user_id", "users", ondelete="SET NULL")])
    for table in QUESTION_HISTORY_TABLES:
        h.ensure_foreign_keys(table, [FKSpec("question_id", "questions", ondelete="CASCADE")])

    if h.has_column("question_versions", "exam_id"):
        h.execute(
            "UPDATE question_versions SET exam_id = ("
            "  SELECT q.exam_id FROM questions q WHERE q.id = question_versions.question_bank_id"
            ") WHERE exam_id IS NULL"
        )
        h.execute("UPDATE question_versions SET exam_id = 'unknown' WHERE exam_id IS NULL")
        if h.is_sqlite():
            with h.batch("question_versions", recreate="always") as b:
                b.alter_column("exam_id", existing_type=sa.String(length=128), nullable=False)
        else:
            op.alter_column("question_versions", "exam_id", existing_type=sa.String(length=128), nullable=False)

    h.drop_index("uq_domain_blueprint_weighted_domain", "domain_blueprint")
    for name, table, _columns in OTHER_NEW_INDEXES:
        h.drop_index(name, table)
    for name, _columns in NEW_QUESTION_INDEXES:
        h.drop_index(name, "questions")

    h.drop_index("ix_study_modules_certification_position", "study_modules")
    h.drop_table("study_modules")

    h.drop_column("study_session_questions", "option_order_json")
    h.drop_column("session_questions", "option_order_json")
    h.drop_column("study_attempts", "question_version_id")
    h.drop_column("session_answers", "question_version_id")
    h.drop_column("domain_blueprint", "weight")
    h.drop_column("question_versions", "import_hash")
    h.drop_column("question_bank", "last_import_hash")
    for column in ("explanation_missing", "needs_review", "language", "deactivated_at", "deactivated_reason", "is_active"):
        h.drop_column("questions", column)
    # user_exam_metrics_snapshot.session_id keeps the unique index (valid for 0013 code).
