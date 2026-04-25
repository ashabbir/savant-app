# Savant File Index (v8)

Focused map of the current split codebase.

## Root

- `AGENTIC.md` -> canonical shared architecture/methodology.
- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` -> agent entry docs referencing `AGENTIC.md`.
- `docker-compose.yml`, `docker-compose.server.yml` -> server runtime compose definitions.
- `build-client.sh`, `build-server.sh` -> build helpers.
- `deploy-client.sh`, `deploy-server.sh` -> deployment helpers.
- `run-all-tests.sh` -> runs client tests, server tests, integration tests.

## Client (`client/`)

- `main.js` -> Electron main process, IPC registration, app lifecycle.
- `preload.js` -> renderer bridge (`window.savantClient`, terminal APIs, desktop APIs).
- `client_store.js` -> local prefs + offline outbox queue.
- `mcp_agent_config.js` -> client-local AI agent MCP config detection/setup helpers.
- `session_service.js` -> provider-based local session discovery and CRUD.
- `renderer/index.html` -> main app screen.
- `renderer/detail.html` -> session detail screen.
- `renderer/static/js/core.js` -> dashboard orchestration.
- `renderer/static/js/sessions.js` -> session list/filter/render and local session actions.
- `renderer/static/js/workspaces.js` -> workspace UI.
- `renderer/static/js/tasks.js` -> tasks UI.
- `terminal.html` -> xterm BrowserView UI.

### Client tests

- `tests/*.test.js` -> node test suites (client store + local session service).
- `tests/mcp_agent_config.test.js` -> unit coverage for local MCP config detection/setup.
- `tests_js/test_terminal_integration.js` -> split contract tests.
- `tests_js/test_local_session_bridge.js` -> local session bridge contract tests.
- `tests_ui/*` -> Playwright Electron UI tests.
- `tests_ui/electron.mcp-config.spec.js` -> verifies System Info MCP config behavior through desktop bridge.
- `run-tests.sh` -> client test runner.

## Server (`server/`)

- `app.py` -> primary API server.
- `sqlite_client.py` and `db/*` -> persistence layer.
- `abilities/*` -> abilities APIs.
- `context/*` -> context indexing, semantic search, and deterministic analysis helpers.
- `context/ingestion.py` -> source-based project ingestion (github/gitlab/directory).
- `context/analysis.py` -> class/file before-after analysis helpers for MCP and API consumers.
- `knowledge/*` -> knowledge graph APIs.
- `mcp/*.py` -> MCP bridge servers.
- `Dockerfile`, `docker-entrypoint.sh` -> container runtime files.
- `requirements*.txt` -> Python deps.
- `run-tests.sh` -> server test runner.

## Integration tests (`tests/`)

- `test_client_server_integration.py`
- `test_repo_hygiene.py`
- `test_test_pipeline_contract.py`

These validate split-architecture contracts at repo level.
