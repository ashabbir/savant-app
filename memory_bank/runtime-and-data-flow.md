# Savant Runtime and Data Flow

## 1. Electron Startup Flow

1. `main.js` starts Electron with sandbox-related flags suited for ad-hoc signed macOS usage.
2. A loading window is created with `loading.html`.
3. Electron resolves the Savant backend directory for dev or packaged mode.
4. Electron verifies or downloads the embedding model if needed.
5. Electron starts Flask with:
   - `FLASK_HOST=127.0.0.1`
   - `FLASK_PORT=<dynamic>`
   - `SAVANT_BUNDLED_MODEL_DIR=<bundled model path>`
6. Electron polls `GET /api/db/health`.
7. Electron kills orphaned MCP listeners on ports `8091` to `8094`.
8. Electron starts the MCP servers.
9. Electron patches client-side MCP configs for external AI tools.
10. Electron navigates the main window to the Flask UI.

## 2. Flask Request Flow

1. Browser or MCP bridge calls a Flask endpoint.
2. `app.py` or a blueprint route handles the request.
3. Request handlers interact with SQLite DB helpers under `savant/db/` or feature modules.
4. Response returns JSON or a Jinja-rendered page.
5. HTML responses are marked no-cache by `after_request`.

Important behavior:

- `app.py` initializes SQLite during startup.
- abilities, context, and knowledge are registered as Flask blueprints.
- most workspace and session routes still live directly in `app.py`.

## 3. Terminal Data Flow

### 3.1 Creation

1. A renderer page calls `window.terminalAPI.create()` from `preload.js`.
2. Electron receives `terminal:create`.
3. Electron spawns a PTY with `node-pty`.
4. PTY output is buffered and streamed back through IPC.

### 3.2 Rendering

1. `terminal.html` hosts xterm.js.
2. `savant/static/js/terminal.js` manages tabs, panes, and splits.
3. `savant/static/js/terminal-bridge.js` exposes page-level helpers like drawer toggle and open-new-tab.
4. Main UI pages treat the terminal as an external surface instead of inline DOM content.

### 3.3 Persistence Across Navigation

1. Electron stores PTY objects in memory.
2. Renderer reconnects by calling `terminal:list`.
3. xterm panes are recreated against living PTYs.
4. Buffered output is replayed into the new view.

## 4. Workspace and Task Flow

### 4.1 Workspace Lifecycle

1. User or agent creates a workspace through Flask or MCP.
2. Workspace is stored in `workspaces`.
3. Session assignment writes workspace metadata for the specific provider.
4. Notifications are emitted for important changes.

### 4.2 Task Lifecycle

1. Task is created under a workspace.
2. DB allocates task metadata and ordering data.
3. Task dependencies are stored in `task_deps`.
4. UI reads and reorders tasks through REST endpoints.

## 5. Session Ingestion Flow

### 5.1 Copilot

Source:

- `~/.copilot/session-state`

Mechanism:

- Session directories and metadata are scanned
- `.copilot-meta.json` is used for workspace linkage

### 5.2 Claude

Sources:

- `~/.claude`
- `~/.claude/sessions`
- `~/.claude/.savant-meta`

Mechanism:

- Session file or session directory discovery
- Savant metadata files store workspace assignment

### 5.3 Codex

Sources:

- `~/.codex/sessions`
- `~/.codex/.savant-meta`

Mechanism:

- Session logs are discovered from Codex session files
- workspace mapping is mirrored into `.savant-meta/<session_id>.json`
- MCP session detection relies on `CODEX_SESSION_ID` or related env signals

### 5.4 Gemini

Sources:

- `~/.gemini`
- `~/.gemini/tmp/savant-app`
- `~/.gemini/.savant-meta`

Mechanism:

- Recent Gemini logs and artifact directories are parsed
- Savant workspace assignment is stored in `.savant-meta`

## 6. MCP Flow

### 6.1 Workspace MCP

1. AI tool calls a FastMCP tool on port `8091`.
2. `savant/mcp/server.py` detects the current session if needed.
3. The MCP server calls the matching Flask route.
4. Flask updates SQLite or provider metadata.
5. MCP returns normalized JSON to the AI tool.

### 6.2 Abilities MCP

1. Agent calls `resolve_abilities`, list tools, or asset CRUD operations.
2. MCP server forwards to `/api/abilities/*`.
3. Ability store reloads assets from disk.
4. Resolver composes the final prompt bundle.

### 6.3 Context MCP

1. Agent calls semantic search or memory-bank tools.
2. MCP server calls `/api/context/*`.
3. Context layer ensures schema and vector support are ready.
4. Queries execute against `ctx_*` tables and vector data.

### 6.4 Knowledge MCP

1. Agent calls graph search, store, connect, commit, or traversal tools.
2. MCP server calls `/api/knowledge/*`.
3. Knowledge DB updates nodes and edges in SQLite.
4. Staged knowledge can later be committed.

## 7. Context Indexing Flow

1. Repo is registered in `ctx_repos`.
2. Indexer loads the embedding model.
3. Existing repo data is cleared for reindex.
4. File walker traverses the repo with ignore support.
5. Language and memory-bank detection classify each file.
6. File contents are chunked.
7. Each chunk is embedded.
8. Chunks and vectors are inserted into SQLite.
9. Repo status is updated to `indexed`, `error`, or `cancelled`.

Important indexing constraints:

- binary files are skipped
- large files are skipped
- memory-bank files are marked separately
- progress is kept in process memory for UI polling

## 8. Knowledge Graph Flow

### 8.1 Node Creation

1. Route validates type, title, IDs, and content size.
2. Node is inserted into `kg_nodes`.
3. Status defaults to `staged` unless otherwise specified.

### 8.2 Edge Creation

1. Route validates IDs and edge type.
2. DB confirms both nodes exist.
3. Duplicate edge protection is enforced.

### 8.3 Workspace Linking

1. Workspace association is stored in node metadata, not as a separate workspace-node table.
2. Multi-workspace linkage is supported.

### 8.4 Commit Flow

1. Staged nodes are created through store workflows.
2. Commit endpoint promotes staged nodes to `committed`.
3. Only committed nodes are shown in default graph views unless staged content is explicitly included.

## 9. Notification Flow

1. Backend action calls `_emit_event`.
2. Notification is written into SQLite.
3. Legacy in-memory event queue is also updated.
4. Frontend polls notification endpoints and renders toast/history views.

## 10. Config Patching Flow

When Savant starts, Electron attempts to add MCP server entries to:

- Copilot CLI config
- Claude Desktop config
- Gemini CLI config
- Codex CLI config

Two patterns are used:

- SSE entries for normal desktop/runtime use
- stdio entries for Codex CLI compatibility

## 11. Failure Modes Agents Should Expect

- Flask can fail to start if Python or Flask is missing.
- MCP servers can fail if the Python `mcp` package is missing.
- context search can be unavailable if `sqlite-vec` or ML dependencies are not available.
- session autodetection can fail when required env variables are missing or provider files do not exist.
- the backend is partly monolithic, so route-level changes in `app.py` can have broad side effects.
