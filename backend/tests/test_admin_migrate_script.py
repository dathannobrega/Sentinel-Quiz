"""scripts/migrate_sqlite_to_postgres.py (phase 2 / workstream F). Self-contained.

Unit tests always run; the end-to-end copy runs against PostgreSQL only when
TEST_DATABASE_URL is set (each test uses its own schema).
"""
from __future__ import annotations

import importlib.util
import os
import uuid
from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa

BACKEND = Path(__file__).resolve().parents[1]
SCRIPT = BACKEND.parent / "scripts" / "migrate_sqlite_to_postgres.py"
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "").strip()


def _load_script():
    spec = importlib.util.spec_from_file_location("migrate_sqlite_to_postgres", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


migrate = _load_script()

from app.db.base import Base  # noqa: E402
from app.models import (  # noqa: E402
    Exam,
    Explanation,
    Option,
    Question,
    QuestionBank,
    QuestionVersion,
    User,
)


# ------------------------------------------------------------------ unit
def test_plan_tables_is_fk_safe():
    tables = migrate.plan_tables(Base.metadata.tables.keys())
    names = [table.name for table in tables]
    position = {name: index for index, name in enumerate(names)}
    for table in tables:
        for fk in table.foreign_keys:
            if fk.constraint.use_alter:
                continue
            parent = fk.column.table.name
            if parent != table.name:
                assert position[parent] < position[table.name], (parent, table.name)
    cyclic = migrate.cyclic_fk_columns()
    assert set(cyclic) == {"question_bank"}
    assert sorted(cyclic["question_bank"]) == ["draft_version_id", "published_version_id"]


def test_copy_columns_uses_defaults_for_new_columns_and_rejects_missing_required():
    questions = Base.metadata.tables["questions"]
    legacy = ["id", "exam_id", "prompt", "multi_select", "domain", "difficulty", "certification"]
    # is_active / needs_review / explanation_missing / language... get model defaults.
    assert migrate.copy_columns(questions, legacy) == legacy
    with pytest.raises(migrate.MigrationError, match="prompt"):
        migrate.copy_columns(questions, ["id", "exam_id"])


def _sqlite_source(tmp_path: Path) -> str:
    url = f"sqlite+pysqlite:///{tmp_path / 'legacy.db'}"
    engine = sa.create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()
    return url


def test_check_violations_are_reported_from_source(tmp_path: Path):
    url = _sqlite_source(tmp_path)
    engine = sa.create_engine(url)
    with engine.begin() as conn:
        conn.execute(sa.text("PRAGMA ignore_check_constraints = 1"))
        conn.execute(sa.insert(Exam.__table__).values(id="secplus", title="Security+", question_count=1))
        conn.execute(
            sa.insert(Question.__table__).values(
                id="q-bad", exam_id="secplus", prompt="P", multi_select=False, difficulty="Impossible"
            )
        )
    with engine.connect() as conn:
        table = Base.metadata.tables["questions"]
        problems = migrate.find_check_violations(conn, table, [c.name for c in table.columns])
    engine.dispose()
    assert len(problems) == 1
    assert "ck_questions_difficulty" in problems[0] and "q-bad" in problems[0]


def test_cli_validates_urls():
    with pytest.raises(SystemExit):
        migrate.main(["--source", "postgresql://x/y", "--target", "postgresql://x/z"])
    with pytest.raises(SystemExit):
        migrate.main(["--source", "sqlite:///x.db", "--target", "sqlite:///y.db"])


# ------------------------------------------------------------------ PostgreSQL end-to-end
def _seed_legacy(url: str, *, bad_difficulty: bool = False) -> None:
    engine = sa.create_engine(url)
    with engine.begin() as conn:
        if bad_difficulty:
            conn.execute(sa.text("PRAGMA ignore_check_constraints = 1"))
        conn.execute(sa.insert(User.__table__).values(
            id="u1", email="admin@example.com", password_hash="x", role="admin", is_active=True, email_verified=True,
            created_at=datetime(2025, 1, 1), updated_at=datetime(2025, 1, 1),
        ))
        conn.execute(sa.insert(Exam.__table__).values(id="secplus", title="Security+", question_count=1))
        conn.execute(sa.insert(Question.__table__).values(
            id="q1", exam_id="secplus", prompt="Which control mitigates phishing?", multi_select=False,
            difficulty="Impossible" if bad_difficulty else "Easy", certification="Security+", is_active=False,
            deactivated_reason="deleted", deactivated_at=datetime(2025, 2, 1),
        ))
        conn.execute(sa.insert(Option.__table__).values(id=7, question_id="q1", key="A", text="Training", is_correct=True))
        conn.execute(sa.insert(Option.__table__).values(id=9, question_id="q1", key="B", text="Relay", is_correct=False))
        conn.execute(sa.insert(Explanation.__table__).values(question_id="q1", justification="Because."))
        conn.execute(sa.insert(QuestionBank.__table__).values(stable_question_id="q1", review_status="archived"))
        conn.execute(sa.insert(QuestionVersion.__table__).values(
            id=5, question_bank_id="q1", version_number=1, status="archived", exam_id="secplus",
            prompt="Which control mitigates phishing?", multi_select=False, question_format="single_choice",
        ))
        conn.execute(
            sa.update(QuestionBank.__table__)
            .where(QuestionBank.__table__.c.stable_question_id == "q1")
            .values(published_version_id=5)
        )
    engine.dispose()


@pytest.fixture()
def pg_schema_url():
    if not TEST_DATABASE_URL.startswith("postgresql"):
        pytest.skip("TEST_DATABASE_URL (PostgreSQL) not set")
    schema = f"test_mig_copy_{uuid.uuid4().hex[:10]}"
    admin = sa.create_engine(TEST_DATABASE_URL)
    with admin.begin() as conn:
        conn.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
    separator = "&" if "?" in TEST_DATABASE_URL else "?"
    try:
        yield f"{TEST_DATABASE_URL}{separator}options=-csearch_path%3D{schema}"
    finally:
        with admin.begin() as conn:
            conn.execute(sa.text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()


def test_migrate_runs_alembic_and_copies_in_fk_order(tmp_path: Path, pg_schema_url: str, capsys):
    source = _sqlite_source(tmp_path)
    _seed_legacy(source)

    assert migrate.main(["--source", source, "--target", pg_schema_url]) == 0
    assert "Migracao concluida." in capsys.readouterr().out

    engine = sa.create_engine(pg_schema_url)
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()
        row = conn.execute(sa.text(
            "SELECT is_active, deactivated_reason, needs_review, explanation_missing FROM questions WHERE id = 'q1'"
        )).one()
        assert tuple(row) == (False, "deleted", False, False)
        assert conn.execute(sa.text(
            "SELECT published_version_id FROM question_bank WHERE stable_question_id = 'q1'"
        )).scalar_one() == 5
        # Sequences were moved past the copied ids.
        next_option = conn.execute(sa.text("SELECT nextval(pg_get_serial_sequence('options', 'id'))")).scalar_one()
        assert next_option > 9
        # Reference rows seeded by the migrations are kept when the source has none.
        assert conn.execute(sa.text("SELECT COUNT(*) FROM domain_blueprint")).scalar_one() > 0
    engine.dispose()

    # Second run without --truncate-target refuses to mix data; with it, the copy is idempotent.
    assert migrate.main(["--source", source, "--target", pg_schema_url]) == 2
    assert "--truncate-target" in capsys.readouterr().err
    assert migrate.main(["--source", source, "--target", pg_schema_url, "--truncate-target"]) == 0


def test_migrate_fails_clearly_on_check_violation(tmp_path: Path, pg_schema_url: str, capsys):
    source = _sqlite_source(tmp_path)
    _seed_legacy(source, bad_difficulty=True)

    assert migrate.main(["--source", source, "--target", pg_schema_url]) == 2
    err = capsys.readouterr().err
    assert "CHECK" in err and "ck_questions_difficulty" in err and "q1" in err

    engine = sa.create_engine(pg_schema_url)
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM questions")).scalar_one() == 0
    engine.dispose()


def test_describe_db_error_names_check_constraint():
    class _Diag:
        constraint_name = "ck_questions_difficulty"

    class _Orig(Exception):
        sqlstate = "23514"
        diag = _Diag()

    exc = sa.exc.IntegrityError("INSERT", {}, _Orig('new row violates check constraint "ck_questions_difficulty"'))
    message = migrate.describe_db_error("questions", exc)
    assert "CHECK" in message and "ck_questions_difficulty" in message and "questions" in message
