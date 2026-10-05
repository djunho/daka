"""Listing routes: browsing, creating and managing marketplace listings.

Mounted under /listings by app/main.py.

The routes in this module define the public API contract for listings.
Business logic will be added incrementally; for now, the handlers only
define the expected paths, dependencies and response schemas.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    Category,
    Condition,
    Favorite,
    Image,
    Listing,
    ListingState,
    Message,
    Report,
    Trade,
    User,
)
from app.schemas import (
    CategoryOut,
    ConditionOut,
    ListingCreateIn,
    ListingDetailOut,
    ListingSummaryOut,
    ListingUpdateIn,
)

router = APIRouter(prefix="/listings", tags=["listings"])


# ---------------------------------------------------------------------------
# Browsing and lookup data
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=list[ListingSummaryOut],
    summary="List and search listings",
)
def list_listings(
    q: str | None = Query(
        default=None,
        description="Search listings by text.",
    ),
    category_id: int | None = Query(
        default=None,
        description="Filter listings by category.",
    ),
    location: str | None = Query(
        default=None,
        description="Filter listings by location.",
    ),
    limit: int = Query(
        default=20,
        ge=1,
        le=100,
        description="Maximum number of listings to return.",
    ),
    offset: int = Query(
        default=0,
        ge=0,
        description="Number of listings to skip for pagination.",
    ),
    db: Session = Depends(get_db),
) -> list[ListingSummaryOut]:
    """Return a paginated list of listings.

    The optional query parameters are intended to support the frontend's
    search, filtering and pagination controls.

    Business logic and database queries will be implemented later.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Listing search is not implemented yet.",
    )


@router.get(
    "/categories",
    response_model=list[CategoryOut],
    summary="List available listing categories",
)
def list_categories(
    db: Session = Depends(get_db),
) -> list[CategoryOut]:
    """Return the categories available for listings.

    The frontend can use this endpoint to populate category filters and
    selection controls when creating or searching listings.
    """
    return db.query(Category).order_by(Category.category_name).all()


@router.get(
    "/conditions",
    response_model=list[ConditionOut],
    summary="List available listing conditions",
)
def list_conditions(
    db: Session = Depends(get_db),
) -> list[ConditionOut]:
    """Return the conditions available for listings.

    The frontend can use this endpoint to populate condition filters and
    selection controls when creating or editing a listing.
    """
    return db.query(Condition).order_by(Condition.id).all()


@router.get(
    "/favorites",
    response_model=list[ListingSummaryOut],
    summary="List the current user's favorite listings",
)
def list_favorites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ListingSummaryOut]:
    """Return listings saved as favorites by the logged-in user.

    Authentication is required. The current user is obtained from the session
    cookie through the get_current_user dependency.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Favorite listings are not implemented yet.",
    )


# ---------------------------------------------------------------------------
# Individual listings
# ---------------------------------------------------------------------------

@router.get(
    "/{id}",
    response_model=ListingDetailOut,
    summary="Get a listing by ID",
)
def get_listing(
    id: int,
    db: Session = Depends(get_db),
) -> ListingDetailOut:
    """Return the complete details of a listing.

    The detailed response includes the listing description, images and whether
    the listing is favorited by the current user when that information is
    available.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Listing retrieval is not implemented yet.",
    )


@router.post(
    "",
    response_model=ListingDetailOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new listing",
)
def create_listing(
    payload: ListingCreateIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListingDetailOut:
    """Create a new listing owned by the logged-in user.

    Authentication is required. The request body is validated by
    ListingCreateIn before this function is called.
    """
    # IDs are valid positive integers after Pydantic validation, but only the
    # database can tell whether they refer to a category/condition that exists.
    category = db.get(Category, payload.category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The selected category does not exist.",
        )

    condition = db.get(Condition, payload.condition_id)
    if condition is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The selected condition does not exist.",
        )

    # State is server-owned: a client must never be able to publish an ad as
    # Removed or Expired just by choosing a different state_id in the request.
    available_state = (
        db.query(ListingState)
        .filter(ListingState.state_name == "Available")
        .first()
    )
    if available_state is None:
        # This is a deployment/configuration problem (the required seed row is
        # missing), rather than invalid input from the user.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Listing states are not configured.",
        )

    listing = Listing(
        user_id=current_user.id,
        category_id=category.id,
        condition_id=condition.id,
        state_id=available_state.id,
        title=payload.title,
        listing_dsc=payload.listing_dsc,
        listing_location=payload.listing_location,
        wish=payload.wish,
    )
    db.add(listing)
    db.commit()

    # Re-read with the relationships required by ListingDetailOut. This keeps
    # the endpoint independent of SQLAlchemy's lazy-loading configuration.
    created_listing = (
        db.query(Listing)
        .options(
            joinedload(Listing.owner),
            joinedload(Listing.category),
            joinedload(Listing.condition),
            selectinload(Listing.images),
        )
        .filter(Listing.id == listing.id)
        .one()
    )
    return created_listing


@router.patch(
    "/{id}",
    response_model=ListingDetailOut,
    summary="Update a listing",
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Not authenticated."},
        status.HTTP_403_FORBIDDEN: {"description": "Not allowed to edit this listing."},
        status.HTTP_404_NOT_FOUND: {"description": "Listing not found."},
    },
)
def update_listing(
    id: int,
    payload: ListingUpdateIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListingDetailOut:
    """Update one or more editable fields of the logged-in user's listing."""
    listing = db.get(Listing, id)
    if listing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )

    if listing.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own listings.",
        )

    changes = payload.model_dump(exclude_unset=True)

    # The client may choose a new ID, but the database remains the authority
    # on whether that category/condition is an available lookup value.
    if "category_id" in changes and db.get(Category, changes["category_id"]) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The selected category does not exist.",
        )
    if "condition_id" in changes and db.get(Condition, changes["condition_id"]) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The selected condition does not exist.",
        )

    for field_name, value in changes.items():
        setattr(listing, field_name, value)
    db.commit()

    updated_listing = (
        db.query(Listing)
        .options(
            joinedload(Listing.owner),
            joinedload(Listing.category),
            joinedload(Listing.condition),
            selectinload(Listing.images),
        )
        .filter(Listing.id == listing.id)
        .one()
    )
    return updated_listing


@router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a listing",
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Not authenticated."},
        status.HTTP_403_FORBIDDEN: {
            "description": "Not allowed to delete this listing."
        },
        status.HTTP_404_NOT_FOUND: {"description": "Listing not found."},
    },
)
def delete_listing(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Permanently delete one of the logged-in user's listings.

    A listing can participate in trades and be favorited, reported, or have
    images. Those child rows must be removed before the listing itself, or
    MariaDB correctly rejects the deletion because of its foreign keys.
    """
    listing = db.get(Listing, id)
    if listing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )

    if listing.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own listings.",
        )

    # A trade can reference the listing either as what someone requested or
    # what they offered. Its messages depend on that trade and come first.
    trade_ids = [
        trade_id
        for (trade_id,) in (
            db.query(Trade.id)
            .filter(
                or_(
                    Trade.listing_requested_id == listing.id,
                    Trade.listing_offered_id == listing.id,
                )
            )
            .all()
        )
    ]

    try:
        db.query(Message).filter(Message.trade_id.in_(trade_ids)).delete(
            synchronize_session=False
        )
        (
            db.query(Report)
            .filter(Report.reported_listings_id == listing.id)
            .delete(synchronize_session=False)
        )
        db.query(Favorite).filter(Favorite.listing_id == listing.id).delete(
            synchronize_session=False
        )
        db.query(Trade).filter(Trade.id.in_(trade_ids)).delete(
            synchronize_session=False
        )
        db.query(Image).filter(Image.listing_id == listing.id).delete(
            synchronize_session=False
        )
        db.delete(listing)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Listing could not be deleted because related data remains.",
        )


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------

@router.post(
    "/{id}/favorite",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Add a listing to the current user's favorites",
)
def add_favorite(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Favorite a listing for the logged-in user.

    Authentication is required. The relationship between the user and the
    listing will be created by the business logic implemented later.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Adding favorites is not implemented yet.",
    )


@router.delete(
    "/{id}/favorite",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a listing from the current user's favorites",
)
def remove_favorite(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Remove a listing from the logged-in user's favorites.

    Authentication is required. The favorite relationship will be removed by
    the business logic implemented later.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Removing favorites is not implemented yet.",
    )
