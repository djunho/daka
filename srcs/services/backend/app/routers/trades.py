"""Trade proposal routes.

This first delivery defines the HTTP contract. The business logic will be
implemented in the next feature branch.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager, joinedload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    Favorite,
    Listing,
    ListingState,
    Message,
    Trade,
    TradeState,
    User,
)
from app.schemas import (
    DEFAULT_TRADES_PAGE_SIZE,
    MAX_TRADES_PAGE_SIZE,
    ListingDetailOut,
    ListingSummaryOut,
    PublicUserOut,
    TradeCreateIn,
    TradeDetailOut,
    TradePageOut,
    TradeStateOut,
    TradeSummaryOut,
)

router = APIRouter(prefix="/trades", tags=["trades"])

def _trade_state(db: Session, name: str) -> TradeState:
    trade_state = (
        db.query(TradeState)
        .filter(TradeState.state_name == name)
        .first()
    )
    if trade_state is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Trade states are not configured.",
        )
    return trade_state


def _available_listing_state(db: Session) -> ListingState:
    listing_state = (
        db.query(ListingState)
        .filter(ListingState.state_name == "Available")
        .first()
    )
    if listing_state is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Listing states are not configured.",
        )
    return listing_state

def _removed_listing_state(db: Session) -> ListingState:
    listing_state = (
        db.query(ListingState)
        .filter(ListingState.state_name == "Removed")
        .first()
    )
    if listing_state is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Listing states are not configured.",
        )
    return listing_state

def _load_trade(db: Session, trade_id: int) -> Trade:
    trade = (
        db.query(Trade)
        .options(
            joinedload(Trade.requested_listing).joinedload(Listing.owner),
            joinedload(Trade.requested_listing).joinedload(Listing.category),
            joinedload(Trade.requested_listing).joinedload(Listing.condition),
            joinedload(Trade.requested_listing).selectinload(Listing.images),
            joinedload(Trade.offered_listing).joinedload(Listing.owner),
            joinedload(Trade.offered_listing).joinedload(Listing.category),
            joinedload(Trade.offered_listing).joinedload(Listing.condition),
            joinedload(Trade.offered_listing).selectinload(Listing.images),
            joinedload(Trade.sender),
            joinedload(Trade.state),
        )
        .filter(Trade.id == trade_id)
        .first()
    )

    if trade is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade not found.",
        )

    return trade


def _trade_detail(trade: Trade) -> TradeDetailOut:
    return TradeDetailOut(
        id=trade.id,
        requested_listing=ListingDetailOut.model_validate(
            trade.requested_listing
        ),
        offered_listing=(
            ListingDetailOut.model_validate(trade.offered_listing)
            if trade.offered_listing is not None
            else None
        ),
        sender=PublicUserOut.model_validate(trade.sender),
        recipient=PublicUserOut.model_validate(
            trade.requested_listing.owner
        ),
        state=TradeStateOut.model_validate(trade.state),
        initial_msg=trade.initial_msg,
        created_at=trade.created_at,
        updated_at=trade.updated_at,
    )

def _trade_summary(trade: Trade) -> TradeSummaryOut:
    return TradeSummaryOut(
        id=trade.id,
        requested_listing=ListingSummaryOut.model_validate(
            trade.requested_listing
        ),
        offered_listing=(
            ListingSummaryOut.model_validate(trade.offered_listing)
            if trade.offered_listing is not None
            else None
        ),
        sender=PublicUserOut.model_validate(trade.sender),
        recipient=PublicUserOut.model_validate(
            trade.requested_listing.owner
        ),
        state=TradeStateOut.model_validate(trade.state),
        created_at=trade.created_at,
        updated_at=trade.updated_at,
    )


def _require_participant(trade: Trade, user_id: int) -> None:
    recipient_id = trade.requested_listing.user_id

    if trade.sender_id != user_id and recipient_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only trade participants may access this trade.",
        )

@router.post(
    "",
    response_model=TradeDetailOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a trade proposal",
)
def create_trade(
    payload: TradeCreateIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeDetailOut:
    message = payload.initial_msg

    available_state = _available_listing_state(db)
    open_state = _trade_state(db, "Open")

    listing_ids = [payload.listing_requested_id]

    if payload.listing_offered_id is not None:
        listing_ids.append(payload.listing_offered_id)

    listing_ids.sort()

    locked_listings = db.scalars(
        select(Listing)
        .where(Listing.id.in_(listing_ids))
        .order_by(Listing.id.asc())
        .with_for_update()
    ).all()

    listings_by_id = {
        listing.id: listing
        for listing in locked_listings
    }

    requested = listings_by_id.get(payload.listing_requested_id)

    offered = (
        listings_by_id.get(payload.listing_offered_id)
        if payload.listing_offered_id is not None
        else None
    )

    if requested is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Requested listing not found.",
        )

    if requested.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot propose a trade for your own listing.",
        )

    if requested.state_id != available_state.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Requested listing is not available.",
        )

    if payload.listing_offered_id is not None:
        if offered is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Offered listing not found.",
            )

        if offered.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You may only offer one of your own listings.",
            )

        if offered.state_id != available_state.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Offered listing is not available.",
            )

    existing_open_trade_query = db.query(Trade).filter(
        Trade.sender_id == current_user.id,
        Trade.listing_requested_id == requested.id,
        Trade.trade_state_id == open_state.id,
    )

    if offered is None:
        existing_open_trade_query = existing_open_trade_query.filter(
            Trade.listing_offered_id.is_(None)
        )
    else:
        existing_open_trade_query = existing_open_trade_query.filter(
            Trade.listing_offered_id == offered.id
        )

    existing_open_trade = existing_open_trade_query.with_for_update().first()
    if existing_open_trade is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have an identical open trade proposal.",
        )

    trade = Trade(
        listing_requested_id=requested.id,
        sender_id=current_user.id,
        listing_offered_id=offered.id if offered is not None else None,
        trade_state_id=open_state.id,
        initial_msg=message,
    )

    db.add(trade)

    try:
        # flush envia o Trade para a base sem concluir a transação.
        # Precisamos disso para obter trade.id antes de criar Message.
        db.flush()

        first_message = Message(
            trade_id=trade.id,
            msg_sender=current_user.id,
            msg=message,
        )
        db.add(first_message)

        # Trade e Message são confirmados na mesma transação.
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Trade could not be created because related data changed.",
        ) from exc

    return _trade_detail(_load_trade(db, trade.id))


@router.get("", response_model=TradePageOut, summary="List my trades")
def list_trades(
    trade_type: Literal["received", "sent"] | None = Query(
        default=None,
        alias="type",
    ),
    limit: int = Query(
        default=DEFAULT_TRADES_PAGE_SIZE,
        ge=1,
        le=MAX_TRADES_PAGE_SIZE,
        description="Maximum number of trades to return.",
    ),
    offset: int = Query(
        default=0,
        ge=0,
        description="Number of trades to skip for pagination.",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradePageOut:
    query = (
        db.query(Trade)
        .join(Trade.requested_listing)
        .options(
            contains_eager(Trade.requested_listing).joinedload(Listing.owner),
            contains_eager(Trade.requested_listing).joinedload(Listing.category),
            contains_eager(Trade.requested_listing).joinedload(Listing.condition),
            contains_eager(Trade.requested_listing).selectinload(Listing.images),
            joinedload(Trade.offered_listing).joinedload(Listing.owner),
            joinedload(Trade.offered_listing).joinedload(Listing.category),
            joinedload(Trade.offered_listing).joinedload(Listing.condition),
            joinedload(Trade.offered_listing).selectinload(Listing.images),
            joinedload(Trade.sender),
            joinedload(Trade.state),
        )
    )

    if trade_type == "received":
        query = query.filter(Listing.user_id == current_user.id)
    elif trade_type == "sent":
        query = query.filter(Trade.sender_id == current_user.id)
    else:
        query = query.filter(
            or_(
                Trade.sender_id == current_user.id,
                Listing.user_id == current_user.id,
            )
        )

    total = query.count()
    trades = (
        query.order_by(Trade.updated_at.desc(), Trade.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return TradePageOut(
        items=[_trade_summary(trade) for trade in trades],
        total=total,
        limit=limit,
        offset=offset,
    )

@router.get(
    "/{id}", response_model=TradeDetailOut, summary="Get one trade proposal"
)
def get_trade(
    id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeDetailOut:
    trade = _load_trade(db, id)
    _require_participant(trade, current_user.id)
    return _trade_detail(trade)

@router.patch(
    "/{id}/accept",
    response_model=TradeDetailOut,
    summary="Accept an open trade proposal",
)
def accept_trade(
    id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeDetailOut:
    user_id = current_user.id

    # get_current_user já realizou consultas. O rollback termina essa transação
    # de leitura antes de começarmos a adquirir locks.
    db.rollback()

    candidate = db.get(Trade, id)
    if candidate is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade not found.",
        )

    candidate_requested = db.get(Listing, candidate.listing_requested_id)
    if candidate_requested is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Requested listing no longer exists.",
        )

    if candidate_requested.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the requested listing owner may accept this trade.",
        )

    open_state_id = _trade_state(db, "Open").id
    if candidate.trade_state_id != open_state_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an open trade may be accepted.",
        )

    listing_ids = [candidate.listing_requested_id]
    if candidate.listing_offered_id is not None:
        listing_ids.append(candidate.listing_offered_id)

    # Termina a transação de leitura iniciada por candidate.
    # Os IDs necessários já estão guardados em listing_ids.
    db.rollback()

    locked_listings = (
        db.query(Listing)
        .filter(Listing.id.in_(listing_ids))
        .order_by(Listing.id)
        .with_for_update()
        .all()
    )
    listings_by_id = {
        listing.id: listing
        for listing in locked_listings
    }

    trade = db.get(
        Trade,
        id,
        with_for_update=True,
        populate_existing=True,
    )

    if trade is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade not found.",
        )

    requested = listings_by_id.get(trade.listing_requested_id)

    offered = (
        listings_by_id.get(trade.listing_offered_id)
        if trade.listing_offered_id is not None
        else None
    )

    if requested is None or (
        trade.listing_offered_id is not None and offered is None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A listing in this trade no longer exists.",
        )

    if requested.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the requested listing owner may accept this trade.",
        )

    open_state = _trade_state(db, "Open")
    finished_state = _trade_state(db, "Finished")
    cancelled_state = _trade_state(db, "Cancelled")
    available_state = _available_listing_state(db)
    removed_state = _removed_listing_state(db)

    if trade.trade_state_id != open_state.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an open trade may be accepted.",
        )

    if requested.state_id != available_state.id or (
        offered is not None and offered.state_id != available_state.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A listing in this trade is no longer available.",
        )

    involved_listing_ids = [requested.id]
    requested.state_id = removed_state.id

    if offered is not None:
        involved_listing_ids.append(offered.id)
        offered.state_id = removed_state.id

    trade.trade_state_id = finished_state.id

    # Anúncios removidos da vitrine também deixam de ser favoritos.
    db.query(Favorite).filter(
        Favorite.listing_id.in_(involved_listing_ids)
    ).delete(synchronize_session=False)

    # Cancela todas as outras propostas abertas que utilizavam qualquer um
    # dos anúncios envolvidos na troca concluída.
    db.query(Trade).filter(
        Trade.id != trade.id,
        Trade.trade_state_id == open_state.id,
        or_(
            Trade.listing_requested_id.in_(involved_listing_ids),
            Trade.listing_offered_id.in_(involved_listing_ids),
        ),
    ).update(
        {Trade.trade_state_id: cancelled_state.id},
        synchronize_session=False,
    )

    db.commit()

    return _trade_detail(_load_trade(db, trade.id))

@router.patch(
    "/{id}/cancel",
    response_model=TradeDetailOut,
    summary="Cancel or reject an open trade proposal",
)
def cancel_trade(
    id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeDetailOut:
    user_id = current_user.id
    db.rollback()

    candidate = db.get(Trade, id)
    if candidate is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade not found.",
        )

    candidate_requested = db.get(Listing, candidate.listing_requested_id)
    if candidate_requested is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Requested listing no longer exists.",
        )

    is_sender = candidate.sender_id == user_id
    is_recipient = candidate_requested.user_id == user_id

    if not is_sender and not is_recipient:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only trade participants may cancel this trade.",
        )

    open_state_id = _trade_state(db, "Open").id
    if candidate.trade_state_id != open_state_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an open trade may be cancelled.",
        )

    db.rollback()

    trade = db.get(
        Trade,
        id,
        with_for_update=True,
        populate_existing=True,
    )
    if trade is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade not found.",
        )

    open_state = _trade_state(db, "Open")
    cancelled_state = _trade_state(db, "Cancelled")

    if trade.trade_state_id != open_state.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an open trade may be cancelled.",
        )

    trade.trade_state_id = cancelled_state.id
    db.commit()

    return _trade_detail(_load_trade(db, trade.id))
