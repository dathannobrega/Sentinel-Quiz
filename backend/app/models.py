from __future__ import annotations

from datetime import datetime
from sqlalchemy import (
    String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint, Text
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

    exam_id: Mapped[str] = mapped_column(String(128), nullable=True)  # null => mixed
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=90)

    current_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)

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
