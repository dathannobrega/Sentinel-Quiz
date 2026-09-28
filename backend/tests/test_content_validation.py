"""The shipped question banks must pass scripts/validate_content.py (M-A5)."""
from __future__ import annotations

import contextlib
import copy
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "validate_content.py"


def load_validator():
    spec = importlib.util.spec_from_file_location("validate_content", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ContentValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = load_validator()

    def run_validator(self, *args: str) -> tuple[int, str]:
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = self.validator.main(list(args))
        return code, buffer.getvalue()

    def test_repository_banks_have_no_errors(self) -> None:
        code, output = self.run_validator()
        self.assertEqual(code, 0, output[-3000:])
        self.assertIn("0 error(s)", output)

    def test_detects_answer_outside_options_and_multi_select_mismatch(self) -> None:
        data = json.loads((REPO / "questions" / "securityplus.json").read_text(encoding="utf-8"))
        broken = copy.deepcopy(data)
        broken["questions"] = broken["questions"][:3]
        broken["exam"]["question_count"] = 3
        broken["questions"][0]["correct_options"] = ["Z"]
        broken["questions"][1]["multi_select"] = True
        broken["questions"][2]["language"] = None
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.json"
            path.write_text(json.dumps(broken, ensure_ascii=False), encoding="utf-8")
            code, output = self.run_validator(str(path))
        self.assertEqual(code, 1)
        self.assertIn("not among option keys", output)
        self.assertIn("multi_select=True", output)
        self.assertIn("language must be one of", output)


if __name__ == "__main__":
    unittest.main()
