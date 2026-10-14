"""Trade proposal routes.

This first delivery defines the HTTP contract. The business logic will be
implemented in the next feature branch.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Listing, ListingState, Message, Trade, TradeState, User
from app.schemas import (
    ListingDetailOut,
    ListingSummaryOut,
    PublicUserOut,
    TradeCreateIn,
    TradeDetailOut,
    TradeStateOut,
    TradeSummaryOut,
)

router = APIRouter(prefix="/trades", tags=["trades"])


def _not_implemented() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Trade endpoints are not implemented yet.",
    )

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
    message = payload.initial_msg.strip()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Initial message must contain visible characters.",
        )

    if payload.listing_offered_id == payload.listing_requested_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Requested and offered listings must be different.",
        )

    available_state = _available_listing_state(db)
    open_state = _trade_state(db, "Open")

    requested = db.get(
        Listing,
        payload.listing_requested_id,
        with_for_update=True,
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

    offered = None

    if payload.listing_offered_id is not None:
        offered = db.get(
            Listing,
            payload.listing_offered_id,
            with_for_update=True,
        )

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


@router.get("", response_model=list[TradeSummaryOut], summary="List my trades")
def list_trades(
    trade_type: Literal["received", "sent"] | None = Query(
        default=None,
        alias="type",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TradeSummaryOut]:
    query = (
        db.query(Trade)
        .join(Trade.requested_listing)
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

    trades = (
        query
        .order_by(Trade.created_at.desc(), Trade.id.desc())
        .all()
    )

    return [_trade_summary(trade) for trade in trades]

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
    raise _not_implemented()


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
    raise _not_implemented()
