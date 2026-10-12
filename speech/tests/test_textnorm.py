from __future__ import annotations

from speech.textnorm import compare_key, display_tokens, normalize_text, normalize_word, number_to_words, ordinal_to_words

TRICKY = (
    "Multi-factor authentication (MFA) adds a 2nd layer — it's \"defense-in-depth\"!\n"
    "In 2024, 50% of breaches involved phishing & social engineering; see SY0-701, page 1,234."
)


def test_display_tokens_round_trip_offsets() -> None:
    tokens = display_tokens(TRICKY)
    assert tokens, "expected tokens"
    for tok in tokens:
        assert TRICKY[tok.char_start:tok.char_end] == tok.text
    texts = [t.text for t in tokens]
    assert texts[:4] == ["Multi-factor", "authentication", "MFA", "adds"]
    assert "it's" in texts
    assert "defense-in-depth" in texts
    assert "50%" in texts
    assert "&" in texts
    assert "SY0-701" in texts
    # offsets are strictly increasing and never overlap
    for a, b in zip(tokens, tokens[1:]):
        assert a.char_end <= b.char_start


def test_display_tokens_skip_punctuation_only_runs() -> None:
    tokens = display_tokens("security - awareness -- training ... ok")
    assert [t.text for t in tokens] == ["security", "awareness", "training", "ok"]


def test_number_to_words() -> None:
    assert number_to_words(0) == "zero"
    assert number_to_words(13) == "thirteen"
    assert number_to_words(42) == "forty-two"
    assert number_to_words(100) == "one hundred"
    assert number_to_words(701) == "seven hundred one"
    assert number_to_words(2024) == "two thousand twenty-four"
    assert number_to_words(9999) == "nine thousand nine hundred ninety-nine"


def test_ordinals() -> None:
    assert ordinal_to_words(1) == "first"
    assert ordinal_to_words(2) == "second"
    assert ordinal_to_words(3) == "third"
    assert ordinal_to_words(12) == "twelfth"
    assert ordinal_to_words(20) == "twentieth"
    assert ordinal_to_words(21) == "twenty-first"
    assert ordinal_to_words(101) == "one hundred first"


def test_normalize_word() -> None:
    assert normalize_word("Security.") == "security"
    assert normalize_word("Don’t") == "don't"
    assert normalize_word("'cause") == "cause"
    assert normalize_word("multi-factor") == "multi-factor"
    assert normalize_word("2nd") == "second"
    assert normalize_word("2024") == "two thousand twenty-four"
    assert normalize_word("50%") == "fifty percent"
    assert normalize_word("&") == "and"
    assert normalize_word("...") == ""
    assert normalize_word("SY0-701") == "sy0-701"


def test_normalize_text_expands_to_single_words() -> None:
    assert normalize_text("I read 2 books & 50% of a 3rd.") == [
        "i", "read", "two", "books", "and", "fifty", "percent", "of", "a", "third",
    ]


def test_compare_key_ignores_hyphens() -> None:
    assert compare_key("multi-factor") == compare_key("multifactor")
    assert compare_key("fifty percent") == compare_key("fiftypercent")
