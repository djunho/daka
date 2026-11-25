"""The offset of every paginated endpoint has a ceiling, so a huge value is a 422."""

import unittest

from fastapi.testclient import TestClient

from app.database import get_db
from app.dependencies import get_current_user
from app.main import app
from app.schemas import MAX_PAGE_OFFSET

PAGINATED_PATHS = [
    "/listings",
    "/listings/favorites",
    "/negotiations",
    "/friends",
]


class PaginationOffsetTestCase(unittest.TestCase):
    def setUp(self) -> None:
        # Validation fails before the handler runs, so neither override is used;
        # they only keep the session check from answering 401 first.
        app.dependency_overrides[get_db] = lambda: None
        app.dependency_overrides[get_current_user] = lambda: None
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_offset_above_the_ceiling_is_rejected(self) -> None:
        # 2e19 used to reach the database, which failed with a 500.
        for offset in (MAX_PAGE_OFFSET + 1, 20_000_000_000_000_000_000):
            for path in PAGINATED_PATHS:
                with self.subTest(path=path, offset=offset):
                    response = self.client.get(path, params={"offset": offset})
                    self.assertEqual(response.status_code, 422)
                    self.assertEqual(response.json()["detail"][0]["loc"], ["query", "offset"])


if __name__ == "__main__":
    unittest.main()
