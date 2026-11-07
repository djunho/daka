"""Shared FastAPI dependencies.

A "dependency" is a function FastAPI runs before a route, injecting its result
as an argument. ``get_current_user`` lives here rather than inside
app/routers/auth.py because every protected route in the app -- listings,
negotiations, chat, and profile -- will need it, not just the auth routes.
Keeping it in a neutral module avoids a circular import once those routers also
import it.
"""
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session, contains_eager

from app.database import get_db
from app.models import User, UserSession
from app.presence import touch_last_seen
from app.security import hash_session_token, is_session_active

# Single source of truth for the session cookie name. Routers import this
# constant, and dependencies use it as the Cookie() alias so changing the name
# is a one-line edit.
SESSION_COOKIE_NAME = "daka_session"


def get_current_user(
    daka_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the logged-in user from the session cookie, or reject with 401.

    ``Cookie(default=None)`` tells FastAPI to pull the value out of the cookie
    named ``daka_session``. The parameter name has to match the cookie name
    (underscores and hyphens are interchangeable to FastAPI), which is why it
    is spelled ``daka_session`` even though the constant uses the same text.

    The steps, in order, each failing the same way so the response never hints
    at which one failed:
      1. no cookie at all           -> 401
      2. cookie present but no matching session row -> 401
      3. row found but already expired -> 401 (and delete the dead row)
    """
    session = get_session_from_session_token(daka_session, db)
    if session is None:
        raise _unauthorised()
    touch_last_seen(db, session.user, session_id=session.id)
    return session.user


def get_user_from_session_token(token: str | None, db: Session) -> User | None:
    """Resolve an active user from a raw session token.

    This transport-neutral function is shared by HTTP and WebSocket
    authentication. All invalid cases intentionally collapse to ``None`` so
    callers do not disclose whether a token, session, or account exists.
    """
    session = get_session_from_session_token(token, db)
    return session.user if session is not None else None


def get_session_from_session_token(
    token: str | None, db: Session
) -> UserSession | None:
    """Resolve an active session row from a raw session token."""
    if not token:
        return None

    token_hash = hash_session_token(token)
    session = (
        db.query(UserSession)
        .join(User)
        .options(contains_eager(UserSession.user))
        .filter(
            UserSession.token_hash == token_hash,
            User.deleted_at.is_(None),
        )
        .first()
    )

    if session is None:
        return None

    # Expiry is enforced here, server-side. The cookie's own max-age is only a
    # hint to the browser; the row's expires_at is the real deadline. Comparing
    # against utcnow() (naive UTC) matches how the column was written.
    if not is_session_active(session.expires_at):
        # Tidy up: a session past its deadline is useless, so drop it. This
        # keeps the table from filling with dead rows over time.
        db.delete(session)
        db.commit()
        return None

    return session


def _unauthorised() -> HTTPException:
    """The single 401 every failure path raises, worded identically."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated.",
    )
