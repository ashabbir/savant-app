const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SavantClientStore } = require("../client_store");

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "savant-client-store-"));
  const dbPath = path.join(dir, "client.db");
  const store = new SavantClientStore(dbPath);
  return { dir, dbPath, store };
}

test("prefs roundtrip", () => {
  const { store } = makeStore();
  store.setPref("server_url", "https://example.internal");
  assert.equal(store.getPref("server_url"), "https://example.internal");
  assert.equal(store.getPref("missing", "fallback"), "fallback");
});

test("enqueue mutation and expose stats", () => {
  const { store } = makeStore();
  const idem = store.enqueueMutation({
    opType: "preferences_save",
    method: "POST",
    endpoint: "/api/preferences",
    headers: { "Content-Type": "application/json" },
    payloadText: '{"theme":"dark"}',
  });
  assert.ok(idem);
  const stats = store.getOutboxStats();
  assert.equal(stats.queued, 1);
  assert.equal(stats.failed, 0);
});

test("fifo order from nextQueued", () => {
  const { store } = makeStore();
  store.enqueueMutation({ endpoint: "/api/a", method: "POST" });
  store.enqueueMutation({ endpoint: "/api/b", method: "POST" });
  const first = store.nextQueued();
  assert.equal(first.endpoint, "/api/a");
  store.markInflight(first.id);
  store.markDone(first.id);
  const second = store.nextQueued();
  assert.equal(second.endpoint, "/api/b");
});

test("failed item can be requeued", () => {
  const { store } = makeStore();
  store.enqueueMutation({ endpoint: "/api/fail", method: "POST" });
  const item = store.nextQueued();
  store.markInflight(item.id);
  store.markFailed(item.id, "bad request");
  let stats = store.getOutboxStats();
  assert.equal(stats.failed, 1);
  store.requeueFailed(item.id);
  stats = store.getOutboxStats();
  assert.equal(stats.queued, 1);
  assert.equal(stats.failed, 0);
});

test("cleanupExpired removes old rows", () => {
  const { store } = makeStore();
  store.enqueueMutation({ endpoint: "/api/short", method: "POST", retentionDays: -1 });
  const removed = store.cleanupExpired();
  assert.ok(removed >= 1);
});
