"""Listing routes for browsing, creating and managing marketplace listings.

Mounted under /listings by app/main.py.

The module exposes public listing browsing and lookup endpoints, as well as
authenticated endpoints for owners to create, update and remove listings.
"""

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Path,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.media import delete_image, save_image
from app.models import (
    Category,
    Condition,
    Favorite,
    Image,
    Listing,
    ListingState,
    Negotiation,
    NegotiationState,
    Proposal,
    ProposalState,
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

# How many photos one listing may have. Each upload is a separate request, so
# this also bounds the disk space a single listing can take (6 x ~2 MB).
MAX_IMAGES_PER_LISTING = 6
# Longest edge, in pixels, of a stored listing photo. The detail page shows
# photos much larger than avatars, so they keep more resolution than
# AVATAR_MAX_SIDE, while full-size phone photos are still scaled down.
LISTING_IMAGE_MAX_SIDE = 1600


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
            # Needed for cover_image on every card of the page.
            selectinload(Listing.images),
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
            selectinload(Listing.images),
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

    return _load_listing_detail(db, listing.id)


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

    if listing.state.state_name != "Available":
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

    return _load_listing_detail(db, listing.id)


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
        status.HTTP_409_CONFLICT: {
            "description": "Reserved or traded listings cannot be removed."
        },
    },
)
def delete_listing(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Soft-delete one of the logged-in user's listings.

    The listing and its history remain in the database for moderation. Open
    negotiations requesting it become unavailable, while pending proposals
    offering it become unavailable individually. Favorites are removed because
    they only apply to public listings.
    """
    user_id = current_user.id
    db.rollback()
    # Resolve lookup ids before starting the transaction that acquires row locks.
    listing_states = {
        state_name: state_id
        for state_name, state_id in db.query(
            ListingState.state_name, ListingState.id
        )
        .filter(ListingState.state_name.in_(("Removed", "Reserved", "Traded")))
        .all()
    }
    negotiation_states = {
        state_name: state_id
        for state_name, state_id in db.query(
            NegotiationState.state_name, NegotiationState.id
        )
        .filter(NegotiationState.state_name.in_(("Open", "Unavailable")))
        .all()
    }
    proposal_states = {
        state_name: state_id
        for state_name, state_id in db.query(
            ProposalState.state_name, ProposalState.id
        )
        .filter(ProposalState.state_name.in_(("Pending", "ItemUnavailable")))
        .all()
    }
    if (
        len(listing_states) != 3
        or len(negotiation_states) != 2
        or len(proposal_states) != 2
    ):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Listing, negotiation, or proposal states are not configured.",
        )

    db.rollback()
    # Match the negotiation lifecycle lock order: negotiations, proposals,
    # then listings.  A listing can participate either as the requested item
    # or as an offered item, so both relationships must be locked.
    offering_negotiation_ids_query = db.query(Proposal.negotiation_id).filter(
        Proposal.offered_listing_id == id,
        Proposal.proposal_state_id == proposal_states["Pending"],
    )
    requested_negotiation_ids = [
        negotiation_id
        for (negotiation_id,) in db.query(Negotiation.id)
        .filter(
            Negotiation.negotiation_state_id == negotiation_states["Open"],
            Negotiation.listing_id == id,
        )
        .all()
    ]
    offering_negotiation_ids = [
        negotiation_id
        for (negotiation_id,) in db.query(Negotiation.id)
        .filter(
            Negotiation.negotiation_state_id == negotiation_states["Open"],
            Negotiation.id.in_(offering_negotiation_ids_query),
        )
        .all()
    ]
    locked_negotiation_ids = sorted(
        set(requested_negotiation_ids) | set(offering_negotiation_ids)
    )
    if locked_negotiation_ids:
        (
            db.query(Negotiation)
            .filter(Negotiation.id.in_(locked_negotiation_ids))
            .order_by(Negotiation.id)
            .with_for_update()
            .all()
        )
        (
            db.query(Proposal)
            .filter(Proposal.negotiation_id.in_(locked_negotiation_ids))
            .order_by(Proposal.id)
            .with_for_update()
            .all()
        )

    listing = db.get(Listing, id, with_for_update=True)
    if listing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )

    if listing.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own listings.",
        )

    if listing.state_id == listing_states["Removed"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )

    if listing.state_id in {
        listing_states["Reserved"],
        listing_states["Traded"],
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reserved or traded listings cannot be removed.",
        )

    if requested_negotiation_ids:
        db.query(Proposal).filter(
            Proposal.negotiation_id.in_(requested_negotiation_ids),
            Proposal.proposal_state_id == proposal_states["Pending"],
        ).update(
            {
                Proposal.proposal_state_id: proposal_states["ItemUnavailable"],
                Proposal.responded_at: func.now(),
            },
            synchronize_session=False,
        )
db.query(Negotiation).filter(
            Negotiation.id.in_(requested_negotiation_ids),
            Negotiation.negotiation_state_id == negotiation_states["Open"],
        ).update(
            {
                Negotiation.negotiation_state_id: negotiation_states[
                    "Unavailable"
                ]
            },
            synchronize_session=False,
        )

    db.query(Proposal).filter(
        Proposal.offered_listing_id == listing.id,
        Proposal.proposal_state_id == proposal_states["Pending"],
    ).update(
        {
            Proposal.proposal_state_id: proposal_states["ItemUnavailable"],
            Proposal.responded_at: func.now(),
        },
        synchronize_session=False,
    )
    listing.state_id = listing_states["Removed"]
    db.query(Favorite).filter(Favorite.listing_id == listing.id).delete(
        synchronize_session=False
    )
    db.commit()


# ---------------------------------------------------------------------------
# Photos
# ---------------------------------------------------------------------------
#
# Photos are uploaded one per request, as multipart/form-data with the file in
# a field named "file" -- the same contract as PUT /auth/me/avatar. One file
# per request keeps every body under nginx's client_max_body_size and lets
# the frontend show progress and errors photo by photo.
#
# Every endpoint answers with the whole updated listing, so the frontend can
# replace what it shows instead of patching its own copy.
#
# A listing with photos always has exactly one primary photo: the first
# upload becomes primary, and deleting the primary promotes the oldest of the
# remaining ones.

@router.post(
    "/{id}/images",
    response_model=ListingDetailOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a photo to a listing",
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Not authenticated."},
        status.HTTP_403_FORBIDDEN: {"description": "Not the listing's owner."},
        status.HTTP_404_NOT_FOUND: {"description": "Listing not found."},
        status.HTTP_409_CONFLICT: {"description": "The listing has too many photos."},
        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: {"description": "File too large."},
        status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: {"description": "Not a JPEG, PNG or WebP."},
        # Declaring 422 replaces FastAPI's automatic "Validation Error" entry,
        # so the description covers both cases.
        status.HTTP_422_UNPROCESSABLE_ENTITY: {
            "description": "Image dimensions are too large, or invalid request "
            "(e.g. no file).",
        },
    },
)
def add_listing_image(
    id: int = Path(gt=0, description="The listing identifier."),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListingDetailOut:
    """Validate, store and attach one photo to the logged-in user's listing."""
    user_id = current_user.id

    # Cheap checks first, so a request that will fail anyway never pays for
    # decoding an image.
    listing = _get_own_listing(db, id, user_id)
    _check_image_limit(listing)

    # Decoding and re-encoding is the slow part, so it runs before the row is
    # locked (same order as upload_avatar).
    new_image = save_image(file, "listings", LISTING_IMAGE_MAX_SIDE)

    try:
        # Lock the listing until the commit, so two uploads at once cannot both
        # pass the photo limit or both become the primary photo. The rollback
        # ends the read-only transaction first: see upload_avatar for the
        # MariaDB snapshot error (1020) a lock would otherwise risk.
        db.rollback()
        listing = _get_own_listing(db, id, user_id, lock=True)
        _check_image_limit(listing)
        db.add(Image(
            listing_id=listing.id,
            image_path=new_image,
            is_primary=not listing.images,
        ))
        db.commit()
    except Exception:
        # Nothing in the database points at the new file: remove it.
        db.rollback()
        delete_image(new_image)
        raise

    return _load_listing_detail(db, id)


@router.put(
    "/{id}/images/{image_id}/primary",
    response_model=ListingDetailOut,
    summary="Make a photo the listing's primary photo",
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Not authenticated."},
        status.HTTP_403_FORBIDDEN: {"description": "Not the listing's owner."},
        status.HTTP_404_NOT_FOUND: {"description": "Listing or photo not found."},
    },
)
def set_primary_listing_image(
    id: int = Path(gt=0, description="The listing identifier."),
    image_id: int = Path(gt=0, description="The photo identifier."),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListingDetailOut:
    """Choose which photo is shown on the listing's card."""
    user_id = current_user.id
    # See add_listing_image: end the read transaction before locking.
    db.rollback()
    listing = _get_own_listing(db, id, user_id, lock=True)
    chosen = _find_image(listing, image_id)
    for image in listing.images:
        image.is_primary = image is chosen
    db.commit()

    return _load_listing_detail(db, id)


@router.delete(
    "/{id}/images/{image_id}",
    response_model=ListingDetailOut,
    summary="Remove a photo from a listing",
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Not authenticated."},
        status.HTTP_403_FORBIDDEN: {"description": "Not the listing's owner."},
        status.HTTP_404_NOT_FOUND: {"description": "Listing or photo not found."},
    },
)
def delete_listing_image(
    id: int = Path(gt=0, description="The listing identifier."),
    image_id: int = Path(gt=0, description="The photo identifier."),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListingDetailOut:
    """Delete one photo, row and file."""
    user_id = current_user.id
    # See add_listing_image: end the read transaction before locking.
    db.rollback()
    listing = _get_own_listing(db, id, user_id, lock=True)
    image = _find_image(listing, image_id)
    old_path = image.image_path

    db.delete(image)
    remaining = [other for other in listing.images if other is not image]
    if image.is_primary and remaining:
        remaining[0].is_primary = True
    db.commit()

    # Only after the commit: until then the listing still used the file.
    delete_image(old_path)
    return _load_listing_detail(db, id)


def _get_own_listing(
    db: Session, id: int, user_id: int, *, lock: bool = False
) -> Listing:
    """Return the user's listing, or raise 404 (missing/not available) or 403.

    With ``lock=True`` the row stays locked (SELECT ... FOR UPDATE) until the
    transaction ends. populate_existing re-reads a row already loaded earlier
    in the request instead of reusing the stale copy.
    """
    query = db.query(Listing).filter(Listing.id == id).populate_existing()
    if lock:
        query = query.with_for_update()
    listing = query.first()
    # Removed and Expired listings behave as not found, as in GET.
    if listing is None or listing.state.state_name != "Available":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found.",
        )
    if listing.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only change the photos of your own listings.",
        )
    return listing


def _check_image_limit(listing: Listing) -> None:
    """Raise 409 when the listing already has the maximum number of photos."""
    if len(listing.images) >= MAX_IMAGES_PER_LISTING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A listing can have at most {MAX_IMAGES_PER_LISTING} photos.",
        )


def _find_image(listing: Listing, image_id: int) -> Image:
    """Return the listing's photo with this id, or raise 404."""
    for image in listing.images:
        if image.id == image_id:
            return image
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Photo not found.",
    )


def _load_listing_detail(db: Session, id: int) -> Listing:
    """Read a listing with every relationship ListingDetailOut needs.

    Used after a write to answer with the saved listing. Loading the
    relationships here keeps the endpoints independent of SQLAlchemy's
    lazy-loading configuration.
    """
    return (
        db.query(Listing)
        .options(
            joinedload(Listing.owner),
            joinedload(Listing.category),
            joinedload(Listing.condition),
            selectinload(Listing.images),
        )
        .populate_existing()
        .filter(Listing.id == id)
        .one()
    )


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
