"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const CLIENT = path.join(ROOT, "client");

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

console.log("\n🧩 Local Session Bridge Validation");

test("session service module exists", () => {
  assert.ok(fs.existsSync(path.join(CLIENT, "session_service.js")));
});

test("packaging config includes session_service module", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(CLIENT, "package.json"), "utf-8"));
  const files = (pkg.build && pkg.build.files) || [];
  assert.ok(files.includes("session_service.js"));
});

test("main process wires local session IPC handlers", () => {
  const main = fs.readFileSync(path.join(CLIENT, "main.js"), "utf-8");
  assert.ok(main.includes("savant:list-local-sessions"));
  assert.ok(main.includes("savant:get-local-session"));
  assert.ok(main.includes("savant:rename-local-session"));
  assert.ok(main.includes("savant:set-local-session-star"));
  assert.ok(main.includes("savant:set-local-session-archive"));
  assert.ok(main.includes("savant:delete-local-session"));
});

test("preload exposes local session bridge and update subscription", () => {
  const preload = fs.readFileSync(path.join(CLIENT, "preload.js"), "utf-8");
  assert.ok(preload.includes("listLocalSessions"));
  assert.ok(preload.includes("getLocalSession"));
  assert.ok(preload.includes("renameLocalSession"));
  assert.ok(preload.includes("setLocalSessionStar"));
  assert.ok(preload.includes("setLocalSessionArchive"));
  assert.ok(preload.includes("deleteLocalSession"));
  assert.ok(preload.includes("onSessionsUpdated"));
});

test("sessions tab consumes local session bridge first", () => {
  const sessions = fs.readFileSync(path.join(CLIENT, "renderer", "static", "js", "sessions.js"), "utf-8");
  assert.ok(sessions.includes("window.savantClient.listLocalSessions"));
  assert.ok(sessions.includes("window.savantClient.getLocalSession"));
  assert.ok(sessions.includes("window.savantClient.onSessionsUpdated"));
});

console.log("\n────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
