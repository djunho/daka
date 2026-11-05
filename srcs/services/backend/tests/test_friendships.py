"""Tests for friendship ORM mapping and account deactivation cleanup."""

from datetime import datetime
import unittest

from fastapi import Response
from sqlalchemy.exc import IntegrityError, StatementError

from app.friendships import (
    active_friendships_query,
    normalize_pair,
    remove_friendship,
    save_friendship,
)
from app.models import (
    Friendship,
    User,
)
from app.routers.auth import delete_me
from app.security import utcnow
from tests.helpers import make_memory_session


class FriendshipsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.db, _, _, _ = make_memory_session()
        self.db.add_all(
            [
                User(
                    user_name="Alice",
                    email="alice-friendships@example.test",
                    last_seen=utcnow(),
                ),
                User(
                    user_name="Bob",
                    email="bob-friendships@example.test",
                    last_seen=utcnow(),
                ),
                User(
                    user_name="Carol",
                    email="carol-friendships@example.test",
                    last_seen=utcnow(),
                ),
            ]
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_friendship_has_two_explicit_user_relationships(self) -> None:
        alice, bob = self.db.query(User).order_by(User.id).limit(2).all()
        friendship = save_friendship(self.db, bob.id, alice.id)
        self.db.commit()

        self.assertIs(friendship.user, alice)
        self.assertIs(friendship.friend, bob)
        self.assertEqual(alice.friendships_as_user, [friendship])
        self.assertEqual(bob.friendships_as_friend, [friendship])

    def test_normalize_pair_is_order_independent(self) -> None:
        self.assertEqual(normalize_pair(3, 10), (3, 10))
        self.assertEqual(normalize_pair(10, 3), (3, 10))

    def test_normalize_pair_rejects_self_friendship(self) -> None:
        with self.assertRaises(ValueError):
            normalize_pair(3, 3)

    def test_friendship_rejects_unnormalized_pair(self) -> None:
        alice, bob = self.db.query(User).order_by(User.id).limit(2).all()
        self.db.add(Friendship(user_id=bob.id, friend_id=alice.id))

        with self.assertRaises(IntegrityError):
            self.db.commit()

    def test_active_friendships_query_finds_both_sides_and_ignores_removed(
        self,
    ) -> None:
        alice, bob, carol = self.db.query(User).order_by(User.id).all()
        save_friendship(self.db, alice.id, bob.id)
        save_friendship(self.db, carol.id, alice.id)
        remove_friendship(self.db, bob.id, carol.id)
        self.db.commit()

        self.assertEqual(
            active_friendships_query(self.db, alice.id).all(),
            [
                self.db.get(Friendship, (alice.id, bob.id)),
                self.db.get(Friendship, (alice.id, carol.id)),
            ],
        )
        self.assertEqual(active_friendships_query(self.db, bob.id).count(), 1)
        self.assertEqual(active_friendships_query(self.db, carol.id).count(), 1)

    def test_remove_friendship_does_not_create_missing_relationship(self) -> None:
        alice, bob = self.db.query(User).order_by(User.id).limit(2).all()

        self.assertIsNone(remove_friendship(self.db, bob.id, alice.id))
        self.assertEqual(self.db.query(Friendship).count(), 0)

    def test_deleting_user_removes_friendships_on_both_sides_and_last_seen(self) -> None:
        alice, bob, carol = self.db.query(User).order_by(User.id).all()
        save_friendship(self.db, alice.id, bob.id)
        save_friendship(self.db, alice.id, carol.id)
        save_friendship(self.db, bob.id, carol.id)
        self.db.commit()

        delete_me(Response(), bob, self.db)

        remaining = self.db.query(Friendship).order_by(
            Friendship.user_id, Friendship.friend_id
        ).all()
        self.assertEqual(
            [(row.user_id, row.friend_id) for row in remaining],
            [(alice.id, carol.id)],
        )
        self.assertIsNone(self.db.get(User, bob.id).last_seen)

    def test_friendship_rejects_unknown_status(self) -> None:
        alice, bob = self.db.query(User).order_by(User.id).limit(2).all()
        self.db.add(Friendship(user_id=alice.id, friend_id=bob.id, status="pending"))

        with self.assertRaises(StatementError):
            self.db.commit()

    def test_friendship_updates_timestamp_when_status_changes(self) -> None:
        alice, bob = self.db.query(User).order_by(User.id).limit(2).all()
        friendship = save_friendship(self.db, alice.id, bob.id)
        self.db.commit()

        created_updated_at = friendship.updated_at
        remove_friendship(self.db, bob.id, alice.id)
        self.db.commit()

        self.assertIsNotNone(created_updated_at)
        self.assertGreaterEqual(friendship.updated_at, created_updated_at)

    def test_physical_user_delete_cascades_loaded_friendships(self) -> None:
        alice, bob, carol = self.db.query(User).order_by(User.id).all()
        save_friendship(self.db, alice.id, bob.id)
        save_friendship(self.db, alice.id, carol.id)
        save_friendship(self.db, bob.id, carol.id)
        self.db.commit()

        self.assertEqual(len(alice.friendships_as_user), 2)
        self.assertEqual(len(bob.friendships_as_user), 1)
        self.assertEqual(len(bob.friendships_as_friend), 1)

        self.db.delete(bob)
        self.db.commit()

        self.assertIsNone(self.db.get(User, bob.id))
        self.assertEqual(
            self.db.query(Friendship).count(),
            1,
        )
        remaining = self.db.query(Friendship).one()
        self.assertEqual((remaining.user_id, remaining.friend_id), (alice.id, carol.id))


if __name__ == "__main__":
    unittest.main()
