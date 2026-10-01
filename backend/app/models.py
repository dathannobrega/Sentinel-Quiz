from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import (
    BigInteger, String, Integer, Boolean, ForeignKey, JSON, UniqueConstraint, Text, Float, CheckConstraint, Index,
    text, true, false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.clock import utcnow
from app.db.base import Base
from app.db.types import UTCDateTime


# Closed value sets enforced with CHECK constraints (migration 0014).
USER_ROLES = ("student", "editor", "reviewer", "admin")
QUESTION_DIFFICULTIES = ("Easy", "Medium", "Hard")
QUESTION_VERSION_STATUSES = ("draft", "in_review", "approved", "published", "archived")
QUESTION_ISSUE_STATUSES = ("open", "triaged", "fix_in_progress", "verified", "released", "dismissed")
# Student-facing question formats (migration 0017): multiple choice or performance-based.
QUESTION_FORMATS = ("mcq", "pbq")
# Content licence of a question (0018): own = authored/audited by the platform,
# platform = third-party source with reuse permission, pending_audit = provenance not
# audited yet, personal_use = private study only (never shown in live quizzes).
LICENSE_SCOPES = ("own", "platform", "pending_audit", "personal_use")
# Sentinel Arena (0019).
LIVE_ITEM_TYPES = (
    "single_choice", "multi_choice", "true_false", "type_answer", "poll", "content", "leaderboard",
    "ordering", "numeric", "word_cloud",  # GA types (Incremento 5)
)
LIVE_SOURCE_KINDS = ("custom", "bank", "ai")
LIVE_REVIEW_STATES = ("ok", "needs_review")
LIVE_SESSION_STATUSES = ("lobby", "live", "finished")
LIVE_SESSION_PHASES = ("lobby", "question", "locked", "reveal", "leaderboard", "content", "podium", "finished")
LIVE_ANSWER_EVENT_TYPES = ("submitted", "host_accepted")
LIVE_ACTIVE_SESSION_STATUSES = ("lobby", "live")
LIVE_MODERATION_STATES = ("clear", "flagged", "approved", "blocked")
LIVE_CASE_SOURCES = ("participant", "filter", "admin")
LIVE_CASE_STATUSES = ("open", "dismissed", "actioned")
LIVE_CASE_REASONS = ("offensive", "spam", "cheating", "copyright", "privacy", "other", "filter_match")
# AI authoring (0020).
AI_JOB_KINDS = ("generate", "from_source", "improve")
AI_JOB_STATUSES = ("queued", "running", "succeeded", "failed", "degraded")
# Why a question projection was deactivated (soft delete).
QUESTION_DEACTIVATED_DELETED = "deleted"
QUESTION_DEACTIVATED_REMOVED_FROM_SOURCE = "removed_from_source"


def _sql_in(column: str, values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({joined})"


# Kept as an alias of app.core.clock.utcnow (aware UTC).
utcnow_aware = utcnow

class ImportState(Base):
    __tablename__ = "import_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    imported_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("file_name", "file_sha256", name="uq_import_file_hash"),)

class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(String(255), nullable=True)
    question_count: Mapped[int] = mapped_column(Integer, nullable=True)

    questions: Mapped[list["Question"]] = relationship(back_populates="exam", cascade="all, delete-orphan")

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="student")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    # Sessions are removed together with the user (FK ON DELETE CASCADE); SET NULL would
    # violate the owner XOR check constraint on exam_sessions/study_sessions.
    sessions: Mapped[list["ExamSession"]] = relationship(
        back_populates="owner",
        cascade="all",
        passive_deletes=True,
    )
    tokens: Mapped[list["AuthToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    auth_challenges: Mapped[list["AuthChallenge"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    bookmarks: Mapped[list["UserBookmark"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    notes: Mapped[list["UserNote"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(_sql_in("role", USER_ROLES), name="ck_users_role_allowed"),
    )

class AuthToken(Base):
    __tablename__ = "auth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)

    user: Mapped["User"] = relationship(back_populates="tokens")


class AuthChallenge(Base):
    __tablename__ = "auth_challenges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    challenge_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    delivery_target: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)

    user: Mapped["User"] = relationship(back_populates="auth_challenges")


class UserBookmark(Base):
    __tablename__ = "user_bookmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    user: Mapped["User | None"] = relationship(back_populates="bookmarks")
    question: Mapped["Question"] = relationship(back_populates="bookmarks")

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_user_bookmarks_owner_scope_xor",
        ),
        UniqueConstraint("user_id", "question_id", name="uq_user_bookmarks_user_question"),
        UniqueConstraint("client_key", "question_id", name="uq_user_bookmarks_client_question"),
    )


class UserNote(Base):
    __tablename__ = "user_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    note_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    user: Mapped["User | None"] = relationship(back_populates="notes")
    question: Mapped["Question"] = relationship(back_populates="notes")

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_user_notes_owner_scope_xor",
        ),
        UniqueConstraint("user_id", "question_id", name="uq_user_notes_user_question"),
        UniqueConstraint("client_key", "question_id", name="uq_user_notes_client_question"),
    )


class QuestionBank(Base):
    __tablename__ = "question_bank"

    stable_question_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    # question_bank <-> question_versions is a reference cycle; use_alter lets the
    # DDL add these FKs after both tables exist.
    published_version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "question_versions.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_question_bank_published_version_id",
        ),
        nullable=True,
    )
    draft_version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "question_versions.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_question_bank_draft_version_id",
        ),
        nullable=True,
    )
    review_status: Mapped[str] = mapped_column(String(24), nullable=False, default="published", index=True)
    # sha256 of the last imported payload signature ("legacy-import" for pre-0014 rows).
    # NULL means the question was never imported from the JSON source.
    last_import_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    versions: Mapped[list["QuestionVersion"]] = relationship(
        back_populates="question_bank",
        cascade="all, delete-orphan",
        foreign_keys="QuestionVersion.question_bank_id",
    )

    __table_args__ = (
        CheckConstraint(_sql_in("review_status", QUESTION_VERSION_STATUSES), name="ck_question_bank_review_status"),
    )


class DomainCatalog(Base):
    __tablename__ = "domain_catalog"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    certification: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    domain: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    subdomain: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    objective_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    blueprint_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "certification",
            "domain",
            "subdomain",
            "objective_code",
            "blueprint_code",
            name="uq_domain_catalog_identity",
        ),
    )


class DomainBlueprint(Base):
    __tablename__ = "domain_blueprint"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    certification: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    blueprint_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    objective_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    subdomain: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Official exam weight (percent) of the domain. Only domain-level rows carry a weight;
    # objective-level rows created by the editorial flow keep it NULL.
    weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "certification",
            "blueprint_code",
            "objective_code",
            name="uq_domain_blueprint_identity",
        ),
        # One weighted (domain-level) row per certification + domain.
        Index(
            "uq_domain_blueprint_weighted_domain",
            "certification",
            "domain",
            unique=True,
            postgresql_where=text("weight IS NOT NULL"),
            sqlite_where=text("weight IS NOT NULL"),
        ),
    )


class QuestionVersion(Base):
    __tablename__ = "question_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_bank_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("question_bank.stable_question_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft", index=True)
    exam_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("exams.id", ondelete="SET NULL"), nullable=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    multi_select: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(64), nullable=True)
    certification: Mapped[str | None] = mapped_column(String(64), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subtopic: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subdomain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    objective_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    blueprint_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    keywords_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    trap_patterns_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    question_format: Mapped[str] = mapped_column(String(32), nullable=False, default="single_choice", index=True)
    tags_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    correct_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    incorrect_rationales_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    avg_time_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    global_accuracy_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    approved_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    # sha256 of the imported payload signature when this version was created by the JSON
    # import ("legacy-import"/"seeded-projection" markers for rows that predate 0014).
    # NULL => created editorially; ingest never overwrites an editorial published version.
    import_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Performance-based questions (question_format == "pbq", migration 0017): public
    # payload (title, scenario, exhibits, tasks without solutions) and the private
    # answer key (solutions, scoring, explanations), both JSON text.
    pbq_payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    pbq_answer_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    question_bank: Mapped["QuestionBank"] = relationship(back_populates="versions", foreign_keys=[question_bank_id])
    options: Mapped[list["QuestionVersionOption"]] = relationship(back_populates="version", cascade="all, delete-orphan")
    references: Mapped[list["QuestionReference"]] = relationship(back_populates="version", cascade="all, delete-orphan")
    hint_rows: Mapped[list["QuestionHint"]] = relationship(back_populates="version", cascade="all, delete-orphan")
    reference_catalog_rows: Mapped[list["ReferenceCatalog"]] = relationship(back_populates="version", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("question_bank_id", "version_number", name="uq_question_versions_bank_version"),
        CheckConstraint(_sql_in("status", QUESTION_VERSION_STATUSES), name="ck_question_versions_status"),
        CheckConstraint(
            "difficulty IS NULL OR " + _sql_in("difficulty", QUESTION_DIFFICULTIES),
            name="ck_question_versions_difficulty",
        ),
    )


class QuestionVersionOption(Base):
    __tablename__ = "question_version_options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("question_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    key: Mapped[str] = mapped_column(String(8), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    version: Mapped["QuestionVersion"] = relationship(back_populates="options")

    __table_args__ = (UniqueConstraint("version_id", "key", name="uq_question_version_options_version_key"),)


class QuestionReference(Base):
    __tablename__ = "question_references"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_version_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("question_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    chapter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    locator: Mapped[str | None] = mapped_column(String(255), nullable=True)
    material_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    page_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    version: Mapped["QuestionVersion"] = relationship(back_populates="references")


class QuestionHint(Base):
    __tablename__ = "question_hints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_version_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("question_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    hint_text: Mapped[str] = mapped_column(Text, nullable=False)
    hint_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="concept")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    version: Mapped["QuestionVersion"] = relationship(back_populates="hint_rows")

    __table_args__ = (
        CheckConstraint("level >= 1 AND level <= 3", name="ck_question_hints_level_range"),
        UniqueConstraint("question_version_id", "level", name="uq_question_hints_version_level"),
    )


class ReferenceCatalog(Base):
    __tablename__ = "reference_catalog"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("question_versions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    certification: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    subdomain: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    objective_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    blueprint_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    reference_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    material_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    locator: Mapped[str | None] = mapped_column(String(255), nullable=True)
    page_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_official: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    version: Mapped["QuestionVersion | None"] = relationship(back_populates="reference_catalog_rows")


class EditorialAuditLog(Base):
    __tablename__ = "editorial_audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_bank_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    question_version_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False, index=True)


class QuestionStatsSnapshot(Base):
    __tablename__ = "question_stats_snapshot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    capture_batch_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("question_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    exam_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    certification: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    attempts_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exam_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    study_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_rate_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    low_confidence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    low_confidence_rate_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    review_pressure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    avg_study_elapsed_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False, index=True)


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    exam_id: Mapped[str] = mapped_column(String(128), ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True)

    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    multi_select: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    difficulty: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    certification: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    tags_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Soft delete: inactive questions are hidden from new sessions but keep student history.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true(), index=True)
    deactivated_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # Content language of the question text, e.g. "en" or "pt-BR".
    language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Editorial flags so admins can find incomplete content.
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false(), index=True)
    explanation_missing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false(), index=True)
    # "mcq" (options) | "pbq" (performance-based: pbq_payload_json/pbq_answer_json), 0017.
    question_format: Mapped[str] = mapped_column(String(8), nullable=False, default="mcq", server_default=text("'mcq'"), index=True)
    pbq_payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    pbq_answer_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Content licence (0018, PLANO §11.1/§15.4): who may see this question outside the
    # study product. Classified by provenance at ingest; unknown => "pending_audit".
    license_scope: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending_audit", server_default=text("'pending_audit'"), index=True
    )
    source_license: Mapped[str | None] = mapped_column(String(64), nullable=True)

    exam: Mapped["Exam"] = relationship(back_populates="questions")
    options: Mapped[list["Option"]] = relationship(back_populates="question", cascade="all, delete-orphan")
    explanation: Mapped["Explanation"] = relationship(back_populates="question", cascade="all, delete-orphan", uselist=False)
    bookmarks: Mapped[list["UserBookmark"]] = relationship(back_populates="question", cascade="all, delete-orphan")
    notes: Mapped[list["UserNote"]] = relationship(back_populates="question", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_questions_certification_domain", "certification", "domain"),
        CheckConstraint(
            "difficulty IS NULL OR " + _sql_in("difficulty", QUESTION_DIFFICULTIES),
            name="ck_questions_difficulty",
        ),
        CheckConstraint(_sql_in("question_format", QUESTION_FORMATS), name="ck_questions_question_format"),
        CheckConstraint(_sql_in("license_scope", LICENSE_SCOPES), name="ck_questions_license_scope"),
    )

class Option(Base):
    __tablename__ = "options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)

    key: Mapped[str] = mapped_column(String(8), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    question: Mapped["Question"] = relationship(back_populates="options")

    __table_args__ = (UniqueConstraint("question_id", "key", name="uq_option_question_key"),)

class Explanation(Base):
    __tablename__ = "explanations"

    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True)
    justification: Mapped[str] = mapped_column(Text, nullable=True)

    question: Mapped["Question"] = relationship(back_populates="explanation")

class ExamSession(Base):
    __tablename__ = "exam_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    exam_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("exams.id", ondelete="SET NULL"), nullable=True)  # null => mixed
    selection_strategy: Mapped[str] = mapped_column(String(24), nullable=False, default="standard", index=True)
    selection_mix_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    experience_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="standard", index=True)

    current_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=True, index=True)

    owner: Mapped["User | None"] = relationship(back_populates="sessions")
    questions: Mapped[list["SessionQuestion"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    answers: Mapped[list["SessionAnswer"]] = relationship(back_populates="session", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_exam_sessions_owner_scope_xor",
        ),
    )

class SessionQuestion(Base):
    __tablename__ = "session_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_sessions.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    marked_for_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_viewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    # JSON list of option keys in the order shown to the student (per-session shuffle).
    option_order_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # PBQ per-session shuffle: {task_id: [item ids in display order]} (0017).
    pbq_order_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    session: Mapped["ExamSession"] = relationship(back_populates="questions")

    __table_args__ = (UniqueConstraint("session_id", "position", name="uq_session_position"),)

class SessionAnswer(Base):
    __tablename__ = "session_answers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_sessions.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False, index=True)
    # Published question version the student actually answered (filled by the runtime).
    question_version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("question_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    selected_keys: Mapped[str] = mapped_column(String(255), nullable=False)  # comma-separated keys
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    elapsed_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # PBQ answers (0017): the learner's response (JSON) and the partial-credit score 0..1.
    response_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)

    answered_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    session: Mapped["ExamSession"] = relationship(back_populates="answers")

    __table_args__ = (UniqueConstraint("session_id", "question_id", name="uq_session_question_answer"),)


class QuestionIssue(Base):
    __tablename__ = "question_issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("question_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="exam", index=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    triaged_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    triaged_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    resolved_version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("question_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    resolved_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_question_issues_owner_scope_xor",
        ),
        CheckConstraint(_sql_in("status", QUESTION_ISSUE_STATUSES), name="ck_question_issues_status"),
    )


class PlacementState(Base):
    __tablename__ = "placement_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    placement_completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    placement_exam_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    placement_question_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_placement_state_owner_scope_xor",
        ),
        UniqueConstraint("user_id", name="uq_placement_state_user"),
        UniqueConstraint("client_key", name="uq_placement_state_client"),
    )


class StudySession(Base):
    __tablename__ = "study_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    exam_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    selection_strategy: Mapped[str] = mapped_column(String(24), nullable=False, default="standard", index=True)
    selection_mix_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    current_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    answered_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    questions: Mapped[list["StudySessionQuestion"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    attempts: Mapped[list["StudyAttempt"]] = relationship(back_populates="session", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_study_sessions_owner_scope_xor",
        ),
    )


class StudySessionQuestion(Base):
    __tablename__ = "study_session_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    # JSON list of option keys in the order shown to the student (per-session shuffle).
    option_order_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # PBQ per-session shuffle: {task_id: [item ids in display order]} (0017).
    pbq_order_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    session: Mapped["StudySession"] = relationship(back_populates="questions")

    __table_args__ = (UniqueConstraint("session_id", "position", name="uq_study_session_position"),)


class StudyAttempt(Base):
    __tablename__ = "study_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False, index=True)
    # Published question version the student actually answered (filled by the runtime).
    question_version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("question_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    selected_keys: Mapped[str] = mapped_column(String(255), nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    confidence_level: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    elapsed_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    answered_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False, index=True)
    # PBQ answers (0017): the learner's response (JSON) and the partial-credit score 0..1.
    response_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)

    session: Mapped["StudySession"] = relationship(back_populates="attempts")

    __table_args__ = (UniqueConstraint("session_id", "question_id", name="uq_study_attempt_session_question"),)


class ReviewQueueItem(Base):
    __tablename__ = "review_queue"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False, index=True)
    due_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    repetition_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lapse_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ease_factor: Mapped[float] = mapped_column(Float, nullable=False, default=2.5)
    stability_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_quality: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_outcome: Mapped[str] = mapped_column(String(16), nullable=False, default="wrong")
    confidence_level: Mapped[str] = mapped_column(String(16), nullable=False, default="low")
    last_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    schedules: Mapped[list["ReviewSchedule"]] = relationship(back_populates="queue_item", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_review_queue_owner_scope_xor",
        ),
        UniqueConstraint("user_id", "question_id", name="uq_review_queue_user_question"),
        UniqueConstraint("client_key", "question_id", name="uq_review_queue_client_question"),
    )


class ReviewSchedule(Base):
    __tablename__ = "review_schedule"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_queue_id: Mapped[int] = mapped_column(Integer, ForeignKey("review_queue.id", ondelete="CASCADE"), nullable=False, index=True)
    scheduled_for: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False)
    trigger_reason: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    queue_item: Mapped["ReviewQueueItem"] = relationship(back_populates="schedules")


class UserQuestionProgress(Base):
    __tablename__ = "user_question_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False, index=True)
    first_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False, index=True)
    total_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exam_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    study_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mastery_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="exam")
    last_confidence_level: Mapped[str | None] = mapped_column(String(16), nullable=True)
    last_is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_user_question_progress_owner_scope_xor",
        ),
        UniqueConstraint("user_id", "question_id", name="uq_user_question_progress_user_question"),
        UniqueConstraint("client_key", "question_id", name="uq_user_question_progress_client_question"),
    )


class UserGoal(Base):
    __tablename__ = "user_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    daily_question_target: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    daily_review_target: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    weekly_question_target: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    weekly_review_target: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    stretch_question_target: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_user_goals_owner_scope_xor",
        ),
        UniqueConstraint("user_id", name="uq_user_goals_user"),
        UniqueConstraint("client_key", name="uq_user_goals_client"),
    )


class UserStreak(Base):
    __tablename__ = "user_streaks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    current_streak_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    best_streak_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_active_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_activity_date: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    last_goal_completed_date: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_user_streaks_owner_scope_xor",
        ),
        UniqueConstraint("user_id", name="uq_user_streaks_user"),
        UniqueConstraint("client_key", name="uq_user_streaks_client"),
    )


class AdaptiveProfile(Base):
    __tablename__ = "adaptive_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    weak_domain_focus_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    low_confidence_bias: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    variety_floor_percent: Mapped[float] = mapped_column(Float, nullable=False, default=30.0)
    recovery_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_recomputed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_adaptive_profile_owner_scope_xor",
        ),
        UniqueConstraint("user_id", name="uq_adaptive_profile_user"),
        UniqueConstraint("client_key", name="uq_adaptive_profile_client"),
    )


class UserDomainMetricDaily(Base):
    __tablename__ = "user_domain_metrics_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    metric_date: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    exam_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    certification: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    domain: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    attempts_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exam_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    study_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    low_confidence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_elapsed_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    timed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_user_domain_metrics_daily_owner_scope_xor",
        ),
        UniqueConstraint(
            "user_id",
            "metric_date",
            "exam_id",
            "domain",
            name="uq_user_domain_metrics_daily_user",
        ),
        UniqueConstraint(
            "client_key",
            "metric_date",
            "exam_id",
            "domain",
            name="uq_user_domain_metrics_daily_client",
        ),
    )


class UserExamMetricsSnapshot(Base):
    __tablename__ = "user_exam_metrics_snapshot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True, index=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="exam", index=True)
    exam_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    selection_strategy: Mapped[str | None] = mapped_column(String(24), nullable=True)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    answered_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    score_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weakest_domains_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_due_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_user_exam_metrics_snapshot_owner_scope_xor",
        ),
    )


class WeeklyProgressSnapshot(Base):
    __tablename__ = "weekly_progress_snapshot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    week_start: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    questions_answered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    scheduled_reviews: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    low_confidence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_exam_sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_study_sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_review_sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_due_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) <> (client_key IS NULL)",
            name="ck_weekly_progress_snapshot_owner_scope_xor",
        ),
        UniqueConstraint("user_id", "week_start", name="uq_weekly_progress_snapshot_user"),
        UniqueConstraint("client_key", "week_start", name="uq_weekly_progress_snapshot_client"),
    )


class StudyModule(Base):
    """Ordered study track (modules/domains) per certification, loaded from material/."""

    __tablename__ = "study_modules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    certification: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Codes of the modules (same certification) to complete first; NULL/[] = none (0016).
    prerequisite_codes: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    source_file: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow_aware, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow_aware, onupdate=utcnow_aware, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("certification", "code", name="uq_study_modules_certification_code"),
        Index("ix_study_modules_certification_position", "certification", "position"),
    )


# --------------------------------------------------------------------------- Sentinel Arena
# Live interactive quizzes (migration 0019, docs/live-quiz/PLANO.md §11). Live answers are
# never written to session_answers/study_attempts (DC-18); guests have neither user_id nor
# client_key, so none of these tables reuse the owner XOR check.

class LiveQuiz(Base):
    __tablename__ = "live_quiz"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="pt-BR")
    theme_key: Mapped[str] = mapped_column(String(32), nullable=False, default="sentinel")
    settings_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Optimistic lock: every mutation must send the version it read (409 otherwise).
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    published_version_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Draft ``version`` captured at the last publish: differs => unpublished changes.
    published_at_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    forked_from_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("live_quiz.id", ondelete="SET NULL"), nullable=True
    )
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # Blocked by moderation (RF-1114): cannot be presented until an admin unblocks it.
    blocked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    items: Mapped[list["LiveQuizItem"]] = relationship(
        back_populates="quiz", cascade="all, delete-orphan", passive_deletes=True, order_by="LiveQuizItem.position"
    )

    __table_args__ = (Index("ix_live_quiz_owner_updated", "owner_user_id", "updated_at"),)


class LiveQuizItem(Base):
    """Draft item of a quiz. Public payload and answer key are stored separately."""

    __tablename__ = "live_quiz_item"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    quiz_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    item_type: Mapped[str] = mapped_column(String(24), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(8), nullable=False, default="custom")
    source_question_id: Mapped[str | None] = mapped_column(
        String(128), ForeignKey("questions.id", ondelete="SET NULL"), nullable=True
    )
    source_version_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("question_versions.id", ondelete="SET NULL"), nullable=True
    )
    prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Public payload: {"options": [{"key", "text"}], "allow_multiple", "all_or_nothing", "body"}.
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Answer key: {"correct_keys": [...], "accepted_answers": [...]} (never sent to players early).
    answer_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    presenter_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    time_limit_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    points_multiplier: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    license_scope: Mapped[str] = mapped_column(String(24), nullable=False, default="own")
    review_state: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    certification: Mapped[str | None] = mapped_column(String(64), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(64), nullable=True)
    objective_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # AI provenance (0020): {"job_id", "model", "issues", "critic", "requires_key_confirmation"}.
    origin_meta_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reviewed_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    quiz: Mapped["LiveQuiz"] = relationship(back_populates="items")

    __table_args__ = (
        UniqueConstraint("quiz_id", "position", name="uq_live_quiz_item_position"),
        Index("ix_live_quiz_item_source_question", "source_question_id"),
        CheckConstraint(_sql_in("item_type", LIVE_ITEM_TYPES), name="ck_live_quiz_item_type"),
        CheckConstraint(_sql_in("source_kind", LIVE_SOURCE_KINDS), name="ck_live_quiz_item_source_kind"),
        CheckConstraint(_sql_in("review_state", LIVE_REVIEW_STATES), name="ck_live_quiz_item_review_state"),
        CheckConstraint(_sql_in("license_scope", LICENSE_SCOPES), name="ck_live_quiz_item_license_scope"),
        CheckConstraint("points_multiplier IN (0, 1, 2)", name="ck_live_quiz_item_multiplier"),
    )


class LiveQuizVersion(Base):
    """Immutable published snapshot (content + answer key) that sessions run from (DC-14)."""

    __tablename__ = "live_quiz_version"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    quiz_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    theme_key: Mapped[str] = mapped_column(String(32), nullable=False)
    settings_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    items_snapshot_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    snapshot_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    published_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    published_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    # Content moderation at publish (RF-1112): "flagged" versions do not reach guests until
    # an admin approves them; positions removed by moderation are hidden in every session.
    moderation_state: Mapped[str] = mapped_column(String(16), nullable=False, default="clear", server_default="clear")
    moderation_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        UniqueConstraint("quiz_id", "version_no", name="uq_live_quiz_version_no"),
        CheckConstraint(_sql_in("moderation_state", LIVE_MODERATION_STATES), name="ck_live_quiz_version_moderation_state"),
    )


class LiveSession(Base):
    """One run of a published quiz version. Authoritative room state lives here."""

    __tablename__ = "live_session"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    quiz_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=False)
    quiz_version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("live_quiz_version.id", ondelete="RESTRICT"), nullable=False
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="live")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="lobby")
    phase: Mapped[str] = mapped_column(String(16), nullable=False, default="lobby")
    # Monotonic room-state sequence (seq of the WebSocket envelopes).
    state_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    answers_open_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    deadline_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # Host pause: the timer is frozen from here; resume shifts answers_open_at/deadline_at.
    paused_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # Positions removed by moderation while the room is open (RF-1114).
    hidden_positions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Word-cloud words the host hid from the projector: {"<position>": [normalized, ...]}.
    hidden_words: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Retention (RF-1109): names anonymized / raw events purged; the report survives as
    # an aggregated snapshot taken before the purge.
    names_anonymized_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    events_purged_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    report_snapshot_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    join_code: Mapped[str] = mapped_column(String(8), nullable=False)
    # Self-paced challenges (mode "self_paced", E1.10): permanent link /q/{share_slug},
    # answering window and the "opened the link" counter of the funnel (RF-1029).
    share_slug: Mapped[str | None] = mapped_column(String(16), nullable=True)
    opens_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    allow_guests: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    room_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    max_participants: Mapped[int] = mapped_column(Integer, nullable=False, default=1000)
    preset: Mapped[str] = mapped_column(String(16), nullable=False, default="turma")
    audience: Mapped[str] = mapped_column(String(16), nullable=False, default="adulto")
    theme_key: Mapped[str] = mapped_column(String(32), nullable=False, default="sentinel")
    settings_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    consent_version: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (
        # A PIN is unique among ACTIVE sessions only; finished sessions release it.
        Index(
            "uq_live_session_active_code",
            "join_code",
            unique=True,
            postgresql_where=text("status IN ('lobby', 'live')"),
            sqlite_where=text("status IN ('lobby', 'live')"),
        ),
        Index("uq_live_session_share_slug", "share_slug", unique=True),
        Index("ix_live_session_owner_created", "owner_user_id", "created_at"),
        Index("ix_live_session_quiz_created", "quiz_id", "created_at"),
        CheckConstraint(_sql_in("status", LIVE_SESSION_STATUSES), name="ck_live_session_status"),
        CheckConstraint(_sql_in("phase", LIVE_SESSION_PHASES), name="ck_live_session_phase"),
    )


class LiveSessionItem(Base):
    """Timeline of each item inside a session (reports and crash recovery)."""

    __tablename__ = "live_session_item"

    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("live_session.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    state: Mapped[str] = mapped_column(String(12), nullable=False, default="open")
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    answers_open_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    deadline_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    lock_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)
    revealed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class LiveParticipant(Base):
    __tablename__ = "live_participant"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    display_name: Mapped[str] = mapped_column(String(24), nullable=False)
    nickname_norm: Mapped[str] = mapped_column(String(48), nullable=False)
    avatar_seed: Mapped[str] = mapped_column(String(16), nullable=False)
    # sha256 of the current token jti (revocation) and of the one-time return code.
    token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    return_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    consent_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    kicked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    banned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Extended time (RF-622): 1 (default), 1.5, 2 or 0 (untimed).
    time_multiplier: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1.0")
    # Rehearsal bot (RF-513): excluded from reports and exports.
    is_bot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    # Host's own phone preview in a rehearsal (RF-514): a real client, never in reports.
    is_preview: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    # LGPD (RF-650): erased = anonymized on request; claimed = linked to an account (RF-633).
    erased_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    final_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    final_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("session_id", "nickname_norm", name="uq_live_participant_nickname"),
        Index(
            "uq_live_participant_session_user",
            "session_id",
            "user_id",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
            sqlite_where=text("user_id IS NOT NULL"),
        ),
        Index("ix_live_participant_user", "user_id"),
        CheckConstraint("time_multiplier IN (0, 1, 1.5, 2)", name="ck_live_participant_time_multiplier"),
    )


LIVE_ATTEMPT_STATUSES = ("in_progress", "finished")


class LiveAttempt(Base):
    """One run of a self-paced challenge by a participant (E1.10, RF-801..813).

    The item order and option shuffle are fixed at the start; ``current_index`` and
    ``item_started_at`` drive the lazy per-item deadline (RF-803); ``deadline_at`` is the
    optional total time (RF-804), already capped at the challenge's ``closes_at``.
    """

    __tablename__ = "live_attempt"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False)
    participant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("live_participant.id", ondelete="CASCADE"), nullable=False
    )
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="in_progress")
    item_order_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    current_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    item_started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    deadline_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finish_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    answered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # RF-813: another participant of the same device already played this challenge.
    repeat_suspect: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    __table_args__ = (
        UniqueConstraint("session_id", "participant_id", "attempt_no", name="uq_live_attempt_no"),
        Index("ix_live_attempt_session_status", "session_id", "status"),
        CheckConstraint(_sql_in("status", LIVE_ATTEMPT_STATUSES), name="ck_live_attempt_status"),
    )


class LiveAnswerEvent(Base):
    """Append-only answer log (PostgreSQL: UPDATE blocked by trigger, migration 0019)."""

    __tablename__ = "live_answer_event"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    participant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("live_participant.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(16), nullable=False, default="submitted")
    # Self-paced attempt (1 for live sessions): each attempt answers every item once.
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # Original option keys (never the per-session opaque ids) or {"text": ...}.
    response_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    score_fraction: Mapped[float | None] = mapped_column(Float, nullable=True)
    points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Server-measured ms since answers opened (fastest/tie-break) and the latency-credited
    # value used for scoring.
    server_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_elapsed_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    suspicious: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    idempotency_key: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "session_id", "position", "participant_id", "event_type", "attempt_no", name="uq_live_answer_event_once"
        ),
        Index("ix_live_answer_event_session_position", "session_id", "position"),
        Index("ix_live_answer_event_received", "received_at"),
        CheckConstraint(_sql_in("event_type", LIVE_ANSWER_EVENT_TYPES), name="ck_live_answer_event_type"),
    )


class AiJob(Base):
    """Asynchronous AI authoring job (PLANO §12.1). Consumed by the in-process runner or
    by the ``ai-worker`` process (``SELECT ... FOR UPDATE SKIP LOCKED``)."""

    __tablename__ = "ai_job"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    quiz_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=True)
    item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("live_quiz_item.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    # Request (source text is purged after the job finishes: PLANO §11.2 retention).
    input_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    applied_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    prompt_id: Mapped[str | None] = mapped_column(String(48), nullable=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    critic_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tokens_in: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    credits: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(300), nullable=True)
    injection_suspected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (
        Index("ix_ai_job_status_created", "status", "created_at"),
        Index("ix_ai_job_owner_created", "owner_user_id", "created_at"),
        Index("ix_ai_job_quiz_created", "quiz_id", "created_at"),
        CheckConstraint(_sql_in("kind", AI_JOB_KINDS), name="ck_ai_job_kind"),
        CheckConstraint(_sql_in("status", AI_JOB_STATUSES), name="ck_ai_job_status"),
    )


class AiUsageLedger(Base):
    """Credits reserved/refunded per job (quota source of truth, PLANO §12.7)."""

    __tablename__ = "ai_usage_ledger"

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("ai_job.id", ondelete="SET NULL"), nullable=True)
    feature: Mapped[str] = mapped_column(String(24), nullable=False)
    # Positive = reserved/consumed, negative = refund.
    credits: Mapped[float] = mapped_column(Float, nullable=False)
    tokens_in: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (Index("ix_ai_usage_ledger_owner_at", "owner_user_id", "at"),)


class LiveModerationTerm(Base):
    """Admin-managed filter terms (RF-1107): block or allow, for names, content or both."""

    __tablename__ = "live_moderation_term"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    term: Mapped[str] = mapped_column(String(64), nullable=False)
    match: Mapped[str] = mapped_column(String(16), nullable=False, default="token")
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="block")
    scope: Mapped[str] = mapped_column(String(8), nullable=False, default="all")
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("term", "kind", "scope", name="uq_live_moderation_term"),
        CheckConstraint("match IN ('substring', 'token')", name="ck_live_moderation_term_match"),
        CheckConstraint("kind IN ('block', 'allow')", name="ck_live_moderation_term_kind"),
        CheckConstraint("scope IN ('names', 'content', 'all')", name="ck_live_moderation_term_scope"),
    )


class LiveModerationCase(Base):
    """Moderation queue (RF-1104/1112/1114): participant reports and filter flags."""

    __tablename__ = "live_moderation_case"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    reason: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    excerpt: Mapped[str | None] = mapped_column(String(500), nullable=True)
    details_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    quiz_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=True)
    quiz_version_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("live_quiz_version.id", ondelete="CASCADE"), nullable=True
    )
    session_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("live_session.id", ondelete="SET NULL"), nullable=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reporter_participant_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("live_participant.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    resolved_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(24), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        CheckConstraint(_sql_in("source", LIVE_CASE_SOURCES), name="ck_live_moderation_case_source"),
        CheckConstraint(_sql_in("status", LIVE_CASE_STATUSES), name="ck_live_moderation_case_status"),
        CheckConstraint(_sql_in("reason", LIVE_CASE_REASONS), name="ck_live_moderation_case_reason"),
        Index("ix_live_moderation_case_status_created", "status", "created_at"),
        Index("ix_live_moderation_case_session", "session_id"),
    )


class LiveAuditEvent(Base):
    """Arena audit trail (RF-1103/1110/1114, LGPD): who did what, on which session, and why."""

    __tablename__ = "live_audit_event"

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    quiz_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    target: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    meta_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (
        Index("ix_live_audit_event_session", "session_id", "created_at"),
        Index("ix_live_audit_event_created", "created_at"),
    )
