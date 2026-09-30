"""Alembic migration tests (C2, M-A4, L-A3 and 0014).

- `upgrade head` on an EMPTY database works and the resulting schema matches the models
  (alembic autogenerate compare returns no diffs).
- Round trips head -> 0013 -> head and head -> 0008 -> head exercise the non-skip
  paths of the idempotent migrations and must also end with no diffs.
- `downgrade base` leaves only alembic_version.
- 0014 data migration on a populated 0013 database.

SQLite always; PostgreSQL when TEST_DATABASE_URL is set (each test uses its own
throw-away schema through search_path, so it never touches existing tables).
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from alembic import command  # noqa: E402
from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import create_engine, event, inspect, text  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.db.base import Base  # noqa: E402
import app.models  # noqa: E402,F401

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "").strip()
REV_0008 = "0008_question_stats_snapshot"
REV_0013 = "0013_issue_workflow_and_placement"
REV_0014 = "0014_content_lifecycle_and_integrity"


def alembic_config(url: str) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.attributes["sqlalchemy.url"] = url
    cfg.attributes["skip_logging_config"] = True
    return cfg


class _MigrationMixin:
    url: str

    def make_url(self) -> str:  # pragma: no cover - overridden
        raise NotImplementedError

    def engine_kwargs(self) -> dict:
        return {}

    def setUp(self) -> None:
        self.url = self.make_url()
        self.cfg = alembic_config(self.url)
        self.engine = create_engine(self.url, **self.engine_kwargs())
        if self.engine.dialect.name == "sqlite":
            @event.listens_for(self.engine, "connect")
            def _enable_fk(dbapi_connection, _record):  # noqa: ANN001
                dbapi_connection.execute("PRAGMA foreign_keys=ON")

    def tearDown(self) -> None:
        self.engine.dispose()
        self.cleanup()

    def cleanup(self) -> None:  # pragma: no cover - overridden
        pass

    # ------------------------------------------------------------------ helpers
    def schema_diffs(self) -> list:
        with self.engine.connect() as conn:
            context = MigrationContext.configure(
                conn, opts={"compare_type": True, "compare_server_default": True}
            )
            return compare_metadata(context, Base.metadata)

    def assert_models_match(self) -> None:
        diffs = self.schema_diffs()
        self.assertEqual(diffs, [], f"schema drift between models and migrations: {diffs[:10]}")

    def current_revision(self) -> str | None:
        with self.engine.connect() as conn:
            return MigrationContext.configure(conn).get_current_revision()

    def check_names(self, table: str) -> set[str]:
        return {ck["name"] for ck in inspect(self.engine).get_check_constraints(table)}

    # ------------------------------------------------------------------ tests
    def test_upgrade_head_on_empty_database_matches_models(self) -> None:
        command.upgrade(self.cfg, "head")
        head = ScriptDirectory.from_config(self.cfg).get_current_head()
        self.assertEqual(self.current_revision(), head)
        self.assert_models_match()
        # Idempotent: running it again is a no-op.
        command.upgrade(self.cfg, "head")
        self.assert_models_match()

    def test_roundtrip_through_0013_and_0008(self) -> None:
        command.upgrade(self.cfg, "head")
        for target in (REV_0013, REV_0008):
            command.downgrade(self.cfg, target)
            self.assertEqual(self.current_revision(), target)
            command.upgrade(self.cfg, "head")
            self.assert_models_match()
            self.assertIn("ck_exam_sessions_owner_scope_xor", self.check_names("exam_sessions"))
            self.assertIn("ck_users_role_allowed", self.check_names("users"))
            indexes = {ix["name"]: ix for ix in inspect(self.engine).get_indexes("user_exam_metrics_snapshot")}
            self.assertTrue(indexes["ix_user_exam_metrics_snapshot_session_id"]["unique"])

    def test_downgrade_base_removes_everything(self) -> None:
        command.upgrade(self.cfg, "head")
        command.downgrade(self.cfg, "base")
        remaining = set(inspect(self.engine).get_table_names()) - {"alembic_version"}
        self.assertEqual(remaining, set())
        command.upgrade(self.cfg, "head")
        self.assert_models_match()

    def test_0014_downgrade_warns_about_soft_deleted_and_removes_seeded_weights(self) -> None:
        import contextlib
        import io

        command.upgrade(self.cfg, "head")
        with self.engine.begin() as conn:
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM domain_blueprint WHERE weight IS NOT NULL")).scalar(), 13)
            # A pre-existing (non-seeded) blueprint row must survive the downgrade.
            conn.execute(text(
                "INSERT INTO domain_blueprint (certification, blueprint_code, objective_code, domain, title, "
                "created_at, updated_at) VALUES ('CISSP', 'CISSP-D1', 'CISSP-1.1', 'Security and Risk Management', "
                "'Objective', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ))
            conn.execute(text("INSERT INTO exams (id, title) VALUES ('ex', 'Exam')"))
            conn.execute(text(
                "INSERT INTO questions (id, exam_id, prompt, multi_select, is_active, deactivated_reason) VALUES "
                "('q-deleted', 'ex', 'p1', false, false, 'deleted'), "
                "('q-removed', 'ex', 'p2', false, false, 'removed_from_source'), "
                "('q-live', 'ex', 'p3', false, true, NULL)"
            ))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            command.downgrade(self.cfg, REV_0013)
        log = output.getvalue()
        self.assertIn("WARNING: 2 soft-deleted question(s) (1 deleted by editors, 1 removed from the source JSON)", log)
        self.assertIn("removed 13 seeded domain weight row(s)", log)
        with self.engine.begin() as conn:
            rows = conn.execute(text("SELECT blueprint_code, objective_code FROM domain_blueprint")).all()
            self.assertEqual([tuple(row) for row in rows], [("CISSP-D1", "CISSP-1.1")])
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM questions")).scalar(), 3)
        command.upgrade(self.cfg, "head")
        self.assert_models_match()

    def test_0019_live_constraints(self) -> None:
        """Active-only PIN uniqueness, cascades, and (PostgreSQL) the append-only answer log."""
        from sqlalchemy.exc import DBAPIError

        command.upgrade(self.cfg, "head")
        now = "CURRENT_TIMESTAMP"
        with self.engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO users (id, email, password_hash, role, is_active, email_verified, created_at, updated_at) "
                f"VALUES ('u1', 'u1@example.com', 'x', 'student', true, false, {now}, {now})"
            ))
            conn.execute(text(
                "INSERT INTO live_quiz (id, owner_user_id, title, language, theme_key, settings_json, version, "
                f"created_at, updated_at) VALUES ('lq1', 'u1', 'Quiz', 'pt-BR', 'sentinel', '{{}}', 1, {now}, {now})"
            ))
            conn.execute(text(
                "INSERT INTO live_quiz_version (id, quiz_id, version_no, title, theme_key, settings_json, "
                f"items_snapshot_json, snapshot_hash, published_at) VALUES ('v1', 'lq1', 1, 'Quiz', 'sentinel', "
                f"'{{}}', '[]', 'h', {now})"
            ))

        def session(conn, sid: str, status: str) -> None:
            conn.execute(text(
                "INSERT INTO live_session (id, quiz_id, quiz_version_id, owner_user_id, mode, status, phase, state_seq, "
                "join_code, allow_guests, room_locked, max_participants, preset, audience, theme_key, settings_json, "
                f"consent_version, created_at, updated_at) VALUES ('{sid}', 'lq1', 'v1', 'u1', 'live', '{status}', "
                f"'lobby', 1, '482913', true, false, 10, 'turma', 'adulto', 'sentinel', '{{}}', 'c1', {now}, {now})"
            ))

        with self.engine.begin() as conn:
            session(conn, "s1", "lobby")
        with self.assertRaises(IntegrityError):
            with self.engine.begin() as conn:
                session(conn, "s2", "live")
        with self.engine.begin() as conn:
            conn.execute(text("UPDATE live_session SET status = 'finished', phase = 'finished' WHERE id = 's1'"))
            session(conn, "s2", "lobby")  # a finished session releases its PIN
            conn.execute(text(
                "INSERT INTO live_participant (id, session_id, display_name, nickname_norm, avatar_seed, banned, "
                f"joined_at) VALUES ('p1', 's2', 'Ana', 'ana', 'abc', false, {now})"
            ))
            conn.execute(text(
                "INSERT INTO live_answer_event (session_id, position, participant_id, event_type, response_json, "
                "points, suspicious, idempotency_key, received_at) VALUES ('s2', 0, 'p1', 'submitted', '{}', 900, "
                f"false, 'k1', {now})"
            ))
        if self.engine.dialect.name == "postgresql":
            with self.assertRaises(DBAPIError):
                with self.engine.begin() as conn:
                    conn.execute(text("UPDATE live_answer_event SET points = 1000"))
        with self.engine.begin() as conn:
            conn.execute(text("DELETE FROM live_quiz WHERE id = 'lq1'"))
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM live_answer_event")).scalar(), 0)
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM live_session")).scalar(), 0)

    def test_0014_data_migration_on_populated_database(self) -> None:
        command.upgrade(self.cfg, "head")
        command.downgrade(self.cfg, REV_0013)
        with self.engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO users (id, email, password_hash, role, is_active, email_verified, created_at, updated_at) "
                "VALUES ('u1', 'u1@example.com', 'x', 'student', true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ))
            conn.execute(text("INSERT INTO exams (id, title) VALUES ('ex', 'Exam')"))
            conn.execute(text(
                "INSERT INTO questions (id, exam_id, prompt, multi_select, difficulty) VALUES "
                "('q1', 'ex', 'p', false, 'medium')"
            ))
            conn.execute(text(
                "INSERT INTO exam_sessions (id, created_at, user_id, exam_id, selection_strategy, total_questions, "
                "experience_mode, current_index, current_position, correct_count, wrong_count) VALUES "
                "('s1', CURRENT_TIMESTAMP, 'u1', 'renamed-exam', 'standard', 1, 'standard', 0, 0, 0, 0)"
            ))
            conn.execute(text(
                "INSERT INTO session_answers (session_id, question_id, selected_keys, is_correct, answered_at) "
                "VALUES ('s1', 'q1', 'A', true, CURRENT_TIMESTAMP)"
            ))
            conn.execute(text(
                "INSERT INTO question_bank (stable_question_id, published_version_id, review_status, created_at, "
                "updated_at) VALUES ('q1', 424242, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ))
        command.upgrade(self.cfg, "head")
        self.assert_models_match()
        with self.engine.begin() as conn:
            self.assertEqual(conn.execute(text("SELECT difficulty FROM questions WHERE id='q1'")).scalar(), "Medium")
            self.assertTrue(conn.execute(text("SELECT is_active FROM questions WHERE id='q1'")).scalar())
            self.assertIsNone(conn.execute(text("SELECT exam_id FROM exam_sessions WHERE id='s1'")).scalar())
            self.assertIsNone(
                conn.execute(text("SELECT published_version_id FROM question_bank WHERE stable_question_id='q1'")).scalar()
            )
            weights = conn.execute(text("SELECT COUNT(*) FROM domain_blueprint WHERE weight IS NOT NULL")).scalar()
            self.assertEqual(weights, 13)
        # M-A3: history blocks hard deletes; M-A1: deleting the user cascades its sessions.
        with self.assertRaises(IntegrityError):
            with self.engine.begin() as conn:
                conn.execute(text("DELETE FROM questions WHERE id='q1'"))
        with self.engine.begin() as conn:
            conn.execute(text("DELETE FROM users WHERE id='u1'"))
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM exam_sessions")).scalar(), 0)
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM session_answers")).scalar(), 0)

    def test_0015_converts_naive_utc_timestamps_to_timestamptz(self) -> None:
        from datetime import datetime, timezone

        from sqlalchemy.orm import Session

        from app.models import AuthToken, User

        command.upgrade(self.cfg, REV_0014)
        with self.engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO users (id, email, password_hash, role, is_active, email_verified, created_at, updated_at) "
                "VALUES ('u1', 'u1@example.com', 'x', 'student', true, true, '2026-01-02 03:04:05', '2026-01-02 03:04:05')"
            ))
            conn.execute(text(
                "INSERT INTO auth_tokens (user_id, token_hash, created_at, expires_at) "
                "VALUES ('u1', 'h1', '2026-01-02 03:04:05', '2026-07-01 23:30:00')"
            ))
        command.upgrade(self.cfg, "head")
        self.assert_models_match()
        expected_created = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        expected_expiry = datetime(2026, 7, 1, 23, 30, tzinfo=timezone.utc)
        if self.engine.dialect.name == "postgresql":
            types = {c["name"]: c["type"] for c in inspect(self.engine).get_columns("auth_tokens")}
            self.assertTrue(types["expires_at"].timezone)
        with self.engine.connect() as conn:
            if self.engine.dialect.name == "postgresql":
                # The stored instant does not depend on the session time zone.
                conn.execute(text("SET TIME ZONE 'America/Sao_Paulo'"))
            with Session(bind=conn) as session:
                user = session.get(User, "u1")
                token = session.query(AuthToken).one()
                self.assertEqual(user.created_at, expected_created)
                self.assertEqual(user.created_at.utcoffset().total_seconds(), 0)
                self.assertEqual(token.expires_at, expected_expiry)
        # Downgrade restores naive UTC values.
        command.downgrade(self.cfg, REV_0014)
        with self.engine.connect() as conn:
            raw = conn.execute(text("SELECT expires_at FROM auth_tokens")).scalar()
            if isinstance(raw, str):
                raw = datetime.fromisoformat(raw)
            self.assertIsNone(raw.tzinfo)
            self.assertEqual(raw, expected_expiry.replace(tzinfo=None))
        command.upgrade(self.cfg, "head")
        self.assert_models_match()

    def test_frozen_baseline_does_not_depend_on_models(self) -> None:
        # C2: 0008 is an explicit, frozen schema (no create_all with current models).
        source = (BACKEND / "alembic" / "versions" / "0008_consolidated_baseline.py").read_text()
        import re

        self.assertIsNone(re.search(r"^\s*(from|import) app\b", source, re.MULTILINE))
        self.assertIsNone(re.search(r"\.create_all\(", source))
        command.upgrade(self.cfg, REV_0008)
        tables = set(inspect(self.engine).get_table_names()) - {"alembic_version"}
        self.assertEqual(len(tables), 23)
        self.assertNotIn("study_modules", tables)
        self.assertNotIn("is_active", {c["name"] for c in inspect(self.engine).get_columns("questions")})
        command.upgrade(self.cfg, "head")
        self.assert_models_match()

    def test_database_from_old_create_all_baseline_is_unaffected(self) -> None:
        # Databases created by the previous baseline (create_all of the models, stamped
        # at head) must keep working: upgrade head is a no-op and the schema matches.
        # (A fresh copy of the metadata: DDL events of earlier create_all calls on other
        # dialects in this process must not leak into the SQLite DDL.)
        from sqlalchemy import MetaData

        fresh = MetaData()
        for table in Base.metadata.sorted_tables:
            table.to_metadata(fresh)
        fresh.create_all(self.engine)
        command.stamp(self.cfg, "head")
        command.upgrade(self.cfg, "head")
        self.assert_models_match()


class SqliteMigrationTests(_MigrationMixin, unittest.TestCase):
    def make_url(self) -> str:
        self.tmpdir = tempfile.mkdtemp()
        return f"sqlite+pysqlite:///{Path(self.tmpdir) / 'migrations.db'}"

    def cleanup(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)


@unittest.skipUnless(TEST_DATABASE_URL.startswith("postgresql"), "TEST_DATABASE_URL (PostgreSQL) not set")
class PostgresMigrationTests(_MigrationMixin, unittest.TestCase):
    def make_url(self) -> str:
        self.schema = f"test_mig_{uuid.uuid4().hex[:10]}"
        admin = create_engine(TEST_DATABASE_URL)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        admin.dispose()
        separator = "&" if "?" in TEST_DATABASE_URL else "?"
        return f"{TEST_DATABASE_URL}{separator}options=-csearch_path%3D{self.schema}"

    def cleanup(self) -> None:
        admin = create_engine(TEST_DATABASE_URL)
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE'))
        admin.dispose()

    def test_advisory_lock_is_released_after_upgrade(self) -> None:
        command.upgrade(self.cfg, "head")
        with self.engine.connect() as conn:
            held = conn.execute(text("SELECT COUNT(*) FROM pg_locks WHERE locktype = 'advisory'")).scalar()
        self.assertEqual(held, 0)


if __name__ == "__main__":
    unittest.main()
