"""Reads the environment variables coming from .env (via docker-compose env_file)."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # --- Database ---------------------------------------------------------
    mysql_user: str = "daka"
    mysql_password: str = "daka"
    mysql_database: str = "daka"
    db_host: str = "db"
    db_port: int = 3306

    # --- Authentication ---------------------------------------------------
    # How long a login stays valid. 168 hours = 7 days. After that the session
    # row is considered expired and the user has to log in again.
    session_ttl_hours: int = 168

    # bcrypt cost factor: the hash runs 2^rounds iterations, so every +1 makes
    # it twice as slow for us AND twice as expensive to crack. 12 is the
    # current common default (~250 ms on a normal machine) -- slow enough to
    # hurt an attacker, fast enough that logging in still feels instant.
    bcrypt_rounds: int = 12

    # Google OAuth credentials. They remain optional until Google login is
    # enabled, so the existing email/password authentication still works when
    # these variables are not configured.
    google_client_id: str | None = None
    google_client_secret: str | None = None
    # Google must redirect to this exact public URL after authorization.
    google_redirect_uri: str = "https://localhost:8443/api/auth/google/callback"
    # Used to sign the temporary cookie that protects the OAuth state.
    oauth_state_secret: str | None = None
    # Destination after the backend creates the local Daka session.
    frontend_url: str = "https://localhost:8443"

    # Comma-separated exact origins allowed to open cookie-authenticated
    # WebSockets. Set this per environment, for example:
    #   development: https://localhost:8443
    #   production:  https://daka.example.com
    # The frontend URL is also included, which keeps the public application
    # origin and the WebSocket policy aligned by default.
    websocket_allowed_origins: str = "https://localhost:8443"

    @property
    def allowed_websocket_origins(self) -> frozenset[str]:
        configured = {
            origin.strip().rstrip("/")
            for origin in self.websocket_allowed_origins.split(",")
            if origin.strip()
        }
        configured.add(self.frontend_url.strip().rstrip("/"))
        return frozenset(configured)

    # --- Uploaded images ---------------------------------------------------
    # Where uploaded files are written inside the backend container. This is a
    # Docker volume, deliberately OUTSIDE /app: /app is a bind mount of the
    # repository, so files saved there would end up in git.
    media_root: str = "/data/media"
    # Public URL prefix nginx serves media_root under. The database stores
    # "/media/avatars/<file>.webp", ready to use as an <img src>.
    media_url: str = "/media"
    # Largest upload accepted, in bytes (2 MB). nginx allows a little more so
    # that this check, with its clear error message, is the one that fires.
    max_image_bytes: int = 2 * 1024 * 1024

    @property
    def database_url(self) -> str:
        """Connection string in the format SQLAlchemy expects."""
        return (
            f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.db_host}:{self.db_port}/{self.mysql_database}"
        )

    class Config:
        case_sensitive = False


settings = Settings()
