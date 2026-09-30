from __future__ import annotations

from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Environments explicitly treated as non-production. Anything else (including an
# unset/unknown APP_ENV such as "staging") is treated as production so that the
# runtime safety checks fail closed.
NON_PRODUCTION_ENVIRONMENTS = frozenset({"development", "dev", "local", "test", "testing"})

# Database passwords that must never be used in production (compose defaults).
FORBIDDEN_PRODUCTION_DB_PASSWORDS = frozenset({"sentinel"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    question_json_dir: str = Field(default="../questions", alias="QUESTION_JSON_DIR")
    material_dir: str = Field(default="../material", alias="MATERIAL_DIR")
    # Non-licensed study-track sources (Modulos_sec+.md, cissp_domain.json, ceh_modules.md) shipped in
    # the image; empty falls back to MATERIAL_DIR.
    study_track_dir: str = Field(default="", alias="STUDY_TRACK_DIR")
    database_url: str = Field(
        default="postgresql+psycopg://sentinel:sentinel@127.0.0.1:5432/sentinel_quiz",
        alias="DATABASE_URL",
    )
    # Fail-closed: when APP_ENV is not provided the application behaves as production.
    environment: str = Field(default="production", alias="APP_ENV")
    enforce_production_safety: bool = Field(default=True, alias="ENFORCE_PRODUCTION_SAFETY")
    bootstrap_schema: bool = Field(default=False, alias="BOOTSTRAP_SCHEMA")
    ingest_on_startup: bool = Field(default=False, alias="INGEST_ON_STARTUP")
    # None => derived from the environment (enabled outside production only).
    expose_api_docs: Optional[bool] = Field(default=None, alias="EXPOSE_API_DOCS")

    # Database pool (ignored for SQLite).
    db_pool_size: int = Field(default=10, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=10, alias="DB_MAX_OVERFLOW")
    db_pool_timeout: int = Field(default=10, alias="DB_POOL_TIMEOUT")
    db_pool_pre_ping: bool = Field(default=True, alias="DB_POOL_PRE_PING")

    # Auth. Tokens have a fixed (non-sliding) lifetime of AUTH_TOKEN_TTL_HOURS; a new
    # token is issued on every login and all tokens are revoked on password reset.
    auth_token_ttl_hours: int = Field(default=168, alias="AUTH_TOKEN_TTL_HOURS")
    auth_token_bytes: int = Field(default=32, alias="AUTH_TOKEN_BYTES")
    auth_return_token_in_body: bool = Field(default=False, alias="AUTH_RETURN_TOKEN_IN_BODY")
    auth_last_used_throttle_seconds: int = Field(default=300, alias="AUTH_LAST_USED_THROTTLE_SECONDS")
    # Sliding session: a token used after half of its TTL elapsed is extended by a full
    # TTL (writes throttled together with last_used_at).
    auth_sliding_session: bool = Field(default=True, alias="AUTH_SLIDING_SESSION")
    auth_verification_resend_cooldown_seconds: int = Field(
        default=60, alias="AUTH_VERIFICATION_RESEND_COOLDOWN_SECONDS"
    )
    # Two-step sign-up (M-B2/L-B2): register only sends a verification link and login
    # requires a verified e-mail. None => derived from the environment (on in production).
    registration_email_verification: Optional[bool] = Field(default=None, alias="REGISTRATION_EMAIL_VERIFICATION")
    auth_cookie_name: str = Field(default="sentinel_session", alias="AUTH_COOKIE_NAME")
    auth_cookie_secure: bool = Field(default=True, alias="AUTH_COOKIE_SECURE")
    auth_cookie_samesite: str = Field(default="lax", alias="AUTH_COOKIE_SAMESITE")
    auth_cookie_domain: str = Field(default="", alias="AUTH_COOKIE_DOMAIN")
    auth_email_verification_ttl_minutes: int = Field(default=1440, alias="AUTH_EMAIL_VERIFICATION_TTL_MINUTES")
    auth_password_reset_ttl_minutes: int = Field(default=60, alias="AUTH_PASSWORD_RESET_TTL_MINUTES")
    public_web_origin: str = Field(default="http://127.0.0.1:3000", alias="PUBLIC_WEB_ORIGIN")
    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_username: str = Field(default="", alias="SMTP_USERNAME")
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")
    smtp_from_email: str = Field(default="", alias="SMTP_FROM_EMAIL")
    smtp_from_name: str = Field(default="Sentinel Quiz", alias="SMTP_FROM_NAME")
    smtp_use_tls: bool = Field(default=True, alias="SMTP_USE_TLS")
    smtp_timeout_seconds: float = Field(default=20.0, alias="SMTP_TIMEOUT_SECONDS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    log_json: bool = Field(default=True, alias="LOG_JSON")
    slow_request_threshold_ms: int = Field(default=1200, alias="SLOW_REQUEST_THRESHOLD_MS")
    trust_request_id_header: bool = Field(default=True, alias="TRUST_REQUEST_ID_HEADER")
    trust_forwarded_for_header: bool = Field(default=False, alias="TRUST_FORWARDED_FOR_HEADER")
    rate_limit_enabled: bool = Field(default=True, alias="RATE_LIMIT_ENABLED")
    rate_limit_public_requests: int = Field(default=180, alias="RATE_LIMIT_PUBLIC_REQUESTS")
    rate_limit_public_window_seconds: int = Field(default=60, alias="RATE_LIMIT_PUBLIC_WINDOW_SECONDS")
    rate_limit_auth_requests: int = Field(default=40, alias="RATE_LIMIT_AUTH_REQUESTS")
    rate_limit_auth_window_seconds: int = Field(default=60, alias="RATE_LIMIT_AUTH_WINDOW_SECONDS")
    # Stricter bucket for credential / account-discovery endpoints (login, register,
    # password reset and verification requests).
    rate_limit_auth_sensitive_requests: int = Field(default=10, alias="RATE_LIMIT_AUTH_SENSITIVE_REQUESTS")
    rate_limit_auth_sensitive_window_seconds: int = Field(
        default=60, alias="RATE_LIMIT_AUTH_SENSITIVE_WINDOW_SECONDS"
    )
    rate_limit_admin_requests: int = Field(default=60, alias="RATE_LIMIT_ADMIN_REQUESTS")
    rate_limit_admin_window_seconds: int = Field(default=60, alias="RATE_LIMIT_ADMIN_WINDOW_SECONDS")
    rate_limit_cache_size: int = Field(default=50000, alias="RATE_LIMIT_CACHE_SIZE")
    abuse_signal_enabled: bool = Field(default=True, alias="ABUSE_SIGNAL_ENABLED")
    abuse_signal_window_seconds: int = Field(default=60, alias="ABUSE_SIGNAL_WINDOW_SECONDS")
    abuse_distinct_path_threshold: int = Field(default=30, alias="ABUSE_DISTINCT_PATH_THRESHOLD")
    abuse_rate_limit_breach_threshold: int = Field(default=3, alias="ABUSE_RATE_LIMIT_BREACH_THRESHOLD")
    abuse_signal_cooldown_seconds: int = Field(default=300, alias="ABUSE_SIGNAL_COOLDOWN_SECONDS")
    rate_limit_backend: str = Field(default="memory", alias="RATE_LIMIT_BACKEND")
    rate_limit_allow_memory_in_production: bool = Field(
        default=False, alias="RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION"
    )
    redis_url: str = Field(default="", alias="REDIS_URL")

    cors_origins: str = Field(
        default="http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:3000,http://localhost:3000",
        alias="CORS_ORIGINS",
    )

    gemini_enable: bool = Field(default=True, alias="GEMINI_ENABLE")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_MODEL")
    gemini_timeout_seconds: float = Field(default=20.0, alias="GEMINI_TIMEOUT_SECONDS")
    gemini_temperature: float = Field(default=0.2, alias="GEMINI_TEMPERATURE")
    gemini_max_output_tokens: int = Field(default=400, alias="GEMINI_MAX_OUTPUT_TOKENS")
    # Extra operator instructions appended to the built-in tutor system instruction.
    gemini_system_prompt: str = Field(default="", alias="GEMINI_SYSTEM_PROMPT")
    gemini_min_response_chars: int = Field(default=220, alias="GEMINI_MIN_RESPONSE_CHARS")
    gemini_retry_on_short: bool = Field(default=True, alias="GEMINI_RETRY_ON_SHORT")
    gemini_candidate_count: int = Field(default=1, alias="GEMINI_CANDIDATE_COUNT")
    # Thinking budget for Gemini 2.5 "flash" models (0 disables thinking so the
    # output-token budget is not consumed by reasoning). Negative => not sent.
    gemini_thinking_budget: int = Field(default=0, alias="GEMINI_THINKING_BUDGET")
    tutor_daily_quota: int = Field(default=40, alias="TUTOR_DAILY_QUOTA")
    # IANA timezone defining the "study day" for daily goals, streaks and daily metric
    # buckets (timestamps themselves are always stored/served in UTC).
    study_day_timezone: str = Field(default="America/Sao_Paulo", alias="STUDY_DAY_TIMEZONE")

    # Sentinel Arena: live interactive quizzes (docs/live-quiz/CONTRATO-INCREMENTO-1.md §8).
    live_enabled: bool = Field(default=False, alias="LIVE_ENABLED")
    # allowlist | verified_users | all (platform admins can always host).
    live_host_policy: str = Field(default="allowlist", alias="LIVE_HOST_POLICY")
    live_host_allowlist: str = Field(default="", alias="LIVE_HOST_ALLOWLIST")
    live_max_participants: int = Field(default=1000, alias="LIVE_MAX_PARTICIPANTS")
    live_max_items: int = Field(default=100, alias="LIVE_MAX_ITEMS")
    live_join_code_length: int = Field(default=6, alias="LIVE_JOIN_CODE_LENGTH")
    # "kid:secret[,kid:secret]" — the first key signs, all keys verify (rotation).
    live_token_keys: str = Field(default="", alias="LIVE_TOKEN_KEYS")
    live_participant_token_ttl_hours: int = Field(default=12, alias="LIVE_PARTICIPANT_TOKEN_TTL_HOURS")
    live_display_token_ttl_hours: int = Field(default=12, alias="LIVE_DISPLAY_TOKEN_TTL_HOURS")
    # memory (single process) | redis (required with more than one worker/replica).
    live_bus_backend: str = Field(default="memory", alias="LIVE_BUS_BACKEND")
    live_redis_url: str = Field(default="", alias="LIVE_REDIS_URL")
    # Items licensed as "platform" may be shown to guests only after legal decision Q-19.
    live_platform_guest_ok: bool = Field(default=False, alias="LIVE_PLATFORM_GUEST_OK")
    live_grace_ms_default: int = Field(default=750, alias="LIVE_GRACE_MS_DEFAULT")
    live_ws_max_message_bytes: int = Field(default=16384, alias="LIVE_WS_MAX_MESSAGE_BYTES")
    live_ws_heartbeat_ms: int = Field(default=15000, alias="LIVE_WS_HEARTBEAT_MS")
    live_ws_rate_per_second: float = Field(default=20.0, alias="LIVE_WS_RATE_PER_SECOND")
    live_ws_rate_burst: int = Field(default=40, alias="LIVE_WS_RATE_BURST")
    # Extra WebSocket origins; CORS_ORIGINS and PUBLIC_WEB_ORIGIN are always allowed.
    live_allowed_origins: str = Field(default="", alias="LIVE_ALLOWED_ORIGINS")
    live_consent_version: str = Field(default="2026-10", alias="LIVE_CONSENT_VERSION")

    # Sentinel Arena AI authoring (docs/live-quiz/CONTRATO-INCREMENTO-2.md §5).
    ai_authoring_enabled: bool = Field(default=False, alias="AI_AUTHORING_ENABLED")
    # gemini | fake (deterministic, development/tests only).
    ai_provider: str = Field(default="gemini", alias="AI_PROVIDER")
    ai_authoring_model: str = Field(default="", alias="AI_AUTHORING_MODEL")  # empty => GEMINI_MODEL
    ai_critic_model: str = Field(default="", alias="AI_CRITIC_MODEL")  # empty => authoring model
    ai_critic_enabled: bool = Field(default=True, alias="AI_CRITIC_ENABLED")
    ai_authoring_max_output_tokens: int = Field(default=8192, alias="AI_AUTHORING_MAX_OUTPUT_TOKENS")
    ai_authoring_timeout_seconds: float = Field(default=90.0, alias="AI_AUTHORING_TIMEOUT_SECONDS")
    ai_daily_quota_credits: float = Field(default=300.0, alias="AI_DAILY_QUOTA_CREDITS")
    ai_max_concurrent_jobs: int = Field(default=2, alias="AI_MAX_CONCURRENT_JOBS")
    # thread (in the API process) | worker (separate `ai-worker` process, SKIP LOCKED queue).
    ai_job_runner: str = Field(default="thread", alias="AI_JOB_RUNNER")
    ai_job_stale_minutes: int = Field(default=10, alias="AI_JOB_STALE_MINUTES")
    rate_limit_ai_requests: int = Field(default=6, alias="RATE_LIMIT_AI_REQUESTS")
    rate_limit_ai_window_seconds: int = Field(default=60, alias="RATE_LIMIT_AI_WINDOW_SECONDS")

    def effective_ai_model(self) -> str:
        return str(self.ai_authoring_model or self.gemini_model or "").strip()

    def effective_ai_critic_model(self) -> str:
        return str(self.ai_critic_model or self.effective_ai_model()).strip()

    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def normalized_environment(self) -> str:
        return str(self.environment or "").strip().lower()

    def is_production(self) -> bool:
        return self.normalized_environment() not in NON_PRODUCTION_ENVIRONMENTS

    def api_docs_enabled(self) -> bool:
        if self.expose_api_docs is not None:
            return bool(self.expose_api_docs)
        return not self.is_production()

    def requires_email_verification(self) -> bool:
        if self.registration_email_verification is not None:
            return bool(self.registration_email_verification)
        return self.is_production()

    def effective_cookie_secure(self) -> bool:
        # Insecure cookies are only honoured outside production.
        return bool(self.auth_cookie_secure or self.is_production())

    def normalized_rate_limit_backend(self) -> str:
        return str(self.rate_limit_backend or "memory").strip().lower()

    def runtime_problems(self) -> list[str]:
        """Return the list of production-safety violations for the current settings."""
        problems: list[str] = []
        samesite = str(self.auth_cookie_samesite or "").strip().lower()
        if samesite not in {"lax", "strict", "none"}:
            problems.append("AUTH_COOKIE_SAMESITE must be one of: lax, strict, none.")
        backend = self.normalized_rate_limit_backend()
        if backend not in {"memory", "redis"}:
            problems.append("RATE_LIMIT_BACKEND must be one of: memory, redis.")
        if backend == "redis" and not str(self.redis_url or "").strip():
            problems.append("RATE_LIMIT_BACKEND=redis requires REDIS_URL.")
        problems.extend(self._live_problems())

        if not self.is_production():
            return problems

        if self.database_url.startswith("sqlite"):
            problems.append("Production runtime requires a PostgreSQL-compatible DATABASE_URL, not SQLite.")
        else:
            password = _database_password(self.database_url)
            if password is not None and password in FORBIDDEN_PRODUCTION_DB_PASSWORDS:
                problems.append("DATABASE_URL uses a default/insecure password; set a strong database password.")
        if self.bootstrap_schema:
            problems.append("BOOTSTRAP_SCHEMA must be false in production; run Alembic migrations instead.")
        if "*" in self.cors_origin_list():
            problems.append("CORS_ORIGINS must list explicit origins in production (wildcard with credentials is forbidden).")
        if not self.auth_cookie_secure:
            problems.append("AUTH_COOKIE_SECURE must be true in production.")
        if backend != "redis" and not self.rate_limit_allow_memory_in_production:
            problems.append(
                "RATE_LIMIT_BACKEND=redis is required in production "
                "(set RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION=true to override)."
            )
        return problems

    def normalized_live_bus_backend(self) -> str:
        return str(self.live_bus_backend or "memory").strip().lower()

    def effective_live_redis_url(self) -> str:
        return str(self.live_redis_url or self.redis_url or "").strip()

    def live_allowed_origin_list(self) -> List[str]:
        origins = [*self.cors_origin_list(), str(self.public_web_origin or "").strip()]
        origins.extend(o.strip() for o in self.live_allowed_origins.split(",") if o.strip())
        return [o.rstrip("/") for o in origins if o]

    def _live_problems(self) -> list[str]:
        problems: list[str] = []
        policy = str(self.live_host_policy or "").strip().lower()
        if policy not in {"allowlist", "verified_users", "all"}:
            problems.append("LIVE_HOST_POLICY must be one of: allowlist, verified_users, all.")
        bus = self.normalized_live_bus_backend()
        if bus not in {"memory", "redis"}:
            problems.append("LIVE_BUS_BACKEND must be one of: memory, redis.")
        if bus == "redis" and not self.effective_live_redis_url():
            problems.append("LIVE_BUS_BACKEND=redis requires LIVE_REDIS_URL (or REDIS_URL).")
        if not 6 <= int(self.live_join_code_length or 0) <= 8:
            problems.append("LIVE_JOIN_CODE_LENGTH must be between 6 and 8.")
        provider = str(self.ai_provider or "").strip().lower()
        if provider not in {"gemini", "fake"}:
            problems.append("AI_PROVIDER must be one of: gemini, fake.")
        if str(self.ai_job_runner or "").strip().lower() not in {"thread", "worker"}:
            problems.append("AI_JOB_RUNNER must be one of: thread, worker.")
        if self.ai_authoring_enabled and self.is_production() and provider == "fake":
            problems.append("AI_PROVIDER=fake is for development/tests only.")
        if self.live_enabled and self.is_production():
            from app.services.live_tokens import parse_token_keys  # local: avoids an import cycle

            try:
                keys = parse_token_keys(self.live_token_keys)
            except ValueError as exc:
                problems.append(f"LIVE_TOKEN_KEYS: {exc}")
            else:
                if not keys:
                    problems.append("LIVE_TOKEN_KEYS is required in production when LIVE_ENABLED=true.")
        return problems

    def validate_runtime(self) -> None:
        problems = self.runtime_problems()
        if not problems:
            return
        if not self.is_production():
            # Outside production only structural errors are fatal.
            raise ValueError(" ".join(problems))
        if not self.enforce_production_safety:
            return
        raise ValueError("Unsafe production configuration: " + " ".join(problems))


def _database_password(database_url: str) -> str | None:
    try:
        from sqlalchemy.engine import make_url

        return make_url(database_url).password
    except Exception:
        return None


settings = Settings()
