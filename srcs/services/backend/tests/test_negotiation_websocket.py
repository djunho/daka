"""Handshake security tests for negotiation WebSockets."""

from datetime import timedelta
import asyncio
import threading
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect

from app.database import Base
from app.connection_manager import ConnectionManager
from app.main import app
from app.models import (
    Category,
    Condition,
    Listing,
    ListingState,
    Message,
    Negotiation,
    NegotiationState,
    User,
    UserSession,
)
from app.security import hash_session_token, utcnow
from app.routers.websockets import _authorize_negotiation, _reject
from app.dependencies import get_user_from_session_token
from app.config import Settings


class RejectionProtocolTestCase(unittest.TestCase):
    def test_rejection_accepts_before_sending_close_code(self) -> None:
        for code in (4401, 4403, 4404):
            with self.subTest(code=code):
                websocket = AsyncMock()
                asyncio.run(_reject(websocket, code))
                self.assertEqual(
                    websocket.method_calls,
                    [unittest.mock.call.accept(), unittest.mock.call.close(code=code)],
                )


class WebSocketOriginSettingsTestCase(unittest.TestCase):
    def test_default_additional_origins_do_not_allow_localhost_in_production(self):
        default = Settings.model_fields["websocket_allowed_origins"].default
        self.assertEqual(default, "")
        settings = Settings(frontend_url="https://daka.example", websocket_allowed_origins=default)
        self.assertEqual(settings.allowed_websocket_origins, frozenset({"https://daka.example"}))

    def test_origins_are_normalised_and_additional_origins_remain_explicit(self):
        settings = Settings(
            frontend_url="https://DAKA.example/",
            websocket_allowed_origins=" HTTPS://Localhost:8443/ , ,https://OTHER.example ",
        )
        self.assertEqual(settings.allowed_websocket_origins, frozenset({
            "https://daka.example", "https://localhost:8443", "https://other.example",
        }))


class NegotiationWebSocketTestCase(unittest.TestCase):
    origin = "https://localhost:8443"

    def setUp(self) -> None:
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        self.db = self.session_factory()
        self.client = self.enterContext(TestClient(app))

        available = ListingState(state_name="Available")
        open_state = NegotiationState(state_name="Open")
        category = Category(category_name="Books")
        condition = Condition(condition_name="Good")
        self.owner = self._user("owner")
        self.interested = self._user("interested")
        self.outsider = self._user("outsider")
        self.admin = self._user("admin", role="admin")
        self.db.add_all([available, open_state, category, condition])
        self.db.flush()
        listing = Listing(
            user_id=self.owner.id,
            category_id=category.id,
            condition_id=condition.id,
            state_id=available.id,
            title="Requested",
            listing_dsc=None,
            listing_location=None,
            wish=None,
        )
        self.db.add(listing)
        self.db.flush()
        self.negotiation = Negotiation(
            listing_id=listing.id,
            interested_user_id=self.interested.id,
            negotiation_state_id=open_state.id,
        )
        self.db.add(self.negotiation)
        self.tokens = {
            user.user_name: self._session(user)
            for user in (self.owner, self.interested, self.outsider, self.admin)
        }
        self.db.commit()
        self.session_patch = patch(
            "app.routers.websockets.SessionLocal", self.session_factory
        )
        self.session_patch.start()
        self.message_session_patch = patch(
            "app.message_processing.SessionLocal", self.session_factory
        )
        self.message_session_patch.start()
        self.recipient_session_patch = patch(
            "app.websocket_authorization.RecipientSessionLocal", self.session_factory
        )
        self.recipient_session_patch.start()
        self.manager = ConnectionManager()
        self.disconnect_condition = threading.Condition()
        original_disconnect = self.manager.disconnect

        def observe_disconnect(*args):
            with self.disconnect_condition:
                original_disconnect(*args)
                self.disconnect_condition.notify_all()

        self.enterContext(patch.object(self.manager, "disconnect", side_effect=observe_disconnect))
        self.manager_patch = patch("app.routers.websockets.manager", self.manager)
        self.manager_patch.start()
        self.connect_patch = patch.object(
            self.manager, "connect", wraps=self.manager.connect
        )
        self.connect_mock = self.connect_patch.start()

    def tearDown(self) -> None:
        self.recipient_session_patch.stop()
        self.message_session_patch.stop()
        self.connect_patch.stop()
        self.manager_patch.stop()
        self.session_patch.stop()
        self.client.close()
        self.db.close()

    def _user(self, name: str, role: str = "user") -> User:
        user = User(
            user_name=name,
            email=f"{name}@example.com",
            pass_hash=None,
            google_sub=None,
            user_role=role,
            avatar=None,
            user_location=None,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def _session(self, user: User, *, expired: bool = False) -> str:
        token = f"token-{user.user_name}"
        self.db.add(
            UserSession(
                user_id=user.id,
                token_hash=hash_session_token(token),
                expires_at=utcnow() + (timedelta(days=-1) if expired else timedelta(days=1)),
            )
        )
        return token

    def _connect(self, token: str | None, *, origin: str | None = None, room=None):
        headers = {}
        if origin is not None:
            headers["origin"] = origin
        cookies = {} if token is None else {"daka_session": token}
        room = self.negotiation.id if room is None else room
        return self.client.websocket_connect(
            f"/ws/negotiations/{room}", headers=headers, cookies=cookies
        )

    def _assert_rejected(self, code: int, token: str | None, **kwargs) -> None:
        with self.assertRaises(WebSocketDisconnect) as raised:
            with self._connect(token, origin=self.origin, **kwargs) as websocket:
                # Rejections accept then close so browsers receive the custom
                # code. Observe that close frame, not just the upgrade.
                websocket.receive_text()
        self.assertEqual(raised.exception.code, code)
        self.connect_mock.assert_not_called()
        self.assertEqual(self.manager.connection_count(), 0)

    def _assert_no_connections(self) -> None:
        # The shared TestClient portal keeps all sockets on one event loop.
        # Its websocket context exit signals cancellation without joining the
        # endpoint task, so wait on cleanup notification rather than sleeping.
        with self.disconnect_condition:
            self.assertTrue(self.disconnect_condition.wait_for(
                lambda: self.manager.connection_count() == 0, timeout=2,
            ), "WebSocket cleanup did not complete")
        self.assertEqual(self.manager.room_count, 0)

    def test_interested_and_owner_are_accepted(self) -> None:
        for participant in (self.interested, self.owner):
            with self.subTest(participant=participant.user_name):
                with self._connect(
                    self.tokens[participant.user_name], origin=self.origin
                ) as websocket:
                    # Client identity claims are deliberately ignored: the
                    # authenticated identity came from the cookie already.
                    websocket.send_json({"sender_id": self.outsider.id})
                    self.assertEqual(websocket.receive_json()["error"]["code"], "invalid_payload")
        self.assertEqual(self.connect_mock.await_count, 2)
        self._assert_no_connections()

    def test_same_user_can_keep_two_connections_open(self) -> None:
        # Nested contexts ensure both connections are alive together. The
        # endpoint-level cleanup tests separately verify all termination paths.
        with self._connect(self.tokens["interested"], origin=self.origin):
            with self._connect(self.tokens["interested"], origin=self.origin):
                self.assertEqual(self.connect_mock.await_count, 2)
        self._assert_no_connections()

    def test_invalid_payload_does_not_close_connection_or_persist(self) -> None:
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            websocket.send_text("{")
            self.assertEqual(websocket.receive_json()["error"]["code"], "invalid_json")
            websocket.send_json({"type": "message.send", "content": "  Olá\nparceira  "})
            self.assertEqual(websocket.receive_json()["type"], "message.created")
            websocket.send_json({"type": "unknown"})
            self.assertEqual(websocket.receive_json()["error"]["code"], "unsupported_event")
        self.db.expire_all()
        message = self.db.query(Message).one()
        self.assertEqual(message.msg, "Olá\nparceira")
        self.assertEqual(message.msg_sender, self.interested.id)
        self.assertEqual(message.negotiation_id, self.negotiation.id)

    def test_payload_identity_fields_are_rejected(self) -> None:
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            for field in ("sender_id", "negotiation_id", "id", "created_at"):
                websocket.send_json({"type": "message.send", "content": "hi", field: 999})
                self.assertEqual(websocket.receive_json()["error"]["code"], "invalid_payload")
        self.assertEqual(self.db.query(Message).count(), 0)

    def test_binary_and_oversized_payloads_are_controlled(self) -> None:
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            websocket.send_bytes(b"binary")
            self.assertEqual(websocket.receive_json()["error"]["code"], "invalid_payload")
            # TestClient bypasses the Uvicorn transport size limit.
            websocket.send_text("x" * 4097)
            self.assertEqual(websocket.receive_json()["error"]["code"], "payload_too_large")
        self.assertEqual(self.db.query(Message).count(), 0)

    def test_rate_limit_prevents_persistence_and_reports_retry_after(self) -> None:
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            for _ in range(10):
                websocket.send_json({"type": "message.send", "content": ""})
                self.assertEqual(websocket.receive_json()["error"]["code"], "empty_content")
            websocket.send_json({"type": "message.send", "content": "valid"})
            error = websocket.receive_json()
            self.assertEqual(error["error"]["code"], "rate_limited")
            self.assertGreater(error["error"]["retry_after"], 0)
        self.assertEqual(self.db.query(Message).count(), 0)

    def test_only_first_ten_valid_messages_are_persisted_in_window(self) -> None:
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            for _ in range(10):
                websocket.send_json({"type": "message.send", "content": "valid"})
                self.assertEqual(websocket.receive_json()["type"], "message.created")
            websocket.send_json({"type": "message.send", "content": "valid"})
            self.assertEqual(websocket.receive_json()["error"]["code"], "rate_limited")
        self.assertEqual(self.db.query(Message).count(), 10)

    def test_both_participants_persist_with_their_real_identity(self) -> None:
        for participant in (self.owner, self.interested):
            with self._connect(self.tokens[participant.user_name], origin=self.origin) as websocket:
                websocket.send_json({"type": "message.send", "content": participant.user_name})
                self.assertEqual(websocket.receive_json()["message"]["sender_id"], participant.id)
                websocket.send_json({"type": "unknown"})
                self.assertEqual(websocket.receive_json()["error"]["code"], "unsupported_event")
        messages = self.db.query(Message).order_by(Message.id).all()
        self.assertEqual([message.msg_sender for message in messages], [self.owner.id, self.interested.id])

    def test_lost_membership_after_handshake_closes_connection(self) -> None:
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            self.negotiation.interested_user_id = self.outsider.id
            self.db.commit()
            websocket.send_json({"type": "message.send", "content": "hi"})
            self.assertEqual(websocket.receive_json()["error"]["code"], "forbidden")
            with self.assertRaises(WebSocketDisconnect) as raised:
                websocket.receive_json()
            self.assertEqual(raised.exception.code, 4403)
        self.assertEqual(self.db.query(Message).count(), 0)
        self.assertEqual(self.manager.room_count, 0)

    def test_read_only_error_keeps_connection_open(self) -> None:
        terminal = NegotiationState(state_name="Completed")
        self.db.add(terminal)
        self.db.commit()
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            original_state = self.negotiation.negotiation_state_id
            self.negotiation.negotiation_state_id = terminal.id
            self.db.commit()
            websocket.send_json({"type": "message.send", "content": "not saved"})
            self.assertEqual(websocket.receive_json()["error"]["code"], "negotiation_read_only")
            self.assertEqual(self.db.query(Message).count(), 0)
            # Direct fixture change verifies a fresh state check per attempt;
            # this is not a supported REST transition out of Completed.
            self.negotiation.negotiation_state_id = original_state
            self.db.commit()
            websocket.send_json({"type": "message.send", "content": "saved"})
            self.assertEqual(websocket.receive_json()["type"], "message.created")
            websocket.send_json({"type": "unknown"})
            self.assertEqual(websocket.receive_json()["error"]["code"], "unsupported_event")
        self.assertEqual(self.db.query(Message).one().msg, "saved")

    def test_session_revocation_after_handshake_closes_and_cleans_up(self) -> None:
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            self.db.query(UserSession).filter(UserSession.user_id == self.interested.id).delete()
            self.db.commit()
            websocket.send_json({"type": "message.send", "content": "hi"})
            self.assertEqual(websocket.receive_json()["error"]["code"], "unauthenticated")
            with self.assertRaises(WebSocketDisconnect) as raised:
                websocket.receive_json()
            self.assertEqual(raised.exception.code, 4401)
        self.assertEqual(self.manager.room_count, 0)
        self.assertEqual(self.db.query(Message).count(), 0)

    def test_persistence_error_is_controlled_and_connection_can_continue(self) -> None:
        from app.message_processing import MessageProcessingError

        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            with patch("app.routers.websockets.persist_message", side_effect=MessageProcessingError("persistence_failed")):
                websocket.send_json({"type": "message.send", "content": "first"})
                self.assertEqual(websocket.receive_json()["error"]["code"], "persistence_failed")
            websocket.send_json({"type": "message.send", "content": "second"})
            self.assertEqual(websocket.receive_json()["type"], "message.created")
            websocket.send_json({"type": "unknown"})
            self.assertEqual(websocket.receive_json()["error"]["code"], "unsupported_event")
        self.assertEqual(self.db.query(Message).one().msg, "second")

    def test_broadcast_reaches_sender_devices_and_owner_but_not_another_room(self) -> None:
        second_room = Negotiation(
            listing_id=self.negotiation.listing_id,
            interested_user_id=self.outsider.id,
            negotiation_state_id=self.negotiation.negotiation_state_id,
        )
        self.db.add(second_room)
        self.db.commit()
        with (
            self._connect(self.tokens["interested"], origin=self.origin) as sender,
            self._connect(self.tokens["interested"], origin=self.origin) as device,
            self._connect(self.tokens["owner"], origin=self.origin) as owner,
            self._connect(self.tokens["outsider"], origin=self.origin, room=second_room.id) as isolated,
        ):
            sender.send_json({"type": "message.send", "content": "  Olá  "})
            event = sender.receive_json()
            self.assertEqual(event["type"], "message.created")
            self.assertEqual(device.receive_json(), event)
            self.assertEqual(owner.receive_json(), event)
            self.assertEqual(event["message"]["sender_id"], self.interested.id)
            self.assertEqual(event["message"]["content"], "Olá")
            self.assertTrue(event["message"]["created_at"].endswith("Z"))
            # Receipt itself confirms a committed row, not just a flushed one.
            stored = self.db.get(Message, event["message"]["id"])
            self.assertIsNotNone(stored)
            self.assertEqual(stored.msg, event["message"]["content"])
            isolated.send_json({"type": "unknown"})
            self.assertEqual(isolated.receive_json()["error"]["code"], "unsupported_event")

    def test_validation_errors_are_not_broadcast_to_other_participants(self) -> None:
        with (
            self._connect(self.tokens["interested"], origin=self.origin) as sender,
            self._connect(self.tokens["owner"], origin=self.origin) as owner,
            patch.object(self.manager, "broadcast", wraps=self.manager.broadcast) as broadcast,
        ):
            sender.send_json({"type": "message.send", "content": ""})
            self.assertEqual(sender.receive_json()["error"]["code"], "empty_content")
            broadcast.assert_not_called()
            owner.send_json({"type": "unknown"})
            self.assertEqual(owner.receive_json()["error"]["code"], "unsupported_event")
        self.assertEqual(self.db.query(Message).count(), 0)

    def test_failed_persistence_does_not_call_broadcast(self) -> None:
        from app.message_processing import MessageProcessingError

        with self._connect(self.tokens["interested"], origin=self.origin) as websocket, patch(
            "app.routers.websockets.persist_message", side_effect=MessageProcessingError("persistence_failed")
        ), patch.object(self.manager, "broadcast", wraps=self.manager.broadcast) as broadcast:
            websocket.send_json({"type": "message.send", "content": "not saved"})
            self.assertEqual(websocket.receive_json()["error"]["code"], "persistence_failed")
            broadcast.assert_not_called()
        self.assertEqual(self.db.query(Message).count(), 0)

    def test_serialisation_failure_keeps_committed_message_and_connection(self) -> None:
        from app.schemas import MessageCreatedEvent

        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            with patch.object(MessageCreatedEvent, "model_dump_json", side_effect=ValueError("private content")), self.assertLogs(
                "app.connection_manager", level="ERROR"
            ) as logs:
                websocket.send_json({"type": "message.send", "content": "saved despite delivery failure"})
                self.assertEqual(websocket.receive_json()["error"]["code"], "delivery_failed")
            self.assertNotIn("private content", " ".join(logs.output))
            self.assertEqual(self.db.query(Message).count(), 1)
            self.db.rollback()
            websocket.send_json({"type": "message.send", "content": "next"})
            self.assertEqual(websocket.receive_json()["type"], "message.created")
        self.assertEqual(self.db.query(Message).count(), 2)

    def test_all_delivery_failures_preserve_committed_message(self) -> None:
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            server_socket = self.connect_mock.call_args.args[1]
            with patch.object(server_socket, "send_text", side_effect=OSError("gone")):
                websocket.send_json({"type": "message.send", "content": "saved"})
                with self.assertRaises(WebSocketDisconnect) as raised:
                    websocket.receive_json()
                self.assertEqual(raised.exception.code, 1011)
        self.assertEqual(self.db.query(Message).one().msg, "saved")
        self.assertEqual(self.manager.room_count, 0)

    def test_failed_error_send_removes_connection_without_persisting(self) -> None:
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            server_socket = self.connect_mock.call_args.args[1]
            with patch.object(server_socket, "send_text", side_effect=OSError("gone")):
                websocket.send_json({"type": "message.send", "content": ""})
                with self.assertRaises(WebSocketDisconnect) as raised:
                    websocket.receive_json()
                self.assertEqual(raised.exception.code, 1011)
        self.assertEqual(self.db.query(Message).count(), 0)
        self._assert_no_connections()

    def test_idle_recipient_cannot_receive_after_session_revocation_or_expiry_or_soft_delete(self):
        for reason in ("revoked", "expired", "deleted"):
            with (
                self.subTest(reason=reason),
                self._connect(self.tokens["interested"], origin=self.origin) as idle,
                self._connect(self.tokens["owner"], origin=self.origin) as sender,
            ):
                session = self.db.query(UserSession).filter_by(user_id=self.interested.id).one()
                if reason == "revoked":
                    self.db.delete(session)
                elif reason == "expired":
                    session.expires_at = utcnow() - timedelta(seconds=1)
                else:
                    self.interested.deleted_at = utcnow()
                self.db.commit()
                sender.send_json({"type": "message.send", "content": reason})
                self.assertEqual(sender.receive_json()["type"], "message.created")
                # The idle recipient never submitted a new payload.
                with self.assertRaises(WebSocketDisconnect) as raised:
                    idle.receive_json()
                self.assertEqual(raised.exception.code, 4401)
            self._assert_no_connections()
            self.interested.deleted_at = None
            self.db.query(UserSession).filter_by(user_id=self.interested.id).delete()
            self.db.add(UserSession(
                user_id=self.interested.id,
                token_hash=hash_session_token(self.tokens["interested"]),
                expires_at=utcnow() + timedelta(hours=1),
            ))
            self.db.commit()

    def test_logout_only_revokes_its_session_and_preserves_another_device(self):
        from app.database import get_db

        token = "second-device"
        self.db.add(UserSession(
            user_id=self.interested.id, token_hash=hash_session_token(token),
            expires_at=utcnow() + timedelta(hours=1),
        ))
        self.db.commit()
        with (
            self._connect(self.tokens["interested"], origin=self.origin) as logged_out,
            self._connect(token, origin=self.origin) as other_device,
            self._connect(self.tokens["owner"], origin=self.origin) as sender,
        ):
            previous = app.dependency_overrides.get(get_db)
            app.dependency_overrides[get_db] = lambda: self.db
            try:
                self.client.cookies.set("daka_session", self.tokens["interested"])
                self.assertEqual(self.client.post("/auth/logout").status_code, 204)
            finally:
                self.client.cookies.clear()
                if previous is None:
                    app.dependency_overrides.pop(get_db, None)
                else:
                    app.dependency_overrides[get_db] = previous
            sender.send_json({"type": "message.send", "content": "after logout"})
            event = sender.receive_json()
            self.assertEqual(other_device.receive_json(), event)
            with self.assertRaises(WebSocketDisconnect) as raised:
                logged_out.receive_json()
            self.assertEqual(raised.exception.code, 4401)

    def test_idle_recipient_with_lost_membership_is_closed_before_delivery(self):
        with (
            self._connect(self.tokens["interested"], origin=self.origin) as idle,
            self._connect(self.tokens["owner"], origin=self.origin) as sender,
        ):
            self.negotiation.interested_user_id = self.outsider.id
            self.db.commit()
            sender.send_json({"type": "message.send", "content": "private"})
            self.assertEqual(sender.receive_json()["type"], "message.created")
            with self.assertRaises(WebSocketDisconnect) as raised:
                idle.receive_json()
            self.assertEqual(raised.exception.code, 4403)

    def test_missing_empty_invalid_and_unknown_sessions_are_4401(self) -> None:
        for token in (None, "", "invalid-token"):
            with self.subTest(token=token):
                self._assert_rejected(4401, token)

    def test_expired_session_and_soft_deleted_user_are_4401(self) -> None:
        expired_user = self._user("expired")
        expired_token = self._session(expired_user, expired=True)
        self.outsider.deleted_at = utcnow()
        self.db.commit()

        self._assert_rejected(4401, expired_token)
        self._assert_rejected(4401, self.tokens["outsider"])

    def test_outsider_and_admin_are_4403(self) -> None:
        self._assert_rejected(4403, self.tokens["outsider"])
        self._assert_rejected(4403, self.tokens["admin"])

    def test_another_or_missing_room_is_not_accessible(self) -> None:
        other_listing = self.negotiation.requested_listing
        second = Negotiation(
            listing_id=other_listing.id,
            interested_user_id=self.outsider.id,
            negotiation_state_id=self.negotiation.negotiation_state_id,
        )
        self.db.add(second)
        self.db.commit()

        self._assert_rejected(4403, self.tokens["interested"], room=second.id)
        self._assert_rejected(4404, self.tokens["interested"], room=999999)
        self._assert_rejected(4404, self.tokens["interested"], room="invalid")

    def test_origin_is_required_and_must_be_allowed(self) -> None:
        token = self.tokens["interested"]
        with self.assertRaises(WebSocketDisconnect) as missing:
            with self._connect(token) as websocket:
                websocket.receive_text()
        self.assertEqual(missing.exception.code, 4403)
        with self.assertRaises(WebSocketDisconnect) as foreign:
            with self._connect(token, origin="https://evil.example") as websocket:
                websocket.receive_text()
        self.assertEqual(foreign.exception.code, 4403)
        self.connect_mock.assert_not_called()

    def test_configured_development_and_production_origins(self) -> None:
        with patch(
            "app.routers.websockets.settings.websocket_allowed_origins",
            "http://localhost:5173,https://daka.example",
        ), patch(
            "app.routers.websockets.settings.frontend_url", "https://daka.example"
        ):
            for origin in ("http://localhost:5173", "https://daka.example"):
                with self.subTest(origin=origin):
                    with self._connect(self.tokens["owner"], origin=origin):
                        pass

    def test_production_origin_default_rejects_localhost_but_accepts_case_variants(self):
        with patch("app.routers.websockets.settings.websocket_allowed_origins", ""), patch(
            "app.routers.websockets.settings.frontend_url", "https://DAKA.example"
        ):
            self._assert_rejected(4403, self.tokens["owner"])
            with self._connect(self.tokens["owner"], origin="HTTPS://Daka.Example") as websocket:
                websocket.send_json({"type": "unknown"})
                self.assertEqual(websocket.receive_json()["error"]["code"], "unsupported_event")
        self._assert_no_connections()

    def test_session_and_user_are_resolved_with_a_single_select(self):
        statements = []

        def capture(_connection, _cursor, statement, _parameters, _context, _many):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        engine = self.db.get_bind()
        event.listen(engine, "before_cursor_execute", capture)
        try:
            with self.session_factory() as worker:
                user = get_user_from_session_token(self.tokens["owner"], worker)
                self.assertEqual(user.id, self.owner.id)
                self.assertEqual(user.user_name, "owner")
            self.assertEqual(len(statements), 1)
            self.assertTrue(inspect(user).detached)
        finally:
            event.remove(engine, "before_cursor_execute", capture)

    def test_handshake_uses_two_selects_and_does_not_keep_the_negotiation(self):
        statements = []

        def capture(_connection, _cursor, statement, _parameters, _context, _many):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        engine = self.db.get_bind()
        event.listen(engine, "before_cursor_execute", capture)
        try:
            user = _authorize_negotiation(self.tokens["interested"], self.negotiation.id)
            self.assertEqual(user.id, self.interested.id)
            self.assertTrue(inspect(user).detached)
            self.assertEqual(len(statements), 2)
            # The negotiation query joins the listing, not its owner account.
            self.assertNotIn("JOIN users", statements[1])
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        with self._connect(self.tokens["interested"], origin=self.origin) as websocket:
            websocket.send_json({"type": "unknown"})
            websocket.receive_json()
            state = self.connect_mock.call_args.args[1].state
            self.assertEqual(state.negotiation_id, self.negotiation.id)
            self.assertFalse(hasattr(state, "negotiation"))
        self._assert_no_connections()


if __name__ == "__main__":
    unittest.main()
