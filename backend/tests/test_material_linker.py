"""Offline question → section linking (app.services.material_linker) on a synthetic book."""
from __future__ import annotations

from app.services.material_corpus import build_corpus
from app.services.material_linker import LinkQuestion, QuestionLinker, certification_key, tokenize

from test_material_corpus import SOURCE, _write_book
from test_material_corpus import _section as _raw_section

# Linkable sections need >= 40 words; the same neutral padding in every section keeps scoring
# driven by the real content.
PADDING = " This part of the guide explains the idea step by step so that readers can apply it on the job." * 3


def _section(anchor, level, title, own, children=(), parents=(), page=10):
    return _raw_section(anchor, level, title, own + PADDING, children=children, parents=parents, page=page)


def _corpus(tmp_path):
    root = tmp_path / "json"
    _write_book(
        root,
        chapters={
            "c01.xhtml": (
                "Chapter 1: Threats",
                [
                    _section("c01_1", 1, "Chapter 1 Threats", "Objectives 2.2 and 2.4 are covered here.", children=[
                        _section("head-2-1", 2, "Social Engineering",
                                 "Social engineering manipulates people. Impersonation means pretending to be someone else, "
                                 "such as a help desk technician or a manager, to gain trust and access.", children=[
                                     _section("head-3-1", 3, "Whaling",
                                              "Whaling is spear phishing aimed at senior executives such as the CEO. "
                                              "Attackers impersonating the CEO ask staff to buy gift cards."),
                                     _section("head-3-2", 3, "Smishing",
                                              "Smishing is phishing delivered by SMS text messages to mobile phones."),
                                 ]),
                        _section("head-2-9", 2, "Review Questions",
                                 "1. An attacker impersonating the CEO asks for gift cards. Which attack is this? whaling smishing"),
                    ]),
                ],
            ),
            "c02.xhtml": (
                "Chapter 2: Cryptography",
                [_section("c02_1", 1, "Chapter 2 Cryptography", "Objectives 1.4 cryptographic solutions.", children=[
                    _section("head-2-5", 2, "Hashing", "A hash function produces a fixed-length digest; SHA-256 provides integrity."),
                ])],
            ),
        },
    )
    return build_corpus(root)


def _question(**overrides):
    base = dict(
        id="q1",
        certification="Security+",
        prompt="Um atacante se passando pelo diretor executivo (CEO) liga para um funcionário e pede cartões-presente.",
        options=[("A", "Smishing"), ("B", "Desinformação (Disinformation)"), ("D", "Whaling")],
        correct_keys=["D"],
        justification="Whaling é uma forma de spear phishing direcionada a executivos.",
        domain="Threats, Vulnerabilities and Mitigations",
    )
    base.update(overrides)
    return LinkQuestion(**base)


def test_tokenize_folds_accents_and_translates_portuguese_terms():
    tokens = tokenize("Criptografia e autenticação")
    assert {"criptografia", "encryption", "cryptography", "autenticacao", "authentication"} <= set(tokens)
    assert "e" not in tokens


def test_certification_key():
    assert certification_key("CompTIA Security+ (SY0-701)") == "secplus"
    assert certification_key("ISC2 CISSP") == "cissp"
    assert certification_key("EC-Council CEH") == "ceh"
    assert certification_key("Unknown") is None


def test_portuguese_question_links_to_the_english_section(tmp_path):
    corpus = _corpus(tmp_path)
    result = QuestionLinker(corpus).link(_question())
    assert result is not None
    assert result.sections[0][0] == "fake_security_guide:c01:head-3-1"  # Whaling
    linked = {section_id for section_id, _ in result.sections}
    assert "fake_security_guide:c01:head-2-9" not in linked  # review questions are never linked


def test_wrong_options_link_only_to_sections_named_after_the_concept(tmp_path):
    corpus = _corpus(tmp_path)
    result = QuestionLinker(corpus).link(_question())
    assert result.options["A"][0] == "fake_security_guide:c01:head-3-2"  # Smishing heading
    assert "B" not in result.options  # no "Disinformation" heading: no link beats a wrong one
    assert "D" not in result.options  # the correct option is not a distractor


def test_legacy_citation_is_reported_and_boosts_its_subtree(tmp_path):
    corpus = _corpus(tmp_path)
    citation = {"material_path": f"material/{SOURCE}", "locator": "OPS/c01.xhtml#head-2-1", "match_terms": ["impersonation"]}
    result = QuestionLinker(corpus).link(_question(citations=[citation]))
    assert result.cited_section == "fake_security_guide:c01:head-2-1"
    assert result.sections[0][0] in {"fake_security_guide:c01:head-3-1", "fake_security_guide:c01:head-2-1"}


def test_unknown_certification_is_not_linked(tmp_path):
    corpus = _corpus(tmp_path)
    assert QuestionLinker(corpus).link(_question(certification="AWS")) is None
