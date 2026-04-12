# Savant Environment Reference

This file lists environment variables referenced directly in the repository and explains how they affect runtime behavior.

## 1. Core Backend and Storage

### 1. `SAVANT_DB`

- Used in: `savant/sqlite_client.py`
- Default: `~/.savant/savant.db`
- Purpose: Overrides the SQLite database path.

### 2. `FLASK_HOST`

- Used in: `savant/app.py`
- Default: `0.0.0.0` in standalone mode, forced to `127.0.0.1` by Electron startup
- Purpose: Host bind address for Flask.

### 3. `FLASK_PORT`

- Used in: `savant/app.py`
- Default: `8090`
- Purpose: Port for the Flask server.

### 4. `META_DIR`

- Used in: `savant/app.py`
- Default:
  - Docker: `/data/meta`
  - local: `~/.savant/meta`
- Purpose: Stores non-provider Savant metadata and migrated JSON-style app metadata.

## 2. Provider Session and Metadata Directories

### 5. `SESSION_DIR`

- Used in: `savant/app.py`
- Default: `~/.copilot/session-state`
- Purpose: Root path for Copilot session state.

### 6. `CLAUDE_DIR`

- Used in: `savant/app.py`
- Default:
  - Docker: `/data/claude`
  - local: `~/.claude`
- Purpose: Root directory for Claude files and Savant Claude metadata.

### 7. `GEMINI_DIR`

- Used in: `savant/app.py`
- Default: `~/.gemini`
- Purpose: Root directory for Gemini files and `.savant-meta`.

### 8. `CODEX_DIR`

- Used in:
  - `savant/app.py`
  - `savant/mcp/session_detect.py`
- Default:
  - Docker: `/data/codex`
  - local: `~/.codex`
- Purpose: Root directory for Codex session logs and `.savant-meta`.

### 9. `CODEX_SESSION_ID`

- Used in: `savant/mcp/session_detect.py`
- Purpose: Primary session identifier for Codex MCP session detection.

### 10. `CODEX_SESSION`

- Used in: `savant/mcp/session_detect.py`
- Purpose: Alternate Codex session identifier env var.

### 11. `CODEX_SESSION_PATH`

- Used in: `savant/mcp/session_detect.py`
- Purpose: Path to a Codex session log; used when session ID is not provided directly.

### 12. `CODEX_SESSION_LOG`

- Used in: `savant/mcp/session_detect.py`
- Purpose: Alternate path env var for a Codex session log.

### 13. `GEMINI_CLI`

- Used in: `savant/mcp/session_detect.py`
- Purpose: Enables Gemini-specific session detection logic.

### 14. `SAVANT_WORKSPACE_ID`

- Used in: `savant/mcp/session_detect.py`
- Purpose: Fallback explicit workspace override when normal detection fails.

### 15. `SAVANT_SESSION_ID`

- Used in: `savant/mcp/session_detect.py`
- Purpose: Fallback explicit session override when normal detection fails.

## 3. Docker and Host Path Mapping

### 16. `RUNNING_IN_DOCKER`

- Used in: `savant/app.py`
- Purpose: Forces Docker-mode path behavior even if `/.dockerenv` is not present.

### 17. `_VOL_MAP_0`
### 18. `_VOL_MAP_1`
### 19. `_VOL_MAP_2`
### 20. `_VOL_MAP_3`
### 21. `_VOL_MAP_4`
### 22. `_VOL_MAP_5`

- Used in: `savant/app.py`
- Purpose: Container-to-host absolute path mapping for file open and reveal actions.
- Format: `<host_prefix>:<container_prefix>`

## 4. MCP and Abilities Configuration

### 23. `SAVANT_API_BASE`

- Used in:
  - `savant/mcp/server.py`
  - `savant/mcp/abilities_server.py`
  - `savant/mcp/context_server.py` indirectly through CLI arg default flow
  - `savant/mcp/knowledge_server.py`
  - `savant/mcp/stdio.py`
- Default: `http://localhost:8090` or discovered local Flask URL
- Purpose: Base URL used by MCP bridge servers to call Flask.

### 24. `SAVANT_ABILITIES_DIR`

- Used in: `savant/abilities/routes.py`
- Default: `~/.savant/abilities`
- Purpose: Root directory for abilities asset loading.

### 25. `MCP_CONFIG`

- Used in: `savant/app.py`
- Default: `~/.copilot/mcp-config.json`
- Purpose: Default path for reading MCP configuration metadata in dashboard routes.

## 5. Embedding and Context Search

### 26. `EMBEDDING_MODEL_NAME`

- Used in:
  - `main.js`
  - `savant/context/embeddings.py`
- Default: `stsb-distilbert-base`
- Purpose: Logical embedding model name and local storage folder segment.

### 27. `EMBEDDING_VERSION`

- Used in:
  - `main.js`
  - `savant/context/embeddings.py`
- Default: `v1`
- Purpose: Version folder for local or bundled embedding models.

### 28. `EMBEDDING_MODEL_DIR`

- Used in:
  - `main.js`
  - `savant/context/embeddings.py`
- Purpose: Explicit override directory for the embedding model.

### 29. `EMBEDDING_DIM`

- Used in: `savant/context/embeddings.py`
- Default: `768`
- Purpose: Embedding vector dimension expected by the context subsystem.

### 30. `EMBEDDING_REPO_ID`

- Used in: `savant/context/embeddings.py`
- Default: `sentence-transformers/stsb-distilbert-base`
- Purpose: Hugging Face repo identifier used for model download.

### 31. `EMBEDDING_REVISION`

- Used in: `savant/context/embeddings.py`
- Default: `main`
- Purpose: Hugging Face revision to download.

### 32. `SAVANT_BUNDLED_MODEL_DIR`

- Used in: `savant/context/embeddings.py`
- Set by: `main.js` when Flask is spawned
- Purpose: Points Flask to a model bundled inside the app resources.

## 6. Terminal and Shell Behavior

### 33. `SHELL`

- Used in:
  - `main.js`
  - `tests/test_terminal.js`
- Default: `/bin/zsh` fallback
- Purpose: Default shell used for terminal PTYs.

### 34. `HOME`

- Used in: `main.js`
- Purpose: Default working directory for terminal sessions and external terminal launch behavior.

### 35. `TERM_PROGRAM`

- Used in: `main.js`
- Purpose: Helps detect whether iTerm is already the preferred external terminal.

### 36. `PATH`

- Used in: `main.js`
- Purpose: Expanded when spawning MCP servers so Python lookup works reliably.

### 37. `PYTHONDONTWRITEBYTECODE`

- Set by: `main.js`
- Purpose: Prevents `.pyc` generation for Flask and model-download subprocesses.

## 7. Runtime Notes for Agents

Important agent-facing implications:

1. Codex workspace detection depends on real `CODEX_SESSION_ID` or a readable session log path.
2. MCP tools may work even when session autodetection fails, but explicit `session_id` values may be required.
3. Context search needs both the embedding model and `sqlite-vec` support.
4. Docker path mapping only works when `_VOL_MAP_*` variables are correctly populated.
5. `SAVANT_API_BASE` is critical for standalone stdio MCP launches.
