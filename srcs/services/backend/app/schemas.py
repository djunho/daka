"""Pydantic schemas: the shape of what goes in and out of the API.

Two jobs, and it helps to keep them apart in your head:

* **Input schemas** (``RegisterIn``, ``LoginIn``) are the backend half of the
  "validate on the frontend AND the backend" requirement. FastAPI runs them
  before our route function is even called, so a malformed body never reaches
  our code -- it comes back as a 422 with a description of what was wrong. The
  frontend checks are there to give fast feedback; these are the ones that
  actually protect the database, because anyone can bypass a browser form with
  a single curl command.

* **Output schemas** (``UserOut``) decide what the API is allowed to send back.
  This is the safety net that stops us leaking ``pass_hash`` to the browser: a
  field that is not listed here is not serialised, no matter what the ORM
  object happens to be carrying.

SQLAlchemy models describe rows in a table. These describe messages on the
wire. They look similar and are deliberately not the same thing.
"""
from datetime import datetime, timezone
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    field_serializer,
    model_validator,
)
from pydantic_core import PydanticCustomError

from app.security import MAX_PASSWORD_BYTES

# Short enough to be memorable, long enough that brute force is hopeless. The
# 42 subject does not fix a number; 8 is the common floor and NIST's minimum.
MIN_PASSWORD_LENGTH = 8
LISTINGS_PAGE_SIZE = 12
DEFAULT_NEGOTIATIONS_PAGE_SIZE = 20
MAX_NEGOTIATIONS_PAGE_SIZE = 100
DEFAULT_FRIENDS_PAGE_SIZE = 50
MAX_FRIENDS_PAGE_SIZE = 100
MAX_LISTINGS_PAGE_SIZE = 100
# Without a ceiling, a huge offset passes validation and makes the database
# fail (500). One billion is far beyond any real list.
MAX_PAGE_OFFSET = 1_000_000_000
DEFAULT_MESSAGES_PAGE_SIZE = 50
MAX_MESSAGES_PAGE_SIZE = 100
# MariaDB message ids are signed INTs. Larger cursors are invalid inputs.
MAX_MESSAGE_ID = 2_147_483_647


class MessageSendEvent(BaseModel):
    """Only client-supplied chat fields; identities come from the handshake."""

    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["message.send"]
    content: str

    @field_validator("content")
    @classmethod
    def normalise_content(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise PydanticCustomError("empty_content", "Content must not be empty")
        if len(value) > 250:
            raise PydanticCustomError("content_too_long", "Content exceeds 250 characters")
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise PydanticCustomError("invalid_payload", "Content must be valid Unicode")
        return value


class PersistedMessage(BaseModel):
    """Detached message data returned only after a successful commit, not an event."""

    model_config = ConfigDict(from_attributes=True, frozen=True)

    id: int
    negotiation_id: int
    msg_sender: int
    msg: str
    created_at: datetime


class MessageCreatedData(BaseModel):
    """Public message format shared by delivery and future REST history."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: int = Field(gt=0)
    negotiation_id: int = Field(gt=0)
    sender_id: int = Field(gt=0)
    content: str
    created_at: datetime

    @field_serializer("created_at")
    def serialise_created_at(self, value: datetime) -> str:
        # app.database enforces UTC on every MariaDB pool checkout, so naive
        # TIMESTAMP results represent UTC rather than the server's local zone.
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class MessageCreatedEvent(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["message.created"] = "message.created"
    message: MessageCreatedData

    @classmethod
    def from_persisted(cls, message: PersistedMessage) -> "MessageCreatedEvent":
        return cls(message=MessageCreatedData(
            id=message.id, negotiation_id=message.negotiation_id,
            sender_id=message.msg_sender, content=message.msg,
            created_at=message.created_at,
        ))


class MessageHistorySender(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_name: str
    avatar: str | None


class MessageHistoryOut(BaseModel):
    id: int
    negotiation_id: int
    sender: MessageHistorySender
    content: str
    created_at: datetime

    @field_serializer("created_at")
    def serialise_created_at(self, value: datetime) -> str:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class MessageHistoryPage(BaseModel):
    items: list[MessageHistoryOut]
    limit: int
    next_before_id: int | None
    has_more: bool


class WebSocketValidationDetail(BaseModel):
    """Optional safe metadata, never raw input or exception text."""

    field: str
    code: str


class WebSocketErrorData(BaseModel):
    code: str
    message: str
    retry_after: int | None = Field(default=None, gt=0)
    details: list[WebSocketValidationDetail] | None = None


class WebSocketErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    error: WebSocketErrorData

# ---------------------------------------------------------------------------
# Shared pieces
# ---------------------------------------------------------------------------
def _normalise_email(value: str) -> str:
    """Lowercase and trim an email so one person cannot own two accounts.

    Without this, "Ana@daka.pt" and "ana@daka.pt" are different strings and
    would both be accepted -- then the user picks the wrong one at login and
    swears the site is broken. The domain part of an email is defined as
    case-insensitive anyway, and no mail provider in practice treats the local
    part as case-sensitive.

    Note this is belt and braces: our MariaDB columns use a case-insensitive
    collation, so the UNIQUE constraint would catch it too. We normalise
    anyway, because the stored value should be predictable and because that
    collation is a database setting someone could change later.
    """
    return value.strip().lower()


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    """Body of POST /api/auth/register."""

    # min_length/max_length are enforced by Pydantic before our code runs.
    # The 100 matches users.user_name VARCHAR(100) -- if the schema ever
    # allowed more than the column, MariaDB would truncate silently.
    user_name: str = Field(min_length=2, max_length=100)
    # EmailStr does the actual parsing (there is an "@", the domain is
    # plausible). It is worth the extra dependency: a hand-written regex for
    # emails is famously easy to get wrong.
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)

    @field_validator("user_name")
    @classmethod
    def strip_user_name(cls, value: str) -> str:
        """Trim surrounding whitespace and refuse a name that is only spaces.

        Field(min_length=2) counts characters, so "  " passes it. We strip
        first and check again, otherwise the site ends up with blank-looking
        profiles.
        """
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("name must have at least 2 visible characters")
        return cleaned

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        return _normalise_email(value)

    @field_validator("password")
    @classmethod
    def check_password_bytes(cls, value: str) -> str:
        """Enforce bcrypt's 72-byte ceiling here, at the edge of the system.

        app/security.py raises on anything longer, but a raised ValueError deep
        inside a route becomes a 500 -- a server error, implying WE broke. It
        is the user's input that is out of range, so it belongs in validation,
        where it becomes a 422 that explains itself.

        BYTES, not characters: "ã" costs 2 bytes in UTF-8 and an emoji costs 4,
        so a 50-character password can still be over the limit.
        """
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(
                f"password must not exceed {MAX_PASSWORD_BYTES} bytes "
                "(accented letters and emoji count as more than one)"
            )
        return value


class LoginIn(BaseModel):
    """Body of POST /api/auth/login.

    Looser than RegisterIn on purpose. The rules for what makes a *good* new
    password have no business here: someone who registered before we tightened
    them must still be able to log in. All we need is a well-formed email and
    a non-empty password -- whether it is right is decided by bcrypt, not by
    Pydantic.
    """

    email: EmailStr
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        return _normalise_email(value)


class ProfileUpdate(BaseModel):
    """Body of PATCH /api/auth/me.

    Fields that an authenticated user may change on their profile.

    All fields are optional so the client can update only one value at a time.
    ``user_location`` also accepts ``None`` to clear it. The avatar is not
    here: it changes only through PUT/DELETE /api/auth/me/avatar, so the
    stored value is always a file we created (or the Google picture).
    """

    user_name: str | None = Field(default=None, min_length=2, max_length=100)
    user_location: str | None = Field(default=None, max_length=200)

    @field_validator("user_name", "user_location")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("user_name")
    @classmethod
    def validate_user_name(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("name cannot be cleared")
        if len(value) < 2:
            raise ValueError("name must have at least 2 visible characters")
        return value

    @model_validator(mode="after")
    def require_a_change(self) -> "ProfileUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one profile field is required")
        return self


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
class UserOut(BaseModel):
    """A user as the API is willing to describe them.

    Compare this with models.User: pass_hash and google_sub are missing, and
    that is the entire point. FastAPI serialises exactly these fields and drops
    everything else, so a careless ``return user`` cannot leak a password hash.
    """

    # from_attributes lets Pydantic build this straight from a SQLAlchemy
    # object by reading its attributes (user.id, user.email, ...) instead of
    # requiring a dict. Without it, every route would need to unpack the model
    # by hand.
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_name: str
    email: EmailStr
    avatar: str | None
    user_location: str | None
    created_at: datetime
    last_seen: datetime | None
    is_online: bool

    @field_serializer("last_seen")
    def serialise_last_seen(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

# ==========================================================================
# LISTINGS SCHEMAS
# ==========================================================================
# --- Lookup schemas (simple, for displaying category/condition names) ---
class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    category_name: str

class ConditionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    condition_name: str

# --- Images ---
class ImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    image_path: str
    is_primary: bool

# --- Ad Entries ---
class ListingCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    category_id: int = Field(gt=0)
    condition_id: int = Field(gt=0)
    listing_dsc: str | None = Field(default=None, max_length=2000)
    listing_location: str | None = Field(default=None, max_length=200)
    wish: str | None = Field(default=None, max_length=1000)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("title must have at least 3 visible characters")
        return cleaned

    @field_validator("listing_dsc", "listing_location", "wish")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

class ListingUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=150)
    category_id: int | None = Field(default=None, gt=0)
    condition_id: int | None = Field(default=None, gt=0)
    listing_dsc: str | None = Field(default=None, max_length=2000)
    listing_location: str | None = Field(default=None, max_length=200)
    wish: str | None = Field(default=None, max_length=1000)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("title must have at least 3 visible characters")
        return cleaned

    @field_validator("listing_dsc", "listing_location", "wish")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @model_validator(mode="after")
    def require_a_change(self) -> "ListingUpdateIn":
        """Reject an empty PATCH and fields that cannot be cleared."""
        if not self.model_fields_set:
            raise ValueError("at least one listing field is required")
        for field_name in ("title", "category_id", "condition_id"):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self

class PublicUserOut(BaseModel):
    """What anyone, even without logging in, may see about a user."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_name: str
    avatar: str | None
    user_location: str | None
    is_online: bool


class FriendOut(BaseModel):
    """Public data for a user in the authenticated user's friend list."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_name: str
    avatar: str | None
    user_location: str | None
    is_online: bool
    last_seen: datetime | None

    @field_serializer("last_seen")
    def serialise_last_seen(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None:
            # Database DATETIME values are written and read as UTC by the
            # backend; a naive value therefore represents UTC here.
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class FriendPageOut(BaseModel):
    """One page of the authenticated user's active friends."""

    items: list[FriendOut]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=MAX_FRIENDS_PAGE_SIZE)
    offset: int = Field(ge=0)


class FriendStatusOut(BaseModel):
    is_friend: bool


# --- Saídas de Anúncios ---
class ListingSummaryOut(BaseModel):
    """Lightweight, condensed version for showcase, feed, search, and autocomplete."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    category: CategoryOut
    condition: ConditionOut
    listing_location: str | None
    wish: str | None
    owner: PublicUserOut
    # URL of the primary photo (Listing.cover_image), or None without photos.
    cover_image: str | None
    created_at: datetime


class ListingPageOut(BaseModel):
    """One page of public listings, together with its pagination metadata."""

    items: list[ListingSummaryOut]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=MAX_LISTINGS_PAGE_SIZE)
    offset: int = Field(ge=0)


class ListingDetailOut(ListingSummaryOut):
    """Detailed version with full description and images."""
    listing_dsc: str | None
    images: list[ImageOut] = Field(default_factory=list)
    is_favorited: bool = False


class PublicProfileOut(BaseModel):
    """Public profile data returned when viewing another active user."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_name: str
    avatar: str | None
    user_location: str | None
    created_at: datetime
    last_seen: datetime | None
    is_online: bool
    listings: list[ListingSummaryOut] = Field(default_factory=list)

    @field_serializer("last_seen")
    def serialise_last_seen(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ===========================================================================
# NEGOTIATION AND PROPOSAL SCHEMAS
# ===========================================================================
class NegotiationCreateIn(BaseModel):
    """Body accepted by POST /api/negotiations."""

    listing_id: int = Field(gt=0)


class ProposalCreateIn(BaseModel):
    """Body accepted by POST /api/negotiations/{id}/proposals.

    The field is required even though its value may be null. This keeps an
    explicit distinction between a deliberate no-listing proposal and a
    malformed request that omitted the proposal content.
    """

    offered_listing_id: int | None = Field(gt=0)


class NegotiationStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    state_name: Literal[
        "Open",
        "Agreed",
        "Completed",
        "Cancelled",
        "Unavailable",
    ]


class ProposalStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    state_name: Literal[
        "Pending",
        "Accepted",
        "Rejected",
        "Withdrawn",
        "NotSelected",
        "ItemUnavailable",
    ]


class ProposalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    offered_listing: ListingSummaryOut | None
    state: ProposalStateOut
    created_at: datetime
    responded_at: datetime | None


class NegotiationSummaryOut(BaseModel):
    """Compact representation returned by GET /api/negotiations."""

    id: int
    requested_listing: ListingSummaryOut
    other_participant: PublicUserOut
    state: NegotiationStateOut
    active_proposal: ProposalOut | None
    created_at: datetime
    updated_at: datetime


class NegotiationPageOut(BaseModel):
    items: list[NegotiationSummaryOut]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=MAX_NEGOTIATIONS_PAGE_SIZE)
    offset: int = Field(ge=0)


class NegotiationDetailOut(BaseModel):
    id: int
    requested_listing: ListingDetailOut
    owner: PublicUserOut
    interested_user: PublicUserOut
    state: NegotiationStateOut
    proposals: list[ProposalOut] = Field(default_factory=list)
    cancelled_by: PublicUserOut | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime
