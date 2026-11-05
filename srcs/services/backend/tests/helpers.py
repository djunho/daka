"""Shared database fixtures for backend tests."""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import ListingState, NegotiationState, ProposalState


def make_memory_session() -> tuple[
    Session,
    dict[str, ListingState],
    dict[str, NegotiationState],
    dict[str, ProposalState],
]:
    """Create an isolated SQLite session with all seeded lookup states."""
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()

    listing_states = {
        name: ListingState(state_name=name)
        for name in ("Available", "Reserved", "Traded", "Expired", "Removed")
    }
    negotiation_states = {
        name: NegotiationState(state_name=name)
        for name in ("Open", "Agreed", "Completed", "Cancelled", "Unavailable")
    }
    proposal_states = {
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
    db.add_all(
        [
            *listing_states.values(),
            *negotiation_states.values(),
            *proposal_states.values(),
        ]
    )
    db.commit()
    return db, listing_states, negotiation_states, proposal_states
