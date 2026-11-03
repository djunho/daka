"""Entry point of the Daka API."""
import secrets

from fastapi import Depends, FastAPI, Request, status
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.routers import auth, listings, negotiations, users


# root_path="/api": nginx forwards /api/ here, so the auto-generated docs
# (at /api/docs) build their links with the correct prefix.
app = FastAPI(title="Daka API", version="0.1.0", root_path="/api")


@app.exception_handler(OperationalError)
async def handle_operational_error(
    _request: Request, exc: OperationalError
) -> JSONResponse:
    """Turn retryable MariaDB concurrency conflicts into HTTP 409 responses."""
    error_code = exc.orig.args[0] if exc.orig.args else None
    if error_code in (1020, 1213):
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": (
                    "The operation conflicted with another concurrent change. "
                    "Please try again."
                )
            },
        )
    raise exc


# Authlib stores the temporary OAuth state in this signed, short-lived cookie.
# It is separate from daka_session, which is created only after Google login
# succeeds and identifies the user on subsequent API requests.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.oauth_state_secret or secrets.token_urlsafe(32),
    session_cookie="daka_oauth_state",
    https_only=True,
    same_site="lax",
)

# Everything in app/routers/ becomes reachable under their respective paths.
# For example, app/routers/auth.py becomes reachable under /auth, which is
# /api/auth from outside and /app/routers/listings.py becomes reachable under /listings, which is
# /api/listings from outside. Routes live in their own modules so main.py stays a
# table of contents instead of growing into a thousand-line file.
app.include_router(auth.router)
app.include_router(listings.router)
app.include_router(negotiations.router)
app.include_router(users.router)

# --- Prometheus metrics -----------------------------------------------------
# Prometheus scrapes GET backend:8000/metrics (job "backend" in prometheus.yml).
# Without this endpoint the scrape gets a 404, so up{job="backend"} == 0 and
# Grafana shows the backend as DOWN even while the container is healthy.
# instrument(app): adds middleware that times and counts every HTTP request.
# expose(app):     mounts /metrics in the Prometheus text exposition format.
# include_in_schema=False hides /metrics from the /api/docs OpenAPI page.
# Note: root_path does not alter the real served path, so /metrics stays at
# backend:8000/metrics, exactly where Prometheus looks for it.
Instrumentator().instrument(app).expose(app, include_in_schema=False)


@app.get("/health")
def health():
    """Just reports that the API is alive."""
    return {"status": "ok", "service": "daka-api"}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)):
    """Confirms that the API can actually talk to MariaDB."""
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "up"}
    except Exception as exc:
        return {"status": "error", "database": "down", "detail": str(exc)}
