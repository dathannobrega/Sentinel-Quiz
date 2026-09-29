"""Timezone-aware time helpers (L-A2).

Every timestamp handled by the application is an *aware* ``datetime`` in UTC:
``utcnow()`` replaces ``datetime.utcnow()`` and :class:`app.db.types.UTCDateTime`
guarantees that values read from the database are aware UTC too (SQLite returns naive
values; they are interpreted as UTC).

"Study days" (daily goals, streaks and the daily domain-metric buckets) follow the
civil day of ``STUDY_DAY_TIMEZONE`` (default ``America/Sao_Paulo``), so an answer given
at 22:00 local time counts for that local day and not for the next UTC day. The day is
still stored as an aware UTC instant (local midnight converted to UTC).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger("app.clock")

UTC = timezone.utc


def utcnow() -> datetime:
    """Current time as an aware UTC datetime."""
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    """Normalise ``value`` to aware UTC (naive values are interpreted as UTC)."""
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def as_utc_or_none(value: datetime | None) -> datetime | None:
    return as_utc(value) if isinstance(value, datetime) else None


def parse_iso_utc(value: object) -> datetime | None:
    """Parse an ISO 8601 string (with or without offset) into aware UTC."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return as_utc(datetime.fromisoformat(raw.replace("Z", "+00:00")))
    except ValueError:
        return None


@lru_cache(maxsize=8)
def _zone(name: str) -> tzinfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("Invalid STUDY_DAY_TIMEZONE %r; falling back to UTC.", name)
        return UTC


def study_timezone() -> tzinfo:
    from app.core.config import settings

    name = str(getattr(settings, "study_day_timezone", "") or "").strip() or "UTC"
    return _zone(name)


def study_date(value: datetime) -> date:
    """Civil date of ``value`` in STUDY_DAY_TIMEZONE."""
    return as_utc(value).astimezone(study_timezone()).date()


def study_day_start_for_date(day: date) -> datetime:
    """Local midnight of ``day`` in STUDY_DAY_TIMEZONE, as aware UTC."""
    return datetime.combine(day, time.min, tzinfo=study_timezone()).astimezone(UTC)


def study_day_start(value: datetime) -> datetime:
    """Start (local midnight, as aware UTC) of the study day containing ``value``."""
    return study_day_start_for_date(study_date(value))


def study_week_start(value: datetime) -> datetime:
    """Monday local midnight (as aware UTC) of the study week containing ``value``."""
    day = study_date(value)
    return study_day_start_for_date(day - timedelta(days=day.weekday()))


def bucket_study_date(value: datetime) -> date:
    """Calendar date represented by a stored day bucket.

    Day buckets are stored as the UTC instant of a midnight. Rows written before
    STUDY_DAY_TIMEZONE existed hold UTC midnights, newer ones hold local midnights;
    reading the local date 12 hours after the bucket start maps both to the intended
    calendar date (for any offset below 12 hours).
    """
    return study_date(as_utc(value) + timedelta(hours=12))
