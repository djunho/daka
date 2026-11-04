"""Validate incoming chat events and persist them in short worker transactions."""

from collections import deque
import json
import logging
import math
import time

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.database import SessionLocal
from app.models import Listing, Message, Negotiation, NegotiationState, User, UserSession
from app.schemas import MessageSendEvent, PersistedMessage
from app.security import hash_session_token, utcnow

logger = logging.getLogger(__name__)
MAX_MESSAGE_PAYLOAD_BYTES = 4096

ERROR_MESSAGES = {
    "invalid_json": "Payload must be valid JSON.",
    "invalid_payload": "Payload must contain only type and textual content.",
    "payload_too_large": "Payload exceeds 4096 bytes.",
    "unsupported_event": "Only message.send is supported.",
    "empty_content": "Content must not be empty.",
    "content_too_long": "Content exceeds 250 Unicode characters.",
    "rate_limited": "Too many attempts. Please wait before sending again.",
    "unauthenticated": "Session is no longer valid.",
    "negotiation_not_found": "Negotiation no longer exists.",
    "forbidden": "You can no longer send messages in this negotiation.",
    "negotiation_read_only": "Negotiation no longer accepts new messages.",
    "persistence_failed": "Message could not be saved.",
}


class MessageProcessingError(Exception):
    def __init__(self, code: str, *, close_code=None, retry_after=None):
        super().__init__(code)
        self.code = code
        self.close_code = close_code
        self.retry_after = retry_after

    def as_event(self) -> dict:
        event = {"type": "error", "code": self.code, "message": ERROR_MESSAGES[self.code]}
        if self.retry_after is not None:
            event["retry_after"] = self.retry_after
        return event


class MessageRateLimiter:
    """Per-connection sliding window: bounded storage, no global registry."""

    def __init__(self, limit: int = 10, window: float = 10.0, clock=time.monotonic):
        self.limit = limit
        self.window = window
        self.clock = clock
        self._attempts: deque[float] = deque()

    def check(self) -> None:
        now = self.clock()
        while self._attempts and self._attempts[0] <= now - self.window:
            self._attempts.popleft()
        if len(self._attempts) >= self.limit:
            raise MessageProcessingError(
                "rate_limited",
                retry_after=max(1, math.ceil(self._attempts[0] + self.window - now)),
            )
        self._attempts.append(now)

    def clear(self) -> None:
        self._attempts.clear()


def _reject_json_constant(_value):
    raise ValueError("Non-JSON constant")


def parse_message_event(text: str | None) -> MessageSendEvent:
    if text is None:
        raise MessageProcessingError("invalid_payload")
    try:
        size = len(text.encode("utf-8"))
    except UnicodeEncodeError:
        raise MessageProcessingError("invalid_payload") from None
    if size > MAX_MESSAGE_PAYLOAD_BYTES:
        raise MessageProcessingError("payload_too_large")
    try:
        payload = json.loads(text, parse_constant=_reject_json_constant)
    except (ValueError, RecursionError):
        raise MessageProcessingError("invalid_json") from None
    if not isinstance(payload, dict):
        raise MessageProcessingError("invalid_payload")
    if "type" in payload and payload["type"] != "message.send":
        raise MessageProcessingError("unsupported_event")
    try:
        return MessageSendEvent.model_validate(payload)
    except ValidationError as exc:
        codes = {error["type"] for error in exc.errors(include_input=False)}
        # Structural errors take precedence over content errors when both occur.
        code = "invalid_payload"
        if codes <= {"empty_content", "content_too_long"}:
            code = "empty_content" if "empty_content" in codes else "content_too_long"
        raise MessageProcessingError(code) from None


def persist_message(
    event: MessageSendEvent,
    negotiation_id: int,
    sender_id: int,
    session_token: str | None,
) -> PersistedMessage:
    """Recheck current authority and state, then commit once before returning.

    Called in a worker thread. Create/use/close the session here, never carry
    handshake ORM instances or a live database transaction into the receive loop.
    Locks follow the existing user -> negotiation -> listing order. Session
    locking also serialises this transaction with logout/revocation.
    """
    with SessionLocal() as db:
        try:
            user = db.get(User, sender_id, with_for_update=True)
            if user is None or user.deleted_at is not None or not session_token:
                raise MessageProcessingError("unauthenticated", close_code=4401)
            session = (
                db.query(UserSession)
                .filter(
                    UserSession.user_id == sender_id,
                    UserSession.token_hash == hash_session_token(session_token),
                )
                .with_for_update()
                .one_or_none()
            )
            if session is None or session.expires_at <= utcnow():
                raise MessageProcessingError("unauthenticated", close_code=4401)

            negotiation = db.get(Negotiation, negotiation_id, with_for_update=True)
            if negotiation is None:
                raise MessageProcessingError("negotiation_not_found", close_code=4404)
            listing = db.get(Listing, negotiation.listing_id, with_for_update=True)
            if listing is None or sender_id not in (
                negotiation.interested_user_id, listing.user_id
            ):
                raise MessageProcessingError("forbidden", close_code=4403)
            # A lock wait can outlast the session's remaining lifetime.
            if session.expires_at <= utcnow():
                raise MessageProcessingError("unauthenticated", close_code=4401)
            state = db.get(NegotiationState, negotiation.negotiation_state_id)
            if state is None or state.state_name not in ("Open", "Agreed"):
                raise MessageProcessingError("negotiation_read_only")

            message = Message(
                negotiation_id=negotiation_id, msg_sender=user.id, msg=event.content
            )
            db.add(message)
            db.flush()
            db.refresh(message)
            # Capture generated fields before commit expires ORM attributes.
            # This value never escapes if commit fails; no post-commit query
            # can turn a successful write into an apparent failed write.
            result = PersistedMessage.model_validate(message)
            db.commit()
            return result
        except MessageProcessingError:
            db.rollback()
            raise
        except SQLAlchemyError as exc:
            db.rollback()
            # SQLAlchemy exception strings may include SQL parameters/content.
            logger.error(
                "Message persistence failed negotiation_id=%s sender_id=%s error_type=%s",
                negotiation_id, sender_id, type(exc).__name__,
            )
            raise MessageProcessingError("persistence_failed") from None
