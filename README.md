# Savant Monorepo

License Owned by Project X. This repository is private and proprietary.

## v8.2.0 Hero Release

Savant v8.2.0 extends the Context MCP with deterministic class/file analysis tools, diff-aware before/after scoring, and clearer refactor guidance for AI agents.

What is included in this release:
- Context MCP now exposes analysis tools for class-name inspection and diff-aware before/after comparisons.
- New code paths can be measured as before=0 and after=current so refactor cost is visible from the start.
- MCP guide/docs were updated to explain the new analysis contract for agents.

Previous hero release:
- v8.1.5: client/server split, local session ownership, source ingestion, hardened runtime, MCP diagnostics, and client-owned MCP config detection/setup.

What is included in this branch:
- The product is now split into `savant-app` (client) and `savant-server` (backend).
- Shared data moves to centralized server storage (API + DB + MCP-side orchestration).
- Client keeps local-only concerns (UI runtime, terminal/xterm, D3 views, local cache, offline queue).
- Client/server integration is standardized through HTTP/SSE contracts for enterprise deployment.
- Context project ingestion supports source modes:
  - GitHub URL
  - GitLab URL (including self-hosted GitLab-style domains)
  - Server directory (relative to `BASE_CODE_DIR`)
- MCP Tool Guide now includes in-guide action logs and abilities bootstrap visibility.
- AI Agent MCP config status/setup is resolved from client-local config files through Electron IPC (with server API fallback).

## Quick Start (One Command Server)

Run server in Docker with mounted code base for context directory source:

```bash
BASE_CODE_HOST_DIR=~/code/archived docker compose up -d --build
```

Then run client in dev mode:

```bash
cd client
SAVANT_SERVER_URL=http://127.0.0.1:8090 npm run dev
```

Savant is now split into two independent applications:

- `client/` — Electron desktop app (`savant-app`)
- `server/` — Python API + MCP backend (`savant-server`)

There is no shared runtime code import between `client` and `server`.  
The client integrates with the server only through HTTP/SSE APIs.

## Canonical Agent Guidance

For architecture, engineering methodology, and complete install/run/test/build/deploy instructions, use:

- [AGENTIC.md](./AGENTIC.md)

## Repository Layout

```text
savant-app/
  client/   # Electron app, local cache, offline queue, local agent runtime
  server/   # Flask backend, MCP servers, web UI assets, persistence
```

## Team Ownership

- **Client team**
  - owns `client/`
  - desktop UX, offline queue, local preferences, terminal/agent runtime
- **Server team**
  - owns `server/`
  - API contracts, MCP orchestration, indexing, knowledge graph, notifications

## Run Independently

### 1) Server

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python app.py
```

Server defaults to `http://127.0.0.1:8090`.

### 2) Client

```bash
cd client
npm install
SAVANT_SERVER_URL=http://127.0.0.1:8090 npm run dev
```

The client stores one server URL per install in local SQLite preferences.

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| **Connectivity** | | |
| `SAVANT_SERVER_URL` | URL of the Flask server (used by Electron client). | `http://127.0.0.1:8090` |
| `SAVANT_FLASK_PORT` / `FLASK_PORT` | Port for the Flask server. | `8090` |
| `FLASK_HOST` | Host to bind the Flask server to. | `0.0.0.0` |
| `SAVANT_API_BASE` | Base URL used by MCP servers to reach the Flask API. | `http://localhost:8090` |
| **MCP Ports** | | |
| `SAVANT_MCP_PORT` | Port for the **Workspace** MCP server. | `8091` |
| `SAVANT_ABILITIES_MCP_PORT` | Port for the **Abilities** MCP server. | `8092` |
| `SAVANT_CONTEXT_MCP_PORT` | Port for the **Context** MCP server. | `8093` |
| `SAVANT_KNOWLEDGE_MCP_PORT` | Port for the **Knowledge** MCP server. | `8094` |
| **Data Directories** | | |
| `SAVANT_SERVER_DATA_DIR` | Server-owned persistent data root (mount this in Docker). | `/data/savant` (Docker) or `server/data` (local) |
| `SAVANT_DB` | Explicit SQLite DB path override. | `<SAVANT_SERVER_DATA_DIR>/savant.db` |
| `SAVANT_ABILITIES_DIR` | Explicit abilities base dir override (`<base>/abilities/...`). | `<SAVANT_SERVER_DATA_DIR>` |
| `SAVANT_ABILITIES_SEED_DIR` | Seed source for abilities bootstrap. | `./savant/abilities` (repo) |
| `SESSION_DIR` | Path to GitHub Copilot CLI session state. | `~/.copilot/session-state` |
| `CLAUDE_DIR` | Path to Claude Code session data. | `~/.claude` |
| `GEMINI_DIR` | Path to Gemini CLI configuration. | `~/.gemini` |
| `CODEX_DIR` | Path to Codex CLI data. | `~/.codex` |
| `HERMES_DIR` | Path to Hermes Agent data. | `~/.hermes` |
| `META_DIR` | Path to Savant metadata (workspaces, MRs). | `~/.savant/meta` |
| **Context & Models** | | |
| `EMBEDDING_MODEL_DIR` | Custom path for the embedding model files. | (Bundled/User home) |
| `EMBEDDING_MODEL_NAME` | Model name for sentence-transformers. | `stsb-distilbert-base` |
| `EMBEDDING_VERSION` | Version tag for the model. | `v1` |
| **App Behavior** | | |
| `RUNNING_IN_DOCKER` | Set to `1` or `true` if running in a container. | (Auto-detected) |
| `SAVANT_DISABLE_BG_CACHE` | Set to `1` to disable the server's background cache worker. | `0` |
| `SHELL` | Default shell for the persistent terminal. | `$SHELL` or `/bin/zsh` |

## Testing

### Server backend coverage

```bash
cd server
pytest
```

Configured via `server/pytest.ini` with `pytest-cov`.

### Server frontend contract tests

```bash
cd server
npm run test:frontend
```

### Client tests

```bash
cd client
npm test
npm run test:coverage
npm run test:frontend
npm run test:ui
```

### One command full repo tests

```bash
./run-all-tests.sh
```

### Build DMG (frontend/client)

```bash
./build-client.sh
```

## Production Notes

- Server should run in enterprise infrastructure (VM/Docker/K8s).
- Client remains fully usable for local agent workflows when server is offline.
- Server-bound mutations are queued locally and replayed in strict FIFO order when connectivity returns.

## Continuous Hardening Log

- Loop 1 (2026-04-21): Added backend TDD coverage for server storage/seed bootstrap branches and restored enforced backend coverage to 100%.
- Loop 2 (2026-04-21): Added contract test preventing browser feature regressions and aligned guide docs with removed browser action.
- Loop 3 (2026-04-21): Added client-store defensive branch tests and raised client store coverage to 100% lines/branches/functions.
- Loop 4 (2026-04-21): Added monorepo integration tests in `tests/` and wired `run-all-tests.sh` to execute them after client/server suites.
- Loop 5 (2026-04-21): Added regression coverage for empty project explorer rendering to guarantee Add Project remains available with zero repos.
- Loop 6 (2026-04-21): Removed residual reindex action handlers from context UI code and added a regression test that reindex actions stay absent.
- Loop 7 (2026-04-21): Migrated server Pydantic models to `ConfigDict` (v2-native) and removed class-config deprecation risk while preserving 100% backend coverage.
- Loop 8 (2026-04-21): Added a pipeline contract test to prevent accidental removal of monorepo integration tests from `run-all-tests.sh`.
- Loop 9 (2026-04-21): Corrected server build metadata to `8.1.4` and added integration validation for `/api/system/info` version output.
- Loop 10 (2026-04-21): Added repository hygiene test coverage to enforce DB artifact ignore rules and prevent accidental state file commits.
