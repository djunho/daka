"""Real recipient-worker query and network-read limits, without persistent data."""

import os
import time
import unittest
from unittest.mock import patch

from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.websocket_authorization import _recipient_close_code, recipient_engine


@unittest.skipUnless(os.getenv("RUN_MARIADB_INTEGRATION") == "1", "requires MariaDB integration")
class MariaDBAuthorizationTimeoutTestCase(unittest.TestCase):
    def test_worker_query_deadline_fails_closed_and_releases_connection(self):
        def stalled_authorisation(db, _token, _room):
            # MariaDB, not an asyncio timer, must interrupt this query.
            db.execute(text("SELECT SLEEP(5)"))
            self.fail("query exceeded max_statement_time without interruption")

        started = time.monotonic()
        with patch(
            "app.websocket_authorization.authorize_negotiation", side_effect=stalled_authorisation,
        ), self.assertLogs("app.websocket_authorization", level="ERROR") as logs:
            self.assertEqual(_recipient_close_code(20, 7, "private-token"), 1011)
        self.assertLess(time.monotonic() - started, 4)
        self.assertNotIn("private-token", " ".join(logs.output))
        self.assertEqual(recipient_engine.pool.checkedout(), 0)
        with recipient_engine.connect() as connection:
            self.assertEqual(connection.scalar(text("SELECT @@session.time_zone")), "+00:00")
            self.assertEqual(float(connection.scalar(text("SELECT @@session.max_statement_time"))), 1)
            self.assertEqual(connection.scalar(text("SELECT 1")), 1)

    def test_driver_read_timeout_even_when_server_query_limit_is_disabled(self):
        started = time.monotonic()
        # Only this connection's session is changed; invalidate on exit so its
        # altered max_statement_time cannot be reused by the application.
        with recipient_engine.connect() as connection:
            try:
                connection.exec_driver_sql("SET SESSION max_statement_time = 0")
                with self.assertRaises(OperationalError):
                    connection.exec_driver_sql("SELECT SLEEP(5)")
            finally:
                connection.invalidate()
        self.assertLess(time.monotonic() - started, 4)
        self.assertEqual(recipient_engine.pool.checkedout(), 0)


if __name__ == "__main__":
    unittest.main()
