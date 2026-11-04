"""Authenticated and authorised WebSocket entry points.

Close-code contract (validation precedes a technical accept and close):

* 4401: missing, empty, invalid, or expired session; inactive account
* 4403: authenticated user is not a participant in the negotiation
* 4404: malformed negotiation id or negotiation not found
* 4403: missing or unrecognised Origin (cookie-CSRF protection)

Message routing intentionally remains outside this module. The authorised
user, negotiation, and validated id are placed in ``websocket.state`` for the
ConnectionManager to consume without trusting client-supplied identity.
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import joinedload
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.connection_manager import manager
from app.database import SessionLocal
from app.dependencies import SESSION_COOKIE_NAME, get_user_from_session_token
from app.models import Listing, Negotiation, User
from app.message_processing import (
    MessageProcessingError, MessageRateLimiter, parse_message_event, persist_message,
)

router = APIRouter()
logger = logging.getLogger(__name__)

WS_UNAUTHENTICATED = 4401
WS_FORBIDDEN = 4403
WS_NOT_FOUND = 4404


async def _reject(websocket: WebSocket, code: int) -> None:
    """Complete the upgrade so browsers can receive the WebSocket close code.

    This does not register the connection in a room or send private data.
    Closing before accept would reject the HTTP handshake instead.
    """
    await websocket.accept()
    await websocket.close(code=code)


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


def _authorize_negotiation(
    token: str | None, negotiation_id: int
) -> tuple[User, Negotiation] | int:
    """Return detached authorised objects or a refusal code.

    Create, use and close the database session within the worker thread.
    All relationships needed by the authorization context are loaded here.
    """
    with SessionLocal() as db:
        current_user = get_user_from_session_token(token, db)
        if current_user is None:
            return WS_UNAUTHENTICATED

        negotiation = (
            db.query(Negotiation)
            .options(
                joinedload(Negotiation.requested_listing).joinedload(Listing.owner)
            )
            .filter(Negotiation.id == negotiation_id)
            .first()
        )
        if negotiation is None:
            return WS_NOT_FOUND

        if current_user.id not in (
            negotiation.interested_user_id,
            negotiation.requested_listing.user_id,
        ):
            return WS_FORBIDDEN

        # Detach the fully loaded authorization context. A database connection
        # must not remain checked out for the lifetime of a WebSocket.
        db.expunge(current_user)
        db.expunge(negotiation)

    return current_user, negotiation


@router.websocket("/ws/negotiations/{negotiation_id}")
async def negotiation_websocket(websocket: WebSocket, negotiation_id: str) -> None:
    """Authorise a negotiation room using only the existing session cookie."""
    if not _origin_is_allowed(websocket):
        await _reject(websocket, WS_FORBIDDEN)
        return

    validated_id = _parse_negotiation_id(negotiation_id)
    if validated_id is None:
        await _reject(websocket, WS_NOT_FOUND)
        return

    authorization = await run_in_threadpool(
        _authorize_negotiation,
        websocket.cookies.get(SESSION_COOKIE_NAME),
        validated_id,
    )
    if isinstance(authorization, int):
        await _reject(websocket, authorization)
        return

    current_user, negotiation = authorization
    websocket.state.current_user = current_user
    websocket.state.negotiation = negotiation
    websocket.state.negotiation_id = validated_id
    limiter = MessageRateLimiter()
    try:
        await manager.connect(validated_id, websocket)
        while manager.is_connected(validated_id, websocket):
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                _log_disconnect(validated_id, message.get("code", 1006))
                return
            if not manager.is_connected(validated_id, websocket):
                return
            try:
                limiter.check()
                event = parse_message_event(message.get("text"))
                persisted_message = await run_in_threadpool(
                    persist_message, event, validated_id, current_user.id,
                    websocket.cookies.get(SESSION_COOKIE_NAME),
                )
            except MessageProcessingError as exc:
                sent = await manager.send_error(
                    validated_id, websocket, exc.as_event(), close_code=exc.close_code,
                )
                if not sent or exc.close_code is not None:
                    return
                continue
            if not await manager.broadcast(persisted_message):
                # A committed message must never be retried/rolled back here.
                if not await manager.send_error(
                    validated_id, websocket, MessageProcessingError("delivery_failed").as_event(),
                ):
                    return
    except WebSocketDisconnect as exc:
        _log_disconnect(validated_id, exc.code)
    except Exception:
        # Do not include exception text: it may contain client-supplied data.
        logger.error("WebSocket loop failed negotiation_id=%s", validated_id)
        raise
    finally:
        limiter.clear()
        manager.disconnect(validated_id, websocket)


def _log_disconnect(negotiation_id: int, code: int) -> None:
    log = logger.info if code in (1000, 1001) else logger.warning
    log("WebSocket disconnected negotiation_id=%s code=%s", negotiation_id, code)
