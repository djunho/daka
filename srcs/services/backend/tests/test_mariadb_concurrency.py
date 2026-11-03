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
    ProposalState,
    User,
)
from app.routers.auth import delete_me
from app.routers.listings import create_listing, delete_listing
from app.routers.negotiations import (
    accept_proposal,
    complete_negotiation,
    create_negotiation,
)
from app.schemas import ListingCreateIn, NegotiationCreateIn


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
        self.other_interested = User(
            user_name=f"race-other-{suffix}",
            email=f"race-other-{suffix}@example.com",
            pass_hash=None,
            google_sub=None,
            avatar=None,
            user_location=None,
        )
        self.fixture_session.add_all(
            [self.owner, self.interested, self.other_interested]
        )
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
        self.category_id = category.id
        self.condition_id = condition.id
        self.owner_id = self.owner.id
        self.interested_id = self.interested.id
        self.other_interested_id = self.other_interested.id
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
            Listing.user_id.in_(
                (self.owner_id, self.interested_id, self.other_interested_id)
            )
        ).delete(synchronize_session=False)
        self.fixture_session.query(User).filter(
            User.id.in_(
                (self.owner_id, self.interested_id, self.other_interested_id)
            )
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

    def test_concurrent_acceptance_refreshes_listing_state_under_lock(self) -> None:
        """Only one negotiation may reserve a shared requested listing."""
        open_state = (
            self.fixture_session.query(NegotiationState)
            .filter(NegotiationState.state_name == "Open")
            .one()
        )
        pending_state = (
            self.fixture_session.query(ProposalState)
            .filter(ProposalState.state_name == "Pending")
            .one()
        )
        negotiations = [
            Negotiation(
                listing_id=self.listing_id,
                interested_user_id=interested_id,
                negotiation_state_id=open_state.id,
            )
            for interested_id in (self.interested_id, self.other_interested_id)
        ]
        self.fixture_session.add_all(negotiations)
        self.fixture_session.flush()
        proposals = [
            Proposal(
                negotiation_id=negotiation.id,
                offered_listing_id=None,
                proposal_state_id=pending_state.id,
            )
            for negotiation in negotiations
        ]
        self.fixture_session.add_all(proposals)
        self.fixture_session.commit()
        proposal_ids = [proposal.id for proposal in proposals]
        negotiation_ids = [negotiation.id for negotiation in negotiations]

        reads_completed = threading.Barrier(2)
        results: list[int] = []
        errors: list[BaseException] = []
        connections = [engine.connect(), engine.connect()]
        sessions = [
            Session(bind=connection, autoflush=False) for connection in connections
        ]

        def pause_after_unlocked_listing_read(
            _connection,
            _cursor,
            statement,
            _parameters,
            _context,
            _executemany,
        ) -> None:
            normalized = " ".join(statement.lower().split())
            if " from listings " in normalized and " for update" not in normalized:
                reads_completed.wait(timeout=10)

        for connection in connections:
            connection.exec_driver_sql(
                "SET SESSION innodb_snapshot_isolation = OFF"
            )
            event.listen(
                connection,
                "after_cursor_execute",
                pause_after_unlocked_listing_read,
            )

        def run_acceptance(index: int) -> None:
            try:
                owner = sessions[index].get(User, self.owner_id)
                if owner is None:
                    raise AssertionError("listing owner disappeared")
                result = accept_proposal(proposal_ids[index], owner, sessions[index])
                results.append(result.id)
            except BaseException as exc:
                errors.append(exc)

        threads = [
            threading.Thread(target=run_acceptance, args=(index,), daemon=True)
            for index in range(2)
        ]
        try:
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=10)
        finally:
            for connection in connections:
                event.remove(
                    connection,
                    "after_cursor_execute",
                    pause_after_unlocked_listing_read,
                )
            for session in sessions:
                session.close()
            for connection in connections:
                connection.close()

        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(len(results), 1)
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], HTTPException)
        self.assertEqual(errors[0].status_code, 409)

        self.fixture_session.rollback()
        negotiation_states = [
            state_name
            for (state_name,) in self.fixture_session.query(
                NegotiationState.state_name
            )
            .join(
                Negotiation,
                Negotiation.negotiation_state_id == NegotiationState.id,
            )
            .filter(Negotiation.id.in_(negotiation_ids))
            .all()
        ]
        self.assertCountEqual(negotiation_states, ["Agreed", "Open"])

    def test_interested_deletion_serializes_with_negotiation_creation(self) -> None:
        """A negotiation cannot be created after participant cleanup."""
        deletion_reached_discovery = threading.Event()
        allow_deletion_to_continue = threading.Event()
        creation_finished = threading.Event()
        deletion_errors: list[BaseException] = []
        creation_errors: list[BaseException] = []

        delete_connection = engine.connect()
        delete_session = Session(bind=delete_connection, autoflush=False)
        deleting_user = delete_session.get(User, self.interested_id)
        self.assertIsNotNone(deleting_user)

        def pause_after_listing_discovery(
            _connection,
            _cursor,
            statement,
            _parameters,
            _context,
            _executemany,
        ) -> None:
            normalized = " ".join(statement.lower().split())
            if (
                not deletion_reached_discovery.is_set()
                and " from listings " in normalized
                and "listings.user_id" in normalized
            ):
                deletion_reached_discovery.set()
                if not allow_deletion_to_continue.wait(timeout=10):
                    raise TimeoutError("negotiation creation did not reach user lock")

        event.listen(
            delete_connection,
            "after_cursor_execute",
            pause_after_listing_discovery,
        )

        def run_deletion() -> None:
            try:
                delete_me(Response(), deleting_user, delete_session)
            except BaseException as exc:
                deletion_errors.append(exc)

        deletion_thread = threading.Thread(target=run_deletion, daemon=True)
        creation_thread = None
        create_session = SessionLocal()
        try:
            deletion_thread.start()
            self.assertTrue(
                deletion_reached_discovery.wait(timeout=10),
                "account deletion never reached listing discovery",
            )
            interested = create_session.get(User, self.interested_id)
            self.assertIsNotNone(interested)

            def run_creation() -> None:
                try:
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
                "negotiation creation did not wait for account deletion",
            )
        finally:
            allow_deletion_to_continue.set()
            deletion_thread.join(timeout=10)
            if creation_thread is not None:
                creation_thread.join(timeout=10)
            event.remove(
                delete_connection,
                "after_cursor_execute",
                pause_after_listing_discovery,
            )
            create_session.close()
            delete_session.close()
            delete_connection.close()

        self.assertFalse(deletion_thread.is_alive())
        self.assertIsNotNone(creation_thread)
        self.assertFalse(creation_thread.is_alive())
        if deletion_errors:
            raise deletion_errors[0]
        self.assertEqual(len(creation_errors), 1)
        self.assertIsInstance(creation_errors[0], HTTPException)
        self.assertEqual(creation_errors[0].status_code, 409)

        self.fixture_session.rollback()
        self.assertIsNone(
            self.fixture_session.query(Negotiation)
            .filter(Negotiation.listing_id == self.listing_id)
            .first()
        )

    def test_account_deletion_serializes_with_listing_creation(self) -> None:
        """A stale authenticated request cannot publish after account cleanup."""
        deletion_reached_discovery = threading.Event()
        allow_deletion_to_continue = threading.Event()
        creation_finished = threading.Event()
        deletion_errors: list[BaseException] = []
        creation_errors: list[BaseException] = []

        delete_connection = engine.connect()
        delete_session = Session(bind=delete_connection, autoflush=False)
        deleting_user = delete_session.get(User, self.interested_id)
        self.assertIsNotNone(deleting_user)

        def pause_after_listing_discovery(
            _connection,
            _cursor,
            statement,
            _parameters,
            _context,
            _executemany,
        ) -> None:
            normalized = " ".join(statement.lower().split())
            if (
                not deletion_reached_discovery.is_set()
                and " from listings " in normalized
                and "listings.user_id" in normalized
            ):
                deletion_reached_discovery.set()
                if not allow_deletion_to_continue.wait(timeout=10):
                    raise TimeoutError("listing creation did not reach user lock")

        event.listen(
            delete_connection,
            "after_cursor_execute",
            pause_after_listing_discovery,
        )

        def run_deletion() -> None:
            try:
                delete_me(Response(), deleting_user, delete_session)
            except BaseException as exc:
                deletion_errors.append(exc)

        deletion_thread = threading.Thread(target=run_deletion, daemon=True)
        creation_thread = None
        create_session = SessionLocal()
        try:
            deletion_thread.start()
            self.assertTrue(
                deletion_reached_discovery.wait(timeout=10),
                "account deletion never reached listing discovery",
            )
            interested = create_session.get(User, self.interested_id)
            self.assertIsNotNone(interested)

            def run_creation() -> None:
                try:
                    create_listing(
                        ListingCreateIn(
                            title="Concurrent listing",
                            category_id=self.category_id,
                            condition_id=self.condition_id,
                        ),
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
                "listing creation did not wait for account deletion",
            )
        finally:
            allow_deletion_to_continue.set()
            deletion_thread.join(timeout=10)
            if creation_thread is not None:
                creation_thread.join(timeout=10)
            event.remove(
                delete_connection,
                "after_cursor_execute",
                pause_after_listing_discovery,
            )
            create_session.close()
            delete_session.close()
            delete_connection.close()

        self.assertFalse(deletion_thread.is_alive())
        self.assertIsNotNone(creation_thread)
        self.assertFalse(creation_thread.is_alive())
        if deletion_errors:
            raise deletion_errors[0]
        self.assertEqual(len(creation_errors), 1)
        self.assertIsInstance(creation_errors[0], HTTPException)
        self.assertEqual(creation_errors[0].status_code, 409)

        self.fixture_session.rollback()
        self.assertEqual(
            self.fixture_session.query(Listing)
            .filter(Listing.user_id == self.interested_id)
            .count(),
            0,
        )

    def test_completion_serializes_with_negotiation_creation(self) -> None:
        """Completion cannot miss a negotiation created for its listing."""
        agreed = (
            self.fixture_session.query(NegotiationState)
            .filter(NegotiationState.state_name == "Agreed")
            .one()
        )
        accepted = (
            self.fixture_session.query(ProposalState)
            .filter(ProposalState.state_name == "Accepted")
            .one()
        )
        reserved = (
            self.fixture_session.query(ListingState)
            .filter(ListingState.state_name == "Reserved")
            .one()
        )
        negotiation = Negotiation(
            listing_id=self.listing_id,
            interested_user_id=self.interested_id,
            negotiation_state_id=agreed.id,
        )
        self.fixture_session.add(negotiation)
        self.fixture_session.flush()
        self.fixture_session.add(
            Proposal(
                negotiation_id=negotiation.id,
                offered_listing_id=None,
                proposal_state_id=accepted.id,
            )
        )
        self.listing.state_id = reserved.id
        self.fixture_session.commit()
        negotiation_id = negotiation.id

        completion_reached_negotiation_lock = threading.Event()
        allow_completion_to_continue = threading.Event()
        creation_finished = threading.Event()
        completion_errors: list[BaseException] = []
        creation_errors: list[BaseException] = []

        complete_connection = engine.connect()
        complete_session = Session(bind=complete_connection, autoflush=False)
        completing_user = complete_session.get(User, self.interested_id)
        self.assertIsNotNone(completing_user)

        def pause_before_negotiation_lock(
            _connection,
            _cursor,
            statement,
            _parameters,
            _context,
            _executemany,
        ) -> None:
            normalized = " ".join(statement.lower().split())
            if (
                not completion_reached_negotiation_lock.is_set()
                and " from negotiations " in normalized
                and " for update" in normalized
            ):
                completion_reached_negotiation_lock.set()
                if not allow_completion_to_continue.wait(timeout=10):
                    raise TimeoutError("negotiation creation did not reach owner lock")

        event.listen(
            complete_connection,
            "before_cursor_execute",
            pause_before_negotiation_lock,
        )

        def run_completion() -> None:
            try:
                complete_negotiation(
                    negotiation_id,
                    completing_user,
                    complete_session,
                )
            except BaseException as exc:
                completion_errors.append(exc)

        completion_thread = threading.Thread(target=run_completion, daemon=True)
        creation_thread = None
        create_session = SessionLocal()
        try:
            completion_thread.start()
            self.assertTrue(
                completion_reached_negotiation_lock.wait(timeout=10),
                "completion never reached its negotiation lock",
            )
            other_interested = create_session.get(User, self.other_interested_id)
            self.assertIsNotNone(other_interested)

            def run_creation() -> None:
                try:
                    create_negotiation(
                        NegotiationCreateIn(listing_id=self.listing_id),
                        Response(),
                        other_interested,
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
                "negotiation creation did not wait for completion",
            )
        finally:
            allow_completion_to_continue.set()
            completion_thread.join(timeout=10)
            if creation_thread is not None:
                creation_thread.join(timeout=10)
            event.remove(
                complete_connection,
                "before_cursor_execute",
                pause_before_negotiation_lock,
            )
            create_session.close()
            complete_session.close()
            complete_connection.close()

        self.assertFalse(completion_thread.is_alive())
        self.assertIsNotNone(creation_thread)
        self.assertFalse(creation_thread.is_alive())
        if completion_errors:
            raise completion_errors[0]
        self.assertEqual(len(creation_errors), 1)
        self.assertIsInstance(creation_errors[0], HTTPException)
        self.assertEqual(creation_errors[0].status_code, 409)

        self.fixture_session.rollback()
        completed_state = (
            self.fixture_session.query(NegotiationState.state_name)
            .join(
                Negotiation,
                Negotiation.negotiation_state_id == NegotiationState.id,
            )
            .filter(Negotiation.id == negotiation_id)
            .scalar()
        )
        competing_count = (
            self.fixture_session.query(Negotiation)
            .filter(
                Negotiation.listing_id == self.listing_id,
                Negotiation.interested_user_id == self.other_interested_id,
            )
            .count()
        )
        self.assertEqual(completed_state, "Completed")
        self.assertEqual(competing_count, 0)


if __name__ == "__main__":
    unittest.main()
