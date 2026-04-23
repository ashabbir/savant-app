# Savant Architecture Overview (v8 Client/Server)

## 1) Product Shape

Savant is split into two independent deployables:

1. `savant-app` -> `client/` (Electron desktop app per developer machine)
2. `savant-server` -> `server/` (central API + MCP backend)

They communicate over HTTP/SSE contracts.

## 2) Ownership Boundaries

### Client owns

- UI rendering (`client/renderer/index.html`, `client/renderer/detail.html`)
- Desktop runtime (`client/main.js`, `client/preload.js`)
- Terminal/xterm and D3 UI surfaces
- Local preferences/cache/offline queue (`client/client_store.js`)
- Local provider session discovery, detail, and mutation (`client/session_service.js`)
- Local AI agent MCP config detection/setup (`client/mcp_agent_config.js` via Electron IPC)

### Server owns

- Shared API surface (`server/app.py`)
- Abilities/context/knowledge APIs
- MCP servers (`server/mcp/*.py`)
- Central shared persistence (server DB and server data root)
- Context project ingestion orchestration (GitHub/GitLab/Directory) under `BASE_CODE_DIR`

## 3) Session Architecture (Current)

Session data is local-first and client-owned:

- Sources: provider files on user machine (`~/.copilot`, `~/.claude`, `~/.codex`, `~/.gemini`, `~/.hermes`)
- Local service: `client/session_service.js`
- IPC bridge from renderer to main process:
  - `savant:list-local-sessions`
  - `savant:get-local-session`
  - `savant:rename-local-session`
  - `savant:set-local-session-star`
  - `savant:set-local-session-archive`
  - `savant:delete-local-session`
- Live update signal:
  - main process broadcasts `savant:sessions-updated`
  - sessions UI listens and refreshes immediately

This keeps session lifecycle responsive even when server connectivity is down.

## 4) Storage Split

### Client-local storage

- Server URL preference (one server per install)
- UI preferences
- Offline FIFO mutation queue (7-day retention; server wins on conflict)
- Provider session metadata overlays (rename/star/archive/workspace links)

### Server storage

- Workspaces
- Tasks
- Notes, MRs, Jira links
- Context index data
- Knowledge graph data
- Abilities catalog (server-side seed/bootstrap)

## 5) Runtime Topology

### Client process model

- Electron main process
- BrowserWindow renderer (dashboard/detail)
- BrowserView terminal surface
- Local session watcher service in main process

### Server process model

- Flask API process
- MCP processes for workspace/abilities/context/knowledge
- Optional containerized deployment (Docker/Kubernetes)

## 6) Design Goals

- Preserve UI behavior while moving ownership to correct side
- Keep provider-specific session logic modular for easy future providers
- Keep client/server concerns strict so two teams can work independently
- Keep credentials and provider configs local to client machine; avoid server-side assumptions about desktop config files
