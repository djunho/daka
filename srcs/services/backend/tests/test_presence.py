"""Tests for authenticated presence updates and online status."""

from datetime import timedelta
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.dependencies import get_current_user
from app.models import User, UserSession
from app.presence import is_online, touch_last_seen
from app.schemas import PublicUserOut, UserOut
from app.security import hash_session_token, utcnow
from tests.helpers import make_memory_session


class PresenceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.db, _, _, _ = make_memory_session()
        self.user = User(
            user_name="Presence",
            email="presence@example.com",
            pass_hash=None,
            last_seen=None,
        )
        self.db.add(self.user)
        self.db.commit()
        self.db.add(
            UserSession(
                user_id=self.user.id,
                token_hash=hash_session_token("presence-session"),
                expires_at=utcnow() + timedelta(hours=1),
            )
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_authenticated_request_writes_last_seen_once_per_minute(self) -> None:
        first_now = utcnow()
        self.assertTrue(touch_last_seen(self.db, self.user, first_now))
        first_seen = self.user.last_seen

        self.assertFalse(
            touch_last_seen(
                self.db,
                self.user,
                first_now + timedelta(seconds=30),
            )
        )
        self.assertEqual(self.user.last_seen, first_seen)

        second_now = first_now + timedelta(seconds=61)
        self.assertTrue(touch_last_seen(self.db, self.user, second_now))
        self.assertEqual(self.user.last_seen, second_now)

    def test_last_seen_update_does_not_change_updated_at(self) -> None:
        original_updated_at = self.user.updated_at
        self.assertTrue(touch_last_seen(self.db, self.user, utcnow()))
        self.assertEqual(self.user.updated_at, original_updated_at)

    def test_presence_write_does_not_dirty_user_after_expiring_commit(self) -> None:
        expiring_db = sessionmaker(
            bind=self.db.get_bind(),
            expire_on_commit=True,
        )()
        observer_db = sessionmaker(bind=self.db.get_bind())()
        try:
            expiring_user = expiring_db.get(User, self.user.id)
            original_updated_at = observer_db.get(User, self.user.id).updated_at

            self.assertTrue(touch_last_seen(expiring_db, expiring_user, utcnow()))
            expiring_db.commit()

            self.assertEqual(
                observer_db.get(User, self.user.id).updated_at,
                original_updated_at,
            )
        finally:
            expiring_db.close()
            observer_db.close()

    def test_is_online_uses_three_minute_window(self) -> None:
        now = utcnow()
        self.user.last_seen = now - timedelta(minutes=3)
        self.assertTrue(is_online(self.user, now))

        self.user.last_seen = now - timedelta(minutes=3, seconds=1)
        self.assertFalse(is_online(self.user, now))

        self.user.last_seen = None
        self.assertFalse(is_online(self.user, now))

    def test_user_output_serializes_last_seen_as_utc(self) -> None:
        now = utcnow()
        self.user.last_seen = now
        output = UserOut.model_validate(self.user)

        self.assertEqual(
            output.model_dump(mode="json")["last_seen"],
            f"{now.isoformat()}Z",
        )

    def test_public_user_output_does_not_expose_last_seen(self) -> None:
        self.user.last_seen = utcnow()
        output = PublicUserOut.model_validate(self.user)

        self.assertNotIn("last_seen", output.model_dump())

    def test_invalid_session_does_not_update_last_seen(self) -> None:
        with self.assertRaises(HTTPException):
            get_current_user("invalid-token", self.db)
        self.assertIsNone(self.user.last_seen)

    def test_authenticated_dependency_updates_last_seen(self) -> None:
        token = "valid-token"
        self.db.add(
            UserSession(
                user_id=self.user.id,
                token_hash=hash_session_token(token),
                expires_at=utcnow() + timedelta(hours=1),
            )
        )
        self.db.commit()

        resolved = get_current_user(token, self.db)

        self.assertIs(resolved, self.user)
        self.assertIsNotNone(self.user.last_seen)

    def test_revoked_session_cannot_restore_presence_with_another_session(self) -> None:
        revoked = self.db.query(UserSession).first()
        self.db.add(
            UserSession(
                user_id=self.user.id,
                token_hash=hash_session_token("second-presence-session"),
                expires_at=utcnow() + timedelta(hours=1),
            )
        )
        self.db.delete(revoked)
        self.db.commit()
        self.db.refresh(self.user)

        self.assertFalse(
            touch_last_seen(
                self.db,
                self.user,
                utcnow(),
                session_id=revoked.id,
            )
        )
        self.assertIsNone(self.user.last_seen)

    def test_presence_write_failure_does_not_expire_request_user(self) -> None:
        user_id = self.user.id
        with patch(
            "sqlalchemy.orm.Session.commit",
            side_effect=SQLAlchemyError("write failed"),
        ):
            self.assertFalse(touch_last_seen(self.db, self.user, utcnow()))

        self.assertIsNotNone(self.db.get(User, user_id))
        self.assertEqual(self.user.id, user_id)
        self.assertIsNone(self.user.last_seen)


if __name__ == "__main__":
    unittest.main()
