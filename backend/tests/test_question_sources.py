"""scripts/question_sources: registry decisions, license gate, adapters, validate, dedupe,
review-apply and import. Only SYNTHETIC fixtures are used (no third-party content)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from scripts.question_sources import adapters, cli, workflow  # noqa: E402
from scripts.question_sources import registry as reg  # noqa: E402

EXPECTED_STATUS = {
    "michaliskampouridis-security-plus-study": "permission_required",
    "iakhator-comptia-security-plus-701": "permission_required",
    "costajr007-security-plus-practice": "blocked",
    "psybeast-ceh-v13-exam-simulator": "blocked",
    "therrpatil-ceh-v13-exam-mcq135": "blocked",
    "siriusbkid-gideon-pbq-generator": "blocked",
}


@pytest.fixture()
def registry():
    return reg.load_registry()


@pytest.fixture()
def cache(tmp_path, monkeypatch):
    root = tmp_path / "cache"
    monkeypatch.setenv("SQ_SOURCES_CACHE", str(root))
    return root


def _source(registry, source_id):
    return json.loads(json.dumps(reg.get_source(registry, source_id)))


# --------------------------------------------------------------------------- registry

def test_registry_has_the_six_decided_sources(registry):
    statuses = {source["id"]: source["status"] for source in registry["sources"]}
    assert statuses == EXPECTED_STATUS
    for source in registry["sources"]:
        assert len(source["commit"]) == 40 and source["url"].startswith("https://github.com/")
        assert source["reason"] and source["evidence"]
        assert source["license"] in {"MIT", "NOASSERTION"}
    stats = {source["id"]: source["review_stats"] for source in registry["sources"]}
    assert stats["costajr007-security-plus-practice"]["reviewed"] == 600
    assert stats["costajr007-security-plus-practice"]["correct_percent"] == 80.2
    assert stats["costajr007-security-plus-practice"]["incorrect_key_percent"] == 1.7
    assert stats["costajr007-security-plus-practice"]["ambiguous_percent"] == 6.3
    assert stats["michaliskampouridis-security-plus-study"] == {
        "reviewed": 25, "scope": stats["michaliskampouridis-security-plus-study"]["scope"],
        "correct_percent": 96.0, "realism_avg": 4.16,
    }
    assert stats["iakhator-comptia-security-plus-701"]["incorrect_key_percent"] == 4.0
    assert stats["iakhator-comptia-security-plus-701"]["realism_avg"] == 4.08
    assert stats["psybeast-ceh-v13-exam-simulator"]["correct_percent"] == 88.0
    assert stats["psybeast-ceh-v13-exam-simulator"]["realism_avg"] == 3.44
    assert stats["therrpatil-ceh-v13-exam-mcq135"]["correct_percent"] == 84.0
    assert stats["therrpatil-ceh-v13-exam-mcq135"]["realism_avg"] == 1.68
    assert "ExamsDigest" in reg.get_source(registry, "costajr007-security-plus-practice")["reason"]
    assert "ExamTopics" in reg.get_source(registry, "psybeast-ceh-v13-exam-simulator")["reason"]


def test_registry_validation_rejects_approval_without_license_or_permission(registry):
    broken = json.loads(json.dumps(registry))
    broken["sources"][0]["status"] = "approved"
    assert any("approved without" in error for error in reg.validate_registry(broken))
    broken["sources"][1]["commit"] = "abc"
    assert any("40-char" in error for error in reg.validate_registry(broken))


def test_license_gate(registry, tmp_path):
    for source_id, status in EXPECTED_STATUS.items():
        with pytest.raises(reg.RegistryError):
            reg.check_import_allowed(reg.get_source(registry, source_id))
    evidence = tmp_path / "permission.eml"
    evidence.write_text("Author: yes, you may reuse the questions with attribution.", encoding="utf-8")
    copy = json.loads(json.dumps(registry))
    reg.record_permission(copy, "iakhator-comptia-security-plus-701", evidence, note="e-mail", permissions_dir=tmp_path / "perm")
    source = reg.get_source(copy, "iakhator-comptia-security-plus-701")
    assert source["status"] == "approved" and source["permission"]["sha256"]
    assert reg.validate_registry(copy) == []
    reg.check_import_allowed(source)
    with pytest.raises(reg.RegistryError):
        reg.record_permission(copy, "costajr007-security-plus-practice", evidence, permissions_dir=tmp_path / "perm")
    empty = tmp_path / "empty.txt"
    empty.write_text("", encoding="utf-8")
    with pytest.raises(reg.RegistryError):
        reg.record_permission(copy, "michaliskampouridis-security-plus-study", empty, permissions_dir=tmp_path / "perm")


def test_cache_must_live_outside_the_repository(monkeypatch):
    monkeypatch.setenv("SQ_SOURCES_CACHE", str(REPO / "tmp-cache"))
    with pytest.raises(workflow.PipelineError):
        workflow.cache_root()


def test_fetch_clones_the_pinned_commit(registry, cache):
    calls = []
    source = _source(registry, "iakhator-comptia-security-plus-701")
    workflow.fetch(source, runner=lambda cmd, check: calls.append(cmd))
    assert calls[0][:2] == ["git", "clone"] and source["url"] in calls[0]
    assert calls[-1][-1] == source["commit"] and "checkout" in calls[-1]
    assert str(cache) in calls[0][-1]


# --------------------------------------------------------------------------- adapters (synthetic)

def _write(path: Path, payload) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload) if not isinstance(payload, str) else payload, encoding="utf-8")
    return path


def _mk_checkout(root: Path) -> Path:
    _write(root / "data" / "questions-1.json", [
        {"id": "D1-001", "domain": 1, "objective": "1.2", "topic": "Synthetic", "format": "multiple_choice",
         "difficulty": "hard", "stem": "Which synthetic control best fits the made-up scenario alpha?",
         "scenario": "A fictional lab team reviews synthetic control alpha.", "options": {"A": "Alpha one", "B": "Alpha two",
         "C": "Alpha three", "D": "Alpha four"}, "answer": "B", "explanation": "Alpha two is the synthetic answer (B).",
         "comptia_logic_note": None},
        {"id": "D1-002", "domain": 4, "objective": "4.8", "topic": "Synthetic", "format": "multiple_select",
         "difficulty": "medium", "stem": "Pick the two synthetic steps of the fictional beta process.",
         "options": {"A": "Beta step one", "B": "Beta step two", "C": "Beta step three", "D": "Beta step four"},
         "answer": ["A", "C"], "explanation": "Synthetic steps one and three.", "comptia_logic_note": "Invented note."},
    ])
    return root


def _ia_checkout(root: Path) -> Path:
    data = root / "src" / "data"
    _write(data / "ch2_TestA.json", [
        {"id": "q1", "objective": "Question 1 of 2 - Domain 2.0 Objective 2.3", "question": "Synthetic gamma question one?",
         "options": {"A": "Gamma A", "B": "Gamma B", "C": "Gamma C", "D": "Gamma D"}, "correct": "C",
         "explanation": "Gamma C is right."},
    ])
    _write(data / "finalExam.json", [
        {"id": "f1", "objective": "Question 1 of 2 - Domain 5.0", "question": "Synthetic delta question with an empty key?",
         "options": {"A": "Delta A", "B": "Delta B", "C": "Delta C", "D": "Delta D"}, "correct": "",
         "explanation": "Delta A (A) is wrong, (B) is wrong and (D) is wrong."},
        {"id": "f2", "objective": "Question 2 of 2 - Domain 3.0", "question": "Synthetic epsilon question with an empty key?",
         "options": {"A": "Eps A", "B": "Eps B", "C": "Eps C", "D": "Eps D"}, "correct": "", "explanation": "No letters here."},
    ])
    return root


def _cj_checkout(root: Path) -> Path:
    _write(root / "questions_db_final.json", [
        {"id": 1, "topic": "3. Security Architecture", "question": "Synthetic zeta question?",
         "options": {"A": "Zeta A", "B": "Zeta B", "C": "Zeta C", "D": "Zeta D"}, "answer": "A", "explanation": "Zeta A."},
        {"id": 2, "topic": "General Knowledge", "question": "Synthetic eta question?",
         "options": {"A": "Eta A", "B": "Eta B", "C": "Eta C", "D": "Eta D"}, "answer": "D", "explanation": "Eta D."},
    ])
    return root


def _psy_checkout(root: Path) -> Path:
    pool = [
        {"id": 1, "domain": "Scanning Networks", "source": "SYN", "q": "Synthetic theta scan question?",
         "opts": ["Theta A", "Theta B", "Theta C", "Theta D"], "ans": 2, "exp": "Theta C."},
        {"id": 2, "domain": "CEH v13", "source": "SYN", "q": "Synthetic iota question?",
         "opts": ["Iota A", "Iota B", "Iota C", "Iota D"], "ans": 0, "exp": "Iota A."},
    ]
    _write(root / "index.html", f"<html><script>var POOL={json.dumps(pool)};var other=1;</script></html>")
    return root


RRP_TEXT = """1. Synthetic kappa question one?
a) Kappa A
b) Kappa B
c) Kappa C
d) Kappa D
Answer: c) Kappa C
Explanation: Kappa C is the synthetic answer
over two lines.

2. Synthetic lambda question two?
A. Lambda A
B. Lambda B
C. Lambda C
D. Lambda D
Correct Answer: B
Option B: correct lambda.
"""


def test_adapters_produce_schema_v3_records_with_provenance(registry, tmp_path, cache):
    cases = {
        "michaliskampouridis-security-plus-study": _mk_checkout(tmp_path / "mk"),
        "iakhator-comptia-security-plus-701": _ia_checkout(tmp_path / "ia"),
        "costajr007-security-plus-practice": _cj_checkout(tmp_path / "cj"),
        "psybeast-ceh-v13-exam-simulator": _psy_checkout(tmp_path / "psy"),
        "therrpatil-ceh-v13-exam-mcq135": _write(tmp_path / "rrp" / "mcq.txt", RRP_TEXT).parent,
    }
    results = {}
    for source_id, root in cases.items():
        source = _source(registry, source_id)
        path, stats = workflow.extract_to_cache(source, root)
        assert path.is_relative_to(cache)
        errors, _warnings = workflow.validate(path)
        assert errors == [], (source_id, errors)
        questions = workflow.read_bank(path)["questions"]
        for q in questions:
            assert q["needs_review"] is True
            assert q["source_repo"] == source["url"] and q["source_commit"] == source["commit"]
            assert q["source_license"] == source["license"] and q["source_path"] and q["source_id"]
        results[source_id] = (questions, stats)

    mk, _ = results["michaliskampouridis-security-plus-study"]
    assert mk[0]["question"].startswith("A fictional lab team") and mk[0]["difficulty"] == "Hard"
    assert mk[1]["multi_select"] is True and mk[1]["correct_options"] == ["A", "C"]
    assert mk[1]["domain"] == "Security Operations" and "CompTIA logic" in mk[1]["justification"]

    ia, ia_stats = results["iakhator-comptia-security-plus-701"]
    assert ia_stats["answer_key_missing_inferred"] == 1 and ia_stats["answer_key_missing_uninferable"] == 1
    assert ia[0]["domain"] == "Threats, Vulnerabilities and Mitigations"
    assert ia[1]["correct_options"] == ["C"] and "inferred" in ia[1]["review_notes"]
    assert ia[2]["domain"] == "Security Architecture" and "could not be inferred" in ia[2]["review_notes"]

    cj, _ = results["costajr007-security-plus-practice"]
    assert cj[0]["domain"] == "Security Architecture" and "placeholder domain" in cj[1]["review_notes"]

    psy, psy_stats = results["psybeast-ceh-v13-exam-simulator"]
    assert psy[0]["certification"] == "CEH" and psy[0]["domain"] == "Reconnaissance Techniques"
    assert psy[0]["correct_options"] == ["C"] and psy_stats["unmapped_domain"] == 1

    rrp, _ = results["therrpatil-ceh-v13-exam-mcq135"]
    assert [q["correct_options"] for q in rrp] == [["C"], ["B"]]
    assert rrp[0]["justification"] == "Kappa C is the synthetic answer over two lines."

    with pytest.raises(adapters.AdapterError):
        adapters.extract(_source(registry, "siriusbkid-gideon-pbq-generator"), tmp_path)


# --------------------------------------------------------------------------- dedupe / review / import

def _bank(path: Path, questions: list[dict]) -> Path:
    return _write(path, {"exam": {"id": "securityplus", "title": "t", "source": "s", "question_count": len(questions),
                                  "certification": "Security+", "language": "en", "schema_version": 3, "notes": None},
                         "questions": questions})


def test_dedupe_exact_fuzzy_and_internal(registry, tmp_path, cache):
    source = _source(registry, "michaliskampouridis-security-plus-study")
    path, _ = workflow.extract_to_cache(source, _mk_checkout(tmp_path / "mk"))
    data = workflow.read_bank(path)
    existing = json.loads(json.dumps(data["questions"][0]))
    existing["id"] = "bank-1"
    fuzzy = json.loads(json.dumps(data["questions"][1]))
    fuzzy["id"] = "bank-2"
    fuzzy["question"] = fuzzy["question"].replace("fictional", "fictitious")
    bank = _bank(tmp_path / "bank.json", [existing, fuzzy])
    report = workflow.dedupe(path, against=[bank])
    by_id = {match["id"]: match for match in report["matches"]}
    assert by_id["ext_mk_0001"]["exact"] is True and by_id["ext_mk_0001"]["match"] == "bank-1"
    assert by_id["ext_mk_0002"]["exact"] is False and by_id["ext_mk_0002"]["ratio"] >= 0.9
    clean = workflow.dedupe(path, against=[])
    assert clean["duplicates"] == 0
    data["questions"].append(dict(data["questions"][0], id="ext_mk_0003"))
    _write(path, data)
    internal = workflow.dedupe(path, against=[])
    assert internal["matches"] == [{"id": "ext_mk_0003", "match": "ext_mk_0001", "bank": "(same file)", "ratio": 1.0, "exact": True}]


def test_review_apply(registry, tmp_path, cache):
    source = _source(registry, "iakhator-comptia-security-plus-701")
    path, _ = workflow.extract_to_cache(source, _ia_checkout(tmp_path / "ia"))
    review = _write(tmp_path / "review.json", [
        {"id": "ext_ia_0001", "verdict": "correct", "objective": "2.4", "domain": "Threats, Vulnerabilities and Mitigations",
         "difficulty": "Hard", "realism": 4, "explanation_ok": True},
        {"id": "ext_ia_0002", "verdict": "incorrect_key", "correct_options": ["B"], "reasoning": "B is right.",
         "explanation_ok": False, "ai_explanation": "Synthetic AI explanation for delta B."},
        {"id": "ext_ia_0003", "verdict": "ambiguous", "reasoning": "Two options fit."},
    ])
    out = tmp_path / "reviewed.json"
    stats = workflow.apply_review(path, review, out=out)
    assert stats["kept"] == 2 and stats["dropped"] == 1 and stats["key_fixed"] == 1 and stats["ai_explanations"] == 1
    questions = {q["id"]: q for q in workflow.read_bank(out)["questions"]}
    assert questions["ext_ia_0001"]["difficulty"] == "Hard" and "obj 2.4" in questions["ext_ia_0001"]["tags"]
    assert questions["ext_ia_0001"]["quality_score"] == 80.0
    fixed = questions["ext_ia_0002"]
    assert fixed["correct_options"] == ["B"] and fixed["explanation_source"] == "ai_draft"
    assert fixed["needs_review"] is True and "incorrect_key" in fixed["review_notes"]
    assert workflow.validate(out)[0] == []
    kept = workflow.apply_review(path, review, out=tmp_path / "kept.json", keep_flagged=True)
    assert kept["kept"] == 3
    bad = _write(tmp_path / "bad.json", [{"id": "ext_ia_0001", "verdict": "incorrect_key", "correct_options": ["Z"]}])
    with pytest.raises(workflow.PipelineError):
        workflow.apply_review(path, bad, out=tmp_path / "x.json")


def test_import_requires_approval_and_writes_provenance(registry, tmp_path, cache):
    source = _source(registry, "michaliskampouridis-security-plus-study")
    path, _ = workflow.extract_to_cache(source, _mk_checkout(tmp_path / "mk"))
    imports = tmp_path / "imports"
    with pytest.raises(reg.RegistryError):
        workflow.import_source(source, path, imports_dir=imports, against=[])
    evidence = _write(tmp_path / "permission.txt", "Synthetic permission granted.")
    reg.record_permission(registry, source["id"], evidence, permissions_dir=tmp_path / "perm")
    approved = reg.get_source(registry, source["id"])
    existing = dict(workflow.read_bank(path)["questions"][0], id="bank-1")
    result = workflow.import_source(approved, path, imports_dir=imports, against=[_bank(tmp_path / "bank.json", [existing])])
    assert result["imported"] == 1 and result["skipped_duplicates"] == 1
    written = json.loads((imports / f"{source['id']}.json").read_text(encoding="utf-8"))
    assert written["exam"]["id"] == "securityplus" and written["exam"]["question_count"] == 1
    q = written["questions"][0]
    assert q["needs_review"] is True and q["source_repo"] == source["url"] and q["source_commit"] == source["commit"]
    assert q["source_license"] == "NOASSERTION" and q["source_path"] and q["source_id"]


def test_cli_list_and_blocked_import(capsys, cache):
    assert cli.main(["list"]) == 0
    out = capsys.readouterr().out
    assert "costajr007-security-plus-practice" in out and "blocked" in out
    assert cli.main(["import", "psybeast-ceh-v13-exam-simulator"]) == 2
    assert "blocked" in capsys.readouterr().err


def test_no_extracted_third_party_content_is_committed():
    imports = REPO / "questions" / "imports"
    for path in imports.glob("*.json") if imports.is_dir() else []:
        source_id = path.stem
        source = reg.get_source(reg.load_registry(), source_id)
        assert source["status"] == "approved", f"{path} imported from a non-approved source"
