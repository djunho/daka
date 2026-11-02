"""MariaDB-only concurrency regression tests.

Run explicitly inside the backend container:

    RUN_MARIADB_INTEGRATION=1 python -m unittest \
        tests.test_mariadb_concurrency -v

The tests use uniquely named rows in the development database and remove them
after each run.  They are skipped during the default isolated SQLite suite.
"""

import os
import threading
import unittest
from uuid import uuid4

from fastapi import HTTPException, Response
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.models import (
    Category,
    Condition,
    Listing,
    ListingState,
    Negotiation,
    NegotiationState,
    Proposal,
    User,
)
from app.routers.listings import delete_listing
from app.routers.negotiations import create_negotiation
from app.schemas import NegotiationCreateIn


@unittest.skipUnless(
    os.getenv("RUN_MARIADB_INTEGRATION") == "1",
    "set RUN_MARIADB_INTEGRATION=1 to run MariaDB concurrency tests",
)
class MariaDBConcurrencyTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture_session = SessionLocal()
        suffix = uuid4().hex
        self.owner = User(
            user_name=f"race-owner-{suffix}",
            email=f"race-owner-{suffix}@example.com",
            pass_hash=None,
            google_sub=None,
            avatar=None,
            user_location=None,
        )
        self.interested = User(
            user_name=f"race-interested-{suffix}",
            email=f"race-interested-{suffix}@example.com",
            pass_hash=None,
            google_sub=None,
            avatar=None,
            user_location=None,
        )
        self.fixture_session.add_all([self.owner, self.interested])
        self.fixture_session.flush()

        category = self.fixture_session.query(Category).order_by(Category.id).first()
        condition = self.fixture_session.query(Condition).order_by(Condition.id).first()
        available = (
            self.fixture_session.query(ListingState)
            .filter(ListingState.state_name == "Available")
            .one()
        )
        if category is None or condition is None:
            self.fail("MariaDB category and condition seeds are required")
        self.listing = Listing(
            user_id=self.owner.id,
            category_id=category.id,
            condition_id=condition.id,
            state_id=available.id,
            title=f"Race listing {suffix}",
            listing_dsc=None,
            listing_location=None,
            wish=None,
        )
        self.fixture_session.add(self.listing)
        self.fixture_session.commit()
        self.owner_id = self.owner.id
        self.interested_id = self.interested.id
        self.listing_id = self.listing.id

    def tearDown(self) -> None:
        self.fixture_session.rollback()
        self.fixture_session.query(Proposal).filter(
            Proposal.negotiation_id.in_(
                self.fixture_session.query(Negotiation.id).filter(
                    Negotiation.listing_id == self.listing_id
                )
            )
        ).delete(synchronize_session=False)
        self.fixture_session.query(Negotiation).filter(
            Negotiation.listing_id == self.listing_id
        ).delete(synchronize_session=False)
        self.fixture_session.query(Listing).filter(
            Listing.id == self.listing_id
        ).delete(synchronize_session=False)
        self.fixture_session.query(User).filter(
            User.id.in_((self.owner_id, self.interested_id))
        ).delete(synchronize_session=False)
        self.fixture_session.commit()
        self.fixture_session.close()

    def test_listing_deletion_catches_negotiation_created_after_discovery(
        self,
    ) -> None:
        """A negotiation committed during deletion must not remain open."""
        deletion_reached_listing_lock = threading.Event()
        allow_deletion_to_continue = threading.Event()
        creation_finished = threading.Event()
        deletion_errors: list[BaseException] = []
        creation_errors: list[BaseException] = []

        delete_connection = engine.connect()
        delete_session = Session(bind=delete_connection, autoflush=False)
        deleting_user = delete_session.get(User, self.owner_id)
        self.assertIsNotNone(deleting_user)

        def pause_before_listing_lock(
            _connection,
            _cursor,
            statement,
            _parameters,
            _context,
            _executemany,
        ) -> None:
            normalized = " ".join(statement.lower().split())
            if (
                not deletion_reached_listing_lock.is_set()
                and " from listings " in normalized
                and " for update" in normalized
            ):
                deletion_reached_listing_lock.set()
                if not allow_deletion_to_continue.wait(timeout=10):
                    raise TimeoutError("negotiation creation did not finish")

        event.listen(
            delete_connection,
            "before_cursor_execute",
            pause_before_listing_lock,
        )

        def run_deletion() -> None:
            try:
                delete_listing(self.listing_id, deleting_user, delete_session)
            except BaseException as exc:  # surfaced in the test thread below
                deletion_errors.append(exc)

        deletion_thread = threading.Thread(target=run_deletion, daemon=True)
        creation_thread = None
        try:
            deletion_thread.start()
            self.assertTrue(
                deletion_reached_listing_lock.wait(timeout=10),
                "listing deletion never reached its listing lock",
            )

            def run_creation() -> None:
                try:
                    with SessionLocal() as create_session:
                        interested = create_session.get(User, self.interested_id)
                        if interested is None:
                            raise AssertionError("interested user disappeared")
                        create_negotiation(
                            NegotiationCreateIn(listing_id=self.listing_id),
                            Response(),
                            interested,
                            create_session,
                        )
                except BaseException as exc:
                    creation_errors.append(exc)
                finally:
                    creation_finished.set()

            creation_thread = threading.Thread(target=run_creation, daemon=True)
            creation_thread.start()
            self.assertFalse(
                creation_finished.wait(timeout=0.5),
                "negotiation creation did not wait for listing deletion",
            )
        finally:
            allow_deletion_to_continue.set()
            deletion_thread.join(timeout=10)
            if creation_thread is not None:
                creation_thread.join(timeout=10)
            event.remove(
                delete_connection,
                "before_cursor_execute",
                pause_before_listing_lock,
            )
            delete_session.close()
            delete_connection.close()

        self.assertFalse(deletion_thread.is_alive(), "listing deletion deadlocked")
        self.assertIsNotNone(creation_thread)
        self.assertFalse(creation_thread.is_alive(), "negotiation creation deadlocked")
        if deletion_errors:
            raise deletion_errors[0]
        self.assertEqual(len(creation_errors), 1)
        self.assertIsInstance(creation_errors[0], HTTPException)
        self.assertEqual(creation_errors[0].status_code, 409)

        # End any REPEATABLE READ snapshot opened while retaining fixture IDs,
        # then verify the state committed by both worker transactions.
        self.fixture_session.rollback()
        listing_state = (
            self.fixture_session.query(ListingState.state_name)
            .join(Listing, Listing.state_id == ListingState.id)
            .filter(Listing.id == self.listing_id)
            .scalar()
        )
        negotiation_state = (
            self.fixture_session.query(NegotiationState.state_name)
            .join(
                Negotiation,
                Negotiation.negotiation_state_id == NegotiationState.id,
            )
            .filter(Negotiation.listing_id == self.listing_id)
            .scalar()
        )
        self.assertEqual(listing_state, "Removed")
        self.assertIsNone(negotiation_state)


if __name__ == "__main__":
    unittest.main()
