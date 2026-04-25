# Savant Runtime and Data Flow (v8)

## 1) Client Startup Flow

1. `client/main.js` starts Electron.
2. Client loads `loading.html`, then dashboard renderer.
3. Client loads local store (`client_store.js`) and server URL preference.
4. Client initializes local session service (`session_service.js`).
5. Session service starts filesystem watchers for provider roots.
6. Renderer requests local sessions over preload IPC.
7. If provider files change, main emits `savant:sessions-updated`; renderer refreshes session list.

## 2) Session List + Detail Flow (Client-Owned)

1. Sessions page calls `window.savantClient.listLocalSessions(...)`.
2. Main process delegates to `LocalSessionService.listSessions(...)`.
3. Service scans provider-native files, applies local metadata overlays, returns sorted records.
4. On card open or expansion, renderer calls `getLocalSession(...)`.
5. Service returns detail + lightweight local tree snapshot.

## 3) Session Mutation Flow (Client-Owned)

Mutations are local operations:

- Rename -> `renameLocalSession`
- Star -> `setLocalSessionStar`
- Archive -> `setLocalSessionArchive`
- Delete -> `deleteLocalSession`

After mutation:

1. Service updates local metadata/filesystem.
2. Service invalidates cache.
3. Main broadcasts `savant:sessions-updated`.
4. Sessions UI updates without waiting for polling.

## 4) Server Data Flow (Shared Data)

Server API handles non-local shared domains:

- workspaces
- tasks
- notes
- MRs/Jira associations
- context indexing/search
- knowledge graph
- abilities APIs

Client communicates with server through HTTP APIs and optional SSE status streams.

### Context Project Ingestion Flow (Server-Owned)

1. Client requests source availability (`/api/context/repos/sources`).
2. User submits source payload (`source=github|gitlab|directory`) to `/api/context/repos`.
3. Server ingestion service validates source and security constraints:
   - token gating for remote repos
   - `BASE_CODE_DIR` traversal protection for directory mode
4. Server clones/updates or resolves directory under `BASE_CODE_DIR`.
5. Existing indexing/AST pipelines run against the resulting project path.

### Context Analysis Flow (Server-Owned)

1. AI agent calls Context MCP `analyze_code` with a class/file target, or with a diff/replacement body.
2. MCP server forwards the request to `POST /api/context/analysis`.
3. Server accepts `path`, `uri`, `code`, or diff-only payloads, resolves the current source when available, isolates the requested class or symbol when named, and computes deterministic before/after complexity plus findings.
4. If the target is new, before-state complexity is reported as zero and after-state reflects the new code surface.
5. The agent uses the structured delta to decide whether to accept the refactor, split it, or further reduce complexity.

## 5) Offline Behavior

When server is unavailable:

- session list/detail/mutations still work locally
- local agent/terminal controls remain available
- shared-data writes are queued locally (FIFO) for replay

When server returns:

1. client detects health
2. outbox replay runs
3. server is source of truth for shared records

## 6) MCP Flow

MCP servers are server-side.

1. AI tool calls server MCP endpoint/tool.
2. MCP server calls server API routes.
3. Server reads/writes central data stores.
4. Results returned to calling tool.

Client does not host business MCP servers in the v8 split.

Context MCP now includes `analyze_code` in addition to search-oriented tools. It is still server-side and deterministic; the client only renders the guide and release notes.

## 7) AI Agent MCP Config Flow (Client-Owned)

1. System Info requests provider config status through `window.electronAPI.checkMcpAgentConfigs()`.
2. Electron main reads local agent config files on the desktop machine.
3. UI renders configured/not-configured/no-config-file status per provider.
4. Setup button calls `window.electronAPI.setupMcpAgentConfigs(...)` to patch local files.
5. Server `/api/check-mcp` and `/api/setup-mcp` remain fallback paths when desktop bridge is unavailable.
