"""Pure (DB-free) parsing/formatting helpers shared by quiz, study and admin (M-C6).

``api/admin.py`` / the admin services keep their own copies for now (owned by another
workstream); new code should import from here.
"""
from __future__ import annotations

import json
from typing import Any

SAFE_FEEDBACK_MAX_CHARS = 240

# Keys of the exam session payload stored in ``selection_mix_json`` (the selection mix,
# the timer/pause config and the active filters). Study sessions store a plain mix.
SELECTION_MIX_KEY = "_selection_mix"
SESSION_CONFIG_KEY = "_session_config"
ACTIVE_FILTERS_KEY = "_active_filters"
UNKNOWN_DOMAIN_LABEL = "Sem dominio"


def score_percent(correct: int, total: int) -> float:
    return round((correct / total) * 100.0, 2) if total else 0.0


def domain_label(value: Any) -> str:
    return str(value or UNKNOWN_DOMAIN_LABEL).strip() or UNKNOWN_DOMAIN_LABEL


def truncate_text(value: str, limit: int = 160) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: max(limit - 1, 0)].rstrip() + "..."


def parse_tags(tags_json: str | None) -> list[str]:
    if not tags_json:
        return []
    try:
        payload = json.loads(tags_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    tags: list[str] = []
    for item in payload:
        text = str(item or "").strip()
        if text:
            tags.append(text)
    return tags


def _clean_citation_value(value):
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, list):
        cleaned_items = []
        for item in value:
            cleaned = _clean_citation_value(item)
            if cleaned is not None:
                cleaned_items.append(cleaned)
        return cleaned_items or None
    if isinstance(value, dict):
        cleaned_dict = {}
        for key, item in value.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            cleaned = _clean_citation_value(item)
            if cleaned is not None:
                cleaned_dict[clean_key] = cleaned
        return cleaned_dict or None
    return None


def parse_citations(citations_json: str | None) -> list[dict]:
    """Citations with guaranteed ``source``/``reference`` keys (used to format study resources)."""
    if not citations_json:
        return []
    try:
        payload = json.loads(citations_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []

    citations: list[dict] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        cleaned_item = {}
        for key, value in item.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            if clean_key in {"source", "reference"}:
                cleaned = str(value or "").strip()
            else:
                cleaned = _clean_citation_value(value)
            if cleaned is None:
                continue
            cleaned_item[clean_key] = cleaned
        source = str(cleaned_item.get("source") or "").strip()
        reference = str(cleaned_item.get("reference") or "").strip()
        locator = str(cleaned_item.get("locator") or "").strip()
        material_path = str(cleaned_item.get("material_path") or "").strip()
        if source or reference or locator or material_path:
            cleaned_item["source"] = source
            cleaned_item["reference"] = reference
            citations.append(cleaned_item)
    return citations


def parse_citation_dicts(citations_json: str | None) -> list[dict[str, Any]]:
    """Citations as cleaned dicts, one level of nesting kept (used by review payloads)."""
    if not citations_json:
        return []
    try:
        payload = json.loads(citations_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []

    citations: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        cleaned: dict[str, Any] = {}
        for key, value in item.items():
            label = str(key or "").strip()
            if not label or value is None:
                continue
            if isinstance(value, str):
                normalized = value.strip()
                if normalized:
                    cleaned[label] = normalized
                continue
            if isinstance(value, (bool, int, float)):
                cleaned[label] = value
                continue
            if isinstance(value, list):
                cleaned_values = [str(entry).strip() for entry in value if str(entry).strip()]
                if cleaned_values:
                    cleaned[label] = cleaned_values
                continue
            if isinstance(value, dict):
                nested: dict[str, Any] = {}
                for nested_key, nested_value in value.items():
                    nested_label = str(nested_key or "").strip()
                    if not nested_label or nested_value is None:
                        continue
                    if isinstance(nested_value, str):
                        nested_text = nested_value.strip()
                        if nested_text:
                            nested[nested_label] = nested_text
                    elif isinstance(nested_value, (bool, int, float)):
                        nested[nested_label] = nested_value
                if nested:
                    cleaned[label] = nested
        if cleaned:
            citations.append(cleaned)
    return citations


def format_citation(citation: dict) -> str:
    source = str(citation.get("source") or "").strip()
    reference = str(citation.get("reference") or "").strip()
    chapter = str(citation.get("chapter") or "").strip()
    section = str(citation.get("section") or "").strip()
    locator = str(citation.get("locator") or "").strip()

    if not reference:
        if chapter and section and section.lower() != chapter.lower():
            reference = f"{chapter} -> {section}"
        else:
            reference = chapter or section

    page_start = citation.get("page_start")
    page_end = citation.get("page_end")
    page_text = ""
    if page_start is not None and page_end is not None:
        if str(page_start) == str(page_end):
            page_text = f"p. {page_start}"
        else:
            page_text = f"pp. {page_start}-{page_end}"
    elif page_start is not None:
        page_text = f"p. {page_start}"

    detail_parts = [part for part in [reference, page_text, locator] if part]
    if source and detail_parts:
        return f"{source}: {' | '.join(detail_parts)}"
    if detail_parts:
        return " | ".join(detail_parts)
    return source


_FEEDBACK_FALLBACKS = {
    "exam": (
        "Resposta correta. A revisão completa continua disponível no resumo final da sessão.",
        "Resposta incorreta. O conceito foi registrado para revisão e a explicação completa fica na tela final.",
    ),
    "study": (
        "Resposta correta. O racional completo permanece disponível na revisão final deste bloco.",
        "Resposta incorreta. A questão entrou na fila de revisão e o racional completo fica no resumo final.",
    ),
}


def feedback_explanation(justification: str | None, *, is_correct: bool, mode: str = "exam") -> str:
    """Short, answer-safe feedback text (never reveals which option is correct)."""
    raw = " ".join(str(justification or "").split()).strip()
    if raw:
        lowered = raw.lower()
        if any(marker in lowered for marker in ("alternativa", "correct answer", "resposta correta", "option ")):
            raw = ""
    if raw:
        trimmed = raw[:SAFE_FEEDBACK_MAX_CHARS].rstrip()
        if len(raw) > SAFE_FEEDBACK_MAX_CHARS:
            trimmed += "..."
        prefix = "Conceito-chave: " if is_correct else "Revise este conceito: "
        return f"{prefix}{trimmed}"
    correct_text, wrong_text = _FEEDBACK_FALLBACKS.get(mode, _FEEDBACK_FALLBACKS["exam"])
    return correct_text if is_correct else wrong_text


def parse_json_dict(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def sanitize_selection_mix(selection_mix: dict[str, int] | None) -> dict[str, int]:
    cleaned: dict[str, int] = {}
    for key, value in (selection_mix or {}).items():
        label = str(key or "").strip()
        if not label:
            continue
        try:
            cleaned[label] = max(int(value), 0)
        except (TypeError, ValueError):
            continue
    return cleaned


def serialize_session_payload(
    selection_mix: dict[str, int] | None,
    *,
    session_config: dict[str, Any] | None = None,
    active_filters: dict[str, Any] | None = None,
) -> str | None:
    cleaned_mix = sanitize_selection_mix(selection_mix)
    cleaned_config = dict(session_config or {})
    cleaned_filters = dict(active_filters or {})
    if not cleaned_config and not cleaned_filters:
        if not cleaned_mix:
            return None
        return json.dumps(cleaned_mix, ensure_ascii=True, sort_keys=True)

    payload: dict[str, Any] = {
        SELECTION_MIX_KEY: cleaned_mix,
        SESSION_CONFIG_KEY: cleaned_config,
        ACTIVE_FILTERS_KEY: cleaned_filters,
    }
    return json.dumps(payload, ensure_ascii=True, sort_keys=True)


def parse_session_payload(selection_mix_json: str | None) -> tuple[dict[str, int], dict[str, Any], dict[str, Any]]:
    if not selection_mix_json:
        return {}, {}, {}
    try:
        payload = json.loads(selection_mix_json)
    except (TypeError, ValueError):
        return {}, {}, {}
    if not isinstance(payload, dict):
        return {}, {}, {}

    if SELECTION_MIX_KEY in payload or SESSION_CONFIG_KEY in payload or ACTIVE_FILTERS_KEY in payload:
        raw_mix = payload.get(SELECTION_MIX_KEY)
        raw_config = payload.get(SESSION_CONFIG_KEY)
        raw_filters = payload.get(ACTIVE_FILTERS_KEY)
    else:
        raw_mix = payload
        raw_config = {}
        raw_filters = {}

    parsed_mix: dict[str, int] = {}
    if isinstance(raw_mix, dict):
        for key, value in raw_mix.items():
            label = str(key or "").strip()
            if not label:
                continue
            try:
                parsed_mix[label] = max(int(value), 0)
            except (TypeError, ValueError):
                continue

    parsed_config = raw_config if isinstance(raw_config, dict) else {}
    parsed_filters = raw_filters if isinstance(raw_filters, dict) else {}
    return parsed_mix, parsed_config, parsed_filters


def parse_selection_mix(selection_mix_json: str | None) -> dict[str, int]:
    """Selection mix of an exam or study session (plain dict or exam envelope)."""
    parsed_mix, _parsed_config, _parsed_filters = parse_session_payload(selection_mix_json)
    return parsed_mix
