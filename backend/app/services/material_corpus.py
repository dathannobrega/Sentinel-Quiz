"""Normalized, section-level view of the licensed study books (material/json).

The converters (scripts/convert_*_to_json.py) emit, per book, a manifest plus one JSON file per
chapter with a flat, document-ordered ``sections`` list. That raw form has three problems for
"study the exact section behind a mistake": a parent's ``content_text`` also contains all of its
descendants' text, "Note/Tip" boxes are emitted as headings that swallow the parent's following
text, and review questions / answer keys sit next to the teaching text. This module fixes all
three in memory, so the API reads ``material/json`` directly (no build step, no copy of the
licensed text anywhere else):

* each section keeps only its own text (the part before its first child);
* sidebar headings are folded back into their parent as labelled blocks;
* every section gets a ``kind`` (teach / summary / review / answers / front) and a globally unique
  id ``{book}:{chapter-file-stem}:{anchor}``;
* sections carry exam objective codes and domain numbers parsed from the books themselves
  (chapter-opener objective lists, "1.1 ..." headings) or, for CEH, a hand-written module map.

Books whose conversion is not usable yet are excluded (see EXCLUDED_BOOKS).
"""

from __future__ import annotations

import json
import re
import threading
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

# CEH v13 was converted from PDF: headings include command output and TOC lines, half the
# sections are under 30 words and the book index is appended to chapter 15. Re-convert first.
EXCLUDED_BOOKS = frozenset({"ceh_certified_ethical_hacker_v13_study_guide"})

LINKABLE_KINDS = frozenset({"teach", "summary"})

_SIDEBAR_TITLE = re.compile(
    r"^(note|tip|exam note|exam tip|testing tip|ethics note|warning|caution|remember this!?|"
    r"real world scenario|real-world scenario|pro tip|on the job|sidebar)\b",
    re.IGNORECASE,
)
_REVIEW_TITLE = re.compile(
    r"\b(review questions|written labs?|chapter review|practice questions|assessment questions|"
    r"pre-assessment|post-assessment|test yourself|check your understanding|questions?)\s*$",
    re.IGNORECASE,
)
_ANSWERS_TITLE = re.compile(r"^answers?\b|\banswers? (to|for)\b|\banswer key\b", re.IGNORECASE)
_SUMMARY_TITLE = re.compile(r"^(summary|chapter summary|exam essentials|key terms)\b", re.IGNORECASE)
_FRONT_CHAPTER = re.compile(
    r"^(introduction|ten ways|ten test-day|putting your certification|isc2 and the cissp)", re.IGNORECASE
)
_ANSWER_PHRASES = re.compile(r"\b(correct answer|is correct|is incorrect|answer is)\b", re.IGNORECASE)
_OBJECTIVE_CODE = re.compile(r"\b([1-8])\.(1[0-4]|[1-9])\b")
_HEADING_OBJECTIVE = re.compile(r"^\s*([1-8])\.(1[0-4]|[1-9])\s")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?:])\s+(?=[A-Z0-9“\"(•])")

# CEH (Walker) has no objective codes; chapters mapped by hand to the CEH v13 modules.
CEH_WALKER_MODULES: dict[str, tuple[str, ...]] = {
    "ch01": ("M01",),
    "ch02": ("M02",),
    "ch03": ("M03", "M04"),
    "ch04": ("M08", "M12"),
    "ch05": ("M05", "M06"),
    "ch06": ("M13", "M14", "M15"),
    "ch07": ("M16",),
    "ch08": ("M17", "M18"),
    "ch09": ("M19",),
    "ch10": ("M07", "M10", "M11"),
    "ch11": ("M20",),
    "ch12": ("M09",),
    "ch13": ("M01",),
    "ch14": ("M01", "M05"),
}
CEH_WALKER_SLUG = "ceh_certified_ethical_hacker_study_guide"

PARAGRAPH_TARGET_WORDS = 90


@dataclass(frozen=True)
class SectionBlock:
    text: str
    label: str | None = None  # e.g. "Exam Note" for a folded sidebar


@dataclass
class CorpusSection:
    id: str
    book_slug: str
    book_title: str
    certification: str
    source_file: str
    chapter_file: str
    chapter_index: int
    chapter_title: str
    anchor: str
    level: int
    title: str
    path: tuple[str, ...]
    page_start: int | None
    page_end: int | None
    kind: str
    blocks: list[SectionBlock] = field(default_factory=list)
    parent_id: str | None = None
    child_ids: list[str] = field(default_factory=list)
    objectives: tuple[str, ...] = ()
    domains: tuple[int, ...] = ()
    modules: tuple[str, ...] = ()

    @property
    def text(self) -> str:
        return "\n\n".join(block.text for block in self.blocks)

    @property
    def word_count(self) -> int:
        return sum(len(block.text.split()) for block in self.blocks)


@dataclass
class CorpusBook:
    slug: str
    title: str
    certification: str
    source_file: str
    section_ids: list[str] = field(default_factory=list)


@dataclass
class MaterialCorpus:
    books: dict[str, CorpusBook]
    sections: dict[str, CorpusSection]
    # (normalized source file name, chapter file, anchor) -> section id (sidebars map to their parent)
    by_locator: dict[tuple[str, str, str], str]

    def get(self, section_id: str) -> CorpusSection | None:
        return self.sections.get(section_id)

    def resolve_locator(self, material_path: str | None, locator: str | None) -> CorpusSection | None:
        """Map a legacy EPUB citation (material_path + 'OPS/c04.xhtml#head-3-30') to a section."""
        if not material_path or not locator:
            return None
        source = normalize_source_name(material_path)
        entry, _, anchor = str(locator).partition("#")
        chapter_file = entry.rsplit("/", 1)[-1]
        section_id = self.by_locator.get((source, chapter_file, anchor)) or self.by_locator.get((source, chapter_file, ""))
        return self.sections.get(section_id) if section_id else None

    def linkable(self) -> list[CorpusSection]:
        return [section for section in self.sections.values() if section.kind in LINKABLE_KINDS and section.word_count >= 40]


def normalize_source_name(value: str) -> str:
    name = str(value or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"\.(epub|pdf)$", "", name, flags=re.IGNORECASE)
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def split_paragraphs(text: str, target_words: int = PARAGRAPH_TARGET_WORDS) -> list[str]:
    """The converters collapse whitespace, so real paragraph breaks are lost. Rebuild readable
    paragraphs by grouping whole sentences up to ~target_words (never splitting a sentence)."""
    sentences = [part.strip() for part in _SENTENCE_BREAK.split(text or "") if part.strip()]
    paragraphs: list[str] = []
    current: list[str] = []
    count = 0
    for sentence in sentences:
        words = len(sentence.split())
        if current and count + words > target_words:
            paragraphs.append(" ".join(current))
            current, count = [], 0
        current.append(sentence)
        count += words
    if current:
        paragraphs.append(" ".join(current))
    return paragraphs


def _is_sidebar(title: str) -> bool:
    """Boxes emitted as headings: "Note", "Exam Tip"... and For Dummies' ALL-CAPS box titles
    ("KEY ESCROW AND KEY RECOVERY"). Chapter openers are never sidebars (index 0 is excluded)."""
    if _SIDEBAR_TITLE.match(title):
        return True
    letters = [char for char in title if char.isalpha()]
    if len(letters) < 6 or not all(char.isupper() for char in letters):
        return False
    # Multi-word ALL-CAPS titles, or long single words ("LAWYERSPEAK", "PACKET-FILTERING");
    # short single tokens are acronym headings ("DNSSEC") and stay sections.
    return len(title.split()) >= 2 or len(letters) >= 8


def _own_text(sections: list[dict], index: int) -> str:
    """A section's text without its descendants: everything before the first child's text."""
    section = sections[index]
    text = str(section.get("content_text") or "")
    if index + 1 < len(sections):
        child = sections[index + 1]
        if int(child.get("level") or 0) > int(section.get("level") or 0):
            probe = str(child.get("content_text") or "")[:160]
            position = text.find(probe) if probe else -1
            if position >= 0:
                text = text[:position]
    return _strip_leading_title(text.strip(), str(section.get("title") or ""))


def _strip_leading_title(text: str, title: str) -> str:
    clean_title = title.strip()
    if clean_title and text[: len(clean_title)].lower() == clean_title.lower():
        return text[len(clean_title):].lstrip(" .:-–—")
    return text


def _chapter_objectives(sections: list[dict]) -> tuple[str, ...]:
    """Objective codes listed in the chapter opener (first section's own text)."""
    if not sections:
        return ()
    opener = _own_text(sections, 0)[:6000]
    codes = {f"{major}.{minor}" for major, minor in _OBJECTIVE_CODE.findall(opener)}
    return tuple(sorted(codes, key=lambda code: tuple(int(part) for part in code.split("."))))


def _chapter_kind(chapter_title: str, sections: list[dict]) -> str | None:
    if _FRONT_CHAPTER.search(chapter_title.strip()):
        return "front"
    # Only the practice-test chapters ("701 Pre-Assessment Questions"); "Security Assessment and
    # Testing" is a CISSP domain / Security+ chapter and must stay teaching text.
    if re.search(r"\b(pre|post)-assessment\b|\bassessment (questions|answers|test)\b", chapter_title, re.IGNORECASE):
        return "answers" if re.search(r"answers", chapter_title, re.IGNORECASE) else "review"
    text = " ".join(str(section.get("content_text") or "") for section in sections[:1])
    words = max(len(text.split()), 1)
    # Answer-key chapters (some are labelled only "Chapter 5") are dense with answer phrases.
    if words > 300 and len(_ANSWER_PHRASES.findall(text)) * 1000 / words >= 4:
        return "answers"
    return None


def _section_kind(title: str, ancestor_titles: list[str]) -> str:
    for candidate in [title, *reversed(ancestor_titles)]:
        clean = candidate.strip()
        if _ANSWERS_TITLE.search(clean):
            return "answers"
        if _REVIEW_TITLE.search(clean):
            return "review"
    if _SUMMARY_TITLE.search(title.strip()):
        return "summary"
    return "teach"


def _load_book(book_dir: Path) -> tuple[CorpusBook, list[CorpusSection], dict[tuple[str, str, str], str]] | None:
    manifest_path = book_dir / "manifest.json"
    if not manifest_path.is_file():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    slug = str(manifest.get("slug") or book_dir.name)
    book = CorpusBook(
        slug=slug,
        title=str(manifest.get("title") or slug),
        certification=str(manifest.get("certification") or ""),
        source_file=str(manifest.get("source_file") or ""),
    )
    source_key = normalize_source_name(book.source_file)
    sections_out: list[CorpusSection] = []
    locators: dict[tuple[str, str, str], str] = {}

    for chapter_meta in manifest.get("chapters", []):
        chapter_path = book_dir / str(chapter_meta.get("json_file") or "")
        if not chapter_path.is_file():
            continue
        chapter = json.loads(chapter_path.read_text(encoding="utf-8"))
        raw_sections: list[dict] = list(chapter.get("sections") or [])
        chapter_file = str(chapter.get("file_name") or chapter_meta.get("file_name") or chapter_path.name)
        chapter_stem = re.sub(r"\.(x?html?|json)$", "", chapter_file, flags=re.IGNORECASE)
        chapter_title = str(chapter.get("title") or chapter_meta.get("title") or chapter_stem)
        chapter_kind = _chapter_kind(chapter_title, raw_sections)
        chapter_objectives = _chapter_objectives(raw_sections)
        chapter_domains = _majority_domains(chapter_objectives)
        chapter_modules = CEH_WALKER_MODULES.get(chapter_stem, ()) if slug == CEH_WALKER_SLUG else ()

        used_ids: Counter[str] = Counter()
        stack: list[CorpusSection] = []  # open ancestors (non-sidebar) by level
        heading_objective: dict[int, tuple[str, ...]] = {}

        for index, raw in enumerate(raw_sections):
            level = int(raw.get("level") or 1)
            title = str(raw.get("title") or "").strip()
            anchor = str(raw.get("anchor") or raw.get("id") or f"s{index}")
            own = _own_text(raw_sections, index)
            if stack and index > 0 and _is_sidebar(title):
                # Fold the box (and the text it swallowed) into the section it sits in, before
                # touching the heading stack: box headings often use a higher level than the
                # sections around them and would otherwise become their parent. The first folded
                # paragraph carries the box label ("Exam Note", "Tip", "KEY ESCROW"...).
                host = stack[-1]
                for position, paragraph in enumerate(split_paragraphs(own)):
                    host.blocks.append(SectionBlock(paragraph, label=title if position == 0 else None))
                locators[(source_key, chapter_file, anchor)] = host.id
                continue
            while stack and stack[-1].level >= level:
                stack.pop()
            parent = stack[-1] if stack else None

            base_id = f"{slug}:{chapter_stem}:{anchor}"
            used_ids[base_id] += 1
            section_id = base_id if used_ids[base_id] == 1 else f"{base_id}~{used_ids[base_id]}"

            match = _HEADING_OBJECTIVE.match(title)
            if match:
                heading_objective[level] = (f"{match.group(1)}.{match.group(2)}",)
            for deeper in [key for key in heading_objective if key > level]:
                heading_objective.pop(deeper, None)
            inherited = next(
                (heading_objective[key] for key in sorted(heading_objective, reverse=True) if key <= level), ()
            )
            objectives = inherited or chapter_objectives
            domains = _majority_domains(inherited) if inherited else chapter_domains

            ancestor_titles = [ancestor.title for ancestor in stack]
            kind = chapter_kind or _section_kind(title, ancestor_titles)
            section = CorpusSection(
                id=section_id,
                book_slug=slug,
                book_title=book.title,
                certification=book.certification,
                source_file=book.source_file,
                chapter_file=chapter_file,
                chapter_index=int(chapter.get("chapter_index") or chapter_meta.get("chapter_index") or 0),
                chapter_title=chapter_title,
                anchor=anchor,
                level=level,
                title=title,
                path=tuple([*ancestor_titles, title]),
                page_start=_as_int(raw.get("page_start")),
                page_end=_as_int(raw.get("page_end")),
                kind=kind,
                blocks=[SectionBlock(paragraph) for paragraph in split_paragraphs(own)],
                parent_id=parent.id if parent else None,
                objectives=objectives,
                domains=domains,
                modules=chapter_modules,
            )
            if parent is not None:
                parent.child_ids.append(section.id)
            sections_out.append(section)
            book.section_ids.append(section.id)
            locators.setdefault((source_key, chapter_file, anchor), section.id)
            if index == 0:
                locators.setdefault((source_key, chapter_file, ""), section.id)
            stack.append(section)

    return book, sections_out, locators


def _majority_domains(codes: tuple[str, ...]) -> tuple[int, ...]:
    if not codes:
        return ()
    counts = Counter(int(code.split(".")[0]) for code in codes)
    top = max(counts.values())
    return tuple(sorted(domain for domain, count in counts.items() if count == top))


def _as_int(value: object) -> int | None:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def build_corpus(json_root: Path, excluded: frozenset[str] = EXCLUDED_BOOKS) -> MaterialCorpus:
    books: dict[str, CorpusBook] = {}
    sections: dict[str, CorpusSection] = {}
    by_locator: dict[tuple[str, str, str], str] = {}
    if json_root.is_dir():
        for book_dir in sorted(path for path in json_root.iterdir() if path.is_dir()):
            if book_dir.name in excluded:
                continue
            loaded = _load_book(book_dir)
            if loaded is None:
                continue
            book, book_sections, locators = loaded
            if book.slug in excluded:
                continue
            books[book.slug] = book
            for section in book_sections:
                sections[section.id] = section
            by_locator.update(locators)
    return MaterialCorpus(books=books, sections=sections, by_locator=by_locator)


_cache_lock = threading.Lock()
_cache: dict[Path, tuple[float, MaterialCorpus]] = {}


def _json_root() -> Path | None:
    from app.services.materials import resolve_material_dir

    base = resolve_material_dir()
    if base is None:
        return None
    root = base / "json"
    return root if root.is_dir() else None


def get_corpus() -> MaterialCorpus | None:
    """Corpus for MATERIAL_DIR/json, cached until any manifest changes. None when not mounted."""
    root = _json_root()
    if root is None:
        return None
    stamp = max((path.stat().st_mtime for path in root.glob("*/manifest.json")), default=0.0)
    with _cache_lock:
        cached = _cache.get(root)
        if cached and cached[0] == stamp:
            return cached[1]
    corpus = build_corpus(root)
    with _cache_lock:
        _cache[root] = (stamp, corpus)
    return corpus


def clear_corpus_cache() -> None:
    with _cache_lock:
        _cache.clear()
