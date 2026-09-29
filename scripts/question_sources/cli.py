"""``python -m scripts.question_sources <command>`` (run from the repository root).

Commands:
  list                                   sources, license and status
  fetch <id>                             clone at the pinned commit into the cache (outside the repo)
  extract <id> [--source-dir DIR]        adapter -> <cache>/<id>/extracted.json
  validate <file>                        schema v3 + provenance (exit 1 on errors)
  dedupe <file> [--threshold 0.9]        duplicates vs questions/*.json (exact + difflib)
  review-apply <file> <review.json> [--out F] [--keep-flagged] [--drop-unreviewed]
  import <id> [--from FILE] [--permission-evidence FILE] [--note TEXT]
                                         license gate, then questions/imports/<id>.json
  import <id> --personal-use [--authorization FILE] [--note TEXT]
                                         private-study source -> questions/local/<id>.json
                                         (git/docker-ignored; never committed nor shipped)

The cache defaults to ~/.cache/sentinel-quiz/sources (override with SQ_SOURCES_CACHE).
Never commit extracted third-party content: only `import` writes into the repository,
and only for approved sources.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import registry as reg
from . import workflow


def _print(payload) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def cmd_list(args) -> int:
    registry = reg.load_registry()
    for source in registry["sources"]:
        stats = source.get("review_stats") or {}
        summary = f"{stats.get('correct_percent')}% correct / {stats.get('reviewed')} reviewed" if stats else "no review"
        print(f"{source['id']:42} {source['status']:20} {source['license']:12} {summary}")
        if args.verbose:
            print(f"    {source['url']} @ {source['commit']}")
            print(f"    {source['reason']}")
    return 0


def cmd_fetch(args) -> int:
    source = reg.get_source(reg.load_registry(), args.source_id)
    path = workflow.fetch(source)
    print(f"{source['id']} @ {source['commit']} -> {path}")
    return 0


def cmd_extract(args) -> int:
    source = reg.get_source(reg.load_registry(), args.source_id)
    path, stats = workflow.extract_to_cache(source, Path(args.source_dir) if args.source_dir else None)
    _print({"output": str(path), **stats})
    return 0


def cmd_validate(args) -> int:
    errors, warnings = workflow.validate(Path(args.file), require_provenance=not args.no_provenance)
    for category, items in sorted(warnings.items()):
        print(f"WARNING [{category}]: {len(items)}")
    for error in errors:
        print(f"ERROR: {error}")
    print(f"{len(errors)} error(s)")
    return 1 if errors else 0


def cmd_dedupe(args) -> int:
    report = workflow.dedupe(Path(args.file), threshold=args.threshold)
    if args.report:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    _print({key: report[key] for key in ("file", "threshold", "candidates", "duplicates")})
    for match in report["matches"][: args.show]:
        print(f"  {match['id']} ~ {match['bank']}:{match['match']} ({'exact' if match['exact'] else match['ratio']})")
    return 0


def cmd_review_apply(args) -> int:
    stats = workflow.apply_review(
        Path(args.file),
        Path(args.review),
        out=Path(args.out) if args.out else None,
        keep_flagged=args.keep_flagged,
        drop_unreviewed=args.drop_unreviewed,
    )
    _print(stats)
    return 0


def cmd_import(args) -> int:
    registry = reg.load_registry()
    source = reg.get_source(registry, args.source_id)
    if args.permission_evidence:
        reg.record_permission(registry, source["id"], Path(args.permission_evidence), note=args.note)
        reg.save_registry(registry)
        print(f"permission recorded: {source['id']} is now approved")
    if args.authorization:
        if not args.personal_use:
            raise reg.RegistryError("--authorization records a private-study authorization: pass --personal-use too")
        reg.record_personal_use(registry, source["id"], Path(args.authorization), note=args.note)
        reg.save_registry(registry)
        print(f"personal-use authorization recorded: {source['id']} -> questions/local/ only")
    reg.check_import_allowed(source, personal_use=args.personal_use)
    if args.input:
        input_path = Path(args.input)
    else:
        reviewed = workflow.work_file(source, "reviewed.json")
        input_path = reviewed if reviewed.is_file() else workflow.work_file(source, "extracted.json")
    if not input_path.is_file():
        raise workflow.PipelineError(f"{input_path} not found: run fetch/extract (and review-apply) first")
    _print(workflow.import_source(source, input_path, personal_use=args.personal_use))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m scripts.question_sources", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list", help="list the registry")
    p.add_argument("-v", "--verbose", action="store_true")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("fetch", help="clone a source at its pinned commit into the cache")
    p.add_argument("source_id")
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("extract", help="normalize a fetched source into <cache>/<id>/extracted.json")
    p.add_argument("source_id")
    p.add_argument("--source-dir", help="use this checkout instead of the cache")
    p.set_defaults(func=cmd_extract)

    p = sub.add_parser("validate", help="validate a normalized file")
    p.add_argument("file")
    p.add_argument("--no-provenance", action="store_true", help="do not require provenance keys")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("dedupe", help="find duplicates against questions/*.json")
    p.add_argument("file")
    p.add_argument("--threshold", type=float, default=workflow.FUZZY_THRESHOLD)
    p.add_argument("--report", help="write the full JSON report here")
    p.add_argument("--show", type=int, default=20)
    p.set_defaults(func=cmd_dedupe)

    p = sub.add_parser("review-apply", help="merge SME review verdicts")
    p.add_argument("file")
    p.add_argument("review")
    p.add_argument("--out", help="output file (default: overwrite the input)")
    p.add_argument("--keep-flagged", action="store_true", help="keep ambiguous/outdated/off_topic/poor_quality items")
    p.add_argument("--drop-unreviewed", action="store_true", help="drop items without a review verdict")
    p.set_defaults(func=cmd_review_apply)

    p = sub.add_parser("import", help="write questions/imports/<id>.json (approved sources only)")
    p.add_argument("source_id")
    p.add_argument("--from", dest="input", help="normalized file (default: <cache>/<id>/reviewed.json or extracted.json)")
    p.add_argument("--permission-evidence", help="written permission of the author; records it and approves the source")
    p.add_argument("--note", help="short note stored with the permission")
    p.add_argument(
        "--personal-use",
        action="store_true",
        help="import a personal_use source into questions/local/ (git/docker-ignored, private study only)",
    )
    p.add_argument(
        "--authorization",
        help="owner's written authorization for private study; records it and sets status personal_use",
    )
    p.set_defaults(func=cmd_import)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except (reg.RegistryError, workflow.PipelineError, workflow.adapters.AdapterError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
