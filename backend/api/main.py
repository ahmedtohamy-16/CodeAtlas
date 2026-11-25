import asyncio
from contextlib import asynccontextmanager
import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.analysis.importers import MAX_ARCHIVE_BYTES, ImportErrorSafe, github_archive, safe_extract_zip
from backend.analysis.scanner import analyze_repository
from backend.database.models import Dependency, FileRecord, Repository, Symbol
from backend.database.session import DATA_DIR, SessionLocal, get_session, initialize_database
from backend.graph.analysis import dependency_report, impact_report

@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    (DATA_DIR / "repos").mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="CodeAtlas API", version="0.1.0", description="Repository analysis API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])


def _iso(value):
    return value.isoformat() if value else None


def _repository_json(repo: Repository) -> dict:
    return {
        "id": repo.id, "name": repo.name, "source": repo.source,
        "imported_at": _iso(repo.imported_at), "last_analyzed": _iso(repo.last_analyzed),
        "status": repo.status, "progress": repo.progress, "progress_message": repo.progress_message,
        "error": repo.error, "stats": repo.stats_json or {},
        "current_branch": repo.current_branch, "current_commit": repo.current_commit,
    }


def _file_json(item: FileRecord) -> dict:
    return {
        "id": item.id, "path": item.path, "language": item.language, "extension": item.extension,
        "size_bytes": item.size_bytes, "line_count": item.line_count, "is_binary": item.is_binary,
        "oversized": item.oversized, "parsed": item.parsed, "parse_error": item.parse_error,
    }


def _symbol_json(item: Symbol) -> dict:
    return {
        "id": item.id, "file_id": item.file_id, "name": item.name, "qualified_name": item.qualified_name,
        "kind": item.kind, "line": item.line, "end_line": item.end_line,
        "docstring": item.docstring, "source_preview": item.source_preview,
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "codeatlas-api", "version": app.version}


@app.get("/api/repositories")
def list_repositories(session: Session = Depends(get_session)):
    rows = session.scalars(select(Repository).order_by(Repository.imported_at.desc()).limit(20)).all()
    return {"items": [_repository_json(item) for item in rows]}


@app.post("/api/repositories/import", status_code=202)
async def import_repository(
    background: BackgroundTasks,
    file: UploadFile | None = File(default=None),
    repo_url: str | None = Form(default=None),
    session: Session = Depends(get_session),
):
    if bool(file) == bool(repo_url and repo_url.strip()):
        raise HTTPException(status_code=422, detail="Provide exactly one ZIP file or public GitHub URL")
    repository_id = str(uuid.uuid4())
    root = DATA_DIR / "repos" / repository_id
    try:
        if repo_url and repo_url.strip():
            archive_bytes, name = github_archive(repo_url.strip())
            source = "github"
        else:
            if not file or not file.filename or Path(file.filename).suffix.lower() != ".zip":
                raise ImportErrorSafe("Choose a ZIP archive ending in .zip")
            if file.content_type not in {"application/zip", "application/x-zip-compressed", "application/octet-stream", "application/x-zip"}:
                raise ImportErrorSafe("The uploaded file does not have a ZIP content type")
            archive_bytes = await file.read(MAX_ARCHIVE_BYTES + 1)
            if len(archive_bytes) > MAX_ARCHIVE_BYTES:
                raise ImportErrorSafe("ZIP upload exceeds the 100 MB limit")
            name = Path(file.filename).name[:-4].strip() or "Imported repository"
            source = "zip"
        safe_extract_zip(archive_bytes, root)
    except ImportErrorSafe as exc:
        shutil.rmtree(root, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        shutil.rmtree(root, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Repository import failed: {exc}") from exc
    repo = Repository(
        id=repository_id, name=name[:255], root_path=str(root.resolve()), source=source,
        status="queued", progress=0, progress_message="Import complete · queued for analysis", stats_json={},
    )
    session.add(repo)
    session.commit()
    background.add_task(analyze_repository, repository_id)
    return {"repository": _repository_json(repo), "message": "Repository imported; analysis started"}


@app.get("/api/repositories/{repository_id}")
def get_repository(repository_id: str, session: Session = Depends(get_session)):
    repo = session.get(Repository, repository_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    return _repository_json(repo)


@app.post("/api/repositories/{repository_id}/analyze", status_code=202)
def reanalyze(repository_id: str, background: BackgroundTasks, session: Session = Depends(get_session)):
    repo = session.get(Repository, repository_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    if repo.status == "analyzing":
        raise HTTPException(status_code=409, detail="Analysis is already running")
    repo.status, repo.progress, repo.progress_message, repo.error = "queued", 0, "Analysis queued", None
    session.commit()
    background.add_task(analyze_repository, repository_id)
    return {"repository": _repository_json(repo), "message": "Analysis queued"}


@app.get("/api/repositories/{repository_id}/progress")
async def repository_progress(repository_id: str):
    with SessionLocal() as session:
        if not session.get(Repository, repository_id):
            raise HTTPException(status_code=404, detail="Repository not found")

    async def events():
        previous = None
        while True:
            with SessionLocal() as session:
                repo = session.get(Repository, repository_id)
                if not repo:
                    yield "event: error\ndata: {\"message\":\"Repository not found\"}\n\n"
                    break
                state = {"status": repo.status, "progress": repo.progress, "message": repo.progress_message, "error": repo.error}
            payload = json.dumps(state, ensure_ascii=False)
            if payload != previous:
                yield f"event: progress\ndata: {payload}\n\n"
                previous = payload
            if state["status"] in {"complete", "failed"}:
                break
            yield ": keep-alive\n\n"
            await asyncio.sleep(0.8)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/repositories/{repository_id}/files")
def list_files(
    repository_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    language: str | None = None,
    directory: str | None = None,
    session: Session = Depends(get_session),
):
    if not session.get(Repository, repository_id):
        raise HTTPException(status_code=404, detail="Repository not found")
    query = select(FileRecord).where(FileRecord.repository_id == repository_id)
    if language:
        query = query.where(FileRecord.language == language)
    if directory:
        prefix = directory.strip("/") + "/"
        query = query.where(FileRecord.path.like(prefix.replace("%", "\\%").replace("_", "\\_") + "%"))
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(query.order_by(FileRecord.path).offset(offset).limit(limit)).all()
    return {"items": [_file_json(item) for item in rows], "total": total, "offset": offset, "limit": limit}


@app.get("/api/repositories/{repository_id}/files/{file_id}/content")
def file_content(repository_id: str, file_id: str, session: Session = Depends(get_session)):
    repo = session.get(Repository, repository_id)
    item = session.get(FileRecord, file_id)
    if not repo or not item or item.repository_id != repository_id:
        raise HTTPException(status_code=404, detail="File not found")
    if item.oversized:
        raise HTTPException(status_code=413, detail="This file exceeds the 1 MB source preview limit")
    root = Path(repo.root_path).resolve()
    target = (root / item.path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="Source file is no longer available")
    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Could not read the source file") from exc
    return {"path": item.path, "language": item.language, "content": content[:1_000_000], "truncated": len(content) > 1_000_000}


@app.get("/api/repositories/{repository_id}/symbols")
def list_symbols(
    repository_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(250, ge=1, le=1000),
    kind: str | None = None,
    file_id: str | None = None,
    session: Session = Depends(get_session),
):
    if not session.get(Repository, repository_id):
        raise HTTPException(status_code=404, detail="Repository not found")
    query = select(Symbol).where(Symbol.repository_id == repository_id)
    if kind:
        query = query.where(Symbol.kind == kind)
    if file_id:
        query = query.where(Symbol.file_id == file_id)
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(query.order_by(Symbol.name).offset(offset).limit(limit)).all()
    return {"items": [_symbol_json(item) for item in rows], "total": total, "offset": offset, "limit": limit}


@app.get("/api/repositories/{repository_id}/graph")
def get_graph(
    repository_id: str,
    limit: int = Query(400, ge=1, le=800),
    language: str | None = None,
    directory: str | None = None,
    session: Session = Depends(get_session),
):
    repo = session.get(Repository, repository_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    query = select(FileRecord).where(FileRecord.repository_id == repository_id)
    if language:
        query = query.where(FileRecord.language == language)
    if directory:
        prefix = directory.strip("/")
        query = query.where(FileRecord.path.startswith(prefix + "/"))
    file_budget = max(1, limit // 2)
    files = session.scalars(query.order_by(FileRecord.path).limit(file_budget)).all()
    file_ids = {item.id for item in files}
    remaining = max(0, limit - len(files))
    symbols = session.scalars(select(Symbol).where(Symbol.repository_id == repository_id, Symbol.file_id.in_(file_ids)).order_by(Symbol.file_id, Symbol.line).limit(remaining)).all() if file_ids and remaining else []
    nodes = [{"id": item.id, "name": item.path, "path": item.path, "kind": "file", "language": item.language, "size": item.size_bytes, "line": None} for item in files]
    nodes.extend({"id": item.id, "name": item.name, "qualified_name": item.qualified_name, "path": next((f.path for f in files if f.id == item.file_id), ""), "file_id": item.file_id, "kind": item.kind, "language": "Python", "line": item.line} for item in symbols)
    node_ids = {item["id"] for item in nodes}
    edges = []
    for item in symbols:
        if item.file_id in node_ids:
            edges.append({"id": f"contains-{item.file_id}-{item.id}", "source": item.file_id, "target": item.id, "kind": "contains", "confidence": "confirmed"})
    dependencies = session.scalars(select(Dependency).where(Dependency.repository_id == repository_id, Dependency.confidence == "confirmed", Dependency.target_id.is_not(None))).all()
    edges.extend({"id": item.id, "source": item.source_id, "target": item.target_id, "kind": item.kind, "confidence": item.confidence, "label": item.detail} for item in dependencies if item.source_id in node_ids and item.target_id in node_ids)
    total_files = session.scalar(select(func.count()).select_from(FileRecord).where(FileRecord.repository_id == repository_id)) or 0
    total_symbols = session.scalar(select(func.count()).select_from(Symbol).where(Symbol.repository_id == repository_id)) or 0
    return {"nodes": nodes, "edges": edges, "truncated": total_files + total_symbols > len(nodes), "node_limit": limit, "total_files": total_files, "total_symbols": total_symbols}


@app.get("/api/repositories/{repository_id}/dependencies")
def get_dependencies(repository_id: str, session: Session = Depends(get_session)):
    repo = session.get(Repository, repository_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    report = dependency_report(session, repository_id)
    rows = session.scalars(select(Dependency).where(Dependency.repository_id == repository_id).order_by(Dependency.source_path, Dependency.line)).all()
    report["imports"] = [
        {"id": item.id, "source": item.source_path, "target": item.target_path, "kind": item.kind, "confidence": item.confidence, "detail": item.detail, "line": item.line}
        for item in rows[:2000]
    ]
    report["imports_truncated"] = len(rows) > 2000
    return report


@app.get("/api/repositories/{repository_id}/impact/{symbol_id}")
def get_impact(repository_id: str, symbol_id: str, session: Session = Depends(get_session)):
    if not session.get(Repository, repository_id):
        raise HTTPException(status_code=404, detail="Repository not found")
    report = impact_report(session, repository_id, symbol_id)
    if not report.get("found"):
        raise HTTPException(status_code=404, detail="Symbol not found")
    return report


@app.get("/api/repositories/{repository_id}/git/history")
def get_git_history(repository_id: str, session: Session = Depends(get_session)):
    repo = session.get(Repository, repository_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    return (repo.stats_json or {}).get("git", {"available": False, "recent_commits": [], "modified_files": []})


@app.get("/api/repositories/{repository_id}/export")
def export_analysis(repository_id: str, session: Session = Depends(get_session)):
    repo = session.get(Repository, repository_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    files = session.scalars(select(FileRecord).where(FileRecord.repository_id == repository_id).order_by(FileRecord.path).limit(20_000)).all()
    symbols = session.scalars(select(Symbol).where(Symbol.repository_id == repository_id).order_by(Symbol.file_id, Symbol.line).limit(50_000)).all()
    dependencies = session.scalars(select(Dependency).where(Dependency.repository_id == repository_id).order_by(Dependency.source_path, Dependency.line).limit(50_000)).all()
    return JSONResponse(content={
        "format": "codeatlas-analysis-v1", "exported_at": datetime.now(timezone.utc).isoformat(),
        "repository": _repository_json(repo), "files": [_file_json(item) for item in files],
        "symbols": [{"id": item.id, "file_id": item.file_id, "name": item.name, "qualified_name": item.qualified_name, "kind": item.kind, "line": item.line, "end_line": item.end_line} for item in symbols],
        "dependencies": [{"id": item.id, "source_path": item.source_path, "target_path": item.target_path, "kind": item.kind, "confidence": item.confidence, "detail": item.detail, "line": item.line} for item in dependencies],
        "truncated": len(files) >= 20_000 or len(symbols) >= 50_000 or len(dependencies) >= 50_000,
        "note": "Analysis metadata only; source file contents are not included.",
    })


@app.get("/api/repositories/{repository_id}/search")
def search_repository(repository_id: str, q: str = Query(..., min_length=1, max_length=200), limit: int = Query(50, ge=1, le=100), session: Session = Depends(get_session)):
    if not session.get(Repository, repository_id):
        raise HTTPException(status_code=404, detail="Repository not found")
    needle = f"%{q.strip()}%"
    files = session.scalars(select(FileRecord).where(FileRecord.repository_id == repository_id, FileRecord.path.ilike(needle)).order_by(FileRecord.path).limit(limit)).all()
    symbols = session.scalars(select(Symbol).where(Symbol.repository_id == repository_id, Symbol.name.ilike(needle)).order_by(Symbol.name).limit(limit)).all()
    file_by_id = {item.id: item for item in session.scalars(select(FileRecord).where(FileRecord.repository_id == repository_id, FileRecord.id.in_([item.file_id for item in symbols]))).all()} if symbols else {}
    results = [{"id": item.id, "type": "file", "name": item.path, "path": item.path, "line": None, "file_id": item.id} for item in files]
    results.extend({"id": item.id, "type": item.kind, "name": item.qualified_name, "path": file_by_id.get(item.file_id).path if item.file_id in file_by_id else "", "line": item.line, "file_id": item.file_id} for item in symbols)
    return {"items": results[:limit], "query": q, "count": min(len(results), limit)}
