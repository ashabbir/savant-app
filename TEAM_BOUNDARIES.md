# Team Boundaries

## Client Team (`client/`)

Owns:
- Electron shell (`main.js`, `preload.js`)
- local persistence (`client_store.js`)
- offline queue and replay behavior
- terminal/agent local runtime UX

Must not:
- import Python/server modules
- rely on `server/` files at runtime

## Server Team (`server/`)

Owns:
- Flask API routes and persistence
- MCP servers and orchestration
- server-rendered web UI assets (`templates/`, `static/`)
- indexing/knowledge/workspace domain logic

Must not:
- import from `client/`
- assume Electron-only runtime APIs

## Integration Contract

- Transport: HTTP + SSE only
- Config: client uses one locally stored `server_url`
- Offline semantics: client queues server mutations in strict FIFO and replays when online
