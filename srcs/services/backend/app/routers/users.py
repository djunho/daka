"""Routes for viewing other active users."""
from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Listing, ListingState, User
from app.schemas import ListingSummaryOut, PublicProfileOut

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/{user_id}",
    response_model=PublicProfileOut,
    summary="View another active user's public profile",
)
def get_public_profile(
    user_id: int = Path(gt=0, description="The user identifier."),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PublicProfileOut:
    """Return a logged-in user's name and currently available listings."""
    user = (
        db.query(User)
        .filter(
            User.id == user_id,
            User.deleted_at.is_(None),
        )
        .first()
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    listings = (
        db.query(Listing)
        .join(Listing.state)
        .options(
            joinedload(Listing.owner),
            joinedload(Listing.category),
            joinedload(Listing.condition),
            selectinload(Listing.images),
        )
        .filter(
            Listing.user_id == user_id,
            ListingState.state_name == "Available",
        )
        .order_by(Listing.created_at.desc(), Listing.id.desc())
        .all()
    )

    return PublicProfileOut(
        id=user.id,
        user_name=user.user_name,
        avatar=user.avatar,
        listings=[ListingSummaryOut.model_validate(listing) for listing in listings],
    )