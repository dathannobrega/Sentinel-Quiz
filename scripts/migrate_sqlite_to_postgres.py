#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import sqlalchemy as sa


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.base import Base  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copia dados de um banco SQLite legado para um banco PostgreSQL com o schema atual.",
    )
    parser.add_argument("--source", required=True, help="URL SQLAlchemy do SQLite de origem.")
    parser.add_argument("--target", required=True, help="URL SQLAlchemy do PostgreSQL de destino.")
    parser.add_argument(
        "--truncate-target",
        action="store_true",
        help="Apaga os dados das tabelas conhecidas no destino antes de copiar.",
    )
    return parser.parse_args()


def validate_urls(source_url: str, target_url: str) -> None:
    if not source_url.startswith("sqlite"):
        raise SystemExit("A origem precisa ser um banco SQLite.")
    if not target_url.startswith("postgresql"):
        raise SystemExit("O destino precisa ser um banco PostgreSQL.")


def main() -> int:
    args = parse_args()
    validate_urls(args.source, args.target)

    source_engine = sa.create_engine(args.source, future=True)
    target_engine = sa.create_engine(args.target, future=True)

    Base.metadata.create_all(bind=target_engine)

    source_inspector = sa.inspect(source_engine)
    source_tables = set(source_inspector.get_table_names())
    metadata_tables = list(Base.metadata.sorted_tables)

    tables_to_copy = [table for table in metadata_tables if table.name in source_tables]
    if not tables_to_copy:
        raise SystemExit("Nenhuma tabela compatível encontrada para copiar.")

    with target_engine.begin() as target_conn:
        if args.truncate_target:
            for table in reversed(tables_to_copy):
                target_conn.execute(table.delete())

        with source_engine.connect() as source_conn:
            for table in tables_to_copy:
                rows = [dict(row) for row in source_conn.execute(sa.select(table)).mappings().all()]
                if not rows:
                    continue
                target_conn.execute(table.insert(), rows)
                print(f"{table.name}: {len(rows)} registro(s) copiados")

    print("Migracao concluida.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
