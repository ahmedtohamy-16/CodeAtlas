# CodeAtlas

CodeAtlas turns a Python repository into a navigable map of files, symbols, and imports. Import a ZIP or a public GitHub repository, inspect real source and symbol definitions, identify dependency cycles, and trace an initial impact summary—all without running the imported project.

## What works in this MVP

- Import ZIP archives or public GitHub repository URLs.
- Scan repository files while skipping common generated paths and respecting `.gitignore` patterns.
- Parse Python source with the Python AST to extract classes, functions, methods, imports (including conditional imports), line counts, and syntax errors.
- Resolve in-repository import relationships and use NetworkX for graph statistics, strongly connected components, and dependency impact.
- Browse source with line numbers, inspect symbols, search symbols and paths, and explore a Cytoscape dependency map.
- Read basic Git branch, commit, history, and worktree status when Git metadata is available.
- Export bounded analysis metadata as JSON without including source file bodies or extracted source snippets.

Python is the only language with semantic parsing in this release. Other file types are identified and counted, but are not represented as fully parsed symbols. Search matches paths and symbol names, not arbitrary source text. Function-call edges are not claimed unless resolution is reliable; unresolved imports remain visibly unresolved. Source is processed in this app's configured workspace and is not sent to an external analysis service. A hosted deployment receives the ZIP/repository source on its server; self-host CodeAtlas for private source you do not want transferred to a hosted server. Importing a public GitHub URL necessarily fetches that public repository from GitHub.

## Requirements

- Python 3.11 or newer
- Node.js 20 or newer
- pnpm 10 or newer

## Install and run

```bash
pnpm install
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

In one terminal, start the API:

```bash
. .venv/bin/activate
uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 --reload
```

In another terminal, start the web app: 

```bash
pnpm dev
```

Open `http://localhost:3000`. Vite forwards `/api` requests to the FastAPI process on port 8000. The API stores repository metadata in `.codeatlas/codeatlas.db` and imported workspaces in `.codeatlas/repos/` by default; set `CODEATLAS_DATA_DIR` to use a different local data directory. Do not expose this development server to untrusted networks without adding authentication and deployment hardening.

## Tests

```bash
pnpm test
python -m pytest
```

Tests need no external API keys or managed database. The included `sample_repo/` is an isolated analysis fixture.

## Architecture

- `apps/web/`: React + TypeScript UI and Cytoscape map.
- `backend/api/`: FastAPI routes, schemas, status updates, and SSE progress.
- `backend/analysis/`: safe import and filesystem scanning.
- `backend/parsers/`: Python AST parser adapter.
- `backend/graph/`: NetworkX dependency and impact analysis.
- `backend/database/`: SQLAlchemy models and local SQLite configuration.
- `backend/tests/`: API, parser, scanner, security, and graph tests.

## Screenshots

Screenshots will be added after the interface is captured and reviewed; none are included yet.

## Supported languages

Python is semantically parsed. Other languages may appear in detected file totals but are currently marked as detected-only or unsupported.

## Roadmap

1. Harden ZIP and GitHub import and complete Python analysis workflows.
2. Add incremental rescans, richer call resolution, and commit-to-commit graph comparisons.
3. Add JavaScript/TypeScript parser adapters and then expand language support independently.
4. Improve large-graph progressive loading and add desktop-local directory access.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md). Bugs and feature proposals can use the GitHub issue templates. The current implementation is an MVP; please include a minimal reproducible repository when reporting parser issues and remove secrets from any sample.

## License

MIT. See [LICENSE](LICENSE).
