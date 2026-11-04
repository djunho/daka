"""Tests for friendship ORM mapping and account deactivation cleanup."""

from datetime import datetime, timezone
import unittest

from fastapi import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Friendship,
    ListingState,
    NegotiationState,
    ProposalState,
    User,
)
from app.routers.auth import delete_me


class FriendshipsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine, expire_on_commit=False)()
        self.db.add_all(
            [
                User(
                    user_name="Alice",
                    email="alice-friendships@example.test",
                    last_seen=datetime.now(timezone.utc),
                ),
                User(
                    user_name="Bob",
                    email="bob-friendships@example.test",
                    last_seen=datetime.now(timezone.utc),
                ),
                User(
                    user_name="Carol",
                    email="carol-friendships@example.test",
                    last_seen=datetime.now(timezone.utc),
                ),
                *[
                    ListingState(state_name=name)
                    for name in ("Available", "Reserved", "Traded", "Removed")
                ],
                *[
                    NegotiationState(state_name=name)
                    for name in ("Open", "Agreed", "Cancelled", "Unavailable")
                ],
                *[
                    ProposalState(state_name=name)
                    for name in (
                        "Pending",
                        "Accepted",
                        "Rejected",
                        "Withdrawn",
                        "NotSelected",
                        "ItemUnavailable",
                    )
                ],
            ]
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_friendship_has_two_explicit_user_relationships(self) -> None:
        alice, bob = self.db.query(User).order_by(User.id).limit(2).all()
        friendship = Friendship(user_id=alice.id, friend_id=bob.id)
        self.db.add(friendship)
        self.db.commit()

        self.assertIs(friendship.user, alice)
        self.assertIs(friendship.friend, bob)
        self.assertEqual(alice.friendships_as_user, [friendship])
        self.assertEqual(bob.friendships_as_friend, [friendship])

    def test_deleting_user_removes_friendships_on_both_sides_and_last_seen(self) -> None:
        alice, bob, carol = self.db.query(User).order_by(User.id).all()
        self.db.add_all(
            [
                Friendship(user_id=alice.id, friend_id=bob.id),
                Friendship(user_id=alice.id, friend_id=carol.id),
                Friendship(user_id=bob.id, friend_id=carol.id),
            ]
        )
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


if __name__ == "__main__":
    unittest.main()
