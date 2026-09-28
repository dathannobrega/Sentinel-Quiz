from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

from app.core.config import settings
from app.db.base import Base
import app.models  # noqa: F401


config = context.config
# An explicit sqlalchemy.url set programmatically (tests) wins over settings.
database_url = config.attributes.get("sqlalchemy.url") or settings.database_url
config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))

if config.config_file_name is not None and not config.attributes.get("skip_logging_config"):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata

# Arbitrary constant key for pg_advisory_lock: serializes `alembic upgrade` when several
# replicas run migrations on startup at the same time (the others wait, then see the
# database already at head and do nothing).
MIGRATION_ADVISORY_LOCK_KEY = 7_265_914_203_118_452


def _ensure_wide_version_table(connection) -> None:
    """Alembic creates alembic_version.version_num as VARCHAR(32), but our revision ids
    (e.g. "0009_editorial_metadata_and_metrics") are longer. PostgreSQL enforces the
    length, so pre-create/widen the column before Alembic touches it."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS alembic_version ("
            "version_num VARCHAR(255) NOT NULL, "
            "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        )
    )
    connection.execute(text("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)"))
    connection.commit()


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = database_url

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        future=True,
    )

    with connectable.connect() as connection:
        use_lock = connection.dialect.name == "postgresql"
        if use_lock:
            # Session-level lock: survives the commit below and is held until unlock.
            connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": MIGRATION_ADVISORY_LOCK_KEY})
            connection.commit()
            _ensure_wide_version_table(connection)
        try:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
                compare_server_default=True,
            )

            with context.begin_transaction():
                context.run_migrations()
        finally:
            if use_lock:
                if connection.in_transaction():
                    connection.rollback()
                connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": MIGRATION_ADVISORY_LOCK_KEY})
                connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
