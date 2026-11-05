"""Shared friendship operations."""

from sqlalchemy import or_
from sqlalchemy.orm import Query, Session

from app.models import Friendship


def normalize_pair(a: int, b: int) -> tuple[int, int]:
    """Return a friendship pair in the database's canonical order."""
    if a == b:
        raise ValueError("A friendship cannot contain the same user twice.")
    return (a, b) if a < b else (b, a)


def active_friendships_query(db: Session, user_id: int) -> Query[Friendship]:
    """Return accepted friendships for a user on either side of the pair."""
    return db.query(Friendship).filter(
        Friendship.status == "accepted",
        or_(
            Friendship.user_id == user_id,
            Friendship.friend_id == user_id,
        ),
    )


def save_friendship(
    db: Session,
    first_user_id: int,
    second_user_id: int,
    *,
    status: str = "accepted",
) -> Friendship:
    """Create or update a friendship using its canonical pair."""
    user_id, friend_id = normalize_pair(first_user_id, second_user_id)
    friendship = db.get(Friendship, (user_id, friend_id))
    if friendship is None:
        friendship = Friendship(
            user_id=user_id,
            friend_id=friend_id,
            status=status,
        )
        db.add(friendship)
    else:
        friendship.status = status
    return friendship


def remove_friendship(
    db: Session, first_user_id: int, second_user_id: int
) -> Friendship:
    """Mark a friendship removed using its canonical pair."""
    friendship = save_friendship(
        db,
        first_user_id,
        second_user_id,
        status="removed",
    )
    return friendship
