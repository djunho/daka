"""Authenticated friendship routes."""

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import and_, case, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.friendships import normalize_pair
from app.models import Friendship, User
from app.presence import online_since
from app.schemas import (
    DEFAULT_FRIENDS_PAGE_SIZE,
    MAX_FRIENDS_PAGE_SIZE,
    MAX_PAGE_OFFSET,
    FriendOut,
    FriendPageOut,
    FriendStatusOut,
)

router = APIRouter(prefix="/friends", tags=["friends"])


def _user_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="User not found.",
    )


@router.get("", response_model=FriendPageOut, summary="List the current user's friends")
def list_friends(
    limit: int = Query(
        default=DEFAULT_FRIENDS_PAGE_SIZE,
        ge=1,
        le=MAX_FRIENDS_PAGE_SIZE,
    ),
    offset: int = Query(default=0, ge=0, le=MAX_PAGE_OFFSET),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendPageOut:
    """Return active friends, online first and then alphabetically."""
    friends = (
        db.query(User)
        .join(
            Friendship,
            or_(
                and_(
                    Friendship.user_id == current_user.id,
                    User.id == Friendship.friend_id,
                ),
                and_(
                    Friendship.friend_id == current_user.id,
                    User.id == Friendship.user_id,
                ),
            ),
        )
        .filter(
            Friendship.status == "accepted",
            or_(
                Friendship.user_id == current_user.id,
                Friendship.friend_id == current_user.id,
            ),
            User.deleted_at.is_(None),
        )
    )
    total = friends.count()
    online_first = case((online_since(), 0), else_=1)
    items = (
        friends.order_by(online_first, User.user_name.asc(), User.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return FriendPageOut(items=items, total=total, limit=limit, offset=offset)


@router.post(
    "/{user_id}",
    response_model=FriendOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add or reactivate a friend",
)
def add_friend(
    user_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendOut:
    """Create or reactivate a friendship with another active user."""
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot add yourself as a friend.",
        )

    # End the authentication snapshot before taking the same user-row locks
    # used by account deletion. Locking both rows in ID order prevents a
    # concurrent delete from committing after the active-user check.
    db.rollback()
    participant_ids = sorted({current_user.id, user_id})
    participants = (
        db.query(User)
        .filter(User.id.in_(participant_ids))
        .order_by(User.id)
        .populate_existing()
        .with_for_update()
        .all()
    )
    participants_by_id = {participant.id: participant for participant in participants}
    friend = participants_by_id.get(user_id)
    if (
        len(participants) != len(participant_ids)
        or current_user.id not in participants_by_id
        or any(participant.deleted_at is not None for participant in participants)
    ):
        raise _user_not_found()

    normalized_user_id, normalized_friend_id = normalize_pair(
        current_user.id, user_id
    )
    friendship = db.get(Friendship, (normalized_user_id, normalized_friend_id))
    if friendship is not None and friendship.status == "accepted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already in your friends list.",
        )
    if friendship is None:
        friendship = Friendship(
            user_id=normalized_user_id,
            friend_id=normalized_friend_id,
            status="accepted",
        )
        db.add(friendship)
    else:
        friendship.status = "accepted"

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        existing = db.get(Friendship, (normalized_user_id, normalized_friend_id))
        if existing is not None and existing.status == "accepted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already in your friends list.",
            ) from exc
        raise
    return friend


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a friend",
)
def delete_friend(
    user_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User is not in your friends list.",
        )
    normalized_user_id, normalized_friend_id = normalize_pair(
        current_user.id, user_id
    )
    friendship = db.get(Friendship, (normalized_user_id, normalized_friend_id))
    if friendship is None or friendship.status != "accepted":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User is not in your friends list.",
        )
    friendship.status = "removed"
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{user_id}/status",
    response_model=FriendStatusOut,
    summary="Check friendship status",
)
def get_friend_status(
    user_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendStatusOut:
    if user_id == current_user.id:
        return FriendStatusOut(is_friend=False)
    friend = (
        db.query(User)
        .filter(User.id == user_id, User.deleted_at.is_(None))
        .first()
    )
    if friend is None:
        raise _user_not_found()
    normalized_user_id, normalized_friend_id = normalize_pair(
        current_user.id, user_id
    )
    friendship = db.get(Friendship, (normalized_user_id, normalized_friend_id))
    return FriendStatusOut(
        is_friend=friendship is not None and friendship.status == "accepted"
    )
