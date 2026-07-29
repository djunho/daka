"""Database connection using SQLAlchemy (our ORM)."""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)

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
