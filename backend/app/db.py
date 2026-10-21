from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from .config import ensure_data_dirs, get_settings

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        settings = get_settings()
        ensure_data_dirs(settings)
        _engine = create_engine(
            f"sqlite:///{settings.db_path}",
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(_engine, "connect")
        def set_sqlite_pragma(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return _engine


def reset_engine_for_tests() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
    _engine = None


def init_db() -> None:
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(get_engine())
    # Additive migrations preserve existing students, classes and arrangements.
    with get_engine().begin() as connection:
        for table, column, declaration in (
            ("studentrecord", "source_area", "TEXT NOT NULL DEFAULT ''"),
            ("projectrecord", "owner_id", "INTEGER REFERENCES userrecord(id)"),
            ("userrecord", "phone", "TEXT"),
        ):
            columns = {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table})")}
            if column not in columns:
                connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")

        connection.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_userrecord_phone ON userrecord(phone)")
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_registration_phone "
            "ON registrationrequestrecord(phone) WHERE status = 'pending'"
        )


def get_session() -> Generator[Session, None, None]:
    with Session(get_engine()) as session:
        yield session
