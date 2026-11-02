"""Behaviour tests for the sort option of GET /listings, using SQLite."""

import unittest
from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Category, Condition, Listing, ListingState, User


class ListingsSortTestCase(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine, expire_on_commit=False)()

        available = ListingState(state_name="Available")
        category = Category(category_name="Books")
        condition = Condition(condition_name="Good")
        owner = User(
            user_name="Ana",
            email="ana@example.com",
            pass_hash=None,
        )
        self.db.add_all([available, category, condition, owner])
        self.db.flush()

        # Oldest to newest. Two share a title and two share a date, to check
        # the tie-breaker that keeps pagination stable.
        rows = [
            ("Bicicleta", datetime(2026, 1, 1)),
            ("Atlas", datetime(2026, 1, 2)),
            ("Candeeiro", datetime(2026, 1, 3)),
            ("Atlas", datetime(2026, 1, 3)),
        ]
        self.db.add_all(
            Listing(
                user_id=owner.id,
                category_id=category.id,
                condition_id=condition.id,
                state_id=available.id,
                title=title,
                created_at=created_at,
            )
            for title, created_at in rows
        )
        self.db.commit()

        app.dependency_overrides[get_db] = lambda: self.db
        self.addCleanup(app.dependency_overrides.pop, get_db, None)
        self.addCleanup(self.db.close)
        self.client = TestClient(app)

    def ids(self, **params) -> list[int]:
        response = self.client.get("/listings", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return [item["id"] for item in response.json()["items"]]

    def test_defaults_to_newest_first(self) -> None:
        self.assertEqual(self.ids(), [4, 3, 2, 1])
        self.assertEqual(self.ids(sort="newest"), [4, 3, 2, 1])

    def test_oldest_first(self) -> None:
        self.assertEqual(self.ids(sort="oldest"), [1, 2, 3, 4])

    def test_title_ascending_breaks_ties_by_id(self) -> None:
        self.assertEqual(self.ids(sort="title_asc"), [2, 4, 1, 3])

    def test_title_descending_breaks_ties_by_id(self) -> None:
        self.assertEqual(self.ids(sort="title_desc"), [3, 1, 4, 2])

    def test_pages_follow_the_chosen_order(self) -> None:
        first = self.ids(sort="title_asc", limit=2)
        second = self.ids(sort="title_asc", limit=2, offset=2)
        self.assertEqual(first + second, [2, 4, 1, 3])

    def test_unknown_sort_is_rejected(self) -> None:
        response = self.client.get("/listings", params={"sort": "price"})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
