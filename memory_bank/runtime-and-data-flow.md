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
