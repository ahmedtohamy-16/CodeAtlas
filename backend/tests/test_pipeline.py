import io
import stat
import zipfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.analysis.scanner as scanner
import backend.api.main as api
from backend.database.models import Base
from backend.database.session import get_session
from backend.parsers.python_parser import parse_python


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(api, "DATA_DIR", tmp_path)
    monkeypatch.setattr(api, "SessionLocal", testing_session)
    monkeypatch.setattr(scanner, "SessionLocal", testing_session)
    monkeypatch.setattr(api, "initialize_database", lambda: Base.metadata.create_all(bind=engine))

    def override_session():
        with testing_session() as session:
            yield session

    api.app.dependency_overrides[get_session] = override_session
    with TestClient(api.app) as test_client:
        yield test_client
    api.app.dependency_overrides.clear()
    engine.dispose()


def archive(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in files.items():
            zf.writestr(f"fixture/{path}", content)
    return buffer.getvalue()


def test_python_ast_extracts_definitions_and_imports():
    result = parse_python("from os import path\n\ndef clean(value):\n    return path.basename(value)\n\nclass Store:\n    def load(self):\n        return clean('x')\n")
    assert [item.name for item in result.symbols] == ["clean", "Store", "load"]
    assert [item.kind for item in result.symbols] == ["function", "class", "method"]
    assert result.symbols[0].line == 3
    assert result.imports[0].module == "os"
    assert not result.syntax_error


def test_python_ast_extracts_imports_inside_control_flow():
    source = """import root
if TYPE_CHECKING:
    from .types import Thing
try:
    import optional_dep
except ImportError:
    from fallback import Thing
def load():
    if enabled:
        from .platform_impl import implementation
"""
    result = parse_python(source)
    assert [(item.module, item.level) for item in result.imports] == [
        ("root", 0), ("types", 1), ("optional_dep", 0), ("fallback", 0), ("platform_impl", 1)
    ]
    assert [item.name for item in result.symbols] == ["load"]


def test_malformed_python_is_reported_without_raising():
    result = parse_python("def broken(:\n  pass\n")
    assert result.symbols == []
    assert "Line 1" in result.syntax_error


def test_import_rejects_path_traversal(client):
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as zf:
        zf.writestr("../escape.py", "print('not run')")
    response = client.post("/api/repositories/import", files={"file": ("evil.zip", payload.getvalue(), "application/zip")})
    assert response.status_code == 400
    assert "unsafe path" in response.json()["detail"].lower()


def test_import_rejects_symlink_members(client):
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as zf:
        info = zipfile.ZipInfo("fixture/link.py")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        zf.writestr(info, "../../outside.py")
    response = client.post("/api/repositories/import", files={"file": ("links.zip", payload.getvalue(), "application/zip")})
    assert response.status_code == 400
    assert "symbolic links" in response.json()["detail"].lower()


def test_import_rejects_high_compression_ratio(client):
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        zf.writestr("fixture/large.py", b"x" * (3 * 1024 * 1024))
    response = client.post("/api/repositories/import", files={"file": ("compressed.zip", payload.getvalue(), "application/zip")})
    assert response.status_code == 400
    assert "compression ratio" in response.json()["detail"].lower()


def test_github_import_rejects_non_github_host_before_download(client):
    response = client.post("/api/repositories/import", data={"repo_url": "https://example.com/owner/repository"})
    assert response.status_code == 400
    assert "github" in response.json()["detail"].lower()


def test_real_zip_pipeline_files_symbols_cycles_source_and_impact(client):
    payload = archive({
        ".gitignore": "ignored.py\nnode_modules/\n",
        "demo/__init__.py": "\"\"\"fixture\"\"\"\n",
        "demo/a.py": "from . import b\n\ndef alpha(value):\n    return value\n\nclass Alpha:\n    def run(self):\n        return alpha(1)\n",
        "demo/b.py": "from . import a\n\ndef beta():\n    return a.Alpha\n",
        "ignored.py": "def hidden():\n    return None\n",
        "node_modules/no.py": "def excluded():\n    return None\n",
    })
    response = client.post("/api/repositories/import", files={"file": ("sample.zip", payload, "application/zip")})
    assert response.status_code == 202, response.text
    repo_id = response.json()["repository"]["id"]

    repo = client.get(f"/api/repositories/{repo_id}").json()
    assert repo["status"] == "complete", repo
    assert repo["stats"]["file_count"] == 4
    assert repo["stats"]["symbol_count"] == 4
    assert repo["stats"]["imports_confirmed"] == 2

    files = client.get(f"/api/repositories/{repo_id}/files?limit=1000").json()["items"]
    paths = {item["path"] for item in files}
    assert "ignored.py" not in paths
    assert "node_modules/no.py" not in paths
    assert "demo/a.py" in paths
    source_file = next(item for item in files if item["path"] == "demo/a.py")
    source = client.get(f"/api/repositories/{repo_id}/files/{source_file['id']}/content").json()
    assert "def alpha" in source["content"]

    report = client.get(f"/api/repositories/{repo_id}/dependencies").json()
    assert report["cycle_count"] == 1
    assert report["confirmed_import_edges"] == 2
    assert report["cycles"]

    symbols = client.get(f"/api/repositories/{repo_id}/symbols?limit=1000").json()["items"]
    alpha = next(item for item in symbols if item["name"] == "alpha")
    impact = client.get(f"/api/repositories/{repo_id}/impact/{alpha['id']}").json()
    assert impact["found"] is True
    assert any(item["path"] == "demo/b.py" for item in impact["direct"])
    assert "file-level" in impact["scope"]

    exported = client.get(f"/api/repositories/{repo_id}/export")
    assert exported.status_code == 200
    export_data = exported.json()
    assert export_data["format"] == "codeatlas-analysis-v1"
    assert len(export_data["files"]) == 4
    assert len(export_data["dependencies"]) == 2
    assert "source_preview" not in export_data["symbols"][0]
    assert "def alpha" not in exported.text
    assert export_data["truncated"] is False


def test_import_requires_exactly_one_source(client):
    response = client.post("/api/repositories/import", data={})
    assert response.status_code == 422


def test_health_is_available(client):
    assert client.get("/api/health").json()["status"] == "ok"
