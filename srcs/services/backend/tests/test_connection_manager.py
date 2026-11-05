"""Connection lifecycle tests without a database or network server."""

import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from starlette.websockets import WebSocketDisconnect

from app.connection_manager import ConnectionManager
from app.routers.websockets import negotiation_websocket


def connection(room: int = 20, user=None):
    websocket = AsyncMock()
    websocket.state = SimpleNamespace(
        negotiation_id=room, current_user=user or SimpleNamespace(id=1)
    )
    return websocket


class ConnectionManagerTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.manager = ConnectionManager()

    async def test_multiple_devices_and_independent_rooms(self):
        user = SimpleNamespace(id=1)
        first, second, other = connection(user=user), connection(user=user), connection(21)
        await asyncio.gather(
            self.manager.connect(20, first),
            self.manager.connect(20, second),
            self.manager.connect(21, other),
        )
        self.assertEqual(self.manager.room_count, 2)
        self.assertEqual(self.manager.connection_count(20), 2)
        self.assertEqual(self.manager.connection_count(), 3)
        self.manager.disconnect(20, first)
        self.assertEqual(self.manager.connection_count(20), 1)
        self.assertEqual(self.manager.connection_count(21), 1)
        self.manager.disconnect(20, second)
        self.assertEqual(self.manager.room_count, 1)
        self.manager.disconnect(21, other)
        self.assertEqual(self.manager.room_count, 0)

    async def test_duplicate_registration_accepts_once(self):
        websocket = connection()
        await self.manager.connect(20, websocket)
        await self.manager.connect(20, websocket)
        websocket.accept.assert_awaited_once()
        self.assertEqual(self.manager.connection_count(20), 1)

    async def test_repeated_cleanup_preserves_new_connection(self):
        old, new = connection(), connection()
        self.manager.disconnect(20, old)
        await self.manager.connect(20, old)
        self.manager.disconnect(20, old)
        await self.manager.connect(20, new)
        self.manager.disconnect(20, old)
        self.assertEqual(self.manager.connection_count(20), 1)
        self.manager.disconnect(20, new)
        self.manager.disconnect(20, new)
        self.assertEqual(self.manager.room_count, 0)

    async def test_failed_accept_leaves_no_room(self):
        websocket = connection()
        websocket.accept.side_effect = RuntimeError("accept failed")
        with self.assertRaises(RuntimeError):
            await self.manager.connect(20, websocket)
        self.assertEqual(self.manager.room_count, 0)

    async def test_missing_or_mismatched_authorisation_is_not_registered(self):
        for websocket in (connection(21), connection()):
            if websocket.state.negotiation_id == 20:
                websocket.state.current_user = None
            with self.assertRaises(ValueError):
                await self.manager.connect(20, websocket)
            websocket.accept.assert_not_awaited()
        self.assertEqual(self.manager.room_count, 0)


class EndpointCleanupTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_error_and_cancellation_cleanup(self):
        for outcome in (
            {"type": "websocket.disconnect", "code": 1000},
            {"type": "websocket.disconnect", "code": 1006},
            WebSocketDisconnect(1001),
            RuntimeError("private payload"),
            asyncio.CancelledError(),
        ):
            with self.subTest(outcome=type(outcome).__name__):
                manager = ConnectionManager()
                websocket = connection()
                websocket.headers = {"origin": "https://localhost:8443"}
                websocket.cookies = {"daka_session": "private token"}
                if isinstance(outcome, BaseException):
                    websocket.receive.side_effect = outcome
                else:
                    websocket.receive.return_value = outcome
                with patch("app.routers.websockets.manager", manager), patch(
                    "app.routers.websockets.run_in_threadpool",
                    AsyncMock(return_value=(SimpleNamespace(id=1), SimpleNamespace(id=20))),
                ), self.assertLogs("app", level="INFO") as logs:
                    if isinstance(outcome, (RuntimeError, asyncio.CancelledError)):
                        with self.assertRaises(type(outcome)):
                            await negotiation_websocket(websocket, "20")
                    else:
                        await negotiation_websocket(websocket, "20")
                self.assertEqual(manager.connection_count(), 0)
                self.assertEqual(manager.room_count, 0)
                output = " ".join(logs.output)
                self.assertNotIn("private payload", output)
                self.assertNotIn("private token", output)
                if isinstance(outcome, dict) and outcome["code"] == 1000:
                    self.assertFalse(any("ERROR" in line for line in logs.output))


if __name__ == "__main__":
    unittest.main()
