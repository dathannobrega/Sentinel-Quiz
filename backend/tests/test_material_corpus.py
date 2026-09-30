"""Normalized material corpus (app.services.material_corpus) on a small synthetic book.

The real books are licensed and never committed, so the fixture below reproduces the converter
output shape: a manifest plus chapter files whose parent sections contain their children's text.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.config import settings
from app.services import material_corpus, materials
from app.services.material_corpus import build_corpus, split_paragraphs

SOURCE = "Fake Security Guide.epub"


def _section(anchor, level, title, own, children=(), parents=(), page=10):
    return {"anchor": anchor, "id": anchor, "level": level, "title": title, "parent_titles": list(parents),
            "page_start": page, "page_end": page + 1, "_own": own, "_children": list(children)}


def _flatten(nodes):
    """Emit document-ordered sections whose content_text includes descendants, like the converter."""
    out = []

    def full_text(node):
        return " ".join([f"{node['title']} {node['_own']}".strip(), *[full_text(child) for child in node["_children"]]]).strip()

    def walk(node):
        record = {key: value for key, value in node.items() if not key.startswith("_")}
        record["content_text"] = full_text(node)
        record["word_count"] = len(record["content_text"].split())
        out.append(record)
        for child in node["_children"]:
            walk(child)

    for node in nodes:
        walk(node)
    return out


def _write_book(root: Path, slug="fake_security_guide", chapters=None):
    book = root / slug
    (book / "chapters").mkdir(parents=True)
    chapters = chapters or {}
    manifest = {"slug": slug, "title": "Fake Security Guide", "source_file": SOURCE, "certification": "CompTIA Security+ (SY0-701)", "chapters": []}
    for index, (file_name, (title, nodes)) in enumerate(chapters.items(), start=1):
        stem = file_name.split(".")[0]
        (book / "chapters" / f"{stem}.json").write_text(
            json.dumps({"chapter_index": index, "file_name": file_name, "title": title, "sections": _flatten(nodes)}),
            encoding="utf-8",
        )
        manifest["chapters"].append({"chapter_index": index, "file_name": file_name, "title": title, "json_file": f"chapters/{stem}.json"})
    (book / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return book


@pytest.fixture()
def corpus_root(tmp_path):
    json_root = tmp_path / "json"
    _write_book(
        json_root,
        chapters={
            "c01.xhtml": (
                "Chapter 1: Social Engineering",
                [
                    _section("c01_1", 1, "Chapter 1 Social Engineering",
                             "This chapter covers objectives 2.2 Explain common threat vectors and 2.4 Analyze indicators.",
                             children=[
                                 _section("head-2-1", 2, "Phishing", "Phishing uses fraudulent email to steal credentials. It is the most common vector.",
                                          children=[
                                              _section("head-3-1", 3, "Whaling", "Whaling targets senior executives such as the CEO with tailored lures."),
                                              _section("head-3-2", 3, "Exam Note", "Remember that whaling is spear phishing aimed at executives."),
                                          ]),
                                 _section("head-2-2", 2, "Review Questions", "1. Which attack targets executives? A. Whaling B. Vishing"),
                             ]),
                ],
            ),
            "c02.xhtml": (
                "Chapter 2: Security Assessment and Testing",
                [_section("c02_1", 1, "Chapter 2 Security Assessment and Testing",
                          "Objectives 4.3 vulnerability management. Vulnerability scans identify weaknesses before attackers do.")],
            ),
        },
    )
    return json_root


def test_sections_keep_only_their_own_text(corpus_root):
    corpus = build_corpus(corpus_root)
    phishing = corpus.get("fake_security_guide:c01:head-2-1")
    assert phishing is not None
    assert "fraudulent email" in phishing.text
    assert "senior executives" not in phishing.text  # child text stays in the child
    whaling = corpus.get("fake_security_guide:c01:head-3-1")
    assert whaling.parent_id == phishing.id and whaling.id in phishing.child_ids
    assert whaling.path == ("Chapter 1 Social Engineering", "Phishing", "Whaling")


def test_sidebars_fold_into_the_preceding_section_and_keep_resolving(corpus_root):
    corpus = build_corpus(corpus_root)
    assert corpus.get("fake_security_guide:c01:head-3-2") is None
    # The box's text physically follows "Whaling", so it is read as part of it (reading order).
    whaling = corpus.get("fake_security_guide:c01:head-3-1")
    labelled = [block for block in whaling.blocks if block.label == "Exam Note"]
    assert labelled and "spear phishing aimed at executives" in labelled[0].text
    # A legacy citation pointing at the sidebar anchor resolves to that host section.
    resolved = corpus.resolve_locator(f"material/{SOURCE}", "OPS/c01.xhtml#head-3-2")
    assert resolved is not None and resolved.id == whaling.id


def test_kinds_objectives_and_linkable(corpus_root):
    corpus = build_corpus(corpus_root)
    review = corpus.get("fake_security_guide:c01:head-2-2")
    assert review.kind == "review"
    assessment = corpus.get("fake_security_guide:c02:c02_1")
    assert assessment.kind == "teach"  # "Security Assessment and Testing" is a domain, not a quiz
    assert corpus.get("fake_security_guide:c01:head-3-1").objectives == ("2.2", "2.4")
    assert corpus.get("fake_security_guide:c01:head-3-1").domains == (2,)
    linkable_ids = {section.id for section in corpus.linkable()}
    assert review.id not in linkable_ids


def test_resolve_locator_accepts_legacy_epub_citations(corpus_root):
    corpus = build_corpus(corpus_root)
    section = corpus.resolve_locator(f"material/{SOURCE}", "OPS/c01.xhtml#head-3-1")
    assert section is not None and section.title == "Whaling"
    assert corpus.resolve_locator("material/Other Book.epub", "OPS/c01.xhtml#head-3-1") is None


def test_excluded_books_are_skipped(tmp_path):
    root = tmp_path / "json"
    _write_book(root, slug="ceh_certified_ethical_hacker_v13_study_guide",
                chapters={"ch01.json": ("Chapter 1", [_section("sec-1", 1, "Ethics", "Some text here.")])})
    assert build_corpus(root).sections == {}


def test_split_paragraphs_groups_whole_sentences():
    text = " ".join(f"Sentence number {index} has several words in it." for index in range(30))
    paragraphs = split_paragraphs(text, target_words=40)
    assert len(paragraphs) > 1
    assert all(paragraph.endswith(".") for paragraph in paragraphs)
    assert " ".join(paragraphs) == text


def test_preview_falls_back_to_json_when_epub_is_missing(login_client, tmp_path, monkeypatch, corpus_root):
    client, _user = login_client()
    monkeypatch.setattr(settings, "material_dir", str(tmp_path))
    materials.clear_material_index_cache()
    material_corpus.clear_corpus_cache()

    response = client.get(
        "/api/materials/preview",
        params={"material_path": f"material/{SOURCE}", "locator": "OPS/c01.xhtml#head-2-1"},
    )
    assert response.status_code == 200
    assert "fraudulent email" in response.text
    assert "senior executives" in response.text  # subsections are included, like the EPUB preview
    assert "Exam Note" in response.text

    missing = client.get("/api/materials/preview", params={"material_path": "material/Unknown.epub", "locator": "OPS/c01.xhtml#x"})
    assert missing.status_code == 404
