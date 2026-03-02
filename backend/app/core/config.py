from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl, Field
from typing import List

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    question_json_dir: str = Field(default="../questions", alias="QUESTION_JSON_DIR")
    material_dir: str = Field(default="../material", alias="MATERIAL_DIR")
    database_url: str = Field(default="sqlite:///./securityplus.db", alias="DATABASE_URL")
    bootstrap_schema: bool = Field(default=True, alias="BOOTSTRAP_SCHEMA")
    admin_api_key: str = Field(default="change-me", alias="ADMIN_API_KEY")
    auth_token_ttl_hours: int = Field(default=168, alias="AUTH_TOKEN_TTL_HOURS")
    auth_token_bytes: int = Field(default=32, alias="AUTH_TOKEN_BYTES")

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

settings = Settings()
