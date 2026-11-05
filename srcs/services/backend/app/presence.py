"""Shared online-presence rules and database helpers."""

from datetime import datetime, timedelta
import logging

from sqlalchemy import or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.models import User
from app.security import utcnow

logger = logging.getLogger(__name__)

ONLINE_WINDOW = timedelta(seconds=settings.presence_online_window_seconds)
PRESENCE_WRITE_INTERVAL = timedelta(seconds=settings.presence_write_interval_seconds)


def is_online(user: User, now: datetime | None = None) -> bool:
    """Return whether a user's last activity is within the online window."""
    if user.last_seen is None:
        return False
    current_time = now or utcnow()
    return current_time - user.last_seen <= ONLINE_WINDOW


def online_since(now: datetime | None = None):
    """Return the SQL expression for users currently inside the online window."""
    current_time = now or utcnow()
    return User.last_seen >= current_time - ONLINE_WINDOW


def touch_last_seen(
    db: Session, user: User, now: datetime | None = None
) -> bool:
    """Persist activity at most once per minute without changing updated_at."""
    current_time = now or utcnow()
    cutoff = current_time - PRESENCE_WRITE_INTERVAL
    if user.last_seen is not None and user.last_seen >= cutoff:
        return False
    try:
        updated = (
            db.query(User)
            .filter(
                User.id == user.id,
                or_(User.last_seen.is_(None), User.last_seen < cutoff),
            )
            .update(
                {
                    User.last_seen: current_time,
                    User.updated_at: User.updated_at,
                },
                synchronize_session=False,
            )
        )
        if updated:
            db.commit()
            user.last_seen = current_time
            return True
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not update last_seen for user %s", user.id)
    return False
