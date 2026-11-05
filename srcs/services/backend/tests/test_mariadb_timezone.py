"""Real MariaDB TIMESTAMP/session timezone regression; no persistent test data."""

from datetime import datetime, timezone
import json
import os
import unittest

from sqlalchemy import text

from app.config import settings
from app.database import create_database_engine
from app.schemas import MessageCreatedData


@unittest.skipUnless(os.getenv("RUN_MARIADB_INTEGRATION") == "1", "requires MariaDB integration")
class MariaDBTimezoneTestCase(unittest.TestCase):
    def test_timestamp_is_utc_on_new_and_reused_connections(self):
        # The creator simulates a server whose default session zone is not UTC,
        # without changing the shared server's global configuration.
        import pymysql
        created_connections = []

        def non_utc_connection():
            connection = pymysql.connect(
                host=settings.db_host, port=settings.db_port,
                user=settings.mysql_user, password=settings.mysql_password,
                database=settings.mysql_database,
                init_command="SET SESSION time_zone = '+05:30'",
            )
            created_connections.append(connection)
            return connection

        engine = create_database_engine(
            settings.database_url, creator=non_utc_connection,
            pool_size=1, max_overflow=0,
        )
        try:
            with engine.connect() as connection:
                self.assertEqual(connection.scalar(text("SELECT @@session.time_zone")), "+00:00")
                connection.exec_driver_sql(
                    "CREATE TEMPORARY TABLE utc_timestamp_test "
                    "(created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql("INSERT INTO utc_timestamp_test () VALUES ()")
                connection.commit()
                utc_value, epoch = connection.execute(text(
                    "SELECT created_at, UNIX_TIMESTAMP(created_at) FROM utc_timestamp_test"
                )).one()
                expected = datetime.fromtimestamp(float(epoch), timezone.utc)
                self.assertEqual(utc_value.replace(tzinfo=timezone.utc), expected)
                # Drift on a checked-out connection must not survive reuse.
                connection.exec_driver_sql("SET SESSION time_zone = '+05:30'")
                shifted_value = connection.scalar(text("SELECT created_at FROM utc_timestamp_test"))
                self.assertNotEqual(shifted_value, utc_value)

            with engine.connect() as connection:
                self.assertEqual(len(created_connections), 1, "test must reuse the same physical connection")
                self.assertEqual(connection.scalar(text("SELECT @@session.time_zone")), "+00:00")
                restored = connection.scalar(text("SELECT created_at FROM utc_timestamp_test"))
                self.assertEqual(restored, utc_value)
                payload = MessageCreatedData(
                    id=1, negotiation_id=1, sender_id=1, content="test", created_at=restored,
                ).model_dump_json()
                serialized = json.loads(payload)["created_at"]
                self.assertTrue(serialized.endswith("Z"))
                self.assertEqual(datetime.fromisoformat(serialized.replace("Z", "+00:00")), expected)
        finally:
            # Disposing closes the only connection and drops its temporary table.
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
