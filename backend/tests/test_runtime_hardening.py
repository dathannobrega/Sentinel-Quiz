from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEPENDENCIES_AVAILABLE = True
DEPENDENCY_MESSAGE = ""

try:
    from app.core.config import Settings
    from app.middleware.rate_limit import InMemoryRateLimitStore, RateLimitMiddleware
    from app.services.auth import _deliver_auth_email, settings as auth_settings
except ModuleNotFoundError as exc:
    DEPENDENCIES_AVAILABLE = False
    DEPENDENCY_MESSAGE = str(exc)


@unittest.skipUnless(DEPENDENCIES_AVAILABLE, f"Backend dependencies are unavailable in this interpreter: {DEPENDENCY_MESSAGE}")
class RuntimeHardeningTests(unittest.TestCase):
    def test_production_auth_email_requires_smtp(self) -> None:
        original_environment = auth_settings.environment
        original_smtp_host = auth_settings.smtp_host
        original_from_email = auth_settings.smtp_from_email
        try:
            auth_settings.environment = "production"
            auth_settings.smtp_host = ""
            auth_settings.smtp_from_email = ""
            with self.assertRaises(RuntimeError):
                _deliver_auth_email(
                    to_email="user@example.com",
                    subject="Reset",
                    body_lines=["line"],
                    fallback_log_context={"challenge_type": "password_reset", "reset_url": "http://example.invalid/token"},
                )
        finally:
            auth_settings.environment = original_environment
            auth_settings.smtp_host = original_smtp_host
            auth_settings.smtp_from_email = original_from_email

    def test_rate_limit_redis_backend_falls_back_when_unavailable(self) -> None:
        async def app(scope, receive, send):
            return None

        settings = Settings(
            RATE_LIMIT_BACKEND="redis",
            REDIS_URL="redis://127.0.0.1:6399/9",
        )
        middleware = RateLimitMiddleware(app, settings=settings)
        self.assertIsInstance(middleware._store, InMemoryRateLimitStore)


if __name__ == "__main__":
    unittest.main()
