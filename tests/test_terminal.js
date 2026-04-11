/**
 * Terminal feature validation tests.
 * Run with: node tests/test_terminal.js
 *
 * Tests:
 * 1. preload.js exports exist and are well-formed
 * 2. node-pty can spawn and communicate
 * 3. PTY manager external terminal command generation
 */

const assert = require("assert");
const path = require("path");
const fs = require("fs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

// ── Test 1: preload.js structure ────────────────────────────────────────────
console.log("\n🔧 Preload Script Validation");

test("preload.js exists", () => {
  const preloadPath = path.join(__dirname, "..", "preload.js");
  assert.ok(fs.existsSync(preloadPath), "preload.js not found");
});

test("preload.js contains terminalAPI", () => {
  const content = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf-8");
  assert.ok(content.includes("terminalAPI"), "terminalAPI not found in preload.js");
  assert.ok(content.includes("contextBridge"), "contextBridge not found");
  assert.ok(content.includes("ipcRenderer"), "ipcRenderer not found");
});

test("preload.js exposes all required methods", () => {
  const content = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf-8");
  const required = ["create", "write", "resize", "close", "closeAll", "openExternal", "getPrefs", "setPrefs", "onData", "onClosed"];
  for (const method of required) {
    assert.ok(content.includes(`${method}:`), `Missing method: ${method}`);
  }
});

// ── Test 2: node-pty loads and can spawn ────────────────────────────────────
console.log("\n🖥️ node-pty Validation");

test("node-pty loads without error", () => {
  const pty = require("node-pty");
  assert.ok(pty, "node-pty failed to load");
  assert.ok(typeof pty.spawn === "function", "pty.spawn is not a function");
});

async function runPtyTests() {
  const pty = require("node-pty");

  await asyncTest("PTY spawns a shell", () => {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const term = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: { ...process.env, TERM: "xterm-256color" },
      });
      assert.ok(term.pid > 0, `PTY should have a PID, got: ${term.pid}`);

      let output = "";
      term.onData((data) => { output += data; });

      setTimeout(() => { term.write("echo SAVANT_TEST_OK\r"); }, 200);
      setTimeout(() => {
        term.kill();
        assert.ok(output.length > 0, "PTY should have produced output");
        resolve();
      }, 1000);
    });
  });

  await asyncTest("PTY resize works", () => {
    return new Promise((resolve) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const term = pty.spawn(shell, [], { name: "xterm-256color", cols: 80, rows: 24, cwd: process.env.HOME });
      term.resize(120, 40);
      assert.ok(true, "Resize succeeded");
      term.kill();
      resolve();
    });
  });

  await asyncTest("PTY onExit fires", () => {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const term = pty.spawn(shell, [], { name: "xterm-256color", cols: 80, rows: 24, cwd: process.env.HOME });
      term.onExit(() => resolve());
      // Use kill() which reliably triggers onExit
      setTimeout(() => term.kill(), 200);
      setTimeout(() => reject(new Error("onExit did not fire within 3s")), 3000);
    });
  });
}

// ── Test 3: main.js PTY manager code validation ────────────────────────────
console.log("\n📋 main.js PTY Manager Validation");

test("main.js contains PTY manager", () => {
  const content = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(content.includes("_terminals"), "PTY map _terminals not found");
  assert.ok(content.includes("_setupTerminalIPC"), "IPC setup function not found");
  assert.ok(content.includes("_killAllTerminals"), "Cleanup function not found");
});

test("main.js has all IPC channels", () => {
  const content = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  const channels = [
    "terminal:create", "terminal:data-in", "terminal:data-out",
    "terminal:resize", "terminal:close", "terminal:close-all",
    "terminal:open-external", "terminal:get-prefs", "terminal:set-prefs",
    "terminal:close-ack",
  ];
  for (const ch of channels) {
    assert.ok(content.includes(`"${ch}"`), `Missing IPC channel: ${ch}`);
  }
});

test("main.js includes preload.js in BrowserWindow", () => {
  const content = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(content.includes("preload.js"), "preload.js not referenced in main.js");
});

test("main.js kills terminals on quit", () => {
  const content = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(content.includes("_killAllTerminals"), "Terminal cleanup not in before-quit");
});

test("main.js supports all external terminals", () => {
  const content = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  for (const term of ["iterm", "terminal", "warp", "alacritty", "kitty", "custom"]) {
    assert.ok(content.includes(`"${term}"`), `Missing external terminal: ${term}`);
  }
});

// ── Test 4: Static assets ───────────────────────────────────────────────────
console.log("\n📦 Static Assets Validation");

test("xterm.css exists", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "savant", "static", "xterm.css")));
});

test("xterm.mjs exists", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "savant", "static", "xterm.mjs")));
});

test("xterm-addon-fit.mjs exists", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "savant", "static", "xterm-addon-fit.mjs")));
});

// ── Test 5: package.json config ─────────────────────────────────────────────
console.log("\n📦 Package Config Validation");

test("package.json has node-pty dependency", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
  assert.ok(pkg.dependencies && pkg.dependencies["node-pty"], "node-pty not in dependencies");
});

test("package.json has xterm dependencies", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
  assert.ok(pkg.dependencies["@xterm/xterm"], "@xterm/xterm not in dependencies");
  assert.ok(pkg.dependencies["@xterm/addon-fit"], "@xterm/addon-fit not in dependencies");
});

test("package.json has asarUnpack for node-pty", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
  const unpack = pkg.build && pkg.build.asarUnpack;
  assert.ok(unpack, "asarUnpack not in build config");
  assert.ok(unpack.some((p) => p.includes("node-pty")), "node-pty not in asarUnpack");
});

test("package.json includes preload.js in files", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
  const files = pkg.build && pkg.build.files;
  assert.ok(files && files.includes("preload.js"), "preload.js not in build files");
});

// ── Terminal split, reconnect, key handler & layout tests ───────────────────

test("main.js spawns login interactive shell (-l -i flags)", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes('pty.spawn(shell, ["-l", "-i"]'), "PTY should spawn with -l and -i flags for login+interactive shell (loads .zshrc and aliases)");
});

test("main.js has terminal:list IPC handler", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes('ipcMain.handle("terminal:list"'), "terminal:list IPC handler missing");
});

test("main.js keeps rolling buffer for reconnection", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes("TERM_BUFFER_SIZE"), "Buffer size constant missing");
  assert.ok(main.includes("getBuffer"), "getBuffer accessor missing in terminal entry");
});

test("main.js broadcasts to all windows via _termSend", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes("function _termSend("), "_termSend broadcast function missing");
  assert.ok(main.includes("_extraWindows"), "Should broadcast to extra windows");
});

test("preload.js exposes list method", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf-8");
  assert.ok(preload.includes("list:"), "list method missing from terminalAPI");
  assert.ok(preload.includes('"terminal:list"'), "terminal:list invoke missing");
});

test("index.html has _reconnectTerminals function", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("async function _reconnectTerminals"), "_reconnectTerminals function missing");
  assert.ok(html.includes("_termApi.list()"), "Should call terminalAPI.list() for reconnection");
});

test("index.html has split pane functions", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("async function termSplitH()"), "termSplitH missing");
  assert.ok(html.includes("async function termSplitV()"), "termSplitV missing");
  assert.ok(html.includes("async function termSplitPane("), "termSplitPane missing");
});

test("index.html has pane tree node operations", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("function _findNode("), "_findNode missing");
  assert.ok(html.includes("function _replaceNode("), "_replaceNode missing");
  assert.ok(html.includes("function _buildPaneDOM("), "_buildPaneDOM missing");
});

test("index.html has Cmd+D / Cmd+Shift+D shortcuts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  const cmdDBlock = html.includes("e.key === 'd' || e.key === 'D'");
  assert.ok(cmdDBlock, "Cmd+D key handler missing");
  assert.ok(html.includes("if (e.shiftKey) termSplitH()"), "Cmd+Shift+D should call termSplitH");
  assert.ok(html.includes("else termSplitV()"), "Cmd+D should call termSplitV");
});

test("index.html has attachCustomKeyEventHandler for xterm", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  const count = (html.match(/attachCustomKeyEventHandler/g) || []).length;
  assert.ok(count >= 2, `Expected at least 2 attachCustomKeyEventHandler calls (createPane + reconnect), found ${count}`);
});

test("index.html toggles term-open class on container", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("classList.add('term-open')"), "Should add term-open class when terminal opens");
  assert.ok(html.includes("classList.remove('term-open')"), "Should remove term-open class when terminal closes");
});

test("index.html does NOT force mobile layout when terminal is open", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  // Task board should NOT be forced into mobile view when terminal opens
  assert.ok(!html.includes(".container.term-open .kanban { grid-template-columns: repeat(2"), "kanban should not be forced to 2-col when terminal opens");
  assert.ok(!html.includes(".container.term-open .sessions-grid { grid-template-columns: 1fr"), "sessions-grid should not be forced to 1-col when terminal opens");
});

test("index.html has draggable splitters in pane tree", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("_makeSplitterDraggable"), "Splitter drag function missing");
  assert.ok(html.includes("term-splitter"), "term-splitter CSS class missing");
});

test("index.html drawer uses display:flex for active containers", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes(".term-container.active { display: flex; }"), "Active container should use display:flex");
});

test("detail.html has _reconnectTerminals function", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  assert.ok(html.includes("async function _reconnectTerminals"), "_reconnectTerminals missing in detail.html");
});

test("detail.html has attachCustomKeyEventHandler", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  const count = (html.match(/attachCustomKeyEventHandler/g) || []).length;
  assert.ok(count >= 2, `Expected at least 2 attachCustomKeyEventHandler in detail.html, found ${count}`);
});

test("index.html has _collectPaneIds for pane navigation", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("function _collectPaneIds("), "_collectPaneIds helper missing");
});

test("index.html has Cmd+[ ] pane navigation shortcuts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("e.key === '['") && html.includes("e.key === ']'"), "Cmd+[ / ] shortcuts missing");
  assert.ok(html.includes("_collectPaneIds("), "Should use _collectPaneIds for pane cycling");
});

test("index.html has Cmd+{ } tab navigation shortcuts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("e.key === '{'") || html.includes("e.key === '}'"), "Cmd+{ / } shortcuts missing");
});

test("index.html reuses xterm DOM on split (no re-open)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("pane.xterm.element"), "Should check xterm.element for existing DOM");
  assert.ok(html.includes("_savedMount"), "Should reuse saved xterm mount to avoid re-opening");
});

test("key handlers pass through [ ] { } to document", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  const handlers = html.match(/attachCustomKeyEventHandler[\s\S]*?return true;\s*\}/g) || [];
  for (const h of handlers) {
    assert.ok(h.includes("'['") || h.includes("'\\['"), "Key handler should pass through [ key");
  }
});

test("index.html has Cmd+T new tab shortcut (works from any state)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("e.key === 't' || e.key === 'T'"), "Cmd+T key check missing");
  assert.ok(html.includes("e.metaKey && !e.shiftKey"), "Should use metaKey (Cmd) for new tab");
  assert.ok(html.includes("_termDrawerState === 'closed'"), "Should open terminal when closed");
  assert.ok(html.includes("_termDrawerState === 'collapsed'"), "Should restore terminal when collapsed");
});

test("detail.html has Cmd+T new tab shortcut (works from any state)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  assert.ok(html.includes("e.key === 't' || e.key === 'T'"), "Cmd+T key check missing in detail.html");
  assert.ok(html.includes("e.metaKey && !e.shiftKey"), "Should use metaKey (Cmd)");
});

test("xterm key handlers pass through Cmd+T", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  const handlers = html.match(/attachCustomKeyEventHandler[\s\S]*?return true;\s*[\}\)]/g) || [];
  assert.ok(handlers.length >= 2, `Expected at least 2 key handlers, found ${handlers.length}`);
  for (const h of handlers) {
    assert.ok(h.includes("'t'"), `Key handler should pass through 't' key`);
    assert.ok(h.includes("e.metaKey"), `Key handler should check metaKey for Cmd+T`);
  }
});

test("index.html detaches xterm mounts before clearing container", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("_savedMount"), "Should use _savedMount to preserve xterm elements during re-render");
  assert.ok(html.includes("pane._savedMount = pane.xterm.element.parentElement"), "Should save mount before clearing innerHTML");
});

test("index.html _buildPaneDOM checks _savedMount first", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  const buildFn = html.substring(html.indexOf("function _buildPaneDOM"), html.indexOf("function _buildPaneDOM") + 2000);
  assert.ok(buildFn.includes("pane._savedMount"), "_buildPaneDOM should check _savedMount");
  assert.ok(buildFn.includes("pane.xterm.open(mount)"), "_buildPaneDOM should still open new panes");
});

test("split pane creates independent PTY (termSplitPane calls _createPane)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  const start = html.indexOf("async function termSplitPane");
  const splitFn = html.substring(start, start + 800);
  assert.ok(splitFn.includes("_createPane(tabId)"), "termSplitPane should create a new independent pane");
  assert.ok(splitFn.includes("_replaceNode("), "Should replace node in tree with split");
  assert.ok(splitFn.includes("_renderTabContent("), "Should re-render tab content after split");
});

test("index.html has ? help popup with all shortcuts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("term-help-popup"), "Help popup element missing");
  assert.ok(html.includes("⌘ + T") && html.includes("New tab"), "Cmd+T shortcut missing from help");
  assert.ok(html.includes("⌘ + D") && html.includes("Split vertical"), "Cmd+D shortcut missing from help");
  assert.ok(html.includes("⌘ + ⇧ + D") && html.includes("Split horizontal"), "Cmd+Shift+D shortcut missing from help");
  assert.ok(html.includes("⌘ + [") && html.includes("Previous pane"), "Cmd+[ shortcut missing from help");
  assert.ok(html.includes("⌘ + ]") && html.includes("Next pane"), "Cmd+] shortcut missing from help");
  assert.ok(html.includes("⌘ + {") && html.includes("Previous tab"), "Cmd+{ shortcut missing from help");
  assert.ok(html.includes("⌘ + }") && html.includes("Next tab"), "Cmd+} shortcut missing from help");
  assert.ok(html.includes("⌘ + `") && html.includes("Toggle terminal"), "Cmd+` shortcut missing from help");
});

test("detail.html has ? help popup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  assert.ok(html.includes("term-help-popup"), "Help popup missing in detail.html");
  assert.ok(html.includes("⌘ + T"), "Cmd+T shortcut missing from detail help");
});

test("index.html collapse button removed (no ◀)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  // The header should not have a collapse button anymore
  assert.ok(!html.includes('onclick="termCollapse()" title="Collapse">◀'), "Collapse button should be removed from header");
});

// ── Test: Zoom not blocked ──────────────────────────────────────────────────
console.log("\n🔍 Zoom Behavior Validation");

test("main.js does NOT block zoom keys (Cmd+=/-/0)", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  // Should not have setVisualZoomLevelLimits locking zoom to 1x
  assert.ok(!main.includes("setVisualZoomLevelLimits(1, 1)"), "setVisualZoomLevelLimits(1, 1) should be removed — it locks zoom");
  // The before-input-event handler should not prevent zoom keys
  const beforeInput = main.substring(main.indexOf('mainWindow.webContents.on("before-input-event"'));
  const handlerBlock = beforeInput.substring(0, beforeInput.indexOf("});") + 3);
  const blocksZoomKeys = handlerBlock.includes('"="') && handlerBlock.includes('event.preventDefault');
  assert.ok(!blocksZoomKeys, "before-input-event should not block Cmd+= zoom key");
});

test("main.js does NOT block zoom on extra windows", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  // Count occurrences of setVisualZoomLevelLimits — should be zero
  const zoomLimitCount = (main.match(/setVisualZoomLevelLimits\(1,\s*1\)/g) || []).length;
  assert.strictEqual(zoomLimitCount, 0, `Expected 0 setVisualZoomLevelLimits(1,1) calls, found ${zoomLimitCount}`);
});

// ── Test: Terminal Flask base URL is dynamic ────────────────────────────────
console.log("\n🌐 Terminal Flask Base URL Validation");

test("terminal.html uses dynamic _getFlaskBase() instead of const _flaskBase", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("function _getFlaskBase()"), "_getFlaskBase function missing");
  assert.ok(!html.includes("const _flaskBase ="), "const _flaskBase should be replaced with dynamic function");
});

test("terminal.html _loadXterm uses _getFlaskBase()", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("_getFlaskBase() + '/static/xterm.mjs'"), "_loadXterm should use _getFlaskBase()");
});

test("terminal.html _loadFitAddon uses _getFlaskBase()", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("_getFlaskBase() + '/static/xterm-addon-fit.mjs'"), "_loadFitAddon should use _getFlaskBase()");
});

test("terminal.html defers CSS loading until first use", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("function _ensureXtermCss()"), "_ensureXtermCss function missing");
  assert.ok(html.includes("_xtermCssLoaded"), "Should track CSS loaded state");
  // Should not load CSS eagerly at module level
  assert.ok(!html.includes("const _xtermCss = document.createElement"), "Should not eagerly create CSS link element");
});

test("terminal.html _init does NOT auto-call _reconnect", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  // Extract the _init function body (from declaration to closing brace + DOMContentLoaded)
  const initMatch = html.match(/function _init\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(initMatch, "_init function not found");
  assert.ok(!initMatch[0].includes("_reconnect()"), "_init should not auto-call _reconnect — wait for main process 'init' command");
});

test("terminal.html handles 'init' command for reconnection", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("case 'init':") || html.includes("cmd === 'init'"), "Should handle 'init' command");
  assert.ok(html.includes("_reconnect()"), "_reconnect should be called from 'init' command handler");
});

test("main.js sends 'init' command to terminal after Flask is ready", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes('"terminal:command", "init"'), "Should send init command to terminal.html after Flask health check passes");
});

// ── Test: Multi-tab support via IPC ─────────────────────────────────────────
console.log("\n📑 Multi-Tab IPC Validation");

test("preload.js exposes addNewTab method", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf-8");
  assert.ok(preload.includes("addNewTab:"), "addNewTab method missing from terminalAPI");
  assert.ok(preload.includes('"terminal:add-new-tab"'), "terminal:add-new-tab IPC channel missing");
});

test("main.js has terminal:add-new-tab IPC handler", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes('"terminal:add-new-tab"'), "terminal:add-new-tab handler missing in main.js");
});

test("main.js add-new-tab handler sends add-tab command to BrowserView", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  const handlerStart = main.indexOf('"terminal:add-new-tab"');
  const handlerBlock = main.substring(handlerStart, main.indexOf("});", handlerStart) + 3);
  assert.ok(handlerBlock.includes('"terminal:command", "add-tab"'), "Should send add-tab command to terminal.html BrowserView");
});

test("main.js add-new-tab handler shows drawer if hidden", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  const handlerStart = main.indexOf('"terminal:add-new-tab"');
  const handlerBlock = main.substring(handlerStart, main.indexOf("});", handlerStart) + 3);
  assert.ok(handlerBlock.includes("showTermView"), "Should show drawer if not visible before adding tab");
});

test("index.html termAddTab override uses addNewTab (not showDrawer)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  // Find the _setupPersistentTerminal function
  const setupStart = html.indexOf("_setupPersistentTerminal");
  const setupBlock = html.substring(setupStart, html.indexOf("})();", setupStart) + 5);
  assert.ok(setupBlock.includes("api.addNewTab"), "termAddTab override should use api.addNewTab");
  assert.ok(!setupBlock.includes("api.showDrawer(cwd)"), "termAddTab override should NOT use api.showDrawer(cwd) — that doesn't add tabs");
});

test("detail.html termAddTab override uses addNewTab (not showDrawer)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  const setupStart = html.indexOf("_setupPersistentTerminal");
  const setupBlock = html.substring(setupStart, html.indexOf("})();", setupStart) + 5);
  assert.ok(setupBlock.includes("api.addNewTab"), "detail.html termAddTab override should use api.addNewTab");
  assert.ok(!setupBlock.includes("api.showDrawer(cwd)"), "detail.html termAddTab override should NOT use api.showDrawer(cwd)");
});

test("terminal.html termAddTab calls _ensureXtermCss", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  const fnStart = html.indexOf("async function termAddTab");
  const fnBlock = html.substring(fnStart, fnStart + 300);
  assert.ok(fnBlock.includes("_ensureXtermCss()"), "termAddTab should call _ensureXtermCss before loading xterm");
});

// ── Test: detail.html term-open CSS targets body ────────────────────────────
console.log("\n📐 Detail Page Terminal Layout Validation");

test("detail.html term-open CSS targets body (not just .container)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  assert.ok(html.includes("body.term-open .meta-grid"), "body.term-open .meta-grid rule missing — detail page has no .container wrapper");
  assert.ok(html.includes("body.term-open .ckpt-layout"), "body.term-open .ckpt-layout rule missing");
  assert.ok(html.includes("body.term-open .conv-layout"), "body.term-open .conv-layout rule missing");
  assert.ok(html.includes("body.term-open .files-row"), "body.term-open .files-row rule missing");
  assert.ok(html.includes("body.term-open .git-files-grid"), "body.term-open .git-files-grid rule missing");
});

test("detail.html term-open CSS covers all grid layouts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  const layouts = [".meta-grid", ".meta-card.span-2", ".files-row", ".ckpt-layout", ".conv-layout", ".git-files-grid"];
  for (const layout of layouts) {
    assert.ok(
      html.includes(`body.term-open ${layout}`),
      `Missing body.term-open rule for ${layout}`
    );
  }
});

test("detail.html _applyDrawerState adds term-open to body when no .container", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  // The selector chain should fall through to body
  assert.ok(
    html.includes("document.querySelector('.container') || document.querySelector('.detail-container') || document.body"),
    "_applyDrawerState should fall through to document.body when no .container exists"
  );
});

// ── Test: Terminal resize drag ──────────────────────────────────────────────
console.log("\n↔️  Terminal Resize Drag Validation");

test("preload.js exposes stopDrag method", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf-8");
  assert.ok(preload.includes("stopDrag:"), "stopDrag method missing from terminalAPI");
  assert.ok(preload.includes('"terminal:stop-drag"'), "terminal:stop-drag IPC channel missing");
});

test("main.js has terminal:stop-drag IPC handler", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes('"terminal:stop-drag"'), "terminal:stop-drag handler missing in main.js");
});

test("main.js stop-drag clears drag state and interval", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  const handlerStart = main.indexOf('"terminal:stop-drag"');
  const handlerBlock = main.substring(handlerStart, main.indexOf("});", handlerStart) + 3);
  assert.ok(handlerBlock.includes("_termDragging = false"), "stop-drag should set _termDragging to false");
  assert.ok(handlerBlock.includes("clearInterval"), "stop-drag should clear the drag interval");
});

test("main.js drag does NOT use a fixed timeout to stop", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  const dragStart = main.indexOf('"terminal:start-drag"');
  const dragEnd = main.indexOf('"terminal:stop-drag"');
  const dragBlock = main.substring(dragStart, dragEnd);
  assert.ok(!dragBlock.includes("setTimeout"), "Drag should not use setTimeout as a fallback stop — use mouseup instead");
});

test("terminal.html sends stopDrag on mouseup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("terminalAPI.stopDrag"), "Should call stopDrag on mouseup");
  assert.ok(html.includes("addEventListener('mouseup'"), "Should listen for mouseup to end drag");
});

// ── Test: MCP servers on session detail page ────────────────────────────────
console.log("\n⬡  Session Detail MCP Display Validation");

test("detail.html renderMetaTab has MCP servers section", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  const metaTab = html.substring(html.indexOf("function renderMetaTab()"));
  assert.ok(metaTab.includes("MCP SERVERS"), "MCP SERVERS card title missing from renderMetaTab");
});

test("detail.html extracts MCP servers from tool_call_counts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  const metaTab = html.substring(html.indexOf("function renderMetaTab()"));
  assert.ok(metaTab.includes("sessionInfo.tool_call_counts"), "Should read tool_call_counts from sessionInfo");
  assert.ok(metaTab.includes("mcpMap"), "Should build mcpMap from tool call prefixes");
});

test("detail.html MCP section detects known MCP prefixes", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  const metaTab = html.substring(html.indexOf("function renderMetaTab()"));
  for (const prefix of ["savant-workspace", "savant-abilities", "savant-context", "gitlab", "github-mcp-server", "atlassian"]) {
    assert.ok(metaTab.includes(`'${prefix}'`), `MCP prefix '${prefix}' missing from detection list`);
  }
});

// ── Drawer auto-close tests ─────────────────────────────────────────────────
test("terminal.html auto-closes drawer when last tab is removed", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  // _closeTabUI should call termHide() when _termTabs.size === 0
  assert.ok(html.includes("_termTabs.size === 0"), "_closeTabUI should check _termTabs.size === 0");
  assert.ok(html.includes("termHide()"), "Should call termHide() when no tabs remain");
  // Verify termHide calls hideDrawer
  assert.ok(html.includes("hideDrawer()"), "termHide should call hideDrawer to close the BrowserView drawer");
});

test("terminal.html _closeTabUI deletes tab before auto-close check", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  const closeTabUI = html.substring(html.indexOf("function _closeTabUI("));
  const deleteIdx = closeTabUI.indexOf("_termTabs.delete(tabId)");
  const autoCloseIdx = closeTabUI.indexOf("_termTabs.size === 0");
  assert.ok(deleteIdx > 0, "_termTabs.delete(tabId) must be in _closeTabUI");
  assert.ok(autoCloseIdx > 0, "_termTabs.size === 0 check must be in _closeTabUI");
  assert.ok(deleteIdx < autoCloseIdx, "delete must come before size check");
});

// ── Modal centering + taskboard layout tests ────────────────────────────────
console.log("\n🪟 Modal & Layout with Terminal Open");

test("index.html modal-overlay uses --term-width-pct for right edge", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  assert.ok(html.includes("right: var(--term-width-pct"), "modal-overlay should use --term-width-pct CSS variable for right edge");
});

test("index.html ws-modal-overlay uses --term-width-pct for right edge", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  const wsOverlay = html.substring(html.indexOf(".ws-modal-overlay {"), html.indexOf(".ws-modal-overlay {") + 300);
  assert.ok(wsOverlay.includes("--term-width-pct"), "ws-modal-overlay should use --term-width-pct");
});

test("index.html notif-modal-overlay uses --term-width-pct for right edge", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  const notifOverlay = html.substring(html.indexOf(".notif-modal-overlay {"), html.indexOf(".notif-modal-overlay {") + 300);
  assert.ok(notifOverlay.includes("--term-width-pct"), "notif-modal-overlay should use --term-width-pct");
});

test("index.html _applyDrawerState sets --term-width-pct CSS variable", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "index.html"), "utf-8");
  const fn = html.substring(html.indexOf("function _applyDrawerState("));
  assert.ok(fn.includes("--term-width-pct"), "_applyDrawerState must set --term-width-pct on body");
});

test("detail.html modal-overlay uses --term-width-pct for right edge", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  const overlay = html.substring(html.indexOf(".modal-overlay {"), html.indexOf(".modal-overlay {") + 300);
  assert.ok(overlay.includes("--term-width-pct"), "detail modal-overlay should use --term-width-pct");
});

test("detail.html _applyDrawerState sets --term-width-pct CSS variable", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "savant", "templates", "detail.html"), "utf-8");
  const fn = html.substring(html.indexOf("function _applyDrawerState("));
  assert.ok(fn.includes("--term-width-pct"), "_applyDrawerState must set --term-width-pct on body");
});

// ── Terminal zoom tests ──────────────────────────────────────────────────────
console.log("\n🔍 Terminal Zoom Validation");

test("terminal.html has termZoom function", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("function termZoom("), "termZoom function missing");
  assert.ok(html.includes("function termResetZoom("), "termResetZoom function missing");
});

test("terminal.html has _termFontSize state variable", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("let _termFontSize = 13"), "_termFontSize state variable missing");
});

test("terminal.html zoom updates all xterm instances", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  const zoomFn = html.substring(html.indexOf("function termZoom("), html.indexOf("function termResetZoom("));
  assert.ok(zoomFn.includes("tab.xterm.options.fontSize"), "zoom must update xterm fontSize option");
  assert.ok(zoomFn.includes("tab.fitAddon.fit()"), "zoom must refit after font change");
});

test("terminal.html new tabs use _termFontSize", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("fontSize: _termFontSize"), "New xterm instances must use _termFontSize");
});

test("terminal.html has Cmd+=/- zoom keyboard shortcuts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  assert.ok(html.includes("termZoom(1)"), "Cmd+= should call termZoom(1)");
  assert.ok(html.includes("termZoom(-1)"), "Cmd+- should call termZoom(-1)");
  assert.ok(html.includes("termResetZoom()"), "Cmd+0 should call termResetZoom()");
});

test("terminal.html help popup shows zoom shortcuts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");
  // Find the actual HTML help popup element (not CSS class)
  const popupHtml = html.substring(html.indexOf('<div class="term-help-popup">'));
  assert.ok(popupHtml.includes("Zoom in"), "Help popup missing 'Zoom in' shortcut");
  assert.ok(popupHtml.includes("Zoom out"), "Help popup missing 'Zoom out' shortcut");
  assert.ok(popupHtml.includes("Reset zoom"), "Help popup missing 'Reset zoom' shortcut");
});

// ── External link handling tests ─────────────────────────────────────────────
console.log("\n🔗 External Link Handling");

test("main.js has setWindowOpenHandler on main window", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes("setWindowOpenHandler"), "mainWindow must have setWindowOpenHandler");
  assert.ok(main.includes("shell.openExternal(url)"), "setWindowOpenHandler must call shell.openExternal");
});

test("main.js has setWindowOpenHandler on extra windows", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  const extraWinSection = main.substring(main.indexOf("function openNewWindow()"));
  assert.ok(extraWinSection.includes("setWindowOpenHandler"), "Extra windows must have setWindowOpenHandler");
});

test("main.js has will-navigate handler to prevent external navigation", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes("will-navigate"), "must have will-navigate handler");
  // Count occurrences — should be on both main and extra windows
  const matches = main.match(/will-navigate/g);
  assert.ok(matches && matches.length >= 2, "will-navigate should be on both main and extra windows");
});

// ── Test: terminal.html structure & correctness ─────────────────────────────
console.log("\n🖥️  Terminal HTML Validation");

const terminalHtml = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");

test("terminal.html is a single valid HTML document (no duplicates)", () => {
  const docCount = (terminalHtml.match(/<!DOCTYPE html>/gi) || []).length;
  assert.strictEqual(docCount, 1, `Expected 1 DOCTYPE, found ${docCount} — file has duplicate content`);
});

test("terminal.html has exactly one <html> opening tag", () => {
  const count = (terminalHtml.match(/<html/g) || []).length;
  assert.strictEqual(count, 1, `Expected 1 <html>, found ${count}`);
});

test("terminal.html help button has id='btn-help'", () => {
  assert.ok(terminalHtml.includes('id="btn-help"'), "Help button must have id='btn-help'");
});

test("terminal.html help popup has id='term-help-popup'", () => {
  assert.ok(terminalHtml.includes('id="term-help-popup"'), "Help popup must have id='term-help-popup'");
});

test("terminal.html help popup opens DOWNWARD (top: calc)", () => {
  assert.ok(
    terminalHtml.includes("top: calc(100%"),
    "Help popup must use 'top: calc(100%...' to open downward, not 'bottom:'"
  );
  assert.ok(
    !terminalHtml.includes("bottom: calc(100% + 6px)"),
    "Old upward-opening style 'bottom: calc(100% + 6px)' must be removed"
  );
});

test("terminal.html outside-click handler uses proper DOM check (not !popup.closest)", () => {
  assert.ok(
    !terminalHtml.includes("!popup.closest &&"),
    "Bug: '!popup.closest' always false — must use 'btn.contains(e.target)' pattern"
  );
  assert.ok(
    terminalHtml.includes("btn.contains(e.target)"),
    "Outside-click handler must check btn.contains(e.target)"
  );
});

test("terminal.html toggleHelp function exists", () => {
  assert.ok(terminalHtml.includes("function toggleHelp("), "toggleHelp() function missing");
});

test("terminal.html help popup has all shortcut sections", () => {
  assert.ok(terminalHtml.includes("Tabs"), "Help popup missing Tabs section");
  assert.ok(terminalHtml.includes("Split"), "Help popup missing Split section");
  assert.ok(terminalHtml.includes("View"), "Help popup missing View section");
});

test("terminal.html help popup documents split shortcut (⌘ D)", () => {
  assert.ok(terminalHtml.includes("⌘ D"), "Help popup must document ⌘D split shortcut");
});

test("terminal.html help popup documents tab shortcuts", () => {
  assert.ok(terminalHtml.includes("⌘ T"), "Missing ⌘T new tab shortcut");
  assert.ok(terminalHtml.includes("⌘ W"), "Missing ⌘W close tab shortcut");
});

test("terminal.html split button (⊞) present in header for horizontal split", () => {
  assert.ok(terminalHtml.includes('id="btn-split-h"'), "Horizontal split button id missing");
  assert.ok(terminalHtml.includes("termToggleSplit('h')"), "Horizontal split toggle call missing");
  assert.ok(terminalHtml.includes("⊞"), "Split button ⊞ icon missing");
});

test("terminal.html vertical split button (⊟) present in header", () => {
  assert.ok(terminalHtml.includes('id="btn-split-v"'), "Vertical split button id missing");
  assert.ok(terminalHtml.includes("termToggleSplit('v')"), "Vertical split toggle call missing");
  assert.ok(terminalHtml.includes("⊟"), "Vertical split button ⊟ icon missing");
});

test("terminal.html expand button present in header", () => {
  assert.ok(terminalHtml.includes("termToggleExpand()"), "Expand toggle button missing");
  assert.ok(terminalHtml.includes("⛶"), "Expand button ⛶ icon missing");
});

test("terminal.html has recursive split tree structure", () => {
  assert.ok(terminalHtml.includes('id="term-body"'), "term-body container missing");
  assert.ok(terminalHtml.includes('split-node'), "split-node CSS class missing");
  assert.ok(terminalHtml.includes('pane-leaf'), "pane-leaf CSS class missing");
  assert.ok(terminalHtml.includes('split-divider'), "split-divider CSS class missing");
});

test("terminal.html keyboard shortcuts handler passes ⌘D through xterm", () => {
  assert.ok(
    terminalHtml.includes("'d'") && terminalHtml.includes("'D'"),
    "⌘D must be in passthrough key list"
  );
});

test("terminal.html zoom shortcuts (⌘= ⌘- ⌘0) passed through xterm", () => {
  const passthrough = terminalHtml.match(/const APP_PASSTHROUGH_KEYS = \[([^\]]+)\]/);
  assert.ok(passthrough, "passthrough key list not found");
  const keys = passthrough[1];
  assert.ok(keys.includes("'='"), "⌘= not in passthrough list");
  assert.ok(keys.includes("'-'"), "⌘- not in passthrough list");
  assert.ok(keys.includes("'0'"), "⌘0 not in passthrough list");
});

test("terminal.html termToggleSplit function accepts direction argument", () => {
  assert.ok(terminalHtml.includes("async function termToggleSplit(direction)"), "termToggleSplit must accept 'direction' param");
});

test("terminal.html _splitFocusedPane creates split node with direction", () => {
  assert.ok(terminalHtml.includes("async function _splitFocusedPane(direction)"), "_splitFocusedPane function missing");
  assert.ok(terminalHtml.includes("direction,"), "split node must store direction");
});

test("terminal.html _buildTree renders split nodes into DOM", () => {
  assert.ok(terminalHtml.includes("function _buildTree()"), "_buildTree function missing");
  assert.ok(terminalHtml.includes("_buildNodeDOM"), "_buildNodeDOM helper missing");
});

test("terminal.html #term-body.split-v CSS exists for vertical layout", () => {
  assert.ok(terminalHtml.includes("split-v"), "split-v CSS class missing");
  assert.ok(terminalHtml.includes("flex-direction: column"), "Vertical split needs flex-direction: column");
});

test("terminal.html pane-divider has row-resize cursor for vertical split", () => {
  assert.ok(terminalHtml.includes("cursor: row-resize"), "Vertical split needs row-resize cursor on divider");
});

test("terminal.html divider drag uses clientY for vertical split", () => {
  assert.ok(terminalHtml.includes("clientY"), "Divider drag must use clientY for vertical split");
  assert.ok(terminalHtml.includes("rect.height"), "Divider drag must use rect.height for vertical split");
  assert.ok(terminalHtml.includes("splitNode.direction === 'v'"), "Drag must check splitNode.direction === 'v'");
});

test("terminal.html ⌘⇧D shortcut triggers vertical split", () => {
  assert.ok(
    terminalHtml.includes("termToggleSplit('v')"),
    "⌘⇧D must call termToggleSplit('v')"
  );
  // Ensure it's in keyboard handler (shiftKey + D)
  const keyBlock = terminalHtml.match(/document\.addEventListener\('keydown'[\s\S]{0,2000}?\}\);/);
  assert.ok(keyBlock, "keydown handler not found");
  assert.ok(keyBlock[0].includes("termToggleSplit('v')"), "⌘⇧D shortcut not in keydown handler");
});

test("terminal.html ⌘D shortcut triggers horizontal split", () => {
  const keyBlock = terminalHtml.match(/document\.addEventListener\('keydown'[\s\S]{0,2000}?\}\);/);
  assert.ok(keyBlock, "keydown handler not found");
  assert.ok(keyBlock[0].includes("termToggleSplit('h')"), "⌘D shortcut must call termToggleSplit('h')");
});

test("terminal.html _closeFocusedPane collapses parent split", () => {
  assert.ok(
    terminalHtml.includes("function _closeFocusedPane()"),
    "_closeFocusedPane function must exist"
  );
  assert.ok(
    terminalHtml.includes("_removeLeafFromTree"),
    "_closeFocusedPane must call _removeLeafFromTree to collapse parent"
  );
});

test("terminal.html help popup documents vertical split shortcut ⌘⇧D", () => {
  assert.ok(
    terminalHtml.includes("⌘ ⇧ D") || terminalHtml.includes("⌘⇧D"),
    "Help popup must document ⌘⇧D vertical split shortcut"
  );
});

test("terminal.html _treeRoot initialized to null", () => {
  assert.ok(
    terminalHtml.includes("let _treeRoot       = null"),
    "_treeRoot must initialize to null"
  );
});

test("terminal.html split-node CSS supports both directions", () => {
  assert.ok(
    terminalHtml.includes(".split-node.split-h") &&
    terminalHtml.includes(".split-node.split-v"),
    "split-node must have CSS for both h and v directions"
  );
});

test("terminal.html EXPAND_WIDTH_PCT is 98", () => {
  const match = terminalHtml.match(/const EXPAND_WIDTH_PCT\s*=\s*(\d+)/);
  assert.ok(match, "EXPAND_WIDTH_PCT constant not found");
  assert.strictEqual(parseInt(match[1]), 98, `Expected 98, got ${match[1]}`);
});

test("terminal.html NORMAL_WIDTH_PCT is defined", () => {
  const match = terminalHtml.match(/const NORMAL_WIDTH_PCT\s*=\s*(\d+)/);
  assert.ok(match, "NORMAL_WIDTH_PCT constant not found");
  const val = parseInt(match[1]);
  assert.ok(val < 90, `NORMAL_WIDTH_PCT should be < 90, got ${val}`);
});

test("terminal.html expand threshold uses >= 90 (not 85)", () => {
  assert.ok(
    terminalHtml.includes("current >= 90"),
    "Expand threshold must be >= 90 to match EXPAND_WIDTH_PCT of 98"
  );
  assert.ok(
    !terminalHtml.includes("current >= 85"),
    "Old threshold 'current >= 85' must be removed"
  );
});

test("terminal.html expand btn active check uses >= 90", () => {
  assert.ok(
    terminalHtml.includes("target >= 90"),
    "Active-btn toggle must check target >= 90"
  );
});

test("main.js set-width-pct clamps max at 97 or higher", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  // Should allow at least 97 to accommodate 98%
  const clampMatch = main.match(/Math\.min\((\d+),\s*pct\)/);
  assert.ok(clampMatch, "set-width-pct must clamp with Math.min");
  assert.ok(parseInt(clampMatch[1]) >= 97, `Clamp max should be >= 97, got ${clampMatch[1]}`);
});

test("preload.js exposes setWidthPct for expand/restore", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf-8");
  assert.ok(preload.includes("setWidthPct"), "setWidthPct missing from preload.js");
  assert.ok(preload.includes("getWidthPct"), "getWidthPct missing from preload.js");
});

test("main.js handles terminal:set-width-pct IPC", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes("terminal:set-width-pct"), "terminal:set-width-pct IPC missing");
  assert.ok(main.includes("terminal:get-width-pct"), "terminal:get-width-pct IPC missing");
});

// ── Drawer close bug regression tests ───────────────────────────────────────

test("terminal.html _closeTabUI removes leaf and collapses parent", () => {
  // When a leaf is closed, its parent split must collapse
  assert.ok(
    terminalHtml.includes("_removeLeafFromTree(leaf.id)"),
    "_closeTabUI must call _removeLeafFromTree to collapse parent split"
  );
});

test("terminal.html _removeLeafFromTree replaces parent with sibling", () => {
  assert.ok(
    terminalHtml.includes("function _removeLeafFromTree(leafId)"),
    "_removeLeafFromTree function must exist"
  );
  assert.ok(
    terminalHtml.includes("sibling"),
    "_removeLeafFromTree must promote sibling when parent collapses"
  );
});

test("terminal.html closing last leaf hides drawer", () => {
  assert.ok(
    terminalHtml.includes("_termTabs.size === 0") && terminalHtml.includes("termHide()"),
    "termHide must be called when all tabs are closed"
  );
});

test("terminal.html _closeTabUI termHide path: size === 0 still present for no-split case", () => {
  // When there is no split and last tab is closed, termHide must still fire
  assert.ok(
    terminalHtml.includes("_termTabs.size === 0") && terminalHtml.includes("termHide()"),
    "termHide must be called when all tabs are closed (no split)"
  );
});

// ── Test 6: BrowserView bridge terminal button functions ────────────────────
console.log("\n🔌 BrowserView Bridge Validation");

const indexHtmlPath = path.join(__dirname, "..", "savant", "templates", "index.html");
const indexHtml = fs.readFileSync(indexHtmlPath, "utf-8");

test("terminal button functions are defined in index.html", () => {
  assert.ok(indexHtml.includes("termSplitH"), "termSplitH not found");
  assert.ok(indexHtml.includes("termSplitV"), "termSplitV not found");
  assert.ok(indexHtml.includes("termMaximize"), "termMaximize not found");
  assert.ok(indexHtml.includes("termClose"), "termClose not found");
  assert.ok(indexHtml.includes("termAddTab"), "termAddTab not found");
});

test("termSplitH calls api.splitPane with 'h'", () => {
  assert.ok(
    indexHtml.includes("api.splitPane && api.splitPane('h')") ||
    indexHtml.includes("api.splitPane('h')"),
    "termSplitH must call api.splitPane('h')"
  );
});

test("termSplitV calls api.splitPane with 'v'", () => {
  assert.ok(
    indexHtml.includes("api.splitPane && api.splitPane('v')") ||
    indexHtml.includes("api.splitPane('v')"),
    "termSplitV must call api.splitPane('v')"
  );
});

test("termMaximize toggles width between saved and 95%", () => {
  assert.ok(
    indexHtml.includes("termMaximize") && indexHtml.includes("95"),
    "termMaximize must reference 95 (95% width)"
  );
});

test("termClose calls api.hideDrawer", () => {
  assert.ok(
    indexHtml.includes("window.termClose") && indexHtml.includes("api.hideDrawer"),
    "termClose must use api.hideDrawer"
  );
});

test("termAddTab calls api.addNewTab", () => {
  assert.ok(
    indexHtml.includes("window.termAddTab") && indexHtml.includes("api.addNewTab"),
    "termAddTab must call api.addNewTab"
  );
});

test("BrowserView bridge overrides all 5 terminal functions", () => {
  const bridgeSection = indexHtml.slice(indexHtml.indexOf("_setupPersistentTerminal"));
  assert.ok(bridgeSection.includes("window.termClose"), "termClose override missing");
  assert.ok(bridgeSection.includes("window.termAddTab"), "termAddTab override missing");
  assert.ok(bridgeSection.includes("window.termSplitH"), "termSplitH override missing");
  assert.ok(bridgeSection.includes("window.termSplitV"), "termSplitV override missing");
  assert.ok(bridgeSection.includes("window.termMaximize"), "termMaximize override missing");
});

// ── VS Code Parity Tests ─────────────────────────────────────────────────────
console.log("\n🆚 VS Code Terminal Parity Validation");

// ── PTY spawn environment ────────────────────────────────────────────────────
test("main.js spawns shell with -l AND -i flags (login + interactive)", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(
    main.includes('pty.spawn(shell, ["-l", "-i"]'),
    "PTY must spawn with both -l (login) and -i (interactive) — -i loads .zshrc aliases"
  );
});

test("main.js sets COLORTERM=truecolor for 24-bit color support", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes('COLORTERM: "truecolor"'), "COLORTERM=truecolor missing — needed for bat, delta, ls colors");
});

test("main.js sets TERM_PROGRAM to identify the terminal", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes('TERM_PROGRAM: "Savant"'), "TERM_PROGRAM not set — shell configs can't detect the terminal");
});

test("main.js sets TERM_PROGRAM_VERSION", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  assert.ok(main.includes("TERM_PROGRAM_VERSION"), "TERM_PROGRAM_VERSION not set");
  assert.ok(main.includes("app.getVersion()"), "TERM_PROGRAM_VERSION should use app.getVersion()");
});

// ── xterm.js options — VS Code defaults ─────────────────────────────────────
const termHtml = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");

test("terminal.html xterm has macOptionIsMeta: true (Option key as Meta)", () => {
  assert.ok(
    termHtml.includes("macOptionIsMeta: true"),
    "macOptionIsMeta missing — Option key won't work as Meta/Escape for readline shortcuts"
  );
});

test("terminal.html xterm has altClickMovesCursor: true", () => {
  assert.ok(
    termHtml.includes("altClickMovesCursor: true"),
    "altClickMovesCursor missing — alt-click should move cursor like VS Code"
  );
});

test("terminal.html xterm has rightClickSelectsWord: true", () => {
  assert.ok(
    termHtml.includes("rightClickSelectsWord: true"),
    "rightClickSelectsWord missing — right-click should select word like VS Code"
  );
});

test("terminal.html xterm has wordSeparator configured", () => {
  assert.ok(
    termHtml.includes("wordSeparator:"),
    "wordSeparator missing — double-click word selection will be wrong without it"
  );
  // Must include common separators
  const wsMatch = termHtml.match(/wordSeparator:\s*['"]([^'"]+)['"]/);
  assert.ok(wsMatch, "wordSeparator value not found");
  const sep = wsMatch[1];
  assert.ok(sep.includes("("), "wordSeparator should include ( for boundary detection");
  assert.ok(sep.includes(")"), "wordSeparator should include ) for boundary detection");
  assert.ok(sep.includes("{"), "wordSeparator should include { for boundary detection");
  assert.ok(sep.includes("["), "wordSeparator should include [ for boundary detection");
});

test("terminal.html xterm has fastScrollModifier: 'alt'", () => {
  assert.ok(
    termHtml.includes("fastScrollModifier: 'alt'"),
    "fastScrollModifier missing — alt+scroll should fast-scroll like VS Code"
  );
});

test("terminal.html xterm has fastScrollSensitivity set", () => {
  assert.ok(
    termHtml.includes("fastScrollSensitivity:"),
    "fastScrollSensitivity missing"
  );
});

test("terminal.html xterm has drawBoldTextInBrightColors: true", () => {
  assert.ok(
    termHtml.includes("drawBoldTextInBrightColors: true"),
    "drawBoldTextInBrightColors missing — bold text won't render brighter"
  );
});

test("terminal.html xterm has lineHeight set (breathing room)", () => {
  assert.ok(
    termHtml.includes("lineHeight:"),
    "lineHeight missing — VS Code uses 1.2 by default"
  );
  const lhMatch = termHtml.match(/lineHeight:\s*([\d.]+)/);
  assert.ok(lhMatch, "lineHeight value not parseable");
  assert.ok(parseFloat(lhMatch[1]) >= 1.0, "lineHeight should be >= 1.0");
});

test("terminal.html xterm has overviewRulerWidth set", () => {
  assert.ok(
    termHtml.includes("overviewRulerWidth:"),
    "overviewRulerWidth missing — VS Code shows a scroll overview ruler"
  );
});

test("terminal.html xterm cursorStyle is 'block' (VS Code default)", () => {
  assert.ok(
    termHtml.includes("cursorStyle: 'block'"),
    "cursorStyle should be 'block' to match VS Code default"
  );
});

test("terminal.html xterm has scrollback >= 10000", () => {
  const sbMatch = termHtml.match(/scrollback:\s*(\d+)/);
  assert.ok(sbMatch, "scrollback not found in xterm config");
  assert.ok(
    parseInt(sbMatch[1]) >= 10000,
    `scrollback should be >= 10000 (VS Code default 1000, we use more), got ${sbMatch[1]}`
  );
});

test("terminal.html xterm has selectionInactiveBackground in theme", () => {
  assert.ok(
    termHtml.includes("selectionInactiveBackground:"),
    "selectionInactiveBackground missing — VS Code dims selection when unfocused"
  );
});

test("terminal.html xterm has selectionForeground in theme", () => {
  assert.ok(
    termHtml.includes("selectionForeground:"),
    "selectionForeground missing from theme"
  );
});

test("terminal.html xterm fontFamily includes fallback monospace fonts", () => {
  // fontFamily uses outer double-quotes wrapping inner single-quoted names:
  // fontFamily: "'JetBrains Mono','Menlo','Cascadia Code','Consolas',monospace"
  const ffMatch = termHtml.match(/fontFamily:\s*"([^"]+)"/);
  assert.ok(ffMatch, `fontFamily not found — expected: fontFamily: "'JetBrains Mono','Menlo',..."`);
  const ff = ffMatch[1];
  assert.ok(ff.includes("Menlo") || ff.includes("Consolas") || ff.includes("monospace"),
    "fontFamily should include system monospace fallbacks (Menlo, Consolas, monospace)"
  );
});

// ── WebLinksAddon ────────────────────────────────────────────────────────────
test("xterm-addon-web-links.mjs static asset exists", () => {
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "savant", "static", "xterm-addon-web-links.mjs")),
    "xterm-addon-web-links.mjs missing from savant/static/ — URLs won't be clickable"
  );
});

test("terminal.html @xterm/addon-web-links dependency exists in package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
  assert.ok(
    pkg.dependencies && pkg.dependencies["@xterm/addon-web-links"],
    "@xterm/addon-web-links not in package.json dependencies"
  );
});

test("terminal.html has _loadWebLinksAddon function", () => {
  assert.ok(
    termHtml.includes("async function _loadWebLinksAddon()"),
    "_loadWebLinksAddon function missing — addon won't be lazy-loaded"
  );
});

test("terminal.html _loadWebLinksAddon imports from static path", () => {
  assert.ok(
    termHtml.includes("_getFlaskBase() + '/static/xterm-addon-web-links.mjs'"),
    "_loadWebLinksAddon should import from Flask static path"
  );
});

test("terminal.html _createXterm accepts webLinksAddon parameter", () => {
  const fnMatch = termHtml.match(/function _createXterm\(([^)]+)\)/);
  assert.ok(fnMatch, "_createXterm function signature not found");
  assert.ok(
    fnMatch[1].includes("webLinksAddon"),
    "_createXterm must accept webLinksAddon as third parameter"
  );
});

test("terminal.html _createXterm loads WebLinksAddon when provided", () => {
  const fnStart = termHtml.indexOf("function _createXterm(");
  const fnEnd = termHtml.indexOf("\nfunction ", fnStart + 1);
  const fnBody = termHtml.substring(fnStart, fnEnd);
  assert.ok(
    fnBody.includes("xterm.loadAddon(webLinksAddon)"),
    "_createXterm must call xterm.loadAddon(webLinksAddon) when addon is provided"
  );
});

test("terminal.html WebLinksAddon is instantiated per tab (new WebLinksAddon())", () => {
  const count = (termHtml.match(/new WebLinksAddon\(\)/g) || []).length;
  assert.ok(
    count >= 2,
    `Each tab needs its own WebLinksAddon instance. Expected >= 2 'new WebLinksAddon()' calls (termAddTab + _reconnect), found ${count}`
  );
});

test("terminal.html termAddTab awaits WebLinksAddon before creating xterm", () => {
  const fnStart = termHtml.indexOf("async function termAddTab(");
  const fnEnd = termHtml.indexOf("\n// ", fnStart + 1);
  const fnBody = termHtml.substring(fnStart, fnEnd);
  assert.ok(
    fnBody.includes("WebLinksAddon") && fnBody.includes("_loadWebLinksAddon"),
    "termAddTab must load WebLinksAddon before creating the terminal"
  );
});

test("terminal.html _reconnect loads WebLinksAddon for existing tabs", () => {
  const fnStart = termHtml.indexOf("async function _reconnect(");
  const fnEnd = termHtml.indexOf("\n// ", fnStart + 1);
  const fnBody = termHtml.substring(fnStart, fnEnd);
  assert.ok(
    fnBody.includes("WebLinksAddon") && fnBody.includes("_loadWebLinksAddon"),
    "_reconnect must also load WebLinksAddon for reconnected tabs"
  );
});

// ── ⌘K clear shortcut ────────────────────────────────────────────────────────
test("terminal.html supports ⌘K to clear scrollback (VS Code behaviour)", () => {
  assert.ok(
    termHtml.includes("xterm.clear()"),
    "xterm.clear() missing — ⌘K should clear scrollback like VS Code"
  );
});

test("terminal.html ⌘K clear is in the xterm key handler (not document keydown)", () => {
  const handlerMatch = termHtml.match(/attachCustomKeyEventHandler[\s\S]*?return true;\s*\}/);
  assert.ok(handlerMatch, "attachCustomKeyEventHandler not found");
  assert.ok(
    handlerMatch[0].includes("xterm.clear()"),
    "⌘K clear must be handled inside attachCustomKeyEventHandler, not document keydown"
  );
});

test("terminal.html help popup documents ⌘K clear shortcut", () => {
  // Popup div has id="term-help-popup" on it, not just the class
  const popupStart = termHtml.indexOf('id="term-help-popup"');
  assert.ok(popupStart !== -1, 'id="term-help-popup" element not found');
  const popupHtml = termHtml.substring(popupStart, popupStart + 2000);
  assert.ok(
    popupHtml.includes("⌘ K") || popupHtml.includes("⌘K"),
    "Help popup must document ⌘K clear scrollback shortcut"
  );
  assert.ok(
    popupHtml.includes("Clear"),
    "Help popup must label ⌘K as 'Clear scrollback'"
  );
});

// ── ⌘C smart copy ────────────────────────────────────────────────────────────
test("terminal.html ⌘C copies text only when there is a selection", () => {
  const handlerMatch = termHtml.match(/attachCustomKeyEventHandler[\s\S]*?return true;\s*\}/);
  assert.ok(handlerMatch, "attachCustomKeyEventHandler not found");
  assert.ok(
    handlerMatch[0].includes("hasSelection()"),
    "⌘C handler must check xterm.hasSelection() before copying — otherwise interrupts are swallowed"
  );
});

// ── PTY async tests ──────────────────────────────────────────────────────────
async function runVsCodeParityPtyTests() {
  const pty = require("node-pty");

  await asyncTest("PTY spawns with -l -i and COLORTERM=truecolor", () => {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const term = pty.spawn(shell, ["-l", "-i"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          TERM_PROGRAM: "Savant",
        },
      });
      assert.ok(term.pid > 0, `PTY should have a valid PID, got ${term.pid}`);
      term.kill();
      resolve();
    });
  });

  await asyncTest("PTY with -i flag produces shell prompt output", () => {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const term = pty.spawn(shell, ["-l", "-i"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      let output = "";
      term.onData((d) => { output += d; });
      // Interactive shells can take 2-5s to initialize (sourcing .zshrc, plugins, etc.)
      setTimeout(() => {
        term.kill();
        if (output.length > 0) resolve();
        else reject(new Error("Interactive shell should produce prompt output within 5s"));
      }, 5000);
      setTimeout(() => { try { term.kill(); } catch {} reject(new Error("Timeout waiting for shell output")); }, 10000);
    });
  });

  await asyncTest("PTY echo command works with -l -i shell", () => {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const term = pty.spawn(shell, ["-l", "-i"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: { ...process.env, TERM: "xterm-256color" },
      });
      let output = "";
      term.onData((d) => { output += d; });
      setTimeout(() => term.write("echo PARITY_TEST_OK\r"), 400);
      setTimeout(() => {
        term.kill();
        assert.ok(output.includes("PARITY_TEST_OK"), `Expected PARITY_TEST_OK in output, got: ${output.slice(-200)}`);
        resolve();
      }, 1500);
      setTimeout(() => reject(new Error("Timeout waiting for echo output")), 6000);
    });
  });

  await asyncTest("PTY resize works after -l -i spawn", () => {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const term = pty.spawn(shell, ["-l", "-i"], {
        name: "xterm-256color", cols: 80, rows: 24, cwd: process.env.HOME,
        env: { ...process.env, TERM: "xterm-256color" },
      });
      setTimeout(() => {
        assert.doesNotThrow(() => term.resize(220, 50), "resize(220, 50) should not throw");
        assert.strictEqual(term.cols, 220, `cols should be 220 after resize, got ${term.cols}`);
        assert.strictEqual(term.rows, 50, `rows should be 50 after resize, got ${term.rows}`);
        term.kill();
        resolve();
      }, 300);
      setTimeout(() => reject(new Error("Timeout")), 4000);
    });
  });

  await asyncTest("PTY TERM_PROGRAM visible inside shell", () => {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const term = pty.spawn(shell, ["-l", "-i"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: { ...process.env, TERM: "xterm-256color", TERM_PROGRAM: "Savant" },
      });
      let output = "";
      term.onData((d) => { output += d; });
      setTimeout(() => term.write("echo $TERM_PROGRAM\r"), 500);
      setTimeout(() => {
        term.kill();
        try {
          assert.ok(output.includes("Savant"), `Expected 'Savant' in output from echo $TERM_PROGRAM, got: ${output.slice(-200)}`);
          resolve();
        } catch (e) { reject(e); }
      }, 1500);
      setTimeout(() => reject(new Error("Timeout waiting for TERM_PROGRAM output")), 6000);
    });
  });

  await asyncTest("PTY COLORTERM=truecolor visible inside shell", () => {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const term = pty.spawn(shell, ["-l", "-i"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      let output = "";
      term.onData((d) => { output += d; });
      setTimeout(() => term.write("echo $COLORTERM\r"), 500);
      setTimeout(() => {
        term.kill();
        try {
          assert.ok(output.includes("truecolor"), `Expected 'truecolor' in output, got: ${output.slice(-200)}`);
          resolve();
        } catch (e) { reject(e); }
      }, 1500);
      setTimeout(() => reject(new Error("Timeout")), 6000);
    });
  });
}

// ── Test suite: Modular Architecture ────────────────────────────────────────
// Validates the refactored terminal.html structure: constants, config objects,
// deduplicated helpers, and clean separation of concerns.

function runModularArchitectureTests() {
  console.log("\n🏗️  Terminal Modular Architecture");

  const termHtml = fs.readFileSync(path.join(__dirname, "..", "terminal.html"), "utf-8");

  // ── TERM_THEME: named theme object ───────────────────────────────────────
  test("TERM_THEME is a named constant", () => {
    assert.ok(/const\s+TERM_THEME\s*=\s*\{/.test(termHtml), "Expected const TERM_THEME = {");
  });

  test("TERM_THEME has all Tokyo Night colors", () => {
    const themeMatch = termHtml.match(/const\s+TERM_THEME\s*=\s*(\{[\s\S]*?\n\s*\};)/);
    assert.ok(themeMatch, "Could not extract TERM_THEME block");
    const block = themeMatch[1];
    const required = ["background", "foreground", "cursor", "cursorAccent",
      "selectionBackground", "selectionForeground", "selectionInactiveBackground",
      "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue",
      "brightMagenta", "brightCyan", "brightWhite"];
    for (const key of required) {
      assert.ok(block.includes(key), `TERM_THEME missing color: ${key}`);
    }
  });

  // ── TERM_OPTIONS: named options object ───────────────────────────────────
  test("TERM_OPTIONS is a named constant", () => {
    assert.ok(/const\s+TERM_OPTIONS\s*=\s*\{/.test(termHtml), "Expected const TERM_OPTIONS = {");
  });

  test("TERM_OPTIONS includes all VS Code parity settings", () => {
    const optMatch = termHtml.match(/const\s+TERM_OPTIONS\s*=\s*(\{[\s\S]*?\n\s*\};)/);
    assert.ok(optMatch, "Could not extract TERM_OPTIONS block");
    const block = optMatch[1];
    const required = [
      "macOptionIsMeta", "altClickMovesCursor", "rightClickSelectsWord",
      "wordSeparator", "fastScrollModifier", "fastScrollSensitivity",
      "drawBoldTextInBrightColors", "cursorBlink", "cursorStyle",
      "scrollback", "tabStopWidth", "overviewRulerWidth",
    ];
    for (const key of required) {
      assert.ok(block.includes(key), `TERM_OPTIONS missing: ${key}`);
    }
  });

  test("TERM_OPTIONS references TERM_THEME (not inline theme)", () => {
    const optMatch = termHtml.match(/const\s+TERM_OPTIONS\s*=\s*(\{[\s\S]*?\n\s*\};)/);
    assert.ok(optMatch, "Could not extract TERM_OPTIONS block");
    const block = optMatch[1];
    // Should reference TERM_THEME, not have inline color definitions
    assert.ok(block.includes("TERM_THEME"), "TERM_OPTIONS should reference TERM_THEME");
    assert.ok(!block.includes("#1a1b26"), "TERM_OPTIONS should NOT inline theme colors");
  });

  // ── Constants: no magic numbers ──────────────────────────────────────────
  test("Font size limits are named constants", () => {
    assert.ok(/const\s+MIN_FONT_SIZE\s*=\s*\d+/.test(termHtml), "Missing MIN_FONT_SIZE constant");
    assert.ok(/const\s+MAX_FONT_SIZE\s*=\s*\d+/.test(termHtml), "Missing MAX_FONT_SIZE constant");
  });

  test("Default font size is a named constant", () => {
    assert.ok(/const\s+DEFAULT_FONT_SIZE\s*=\s*\d+/.test(termHtml), "Missing DEFAULT_FONT_SIZE constant");
  });

  test("Split pane limits are named constants", () => {
    assert.ok(/const\s+MIN_SPLIT_PCT\s*=\s*\d+/.test(termHtml), "Missing MIN_SPLIT_PCT constant");
    assert.ok(/const\s+MAX_SPLIT_PCT\s*=\s*\d+/.test(termHtml), "Missing MAX_SPLIT_PCT constant");
  });

  test("App passthrough keys are a named constant", () => {
    assert.ok(/const\s+APP_PASSTHROUGH_KEYS\s*=\s*\[/.test(termHtml), "Missing APP_PASSTHROUGH_KEYS constant");
  });

  // ── _wireTerminal: deduplicated helper ───────────────────────────────────
  test("_wireTerminal helper exists (deduplicates reconnect/addTab)", () => {
    assert.ok(/function\s+_wireTerminal\s*\(/.test(termHtml), "Missing _wireTerminal function");
  });

  test("_wireTerminal is called by both _reconnect and termAddTab", () => {
    // Extract _reconnect body
    const reconnectMatch = termHtml.match(/async\s+function\s+_reconnect\s*\(\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(reconnectMatch, "Could not find _reconnect function");
    assert.ok(reconnectMatch[0].includes("_wireTerminal"), "_reconnect should call _wireTerminal");

    // Extract termAddTab body
    const addTabMatch = termHtml.match(/async\s+function\s+termAddTab\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(addTabMatch, "Could not find termAddTab function");
    assert.ok(addTabMatch[0].includes("_wireTerminal"), "termAddTab should call _wireTerminal");
  });

  test("No duplicate ResizeObserver setup outside _wireTerminal", () => {
    // ResizeObserver should be created in _wireTerminal, not in both _reconnect and termAddTab directly
    const lines = termHtml.split('\n');
    let roCount = 0;
    for (const line of lines) {
      if (line.includes("new ResizeObserver(") && !line.trim().startsWith("//")) roCount++;
    }
    assert.ok(roCount === 1, `Expected 1 ResizeObserver instantiation (in _wireTerminal), found ${roCount}`);
  });

  test("No duplicate xterm.onData wiring outside _wireTerminal", () => {
    const lines = termHtml.split('\n');
    let onDataCount = 0;
    for (const line of lines) {
      // Count xterm→PTY data wiring (xterm.onData), not _termApi.onData (PTY→xterm)
      if (line.includes("xterm.onData(") && !line.trim().startsWith("//")) onDataCount++;
    }
    assert.ok(onDataCount === 1, `Expected 1 xterm.onData wiring (in _wireTerminal), found ${onDataCount}`);
  });

  // ── _createXterm uses TERM_OPTIONS ───────────────────────────────────────
  test("_createXterm references TERM_OPTIONS (not inline config)", () => {
    const createMatch = termHtml.match(/function\s+_createXterm\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(createMatch, "Could not find _createXterm function");
    const body = createMatch[0];
    assert.ok(body.includes("TERM_OPTIONS"), "_createXterm should use TERM_OPTIONS");
    // Should not have inline scrollback or macOptionIsMeta
    assert.ok(!body.includes("scrollback:"), "_createXterm should not inline scrollback (use TERM_OPTIONS)");
    assert.ok(!body.includes("macOptionIsMeta:"), "_createXterm should not inline macOptionIsMeta (use TERM_OPTIONS)");
  });

  test("_createXterm still uses APP_PASSTHROUGH_KEYS for key handler", () => {
    const createMatch = termHtml.match(/function\s+_createXterm\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(createMatch, "Could not find _createXterm function");
    assert.ok(createMatch[0].includes("APP_PASSTHROUGH_KEYS"), "_createXterm should reference APP_PASSTHROUGH_KEYS");
  });

  // ── termZoom/termResetZoom use constants ──────────────────────────────────
  test("termZoom uses MIN_FONT_SIZE and MAX_FONT_SIZE", () => {
    const zoomMatch = termHtml.match(/function\s+termZoom\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(zoomMatch, "Could not find termZoom function");
    assert.ok(zoomMatch[0].includes("MIN_FONT_SIZE"), "termZoom should use MIN_FONT_SIZE");
    assert.ok(zoomMatch[0].includes("MAX_FONT_SIZE"), "termZoom should use MAX_FONT_SIZE");
  });

  test("termResetZoom uses DEFAULT_FONT_SIZE", () => {
    const resetMatch = termHtml.match(/function\s+termResetZoom\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(resetMatch, "Could not find termResetZoom function");
    assert.ok(resetMatch[0].includes("DEFAULT_FONT_SIZE"), "termResetZoom should use DEFAULT_FONT_SIZE");
  });

  // ── No inline theme colors in _createXterm ───────────────────────────────
  test("No hardcoded hex colors in _createXterm", () => {
    const createMatch = termHtml.match(/function\s+_createXterm\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(createMatch, "Could not find _createXterm");
    assert.ok(!createMatch[0].includes("#1a1b26"), "No inline background color in _createXterm");
    assert.ok(!createMatch[0].includes("#c0caf5"), "No inline foreground color in _createXterm");
    assert.ok(!createMatch[0].includes("#f7768e"), "No inline red color in _createXterm");
  });

  // ── _fitAll helper still exists ──────────────────────────────────────────
  test("_fitAll iterates _termTabs and calls resize", () => {
    assert.ok(/function\s+_fitAll\s*\(\)/.test(termHtml), "_fitAll should exist");
    const match = termHtml.match(/function\s+_fitAll\s*\(\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(match, "Could not extract _fitAll");
    assert.ok(match[0].includes("_termTabs"), "_fitAll should iterate _termTabs");
  });
}

(async () => {
  await runPtyTests();
  await runVsCodeParityPtyTests();
  runModularArchitectureTests();

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
