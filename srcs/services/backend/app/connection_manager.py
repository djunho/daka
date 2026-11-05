"""Process-local WebSocket rooms; accessed only from the application event loop."""

import asyncio
import logging
from collections.abc import Awaitable, Callable

from fastapi import WebSocket, WebSocketDisconnect

from app.schemas import MessageCreatedEvent, PersistedMessage, WebSocketErrorEvent
from app.dependencies import SESSION_COOKIE_NAME
from app.websocket_authorization import authorize_recipient

logger = logging.getLogger(__name__)
SEND_TIMEOUT_SECONDS = 5.0
CLOSE_TIMEOUT_SECONDS = 1.0


class ConnectionManager:
    """Track authorised connections without persisting or exposing room sets."""

    def __init__(
        self, recipient_authorizer: Callable[[int, int, str | None], Awaitable[int | None]] = authorize_recipient,
    ) -> None:
        self._connections: dict[int, set[WebSocket]] = {}
        self._send_locks: dict[WebSocket, asyncio.Lock] = {}
        self._connecting: dict[WebSocket, asyncio.Task] = {}
        self._identities: dict[WebSocket, tuple[int, str | None]] = {}
        self._recipient_authorizer = recipient_authorizer

    def is_connected(self, negotiation_id: int, websocket: WebSocket) -> bool:
        return websocket in self._connections.get(negotiation_id, ())

    def connection_count(self, negotiation_id: int | None = None) -> int:
        """Return a room's count, or the total for this process."""
        if negotiation_id is not None:
            return len(self._connections.get(negotiation_id, ()))
        return sum(len(room) for room in self._connections.values())

    @property
    def room_count(self) -> int:
        return len(self._connections)

    async def connect(self, negotiation_id: int, websocket: WebSocket) -> None:
        """Accept and register a connection after endpoint authorisation.

        The state check enforces the endpoint's authorised room, not participant
        authorisation itself. No room is created until acceptance succeeds.
        """
        if (
            getattr(websocket.state, "negotiation_id", None) != negotiation_id
            or getattr(websocket.state, "current_user", None) is None
        ):
            raise ValueError("WebSocket has no matching authorised negotiation")
        if websocket in self._connections.get(negotiation_id, ()):
            return

        task = self._connecting.get(websocket)
        if task is None:
            task = asyncio.create_task(self._accept_and_register(negotiation_id, websocket))
            self._connecting[websocket] = task
        try:
            # One accept attempt per socket; concurrent callers share its result.
            # Cancellation aborts the shared attempt, preventing orphan sockets.
            await task
        finally:
            if task.done() and self._connecting.get(websocket) is task:
                self._connecting.pop(websocket, None)

    async def _accept_and_register(self, negotiation_id: int, websocket: WebSocket) -> None:
        user_id = websocket.state.current_user.id
        token = websocket.cookies.get(SESSION_COOKIE_NAME)
        await websocket.accept()
        # No await between room lookup and insertion: other event-loop tasks
        # cannot interleave these mutations.
        self._connections.setdefault(negotiation_id, set()).add(websocket)
        self._send_locks[websocket] = asyncio.Lock()
        self._identities[websocket] = (user_id, token)
        logger.info(
            "WebSocket connected negotiation_id=%s room_connections=%s",
            negotiation_id, self.connection_count(negotiation_id),
        )

    def disconnect(self, negotiation_id: int, websocket: WebSocket) -> None:
        """Remove only this connection; repeated cleanup is harmless."""
        pending = self._connecting.get(websocket)
        if (
            pending is not None and not pending.done()
            and websocket.state.negotiation_id == negotiation_id
        ):
            pending.cancel()
        room = self._connections.get(negotiation_id)
        if room is None:
            return
        previous_count = len(room)
        room.discard(websocket)
        if len(room) == previous_count:
            return
        self._send_locks.pop(websocket, None)
        self._identities.pop(websocket, None)
        if not room:
            del self._connections[negotiation_id]
        logger.info(
            "WebSocket removed negotiation_id=%s room_connections=%s",
            negotiation_id, self.connection_count(negotiation_id),
        )

    async def broadcast(self, message: PersistedMessage) -> bool:
        """Deliver only committed worker results, deriving the room from them.

        No database work or client-provided room argument is accepted here.
        A false result means an internal preparation/delivery failure, not a
        failed commit. Individual failed sockets are handled independently.
        """
        negotiation_id = getattr(message, "negotiation_id", None)
        message_id = getattr(message, "id", None)
        try:
            if not isinstance(message, PersistedMessage):
                raise TypeError("Broadcast requires a committed persistence result")
            payload = MessageCreatedEvent.from_persisted(message).model_dump_json()
            connections = tuple(self._connections.get(negotiation_id, ()))
            outcomes = await asyncio.gather(*(
                self._send_text(negotiation_id, websocket, payload, message_id=message_id)
                for websocket in connections
            ))
        except Exception as exc:
            logger.error(
                "WebSocket broadcast failed negotiation_id=%s message_id=%s error_type=%s",
                negotiation_id, message_id, type(exc).__name__,
            )
            return False
        logger.info(
            "WebSocket broadcast completed negotiation_id=%s message_id=%s delivered=%s removed=%s",
            negotiation_id, message_id, outcomes.count("sent"), outcomes.count("removed"),
        )
        return True

    async def send_error(
        self, negotiation_id: int, websocket: WebSocket, event: dict,
        *, close_code: int | None = None,
    ) -> bool:
        """Send an error only to its origin, sharing the broadcast send lock."""
        try:
            payload = WebSocketErrorEvent.model_validate(event).model_dump_json(exclude_none=True)
        except Exception as exc:
            logger.error(
                "WebSocket error serialisation failed negotiation_id=%s error_type=%s",
                negotiation_id, type(exc).__name__,
            )
            lock = self._send_locks.get(websocket)
            if lock is not None:
                async with lock:
                    self.disconnect(negotiation_id, websocket)
                    await self._close(websocket, 1011)
            return False
        outcome = await self._send_text(
            negotiation_id, websocket, payload, close_code=close_code,
        )
        return outcome == "sent"

    async def _send_text(
        self, negotiation_id: int, websocket: WebSocket, payload: str,
        *, message_id: int | None = None, close_code: int | None = None,
    ) -> str:
        lock = self._send_locks.get(websocket)
        if lock is None:
            return "skipped"
        async with lock:
            if not self.is_connected(negotiation_id, websocket):
                return "skipped"
            try:
                if message_id is not None:
                    user_id, token = self._identities[websocket]
                    code = await self._recipient_authorizer(negotiation_id, user_id, token)
                    # A disconnect can happen while the worker queries the DB.
                    if not self.is_connected(negotiation_id, websocket):
                        return "skipped"
                    if code is not None:
                        logger.info(
                            "WebSocket recipient removed negotiation_id=%s message_id=%s code=%s",
                            negotiation_id, message_id, code,
                        )
                        self.disconnect(negotiation_id, websocket)
                        await self._close(websocket, code)
                        return "removed"
                await asyncio.wait_for(websocket.send_text(payload), SEND_TIMEOUT_SECONDS)
            except Exception as exc:
                # Closed transports are expected; unexpected failures are errors.
                log = logger.info if isinstance(exc, (WebSocketDisconnect, OSError, RuntimeError)) else logger.error
                if isinstance(exc, TimeoutError):
                    log = logger.warning
                log(
                    "WebSocket send failed negotiation_id=%s message_id=%s error_type=%s",
                    negotiation_id, message_id, type(exc).__name__,
                )
                was_registered = self.is_connected(negotiation_id, websocket)
                self.disconnect(negotiation_id, websocket)
                await self._close(websocket, 1011)
                return "removed" if was_registered else "skipped"
            if close_code is not None:
                self.disconnect(negotiation_id, websocket)
                await self._close(websocket, close_code)
            return "sent"

    async def _close(self, websocket: WebSocket, code: int) -> None:
        try:
            await asyncio.wait_for(websocket.close(code=code), CLOSE_TIMEOUT_SECONDS)
        except Exception:
            # The peer may already be gone. It has already been unregistered.
            pass


# One shared manager per backend process, not one per request or connection.
manager = ConnectionManager()
