"""Readiness formula (M-C4) and (certification, domain) grouping (M-C5)."""
from __future__ import annotations

from datetime import datetime, timedelta

OWNER = "device-readiness"


def _metric(db, *, certification, domain, attempts, correct, low_confidence=0, days_ago=1):
    from app.models import UserDomainMetricDaily

    day = (datetime.utcnow() - timedelta(days=days_ago)).replace(hour=0, minute=0, second=0, microsecond=0)
    db.add(UserDomainMetricDaily(
        client_key=OWNER,
        metric_date=day,
        exam_id=f"{certification}-{domain}-{days_ago}",
        certification=certification,
        domain=domain,
        attempts_total=attempts,
        study_attempts=attempts,
        correct_count=correct,
        wrong_count=attempts - correct,
        low_confidence_count=low_confidence,
    ))
    db.commit()


def _question(db, qid, *, certification="CISSP", domain="Asset Security"):
    from app.models import Exam, Question

    if not db.get(Exam, "cissp"):
        db.add(Exam(id="cissp", title="CISSP"))
        db.flush()
    db.add(Question(id=qid, exam_id="cissp", prompt=qid, multi_select=False, domain=domain, certification=certification))
    db.commit()


def _snapshot(db, **kwargs):
    from app.services.readiness import build_readiness_snapshot

    return build_readiness_snapshot(db, owner_user_id=None, owner_client_key=OWNER, **kwargs)


def test_no_data_means_insufficient_data_not_a_magic_default(db):
    snapshot = _snapshot(db)
    assert snapshot["score_percent"] is None
    assert snapshot["projected_score_percent"] is None
    assert snapshot["band"] == "insufficient_data"
    assert snapshot["status"] == "insufficient_data"
    assert snapshot["factor_codes"][0]["code"] == "readiness.insufficient_data"


def test_few_attempts_are_insufficient(db):
    _metric(db, certification="CISSP", domain="Asset Security", attempts=4, correct=4)
    snapshot = _snapshot(db)
    assert snapshot["score_percent"] is None and snapshot["band"] == "insufficient_data"
    assert snapshot["certification"] == "CISSP"


def test_score_is_blueprint_weighted_without_bonus(db):
    # CISSP fallback weights: Security and Risk Management 16, Asset Security 10.
    _metric(db, certification="CISSP", domain="Security and Risk Management", attempts=10, correct=10)
    _metric(db, certification="CISSP", domain="Asset Security", attempts=10, correct=0)
    snapshot = _snapshot(db)
    expected = round((16 * 100.0 + 10 * 0.0) / 26, 2)
    assert snapshot["score_percent"] == expected  # no +6 bonus, weighted (not a simple mean = 50)
    assert snapshot["certification"] == "CISSP"
    assert snapshot["pass_threshold_percent"] == 70.0
    assert snapshot["band"] == "developing"  # 61.54 is within 15 points of the 70 % threshold
    assert snapshot["projected_score_percent"] == expected  # no trend data, nothing overdue
    by_domain = {item["domain"]: item for item in snapshot["domain_scores"]}
    assert by_domain["Security and Risk Management"]["weight"] == 16.0


def test_projection_never_increases_with_overdue_reviews(db):
    from app.models import ReviewQueueItem, UserQuestionProgress

    _metric(db, certification="CISSP", domain="Asset Security", attempts=20, correct=16)
    for index in range(8):
        qid = f"q-{index}"
        _question(db, qid)
        db.add(UserQuestionProgress(client_key=OWNER, question_id=qid, total_attempts=1))
    db.commit()

    projections = [_snapshot(db)["projected_score_percent"]]
    for index in range(8):
        db.add(ReviewQueueItem(client_key=OWNER, question_id=f"q-{index}", due_at=datetime.utcnow() - timedelta(days=1)))
        db.commit()
        snapshot = _snapshot(db)
        projections.append(snapshot["projected_score_percent"])
        assert snapshot["overdue_reviews"] == index + 1
    assert all(later <= earlier for earlier, later in zip(projections, projections[1:]))
    assert projections[-1] < projections[0]
    assert _snapshot(db)["factor_codes"][0]["code"] == "readiness.overdue_reviews"


def test_homonymous_domains_are_grouped_by_certification(db):
    _metric(db, certification="CISSP", domain="Security Operations", attempts=12, correct=12)
    _metric(db, certification="Security+", domain="Security Operations", attempts=10, correct=0)
    snapshot = _snapshot(db)
    pairs = {(item["certification"], item["domain"]): item for item in snapshot["domain_scores"]}
    assert pairs[("CISSP", "Security Operations")]["score_percent"] == 100.0
    assert pairs[("Security+", "Security Operations")]["score_percent"] == 0.0
    certs = {item["certification"]: item for item in snapshot["certifications"]}
    assert certs["Security+"]["pass_threshold_percent"] == 83.0
    assert certs["CISSP"]["score_percent"] == 100.0 and certs["Security+"]["score_percent"] == 0.0
    # Primary certification = most recent attempts; explicit certification wins.
    assert snapshot["certification"] == "CISSP"
    assert _snapshot(db, certification="Security+")["score_percent"] == 0.0


def test_readiness_endpoint_handles_insufficient_data(make_client):
    client = make_client()
    response = client.get("/api/analytics/readiness", headers={"X-Client-Key": OWNER})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["score_percent"] is None and body["band"] == "insufficient_data"
    assert body["factor_codes"] and body["factors"]
