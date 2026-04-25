# Data Location PRD — Implementation Status (2026-04-22)

## Original intent
- Session data (`~/.claude`, `~/.copilot`, etc.) is local-machine data and should be owned by client/runtime-local logic.
- Workspaces are server-owned containers for shared planning artifacts (tasks, notes, knowledge graph, and session links).
- Tasks are server-owned and assigned to workspaces.

## Status summary
- Client-owned session lifecycle: ✅ Implemented (primary path)
- Server-owned workspace/task persistence: ✅ Implemented
- Server-owned workspace↔session linkage: ✅ Implemented
- Legacy overlap still present in server session APIs: ⚠️ Transitional (not blocking current split flow)

## Evidence in codebase

### 1) Sessions are client-owned
- `client/session_service.js`
  - Discovers sessions from local provider directories.
  - Handles local metadata overlays (rename/star/archive/workspace).
- `client/preload.js`
  - Exposes `listLocalSessions`, `getLocalSession`, and local session mutation IPC methods.
- `client/main.js`
  - Broadcasts `savant:sessions-updated` for local-first UX.

Status: ✅

### 2) Workspaces and tasks are server-owned
- `server/sqlite_client.py`
  - Defines canonical server tables: `workspaces`, `tasks`, and related entities.
- `server/db/workspaces.py`, `server/db/tasks.py`
  - Server persistence and domain CRUD.
- `server/app.py`
  - API routes for workspace/task operations.

Status: ✅

### 3) Workspace links to sessions are server-owned mappings
- `server/sqlite_client.py`
  - `workspace_session_links` table.
- `server/db/workspace_session_links.py`
  - Mapping logic for provider + session_id attached to workspace_id.
- `server/app.py`
  - Session-link API endpoints under `/api/workspaces/<ws_id>/session-links`.

Status: ✅

## Notes / caveats
- Server still contains broad session-related endpoints for compatibility and legacy workflows.
- Current split architecture uses client-local session discovery as the preferred path, with server retaining shared domain ownership.

Status: ⚠️ Transitional overlap remains, but architecture direction is correctly implemented.

## Final assessment
This PRD is effectively implemented for the v8 client/server split:
- Local session ownership is on client.
- Shared collaboration artifacts (workspaces/tasks/knowledge/etc.) are on server.
- Data-boundary objective is met with known backward-compatibility overlap.
