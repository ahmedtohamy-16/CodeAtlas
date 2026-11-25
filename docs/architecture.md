# Architecture

The browser UI is a React + TypeScript Vite application. Vite proxies same-origin `/api` requests to a local FastAPI process; in production packaging the frontend and API can be served behind one origin. Cytoscape renders a bounded graph response and releases its instance when the view changes.

FastAPI validates requests and records repository metadata, analysis status, files, symbols, edges, and analysis runs with SQLAlchemy and SQLite. ZIP and GitHub imports are extracted only after path, size, member-count, and symlink validation. A scanner walks the repository without invoking its build system or code, prunes generated folders, consults `.gitignore`, and parses Python with `ast`.

The parser is an adapter: Python AST extraction is implemented; other adapters are not falsely represented as complete. Confirmed in-repository import edges feed NetworkX for strongly connected components, dependency traversal, and impact distance. Ambiguous edges remain unresolved rather than silently becoming confirmed. Git integration is read-only and runs only bounded metadata commands with local hooks and filesystem monitors disabled.

SQLite and the repository workspace are local app data. Public GitHub import retrieves the public archive from GitHub; source is not sent to an external analysis provider. The first web MVP accepts ZIP and public GitHub URLs; opening an arbitrary directory is reserved for a future local desktop or native integration.
