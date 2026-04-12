# Savant Architecture Overview

## 1. Purpose

Savant is a macOS desktop dashboard for monitoring and managing AI coding sessions across multiple providers. In this checkout, the supported providers are:

- GitHub Copilot CLI
- Claude Code
- Codex CLI
- Gemini CLI

The product combines a desktop shell, a Python backend, multiple MCP servers, a persistent terminal surface, and a SQLite-backed data layer.

## 2. Top-Level Architecture

Savant runs as a three-process system:

1. Electron desktop shell
2. Flask backend application
3. Multiple MCP bridge servers

At runtime the effective flow is:

1. Electron starts first and opens `loading.html`.
2. Electron finds a free local Flask port.
3. Electron starts `savant/app.py`.
4. Electron waits for `/api/db/health` to succeed.
5. Electron starts the MCP servers on fixed local ports.
6. Electron patches local AI-tool MCP configs when possible.
7. Electron navigates the main window to the Flask UI.

## 3. Process Boundaries

### 3.1 Electron

Primary file: `main.js`

Responsibilities:

- Creates the main `BrowserWindow`
- Creates the persistent terminal `BrowserView`
- Manages PTY lifecycle through `node-pty`
- Starts and stops Flask
- Starts and stops the MCP servers
- Performs fixed-port cleanup for MCP servers
- Updates Copilot, Claude Desktop, Gemini, and Codex MCP config files
- Provides preload bridges for renderer access to terminal and desktop actions

Important runtime traits:

- Flask port is dynamic.
- MCP ports are fixed:
  - `8091` workspace
  - `8092` abilities
  - `8093` context
  - `8094` knowledge
- Terminal rendering is persistent across page changes because it lives in a `BrowserView`, not in the main page DOM.

### 3.2 Flask Backend

Primary file: `savant/app.py`

Responsibilities:

- Serves the dashboard UI via Jinja templates
- Exposes the main REST API
- Scans and parses provider session data from the filesystem
- Stores workspace, task, note, MR, Jira, notification, knowledge, and context metadata
- Hosts feature blueprints:
  - abilities
  - context
  - knowledge

Important backend characteristics:

- Monolithic entrypoint with many route handlers
- Uses a background in-memory cache for session lists and usage summaries
- Persists durable application state in SQLite
- Still reads provider-native session artifacts from the filesystem

### 3.3 MCP Servers

Primary directory: `savant/mcp/`

Responsibilities:

- Expose selected Savant behavior to AI agents through FastMCP
- Proxy MCP tool calls to Flask REST endpoints
- Provide separate logical servers for:
  - workspace/task/note/MR/Jira operations
  - abilities resolution and asset management
  - semantic context search and memory-bank access
  - knowledge graph operations

Pattern:

- Thin bridge
- Minimal business logic
- Requests-based HTTP client against Flask
- Tool docstrings define MCP tool semantics

## 4. UI Architecture

### 4.1 Rendering Model

The UI is server-rendered HTML plus modular vanilla JavaScript.

Key parts:

- `savant/templates/index.html`: main dashboard view
- `savant/templates/detail.html`: session detail page
- `savant/templates/components/_header.html`: shared header macros
- `savant/static/css/shared.css`: shared chrome and base styling
- `savant/static/js/*.js`: page and feature modules

There is no frontend framework, bundler, or TypeScript layer in this repo.

### 4.2 Major Frontend Areas

- Session dashboards and filters
- Workspace management
- Task board
- Context/indexing UI
- Knowledge graph UI
- Abilities asset browser/editor
- MCP diagnostics/playground
- Developer guide overlay
- Notification history and toast system
- Persistent terminal bridge

### 4.3 Terminal Model

The terminal is not embedded into the Flask-rendered DOM as a traditional widget.

Instead:

- Electron owns PTY processes
- `terminal.html` renders the terminal UI in a dedicated `BrowserView`
- `preload.js` exposes IPC APIs
- `savant/static/js/terminal-bridge.js` connects normal pages to the persistent terminal
- `savant/static/js/terminal.js` drives xterm.js panes, tabs, and split behavior inside the terminal surface

This design avoids losing terminal state during page navigation.

## 5. Persistence Model

### 5.1 Primary Durable Store

Primary DB file:

- `~/.savant/savant.db`
- Override via `SAVANT_DB`

DB engine:

- SQLite
- WAL mode
- foreign keys enabled
- schema version tracked in `meta`

### 5.2 Main Data Domains in SQLite

- workspaces
- tasks
- task dependencies
- notes
- merge requests
- MR notes and MR-session assignments
- Jira tickets
- Jira notes and Jira-session assignments
- notifications
- preferences and metadata
- legacy experiences
- knowledge graph nodes and edges
- context indexing tables and vector storage

### 5.3 Context Search Storage

Context search lives in the same SQLite connection but uses `ctx_*` prefixed tables and a `sqlite-vec` virtual table:

- `ctx_repos`
- `ctx_files`
- `ctx_chunks`
- `ctx_vec_chunks`

### 5.4 Filesystem Sources Still Used

Savant still depends heavily on provider-native filesystem data:

- Copilot session-state directories
- Claude session files and metadata
- Codex session logs and `.savant-meta`
- Gemini temp and metadata files

The app stores application metadata in SQLite, but provider conversations and session artifacts remain filesystem-driven.

## 6. Core Subsystems

### 6.1 Workspace and Task System

Main backend:

- `savant/app.py`
- `savant/db/workspaces.py`
- `savant/db/tasks.py`
- `savant/db/notes.py`
- `savant/db/merge_requests.py`
- `savant/db/jira_tickets.py`
- `savant/db/notifications.py`

Capabilities:

- Workspace CRUD
- Session-to-workspace assignment
- Daily task tracking and ordering
- Task dependency graph
- Session and workspace notes
- Merge request tracking
- Jira ticket tracking
- Notification history

### 6.2 Abilities System

Primary files:

- `savant/abilities/store.py`
- `savant/abilities/resolver.py`
- `savant/abilities/routes.py`
- `savant/mcp/abilities_server.py`

Purpose:

- Manage prompt assets such as personas, rules, policies, styles, and repo overlays
- Resolve a persona plus tags and an optional repo overlay into a deterministic prompt

Storage model:

- Markdown assets with YAML frontmatter
- Loaded from `~/.savant/abilities` by default

### 6.3 Context System

Primary files:

- `savant/context/db.py`
- `savant/context/indexer.py`
- `savant/context/embeddings.py`
- `savant/context/chunker.py`
- `savant/context/walker.py`
- `savant/context/language.py`
- `savant/context/routes.py`
- `savant/mcp/context_server.py`

Purpose:

- Index repositories and memory-bank markdown
- Chunk content
- Generate embeddings
- Store vector data in SQLite
- Provide semantic search across code and memory-bank files

### 6.4 Knowledge Graph

Primary files:

- `savant/db/knowledge_graph.py`
- `savant/knowledge/routes.py`
- `savant/mcp/knowledge_server.py`

Purpose:

- Store typed knowledge nodes and edges
- Support staged versus committed knowledge
- Associate knowledge to workspaces
- Search, merge, export, import, and traverse graph content

### 6.5 Session Detection

Primary file:

- `savant/mcp/session_detect.py`

Purpose:

- Detect which AI session is calling an MCP tool
- Map that session to the correct workspace

Detection strategies:

- Copilot via PID lock files
- Claude via session JSON files
- Codex via environment variables and `.savant-meta`
- Gemini via process and temp-log heuristics
- fallback env overrides

## 7. Ports and Network Model

Default local listeners:

- Flask: dynamic port in Electron mode, `8090` by default in standalone mode
- MCP workspace: `8091`
- MCP abilities: `8092`
- MCP context: `8093`
- MCP knowledge: `8094`

Network behavior:

- All normal communication is loopback-local
- MCP servers proxy to Flask over HTTP
- Electron checks Flask health before exposing the UI

## 8. Packaging and Distribution

Primary files:

- `package.json`
- `savant/Dockerfile`
- `INSTALL.md`
- `build-and-deploy.sh`
- `archive.sh`

Desktop packaging:

- Electron Builder creates a macOS app and DMG
- `savant/` is copied as unpacked extra resources into the app bundle

Container support:

- Dockerfile exists for the Flask layer
- Current desktop runtime still centers on the Electron app

## 9. Testing Strategy

Test layers:

- `tests/test_terminal.js`: Node/Electron-terminal validation
- `savant/tests/*.py`: backend, route, structural, and regression tests

Coverage focus:

- DB layer contracts
- route regressions
- knowledge graph hardening
- Codex and Gemini session handling
- template and JS structural invariants
- shared component integrity

## 10. Operational Summary

The most important fact about this repository is that it is not a simple web app. It is a desktop orchestrator that:

1. Boots a Python service dynamically
2. Exposes multiple MCP tool surfaces
3. Maintains a persistent terminal independently from the page DOM
4. Combines SQLite persistence with provider-native filesystem scraping
5. Serves both human UI workflows and agent tooling from the same backend
