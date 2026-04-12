const { app, BrowserWindow, BrowserView, Tray, Menu, nativeImage, globalShortcut, shell, ipcMain } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const net = require("net");
const http = require("http");
const fs = require("fs");

// GPU sandbox fix for ad-hoc signed macOS apps
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");

// Suppress EPIPE/EIO errors from broken pipes when Flask exits
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE" || err.code === "EIO") return;
  // swallow pipe errors completely during shutdown
});

// Safe console wrapper — never throws on broken pipes
// Also write to a log file for debugging packaged app issues
let _logFile = null;
const _getLogFile = () => {
  if (!_logFile) {
    try { _logFile = path.join(app.getPath("userData"), "savant-main.log"); }
    catch { _logFile = "/tmp/savant-main.log"; }
  }
  return _logFile;
};
const _appendLog = (level, args) => {
  try {
    const ts = new Date().toISOString();
    const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    fs.appendFileSync(_getLogFile(), `${ts} [${level}] ${msg}\n`);
  } catch {}
};
const _log = (...args) => { try { console.log(...args); } catch {} _appendLog("INFO", args); };
const _err = (...args) => { try { console.error(...args); } catch {} _appendLog("ERROR", args); };

/// Resolve the savant Flask app directory (works in dev and packaged .app).
function getSavantDir() {
  if (app.isPackaged) {
    // In .app bundle: Contents/Resources/savant/
    return path.join(process.resourcesPath, "savant");
  }
  // Dev mode: sibling directory
  return path.join(__dirname, "savant");
}

// ── MCP auto-setup ──────────────────────────────────────────────────────────
// On first launch, inject savant-workspace MCP server config into AI tool
// config files (Copilot CLI, Claude Desktop, Codex CLI). Merges without
// overwriting existing entries.
function setupMcpConfigs() {
  const mcpServerPath = path.join(getSavantDir(), "mcp", "server.py");

  // Build SSE entries from the MCP_SERVERS registry
  const sseEntries = {};
  for (const [name, cfg] of Object.entries(MCP_SERVERS)) {
    sseEntries[name] = { type: "sse", url: `http://127.0.0.1:${cfg.port}/sse` };
  }

  // stdio fallback entry (used when MCP is launched per-process by AI tool)
  const stdioEntry = {
    type: "stdio",
    command: "python3",
    args: [mcpServerPath],
  };

  const configs = [
    {
      name: "Copilot CLI",
      path: path.join(app.getPath("home"), ".copilot", "config.json"),
      entryFn: (sse) => ({ ...sse, autoApprove: ["*"], disabled: false, timeout: 120 }),
    },
    {
      name: "Claude Desktop",
      path: path.join(app.getPath("home"), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      entryFn: (sse) => ({ ...sse, tools: ["*"] }),
    },
    {
      name: "Gemini CLI",
      path: path.join(app.getPath("home"), ".gemini", "settings.json"),
      entryFn: (sse) => ({ ...sse, trust: true }),
    },
  ];

  const patchCodexConfig = () => {
    const codexPath = path.join(app.getPath("home"), ".codex", "config.toml");
    if (!fs.existsSync(codexPath)) return;
    const raw = fs.readFileSync(codexPath, "utf8");
    const stdioPyPath = path.join(getSavantDir(), "mcp", "stdio.py");
    const pythonCmd = _findMcpPython() || "python3";

    let updated = raw;
    for (const name of Object.keys(MCP_SERVERS)) {
      const sectionHeader = `[mcp_servers."savant-${name}"]`;
      if (raw.includes(sectionHeader)) continue;

      const entry = `\n${sectionHeader}\ntype = "stdio"\ncommand = "${pythonCmd}"\nargs = ["${stdioPyPath}", "${name}"]\n`;
      updated += entry;
    }

    if (updated !== raw) {
      fs.writeFileSync(codexPath, updated, "utf8");
      _log(`MCP: appended ${Object.keys(MCP_SERVERS).map(n => `savant-${n}`).join(' + ')} to Codex CLI config`);
    }
  };

  for (const cfg of configs) {
    try {
      if (!fs.existsSync(cfg.path)) continue; // only patch existing configs
      const raw = fs.readFileSync(cfg.path, "utf8");
      const data = JSON.parse(raw);
      const servers = data.mcpServers || {};
      for (const [name, sse] of Object.entries(sseEntries)) {
        servers[`savant-${name}`] = cfg.entryFn(sse);
      }
      data.mcpServers = servers;
      fs.writeFileSync(cfg.path, JSON.stringify(data, null, 2) + "\n", "utf8");
      _log(`MCP: updated ${Object.keys(sseEntries).map(n => `savant-${n}`).join(' + ')} in ${cfg.name}`);
    } catch (e) {
      _err(`MCP: failed to update ${cfg.name}:`, e.message);
    }
  }

  try {
    patchCodexConfig();
  } catch (e) {
    _err(`MCP: failed to update Codex CLI:`, e.message);
  }
}

// ── Config ──────────────────────────────────────────────────────────────────
const HEALTH_PATH = "/api/db/health";
const MCP_PORT = 8091; // Fixed port so AI tool configs never go stale
const ABILITIES_MCP_PORT = 8092; // Fixed port for abilities MCP
const CONTEXT_MCP_PORT = 8093; // Fixed port for context MCP
const KNOWLEDGE_MCP_PORT = 8094; // Fixed port for knowledge MCP
const MAX_WAIT_MS = 20000;

// ── Port cleanup (kill orphaned processes on fixed MCP ports) ───────────────

/**
 * Kill any process listening on the given port. Used on startup to clean up
 * orphaned MCP servers from a previous Electron session that wasn't shut down
 * cleanly (crash, force-quit, etc.).
 */
function killProcessOnPort(port) {
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: "utf8", timeout: 5000 }).trim();
    if (pids) {
      for (const pid of pids.split("\n")) {
        const p = parseInt(pid, 10);
        if (p > 0) {
          _log(`Killing orphaned process PID ${p} on port ${port}`);
          try { process.kill(p, "SIGKILL"); } catch {}
        }
      }
      // Brief pause for OS to release the port
      execSync("sleep 0.3", { stdio: "ignore" });
    }
  } catch {
    // No process on this port — that's fine
  }
}

let mainWindow = null;
let tray = null;
let flaskProcess = null;
let flaskPort = null;

// ── Terminal PTY Manager ────────────────────────────────────────────────────
const pty = require("node-pty");
const _terminals = new Map(); // paneId → { pty, cwd, buffer }
const TERM_BUFFER_SIZE = 50000; // chars of recent output to keep for reconnection

let _termPrefs = {
  shell: process.env.SHELL || "/bin/zsh",
  externalTerminal: "auto",
  customCommand: "",
  fontSize: 13,
  cursorStyle: "block",
  scrollback: 5000,
};

// Send terminal data to the persistent BrowserView (and fallback to main window for old pages)
function _termSend(channel, ...args) {
  try {
    // Send to the persistent terminal BrowserView first
    if (termView && !termView.webContents.isDestroyed()) {
      termView.webContents.send(channel, ...args);
    }
    // Also send to mainWindow (for old in-page terminals during transition)
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
    for (const win of _extraWindows) {
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    }
  } catch {}
}

function _setupTerminalIPC() {
  // Create a new PTY
  ipcMain.handle("terminal:create", (_event, opts = {}) => {
    const tabId = opts.tabId || `tab-${Date.now()}`;
    const cwd = opts.cwd || process.env.HOME || "/";
    const shell = opts.shell || _termPrefs.shell;
    const cols = opts.cols || 80;
    const rows = opts.rows || 24;
    try {
      const term = pty.spawn(shell, ["-l", "-i"], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          TERM_PROGRAM: "Savant",
          TERM_PROGRAM_VERSION: app.getVersion(),
        },
      });
      let buffer = "";
      term.onData((data) => {
        // Keep a rolling buffer for reconnection
        buffer += data;
        if (buffer.length > TERM_BUFFER_SIZE) buffer = buffer.slice(-TERM_BUFFER_SIZE);
        _termSend("terminal:data-out", { tabId, data });
      });
      term.onExit(() => {
        _terminals.delete(tabId);
        _termSend("terminal:close-ack", tabId);
      });
      _terminals.set(tabId, { pty: term, cwd, getBuffer: () => buffer });
      _log(`Terminal created: ${tabId} (shell=${shell}, cwd=${cwd})`);
      return { tabId, pid: term.pid };
    } catch (err) {
      _err("Failed to create terminal:", err);
      return { error: err.message };
    }
  });

  // List all living terminals (for reconnection after page navigation)
  ipcMain.handle("terminal:list", () => {
    const result = [];
    for (const [tabId, entry] of _terminals) {
      result.push({ tabId, cwd: entry.cwd, buffer: entry.getBuffer() });
    }
    return result;
  });

  // Receive data from renderer → PTY
  ipcMain.on("terminal:data-in", (_event, { tabId, data }) => {
    const entry = _terminals.get(tabId);
    if (entry) entry.pty.write(data);
  });

  // Resize PTY
  ipcMain.on("terminal:resize", (_event, { tabId, cols, rows }) => {
    const entry = _terminals.get(tabId);
    if (entry) {
      try { entry.pty.resize(cols, rows); } catch {}
    }
  });

  // Close a single PTY
  ipcMain.handle("terminal:close", (_event, tabId) => {
    const entry = _terminals.get(tabId);
    if (entry) {
      try { entry.pty.kill(); } catch {}
      _terminals.delete(tabId);
    }
    return true;
  });

  // Close all PTYs
  ipcMain.handle("terminal:close-all", () => {
    for (const [tabId, entry] of _terminals) {
      try { entry.pty.kill(); } catch {}
    }
    _terminals.clear();
    return true;
  });

  // Open in external terminal
  ipcMain.handle("terminal:open-external", (_event, cwd) => {
    const dir = cwd || process.env.HOME || "/";
    const term = _termPrefs.externalTerminal;
    try {
      let cmd;
      if (term === "auto") {
        // auto-detect: iTerm > Warp > Terminal.app
        const tp = process.env.TERM_PROGRAM || "";
        if (tp.includes("iTerm") || fs.existsSync("/Applications/iTerm.app")) {
          cmd = `osascript -e 'tell application "iTerm2" to create window with default profile command "cd ${dir.replace(/'/g, "\\'")} && exec $SHELL"'`;
        } else if (fs.existsSync("/Applications/Warp.app")) {
          cmd = `open -a Warp "${dir}"`;
        } else {
          cmd = `osascript -e 'tell application "Terminal" to do script "cd ${dir.replace(/'/g, "\\'")}"'`;
        }
      } else if (term === "iterm") {
        cmd = `osascript -e 'tell application "iTerm2" to create window with default profile command "cd ${dir.replace(/'/g, "\\'")} && exec $SHELL"'`;
      } else if (term === "terminal") {
        cmd = `osascript -e 'tell application "Terminal" to do script "cd ${dir.replace(/'/g, "\\'")}"'`;
      } else if (term === "warp") {
        cmd = `open -a Warp "${dir}"`;
      } else if (term === "alacritty") {
        cmd = `open -a Alacritty --args --working-directory "${dir}"`;
      } else if (term === "kitty") {
        cmd = `kitty --directory "${dir}" &`;
      } else if (term === "custom" && _termPrefs.customCommand) {
        cmd = _termPrefs.customCommand.replace(/\{cwd\}/g, dir);
      } else {
        cmd = `open -a Terminal "${dir}"`;
      }
      execSync(cmd);
      return { ok: true };
    } catch (err) {
      _err("Failed to open external terminal:", err);
      return { error: err.message };
    }
  });

  // Get/set preferences
  ipcMain.handle("terminal:get-prefs", () => ({ ..._termPrefs }));
  ipcMain.handle("terminal:set-prefs", (_event, prefs) => {
    Object.assign(_termPrefs, prefs);
    return { ..._termPrefs };
  });
}

function _killAllTerminals() {
  for (const [tabId, entry] of _terminals) {
    try { entry.pty.kill(); } catch {}
  }
  _terminals.clear();
}

// ── Push status text to the loading screen ──────────────────────────────────
function setStatus(msg, level = 'step') {
  if (mainWindow && mainWindow.webContents) {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
    // Update current-step banner
    mainWindow.webContents.executeJavaScript(
      `document.getElementById('status').textContent='${esc(msg)}'`
    ).catch(() => {});
    // Append to log panel
    mainWindow.webContents.executeJavaScript(
      `window._savantLog && window._savantLog('${esc(msg)}', '${level}')`
    ).catch(() => {});
  }
}

function _logDetail(msg, level = 'info') {
  if (mainWindow && mainWindow.webContents) {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
    mainWindow.webContents.executeJavaScript(
      `window._savantLog && window._savantLog('${esc(msg)}', '${level}')`
    ).catch(() => {});
  }
}

function _setPort(key, val) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.executeJavaScript(
      `window._savantSetPort && window._savantSetPort('${key}', '${val}')`
    ).catch(() => {});
  }
}

// ── Find a free port ────────────────────────────────────────────────────────
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const EMBEDDING_MODEL_NAME = process.env.EMBEDDING_MODEL_NAME || "stsb-distilbert-base";
const EMBEDDING_MODEL_VERSION = process.env.EMBEDDING_VERSION || "v1";
let _flaskPythonCmd = undefined; // undefined = not probed, null = not found

function _findPythonWithFlask() {
  if (_flaskPythonCmd !== undefined) return _flaskPythonCmd;
  const pythonPaths = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3", "python3"];
  for (const p of pythonPaths) {
    try {
      require("child_process").execSync(`${p} -c "import flask"`, { stdio: "ignore" });
      _flaskPythonCmd = p;
      return p;
    } catch {
      // try next
    }
  }
  _flaskPythonCmd = null;
  return null;
}

function _hasEmbeddingModel(dir) {
  if (!dir) return false;
  try {
    if (!fs.existsSync(dir)) return false;
    if (fs.existsSync(path.join(dir, "config.json"))) return true;
    const entries = fs.readdirSync(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function _bundledEmbeddingModelDir() {
  return path.join(getSavantDir(), "models", EMBEDDING_MODEL_NAME, EMBEDDING_MODEL_VERSION);
}

function _userEmbeddingModelDir() {
  return path.join(app.getPath("home"), ".savant", "models", EMBEDDING_MODEL_NAME, EMBEDDING_MODEL_VERSION);
}

function _downloadEmbeddingModel(pythonCmd, targetDir) {
  return new Promise((resolve) => {
    const script = [
      "from context.embeddings import download_model",
      "from pathlib import Path",
      "import sys",
      "dest = Path(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else None",
      "download_model(dest)",
    ].join("\n");

    const args = ["-c", script];
    if (targetDir) args.push(targetDir);

    const child = spawn(pythonCmd, args, {
      cwd: getSavantDir(),
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const logLine = (label, data) => {
      const text = data.toString().trim();
      if (!text) return;
      _logDetail(`[model] ${text}`, label);
    };

    child.stdout.on("data", (d) => logLine("info", d));
    child.stderr.on("data", (d) => logLine("warn", d));
    child.on("exit", (code) => {
      if (code === 0) {
        _logDetail(`Embedding model ready at ${targetDir}`, "ok");
        resolve(true);
      } else {
        _err(`Embedding model download failed with code ${code}`);
        resolve(false);
      }
    });
  });
}

async function ensureEmbeddingModel() {
  const overrideDir = process.env.EMBEDDING_MODEL_DIR;
  if (overrideDir && _hasEmbeddingModel(overrideDir)) {
    _logDetail(`Embedding model already present at ${overrideDir}`, "ok");
    return;
  }

  const bundledDir = _bundledEmbeddingModelDir();
  if (!overrideDir && _hasEmbeddingModel(bundledDir)) {
    _logDetail(`Embedding model bundled at ${bundledDir}`, "ok");
    return;
  }

  const userDir = _userEmbeddingModelDir();
  if (!overrideDir && _hasEmbeddingModel(userDir)) {
    _logDetail(`Embedding model already downloaded at ${userDir}`, "ok");
    return;
  }

  const targetDir = overrideDir || userDir;
  const pythonCmd = _findPythonWithFlask();
  if (!pythonCmd) {
    _err("No Python with Flask found. Install Flask: pip3 install flask");
    return;
  }

  setStatus("Downloading embedding model…");
  _logDetail(`Embedding model missing, downloading to ${targetDir}`, "warn");
  await _downloadEmbeddingModel(pythonCmd, targetDir);
}

// ── Start Flask ─────────────────────────────────────────────────────────────
function startFlask(port) {
  const savantDir = getSavantDir();
  const pythonCmd = _findPythonWithFlask();

  if (!pythonCmd) {
    _err("No Python with Flask found. Install Flask: pip3 install flask");
    return null;
  }

  const appPy = path.join(savantDir, "app.py");
  _log(`Starting Flask: ${pythonCmd} ${appPy} on port ${port}`);

  const child = spawn(pythonCmd, [appPy], {
    cwd: savantDir,
    env: {
      ...process.env,
      FLASK_HOST: "127.0.0.1",
      FLASK_PORT: String(port),
      PYTHONDONTWRITEBYTECODE: "1",
      SAVANT_BUNDLED_MODEL_DIR: path.join(savantDir, "models", "stsb-distilbert-base", "v1"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const safeLog = (msg) => { try { _log(msg); } catch { /* pipe closed */ } };
  child.stdout.on("data", (d) => safeLog(`[flask] ${d.toString().trim()}`));
  child.stderr.on("data", (d) => safeLog(`[flask] ${d.toString().trim()}`));
  child.on("exit", (code) => safeLog(`Flask exited with code ${code}`));

  return child;
}

// ── Wait for Flask health ───────────────────────────────────────────────────
function waitForFlask(port) {
  return new Promise((resolve) => {
    const start = Date.now();

    const check = () => {
      if (Date.now() - start > MAX_WAIT_MS) {
        _err("Flask failed to start within timeout");
        return resolve(false);
      }

      const req = http.get(
        `http://127.0.0.1:${port}${HEALTH_PATH}`,
        (res) => {
          resolve(res.statusCode === 200);
        }
      );
      req.on("error", () => setTimeout(check, 500));
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(check, 500);
      });
    };

    setTimeout(check, 1000); // give Flask a moment to start
  });
}

// ── Kill Flask ──────────────────────────────────────────────────────────────
function killFlask() {
  if (flaskProcess) {
    _log("Stopping Flask server...");
    try { flaskProcess.kill("SIGKILL"); } catch {}
    flaskProcess = null;
  }
}

// ── Generic MCP Server Manager ──────────────────────────────────────────────
// Registry of all MCP servers: name → { port, serverFile, process, extraArgs?, extraEnv? }
const MCP_SERVERS = {
  workspace:  { port: MCP_PORT,           file: "server.py" },
  abilities:  { port: ABILITIES_MCP_PORT, file: "abilities_server.py" },
  context:    { port: CONTEXT_MCP_PORT,   file: "context_server.py" },
  knowledge:  { port: KNOWLEDGE_MCP_PORT, file: "knowledge_server.py" },
};

// Cached Python binary path (resolved once, reused for all MCP servers)
let _mcpPythonCmd = undefined; // undefined = not probed yet, null = not found
let _mcpPythonProbeErrors = [];

function _findMcpPython() {
  if (_mcpPythonCmd !== undefined) return _mcpPythonCmd;
  const candidates = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3", "python3"];
  _mcpPythonProbeErrors = [];
  for (const p of candidates) {
    try {
      execSync(`${p} -c "import mcp"`, { stdio: "ignore" });
      _mcpPythonCmd = p;
      return p;
    } catch (err) {
      const reason = (err.stderr || err.stdout || err.message || "")
        .toString()
        .trim()
        .split("\n")
        .slice(-1)[0] || "import mcp failed";
      _mcpPythonProbeErrors.push(`${p}: ${reason}`);
    }
  }
  _mcpPythonCmd = null;
  return null;
}

/**
 * Start a named MCP server. Options:
 *   extraArgs  — additional CLI args (e.g. ["--flask-url", url])
 *   extraEnv   — additional env vars merged into the child env
 */
function _startMcpServer(name, apiPort, { extraArgs = [], extraEnv = {} } = {}) {
  const cfg = MCP_SERVERS[name];
  if (!cfg) { _err(`Unknown MCP server: ${name}`); return null; }

  const pythonCmd = _findMcpPython();
  if (!pythonCmd) {
    _err(`No Python with mcp package found for ${name} server`);
    if (_mcpPythonProbeErrors.length) {
      _err(`MCP Python probe errors: ${_mcpPythonProbeErrors.join(" | ")}`);
    }
    return null;
  }

  const savantDir = getSavantDir();
  const serverFile = path.join(savantDir, "mcp", cfg.file);
  const args = [serverFile, "--transport", "sse", "--port", String(cfg.port), ...extraArgs];

  _log(`Starting ${name} MCP: ${pythonCmd} ${args.join(" ")}`);

  const child = spawn(pythonCmd, args, {
    cwd: savantDir,
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || "/usr/bin"}`,
      SAVANT_API_BASE: `http://127.0.0.1:${apiPort}`,
      PYTHONDONTWRITEBYTECODE: "1",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tag = `[${name}-mcp]`;
  const safeLog = (msg) => { try { _log(msg); } catch {} };
  child.stdout.on("data", (d) => safeLog(`${tag} ${d.toString().trim()}`));
  child.stderr.on("data", (d) => safeLog(`${tag} ${d.toString().trim()}`));
  child.on("error", (err) => {
    _err(`${tag} spawn error: ${err.message}`);
    _err(`${tag} command: ${pythonCmd} ${args.join(" ")}`);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      _err(`${tag} CRASHED with code ${code}${signal ? ` (signal: ${signal})` : ""}`);
    } else {
      _log(`${name} MCP exited cleanly${signal ? ` (signal: ${signal})` : ""}`);
    }
  });

  cfg.process = child;
  return child;
}

function _killMcpServer(name) {
  const cfg = MCP_SERVERS[name];
  if (!cfg) return;
  if (cfg.process) {
    _log(`Stopping ${name} MCP server...`);
    try { cfg.process.kill("SIGKILL"); } catch {}
    cfg.process = null;
  }
  killProcessOnPort(cfg.port);
}

function _killAllMcpServers() {
  for (const name of Object.keys(MCP_SERVERS).reverse()) {
    _killMcpServer(name);
  }
}

function _startAllMcpServers(apiPort) {
  // Kill orphans on all fixed ports
  for (const cfg of Object.values(MCP_SERVERS)) {
    killProcessOnPort(cfg.port);
  }

  _startMcpServer("workspace", apiPort);
  _startMcpServer("abilities", apiPort);
  _startMcpServer("context", apiPort, {
    extraArgs: ["--flask-url", `http://127.0.0.1:${apiPort}`],
  });
  _startMcpServer("knowledge", apiPort);
}

// ── Create window ───────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Savant",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      zoomFactor: 1.0,
      preload: path.join(__dirname, "preload.js"),
    },
    show: false,
  });

  // Open external links (window.open, target="_blank") in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Prevent in-page navigation to external URLs — open in browser instead
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Inject a dedicated drag bar for window dragging.
  // Strategy: one thin fixed div at the top acts as the drag handle.
  // Everything else stays default (no-drag) so all buttons/modals work.
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.executeJavaScript(`
      if (!document.getElementById('electron-drag-bar')) {
        const bar = document.createElement('div');
        bar.id = 'electron-drag-bar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:42px;z-index:1;-webkit-app-region:drag;-webkit-user-select:none;pointer-events:auto;';
        document.body.prepend(bar);
      }
      // Force-clear any stale inline marginRight on container elements
      document.querySelectorAll('.container, .detail-container').forEach(el => {
        el.style.marginRight = '';
      });
    `).catch(() => {});
    mainWindow.webContents.insertCSS(`
      /* All interactive elements must not be draggable */
      button, input, select, textarea, a, label,
      [onclick], [role="button"],
      .mode-btn, .icon-action, .notif-btn, .release-icon {
        -webkit-app-region: no-drag !important;
      }
      /* Force full width layout in Electron to prevent tiny mode */
      html { min-width: 900px !important; }
      .container, .detail-container { max-width: none !important; width: auto !important; margin-right: 0 !important; }
    `).catch(() => {});

    // Re-send terminal drawer state after every page load so the new page
    // picks up the correct class (term-open) for CSS grid adjustments
    mainWindow.webContents.send("terminal:drawer-state", {
      open: termViewVisible,
      widthPct: termViewVisible ? _activeWidthPct() : 0,
    });
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.control || input.meta) {
      // Toggle persistent terminal with Cmd/Ctrl + `
      if (input.key === "`" && input.type === "keyDown") {
        event.preventDefault();
        toggleTermView();
      }
    }
  });

  // Show loading screen immediately
  mainWindow.loadFile(path.join(__dirname, "loading.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Hide instead of quit on close
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Persistent Terminal BrowserView ─────────────────────────────────────────
// Design: The BrowserView is added/removed from mainWindow on show/hide.
// Zero-bounds hide caused Electron layout bugs (terminal rendered mid-screen).
// Add/remove is the reliable pattern — each call pair is guarded to avoid duplicates.

let termView = null;
let termViewVisible = false;
let termViewWidthPct = 60;
let termViewExpanded = false;
let _termDragging = false;
let _termViewAttached = false; // track whether BrowserView is currently added

const _ZERO_BOUNDS = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

function createTermView() {
  termView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  termView.webContents.loadFile(path.join(__dirname, "terminal.html"));

  // When the terminal BrowserView gains focus (user clicked into it),
  // tell xterm.js to focus + refresh so cursor and text are visible.
  // Also explicitly call .focus() to ensure webContents has input focus.
  termView.webContents.on("focus", () => {
    if (termViewVisible && termView && !termView.webContents.isDestroyed()) {
      termView.webContents.send("terminal:command", "focus-and-refresh");
    }
  });
}

function _isDetailPage() {
  try {
    const url = mainWindow.webContents.getURL();
    return url.includes("/session/");
  } catch { return false; }
}

function _activeWidthPct() {
  // Terminal always takes 100% of the content area (between the 4 bars)
  return 100;
}

/** Pure calculation — returns the {x, y, width, height} rect for the terminal. */
// App chrome dimensions — must match shared.css
const _SIDEBAR_WIDTH = 48;    // #left-tab-bar width
const _TOPBAR_HEIGHT = 36;    // #top-bar height
const _STATUSBAR_HEIGHT = 22; // #bottom-status-bar height
const _RIGHTBAR_WIDTH = 36;   // #right-bar width

function _calcTermBounds() {
  if (!mainWindow) return { ..._ZERO_BOUNDS };
  const [winW, winH] = mainWindow.getContentSize();
  if (winW <= 0 || winH <= 0) return { ..._ZERO_BOUNDS };

  // Content area: between all 4 bars
  const contentX = _SIDEBAR_WIDTH;
  const contentY = _TOPBAR_HEIGHT;
  const contentW = winW - _SIDEBAR_WIDTH - _RIGHTBAR_WIDTH;
  const contentH = winH - _TOPBAR_HEIGHT - _STATUSBAR_HEIGHT;

  const pct = _activeWidthPct();
  const termW = Math.round(contentW * pct / 100);
  const x = contentX + contentW - termW;

  return { x, y: contentY, width: termW, height: Math.max(contentH, 0) };
}

/** Apply the correct bounds to the BrowserView. Only called when visible. */
function _updateTermBounds() {
  if (!mainWindow || !termView || !termViewVisible || !_termViewAttached) return;
  const bounds = _calcTermBounds();
  try {
    termView.setBounds(bounds);
    // Verify bounds were applied (Electron can silently ignore setBounds)
    setTimeout(() => {
      if (!termViewVisible || !termView || !_termViewAttached) return;
      try {
        const actual = termView.getBounds();
        if (actual.width !== bounds.width || actual.height !== bounds.height ||
            actual.x !== bounds.x || actual.y !== bounds.y) {
          termView.setBounds(bounds);
        }
      } catch {}
    }, 100);
  } catch {}
}

/** Send a single focus-and-refresh to the terminal with a short delay for layout to settle. */
function _sendTermFocus() {
  setTimeout(() => {
    if (termView && !termView.webContents.isDestroyed() && termViewVisible) {
      termView.webContents.send("terminal:command", "focus-and-refresh");
      termView.webContents.focus();
    }
  }, 50);
}

/** Broadcast the current drawer state to the main page so it can adjust its layout. */
function _broadcastDrawerState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("terminal:drawer-state", {
    open: termViewVisible,
    widthPct: termViewVisible ? _activeWidthPct() : 0,
  });
}

async function _injectFlaskBase() {
  if (!termView || !flaskPort) return;
  try {
    await termView.webContents.executeJavaScript(
      `window.__FLASK_BASE__ = "http://127.0.0.1:${flaskPort}";`
    );
  } catch {}
}

async function showTermView(cwd) {
  if (!mainWindow || !termView) return;
  // Add the BrowserView if not already attached
  if (!_termViewAttached) {
    mainWindow.addBrowserView(termView);
    _termViewAttached = true;
  }
  termViewVisible = true;
  _updateTermBounds();
  // Inject Flask base URL and WAIT for it before sending commands
  await _injectFlaskBase();
  _broadcastDrawerState();
  _sendTermFocus();
  // Verify bounds settled after Electron processes the addBrowserView
  setTimeout(() => _updateTermBounds(), 50);
  setTimeout(() => {
    _updateTermBounds();
    _sendTermFocus();
  }, 200);
  // If no tabs exist yet, tell terminal.html to add one
  if (_terminals.size === 0) {
    termView.webContents.send("terminal:command", "add-tab", cwd || undefined);
  }
}

function hideTermView() {
  if (!mainWindow || !termView) return;
  if (!termViewVisible) return; // already hidden — break the hide↔switchView loop
  termViewVisible = false;
  // Remove the BrowserView entirely to avoid ghost rendering
  if (_termViewAttached) {
    try { mainWindow.removeBrowserView(termView); } catch {}
    _termViewAttached = false;
  }
  _broadcastDrawerState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.focus();
    // Switch the Flask page back to UI view (restore container, update sidebar buttons)
    mainWindow.webContents.executeJavaScript(
      `if (typeof switchView === 'function') switchView('ui');`
    ).catch(() => {});
  }
}

function toggleTermView() {
  if (termViewVisible) hideTermView();
  else showTermView();
}

function _setupTermViewIPC() {
  ipcMain.on("terminal:toggle-drawer", () => toggleTermView());
  ipcMain.on("terminal:show-drawer", (_event, cwd) => showTermView(cwd));
  ipcMain.on("terminal:hide-drawer", () => hideTermView());
  ipcMain.on("terminal:add-new-tab", (_event, cwd) => {
    // Show the drawer if hidden, then always tell terminal.html to add a new tab
    if (!termViewVisible) showTermView(cwd);
    if (termView && !termView.webContents.isDestroyed()) {
      termView.webContents.send("terminal:command", "add-tab", cwd || undefined);
    }
  });
  // Run a command in a new terminal tab (used by resume-in-terminal)
  ipcMain.on("terminal:run-in-new-tab", (_event, { cwd, command }) => {
    if (!termViewVisible) showTermView(cwd);
    if (termView && !termView.webContents.isDestroyed()) {
      termView.webContents.send("terminal:command", "run-in-new-tab", { cwd, command });
    }
  });
  ipcMain.handle("terminal:is-drawer-open", () => termViewVisible);

  // Resize drag from terminal.html
  let _dragInterval = null;
  ipcMain.on("terminal:start-drag", () => {
    if (!mainWindow) return;
    _termDragging = true;
    const onMove = () => {
      if (!_termDragging || !mainWindow) return;
      const pos = require("electron").screen.getCursorScreenPoint();
      const winBounds = mainWindow.getBounds();
      const relX = pos.x - winBounds.x;
      const [winW] = mainWindow.getContentSize();
      const pct = Math.max(20, Math.min(97, ((winW - relX) / winW) * 100));
      termViewWidthPct = pct;
      _updateTermBounds();
      mainWindow.webContents.send("terminal:drawer-state", { open: true, widthPct: pct });
      termView.webContents.send("terminal:command", "fit-all");
    };
    // Poll mouse position (BrowserView can't easily get cross-view mouse events)
    if (_dragInterval) clearInterval(_dragInterval);
    _dragInterval = setInterval(() => {
      if (!_termDragging) { clearInterval(_dragInterval); _dragInterval = null; return; }
      onMove();
    }, 16);
  });
  ipcMain.on("terminal:stop-drag", () => {
    _termDragging = false;
    if (_dragInterval) { clearInterval(_dragInterval); _dragInterval = null; }
  });

  ipcMain.on("terminal:set-width-pct", (_event, pct) => {
    termViewWidthPct = Math.max(20, Math.min(97, pct));
    termViewExpanded = (pct >= 90);
    _updateTermBounds();
    _broadcastDrawerState();
    if (termView && !termView.webContents.isDestroyed()) {
      termView.webContents.send("terminal:command", "fit-all");
    }
  });

  ipcMain.handle("terminal:get-width-pct", () => termViewWidthPct);
}

// Keep terminal bounds in sync when main window resizes / state changes
function _watchWindowResize() {
  if (!mainWindow) return;

  // Debounced resync — coalesces rapid resize/state-change events into one update
  let _resyncTimer = null;
  const _debouncedResync = () => {
    if (_resyncTimer) clearTimeout(_resyncTimer);
    _resyncTimer = setTimeout(() => {
      _resyncTimer = null;
      _updateTermBounds();
      if (termViewVisible && termView && !termView.webContents.isDestroyed()) {
        termView.webContents.send("terminal:command", "fit-all");
      }
    }, 50);
  };

  mainWindow.on("resize", _debouncedResync);
  mainWindow.on("maximize", _debouncedResync);
  mainWindow.on("unmaximize", _debouncedResync);
  mainWindow.on("enter-full-screen", _debouncedResync);
  mainWindow.on("leave-full-screen", _debouncedResync);
  mainWindow.on("restore", _debouncedResync);

  // When the main window regains OS focus, re-sync bounds and fit terminals.
  // Do NOT force-focus the terminal — the user might want to interact with the
  // Flask UI. The terminal's own focus handler will fire if they click into it.
  mainWindow.on("focus", () => {
    if (termViewVisible && termView && !termView.webContents.isDestroyed()) {
      _debouncedResync();
    }
  });
}

// ── Extra windows (Cmd+N) ───────────────────────────────────────────────────
const _extraWindows = new Set();

function openNewWindow() {
  if (!flaskPort) return;
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Savant",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      zoomFactor: 1.0,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Same drag bar + zoom lock as main window
  win.webContents.on("did-finish-load", () => {
    win.webContents.executeJavaScript(`
      if (!document.getElementById('electron-drag-bar')) {
        const bar = document.createElement('div');
        bar.id = 'electron-drag-bar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:42px;z-index:1;-webkit-app-region:drag;-webkit-user-select:none;pointer-events:auto;';
        document.body.prepend(bar);
      }
    `).catch(() => {});
    win.webContents.insertCSS(`
      button, input, select, textarea, a, label,
      [onclick], [role="button"],
      .mode-btn, .icon-action, .notif-btn, .release-icon {
        -webkit-app-region: no-drag !important;
      }
      /* Force full width layout in Electron to prevent tiny mode */
      html { min-width: 900px !important; }
      .container, .detail-container { max-width: none !important; width: auto !important; margin-right: 0 !important; }
    `).catch(() => {});
  });

  win.loadURL(`http://127.0.0.1:${flaskPort}`);
  _extraWindows.add(win);
  win.on("closed", () => _extraWindows.delete(win));
  _log(`Opened new window (total: ${_extraWindows.size + 1})`);
}

function openInBrowser() {
  if (!flaskPort) return;
  shell.openExternal(`http://127.0.0.1:${flaskPort}`);
  _log("Opened dashboard in default browser");
}

// ── System tray ─────────────────────────────────────────────────────────────
function createTray() {
  // Create a simple 22x22 template icon (purple circle)
  const iconPath = path.join(__dirname, "icon.png");
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 });
    trayIcon.setTemplateImage(true);
  } catch {
    // Fallback: create a tiny icon programmatically
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("Savant");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Dashboard",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "New Window",
      accelerator: "CmdOrCtrl+N",
      click: () => openNewWindow(),
    },
    {
      label: "Open in Browser",
      click: () => openInBrowser(),
    },
    { type: "separator" },
    {
      label: `Flask: ${flaskPort} · ${Object.entries(MCP_SERVERS).map(([n, c]) => `${n[0].toUpperCase() + n.slice(1)}: ${c.port}`).join(' · ')}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Quit Savant",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

// ── App lifecycle ───────────────────────────────────────────────────────────
app.on("ready", async () => {
  try {
    // 0. Set up terminal IPC handlers (before window creation)
    _setupTerminalIPC();
    _setupTermViewIPC();

    // 0b. IPC: native directory picker for Context project management
    const { dialog } = require("electron");
    ipcMain.handle("shell:openPath", async (_event, filePath) => {
      if (!filePath) return;
      return shell.openPath(filePath);
    });

    ipcMain.handle("pick-directory", async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select Project Directory",
      });
      if (result.canceled || !result.filePaths.length) return null;
      return result.filePaths[0];
    });

    ipcMain.handle("mcp:restart", async (_event, name) => {
      _log(`Manual restart requested for MCP: ${name}`);
      _killMcpServer(name);
      // Wait a bit for port to clear
      await new Promise(r => setTimeout(r, 500));
      _startMcpServer(name, flaskPort);
      return { ok: true };
    });

    // 1. Show window immediately
    createWindow();
    createTermView();
    _watchWindowResize();
    setStatus("Checking embedding model…");
    _logDetail(`Electron ${process.versions.electron} · Node ${process.versions.node}`, 'sys');
    _logDetail(`Platform: ${process.platform} ${process.arch}`, 'sys');
    _logDetail(`App path: ${app.getAppPath()}`, 'sys');

    await ensureEmbeddingModel();

    setStatus("Allocating port…");

    flaskPort = await findFreePort();
    _logDetail(`Flask port allocated: ${flaskPort}`, 'ok');
    _setPort('flask', flaskPort);
    setStatus("Starting Python server…");

    // 2. Start Flask in background
    flaskProcess = startFlask(flaskPort);
    _logDetail(`Flask PID: ${flaskProcess.pid}`, 'flask');
    createTray();

    // 3. Parse Flask stderr for progress updates
    flaskProcess.stderr.on("data", (d) => {
      const line = d.toString().trim();
      if (!line) return;
      if (line.includes("SQLite connected")) { setStatus("Database connected"); _logDetail(line, 'ok'); }
      else if (line.includes("bg-cache") && line.includes("Worker")) { setStatus("Loading sessions…"); _logDetail(line, 'flask'); }
      else if (line.includes("Running on")) { setStatus("Server ready, loading dashboard…"); _logDetail(line, 'ok'); }
      else if (line.includes("ERROR") || line.includes("Traceback") || line.includes("Error")) { _logDetail(line, 'error'); }
      else { _logDetail(line, 'flask'); }
    });
    flaskProcess.stdout && flaskProcess.stdout.on("data", (d) => {
      const line = d.toString().trim();
      if (line) _logDetail(line, 'flask');
    });

    // 4. Poll until Flask health check passes, then start MCP + navigate
    const start = Date.now();
    let setupDone = false;
    const poll = () => {
      if (setupDone) return;
      const elapsed = Date.now() - start;
      if (elapsed > MAX_WAIT_MS) {
        setStatus("Server took too long — retrying…", 'warn');
        _logDetail(`Flask health check timeout after ${elapsed}ms — still waiting`, 'warn');
      }
      const req = http.get(
        `http://127.0.0.1:${flaskPort}${HEALTH_PATH}`,
        (res) => {
          if (setupDone) return;
          _logDetail(`Health check → HTTP ${res.statusCode} (${Date.now() - start}ms)`, res.statusCode === 200 ? 'ok' : 'warn');
          if (res.statusCode === 200) {
            setupDone = true;
            const flaskMs = Date.now() - start;
            _log(`Flask ready in ${flaskMs}ms`);
            _logDetail(`Flask ready in ${flaskMs}ms on port ${flaskPort}`, 'ok');

            // 5. Start MCP SSE servers
            setStatus("Starting MCP servers…");
            _logDetail('Starting all MCP servers (workspace, abilities, context, knowledge)', 'mcp');
            _startAllMcpServers(flaskPort);
            for (const [name, cfg] of Object.entries(MCP_SERVERS)) {
              _logDetail(`savant-${name} MCP on port ${cfg.port}`, 'mcp');
            }

            // 6. Auto-configure AI tool MCP configs
            _logDetail('Patching ~/.copilot/config.json, Claude Desktop with MCP URLs', 'sys');
            setupMcpConfigs();
            _logDetail('MCP configs updated in all AI tools', 'ok');

            // 7. Set up app menu with New Window shortcut
            const appMenu = Menu.buildFromTemplate([
              {
                label: "Savant",
                submenu: [
                  { label: "About Savant", role: "about" },
                  { type: "separator" },
                  { label: "Hide Savant", role: "hide" },
                  { label: "Hide Others", role: "hideOthers" },
                  { type: "separator" },
                  { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => { app.isQuitting = true; app.quit(); } },
                ],
              },
              {
                label: "File",
                submenu: [
                  { label: "New Window", accelerator: "CmdOrCtrl+N", click: () => openNewWindow() },
                  { label: "Open in Browser", accelerator: "CmdOrCtrl+Shift+B", click: () => openInBrowser() },
                  { type: "separator" },
                  { label: "Close Window", accelerator: "CmdOrCtrl+W", role: "close" },
                ],
              },
              {
                label: "Edit",
                submenu: [
                  { role: "undo" }, { role: "redo" }, { type: "separator" },
                  { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
                ],
              },
              {
                label: "Window",
                submenu: [
                  { role: "minimize" }, { role: "zoom" },
                  { type: "separator" }, { role: "front" },
                ],
              },
            ]);
            Menu.setApplicationMenu(appMenu);

            setStatus("Ready! ✓", 'ok');
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.executeJavaScript('window._savantDone && window._savantDone()').catch(() => {});
            }
            if (mainWindow) {
              mainWindow.loadURL(`http://127.0.0.1:${flaskPort}`);
              // After dashboard loads, replay startup log summary
              mainWindow.webContents.once('did-finish-load', () => {
                _logDetail(`Electron ${process.versions.electron} · Node ${process.versions.node}`, 'sys');
                _logDetail(`Platform: ${process.platform} ${process.arch}`, 'sys');
                _logDetail(`Flask running on port ${flaskPort} (PID ${flaskProcess ? flaskProcess.pid : '?'})`, 'flask');
                _logDetail(`MCP servers: ${Object.entries(MCP_SERVERS).map(([n, c]) => `${n}:${c.port}`).join(' ')}`, 'mcp');
                _logDetail(`Startup completed in ${Date.now() - start}ms`, 'ok');
              });
              // Inject Flask URL into persistent terminal BrowserView, then init
              _injectFlaskBase().then(() => {
                if (termView && !termView.webContents.isDestroyed()) {
                  setTimeout(() => {
                    termView.webContents.send("terminal:command", "init");
                  }, 200);
                }
              });
            }
          } else {
            setTimeout(poll, 300);
          }
        }
      );
      req.on("error", (err) => {
        _logDetail(`Health check failed: ${err.message} — retrying in 300ms`, 'warn');
        if (!setupDone) setTimeout(poll, 300);
      });
      req.setTimeout(2000, () => { req.destroy(); }); // destroy triggers error→retry
    };
    setTimeout(poll, 500);
  } catch (err) {
    _err("Failed to start:", err);
    app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  _killAllTerminals();
  _killAllMcpServers();
  killFlask();
});

app.on("window-all-closed", () => {
  // Don't quit on macOS when all windows closed (tray keeps it alive)
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // Re-show window when dock icon clicked
  if (mainWindow) {
    mainWindow.show();
  }
});
