"""HTTP tests for GET /auth/session: no session is an answer, never an error."""

from datetime import timedelta
import unittest

from fastapi.testclient import TestClient

from app.database import get_db
from app.dependencies import SESSION_COOKIE_NAME
from app.main import app
from app.models import User, UserSession
from app.security import hash_session_token, utcnow
from tests.helpers import make_memory_session

NO_SESSION = {"user": None}


class SessionCheckTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.db, _, _, _ = make_memory_session()
        self.user = User(user_name="ana", email="ana@example.com", pass_hash=None)
        self.db.add(self.user)
        self.db.commit()

        self.previous_override = app.dependency_overrides.get(get_db)
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        if self.previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = self.previous_override
        self.client.close()
        self.db.close()

    def open_session(self, token: str, expires_in: timedelta = timedelta(hours=1)) -> None:
        self.db.add(
            UserSession(
                user_id=self.user.id,
                token_hash=hash_session_token(token),
                expires_at=utcnow() + expires_in,
            )
        )
        self.db.commit()

    def check(self, token: str | None = None):
        if token is not None:
            self.client.cookies.set(SESSION_COOKIE_NAME, token)
        return self.client.get("/auth/session")

    def assert_cookie_cleared(self, response) -> None:
        header = response.headers.get("set-cookie", "")
        self.assertIn(f"{SESSION_COOKIE_NAME}=", header)
        self.assertIn("Max-Age=0", header)

    def test_no_cookie_answers_200_with_no_user(self) -> None:
        response = self.check()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), NO_SESSION)
        self.assertNotIn("set-cookie", response.headers)

    def test_unknown_cookie_answers_no_user_and_clears_it(self) -> None:
        response = self.check("not-a-session")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), NO_SESSION)
        self.assert_cookie_cleared(response)

    def test_expired_session_answers_no_user_and_is_deleted(self) -> None:
        self.open_session("old", expires_in=timedelta(hours=-1))

        response = self.check("old")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), NO_SESSION)
        self.assert_cookie_cleared(response)
        self.assertEqual(self.db.query(UserSession).count(), 0)

    def test_deactivated_account_answers_no_user(self) -> None:
        self.open_session("valid")
        self.user.deleted_at = utcnow()
        self.db.commit()

        response = self.check("valid")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), NO_SESSION)

    def test_valid_session_returns_the_user_and_counts_as_activity(self) -> None:
        self.open_session("valid")

        response = self.check("valid")

        self.assertEqual(response.status_code, 200)
        user = response.json()["user"]
        self.assertEqual(user["id"], self.user.id)
        self.assertEqual(user["email"], self.user.email)
        self.assertTrue(user["is_online"])
        self.assertNotIn("pass_hash", user)
        self.assertNotIn("set-cookie", response.headers)
        self.db.refresh(self.user)
        self.assertIsNotNone(self.user.last_seen)


if __name__ == "__main__":
    unittest.main()
