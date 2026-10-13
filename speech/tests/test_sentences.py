from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from speech.textnorm import MAX_SENTENCE_CHARS, display_tokens, split_sentences
from tests.test_api import make_client

# Mirror of backend/app/services/material_corpus.py::_SENTENCE_BREAK (parity check).
CORPUS_BREAK = re.compile(r"(?<=[.!?:])\s+(?=[A-Z0-9“\"(•])")

PARAGRAPH = (
    "Security awareness training teaches employees to recognize phishing. "
    "Multifactor authentication adds a second layer of defense! Does it stop every attack? "
    "No: it raises the cost for the attacker. 2024 saw more credential theft than ever. "
    "“Quoted” sentences start with a curly quote. (Parenthetical ones too.) • Bullets as well."
)


def _texts(text: str) -> list[str]:
    return [text[a:b] for a, b in split_sentences(text)]


def test_corpus_regex_parity() -> None:
    """Every boundary the corpus regex produces is a boundary here (modulo short-fragment merging)."""
    corpus = [part.strip() for part in CORPUS_BREAK.split(PARAGRAPH) if part.strip()]
    ours = _texts(PARAGRAPH)
    # "No: it raises..." keeps the colon break; ")" before the space is not a break (same as the corpus).
    assert ours == corpus
    assert ours[0] == "Security awareness training teaches employees to recognize phishing."
    assert ours[2] == "Does it stop every attack?"
    assert ours[4] == "2024 saw more credential theft than ever."
    assert ours[5] == "“Quoted” sentences start with a curly quote."
    assert ours[-1] == "(Parenthetical ones too.) • Bullets as well."
    assert _texts("First one here. • Second bullet here.") == ["First one here.", "• Second bullet here."]


def test_no_break_before_lowercase_or_inside_abbreviations() -> None:
    text = "See e.g. the appendix. it continues in lowercase. Then a new sentence."
    assert _texts(text) == ["See e.g. the appendix. it continues in lowercase.", "Then a new sentence."]


def test_short_fragments_merge_into_neighbour() -> None:
    text = "Yes. Security awareness training works well. It does. Really well indeed. Ok."
    assert _texts(text) == ["Yes. Security awareness training works well. It does.", "Really well indeed. Ok."]
    # A short opener with nothing before it joins the sentence that follows.
    assert _texts("Note: Phishing is the top threat.") == ["Note: Phishing is the top threat."]
    # A block that is only short fragments stays one sentence.
    assert _texts("Hi. There.") == ["Hi. There."]


def test_offsets_round_trip_and_never_overlap() -> None:
    text = "  Leading spaces.  Then two spaces between sentences.\n\nAnd a paragraph break here.  "
    spans = split_sentences(text)
    assert spans
    for a, b in spans:
        assert not text[a].isspace() and not text[b - 1].isspace()
    for (a, b), (c, _d) in zip(spans, spans[1:]):
        assert b <= c
    assert "".join(text[a:b] for a, b in spans).replace(" ", "") == text.replace(" ", "").replace("\n", "")
    assert split_sentences("") == [] and split_sentences("   \n ") == []


def test_long_sentence_is_capped_at_comma_or_space() -> None:
    clauses = ", ".join(f"clause number {i} has several words in it" for i in range(20)) + "."
    assert len(clauses) > 2 * MAX_SENTENCE_CHARS
    spans = split_sentences(clauses)
    assert len(spans) >= 3
    for a, b in spans:
        assert b - a <= MAX_SENTENCE_CHARS
        assert not clauses[a].isspace() and not clauses[b - 1].isspace()
        # cut right after a comma: the left part ends with "," and the right part starts a clause
    assert all(clauses[b - 1] == "," for _a, b in spans[:-1])
    # No words lost: the tokens of the parts are the tokens of the whole.
    whole = [t.text for t in display_tokens(clauses)]
    parts = [t.text for a, b in spans for t in display_tokens(clauses[a:b])]
    assert parts == whole

    no_commas = " ".join(["word"] * 150) + "."
    spans = split_sentences(no_commas)
    assert all(b - a <= MAX_SENTENCE_CHARS for a, b in spans) and len(spans) == 2
    assert sum(len(display_tokens(no_commas[a:b])) for a, b in spans) == 150


def test_giant_token_is_hard_split() -> None:
    token = "x" * 1000
    spans = split_sentences(token)
    assert all(b - a <= MAX_SENTENCE_CHARS for a, b in spans)
    assert "".join(token[a:b] for a, b in spans) == token


# ------------------------------------------------------------- service level
BLOCK = (
    "Security awareness training teaches employees to recognize phishing. "
    "Multifactor authentication adds a second layer of defense. "
    "Together they stop most credential theft."
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    yield from make_client(tmp_path, monkeypatch, SPEECH_AUDIO_FORMAT="wav")


def test_sentence_outputs_match_block_output(client: TestClient) -> None:
    service = client.app.state.service
    sentences = list(service.synthesize_sentences(BLOCK, "af_heart", 1.0, "en-us"))
    assert len(sentences) == 3 and [s.index for s in sentences] == [0, 1, 2]
    assert all(s.cached is False for s in sentences)
    for s in sentences:
        assert BLOCK[s.char_start:s.char_end] == s.text
        assert s.duration_seconds > 0 and s.words
        for w in s.words:
            assert BLOCK[w["char_start"]:w["char_end"]] == w["text"]  # offsets relative to the BLOCK
            assert 0 <= w["start"] < w["end"] <= s.duration_seconds + 1e-3  # times relative to the sentence
    # Second pass: everything comes from the sentence cache.
    again = list(service.synthesize_sentences(BLOCK, "af_heart", 1.0, "en-us"))
    assert all(s.cached for s in again)
    assert [s.audio_id for s in again] == [s.audio_id for s in sentences]
    assert [s.words for s in again] == [s.words for s in sentences]

    calls = {"n": 0}
    original = service.tts.synthesize

    def counting(*args, **kwargs):
        calls["n"] += 1
        return original(*args, **kwargs)

    service.tts.synthesize = counting  # type: ignore[method-assign]
    block = service.synthesize(BLOCK, "af_heart", 1.0, "en-us")
    assert calls["n"] == 0, "a block whose sentences are cached must not synthesize"
    assert block.audio_id == service.tts_audio_id(BLOCK, "af_heart", 1.0, "en-us")
    assert block.duration_seconds == pytest.approx(sum(s.duration_seconds for s in sentences), abs=1e-3)
    # Block words = sentence words shifted by the sentence offsets.
    expected = []
    offset = 0.0
    for s in sentences:
        for w in s.words:
            expected.append({**w, "start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3)})
        offset += s.duration_seconds
    assert block.words == expected
    for w in block.words:
        assert BLOCK[w["char_start"]:w["char_end"]] == w["text"]
    # /v1/tts and /v1/audio serve the block and every sentence.
    res = client.post("/v1/tts", json={"text": BLOCK})
    assert res.status_code == 200 and res.json()["audio_id"] == block.audio_id and res.json()["cached"] is True
    for s in sentences:
        assert client.get(f"/v1/audio/{s.audio_id}").status_code == 200


def test_block_from_cold_cache_and_pcm_lru_miss(client: TestClient) -> None:
    """Sentences cached on disk but no longer in the PCM LRU: the block decodes the cached files."""
    service = client.app.state.service
    sentences = list(service.synthesize_sentences(BLOCK, "af_heart", 1.0, "en-us"))
    service._pcm_lru._items.clear()
    block = service.synthesize(BLOCK, "af_heart", 1.0, "en-us")
    assert block.duration_seconds == pytest.approx(sum(s.duration_seconds for s in sentences), abs=1e-3)
    assert block.words[-1]["end"] == pytest.approx(block.duration_seconds, abs=1e-3)


def test_single_sentence_block_is_the_sentence(client: TestClient) -> None:
    service = client.app.state.service
    text = "Security awareness training teaches employees to recognize phishing."
    block = service.synthesize(text, "af_heart", 1.0, "en-us")
    sentence = service.cached_sentence(text, (0, len(text)), "af_heart", 1.0, "en-us")
    assert sentence is not None and sentence.audio_id == block.audio_id
    assert sentence.words == block.words
