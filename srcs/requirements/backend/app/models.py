"""SQLAlchemy models for Daka.

These classes mirror the tables defined in
``srcs/requirements/mariadb/schema.sql``, which is the single source of truth
for our database schema. The tables themselves are created on the MariaDB side
(the SQL file runs automatically the first time an empty database boots), so we
deliberately do NOT call ``Base.metadata.create_all()`` in production. These
models exist so the backend can read and write through the ORM (SQLAlchemy)
instead of hand-writing raw SQL.

Rule of thumb: if you change ``schema.sql``, change this file to match, and the
other way around. They describe the same tables from two sides.
"""
from datetime import datetime

from sqlalchemy import Boolean, CHAR, DateTime, ForeignKey, String, Text, func
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
    # Nullable columns are written as ``Mapped[str | None]``.
    avatar: Mapped[str | None] = mapped_column(String(255))
    user_location: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # The DB refreshes updated_at via "ON UPDATE CURRENT_TIMESTAMP" (see
    # schema.sql). ``onupdate`` makes the ORM do the same when it writes rows.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

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
    state_name: Mapped[str] = mapped_column(String(50))


class TradeState(Base):
    """Lookup table for a trade's status: Open, Finished, Cancelled."""

    __tablename__ = "trade_states"

    id: Mapped[int] = mapped_column(primary_key=True)
    state_name: Mapped[str] = mapped_column(String(50))


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
    listing_location: Mapped[str | None] = mapped_column(String(100))
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
    # One-to-many: a listing can have several photos.
    images: Mapped[list["Image"]] = relationship(back_populates="listing")


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


class Trade(Base):
    """A negotiation: someone requests a listing, optionally offering one back."""

    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_requested_id: Mapped[int] = mapped_column(ForeignKey("listings.id"))
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    # Nullable: the sender may request a listing without offering one in return.
    listing_offered_id: Mapped[int | None] = mapped_column(ForeignKey("listings.id"))
    trade_state_id: Mapped[int] = mapped_column(ForeignKey("trade_states.id"))
    initial_msg: Mapped[str] = mapped_column(String(250))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # This table references "listings" TWICE (requested + offered), so
    # SQLAlchemy cannot guess which foreign key each relationship uses. We tell
    # it explicitly with ``foreign_keys``.
    requested_listing: Mapped["Listing"] = relationship(
        foreign_keys=[listing_requested_id]
    )
    offered_listing: Mapped["Listing | None"] = relationship(
        foreign_keys=[listing_offered_id]
    )
    sender: Mapped["User"] = relationship(foreign_keys=[sender_id])
    state: Mapped["TradeState"] = relationship()
    # One trade holds the whole chat between the two users.
    messages: Mapped[list["Message"]] = relationship(back_populates="trade")


class Message(Base):
    """A single chat message inside a trade."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_id: Mapped[int] = mapped_column(ForeignKey("trades.id"))
    msg_sender: Mapped[int] = mapped_column(ForeignKey("users.id"))
    msg: Mapped[str] = mapped_column(String(250))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    trade: Mapped["Trade"] = relationship(back_populates="messages")
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

    # Like Trade, this table references "users" TWICE (reporter + reported), so
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