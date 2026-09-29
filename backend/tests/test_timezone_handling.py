"""L-A2: aware UTC timestamps everywhere and STUDY_DAY_TIMEZONE day boundaries."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.core import clock
from app.core.config import settings
from app.models import AuthToken, UserDomainMetricDaily

UTC = timezone.utc


def test_utcnow_is_aware():
    now = clock.utcnow()
    assert now.tzinfo is not None and now.utcoffset() == timedelta(0)


def test_parse_iso_utc_accepts_naive_offset_and_z():
    expected = datetime(2026, 5, 1, 12, 0, tzinfo=UTC)
    assert clock.parse_iso_utc("2026-05-01T12:00:00") == expected
    assert clock.parse_iso_utc("2026-05-01T09:00:00-03:00") == expected
    assert clock.parse_iso_utc("2026-05-01T12:00:00Z") == expected
    assert clock.parse_iso_utc("garbage") is None


def test_study_day_follows_configured_timezone(monkeypatch):
    monkeypatch.setattr(settings, "study_day_timezone", "America/Sao_Paulo")
    late_evening = datetime(2026, 3, 11, 2, 30, tzinfo=UTC)  # 23:30 on 10/03 in Sao Paulo
    assert clock.study_date(late_evening) == date(2026, 3, 10)
    assert clock.study_day_start(late_evening) == datetime(2026, 3, 10, 3, 0, tzinfo=UTC)
    # Monday 09/03 local midnight
    assert clock.study_week_start(late_evening) == datetime(2026, 3, 9, 3, 0, tzinfo=UTC)
    # Legacy UTC-midnight buckets and new local-midnight buckets map to their own date.
    assert clock.bucket_study_date(datetime(2026, 3, 10, 0, 0, tzinfo=UTC)) == date(2026, 3, 10)
    assert clock.bucket_study_date(datetime(2026, 3, 10, 3, 0, tzinfo=UTC)) == date(2026, 3, 10)

    monkeypatch.setattr(settings, "study_day_timezone", "UTC")
    assert clock.study_date(late_evening) == date(2026, 3, 11)


def test_invalid_study_timezone_falls_back_to_utc(monkeypatch):
    monkeypatch.setattr(settings, "study_day_timezone", "Not/AZone")
    value = datetime(2026, 3, 11, 2, 30, tzinfo=UTC)
    assert clock.study_date(value) == date(2026, 3, 11)


def test_utc_datetime_column_round_trips_aware_values(db, make_user):
    user = make_user()
    sao_paulo = timezone(timedelta(hours=-3))
    db.add(AuthToken(user_id=user.id, token_hash="x" * 64, expires_at=datetime(2026, 1, 1, 9, 0, tzinfo=sao_paulo)))
    db.commit()
    db.expire_all()
    token = db.query(AuthToken).one()
    assert token.expires_at == datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    assert token.expires_at.utcoffset() == timedelta(0)
    assert token.created_at.tzinfo is not None
    # Comparisons against aware "now" work in SQL and in Python.
    assert db.query(AuthToken).filter(AuthToken.expires_at < clock.utcnow()).count() == 1
    assert token.expires_at < clock.utcnow()


def test_api_serializes_timestamps_with_offset(login_client):
    client, _user = login_client()
    created_at = client.get("/api/auth/me").json()["created_at"]
    parsed = datetime.fromisoformat(created_at)
    assert parsed.utcoffset() == timedelta(0)


@pytest.mark.parametrize("tz_name, expected_current", [("America/Sao_Paulo", 2), ("UTC", 1)])
def test_streak_uses_study_day_timezone(db, monkeypatch, tz_name, expected_current):
    """Answers at 22:00 and 23:30 Sao Paulo time on consecutive local days form a 2-day
    streak in Sao Paulo; in UTC both fall on the same (next) day."""
    from app.services.engagement import _compute_streak
    from app.services.metrics import _day_start

    monkeypatch.setattr(settings, "study_day_timezone", tz_name)
    first = datetime(2026, 3, 10, 1, 0, tzinfo=UTC)   # 22:00 on 09/03 local
    second = datetime(2026, 3, 10, 23, 30, tzinfo=UTC)  # 20:30 on 10/03 local
    for moment, domain in ((first, "General Security Concepts"), (second, "Security Operations")):
        db.add(UserDomainMetricDaily(
            client_key="tz-device", metric_date=_day_start(moment), exam_id="secplus",
            certification="Security+", domain=domain,
            attempts_total=1, study_attempts=1, correct_count=1, wrong_count=0,
        ))
    db.commit()
    streak = _compute_streak(db, owner_user_id=None, owner_client_key="tz-device", now=second)
    assert streak["current"] == expected_current
    assert streak["last_activity_date"].tzinfo is not None
