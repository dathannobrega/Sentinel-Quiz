"""Database engine / session management.

Transaction policy (M-B7):

* ``get_db`` never commits implicitly. Handlers (or the services they call) own
  their transactions and call ``db.commit()`` explicitly when they write.
* On any exception raised while the request is being handled the session is
  rolled back before it is closed, so a failed request never leaks a half-written
  transaction back into the pool.
* Code that performs slow external I/O (SMTP, Gemini) must not keep a pooled
  connection checked out: finish the database work first (``db.commit()`` releases
  the connection) or use ``session_scope()`` for a short-lived session.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings


def _is_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


def _is_sqlite_memory(url: str) -> bool:
    if not _is_sqlite(url):
        return False
    path = url.split("://", 1)[-1]
    return path in {"", "/", "/:memory:"} or ":memory:" in path or "mode=memory" in path


def build_engine_kwargs(database_url: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "echo": False,
        "future": True,
        "pool_pre_ping": bool(settings.db_pool_pre_ping),
    }
    if _is_sqlite(database_url):
        # SQLite needs check_same_thread=False for the threaded dev server / tests.
        kwargs["connect_args"] = {"check_same_thread": False}
        if _is_sqlite_memory(database_url):
            # A single shared connection so every session sees the same in-memory DB.
            kwargs["poolclass"] = StaticPool
        return kwargs

    kwargs["pool_size"] = max(int(settings.db_pool_size or 0), 1)
    kwargs["max_overflow"] = max(int(settings.db_max_overflow or 0), 0)
    kwargs["pool_timeout"] = max(int(settings.db_pool_timeout or 0), 1)
    return kwargs


engine = create_engine(settings.database_url, **build_engine_kwargs(settings.database_url))
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Short-lived session for background work: commits on success, rolls back on error."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
