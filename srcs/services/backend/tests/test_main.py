"""Tests for application-level database error handling."""

import json
import unittest

from sqlalchemy.exc import OperationalError
from starlette.requests import Request

from app.main import handle_operational_error


class OperationalErrorHandlerTestCase(unittest.IsolatedAsyncioTestCase):
    def _request(self) -> Request:
        return Request({"type": "http", "method": "GET", "path": "/"})

    def _error(self, code: int) -> OperationalError:
        return OperationalError("statement", {}, RuntimeError(code, "database error"))

    async def test_retryable_concurrency_errors_become_conflicts(self) -> None:
        for code in (1020, 1213):
            with self.subTest(code=code):
                response = await handle_operational_error(
                    self._request(), self._error(code)
                )
                self.assertEqual(response.status_code, 409)
                self.assertIn("Please try again", json.loads(response.body)["detail"])

    async def test_other_operational_errors_are_not_translated(self) -> None:
        error = self._error(2003)
        with self.assertRaises(OperationalError) as raised:
            await handle_operational_error(self._request(), error)
        self.assertIs(raised.exception, error)


if __name__ == "__main__":
    unittest.main()
