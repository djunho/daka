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