"""Behaviour tests for the trades service, using an isolated SQLite database."""

import unittest

from fastapi import HTTPException
from pydantic import ValidationError
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
    Message,
    Trade,
    TradeState,
    User,
)
from app.routers.trades import (
    accept_trade,
    cancel_trade,
    create_trade,
    get_trade,
    list_trades,
)
from app.schemas import TradeCreateIn


class TradesTestCase(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine, expire_on_commit=False)()

        self.available = ListingState(state_name="Available")
        self.removed = ListingState(state_name="Removed")
        self.db.add_all(
            [
                self.available,
                self.removed,
                ListingState(state_name="Expired"),
                TradeState(state_name="Open"),
                TradeState(state_name="Finished"),
                TradeState(state_name="Cancelled"),
            ]
        )
        self.category = Category(category_name="Books")
        self.condition = Condition(condition_name="Good")
        self.sender = self._user("sender")
        self.recipient = self._user("recipient")
        self.other_sender = self._user("other")
        self.db.add_all([self.category, self.condition])
        self.db.flush()

        self.requested = self._listing(self.recipient, "Requested")
        self.offered = self._listing(self.sender, "Offered")
        self.other_offer = self._listing(self.other_sender, "Other offer")
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
            state_id=self.available.id,
            title=title,
            listing_dsc=None,
            listing_location=None,
            wish=None,
        )
        self.db.add(listing)
        self.db.flush()
        return listing

    def _create(self, sender: User, offered: Listing | None = None):
        return create_trade(
            TradeCreateIn(
                listing_requested_id=self.requested.id,
                listing_offered_id=offered.id if offered else None,
                initial_msg="  Interested in a swap  ",
            ),
            sender,
            self.db,
        )

    def test_create_stores_trade_and_first_message(self) -> None:
        result = self._create(self.sender, self.offered)

        trade = self.db.get(Trade, result.id)
        messages = self.db.query(Message).filter(Message.trade_id == result.id).all()
        self.assertEqual(trade.initial_msg, "Interested in a swap")
        self.assertEqual(result.state.state_name, "Open")
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].msg, trade.initial_msg)

    def test_create_rejects_own_requested_listing(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            create_trade(
                TradeCreateIn(
                    listing_requested_id=self.offered.id,
                    initial_msg="Mine",
                ),
                self.sender,
                self.db,
            )
        self.assertEqual(raised.exception.status_code, 400)

    def test_create_without_offered_listing(self) -> None:
        result = self._create(self.sender)

        self.assertIsNone(result.offered_listing)
        self.assertEqual(result.initial_msg, "Interested in a swap")

    def test_create_rejects_identical_open_trade_without_offer(self) -> None:
        self._create(self.sender)

        with self.assertRaises(HTTPException) as raised:
            self._create(self.sender)

        self.assertEqual(raised.exception.status_code, 409)

    def test_create_rejects_identical_open_trade_with_same_offer(self) -> None:
        self._create(self.sender, self.offered)

        with self.assertRaises(HTTPException) as raised:
            self._create(self.sender, self.offered)

        self.assertEqual(raised.exception.status_code, 409)

    def test_create_allows_different_offers_for_same_listing(self) -> None:
        second_offer = self._listing(self.sender, "Second offer")
        self.db.commit()

        first = self._create(self.sender, self.offered)
        second = self._create(self.sender, second_offer)

        self.assertNotEqual(first.id, second.id)
        self.assertEqual(first.state.state_name, "Open")
        self.assertEqual(second.state.state_name, "Open")

    def test_trade_schema_rejects_blank_message(self) -> None:
        with self.assertRaises(ValidationError):
            TradeCreateIn(
                listing_requested_id=self.requested.id,
                initial_msg="   ",
            )

    def test_trade_schema_rejects_same_requested_and_offered_listing(self) -> None:
        with self.assertRaises(ValidationError):
            TradeCreateIn(
                listing_requested_id=self.requested.id,
                listing_offered_id=self.requested.id,
                initial_msg="Interested",
            )

    def test_create_rejects_unavailable_requested_listing(self) -> None:
        self.requested.state_id = self.removed.id
        self.db.commit()

        with self.assertRaises(HTTPException) as raised:
            self._create(self.sender, self.offered)

        self.assertEqual(raised.exception.status_code, 409)

    def test_list_filters_and_paginates_trades(self) -> None:
        sent_trade = self._create(self.sender, self.offered)
        other_trade = self._create(self.other_sender, self.other_offer)

        sent_page = list_trades(
            trade_type="sent",
            limit=20,
            offset=0,
            current_user=self.sender,
            db=self.db,
        )
        received_page = list_trades(
            trade_type="received",
            limit=1,
            offset=1,
            current_user=self.recipient,
            db=self.db,
        )

        self.assertEqual(sent_page.total, 1)
        self.assertEqual([item.id for item in sent_page.items], [sent_trade.id])
        self.assertEqual(received_page.total, 2)
        self.assertEqual(received_page.limit, 1)
        self.assertEqual(received_page.offset, 1)
        self.assertEqual(len(received_page.items), 1)
        self.assertIn(received_page.items[0].id, {sent_trade.id, other_trade.id})

    def test_trade_detail_is_restricted_to_participants(self) -> None:
        trade = self._create(self.sender, self.offered)

        detail = get_trade(trade.id, self.recipient, self.db)
        self.assertEqual(detail.id, trade.id)

        with self.assertRaises(HTTPException) as raised:
            get_trade(trade.id, self.other_sender, self.db)

        self.assertEqual(raised.exception.status_code, 403)

    def test_accept_finishes_trade_and_cancels_competing_trade(self) -> None:
        accepted = self._create(self.sender, self.offered)
        competing = self._create(self.other_sender, self.other_offer)
        self.db.add(
            Favorite(user_id=self.other_sender.id, listing_id=self.requested.id)
        )
        self.db.commit()

        result = accept_trade(accepted.id, self.recipient, self.db)

        self.assertEqual(result.state.state_name, "Finished")
        self.assertEqual(
            self.db.get(Trade, competing.id).state.state_name,
            "Cancelled",
        )
        self.assertEqual(self.db.get(Listing, self.requested.id).state_id, self.removed.id)
        self.assertEqual(self.db.get(Listing, self.offered.id).state_id, self.removed.id)
        self.assertEqual(self.db.query(Favorite).count(), 0)

    def test_only_recipient_can_accept(self) -> None:
        trade = self._create(self.sender, self.offered)
        with self.assertRaises(HTTPException) as raised:
            accept_trade(trade.id, self.sender, self.db)
        self.assertEqual(raised.exception.status_code, 403)

    def test_sender_can_cancel_and_list_sent_trade(self) -> None:
        trade = self._create(self.sender)

        cancelled = cancel_trade(trade.id, self.sender, self.db)
        sent = list_trades(
            trade_type="sent",
            limit=20,
            offset=0,
            current_user=self.sender,
            db=self.db,
        )

        self.assertEqual(cancelled.state.state_name, "Cancelled")
        self.assertEqual([item.id for item in sent.items], [trade.id])

    def test_recipient_can_reject_trade(self) -> None:
        trade = self._create(self.sender, self.offered)

        cancelled = cancel_trade(trade.id, self.recipient, self.db)

        self.assertEqual(cancelled.state.state_name, "Cancelled")

    def test_closed_trade_cannot_be_cancelled_again(self) -> None:
        trade = self._create(self.sender)
        cancel_trade(trade.id, self.sender, self.db)

        with self.assertRaises(HTTPException) as raised:
            cancel_trade(trade.id, self.sender, self.db)

        self.assertEqual(raised.exception.status_code, 409)

    def test_cancelled_trade_cannot_be_accepted(self) -> None:
        trade = self._create(self.sender, self.offered)
        cancel_trade(trade.id, self.sender, self.db)

        with self.assertRaises(HTTPException) as raised:
            accept_trade(trade.id, self.recipient, self.db)

        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
