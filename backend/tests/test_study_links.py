"""Study sections after answering, the section reader, weak sections, practice-by-section and
tutor grounding (app.services.study_links + API), on a synthetic book and link file."""
from __future__ import annotations

import json

import pytest

from app.core.config import settings
from app.services import material_corpus, materials, study_links

from conftest import make_exam_session, seed_question
from test_material_corpus import _section, _write_book

HEADERS = {"X-Client-Key": "device-sections"}
PHISHING = "fake_security_guide:c01:head-2-1"
WHALING = "fake_security_guide:c01:head-3-1"


@pytest.fixture()
def study_material(tmp_path, monkeypatch):
    """Mount a synthetic book under MATERIAL_DIR/json and point the link file at a temp copy."""
    _write_book(
        tmp_path / "json",
        chapters={
            "c01.xhtml": (
                "Chapter 1: Social Engineering",
                [_section("c01_1", 1, "Chapter 1 Social Engineering", "Objectives 2.2 threat vectors.", children=[
                    _section("head-2-1", 2, "Phishing", "Phishing uses fraudulent email to steal credentials. Awareness training teaches staff to spot it.", children=[
                        _section("head-3-1", 3, "Whaling", "Whaling targets senior executives. An open relay forwards mail from anyone and is abused for spam."),
                    ]),
                ])],
            ),
        },
    )
    monkeypatch.setattr(settings, "material_dir", str(tmp_path))
    materials.clear_material_index_cache()
    material_corpus.clear_corpus_cache()

    links_path = tmp_path / "study_links.json"
    monkeypatch.setattr(study_links, "LINKS_PATH", links_path)

    def write_links(mapping):
        links_path.write_text(json.dumps({"version": 1, "questions": mapping}), encoding="utf-8")
        study_links.clear_links_cache()

    yield write_links
    study_links.clear_links_cache()
    material_corpus.clear_corpus_cache()


def _study_answer(client, db, qid, display_key, *, order_json=None):
    from app.models import StudySessionQuestion

    created = client.post("/api/study/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS)
    assert created.status_code == 200, created.text
    session_id = created.json()["id"]
    for row in db.query(StudySessionQuestion).filter_by(session_id=session_id):
        row.option_order_json = order_json
    db.commit()
    response = client.post(
        f"/api/study/sessions/{session_id}/answer",
        json={"question_id": qid, "selected_keys": [display_key], "confidence_level": "confident"},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_wrong_answer_puts_the_chosen_option_section_first_with_display_keys(make_client, db, study_material):
    qid = seed_question(db)  # A = correct, B = wrong ("Open relay")
    study_material({qid: {"sections": [[PHISHING, 12.0]], "options": {"B": [WHALING, 8.0]}}})

    # Shuffled session: display "A" is the original wrong option B.
    body = _study_answer(make_client(), db, qid, "A", order_json='["B", "A"]')
    assert body["is_correct"] is False
    sections = body["study_sections"]
    assert [item["reason"] for item in sections] == ["your_choice", "explanation"]
    assert sections[0]["section_id"] == WHALING
    assert sections[0]["option_key"] == "A"  # the key the student saw, not the original "B"
    assert "open relay" in sections[0]["excerpt"].lower()
    assert sections[1]["section_id"] == PHISHING
    assert sections[1]["book_title"] == "Fake Security Guide"
    assert sections[1]["breadcrumb"][-1] == "Phishing"


def test_correct_answer_gets_only_explanations(make_client, db, study_material):
    qid = seed_question(db)
    study_material({qid: {"sections": [[PHISHING, 12.0]], "options": {"B": [WHALING, 8.0]}}})
    body = _study_answer(make_client(), db, qid, "A")
    assert body["is_correct"] is True
    assert [item["section_id"] for item in body["study_sections"]] == [PHISHING]


def test_questions_without_links_fall_back_to_their_citation(make_client, db, study_material):
    from app.models import Question

    qid = seed_question(db)
    question = db.get(Question, qid)
    question.citations_json = json.dumps([{"material_path": "material/Fake Security Guide.epub", "locator": "OPS/c01.xhtml#head-3-1"}])
    db.commit()
    study_material({})
    body = _study_answer(make_client(), db, qid, "A")
    assert [item["section_id"] for item in body["study_sections"]] == [WHALING]


def test_no_mounted_books_means_no_sections(make_client, db, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "material_dir", str(tmp_path / "empty"))
    material_corpus.clear_corpus_cache()
    qid = seed_question(db)
    body = _study_answer(make_client(), db, qid, "B")
    assert body["study_sections"] == []


def test_section_reader_requires_login_and_returns_subsections(client, login_client, study_material):
    study_material({})
    assert client.get(f"/api/materials/sections/{PHISHING}").status_code == 401

    authed, _user = login_client()
    response = authed.get(f"/api/materials/sections/{PHISHING}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Phishing"
    assert [part["title"] for part in body["parts"]] == ["Phishing", "Whaling"]
    assert body["parent"]["id"] == "fake_security_guide:c01:c01_1"
    assert authed.get("/api/materials/sections/fake_security_guide:c01:missing").status_code == 404


def test_weak_sections_and_practice_by_section(make_client, db, study_material):
    qid = seed_question(db)
    study_material({qid: {"sections": [[PHISHING, 12.0]], "options": {}}})
    client = make_client()
    _study_answer(client, db, qid, "B")  # wrong

    weak = client.get("/api/study/weak-sections", headers=HEADERS)
    assert weak.status_code == 200, weak.text
    items = weak.json()
    assert items and items[0]["section_id"] == PHISHING
    assert items[0]["open_questions"] == 1 and items[0]["mistakes"] == 1
    assert items[0]["practice_questions"] == 1

    practice = client.post(
        "/api/study/sessions",
        json={"exam_id": "secplus", "total_questions": 5, "section_id": PHISHING},
        headers=HEADERS,
    )
    assert practice.status_code == 200, practice.text
    assert practice.json()["total_questions"] == 1

    unknown = client.post(
        "/api/study/sessions",
        json={"exam_id": "secplus", "total_questions": 5, "section_id": "nope:c01:x"},
        headers=HEADERS,
    )
    assert unknown.status_code == 404


def test_tutor_gets_the_book_excerpt_only_after_answering(login_client, db, study_material, monkeypatch):
    from app.services.gemini import GeminiResult
    import app.api.routes as routes

    calls = []
    monkeypatch.setattr(routes, "ask_gemini", lambda **kwargs: calls.append(kwargs) or GeminiResult(message="ok", blocked=False, model="m"))
    qid = seed_question(db)
    study_material({qid: {"sections": [[PHISHING, 12.0]], "options": {}}})
    client, user = login_client()

    answered = make_exam_session(db, question_ids=[qid], user_id=user.id, completed=True, answers={qid: ("B", False)})
    response = client.post(f"/api/sessions/{answered}/questions/{qid}/tutor", json={"mode": "help"})
    assert response.status_code == 200, response.text
    material = calls[-1]["study_material"] or ""
    assert "Fake Security Guide" in material and "fraudulent email" in material

    unanswered = make_exam_session(db, question_ids=[qid], user_id=user.id, completed=True)
    response = client.post(f"/api/sessions/{unanswered}/questions/{qid}/tutor", json={"mode": "help"})
    assert response.status_code == 200, response.text
    assert calls[-1]["study_material"] is None  # nothing from the book before answering


def test_tutor_prompt_includes_material_block():
    from app.services.gemini import _build_prompt

    prompt = _build_prompt(
        question_prompt="Q?", options=[{"key": "A", "text": "x"}], multi_select=False, user_message="why",
        mode="help", selected_keys=["A"], is_correct=False, justification="J", study_material="Book — Phishing:\nText",
    )
    assert "<material_de_estudo>" in prompt and "Book — Phishing" in prompt
