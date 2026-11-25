"""Database connection using SQLAlchemy (our ORM)."""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

def _set_session_utc(dbapi_connection, _connection_record, _connection_proxy) -> None:
    """TIMESTAMP values must be read/written as UTC, including reused sockets."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("SET SESSION time_zone = '+00:00'")
    finally:
        cursor.close()


def create_database_engine(url: str, **options):
    database_engine = create_engine(url, pool_pre_ping=True, **options)
    event.listen(database_engine, "checkout", _set_session_utc)
    return database_engine


engine = create_database_engine(settings.database_url)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Parent class of every model (table)."""
    pass


def get_db():
    """FastAPI dependency: opens a session per request and closes it at the end."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
