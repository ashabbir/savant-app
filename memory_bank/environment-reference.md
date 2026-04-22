# Savant Environment Reference (v8)

This file lists the key env vars used in current client/server architecture.

## 1) Client (`client/`)

### `SAVANT_SERVER_URL`

- Used by: `client/main.js`
- Default: `http://127.0.0.1:8090`
- Purpose: server base URL configured per install.

### `SAVANT_FLASK_PORT`

- Used by: `client/main.js`
- Default: `8090`
- Purpose: legacy fallback for local/server discovery logic.

### `SAVANT_MCP_PORT`, `SAVANT_ABILITIES_MCP_PORT`, `SAVANT_CONTEXT_MCP_PORT`, `SAVANT_KNOWLEDGE_MCP_PORT`

- Used by: `client/main.js`
- Defaults: `8091`, `8092`, `8093`, `8094`
- Purpose: MCP config defaults and compatibility routing.

### `SESSION_DIR` / `CLAUDE_DIR` / `CODEX_DIR` / `GEMINI_DIR` / `HERMES_DIR`

- Used by: `client/session_service.js`
- Purpose: override provider-local roots for session detection on client machine.
- Defaults:
  - `SESSION_DIR` -> `~/.copilot/session-state`
  - `CLAUDE_DIR` -> `~/.claude`
  - `CODEX_DIR` -> `~/.codex`
  - `GEMINI_DIR` -> `~/.gemini`
  - `HERMES_DIR` -> `~/.hermes`

### `SHELL`

- Used by: `client/main.js`
- Purpose: default shell for local terminal PTYs.

## 2) Server (`server/`)

### `FLASK_HOST`

- Used by: `server/app.py`
- Default: `0.0.0.0` (or deployment-specific)
- Purpose: host bind address.

### `FLASK_PORT`

- Used by: `server/app.py`
- Default: `8090`
- Purpose: API server port.

### `SAVANT_DB`

- Used by: server data layer
- Purpose: override server SQLite path.

### `META_DIR`

- Used by: `server/app.py`
- Default:
  - Docker: `/data/meta`
  - local: `~/.savant/meta`
- Purpose: server metadata root.

### `RUNNING_IN_DOCKER`

- Used by: `server/app.py`
- Purpose: force container-mode path behavior.

### `_VOL_MAP_0` ... `_VOL_MAP_5`

- Used by: `server/app.py`
- Purpose: container->host path mapping for reveal/open actions.

## 3) MCP Server Bridges

### `SAVANT_API_BASE`

- Used by: `server/mcp/*.py`
- Default: `http://localhost:8090`
- Purpose: base URL used by MCP server processes to call server API.
