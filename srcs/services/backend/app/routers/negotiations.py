"""REST routes for negotiations and their proposals."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    Favorite,
    Listing,
    ListingState,
    Negotiation,
    NegotiationState,
    Proposal,
    ProposalState,
    User,
)
from app.schemas import (
    DEFAULT_NEGOTIATIONS_PAGE_SIZE,
    MAX_NEGOTIATIONS_PAGE_SIZE,
    MAX_PAGE_OFFSET,
    ListingDetailOut,
    ListingSummaryOut,
    NegotiationCreateIn,
    NegotiationDetailOut,
    NegotiationPageOut,
    NegotiationStateOut,
    NegotiationSummaryOut,
    ProposalCreateIn,
    ProposalOut,
    ProposalStateOut,
    PublicUserOut,
)
from app.security import utcnow

router = APIRouter()


def _listing_state(db: Session, name: str) -> ListingState:
    state = db.query(ListingState).filter(ListingState.state_name == name).first()
    if state is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Listing states are not configured.",
        )
    return state


def _negotiation_state(db: Session, name: str) -> NegotiationState:
    state = (
        db.query(NegotiationState)
        .filter(NegotiationState.state_name == name)
        .first()
    )
    if state is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Negotiation states are not configured.",
        )
    return state


def _proposal_state(db: Session, name: str) -> ProposalState:
    state = db.query(ProposalState).filter(ProposalState.state_name == name).first()
    if state is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Proposal states are not configured.",
        )
    return state


def _negotiation_options():
    proposal_listing = selectinload(Negotiation.proposals).joinedload(
        Proposal.offered_listing
    )
    return (
        joinedload(Negotiation.requested_listing).joinedload(Listing.owner),
        joinedload(Negotiation.requested_listing).joinedload(Listing.category),
        joinedload(Negotiation.requested_listing).joinedload(Listing.condition),
        joinedload(Negotiation.requested_listing).selectinload(Listing.images),
        joinedload(Negotiation.interested_user),
        joinedload(Negotiation.state),
        joinedload(Negotiation.cancelled_by),
        selectinload(Negotiation.proposals).joinedload(Proposal.state),
        proposal_listing.joinedload(Listing.owner),
        proposal_listing.joinedload(Listing.category),
        proposal_listing.joinedload(Listing.condition),
        proposal_listing.selectinload(Listing.images),
    )


def _load_negotiation(db: Session, negotiation_id: int) -> Negotiation:
    negotiation = (
        db.query(Negotiation)
        .options(*_negotiation_options())
        .filter(Negotiation.id == negotiation_id)
        .first()
    )
    if negotiation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Negotiation not found.",
        )
    return negotiation


def _load_proposal(db: Session, proposal_id: int) -> Proposal:
    proposal = (
        db.query(Proposal)
        .options(
            joinedload(Proposal.state),
            joinedload(Proposal.offered_listing).joinedload(Listing.owner),
            joinedload(Proposal.offered_listing).joinedload(Listing.category),
            joinedload(Proposal.offered_listing).joinedload(Listing.condition),
            joinedload(Proposal.offered_listing).selectinload(Listing.images),
        )
        .filter(Proposal.id == proposal_id)
        .first()
    )
    if proposal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proposal not found.",
        )
    return proposal


def _proposal_out(proposal: Proposal) -> ProposalOut:
    return ProposalOut(
        id=proposal.id,
        offered_listing=(
            ListingSummaryOut.model_validate(proposal.offered_listing)
            if proposal.offered_listing is not None
            else None
        ),
        state=ProposalStateOut.model_validate(proposal.state),
        created_at=proposal.created_at,
        responded_at=proposal.responded_at,
    )


def _active_proposal(negotiation: Negotiation) -> Proposal | None:
    accepted = [
        proposal
        for proposal in negotiation.proposals
        if proposal.state.state_name == "Accepted"
    ]
    if accepted:
        return max(accepted, key=lambda proposal: (proposal.created_at, proposal.id))

    pending = [
        proposal
        for proposal in negotiation.proposals
        if proposal.state.state_name == "Pending"
    ]
    return (
        max(pending, key=lambda proposal: (proposal.created_at, proposal.id))
        if pending
        else None
    )


def _negotiation_detail(negotiation: Negotiation) -> NegotiationDetailOut:
    return NegotiationDetailOut(
        id=negotiation.id,
        requested_listing=ListingDetailOut.model_validate(
            negotiation.requested_listing
        ),
        owner=PublicUserOut.model_validate(negotiation.requested_listing.owner),
        interested_user=PublicUserOut.model_validate(negotiation.interested_user),
        state=NegotiationStateOut.model_validate(negotiation.state),
        proposals=[_proposal_out(proposal) for proposal in negotiation.proposals],
        cancelled_by=(
            PublicUserOut.model_validate(negotiation.cancelled_by)
            if negotiation.cancelled_by is not None
            else None
        ),
        cancelled_at=negotiation.cancelled_at,
        created_at=negotiation.created_at,
        updated_at=negotiation.updated_at,
    )


def _negotiation_summary(
    negotiation: Negotiation, current_user_id: int
) -> NegotiationSummaryOut:
    active = _active_proposal(negotiation)
    other_participant = (
        negotiation.requested_listing.owner
        if negotiation.interested_user_id == current_user_id
        else negotiation.interested_user
    )
    return NegotiationSummaryOut(
        id=negotiation.id,
        requested_listing=ListingSummaryOut.model_validate(
            negotiation.requested_listing
        ),
        other_participant=PublicUserOut.model_validate(other_participant),
        state=NegotiationStateOut.model_validate(negotiation.state),
        active_proposal=_proposal_out(active) if active is not None else None,
        created_at=negotiation.created_at,
        updated_at=negotiation.updated_at,
    )


def _require_participant(negotiation: Negotiation, user_id: int) -> None:
    if (
        negotiation.interested_user_id != user_id
        and negotiation.requested_listing.user_id != user_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only negotiation participants may access this negotiation.",
        )


@router.post(
    "/negotiations",
    response_model=NegotiationDetailOut,
    status_code=status.HTTP_201_CREATED,
    tags=["negotiations"],
    summary="Create or recover a negotiation",
)
def create_negotiation(
    payload: NegotiationCreateIn,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NegotiationDetailOut:
    user_id = current_user.id
    db.rollback()

    # Discover the owner without retaining a snapshot, then lock both
    # participants in global ID order before negotiations and listings. Account
    # deletion locks its user row first, so it cannot miss a negotiation created
    # concurrently for either participant.
    requested_candidate = db.get(Listing, payload.listing_id)
    if requested_candidate is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )
    owner_id = requested_candidate.user_id
    db.rollback()
    participant_ids = sorted({owner_id, user_id})
    participants = (
        db.query(User)
        .filter(User.id.in_(participant_ids))
        .order_by(User.id)
        .populate_existing()
        .with_for_update()
        .all()
    )
    participants_by_id = {
        participant.id: participant for participant in participants
    }
    listing_owner = participants_by_id.get(owner_id)
    interested_user = participants_by_id.get(user_id)
    if listing_owner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing owner not found.",
        )
    if (
        listing_owner.deleted_at is not None
        or interested_user is None
        or interested_user.deleted_at is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Negotiation participants must have active accounts.",
        )

    # Continue in the shared lock order: negotiations before listings.
    existing = (
        db.query(Negotiation)
        .filter(
            Negotiation.listing_id == payload.listing_id,
            Negotiation.interested_user_id == user_id,
        )
        .with_for_update()
        .first()
    )
    if existing is not None:
        cancelled = _negotiation_state(db, "Cancelled")
        if existing.negotiation_state_id == cancelled.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A cancelled negotiation cannot be reopened.",
            )
        negotiation_id = existing.id
        db.commit()
        response.status_code = status.HTTP_200_OK
        return _negotiation_detail(_load_negotiation(db, negotiation_id))

    requested = db.get(Listing, payload.listing_id, with_for_update=True)
    if requested is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )
    if requested.user_id == user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot negotiate your own listing.",
        )

    available = _listing_state(db, "Available")
    if requested.state_id != available.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Listing is not available.",
        )

    negotiation = Negotiation(
        listing_id=requested.id,
        interested_user_id=user_id,
        negotiation_state_id=_negotiation_state(db, "Open").id,
    )
    db.add(negotiation)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        existing = (
            db.query(Negotiation)
            .filter(
                Negotiation.listing_id == requested.id,
                Negotiation.interested_user_id == user_id,
            )
            .first()
        )
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Negotiation could not be created.",
            ) from exc
        response.status_code = status.HTTP_200_OK
        return _negotiation_detail(_load_negotiation(db, existing.id))

    return _negotiation_detail(_load_negotiation(db, negotiation.id))


@router.get(
    "/negotiations",
    response_model=NegotiationPageOut,
    tags=["negotiations"],
    summary="List my negotiations",
)
def list_negotiations(
    role: Literal["owner", "interested"] | None = Query(default=None),
    state: Literal[
        "Open", "Agreed", "Completed", "Cancelled", "Unavailable"
    ]
    | None = Query(default=None),
    limit: int = Query(
        default=DEFAULT_NEGOTIATIONS_PAGE_SIZE,
        ge=1,
        le=MAX_NEGOTIATIONS_PAGE_SIZE,
    ),
    offset: int = Query(default=0, ge=0, le=MAX_PAGE_OFFSET),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NegotiationPageOut:
    query = db.query(Negotiation).join(Negotiation.requested_listing)
    if role == "owner":
        query = query.filter(Listing.user_id == current_user.id)
    elif role == "interested":
        query = query.filter(Negotiation.interested_user_id == current_user.id)
    else:
        query = query.filter(
            or_(
                Listing.user_id == current_user.id,
                Negotiation.interested_user_id == current_user.id,
            )
        )

    if state is not None:
        query = query.join(Negotiation.state).filter(
            NegotiationState.state_name == state
        )

    total = query.count()
    negotiations = (
        query.options(*_negotiation_options())
        .order_by(Negotiation.updated_at.desc(), Negotiation.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return NegotiationPageOut(
        items=[
            _negotiation_summary(negotiation, current_user.id)
            for negotiation in negotiations
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/negotiations/{negotiation_id}",
    response_model=NegotiationDetailOut,
    tags=["negotiations"],
    summary="Get a negotiation",
)
def get_negotiation(
    negotiation_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NegotiationDetailOut:
    negotiation = _load_negotiation(db, negotiation_id)
    _require_participant(negotiation, current_user.id)
    return _negotiation_detail(negotiation)


@router.post(
    "/negotiations/{negotiation_id}/proposals",
    response_model=ProposalOut,
    status_code=status.HTTP_201_CREATED,
    tags=["proposals"],
    summary="Create a proposal",
)
def create_proposal(
    payload: ProposalCreateIn,
    negotiation_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProposalOut:
    user_id = current_user.id
    db.rollback()
    negotiation = db.get(Negotiation, negotiation_id, with_for_update=True)
    if negotiation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Negotiation not found.",
        )
    if negotiation.interested_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the interested user may create proposals.",
        )
    if negotiation.negotiation_state_id != _negotiation_state(db, "Open").id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Proposals can only be created in an open negotiation.",
        )

    offered = None
    if payload.offered_listing_id is not None:
        if payload.offered_listing_id == negotiation.listing_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Requested and offered listings must be different.",
            )
        offered = db.get(
            Listing, payload.offered_listing_id, with_for_update=True
        )
        if offered is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Offered listing not found.",
            )
        if offered.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You may only offer one of your own listings.",
            )
        if offered.state_id != _listing_state(db, "Available").id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Offered listing is not available.",
            )

    proposal = Proposal(
        negotiation_id=negotiation.id,
        offered_listing_id=offered.id if offered is not None else None,
        proposal_state_id=_proposal_state(db, "Pending").id,
    )
    db.add(proposal)
    negotiation.updated_at = utcnow()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An identical proposal already exists in this negotiation.",
        ) from exc
    return _proposal_out(_load_proposal(db, proposal.id))


def _lock_proposal_and_negotiation(
    db: Session, proposal_id: int
) -> tuple[Proposal, Negotiation]:
    candidate = db.get(Proposal, proposal_id)
    if candidate is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proposal not found.",
        )
    negotiation_id = candidate.negotiation_id
    db.rollback()

    negotiation = db.get(Negotiation, negotiation_id, with_for_update=True)
    proposal = db.get(
        Proposal, proposal_id, with_for_update=True, populate_existing=True
    )
    if negotiation is None or proposal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proposal not found.",
        )
    return proposal, negotiation


@router.patch(
    "/proposals/{proposal_id}/accept",
    response_model=ProposalOut,
    tags=["proposals"],
    summary="Accept a proposal",
)
def accept_proposal(
    proposal_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProposalOut:
    user_id = current_user.id
    db.rollback()
    proposal, negotiation = _lock_proposal_and_negotiation(db, proposal_id)
    requested = db.get(Listing, negotiation.listing_id)
    if requested is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Requested listing no longer exists.",
        )
    if requested.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the requested listing owner may accept a proposal.",
        )

    open_state = _negotiation_state(db, "Open")
    pending_state = _proposal_state(db, "Pending")
    if (
        negotiation.negotiation_state_id != open_state.id
        or proposal.proposal_state_id != pending_state.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a pending proposal in an open negotiation may be accepted.",
        )

    listing_ids = [negotiation.listing_id]
    if proposal.offered_listing_id is not None:
        listing_ids.append(proposal.offered_listing_id)
    listings = (
        db.query(Listing)
        .filter(Listing.id.in_(listing_ids))
        .order_by(Listing.id)
        .populate_existing()
        .with_for_update()
        .all()
    )
    listings_by_id = {listing.id: listing for listing in listings}
    requested = listings_by_id.get(negotiation.listing_id)
    offered = (
        listings_by_id.get(proposal.offered_listing_id)
        if proposal.offered_listing_id is not None
        else None
    )
    if requested is None or (
        proposal.offered_listing_id is not None and offered is None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A listing in this proposal no longer exists.",
        )
    available = _listing_state(db, "Available")
    if requested.state_id != available.id or (
        offered is not None and offered.state_id != available.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A listing in this proposal is no longer available.",
        )

    reserved = _listing_state(db, "Reserved")
    requested.state_id = reserved.id
    if offered is not None:
        offered.state_id = reserved.id
    proposal.proposal_state_id = _proposal_state(db, "Accepted").id
    proposal.responded_at = utcnow()
    negotiation.negotiation_state_id = _negotiation_state(db, "Agreed").id
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Proposal could not be accepted because related data changed.",
        ) from exc
    return _proposal_out(_load_proposal(db, proposal.id))


def _close_pending_proposal(
    proposal_id: int,
    current_user: User,
    db: Session,
    *,
    action: Literal["reject", "withdraw"],
) -> ProposalOut:
    user_id = current_user.id
    db.rollback()
    proposal, negotiation = _lock_proposal_and_negotiation(db, proposal_id)
    requested = db.get(Listing, negotiation.listing_id)
    if requested is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Requested listing no longer exists.",
        )

    if action == "reject" and requested.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the requested listing owner may reject a proposal.",
        )
    if action == "withdraw" and negotiation.interested_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the interested user may withdraw a proposal.",
        )
    if (
        negotiation.negotiation_state_id != _negotiation_state(db, "Open").id
        or proposal.proposal_state_id != _proposal_state(db, "Pending").id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a pending proposal in an open negotiation may be changed.",
        )

    now = utcnow()
    proposal.proposal_state_id = _proposal_state(
        db, "Rejected" if action == "reject" else "Withdrawn"
    ).id
    proposal.responded_at = now
    negotiation.updated_at = now
    db.commit()
    return _proposal_out(_load_proposal(db, proposal.id))


@router.patch(
    "/proposals/{proposal_id}/reject",
    response_model=ProposalOut,
    tags=["proposals"],
    summary="Reject a proposal",
)
def reject_proposal(
    proposal_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProposalOut:
    return _close_pending_proposal(
        proposal_id, current_user, db, action="reject"
    )


@router.patch(
    "/proposals/{proposal_id}/withdraw",
    response_model=ProposalOut,
    tags=["proposals"],
    summary="Withdraw a proposal",
)
def withdraw_proposal(
    proposal_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProposalOut:
    return _close_pending_proposal(
        proposal_id, current_user, db, action="withdraw"
    )


@router.patch(
    "/negotiations/{negotiation_id}/cancel",
    response_model=NegotiationDetailOut,
    tags=["negotiations"],
    summary="Cancel a negotiation",
)
def cancel_negotiation(
    negotiation_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NegotiationDetailOut:
    user_id = current_user.id
    db.rollback()
    negotiation = db.get(Negotiation, negotiation_id, with_for_update=True)
    if negotiation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Negotiation not found.",
        )
    requested = db.get(Listing, negotiation.listing_id)
    if requested is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Requested listing no longer exists.",
        )
    is_interested = negotiation.interested_user_id == user_id
    is_owner = requested.user_id == user_id
    if not is_interested and not is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only negotiation participants may cancel this negotiation.",
        )

    open_state = _negotiation_state(db, "Open")
    agreed_state = _negotiation_state(db, "Agreed")
    if negotiation.negotiation_state_id not in (open_state.id, agreed_state.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an open or agreed negotiation may be cancelled.",
        )

    proposals = (
        db.query(Proposal)
        .filter(Proposal.negotiation_id == negotiation.id)
        .with_for_update()
        .all()
    )
    pending_id = _proposal_state(db, "Pending").id
    accepted_id = _proposal_state(db, "Accepted").id
    now = utcnow()
    for proposal in proposals:
        if proposal.proposal_state_id == pending_id:
            proposal.proposal_state_id = _proposal_state(
                db, "Withdrawn" if is_interested else "Rejected"
            ).id
            proposal.responded_at = now

    if negotiation.negotiation_state_id == agreed_state.id:
        accepted = [
            proposal
            for proposal in proposals
            if proposal.proposal_state_id == accepted_id
        ]
        if len(accepted) != 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Agreed negotiation does not have exactly one accepted "
                    "proposal."
                ),
            )
        listing_ids = [negotiation.listing_id]
        if accepted[0].offered_listing_id is not None:
            listing_ids.append(accepted[0].offered_listing_id)
        reserved = _listing_state(db, "Reserved")
        available = _listing_state(db, "Available")
        locked_listings = (
            db.query(Listing)
            .filter(Listing.id.in_(listing_ids))
            .order_by(Listing.id)
            .with_for_update()
            .all()
        )
        if len(locked_listings) != len(set(listing_ids)) or any(
            listing.state_id != reserved.id for listing in locked_listings
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Reserved listings are inconsistent with this agreement.",
            )
        for listing in locked_listings:
            listing.state_id = available.id

    negotiation.negotiation_state_id = _negotiation_state(db, "Cancelled").id
    negotiation.cancelled_by_user_id = user_id
    negotiation.cancelled_at = now
    db.commit()
    return _negotiation_detail(_load_negotiation(db, negotiation.id))


@router.patch(
    "/negotiations/{negotiation_id}/complete",
    response_model=NegotiationDetailOut,
    tags=["negotiations"],
    summary="Complete a negotiation",
)
def complete_negotiation(
    negotiation_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NegotiationDetailOut:
    user_id = current_user.id
    db.rollback()

    # Discover the complete lock set without retaining any locks, then acquire
    # every affected negotiation and proposal in global ID order.  In
    # particular, this includes pending proposals in *other* negotiations that
    # offer either listing in this agreement.
    candidate = db.get(Negotiation, negotiation_id)
    if candidate is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Negotiation not found.",
        )
    if candidate.interested_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the interested user may complete this negotiation.",
        )
    agreed_id = _negotiation_state(db, "Agreed").id
    if candidate.negotiation_state_id != agreed_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an agreed negotiation may be completed.",
        )
    accepted_id = _proposal_state(db, "Accepted").id
    accepted_candidate = (
        db.query(Proposal)
        .filter(
            Proposal.negotiation_id == negotiation_id,
            Proposal.proposal_state_id == accepted_id,
        )
        .one_or_none()
    )
    if accepted_candidate is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Agreed negotiation does not have exactly one accepted proposal.",
        )
    involved_listing_ids = [candidate.listing_id]
    if accepted_candidate.offered_listing_id is not None:
        involved_listing_ids.append(accepted_candidate.offered_listing_id)

    listing_owner_rows = (
        db.query(Listing.id, Listing.user_id)
        .filter(Listing.id.in_(involved_listing_ids))
        .all()
    )
    if len(listing_owner_rows) != len(set(involved_listing_ids)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An agreement listing no longer exists.",
        )
    listing_owner_ids = sorted(
        {owner_id for _listing_id, owner_id in listing_owner_rows}
    )

    pending_id = _proposal_state(db, "Pending").id
    db.rollback()

    # Negotiation creation locks listing owners before negotiations. Completion
    # follows the same order, then discovers the affected negotiation set again
    # while those owners are locked so no new competing row can be missed.
    locked_owners = (
        db.query(User)
        .filter(User.id.in_(listing_owner_ids))
        .order_by(User.id)
        .populate_existing()
        .with_for_update()
        .all()
    )
    if len(locked_owners) != len(listing_owner_ids) or any(
        owner.deleted_at is not None for owner in locked_owners
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An agreement listing owner is no longer active.",
        )

    offering_negotiation_ids = db.query(Proposal.negotiation_id).filter(
        Proposal.offered_listing_id.in_(involved_listing_ids),
        Proposal.proposal_state_id == pending_id,
    )
    affected_negotiation_ids = [
        affected_id
        for (affected_id,) in db.query(Negotiation.id)
        .filter(
            or_(
                Negotiation.id == negotiation_id,
                Negotiation.listing_id.in_(involved_listing_ids),
                Negotiation.id.in_(offering_negotiation_ids),
            )
        )
        .order_by(Negotiation.id)
        .all()
    ]

    locked_negotiations = (
        db.query(Negotiation)
        .filter(Negotiation.id.in_(affected_negotiation_ids))
        .order_by(Negotiation.id)
        .with_for_update()
        .all()
    )
    negotiations_by_id = {
        locked_negotiation.id: locked_negotiation
        for locked_negotiation in locked_negotiations
    }
    negotiation = negotiations_by_id.get(negotiation_id)
    if negotiation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Negotiation not found.",
        )
    proposals = (
        db.query(Proposal)
        .filter(Proposal.negotiation_id.in_(affected_negotiation_ids))
        .order_by(Proposal.id)
        .with_for_update()
        .all()
    )
    accepted = [
        proposal
        for proposal in proposals
        if proposal.negotiation_id == negotiation_id
        and proposal.proposal_state_id == accepted_id
    ]
    if (
        negotiation.interested_user_id != user_id
        or negotiation.negotiation_state_id != agreed_id
        or len(accepted) != 1
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Agreement changed while completion was being prepared.",
        )
    locked_listing_ids = [negotiation.listing_id]
    if accepted[0].offered_listing_id is not None:
        locked_listing_ids.append(accepted[0].offered_listing_id)
    if set(locked_listing_ids) != set(involved_listing_ids):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Agreement changed while completion was being prepared.",
        )
    locked_listings = (
        db.query(Listing)
        .filter(Listing.id.in_(involved_listing_ids))
        .order_by(Listing.id)
        .with_for_update()
        .all()
    )
    reserved = _listing_state(db, "Reserved")
    if len(locked_listings) != len(set(involved_listing_ids)) or any(
        listing.state_id != reserved.id for listing in locked_listings
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reserved listings are inconsistent with this agreement.",
        )

    now = utcnow()
    automatically_changed_negotiation_ids = sorted(
        {
            proposal.negotiation_id
            for proposal in proposals
            if proposal.negotiation_id != negotiation.id
            and proposal.offered_listing_id in involved_listing_ids
            and proposal.proposal_state_id == pending_id
        }
    )
    db.query(Proposal).filter(
        Proposal.negotiation_id == negotiation.id,
        Proposal.proposal_state_id == pending_id,
    ).update(
        {
            Proposal.proposal_state_id: _proposal_state(db, "NotSelected").id,
            Proposal.responded_at: now,
        },
        synchronize_session=False,
    )

    open_id = _negotiation_state(db, "Open").id
    competing_ids = [
        locked_negotiation.id
        for locked_negotiation in locked_negotiations
        if locked_negotiation.id != negotiation.id
        and locked_negotiation.listing_id in involved_listing_ids
        and locked_negotiation.negotiation_state_id == open_id
    ]
    if competing_ids:
        db.query(Proposal).filter(
            Proposal.negotiation_id.in_(competing_ids),
            Proposal.proposal_state_id == pending_id,
        ).update(
            {
                Proposal.proposal_state_id: _proposal_state(
                    db, "ItemUnavailable"
                ).id,
                Proposal.responded_at: now,
            },
            synchronize_session=False,
        )
        db.query(Negotiation).filter(Negotiation.id.in_(competing_ids)).update(
            {
                Negotiation.negotiation_state_id: _negotiation_state(
                    db, "Unavailable"
                ).id,
                Negotiation.updated_at: now,
            },
            synchronize_session=False,
        )

    db.query(Proposal).filter(
        Proposal.negotiation_id != negotiation.id,
        Proposal.offered_listing_id.in_(involved_listing_ids),
        Proposal.proposal_state_id == pending_id,
    ).update(
        {
            Proposal.proposal_state_id: _proposal_state(
                db, "ItemUnavailable"
            ).id,
            Proposal.responded_at: now,
        },
        synchronize_session=False,
    )
    if automatically_changed_negotiation_ids:
        db.query(Negotiation).filter(
            Negotiation.id.in_(automatically_changed_negotiation_ids)
        ).update(
            {Negotiation.updated_at: now},
            synchronize_session=False,
        )

    traded = _listing_state(db, "Traded")
    for listing in locked_listings:
        listing.state_id = traded.id
    negotiation.negotiation_state_id = _negotiation_state(db, "Completed").id
    db.query(Favorite).filter(
        Favorite.listing_id.in_(involved_listing_ids)
    ).delete(synchronize_session=False)
    db.commit()
    return _negotiation_detail(_load_negotiation(db, negotiation.id))
