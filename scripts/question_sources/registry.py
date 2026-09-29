"""Source registry (registry.json) and the license gate."""
from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parents[1]
REGISTRY_PATH = PACKAGE_DIR / "registry.json"
PERMISSIONS_DIR = PACKAGE_DIR / "permissions"

STATUSES = ("approved", "permission_required", "blocked")
# SPDX identifiers whose terms allow copying and adapting the questions with attribution.
REUSE_LICENSES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "Unlicense"}
REQUIRED_KEYS = ("id", "name", "url", "commit", "license", "status", "reason", "evidence", "review_stats")


class RegistryError(Exception):
    """Invalid registry or a refused operation (license gate)."""


def load_registry(path: Path | None = None) -> dict[str, Any]:
    registry = json.loads((path or REGISTRY_PATH).read_text(encoding="utf-8"))
    errors = validate_registry(registry)
    if errors:
        raise RegistryError("invalid registry: " + "; ".join(errors))
    return registry


def save_registry(registry: dict[str, Any], path: Path | None = None) -> None:
    errors = validate_registry(registry)
    if errors:
        raise RegistryError("refusing to save an invalid registry: " + "; ".join(errors))
    (path or REGISTRY_PATH).write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_registry(registry: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for index, source in enumerate(registry.get("sources") or []):
        where = source.get("id") or f"#{index}"
        missing = [key for key in REQUIRED_KEYS if key not in source]
        if missing:
            errors.append(f"{where}: missing {missing}")
        if source.get("id") in seen:
            errors.append(f"{where}: duplicate id")
        seen.add(source.get("id"))
        if source.get("status") not in STATUSES:
            errors.append(f"{where}: status must be one of {list(STATUSES)}")
        if not str(source.get("reason") or "").strip():
            errors.append(f"{where}: reason is required")
        commit = str(source.get("commit") or "")
        if len(commit) != 40 or any(ch not in "0123456789abcdef" for ch in commit):
            errors.append(f"{where}: commit must be a full 40-char SHA")
        if source.get("status") == "approved":
            license_ok = source.get("license") in REUSE_LICENSES
            permission = source.get("permission") or {}
            if not license_ok and not permission.get("evidence_file"):
                errors.append(f"{where}: approved without a reuse license or recorded permission")
    return errors


def get_source(registry: dict[str, Any], source_id: str) -> dict[str, Any]:
    for source in registry.get("sources") or []:
        if source.get("id") == source_id:
            return source
    raise RegistryError(f"unknown source {source_id!r} (see `list`)")


def check_import_allowed(source: dict[str, Any]) -> None:
    """License gate: raises unless the source may be imported."""
    status = source.get("status")
    if status == "approved":
        return
    if status == "blocked":
        raise RegistryError(
            f"{source['id']} is blocked: {source.get('reason')} "
            "Blocked sources are never imported (a new decision must be reviewed and recorded in registry.json)."
        )
    raise RegistryError(
        f"{source['id']} requires the author's written permission ({source.get('reason')}). "
        "Re-run with --permission-evidence <file> once the permission is granted."
    )


def record_permission(
    registry: dict[str, Any],
    source_id: str,
    evidence_file: Path,
    *,
    note: str | None = None,
    now: datetime | None = None,
    permissions_dir: Path | None = None,
) -> dict[str, Any]:
    """Store the evidence next to the registry and flip permission_required -> approved."""
    source = get_source(registry, source_id)
    if source.get("status") == "blocked":
        check_import_allowed(source)  # raises: permission from the uploader cannot fix copied content
    evidence_file = Path(evidence_file)
    if not evidence_file.is_file() or evidence_file.stat().st_size == 0:
        raise RegistryError(f"permission evidence {evidence_file} is missing or empty")
    digest = hashlib.sha256(evidence_file.read_bytes()).hexdigest()
    stamp = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    target_dir = (permissions_dir or PERMISSIONS_DIR) / source_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{stamp.strftime('%Y%m%dT%H%M%SZ')}-{evidence_file.name}"
    shutil.copyfile(evidence_file, target)
    try:
        stored = str(target.relative_to(REPO_ROOT))
    except ValueError:
        stored = str(target)
    source["permission"] = {
        "evidence_file": stored,
        "sha256": digest,
        "recorded_at": stamp.isoformat(),
        "note": note,
    }
    source["status"] = "approved"
    source.setdefault("evidence", []).append(f"Written permission recorded {stamp.date().isoformat()}: {stored}")
    return source
