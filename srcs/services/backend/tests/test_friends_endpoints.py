"""HTTP tests for the friendship and online-status API."""

from datetime import timedelta
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import Friendship, User
from app.presence import ONLINE_WINDOW
from app.security import utcnow
from tests.helpers import make_memory_session


class FriendsEndpointsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.db, _, _, _ = make_memory_session()
        self.alice = User(
            user_name="Alice",
            email="alice-friends-endpoints@example.test",
            last_seen=utcnow(),
        )
        self.bob = User(
            user_name="Bob",
            email="bob-friends-endpoints@example.test",
            last_seen=utcnow(),
        )
        self.carol = User(
            user_name="Carol",
            email="carol-friends-endpoints@example.test",
            last_seen=utcnow() - ONLINE_WINDOW - timedelta(seconds=1),
        )
        self.dan = User(
            user_name="Dan",
            email="dan-friends-endpoints@example.test",
            last_seen=utcnow(),
        )
        self.db.add_all([self.alice, self.bob, self.carol, self.dan])
        self.db.commit()

        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.current_user
        self.current_user = self.alice
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(app.dependency_overrides.clear)
        self.addCleanup(self.db.close)

    def add_friend(self, user_id: int):
        return self.client.post(f"/friends/{user_id}")

    def test_add_friend_is_visible_to_both_users_and_uses_one_normalized_row(self) -> None:
        response = self.add_friend(self.bob.id)

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["id"], self.bob.id)
        friendship = self.db.query(Friendship).one()
        self.assertEqual(
            (friendship.user_id, friendship.friend_id),
            (self.alice.id, self.bob.id),
        )

        self.current_user = self.bob
        response = self.client.get("/friends")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item["id"] for item in response.json()["items"]], [self.alice.id])

        response = self.client.post(f"/friends/{self.alice.id}")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "User is already in your friends list."})
        self.assertEqual(self.db.query(Friendship).count(), 1)

    def test_add_self_returns_400(self) -> None:
        response = self.add_friend(self.alice.id)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "You cannot add yourself as a friend."})

    def test_add_missing_or_deleted_user_returns_404(self) -> None:
        missing = self.add_friend(99999)
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json(), {"detail": "User not found."})

        self.dan.deleted_at = utcnow()
        self.db.commit()
        deleted = self.add_friend(self.dan.id)
        self.assertEqual(deleted.status_code, 404)
        self.assertEqual(deleted.json(), {"detail": "User not found."})

    def test_integrity_error_during_add_returns_409(self) -> None:
        existing = Friendship(
            user_id=self.alice.id,
            friend_id=self.bob.id,
            status="accepted",
        )
        with (
            patch.object(
                self.db,
                "get",
                side_effect=[None, existing],
            ),
            patch(
                "app.routers.friends.Session.commit",
                side_effect=IntegrityError("insert friendship", {}, Exception("duplicate")),
            ),
        ):
            response = self.add_friend(self.bob.id)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "User is already in your friends list."})

    def test_unrelated_integrity_error_is_not_mapped_to_friend_conflict(self) -> None:
        with (
            patch.object(self.db, "get", side_effect=[None, None]),
            patch(
                "app.routers.friends.Session.commit",
                side_effect=IntegrityError("insert friendship", {}, Exception("constraint")),
            ),
            self.assertRaises(IntegrityError),
        ):
            self.add_friend(self.bob.id)

    def test_remove_is_logical_and_reactivation_reuses_the_same_row(self) -> None:
        self.assertEqual(self.add_friend(self.bob.id).status_code, 201)
        friendship = self.db.query(Friendship).one()

        response = self.client.delete(f"/friends/{self.bob.id}")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b"")
        self.db.refresh(friendship)
        self.assertEqual(friendship.status, "removed")

        response = self.client.get("/friends")
        self.assertEqual(response.json()["items"], [])

        response = self.client.post(f"/friends/{self.bob.id}")
        self.assertEqual(response.status_code, 201, response.text)
        self.db.refresh(friendship)
        self.assertEqual(friendship.status, "accepted")
        self.assertEqual(self.db.query(Friendship).count(), 1)

    def test_either_user_can_remove_and_non_friend_returns_404(self) -> None:
        self.assertEqual(self.add_friend(self.bob.id).status_code, 201)

        self.current_user = self.bob
        response = self.client.delete(f"/friends/{self.alice.id}")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.db.query(Friendship).one().status, "removed")

        response = self.client.delete(f"/friends/{self.alice.id}")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "User is not in your friends list."})

    def test_status_is_true_only_for_accepted_and_false_for_removed_or_self(self) -> None:
        self.assertEqual(self.client.get(f"/friends/{self.alice.id}/status").json(), {"is_friend": False})
        self.assertEqual(self.client.get(f"/friends/{self.bob.id}/status").json(), {"is_friend": False})

        self.assertEqual(self.add_friend(self.bob.id).status_code, 201)
        self.assertEqual(
            self.client.get(f"/friends/{self.bob.id}/status").json(),
            {"is_friend": True},
        )
        self.client.delete(f"/friends/{self.bob.id}")
        self.assertEqual(
            self.client.get(f"/friends/{self.bob.id}/status").json(),
            {"is_friend": False},
        )

    def test_status_missing_or_deleted_user_returns_404(self) -> None:
        for user_id in (99999, self.dan.id):
            if user_id == self.dan.id:
                self.dan.deleted_at = utcnow()
                self.db.commit()
            response = self.client.get(f"/friends/{user_id}/status")
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json(), {"detail": "User not found."})

    def test_list_excludes_deleted_users_orders_online_first_and_paginates(self) -> None:
        self.assertEqual(self.add_friend(self.bob.id).status_code, 201)
        self.assertEqual(self.add_friend(self.carol.id).status_code, 201)
        self.assertEqual(self.add_friend(self.dan.id).status_code, 201)
        self.dan.deleted_at = utcnow()
        self.db.commit()

        response = self.client.get("/friends")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["total"], 2)
        self.assertEqual([item["id"] for item in body["items"]], [self.bob.id, self.carol.id])
        self.assertTrue(body["items"][0]["is_online"])
        self.assertFalse(body["items"][1]["is_online"])
        self.assertIn("last_seen", body["items"][0])

        first = self.client.get("/friends", params={"limit": 1, "offset": 0}).json()
        second = self.client.get("/friends", params={"limit": 1, "offset": 1}).json()
        self.assertEqual(first["total"], 2)
        self.assertEqual([item["id"] for item in first["items"]], [self.bob.id])
        self.assertEqual([item["id"] for item in second["items"]], [self.carol.id])

    def test_public_profile_includes_presence(self) -> None:
        response = self.client.get(f"/users/{self.bob.id}")

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["is_online"])
        self.assertIsNotNone(body["last_seen"])

    def test_friend_and_public_profile_endpoints_require_authentication(self) -> None:
        app.dependency_overrides.pop(get_current_user)

        requests = (
            self.client.get("/friends"),
            self.client.post(f"/friends/{self.bob.id}"),
            self.client.delete(f"/friends/{self.bob.id}"),
            self.client.get(f"/friends/{self.bob.id}/status"),
            self.client.get(f"/users/{self.bob.id}"),
        )
        for response in requests:
            with self.subTest(path=response.request.url.path):
                self.assertEqual(response.status_code, 401, response.text)


if __name__ == "__main__":
    unittest.main()
