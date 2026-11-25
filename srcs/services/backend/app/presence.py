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
    db: Session,
    user: User,
    now: datetime | None = None,
    session: UserSession | None = None,
) -> bool:
    """Persist activity at most once per minute without changing updated_at.

    With ``session`` (every authenticated request passes the one it came
    through), two things are written, each at most once per minute:

    * ``users.last_seen``, only while that session still exists and has not
      expired, so a request that was already running when its session was
      logged out cannot put the user back online;
    * ``sessions.last_seen_at``, so logout can tell a device still in use from
      a session nobody has touched for days. It is kept even while another
      device keeps ``users.last_seen`` fresh.

    Returns whether ``users.last_seen`` was written.
    """
    current_time = now or utcnow()
    cutoff = current_time - PRESENCE_WRITE_INTERVAL
    user_due = user.last_seen is None or user.last_seen < cutoff
    session_due = session is not None and (
        session.last_seen_at is None or session.last_seen_at < cutoff
    )
    if not user_due and not session_due:
        return False
    user_id = user.id
    session_id = session.id if session is not None else None
    try:
        updated = 0
        if user_due:
            query = db.query(User).filter(
                User.id == user_id,
                or_(User.last_seen.is_(None), User.last_seen < cutoff),
            )
            if session_id is not None:
                query = query.filter(
                    exists().where(
                        UserSession.id == session_id,
                        UserSession.user_id == user_id,
                        UserSession.expires_at > current_time,
                    )
                )
            updated = query.update(
                {
                    User.last_seen: current_time,
                    User.updated_at: User.updated_at,
                },
                synchronize_session=False,
            )
        # After the user row, the same order as logout takes its locks in.
        session_updated = 0
        if session_due:
            session_updated = (
                db.query(UserSession)
                .filter(
                    UserSession.id == session_id,
                    UserSession.expires_at > current_time,
                    or_(
                        UserSession.last_seen_at.is_(None),
                        UserSession.last_seen_at < cutoff,
                    ),
                )
                .update(
                    {UserSession.last_seen_at: current_time},
                    synchronize_session=False,
                )
            )
        db.commit()
        if updated:
            set_committed_value(user, "last_seen", current_time)
        if session_updated:
            set_committed_value(session, "last_seen_at", current_time)
        return bool(updated)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not update last_seen for user %s", user_id)
        return False
