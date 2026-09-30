"""Listing routes: browsing, creating and managing marketplace listings.

Mounted under /listings by app/main.py.

The routes in this module define the public API contract for listings.
Business logic will be added incrementally; for now, the handlers only
define the expected paths, dependencies and response schemas.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
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
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Category listing is not implemented yet.",
    )


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
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Condition listing is not implemented yet.",
    )


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
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Listing creation is not implemented yet.",
    )


@router.patch(
    "/{id}",
    response_model=ListingDetailOut,
    summary="Update a listing",
)
def update_listing(
    id: int,
    payload: ListingUpdateIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListingDetailOut:
    """Update an existing listing owned by the logged-in user.

    The ownership check and database update will be implemented later.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Listing update is not implemented yet.",
    )


@router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete or archive a listing",
)
def delete_listing(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete or archive a listing owned by the logged-in user.

    The final behaviour (hard delete or archive) will be decided when the
    listing business logic is implemented.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Listing deletion is not implemented yet.",
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
