"""Shared helpers for the Sentinel Arena API/WebSocket tests."""
from __future__ import annotations

from typing import Any

import pytest

from app.core.config import settings

ORIGIN = "http://localhost:3000"


@pytest.fixture()
def live_on(monkeypatch):
    monkeypatch.setattr(settings, "live_enabled", True)
    monkeypatch.setattr(settings, "live_host_policy", "all")
    monkeypatch.setattr(settings, "live_ws_heartbeat_ms", 60000)
    # TestClient buffers a streaming body until it ends: keep SSE streams short.
    monkeypatch.setattr(settings, "live_sse_max_seconds", 0.3)
    yield settings


def create_quiz(client, title: str = "Quiz de phishing", **extra: Any) -> dict:
    response = client.post("/api/live/quizzes", json={"title": title, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def add_item(client, quiz: dict, **fields: Any) -> dict:
    response = client.post(f"/api/live/quizzes/{quiz['id']}/items", json={"expected_version": quiz["version"], **fields})
    assert response.status_code == 201, response.text
    return response.json()


def published_quiz(client, *, settings_patch: dict | None = None) -> dict:
    quiz = create_quiz(client, settings=settings_patch or {"reading_phase_s": 0, "leaderboard_every": 0})
    quiz = add_item(
        client, quiz, item_type="single_choice", prompt="Qual controle mitiga phishing?",
        options=[{"text": "Treinamento", "correct": True}, {"text": "Relay aberto"}], time_limit_s=20,
    )
    quiz = add_item(
        client, quiz, item_type="multi_choice", prompt="Quais são fatores de autenticação?",
        options=[{"text": "Senha", "correct": True}, {"text": "Token", "correct": True}, {"text": "Cor favorita"}], time_limit_s=20,
    )
    quiz = add_item(client, quiz, item_type="type_answer", prompt="Ataque por SMS?", accepted_answers=["smishing"], time_limit_s=20)
    quiz = add_item(client, quiz, item_type="poll", prompt="Você usa MFA?", options=[{"text": "Sim"}, {"text": "Não"}], time_limit_s=20)
    response = client.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
    assert response.status_code == 200, response.text
    return response.json()["quiz"]
