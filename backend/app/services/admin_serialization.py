"""Serialization helpers shared by the admin/editorial services.

Single home for the JSON-column parsers (tags, citations, keywords...) and the
tag/citation normalisers that used to be copied across services/admin_questions.py,
services/admin_export.py, services/admin_users.py and services/editorial.py.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any


def iso_or_none(value: date | datetime | None) -> str | None:
    return value.isoformat() if value else None


def parse_json(raw: str | None, default: Any) -> Any:
    """Decode a JSON text column, returning ``default`` when empty or invalid."""
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def parse_text_list(raw: str | None) -> list[str]:
    """JSON list column -> list of non-empty stripped strings (tags, keywords...)."""
    payload = parse_json(raw, None)
    if not isinstance(payload, list):
        return []
    return [str(item).strip() for item in payload if str(item).strip()]


def parse_dict_list(raw: str | None) -> list[dict[str, Any]]:
    """JSON list column -> list of dict items (citations)."""
    payload = parse_json(raw, None)
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


def json_or_none(value: Any) -> str | None:
    if not value:
        return None
    return json.dumps(value, ensure_ascii=False)


def strip_or_none(value: str | None) -> str | None:
    return (value.strip() or None) if value else None


def clean_citation_value(value: Any) -> Any:
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
            cleaned = clean_citation_value(item)
            if cleaned is not None:
                cleaned_items.append(cleaned)
        return cleaned_items or None
    if isinstance(value, dict):
        cleaned_dict: dict[str, Any] = {}
        for key, item in value.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            cleaned = clean_citation_value(item)
            if cleaned is not None:
                cleaned_dict[clean_key] = cleaned
        return cleaned_dict or None
    return None


def normalize_tags(tags: list[str] | None) -> list[str]:
    """Strip, drop empties and de-duplicate case-insensitively (first spelling wins)."""
    normalized: list[str] = []
    seen: set[str] = set()
    for tag in tags or []:
        clean = str(tag or "").strip()
        if not clean:
            continue
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(clean)
    return normalized


def normalize_citations(citations: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in citations or []:
        if not isinstance(item, dict):
            continue
        normalized_item: dict[str, Any] = {}
        for key, value in item.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            if clean_key in {"source", "reference"}:
                cleaned = str(value or "").strip()
            else:
                cleaned = clean_citation_value(value)
            if cleaned is None:
                continue
            normalized_item[clean_key] = cleaned

        source = str(normalized_item.get("source") or "").strip()
        reference = str(normalized_item.get("reference") or "").strip()
        locator = str(normalized_item.get("locator") or "").strip()
        material_path = str(normalized_item.get("material_path") or "").strip()
        if not source and not reference and not locator and not material_path:
            continue
        normalized_item["source"] = source
        normalized_item["reference"] = reference
        key = json.dumps(normalized_item, ensure_ascii=False, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(normalized_item)
    return normalized
