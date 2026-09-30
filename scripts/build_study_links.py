"""Build backend/app/data/study_links.json: question → book sections that explain it.

Usage (repo root, books mounted/converted under material/json):

    python3 scripts/build_study_links.py            # write the links file and print a report
    python3 scripts/build_study_links.py --check    # report only, do not write
    python3 scripts/build_study_links.py --sample 12 # also print random links for manual review

The output holds only section ids and scores (no book text), so it is committed with the code;
the API resolves ids against MATERIAL_DIR/json at runtime. Re-run after adding questions or
re-converting books.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services.material_corpus import build_corpus  # noqa: E402
from app.services.material_linker import LinkQuestion, QuestionLinker, certification_key  # noqa: E402

OUTPUT = REPO_ROOT / "backend" / "app" / "data" / "study_links.json"


def load_questions(questions_dir: Path) -> list[LinkQuestion]:
    questions: list[LinkQuestion] = []
    seen: set[str] = set()
    for path in sorted(questions_dir.rglob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        items = raw if isinstance(raw, list) else raw.get("questions") if isinstance(raw, dict) else None
        for item in items or []:
            if not isinstance(item, dict):
                continue
            question_id = str(item.get("id") or "").strip()
            options = [(str(option.get("key")), str(option.get("text") or "")) for option in item.get("options") or [] if isinstance(option, dict)]
            if not question_id or not options or question_id in seen:
                continue
            seen.add(question_id)
            questions.append(
                LinkQuestion(
                    id=question_id,
                    certification=item.get("certification"),
                    prompt=str(item.get("question") or item.get("prompt") or ""),
                    options=options,
                    correct_keys=[str(key) for key in item.get("correct_options") or item.get("correct_keys") or []],
                    justification=str(item.get("justification") or ""),
                    domain=item.get("domain"),
                    module_code=item.get("module_code"),
                    citations=[citation for citation in item.get("citations") or [] if isinstance(citation, dict)],
                )
            )
    return questions


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--material", default=str(REPO_ROOT / "material" / "json"))
    parser.add_argument("--questions", default=str(REPO_ROOT / "questions"))
    parser.add_argument("--check", action="store_true", help="report only; do not write the links file")
    parser.add_argument("--sample", type=int, default=0, help="print N random links for manual review")
    args = parser.parse_args()

    corpus = build_corpus(Path(args.material))
    if not corpus.sections:
        print(f"No books found under {args.material}", file=sys.stderr)
        return 1
    linker = QuestionLinker(corpus)
    questions = load_questions(Path(args.questions))

    links: dict[str, dict] = {}
    stats: Counter[str] = Counter()
    by_bank: dict[str, Counter[str]] = {}
    samples: list[tuple[LinkQuestion, object]] = []
    for question in questions:
        result = linker.link(question)
        cert = certification_key(question.certification) or "other"
        language = "pt" if any(word in question.prompt.lower() for word in (" um ", " uma ", " qual ", " não ", "ção")) else "en"
        bucket = by_bank.setdefault(f"{cert}/{language}", Counter())
        bucket["questions"] += 1
        if result is None or not result.sections:
            bucket["unlinked"] += 1
            continue
        bucket["linked"] += 1
        bucket["option_links"] += len(result.options)
        if result.cited_section:
            bucket["with_citation"] += 1
            subtree = linker._subtree(corpus.get(result.cited_section))
            top_ids = [section_id for section_id, _ in result.sections]
            if top_ids[0] in subtree:
                bucket["top1_in_cited"] += 1
            if any(section_id in subtree for section_id in top_ids):
                bucket["top3_in_cited"] += 1
            cited = corpus.get(result.cited_section)
            # Fair agreement: links may come from another book (equally valid), so compare only the
            # best link from the cited book with the cited section's subtree.
            same_book = [section_id for section_id in top_ids if corpus.get(section_id).book_slug == cited.book_slug]
            if same_book:
                bucket["with_same_book"] += 1
                if same_book[0] in subtree:
                    bucket["same_book_in_cited"] += 1
        links[question.id] = {
            "sections": [[section_id, score] for section_id, score in result.sections],
            "options": {key: [section_id, score] for key, (section_id, score) in result.options.items()},
        }
        samples.append((question, result))
        stats["linked"] += 1

    print(f"Corpus: {len(corpus.books)} books, {len(corpus.sections)} sections ({len(corpus.linkable())} linkable)")
    print(f"Questions: {len(questions)}, linked: {stats['linked']}")
    for bank, counter in sorted(by_bank.items()):
        cited = counter["with_citation"] or 0
        rate = lambda key: f"{counter[key] * 100 / cited:.0f}%" if cited else "n/a"  # noqa: E731
        print(
            f"  {bank:<12} questions={counter['questions']:<5} linked={counter['linked']:<5} option-links={counter['option_links']:<5}"
            f" cited={cited:<5} top1∈cited={rate('top1_in_cited'):<5} top3∈cited={rate('top3_in_cited'):<5}"
            f" same-book best∈cited={counter['same_book_in_cited'] * 100 / max(counter['with_same_book'], 1):.0f}% (of {counter['with_same_book']})"
        )

    if args.sample:
        random.seed(7)
        for question, result in random.sample(samples, min(args.sample, len(samples))):
            print(f"\n[{question.id}] {question.prompt[:110]}")
            for section_id, score in result.sections:
                section = corpus.get(section_id)
                print(f"   {score:>6.1f}  {section.book_slug[:22]:<22} {' > '.join(section.path[-3:])[:110]}")
            for key, (section_id, score) in result.options.items():
                section = corpus.get(section_id)
                option = dict(question.options).get(key, "")[:40]
                print(f"   opt {key} {option!r:<44} -> {' > '.join(section.path[-2:])[:70]}")

    if not args.check:
        payload = {
            "version": 1,
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "books": {slug: len(book.section_ids) for slug, book in sorted(corpus.books.items())},
            "questions": dict(sorted(links.items())),
        }
        OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"\nWrote {OUTPUT.relative_to(REPO_ROOT)} ({OUTPUT.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
