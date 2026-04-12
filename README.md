# 🚀 AI Workflows Dashboard

A unified real-time monitoring dashboard for **three AI coding assistants** — GitHub Copilot CLI, Cline (VS Code), and Claude Code. Track sessions, analyze model usage, manage lifecycle, and never lose context across all your AI-assisted workflows.

Dark cyberpunk spaceship-console theme. Dockerized. Port `8090`.

---

## What Is This?

Every time you use an AI coding assistant, it generates session data — conversations, tool calls, model usage, file changes, checkpoints. This data lives scattered across your filesystem in different formats:

- **Copilot CLI** → `~/.copilot/session-state/` (YAML + JSONL)
- **Cline** → `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/` (JSON)
- **Claude Code** → `~/.claude/projects/` (JSONL + JSON)

This dashboard unifies all three into a single interface with consistent cards, filters, analytics, and management tools.

---

## Why You Need This

| Without Dashboard | With Dashboard |
|---|---|
| Sessions disappear into filesystem noise | Every session is visible with status, project, model, timestamps |
| No idea which sessions are still active | Live status detection: RUNNING, ACTIVE, WAITING, IDLE, DORMANT |
| Can't search across conversations | Deep text search across all messages and tool calls |
| Manual cleanup of stale sessions | Bulk purge dormant sessions with disk space reclaim |
| No usage analytics | Model usage, tool frequency, daily activity charts |
| Context-switching loses track of work | Star important sessions, rename with nicknames, command palette |

---

## Getting Started

### Prerequisites

- Docker & Docker Compose
- At least one of: Copilot CLI, Cline (VS Code), or Claude Code installed

### Start the Dashboard

```bash
# From the repository root
docker compose up -d --build

# Open in browser
open http://localhost:8090
```

That's it. The dashboard auto-discovers all three AI tools from their default data directories.

### Running Without Docker

```bash
cd app
pip install -r requirements.txt
pip install -r mcp/requirements.txt
python app.py
# Production mode:
gunicorn --bind 0.0.0.0:8090 --workers 2 --timeout 30 app:app
```

---

## Your First 5 Minutes

Here's what to do the first time you open the dashboard:

### 1. Pick Your Mode

The top-right of the dashboard has three mode buttons: **COPILOT**, **CLINE**, **CLAUDE**. Click the one matching the tool you use most. Each mode reads from that tool's data directory and shows all its sessions.

### 2. Browse Your Sessions

Sessions appear as cards in a grid (default view). Each card shows:
- **Summary** — first prompt or task description
- **Project & branch** — where you were working
- **Model badges** — which AI models were used (color-coded)
- **Stats** — message count, turn count, tool count
- **Activity timeline** — 24-segment heatmap of session activity
- **Status badge** — ACTIVE, IDLE, DORMANT, etc.

### 3. Open a Session Detail

Click any card to see the full session: overview stats, complete conversation (with Mermaid diagrams and syntax highlighting), checkpoints, and git changes — all in a tabbed interface.

### 4. Star Your Important Sessions

Click the ⭐ icon on any card to pin it. Starred sessions sort to the top and appear in the pinned rail on the left sidebar.

### 5. Try the Command Palette

Press `⌘K` (Mac) or `Ctrl+K` — fuzzy-search any session by name, project, branch, or intent. Press Enter to copy a resume command, or Shift+Enter to jump to the card.

---

## Typical Developer Workflow

> *You're working on a feature across multiple AI assistants throughout the day. Here's how the dashboard fits in.*

**Morning** — Open the dashboard. Switch to Copilot mode. Your yesterday sessions are there, sorted by last activity. The one you were working on shows `IDLE`. Click it to review the conversation and remember where you left off. Copy the resume command and pick up in terminal.

**Midday** — You switch to Cline in VS Code for a refactoring task. Later, open the dashboard in Cline mode. Your new Cline task appears at the top with `ACTIVE` status. You can watch the tool calls happen in near-real-time as the background cache refreshes every 30 seconds.

**Afternoon** — You use Claude Code for a complex architecture discussion. Switch to Claude mode. All your Claude sessions appear with the same card format — project, model, conversation, tools.

**End of day** — Check the Usage Intelligence panel (click "Usage Intelligence" header to expand). See your model usage breakdown, daily activity chart, and top tools. Notice you have 30 dormant sessions — click "PURGE DORMANT", select the ones you don't need, and reclaim disk space.

---

## Three Modes

### 🤖 Copilot Mode

Reads from `~/.copilot/session-state/`. Each session is a UUID directory containing:
- `workspace.yaml` — project, branch, working directory
- `events.jsonl` — every event: messages, tool calls, model responses
- `plan.md`, `checkpoints/`, `files/`, `research/`, `rewind-snapshots/`

**Unique features**: MCP server cards, resume command copy, open-session detection (green dot), checkpoint/rewind viewer, research files.

### 🔧 Cline Mode

Reads from VS Code's Cline extension storage. Each task is a timestamp directory containing:
- `ui_messages.json` — full conversation with tool calls
- `task_metadata.json` — API usage stats
- Task history from `task_history.json`

**Unique features**: Cost tracking (total cost per task), token counts (in/out/cache), MCP server usage, checkpoint count from `checkpoint_created` events.

### 🧠 Claude Mode

Reads from `~/.claude/`. Sessions are JSONL files under `projects/` directories:
- `{session_id}.jsonl` — conversation messages
- `{session_id}/` — artifact directory (tool results, subagents)
- `history.jsonl` — session history with metadata

**Unique features**: Subagent detection, multi-project scoping, git branch from directory context, cost tracking from token usage.

---

## Features

### 🧠 Usage Intelligence

Collapsible top panel with deep analytics mined from session data:

| Metric | Description |
|--------|-------------|
| **Summary Stats** | Total sessions, messages, turns, tool calls, total hours, avg duration |
| **Model Usage** | Calls per model with visual bars (Opus=purple, Sonnet=cyan, Haiku=green) |
| **Daily Activity** | 14-day stacked bar chart — tool calls (cyan) + messages (magenta) |
| **Efficiency** | Tools/turn ratio, turns/message ratio, total events |
| **Top Tools** | Ranked list of most-used tools with gradient bars |

Works across all three modes — each mode mines its own data format.

### ⬡ MCP Server Cards (Copilot Mode)

Collapsible panel showing all connected MCP servers:
- Each server rendered as a card with name, type, command
- Discovered tools (mined from actual session usage) with scrollable grid
- Secrets automatically masked in display

### 📊 Session Analytics

Collapsible panel with:
- Sessions per day (7-day bar chart)
- Most active projects (ranked list)
- Most used tools (bar visualization)
- Weekly session time totals

### 📡 Background Cache & Real-Time Refresh

The backend runs a **background daemon thread** that continuously refreshes data:

| Data | Refresh Interval |
|------|-----------------|
| Session lists (all modes) | Every 30 seconds |
| Usage analytics | Every 120 seconds |

**Why this matters**: The frontend never waits for slow filesystem scans. All API reads come from an in-memory cache, delivering **2–8ms response times** for session lists. The UI auto-refreshes every 10 seconds (main page) and 5 seconds (detail page).

If data isn't ready yet, the API returns `{"loading": true}` and the frontend retries in 3 seconds.

### 📋 Session Cards

Each card displays:
- Session name/summary (editable via rename)
- Project, branch, current intent
- Start/update timestamps with relative time
- **Model badges** with call counts (color-coded)
- **Stats line**: messages · turns · tools count
- **Activity timeline** — 24-segment heatmap showing when work happened
- **Asset tags**: 📍 checkpoints, 📄 files, 🔬 research, 📋 plan
- Tool tags (truncated with overflow indicator)

**Card actions** (top-right icons):
- `?` — Info tooltip with full session details
- 📋 — Copy resume command (Copilot) / session info (Cline/Claude)
- ⭐ — Star/unstar session
- Status badge with color-coded indicator
- 🗑 — Delete session (with confirmation)

### 📄 Pagination

Sessions load **30 at a time** for fast initial render. The count label shows `X of Y` (loaded vs total). Click the **▸▸** button next to the count to load the next 30. Button disables when all sessions are loaded.

### 🗂 View Modes

| Mode | Description |
|------|-------------|
| **Grid** (default) | Flat card grid of all sessions |
| **Grouped** | Sessions grouped by project with collapsible sections |

Toggle with buttons in the filter bar.

### 🔍 Filtering & Search

| Filter | Description |
|--------|-------------|
| **Status** | Dynamic buttons generated from actual statuses |
| **Project** | Dropdown of all projects |
| **Date Range** | Filter by session start date |
| **Text Search** | Live card filtering; press `Enter` for deep context search |
| **Starred** | Show only starred sessions |
| **Open Only** | Show only active sessions |

### 📄 Session Detail Page

Tabbed interface with 4 tabs (navigate with `{` and `}` keys):

#### Tab 1: Overview
- **Session Info** — ID, project, branch, working dir, timestamps, duration, disk usage, intent
- **Session Stats** — Message counts, tool calls, success rate, thinking usage, events, turns
- **Models Used** — Per-model call counts with visual bars
- **Conversation Flow** — Visual segment bar (user/assistant/tool) with hover tooltips
- **Activity Timeline** — Time-based heatmap with tooltips
- **Tool Usage** — Ranked bar chart
- **Session Files** — Grouped file listing with timestamps

#### Tab 2: Conversation
- **Reverse chronological order** (latest messages first)
- **Full local timestamps** on every message
- Markdown rendering with **Mermaid diagram** support
- **Syntax-highlighted** code blocks (highlight.js)
- Collapsible tool calls with success/failure indicators
- Expandable thinking/reasoning blocks
- **Search** (`/` shortcut): type to find, `Enter` cycles matches, `Esc` clears

#### Tab 3: Checkpoints & Rewind
- Checkpoint files sorted by timestamp
- Rewind snapshots, plan files
- Click any file to open in the file viewer modal

#### Tab 4: Git Changes
- **Commits** — SHA, branch, message, file stats
- **File Summary** — All files touched with change counts
- **Git Command Log** — Full history of git commands from the session

### 📂 File Viewer Modal

Full-viewport modal (92vw × 90vh) with smart rendering:

| File Type | Rendering |
|-----------|-----------|
| **Markdown** (`.md`) | Rendered HTML with Mermaid diagrams |
| **HTML** (`.html`) | Rendered in sandboxed iframe |
| **Code files** | Syntax-highlighted (highlight.js, github-dark) |
| **Plain text** | Raw text display |

Supports 30+ languages. Copy button works for all file types.

### ⌨️ Command Palette (`⌘K` / `Ctrl+K`)

Quick-find any session:
- Fuzzy search by name, project, branch, intent, or status
- `↑↓` navigate · `Enter` copy resume command · `⇧Enter` jump to card

### 📌 Pinned Sessions Rail

Left sidebar showing starred + active sessions as colored status dots. Click to jump.

### 🔔 Browser Notifications

Desktop alerts when a session transitions to WAITING or STUCK.

### 🧹 Bulk Cleanup

- **PURGE DORMANT** button toggles bulk mode with checkboxes
- "Select All Dormant" for quick selection
- Shows selected count + reclaimable disk space
- Mass delete with confirmation (won't delete open sessions)

### 🗑 Session Management

| Action | Description |
|--------|-------------|
| **Star** | Pin sessions for quick access |
| **Rename** | Custom nicknames (stored in sidecar metadata) |
| **Delete** | Remove session data with confirmation |
| **Resume** | Copy resume command (Copilot mode) |

---

## Sort Order

Sessions are sorted by:
1. ⭐ Starred sessions first
2. Status priority: RUNNING → PROCESSING → ACTIVE → WAITING → STUCK → IDLE → ABORTED → DORMANT
3. Most recent last activity first

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Browser (port 8090)                        │
│  index.html — Dashboard with mode switcher (Copilot/Cline/Claude)  │
│  detail.html — Session detail (4 tabs)                       │
│  Dark cyberpunk theme · Orbitron + JetBrains Mono fonts      │
└───────────────────────┬──────────────────────────────────────┘
                        │ fetch() · auto-refresh 10s/5s
┌───────────────────────▼──────────────────────────────────────┐
│              Flask + Gunicorn (Python 3.12)                   │
│                                                              │
│  Background Cache Thread (daemon)                            │
│  ├── Refreshes session lists every 30s                       │
│  ├── Refreshes usage analytics every 120s                    │
│  └── All API reads from in-memory cache (2-8ms)              │
│                                                              │
│  /api/sessions · /api/session/<id> · /api/usage              │
│  /api/cline/tasks · /api/cline/task/<id>                     │
│  /api/claude/sessions · /api/claude/session/<id>             │
│  /api/search · /api/mcp · /api/analytics                     │
└───────────┬─────────────┬──────────────┬─────────────────────┘
            │             │              │
  ┌─────────▼───────┐ ┌──▼──────────┐ ┌─▼──────────────┐
  │ ~/.copilot/     │ │ VS Code     │ │ ~/.claude/      │
  │ session-state/  │ │ Cline ext/  │ │ projects/       │
  │ mcp-config.json │ │ tasks/      │ │ history.jsonl   │
  │                 │ │ state/      │ │ stats-cache.json│
  │ YAML + JSONL    │ │ JSON        │ │ JSONL + JSON    │
  └─────────────────┘ └─────────────┘ └─────────────────┘
```

### Status Detection Logic

| Status | Condition |
|--------|-----------|
| **RUNNING** | Active tools executing, last event < 10 min ago |
| **PROCESSING** | Assistant turn in progress, < 10 min ago |
| **ACTIVE** | Last event < 2 min ago |
| **WAITING** | Assistant finished turn, < 5 min ago |
| **IDLE** | Assistant finished turn, < 30 min ago |
| **STUCK** | Active tools/processing but > 10 min stale |
| **ABORTED** | Session has an abort event |
| **DORMANT** | No activity for 30+ minutes |

---

## API Reference

### Copilot Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions?limit=N&offset=N` | GET | Sessions with pagination |
| `/api/session/<id>` | GET | Full session detail |
| `/api/session/<id>` | DELETE | Delete session (blocked if open) |
| `/api/session/<id>/conversation` | GET | Conversation with stats |
| `/api/session/<id>/git-changes` | GET | Git commits and file changes |
| `/api/session/<id>/file?path=<p>` | GET | Raw file contents |
| `/api/session/<id>/rename` | POST | `{"nickname": "..."}` |
| `/api/session/<id>/star` | POST | Toggle star |
| `/api/sessions/bulk-delete` | POST | `{"ids": ["uuid1", ...]}` |
| `/api/search?q=<query>` | GET | Deep search across conversations |
| `/api/mcp` | GET | MCP servers with discovered tools |
| `/api/usage` | GET | Aggregated usage analytics |
| `/api/analytics` | GET | Daily counts, top projects |

### Cline Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cline/tasks?limit=N&offset=N` | GET | Tasks with pagination |
| `/api/cline/task/<id>` | GET | Full task detail |
| `/api/cline/task/<id>` | DELETE | Delete task |
| `/api/cline/task/<id>/conversation` | GET | Conversation with stats |
| `/api/cline/task/<id>/rename` | POST | `{"nickname": "..."}` |
| `/api/cline/task/<id>/star` | POST | Toggle star |
| `/api/cline/tasks/bulk-delete` | POST | `{"ids": ["id1", ...]}` |
| `/api/cline/search?q=<query>` | GET | Search across task messages |
| `/api/cline/usage` | GET | Cline usage analytics |
| `/api/cline/task/<id>/project-files` | GET | Project file listing |
| `/api/cline/task/<id>/git-changes` | GET | Git changes from task |

### Claude Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/claude/sessions?limit=N&offset=N` | GET | Sessions with pagination |
| `/api/claude/session/<id>` | GET | Full session detail |
| `/api/claude/session/<id>` | DELETE | Delete session |
| `/api/claude/session/<id>/conversation` | GET | Conversation with stats |
| `/api/claude/session/<id>/rename` | POST | `{"nickname": "..."}` |
| `/api/claude/session/<id>/star` | POST | Toggle star |
| `/api/claude/sessions/bulk-delete` | POST | `{"ids": ["id1", ...]}` |
| `/api/claude/search?q=<query>` | GET | Search across sessions |
| `/api/claude/usage` | GET | Claude usage analytics |

All list endpoints support `?limit=N&offset=N` and return `{sessions, total, has_more}`.

---

## Configuration

### Docker Compose

```yaml
services:
  app:
    build: ./app
    container_name: workflows-app
    ports:
      - "8090:8090"
    volumes:
      - ~/.copilot/session-state:/data/session-state
      - ~/.copilot/mcp-config.json:/data/mcp-config.json:ro
      - ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks:/data/cline-tasks
      - ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/state:/data/cline-state:ro
      - ~/.claude:/data/claude
      - claude-meta:/data/meta
    environment:
      - SESSION_DIR=/data/session-state
      - MCP_CONFIG=/data/mcp-config.json
      - CLINE_TASKS_DIR=/data/cline-tasks
      - CLINE_STATE_DIR=/data/cline-state
      - CLAUDE_DIR=/data/claude
      - META_DIR=/data/meta
    restart: unless-stopped

volumes:
  claude-meta:
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_DIR` | `~/.copilot/session-state` | Copilot session state directory |
| `MCP_CONFIG` | `~/.copilot/mcp-config.json` | MCP server configuration file |
| `CLINE_TASKS_DIR` | `~/Library/.../saoudrizwan.claude-dev/tasks` | Cline tasks directory |
| `CLINE_STATE_DIR` | `~/Library/.../saoudrizwan.claude-dev/state` | Cline state directory (read-only) |
| `CLAUDE_DIR` | `~/.claude` | Claude Code data directory |
| `META_DIR` | `/data/meta` | Persistent metadata store (star/nickname for Claude) |

### Changing the Port

```yaml
ports:
  - "3000:8090"  # Access on port 3000 instead
```

---

## Keyboard Shortcuts

### Main Page

| Shortcut | Action |
|----------|--------|
| `⌘K` / `Ctrl+K` | Open command palette |
| `/` | Focus search (live card filtering) |
| `Enter` (in search) | Deep context search popup |
| `Escape` | Close palette / modals / clear search |
| `↑` / `↓` | Navigate command palette results |
| `Enter` (palette) | Copy resume command |
| `⇧Enter` (palette) | Jump to session card |
| `j` / `k` | Navigate cards |
| `s` | Star/unstar focused card |

### Session Detail Page

| Shortcut | Action |
|----------|--------|
| `}` | Next tab |
| `{` | Previous tab |
| `/` | Open conversation search |
| `Enter` (search) | Cycle to next match |
| `Escape` | Close modal / clear search |

---

## Project Structure

```
app/
├── app.py              # Flask backend — all 3 mode backends + background cache (~3800 lines)
├── requirements.txt    # Flask 3.1, PyYAML 6.0, Gunicorn 23.0
├── Dockerfile          # Python 3.12-slim, gunicorn with 2 workers
├── templates/
│   ├── index.html      # Main dashboard — mode switcher, cards, filters, analytics (~3800 lines)
│   └── detail.html     # Session detail — 4 tabs, visualizations (~2300 lines)
├── static/             # Static assets
└── README.md           # This file
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, Flask 3.1, Gunicorn |
| Frontend | Vanilla HTML/CSS/JS (zero frameworks, zero build step) |
| Fonts | Orbitron (headers), JetBrains Mono (code/data) |
| Markdown | marked.js via CDN |
| Diagrams | Mermaid.js 11 (sequence, flowchart, mindmap, etc.) |
| Syntax Highlighting | highlight.js with github-dark theme |
| Container | Docker, Python 3.12-slim base |
| Data | Direct filesystem reads — YAML, JSONL, JSON, Markdown |
| Caching | In-memory background thread with reader-writer lock |

No database. No build tools. No npm. No frameworks.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No sessions shown | Verify the data directory exists for your mode |
| Copilot: no sessions | Check `~/.copilot/session-state/` has session UUID dirs |
| Cline: no tasks | Check Cline extension is installed in VS Code |
| Claude: no sessions | Check `~/.claude/projects/` has JSONL files |
| Delete not working | Ensure volumes are mounted read-write (not `:ro`) |
| MCP shows "not configured" | Check `~/.copilot/mcp-config.json` exists |
| Slow initial load | Wait ~30s for background cache to build on first start |
| Stale data after rebuild | HTML has no-cache headers; hard refresh if needed |
| Container won't start | Run `docker compose logs app` |

### Rebuild After Changes

```bash
docker compose up -d --build
```
