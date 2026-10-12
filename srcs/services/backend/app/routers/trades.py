"""Trade proposal routes.

This first delivery defines the HTTP contract. The business logic will be
implemented in the next feature branch.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import TradeCreateIn, TradeDetailOut, TradeSummaryOut

router = APIRouter(prefix="/trades", tags=["trades"])


def _not_implemented() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Trade endpoints are not implemented yet.",
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
    raise _not_implemented()


@router.get("", response_model=list[TradeSummaryOut], summary="List my trades")
def list_trades(
    trade_type: Literal["received", "sent"] | None = Query(default=None, alias="type"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TradeSummaryOut]:
    raise _not_implemented()


@router.get(
    "/{id}", response_model=TradeDetailOut, summary="Get one trade proposal"
)
def get_trade(
    id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeDetailOut:
    raise _not_implemented()


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
