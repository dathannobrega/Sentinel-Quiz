from __future__ import annotations

import argparse
import json
import math
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
QUESTIONS_DIR = ROOT / "questions"
MATERIAL_DIR = ROOT / "material"

SECURITY_PLUS_FILE = QUESTIONS_DIR / "securityplus.json"
CISSP_FILE = QUESTIONS_DIR / "cissp.json"

SECURITY_PLUS_BOOK_PATH = MATERIAL_DIR / "CompTIA Security+ Study Guide Exam SY0-701.epub"
CISSP_BOOK_PATH = MATERIAL_DIR / "CISSP For Dummies.epub"

GENERIC_REFERENCE_TITLES = {
    "summary",
    "exam essentials",
    "review questions",
    "exam note",
    "introduction",
}

GENERIC_TAG_PREFIXES = ("simulado ", "simulation ")
IGNORED_ACRONYMS = {"MOST", "LEAST", "BEST", "NOT", "TRUE", "FALSE", "EXCEPT"}

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "can",
    "could", "do", "does", "during", "each", "for", "from", "had", "has", "have",
    "if", "in", "into", "is", "it", "its", "may", "might", "more", "most", "must",
    "need", "of", "on", "only", "or", "other", "our", "out", "over", "should",
    "so", "some", "such", "than", "that", "the", "their", "them", "then", "there",
    "these", "they", "this", "those", "through", "to", "under", "use", "using",
    "various", "what", "when", "where", "which", "while", "who", "why", "will",
    "with", "within", "would", "your",
    "ao", "aos", "apos", "apos", "apenas", "as", "assim", "bem", "com", "como",
    "contra", "da", "das", "de", "delas", "dele", "deles", "depois", "do", "dos",
    "e", "ela", "elas", "ele", "eles", "em", "entre", "essa", "essas", "esse",
    "esses", "esta", "estao", "estas", "este", "estes", "foi", "mais", "mas",
    "menos", "muito", "na", "nas", "no", "nos", "o", "os", "ou", "para", "pela",
    "pelas", "pelo", "pelos", "por", "qual", "quais", "quando", "que", "quem",
    "sao", "se", "sem", "ser", "sera", "seria", "seu", "seus", "sua", "suas",
    "sobre", "tambem", "tem", "ter", "uma", "umas", "um", "uns",
    "organization", "company", "question", "questions", "following", "correct",
    "incorrect", "option", "options", "security", "system", "systems", "user",
    "users", "data",
}

SECURITY_PLUS_DOMAIN_CHAPTERS = {
    "General Security Concepts": {"c01.xhtml", "c07.xhtml", "c08.xhtml", "c16.xhtml", "c17.xhtml"},
    "Threats, Vulnerabilities and Mitigations": {
        "c02.xhtml", "c03.xhtml", "c04.xhtml", "c05.xhtml", "c06.xhtml", "c11.xhtml",
        "c12.xhtml", "c13.xhtml", "c14.xhtml",
    },
    "Security Architecture": {"c01.xhtml", "c07.xhtml", "c08.xhtml", "c09.xhtml", "c10.xhtml", "c11.xhtml", "c12.xhtml", "c13.xhtml"},
    "Security Operations": {"c05.xhtml", "c09.xhtml", "c11.xhtml", "c14.xhtml", "c15.xhtml", "c16.xhtml", "c17.xhtml"},
    "Security Program Management and Oversight": {"c01.xhtml", "c05.xhtml", "c16.xhtml", "c17.xhtml"},
}

CISSP_DOMAIN_CHAPTER = {
    "Security and Risk Management": "c03.xhtml",
    "Asset Security": "c04.xhtml",
    "Security Architecture and Engineering": "c05.xhtml",
    "Communication and Network Security": "c06.xhtml",
    "Identity and Access Management (IAM)": "c07.xhtml",
    "Identity and Access Management": "c07.xhtml",
    "Security Assessment and Testing": "c08.xhtml",
    "Security Operations": "c09.xhtml",
    "Software Development Security": "c10.xhtml",
}


def strip_tags(raw: str) -> str:
    cleaned = re.sub(r"<script\b.*?</script>", " ", raw, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<style\b.*?</style>", " ", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", unescape(cleaned))
    return cleaned.strip()


def normalize_search_text(value: str) -> str:
    value = unescape(value or "").lower()
    value = re.sub(r"[^a-z0-9+.#/ -]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def tokenize(value: str) -> list[str]:
    normalized = normalize_search_text(value)
    tokens: list[str] = []
    for token in normalized.split():
        token = token.strip(".-/")
        if len(token) < 2 and not token.isdigit():
            continue
        if token in STOPWORDS:
            continue
        tokens.append(token)
    return tokens


def clean_json_value(value: Any):
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
            cleaned = clean_json_value(item)
            if cleaned is not None:
                cleaned_items.append(cleaned)
        return cleaned_items or None
    if isinstance(value, dict):
        cleaned_dict: dict[str, Any] = {}
        for key, item in value.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            cleaned = clean_json_value(item)
            if cleaned is not None:
                cleaned_dict[clean_key] = cleaned
        return cleaned_dict or None
    return None


def to_page_value(raw: str | None):
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    if value.isdigit():
        return int(value)
    return value


def dedupe_citations(citations: list[dict]) -> list[dict]:
    unique: list[dict] = []
    seen = set()
    for item in citations:
        cleaned = clean_json_value(item)
        if not isinstance(cleaned, dict):
            continue
        key = json.dumps(cleaned, ensure_ascii=False, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        unique.append(cleaned)
    return unique


def prettify_chapter_title(title: str) -> str:
    if not title:
        return title
    return re.sub(r"^(Chapter\s+\d+)\s+(?=\S)", r"\1: ", title)


def build_reference_path(section: "Section") -> str:
    parts = [prettify_chapter_title(section.chapter_title)]
    parts.extend(section.parent_titles)
    normalized_parts = {normalize_search_text(part) for part in parts}
    if section.title and normalize_search_text(section.title) not in normalized_parts:
        parts.append(section.title)
    return " -> ".join([part for part in parts if part])


def build_reference_label(section: "Section") -> str:
    parts = [prettify_chapter_title(section.chapter_title)]
    if section.parent_titles:
        parts.extend(section.parent_titles)
    normalized_parts = {normalize_search_text(part) for part in parts}
    if section.title and normalize_search_text(section.title) not in normalized_parts:
        parts.append(section.title)
    return " -> ".join([part for part in parts if part])


def is_generic_reference_title(title: str) -> bool:
    return normalize_search_text(title) in GENERIC_REFERENCE_TITLES


def extract_parenthetical_phrases(text: str) -> list[str]:
    phrases: list[str] = []
    for match in re.findall(r"\(([^)]+)\)", text or ""):
        cleaned = " ".join(match.split())
        if cleaned:
            phrases.append(cleaned)
    return phrases


def extract_acronyms(text: str) -> list[str]:
    matches = re.findall(r"\b[A-Z][A-Z0-9.+/-]{1,}\b", text or "")
    return [match for match in matches if len(match) >= 2 and match not in IGNORED_ACRONYMS]


def build_search_phrases(question: dict) -> dict[str, float]:
    phrases: dict[str, float] = {}

    def add(raw: str, weight: float) -> None:
        cleaned = " ".join(str(raw or "").split())
        if not cleaned:
            return
        lowered = cleaned.lower()
        if lowered in {question.get("domain", "").lower()}:
            return
        if any(lowered.startswith(prefix) for prefix in GENERIC_TAG_PREFIXES):
            return
        normalized = normalize_search_text(cleaned)
        if len(normalized) < 2:
            return
        phrases[normalized] = max(weight, phrases.get(normalized, 0.0))

    options = question.get("options") or []
    correct_keys = {str(item).strip().upper() for item in question.get("correct_options") or []}

    for tag in question.get("tags") or []:
        add(tag, 8.0)

    for option in options:
        if not isinstance(option, dict):
            continue
        text = str(option.get("text") or "").strip()
        if not text:
            continue
        if str(option.get("key") or "").strip().upper() in correct_keys:
            add(text, 10.0)
            for phrase in extract_parenthetical_phrases(text):
                add(phrase, 9.0)
        for acronym in extract_acronyms(text):
            add(acronym, 6.0)

    for phrase in extract_parenthetical_phrases(question.get("question") or ""):
        add(phrase, 7.0)

    for acronym in extract_acronyms(question.get("question") or ""):
        add(acronym, 5.5)

    return phrases


@dataclass(slots=True)
class Section:
    file_name: str
    anchor: str | None
    level: int
    title: str
    chapter_title: str
    parent_titles: tuple[str, ...]
    locator: str
    page_start: int | str | None
    page_end: int | str | None
    search_text: str
    path_search: str
    title_token_set: frozenset[str]
    path_token_set: frozenset[str]
    token_set: frozenset[str]


class BookIndex:
    def __init__(
        self,
        material_path: Path,
        source_name: str,
        certification: str,
        security_plus_domain_map: dict[str, set[str]] | None = None,
        cissp_domain_map: dict[str, str] | None = None,
    ) -> None:
        self.material_path = material_path
        self.source_name = source_name
        self.certification = certification
        self.security_plus_domain_map = security_plus_domain_map or {}
        self.cissp_domain_map = cissp_domain_map or {}
        self.sections: list[Section] = []
        self.idf: dict[str, float] = {}
        self.sections_by_file: dict[str, list[Section]] = defaultdict(list)
        self.chapter_sections_by_file: dict[str, list[Section]] = defaultdict(list)
        self._build()

    def _build(self) -> None:
        with zipfile.ZipFile(self.material_path) as archive:
            chapter_files = sorted(
                name for name in archive.namelist()
                if re.match(r"OPS/c\d+\.xhtml$", name)
            )
            for archive_name in chapter_files:
                raw = archive.read(archive_name).decode("utf-8", "ignore")
                body_match = re.search(r"<body\b[^>]*>(.*)</body>", raw, flags=re.IGNORECASE | re.DOTALL)
                body = body_match.group(1) if body_match else raw
                file_name = archive_name.split("/", 1)[1]
                self._index_file(file_name, body)
        self._build_idf()

    def _index_file(self, file_name: str, body: str) -> None:
        pagebreaks: list[tuple[int, int | str | None]] = []
        for match in re.finditer(r"<[^>]*epub:type=\"pagebreak\"[^>]*>", body, flags=re.IGNORECASE | re.DOTALL):
            tag = match.group(0)
            label_match = re.search(r"aria-label=\"([^\"]+)\"", tag)
            pagebreaks.append((match.start(), to_page_value(label_match.group(1) if label_match else None)))

        headings: list[tuple[int, int, str | None, str]] = []
        for match in re.finditer(r"<h([1-6])\b([^>]*)>(.*?)</h\1>", body, flags=re.IGNORECASE | re.DOTALL):
            level = int(match.group(1))
            attrs = match.group(2)
            title = strip_tags(match.group(3))
            if not title:
                continue
            id_match = re.search(r"id=\"([^\"]+)\"", attrs)
            anchor = id_match.group(1) if id_match else None
            if not anchor:
                continue
            headings.append((match.start(), level, anchor, title))

        if not headings:
            return

        chapter_title = next((title for _, level, _, title in headings if level == 1), file_name)
        heading_path: dict[int, str] = {}

        for index, (start_pos, level, anchor, title) in enumerate(headings):
            end_pos = len(body)
            for later_pos, later_level, _, _ in headings[index + 1:]:
                if later_level <= level:
                    end_pos = later_pos
                    break

            while heading_path and max(heading_path) >= level:
                del heading_path[max(heading_path)]
            if level > 1:
                heading_path[level] = title
            parent_titles = tuple(heading_path[key] for key in sorted(heading_path) if key < level)

            page_start = None
            for page_pos, page_value in pagebreaks:
                if page_pos <= start_pos:
                    page_start = page_value
                else:
                    break
            if page_start is None:
                page_start = next((value for _, value in pagebreaks if value is not None), None)

            page_end = page_start
            for page_pos, page_value in pagebreaks:
                if page_pos < start_pos:
                    continue
                if page_pos >= end_pos:
                    break
                if page_value is not None:
                    page_end = page_value

            segment = strip_tags(body[start_pos:end_pos])
            locator = f"OPS/{file_name}" + (f"#{anchor}" if anchor else "")
            path_label = build_reference_path(
                Section(
                    file_name=file_name,
                    anchor=anchor,
                    level=level,
                    title=title,
                    chapter_title=chapter_title,
                    parent_titles=parent_titles,
                    locator=locator,
                    page_start=page_start,
                    page_end=page_end,
                    search_text="",
                    path_search="",
                    title_token_set=frozenset(),
                    path_token_set=frozenset(),
                    token_set=frozenset(),
                )
            )
            path_search = normalize_search_text(path_label)
            search_text = normalize_search_text(segment)
            token_set = frozenset(tokenize(f"{path_label} {segment}"))
            title_token_set = frozenset(tokenize(title))
            path_token_set = frozenset(tokenize(path_label))
            section = Section(
                file_name=file_name,
                anchor=anchor,
                level=level,
                title=title,
                chapter_title=chapter_title,
                parent_titles=parent_titles,
                locator=locator,
                page_start=page_start,
                page_end=page_end,
                search_text=search_text,
                path_search=path_search,
                title_token_set=title_token_set,
                path_token_set=path_token_set,
                token_set=token_set,
            )
            self.sections.append(section)
            self.sections_by_file[file_name].append(section)
            if level == 1:
                self.chapter_sections_by_file[file_name].append(section)

    def _build_idf(self) -> None:
        if not self.sections:
            return
        document_frequency: Counter[str] = Counter()
        for section in self.sections:
            document_frequency.update(section.token_set)
        total_sections = len(self.sections)
        self.idf = {
            token: 1.0 + math.log((total_sections + 1) / (count + 1))
            for token, count in document_frequency.items()
        }

    def allowed_files(self, domain: str | None) -> set[str] | None:
        if self.certification == "Security+":
            return self.security_plus_domain_map.get(str(domain or "").strip())
        if self.certification == "CISSP":
            file_name = self.cissp_domain_map.get(str(domain or "").strip())
            return {file_name} if file_name else None
        return None

    def choose_fallback(self, domain: str | None) -> Section:
        allowed = self.allowed_files(domain)
        candidate_files = sorted(allowed) if allowed else sorted(self.chapter_sections_by_file)
        if not candidate_files:
            if not self.sections:
                raise ValueError(f"No sections indexed for {self.material_path}")
            return self.sections[0]
        file_name = candidate_files[0]
        chapters = self.chapter_sections_by_file.get(file_name)
        if chapters:
            return chapters[0]
        return self.sections_by_file[file_name][0]

    def match_question(self, question: dict) -> tuple[Section, float, list[str], bool]:
        domain = str(question.get("domain") or "").strip()
        allowed = self.allowed_files(domain)
        candidates = self.sections
        if allowed:
            narrowed = [section for section in self.sections if section.file_name in allowed]
            if narrowed:
                candidates = narrowed
        non_chapter_candidates = [section for section in candidates if section.level >= 2]
        if non_chapter_candidates:
            candidates = non_chapter_candidates

        phrases = build_search_phrases(question)
        corpus_parts = [question.get("question") or "", question.get("justification") or "", domain]
        corpus_parts.extend(question.get("tags") or [])
        corpus_parts.extend(
            str(option.get("text") or "")
            for option in question.get("options") or []
            if isinstance(option, dict)
        )
        question_tokens = tokenize(" ".join(corpus_parts))
        token_counts = Counter(question_tokens)
        token_set = set(token_counts)
        normalized_domain = normalize_search_text(domain)

        scored: list[tuple[float, Section, list[str], int, int]] = []
        for section in candidates:
            overlap_tokens = token_set & section.token_set
            overlap_score = sum(self.idf.get(token, 1.0) * min(token_counts[token], 2) for token in overlap_tokens)
            title_score = sum(self.idf.get(token, 1.0) * 3.6 for token in (token_set & section.title_token_set))
            path_score = sum(self.idf.get(token, 1.0) * 1.4 for token in (token_set & section.path_token_set))

            phrase_hits: list[str] = []
            phrase_score = 0.0
            for phrase, weight in phrases.items():
                if phrase in section.path_search:
                    phrase_score += weight * 2.3
                    phrase_hits.append(phrase)
                elif phrase in section.search_text:
                    phrase_score += weight * 1.2
                    phrase_hits.append(phrase)

            level_bias = {1: -1.5, 2: 1.8, 3: 2.4, 4: 1.9, 5: 1.1, 6: 0.6}.get(section.level, 0.0)
            score = overlap_score + title_score + path_score + phrase_score + level_bias

            if allowed and section.file_name in allowed:
                score += 3.0
            if normalized_domain and normalized_domain in section.path_search:
                score += 2.0
            if is_generic_reference_title(section.title):
                score -= 8.0

            scored.append((score, section, phrase_hits, len(overlap_tokens), len(token_set & section.title_token_set)))

        scored.sort(key=lambda item: item[0], reverse=True)
        if not scored:
            fallback = self.choose_fallback(domain)
            return fallback, 0.35, [], True

        best_score, best_section, best_phrase_hits, overlap_count, title_overlap_count = scored[0]
        second_score = scored[1][0] if len(scored) > 1 else 0.0

        best_path_prefix = best_section.path_search
        if best_path_prefix:
            for candidate_score, candidate_section, candidate_phrase_hits, candidate_overlap_count, candidate_title_overlap_count in scored[1:8]:
                if candidate_score < best_score - 2.5:
                    break
                if candidate_section.file_name != best_section.file_name:
                    continue
                if candidate_section.level <= best_section.level:
                    continue
                if not candidate_section.path_search.startswith(best_path_prefix):
                    continue
                if is_generic_reference_title(candidate_section.title):
                    continue
                best_score = candidate_score
                best_section = candidate_section
                best_phrase_hits = candidate_phrase_hits
                overlap_count = candidate_overlap_count
                title_overlap_count = candidate_title_overlap_count
                break

        if (
            is_generic_reference_title(best_section.title) or best_section.level == 1
        ) and len(scored) > 1:
            second = scored[1]
            second_score_value, second_section = second[0], second[1]
            if second_score_value >= best_score - 3.0 and not is_generic_reference_title(second_section.title):
                best_score, best_section, best_phrase_hits, overlap_count, title_overlap_count = second
                second_score = scored[2][0] if len(scored) > 2 else scored[0][0]

        fallback_used = False
        if best_score <= 0:
            best_section = self.choose_fallback(domain)
            best_phrase_hits = []
            overlap_count = 0
            title_overlap_count = 0
            second_score = 0.0
            fallback_used = True

        second_score = next(
            (score for score, section, *_rest in scored if section is not best_section),
            0.0,
        )

        margin = max(best_score - second_score, 0.0)
        confidence = 0.42
        confidence += min(0.18, overlap_count * 0.025)
        confidence += min(0.16, title_overlap_count * 0.04)
        confidence += min(0.14, len(best_phrase_hits) * 0.05)
        confidence += min(0.11, margin * 0.015)
        if best_section.level >= 2:
            confidence += 0.04
        if best_section.level == 1:
            confidence -= 0.05
        if fallback_used:
            confidence -= 0.08
        confidence = max(0.35, min(0.97, round(confidence, 2)))

        match_terms = best_phrase_hits[:4]
        if len(match_terms) < 4:
            overlap_terms = sorted(
                token for token in (token_set & best_section.token_set)
                if token not in STOPWORDS
            )
            for token in overlap_terms:
                if token in match_terms:
                    continue
                match_terms.append(token)
                if len(match_terms) >= 6:
                    break

        return best_section, confidence, match_terms, fallback_used


def build_citation(book: BookIndex, section: Section, confidence: float, match_terms: list[str]) -> dict[str, Any]:
    citation = {
        "source": book.source_name,
        "reference": build_reference_label(section),
        "material_path": str(book.material_path.relative_to(ROOT)),
        "locator": section.locator,
        "page_start": section.page_start,
        "page_end": section.page_end,
        "confidence": confidence,
        "chapter": prettify_chapter_title(section.chapter_title),
    }
    if section.parent_titles:
        citation["section"] = " -> ".join([*section.parent_titles, section.title])
    elif section.title and normalize_search_text(section.title) != normalize_search_text(section.chapter_title):
        citation["section"] = section.title
    if match_terms:
        citation["match_terms"] = match_terms
    return citation


def enrich_questions(question_file: Path, book: BookIndex, write_changes: bool) -> dict[str, Any]:
    payload = json.loads(question_file.read_text(encoding="utf-8"))
    questions = payload.get("questions") if isinstance(payload, dict) else None
    if not isinstance(questions, list):
        raise ValueError(f"Invalid question payload in {question_file}")

    updated = 0
    fallback_count = 0
    confidence_total = 0.0
    low_confidence_ids: list[str] = []
    samples: list[dict[str, Any]] = []

    for question in questions:
        if not isinstance(question, dict):
            continue
        certification = str(question.get("certification") or "").strip()
        if certification != book.certification:
            continue

        section, confidence, match_terms, fallback_used = book.match_question(question)
        if fallback_used:
            fallback_count += 1
        confidence_total += confidence

        citation = build_citation(book, section, confidence, match_terms)
        existing_citations = question.get("citations") if isinstance(question.get("citations"), list) else []
        retained_citations = []
        for item in existing_citations:
            if not isinstance(item, dict):
                continue
            existing_source = str(item.get("source") or "").strip()
            existing_material = str(item.get("material_path") or "").strip()
            if existing_source == book.source_name:
                continue
            if existing_material == citation["material_path"]:
                continue
            retained_citations.append(item)
        retained_citations.append(citation)
        question["citations"] = dedupe_citations(retained_citations)

        source_materials = question.get("source_materials")
        if not isinstance(source_materials, list):
            source_materials = []
        material_path = citation["material_path"]
        if material_path not in source_materials:
            source_materials.append(material_path)
        question["source_materials"] = source_materials

        if confidence < 0.55:
            low_confidence_ids.append(str(question.get("id") or ""))
        if len(samples) < 5:
            samples.append(
                {
                    "id": question.get("id"),
                    "domain": question.get("domain"),
                    "reference": citation["reference"],
                    "confidence": confidence,
                }
            )
        updated += 1

    if write_changes:
        question_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    average_confidence = round((confidence_total / updated), 2) if updated else 0.0
    return {
        "file": str(question_file.relative_to(ROOT)),
        "updated": updated,
        "fallback_count": fallback_count,
        "average_confidence": average_confidence,
        "low_confidence_count": len(low_confidence_ids),
        "low_confidence_ids": low_confidence_ids[:15],
        "samples": samples,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Associate question banks with EPUB sections and pages.")
    parser.add_argument("--write", action="store_true", help="Persist changes to the JSON files.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    security_plus_book = BookIndex(
        material_path=SECURITY_PLUS_BOOK_PATH,
        source_name="CompTIA Security+ Study Guide Exam SY0-701 (EPUB)",
        certification="Security+",
        security_plus_domain_map=SECURITY_PLUS_DOMAIN_CHAPTERS,
    )
    cissp_book = BookIndex(
        material_path=CISSP_BOOK_PATH,
        source_name="CISSP For Dummies (EPUB)",
        certification="CISSP",
        cissp_domain_map=CISSP_DOMAIN_CHAPTER,
    )

    reports = [
        enrich_questions(SECURITY_PLUS_FILE, security_plus_book, args.write),
        enrich_questions(CISSP_FILE, cissp_book, args.write),
    ]

    print(json.dumps({"write": args.write, "reports": reports}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
