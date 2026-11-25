from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def utcnow():
    return datetime.now(timezone.utc)


class Repository(Base):
    __tablename__ = "repositories"
    id = Column(String(36), primary_key=True)
    name = Column(String(255), nullable=False)
    root_path = Column(Text, nullable=False)
    source = Column(String(32), nullable=False)
    imported_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_analyzed = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(24), default="queued", nullable=False)
    progress = Column(Integer, default=0, nullable=False)
    progress_message = Column(String(255), default="Queued", nullable=False)
    error = Column(Text, nullable=True)
    stats_json = Column(JSON, default=dict, nullable=False)
    current_branch = Column(String(255), nullable=True)
    current_commit = Column(String(64), nullable=True)


class FileRecord(Base):
    __tablename__ = "files"
    id = Column(String(64), primary_key=True)
    repository_id = Column(String(36), ForeignKey("repositories.id", ondelete="CASCADE"), index=True, nullable=False)
    path = Column(Text, nullable=False)
    language = Column(String(64), nullable=False)
    extension = Column(String(32), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    line_count = Column(Integer, nullable=True)
    is_binary = Column(Boolean, default=False, nullable=False)
    oversized = Column(Boolean, default=False, nullable=False)
    parsed = Column(Boolean, default=False, nullable=False)
    parse_error = Column(Text, nullable=True)


class Symbol(Base):
    __tablename__ = "symbols"
    id = Column(String(64), primary_key=True)
    repository_id = Column(String(36), ForeignKey("repositories.id", ondelete="CASCADE"), index=True, nullable=False)
    file_id = Column(String(64), ForeignKey("files.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String(512), nullable=False, index=True)
    qualified_name = Column(String(1024), nullable=False)
    kind = Column(String(32), nullable=False)
    line = Column(Integer, nullable=False)
    end_line = Column(Integer, nullable=False)
    docstring = Column(Text, nullable=True)
    source_preview = Column(Text, nullable=True)


class Dependency(Base):
    __tablename__ = "dependencies"
    id = Column(String(64), primary_key=True)
    repository_id = Column(String(36), ForeignKey("repositories.id", ondelete="CASCADE"), index=True, nullable=False)
    source_id = Column(String(64), nullable=False, index=True)
    target_id = Column(String(64), nullable=True, index=True)
    source_path = Column(Text, nullable=False)
    target_path = Column(Text, nullable=True)
    kind = Column(String(32), nullable=False)
    confidence = Column(String(24), nullable=False)
    detail = Column(Text, nullable=False)
    line = Column(Integer, nullable=True)


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"
    id = Column(String(36), primary_key=True)
    repository_id = Column(String(36), ForeignKey("repositories.id", ondelete="CASCADE"), index=True, nullable=False)
    status = Column(String(24), nullable=False)
    started_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    files_scanned = Column(Integer, default=0, nullable=False)
    symbols_found = Column(Integer, default=0, nullable=False)
    error = Column(Text, nullable=True)
