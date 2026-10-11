"""Listing routes for browsing, creating and managing marketplace listings.

Mounted under /listings by app/main.py.

The module exposes public listing browsing and lookup endpoints, as well as
authenticated endpoints for owners to create, update and remove listings.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    Category,
    Condition,
    Favorite,
    Listing,
    ListingState,
    Trade,
    TradeState,
    User,
)
from app.schemas import (
    LISTINGS_PAGE_SIZE,
    MAX_LISTINGS_PAGE_SIZE,
    CategoryOut,
    ConditionOut,
    ListingCreateIn,
    ListingDetailOut,
    ListingPageOut,
    ListingUpdateIn,
)

router = APIRouter(prefix="/listings", tags=["listings"])


# ---------------------------------------------------------------------------
# Browsing and lookup data
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=ListingPageOut,
    summary="List and search listings",
)
def list_listings(
    q: str | None = Query(
        default=None,
        max_length=150,
        description="Search available listings by title.",
    ),
    category_id: int | None = Query(
        default=None,
        gt=0,
        description="Filter listings by category.",
    ),
    user_id: int | None = Query(
        default=None,
        gt=0,
        description="Filter listings by owner.",
    ),
    location: str | None = Query(
        default=None,
        max_length=100,
        description="Filter listings by location.",
    ),
    limit: int = Query(
        default=LISTINGS_PAGE_SIZE,
        ge=1,
        le=MAX_LISTINGS_PAGE_SIZE,
        description="Maximum number of listings to return.",
    ),
    offset: int = Query(
        default=0,
        ge=0,
        description="Number of listings to skip for pagination.",
    ),
    db: Session = Depends(get_db),
) -> ListingPageOut:
    """Return one page of public listings, ordered from newest to oldest.

    Every optional filter is combined with AND. Removed and Expired listings
    are never visible here.
    """
    listings = (
        db.query(Listing)
        .join(Listing.state)
        .options(
            joinedload(Listing.owner),
            joinedload(Listing.category),
            joinedload(Listing.condition),
        )
        .filter(ListingState.state_name == "Available")
    )

    if category_id is not None:
        listings = listings.filter(Listing.category_id == category_id)
    if user_id is not None:
        listings = listings.filter(Listing.user_id == user_id)
    if q is not None and (search := q.strip()):
        listings = listings.filter(
            Listing.title.icontains(search, autoescape=True))
    if location is not None and (place := location.strip()):
        listings = listings.filter(
            Listing.listing_location.icontains(place, autoescape=True))
    total = listings.count()
    items = (
        listings.order_by(Listing.created_at.desc(), Listing.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return ListingPageOut(items=items, total=total, limit=limit, offset=offset)


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
    response_model=ListingPageOut,
    summary="List the current user's favorite listings",
)
def list_favorites(
    limit: int = Query(
        default=LISTINGS_PAGE_SIZE,
        ge=1,
        le=MAX_LISTINGS_PAGE_SIZE,
        description="Maximum number of listings to return.",
    ),
    offset: int = Query(
        default=0,
        ge=0,
        description="Number of favorite listings to skip for pagination.",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListingPageOut:
    """Return listings saved as favorites by the logged-in user.

    Authentication is required. The current user is obtained from the session
    cookie through the get_current_user dependency.
    """
    favorites = (
        db.query(Listing)
        .join(Favorite, Favorite.listing_id == Listing.id)
        .join(Listing.state)
        .options(
            joinedload(Listing.owner),
            joinedload(Listing.category),
            joinedload(Listing.condition),
        )
        .filter(
            Favorite.user_id == current_user.id,
            ListingState.state_name == "Available",
        )
    )
    total = favorites.count()
    items = (
        favorites
        .order_by(Listing.created_at.desc(), Listing.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return ListingPageOut(items=items, total=total, limit=limit, offset=offset)


# ---------------------------------------------------------------------------
# Individual listings
# ---------------------------------------------------------------------------

@router.get(
    "/{id}",
    response_model=ListingDetailOut,
    summary="Get a listing by ID",
)
def get_listing(
    id: int = Path(gt=0, description="The listing identifier."),
    db: Session = Depends(get_db),
) -> ListingDetailOut:
    """Return the complete details of one available listing.

    Removed and Expired listings deliberately behave as not found so a public
    request cannot reveal data that should no longer be visible.
    """
    listing = (
        db.query(Listing)
        .join(Listing.state)
        .options(
            joinedload(Listing.owner),
            joinedload(Listing.category),
            joinedload(Listing.condition),
            selectinload(Listing.images),
        )
        .filter(
            Listing.id == id,
            ListingState.state_name == "Available",
        )
        .first()
    )
    if listing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )
    return listing


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
    listing = db.get(Listing, id, with_for_update=True)
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

    if listing.state.state_name == "Removed":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
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
    summary="Remove a listing from public view",
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
    """Soft-delete one of the logged-in user's listings.

    The listing and its history remain in the database for moderation and
    completed trades. Open trades are cancelled because the offer is no longer
    available, and favorites are removed because they only apply to public
    listings.
    """
    listing = db.get(Listing, id, with_for_update=True)
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

    removed = (
        db.query(ListingState)
        .filter(ListingState.state_name == "Removed")
        .first()
    )
    open_trade = (
        db.query(TradeState).filter(TradeState.state_name == "Open").first()
    )
    cancelled_trade = (
        db.query(TradeState)
        .filter(TradeState.state_name == "Cancelled")
        .first()
    )
    if removed is None or open_trade is None or cancelled_trade is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Listing or trade states are not configured.",
        )

    if listing.state_id == removed.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )

    listing.state_id = removed.id
    db.query(Trade).filter(
        or_(
            Trade.listing_requested_id == listing.id,
            Trade.listing_offered_id == listing.id,
        ),
        Trade.trade_state_id == open_trade.id,
    ).update({Trade.trade_state_id: cancelled_trade.id}, synchronize_session=False)
    db.query(Favorite).filter(Favorite.listing_id == listing.id).delete(
        synchronize_session=False
    )
    db.commit()


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------

@router.post(
    "/{id}/favorite",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Add a listing to the current user's favorites",
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Not authenticated."},
        status.HTTP_404_NOT_FOUND: {"description": "Listing not found."},
        status.HTTP_409_CONFLICT: {
            "description": (
                "The listing is already favorited or belongs to the current user."
            )
        },
    },
)
def add_favorite(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Favorite a listing for the logged-in user.

    Only an available listing can be saved. Trying to save the same listing
    twice returns a conflict instead of relying on the database constraint to
    produce a server error. Trying to favorite your own listing is not allowed.
    """
    listing = (
        db.query(Listing)
        .join(Listing.state)
        .filter(
            Listing.id == id,
            ListingState.state_name == "Available",
        )
        .first()
    )
    if listing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )
    if listing.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot favorite your own listing.",
        )

    favorite_key = (current_user.id, listing.id)
    if db.get(Favorite, favorite_key) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Listing is already in your favorites.",
        )

    db.add(Favorite(user_id=current_user.id, listing_id=listing.id))
    try:
        db.commit()
    except IntegrityError:
        # The composite primary key also protects against two concurrent
        # requests that both pass the check above.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Listing is already in your favorites.",
        ) from None


@router.delete(
    "/{id}/favorite",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a listing from the current user's favorites",
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Not authenticated."},
        status.HTTP_404_NOT_FOUND: {"description": "Favorite not found."},
    },
)
def remove_favorite(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Remove a listing from the logged-in user's favorites.

    Authentication is required. Only the current user's relationship is
    considered, so one user can never remove another user's favorite.
    """
    favorite = db.get(Favorite, (current_user.id, id), with_for_update=True)

    if favorite is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Favorite not found.",
        )

    db.delete(favorite)
    db.commit()
