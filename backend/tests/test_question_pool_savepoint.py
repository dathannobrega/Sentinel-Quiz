"""A failing blueprint lookup must not poison the request transaction (PostgreSQL
aborts the whole transaction on error unless the statement runs in a SAVEPOINT)."""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import create_engine, select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.models import Exam  # noqa: E402

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "").strip()


def _broken_lookup(db, certification):  # noqa: ANN001
    db.execute(text("SELECT weight FROM table_that_does_not_exist"))
    return {}


def _exercise(engine, monkeypatch) -> None:
    from app.services import ingest, question_pool

    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(Exam(id="pending-exam", title="Pending"))
        db.flush()
        monkeypatch.setattr(ingest, "get_domain_blueprint_weights", _broken_lookup)
        weights = question_pool.blueprint_weights_for_certification(db, "Security+")
        # Falls back to the built-in outline...
        assert weights and abs(sum(weights.values()) - 100.0) < 0.5
        # ...and the transaction is still usable, with the earlier work intact.
        assert db.scalar(select(Exam.title).where(Exam.id == "pending-exam")) == "Pending"
        db.commit()
    with Session(engine) as db:
        assert db.get(Exam, "pending-exam") is not None


def test_failed_blueprint_lookup_keeps_sqlite_transaction_usable(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    try:
        _exercise(engine, monkeypatch)
    finally:
        engine.dispose()


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL (PostgreSQL) not set")
def test_failed_blueprint_lookup_keeps_postgres_transaction_usable(monkeypatch):
    schema = f"t_pool_{uuid.uuid4().hex[:8]}"
    admin = create_engine(TEST_DATABASE_URL)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(TEST_DATABASE_URL, connect_args={"options": f"-csearch_path={schema}"})
    try:
        _exercise(engine, monkeypatch)
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
