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

test("client main retains server base injection for API bridge", () => {
  const main = fs.readFileSync(path.join(CLIENT, "main.js"), "utf-8");
  assert.ok(main.includes("window.__SAVANT_SERVER_URL__"));
  assert.ok(main.includes("serverBaseUrl"));
});

test("client preload exposes savantClient bridge", () => {
  const preload = fs.readFileSync(path.join(CLIENT, "preload.js"), "utf-8");
  assert.ok(preload.includes("contextBridge.exposeInMainWorld(\"savantClient\""));
  assert.ok(preload.includes("getServerConfig"));
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

console.log("\n────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
