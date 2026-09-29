"""Custom column types (L-A2)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator

from app.core.clock import as_utc


class UTCDateTime(TypeDecorator):
    """``TIMESTAMP WITH TIME ZONE`` that always round-trips aware UTC datetimes.

    - PostgreSQL: ``timestamptz``; values are bound as aware UTC and read back as UTC.
    - SQLite (tests/dev): no timezone support; values are stored as naive UTC and
      read back as aware UTC so comparisons with ``utcnow()`` never mix naive/aware.

    Naive values passed in are interpreted as UTC.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None or not isinstance(value, datetime):
            return value
        value = as_utc(value)
        if dialect.name == "sqlite":
            return value.replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is None or not isinstance(value, datetime):
            return value
        return as_utc(value)
