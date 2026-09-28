from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings

from conftest import make_exam_session, make_study_session, seed_question


# ---------------------------------------------------------------- error envelope
def test_validation_error_envelope(client):
    response = client.post("/api/auth/login", json={"email": "x"})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert isinstance(body["detail"], str) and "password" in body["detail"]
    assert isinstance(body["errors"], list) and body["errors"]
    assert set(body["errors"][0]) == {"loc", "msg", "type"}


def test_list_size_limits_are_validated(client):
    response = client.post(
        "/api/sessions",
        json={"domains": [f"d{i}" for i in range(80)]},
        headers={"X-Client-Key": "device-A"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_not_found_envelope(client):
    response = client.get("/api/sessions/does-not-exist")
    assert response.status_code == 404
    body = response.json()
    assert body["detail"] == "Session not found"
    assert body["code"] == "http_404"


def test_http_exception_with_code_dict(client):
    response = client.get("/api/auth/me")
    body = response.json()
    assert body["detail"] == "Authentication required."
    assert body["code"] == "auth_required"
    assert response.headers.get("www-authenticate") == "Bearer"


def test_unhandled_error_envelope_has_cors_and_no_stack(app):
    from app.main import create_app

    test_app = create_app(Settings(_env_file=None))

    @test_app.get("/api/boom")
    def boom():
        raise RuntimeError("database password is hunter2")

    with TestClient(test_app, raise_server_exceptions=False) as test_client:
        response = test_client.get("/api/boom", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 500
    body = response.json()
    assert body["detail"] == "Internal server error."
    assert body["code"] == "internal_error"
    assert body["request_id"] == response.headers["x-request-id"]
    assert "hunter2" not in response.text
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


# ------------------------------------------------------------------ docs / static
def test_docs_available_outside_production(client):
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_docs_disabled_in_production():
    from app.main import create_app

    production = Settings(
        _env_file=None,
        APP_ENV="production",
        DATABASE_URL="postgresql+psycopg://sentinel:Str0ng-Secret@db:5432/sentinel_quiz",
        BOOTSTRAP_SCHEMA=False,
        AUTH_COOKIE_SECURE=True,
        RATE_LIMIT_BACKEND="redis",
        REDIS_URL="redis://redis:6379/0",
        CORS_ORIGINS="https://quiz.example.com",
    )
    prod_app = create_app(production)
    client = TestClient(prod_app)  # no lifespan: nothing touches Redis/DB here
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/redoc").status_code == 404


# -------------------------------------------------------------- response models
def test_health_shape(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"ok", "ai_enabled", "ai_model"}
    assert body["ok"] is True


def test_domains_and_weak_areas_shapes(client, db):
    seed_question(db)
    domains = client.get("/api/domains").json()
    assert set(domains) >= {"exam_id", "domains"}
    assert set(domains["domains"][0]) >= {"value", "label", "question_count", "certifications"}

    weak = client.get("/api/analytics/weak-areas", headers={"X-Client-Key": "device-A"}).json()
    assert "certifications" in weak
    if weak["certifications"]:
        assert set(weak["certifications"][0]) >= {"certification", "attempted", "wrong", "focus_domain", "domains", "message"}


def test_study_next_finished_shape_is_unchanged(make_client, db):
    from app.models import StudySession

    qid = seed_question(db)
    session_id = make_study_session(db, question_ids=[qid], client_key="device-A")
    anon = make_client()
    running = anon.get(f"/api/study/sessions/{session_id}/next", headers={"X-Client-Key": "device-A"}).json()
    assert running["finished"] is False
    assert set(running) == {"finished", "question", "progress_index", "total_questions", "answered_count"}
    assert {"id", "prompt", "options", "domain"} <= set(running["question"])

    session = db.get(StudySession, session_id)
    session.current_index = 5
    db.commit()
    finished = anon.get(f"/api/study/sessions/{session_id}/next", headers={"X-Client-Key": "device-A"}).json()
    assert finished == {"finished": True}


def test_mark_review_shape(make_client, db):
    qid = seed_question(db)
    session_id = make_exam_session(db, question_ids=[qid], client_key="device-A")
    anon = make_client()
    response = anon.post(
        f"/api/sessions/{session_id}/questions/{qid}/mark-review",
        headers={"X-Client-Key": "device-A"},
    )
    assert response.status_code == 200
    assert set(response.json()) == {"question_id", "marked_for_review", "marked_for_review_count", "current_position"}


def test_auth_simple_endpoints_shapes(client):
    assert client.post("/api/auth/logout").json() == {"ok": True}
    reset = client.post("/api/auth/request-password-reset", json={"email": "x@example.com"}).json()
    assert set(reset) == {"ok", "message"}
    verify = client.post("/api/auth/request-email-verification", json={"email": "x@example.com"}).json()
    assert set(verify) == {"ok", "message"}


def test_editorial_actions_keep_their_shapes(login_client, db):
    client, _admin = login_client(role="admin")
    exam = client.post("/api/admin/exams", json={"id": "secplus", "title": "Security+"})
    assert exam.json() == {"ok": True, "id": "secplus"}

    created = client.post(
        "/api/admin/questions",
        json={
            "id": "q-new",
            "exam_id": "secplus",
            "prompt": "What is MFA?",
            "options": [{"key": "a", "text": "Two factors"}, {"key": "b", "text": "One factor"}],
            "correct_keys": ["A"],
            "tags": ["auth", "Auth", " "],
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert {"ok", "id", "status", "version_id", "version_number"} <= set(body)
    assert body["status"] == "draft"

    listed = client.get("/api/admin/questions").json()
    assert any(item["id"] == "q-new" and item["loaded_from"] == "draft" for item in listed)

    overview = client.get("/api/admin/overview").json()
    # Additive contract (phase 2 F): lifecycle/editorial counters were added.
    assert set(overview) == {
        "exam_count",
        "question_count",
        "completed_session_count",
        "question_breakdown",
        "inactive_question_count",
        "needs_review_count",
        "explanation_missing_count",
    }
    assert overview["exam_count"] == 1

    deleted = client.delete("/api/admin/questions/q-new")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"ok": True, "id": "q-new", "status": "deleted"}


def test_admin_question_payload_validation(login_client, db):
    client, _admin = login_client(role="editor")
    client.post("/api/admin/exams", json={"id": "secplus", "title": "Security+"})
    duplicate = client.post(
        "/api/admin/questions",
        json={
            "id": "q-dup",
            "exam_id": "secplus",
            "prompt": "P",
            "options": [{"key": "A", "text": "x"}, {"key": "a", "text": "y"}],
            "correct_keys": ["A"],
        },
    )
    assert duplicate.status_code == 400
    assert duplicate.json() == {"detail": "Duplicate option key: A", "code": "http_400", "request_id": duplicate.headers["x-request-id"]}


def test_admin_overview_counts_with_group_by(login_client, db):
    seed_question(db)
    seed_question(db)
    client, _ = login_client(role="editor")
    overview = client.get("/api/admin/overview").json()
    assert overview["question_count"] == 2
    assert overview["question_breakdown"] == {"Security+": 2}


def test_admin_export_streams_valid_json(login_client, db):
    qid = seed_question(db)
    make_exam_session(db, question_ids=[qid], client_key="device-A", answers={qid: ("A", True)})
    client, _admin = login_client(role="admin")
    response = client.get("/api/admin/export")
    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith("attachment; filename=")
    document = json.loads(response.content)
    assert set(document) == {"meta", "exams", "editorial", "sessions", "learning_metrics", "import_state"}
    assert document["exams"][0]["questions"][0]["id"] == qid
    assert document["exams"][0]["questions"][0]["correct_keys"] == ["A"]
    assert document["sessions"][0]["answers"][0]["selected_keys"] == ["A"]
    assert set(document["editorial"]) == {
        "question_banks", "versions", "audit_log", "question_stats_snapshots", "domain_catalog", "domain_blueprints",
    }
    assert set(document["learning_metrics"]) == {
        "user_domain_metrics_daily", "user_exam_metrics_snapshot", "weekly_progress_snapshot",
    }


def test_deprecated_orphan_routes_are_flagged(client):
    spec = client.get("/openapi.json").json()
    paths = spec["paths"]
    assert paths["/api/sessions/{session_id}/next"]["get"].get("deprecated") is True
    assert paths["/api/sessions/{session_id}/answer"]["post"].get("deprecated") is True
    assert paths["/api/sessions/{session_id}/result"]["get"].get("deprecated") is True
    assert paths["/api/study/sessions/{session_id}/result"]["get"].get("deprecated") is True
    assert not paths["/api/health"]["get"].get("deprecated")


@pytest.mark.parametrize(
    "path",
    [
        "/api/health",
        "/api/domains",
        "/api/analytics/weak-areas",
        "/api/auth/logout",
        "/api/auth/request-email-verification",
        "/api/auth/request-password-reset",
        "/api/auth/reset-password",
        "/api/admin/ingest",
        "/api/admin/exams",
        "/api/admin/questions/{question_id}/publish",
    ],
)
def test_former_dict_endpoints_have_response_models(client, path):
    spec = client.get("/openapi.json").json()
    operations = spec["paths"][path]
    for operation in operations.values():
        schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
        assert schema, path
