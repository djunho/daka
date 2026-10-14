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
from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.security import MAX_PASSWORD_BYTES

# Short enough to be memorable, long enough that brute force is hopeless. The
# 42 subject does not fix a number; 8 is the common floor and NIST's minimum.
MIN_PASSWORD_LENGTH = 8
LISTINGS_PAGE_SIZE = 12
MAX_LISTINGS_PAGE_SIZE = 100

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
    user_location: str | None = Field(default=None, max_length=100)

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
    listing_location: str | None = Field(default=None, max_length=100)
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
    listing_location: str | None = Field(default=None, max_length=100)
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
