"""Database sessions for the realtime layer.

The gateway runs database work for many sockets concurrently in the threadpool. On
PostgreSQL every call gets its own pooled connection. SQLite (development and tests)
uses a single shared in-memory connection (StaticPool) that is not safe for concurrent
use, so there the realtime layer serializes its database work with one process-wide
lock. The lock is never taken on PostgreSQL.
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy.orm import Session

from app.db.session import SessionLocal, engine

_SERIALIZE = engine.dialect.name == "sqlite"
_LOCK = threading.RLock()


@contextmanager
def live_db() -> Iterator[Session]:
    if _SERIALIZE:
        _LOCK.acquire()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        if _SERIALIZE:
            _LOCK.release()
