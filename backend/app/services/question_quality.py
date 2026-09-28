from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DomainBlueprint

ALLOWED_QUESTION_FORMATS = {"single_choice", "multiple_response", "best_answer", "matching", "ordering"}
ALLOWED_DIFFICULTIES = ("Easy", "Medium", "Hard")

# Marker sentences appended to automatically generated rationales. They let the
# platform recognise fallback text (explanation_missing flag / quality warning).
FALLBACK_RATIONALE_MARKERS = {
    "en": "This rationale was generated automatically because the source file did not include a written explanation.",
    "pt-BR": "Esta justificativa foi gerada automaticamente porque o arquivo de origem não trazia uma explicação escrita.",
}


def _language_family(language: str | None) -> str:
    normalized = str(language or "").strip().lower()
    return "pt-BR" if normalized.startswith("pt") else "en"


def build_fallback_rationale(
    options: list[dict[str, Any]],
    correct_keys: list[str],
    language: str | None = None,
) -> str:
    """Neutral, localized placeholder used when the source has no written explanation.

    It only restates the answer key; it never invents an expert explanation.
    """
    family = _language_family(language)
    option_map = {
        str(item.get("key") or "").strip().upper(): str(item.get("text") or "").strip()
        for item in options
    }
    resolved: list[str] = []
    for key in correct_keys:
        label = str(key or "").strip().upper()
        if not label:
            continue
        text = option_map.get(label)
        resolved.append(f"{label} ({text})" if text else label)

    marker = FALLBACK_RATIONALE_MARKERS[family]
    joined = ", ".join(resolved)
    if family == "pt-BR":
        if not resolved:
            return f"O gabarito importado identifica a resposta correta. {marker}"
        label = "as alternativas corretas" if len(resolved) != 1 else "a alternativa correta"
        return f"O gabarito importado indica {joined} como {label}. {marker}"
    if not resolved:
        return f"The imported answer key identifies this as the correct answer. {marker}"
    label = "options" if len(resolved) != 1 else "option"
    return f"The imported answer key identifies {joined} as the correct {label}. {marker}"


def is_fallback_rationale(text: str | None) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    return any(marker in value for marker in FALLBACK_RATIONALE_MARKERS.values())


def normalize_difficulty(value: Any) -> str | None:
    """Canonical difficulty (Easy/Medium/Hard) or None; raises ValueError otherwise."""
    text = str(value or "").strip()
    if not text:
        return None
    for allowed in ALLOWED_DIFFICULTIES:
        if text.lower() == allowed.lower():
            return allowed
    raise ValueError(f"Difficulty must be one of: {', '.join(ALLOWED_DIFFICULTIES)}.")


def _normalize_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _normalize_text_list(values: Any) -> list[str]:
    items = values if isinstance(values, list) else []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in items:
        text = str(item or "").strip()
        if not text:
            continue
        lowered = text.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(text)
    return normalized


def _infer_keywords(payload: dict[str, Any]) -> list[str]:
    tags = _normalize_text_list(payload.get("tags"))
    if tags:
        return tags[:8]

    prompt = str(payload.get("prompt") or "").strip().lower()
    if not prompt:
        return []
    raw_tokens = re.findall(r"[a-z0-9][a-z0-9\\-]{2,}", prompt)
    stop_words = {"which", "what", "when", "where", "would", "should", "could", "their", "about", "these", "those"}
    keywords: list[str] = []
    seen: set[str] = set()
    for token in raw_tokens:
        if token in stop_words or token in seen:
            continue
        seen.add(token)
        keywords.append(token)
        if len(keywords) >= 8:
            break
    return keywords


def _infer_question_format(payload: dict[str, Any]) -> str:
    provided = str(payload.get("question_format") or "").strip().lower()
    if provided in ALLOWED_QUESTION_FORMATS:
        return provided
    if bool(payload.get("multi_select")):
        return "multiple_response"
    prompt = str(payload.get("prompt") or "").lower()
    if "best" in prompt and "answer" in prompt:
        return "best_answer"
    return "single_choice"


def normalize_editorial_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    normalized["subject"] = _normalize_text(payload.get("subject")) or _normalize_text(payload.get("certification")) or _normalize_text(payload.get("exam_id"))
    normalized["subtopic"] = _normalize_text(payload.get("subtopic")) or _normalize_text(payload.get("domain"))
    normalized["subdomain"] = _normalize_text(payload.get("subdomain"))
    normalized["objective_code"] = _normalize_text(payload.get("objective_code"))
    normalized["blueprint_code"] = _normalize_text(payload.get("blueprint_code")) or normalized["objective_code"]
    normalized["keywords"] = _normalize_text_list(payload.get("keywords")) or _infer_keywords(payload)
    normalized["trap_patterns"] = _normalize_text_list(payload.get("trap_patterns"))
    normalized["question_format"] = _infer_question_format(payload)
    normalized["correct_rationale"] = _normalize_text(payload.get("correct_rationale")) or _normalize_text(payload.get("justification"))
    normalized["incorrect_rationales"] = _normalize_text_list(payload.get("incorrect_rationales"))
    avg_time_seconds = payload.get("avg_time_seconds")
    normalized["avg_time_seconds"] = float(avg_time_seconds) if isinstance(avg_time_seconds, (int, float)) and float(avg_time_seconds) > 0 else None
    global_accuracy_percent = payload.get("global_accuracy_percent")
    normalized["global_accuracy_percent"] = (
        max(0.0, min(float(global_accuracy_percent), 100.0))
        if isinstance(global_accuracy_percent, (int, float))
        else None
    )
    return normalized


def assess_question_quality(
    payload: dict[str, Any],
    *,
    db: Session | None = None,
) -> dict[str, Any]:
    normalized = normalize_editorial_payload(payload)
    blocking_issues: list[str] = []
    warnings: list[str] = []
    field_status: dict[str, str] = {}

    prompt = _normalize_text(normalized.get("prompt"))
    options = normalized.get("options") or []
    correct_options = [item for item in options if bool(item.get("is_correct"))]
    certification = _normalize_text(normalized.get("certification"))
    domain = _normalize_text(normalized.get("domain"))
    subdomain = _normalize_text(normalized.get("subdomain"))
    blueprint_code = _normalize_text(normalized.get("blueprint_code"))
    objective_code = _normalize_text(normalized.get("objective_code"))
    question_format = normalized.get("question_format")
    references = normalized.get("citations") or []
    incorrect_rationales = normalized.get("incorrect_rationales") or []

    if not prompt:
        blocking_issues.append("Prompt is required.")
        field_status["prompt"] = "missing"
    else:
        field_status["prompt"] = "ok"
        if len(prompt) < 24:
            warnings.append("Prompt is unusually short and may not provide enough context.")

    if len(options) < 2:
        blocking_issues.append("At least two options are required.")
        field_status["options"] = "missing"
    else:
        field_status["options"] = "ok"

    if not correct_options:
        blocking_issues.append("At least one correct option is required.")
        field_status["correct_options"] = "missing"
    else:
        field_status["correct_options"] = "ok"

    if question_format == "single_choice" and len(correct_options) != 1:
        blocking_issues.append("Single choice questions must have exactly one correct option.")
    if question_format == "multiple_response" and len(correct_options) < 2:
        blocking_issues.append("Multiple response questions must have at least two correct options.")

    if not certification:
        blocking_issues.append("Certification is required.")
        field_status["certification"] = "missing"
    else:
        field_status["certification"] = "ok"

    if not domain:
        blocking_issues.append("Domain is required.")
        field_status["domain"] = "missing"
    else:
        field_status["domain"] = "ok"

    if not normalized.get("correct_rationale"):
        blocking_issues.append("A correct rationale is required.")
        field_status["correct_rationale"] = "missing"
    elif is_fallback_rationale(normalized.get("correct_rationale")):
        warnings.append("Rationale is an automatic placeholder; write a real explanation.")
        field_status["correct_rationale"] = "placeholder"
    else:
        field_status["correct_rationale"] = "ok"

    if correct_options and incorrect_rationales and len(incorrect_rationales) < max(len(options) - len(correct_options), 1):
        warnings.append("Incorrect rationales are present but do not cover all distractors.")

    if not references:
        warnings.append("No references linked to this question yet.")
        field_status["references"] = "missing"
    else:
        field_status["references"] = "ok"

    if not normalized.get("keywords"):
        warnings.append("Keywords were inferred weakly; consider adding explicit keywords.")
        field_status["keywords"] = "missing"
    else:
        field_status["keywords"] = "ok"

    if not normalized.get("trap_patterns"):
        warnings.append("No trap patterns recorded for this question.")
        field_status["trap_patterns"] = "missing"
    else:
        field_status["trap_patterns"] = "ok"

    blueprint_ready = bool(certification and blueprint_code)
    if not blueprint_ready:
        warnings.append("Blueprint mapping is incomplete.")
        field_status["blueprint"] = "missing"
    elif db is not None:
        exists = db.execute(
            select(DomainBlueprint.id).where(
                DomainBlueprint.certification == certification,
                DomainBlueprint.blueprint_code == blueprint_code,
            )
        ).scalar_one_or_none()
        if exists:
            field_status["blueprint"] = "ok"
        else:
            warnings.append("Blueprint code is present but not registered in the blueprint catalog yet.")
            field_status["blueprint"] = "unverified"
    else:
        field_status["blueprint"] = "provided"

    if subdomain:
        field_status["subdomain"] = "ok"
    else:
        warnings.append("Subdomain is missing.")
        field_status["subdomain"] = "missing"

    if objective_code:
        field_status["objective_code"] = "ok"
    else:
        warnings.append("Objective code is missing.")
        field_status["objective_code"] = "missing"

    completed_fields = sum(1 for value in field_status.values() if value in {"ok", "provided"})
    measurable_fields = max(len(field_status), 1)
    completeness_score = round((completed_fields / measurable_fields) * 100.0, 2)

    return {
        "normalized": normalized,
        "question_format": question_format,
        "blocking_issues": blocking_issues,
        "warnings": warnings,
        "field_status": field_status,
        "completeness_score": completeness_score,
        "is_publish_ready": not blocking_issues,
        "blueprint": {
            "certification": certification,
            "domain": domain,
            "subdomain": subdomain,
            "objective_code": objective_code,
            "blueprint_code": blueprint_code,
        },
    }


def json_text_list(value: list[str] | None) -> str | None:
    items = _normalize_text_list(value)
    if not items:
        return None
    return json.dumps(items, ensure_ascii=False)
