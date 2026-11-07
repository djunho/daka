"""SQLAlchemy models for Daka.

These classes mirror the tables defined in
``srcs/services/mariadb/schema.sql``, which is the single source of truth
for our database schema. The tables themselves are created on the MariaDB side
(the SQL file runs automatically the first time an empty database boots), so we
deliberately do NOT call ``Base.metadata.create_all()`` in production. These
models exist so the backend can read and write through the ORM (SQLAlchemy)
instead of hand-writing raw SQL.

Rule of thumb: if you change ``schema.sql``, change this file to match, and the
other way around. They describe the same tables from two sides.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CHAR,
    CheckConstraint,
    Computed,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ---------------------------------------------------------------------------
# Core tables
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    # Nullable: a Google-only account never picks a password, so there is
    # nothing to hash. The API refuses to create an email/password account
    # without one -- the database cannot tell the two signup paths apart.
    pass_hash: Mapped[str | None] = mapped_column(String(255))
    # Google's permanent user id. Unused until the OAuth module lands; the
    # column exists now so adding it later does not require wiping the volume.
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    # The user's role in the system.
    user_role: Mapped[str] = mapped_column(String(20), default="user")
    # Nullable columns are written as ``Mapped[str | None]``.
    avatar: Mapped[str | None] = mapped_column(String(255))
    user_location: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # The DB refreshes updated_at via "ON UPDATE CURRENT_TIMESTAMP" (see
    # schema.sql). ``onupdate`` makes the ORM do the same when it writes rows.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    last_seen: Mapped[datetime | None] = mapped_column(DateTime)
    # Soft deletion keeps the row for reports and historical records while
    # preventing the account from authenticating or appearing as active.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)

    @property
    def is_online(self) -> bool:
        from app.presence import is_online

        return is_online(self)

    # One-to-many: a user publishes many listings. ``back_populates`` links this
    # to Listing.owner so both sides stay consistent in memory.
    listings: Mapped[list["Listing"]] = relationship(back_populates="owner")
    # One-to-many: one row per device the user is logged in on.
    # ``cascade="all, delete-orphan"`` is the ORM-side twin of the SQL
    # ON DELETE CASCADE: deleting a User through the ORM also deletes their
    # sessions. Both sides are declared because either can do the delete.
    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    # These collections include both accepted and removed rows. Callers that
    # display the active friend list must filter by Friendship.status.
    friendships_as_user: Mapped[list["Friendship"]] = relationship(
        foreign_keys="Friendship.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    friendships_as_friend: Mapped[list["Friendship"]] = relationship(
        foreign_keys="Friendship.friend_id",
        back_populates="friend",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class UserSession(Base):
    """One active login. Deleting the row is what logging out means.

    Named ``UserSession`` and not ``Session`` on purpose: SQLAlchemy already
    exports a class called ``Session`` (the database connection handle we pass
    around as ``db``). Two different things called Session in the same file is
    a bug waiting to happen, so the table stays ``sessions`` and the class gets
    a distinct name.
    """

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="sessions")


class Friendship(Base):
    """Symmetric friendship stored once with the lower user id first."""

    __tablename__ = "friendships"
    __table_args__ = (CheckConstraint("user_id < friend_id", name="chk_friendship_order"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    friend_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(
        Enum(
            "accepted",
            "removed",
            name="friendship_status",
            validate_strings=True,
        ),
        default="accepted",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(
        foreign_keys=[user_id],
        back_populates="friendships_as_user",
        passive_deletes=True,
    )
    friend: Mapped["User"] = relationship(
        foreign_keys=[friend_id],
        back_populates="friendships_as_friend",
        passive_deletes=True,
    )


class Category(Base):
    """Lookup table: Books, Clothing, Electronics, ... (see seeds.sql)."""

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_name: Mapped[str] = mapped_column(String(50))


class Condition(Base):
    """Lookup table: New, Like New, Good, Fair, Needs Repair."""

    __tablename__ = "conditions"

    id: Mapped[int] = mapped_column(primary_key=True)
    condition_name: Mapped[str] = mapped_column(String(50))


class ListingState(Base):
    """Lookup table for a listing's status: Available, Removed, Expired."""

    __tablename__ = "listings_states"

    id: Mapped[int] = mapped_column(primary_key=True)
    state_name: Mapped[str] = mapped_column(String(50), unique=True)


class NegotiationState(Base):
    """Lookup table: Open, Agreed, Completed, Cancelled, Unavailable."""

    __tablename__ = "negotiation_states"

    id: Mapped[int] = mapped_column(primary_key=True)
    state_name: Mapped[str] = mapped_column(String(50), unique=True)


class ProposalState(Base):
    """Lookup table for the lifecycle of an individual proposal."""

    __tablename__ = "proposal_states"

    id: Mapped[int] = mapped_column(primary_key=True)
    state_name: Mapped[str] = mapped_column(String(50), unique=True)


class Listing(Base):
    """A published offer: what the person HAS (title) and WANTS (wish)."""

    __tablename__ = "listings"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Foreign keys point at the "id" column of each referenced table.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    condition_id: Mapped[int] = mapped_column(ForeignKey("conditions.id"))
    state_id: Mapped[int] = mapped_column(ForeignKey("listings_states.id"))
    title: Mapped[str] = mapped_column(String(150))            # what the person HAS
    listing_dsc: Mapped[str | None] = mapped_column(Text)
    listing_location: Mapped[str | None] = mapped_column(String(200))
    wish: Mapped[str | None] = mapped_column(Text)             # what the person WANTS
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # Many-to-one links. Only the owner side is bidirectional (User.listings);
    # the lookup links are one-directional because we never need the reverse
    # (e.g. "all listings of a category") as a mapped collection.
    owner: Mapped["User"] = relationship(back_populates="listings")
    category: Mapped["Category"] = relationship()
    condition: Mapped["Condition"] = relationship()
    state: Mapped["ListingState"] = relationship()
    # One-to-many: a listing can have several photos, kept in upload order.
    images: Mapped[list["Image"]] = relationship(
        back_populates="listing", order_by="Image.id"
    )
    # One-to-many: PDF documents attached by the owner, kept in upload order.
    documents: Mapped[list["Document"]] = relationship(
        back_populates="listing", order_by="Document.id"
    )

    @property
    def cover_image(self) -> str | None:
        """URL of the photo shown on cards: the primary one, else the oldest."""
        for image in self.images:
            if image.is_primary:
                return image.image_path
        return self.images[0].image_path if self.images else None


# ---------------------------------------------------------------------------
# Support tables
# ---------------------------------------------------------------------------
class Image(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"))
    image_path: Mapped[str] = mapped_column(String(150))
    # DEFAULT FALSE lives in schema.sql; ``default=False`` mirrors it for rows
    # created through the ORM.
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)

    listing: Mapped["Listing"] = relationship(back_populates="images")


class Document(Base):
    """A PDF attached to a listing (manual, invoice, warranty...).

    The file is stored under settings.documents_root with a random name
    (``file_name``). ``original_name`` is only shown to people and sent in the
    Content-Disposition header: it never reaches the file system.
    """

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"))
    file_name: Mapped[str] = mapped_column(String(64))
    original_name: Mapped[str] = mapped_column(String(150))
    size_bytes: Mapped[int] = mapped_column()
    page_count: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    listing: Mapped["Listing"] = relationship(back_populates="documents")


class Negotiation(Base):
    """One conversation about a listing between its owner and one user."""

    __tablename__ = "negotiations"
    __table_args__ = (
        UniqueConstraint("listing_id", "interested_user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"))
    interested_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    negotiation_state_id: Mapped[int] = mapped_column(
        ForeignKey("negotiation_states.id")
    )
    cancelled_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    requested_listing: Mapped["Listing"] = relationship(
        foreign_keys=[listing_id]
    )
    interested_user: Mapped["User"] = relationship(
        foreign_keys=[interested_user_id]
    )
    state: Mapped["NegotiationState"] = relationship()
    cancelled_by: Mapped["User | None"] = relationship(
        foreign_keys=[cancelled_by_user_id]
    )
    proposals: Mapped[list["Proposal"]] = relationship(
        back_populates="negotiation", order_by="Proposal.created_at"
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="negotiation", order_by="Message.created_at"
    )


class Proposal(Base):
    """An optional listing offered within an existing negotiation."""

    __tablename__ = "proposals"
    __table_args__ = (
        UniqueConstraint(
            "negotiation_id",
            "offered_listing_unique_key",
            name="uq_proposals_negotiation_offer",
        ),
        Index(
            "idx_proposals_negotiation_state",
            "negotiation_id",
            "proposal_state_id",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    negotiation_id: Mapped[int] = mapped_column(ForeignKey("negotiations.id"))
    offered_listing_id: Mapped[int | None] = mapped_column(ForeignKey("listings.id"))
    # Mirrors the generated column in schema.sql. Zero is safe as the null
    # sentinel because listing ids are positive AUTO_INCREMENT values.
    offered_listing_unique_key: Mapped[int] = mapped_column(
        Computed("COALESCE(offered_listing_id, 0)", persisted=True)
    )
    proposal_state_id: Mapped[int] = mapped_column(ForeignKey("proposal_states.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    responded_at: Mapped[datetime | None] = mapped_column(DateTime)

    negotiation: Mapped["Negotiation"] = relationship(back_populates="proposals")
    offered_listing: Mapped["Listing | None"] = relationship(
        foreign_keys=[offered_listing_id]
    )
    state: Mapped["ProposalState"] = relationship()


class Message(Base):
    """A single chat message inside a negotiation."""

    __tablename__ = "messages"
    __table_args__ = (
        Index("idx_messages_negotiation_created", "negotiation_id", "created_at"),
        Index("idx_messages_negotiation_id", "negotiation_id", "id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    negotiation_id: Mapped[int] = mapped_column(ForeignKey("negotiations.id"))
    msg_sender: Mapped[int] = mapped_column(ForeignKey("users.id"))
    msg: Mapped[str] = mapped_column(String(250))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    negotiation: Mapped["Negotiation"] = relationship(back_populates="messages")
    sender: Mapped["User"] = relationship()


class Report(Base):
    """A user report against a listing and/or another user."""

    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reported_listings_id: Mapped[int | None] = mapped_column(ForeignKey("listings.id"))
    reported_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(String(250))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # This table references "users" twice (reporter + reported), so
    # each relationship states its foreign key explicitly.
    reporter: Mapped["User"] = relationship(foreign_keys=[reporter_id])
    reported_user: Mapped["User | None"] = relationship(foreign_keys=[reported_user_id])
    reported_listing: Mapped["Listing | None"] = relationship(
        foreign_keys=[reported_listings_id]
    )


class Favorite(Base):
    """Join table: which listings a user has saved."""

    __tablename__ = "favorites"

    # Composite primary key (user_id + listing_id): a user can save a given
    # listing only once. Both columns are also foreign keys.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), primary_key=True)

    user: Mapped["User"] = relationship()
    listing: Mapped["Listing"] = relationship()
