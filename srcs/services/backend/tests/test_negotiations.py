"""Behaviour tests for negotiations and proposals using isolated SQLite."""

from datetime import datetime
import unittest

from fastapi import HTTPException, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Category,
    Condition,
    Favorite,
    Listing,
    ListingState,
    Negotiation,
    NegotiationState,
    Proposal,
    ProposalState,
    User,
)
from app.routers.listings import delete_listing
from app.routers.negotiations import (
    accept_proposal,
    cancel_negotiation,
    complete_negotiation,
    create_negotiation,
    create_proposal,
    get_negotiation,
    list_negotiations,
    reject_proposal,
    withdraw_proposal,
)
from app.schemas import NegotiationCreateIn, ProposalCreateIn


class NegotiationsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine, expire_on_commit=False)()

        self.listing_states = {
            name: ListingState(state_name=name)
            for name in ("Available", "Reserved", "Traded", "Expired", "Removed")
        }
        self.negotiation_states = {
            name: NegotiationState(state_name=name)
            for name in ("Open", "Agreed", "Completed", "Cancelled", "Unavailable")
        }
        self.proposal_states = {
            name: ProposalState(state_name=name)
            for name in (
                "Pending",
                "Accepted",
                "Rejected",
                "Withdrawn",
                "NotSelected",
                "ItemUnavailable",
            )
        }
        self.db.add_all(
            [
                *self.listing_states.values(),
                *self.negotiation_states.values(),
                *self.proposal_states.values(),
            ]
        )

        self.category = Category(category_name="Books")
        self.condition = Condition(condition_name="Good")
        self.owner = self._user("owner")
        self.interested = self._user("interested")
        self.other_interested = self._user("other")
        self.outsider = self._user("outsider")
        self.db.add_all([self.category, self.condition])
        self.db.flush()

        self.requested = self._listing(self.owner, "Requested")
        self.offered = self._listing(self.interested, "Offered")
        self.second_offer = self._listing(self.interested, "Second offer")
        self.other_offer = self._listing(self.other_interested, "Other offer")
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def _user(self, name: str) -> User:
        user = User(
            user_name=name,
            email=f"{name}@example.com",
            pass_hash=None,
            google_sub=None,
            avatar=None,
            user_location=None,
        )
        self.db.add(user)
        return user

    def _listing(self, owner: User, title: str) -> Listing:
        listing = Listing(
            user_id=owner.id,
            category_id=self.category.id,
            condition_id=self.condition.id,
            state_id=self.listing_states["Available"].id,
            title=title,
            listing_dsc=None,
            listing_location=None,
            wish=None,
        )
        self.db.add(listing)
        self.db.flush()
        return listing

    def _create_negotiation(
        self,
        interested: User | None = None,
        requested: Listing | None = None,
    ):
        return create_negotiation(
            NegotiationCreateIn(listing_id=(requested or self.requested).id),
            Response(),
            interested or self.interested,
            self.db,
        )

    def _create_proposal(
        self,
        negotiation_id: int,
        offered: Listing | None = None,
        interested: User | None = None,
    ):
        return create_proposal(
            ProposalCreateIn(
                offered_listing_id=offered.id if offered is not None else None
            ),
            negotiation_id,
            interested or self.interested,
            self.db,
        )

    def _state(self, model, row_id: int) -> str:
        return self.db.get(model, row_id).state.state_name

    def test_create_and_recover_unique_negotiation(self) -> None:
        response = Response()
        created = create_negotiation(
            NegotiationCreateIn(listing_id=self.requested.id),
            response,
            self.interested,
            self.db,
        )
        recovered_response = Response()
        recovered = create_negotiation(
            NegotiationCreateIn(listing_id=self.requested.id),
            recovered_response,
            self.interested,
            self.db,
        )

        self.assertEqual(recovered_response.status_code, 200)
        self.assertEqual(created.id, recovered.id)
        self.assertEqual(created.state.state_name, "Open")
        self.assertEqual(created.proposals, [])
        self.assertEqual(self.db.query(Negotiation).count(), 1)

    def test_cancelled_negotiation_cannot_be_reopened(self) -> None:
        negotiation = self._create_negotiation()
        cancel_negotiation(negotiation.id, self.interested, self.db)

        with self.assertRaises(HTTPException) as raised:
            self._create_negotiation()

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail,
            "A cancelled negotiation cannot be reopened.",
        )
        self.assertEqual(self.db.query(Negotiation).count(), 1)

    def test_create_rejects_own_or_unavailable_listing(self) -> None:
        with self.assertRaises(HTTPException) as own:
            self._create_negotiation(requested=self.offered)
        self.assertEqual(own.exception.status_code, 409)

        self.requested.state_id = self.listing_states["Removed"].id
        self.db.commit()
        with self.assertRaises(HTTPException) as unavailable:
            self._create_negotiation()
        self.assertEqual(unavailable.exception.status_code, 409)

    def test_list_filters_roles_states_and_paginates(self) -> None:
        first = self._create_negotiation()
        second = self._create_negotiation(interested=self.other_interested)
        second_row = self.db.get(Negotiation, second.id)
        second_row.negotiation_state_id = self.negotiation_states["Cancelled"].id
        self.db.commit()

        interested_page = list_negotiations(
            role="interested",
            state="Open",
            limit=20,
            offset=0,
            current_user=self.interested,
            db=self.db,
        )
        owner_page = list_negotiations(
            role="owner",
            state=None,
            limit=1,
            offset=1,
            current_user=self.owner,
            db=self.db,
        )

        self.assertEqual(interested_page.total, 1)
        self.assertEqual([item.id for item in interested_page.items], [first.id])
        self.assertEqual(owner_page.total, 2)
        self.assertEqual(owner_page.limit, 1)
        self.assertEqual(owner_page.offset, 1)
        self.assertEqual(len(owner_page.items), 1)

    def test_detail_is_restricted_to_participants(self) -> None:
        negotiation = self._create_negotiation()

        self.assertEqual(
            get_negotiation(negotiation.id, self.owner, self.db).id,
            negotiation.id,
        )
        with self.assertRaises(HTTPException) as raised:
            get_negotiation(negotiation.id, self.outsider, self.db)
        self.assertEqual(raised.exception.status_code, 403)

    def test_create_proposals_with_and_without_offered_listing(self) -> None:
        negotiation = self._create_negotiation()

        without_listing = self._create_proposal(negotiation.id)
        with_listing = self._create_proposal(negotiation.id, self.offered)

        self.assertIsNone(without_listing.offered_listing)
        self.assertEqual(without_listing.state.state_name, "Pending")
        self.assertEqual(with_listing.offered_listing.id, self.offered.id)
        self.assertEqual(with_listing.state.state_name, "Pending")

    def test_proposal_activity_updates_negotiation_timestamp(self) -> None:
        negotiation = self._create_negotiation()
        old_timestamp = datetime(2000, 1, 1)
        negotiation_row = self.db.get(Negotiation, negotiation.id)
        negotiation_row.updated_at = old_timestamp
        self.db.commit()

        proposal = self._create_proposal(negotiation.id, self.offered)
        self.db.refresh(negotiation_row)
        self.assertGreater(negotiation_row.updated_at, old_timestamp)

        negotiation_row.updated_at = old_timestamp
        self.db.commit()
        reject_proposal(proposal.id, self.owner, self.db)
        self.db.refresh(negotiation_row)
        self.assertGreater(negotiation_row.updated_at, old_timestamp)

        second = self._create_proposal(negotiation.id, self.second_offer)
        negotiation_row.updated_at = old_timestamp
        self.db.commit()
        withdraw_proposal(second.id, self.interested, self.db)
        self.db.refresh(negotiation_row)
        self.assertGreater(negotiation_row.updated_at, old_timestamp)

    def test_proposal_uniqueness_with_and_without_listing(self) -> None:
        negotiation = self._create_negotiation()
        self._create_proposal(negotiation.id)
        self._create_proposal(negotiation.id, self.offered)

        for offered in (None, self.offered):
            with self.assertRaises(HTTPException) as raised:
                self._create_proposal(negotiation.id, offered)
            self.assertEqual(raised.exception.status_code, 409)

    def test_create_proposal_validates_actor_owner_and_availability(self) -> None:
        negotiation = self._create_negotiation()

        with self.assertRaises(HTTPException) as actor:
            self._create_proposal(
                negotiation.id,
                self.other_offer,
                interested=self.other_interested,
            )
        self.assertEqual(actor.exception.status_code, 403)

        with self.assertRaises(HTTPException) as owner:
            self._create_proposal(negotiation.id, self.other_offer)
        self.assertEqual(owner.exception.status_code, 403)

        self.offered.state_id = self.listing_states["Removed"].id
        self.db.commit()
        with self.assertRaises(HTTPException) as unavailable:
            self._create_proposal(negotiation.id, self.offered)
        self.assertEqual(unavailable.exception.status_code, 409)

    def test_owner_accepts_proposal_and_reserves_listings(self) -> None:
        negotiation = self._create_negotiation()
        proposal = self._create_proposal(negotiation.id, self.offered)

        accepted = accept_proposal(proposal.id, self.owner, self.db)

        self.assertEqual(accepted.state.state_name, "Accepted")
        self.assertIsNotNone(accepted.responded_at)
        self.assertEqual(self._state(Negotiation, negotiation.id), "Agreed")
        self.assertEqual(self._state(Listing, self.requested.id), "Reserved")
        self.assertEqual(self._state(Listing, self.offered.id), "Reserved")

    def test_accept_without_offered_listing_reserves_only_requested(self) -> None:
        negotiation = self._create_negotiation()
        proposal = self._create_proposal(negotiation.id)

        accept_proposal(proposal.id, self.owner, self.db)

        self.assertEqual(self._state(Listing, self.requested.id), "Reserved")
        self.assertEqual(self._state(Listing, self.offered.id), "Available")

    def test_only_owner_can_accept_pending_proposal(self) -> None:
        negotiation = self._create_negotiation()
        proposal = self._create_proposal(negotiation.id, self.offered)

        with self.assertRaises(HTTPException) as actor:
            accept_proposal(proposal.id, self.interested, self.db)
        self.assertEqual(actor.exception.status_code, 403)

        reject_proposal(proposal.id, self.owner, self.db)
        with self.assertRaises(HTTPException) as state:
            accept_proposal(proposal.id, self.owner, self.db)
        self.assertEqual(state.exception.status_code, 409)

    def test_owner_rejects_and_interested_withdraws_pending_proposals(self) -> None:
        negotiation = self._create_negotiation()
        rejected = self._create_proposal(negotiation.id, self.offered)
        withdrawn = self._create_proposal(negotiation.id, self.second_offer)

        rejected_result = reject_proposal(rejected.id, self.owner, self.db)
        withdrawn_result = withdraw_proposal(
            withdrawn.id, self.interested, self.db
        )

        self.assertEqual(rejected_result.state.state_name, "Rejected")
        self.assertEqual(withdrawn_result.state.state_name, "Withdrawn")
        self.assertIsNotNone(rejected_result.responded_at)
        self.assertIsNotNone(withdrawn_result.responded_at)

    def test_reject_and_withdraw_enforce_roles(self) -> None:
        negotiation = self._create_negotiation()
        first = self._create_proposal(negotiation.id, self.offered)
        second = self._create_proposal(negotiation.id, self.second_offer)

        with self.assertRaises(HTTPException) as reject_actor:
            reject_proposal(first.id, self.interested, self.db)
        self.assertEqual(reject_actor.exception.status_code, 403)

        with self.assertRaises(HTTPException) as withdraw_actor:
            withdraw_proposal(second.id, self.owner, self.db)
        self.assertEqual(withdraw_actor.exception.status_code, 403)

    def test_interested_cancellation_withdraws_pending_proposals(self) -> None:
        negotiation = self._create_negotiation()
        first = self._create_proposal(negotiation.id, self.offered)
        second = self._create_proposal(negotiation.id, self.second_offer)

        cancelled = cancel_negotiation(
            negotiation.id, self.interested, self.db
        )

        self.assertEqual(cancelled.state.state_name, "Cancelled")
        self.assertEqual(cancelled.cancelled_by.id, self.interested.id)
        self.assertEqual(self._state(Proposal, first.id), "Withdrawn")
        self.assertEqual(self._state(Proposal, second.id), "Withdrawn")

    def test_owner_cancellation_rejects_pending_proposals(self) -> None:
        negotiation = self._create_negotiation()
        proposal = self._create_proposal(negotiation.id, self.offered)

        cancel_negotiation(negotiation.id, self.owner, self.db)

        self.assertEqual(self._state(Proposal, proposal.id), "Rejected")

    def test_cancel_agreed_negotiation_releases_reserved_listings(self) -> None:
        negotiation = self._create_negotiation()
        accepted = self._create_proposal(negotiation.id, self.offered)
        pending = self._create_proposal(negotiation.id, self.second_offer)
        accept_proposal(accepted.id, self.owner, self.db)

        cancel_negotiation(negotiation.id, self.owner, self.db)

        self.assertEqual(self._state(Negotiation, negotiation.id), "Cancelled")
        self.assertEqual(self._state(Proposal, accepted.id), "Accepted")
        self.assertEqual(self._state(Proposal, pending.id), "Rejected")
        self.assertEqual(self._state(Listing, self.requested.id), "Available")
        self.assertEqual(self._state(Listing, self.offered.id), "Available")

    def test_cancel_enforces_participant_and_open_or_agreed_state(self) -> None:
        negotiation = self._create_negotiation()

        with self.assertRaises(HTTPException) as actor:
            cancel_negotiation(negotiation.id, self.outsider, self.db)
        self.assertEqual(actor.exception.status_code, 403)

        cancel_negotiation(negotiation.id, self.interested, self.db)
        with self.assertRaises(HTTPException) as state:
            cancel_negotiation(negotiation.id, self.interested, self.db)
        self.assertEqual(state.exception.status_code, 409)

    def test_complete_marks_listings_traded_and_closes_alternatives(self) -> None:
        negotiation = self._create_negotiation()
        accepted = self._create_proposal(negotiation.id, self.offered)
        alternative = self._create_proposal(negotiation.id, self.second_offer)
        self.db.add_all(
            [
                Favorite(user_id=self.owner.id, listing_id=self.offered.id),
                Favorite(
                    user_id=self.other_interested.id,
                    listing_id=self.requested.id,
                ),
            ]
        )
        self.db.commit()
        accept_proposal(accepted.id, self.owner, self.db)

        completed = complete_negotiation(
            negotiation.id, self.interested, self.db
        )

        self.assertEqual(completed.state.state_name, "Completed")
        self.assertEqual(self._state(Proposal, accepted.id), "Accepted")
        self.assertEqual(self._state(Proposal, alternative.id), "NotSelected")
        self.assertEqual(self._state(Listing, self.requested.id), "Traded")
        self.assertEqual(self._state(Listing, self.offered.id), "Traded")
        self.assertEqual(self.db.query(Favorite).count(), 0)

    def test_complete_closes_competing_requested_listing_negotiation(self) -> None:
        selected = self._create_negotiation()
        accepted = self._create_proposal(selected.id, self.offered)
        competing = self._create_negotiation(
            interested=self.other_interested
        )
        competing_proposal = self._create_proposal(
            competing.id,
            self.other_offer,
            interested=self.other_interested,
        )
        accept_proposal(accepted.id, self.owner, self.db)

        complete_negotiation(selected.id, self.interested, self.db)

        self.assertEqual(self._state(Negotiation, competing.id), "Unavailable")
        self.assertEqual(
            self._state(Proposal, competing_proposal.id),
            "ItemUnavailable",
        )

    def test_complete_invalidates_proposals_offering_traded_listing(self) -> None:
        selected = self._create_negotiation()
        accepted = self._create_proposal(selected.id, self.offered)

        second_requested = self._listing(self.outsider, "Second requested")
        self.db.commit()
        other_negotiation = self._create_negotiation(
            requested=second_requested
        )
        other_proposal = self._create_proposal(
            other_negotiation.id,
            self.offered,
        )
        accept_proposal(accepted.id, self.owner, self.db)
        old_timestamp = datetime(2000, 1, 1)
        other_negotiation_row = self.db.get(Negotiation, other_negotiation.id)
        other_negotiation_row.updated_at = old_timestamp
        self.db.commit()

        complete_negotiation(selected.id, self.interested, self.db)

        self.assertEqual(
            self._state(Proposal, other_proposal.id),
            "ItemUnavailable",
        )
        self.assertEqual(
            self._state(Negotiation, other_negotiation.id),
            "Open",
        )
        self.db.refresh(other_negotiation_row)
        self.assertGreater(other_negotiation_row.updated_at, old_timestamp)

    def test_listing_removal_updates_offering_negotiation_timestamp(self) -> None:
        negotiation = self._create_negotiation()
        proposal = self._create_proposal(negotiation.id, self.offered)
        old_timestamp = datetime(2000, 1, 1)
        negotiation_row = self.db.get(Negotiation, negotiation.id)
        negotiation_row.updated_at = old_timestamp
        self.db.commit()

        delete_listing(self.offered.id, self.interested, self.db)

        self.assertEqual(self._state(Proposal, proposal.id), "ItemUnavailable")
        self.db.refresh(negotiation_row)
        self.assertEqual(self._state(Negotiation, negotiation.id), "Open")
        self.assertGreater(negotiation_row.updated_at, old_timestamp)

    def test_only_interested_can_complete_agreed_negotiation(self) -> None:
        negotiation = self._create_negotiation()
        proposal = self._create_proposal(negotiation.id, self.offered)

        with self.assertRaises(HTTPException) as state:
            complete_negotiation(negotiation.id, self.interested, self.db)
        self.assertEqual(state.exception.status_code, 409)

        accept_proposal(proposal.id, self.owner, self.db)
        with self.assertRaises(HTTPException) as actor:
            complete_negotiation(negotiation.id, self.owner, self.db)
        self.assertEqual(actor.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
