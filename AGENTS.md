# Repository Guidelines

## Project Structure & Module Organization
- `main.js`, `preload.js`, `terminal.html`, `loading.html`: Electron shell and renderer entry points.
- `savant/`: Flask backend and MCP servers.
  - `app.py`: Flask app and REST routes.
  - `db/`, `models.py`, `sqlite_client.py`: SQLite data layer and models.
  - `mcp/`: MCP SSE servers that proxy to Flask.
  - `templates/`, `static/`: Jinja2 views and static assets.
  - `tests/`: pytest suite for the Flask backend.
- `tests/test_terminal.js`: Node-based validation for Electron terminal features.
- `CLAUDE.md`: detailed architecture notes, conventions, and MCP server checklist.

## Build, Test, and Development Commands
- `npm install`: install Electron and Node dependencies.
- `npm run dev`: run Electron in development mode (spawns Flask + MCP).
- `npm run build`: create macOS DMG/dir artifacts via electron-builder.
- `npm start`: start Electron without dev flags.
- `cd savant && pip install -r requirements.txt && python app.py`: run Flask standalone.
- `cd savant && python3 -m pytest tests/ -v`: run backend tests.
- `node tests/test_terminal.js`: run Electron terminal validation.

## Coding Style & Naming Conventions
- JavaScript uses 2-space indentation and `const`/`let` (see `main.js`).
- Python uses 4-space indentation and PEP 8-style naming.
- Database entities live in `savant/db/<entity>.py` as `@staticmethod` classes.
- MCP tools are thin proxies; docstrings become tool descriptions.
- No formatter or linter is configured; keep changes consistent with nearby code.

## Testing Guidelines
- Backend tests use `pytest` with fixtures in `savant/tests/conftest.py`.
- Prefer running targeted tests: `python3 -m pytest tests/test_file.py -v`.
- Node validation uses `node tests/test_terminal.js` for terminal features.

## Commit & Pull Request Guidelines
- Git history is not available in this checkout; use concise, imperative messages (e.g., `feat: add knowledge graph endpoint`).
- PRs should describe changes, note user-facing impacts, and include screenshots for UI updates.
- Link related issues or tickets when available.

## Additional Notes
- The app uses a three-process model (Electron → Flask → MCP servers); see `CLAUDE.md` for startup details.
- MCP server registry ports live in `savant/mcp/` and are spawned by `main.js`.
- New MCP servers or Flask Blueprints should follow the checklist in `.github/copilot-instructions.md` when present.
