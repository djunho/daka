"""Entry point of the Daka API."""
from fastapi import Depends, FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers import auth, listings


# root_path="/api": nginx forwards /api/ here, so the auto-generated docs
# (at /api/docs) build their links with the correct prefix.
app = FastAPI(title="Daka API", version="0.1.0", root_path="/api")

# Everything in app/routers/ becomes reachable under their respective paths.
# For example, app/routers/auth.py becomes reachable under /auth, which is
# /api/auth from outside and /app/routers/listings.py becomes reachable under /listings, which is
# /api/listings from outside. Routes live in their own modules so main.py stays a
# table of contents instead of growing into a thousand-line file.
app.include_router(auth.router)
app.include_router(listings.router)

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
