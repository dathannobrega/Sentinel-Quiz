from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import List

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    question_json_dir: str = Field(default="../questions", alias="QUESTION_JSON_DIR")
    material_dir: str = Field(default="../material", alias="MATERIAL_DIR")
    database_url: str = Field(
        default="postgresql+psycopg://sentinel:sentinel@127.0.0.1:5432/sentinel_quiz",
        alias="DATABASE_URL",
    )
    environment: str = Field(default="development", alias="APP_ENV")
    enforce_production_safety: bool = Field(default=True, alias="ENFORCE_PRODUCTION_SAFETY")
    bootstrap_schema: bool = Field(default=True, alias="BOOTSTRAP_SCHEMA")
    auth_token_ttl_hours: int = Field(default=168, alias="AUTH_TOKEN_TTL_HOURS")
    auth_token_bytes: int = Field(default=32, alias="AUTH_TOKEN_BYTES")
    auth_cookie_name: str = Field(default="sentinel_session", alias="AUTH_COOKIE_NAME")
    auth_cookie_secure: bool = Field(default=False, alias="AUTH_COOKIE_SECURE")
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
    rate_limit_admin_requests: int = Field(default=60, alias="RATE_LIMIT_ADMIN_REQUESTS")
    rate_limit_admin_window_seconds: int = Field(default=60, alias="RATE_LIMIT_ADMIN_WINDOW_SECONDS")
    rate_limit_cache_size: int = Field(default=50000, alias="RATE_LIMIT_CACHE_SIZE")
    abuse_signal_enabled: bool = Field(default=True, alias="ABUSE_SIGNAL_ENABLED")
    abuse_signal_window_seconds: int = Field(default=60, alias="ABUSE_SIGNAL_WINDOW_SECONDS")
    abuse_distinct_path_threshold: int = Field(default=30, alias="ABUSE_DISTINCT_PATH_THRESHOLD")
    abuse_rate_limit_breach_threshold: int = Field(default=3, alias="ABUSE_RATE_LIMIT_BREACH_THRESHOLD")
    abuse_signal_cooldown_seconds: int = Field(default=300, alias="ABUSE_SIGNAL_COOLDOWN_SECONDS")

    cors_origins: str = Field(default="http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:3000,http://localhost:3000", alias="CORS_ORIGINS")

    gemini_enable: bool = Field(default=True, alias="GEMINI_ENABLE")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-1.5-flash", alias="GEMINI_MODEL")
    gemini_timeout_seconds: float = Field(default=20.0, alias="GEMINI_TIMEOUT_SECONDS")
    gemini_temperature: float = Field(default=0.2, alias="GEMINI_TEMPERATURE")
    gemini_max_output_tokens: int = Field(default=400, alias="GEMINI_MAX_OUTPUT_TOKENS")
    gemini_system_prompt: str = Field(default="", alias="GEMINI_SYSTEM_PROMPT")
    gemini_min_response_chars: int = Field(default=220, alias="GEMINI_MIN_RESPONSE_CHARS")
    gemini_retry_on_short: bool = Field(default=True, alias="GEMINI_RETRY_ON_SHORT")
    gemini_candidate_count: int = Field(default=1, alias="GEMINI_CANDIDATE_COUNT")

    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def is_production(self) -> bool:
        return str(self.environment or "").strip().lower() in {"prod", "production"}

    def validate_runtime(self) -> None:
        if not self.enforce_production_safety or not self.is_production():
            return
        if self.database_url.startswith("sqlite"):
            raise ValueError("Production runtime requires a PostgreSQL-compatible DATABASE_URL, not SQLite.")
        if str(self.auth_cookie_samesite or "").strip().lower() not in {"lax", "strict", "none"}:
            raise ValueError("AUTH_COOKIE_SAMESITE must be one of: lax, strict, none.")

settings = Settings()
