"""Performance-based questions (PBQ): authoring format, validation and grading.

Pure Python (stdlib only, no database access) so that ``scripts/validate_content.py``
can import it as well.

Authoring format (``questions/pbq_*.json``, one item per question, see
``questions/pbq_securityplus.json``)::

    {"id", "question_format": "pbq", "certification", "domain", "difficulty",
     "objective_codes": [...], "points", "title", "scenario", "exhibits": [...],
     "tasks": [{"id", "type", "weight", "prompt", <public fields>,
                "solution", "scoring": {"method"}, "explanation": {"summary", "per_item"}}],
     "scoring": {"aggregate": "weighted_mean", "correct_threshold": 1.0},
     "explanation", "references": [...]}

At ingest the item is split (:func:`split_authoring_item`) into

* the **public payload** (``Question.pbq_payload_json``): title, scenario, exhibits and
  tasks *without* solution/scoring/explanation - safe to send to the learner;
* the **answer key** (``Question.pbq_answer_json``): per-task solution, scoring method
  and explanations, the aggregate rule and the item points - never sent before the
  answer is graded (and never in exam_day mode before the exam is completed).

Task types and their scoring methods (partial credit, every task score is in 0..1):

``ordering``           response ``[item_id, ...]`` (every item exactly once)
    ``kendall_tau_clipped`` max(0, Kendall tau) = (concordant - discordant pairs) / pairs,
                            clipped at 0 - an adjacent swap of 7 items still earns 0.905;
    ``per_position``        share of items in their correct position;
    ``exact``               1 only for the exact order.
``categorization``     response ``{item_id: bucket_id}``
    ``per_item``            share of items placed in the correct bucket; ``exact``.
``matching``           response ``{left_id: right_id}`` (a right item used at most once
                       unless ``allow_reuse``)
    ``per_pair``            share of left items paired correctly; ``exact``.
``table_form``         response ``{row_id: {column_id: value}}`` (editable cells only)
    ``per_cell``            share of solution cells answered correctly; ``exact``.
                            A cell solution is ``{"accepted": [...]}`` (text compared
                            case/whitespace-insensitively) or ``{"number": n,
                            "tolerance": t}`` (pt-BR/en number formats accepted).
``select_in_exhibit``  response ``[line_or_row_id, ...]`` from the referenced exhibit
    ``tp_minus_fp``         max(0, (true positives - false positives) / |solution|);
    ``per_line``            share of exhibit lines classified correctly (selected or not);
    ``exact``               1 only for exactly the solution set.

Item score = weighted mean of the task scores (``weight`` > 0). The item is correct
when score >= ``correct_threshold`` (1.0: every task fully right).
"""
from __future__ import annotations

import json
import math
import random
import re
import unicodedata
from typing import Any, Iterable, Optional

TASK_TYPES = ("ordering", "categorization", "matching", "table_form", "select_in_exhibit")
SCORING_METHODS: dict[str, tuple[str, ...]] = {
    "ordering": ("kendall_tau_clipped", "per_position", "exact"),
    "categorization": ("per_item", "exact"),
    "matching": ("per_pair", "exact"),
    "table_form": ("per_cell", "exact"),
    "select_in_exhibit": ("tp_minus_fp", "per_line", "exact"),
}
DEFAULT_SCORING = {
    "ordering": "kendall_tau_clipped",
    "categorization": "per_item",
    "matching": "per_pair",
    "table_form": "per_cell",
    "select_in_exhibit": "tp_minus_fp",
}
EXHIBIT_TYPES = ("log", "table", "text")
AGGREGATES = ("weighted_mean",)
MAX_PBQ_COUNT = 5
SCORE_EPSILON = 1e-9


class PBQError(ValueError):
    """Invalid PBQ authoring item or learner response (maps to HTTP 400)."""


# --------------------------------------------------------------------------- helpers

def _text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def _id(value: Any) -> str:
    return _text(value)


def _ids(entries: Any) -> list[str]:
    return [_id(item.get("id")) for item in (entries or []) if isinstance(item, dict)]


def normalize_cell_text(value: Any) -> str:
    """Case/whitespace/accent-insensitive form used to compare text cells."""
    text = unicodedata.normalize("NFKD", _text(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text).casefold()


_THOUSANDS_DOT = re.compile(r"^-?\d{1,3}(\.\d{3})+$")
_THOUSANDS_COMMA = re.compile(r"^-?\d{1,3}(,\d{3})+$")


def parse_number(value: Any) -> Optional[float]:
    """Parse ``30000``, ``30.000`` (pt-BR), ``30,000`` (en), ``US$ 3.000,50``..."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    text = _text(value)
    if not text:
        return None
    text = re.sub(r"(?i)(us\$|r\$|\$|usd|brl)", "", text).replace(" ", "").replace(" ", "")
    if "." in text and "," in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif _THOUSANDS_DOT.match(text):
        text = text.replace(".", "")
    elif _THOUSANDS_COMMA.match(text):
        text = text.replace(",", "")
    else:
        text = text.replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _round(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 4)


# --------------------------------------------------------------------------- authoring -> public / answer

def _public_exhibit(raw: dict[str, Any]) -> dict[str, Any]:
    kind = _text(raw.get("type") or raw.get("kind")).lower() or "text"
    exhibit: dict[str, Any] = {"id": _id(raw.get("id")), "type": kind, "title": _text(raw.get("title"))}
    if kind == "log":
        lines = raw.get("lines") if raw.get("lines") is not None else raw.get("rows")
        exhibit["lines"] = [{"id": _id(item.get("id")), "text": _text(item.get("text"))} for item in lines or [] if isinstance(item, dict)]
    elif kind == "table":
        exhibit["columns"] = [_text(col.get("label") if isinstance(col, dict) else col) for col in raw.get("columns") or []]
        exhibit["rows"] = [
            {"id": _id(row.get("id")), "cells": [_text(cell) for cell in row.get("cells") or []]}
            for row in raw.get("rows") or []
            if isinstance(row, dict)
        ]
    else:
        exhibit["content"] = _text(raw.get("content"))
    return exhibit


def _cell_input_type(column: dict[str, Any], cell: dict[str, Any]) -> str:
    declared = _text(cell.get("input_type") or cell.get("input") or column.get("input_type") or column.get("input")).lower()
    if declared == "select":
        return "select"
    return "text"  # "number", "text", "number_or_select" without choices


def _public_table_form(task: dict[str, Any]) -> dict[str, Any]:
    columns = [col for col in task.get("columns") or [] if isinstance(col, dict)]
    column_map = {_id(col.get("id")): col for col in columns}
    rows: list[dict[str, Any]] = []
    for row in task.get("rows") or []:
        if not isinstance(row, dict):
            continue
        cells: dict[str, Any] = {}
        for column_id, column in column_map.items():
            cell = (row.get("cells") or {}).get(column_id)
            if not isinstance(cell, dict):
                cells[column_id] = {"editable": False, "value": ""}
                continue
            if not cell.get("editable"):
                cells[column_id] = {"editable": False, "value": _text(cell.get("value"))}
                continue
            choices = cell.get("choices") if cell.get("choices") is not None else column.get("choices")
            choices = [_text(choice) for choice in choices] if isinstance(choices, list) else None
            declared = _text(cell.get("input_type") or cell.get("input") or column.get("input_type") or column.get("input")).lower()
            input_type = "select" if choices and declared in {"select", "number_or_select", ""} else _cell_input_type(column, cell)
            rendered: dict[str, Any] = {"editable": True, "input_type": input_type}
            if input_type == "select":
                rendered["choices"] = choices or []
            elif declared == "number":
                rendered["numeric"] = True
            cells[column_id] = rendered
        rows.append({"id": _id(row.get("id")), "label": _text(row.get("label")), "cells": cells})
    return {
        "columns": [{"id": _id(col.get("id")), "label": _text(col.get("label"))} for col in columns],
        "rows": rows,
    }


def _select_mode(task: dict[str, Any]) -> str:
    declared = _text(task.get("select_mode")).lower()
    if declared in {"single", "multiple"}:
        return declared
    selected = (task.get("solution") or {}).get("selected") or []
    method = _text((task.get("scoring") or {}).get("method")) or DEFAULT_SCORING["select_in_exhibit"]
    return "single" if len(selected) == 1 and method == "exact" else "multiple"


def _public_task(task: dict[str, Any]) -> dict[str, Any]:
    task_type = _text(task.get("type"))
    public: dict[str, Any] = {
        "id": _id(task.get("id")),
        "type": task_type,
        "prompt": _text(task.get("prompt")),
        "weight": float(task.get("weight") if task.get("weight") is not None else 1),
    }
    if task_type == "ordering":
        public["items"] = [{"id": _id(i.get("id")), "text": _text(i.get("text"))} for i in task.get("items") or [] if isinstance(i, dict)]
    elif task_type == "categorization":
        public["items"] = [{"id": _id(i.get("id")), "text": _text(i.get("text"))} for i in task.get("items") or [] if isinstance(i, dict)]
        public["buckets"] = [{"id": _id(b.get("id")), "label": _text(b.get("label") or b.get("text"))} for b in task.get("buckets") or [] if isinstance(b, dict)]
    elif task_type == "matching":
        public["left"] = [{"id": _id(i.get("id")), "text": _text(i.get("text"))} for i in task.get("left") or [] if isinstance(i, dict)]
        public["right"] = [{"id": _id(i.get("id")), "text": _text(i.get("text"))} for i in task.get("right") or [] if isinstance(i, dict)]
        public["allow_reuse"] = bool(task.get("allow_reuse"))
    elif task_type == "table_form":
        public.update(_public_table_form(task))
    elif task_type == "select_in_exhibit":
        public["exhibit_id"] = _id(task.get("exhibit_id"))
        public["select_mode"] = _select_mode(task)
    return public


def _answer_task(task: dict[str, Any]) -> dict[str, Any]:
    task_type = _text(task.get("type"))
    explanation = task.get("explanation")
    if isinstance(explanation, str):
        explanation = {"summary": explanation, "per_item": {}}
    elif not isinstance(explanation, dict):
        explanation = {"summary": "", "per_item": {}}
    scoring = dict(task.get("scoring") or {})
    scoring["method"] = _text(scoring.get("method")) or DEFAULT_SCORING.get(task_type, "exact")
    return {
        "type": task_type,
        "weight": float(task.get("weight") if task.get("weight") is not None else 1),
        "scoring": scoring,
        "solution": task.get("solution") or {},
        "explanation": {
            "summary": _text(explanation.get("summary")),
            "per_item": {str(k): _text(v) for k, v in (explanation.get("per_item") or {}).items()},
        },
    }


def split_authoring_item(raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """``(public_payload, answer_key)`` of an authoring item (validate it first)."""
    tasks = [task for task in raw.get("tasks") or [] if isinstance(task, dict)]
    scoring = raw.get("scoring") if isinstance(raw.get("scoring"), dict) else {}
    public = {
        "title": _text(raw.get("title")),
        "scenario": _text(raw.get("scenario")),
        "exhibits": [_public_exhibit(ex) for ex in raw.get("exhibits") or [] if isinstance(ex, dict)],
        "tasks": [_public_task(task) for task in tasks],
    }
    answer = {
        "points": float(raw.get("points") if raw.get("points") is not None else 1),
        "aggregate": _text(scoring.get("aggregate")) or "weighted_mean",
        "correct_threshold": float(scoring.get("correct_threshold") if scoring.get("correct_threshold") is not None else 1.0),
        "explanation": _text(raw.get("explanation")),
        "tasks": {_id(task.get("id")): _answer_task(task) for task in tasks},
    }
    return public, answer


# --------------------------------------------------------------------------- authoring validation

def _check_unique(errors: list[str], where: str, ids: list[str], label: str) -> None:
    if any(not item for item in ids):
        errors.append(f"{where}: every {label} needs a non-empty id")
    duplicates = sorted({item for item in ids if item and ids.count(item) > 1})
    if duplicates:
        errors.append(f"{where}: duplicate {label} ids {duplicates}")


def _validate_cell_solution(errors: list[str], where: str, spec: Any, public_cell: dict[str, Any] | None) -> None:
    if not isinstance(spec, dict):
        errors.append(f"{where}: cell solution must be an object")
        return
    if public_cell is None or not public_cell.get("editable"):
        errors.append(f"{where}: solution targets a cell that is not editable")
        return
    if "number" in spec:
        if parse_number(spec.get("number")) is None:
            errors.append(f"{where}: 'number' must be numeric")
        tolerance = spec.get("tolerance", 0)
        if parse_number(tolerance) is None or parse_number(tolerance) < 0:
            errors.append(f"{where}: 'tolerance' must be a number >= 0")
        if public_cell.get("input_type") == "select":
            errors.append(f"{where}: numeric solution on a select cell")
        return
    accepted = spec.get("accepted")
    if not isinstance(accepted, list) or not [a for a in accepted if _text(a)]:
        errors.append(f"{where}: cell solution needs 'accepted' (non-empty list) or 'number'")
        return
    if public_cell.get("input_type") == "select":
        choices = {normalize_cell_text(choice) for choice in public_cell.get("choices") or []}
        missing = [a for a in accepted if normalize_cell_text(a) not in choices]
        if missing:
            errors.append(f"{where}: accepted values {missing} are not among the select choices")


def validate_authoring_item(raw: Any, *, where: str = "pbq") -> list[str]:
    """Structural errors of an authoring PBQ item (empty list = valid)."""
    errors: list[str] = []
    if not isinstance(raw, dict):
        return [f"{where}: item must be an object"]
    if _text(raw.get("question_format")) != "pbq":
        errors.append(f"{where}: question_format must be 'pbq'")
    for key in ("id", "title", "scenario"):
        if not _text(raw.get(key)):
            errors.append(f"{where}: '{key}' is required")
    points = raw.get("points", 1)
    if not isinstance(points, (int, float)) or isinstance(points, bool) or points <= 0:
        errors.append(f"{where}: 'points' must be a number > 0")
    scoring = raw.get("scoring") or {}
    if not isinstance(scoring, dict):
        errors.append(f"{where}: 'scoring' must be an object")
        scoring = {}
    if _text(scoring.get("aggregate") or "weighted_mean") not in AGGREGATES:
        errors.append(f"{where}: unknown aggregate {scoring.get('aggregate')!r} (allowed: {list(AGGREGATES)})")
    threshold = scoring.get("correct_threshold", 1.0)
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not 0 < threshold <= 1:
        errors.append(f"{where}: correct_threshold must be in (0, 1]")

    exhibits = [ex for ex in raw.get("exhibits") or [] if isinstance(ex, dict)]
    if not isinstance(raw.get("exhibits", []), list):
        errors.append(f"{where}: 'exhibits' must be a list")
    _check_unique(errors, where, _ids(exhibits), "exhibit")
    public_exhibits = {}
    for exhibit in exhibits:
        rendered = _public_exhibit(exhibit)
        public_exhibits[rendered["id"]] = rendered
        ex_where = f"{where}:exhibit {rendered['id']}"
        if rendered["type"] not in EXHIBIT_TYPES:
            errors.append(f"{ex_where}: type must be one of {list(EXHIBIT_TYPES)}")
        if rendered["type"] == "log":
            if not rendered["lines"]:
                errors.append(f"{ex_where}: log exhibit needs lines")
            _check_unique(errors, ex_where, [line["id"] for line in rendered["lines"]], "line")
        elif rendered["type"] == "table":
            if not rendered["columns"] or not rendered["rows"]:
                errors.append(f"{ex_where}: table exhibit needs columns and rows")
            _check_unique(errors, ex_where, [row["id"] for row in rendered["rows"]], "row")
            for row in rendered["rows"]:
                if len(row["cells"]) != len(rendered["columns"]):
                    errors.append(f"{ex_where}: row {row['id']} has {len(row['cells'])} cells for {len(rendered['columns'])} columns")
        elif not rendered.get("content"):
            errors.append(f"{ex_where}: text exhibit needs content")

    tasks = raw.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        errors.append(f"{where}: at least one task is required")
        return errors
    _check_unique(errors, where, _ids(tasks), "task")
    for task in tasks:
        if not isinstance(task, dict):
            errors.append(f"{where}: task must be an object")
            continue
        errors.extend(_validate_task(task, f"{where}:task {_id(task.get('id'))}", public_exhibits))
    return errors


def _validate_task(task: dict[str, Any], where: str, exhibits: dict[str, dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    task_type = _text(task.get("type"))
    if task_type not in TASK_TYPES:
        return [f"{where}: type must be one of {list(TASK_TYPES)} (got {task_type!r})"]
    weight = task.get("weight", 1)
    if not isinstance(weight, (int, float)) or isinstance(weight, bool) or weight <= 0:
        errors.append(f"{where}: weight must be a number > 0")
    if not _text(task.get("prompt")):
        errors.append(f"{where}: prompt is required")
    method = _text((task.get("scoring") or {}).get("method")) or DEFAULT_SCORING[task_type]
    if method not in SCORING_METHODS[task_type]:
        errors.append(f"{where}: scoring method {method!r} not valid for {task_type} (allowed: {list(SCORING_METHODS[task_type])})")
    explanation = task.get("explanation")
    summary = explanation.get("summary") if isinstance(explanation, dict) else explanation
    if not _text(summary):
        errors.append(f"{where}: explanation.summary is required")
    solution = task.get("solution")
    if not isinstance(solution, dict):
        return errors + [f"{where}: solution is required"]

    if task_type == "ordering":
        items = _ids(task.get("items"))
        _check_unique(errors, where, items, "item")
        if len(items) < 2:
            errors.append(f"{where}: ordering needs at least 2 items")
        order = [_id(x) for x in solution.get("order") or []]
        if sorted(order) != sorted(items) or len(set(order)) != len(order):
            errors.append(f"{where}: solution.order must be a permutation of the item ids")
    elif task_type == "categorization":
        items = _ids(task.get("items"))
        buckets = _ids(task.get("buckets"))
        _check_unique(errors, where, items, "item")
        _check_unique(errors, where, buckets, "bucket")
        if not items or len(buckets) < 2:
            errors.append(f"{where}: categorization needs items and at least 2 buckets")
        assignment = solution.get("assignment") or {}
        if not isinstance(assignment, dict) or set(map(str, assignment)) != set(items):
            errors.append(f"{where}: solution.assignment must map every item id (and only them)")
        else:
            wrong = sorted(k for k, v in assignment.items() if _id(v) not in buckets)
            if wrong:
                errors.append(f"{where}: solution.assignment uses unknown buckets for {wrong}")
    elif task_type == "matching":
        left = _ids(task.get("left"))
        right = _ids(task.get("right"))
        _check_unique(errors, where, left, "left")
        _check_unique(errors, where, right, "right")
        if not left or not right:
            errors.append(f"{where}: matching needs left and right items")
        pairs = solution.get("pairs") or {}
        if not isinstance(pairs, dict) or set(map(str, pairs)) != set(left):
            errors.append(f"{where}: solution.pairs must map every left id (and only them)")
        else:
            unknown = sorted(k for k, v in pairs.items() if _id(v) not in right)
            if unknown:
                errors.append(f"{where}: solution.pairs uses unknown right ids for {unknown}")
            used = [_id(v) for v in pairs.values()]
            if not task.get("allow_reuse") and len(set(used)) != len(used):
                errors.append(f"{where}: solution reuses a right item but allow_reuse is false")
            if not task.get("allow_reuse") and len(right) < len(left):
                errors.append(f"{where}: fewer right items than left items without allow_reuse")
    elif task_type == "table_form":
        public = _public_table_form(task)
        column_ids = [col["id"] for col in public["columns"]]
        row_ids = [row["id"] for row in public["rows"]]
        _check_unique(errors, where, column_ids, "column")
        _check_unique(errors, where, row_ids, "row")
        rows = {row["id"]: row for row in public["rows"]}
        editable = {(r["id"], c) for r in public["rows"] for c, cell in r["cells"].items() if cell.get("editable")}
        if not editable:
            errors.append(f"{where}: table_form needs at least one editable cell")
        cells = solution.get("cells") or {}
        if not isinstance(cells, dict):
            errors.append(f"{where}: solution.cells must be an object")
            cells = {}
        solved = set()
        for row_id, row_spec in cells.items():
            if row_id not in rows or not isinstance(row_spec, dict):
                errors.append(f"{where}: solution row {row_id!r} is not a table row")
                continue
            for column_id, spec in row_spec.items():
                solved.add((row_id, column_id))
                _validate_cell_solution(errors, f"{where}:{row_id}.{column_id}", spec, rows[row_id]["cells"].get(column_id))
        missing = sorted(f"{r}.{c}" for r, c in editable - solved)
        if missing:
            errors.append(f"{where}: editable cells without solution {missing}")
    elif task_type == "select_in_exhibit":
        exhibit = exhibits.get(_id(task.get("exhibit_id")))
        if exhibit is None:
            errors.append(f"{where}: exhibit_id {task.get('exhibit_id')!r} not found")
            return errors
        if exhibit["type"] == "log":
            selectable = [line["id"] for line in exhibit["lines"]]
        elif exhibit["type"] == "table":
            selectable = [row["id"] for row in exhibit["rows"]]
        else:
            errors.append(f"{where}: select_in_exhibit needs a log or table exhibit")
            return errors
        selected = [_id(x) for x in solution.get("selected") or []]
        if not selected:
            errors.append(f"{where}: solution.selected must not be empty")
        unknown = sorted(set(selected) - set(selectable))
        if unknown:
            errors.append(f"{where}: solution.selected has ids not in the exhibit {unknown}")
        if len(set(selected)) != len(selected):
            errors.append(f"{where}: duplicate ids in solution.selected")
        if _select_mode(task) == "single" and len(selected) != 1:
            errors.append(f"{where}: select_mode single needs exactly one selected id")
    return errors


# --------------------------------------------------------------------------- per-session shuffle

def build_session_order(public: dict[str, Any], rng: Optional[random.Random] = None) -> dict[str, list[str]]:
    """Random display order of ordering items, categorization items and matching right side.

    Ordering items never keep the authored order when it could be the solution.
    """
    generator = rng or random.SystemRandom()
    order: dict[str, list[str]] = {}
    for task in public.get("tasks") or []:
        task_type = task.get("type")
        if task_type in {"ordering", "categorization"}:
            ids = [item["id"] for item in task.get("items") or []]
        elif task_type == "matching":
            ids = [item["id"] for item in task.get("right") or []]
        else:
            continue
        if len(ids) < 2:
            continue
        shuffled = list(ids)
        for _attempt in range(8):
            generator.shuffle(shuffled)
            if shuffled != ids:
                break
        order[task["id"]] = shuffled
    return order


def serialize_session_order(order: dict[str, list[str]]) -> Optional[str]:
    return json.dumps(order, ensure_ascii=True, sort_keys=True) if order else None


def parse_json_object(raw: Optional[str]) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _apply_order(entries: list[dict[str, Any]], wanted: Optional[list[str]]) -> list[dict[str, Any]]:
    if not wanted:
        return list(entries)
    by_id = {entry["id"]: entry for entry in entries}
    if sorted(by_id) != sorted(wanted):
        return list(entries)  # stale order (items edited): fall back to the authored order
    return [by_id[item] for item in wanted]


def render_public_payload(public: dict[str, Any], order: Optional[dict[str, list[str]]] = None) -> dict[str, Any]:
    """Public payload with this session's shuffle applied (never contains solutions)."""
    order = order or {}
    tasks = []
    for task in public.get("tasks") or []:
        rendered = dict(task)
        if task.get("type") in {"ordering", "categorization"}:
            rendered["items"] = _apply_order(task.get("items") or [], order.get(task["id"]))
        elif task.get("type") == "matching":
            rendered["right"] = _apply_order(task.get("right") or [], order.get(task["id"]))
        tasks.append(rendered)
    return {
        "title": public.get("title") or "",
        "scenario": public.get("scenario") or "",
        "exhibits": list(public.get("exhibits") or []),
        "tasks": tasks,
    }


# --------------------------------------------------------------------------- responses

def _exhibit_selectable(public: dict[str, Any], exhibit_id: str) -> list[str]:
    for exhibit in public.get("exhibits") or []:
        if exhibit.get("id") != exhibit_id:
            continue
        if exhibit.get("type") == "log":
            return [line["id"] for line in exhibit.get("lines") or []]
        if exhibit.get("type") == "table":
            return [row["id"] for row in exhibit.get("rows") or []]
    return []


def _as_id_list(value: Any, where: str) -> list[str]:
    if not isinstance(value, list):
        raise PBQError(f"{where}: expected a list of ids.")
    return [_id(item) for item in value]


def _as_mapping(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PBQError(f"{where}: expected an object.")
    return {str(key): item for key, item in value.items()}


def sanitize_response(public: dict[str, Any], response: Any) -> dict[str, Any]:
    """Validate a learner response against the public payload (raises :class:`PBQError`).

    Tasks may be left out (partial answer, graded 0). Unknown task/item ids, duplicate
    ids and invalid values are rejected.
    """
    if response is None:
        raise PBQError("pbq_response is required for performance-based questions.")
    if not isinstance(response, dict):
        raise PBQError("pbq_response must be an object keyed by task id.")
    tasks = {task["id"]: task for task in public.get("tasks") or []}
    unknown_tasks = sorted(set(map(str, response)) - set(tasks))
    if unknown_tasks:
        raise PBQError(f"Unknown task id(s): {', '.join(unknown_tasks)}")
    clean: dict[str, Any] = {}
    for task_id, value in response.items():
        task_id = str(task_id)
        task = tasks[task_id]
        task_type = task["type"]
        where = f"task {task_id}"
        if value is None:
            continue
        if task_type == "ordering":
            ids = _as_id_list(value, where)
            items = [item["id"] for item in task.get("items") or []]
            if sorted(ids) != sorted(items):
                raise PBQError(f"{where}: the order must contain every item exactly once.")
            clean[task_id] = ids
        elif task_type in {"categorization", "matching"}:
            mapping = _as_mapping(value, where)
            keys = [item["id"] for item in (task.get("items") if task_type == "categorization" else task.get("left")) or []]
            targets = (
                [b["id"] for b in task.get("buckets") or []]
                if task_type == "categorization"
                else [r["id"] for r in task.get("right") or []]
            )
            unknown = sorted(set(mapping) - set(keys))
            if unknown:
                raise PBQError(f"{where}: unknown item id(s) {', '.join(unknown)}")
            entry: dict[str, str] = {}
            for key, target in mapping.items():
                if target is None or _id(target) == "":
                    continue
                if _id(target) not in targets:
                    raise PBQError(f"{where}: unknown target id {_id(target)!r}")
                entry[key] = _id(target)
            if task_type == "matching" and not task.get("allow_reuse"):
                used = list(entry.values())
                if len(set(used)) != len(used):
                    raise PBQError(f"{where}: each right-side item can be used only once.")
            clean[task_id] = entry
        elif task_type == "table_form":
            mapping = _as_mapping(value, where)
            rows = {row["id"]: row for row in task.get("rows") or []}
            entry = {}
            for row_id, row_value in mapping.items():
                if row_id not in rows:
                    raise PBQError(f"{where}: unknown row id {row_id!r}")
                row_map = _as_mapping(row_value, f"{where}.{row_id}")
                cells: dict[str, str] = {}
                for column_id, cell_value in row_map.items():
                    cell = rows[row_id]["cells"].get(column_id)
                    if cell is None or not cell.get("editable"):
                        raise PBQError(f"{where}: cell {row_id}.{column_id} is not editable")
                    if cell_value is None:
                        continue
                    if isinstance(cell_value, (dict, list)):
                        raise PBQError(f"{where}: cell {row_id}.{column_id} must be a string or number")
                    text = _text(cell_value)[:200]
                    if cell.get("input_type") == "select" and text and text not in (cell.get("choices") or []):
                        raise PBQError(f"{where}: {text!r} is not a choice of cell {row_id}.{column_id}")
                    cells[column_id] = text
                entry[row_id] = cells
            clean[task_id] = entry
        elif task_type == "select_in_exhibit":
            ids = _as_id_list(value, where)
            selectable = _exhibit_selectable(public, task.get("exhibit_id"))
            unknown = sorted(set(ids) - set(selectable))
            if unknown:
                raise PBQError(f"{where}: unknown line id(s) {', '.join(unknown)}")
            if len(set(ids)) != len(ids):
                raise PBQError(f"{where}: duplicate line ids")
            if task.get("select_mode") == "single" and len(ids) > 1:
                raise PBQError(f"{where}: select a single line.")
            clean[task_id] = ids
    return clean


# --------------------------------------------------------------------------- scoring

def _kendall_tau_clipped(response: list[str], solution: list[str]) -> float:
    n = len(solution)
    if n < 2:
        return 1.0 if response == solution else 0.0
    rank = {item: index for index, item in enumerate(solution)}
    ranks = [rank[item] for item in response if item in rank]
    if len(ranks) != n:
        return 0.0
    concordant = discordant = 0
    for i in range(n):
        for j in range(i + 1, n):
            if ranks[i] < ranks[j]:
                concordant += 1
            else:
                discordant += 1
    total = n * (n - 1) / 2
    return max(0.0, (concordant - discordant) / total)


def _cell_is_correct(value: Any, spec: dict[str, Any]) -> bool:
    if value is None or _text(value) == "":
        return False
    if "number" in spec:
        number = parse_number(value)
        target = parse_number(spec.get("number"))
        tolerance = parse_number(spec.get("tolerance", 0)) or 0.0
        return number is not None and target is not None and abs(number - target) <= tolerance + 1e-9
    accepted = {normalize_cell_text(item) for item in spec.get("accepted") or []}
    return normalize_cell_text(value) in accepted


def score_task(answer_task: dict[str, Any], response: Any, *, selectable: Iterable[str] = ()) -> float:
    """Score (0..1) of one task given its answer key and the sanitized response."""
    task_type = answer_task.get("type")
    method = (answer_task.get("scoring") or {}).get("method") or DEFAULT_SCORING.get(task_type, "exact")
    solution = answer_task.get("solution") or {}
    if response is None:
        return 0.0

    if task_type == "ordering":
        order = [_id(x) for x in solution.get("order") or []]
        given = list(response)
        if method == "exact":
            return 1.0 if given == order else 0.0
        if method == "per_position":
            return sum(1 for a, b in zip(given, order) if a == b) / len(order) if order else 0.0
        return _kendall_tau_clipped(given, order)

    if task_type in {"categorization", "matching"}:
        expected = {str(k): _id(v) for k, v in (solution.get("assignment") or solution.get("pairs") or {}).items()}
        if not expected:
            return 0.0
        hits = sum(1 for key, target in expected.items() if response.get(key) == target)
        if method == "exact":
            return 1.0 if hits == len(expected) else 0.0
        return hits / len(expected)

    if task_type == "table_form":
        specs = [
            (row_id, column_id, spec)
            for row_id, row_spec in (solution.get("cells") or {}).items()
            for column_id, spec in row_spec.items()
        ]
        if not specs:
            return 0.0
        hits = sum(1 for row_id, column_id, spec in specs if _cell_is_correct((response.get(row_id) or {}).get(column_id), spec))
        if method == "exact":
            return 1.0 if hits == len(specs) else 0.0
        return hits / len(specs)

    if task_type == "select_in_exhibit":
        expected = {_id(x) for x in solution.get("selected") or []}
        given = set(response)
        if not expected:
            return 0.0
        if method == "exact":
            return 1.0 if given == expected else 0.0
        if method == "per_line":
            universe = set(selectable) | expected | given
            return sum(1 for line in universe if (line in expected) == (line in given)) / len(universe)
        true_positives = len(given & expected)
        false_positives = len(given - expected)
        return max(0.0, (true_positives - false_positives) / len(expected))

    return 0.0


def solution_for_display(answer_task: dict[str, Any]) -> Any:
    """Solution in the same shape as a response (what the learner should have sent)."""
    task_type = answer_task.get("type")
    solution = answer_task.get("solution") or {}
    if task_type == "ordering":
        return [_id(x) for x in solution.get("order") or []]
    if task_type == "categorization":
        return {str(k): _id(v) for k, v in (solution.get("assignment") or {}).items()}
    if task_type == "matching":
        return {str(k): _id(v) for k, v in (solution.get("pairs") or {}).items()}
    if task_type == "table_form":
        rendered: dict[str, dict[str, str]] = {}
        for row_id, row_spec in (solution.get("cells") or {}).items():
            for column_id, spec in row_spec.items():
                if "number" in spec:
                    number = parse_number(spec.get("number"))
                    value = f"{number:g}" if number is not None else _text(spec.get("number"))
                else:
                    value = _text((spec.get("accepted") or [""])[0])
                rendered.setdefault(str(row_id), {})[str(column_id)] = value
        return rendered
    if task_type == "select_in_exhibit":
        return [_id(x) for x in solution.get("selected") or []]
    return None


def grade_response(public: dict[str, Any], answer: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    """Grade a sanitized response: score, points and per-task results."""
    tasks = public.get("tasks") or []
    answer_tasks = answer.get("tasks") or {}
    results: list[dict[str, Any]] = []
    weighted = 0.0
    total_weight = 0.0
    for task in tasks:
        task_id = task["id"]
        key = answer_tasks.get(task_id) or {}
        weight = float(key.get("weight") or task.get("weight") or 1.0)
        selectable = _exhibit_selectable(public, task.get("exhibit_id")) if task.get("type") == "select_in_exhibit" else ()
        task_score = _round(score_task(key, response.get(task_id), selectable=selectable))
        results.append({
            "task_id": task_id,
            "type": task.get("type"),
            "weight": weight,
            "score": task_score,
            "is_correct": task_score >= 1.0 - SCORE_EPSILON,
        })
        weighted += weight * task_score
        total_weight += weight
    score = _round(weighted / total_weight) if total_weight else 0.0
    threshold = float(answer.get("correct_threshold") or 1.0)
    points_possible = float(answer.get("points") or 1.0)
    return {
        "score": score,
        "is_correct": score >= threshold - SCORE_EPSILON,
        "points_possible": points_possible,
        "points_earned": round(score * points_possible, 2),
        "task_results": results,
    }


def solutions_and_explanations(answer: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str], dict[str, dict[str, str]]]:
    """``(pbq_solution, pbq_explanations, pbq_item_explanations)`` keyed by task id."""
    solutions: dict[str, Any] = {}
    explanations: dict[str, str] = {}
    per_item: dict[str, dict[str, str]] = {}
    for task_id, key in (answer.get("tasks") or {}).items():
        solutions[task_id] = solution_for_display(key)
        explanation = key.get("explanation") or {}
        explanations[task_id] = _text(explanation.get("summary"))
        if explanation.get("per_item"):
            per_item[task_id] = dict(explanation["per_item"])
    return solutions, explanations, per_item
