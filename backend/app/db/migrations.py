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

EXAM_SESSION_COLUMN_DDL = {
    "user_id": "ALTER TABLE exam_sessions ADD COLUMN user_id VARCHAR(36)",
    "client_key": "ALTER TABLE exam_sessions ADD COLUMN client_key VARCHAR(64)",
}

STUDY_SESSION_COLUMN_DDL = {
    "selection_strategy": "ALTER TABLE study_sessions ADD COLUMN selection_strategy VARCHAR(24) NOT NULL DEFAULT 'standard'",
    "selection_mix_json": "ALTER TABLE study_sessions ADD COLUMN selection_mix_json TEXT",
}

COMPAT_INDEX_DDL = {
    "exam_sessions": [
        "CREATE INDEX IF NOT EXISTS ix_exam_sessions_user_id ON exam_sessions (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_exam_sessions_client_key ON exam_sessions (client_key)",
        "CREATE INDEX IF NOT EXISTS ix_exam_sessions_completed_at ON exam_sessions (completed_at)",
    ],
    "study_sessions": [
        "CREATE INDEX IF NOT EXISTS ix_study_sessions_selection_strategy ON study_sessions (selection_strategy)",
    ],
    "auth_tokens": [
        "CREATE INDEX IF NOT EXISTS ix_auth_tokens_user_id ON auth_tokens (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_auth_tokens_expires_at ON auth_tokens (expires_at)",
        "CREATE INDEX IF NOT EXISTS ix_auth_tokens_revoked_at ON auth_tokens (revoked_at)",
    ],
}


def ensure_compat_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "questions" not in table_names:
        return

    statements: list[str] = []

    existing_question_columns = {col["name"] for col in inspector.get_columns("questions")}
    statements.extend(
        QUESTION_COLUMN_DDL[name]
        for name in QUESTION_COLUMN_DDL
        if name not in existing_question_columns
    )

    if "exam_sessions" in table_names:
        existing_session_columns = {col["name"] for col in inspector.get_columns("exam_sessions")}
        statements.extend(
            EXAM_SESSION_COLUMN_DDL[name]
            for name in EXAM_SESSION_COLUMN_DDL
            if name not in existing_session_columns
        )
        statements.extend(COMPAT_INDEX_DDL["exam_sessions"])

    if "study_sessions" in table_names:
        existing_study_columns = {col["name"] for col in inspector.get_columns("study_sessions")}
        statements.extend(
            STUDY_SESSION_COLUMN_DDL[name]
            for name in STUDY_SESSION_COLUMN_DDL
            if name not in existing_study_columns
        )
        statements.extend(COMPAT_INDEX_DDL["study_sessions"])

    if "auth_tokens" in table_names:
        statements.extend(COMPAT_INDEX_DDL["auth_tokens"])

    if not statements:
        return

    with engine.begin() as conn:
        for ddl in statements:
            conn.execute(text(ddl))
