"""Local delivery, independent failures, concurrency and public event contracts."""

import asyncio
from datetime import datetime, timedelta, timezone
import json
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from sqlalchemy.exc import OperationalError

from app.connection_manager import ConnectionManager
from app.message_processing import MessageProcessingError
from app.schemas import MessageCreatedEvent, PersistedMessage
from app.websocket_authorization import _recipient_close_code, authorize_recipient


def persisted(room=20, message_id=123, **overrides):
    data = dict(
        id=message_id, negotiation_id=room, msg_sender=7, msg="Olá\nparceira",
        created_at=datetime(2026, 10, 28, 14, 30),
    )
    data.update(overrides)
    return PersistedMessage(**data)


class BroadcastTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.authorizer = AsyncMock(return_value=None)
        self.manager = ConnectionManager(recipient_authorizer=self.authorizer)

    async def connect(self, room=20, user_id=7):
        websocket = AsyncMock()
        websocket.state = SimpleNamespace(
            negotiation_id=room, current_user=SimpleNamespace(id=user_id)
        )
        websocket.cookies = {"daka_session": "token"}
        await self.manager.connect(room, websocket)
        return websocket

    async def test_all_room_connections_including_sender_receive_one_public_event(self):
        sender = await self.connect()
        second_device = await self.connect()
        owner = await self.connect(user_id=8)
        other_room = await self.connect(21)
        original = MessageCreatedEvent.model_dump_json
        with patch.object(MessageCreatedEvent, "model_dump_json", autospec=True, side_effect=original) as serialise:
            message = persisted()
            self.assertTrue(await self.manager.broadcast(message))
            serialise.assert_called_once()
        for websocket in (sender, second_device, owner):
            websocket.send_text.assert_awaited_once()
            data = json.loads(websocket.send_text.call_args.args[0])
            self.assertEqual(data, {
                "type": "message.created",
                "message": {
                    "id": 123, "negotiation_id": 20, "sender_id": 7,
                    "content": "Olá\nparceira", "created_at": "2026-10-28T14:30:00Z",
                },
            })
        other_room.send_text.assert_not_awaited()
        self.assertEqual(message, persisted())

    async def test_empty_room_and_single_connection_are_supported(self):
        self.assertTrue(await self.manager.broadcast(persisted()))
        self.assertEqual(self.manager.room_count, 0)
        websocket = await self.connect()
        self.assertTrue(await self.manager.broadcast(persisted()))
        websocket.send_text.assert_awaited_once()

    async def test_missing_database_fields_or_wrong_result_are_not_broadcast(self):
        websocket = await self.connect()
        for message in (
            persisted(message_id=0),
            persisted().model_copy(update={"created_at": None}),
            SimpleNamespace(id=123, negotiation_id=20),
        ):
            with self.assertLogs("app.connection_manager", level="ERROR"):
                self.assertFalse(await self.manager.broadcast(message))
        websocket.send_text.assert_not_awaited()

    async def test_timestamps_are_serialised_as_utc(self):
        message = persisted(created_at=datetime(2026, 10, 28, 16, 30, tzinfo=timezone(timedelta(hours=2))))
        data = json.loads(MessageCreatedEvent.from_persisted(message).model_dump_json())
        self.assertEqual(data["message"]["created_at"], "2026-10-28T14:30:00Z")

    async def test_one_failed_socket_is_removed_without_interrupting_other_sends(self):
        failed, healthy = await self.connect(), await self.connect()
        failed.send_text.side_effect = RuntimeError("private token and content")
        with self.assertLogs("app.connection_manager", level="INFO") as logs:
            self.assertTrue(await self.manager.broadcast(persisted()))
        healthy.send_text.assert_awaited_once()
        self.assertFalse(self.manager.is_connected(20, failed))
        self.assertTrue(self.manager.is_connected(20, healthy))
        failed.close.assert_awaited_once_with(code=1011)
        output = " ".join(logs.output)
        self.assertIn("message_id=123", output)
        self.assertIn("delivered=1 removed=1", output)
        self.assertNotIn("private", output)
        self.assertFalse(any("ERROR" in line for line in logs.output))

    async def test_all_failed_sockets_remove_the_room_even_when_close_fails(self):
        websocket = await self.connect()
        websocket.send_text.side_effect = OSError("gone")
        websocket.close.side_effect = RuntimeError("already closed")
        await self.manager.broadcast(persisted())
        self.assertEqual(self.manager.room_count, 0)
        self.assertEqual(self.manager.connection_count(), 0)
        self.manager.disconnect(20, websocket)

    async def test_slow_socket_does_not_delay_healthy_delivery_and_is_removed(self):
        slow, healthy = await self.connect(), await self.connect()
        delivered = asyncio.Event()

        async def stall(_payload):
            await asyncio.Event().wait()

        async def receive(_payload):
            delivered.set()

        slow.send_text.side_effect = stall
        healthy.send_text.side_effect = receive
        with patch("app.connection_manager.SEND_TIMEOUT_SECONDS", 0.05):
            task = asyncio.create_task(self.manager.broadcast(persisted()))
            await asyncio.wait_for(delivered.wait(), timeout=1)
            await asyncio.wait_for(task, timeout=1)
        self.assertFalse(self.manager.is_connected(20, slow))
        self.assertTrue(self.manager.is_connected(20, healthy))

    async def test_connect_and_disconnect_during_broadcast_preserve_new_room(self):
        old = await self.connect()
        started, release = asyncio.Event(), asyncio.Event()

        async def send(_payload):
            started.set()
            await release.wait()
            raise OSError("connection disappeared")

        old.send_text.side_effect = send
        task = asyncio.create_task(self.manager.broadcast(persisted()))
        await asyncio.wait_for(started.wait(), timeout=1)
        self.manager.disconnect(20, old)
        new = await self.connect()
        release.set()
        self.assertTrue(await asyncio.wait_for(task, timeout=1))
        new.send_text.assert_not_awaited()
        self.assertEqual(self.manager.connection_count(20), 1)

    async def test_concurrent_broadcasts_and_errors_never_write_same_socket_together(self):
        websocket = await self.connect()
        sending = False
        received = []

        async def send(payload):
            nonlocal sending
            self.assertFalse(sending, "overlapping writes on one socket")
            sending = True
            await asyncio.sleep(0)
            received.append(json.loads(payload))
            sending = False

        websocket.send_text.side_effect = send
        await asyncio.gather(
            self.manager.broadcast(persisted(message_id=1)),
            self.manager.broadcast(persisted(message_id=2)),
            self.manager.send_error(20, websocket, MessageProcessingError("empty_content").as_event()),
        )
        self.assertEqual(len(received), 3)
        self.assertEqual(sorted(event["message"]["id"] for event in received if event["type"] == "message.created"), [1, 2])
        self.assertEqual(sum(event["type"] == "error" for event in received), 1)

    async def test_different_rooms_broadcast_independently(self):
        slow, other = await self.connect(), await self.connect(21)
        started, release = asyncio.Event(), asyncio.Event()

        async def send(_payload):
            started.set()
            await release.wait()

        slow.send_text.side_effect = send
        task = asyncio.create_task(self.manager.broadcast(persisted()))
        await asyncio.wait_for(started.wait(), timeout=1)
        try:
            await asyncio.wait_for(self.manager.broadcast(persisted(room=21)), timeout=1)
            other.send_text.assert_awaited_once()
        finally:
            release.set()
            await task

    async def test_error_is_only_sent_to_origin_and_failed_error_send_removes_it(self):
        origin, other = await self.connect(), await self.connect()
        error = MessageProcessingError("rate_limited", retry_after=2).as_event()
        self.assertTrue(await self.manager.send_error(20, origin, error))
        data = json.loads(origin.send_text.call_args.args[0])
        self.assertEqual(data["error"]["retry_after"], 2)
        other.send_text.assert_not_awaited()
        self.assertTrue(self.manager.is_connected(20, origin))
        origin.send_text.side_effect = OSError("private error")
        self.assertFalse(await self.manager.send_error(20, origin, error))
        self.assertFalse(self.manager.is_connected(20, origin))
        self.assertEqual(self.manager.connection_count(20), 1)

    async def test_revoked_recipient_is_closed_without_receiving_private_message(self):
        revoked, healthy = await self.connect(user_id=7), await self.connect(user_id=8)

        async def authorise(_room, user_id, _token):
            return 4401 if user_id == 7 else None

        self.authorizer.side_effect = authorise
        await self.manager.broadcast(persisted())
        revoked.send_text.assert_not_awaited()
        revoked.close.assert_awaited_once_with(code=4401)
        healthy.send_text.assert_awaited_once()
        self.assertEqual(self.manager.connection_count(20), 1)

    async def test_recipient_authorisation_failure_is_isolated_and_logs_no_secrets(self):
        failed, healthy = await self.connect(user_id=7), await self.connect(user_id=8)

        async def authorise(_room, user_id, _token):
            if user_id == 7:
                raise ValueError("private cookie")
            return None

        self.authorizer.side_effect = authorise
        with self.assertLogs("app.connection_manager", level="ERROR") as logs:
            await self.manager.broadcast(persisted())
        failed.send_text.assert_not_awaited()
        failed.close.assert_awaited_once_with(code=1011)
        healthy.send_text.assert_awaited_once()
        self.assertNotIn("private cookie", " ".join(logs.output))

    async def test_stalled_authorisation_times_out_and_does_not_block_other_recipients(self):
        stalled, healthy = await self.connect(user_id=7), await self.connect(user_id=8)
        delivered = asyncio.Event()

        async def authorise(_room, user_id, _token):
            if user_id == 7:
                await asyncio.Event().wait()
            return None

        async def send(_payload):
            delivered.set()

        self.authorizer.side_effect = authorise
        healthy.send_text.side_effect = send
        with patch("app.connection_manager.RECIPIENT_AUTH_TIMEOUT_SECONDS", 0.05), self.assertLogs(
            "app.connection_manager", level="WARNING"
        ):
            task = asyncio.create_task(self.manager.broadcast(persisted()))
            await asyncio.wait_for(delivered.wait(), timeout=1)
            self.assertTrue(await asyncio.wait_for(task, timeout=1))
        stalled.send_text.assert_not_awaited()
        stalled.close.assert_awaited_once_with(code=1011)
        self.assertFalse(self.manager.is_connected(20, stalled))
        self.assertNotIn(stalled, self.manager._send_locks)
        self.assertNotIn(stalled, self.manager._identities)
        # A later broadcast completes and continues to reach the healthy peer.
        self.assertTrue(await asyncio.wait_for(self.manager.broadcast(persisted(message_id=124)), timeout=1))
        self.assertEqual(healthy.send_text.await_count, 2)

    async def test_async_deadline_does_not_wait_for_running_sync_worker(self):
        started, release, finished = threading.Event(), threading.Event(), threading.Event()

        def stalled_worker(*_args):
            started.set()
            try:
                release.wait(timeout=2)
                return None
            finally:
                finished.set()

        with patch("app.websocket_authorization._recipient_close_code", side_effect=stalled_worker):
            task = asyncio.create_task(authorize_recipient(20, 7, "token"))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 1))
                with self.assertRaises(TimeoutError):
                    await asyncio.wait_for(task, timeout=0.05)
                self.assertFalse(finished.is_set(), "deadline waited for synchronous work")
            finally:
                release.set()
                self.assertTrue(await asyncio.to_thread(finished.wait, 1))

    async def test_database_failure_during_recipient_check_fails_closed(self):
        with patch(
            "app.websocket_authorization.RecipientSessionLocal",
            side_effect=OperationalError("private SQL", {}, Exception("private token")),
        ), self.assertLogs("app.websocket_authorization", level="ERROR") as logs:
            self.assertEqual(_recipient_close_code(20, 7, "private token"), 1011)
        self.assertNotIn("private", " ".join(logs.output))

    async def test_terminal_error_is_sent_before_closing_and_removing_connection(self):
        websocket = await self.connect()
        await self.manager.send_error(
            20, websocket, MessageProcessingError("unauthenticated").as_event(), close_code=4401,
        )
        self.assertEqual([call[0] for call in websocket.method_calls], ["accept", "send_text", "close"])
        websocket.close.assert_awaited_once_with(code=4401)
        self.assertEqual(self.manager.room_count, 0)

    async def test_serialisation_failure_is_controlled_without_exposing_content(self):
        websocket = await self.connect()
        with patch.object(MessageCreatedEvent, "model_dump_json", side_effect=ValueError("private text")), self.assertLogs(
            "app.connection_manager", level="ERROR"
        ) as logs:
            self.assertFalse(await self.manager.broadcast(persisted()))
        websocket.send_text.assert_not_awaited()
        self.assertNotIn("private text", " ".join(logs.output))
        self.assertTrue(self.manager.is_connected(20, websocket))


if __name__ == "__main__":
    unittest.main()
