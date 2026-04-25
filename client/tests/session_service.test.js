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

test("LocalSessionService keeps workspace hint in local metadata", () => {
  const home = makeTempDir();
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const sessionDir = path.join(home, ".copilot", "session-state", sessionId);
  writeJson(path.join(sessionDir, "workspace.json"), { cwd: "/tmp/p4", summary: "S4" });

  const svc = new LocalSessionService({ homeDir: home, cacheTtlMs: 1 });
  const session = svc.getSession("copilot", sessionId);
  assert.ok(session);

  const wrote = svc.writeMeta("copilot", session, { workspace: "ws-local-hint" });
  assert.equal(wrote, true);

  const meta = svc.readMeta("copilot", session);
  assert.equal(meta.workspace, "ws-local-hint");
});

test("LocalSessionService resolves provider roots and missing sessions across providers", () => {
  const home = makeTempDir();
  const svc = new LocalSessionService({ homeDir: home, cacheTtlMs: 1 });

  assert.equal(svc.providerRoot("claude"), path.join(home, ".claude"));
  assert.equal(svc.providerRoot("codex"), path.join(home, ".codex"));
  assert.equal(svc.providerRoot("gemini"), path.join(home, ".gemini"));
  assert.equal(svc.providerRoot("hermes"), path.join(home, ".hermes"));
  assert.equal(svc.providerRoot("unknown"), "");
  assert.equal(svc._providerName("claude"), "claude");
  assert.equal(svc._providerName("unknown"), "copilot");
  assert.equal(svc.getSession("copilot", "missing"), null);
  assert.equal(svc.deleteSession("copilot", "missing").ok, false);
});

test("LocalSessionService collects claude, codex, gemini, and hermes sessions and builds trees", () => {
  const home = makeTempDir();

  const claudeProject = path.join(home, ".claude", "projects", "demo");
  writeJson(path.join(claudeProject, "sessions-index.json"), [
    {
      sessionId: "55555555-5555-4555-8555-555555555555",
      projectPath: "/tmp/claude-project",
      summary: "Claude summary",
      created: "2026-04-21T10:00:00.000Z",
      modified: "2026-04-21T10:05:00.000Z",
      messageCount: 7,
    },
  ]);

  const codexFile = path.join(home, ".codex", "sessions", "aa", "66666666-6666-4666-8666-666666666666.jsonl");
  fs.mkdirSync(path.dirname(codexFile), { recursive: true });
  fs.writeFileSync(codexFile, '{"x":1}\n', "utf8");

  const geminiFile = path.join(home, ".gemini", "tmp", "savant-app", "chats", "chat-1.json");
  writeJson(geminiFile, {
    startTime: "2026-04-21T11:00:00.000Z",
    lastUpdated: "2026-04-21T11:05:00.000Z",
    messages: [
      { type: "user", content: "Gemini hello" },
      { type: "model", content: "hi" },
    ],
  });

  const hermesFile = path.join(home, ".hermes", "sessions", "hermes-1.json");
  writeJson(hermesFile, {
    session_id: "77777777-7777-4777-8777-777777777777",
    session_start: "2026-04-21T12:00:00.000Z",
    last_updated: "2026-04-21T12:05:00.000Z",
    project_path: "/tmp/hermes-project",
    messages: [
      { role: "user", content: "Hermes hello" },
      { role: "assistant", content: "hi" },
    ],
  });

  const svc = new LocalSessionService({ homeDir: home, cacheTtlMs: 1 });

  const claude = svc.listSessions("claude");
  assert.equal(claude.total, 1);
  assert.equal(claude.sessions[0].id, "55555555-5555-4555-8555-555555555555");
  assert.equal(claude.sessions[0].project, "claude-project");

  const codex = svc.listSessions("codex");
  assert.equal(codex.total, 1);
  assert.equal(codex.sessions[0].id, "66666666-6666-4666-8666-666666666666");

  const gemini = svc.listSessions("gemini");
  assert.equal(gemini.total, 1);
  assert.equal(gemini.sessions[0].summary, "Gemini hello");
  assert.equal(gemini.sessions[0].message_count, 2);
  assert.equal(gemini.sessions[0].turn_count, 1);

  const hermes = svc.listSessions("hermes");
  assert.equal(hermes.total, 1);
  assert.equal(hermes.sessions[0].id, "77777777-7777-4777-8777-777777777777");
  assert.equal(hermes.sessions[0].project, "hermes-project");

  const tree = svc._tree(path.dirname(codexFile));
  assert.equal(Array.isArray(tree.files), true);
  assert.equal(tree.files.length > 0, true);
});
