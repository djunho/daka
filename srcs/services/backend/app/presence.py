"""Shared online-presence rules and database helpers."""

from datetime import datetime, timedelta
import logging

from sqlalchemy import exists, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.config import settings
from app.models import User, UserSession
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
    user_id = user.id
    try:
        updated = (
            db.query(User)
            .filter(
                User.id == user_id,
                or_(User.last_seen.is_(None), User.last_seen < cutoff),
                exists().where(
                    UserSession.user_id == User.id,
                    UserSession.expires_at > current_time,
                ),
            )
            .update(
                {
                    User.last_seen: current_time,
                    User.updated_at: User.updated_at,
                },
                synchronize_session=False,
            )
        )
        db.commit()
        if updated:
            set_committed_value(user, "last_seen", current_time)
        return bool(updated)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not update last_seen for user %s", user_id)
        return False
