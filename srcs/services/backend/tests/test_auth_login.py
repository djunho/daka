"""HTTP tests for POST /auth/login: one answer for every failure, never a 500."""

import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.database import get_db
from app.dependencies import SESSION_COOKIE_NAME
from app.main import app
from app.models import User, UserSession
from app.security import hash_password, hash_session_token, utcnow, verify_password
from tests.helpers import make_memory_session

PASSWORD = "correct-horse-battery"
WRONG_CREDENTIALS = {"detail": "Incorrect email or password."}


class LoginTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.db, _, _, _ = make_memory_session()
        self.user = User(
            user_name="ana",
            email="ana@example.com",
            pass_hash=hash_password(PASSWORD),
        )
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

    def login(self, email: str, password: str):
        return self.client.post("/auth/login", json={"email": email, "password": password})

    def session_count(self) -> int:
        return self.db.query(UserSession).count()

    def login_checking_password(self, email: str, password: str):
        """Log in and report whether bcrypt ran before the answer.

        Every failure must cost a password check, or a faster answer would tell
        which emails exist or which accounts were deactivated. Counting the
        call catches that without timing the response.
        """
        with patch("app.routers.auth.verify_password", wraps=verify_password) as check:
            response = self.login(email, password)
        return response, check

    def test_unknown_email_is_rejected_like_a_wrong_password(self) -> None:
        response, check = self.login_checking_password("nobody@example.com", PASSWORD)

        check.assert_called_once()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), WRONG_CREDENTIALS)
        self.assertNotIn(SESSION_COOKIE_NAME, response.cookies)
        self.assertEqual(self.session_count(), 0)

    def test_wrong_password_is_rejected(self) -> None:
        response = self.login(self.user.email, "not-the-password")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), WRONG_CREDENTIALS)
        self.assertEqual(self.session_count(), 0)

    def test_deactivated_account_gets_the_same_answer_and_no_session(self) -> None:
        self.user.deleted_at = utcnow()
        self.db.commit()

        # Even with the right password, the answer must not reveal that the
        # account exists but was deactivated: neither by its text nor by
        # coming back before the password was checked.
        response, check = self.login_checking_password(self.user.email, PASSWORD)

        check.assert_called_once()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), WRONG_CREDENTIALS)
        self.assertNotIn(SESSION_COOKIE_NAME, response.cookies)
        self.assertEqual(self.session_count(), 0)

    def test_account_without_password_is_rejected(self) -> None:
        # Google-only accounts have no password hash.
        self.user.pass_hash = None
        self.db.commit()

        response, check = self.login_checking_password(self.user.email, PASSWORD)

        check.assert_called_once()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), WRONG_CREDENTIALS)

    def test_correct_credentials_open_a_session(self) -> None:
        response = self.login(self.user.email, PASSWORD)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], self.user.id)
        self.assertEqual(response.json()["email"], self.user.email)
        self.assertIn(SESSION_COOKIE_NAME, response.cookies)
        self.assertEqual(self.session_count(), 1)

    def test_logout_clears_last_seen_when_no_sessions_remain(self) -> None:
        self.user.last_seen = utcnow()
        self.db.commit()
        login_response = self.login(self.user.email, PASSWORD)
        self.client.cookies.set(
            SESSION_COOKIE_NAME,
            login_response.cookies[SESSION_COOKIE_NAME],
        )

        response = self.client.post("/auth/logout")

        self.assertEqual(response.status_code, 204)
        self.assertIsNone(self.db.get(User, self.user.id).last_seen)

    def test_logout_preserves_last_seen_when_another_session_remains(self) -> None:
        self.user.last_seen = utcnow()
        self.db.add(
            UserSession(
                user_id=self.user.id,
                token_hash=hash_session_token("other-device"),
                expires_at=utcnow() + timedelta(hours=1),
            )
        )
        self.db.commit()
        login_response = self.login(self.user.email, PASSWORD)
        self.client.cookies.set(
            SESSION_COOKIE_NAME,
            login_response.cookies[SESSION_COOKIE_NAME],
        )

        response = self.client.post("/auth/logout")

        self.assertEqual(response.status_code, 204)
        self.assertIsNotNone(self.db.get(User, self.user.id).last_seen)


if __name__ == "__main__":
    unittest.main()
