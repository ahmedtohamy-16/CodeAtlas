"""Initial repository analysis schema.

Revision ID: 0001_initial
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "repositories",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("root_path", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_analyzed", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("progress_message", sa.String(length=255), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("stats_json", sa.JSON(), nullable=False),
        sa.Column("current_branch", sa.String(length=255), nullable=True),
        sa.Column("current_commit", sa.String(length=64), nullable=True),
    )
    op.create_table(
        "files",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("repository_id", sa.String(length=36), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("language", sa.String(length=64), nullable=False),
        sa.Column("extension", sa.String(length=32), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("line_count", sa.Integer(), nullable=True),
        sa.Column("is_binary", sa.Boolean(), nullable=False),
        sa.Column("oversized", sa.Boolean(), nullable=False),
        sa.Column("parsed", sa.Boolean(), nullable=False),
        sa.Column("parse_error", sa.Text(), nullable=True),
    )
    op.create_index("ix_files_repository_id", "files", ["repository_id"])
    op.create_table(
        "symbols",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("repository_id", sa.String(length=36), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", sa.String(length=64), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("qualified_name", sa.String(length=1024), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("line", sa.Integer(), nullable=False),
        sa.Column("end_line", sa.Integer(), nullable=False),
        sa.Column("docstring", sa.Text(), nullable=True),
        sa.Column("source_preview", sa.Text(), nullable=True),
    )
    op.create_index("ix_symbols_repository_id", "symbols", ["repository_id"])
    op.create_index("ix_symbols_file_id", "symbols", ["file_id"])
    op.create_index("ix_symbols_name", "symbols", ["name"])
    op.create_table(
        "dependencies",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("repository_id", sa.String(length=36), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(length=64), nullable=False),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("target_path", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("confidence", sa.String(length=24), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("line", sa.Integer(), nullable=True),
    )
    op.create_index("ix_dependencies_repository_id", "dependencies", ["repository_id"])
    op.create_index("ix_dependencies_source_id", "dependencies", ["source_id"])
    op.create_index("ix_dependencies_target_id", "dependencies", ["target_id"])
    op.create_table(
        "analysis_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("repository_id", sa.String(length=36), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("files_scanned", sa.Integer(), nullable=False),
        sa.Column("symbols_found", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("ix_analysis_runs_repository_id", "analysis_runs", ["repository_id"])


def downgrade():
    op.drop_table("analysis_runs")
    op.drop_table("dependencies")
    op.drop_table("symbols")
    op.drop_table("files")
    op.drop_table("repositories")
