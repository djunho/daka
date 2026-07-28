"""Reads the environment variables coming from .env (via docker-compose env_file)."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mysql_user: str = "daka"
    mysql_password: str = "daka"
    mysql_database: str = "daka"
    db_host: str = "db"
    db_port: int = 3306

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
