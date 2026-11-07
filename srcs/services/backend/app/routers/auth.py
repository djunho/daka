"""Authentication routes: creating an account and logging in.

Mounted under /auth by app/main.py. Because nginx forwards /api/ to this
service, the public URLs are /api/auth/register and /api/auth/login.

"""
import logging
import secrets
from urllib.parse import quote

from authlib.integrations.base_client import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from starlette.responses import RedirectResponse
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import (
    SESSION_COOKIE_NAME,
    get_current_user,
    get_session_from_session_token,
)
from app.documents import delete_document
from app.media import delete_image, save_image
from app.models import (
    Document,
    Favorite,
    Friendship,
    Listing,
    ListingState,
    Negotiation,
    NegotiationState,
    Proposal,
    ProposalState,
    User,
    UserSession,
)
from app.presence import touch_last_seen
from app.schemas import LoginIn, ProfileUpdate, RegisterIn, SessionOut, UserOut
from app.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    is_session_active,
    session_expiry,
    utcnow,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

# Longest edge, in pixels, of a stored avatar. The UI shows avatars at most
# 80 px wide; 512 px stays sharp on high-density screens without keeping
# full-size phone photos on disk.
AVATAR_MAX_SIDE = 512

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

# Allowed OAuth 2.0 error codes (RFC 6749 section 4.1.2.1 / Google OAuth).
# Any unknown, malformed, or injected strings safely fallback to "auth_failed".
ALLOWED_OAUTH_ERRORS = {
    "access_denied",
    "invalid_request",
    "unauthorized_client",
    "server_error",
    "temporarily_unavailable",
    "interaction_required",
    "login_required",
    "consent_required",
}


def _sanitize_oauth_error(raw_error: str | None) -> str:
    """Validate and URL-encode external OAuth error codes before redirecting."""
    if raw_error and raw_error in ALLOWED_OAUTH_ERRORS:
        return quote(raw_error, safe="")
    return "auth_failed"


def _validate_redirect_dest(dest: str | None) -> str:
    """Ensure the destination path is a safe relative internal route to prevent open redirects."""
    if not dest or not isinstance(dest, str):
        return "/"
    if dest.startswith("/") and not dest.startswith("//") and "\\" not in dest:
        return dest
    return "/"


@router.get(
    "/google/login",
    summary="Start Google OAuth login",
)
async def google_login(request: Request, dest: str | None = None):
    """Redirect the browser to Google's consent screen."""
    frontend_url = settings.frontend_url.rstrip("/")
    if not settings.google_client_id or not settings.google_client_secret:
        return RedirectResponse(
            url=f"{frontend_url}/login?error=google_unconfigured",
            status_code=status.HTTP_302_FOUND,
        )

    # Preserve intended frontend destination in the temporary signed OAuth session
    request.session["oauth_dest"] = _validate_redirect_dest(dest)

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
    frontend_url = settings.frontend_url.rstrip("/")
    login_url = f"{frontend_url}/login"

    if not settings.google_client_id or not settings.google_client_secret:
        logger.warning("Google OAuth callback invoked but credentials are not configured")
        return RedirectResponse(
            url=f"{login_url}?error=google_unconfigured",
            status_code=status.HTTP_302_FOUND,
        )

    # Exchange Google's one-time authorization code for verified token data.
    # Authlib also checks the state saved by google_login before returning.
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as err:
        raw_error = err.error or request.query_params.get("error")
        logger.warning(
            "Google OAuth failed: %s (%s)",
            err.error,
            getattr(err, "description", None),
        )
        error_code = _sanitize_oauth_error(raw_error)
        return RedirectResponse(
            url=f"{login_url}?error={error_code}",
            status_code=status.HTTP_302_FOUND,
        )

    # The OpenID Connect userinfo claim contains the identity fields requested
    # by the client: Google's stable subject id, email, name, and picture.
    google_user = token.get("userinfo")
    if not google_user:
        logger.warning("Google OAuth failed: missing userinfo claim in token response")
        return RedirectResponse(
            url=f"{login_url}?error=auth_failed",
            status_code=status.HTTP_302_FOUND,
        )

    google_sub = google_user.get("sub")
    email = google_user.get("email")
    if isinstance(email, str):
        email = email.strip().lower()
    if not google_sub or not email or google_user.get("email_verified") is not True:
        logger.warning(
            "Google OAuth failed: unverified or missing claims (sub=%s, email=%s, verified=%s)",
            bool(google_sub),
            bool(email),
            google_user.get("email_verified"),
        )
        return RedirectResponse(
            url=f"{login_url}?error=auth_failed",
            status_code=status.HTTP_302_FOUND,
        )

    # The stable Google subject is the primary lookup. Email is only the
    # fallback used to link an existing local account after Google verifies it.
    user = (
        db.query(User)
        .filter(
            User.google_sub == google_sub,
            User.deleted_at.is_(None),
        )
        .first()
    )
    if user is None:
        # Lock the matched account until this transaction commits. Without
        # this lock, concurrent callbacks could both observe an empty
        # google_sub and the later commit could overwrite the first link.
        existing_email = (
            db.query(User)
            .filter(User.email == email)
            .with_for_update()
            .first()
        )
        if existing_email is not None:
            # Never replace an existing Google link. A different subject with
            # the same email must not take over an already-linked account.
            if existing_email.google_sub is not None:
                logger.warning(
                    "Google OAuth conflict: local account %s is already linked to another google_sub",
                    existing_email.id,
                )
                return RedirectResponse(
                    url=f"{login_url}?error=google_conflict",
                    status_code=status.HTTP_302_FOUND,
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
            except IntegrityError as exc:
                db.rollback()
                logger.warning("Google OAuth user creation race condition: %s", exc)
                return RedirectResponse(
                    url=f"{login_url}?error=server_error",
                    status_code=status.HTTP_302_FOUND,
                )
            db.refresh(user)

    # Retrieve and validate the intended destination stored during google_login
    dest = request.session.pop("oauth_dest", "/")
    safe_dest = _validate_redirect_dest(dest)
    redirect_url = f"{frontend_url}{safe_dest}"

    # Create the same server-side session used by password login before
    # redirecting, so the frontend is authenticated immediately after return.
    response = RedirectResponse(url=redirect_url, status_code=302)
    try:
        _open_session(db, user, response)
    except IntegrityError as exc:
        db.rollback()
        logger.warning("Google OAuth session creation error: %s", exc)
        return RedirectResponse(
            url=f"{login_url}?error=server_error",
            status_code=status.HTTP_302_FOUND,
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

    # Four cases collapse into one here, deliberately:
    #   - no account with that email        -> compare against the dummy hash
    #   - account exists but has no password (Google-only)
    #   - account is deactivated (deleted_at is set)
    #   - account exists and the password is wrong
    # The password is always checked first, so all four take the same amount
    # of time and produce the same message: the response leaks nothing about
    # which emails are registered or which accounts were deactivated.
    stored_hash = user.pass_hash if user and user.pass_hash else _DUMMY_HASH
    password_ok = verify_password(payload.password, stored_hash)

    if user is None or user.deleted_at is not None or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    _open_session(db, user, response)
    return user


@router.get(
    "/session",
    response_model=SessionOut,
    summary="Return the logged-in user, or null when there is no session",
)
def get_session(
    daka_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> SessionOut:
    """Tell the frontend whether someone is logged in.

    Called on page load and by the presence heartbeat. Unlike GET /me, having
    no session is a normal answer here, not an error: without one the answer
    is 200 with ``user: null``. Every visit makes this call, and a session can
    end while the site is open (it expires, or another tab logs out), so a 401
    would show up in red in the browser console. The same checks as get_current_user apply, so a
    missing, unknown, expired or deactivated session all read as no session.
    """
    session = get_session_from_session_token(daka_session, db)
    if session is None:
        # The cookie is left alone. Another tab may be logging in while this
        # answer travels back: clearing the cookie here would delete the new
        # one and log that tab out. Logging out is what clears it.
        return SessionOut(user=None)
    # Opening the site is activity, as with every authenticated request.
    touch_last_seen(db, session.user, session_id=session.id)
    return SessionOut(user=UserOut.model_validate(session.user))


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
    GET /session instead, on page load and for the presence heartbeat, because
    that one answers without an error when nobody is logged in.
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
    # get_current_user already read this row, which pins a MariaDB snapshot.
    # End that read before locking so a concurrent presence update does not
    # produce error 1020 under innodb_snapshot_isolation.
    db.rollback()
    db.refresh(current_user, with_for_update=True)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return current_user


@router.put(
    "/me/avatar",
    response_model=UserOut,
    summary="Upload or replace the current user's avatar",
)
def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Store a new avatar image and point the profile at it.

    The request is multipart/form-data with the image in a field named
    ``file``. Validation, re-encoding and storage live in app/media.py.
    """
    # Decoding and re-encoding the image is the slow part, so it runs before
    # the row is locked: the lock below is held only for a quick read and
    # write, never while the image is being processed.
    new_avatar = save_image(file, "avatars", AVATAR_MAX_SIDE)

    try:
        # Lock the user row until the commit. Without it, two uploads from
        # the same user at once would both read the same old avatar, and one
        # of the new files would stay on disk with nothing pointing at it.
        #
        # get_current_user already read this row, which pins a MariaDB
        # snapshot (innodb_snapshot_isolation): locking it now would fail
        # with error 1020 if another request changed it since. Ending that
        # read-only transaction first makes the lock wait for the other
        # request instead.
        db.rollback()
        db.refresh(current_user, with_for_update=True)
        old_avatar = current_user.avatar
        current_user.avatar = new_avatar
        db.commit()
    except Exception:
        # The database never recorded the new file, so nothing will ever
        # point at it: remove it before letting the error through.
        db.rollback()
        delete_image(new_avatar)
        raise

    # Only after the commit: until then the profile still used the old file.
    # delete_image ignores URLs we did not create, like a Google picture.
    delete_image(old_avatar)
    db.refresh(current_user)
    return current_user


@router.delete(
    "/me/avatar",
    response_model=UserOut,
    summary="Remove the current user's avatar",
)
def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Clear the avatar. The UI then falls back to the user's initial."""
    # See upload_avatar: end the read transaction before locking.
    db.rollback()
    db.refresh(current_user, with_for_update=True)
    old_avatar = current_user.avatar

    current_user.avatar = None
    db.commit()

    delete_image(old_avatar)
    db.refresh(current_user)
    return current_user


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete the currently logged-in user's account",
)
def delete_me(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Soft-delete the account and remove it from active application data."""
    # Lock the account first. See upload_avatar for why the read transaction
    # must end before locking on MariaDB 11.8.
    db.rollback()
    db.refresh(current_user, with_for_update=True)
    user_id = current_user.id
    avatar = current_user.avatar
    deleted_at = utcnow()
    listing_ids = [
        listing_id
        for (listing_id,) in db.query(Listing.id)
        .filter(Listing.user_id == user_id)
        .order_by(Listing.id)
        .all()
    ]
    # PDFs attached to those listings: the privacy policy promises that
    # deleting the account removes personal data, and an invoice may hold some.
    document_files = [
        file_name
        for (file_name,) in db.query(Document.file_name)
        .filter(Document.listing_id.in_(listing_ids))
        .all()
    ]

    listing_states = {
        state.state_name: state
        for state in db.query(ListingState)
        .filter(
            ListingState.state_name.in_(
                ("Available", "Reserved", "Traded", "Removed")
            )
        )
        .all()
    }
    negotiation_states = {
        state.state_name: state
        for state in db.query(NegotiationState)
        .filter(
            NegotiationState.state_name.in_(
                ("Open", "Agreed", "Cancelled", "Unavailable")
            )
        )
        .all()
    }
    proposal_states = {
        state.state_name: state
        for state in db.query(ProposalState)
        .filter(
            ProposalState.state_name.in_(
                (
                    "Pending",
                    "Accepted",
                    "Rejected",
                    "Withdrawn",
                    "ItemUnavailable",
                )
            )
        )
        .all()
    }
    if (
        len(listing_states) != 4
        or len(negotiation_states) != 4
        or len(proposal_states) != 5
    ):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account deletion states are not configured.",
        )

    # Account deletion touches negotiations both through ownership and through
    # offered listings.  Lock the complete relationship graph in the same
    # order as negotiation lifecycle operations: negotiations, proposals,
    # listings.  The initial listing query above only discovers IDs.
    offering_negotiation_ids = db.query(Proposal.negotiation_id).filter(
        Proposal.offered_listing_id.in_(listing_ids),
        Proposal.proposal_state_id == proposal_states["Pending"].id,
    )
    affected_negotiation_ids = [
        negotiation_id
        for (negotiation_id,) in db.query(Negotiation.id)
        .filter(
            or_(
                Negotiation.interested_user_id == user_id,
                Negotiation.listing_id.in_(listing_ids),
                Negotiation.id.in_(offering_negotiation_ids),
            ),
            Negotiation.negotiation_state_id.in_(
                (
                    negotiation_states["Open"].id,
                    negotiation_states["Agreed"].id,
                )
            ),
        )
        .order_by(Negotiation.id)
        .with_for_update()
        .all()
    ]
    locked_proposals = []
    if affected_negotiation_ids:
        locked_proposals = (
            db.query(Proposal)
            .filter(Proposal.negotiation_id.in_(affected_negotiation_ids))
            .order_by(Proposal.id)
            .with_for_update()
            .all()
        )
    affected_listing_ids = set(listing_ids)
    affected_listing_ids.update(
        listing_id
        for (listing_id,) in db.query(Negotiation.listing_id)
        .filter(Negotiation.id.in_(affected_negotiation_ids))
        .all()
    )
    affected_listing_ids.update(
        proposal.offered_listing_id
        for proposal in locked_proposals
        if proposal.offered_listing_id is not None
    )
    if affected_listing_ids:
        (
            db.query(Listing)
            .filter(Listing.id.in_(affected_listing_ids))
            .order_by(Listing.id)
            .with_for_update()
            .all()
        )

    try:
        # Participant cancellation takes precedence over item unavailability.
        # The interested user's open and agreed negotiations are cancelled.
        # Agreed negotiations owned by the deleted user are also cancelled so
        # their reserved listings can be released before the owner's listings
        # are removed.
        negotiations_to_cancel = (
            db.query(Negotiation)
            .filter(
                Negotiation.id.in_(affected_negotiation_ids),
                or_(
                    Negotiation.interested_user_id == user_id,
                    (
                        Negotiation.listing_id.in_(listing_ids)
                        & (
                            Negotiation.negotiation_state_id
                            == negotiation_states["Agreed"].id
                        )
                    ),
                ),
                Negotiation.negotiation_state_id.in_(
                    (
                        negotiation_states["Open"].id,
                        negotiation_states["Agreed"].id,
                    )
                ),
            )
            .order_by(Negotiation.id)
            .all()
        )

        for negotiation in negotiations_to_cancel:
            cancelled_by_interested = negotiation.interested_user_id == user_id
            terminal_proposal_state = proposal_states[
                "Withdrawn" if cancelled_by_interested else "Rejected"
            ]
            db.query(Proposal).filter(
                Proposal.negotiation_id == negotiation.id,
                Proposal.proposal_state_id == proposal_states["Pending"].id,
            ).update(
                {
                    Proposal.proposal_state_id: terminal_proposal_state.id,
                    Proposal.responded_at: deleted_at,
                },
                synchronize_session=False,
            )

            if (
                negotiation.negotiation_state_id
                == negotiation_states["Agreed"].id
            ):
                accepted_proposal = (
                    db.query(Proposal)
                    .filter(
                        Proposal.negotiation_id == negotiation.id,
                        Proposal.proposal_state_id
                        == proposal_states["Accepted"].id,
                    )
                    .with_for_update()
                    .one_or_none()
                )
                involved_listing_ids = [negotiation.listing_id]
                if (
                    accepted_proposal is not None
                    and accepted_proposal.offered_listing_id is not None
                ):
                    involved_listing_ids.append(
                        accepted_proposal.offered_listing_id
                    )
                db.query(Listing).filter(
                    Listing.id.in_(involved_listing_ids),
                    Listing.state_id == listing_states["Reserved"].id,
                ).update(
                    {Listing.state_id: listing_states["Available"].id},
                    synchronize_session=False,
                )

            negotiation.negotiation_state_id = negotiation_states["Cancelled"].id
            negotiation.cancelled_by_user_id = user_id
            negotiation.cancelled_at = deleted_at

        # Keep historical rows. Listings that already reached Traded preserve
        # that terminal state; every other owned listing leaves active use.
        db.query(Listing).filter(
            Listing.user_id == user_id,
            Listing.id.in_(listing_ids),
            Listing.state_id.notin_(
                (
                    listing_states["Traded"].id,
                    listing_states["Removed"].id,
                )
            ),
        ).update(
            {Listing.state_id: listing_states["Removed"].id},
            synchronize_session=False,
        )

        unavailable_negotiation_ids = [
            negotiation_id
            for (negotiation_id,) in db.query(Negotiation.id)
            .filter(
                Negotiation.id.in_(affected_negotiation_ids),
                Negotiation.listing_id.in_(listing_ids),
                Negotiation.negotiation_state_id
                == negotiation_states["Open"].id,
            )
            .order_by(Negotiation.id)
            .all()
        ]
        if unavailable_negotiation_ids:
            db.query(Proposal).filter(
                Proposal.negotiation_id.in_(unavailable_negotiation_ids),
                Proposal.proposal_state_id == proposal_states["Pending"].id,
            ).update(
                {
                    Proposal.proposal_state_id: proposal_states[
                        "ItemUnavailable"
                    ].id,
                    Proposal.responded_at: deleted_at,
                },
                synchronize_session=False,
            )
            db.query(Negotiation).filter(
                Negotiation.id.in_(unavailable_negotiation_ids)
            ).update(
                {
                    Negotiation.negotiation_state_id: negotiation_states[
                        "Unavailable"
                    ].id
                },
                synchronize_session=False,
            )

        db.query(Proposal).filter(
            Proposal.offered_listing_id.in_(listing_ids),
            Proposal.proposal_state_id == proposal_states["Pending"].id,
        ).update(
            {
                Proposal.proposal_state_id: proposal_states[
                    "ItemUnavailable"
                ].id,
                Proposal.responded_at: deleted_at,
            },
            synchronize_session=False,
        )
        db.query(Favorite).filter(
            or_(
                Favorite.user_id == user_id,
                Favorite.listing_id.in_(listing_ids),
            )
        ).delete(synchronize_session=False)
        # Account deletion is permanent, so its friendship rows are removed
        # rather than retained as reusable "removed" relationships.
        db.query(Friendship).filter(
            or_(
                Friendship.user_id == user_id,
                Friendship.friend_id == user_id,
            )
        ).delete(synchronize_session=False)
        db.query(Document).filter(Document.listing_id.in_(listing_ids)).delete(
            synchronize_session=False
        )
        current_user.deleted_at = deleted_at
        current_user.user_name = "Deleted user"
        current_user.email = f"deleted-{user_id}@deleted.daka"
        current_user.pass_hash = None
        current_user.google_sub = None
        current_user.avatar = None
        current_user.user_location = None
        current_user.last_seen = None
        db.query(UserSession).filter(UserSession.user_id == user_id).delete(
            synchronize_session=False
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account deactivation could not be completed due to a database conflict.",
        )

    # The account is now inactive, so its private avatar file is no longer
    # needed. File cleanup happens after commit so a rollback keeps the data.
    delete_image(avatar)
    for file_name in document_files:
        delete_document(file_name)

    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return None


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
        user_id = (
            db.query(UserSession.user_id)
            .filter(UserSession.token_hash == token_hash)
            .scalar()
        )
        if user_id is not None:
            db.rollback()
            user = (
                db.query(User)
                .filter(User.id == user_id)
                .with_for_update()
                .one_or_none()
            )
            session = (
                db.query(UserSession)
                .filter(
                    UserSession.token_hash == token_hash,
                    UserSession.user_id == user_id,
                )
                .with_for_update()
                .one_or_none()
            )
            if session is not None:
                session_was_active = is_session_active(session.expires_at)
                db.delete(session)
                if user is not None and session_was_active:
                    db.query(User).filter(User.id == user_id).update(
                        {
                            User.last_seen: None,
                            User.updated_at: User.updated_at,
                        },
                        synchronize_session=False,
                    )
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
