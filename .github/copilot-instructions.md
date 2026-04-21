# Copilot Instructions — Savant App

## Canonical Guidance

`AGENTIC.md` at repo root is the canonical source for architecture, boundaries, and install/run/test/build/deploy workflows.
When this file and `AGENTIC.md` differ, follow `AGENTIC.md`.

## Architecture

Savant is an **Electron + Flask + MCP** desktop app for monitoring AI coding sessions (Copilot CLI, Cline, Claude Code).

### Three-process model

1. **Electron shell** (`main.js`) — BrowserWindow that shows a loading screen, spawns Flask, spawns MCP, then navigates to `http://127.0.0.1:<port>`. Hides to system tray on close (macOS).
2. **Flask backend** (`savant/app.py`) — REST API + Jinja2-rendered dashboard. Reads AI session data from the filesystem (`~/.copilot/`, `~/.claude/`, Cline globalStorage). Background thread caches session lists in memory (`_bg_cache`).
3. **MCP server** (`savant/mcp/server.py`) — FastMCP bridge that proxies workspace/task tools to the Flask API over HTTP. Runs as SSE on port 8091. Auto-injects its config into Copilot CLI, Claude Desktop, and Codex CLI config files on each launch.

### Data flow

- SQLite database at `~/.savant/savant.db` (configurable via `SAVANT_DB` env var)
- Schema defined in `savant/sqlite_client.py` — singleton `SQLiteClient` with WAL mode
- DB access layer: static-method classes in `savant/db/` (`WorkspaceDB`, `TaskDB`, `NoteDB`, `MergeRequestDB`, `JiraTicketDB`, `NotificationDB`)
- Pydantic models in `savant/models.py` for validation
- Session detection via PID-based process tree walking (`savant/mcp/session_detect.py`)

### Frontend

- Server-rendered Jinja2 templates in `savant/templates/` (`index.html`, `detail.html`)
- Static assets (loading GIFs) in `savant/static/`
- Electron injects a drag bar and disables zoom after page load

## Build & Run Commands

```bash
# Install Electron dependencies
npm install

# Dev mode (opens Electron window, spawns Flask + MCP)
npm run dev

# Production build (macOS DMG + dir)
npm run build

# Run Flask backend standalone (without Electron)
cd savant
pip install -r requirements.txt
python app.py

# Run Flask with gunicorn
cd savant
gunicorn --bind 0.0.0.0:8090 --workers 1 --threads 4 --timeout 30 app:app

# Docker (Flask only)
cd savant
docker compose up -d --build
```

### Build & Deploy to /Applications (macOS)

After making changes, use this exact sequence to build and deploy the Electron app:

```bash
# 1. Quit the running app
osascript -e 'quit app "Savant"'
sleep 2

# 2. Clean build
cd /Users/ashabbir/Developer/icapital/savant-app
rm -rf dist
npm run build

# 3. Deploy (rsync works without sudo, unlike rm + cp)
rsync -a --delete dist/mac-arm64/Savant.app/ /Applications/Savant.app/

# 4. Launch
open /Applications/Savant.app
```

**Important notes:**
- Always `rm -rf dist` before `npm run build` to avoid stale artifacts.
- Use `rsync -a --delete` to deploy — you cannot `rm` in `/Applications/` without sudo, but rsync overwrites in place.
- The app auto-starts Flask on a dynamic port and MCP servers on fixed ports (8091, 8092).
- Verify deployment by checking the Electron log: `tail -f ~/Library/Application\ Support/savant/savant-main.log`

### Running tests

```bash
cd savant
python3 -m pytest tests/ -v
```

### Python dependencies

Flask backend: `savant/requirements.txt` (flask, pyyaml, gunicorn, pydantic).
MCP server: `savant/mcp/requirements.txt` (mcp, requests).

## Key Conventions

### DB layer pattern

Each entity has a `savant/db/<entity>.py` file with a class using `@staticmethod` methods. All methods call `get_connection()` from `sqlite_client.py`. Timestamps are ISO 8601 UTC strings. Follow the existing pattern when adding new entities.

### Electron ↔ Flask startup sequence

`main.js` finds a free port, spawns Flask, polls `GET /api/db/health` until 200, then spawns MCP on fixed port 8091, runs `setupMcpConfigs()`, and navigates the BrowserWindow to Flask. The loading screen (`loading.html`) shows progress via `setStatus()`.

### Python path resolution

`main.js` searches multiple Python paths (`/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, etc.) and probes for required packages (`import flask`, `import mcp`). The `getSavantDir()` function handles dev vs packaged `.app` bundle paths.

### electron-builder packaging

Only `main.js`, `icon.png`, and `loading.html` go into Electron's `files`. The entire `savant/` directory is copied as an `extraResource` (excluding `__pycache__`, `*.pyc`, and legacy mongo files). In packaged mode, `process.resourcesPath + "/savant"` is the Flask app root.

### Hardening

`savant/hardening.py` provides `rate_limit`, `validate_request`, `safe_limit` decorators and `retry_with_backoff` for Flask routes.

### MCP auto-setup

On each launch, `setupMcpConfigs()` in `main.js` patches `~/.copilot/config.json`, Claude Desktop config, and Codex CLI MCP settings with the current SSE URL. It only patches files that already exist.

---

## Adding a New MCP Server — Step-by-Step

Follow this checklist when adding a new MCP server to the Savant app. Each MCP is a thin SSE bridge that proxies tool calls to Flask REST API endpoints. The pattern is identical for every MCP — only the tool definitions and Flask routes change.

### Port registry

| MCP name           | Port | Server file                     |
|--------------------|------|---------------------------------|
| savant-workspace   | 8091 | `savant/mcp/server.py`          |
| savant-abilities   | 8092 | `savant/mcp/abilities_server.py`|
| *(next)*           | 8093 | `savant/mcp/<name>_server.py`   |

Pick the next sequential port. Ports are **fixed** (not dynamic) so AI tool configs never go stale between launches.

---

### Step 1 — Flask REST API (backend)

Create Flask routes that the MCP will proxy to. The MCP server itself never touches the DB or filesystem directly.

**1a. Create module (if needed):** `savant/<feature>/__init__.py`, core logic files.

**1b. Create Blueprint:** `savant/<feature>/routes.py`

```python
"""Flask Blueprint for <Feature> REST API. All routes under /api/<feature>/*."""
from flask import Blueprint, jsonify, request

<feature>_bp = Blueprint("<feature>", __name__)

@<feature>_bp.route("/api/<feature>/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

@<feature>_bp.route("/api/<feature>/example", methods=["POST"])
def example():
    data = request.get_json(force=True)
    # ... business logic ...
    return jsonify({"result": "ok"})
```

**1c. Register in `savant/app.py`:**

```python
from <feature>.routes import <feature>_bp
app.register_blueprint(<feature>_bp)
```

**1d. Add health probe to `savant/app.py`** — update the `api_mcp_health` route's `ports` dict:

```python
ports = {"workspace": 8091, "abilities": 8092, "<name>": <PORT>}
```

---

### Step 2 — MCP Server (SSE bridge)

Create `savant/mcp/<name>_server.py`. **Copy this template exactly** — only change the marked values:

```python
"""
savant-<name> MCP Server

Thin MCP bridge to the Savant Dashboard Flask API (/api/<feature>/*).
Runs as SSE on port <PORT>.
"""

import argparse
import json
import logging
import os
import sys
from typing import Any

import requests
from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_BASE = os.environ.get("SAVANT_API_BASE", "http://localhost:8090")
REQUEST_TIMEOUT = 10

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("savant-<name>")                    # ← change

# ---------------------------------------------------------------------------
# Entry point args
# ---------------------------------------------------------------------------

_parser = argparse.ArgumentParser(description="savant-<name> MCP server")
_parser.add_argument("--transport", choices=["stdio", "sse"], default="stdio")
_parser.add_argument("--port", type=int, default=<PORT>)    # ← change
_parser.add_argument("--host", default="127.0.0.1")
_args, _ = _parser.parse_known_args()

mcp = FastMCP(
    "savant-<name>",                                         # ← change
    instructions="<one-line description of what this MCP does>",
    host=_args.host,
    port=_args.port,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _api(method: str, path: str, **kwargs) -> dict | list:
    """Call the Flask API. Raises on connection error with a helpful message."""
    url = f"{API_BASE}{path}"
    try:
        resp = requests.request(method, url, timeout=REQUEST_TIMEOUT, **kwargs)
        resp.raise_for_status()
        return resp.json()
    except requests.ConnectionError:
        raise RuntimeError(
            f"Dashboard app not running at {API_BASE}. "
            "Start it with: npm run dev (or docker compose up -d)"
        )
    except requests.HTTPError as e:
        body = e.response.text if e.response is not None else ""
        raise RuntimeError(f"API error {e.response.status_code}: {body}")

# ---------------------------------------------------------------------------
# Tools — define one @mcp.tool() per operation
# ---------------------------------------------------------------------------

@mcp.tool()
def example_tool(param: str) -> dict[str, Any]:
    """Tool description shown to AI clients."""
    return _api("POST", "/api/<feature>/example", json={"param": param})

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if _args.transport == "sse":
        log.info(f"Starting savant-<name> MCP (SSE) on {_args.host}:{_args.port}")
    mcp.run(transport=_args.transport)
```

**Key rules:**
- Every tool is a thin proxy — call `_api()` and return the result.
- Use `@mcp.tool()` decorator. The docstring becomes the tool description shown to AI clients.
- Type hints on parameters are **required** — MCP uses them to generate the JSON schema.
- Default values → optional params. No default → required.
- Return `dict` or `list`, never raw strings.

---

### Step 3 — Electron integration (`main.js`)

**3a. Add port constant** (next to existing ones ~line 119):

```javascript
const <NAME>_MCP_PORT = <PORT>;
```

**3b. Add process variable** (next to existing ones ~line 127):

```javascript
let <name>McpProcess = null;
let <name>McpPort = null;
```

**3c. Add start function** — copy `startAbilitiesMcp()` and change the server path + log prefix:

```javascript
function start<Name>Mcp(<name>Port, apiPort) {
  const savantDir = getSavantDir();
  const serverFile = path.join(savantDir, "mcp", "<name>_server.py");
  const pythonPaths = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3", "python3"];
  let pythonCmd = null;

  for (const p of pythonPaths) {
    try {
      execSync(`${p} -c "import mcp"`, { stdio: "ignore" });
      pythonCmd = p;
      break;
    } catch { /* try next */ }
  }

  if (!pythonCmd) {
    _err("No Python with mcp package found for <name> server");
    return null;
  }

  _log(`Starting <Name> MCP SSE server on port ${<name>Port}`);

  const child = spawn(pythonCmd, [serverFile, "--transport", "sse", "--port", String(<name>Port)], {
    cwd: savantDir,
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || "/usr/bin"}`,
      SAVANT_API_BASE: `http://127.0.0.1:${apiPort}`,
      PYTHONDONTWRITEBYTECODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const safeLog = (msg) => { try { _log(msg); } catch {} };
  child.stdout.on("data", (d) => safeLog(`[<name>-mcp] ${d.toString().trim()}`));
  child.stderr.on("data", (d) => safeLog(`[<name>-mcp] ${d.toString().trim()}`));
  child.on("exit", (code) => safeLog(`<Name> MCP exited with code ${code}`));

  return child;
}

function kill<Name>Mcp() {
  if (<name>McpProcess) {
    _log("Stopping <Name> MCP server...");
    <name>McpProcess.kill("SIGTERM");
    setTimeout(() => {
      try { <name>McpProcess.kill("SIGKILL"); } catch {}
    }, 3000);
    <name>McpProcess = null;
  }
}
```

**3d. Update `setupMcpConfigs()`** — add the SSE URL and entry:

```javascript
const <name>SseUrl = `http://127.0.0.1:${<name>McpPort}/sse`;
const <name>SseEntry = { type: "sse", url: <name>SseUrl };

// In each config object, add:
//   <name>Entry: { ...<name>SseEntry, autoApprove: ["*"], disabled: false, timeout: 120 }

// In the loop, add:
servers["savant-<name>"] = cfg.<name>Entry;
```

**3e. Update app lifecycle** (`app.on("ready", ...)`) — spawn the MCP after Flask is ready:

```javascript
<name>McpProcess = start<Name>Mcp(<name>McpPort, flaskPort);
_log(`<Name> MCP SSE server starting on port ${<name>McpPort}`);
```

**3f. Update `before-quit`** — kill the MCP on exit:

```javascript
kill<Name>Mcp();
```

---

### Step 4 — UI Toolguide tab (`savant/templates/index.html`)

**4a. Add tab button** (inside `.tutorial-tabs`):

```html
<button class="tutorial-tab" onclick="switchTutorialTab('<name>')">savant-<name></button>
```

**4b. Add tab panel** (after the last `tutorial-tab-panel` div):

```html
<div id="tutorial-panel-<name>" class="tutorial-tab-panel">
  <div class="tutorial-server-info">
    <div class="info-row"><span class="info-label">Server</span><span class="info-value">savant-<name></span></div>
    <div class="info-row"><span class="info-label">Transport</span><span class="info-value">SSE</span></div>
    <div class="info-row"><span class="info-label">Port</span><span class="info-value"><PORT></span></div>
    <div class="info-row"><span class="info-label">URL</span><span class="info-value">http://127.0.0.1:<PORT>/sse</span></div>
    <div class="info-row" style="margin-top:8px;"><span class="info-label">Setup</span><span class="info-value" style="color:#aaa;">Auto-configured by Savant on launch into<br>~/.copilot/config.json, Claude Desktop, and Codex CLI</span></div>
    <div class="mcp-test-row">
      <button class="mcp-test-btn" onclick="testMcpConnection('<name>', <PORT>, this)">⚡ TEST CONNECTION</button>
      <span id="mcp-test-<name>" class="mcp-test-status"></span>
    </div>
  </div>

  <div class="tutorial-tip">
    <strong>💡 TIP:</strong> Description of what this MCP does.
  </div>

  <!-- Tool sections -->
  <div class="tutorial-section" style="margin-top:16px;">
    <h4>🔧 Section Name</h4>
    <div class="tutorial-tool">
      <span class="tutorial-tool-icon">⚡</span>
      <div class="tutorial-tool-info">
        <div class="tutorial-tool-name">tool_name</div>
        <div class="tutorial-tool-desc">What this tool does.</div>
      </div>
    </div>
  </div>
</div>
```

---

### Step 5 — Build & verify

```bash
# 1. Test Flask routes standalone
cd savant && python -c "
from app import app
with app.test_client() as c:
    print(c.get('/api/<feature>/health').get_json())
"

# 2. Test MCP server standalone
cd savant && SAVANT_API_BASE=http://127.0.0.1:8090 python mcp/<name>_server.py --transport sse --port <PORT>
# In another terminal: curl http://127.0.0.1:<PORT>/sse  → should return 200

# 3. Build Electron app
npm run build

# 4. Verify bundle includes the new server
ls dist/mac-arm64/Savant.app/Contents/Resources/savant/mcp/<name>_server.py

# 5. Launch and test connection from MCP Toolguide modal
```

---

### Checklist summary

- [ ] Flask Blueprint with REST API routes under `/api/<feature>/*`
- [ ] Blueprint registered in `savant/app.py`
- [ ] Health probe port added to `api_mcp_health` in `savant/app.py`
- [ ] MCP server at `savant/mcp/<name>_server.py` (copy template exactly)
- [ ] Port constant + process variable in `main.js`
- [ ] `start<Name>Mcp()` / `kill<Name>Mcp()` functions in `main.js`
- [ ] `setupMcpConfigs()` updated with new SSE entry
- [ ] App lifecycle: spawn on ready, kill on before-quit
- [ ] Toolguide tab added in `index.html` (server info + test button + tool list)
- [ ] Built and verified with `npm run build`
