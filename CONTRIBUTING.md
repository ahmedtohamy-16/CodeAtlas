# Contributing

Thanks for helping improve CodeAtlas. Start with a focused issue or describe the behavior you intend to change. Keep parser behavior honest: distinguish confirmed imports from unresolved and heuristic relationships, and never run source code from repositories being analyzed.

## Development

Install Node dependencies with `pnpm install`. Create a Python virtual environment and install `requirements.txt`. Run the API with `uvicorn backend.api.main:app --reload --port 8000` and the UI with `pnpm dev`. Run UI tests with `pnpm test` and backend tests with `python -m pytest`.

Keep changes modular: language-specific parsing belongs in `backend/parsers/`; shared filesystem traversal belongs in `backend/analysis/`; graph algorithms belong in `backend/graph/`; UI components belong in `apps/web/src/`. Add or update tests for behavioral changes and use the small sample repository where possible. Do not commit imported repositories, `.codeatlas/`, credentials, or generated build artifacts.

## Pull requests

Explain the problem, approach, security impact, and tests run. For visible UI changes, include a screenshot if available. For parsing changes, include a compact source fixture and expected extracted relationships.
