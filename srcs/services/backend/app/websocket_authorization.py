"""Shared database authorisation for handshakes and live message recipients."""

import logging

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload, sessionmaker
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.database import create_database_engine
from app.dependencies import get_user_from_session_token
from app.models import Negotiation, User
from app.negotiation_access import is_participant

logger = logging.getLogger(__name__)

# Keep short live-delivery budgets separate from lifecycle write transactions.
# UTC checkout handling from create_database_engine applies to this pool too.
recipient_engine = create_database_engine(
    settings.database_url,
    pool_size=5, max_overflow=5, pool_timeout=2,
    connect_args={
        "connect_timeout": 2, "read_timeout": 2, "write_timeout": 2,
        "init_command": "SET SESSION max_statement_time = 1",
    },
)
RecipientSessionLocal = sessionmaker(bind=recipient_engine, autoflush=False, autocommit=False)


def authorize_negotiation(db: Session, token: str | None, negotiation_id: int) -> User | int:
    user = get_user_from_session_token(token, db)
    if user is None:
        return 4401
    negotiation = (
        db.query(Negotiation)
        .options(joinedload(Negotiation.requested_listing))
        .filter(Negotiation.id == negotiation_id)
        .first()
    )
    if negotiation is None:
        return 4404
    if not is_participant(negotiation, user.id):
        return 4403
    return user


def _recipient_close_code(negotiation_id: int, user_id: int, token: str | None) -> int | None:
    try:
        with RecipientSessionLocal() as db:
            result = authorize_negotiation(db, token, negotiation_id)
            if isinstance(result, int):
                return result
            return None if result.id == user_id else 4401
    except SQLAlchemyError as exc:
        # Fail closed; exception strings can contain credentials or parameters.
        logger.error(
            "WebSocket recipient authorisation failed negotiation_id=%s user_id=%s error_type=%s",
            negotiation_id, user_id, type(exc).__name__,
        )
        return 1011


async def authorize_recipient(negotiation_id: int, user_id: int, token: str | None) -> int | None:
    """Recheck an idle recipient in a fresh worker session before delivery."""
    return await run_in_threadpool(_recipient_close_code, negotiation_id, user_id, token)
