import hashlib
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import pathspec
from sqlalchemy import delete, select

from backend.database.models import AnalysisRun, Dependency, FileRecord, Repository, Symbol
from backend.database.session import SessionLocal
from backend.parsers.python_parser import parse_python, stable_id

EXCLUDED_DIRS = {"node_modules", ".git", "dist", "build", "coverage", "__pycache__", ".venv", "vendor", ".mypy_cache", ".pytest_cache", ".ruff_cache"}
LANGUAGES = {
    ".py": "Python", ".pyi": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
    ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".cpp": "C++", ".cc": "C++",
    ".cxx": "C++", ".hpp": "C++", ".h": "C/C++", ".c": "C", ".java": "Java", ".go": "Go",
    ".rs": "Rust", ".html": "HTML", ".css": "CSS", ".scss": "CSS", ".json": "JSON", ".yaml": "YAML",
    ".yml": "YAML", ".toml": "TOML", ".md": "Markdown", ".sh": "Shell", ".sql": "SQL", ".xml": "XML",
}
MAX_SOURCE_BYTES = 1024 * 1024
MAX_FILES = 20_000


def _hash_id(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8", "replace")).hexdigest()[:32]


def _read_ignore(root: Path):
    ignore_path = root / ".gitignore"
    try:
        patterns = ignore_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        patterns = []
    return pathspec.PathSpec.from_lines("gitwildmatch", patterns)


def _iter_text_files(root: Path):
    ignore = _read_ignore(root)
    count = 0
    for current, dirs, filenames in os.walk(root, topdown=True, followlinks=False):
        base = Path(current)
        rel_dir = base.relative_to(root).as_posix()
        dirs[:] = [name for name in dirs if name.lower() not in EXCLUDED_DIRS and not (base / name).is_symlink()]
        dirs[:] = [name for name in dirs if not ignore.match_file(f"{rel_dir}/{name}" if rel_dir != "." else name)]
        for filename in filenames:
            full = base / filename
            relative = full.relative_to(root).as_posix()
            if full.is_symlink() or ignore.match_file(relative):
                continue
            try:
                size = full.stat().st_size
            except OSError:
                continue
            yield full, relative, size
            count += 1
            if count >= MAX_FILES:
                return


def _module_names(relative: str) -> list[str]:
    path = Path(relative)
    if path.suffix not in {".py", ".pyi"}:
        return []
    parts = list(path.with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return [".".join(parts)] if parts else []


def _resolve_import(root: Path, source_path: str, module: str | None, level: int, names: list[str], module_index: dict[str, list[FileRecord]]):
    source = Path(source_path)
    package_parts = list(source.with_suffix("").parts)
    if package_parts and package_parts[-1] == "__init__":
        pass
    else:
        package_parts = package_parts[:-1]
    if level:
        package_parts = package_parts[: max(0, len(package_parts) - (level - 1))]
        base = ".".join(package_parts + ([module] if module else []))
    else:
        base = module or ""

    candidates: list[str] = []
    if level and not module:
        candidates.extend(".".join(package_parts + [name]) for name in names)
        if base:
            candidates.append(base)
    else:
        if base:
            candidates.append(base)
        if module and names:
            candidates.extend(f"{base}.{name}" for name in names)
    for candidate in candidates:
        files = module_index.get(candidate, [])
        if len(files) == 1:
            return files[0], candidate
        if len(files) > 1:
            return None, candidate
    if base in sys.stdlib_module_names or base.split(".")[0] in sys.stdlib_module_names:
        return None, base
    if not level and not any(candidate.split(".")[0] in module_index for candidate in candidates if candidate):
        return None, base or ", ".join(names)
    return None, base or ", ".join(names)


def _git_metadata(root: Path) -> dict:
    env = {
        "PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "/tmp"),
        "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_OPTIONAL_LOCKS": "0",
    }

    def git(*args: str) -> str | None:
        try:
            result = subprocess.run(
                ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", str(root), *args],
                capture_output=True, text=True, timeout=3, check=False, env=env,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            return None
        return None

    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    commit = git("rev-parse", "HEAD")
    if not commit:
        return {"available": False, "branch": None, "commit": None, "recent_commits": [], "modified_files": [], "uncommitted": False}
    log = git("log", "-5", "--format=%H%x1f%h%x1f%s%x1f%aI") or ""
    recent = []
    for row in log.splitlines():
        values = row.split("\x1f", 3)
        if len(values) == 4:
            recent.append({"commit": values[0], "short": values[1], "subject": values[2], "date": values[3]})
    status = git("status", "--short", "--untracked-files=no") or ""
    return {
        "available": True,
        "branch": branch,
        "commit": commit,
        "recent_commits": recent,
        "modified_files": [line[3:].strip() for line in status.splitlines() if len(line) > 3][:200],
        "uncommitted": bool(status),
    }


def _set_progress(repo_id: str, status: str, progress: int, message: str, error: str | None = None):
    with SessionLocal() as session:
        repo = session.get(Repository, repo_id)
        if repo:
            repo.status = status
            repo.progress = progress
            repo.progress_message = message
            repo.error = error
            session.commit()


def analyze_repository(repository_id: str) -> None:
    with SessionLocal() as session:
        repo = session.get(Repository, repository_id)
        if not repo:
            return
        root = Path(repo.root_path).resolve()
        run = AnalysisRun(id=stable_id(repository_id, datetime.now(timezone.utc).isoformat()), repository_id=repository_id, status="running")
        repo.status, repo.progress, repo.progress_message, repo.error = "analyzing", 1, "Preparing repository scan", None
        session.add(run)
        session.execute(delete(Dependency).where(Dependency.repository_id == repository_id))
        session.execute(delete(Symbol).where(Symbol.repository_id == repository_id))
        session.execute(delete(FileRecord).where(FileRecord.repository_id == repository_id))
        session.commit()

    try:
        if not root.is_dir():
            raise ValueError("Imported repository directory is no longer available")
        paths = list(_iter_text_files(root))
        files: list[FileRecord] = []
        parsed_by_path = {}
        binary_skipped = 0
        oversized = 0
        for index, (full, relative, size) in enumerate(paths):
            if size > MAX_SOURCE_BYTES:
                oversized += 1
                record = FileRecord(
                    id=_hash_id(repository_id, "file", relative), repository_id=repository_id, path=relative,
                    language=LANGUAGES.get(full.suffix.lower(), "Text"), extension=full.suffix.lower(),
                    size_bytes=size, line_count=None, oversized=True, parsed=False,
                )
                files.append(record)
                continue
            try:
                raw = full.read_bytes()
            except OSError:
                continue
            if b"\x00" in raw[:8192]:
                binary_skipped += 1
                continue
            text = raw.decode("utf-8", errors="replace")
            file_id = _hash_id(repository_id, "file", relative)
            record = FileRecord(
                id=file_id, repository_id=repository_id, path=relative,
                language=LANGUAGES.get(full.suffix.lower(), "Text"), extension=full.suffix.lower(),
                size_bytes=size, line_count=text.count("\n") + (1 if text and not text.endswith("\n") else 0),
            )
            files.append(record)
            if record.language == "Python":
                parsed_by_path[relative] = parse_python(text)
            if index % 75 == 0:
                _set_progress(repository_id, "analyzing", min(45, 5 + int(40 * index / max(len(paths), 1))), f"Reading files · {index + 1} / {len(paths)}")

        with SessionLocal() as session:
            session.add_all(files)
            session.commit()
        module_index: dict[str, list[FileRecord]] = {}
        for record in files:
            for module_name in _module_names(record.path):
                module_index.setdefault(module_name, []).append(record)

        symbols: list[Symbol] = []
        dependency_rows: list[Dependency] = []
        parse_errors = 0
        python_files = [record for record in files if record.language == "Python" and not record.oversized]
        for index, record in enumerate(python_files):
            parsed = parsed_by_path.get(record.path)
            if parsed is None:
                parsed = parse_python("")
            record.parsed = True
            record.parse_error = parsed.syntax_error
            if parsed.syntax_error:
                parse_errors += 1
            for item in parsed.symbols:
                symbol_id = stable_id(repository_id, record.path, item.qualified_name, item.kind, item.line)
                symbols.append(Symbol(
                    id=symbol_id, repository_id=repository_id, file_id=record.id, name=item.name,
                    qualified_name=item.qualified_name, kind=item.kind, line=item.line, end_line=item.end_line,
                    docstring=item.docstring, source_preview=item.source_preview,
                ))
            for imported in parsed.imports:
                target, target_module = _resolve_import(root, record.path, imported.module, imported.level, imported.names, module_index)
                is_relative = imported.level > 0
                top = (imported.module or "").split(".")[0]
                is_localish = is_relative or top in module_index
                confidence = "confirmed" if target else ("unresolved" if is_localish else "external")
                detail = imported.statement
                dep_id = stable_id(repository_id, record.id, imported.line, imported.statement)
                dependency_rows.append(Dependency(
                    id=dep_id, repository_id=repository_id, source_id=record.id,
                    target_id=target.id if target else None, source_path=record.path,
                    target_path=target.path if target else target_module or None,
                    kind="import", confidence=confidence, detail=detail, line=imported.line,
                ))
            if index % 30 == 0:
                _set_progress(repository_id, "analyzing", min(90, 48 + int(40 * index / max(len(python_files), 1))), f"Parsing Python · {index + 1} / {len(python_files)}")

        with SessionLocal() as session:
            for record in python_files:
                session.merge(record)
            session.add_all(symbols)
            session.add_all(dependency_rows)
            session.commit()

        git = _git_metadata(root)
        imports_confirmed = sum(1 for row in dependency_rows if row.confidence == "confirmed")
        unresolved_imports = sum(1 for row in dependency_rows if row.confidence == "unresolved")
        external_imports = sum(1 for row in dependency_rows if row.confidence == "external")
        languages: dict[str, int] = {}
        for record in files:
            languages[record.language] = languages.get(record.language, 0) + 1
        stats = {
            "file_count": len(files), "symbol_count": len(symbols), "python_files": len(python_files),
            "parsed_python_files": sum(1 for record in python_files if not record.parse_error),
            "parse_errors": parse_errors, "imports_confirmed": imports_confirmed,
            "unresolved_imports": unresolved_imports, "external_imports": external_imports,
            "binary_skipped": binary_skipped, "oversized_files": oversized, "languages": languages,
            "coverage": {language: ("supported" if language == "Python" else "detected-only") for language in languages},
            "git": git,
        }
        with SessionLocal() as session:
            repo = session.get(Repository, repository_id)
            run_query = select(AnalysisRun).where(AnalysisRun.repository_id == repository_id).order_by(AnalysisRun.started_at.desc())
            run = session.scalar(run_query)
            if repo:
                repo.status, repo.progress, repo.progress_message = "complete", 100, "Analysis complete"
                repo.last_analyzed = datetime.now(timezone.utc)
                repo.stats_json = stats
                repo.current_branch = git.get("branch")
                repo.current_commit = git.get("commit")
            if run:
                run.status, run.finished_at = "complete", datetime.now(timezone.utc)
                run.files_scanned, run.symbols_found = len(files), len(symbols)
            session.commit()
    except Exception as exc:
        with SessionLocal() as session:
            repo = session.get(Repository, repository_id)
            run = session.scalar(select(AnalysisRun).where(AnalysisRun.repository_id == repository_id).order_by(AnalysisRun.started_at.desc()))
            if repo:
                repo.status, repo.progress, repo.progress_message = "failed", 100, "Analysis failed"
                repo.error = f"{type(exc).__name__}: {exc}"[:1200]
            if run:
                run.status, run.finished_at, run.error = "failed", datetime.now(timezone.utc), str(exc)[:1200]
            session.commit()
