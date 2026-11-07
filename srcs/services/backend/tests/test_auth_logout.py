"""HTTP tests for logout session invalidation and presence cleanup."""

from datetime import timedelta
import unittest

from fastapi.testclient import TestClient

from app.database import get_db
from app.dependencies import SESSION_COOKIE_NAME
from app.main import app
from app.models import User, UserSession
from app.security import hash_session_token, utcnow
from tests.helpers import make_memory_session


class LogoutTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.db, _, _, _ = make_memory_session()
        self.user = User(
            user_name="ana",
            email="ana-logout@example.com",
            last_seen=utcnow(),
        )
        self.db.add(self.user)
        self.db.commit()

        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(app.dependency_overrides.pop, get_db, None)
        self.addCleanup(self.db.close)

    def open_session(self, token: str, expires_in: timedelta = timedelta(hours=1)) -> None:
        self.db.add(
            UserSession(
                user_id=self.user.id,
                token_hash=hash_session_token(token),
                expires_at=utcnow() + expires_in,
            )
        )
        self.db.commit()
        self.client.cookies.set(SESSION_COOKIE_NAME, token)

    def test_logout_clears_last_seen_after_last_active_session(self) -> None:
        self.open_session("last-device")

        response = self.client.post("/auth/logout")

        self.assertEqual(response.status_code, 204)
        self.db.refresh(self.user)
        self.assertIsNone(self.user.last_seen)
        self.assertEqual(self.db.query(UserSession).count(), 0)

    def test_logout_preserves_last_seen_when_another_active_session_remains(self) -> None:
        self.open_session("first-device")
        self.open_session("second-device")
        last_seen = self.user.last_seen

        self.client.cookies.set(SESSION_COOKIE_NAME, "first-device")
        response = self.client.post("/auth/logout")

        self.assertEqual(response.status_code, 204)
        self.db.refresh(self.user)
        self.assertEqual(self.user.last_seen, last_seen)
        self.assertEqual(self.db.query(UserSession).count(), 1)

    def test_expired_sessions_do_not_keep_user_online_after_logout(self) -> None:
        self.open_session("expired-device", expires_in=timedelta(seconds=-1))

        response = self.client.post("/auth/logout")

        self.assertEqual(response.status_code, 204)
        self.db.refresh(self.user)
        self.assertIsNone(self.user.last_seen)
        self.assertEqual(self.db.query(UserSession).count(), 0)


if __name__ == "__main__":
    unittest.main()
