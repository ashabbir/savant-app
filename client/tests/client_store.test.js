const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SavantClientStore, newIdempotencyKey } = require("../client_store");

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

  // force invalid JSON branch in getPref()
  store.db.prepare(`
    INSERT INTO client_prefs(key, value, updated_at)
    VALUES('broken', '{bad-json}', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run();
  assert.equal(store.getPref("broken", "fallback-broken"), "fallback-broken");
});

test("enqueue mutation and expose stats", () => {
  const { store } = makeStore();
  const baseline = store.getOutboxStats();
  assert.equal(baseline.queued, 0);
  assert.equal(baseline.failed, 0);
  assert.equal(baseline.total, 0);

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

  // cover listOutbox + custom idempotency key path
  const custom = "idem-custom-1";
  const idem2 = store.enqueueMutation({
    endpoint: "/api/second",
    method: null, // cover default method branch
    idempotencyKey: custom,
    headers: null, // cover headers fallback
  });
  assert.equal(idem2, custom);
  const list = store.listOutbox(10);
  assert.equal(list.length, 2);
  assert.equal(list[1].method, "POST");
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

  // cover markQueuedWithError fallback + explicit message
  const queued = store.nextQueued();
  store.markInflight(queued.id);
  store.markQueuedWithError(queued.id);
  let row = store.listOutbox(1)[0];
  assert.equal(row.last_error, "retry");

  store.markQueuedWithError(queued.id, "net-timeout");
  row = store.listOutbox(1)[0];
  assert.equal(row.last_error, "net-timeout");

  // cover markFailed fallback message branch
  store.markInflight(queued.id);
  store.markFailed(queued.id);
  row = store.listOutbox(1)[0];
  assert.equal(row.last_error, "failed");
});

test("cleanupExpired removes old rows", () => {
  const { store } = makeStore();
  store.enqueueMutation({ endpoint: "/api/short", method: "POST", retentionDays: -1 });
  const removed = store.cleanupExpired();
  assert.ok(removed >= 1);
});

test("newIdempotencyKey returns unique non-empty ids", () => {
  const a = newIdempotencyKey();
  const b = newIdempotencyKey();
  assert.ok(typeof a === "string" && a.length > 0);
  assert.ok(typeof b === "string" && b.length > 0);
  assert.notEqual(a, b);
});

test("defensive numeric fallbacks when sqlite returns sparse values", () => {
  const { store } = makeStore();
  let mode = "stats";
  store.db = {
    prepare() {
      if (mode === "stats") {
        return { get: () => undefined };
      }
      return { run: () => ({}) };
    },
  };

  const stats = store.getOutboxStats();
  assert.deepEqual(stats, { queued: 0, failed: 0, total: 0 });

  mode = "cleanup";
  const removed = store.cleanupExpired();
  assert.equal(removed, 0);
});
