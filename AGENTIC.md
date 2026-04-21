# AGENTIC.md

Canonical architecture and engineering methodology for all agents (Claude, Gemini, Copilot, Codex).

## 0) Agent Bootstrap (Install / Run / Test / Build)

Use this as the default startup checklist for any agent session.

### Prerequisites
- Node.js + npm available for `client/`.
- Python 3.11 available for `server/`.
- macOS build flow assumes Xcode command line tools for Electron packaging.

### Initial install

```bash
# Client deps
cd client
npm install

# Server deps
cd ../server
python3.11 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

### Run locally (independent processes)

```bash
# Terminal A: start server
cd server
.venv/bin/python app.py

# Terminal B: start client and point to server
cd client
SAVANT_SERVER_URL=http://127.0.0.1:8090 npm run dev
```

### Run tests

```bash
# Client-only
cd client
./run-tests.sh

# Server-only
cd ../server
./run-tests.sh

# Full repo
cd ..
./run-all-tests.sh
```

### Build / deploy helpers

```bash
# Repo root
./build-client.sh
./build-server.sh
./deploy-client.sh
./deploy-server.sh
```

### Minimum pre-PR validation
- Run touched-scope tests at minimum.
- For cross-boundary changes, run `./run-all-tests.sh`.
- Verify client still renders key screens and server API routes start cleanly.

## 1) System Architecture (Current)

Savant is a split enterprise system with two independent deployables:

1. `client/` (`savant-app`): Electron desktop app installed per user machine.
2. `server/` (`savant-server`): centralized Flask API + MCP backend deployed in customer infrastructure.

Core rule: client and server must run independently and communicate over HTTP/SSE contracts only.

## 2) Ownership Boundaries

### Client owns
- Desktop shell lifecycle (`client/main.js`, `client/preload.js`).
- UI rendering and interaction:
  - `client/renderer/index.html`
  - `client/renderer/detail.html`
  - `client/renderer/static/js/*`
- Terminal/xterm and D3 visualization surfaces:
  - `client/terminal.html`
  - context/AST/visual modules in `client/renderer/static/js/`
- Agent-local runtime concerns (agent launch/runtime UX).
- Local SQLite preferences/cache/outbox (`client/client_store.js`):
  - one server URL per install
  - local UI/user preferences
  - offline mutation queue (FIFO)

### Server owns
- API and orchestration (`server/app.py`).
- Feature API modules/blueprints (`server/abilities`, `server/context`, `server/knowledge`).
- Centralized persistence and source of truth (`server/sqlite_client.py`, `server/db/*`).
- MCP servers (`server/mcp/*.py`) that expose server-side tools.

### Strict non-ownership
- Server must not own renderer HTML/CSS/JS, xterm UI, or guide UI runtime.
- Client must not embed server runtime internals.

## 3) Integration Contract

- Protocol: HTTP for request/response APIs, SSE where streaming/status is needed.
- Offline behavior:
  - Client can continue limited local operations.
  - Mutations queue locally (FIFO string payload model).
  - Retention policy: 7 days.
  - Reconnect replay: client flushes queue to server.
  - Conflict policy: server wins.
- Server availability:
  - if unavailable, client remains usable for local agent management and cached reads.

## 4) Deployment Model

- Enterprise deployment, no tenant boundary required in current phase.
- Customer hosts `savant-server` in their infra (VM, Docker, or Kubernetes).
- Users install `savant-app` locally and connect to one configured server endpoint.
- Authentication/RBAC:
  - initial phase may run without full auth model
  - username/password then RBAC planned in later phase
  - no SSO requirement currently

## 5) Data Model Direction

- Centralized data objective: server is canonical store for shared application data and knowledge graph.
- Local-only data objective: client stores preferences/cache/offline queue and local agent runtime state.
- Existing migration of legacy data is not required for phase 1 split; can be handled later.

## 6) Engineering Methodology

### Design principles
- Keep client/server concerns explicit and separated.
- Prefer small, composable modules with clear ownership.
- Reuse existing patterns before introducing new abstractions.
- Keep MCP implementations thin and API-proxy oriented.
- Preserve current UX/behavior while refactoring internals.

### Coding standards
- JavaScript: 2-space indentation, `const`/`let`, existing repo style.
- Python: 4-space indentation, PEP 8 naming/style.
- Keep changes scoped; avoid unrelated refactors in the same change.
- Add comments only where logic is non-obvious.

### Refactor approach
- Migrate screen-by-screen without changing look/feel unexpectedly.
- Decompose large renderer scripts into reusable components/modules as you touch them.
- Keep UI behavior parity while reducing duplication.

## 7) Testing and Quality Gates

### Client tests
- `cd client && ./run-tests.sh`
- Includes:
  - unit tests (`npm test`)
  - coverage run (`npm run test:coverage`)
  - frontend contract/integration checks (`npm run test:frontend`)

### Server tests
- `cd server && ./run-tests.sh`
- Uses server-local venv + pytest.

### Full workspace run
- `./run-all-tests.sh`

### Coverage intent
- Quality bar is high and should trend to comprehensive coverage for server API/MCP/data paths and client critical flows.
- Tests must align with the split architecture; obsolete monolith path assumptions should be removed or migrated.

## 8) Build and Deploy Scripts

Repo root helper scripts:
- `build-client.sh`
- `build-server.sh`
- `deploy-client.sh`
- `deploy-server.sh`

Per-app test scripts:
- `client/run-tests.sh`
- `server/run-tests.sh`

## 9) Documentation Rules

- `AGENTIC.md` is the canonical shared architecture + methodology source.
- Agent-specific docs (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot-specific docs if present) should reference this file rather than duplicating architecture content.
- Keep agent-specific files focused on invocation nuances, not divergent architecture statements.
