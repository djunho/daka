"""Authentication routes: creating an account and logging in.

Mounted under /auth by app/main.py. Because nginx forwards /api/ to this
service, the public URLs are /api/auth/register and /api/auth/login.

User-facing messages here are in Portuguese: they are shown directly in the
UI, so they count as application content rather than code.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User, UserSession
from app.schemas import LoginIn, RegisterIn, UserOut
from app.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    session_expiry,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Name of the cookie carrying the session token. Defined here because this is
# the module that creates it; app/dependencies.py will read the same constant.
SESSION_COOKIE_NAME = "daka_session"

# A throwaway bcrypt hash of a random string nobody knows, built once when the
# module loads. It exists purely so that a login attempt with an unknown email
# still spends the same ~250 ms doing bcrypt work as one with a known email.
# Without it, "email not found" would return almost instantly while "wrong
# password" would take a quarter of a second -- and that difference is enough
# for an attacker to discover which emails have accounts here, by timing alone.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


def _open_session(db: Session, user: User, response: Response) -> None:
    """Create a session row and hand the raw token to the browser as a cookie.

    The raw token is generated here and never stored: the database only ever
    sees its SHA-256. This is the one and only moment it exists in plaintext on
    our side, which is exactly why it goes straight into the response and into
    no variable that outlives this function.
    """
    raw_token = generate_session_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_session_token(raw_token),
            expires_at=session_expiry(),
        )
    )
    db.commit()

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        # httponly: JavaScript cannot read this cookie. If someone ever manages
        # to inject a script into our pages, they still cannot steal the token.
        httponly=True,
        # secure: the browser only sends it over HTTPS, so it never travels in
        # the clear. Our nginx is HTTPS-only, so this costs us nothing.
        secure=True,
        # lax: the cookie is sent on normal navigation to our site but not on
        # cross-site POSTs, which blocks the basic form of CSRF.
        samesite="lax",
        # Sent on every path, including /api/*.
        path="/",
        # Tells the browser when to throw the cookie away. The real deadline is
        # expires_at in the database -- this is only a convenience, because the
        # browser owns this value and the user can edit it.
        max_age=settings.session_ttl_hours * 3600,
    )


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    response_model=UserOut,
    summary="Create an account with email and password",
)
def register(payload: RegisterIn, db: Session = Depends(get_db)) -> User:
    """Create a user. Returns 409 if the email is already taken.

    By the time this function runs, RegisterIn has already checked the shape of
    everything (valid email, password length, name not blank) and normalised
    the email to lowercase. What is left to decide is uniqueness, which needs
    the database.
    """
    # First pass: a plain lookup, so the common case produces a friendly 409
    # instead of a database error.
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe uma conta com este email.",
        )

    user = User(
        user_name=payload.user_name,
        email=payload.email,
        pass_hash=hash_password(payload.password),
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError:
        # Second pass, and the one that actually guarantees correctness.
        #
        # Between the lookup above and this commit, another request could have
        # inserted the same email -- two people registering simultaneously, or
        # one person double-clicking "Criar conta". The check-then-insert
        # pattern has a gap between the two steps, and no amount of extra
        # checking closes it. The UNIQUE constraint on users.email does: the
        # database refuses the second write, and we translate that refusal into
        # the same 409 the user would have seen anyway.
        #
        # The subject asks for multiple simultaneous users with no race
        # conditions. This is what that means in practice.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe uma conta com este email.",
        )

    # Reload the row so the columns the database filled in (id, created_at)
    # are present on the object we return.
    db.refresh(user)
    return user


@router.post(
    "/login",
    response_model=UserOut,
    summary="Log in with email and password",
)
def login(
    payload: LoginIn, response: Response, db: Session = Depends(get_db)
) -> User:
    """Verify the credentials and open a session.

    On success the browser receives an httpOnly cookie holding the session
    token, and the body describes the user who just logged in.
    """
    user = db.query(User).filter(User.email == payload.email).first()

    # Three cases collapse into one here, deliberately:
    #   - no account with that email        -> compare against the dummy hash
    #   - account exists but has no password (Google-only, once OAuth lands)
    #   - account exists and the password is wrong
    # All three take the same amount of time and produce the same message, so
    # the response leaks nothing about which emails are registered.
    stored_hash = user.pass_hash if user and user.pass_hash else _DUMMY_HASH

    if not verify_password(payload.password, stored_hash) or user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou palavra-passe incorretos.",
        )

    _open_session(db, user, response)
    return user