from __future__ import annotations

import re
import threading
import time
import zipfile
from html import escape, unescape
from pathlib import Path

from app.core.config import settings


REPO_ROOT = Path(__file__).resolve().parents[3]

# File index cache (L-B7): the material tree is scanned at most once per
# MATERIAL_INDEX_TTL_SECONDS per root, and immediately when the root mtime changes,
# instead of an rglob() on every preview request.
MATERIAL_INDEX_TTL_SECONDS = 300.0
_material_index_lock = threading.Lock()
_material_index_cache: dict[Path, tuple[int, float, tuple[Path, ...]]] = {}


def _material_files(root: Path) -> tuple[Path, ...]:
    try:
        root_mtime = root.stat().st_mtime_ns
    except OSError:
        return ()
    now = time.monotonic()
    with _material_index_lock:
        cached = _material_index_cache.get(root)
        if cached and cached[0] == root_mtime and (now - cached[1]) < MATERIAL_INDEX_TTL_SECONDS:
            return cached[2]
    files = tuple(sorted(path for path in root.rglob("*") if path.is_file()))
    with _material_index_lock:
        _material_index_cache[root] = (root_mtime, now, files)
    return files


def clear_material_index_cache() -> None:
    with _material_index_lock:
        _material_index_cache.clear()


def resolve_material_dir() -> Path | None:
    material_dir = Path(settings.material_dir)
    if not material_dir.is_absolute():
        material_dir = (Path.cwd() / material_dir).resolve()
    if material_dir.is_dir():
        return material_dir

    repo_material = (REPO_ROOT / "material").resolve()
    if repo_material.is_dir():
        return repo_material
    return None


def resolve_material_file(material_path: str) -> Path:
    raw_path = str(material_path or "").strip()
    if not raw_path:
        raise FileNotFoundError("Material path is required.")

    base_dir = resolve_material_dir()
    allowed_roots = _allowed_material_roots(base_dir)

    candidates: list[Path] = []
    if not Path(raw_path).is_absolute():
        candidates.append((REPO_ROOT / raw_path).resolve())
        if raw_path.startswith("material/"):
            relative_name = raw_path.split("/", 1)[1]
            if base_dir:
                candidates.append((base_dir / relative_name).resolve())
            for root in allowed_roots:
                candidates.append((root / relative_name).resolve())
        else:
            if base_dir:
                candidates.append((base_dir / raw_path).resolve())
            for root in allowed_roots:
                candidates.append((root / raw_path).resolve())
    else:
        candidates.append(Path(raw_path).resolve())

    for candidate in candidates:
        if not candidate.is_file():
            continue
        if any(_is_relative_to(candidate, root) for root in allowed_roots):
            return candidate

    filename = Path(raw_path).name.strip()
    if filename:
        direct_name_match = _find_material_by_name(filename, allowed_roots)
        if direct_name_match:
            return direct_name_match

        normalized_name_match = _find_material_by_normalized_name(filename, allowed_roots)
        if normalized_name_match:
            return normalized_name_match

    raise FileNotFoundError(f"Material not found: {raw_path}")


def build_material_preview(material_path: str, locator: str | None = None) -> dict:
    material_file = resolve_material_file(material_path)
    suffix = material_file.suffix.lower()
    if suffix == ".epub":
        return _build_epub_preview(material_file, locator)
    return _build_text_preview(material_file)


def _build_text_preview(material_file: Path) -> dict:
    text = material_file.read_text(encoding="utf-8", errors="ignore")
    body_html = _text_to_html(text)
    return {
        "title": material_file.name,
        "chapter": material_file.stem,
        "body_html": body_html,
        "material_name": material_file.name,
    }


def _build_epub_preview(material_file: Path, locator: str | None = None) -> dict:
    locator_value = str(locator or "").strip()
    entry_name = "OPS/c01.xhtml"
    anchor = ""
    if locator_value:
        if "#" in locator_value:
            entry_name, anchor = locator_value.split("#", 1)
        else:
            entry_name = locator_value

    with zipfile.ZipFile(material_file) as archive:
        target_entry = _resolve_archive_entry(archive, entry_name)
        raw = archive.read(target_entry).decode("utf-8", "ignore")

    body_match = re.search(r"<body\b[^>]*>(.*)</body>", raw, flags=re.IGNORECASE | re.DOTALL)
    body = body_match.group(1) if body_match else raw

    headings = []
    for match in re.finditer(r"<h([1-6])\b([^>]*)>(.*?)</h\1>", body, flags=re.IGNORECASE | re.DOTALL):
        level = int(match.group(1))
        attrs = match.group(2)
        title = _strip_tags(match.group(3))
        heading_id_match = re.search(r"id=\"([^\"]+)\"", attrs)
        heading_id = heading_id_match.group(1) if heading_id_match else None
        headings.append({
            "start": match.start(),
            "level": level,
            "id": heading_id,
            "title": title,
        })

    if not headings:
        plain_text = _html_to_text(body)
        return {
            "title": material_file.name,
            "chapter": material_file.stem,
            "body_html": _text_to_html(plain_text),
            "material_name": material_file.name,
        }

    anchor_pos = None
    if anchor:
        anchor_match = re.search(fr'id=\"{re.escape(anchor)}\"', body)
        if anchor_match:
            anchor_pos = anchor_match.start()

    section_index = 0
    if anchor:
        for index, heading in enumerate(headings):
            if heading["id"] == anchor:
                section_index = index
                anchor_pos = heading["start"]
                break
        else:
            if anchor_pos is not None:
                for index, heading in enumerate(headings):
                    if heading["start"] <= anchor_pos:
                        section_index = index
                    else:
                        break

    current_heading = headings[section_index]
    section_start = current_heading["start"]
    current_level = current_heading["level"]
    section_end = len(body)
    for heading in headings[section_index + 1:]:
        if heading["level"] <= current_level:
            section_end = heading["start"]
            break

    chapter_title = current_heading["title"]
    for heading in reversed(headings[:section_index + 1]):
        if heading["level"] == 1:
            chapter_title = heading["title"]
            break

    section_html = body[section_start:section_end]
    section_text = _html_to_text(section_html)

    return {
        "title": current_heading["title"] or chapter_title,
        "chapter": chapter_title,
        "body_html": _text_to_html(section_text),
        "material_name": material_file.name,
        "locator": f"{target_entry}#{anchor}" if anchor else target_entry,
    }


def _resolve_archive_entry(archive: zipfile.ZipFile, entry_name: str) -> str:
    normalized = str(entry_name or "").strip()
    if normalized in archive.namelist():
        return normalized
    prefixed = normalized if normalized.startswith("OPS/") else f"OPS/{normalized}"
    if prefixed in archive.namelist():
        return prefixed
    chapter_entries = sorted(
        name for name in archive.namelist()
        if re.match(r"OPS/c\d+\.xhtml$", name)
    )
    if chapter_entries:
        return chapter_entries[0]
    raise FileNotFoundError(f"Archive entry not found: {entry_name}")


def _html_to_text(value: str) -> str:
    working = value
    replacements = [
        (r"<br\s*/?>", "\n"),
        (r"</p>", "\n\n"),
        (r"</div>", "\n\n"),
        (r"</section>", "\n\n"),
        (r"</h[1-6]>", "\n\n"),
        (r"</li>", "\n"),
        (r"</ul>", "\n\n"),
        (r"</ol>", "\n\n"),
    ]
    for pattern, replacement in replacements:
        working = re.sub(pattern, replacement, working, flags=re.IGNORECASE)
    working = re.sub(r"<li\b[^>]*>", "• ", working, flags=re.IGNORECASE)
    working = re.sub(r"<img\b[^>]*>", "", working, flags=re.IGNORECASE)
    working = re.sub(r"<script\b.*?</script>", " ", working, flags=re.IGNORECASE | re.DOTALL)
    working = re.sub(r"<style\b.*?</style>", " ", working, flags=re.IGNORECASE | re.DOTALL)
    working = re.sub(r"<[^>]+>", " ", working)
    working = unescape(working)
    working = working.replace("\r", "")
    working = re.sub(r"[ \t]+\n", "\n", working)
    working = re.sub(r"\n[ \t]+", "\n", working)
    working = re.sub(r"\n{3,}", "\n\n", working)
    return working.strip()


def _text_to_html(text: str) -> str:
    paragraphs = [chunk.strip() for chunk in re.split(r"\n{2,}", text or "") if chunk.strip()]
    if not paragraphs:
        return "<p>Sem conteudo suficiente para este trecho.</p>"
    html_parts = []
    for paragraph in paragraphs[:24]:
        lines = [line.strip() for line in paragraph.splitlines() if line.strip()]
        if not lines:
            continue
        if all(line.startswith("• ") for line in lines):
            items = "".join(f"<li>{escape(line[2:])}</li>" for line in lines)
            html_parts.append(f"<ul>{items}</ul>")
            continue
        joined = "<br>".join(escape(line) for line in lines)
        html_parts.append(f"<p>{joined}</p>")
    return "".join(html_parts) or "<p>Sem conteudo suficiente para este trecho.</p>"


def _strip_tags(value: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", value)
    cleaned = re.sub(r"\s+", " ", unescape(cleaned))
    return cleaned.strip()


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _allowed_material_roots(base_dir: Path | None = None) -> list[Path]:
    repo_material = (REPO_ROOT / "material").resolve()
    roots: list[Path] = []
    for candidate in [base_dir.resolve() if base_dir else None, repo_material]:
        if not candidate or not candidate.is_dir():
            continue
        if candidate in roots:
            continue
        roots.append(candidate)
    return roots


def _find_material_by_name(filename: str, roots: list[Path]) -> Path | None:
    requested = str(filename or "").strip().lower()
    if not requested:
        return None
    for root in roots:
        direct = (root / filename).resolve()
        if direct.is_file() and _is_relative_to(direct, root):
            return direct
        for candidate in _material_files(root):
            if candidate.name.lower() == requested and _is_relative_to(candidate.resolve(), root):
                return candidate.resolve()
    return None


def _normalize_material_name(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())
    return normalized


def _find_material_by_normalized_name(filename: str, roots: list[Path]) -> Path | None:
    requested = _normalize_material_name(Path(filename).name)
    if not requested:
        return None
    for root in roots:
        for candidate in _material_files(root):
            if not _is_relative_to(candidate.resolve(), root):
                continue
            if _normalize_material_name(candidate.name) == requested:
                return candidate.resolve()
    return None
