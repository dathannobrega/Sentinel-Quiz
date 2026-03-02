from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import (
    String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint, Text, Float
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

class ImportState(Base):
    __tablename__ = "import_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    sessions: Mapped[list["ExamSession"]] = relationship(back_populates="owner")
    tokens: Mapped[list["AuthToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    bookmarks: Mapped[list["UserBookmark"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    notes: Mapped[list["UserNote"]] = relationship(back_populates="user", cascade="all, delete-orphan")

class AuthToken(Base):
    __tablename__ = "auth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    user: Mapped["User"] = relationship(back_populates="tokens")


class UserBookmark(Base):
    __tablename__ = "user_bookmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user: Mapped["User | None"] = relationship(back_populates="bookmarks")
    question: Mapped["Question"] = relationship(back_populates="bookmarks")

    __table_args__ = (
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user: Mapped["User | None"] = relationship(back_populates="notes")
    question: Mapped["Question"] = relationship(back_populates="notes")

    __table_args__ = (
        UniqueConstraint("user_id", "question_id", name="uq_user_notes_user_question"),
        UniqueConstraint("client_key", "question_id", name="uq_user_notes_client_question"),
    )


class QuestionBank(Base):
    __tablename__ = "question_bank"

    stable_question_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    published_version_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    draft_version_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_status: Mapped[str] = mapped_column(String(24), nullable=False, default="published", index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    versions: Mapped[list["QuestionVersion"]] = relationship(back_populates="question_bank", cascade="all, delete-orphan")


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
    exam_id: Mapped[str] = mapped_column(String(128), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    multi_select: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(64), nullable=True)
    certification: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tags_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    approved_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    question_bank: Mapped["QuestionBank"] = relationship(back_populates="versions")
    options: Mapped[list["QuestionVersionOption"]] = relationship(back_populates="version", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("question_bank_id", "version_number", name="uq_question_versions_bank_version"),)


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    exam_id: Mapped[str] = mapped_column(String(128), ForeignKey("exams.id", ondelete="CASCADE"), nullable=False)

    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    multi_select: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(64), nullable=True)
    certification: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tags_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    exam: Mapped["Exam"] = relationship(back_populates="questions")
    options: Mapped[list["Option"]] = relationship(back_populates="question", cascade="all, delete-orphan")
    explanation: Mapped["Explanation"] = relationship(back_populates="question", cascade="all, delete-orphan", uselist=False)
    bookmarks: Mapped[list["UserBookmark"]] = relationship(back_populates="question", cascade="all, delete-orphan")
    notes: Mapped[list["UserNote"]] = relationship(back_populates="question", cascade="all, delete-orphan")

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    exam_id: Mapped[str] = mapped_column(String(128), nullable=True)  # null => mixed
    selection_strategy: Mapped[str] = mapped_column(String(24), nullable=False, default="standard", index=True)
    selection_mix_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=90)

    current_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, index=True)

    owner: Mapped["User | None"] = relationship(back_populates="sessions")
    questions: Mapped[list["SessionQuestion"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    answers: Mapped[list["SessionAnswer"]] = relationship(back_populates="session", cascade="all, delete-orphan")

class SessionQuestion(Base):
    __tablename__ = "session_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_sessions.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    session: Mapped["ExamSession"] = relationship(back_populates="questions")

    __table_args__ = (UniqueConstraint("session_id", "position", name="uq_session_position"),)

class SessionAnswer(Base):
    __tablename__ = "session_answers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_sessions.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)

    selected_keys: Mapped[str] = mapped_column(String(255), nullable=False)  # comma-separated keys
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)

    answered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    session: Mapped["ExamSession"] = relationship(back_populates="answers")

    __table_args__ = (UniqueConstraint("session_id", "question_id", name="uq_session_question_answer"),)


class StudySession(Base):
    __tablename__ = "study_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
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


class StudySessionQuestion(Base):
    __tablename__ = "study_session_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    session: Mapped["StudySession"] = relationship(back_populates="questions")

    __table_args__ = (UniqueConstraint("session_id", "position", name="uq_study_session_position"),)


class StudyAttempt(Base):
    __tablename__ = "study_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    selected_keys: Mapped[str] = mapped_column(String(255), nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    confidence_level: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    elapsed_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    answered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    session: Mapped["StudySession"] = relationship(back_populates="attempts")

    __table_args__ = (UniqueConstraint("session_id", "question_id", name="uq_study_attempt_session_question"),)


class ReviewQueueItem(Base):
    __tablename__ = "review_queue"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    client_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    question_id: Mapped[str] = mapped_column(String(128), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    due_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    repetition_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lapse_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ease_factor: Mapped[float] = mapped_column(Float, nullable=False, default=2.5)
    stability_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_quality: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_outcome: Mapped[str] = mapped_column(String(16), nullable=False, default="wrong")
    confidence_level: Mapped[str] = mapped_column(String(16), nullable=False, default="low")
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    schedules: Mapped[list["ReviewSchedule"]] = relationship(back_populates="queue_item", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("user_id", "question_id", name="uq_review_queue_user_question"),
        UniqueConstraint("client_key", "question_id", name="uq_review_queue_client_question"),
    )


class ReviewSchedule(Base):
    __tablename__ = "review_schedule"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_queue_id: Mapped[int] = mapped_column(Integer, ForeignKey("review_queue.id", ondelete="CASCADE"), nullable=False, index=True)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False)
    trigger_reason: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    queue_item: Mapped["ReviewQueueItem"] = relationship(back_populates="schedules")
