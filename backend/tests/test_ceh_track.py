"""CEH v13: blueprint weights, study track (modules, domains, prerequisites), pass
threshold, question bank ingest and the image/study-track wiring."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
CEH_DOMAINS = {
    "Information Security and Ethical Hacking Overview": 6.0,
    "Reconnaissance Techniques": 17.0,
    "System Hacking Phases and Attack Techniques": 15.0,
    "Network and Perimeter Hacking": 24.0,
    "Web Application Hacking": 14.0,
    "Wireless Network Hacking": 5.0,
    "Mobile Platform, IoT, and OT Hacking": 10.0,
    "Cloud Computing": 5.0,
    "Cryptography": 5.0,
}


def test_pass_threshold_is_70_with_aliases():
    from app.services.exam_policy import pass_threshold_for, resolve_pass_threshold

    for name in ("CEH", "ceh", "CEH v13", "312-50", "Certified Ethical Hacker"):
        assert pass_threshold_for(name) == 70.0
    assert resolve_pass_threshold({"CEH": 10}) == (70.0, "CEH")
    assert resolve_pass_threshold({"CEH": 1, "Security+": 1}) == (76.5, None)


def test_ceh_weights_and_fallback_match_the_blueprint():
    from app.services.ingest import OFFICIAL_DOMAIN_WEIGHTS
    from app.services.question_pool import FALLBACK_BLUEPRINT_WEIGHTS

    assert {domain: weight for _code, domain, weight in OFFICIAL_DOMAIN_WEIGHTS["CEH"]} == CEH_DOMAINS
    assert [code for code, _d, _w in OFFICIAL_DOMAIN_WEIGHTS["CEH"]] == [f"CEH-D{i}" for i in range(1, 10)]
    assert FALLBACK_BLUEPRINT_WEIGHTS["ceh"] == CEH_DOMAINS


def test_ceh_study_track_metadata_is_acyclic_and_uses_blueprint_domains():
    from app.services.ingest import load_study_track_metadata, parse_markdown_modules

    metadata = load_study_track_metadata()["CEH"]
    modules = parse_markdown_modules((REPO / "material" / "ceh_modules.md").read_text(encoding="utf-8"))
    assert [m["code"] for m in modules] == [f"M{i:02d}" for i in range(1, 21)]
    assert set(metadata) == {m["code"] for m in modules}
    for code, spec in metadata.items():
        assert spec["domain"] in CEH_DOMAINS
        for prerequisite in spec["prerequisites"]:
            assert prerequisite < code  # earlier module (acyclic)
    assert metadata["M12"]["prerequisites"] == ["M03", "M08"]
    assert metadata["M16"]["domain"] == "Wireless Network Hacking"


def test_ceh_bank_ingest_modules_and_weights(db, tmp_path):
    from sqlalchemy import select

    from app.models import Exam, Question, StudyModule
    from app.services.ingest import get_domain_blueprint_weights, ingest_questions_from_dir

    qdir = tmp_path / "questions"
    qdir.mkdir()
    material = tmp_path / "material"
    material.mkdir()
    shutil.copy(REPO / "questions" / "ceh.json", qdir / "ceh.json")
    shutil.copy(REPO / "material" / "ceh_modules.md", material / "ceh_modules.md")
    result = ingest_questions_from_dir(db, str(qdir), material_dir=str(material))
    assert result["errors"] == [] and result["rejected_invalid_domain"] == 0
    bank = json.loads((REPO / "questions" / "ceh.json").read_text(encoding="utf-8"))
    assert result["questions_imported"] == len(bank["questions"])
    exam = db.get(Exam, "ceh")
    assert exam is not None and exam.question_count == len(bank["questions"])
    question = db.get(Question, bank["questions"][0]["id"])
    assert question.certification == "CEH" and question.domain in CEH_DOMAINS
    assert question.needs_review is True  # ai_draft items wait for SME review

    weights = get_domain_blueprint_weights(db, "CEH")
    assert weights == CEH_DOMAINS

    modules = db.execute(
        select(StudyModule).where(StudyModule.certification == "CEH").order_by(StudyModule.position)
    ).scalars().all()
    assert len(modules) == 20 and result["study_modules"] == 20
    assert modules[0].source_file == "material/ceh_modules.md"
    assert modules[0].title.startswith("Introdução ao Ethical Hacking")
    assert all(module.domain in CEH_DOMAINS for module in modules)
    by_code = {module.code: module for module in modules}
    assert by_code["M01"].prerequisite_codes == []
    assert by_code["M17"].prerequisite_codes == ["M07", "M14"]


def test_ceh_exam_session_uses_blueprint_quotas(client, db, tmp_path):
    from app.services.ingest import ingest_questions_from_dir

    qdir = tmp_path / "questions"
    qdir.mkdir()
    shutil.copy(REPO / "questions" / "ceh.json", qdir / "ceh.json")
    ingest_questions_from_dir(db, str(qdir), material_dir=str(tmp_path))
    response = client.post("/api/sessions", json={"exam_id": "ceh", "total_questions": 20}, headers={"X-Client-Key": "ceh-k"})
    assert response.status_code == 200, response.text
    assert response.json()["selection_mix"].get("blueprint_weighted") == 20
    session_id = response.json()["id"]
    result = client.post(f"/api/sessions/{session_id}/submit", headers={"X-Client-Key": "ceh-k"}).json()
    assert result["pass_threshold_percent"] == 70.0 and result["pass_threshold_certification"] == "CEH"


@pytest.mark.parametrize("name", ["Modulos_sec+.md", "cissp_domain.json", "ceh_modules.md"])
def test_image_ships_the_three_study_track_files(name):
    dockerfile = (REPO / "Dockerfile").read_text(encoding="utf-8")
    dockerignore = (REPO / ".dockerignore").read_text(encoding="utf-8")
    copy_line = next(line for line in dockerfile.splitlines() if "/app/study-tracks/" in line and line.startswith("COPY"))
    assert f"material/{name}" in copy_line
    assert f"!material/{name}" in dockerignore
