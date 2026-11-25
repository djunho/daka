"""Transport-independent participant rule; negotiation state is a separate policy."""

from app.models import Negotiation


def is_participant(negotiation: Negotiation, user_id: int) -> bool:
    """Call with the requested listing loaded while a database session is open."""
    return user_id in (
        negotiation.interested_user_id,
        negotiation.requested_listing.user_id,
    )
