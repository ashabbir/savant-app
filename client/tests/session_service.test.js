"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LocalSessionService } = require("../session_service.js");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "savant-session-service-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test("LocalSessionService lists copilot sessions from local filesystem", () => {
  const home = makeTempDir();
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const sessionDir = path.join(home, ".copilot", "session-state", sessionId);
  writeJson(path.join(sessionDir, "workspace.json"), {
    cwd: "/tmp/my-project",
    summary: "Build API integration",
    branch: "feat/client-sessions",
    git_root: "/tmp/my-project",
    created_at: "2026-04-21T10:00:00.000Z",
    updated_at: "2026-04-21T10:05:00.000Z",
  });

  const svc = new LocalSessionService({ homeDir: home, cacheTtlMs: 1 });
  const res = svc.listSessions("copilot");
  assert.equal(res.total, 1);
  assert.equal(res.sessions[0].id, sessionId);
  assert.equal(res.sessions[0].project, "my-project");
  assert.equal(res.sessions[0].summary, "Build API integration");
});

test("LocalSessionService supports local rename/star/archive metadata updates", () => {
  const home = makeTempDir();
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const sessionDir = path.join(home, ".copilot", "session-state", sessionId);
  writeJson(path.join(sessionDir, "workspace.json"), { cwd: "/tmp/p2", summary: "S2" });

  const svc = new LocalSessionService({ homeDir: home, cacheTtlMs: 1 });
  const renamed = svc.renameSession("copilot", sessionId, "My Renamed Session");
  assert.equal(renamed.nickname, "My Renamed Session");

  const starred = svc.setStar("copilot", sessionId, true);
  assert.equal(starred.starred, true);

  const archived = svc.setArchive("copilot", sessionId, true);
  assert.equal(archived.archived, true);

  const refreshed = svc.getSession("copilot", sessionId);
  assert.equal(refreshed.nickname, "My Renamed Session");
  assert.equal(refreshed.starred, true);
  assert.equal(refreshed.archived, true);
});

test("LocalSessionService delete removes local session path", () => {
  const home = makeTempDir();
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const sessionDir = path.join(home, ".copilot", "session-state", sessionId);
  writeJson(path.join(sessionDir, "workspace.json"), { cwd: "/tmp/p3", summary: "S3" });

  const svc = new LocalSessionService({ homeDir: home, cacheTtlMs: 1 });
  const before = svc.listSessions("copilot");
  assert.equal(before.total, 1);

  const deleted = svc.deleteSession("copilot", sessionId);
  assert.equal(deleted.ok, true);
  assert.equal(fs.existsSync(sessionDir), false);

  const after = svc.listSessions("copilot");
  assert.equal(after.total, 0);
});
