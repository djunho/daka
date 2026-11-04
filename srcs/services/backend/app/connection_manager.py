"""Process-local WebSocket rooms; accessed only from the application event loop."""

import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Track authorised connections without persisting or exposing room sets."""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = {}

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

        await websocket.accept()
        # No await between room lookup and insertion: other event-loop tasks
        # cannot interleave these mutations.
        self._connections.setdefault(negotiation_id, set()).add(websocket)
        logger.info(
            "WebSocket connected negotiation_id=%s room_connections=%s",
            negotiation_id, self.connection_count(negotiation_id),
        )

    def disconnect(self, negotiation_id: int, websocket: WebSocket) -> None:
        """Remove only this connection; repeated cleanup is harmless."""
        room = self._connections.get(negotiation_id)
        if room is None or websocket not in room:
            return
        room.remove(websocket)
        if not room:
            del self._connections[negotiation_id]
        logger.info(
            "WebSocket removed negotiation_id=%s room_connections=%s",
            negotiation_id, self.connection_count(negotiation_id),
        )


# One shared manager per backend process, not one per request or connection.
manager = ConnectionManager()
