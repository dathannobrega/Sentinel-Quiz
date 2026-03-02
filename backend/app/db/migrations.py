from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


QUESTION_COLUMN_DDL = {
    "domain": "ALTER TABLE questions ADD COLUMN domain VARCHAR(255)",
    "difficulty": "ALTER TABLE questions ADD COLUMN difficulty VARCHAR(64)",
    "certification": "ALTER TABLE questions ADD COLUMN certification VARCHAR(64)",
    "tags_json": "ALTER TABLE questions ADD COLUMN tags_json TEXT",
    "citations_json": "ALTER TABLE questions ADD COLUMN citations_json TEXT",
}


def ensure_compat_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "questions" not in inspector.get_table_names():
        return

    existing = {col["name"] for col in inspector.get_columns("questions")}
    missing = [name for name in QUESTION_COLUMN_DDL if name not in existing]
    if not missing:
        return

    with engine.begin() as conn:
        for name in missing:
            conn.execute(text(QUESTION_COLUMN_DDL[name]))
