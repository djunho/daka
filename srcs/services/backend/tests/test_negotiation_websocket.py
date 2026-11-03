"""Handshake security tests for negotiation WebSockets."""

from datetime import timedelta
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect

from app.database import Base
from app.main import app
from app.models import (
    Category,
    Condition,
    Listing,
    ListingState,
    Negotiation,
    NegotiationState,
    User,
    UserSession,
)
from app.security import hash_session_token, utcnow


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
        self.client = TestClient(app)

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

    def tearDown(self) -> None:
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
            with self._connect(token, origin=self.origin, **kwargs):
                pass
        self.assertEqual(raised.exception.code, code)

    def test_interested_and_owner_are_accepted(self) -> None:
        for participant in (self.interested, self.owner):
            with self.subTest(participant=participant.user_name):
                with self._connect(
                    self.tokens[participant.user_name], origin=self.origin
                ) as websocket:
                    # Client identity claims are deliberately ignored: the
                    # authenticated identity came from the cookie already.
                    websocket.send_json({"sender_id": self.outsider.id})

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
            with self._connect(token):
                pass
        self.assertEqual(missing.exception.code, 4403)
        with self.assertRaises(WebSocketDisconnect) as foreign:
            with self._connect(token, origin="https://evil.example"):
                pass
        self.assertEqual(foreign.exception.code, 4403)

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


if __name__ == "__main__":
    unittest.main()
