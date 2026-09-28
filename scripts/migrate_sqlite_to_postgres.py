#!/usr/bin/env python3
"""Copia os dados de um banco SQLite legado para um PostgreSQL no schema atual.

Fluxo:
1. ``alembic upgrade head`` no destino (cria/atualiza tabelas, FKs, CHECKs, colunas
   novas) em vez de ``create_all`` -- o destino fica exatamente no schema versionado.
2. Pré-validação: as CHECK constraints do schema atual são avaliadas nos dados de
   origem; violações abortam com mensagem clara (tabela, constraint, exemplos) antes
   de qualquer escrita no destino.
3. Tabelas semeadas pelas migrations (domain_blueprint) são substituídas pelos
   dados da origem quando a origem os tiver; as demais precisam estar vazias no
   destino (ou use --truncate-target).
4. Cópia em ordem segura para FKs (``Base.metadata.sorted_tables``). O ciclo
   question_bank <-> question_versions (FKs ``use_alter``) é resolvido inserindo as
   colunas do ciclo como NULL e preenchendo-as depois.
5. Colunas que não existem no SQLite legado recebem o default do modelo (Python) ou
   do servidor; colunas NOT NULL sem default abortam com mensagem clara.
6. Sequências de PKs inteiras são reajustadas para MAX(id).

Tudo roda numa única transação no destino: qualquer erro desfaz a cópia inteira.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import sqlalchemy as sa
from sqlalchemy.exc import DBAPIError, OperationalError

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.base import Base  # noqa: E402
import app.models  # noqa: E402,F401  (registra todas as tabelas no metadata)

DEFAULT_BATCH_SIZE = 1000
# Tables that Alembic data-migrations seed on a fresh database (0014 seeds the official
# domain weights). They do not count as "target already has data"; when the source
# has rows for them, the seeded rows are replaced by the source rows (the next JSON
# ingest re-syncs the official weights anyway).
MIGRATION_SEEDED_TABLES = frozenset({"domain_blueprint"})
SAMPLE_LIMIT = 5

# SQLSTATE -> descrição (PostgreSQL)
_SQLSTATE_LABELS = {
    "23514": "violação de CHECK constraint",
    "23503": "violação de chave estrangeira",
    "23505": "violação de unicidade",
    "23502": "valor NULL em coluna NOT NULL",
    "22001": "texto maior que o tamanho da coluna",
}


class MigrationError(RuntimeError):
    """Erro com mensagem pronta para o operador."""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
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
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Linhas por lote de INSERT (padrão: {DEFAULT_BATCH_SIZE}).",
    )
    return parser.parse_args(argv)


def validate_urls(source_url: str, target_url: str) -> None:
    if not source_url.startswith("sqlite"):
        raise SystemExit("A origem precisa ser um banco SQLite.")
    if not target_url.startswith("postgresql"):
        raise SystemExit("O destino precisa ser um banco PostgreSQL.")


# --------------------------------------------------------------------------- schema
def run_alembic_upgrade(target_url: str) -> None:
    """Leva o destino ao schema versionado atual (``alembic upgrade head``)."""
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    # backend/alembic/env.py dá prioridade a esta URL sobre settings.database_url.
    cfg.attributes["sqlalchemy.url"] = target_url
    cfg.attributes["skip_logging_config"] = True
    command.upgrade(cfg, "head")


def cyclic_fk_columns() -> dict[str, list[str]]:
    """Colunas de FKs ``use_alter`` (ciclos), por tabela: inseridas como NULL e atualizadas depois."""
    cyclic: dict[str, list[str]] = {}
    for table, constraints in sa.schema.sort_tables_and_constraints(Base.metadata.tables.values()):
        if table is not None:
            continue
        for constraint in constraints:
            cyclic.setdefault(constraint.table.name, []).extend(col.name for col in constraint.columns)
    return cyclic


def plan_tables(source_tables: Iterable[str]) -> list[sa.Table]:
    """Tabelas do schema atual presentes na origem, em ordem segura para FKs."""
    available = set(source_tables)
    return [table for table in Base.metadata.sorted_tables if table.name in available]


def _column_has_default(column: sa.Column) -> bool:
    if column.nullable or column.default is not None or column.server_default is not None:
        return True
    # Integer primary keys are generated by the target (SERIAL/IDENTITY).
    return bool(column.primary_key and isinstance(column.type, sa.Integer) and column.autoincrement in (True, "auto"))


def copy_columns(table: sa.Table, source_columns: Iterable[str]) -> list[str]:
    """Colunas copiadas da origem; aborta se faltar coluna NOT NULL sem default."""
    available = set(source_columns)
    missing_required = [
        column.name
        for column in table.columns
        if column.name not in available and not _column_has_default(column)
    ]
    if missing_required:
        raise MigrationError(
            f"A tabela '{table.name}' na origem não tem as colunas obrigatórias {missing_required} "
            "(NOT NULL sem default no schema atual). Atualize o SQLite de origem ou preencha esses dados."
        )
    return [column.name for column in table.columns if column.name in available]


def _adapt_value(column: sa.Column, value: Any) -> Any:
    if (
        isinstance(value, datetime)
        and value.tzinfo is None
        and isinstance(column.type, sa.DateTime)
        and column.type.timezone
    ):
        # SQLite guarda datetimes sem fuso; o app sempre gravou UTC.
        return value.replace(tzinfo=timezone.utc)
    return value


# --------------------------------------------------------------------------- checks
def _check_constraints(table: sa.Table) -> list[sa.CheckConstraint]:
    return [c for c in table.constraints if isinstance(c, sa.CheckConstraint)]


def find_check_violations(source_conn: sa.Connection, table: sa.Table, columns: list[str]) -> list[str]:
    """Avalia as CHECKs do schema atual nos dados de origem (melhor esforço)."""
    problems: list[str] = []
    pk_cols = [col.name for col in table.primary_key.columns if col.name in columns]
    for constraint in _check_constraints(table):
        expression = str(constraint.sqltext)
        if not all(col.name in columns for col in table.columns if col.name in expression):
            # A CHECK usa coluna inexistente na origem (receberá default): o destino valida.
            continue
        select_cols = ", ".join(f'"{name}"' for name in pk_cols) or "rowid"
        try:
            total = source_conn.execute(
                sa.text(f'SELECT COUNT(*) FROM "{table.name}" WHERE NOT ({expression})')
            ).scalar_one()
            if not total:
                continue
            samples = source_conn.execute(
                sa.text(f'SELECT {select_cols} FROM "{table.name}" WHERE NOT ({expression}) LIMIT {SAMPLE_LIMIT}')
            ).all()
        except (OperationalError, DBAPIError):
            source_conn.rollback()
            continue
        sample_text = ", ".join(str(tuple(row)) if len(row) > 1 else str(row[0]) for row in samples)
        problems.append(
            f"- {table.name}: {total} linha(s) violam a CHECK '{constraint.name}' ({expression}). "
            f"Exemplos ({'/'.join(pk_cols) or 'rowid'}): {sample_text}"
        )
    return problems


def describe_db_error(table_name: str, exc: DBAPIError) -> str:
    orig = getattr(exc, "orig", None)
    sqlstate = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    diag = getattr(orig, "diag", None)
    constraint = getattr(diag, "constraint_name", None) if diag is not None else None
    label = _SQLSTATE_LABELS.get(str(sqlstate), "erro do banco de destino")
    detail = str(orig or exc).strip().splitlines()[0] if (orig or exc) else ""
    message = f"Falha ao copiar a tabela '{table_name}': {label}"
    if constraint:
        message += f" (constraint '{constraint}')"
    message += f". Detalhe: {detail}"
    if str(sqlstate) == "23514":
        message += " -- corrija os dados de origem para respeitar o schema atual e rode novamente."
    elif str(sqlstate) == "23505":
        message += " -- o destino já tem dados conflitantes; use --truncate-target para recomeçar."
    return message


# --------------------------------------------------------------------------- copy
def _target_row_counts(target_conn: sa.Connection, tables: list[sa.Table]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in tables:
        total = target_conn.execute(sa.select(sa.func.count()).select_from(table)).scalar_one()
        if total:
            counts[table.name] = int(total)
    return counts


def truncate_target(target_conn: sa.Connection) -> None:
    names = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    target_conn.execute(sa.text(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE"))


def reset_sequences(target_conn: sa.Connection, tables: list[sa.Table]) -> None:
    for table in tables:
        for column in table.primary_key.columns:
            if not isinstance(column.type, sa.Integer):
                continue
            sequence = target_conn.execute(
                sa.text("SELECT pg_get_serial_sequence(:table, :column)"),
                {"table": table.name, "column": column.name},
            ).scalar_one_or_none()
            if not sequence:
                continue
            target_conn.execute(
                sa.text(
                    f'SELECT setval(:sequence, COALESCE((SELECT MAX("{column.name}") FROM "{table.name}"), 1), '
                    f'(SELECT MAX("{column.name}") FROM "{table.name}") IS NOT NULL)'
                ),
                {"sequence": sequence},
            )


def copy_database(source_url: str, target_url: str, *, truncate: bool, batch_size: int = DEFAULT_BATCH_SIZE) -> dict[str, int]:
    source_engine = sa.create_engine(source_url, future=True)
    target_engine = sa.create_engine(target_url, future=True)
    try:
        source_inspector = sa.inspect(source_engine)
        tables = plan_tables(source_inspector.get_table_names())
        if not tables:
            raise MigrationError("Nenhuma tabela compatível encontrada para copiar.")
        columns_by_table = {
            table.name: copy_columns(table, [col["name"] for col in source_inspector.get_columns(table.name)])
            for table in tables
        }
        unknown = sorted(set(source_inspector.get_table_names()) - set(Base.metadata.tables) - {"alembic_version"})
        if unknown:
            print(f"Aviso: tabelas da origem ignoradas (não existem no schema atual): {', '.join(unknown)}")

        with source_engine.connect() as source_conn:
            problems: list[str] = []
            for table in tables:
                problems.extend(find_check_violations(source_conn, table, columns_by_table[table.name]))
            if problems:
                raise MigrationError(
                    "Os dados de origem violam CHECK constraints do schema atual; nada foi copiado:\n"
                    + "\n".join(problems)
                )

        cyclic = cyclic_fk_columns()
        copied: dict[str, int] = {}
        with target_engine.begin() as target_conn, source_engine.connect() as source_conn:
            if truncate:
                truncate_target(target_conn)
            else:
                existing = _target_row_counts(
                    target_conn, [table for table in tables if table.name not in MIGRATION_SEEDED_TABLES]
                )
                if existing:
                    raise MigrationError(
                        "O destino já contém dados ("
                        + ", ".join(f"{name}: {count}" for name, count in existing.items())
                        + "). Use --truncate-target para substituí-los."
                    )

            deferred_updates: dict[str, list[dict[str, Any]]] = {}
            for table in tables:
                names = columns_by_table[table.name]
                if table.name in MIGRATION_SEEDED_TABLES and source_conn.execute(
                    sa.select(sa.func.count()).select_from(sa.table(table.name))
                ).scalar_one():
                    target_conn.execute(table.delete())
                deferred_cols = [name for name in cyclic.get(table.name, []) if name in names]
                pk_cols = [col.name for col in table.primary_key.columns]
                select_stmt = sa.select(*[table.c[name] for name in names])
                result = source_conn.execute(select_stmt.execution_options(yield_per=batch_size))
                total = 0
                try:
                    for partition in result.mappings().partitions(batch_size):
                        rows = []
                        for row in partition:
                            values = {name: _adapt_value(table.c[name], row[name]) for name in names}
                            if deferred_cols:
                                pending = {name: values[name] for name in deferred_cols if values[name] is not None}
                                if pending:
                                    deferred_updates.setdefault(table.name, []).append(
                                        {**{f"pk_{pk}": values[pk] for pk in pk_cols}, **pending}
                                    )
                                for name in deferred_cols:
                                    values[name] = None
                            rows.append(values)
                        if rows:
                            target_conn.execute(table.insert(), rows)
                            total += len(rows)
                except DBAPIError as exc:  # IntegrityError (CHECK/FK/unique), DataError...
                    raise MigrationError(describe_db_error(table.name, exc)) from exc
                copied[table.name] = total
                if total:
                    print(f"{table.name}: {total} registro(s) copiados")

            for table_name, updates in deferred_updates.items():
                table = Base.metadata.tables[table_name]
                pk_cols = [col.name for col in table.primary_key.columns]
                for update in updates:
                    values = {key: value for key, value in update.items() if not key.startswith("pk_")}
                    stmt = sa.update(table).values(**values)
                    for pk in pk_cols:
                        stmt = stmt.where(table.c[pk] == update[f"pk_{pk}"])
                    try:
                        target_conn.execute(stmt)
                    except DBAPIError as exc:
                        raise MigrationError(describe_db_error(table_name, exc)) from exc

            reset_sequences(target_conn, tables)
        return copied
    finally:
        source_engine.dispose()
        target_engine.dispose()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    validate_urls(args.source, args.target)
    if args.batch_size < 1:
        raise SystemExit("--batch-size precisa ser >= 1.")

    print("Aplicando migrations no destino (alembic upgrade head)...")
    try:
        run_alembic_upgrade(args.target)
    except Exception as exc:  # noqa: BLE001 - mensagem para o operador
        print(f"Erro: não foi possível migrar o schema do destino: {exc}", file=sys.stderr)
        return 1

    try:
        copy_database(args.source, args.target, truncate=args.truncate_target, batch_size=args.batch_size)
    except MigrationError as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        return 2

    print("Migracao concluida.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
