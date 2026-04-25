---
name: session-provider
description: Add or maintain AI session providers in the Savant Electron+Flask app. Covers the full pattern — session discovery, listing, detail, conversation parsing, usage stats, delete, workspace/star/rename — plus Hermes checkpoint chain merging and test isolation pitfalls.
version: 1.1.0
metadata:
  hermes:
    tags: [savant, electron, flask, sessions, provider, hermes, copilot, claude, codex, gemini]
---

# Savant Session Provider Integration

Use this skill when adding a new AI session provider to Savant, maintaining existing provider code, or debugging session-related issues. Savant is an Electron+Flask app that aggregates sessions from multiple AI coding tools (Copilot, Claude, Codex, Gemini, Hermes) into a unified dashboard.

## Architecture

- Main repo: `~/Developer/<org>/savant-app` (branch `main`)
- Worktrees: `~/Developer/<org>/<branch-name>` (for feature work)
- Backend: `savant/app.py` — Flask app with REST routes
- Frontend: Electron shell (`main.js`, `preload.js`)
- Tests: `savant/tests/` — pytest suite
- Build: `bash build-and-deploy.sh` → deploy `dist/mac-arm64/Savant.app/Contents` to `/Applications/Savant.app/Contents`
- Python: `/opt/homebrew/bin/python3.13`

## Provider Pattern (What Each Provider Needs)

Every session provider in `app.py` implements these functions:

1. **`<provider>_get_all_sessions()`** — Discover and list sessions. Returns list of dicts with: id, title, model, started_at, last_updated, provider icon/color, tool counts, message counts.
2. **`<provider>_get_session_detail(session_id)`** — Full session metadata including tools used, models, timestamps, message/token counts.
3. **`<provider>_parse_full_conversation(session_id)`** — Parse raw session files into OpenAI-format messages array for the conversation view.
4. **`_build_<provider>_usage(messages)`** — Calculate token usage from messages. Avoid double-counting when aggregating across chain members.
5. **Delete endpoints** — Single and bulk delete. Must clean up all related files.
6. **Meta endpoints** — Workspace assignment, star/favorite, archive, rename. These update a metadata sidecar file (usually `<session_dir>/.savant_meta.json`).
7. **Project files / git changes** — Scan session for file paths and git operations mentioned.

### Provider Constants

Each provider has a display config:
- **Copilot**: icon `🤖`, color `#1f6feb`
- **Claude**: icon `🧠`, color `#d97706`
- **Codex**: icon `⚡`, color `#10a37f`
- **Gemini**: icon `💎`, color `#4285f4`
- **Hermes**: icon `🪶`, color `#a78bfa`

## Hermes-Specific: Checkpoint Chain Merging

Hermes creates checkpoint sessions during context compaction. A chain looks like:
```
root (end_reason=null) → child1 (end_reason='compression') → child2 (end_reason='compression') → tip (end_reason='active')
```

### Key Rules

1. **`state.db` is authoritative** — Located at `~/.hermes/state.db`. The `sessions` table has `id, parent_session_id, started_at, ended_at, end_reason, message_count, title, model, input_tokens, output_tokens, estimated_cost_usd`. JSON files in `~/.hermes/sessions/` that aren't in state.db are stale leftovers — skip them.

2. **Root session ID is canonical** — All endpoints must resolve any child/tip ID to the root. Use `_hermes_resolve_session_id(session_id)` which walks `parent_session_id` up to root.

3. **Chain building** — `_hermes_build_session_chains()` queries state.db, builds parent→children map, finds roots (no parent), then DFS to build ordered chains. Returns `{root_id: [root_id, child1_id, child2_id, ...]}`.

4. **Aggregation across chains**:
   - Messages: concatenate from all chain members in order
   - Tools/models: union across all members
   - Timestamps: root's `started_at`, tip's `last_updated`
   - Token usage: sum across chain, but deduplicate (don't count compressed tokens twice)
   - Title: use tip's title (most recent), fall back to root's

5. **Fallback**: If no state.db exists, treat each JSON file as standalone (backward compat).

6. **Session file naming**: `~/.hermes/sessions/session_<session_id>.json` where session_id format is `YYYYMMDD_HHMMSS_<hex6>`.

## Testing

### Running Tests
```bash
cd savant
/opt/homebrew/bin/python3.13 -m pytest tests/test_hermes_checkpoint_merge.py -v --tb=short
/opt/homebrew/bin/python3.13 -m pytest tests/ -v  # full suite
```

### Critical Pitfall: Test Ordering Pollution

When hermes tests monkeypatch module-level constants like `HERMES_STATE_DB` in `app.py`, the patch can leak across test modules if not properly scoped. Symptoms: tests pass individually but fail in full suite.

**Fix**: Always reset module constants in fixtures:
```python
@pytest.fixture(autouse=True)
def reset_hermes_state_db():
    import savant.app as app_module
    original = app_module.HERMES_STATE_DB
    yield
    app_module.HERMES_STATE_DB = original
```

Or use `monkeypatch.setattr()` with function-scoped fixtures (pytest auto-reverts after each test).

### Test File Structure

- `tests/test_hermes_sessions.py` — Core hermes session CRUD (25 tests)
- `tests/test_hermes_checkpoint_merge.py` — Chain merging logic (23 tests)
- `tests/test_session_detection.py` — Multi-provider session detection (31 tests)

## Build & Deploy

### Building from Worktrees

Building works from worktrees if `npm install` is run first (ensures `node-pty` native bindings compile with correct paths). Requires Node.js ≥ 18.17 for `@electron/rebuild` — use homebrew node if nvm default is too old:

```bash
cd ~/Developer/<org>/hermes-integration  # worktree
npm install                                  # native deps need this
PATH="/opt/homebrew/bin:$PATH" npx electron-builder --mac
```

If `build-and-deploy.sh` fails with `electron-builder: command not found`, use the `npx` approach above.

### Deploy Steps
1. Build produces `dist/mac-arm64/Savant.app/Contents`
2. Copy to `/Applications/Savant.app/Contents`
3. Restart Savant app

## Required Session Fields (Frontend Parity)

The frontend (`sessions.js`) expects ALL of these fields on every session object. Missing fields cause blank cards, broken sparklines, or JS errors. Both `_get_all_sessions()` and `_get_session_detail()` must include them:

### Core fields (always present)
```
id, provider, summary, model, models, platform, status, is_open,
created, created_at, modified, updated_at, path, session_path,
message_count, turn_count, event_count, user_messages,
workspace, starred, archived, nickname,
project, project_path, cwd, git_commit_count
```

### Enriched fields (often missed — causes blank dashboard sections)
```
activity_buckets     — list of 24 ints (sparkline), [] if no timestamps
model_call_counts    — dict {model_name: count}
tool_call_counts     — dict {tool_name: count}
tools_used           — list of tool name strings
tool_call_count      — int total
checkpoint_count     — int (chain length - 1, or 0 for standalone)
disk_size            — int bytes (sum all session files)
file_count           — int (number of session files)
resume_command       — str (e.g. "hermes --resume <id>")
first_event_time     — ISO string or None
last_event_time      — ISO string or None
last_event_type      — str (last message role) or None
last_intent          — str (last user message, truncated 200 chars) or None
has_abort            — bool
active_tools         — list (empty for completed sessions)
notes                — list from meta sidecar
jira_tickets         — list from meta sidecar
mrs                  — list from meta sidecar
has_plan_file        — bool
research_count       — int
input_tokens         — int (from state.db or usage tracking)
output_tokens        — int (from state.db or usage tracking)
estimated_cost_usd   — float (from state.db or usage tracking)
```

### Activity Buckets Pattern
The frontend `buildTimelineHtml(buckets)` at `sessions.js:434` renders a 24-bar sparkline. Compute by dividing session duration into 24 equal time slots and counting messages per slot. If duration is 0, put all messages in bucket[0]. If no timestamps available, return `[]`.

### Token/Cost Aggregation from state.db
When a provider has a state database (like Hermes's `state.db`), aggregate tokens and cost across all chain members by summing from `db_rows`. The `_hermes_build_session_chains()` SELECT must include `estimated_cost_usd` and `tool_call_count` columns — these were initially missing and caused zero values.

## File, MR, and Jira CRUD Endpoints

Each provider also needs file read/write, merge request, and Jira ticket endpoints. These follow the same pattern across all providers:

### File Endpoints
- `GET /api/<provider>/session/<id>/file?path=<relpath>` — Read file content (500KB limit, path traversal protection via `os.path.realpath` check)
- `GET /api/<provider>/session/<id>/file/raw?path=<relpath>` — Raw file content (no JSON wrapping)
- `PUT /api/<provider>/session/<id>/file` — Write/update file (JSON body: `{path, content}`)

### MR Endpoints
- `GET /api/<provider>/session/<id>/mr` — List merge requests from meta sidecar
- `POST /api/<provider>/session/<id>/mr` — Create/add MR (JSON body: `{url, title?, status?, ...}`)
- `DELETE /api/<provider>/session/<id>/mr/<mr_id>` — Remove MR

### Jira Ticket Endpoints
- `GET /api/<provider>/session/<id>/jira-ticket` — List Jira tickets from meta sidecar
- `POST /api/<provider>/session/<id>/jira-ticket` — Create/add ticket (JSON body: `{ticket_key, title?, ...}`)
- `DELETE /api/<provider>/session/<id>/jira-ticket/<ticket_id>` — Remove ticket

### Helper: `_<provider>_find_session_dir(session_id)`
For Hermes, resolves session_id (possibly a child/tip) to the actual session directory on disk. Used by all file/MR/Jira endpoints. Pattern:
1. Resolve chain root via `_hermes_resolve_session_id()`
2. Try `HERMES_SESSIONS_DIR/<resolved_id>/` directory
3. Fall back to `HERMES_SESSIONS_DIR/session_<resolved_id>.json` parent dir

### Meta Sidecar Pattern
MR and Jira data persist in `.savant_meta.json` inside the session directory (same file used for notes, starred, archived, workspace). The `_bg_refresh_hermes_cache()` function syncs these to the background cache.

### Test Coverage
`tests/test_hermes_file_mr_jira.py` — 38 tests covering all CRUD operations, error handling, and cache sync.

## Critical Pitfall: Cross-Provider Aggregation Gaps

When a new provider's own routes are complete, it can STILL be invisible to cross-cutting features. The monolithic `app.py` has ~10 places that iterate over all providers using tuples like `("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions")`. If you add a provider but miss even one of these, that provider's sessions silently vanish from workspaces, search, MR/Jira aggregation, etc.

### How to find them all
```bash
# Find all provider iteration loops — any that DON'T include your new provider are bugs:
grep -n "copilot_sessions.*claude_sessions.*codex_sessions.*gemini_sessions" app.py
# Also search for provider name tuples in the bg_cache walk patterns:
grep -n '"copilot".*"claude".*"codex".*"gemini"' app.py
```

### Known cross-provider aggregation points (must include ALL providers):

1. **`_bg_cache` init** (~line 117) — Initial cache dict keys
2. **`_bg_worker`** — Session refresh + usage refresh ThreadPoolExecutor
3. **`api_workspaces_list`** — Session counting per workspace
4. **`api_workspaces_sessions`** — Sessions within a workspace
5. **`api_workspaces_files`** — File listing across providers
6. **`api_workspaces_session_files`** — Session-files within workspace
7. **`api_workspaces_notes`** — Notes aggregation across providers
8. **`api_workspaces_search`** — Deep search across all sessions/notes
9. **`api_all_mrs`** — MR aggregation across all providers
10. **`api_all_jira_tickets`** — Jira ticket aggregation across all providers
11. **`_collect_workspace_sessions`** — Used by workspace context prompt
12. **`_collect_session_artifacts`** — File/plan scanning (needs provider's session dir path)
13. **Project-files provider scan** — Provider scan for project files across sessions
14. **Search endpoints** — Provider-level search in sessions

### Verification approach
After adding a provider, run this comprehensive check:
```bash
# Count occurrences — each provider should appear the SAME number of times in iteration tuples:
grep -c "hermes_sessions" app.py   # should match gemini_sessions count
grep -c "gemini_sessions" app.py   # baseline
```
If counts differ, you have gaps. The fix is mechanical — just add the new provider to the missing tuples.

## Checklist for Adding a New Provider

- [ ] Add session directory constant (e.g., `HERMES_SESSIONS_DIR`)
- [ ] Implement `_get_all_sessions()` with provider icon/color
- [ ] Implement `_get_session_detail(session_id)`
- [ ] Implement `_parse_full_conversation(session_id)`
- [ ] Implement `_build_usage(messages)`
- [ ] Add delete endpoint (single + bulk)
- [ ] Add meta endpoints (workspace, star, archive, rename)
- [ ] Add project-files and git-changes endpoints
- [ ] Add file read/write endpoints (GET/PUT file, GET file/raw)
- [ ] Add MR CRUD endpoints (GET/POST/DELETE)
- [ ] Add Jira ticket CRUD endpoints (GET/POST/DELETE)
- [ ] Register in session detection/routing (so `/api/sessions` includes the new provider)
- [ ] **Add to ALL cross-provider aggregation loops** (see "Cross-Provider Aggregation Gaps" above)
- [ ] Handle chain/checkpoint merging if the provider supports it
- [ ] Wire frontend JS: `core.js` endpoint helpers, `sessions.js` provider labels/pagination
- [ ] Wire frontend HTML: `index.html` tab button + CSS, `detail.html` mode handling
- [ ] Update ALL descriptive text/tooltips that list providers (search for hardcoded provider lists like "Copilot, Claude, Codex" in index.html — tooltip text at workspace info icon and MCP tutorial tip)
- [ ] Write tests (listing, detail, conversation, delete, meta ops)
- [ ] Test in isolation AND in full suite (watch for ordering pollution)
- [ ] Build from main repo, deploy, verify in app

## Usage Endpoint Field Parity

The `_build_<provider>_usage()` function must return fields with EXACT names matching the frontend's `renderUsage()` in `sessions.js:596`. Field name mismatches cause silent rendering failures (panels show "Loading..." forever).

### Required top-level fields
```
total_sessions, total_messages, total_turns, total_tool_calls,
total_hours, avg_session_minutes, avg_tools_per_turn, avg_turns_per_message
```

### models / tools arrays — use `calls` NOT `count`
```python
# WRONG: {"name": "opus-4.6", "count": 606}
# RIGHT: {"name": "opus-4.6", "calls": 606}
```

### daily array — use `date` NOT `day`, include `turns`
```python
# WRONG: {"day": "2025-04-15", "tool_calls": 50, "messages": 10}
# RIGHT: {"date": "2025-04-15", "tool_calls": 50, "messages": 10, "turns": 30}
```

### Efficiency metrics
`avg_tools_per_turn` and `avg_turns_per_message` are computed, not stored. Calculate from totals:
```python
avg_tools_per_turn = round(total_tool_calls / max(total_turns, 1), 1)
avg_turns_per_message = round(total_turns / max(total_messages, 1), 1)
```

### Session duration for providers without explicit tracking
Hermes doesn't store session duration. Compute from first/last message timestamps in the session JSON. Sum all sessions for `total_hours`, divide by session count for `avg_session_minutes`.

## MCP Bar: Dual Regex for Tool Name Formats

The MCP servers bar in `sessions.js` (`fetchMcp()` at ~line 1398) extracts server names from tool call names. Different providers use different formats:

- **Claude format**: `mcp:serverName/toolName` → regex `^mcp:([^/]+)/(.+)$`
- **Hermes format**: `mcp_serverName_toolName` → regex `^mcp_([^_]+_[^_]+)_(.+)$`

The Hermes regex groups `mcp_savant_workspace_create_task` → server `savant-workspace`, tool `create-task` (underscores converted to hyphens for display). Both regexes must be tried in sequence. Without the second regex, the MCP bar shows empty for Hermes sessions.

## Conversation Format Parity (Critical)

All providers' `_parse_full_conversation()` must return the **same shape**. The frontend detail page conversation tab (`detail.html`) uses a single renderer that expects this exact format:

### Conversation entries use `type` NOT `role`
```python
# WRONG (raw OpenAI format — causes empty conversation tab):
{"role": "user", "content": "..."}
{"role": "assistant", "content": "...", "tool_calls": [...]}

# RIGHT (Savant display format):
{"type": "user_message", "content": "..."}
{"type": "assistant_message", "content": "...", "tool_requests": [...]}
{"type": "tool_start", "tool_call_id": "call_001"}  # separate entry per tool
```

### Tool calls use `tool_requests` NOT `tool_calls`
```python
# WRONG:
"tool_calls": [{"name": "read_file", "arguments": {...}}]

# RIGHT:
"tool_requests": [{"call_id": "call_001", "tool_name": "read_file", "arguments": {...}}]
```

### Tool results go in `tool_map` dict, NOT as conversation entries
```python
# Tool results are keyed by call_id in the second return value:
tool_map = {"call_001": {"name": "read_file", "args": {...}, "result": "...", "success": True}}
```

### Stats dict uses specific field names
```python
# WRONG: {"tool_call_count": 5, "turn_count": 2, "tools_used": ["read_file"]}
# RIGHT: {"tool_calls": 5, "user_messages": 2, "assistant_messages": 10,
#          "tool_successes": 4, "tool_failures": 1, "files_created": [...], "files_edited": [...]}
```

### Return tuple shape
```python
def provider_parse_full_conversation(session_id) -> tuple:
    return (conversation_list, tool_map_dict, stats_dict)
```

The conversation tab, stats panel, and tool usage panel ALL depend on these exact field names. A mismatch causes the section to render as empty with no error — it fails silently.

### Test files for conversation parity
- `test_hermes_conversation_parity.py` — 30 tests validating format matches Claude/Copilot

## Learned

- When the hermes_dir fixture monkeypatches HERMES_DIR/HERMES_SESSIONS_DIR/HERMES_META_DIR, it MUST also patch HERMES_STATE_DB to point inside the tmp_path (e.g., `str(hdir / "state.db")`). If HERMES_STATE_DB is not patched, the chain-aware code reads the real `~/.hermes/state.db`, finds sessions that don't exist in the test's tmp dir, and filters out the test's session — causing listing/search/usage tests to return empty results. This was the root cause of 5 test failures that only appeared in full-suite runs.
- The "What's New" release modal version (shown in `index.html`) is a separate hardcoded value from `package.json` version. After bumping `package.json`, the modal may still show an older version — this is cosmetic, not a build failure. Check the actual deployed version via `PlistBuddy -c "Print :CFBundleShortVersionString" /Applications/Savant.app/Contents/Info.plist`.
- Savant Flask server defaults to port 8090 (configurable via `SAVANT_FLASK_PORT` env var). MCP servers default to 8091-8094 (`SAVANT_MCP_PORT`, `SAVANT_ABILITIES_MCP_PORT`, `SAVANT_CONTEXT_MCP_PORT`, `SAVANT_KNOWLEDGE_MCP_PORT`). If a port is busy, Electron tries port+100, then OS-assigned. After MCP servers start, Electron pushes resolved ports to Flask via `POST /api/system/ports` so Flask's health endpoints (`/api/mcp/health`, `/api/mcp/health/<name>`) and `/api/system/info` use correct ports. The port registry lives in `_system_ports` dict in app.py. The `_startAllMcpServers()` function in main.js is `async` — when calling it inside an `http.get` callback, that callback must also be `async` or `await` is a syntax error (Node.js lint catches this).
- **Hermes session-to-workspace assignment from within Hermes**: The `assign_session_to_workspace` MCP tool calls `detect_session()` which relies on `HERMES_SESSION_ID` env var — but Hermes doesn't export this to child shells. Auto-detection fails with "Could not detect session ID." Workaround: find the session ID manually by searching `~/.hermes/sessions/session_*.json` files (format: `session_YYYYMMDD_HHMMSS_<hex6>.json`), match on the first user message content or timestamp to identify the current session, then call `assign_session_to_workspace(session_id="YYYYMMDD_HHMMSS_hex6", workspace_id="...")` with the explicit ID. Quick way to find it:
  ```python
  import json, os, glob
  sessions = sorted(glob.glob(os.path.expanduser('~/.hermes/sessions/session_*.json')), key=os.path.getmtime, reverse=True)
  for s in sessions[:5]:
      with open(s) as f:
          data = json.load(f)
      sid = os.path.basename(s).replace('session_','').replace('.json','')
      for m in data.get('messages', []):
          if m.get('role') == 'user':
              print(f'{sid} | {str(m.get("content",""))[:80]}')
              break
  ```
- **Hermes cwd extraction heuristic** (`_hermes_extract_cwd()` in app.py): Hermes session JSON has NO `cwd`/`workdir` field, nor does `state.db`. To populate `cwd`, `project`, `project_path`, and prefix `resume_command` with `cd /path &&`, scan tool call arguments from the session messages: (1) `workdir` args in terminal calls, (2) `path` args in read_file/search_files/patch, (3) system prompt path references. Use `Counter` to find the most-common project root via `_hermes_project_root_from_path()`. That helper uses dev directory markers (`Developer`, `Projects`, `repos`, `src`, `workspace`) with depth-aware extraction: `Developer` uses depth 3 (org/repo pattern like `Developer/<org>/savant-app`) while all other markers use depth 2 (just `Projects/myapp`). Using depth 3 for `Projects` causes filename leakage (e.g. `Projects/myapp/index.js` instead of `Projects/myapp`). An `_EXCLUDED_SEGMENTS` set filters false positives from hidden/system paths: `.hermes`, `.copilot`, `.claude`, `.codex`, `.cache`, `.config`, `.local`, `.npm`, `.git`, `Library`, `node_modules`, `tmp`, `__pycache__`, `.savant`, `.savant-meta`. The frontend (`sessions.js`, `command-palette.js`) already consumes `s.resume_command` and `s.cwd` — only backend changes were needed.
- **MCP config management for AI agents**: `POST /api/setup-mcp` adds Savant MCP server entries to each AI agent's config. `GET /api/check-mcp` returns per-agent configured status. `_AGENT_CONFIG_MAP` in `app.py` (~line 2392+) maps providers to config paths, formats (json/yaml/toml), keys, and extras. Agents: copilot (json `mcpServers`), claude (json `mcpServers`), gemini (json `mcpServers`), codex (toml `mcp_servers` stdio), hermes (yaml `mcp_servers` SSE). Idempotent via `_check_mcp_configured()`. Supports `force: true`. Falls back to `enabled_providers` from prefs if no providers specified.
- **MCP setup triggers are user-initiated only**: (1) `savePreferences()` in `tasks.js` detects newly enabled providers (before/after diff of `enabled_providers`) and calls `_setupMcpForProviders()` → toast per status. (2) System Status tab shows "AI Agent MCP Config" card: ● Configured (green), ○ Not configured (red + Setup btn), — No config file (dim). `setupMcpAgent()` in `core.js` uses `force: true`, shows toast, refreshes panel. Legacy `setupMcpConfigs()` in `main.js` is NOT called on startup — user explicitly wanted no auto-setup at launch, only on explicit action.
- CSS subtab active styles in `shared.css` are easy to miss. When adding a provider, add `.savant-subtab.active.<provider>` with the provider's brand color. Without it, the active tab highlight defaults to white instead of the provider color. Both Codex and Hermes were initially missing these rules despite having full route and JS support.
- **Hermes SSE auto-patching**: When Hermes is enabled, `_setup_mcp_for_provider("hermes")` also calls `_patch_hermes_sse_support()` (in `app.py`) to patch `~/.hermes/hermes-agent/tools/mcp_tool.py` and `~/.hermes/hermes-agent/hermes_cli/mcp_config.py` with SSE transport support. Detection markers: `_MCP_SSE_AVAILABLE` in mcp_tool.py, `is_sse` in mcp_config.py. Patching is idempotent (creates `.bak` backups, skips if markers present). Runs on both fresh setup AND `already_configured` re-check. The `sse_patch` key in the API response carries `{patches_applied, errors, all_good, checks}` — frontend toast code in both `tasks.js` (`_setupMcpForProviders`) and `core.js` (`setupMcpAgent`) shows results. The patches add: `_MCP_SSE_AVAILABLE` flag + `sse_client` import, `_is_sse()` method (detects `transport: sse` or URL ending in `/sse`), `_run_sse()` async method (SSE client session lifecycle), updated `_is_http()` to exclude SSE URLs, and `run()` routing (SSE → HTTP → stdio). In mcp_config.py it adds `is_sse` detection + `transport_label` variable for "SSE" vs "HTTP" display. The patch logic uses string replacement with careful marker-based detection — each sub-patch checks if its specific marker is already present before applying.
- **Build requires homebrew node**: The hermes-integration worktree can build directly (no need to merge to main first) BUT `electron-builder` with `@electron/rebuild` for `node-pty` requires Node.js ≥ 18.17. The nvm default (v18.14) is too old — use `PATH="/opt/homebrew/bin:$PATH" npx electron-builder --mac` to pick up homebrew's node (v25.x). Must `npm install` first if `node_modules` is missing in the worktree.
