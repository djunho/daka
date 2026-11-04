"""Message contract, throttling and transactional persistence regression tests."""

from datetime import timedelta
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, event as sqlalchemy_event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.message_processing import (
    MessageProcessingError, MessageRateLimiter, parse_message_event, persist_message,
)
from app.models import (
    Category, Condition, Listing, ListingState, Message, Negotiation,
    NegotiationState, User, UserSession,
)
from app.schemas import MessageSendEvent
from app.security import hash_session_token, utcnow


class MessageContractTestCase(unittest.TestCase):
    def test_valid_content_normalises_and_preserves_internal_text(self):
        for content in ("  Olá\nTudo bem?  ", "😀" * 250, "<b>texto</b>"):
            parsed = parse_message_event(json.dumps({"type": "message.send", "content": content}))
            self.assertEqual(parsed.content, content.strip())

    def test_invalid_events_have_stable_codes(self):
        cases = [
            ("{", "invalid_json"), ("NaN", "invalid_json"),
            ("[", "invalid_json"), ("[]", "invalid_payload"),
            ("null", "invalid_payload"), ("123", "invalid_payload"),
            (None, "invalid_payload"),
            ({"content": "hi"}, "invalid_payload"),
            ({"type": "other", "content": "hi"}, "unsupported_event"),
            ({"type": "message.send"}, "invalid_payload"),
            ({"type": "message.send", "content": 123}, "invalid_payload"),
            ({"type": "message.send", "content": None}, "invalid_payload"),
            ({"type": "message.send", "content": ""}, "empty_content"),
            ({"type": "message.send", "content": " \n\t "}, "empty_content"),
            ({"type": "message.send", "content": "😀" * 251}, "content_too_long"),
            ({"type": "message.send", "content": "\ud800"}, "invalid_payload"),
            ("x" * 4097, "payload_too_large"),
        ]
        for field in ("sender_id", "negotiation_id", "id", "created_at", "unknown"):
            cases.append(({"type": "message.send", "content": "hi", field: 1}, "invalid_payload"))
        for payload, code in cases:
            with self.subTest(code=code, payload=repr(payload)[:80]):
                text = json.dumps(payload) if isinstance(payload, dict) else payload
                with self.assertRaises(MessageProcessingError) as raised:
                    parse_message_event(text)
                self.assertEqual(raised.exception.code, code)

    def test_limiter_recovers_and_storage_stays_bounded(self):
        clock = SimpleNamespace(now=0)
        limiter = MessageRateLimiter(clock=lambda: clock.now)
        for _ in range(10):
            limiter.check()
        for _ in range(100):
            with self.assertRaises(MessageProcessingError) as raised:
                limiter.check()
            self.assertEqual(raised.exception.code, "rate_limited")
            self.assertEqual(raised.exception.as_event()["error"]["retry_after"], 10)
        self.assertEqual(len(limiter._attempts), 10)
        clock.now = 10
        limiter.check()
        self.assertEqual(len(limiter._attempts), 1)
        limiter.clear()
        self.assertEqual(len(limiter._attempts), 0)


class MessagePersistenceTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.patch = patch("app.message_processing.SessionLocal", self.factory)
        self.patch.start()
        self.db = self.factory()
        self.owner = User(user_name="owner", email="owner@example.com")
        self.sender = User(user_name="sender", email="sender@example.com")
        self.outsider = User(user_name="outsider", email="outsider@example.com")
        category = Category(category_name="Books")
        condition = Condition(condition_name="Good")
        available = ListingState(state_name="Available")
        self.states = {
            name: NegotiationState(state_name=name)
            for name in ("Open", "Agreed", "Completed", "Cancelled", "Unavailable")
        }
        self.db.add_all([
            self.owner, self.sender, self.outsider, category, condition, available,
            *self.states.values(),
        ])
        self.db.flush()
        listing = Listing(
            user_id=self.owner.id, title="Book", category_id=category.id,
            condition_id=condition.id, state_id=available.id,
        )
        self.db.add(listing)
        self.db.flush()
        self.room = Negotiation(
            listing_id=listing.id, interested_user_id=self.sender.id,
            negotiation_state_id=self.states["Open"].id,
        )
        self.session = UserSession(
            user_id=self.sender.id, token_hash=hash_session_token("token"),
            expires_at=utcnow() + timedelta(hours=1),
        )
        self.db.add_all([self.room, self.session])
        self.db.commit()

    def tearDown(self):
        self.patch.stop()
        self.db.close()
        self.engine.dispose()

    def send(self, content="  Olá\nparceira  ", **overrides):
        arguments = dict(
            event=MessageSendEvent(type="message.send", content=content),
            negotiation_id=self.room.id, sender_id=self.sender.id, session_token="token",
        )
        arguments.update(overrides)
        return persist_message(**arguments)

    def assert_failure(self, code, **overrides):
        with self.assertRaises(MessageProcessingError) as raised:
            self.send(**overrides)
        self.assertEqual(raised.exception.code, code)
        self.db.expire_all()
        self.assertEqual(self.db.query(Message).count(), 0)

    def test_open_and_agreed_persist_normalised_content_and_backend_fields(self):
        for state in ("Open", "Agreed"):
            self.room.negotiation_state_id = self.states[state].id
            self.db.commit()
            result = self.send("  " + "😀" * 250 + "  ")
            with self.factory() as check:
                stored = check.get(Message, result.id)
                self.assertIsNotNone(stored)
                self.assertEqual(result.negotiation_id, self.room.id)
                self.assertEqual(result.msg_sender, self.sender.id)
                self.assertEqual(result.msg, "😀" * 250)
                self.assertEqual(result.created_at, stored.created_at)

    def test_internal_line_breaks_are_persisted(self):
        self.assertEqual(self.send().msg, "Olá\nparceira")

    def test_read_only_states_are_reloaded_before_each_send(self):
        for state in ("Completed", "Cancelled", "Unavailable"):
            self.room.negotiation_state_id = self.states[state].id
            self.db.commit()
            self.assert_failure("negotiation_read_only")

    def test_session_revoked_expired_or_mismatched_and_deleted_user(self):
        self.assert_failure("unauthenticated", session_token=None)
        self.assert_failure("unauthenticated", session_token="unknown")
        self.assert_failure("unauthenticated", sender_id=self.owner.id)
        self.session.expires_at = utcnow() - timedelta(seconds=1)
        self.db.commit()
        self.assert_failure("unauthenticated")
        self.session.expires_at = utcnow() + timedelta(hours=1)
        self.sender.deleted_at = utcnow()
        self.db.commit()
        self.assert_failure("unauthenticated")
        self.sender.deleted_at = None
        self.db.delete(self.session)
        self.db.commit()
        self.assert_failure("unauthenticated")

    def test_membership_is_reloaded_and_missing_negotiation_is_rejected(self):
        self.assert_failure("negotiation_not_found", negotiation_id=999999)
        self.room.interested_user_id = self.outsider.id
        self.db.commit()
        self.assert_failure("forbidden")

    def test_flush_and_commit_failure_roll_back_without_returning_a_result(self):
        for method in ("flush", "commit"):
            with self.subTest(method=method):
                worker = self.factory()
                with patch("app.message_processing.SessionLocal", return_value=worker), patch.object(
                    worker, method, side_effect=OperationalError("SQL private content", {}, Exception("private"))
                ), patch.object(worker, "rollback", wraps=worker.rollback) as rollback, self.assertLogs(
                    "app.message_processing", level="ERROR"
                ) as logs:
                    self.assert_failure("persistence_failed")
                    rollback.assert_called_once()
                self.assertNotIn("private", " ".join(logs.output))
                # A subsequent processing operation uses a fresh valid session.
        self.assertIsNotNone(self.send().id)

    def test_result_is_returned_only_after_commit(self):
        committed = []
        worker = self.factory()
        sqlalchemy_event.listen(worker, "after_commit", lambda _db: committed.append(True))
        with patch("app.message_processing.SessionLocal", return_value=worker):
            result = self.send()
        self.assertEqual(committed, [True])
        self.assertIsNotNone(result.id)
        self.assertIsNotNone(result.created_at)


if __name__ == "__main__":
    unittest.main()
