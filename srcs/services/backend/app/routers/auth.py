"""Authentication routes: creating an account and logging in.

Mounted under /auth by app/main.py. Because nginx forwards /api/ to this
service, the public URLs are /api/auth/register and /api/auth/login.

"""
import secrets

from authlib.integrations.base_client import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from starlette.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import SESSION_COOKIE_NAME, get_current_user
from app.models import User, UserSession
from app.schemas import LoginIn, ProfileUpdate, RegisterIn, UserOut
from app.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    session_expiry,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# The cookie name now lives in app/dependencies.py (imported above), since both
# this module and the dependency need it. One definition, one source of truth.

# A throwaway bcrypt hash of a random string nobody knows, built once when the
# module loads. It exists purely so that a login attempt with an unknown email
# still spends the same ~250 ms doing bcrypt work as one with a known email.
# Without it, "email not found" would return almost instantly while "wrong
# password" would take a quarter of a second -- and that difference is enough
# for an attacker to discover which emails have accounts here, by timing alone.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(32))

# Register the Google client only when its credentials exist. This keeps the
# email/password routes usable in environments where Google OAuth is disabled.
oauth = OAuth()
if settings.google_client_id and settings.google_client_secret:
    oauth.register(
        name="google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        server_metadata_url=(
            "https://accounts.google.com/.well-known/openid-configuration"
        ),
        client_kwargs={"scope": "openid email profile"},
    )


@router.get(
    "/google/login",
    summary="Start Google OAuth login",
)
async def google_login(request: Request):
    """Redirect the browser to Google's consent screen."""
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google authentication is not configured.",
        )

    # Authlib generates the OAuth state and stores it in the signed session
    # cookie; the callback will reject a response with a missing or invalid
    # state, preventing an unsolicited authorization response from being used.
    return await oauth.google.authorize_redirect(
        request,
        settings.google_redirect_uri,
    )


@router.get(
    "/google/callback",
    summary="Complete Google OAuth login",
)
async def google_callback(
    request: Request,
    db: Session = Depends(get_db),
):
    """Validate Google's response, create a local session, and redirect."""
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google authentication is not configured.",
        )

    # Exchange Google's one-time authorization code for verified token data.
    # Authlib also checks the state saved by google_login before returning.
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google authentication was not completed.",
        )

    # The OpenID Connect userinfo claim contains the identity fields requested
    # by the client: Google's stable subject id, email, name, and picture.
    google_user = token.get("userinfo")
    if not google_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google did not return user information.",
        )

    google_sub = google_user.get("sub")
    email = google_user.get("email")
    if isinstance(email, str):
        email = email.strip().lower()
    if not google_sub or not email or google_user.get("email_verified") is not True:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account information could not be verified.",
        )

    # The stable Google subject is the primary lookup. Email is only the
    # fallback used to link an existing local account after Google verifies it.
    user = db.query(User).filter(User.google_sub == google_sub).first()
    if user is None:
        existing_email = db.query(User).filter(User.email == email).first()
        if existing_email is not None:
            # Never replace an existing Google link. A different subject with
            # the same email must not take over an already-linked account.
            if existing_email.google_sub is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This email is linked to another Google account.",
                )
            existing_email.google_sub = google_sub
            user = existing_email
        else:
            # First-time Google users receive a local account without a
            # password; future requests still use Daka's own session cookie.
            user_name = google_user.get("name") or email.split("@", 1)[0]
            user_name = user_name.strip()[:100] or "Google user"
            user = User(
                user_name=user_name,
                email=email,
                google_sub=google_sub,
                avatar=google_user.get("picture"),
            )
            db.add(user)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This Google account is already registered.",
                )
            db.refresh(user)

    # Create the same server-side session used by password login before
    # redirecting, so the frontend is authenticated immediately after return.
    response = RedirectResponse(url=settings.frontend_url, status_code=302)
    try:
        _open_session(db, user, response)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Google account is already registered.",
        )
    return response


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
            detail="An account with this email already exists.",
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
        # one person double-clicking "Create account". The check-then-insert
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
            detail="An account with this email already exists.",
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
            detail="Incorrect email or password.",
        )

    _open_session(db, user, response)
    return user


@router.get(
    "/me",
    response_model=UserOut,
    summary="Return the currently logged-in user",
)
def me(current_user: User = Depends(get_current_user)) -> User:
    """Report who the session cookie belongs to.

    The whole job is done by the get_current_user dependency: if the cookie is
    missing, unknown or expired, it raises 401 before this function runs, so
    reaching the body at all means there is a valid user. The frontend calls
    this once on page load to decide whether someone is logged in -- that is
    what keeps a session alive across a browser refresh.
    """
    return current_user


@router.patch(
    "/me",
    response_model=UserOut,
    summary="Update the currently logged-in user's profile",
)
def update_me(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Update only the profile fields included in the request body."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Log out and invalidate the current session",
)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    """Delete the current session row and clear the cookie.

    Deliberately NOT protected by get_current_user. Logout must succeed no
    matter the state of the cookie: an expired or unknown session should still
    end up logged out, not throw a 401. So we look the row up directly and
    delete it if present, and either way we tell the browser to drop the
    cookie.

    This delete is exactly what "logout invalidates the session" means: the
    token in the user's cookie now matches no row, so it can never authenticate
    again -- unlike a stateless JWT, which would stay valid until it expired.
    """
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if raw_token:
        token_hash = hash_session_token(raw_token)
        session = (
            db.query(UserSession)
            .filter(UserSession.token_hash == token_hash)
            .first()
        )
        if session is not None:
            db.delete(session)
            db.commit()

    # Clearing the cookie must use the SAME attributes it was set with (path,
    # samesite, secure, httponly), or some browsers keep the old one around.
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=True,
        samesite="lax",
    )
    # 204 No Content: success, nothing to send back.
    return None