/**
 * Server/client integration contract checks for split architecture.
 * Run with: node tests_js/test_terminal_integration.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const CLIENT = path.join(ROOT, "client");
const SERVER = path.join(ROOT, "server");

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

console.log("\n🔗 Split Contract Validation");

test("client/main.js exists", () => {
  assert.ok(fs.existsSync(path.join(CLIENT, "main.js")));
});

test("client/preload.js exists", () => {
  assert.ok(fs.existsSync(path.join(CLIENT, "preload.js")));
});

test("server/app.py exists", () => {
  assert.ok(fs.existsSync(path.join(SERVER, "app.py")));
});

test("client has no embedded server directory", () => {
  assert.ok(!fs.existsSync(path.join(CLIENT, "savant")));
});

test("client renderer static xterm assets exist", () => {
  assert.ok(fs.existsSync(path.join(CLIENT, "renderer", "static", "xterm.css")));
  assert.ok(fs.existsSync(path.join(CLIENT, "renderer", "static", "xterm.mjs")));
  assert.ok(fs.existsSync(path.join(CLIENT, "renderer", "static", "xterm-addon-fit.mjs")));
  assert.ok(fs.existsSync(path.join(CLIENT, "renderer", "static", "xterm-addon-web-links.mjs")));
});

test("client terminal uses local renderer xterm modules", () => {
  const html = fs.readFileSync(path.join(CLIENT, "terminal.html"), "utf-8");
  assert.ok(html.includes("import('./renderer/static/xterm.mjs')"));
  assert.ok(html.includes("import('./renderer/static/xterm-addon-fit.mjs')"));
});

test("client terminal exposes a visible help button and popup wiring", () => {
  const html = fs.readFileSync(path.join(CLIENT, "terminal.html"), "utf-8");
  assert.ok(html.includes('id="btn-help"'));
  assert.ok(html.includes('onclick="toggleHelp()"'));
  assert.ok(html.includes('aria-label="Terminal shortcuts"'));
  assert.ok(html.includes('id="term-help-popup"'));
  assert.ok(!html.includes('term-header-actions" style="display:none"'));
});

test("client terminal captures '?' key and opens shortcuts popup", () => {
  const html = fs.readFileSync(path.join(CLIENT, "terminal.html"), "utf-8");
  assert.ok(
    html.includes("if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) { toggleHelp(); return false; }")
  );
});

test("client terminal never closes tabs/panes via keyboard shortcuts", () => {
  const html = fs.readFileSync(path.join(CLIENT, "terminal.html"), "utf-8");
  assert.ok(
    html.includes("if (!e.shiftKey && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); return; }")
  );
  assert.ok(
    !html.includes("if (parentResult && parentResult.parent.direction === direction) {")
  );
  assert.ok(
    html.includes("await _splitFocusedPane(direction);")
  );
});

test("client terminal no longer binds Cmd/Ctrl+Shift+E", () => {
  const html = fs.readFileSync(path.join(CLIENT, "terminal.html"), "utf-8");
  assert.ok(!html.includes("if (e.shiftKey && e.key === 'E') { e.preventDefault(); termToggleExpand(); return; }"));
  assert.ok(!html.includes("'0', 'E']"));
});

test("client terminal binds remaining non-zoom shortcuts", () => {
  const html = fs.readFileSync(path.join(CLIENT, "terminal.html"), "utf-8");
  const requiredSnippets = [
    "if (!mod && e.key === '?' && !e.altKey) { e.preventDefault(); toggleHelp(); return; }",
    "if (e.key === '`') { e.preventDefault(); termHide(); return; }",
    "if (!e.shiftKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); termAddTab(); return; }",
    "if (!e.shiftKey && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); return; }",
    "if (!e.shiftKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); termToggleSplit('h'); return; }",
    "if (e.shiftKey && (e.key === 'd' || e.key === 'D'))  { e.preventDefault(); termToggleSplit('v'); return; }",
    "if (e.shiftKey && e.key === '[') { e.preventDefault(); _cycleTabs(-1); return; }",
    "if (e.shiftKey && e.key === ']') { e.preventDefault(); _cycleTabs(1); return; }",
    "if (e.shiftKey && e.key === 'ArrowLeft')  { e.preventDefault(); _navigateLeaf('ArrowLeft'); return; }",
    "if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); _navigateLeaf('ArrowRight'); return; }",
    "if (e.shiftKey && e.key === 'ArrowUp')    { e.preventDefault(); _navigateLeaf('ArrowUp'); return; }",
    "if (e.shiftKey && e.key === 'ArrowDown')  { e.preventDefault(); _navigateLeaf('ArrowDown'); return; }",
    "if (!e.shiftKey && e.key === 'k') { xterm.clear(); return false; }",
    "if (e.key === 'c' && xterm.hasSelection()) { document.execCommand('copy'); return false; }",
  ];

  for (const snippet of requiredSnippets) {
    assert.ok(html.includes(snippet), `Missing shortcut binding snippet: ${snippet}`);
  }
});

test("client main retains server base injection for API bridge", () => {
  const main = fs.readFileSync(path.join(CLIENT, "main.js"), "utf-8");
  assert.ok(main.includes("window.__SAVANT_SERVER_URL__"));
  assert.ok(main.includes("serverBaseUrl"));
});

test("client preload exposes savantClient bridge", () => {
  const preload = fs.readFileSync(path.join(CLIENT, "preload.js"), "utf-8");
  assert.ok(preload.includes("contextBridge.exposeInMainWorld(\"savantClient\""));
  assert.ok(preload.includes("getServerConfig"));
  assert.ok(preload.includes("listLocalSessions"));
  assert.ok(preload.includes("getLocalSession"));
  assert.ok(preload.includes("renameLocalSession"));
  assert.ok(preload.includes("setLocalSessionStar"));
  assert.ok(preload.includes("setLocalSessionArchive"));
  assert.ok(preload.includes("deleteLocalSession"));
  assert.ok(preload.includes("onSessionsUpdated"));
  assert.ok(preload.includes("enqueueMutation"));
  assert.ok(preload.includes("flushQueueNow"));
});

test("client index renderer includes client sync script", () => {
  const index = fs.readFileSync(path.join(CLIENT, "renderer", "index.html"), "utf-8");
  assert.ok(index.includes("./static/js/client-sync.js"));
});

test("client detail renderer includes client sync script", () => {
  const detail = fs.readFileSync(path.join(CLIENT, "renderer", "detail.html"), "utf-8");
  assert.ok(detail.includes("./static/js/client-sync.js"));
});

test("client package has no extraResources server embedding", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(CLIENT, "package.json"), "utf-8"));
  assert.ok(!pkg.build.extraResources, "extraResources must be removed for independent client/server");
});

test("client no longer exposes open-in-browser surface", () => {
  const index = fs.readFileSync(path.join(CLIENT, "renderer", "index.html"), "utf-8");
  const main = fs.readFileSync(path.join(CLIENT, "main.js"), "utf-8");
  assert.ok(!index.includes("left-tab-browser"), "left action bar should not expose browser button");
  assert.ok(!main.includes("Open in Browser"), "menu/tray should not expose browser action");
});

console.log("\n────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
