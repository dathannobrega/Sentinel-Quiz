"""Seeds the E2E admin user with backend app code (run by web/e2e/global-setup.ts).

Usage: python seed_admin.py <backend_dir> <email> <password>
DATABASE_URL (and the other backend settings) must already be in the environment. Creates the
schema when needed (BOOTSTRAP_SCHEMA semantics), then an active admin with a verified e-mail.
Idempotent: an existing user is promoted and its password reset.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone


def main() -> int:
    backend_dir, email, password = sys.argv[1], sys.argv[2], sys.argv[3]
    sys.path.insert(0, backend_dir)

    from sqlalchemy import select

    from app.db.base import Base
    from app.db.session import SessionLocal, engine
    from app import models  # noqa: F401  (registers every table on Base.metadata)
    from app.models import User
    from app.services.auth import create_user, hash_password, normalize_email

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == normalize_email(email))).scalar_one_or_none()
        if user is None:
            user = create_user(db, email=email, password=password, display_name="E2E Admin")
        else:
            user.password_hash = hash_password(password)
        user.role = "admin"
        user.is_active = True
        user.email_verified = True
        # Naive UTC matches the current columns; aware values are also accepted by SQLite.
        user.email_verified_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        print(f"seeded admin {user.email} ({user.id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
