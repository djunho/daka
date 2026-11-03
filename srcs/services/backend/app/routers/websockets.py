"""Authenticated and authorised WebSocket entry points.

Close-code contract (before accepting the connection):

* 4401: missing, empty, invalid, or expired session; inactive account
* 4403: authenticated user is not a participant in the negotiation
* 4404: malformed negotiation id or negotiation not found
* 4403: missing or unrecognised Origin (cookie-CSRF protection)

Message routing intentionally remains outside this module. The authorised
user, negotiation, and validated id are placed in ``websocket.state`` for the
ConnectionManager ticket to consume without trusting client-supplied identity.
"""

from fastapi import APIRouter, WebSocket
from sqlalchemy.orm import joinedload

from app.config import settings
from app.database import SessionLocal
from app.dependencies import SESSION_COOKIE_NAME, get_user_from_session_token
from app.models import Listing, Negotiation

router = APIRouter()

WS_UNAUTHENTICATED = 4401
WS_FORBIDDEN = 4403
WS_NOT_FOUND = 4404


def _origin_is_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if origin is None:
        return False
    return origin.rstrip("/") in settings.allowed_websocket_origins


def _parse_negotiation_id(raw_id: str) -> int | None:
    try:
        negotiation_id = int(raw_id)
    except (TypeError, ValueError):
        return None
    return negotiation_id if negotiation_id > 0 and str(negotiation_id) == raw_id else None


@router.websocket("/ws/negotiations/{negotiation_id}")
async def negotiation_websocket(websocket: WebSocket, negotiation_id: str) -> None:
    """Authorise a negotiation room using only the existing session cookie."""
    if not _origin_is_allowed(websocket):
        await websocket.close(code=WS_FORBIDDEN)
        return

    validated_id = _parse_negotiation_id(negotiation_id)
    if validated_id is None:
        await websocket.close(code=WS_NOT_FOUND)
        return

    with SessionLocal() as db:
        current_user = get_user_from_session_token(
            websocket.cookies.get(SESSION_COOKIE_NAME), db
        )
        if current_user is None:
            await websocket.close(code=WS_UNAUTHENTICATED)
            return

        negotiation = (
            db.query(Negotiation)
            .options(
                joinedload(Negotiation.requested_listing).joinedload(Listing.owner)
            )
            .filter(Negotiation.id == validated_id)
            .first()
        )
        if negotiation is None:
            await websocket.close(code=WS_NOT_FOUND)
            return

        if current_user.id not in (
            negotiation.interested_user_id,
            negotiation.requested_listing.user_id,
        ):
            await websocket.close(code=WS_FORBIDDEN)
            return

        # Detach the fully loaded authorization context. A database connection
        # must not remain checked out for the lifetime of a WebSocket.
        db.expunge(current_user)
        db.expunge(negotiation)

    websocket.state.current_user = current_user
    websocket.state.negotiation = negotiation
    websocket.state.negotiation_id = validated_id
    await websocket.accept()

    # ConnectionManager will replace this transport-only wait loop. No payload
    # is interpreted, so token/sender_id claims cannot influence identity.
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return
