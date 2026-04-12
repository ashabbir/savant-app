# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Savant is an **Electron + Flask + MCP** desktop app (macOS) for monitoring AI coding sessions (Copilot CLI, Cline, Claude Code). Three-process model: Electron shell → Flask REST backend → MCP SSE servers.

## Build & Run Commands

```bash
npm install                        # Install Electron + node-pty deps
npm run dev                        # Dev mode (Electron + Flask + MCP)
npm run build                      # Production macOS DMG + dir build

# Flask standalone
cd savant && pip install -r requirements.txt && python app.py

# Tests
cd savant && python3 -m pytest tests/ -v
cd savant && python3 -m pytest tests/test_foo.py -v        # single file
cd savant && python3 -m pytest tests/test_foo.py::test_bar  # single test

# Build & deploy to /Applications
osascript -e 'quit app "Savant"' && sleep 2
rm -rf dist && npm run build
rsync -a --delete dist/mac-arm64/Savant.app/ /Applications/Savant.app/
open /Applications/Savant.app
```

## Architecture

### Three-Process Model

1. **Electron** (`main.js`) — BrowserWindow, loading screen, spawns Flask on dynamic port, spawns MCP servers on fixed ports, navigates to Flask URL. Hides to tray on close.
2. **Flask** (`savant/app.py`) — REST API + Jinja2 templates. Blueprints for abilities, context, knowledge. Background cache thread refreshes sessions.
3. **MCP Servers** (`savant/mcp/`) — FastMCP SSE bridges that proxy tool calls to Flask REST API via HTTP.

### MCP Server Registry

| Server | Port | File | Purpose |
|---|---|---|---|
| savant-workspace | 8091 | `mcp/server.py` | Workspace/task/note/MR/Jira CRUD |
| savant-abilities | 8092 | `mcp/abilities_server.py` | Persona/rule resolution, YAML assets |
| savant-context | 8093 | `mcp/context_server.py` | Semantic code search, memory bank |
| savant-knowledge | 8094 | `mcp/knowledge_server.py` | Knowledge graph nodes/edges |

### Startup Sequence

`main.js`: find free port → spawn Flask → poll `GET /api/db/health` → kill orphans on MCP ports (lsof) → spawn 4 MCP servers → `setupMcpConfigs()` patches Copilot CLI, Claude Desktop, and Codex CLI configs → navigate BrowserWindow to Flask.

### Data Layer

- SQLite at `~/.savant/savant.db` (WAL mode, schema v5)
- `savant/sqlite_client.py` — singleton `SQLiteClient`
- `savant/db/*.py` — static-method classes (`WorkspaceDB`, `TaskDB`, `NoteDB`, `MergeRequestDB`, `JiraTicketDB`, `NotificationDB`, `ExperienceDB`, `KnowledgeGraphDB`)
- `savant/models.py` — Pydantic validation models
- Timestamps: ISO 8601 UTC strings

### Frontend

- Server-rendered Jinja2 (`savant/templates/index.html`, `detail.html`)
- Vanilla JS (no framework, no TypeScript, no bundler)
- xterm.js terminal in a persistent BrowserView (`terminal.html`, `preload.js`)

### Key Subsystems

- **Abilities** (`savant/abilities/`) — YAML-driven persona/rule/policy store with prompt resolver
- **Context** (`savant/context/`) — sqlite-vec embeddings, code indexing, semantic search, chunking
- **Knowledge** (`savant/knowledge/`, `savant/db/knowledge_graph.py`) — graph of nodes/edges with experiences
- **Hardening** (`savant/hardening.py`) — `@rate_limit`, `@validate_request`, `@safe_limit`, `@retry_with_backoff`
- **Session Detection** (`savant/mcp/session_detect.py`) — PID-based process tree walking

## Key Conventions

- **DB entities**: each has `savant/db/<entity>.py` with `@staticmethod` methods calling `get_connection()`. Follow this pattern for new entities.
- **Flask Blueprints**: feature modules register as Blueprints under `/api/<feature>/*`.
- **MCP tools**: thin proxies — call Flask API via `_api()` helper, return `dict`/`list`. Docstrings become tool descriptions. Type hints required for JSON schema generation.
- **Python path resolution**: `main.js` searches `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, `/usr/bin/python3`, `python3` and probes for packages.
- **Packaging**: `savant/` directory goes into `extraResources` (not asar). In packaged mode, `process.resourcesPath + "/savant"` is the Flask root.
- **Logs**: `~/Library/Application Support/savant/savant-main.log`

## Adding New Features

The `.github/copilot-instructions.md` file contains detailed step-by-step checklists for:
- Adding a new MCP server (Flask Blueprint → MCP server file → Electron integration → UI tab)
- The exact MCP server template to copy
- Port allocation and config patching

Always consult that file when adding MCP servers or Flask Blueprints.

## Test Infrastructure

- pytest with fixtures in `savant/tests/conftest.py`
- `_isolated_db` fixture creates a temp SQLite DB per test
- `client` fixture provides Flask test client
- `sample_workspace` / `sample_tasks` fixtures for pre-populated data
- 26+ test files in `savant/tests/`
