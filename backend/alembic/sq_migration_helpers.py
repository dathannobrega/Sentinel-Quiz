"""Idempotent schema helpers shared by the Alembic revisions.

Why this exists: revision 0008 is a consolidated baseline that runs
``Base.metadata.create_all`` with the *current* models. On an empty database it
therefore already creates every column/table/index/constraint that the later
revisions (0009+) add. Every later revision must be idempotent: each operation
checks the live schema first and is skipped when the object already exists (or
is already gone, for downgrades). This lets ``alembic upgrade head`` work both
on an empty database and on databases stamped at older revisions.

SQLite cannot ALTER constraints, so constraint/FK changes run inside
``op.batch_alter_table`` (table recreate) on SQLite and as plain ALTERs on
PostgreSQL. Unnamed constraints reflected from SQLite are addressed through
``NAMING_CONVENTION``.

Import from a revision with::

    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import sq_migration_helpers as h
"""
from __future__ import annotations

from typing import Any, Iterable, Sequence

import sqlalchemy as sa
from alembic import op

NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
}


def bind():
    return op.get_bind()


def dialect() -> str:
    return bind().dialect.name


def is_sqlite() -> bool:
    return dialect() == "sqlite"


def inspector():
    # A fresh inspector every time: the default one caches reflection results.
    return sa.inspect(bind())


def has_table(table: str) -> bool:
    return inspector().has_table(table)


def column_names(table: str) -> set[str]:
    if not has_table(table):
        return set()
    return {col["name"] for col in inspector().get_columns(table)}


def has_column(table: str, column: str) -> bool:
    return column in column_names(table)


def get_column(table: str, column: str) -> dict[str, Any] | None:
    if not has_table(table):
        return None
    for col in inspector().get_columns(table):
        if col["name"] == column:
            return col
    return None


def index_map(table: str) -> dict[str, dict[str, Any]]:
    if not has_table(table):
        return {}
    return {idx["name"]: idx for idx in inspector().get_indexes(table) if idx.get("name")}


def has_index(table: str, name: str) -> bool:
    return name in index_map(table)


def check_names(table: str) -> set[str]:
    if not has_table(table):
        return set()
    try:
        return {ck["name"] for ck in inspector().get_check_constraints(table) if ck.get("name")}
    except NotImplementedError:  # pragma: no cover - dialect without reflection
        return set()


def has_check(table: str, name: str) -> bool:
    return name in check_names(table)


def fk_name_for(fk: dict[str, Any], table: str) -> str:
    """Actual constraint name, or the naming-convention name for unnamed SQLite FKs."""
    if fk.get("name"):
        return fk["name"]
    return NAMING_CONVENTION["fk"] % {
        "table_name": table,
        "column_0_name": fk["constrained_columns"][0],
        "referred_table_name": fk["referred_table"],
    }


def find_fk(table: str, columns: Sequence[str], referred_table: str) -> dict[str, Any] | None:
    if not has_table(table):
        return None
    for fk in inspector().get_foreign_keys(table):
        if list(fk.get("constrained_columns") or []) == list(columns) and fk.get("referred_table") == referred_table:
            return fk
    return None


def fk_ondelete(fk: dict[str, Any] | None) -> str | None:
    if not fk:
        return None
    value = (fk.get("options") or {}).get("ondelete")
    value = str(value).upper() if value else None
    if value == "NO ACTION":
        return None
    return value


def batch(table: str, *, recreate: str = "auto"):
    return op.batch_alter_table(table, recreate=recreate, naming_convention=NAMING_CONVENTION)


# --------------------------------------------------------------------------- tables / columns / indexes

def create_table(name: str, *elements: Any, **kwargs: Any) -> bool:
    if has_table(name):
        return False
    op.create_table(name, *elements, **kwargs)
    return True


def drop_table(name: str) -> bool:
    if not has_table(name):
        return False
    op.drop_table(name)
    return True


def add_column(table: str, column: sa.Column) -> bool:
    if not has_table(table) or has_column(table, column.name):
        return False
    if is_sqlite() and (column.foreign_keys or column.constraints):
        with batch(table) as b:
            b.add_column(column)
    else:
        op.add_column(table, column)
    return True


def drop_column(table: str, column: str) -> bool:
    if not has_column(table, column):
        return False
    if is_sqlite():
        with batch(table, recreate="always") as b:
            b.drop_column(column)
    else:
        op.drop_column(table, column)
    return True


def create_index(name: str, table: str, columns: Sequence[str], *, unique: bool = False, **kwargs: Any) -> bool:
    if not has_table(table) or has_index(table, name):
        return False
    op.create_index(name, table, list(columns), unique=unique, **kwargs)
    return True


def drop_index(name: str, table: str) -> bool:
    if not has_index(table, name):
        return False
    op.drop_index(name, table_name=table)
    return True


def clear_server_default(table: str, column: str) -> bool:
    col = get_column(table, column)
    if not col or col.get("default") is None:
        return False
    if is_sqlite():
        with batch(table, recreate="always") as b:
            b.alter_column(column, server_default=None)
    else:
        op.alter_column(table, column, server_default=None)
    return True


def clear_server_defaults(table: str, columns: Sequence[str]) -> list[str]:
    """Drop server defaults on several columns (single table rebuild on SQLite)."""
    if not has_table(table):
        return []
    live = {col["name"]: col for col in inspector().get_columns(table)}
    targets = [name for name in columns if name in live and live[name].get("default") is not None]
    if not targets:
        return []
    if is_sqlite():
        with batch(table, recreate="always") as b:
            for name in targets:
                b.alter_column(name, server_default=None)
    else:
        for name in targets:
            op.alter_column(table, name, server_default=None)
    return targets


# --------------------------------------------------------------------------- constraints

def create_foreign_key(
    name: str,
    table: str,
    referred_table: str,
    local_cols: Sequence[str],
    remote_cols: Sequence[str],
    *,
    ondelete: str | None = None,
) -> bool:
    """Create the FK unless one already exists on the same columns (any name)."""
    if not has_table(table) or find_fk(table, local_cols, referred_table):
        return False
    if is_sqlite():
        with batch(table, recreate="always") as b:
            b.create_foreign_key(name, referred_table, list(local_cols), list(remote_cols), ondelete=ondelete)
    else:
        op.create_foreign_key(name, table, referred_table, list(local_cols), list(remote_cols), ondelete=ondelete)
    return True


def drop_foreign_key(table: str, local_cols: Sequence[str], referred_table: str) -> bool:
    fk = find_fk(table, local_cols, referred_table)
    if not fk:
        return False
    name = fk_name_for(fk, table)
    if is_sqlite():
        with batch(table, recreate="always") as b:
            b.drop_constraint(name, type_="foreignkey")
    else:
        op.drop_constraint(name, table, type_="foreignkey")
    return True


def create_check(table: str, name: str, condition: str) -> bool:
    if not has_table(table) or has_check(table, name):
        return False
    if is_sqlite():
        with batch(table, recreate="always") as b:
            b.create_check_constraint(name, sa.text(condition))
    else:
        op.create_check_constraint(name, table, sa.text(condition))
    return True


def drop_check(table: str, name: str) -> bool:
    if not has_check(table, name):
        return False
    if is_sqlite():
        with batch(table, recreate="always") as b:
            b.drop_constraint(name, type_="check")
    else:
        op.drop_constraint(name, table, type_="check")
    return True


class FKSpec:
    """Desired foreign key on a single column."""

    def __init__(self, column: str, referred_table: str, referred_column: str = "id", ondelete: str | None = None,
                 name: str | None = None) -> None:
        self.column = column
        self.referred_table = referred_table
        self.referred_column = referred_column
        self.ondelete = ondelete.upper() if ondelete else None
        self.name = name

    def constraint_name(self, table: str) -> str:
        # Matches PostgreSQL's default naming so fresh (create_all) and migrated
        # databases end up with identical constraint names.
        return self.name or f"{table}_{self.column}_fkey"


def ensure_foreign_keys(table: str, specs: Iterable[FKSpec]) -> list[str]:
    """Make each FK exist with the requested ON DELETE rule (drop + recreate when different)."""
    if not has_table(table):
        return []
    to_drop: list[str] = []
    to_create: list[FKSpec] = []
    for spec in specs:
        if not has_column(table, spec.column):
            continue
        current = find_fk(table, [spec.column], spec.referred_table)
        if current and fk_ondelete(current) == spec.ondelete:
            continue
        if current:
            to_drop.append(fk_name_for(current, table))
        to_create.append(spec)
    if not to_create:
        return []
    if is_sqlite():
        with batch(table, recreate="always") as b:
            for name in to_drop:
                b.drop_constraint(name, type_="foreignkey")
            for spec in to_create:
                b.create_foreign_key(
                    spec.constraint_name(table),
                    spec.referred_table,
                    [spec.column],
                    [spec.referred_column],
                    ondelete=spec.ondelete,
                )
    else:
        for name in to_drop:
            op.drop_constraint(name, table, type_="foreignkey")
        for spec in to_create:
            op.create_foreign_key(
                spec.constraint_name(table),
                table,
                spec.referred_table,
                [spec.column],
                [spec.referred_column],
                ondelete=spec.ondelete,
            )
    return [spec.column for spec in to_create]


def scalar(sql: str, **params: Any) -> Any:
    return bind().execute(sa.text(sql), params).scalar()


def execute(sql: str, **params: Any) -> None:
    bind().execute(sa.text(sql), params)
