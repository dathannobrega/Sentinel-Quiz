from __future__ import annotations

import shutil

import numpy as np
import pytest

from speech.engines.base import ExpectedPhonemes, Posteriors
from speech.g2p import MISAKI_TO_IPA, to_standard_ipa
from speech.phonemes import (
    ctc_forced_align, display_ipa, espeak_words, expected_variants, gop, class_logp, log_softmax,
    quality_for, score_word, score_words, split_units, tokenize_ipa,
)

VOCAB = ["<pad>", "<unk>", "s", "t", "θ", "ɹ", "ɛ", "aɪ", "eɪ", "ɪ", "iː", "ʊɹ", "ᵻ", "k", "j", "ɾ", "i"]
BLANK = 0


def posteriors(frames: list[dict[str, float]], vocab: list[str] = VOCAB, rate: float = 50.0) -> Posteriors:
    """Hand-built posteriors: each frame lists {token: logit}; unspecified tokens get 0."""
    logits = np.zeros((len(frames), len(vocab)), dtype=np.float32)
    for t, frame in enumerate(frames):
        for tok, value in frame.items():
            logits[t, vocab.index(tok)] = value
    return Posteriors(logp=log_softmax(logits), frame_rate=rate, vocab=vocab, blank_id=BLANK, special_ids=frozenset({1}))


B = {"<pad>": 10.0}


def peak(tok: str) -> dict[str, float]:
    return {tok: 10.0}


def test_ctc_forced_alignment_on_hand_built_matrix() -> None:
    # blank, θ, θ, blank, ɹ, blank, blank, ɛ, t, blank
    post = posteriors([B, peak("θ"), peak("θ"), B, peak("ɹ"), B, B, peak("ɛ"), peak("t"), B])
    ids = [VOCAB.index(t) for t in ["θ", "ɹ", "ɛ", "t"]]
    spans = ctc_forced_align(post.logp, ids, BLANK)
    assert spans == [(1, 2), (4, 4), (7, 7), (8, 8)]


def test_ctc_repeated_tokens_need_a_blank() -> None:
    ids = [VOCAB.index("s"), VOCAB.index("s")]
    # two frames cannot hold "s s" (CTC would collapse them); three can.
    assert ctc_forced_align(posteriors([peak("s"), peak("s")]).logp, ids, BLANK) is None
    spans = ctc_forced_align(posteriors([peak("s"), B, peak("s")]).logp, ids, BLANK)
    assert spans == [(0, 0), (2, 2)]
    # too few frames for the sequence at all
    assert ctc_forced_align(posteriors([B]).logp, ids[:1] + [VOCAB.index("t")], BLANK) is None
    assert ctc_forced_align(posteriors([B]).logp, [], BLANK) == []


def test_ctc_alignment_respects_allowed_frames() -> None:
    post = posteriors([peak("s"), B, B, peak("s"), B])
    ids = [VOCAB.index("s")]
    assert ctc_forced_align(post.logp, ids, BLANK) in ([(0, 0)], [(3, 3)])
    allowed = np.zeros((5, 1), dtype=bool)
    allowed[2:, 0] = True
    assert ctc_forced_align(post.logp, ids, BLANK, allowed) == [(3, 3)]


def test_gop_good_vs_bad_phoneme() -> None:
    # Expected θ ɹ ɛ t; the speaker said t ɹ ɛ t ("tret"): θ must score bad and be heard as t.
    post = posteriors([B, peak("t"), B, peak("ɹ"), B, peak("ɛ"), peak("t"), B])
    tokens = ["θ", "ɹ", "ɛ", "t"]
    tok_lp = class_logp(post, post.logp, tokens)
    ids = [VOCAB.index(t) for t in tokens]
    spans = ctc_forced_align(post.logp, ids, BLANK)
    assert spans is not None
    scored = gop(post.logp, tok_lp, spans, post)
    (theta_score, theta_heard), *rest = scored
    assert theta_score < 0.01 and VOCAB[theta_heard] == "t"
    assert all(score > 0.99 for score, _ in rest)
    assert [VOCAB[h] for _s, h in rest] == ["ɹ", "ɛ", "t"]


def test_score_word_window_quality_and_variants() -> None:
    frames = [B] * 5 + [peak("θ"), B, peak("ɹ"), peak("ɛ"), B, peak("t")] + [B] * 5
    post = posteriors(frames)  # 50 fps: the word spans frames 5..10 = 0.10-0.22 s
    good = score_word(post, 0.10, 0.22, [ExpectedPhonemes("θɹˈɛt", ["θ", "ɹ", "ɛ", "t"])])
    assert good is not None and good.score > 0.99
    assert [p.quality for p in good.phonemes] == ["good"] * 4 and good.heard_ipa == "θɹɛt"
    # A second variant that does not match never beats the right one; the best wins.
    best = score_word(post, 0.10, 0.22, [ExpectedPhonemes("tɹˈɛt", ["t", "ɹ", "ɛ", "t"]), ExpectedPhonemes("θɹˈɛt", ["θ", "ɹ", "ɛ", "t"])])
    assert best is not None and best.expected_ipa == "θɹˈɛt"
    wrong = score_word(post, 0.10, 0.22, [ExpectedPhonemes("sɛt", ["s", "ɛ", "t"])])
    assert wrong is not None and wrong.phonemes[0].quality == "bad" and wrong.phonemes[0].heard == "θ"
    assert wrong.score < 0.7 and wrong.phonemes[-1].quality == "good"


def test_score_words_joint_alignment_recovers_cut_word_endings() -> None:
    # Word 1 "θɹɛt" really spans frames 2..9 but the ASR says it ends at frame 4 (0.08 s);
    # the contract's ±0.08 s window would cut the final t, the joint alignment does not.
    frames = [B, B, peak("θ"), B, peak("ɹ"), peak("ɛ"), B, B, B, peak("t"), B, B, peak("s"), peak("ɛ"), peak("t"), B, B]
    post = posteriors(frames)
    threat = [ExpectedPhonemes("θɹˈɛt", ["θ", "ɹ", "ɛ", "t"])]
    tight = score_word(post, 0.04, 0.08, threat)
    assert tight is not None and tight.phonemes[-1].quality == "bad"
    joint = score_words(post, [(0.04, 0.08, threat), (0.24, 0.30, [ExpectedPhonemes("sɛt", ["s", "ɛ", "t"])])])
    assert joint[0] is not None and joint[0].score > 0.99
    assert joint[1] is not None and joint[1].score > 0.99


def test_equivalent_realizations_are_not_errors() -> None:
    # espeak's reduced ᵻ realized as ɪ, and a flap for t, are accent variation.
    post = posteriors([B, peak("s"), peak("ɪ"), peak("k"), B, peak("ɾ"), peak("i"), B])
    res = score_word(post, 0.0, 0.16, [ExpectedPhonemes("sᵻkti", ["s", "ᵻ", "k", "t", "i"])], pad=0.0)
    assert res is not None and res.score > 0.99
    assert [p.heard for p in res.phonemes] == ["s", "ɪ", "k", "ɾ", "i"]


def test_quality_thresholds() -> None:
    assert quality_for(0.75) == "good" and quality_for(0.74) == "fair"
    assert quality_for(0.5) == "fair" and quality_for(0.49) == "bad"


def test_split_units_and_tokenization_to_toy_vocab() -> None:
    zwj = "‍"
    raw = f"sᵻkjˈʊ{zwj}ɹɹᵻɾi"  # espeak-ng --ipa=3 output for "security"
    assert split_units(raw) == ["s", "ᵻ", "k", "j", "ʊɹ", "ɹ", "ᵻ", "ɾ", "i"]
    vocab = {"s", "ᵻ", "k", "j", "ʊɹ", "ɹ", "ɾ", "i", "aɪ", "eɪ", "iː", "ɔː", "ɔːɹ", "θ"}
    assert tokenize_ipa(raw, vocab) == ["s", "ᵻ", "k", "j", "ʊɹ", "ɹ", "ᵻ", "ɾ", "i"]
    # optional: espeak's linking ɹ after an r-coloured token merged away
    assert tokenize_ipa(raw, vocab, merge_linking_r=True) == ["s", "ᵻ", "k", "j", "ʊɹ", "ᵻ", "ɾ", "i"]
    assert tokenize_ipa(f"ˌɔː{zwj}ɹθ", vocab) == ["ɔːɹ", "θ"]
    # a tied unit missing from the vocabulary falls back to longest match, then single chars
    assert tokenize_ipa(f"ɔː{zwj}ɪ", vocab) == ["ɔː"]
    assert tokenize_ipa(f"a{zwj}ɪe{zwj}ɪ", vocab) == ["aɪ", "eɪ"]
    assert tokenize_ipa("ˈiː", vocab) == ["iː"]
    assert display_ipa(raw) == "sᵻkjˈʊɹɹᵻɾi"
    # "_"-separated output (other espeak-ng builds) gives the same units
    assert split_units("s_ᵻ_k_j_ˈʊɹ_ɹ_ᵻ_ɾ_i") == ["s", "ᵻ", "k", "j", "ʊɹ", "ɹ", "ᵻ", "ɾ", "i"]


@pytest.mark.skipif(shutil.which("espeak-ng") is None, reason="espeak-ng not installed")
def test_espeak_tokenization_to_toy_vocab() -> None:
    raw = espeak_words(["threat", "security"])
    assert raw[0] == "θɹˈɛt"
    vocab = {"θ", "ɹ", "ɛ", "t", "s", "ᵻ", "k", "j", "ʊɹ", "ɾ", "i", "ð", "ə", "ɐ", "eɪ"}
    variants = expected_variants(["threat", "security", "a"], vocab)
    assert variants[0][0].tokens == ["θ", "ɹ", "ɛ", "t"] and variants[0][0].ipa == "θɹˈɛt"
    assert [v.tokens for v in variants[1]][:2] == [["s", "ᵻ", "k", "j", "ʊɹ", "ɹ", "ᵻ", "ɾ", "i"], ["s", "ᵻ", "k", "j", "ʊɹ", "ᵻ", "ɾ", "i"]]
    # "a": citation form eɪ first, then the weak forms
    assert [v.tokens for v in variants[2]][:2] == [["eɪ"], ["ɐ"]]


def test_misaki_to_standard_ipa() -> None:
    assert to_standard_ipa("sˈAf") == "sˈeɪf"
    assert to_standard_ipa("ˈIdᵊntəti") == "ˈaɪdəntəti"
    assert to_standard_ipa("ˈWt") == "ˈaʊt"
    assert to_standard_ipa("bˈY") == "bˈɔɪ"
    assert to_standard_ipa("ɡˈO") == "ɡˈoʊ"
    assert to_standard_ipa("ɡˈQ") == "ɡˈəʊ"
    assert to_standard_ipa("sᵻkjˈʊɹəTi") == "sᵻkjˈʊɹəɾi"
    assert to_standard_ipa("ʤˈʌʧ") == "dʒˈʌtʃ"
    assert to_standard_ipa(None) is None
    assert not set(MISAKI_TO_IPA) & set("".join(MISAKI_TO_IPA.values()))
