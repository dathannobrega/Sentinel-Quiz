"""Official justifications cite option letters; with per-session shuffle they must follow display keys."""
import json

from app.services.option_order import OptionMapping


def _mapping(order):
    return OptionMapping.build(json.dumps(order), ["A", "B", "C", "D"])


def test_swap_does_not_chain():
    # Display order C, A, B, D -> original C shows as A, A as B, B as C.
    mapping = _mapping(["C", "A", "B", "D"])
    assert mapping.remap_text("**Correct Answer:** B. Because") == "**Correct Answer:** C. Because"
    assert mapping.remap_text("A alternativa C está correta; a opção A não.") == "A alternativa A está correta; a opção B não."


def test_reference_forms_from_content():
    mapping = _mapping(["D", "C", "B", "A"])  # A<->D, B<->C
    text = (
        "A resposta correta é B.\n"
        "A) Wrong because...\n"
        "- **B)** Right because...\n"
        "Veja também (C) e as opções A e D."
    )
    expected = (
        "A resposta correta é C.\n"
        "D) Wrong because...\n"
        "- **C)** Right because...\n"
        "Veja também (B) e as opções D e A."
    )
    assert mapping.remap_text(text) == expected


def test_prose_is_untouched():
    mapping = _mapping(["B", "A", "C", "D"])
    prose = "The answer is a matter of policy. A firewall is not enough. Option: see RFC."
    assert mapping.remap_text(prose) == prose


def test_identity_when_not_shuffled():
    mapping = OptionMapping.build(None, ["A", "B", "C", "D"])
    text = "Correct Answer: B"
    assert mapping.remap_text(text) == text
    assert mapping.remap_text(None) is None
