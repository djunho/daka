"""Entry point of the Daka API."""
import logging
import secrets

from fastapi import Depends, FastAPI, Request, Response, status
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator, metrics
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.routers import auth, listings, negotiations, users


logger = logging.getLogger(__name__)

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
# Exclude /metrics and /health* so automated probe calls do not pollute application
# latency histograms, error rates, and Grafana traffic charts.
# Custom latency_lowr_buckets provide granular response times below 100 ms and
# span up to 10s, allowing p95 calculations to measure latencies above 1.0s.
Instrumentator(
    excluded_handlers=["/metrics", "/health.*"]
).add(
    metrics.default(
        latency_lowr_buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10)
    )
).instrument(app).expose(app, include_in_schema=False)


@app.get("/health")
def health():
    """Just reports that the API is alive."""
    return {"status": "ok", "service": "daka-api"}


@app.get("/health/db")
def health_db(response: Response, db: Session = Depends(get_db)):
    """Confirms that the API can actually talk to MariaDB."""
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "up"}
    except Exception:
        # Log the full exception server-side so database connection issues
        # (credentials, timeouts, exhausted pools) are diagnostic in backend logs.
        logger.exception("Database health check failed")
        # Return 503 so blackbox-exporter (which probes for 2xx responses)
        # marks /api/health/db as failed when MariaDB is unreachable.
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "error", "database": "down"}
