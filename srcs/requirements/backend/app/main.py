"""Entry point of the Daka API."""
from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers import auth

# root_path="/api": nginx forwards /api/ here, so the auto-generated docs
# (at /api/docs) build their links with the correct prefix.
app = FastAPI(title="Daka API", version="0.1.0", root_path="/api")

# Everything in app/routers/auth.py becomes reachable under /auth, which is
# /api/auth from outside. Routes live in their own modules so main.py stays a
# table of contents instead of growing into a thousand-line file.
app.include_router(auth.router)


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