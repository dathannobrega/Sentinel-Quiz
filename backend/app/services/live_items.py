"""Item type registry of Sentinel Arena (PLANO §5, contract §3).

One place defines, per ``item_type``: which fields it has, write-time sanitation (hard
limits only, so the editor can autosave half-written items), publish-time validation
(completeness), the public projection sent to players (opaque per-session option ids,
never the answer key) and the grader that returns ``score_fraction``.
"""
from __future__ import annotations

import hashlib
import math
import random
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Iterable

from app.models import LIVE_ITEM_TYPES
from app.services.pbq_grading import _kendall_tau_clipped, parse_number

PROMPT_MAX = 400
PROMPT_WARN = 120
OPTION_MAX = 120
OPTION_WARN = 60
OPTIONS_MIN = 2
OPTIONS_MAX = 6
BODY_MAX = 1000
ACCEPTED_MAX = 10
ACCEPTED_LEN_MAX = 60
TEXT_ANSWER_MAX = 60
EXPLANATION_MAX = 2000
NOTES_MAX = 2000
TIME_LIMIT_MIN = 5
TIME_LIMIT_MAX = 240
DEFAULT_TIME_LIMIT = {
    "single_choice": 20, "multi_choice": 30, "true_false": 15, "type_answer": 30, "poll": 30,
    "ordering": 45, "numeric": 30, "word_cloud": 45,
}
# Ordering (T05)
ORDER_MIN = 3
ORDER_METHODS = ("kendall", "exact")
# Numeric (T06): full credit within tolerance, linear partial credit up to 3x tolerance.
NUMERIC_PARTIAL_FACTOR = 3.0
NUMERIC_UNIT_MAX = 12
NUMERIC_BINS = 20
# Word cloud (T08)
WORD_MAX_LEN = 25
WORDS_PER_PERSON_MAX = 3
WORD_CLOUD_TOP = 60

CHOICE_TYPES = frozenset({"single_choice", "multi_choice", "true_false"})
OPTION_TYPES = CHOICE_TYPES | {"poll"}
SCORED_TYPES = CHOICE_TYPES | {"type_answer", "ordering", "numeric"}
INTERACTIVE_TYPES = SCORED_TYPES | {"poll", "word_cloud"}
PASSIVE_TYPES = frozenset({"content", "leaderboard"})
OPTION_KEYS = ("A", "B", "C", "D", "E", "F")
TRUE_FALSE_KEYS = ("T", "F")


class ItemInputError(ValueError):
    def __init__(self, field: str, code: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Issue:
    field: str
    code: str
    message: str
    severity: str = "error"  # "error" blocks publish, "warning" does not


def _text(value: Any, *, field: str, limit: int, allow_empty: bool = True) -> str:
    text = unicodedata.normalize("NFC", str(value or "")).strip()
    text = "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    if len(text) > limit:
        raise ItemInputError(field, "too_long", f"{field} must have at most {limit} characters.")
    if not allow_empty and not text:
        raise ItemInputError(field, "required", f"{field} is required.")
    return text


def _optional_text(value: Any, *, field: str, limit: int) -> str | None:
    text = _text(value, field=field, limit=limit)
    return text or None


def _number(value: Any, *, field: str, allow_none: bool = False) -> float | None:
    if value is None or value == "":
        if allow_none:
            return None
        raise ItemInputError(field, "required", f"{field} is required.")
    number = parse_number(value)
    if number is None or not math.isfinite(number) or abs(number) > 1e12:
        raise ItemInputError(field, "invalid", f"{field} must be a number.")
    return float(number)


def is_scored(item_type: str, points_multiplier: int = 1) -> bool:
    return item_type in SCORED_TYPES and int(points_multiplier or 0) > 0


def default_payload(item_type: str) -> tuple[dict, dict]:
    if item_type == "true_false":
        return (
            {"options": [{"key": "T", "text": "Verdadeiro"}, {"key": "F", "text": "Falso"}]},
            {"correct_keys": []},
        )
    if item_type in OPTION_TYPES:
        return ({"options": [{"key": "A", "text": ""}, {"key": "B", "text": ""}], "allow_multiple": False}, {"correct_keys": []})
    if item_type == "type_answer":
        return ({}, {"accepted_answers": []})
    if item_type == "ordering":
        # The options are stored in the correct order; players see a per-session shuffle.
        return ({"options": [{"key": k, "text": ""} for k in OPTION_KEYS[:ORDER_MIN]]}, {"method": "kendall"})
    if item_type == "numeric":
        return ({"min": 0.0, "max": 100.0, "step": 1.0, "unit": ""}, {"value": None, "tolerance": 0.0, "partial": True})
    if item_type == "word_cloud":
        return ({"max_words": 1}, {})
    if item_type == "content":
        return ({"body": ""}, {})
    return ({}, {})


def _sanitize_options(item_type: str, raw_options: Any) -> tuple[list[dict], list[str]]:
    if not isinstance(raw_options, list):
        raise ItemInputError("options", "invalid", "options must be a list.")
    if item_type == "true_false":
        by_key = {str(o.get("key") or "").upper(): o for o in raw_options if isinstance(o, dict)}
        options, correct = [], []
        for key, default_text in zip(TRUE_FALSE_KEYS, ("Verdadeiro", "Falso")):
            source = by_key.get(key, {})
            text = _text(source.get("text") or default_text, field="options.text", limit=OPTION_MAX)
            options.append({"key": key, "text": text})
            if source.get("correct"):
                correct.append(key)
        return options, correct
    if len(raw_options) > OPTIONS_MAX:
        raise ItemInputError("options", "too_many", f"At most {OPTIONS_MAX} options.")
    options, correct, seen = [], [], set()
    free_keys = [k for k in OPTION_KEYS if k not in {str(o.get("key") or "").upper() for o in raw_options if isinstance(o, dict)}]
    for raw in raw_options:
        if not isinstance(raw, dict):
            raise ItemInputError("options", "invalid", "Each option must be an object.")
        key = str(raw.get("key") or "").strip().upper()
        if key not in OPTION_KEYS or key in seen:
            key = free_keys.pop(0)
        seen.add(key)
        options.append({"key": key, "text": _text(raw.get("text"), field="options.text", limit=OPTION_MAX)})
        if raw.get("correct") and item_type != "poll":
            correct.append(key)
    return options, correct


def apply_write(item_type: str, data: dict[str, Any], *, payload: dict, answer: dict) -> dict[str, Any]:
    """Merge a (partial) write into column values. Hard limits only."""
    if item_type not in LIVE_ITEM_TYPES:
        raise ItemInputError("item_type", "invalid", "Unknown item type.")
    payload = dict(payload or {})
    answer = dict(answer or {})
    values: dict[str, Any] = {}

    if "prompt" in data:
        values["prompt"] = _text(data.get("prompt"), field="prompt", limit=PROMPT_MAX)
    if "options" in data and item_type in OPTION_TYPES:
        options, correct = _sanitize_options(item_type, data.get("options") or [])
        payload["options"] = options
        answer["correct_keys"] = correct
    if "options" in data and item_type == "ordering":
        options, _ = _sanitize_options("poll", data.get("options") or [])
        payload["options"] = options  # author order = correct order
    if item_type == "ordering" and "order_method" in data:
        if data.get("order_method") not in ORDER_METHODS:
            raise ItemInputError("order_method", "invalid", "order_method must be kendall or exact.")
        answer["method"] = data.get("order_method")
    if item_type == "numeric":
        for field in ("min", "max", "step"):
            if field in data:
                payload[field] = _number(data.get(field), field=field, allow_none=field == "step")
        if "unit" in data:
            payload["unit"] = _text(data.get("unit"), field="unit", limit=NUMERIC_UNIT_MAX)
        if "value" in data:
            answer["value"] = _number(data.get("value"), field="value", allow_none=True)
        if "tolerance" in data:
            tolerance = _number(data.get("tolerance"), field="tolerance")
            if tolerance < 0:
                raise ItemInputError("tolerance", "invalid", "tolerance must be >= 0.")
            answer["tolerance"] = tolerance
        if "partial" in data:
            answer["partial"] = bool(data.get("partial"))
    if item_type == "word_cloud" and "max_words" in data:
        try:
            max_words = int(data.get("max_words"))
        except (TypeError, ValueError):
            raise ItemInputError("max_words", "invalid", "max_words must be an integer.") from None
        if not 1 <= max_words <= WORDS_PER_PERSON_MAX:
            raise ItemInputError("max_words", "out_of_range", f"max_words must be between 1 and {WORDS_PER_PERSON_MAX}.")
        payload["max_words"] = max_words
    if item_type == "poll" and "allow_multiple" in data:
        payload["allow_multiple"] = bool(data.get("allow_multiple"))
    if item_type == "multi_choice" and "all_or_nothing" in data:
        payload["all_or_nothing"] = bool(data.get("all_or_nothing"))
    if item_type == "type_answer" and "accepted_answers" in data:
        raw = data.get("accepted_answers") or []
        if not isinstance(raw, list) or len(raw) > ACCEPTED_MAX:
            raise ItemInputError("accepted_answers", "too_many", f"At most {ACCEPTED_MAX} accepted answers.")
        cleaned: list[str] = []
        for value in raw:
            text = _text(value, field="accepted_answers", limit=ACCEPTED_LEN_MAX)
            if text and normalize_text_answer(text) not in {normalize_text_answer(v) for v in cleaned}:
                cleaned.append(text)
        answer["accepted_answers"] = cleaned
    if item_type == "content" and "body" in data:
        payload["body"] = _text(data.get("body"), field="body", limit=BODY_MAX)
    if "time_limit_s" in data:
        limit = data.get("time_limit_s")
        if limit is not None:
            try:
                limit = int(limit)
            except (TypeError, ValueError):
                raise ItemInputError("time_limit_s", "invalid", "time_limit_s must be an integer or null.") from None
            if not TIME_LIMIT_MIN <= limit <= TIME_LIMIT_MAX:
                raise ItemInputError(
                    "time_limit_s", "out_of_range", f"time_limit_s must be between {TIME_LIMIT_MIN} and {TIME_LIMIT_MAX}."
                )
        values["time_limit_s"] = limit
    if "points_multiplier" in data:
        multiplier = data.get("points_multiplier")
        if multiplier not in (0, 1, 2):
            raise ItemInputError("points_multiplier", "invalid", "points_multiplier must be 0, 1 or 2.")
        values["points_multiplier"] = int(multiplier)
    if "explanation" in data:
        values["explanation"] = _optional_text(data.get("explanation"), field="explanation", limit=EXPLANATION_MAX)
    if "presenter_notes" in data:
        values["presenter_notes"] = _optional_text(data.get("presenter_notes"), field="presenter_notes", limit=NOTES_MAX)

    values["payload_json"] = payload
    values["answer_json"] = answer
    return values


def publish_issues(item_type: str, *, prompt: str, payload: dict, answer: dict, time_limit_s: int | None) -> list[Issue]:
    issues: list[Issue] = []
    if item_type not in {"leaderboard", "content"} and not (prompt or "").strip():
        issues.append(Issue("prompt", "required", "The prompt is empty."))
    elif len(prompt or "") > PROMPT_WARN:
        issues.append(Issue("prompt", "long", f"Prompt longer than {PROMPT_WARN} characters is hard to read on a projector.", "warning"))
    if item_type in OPTION_TYPES:
        options = payload.get("options") or []
        if len(options) < OPTIONS_MIN:
            issues.append(Issue("options", "too_few", f"At least {OPTIONS_MIN} options are required."))
        if any(not str(o.get("text") or "").strip() for o in options):
            issues.append(Issue("options", "empty_option", "Every option needs a text."))
        texts = [normalize_text_answer(o.get("text") or "") for o in options]
        if len(set(texts)) != len(texts):
            issues.append(Issue("options", "duplicate_option", "Two options have the same text."))
        if any(len(str(o.get("text") or "")) > OPTION_WARN for o in options):
            issues.append(Issue("options", "long", f"Options longer than {OPTION_WARN} characters are hard to read.", "warning"))
        correct = answer.get("correct_keys") or []
        if item_type in CHOICE_TYPES and not correct:
            issues.append(Issue("options", "no_correct", "Mark at least one correct option."))
        if item_type == "true_false" and len(correct) > 1:
            issues.append(Issue("options", "too_many_correct", "True/false needs exactly one correct option."))
        if item_type == "multi_choice" and correct and len(correct) == len(options):
            issues.append(Issue("options", "all_correct", "Every option is correct; consider a distractor.", "warning"))
    if item_type == "ordering":
        options = payload.get("options") or []
        if len(options) < ORDER_MIN:
            issues.append(Issue("options", "too_few", f"At least {ORDER_MIN} items to order are required."))
        if any(not str(o.get("text") or "").strip() for o in options):
            issues.append(Issue("options", "empty_option", "Every item needs a text."))
        texts = [normalize_text_answer(o.get("text") or "") for o in options]
        if len(set(texts)) != len(texts):
            issues.append(Issue("options", "duplicate_option", "Two items have the same text."))
        if any(len(str(o.get("text") or "")) > OPTION_WARN for o in options):
            issues.append(Issue("options", "long", f"Items longer than {OPTION_WARN} characters are hard to read.", "warning"))
    if item_type == "numeric":
        low, high, value = payload.get("min"), payload.get("max"), answer.get("value")
        if low is None or high is None or not low < high:
            issues.append(Issue("range", "invalid_range", "Set a minimum lower than the maximum."))
        elif value is None:
            issues.append(Issue("value", "required", "Set the correct value."))
        elif not low <= value <= high:
            issues.append(Issue("value", "out_of_range", "The correct value must be inside the range."))
        step = payload.get("step")
        if step is not None and step <= 0:
            issues.append(Issue("step", "invalid", "The step must be positive."))
        elif step and low is not None and high is not None and low < high and (high - low) / step > 100_000:
            issues.append(Issue("step", "too_fine", "The step is too small for this range."))
    if item_type == "type_answer" and not (answer.get("accepted_answers") or []):
        issues.append(Issue("accepted_answers", "required", "Add at least one accepted answer."))
    if item_type == "content" and not str(payload.get("body") or "").strip() and not (prompt or "").strip():
        issues.append(Issue("body", "required", "The content slide is empty."))
    if item_type in SCORED_TYPES and time_limit_s is None:
        issues.append(Issue("time_limit_s", "no_timer", "Without a timer the item uses fixed points and closes on the host's command.", "warning"))
    return issues


# ----------------------------------------------------------------------------- runtime

def type_fields(item_type: str, payload: dict, answer: dict) -> dict[str, Any]:
    """Author-facing settings of the GA types (editor and presenter views)."""
    if item_type == "ordering":
        return {"order_method": answer.get("method") or "kendall"}
    if item_type == "numeric":
        return {
            "numeric": {
                "min": payload.get("min"), "max": payload.get("max"), "step": payload.get("step"),
                "unit": payload.get("unit") or "", "value": answer.get("value"),
                "tolerance": float(answer.get("tolerance") or 0.0), "partial": bool(answer.get("partial", True)),
            }
        }
    if item_type == "word_cloud":
        return {"max_words": int(payload.get("max_words") or 1)}
    return {}


def option_public_id(session_id: str, position: int, key: str) -> str:
    digest = hashlib.sha256(f"{session_id}:{position}:{key}".encode("utf-8")).hexdigest()
    return f"o_{digest[:8]}"


def option_id_map(session_id: str, position: int, snapshot: dict) -> dict[str, str]:
    """opaque id -> original key for one item of one session."""
    return {
        option_public_id(session_id, position, str(option["key"])): str(option["key"])
        for option in (snapshot.get("payload") or {}).get("options") or []
    }


def shuffled_keys(session_id: str, position: int, keys: list[str]) -> list[str]:
    """Deterministic per-session shuffle for ordering items, never the correct order."""
    if len(keys) < 2:
        return list(keys)
    seed = int(hashlib.sha256(f"order:{session_id}:{position}".encode("utf-8")).hexdigest()[:16], 16)
    shuffled = list(keys)
    random.Random(seed).shuffle(shuffled)
    if shuffled == keys:
        shuffled = shuffled[1:] + shuffled[:1]
    return shuffled


def public_question(session_id: str, position: int, snapshot: dict) -> dict[str, Any]:
    item_type = snapshot["item_type"]
    payload = snapshot.get("payload") or {}
    answer = snapshot.get("answer") or {}
    raw_options = list(payload.get("options") or [])
    if item_type == "ordering":  # never leak the answer through the option order
        by_key = {str(o["key"]): o for o in raw_options}
        raw_options = [by_key[k] for k in shuffled_keys(session_id, position, [str(o["key"]) for o in raw_options])]
    options = [
        {"id": option_public_id(session_id, position, str(option["key"])), "text": option.get("text") or "", "index": index}
        for index, option in enumerate(raw_options)
    ]
    multiplier = int(snapshot.get("points_multiplier", 1))
    return {
        "qi": position,
        "item_type": item_type,
        "prompt": snapshot.get("prompt") or "",
        "options": options,
        "allow_multiple": bool(payload.get("allow_multiple")) if item_type == "poll" else item_type == "multi_choice",
        "body": payload.get("body") if item_type == "content" else None,
        "time_limit_s": snapshot.get("time_limit_s"),
        "points_multiplier": multiplier,
        "scored": is_scored(item_type, multiplier),
        "select_count": len(answer.get("correct_keys") or []) if item_type == "multi_choice" else None,
        # Numeric (T06): slider range; word cloud (T08): how many words per person.
        "numeric": (
            {"min": payload.get("min"), "max": payload.get("max"), "step": payload.get("step"), "unit": payload.get("unit") or ""}
            if item_type == "numeric" else None
        ),
        "max_words": int(payload.get("max_words") or 1) if item_type == "word_cloud" else None,
        # Removed by moderation (RF-1114): clients show a neutral placeholder.
        "removed": bool(snapshot.get("removed")),
    }


_TRAILING = re.compile(r"[\s.!?;:,'\"`´]+$")
_LEADING = re.compile(r"^[\s'\"`´]+")


def normalize_text_answer(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).casefold()
    text = re.sub(r"\s+", " ", text).strip()
    return _LEADING.sub("", _TRAILING.sub("", text))


@dataclass(frozen=True)
class Graded:
    response: dict[str, Any]  # original keys / normalized text
    fraction: float | None  # None for non-scored interactive items (poll)
    is_correct: bool | None


class InvalidAnswer(ValueError):
    pass


def normalize_word(value: str) -> str:
    return normalize_text_answer(value)[:WORD_MAX_LEN]


def numeric_fraction(given: float, target: float, tolerance: float, partial: bool) -> float:
    distance = abs(given - target)
    if distance <= tolerance + 1e-9:
        return 1.0
    if not partial:
        return 0.0
    band = max(tolerance, 1e-9) * (NUMERIC_PARTIAL_FACTOR - 1.0)
    if tolerance <= 0:  # exact answers get no partial band
        return 0.0
    return max(0.0, 1.0 - (distance - tolerance) / band)


def grade(
    session_id: str, position: int, snapshot: dict, *, choice: Iterable[str] | None, text: str | None,
    words: Iterable[str] | None = None, number: float | None = None,
) -> Graded:
    item_type = snapshot["item_type"]
    payload = snapshot.get("payload") or {}
    answer = snapshot.get("answer") or {}
    if item_type == "ordering":
        ids = [str(value) for value in (choice or [])]
        mapping = option_id_map(session_id, position, snapshot)
        if len(ids) != len(mapping) or len(set(ids)) != len(ids) or any(value not in mapping for value in ids):
            raise InvalidAnswer("the order must contain every item exactly once")
        order = [mapping[value] for value in ids]
        solution = [str(o["key"]) for o in payload.get("options") or []]
        if answer.get("method") == "exact":
            fraction = 1.0 if order == solution else 0.0
        else:
            fraction = _kendall_tau_clipped(order, solution)
        return Graded({"order": order}, round(fraction, 4), order == solution)
    if item_type == "numeric":
        if number is not None:
            number = float(number) if math.isfinite(float(number)) else None
        else:
            number = parse_number(text)
        low, high = payload.get("min"), payload.get("max")
        if number is None or low is None or high is None or not low <= number <= high:
            raise InvalidAnswer("the number must be inside the range")
        target = answer.get("value")
        if target is None:
            raise InvalidAnswer("item has no correct value")
        tolerance = float(answer.get("tolerance") or 0.0)
        fraction = numeric_fraction(number, float(target), tolerance, bool(answer.get("partial", True)))
        return Graded({"number": number}, round(fraction, 4), abs(number - float(target)) <= tolerance + 1e-9)
    if item_type == "word_cloud":
        raw = [str(w or "").strip() for w in (words if words is not None else ([text] if text else []))]
        raw = [w for w in raw if w]
        if not raw or len(raw) > int(payload.get("max_words") or 1) or any(len(w) > WORD_MAX_LEN for w in raw):
            raise InvalidAnswer("send 1..max_words words of up to 25 characters")
        cleaned: list[str] = []
        for word in raw:
            if normalize_word(word) and normalize_word(word) not in {normalize_word(w) for w in cleaned}:
                cleaned.append(word)
        if not cleaned:
            raise InvalidAnswer("empty words")
        return Graded({"words": cleaned, "normalized": [normalize_word(w) for w in cleaned]}, None, None)
    if item_type in OPTION_TYPES:
        ids = [str(value) for value in (choice or [])]
        mapping = option_id_map(session_id, position, snapshot)
        if not ids or len(ids) != len(set(ids)) or any(value not in mapping for value in ids):
            raise InvalidAnswer("unknown or duplicate option")
        allow_many = item_type == "multi_choice" or (item_type == "poll" and payload.get("allow_multiple"))
        if not allow_many and len(ids) != 1:
            raise InvalidAnswer("exactly one option expected")
        keys = sorted(mapping[value] for value in ids)
        if item_type == "poll":
            return Graded({"keys": keys}, None, None)
        correct = set(answer.get("correct_keys") or [])
        if item_type in {"single_choice", "true_false"}:
            ok = keys[0] in correct
            return Graded({"keys": keys}, 1.0 if ok else 0.0, ok)
        chosen = set(keys)
        if payload.get("all_or_nothing"):
            fraction = 1.0 if chosen == correct else 0.0
        else:
            hits = len(chosen & correct)
            wrong = len(chosen - correct)
            fraction = max(0.0, (hits - wrong) / len(correct)) if correct else 0.0
        return Graded({"keys": keys}, round(fraction, 4), fraction >= 1.0)
    if item_type == "type_answer":
        raw = str(text or "").strip()
        if not raw or len(raw) > TEXT_ANSWER_MAX:
            raise InvalidAnswer("text answer must have 1..60 characters")
        normalized = normalize_text_answer(raw)
        accepted = {normalize_text_answer(value) for value in answer.get("accepted_answers") or []}
        ok = normalized in accepted
        return Graded({"text": raw[:TEXT_ANSWER_MAX], "normalized": normalized}, 1.0 if ok else 0.0, ok)
    raise InvalidAnswer("item does not accept answers")


# ----------------------------------------------------------------------------- bank

def bank_conversion(options: list[dict], multi_select: bool) -> tuple[str | None, str | None]:
    """Target item type for a bank MCQ, or a reject reason."""
    if len(options) < OPTIONS_MIN:
        return None, "too_few_options"
    if len(options) > OPTIONS_MAX:
        return None, "too_many_options"
    if multi_select:
        return "multi_choice", None
    texts = {normalize_text_answer(o.get("text") or "") for o in options}
    if len(options) == 2 and texts <= {"verdadeiro", "falso", "true", "false", "v", "f"}:
        return "true_false", None
    return "single_choice", None
