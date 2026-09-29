"""PBQ authoring validation, public/private split, per-session shuffle and grading
(every task type and scoring method, including partial credit)."""
from __future__ import annotations

import copy
import json
import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.pbq_grading import (  # noqa: E402
    PBQError,
    build_session_order,
    grade_response,
    parse_number,
    render_public_payload,
    sanitize_response,
    score_task,
    solutions_and_explanations,
    split_authoring_item,
    validate_authoring_item,
)

BANK = ROOT.parent / "questions" / "pbq_securityplus.json"


def _items() -> dict[str, dict]:
    return {item["id"]: item for item in json.loads(BANK.read_text(encoding="utf-8"))["questions"]}


def _split(item_id: str):
    return split_authoring_item(_items()[item_id])


def _task_key(answer: dict, task_id: str) -> dict:
    return answer["tasks"][task_id]


# --------------------------------------------------------------------------- bank + split

def test_bank_items_are_valid_and_keep_ids():
    items = _items()
    assert sorted(items) == [f"sq_pbq_701_000{i}" for i in range(1, 7)]
    for item_id, item in items.items():
        assert validate_authoring_item(item, where=item_id) == []


def test_bank_texts_have_pt_br_accents():
    text = BANK.read_text(encoding="utf-8")
    for accented in ("evidências", "Você é o líder", "não", "segurança", "Injeção de SQL", "às 03:00"):
        assert accented in text
    for unaccented in (" nao ", "seguranca", "Voce ", "evidencias"):
        assert unaccented not in text


def test_public_payload_never_contains_the_answer_key():
    for item in _items().values():
        public, answer = split_authoring_item(item)
        dumped = json.dumps(public, ensure_ascii=False)
        assert '"solution"' not in dumped and '"scoring"' not in dumped and '"explanation"' not in dumped
        assert set(answer["tasks"]) == {task["id"] for task in public["tasks"]}
        for task in public["tasks"]:
            assert task["weight"] > 0


def test_exhibits_and_table_cells_are_normalized():
    public, _answer = _split("sq_pbq_701_0005")
    log = public["exhibits"][0]
    assert log["type"] == "log" and log["lines"][0]["id"] == "l01"
    task = public["tasks"][1]
    cell = task["rows"][0]["cells"]["ans"]
    assert cell == {"editable": True, "input_type": "select", "choices": cell["choices"]} and len(cell["choices"]) == 4

    public, _answer = _split("sq_pbq_701_0002")
    assert public["exhibits"][1]["type"] == "table" and public["exhibits"][1]["rows"][0]["id"] == "c1"
    row = public["tasks"][0]["rows"][0]
    assert row["cells"]["src"] == {"editable": False, "value": "ANY"}
    assert row["cells"]["act"]["choices"] == ["ALLOW", "DENY"]
    assert public["tasks"][1]["select_mode"] == "multiple"

    public, _answer = _split("sq_pbq_701_0006")
    number_cell = public["tasks"][0]["rows"][0]["cells"]["val"]
    assert number_cell == {"editable": True, "input_type": "text", "numeric": True}
    decision = public["tasks"][0]["rows"][4]["cells"]["val"]
    assert decision["input_type"] == "select" and len(decision["choices"]) == 2


# --------------------------------------------------------------------------- validation errors

def test_validation_reports_inconsistent_solutions():
    items = _items()
    broken = copy.deepcopy(items["sq_pbq_701_0003"])
    broken["tasks"][0]["solution"]["assignment"]["k1"] = "nope"
    broken["tasks"][1]["weight"] = 0
    del broken["tasks"][1]["solution"]["assignment"]["g8"]
    errors = validate_authoring_item(broken, where="x")
    assert any("unknown buckets" in e for e in errors)
    assert any("weight must be a number > 0" in e for e in errors)
    assert any("must map every item id" in e for e in errors)

    broken = copy.deepcopy(items["sq_pbq_701_0001"])
    broken["tasks"][0]["solution"]["order"] = broken["tasks"][0]["solution"]["order"][:-1]
    assert any("permutation" in e for e in validate_authoring_item(broken))

    broken = copy.deepcopy(items["sq_pbq_701_0002"])
    broken["tasks"][0]["solution"]["cells"]["r1"]["svc"]["accepted"] = ["TCP 8443"]
    del broken["tasks"][0]["solution"]["cells"]["r4"]
    broken["tasks"][1]["exhibit_id"] = "e9"
    errors = validate_authoring_item(broken)
    assert any("not among the select choices" in e for e in errors)
    assert any("without solution" in e for e in errors)
    assert any("exhibit_id" in e for e in errors)

    broken = copy.deepcopy(items["sq_pbq_701_0004"])
    broken["tasks"][0]["solution"]["pairs"]["i2"] = "a_sqli"
    broken["tasks"][0]["scoring"]["method"] = "kendall_tau_clipped"
    errors = validate_authoring_item(broken)
    assert any("reuses a right item" in e for e in errors)
    assert any("not valid for matching" in e for e in errors)

    broken = copy.deepcopy(items["sq_pbq_701_0005"])
    broken["tasks"][0]["solution"]["selected"].append("l99")
    broken["tasks"][1]["explanation"] = {"summary": ""}
    errors = validate_authoring_item(broken)
    assert any("not in the exhibit" in e for e in errors)
    assert any("explanation.summary" in e for e in errors)


# --------------------------------------------------------------------------- scoring per task type

def test_ordering_kendall_tau_partial_credit():
    _public, answer = _split("sq_pbq_701_0001")
    key = _task_key(answer, "t1")
    order = key["solution"]["order"]
    assert score_task(key, list(order)) == 1.0
    swapped = list(order)
    swapped[3], swapped[4] = swapped[4], swapped[3]
    assert score_task(key, swapped) == pytest.approx(19 / 21)
    assert score_task(key, list(reversed(order))) == 0.0  # tau = -1 clipped at 0
    per_position = dict(key, scoring={"method": "per_position"})
    assert score_task(per_position, swapped) == pytest.approx(5 / 7)
    exact = dict(key, scoring={"method": "exact"})
    assert score_task(exact, swapped) == 0.0 and score_task(exact, list(order)) == 1.0


def test_categorization_per_item_and_exact():
    _public, answer = _split("sq_pbq_701_0003")
    key = _task_key(answer, "t1")
    response = dict(key["solution"]["assignment"])
    assert score_task(key, response) == 1.0
    response["k2"] = "prev"
    response["k6"] = "prev"
    assert score_task(key, response) == pytest.approx(6 / 8)
    del response["k7"]  # unanswered item counts as wrong
    assert score_task(key, response) == pytest.approx(5 / 8)
    assert score_task(dict(key, scoring={"method": "exact"}), response) == 0.0


def test_matching_per_pair():
    _public, answer = _split("sq_pbq_701_0004")
    key = _task_key(answer, "t1")
    response = dict(key["solution"]["pairs"])
    assert score_task(key, response) == 1.0
    response["i3"] = "a_brute"
    assert score_task(key, response) == pytest.approx(5 / 6)


def test_table_form_per_cell_with_numbers_and_selects():
    public, answer = _split("sq_pbq_701_0006")
    key = _task_key(answer, "t1")
    response = {
        "sle": {"val": "30.000"},          # pt-BR thousands separator
        "ale0": {"val": "US$ 15,000"},     # en thousands separator + currency
        "ale1": {"val": 3000},             # JSON number
        "net": {"val": "2999"},            # tolerance 0 -> wrong
        "dec": {"val": "Implementar: o controle se paga"},
    }
    clean = sanitize_response(public, {"t1": response})
    assert score_task(key, clean["t1"]) == pytest.approx(4 / 5)
    assert score_task(dict(key, scoring={"method": "exact"}), clean["t1"]) == 0.0

    public, answer = _split("sq_pbq_701_0002")
    key = _task_key(answer, "t1")
    response = {
        "r1": {"dst": "10.10.20.10", "svc": "TCP 443", "act": "ALLOW"},
        "r2": {"src": "10.10.0.0/16", "svc": "TCP 22"},  # src too broad
        "r3": {"src": "10.10.20.10", "dst": "10.10.30.5"},  # svc missing
        "r4": {"act": "DENY"},
    }
    clean = sanitize_response(public, {"t1": response})
    assert score_task(key, clean["t1"]) == pytest.approx(7 / 9)


def test_parse_number_formats():
    assert parse_number("30.000") == 30000
    assert parse_number("30,000") == 30000
    assert parse_number("3.000,50") == 3000.5
    assert parse_number("0,25") == 0.25
    assert parse_number("R$ 1.234.567") == 1234567
    assert parse_number("abc") is None
    assert parse_number(True) is None


def test_select_in_exhibit_tp_minus_fp_and_per_line():
    public, answer = _split("sq_pbq_701_0005")
    key = _task_key(answer, "t1")
    lines = [line["id"] for line in public["exhibits"][0]["lines"]]
    assert score_task(key, ["l05", "l06", "l07", "l09"]) == 1.0
    assert score_task(key, ["l05", "l06", "l07", "l08"]) == pytest.approx((3 - 1) / 4)
    assert score_task(key, ["l01", "l02", "l03", "l05"]) == 0.0  # 1 TP - 3 FP clipped
    assert score_task(key, []) == 0.0
    per_line = dict(key, scoring={"method": "per_line"})
    assert score_task(per_line, ["l05", "l06", "l07", "l08"], selectable=lines) == pytest.approx(8 / 10)
    assert score_task(dict(key, scoring={"method": "exact"}), ["l05", "l06", "l07"]) == 0.0


def test_weighted_mean_aggregate_points_and_threshold():
    public, answer = _split("sq_pbq_701_0001")
    solutions, explanations, per_item = solutions_and_explanations(answer)
    graded = grade_response(public, answer, sanitize_response(public, {"t1": solutions["t1"]}))
    assert graded["score"] == pytest.approx(round(2 / 3, 4))  # t1 weight 2 right, t2 weight 1 missing
    assert graded["is_correct"] is False
    assert graded["points_possible"] == 3.0 and graded["points_earned"] == pytest.approx(2.0)
    assert [r["task_id"] for r in graded["task_results"]] == ["t1", "t2"]
    assert graded["task_results"][0]["is_correct"] is True and graded["task_results"][1]["score"] == 0.0
    full = grade_response(public, answer, sanitize_response(public, solutions))
    assert full["score"] == 1.0 and full["is_correct"] is True
    assert explanations["t1"] and per_item["t1"]["a9d"].startswith("Preparation")


# --------------------------------------------------------------------------- responses

def test_sanitize_rejects_invalid_responses():
    public, _answer = _split("sq_pbq_701_0004")
    with pytest.raises(PBQError):
        sanitize_response(public, None)
    with pytest.raises(PBQError):
        sanitize_response(public, {"t9": {}})
    with pytest.raises(PBQError):
        sanitize_response(public, {"t1": {"i1": "a_nope"}})
    with pytest.raises(PBQError):
        sanitize_response(public, {"t1": {"i1": "a_sqli", "i2": "a_sqli"}})  # allow_reuse false
    assert sanitize_response(public, {"t1": {"i1": "a_sqli", "i2": None}}) == {"t1": {"i1": "a_sqli"}}

    public, _answer = _split("sq_pbq_701_0001")
    with pytest.raises(PBQError):
        sanitize_response(public, {"t1": ["a9d", "c3h"]})  # incomplete order
    public, _answer = _split("sq_pbq_701_0002")
    with pytest.raises(PBQError):
        sanitize_response(public, {"t1": {"r1": {"src": "ANY"}}})  # not editable
    with pytest.raises(PBQError):
        sanitize_response(public, {"t1": {"r1": {"dst": "8.8.8.8"}}})  # not a choice
    with pytest.raises(PBQError):
        sanitize_response(public, {"t2": ["c1", "c1"]})
    with pytest.raises(PBQError):
        sanitize_response(public, {"t2": ["l01"]})


# --------------------------------------------------------------------------- shuffle

def test_session_order_is_a_permutation_and_never_the_solution_for_ordering():
    public, answer = _split("sq_pbq_701_0001")
    for seed in range(30):
        order = build_session_order(public, random.Random(seed))
        for task in public["tasks"]:
            ids = [item["id"] for item in task["items"]]
            assert sorted(order[task["id"]]) == sorted(ids)
            assert order[task["id"]] != ids
        rendered = render_public_payload(public, order)
        assert [i["id"] for i in rendered["tasks"][0]["items"]] == order["t1"]


def test_session_order_covers_categorization_items_and_matching_right_side():
    public, _answer = _split("sq_pbq_701_0004")
    order = build_session_order(public, random.Random(7))
    rendered = render_public_payload(public, order)
    assert [r["id"] for r in rendered["tasks"][0]["right"]] == order["t1"]
    assert [left["id"] for left in rendered["tasks"][0]["left"]] == [left["id"] for left in public["tasks"][0]["left"]]
    public, _answer = _split("sq_pbq_701_0003")
    order = build_session_order(public, random.Random(3))
    assert set(order) == {"t1", "t2"}
    # a stale order (items changed since) falls back to the authored order
    rendered = render_public_payload(public, {"t1": ["k1", "k2"]})
    assert [i["id"] for i in rendered["tasks"][0]["items"]] == [i["id"] for i in public["tasks"][0]["items"]]
