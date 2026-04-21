const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function newIdempotencyKey() {
  return crypto.randomUUID();
}

class SavantClientStore {
  constructor(dbPath) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this._init();
  }

  _init() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS client_prefs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        op_type TEXT NOT NULL,
        method TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        headers_json TEXT NOT NULL,
        payload_text TEXT,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_id ON sync_outbox(status, id);
      CREATE INDEX IF NOT EXISTS idx_sync_outbox_expires ON sync_outbox(expires_at);
    `);
  }

  getPref(key, fallback = null) {
    const row = this.db.prepare("SELECT value FROM client_prefs WHERE key = ?").get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  }

  setPref(key, value) {
    const ts = nowIso();
    this.db.prepare(`
      INSERT INTO client_prefs(key, value, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), ts);
  }

  enqueueMutation({
    opType = "api_mutation",
    method = "POST",
    endpoint,
    headers = {},
    payloadText = null,
    idempotencyKey = null,
    retentionDays = 7,
  }) {
    const ts = nowIso();
    const exp = addDaysIso(ts, retentionDays);
    const idem = idempotencyKey || newIdempotencyKey();
    const m = (method || "POST").toUpperCase();
    this.db.prepare(`
      INSERT INTO sync_outbox(
        op_type, method, endpoint, headers_json, payload_text, idempotency_key,
        status, retry_count, created_at, updated_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
    `).run(
      opType,
      m,
      endpoint,
      JSON.stringify(headers || {}),
      payloadText,
      idem,
      ts,
      ts,
      exp
    );
    return idem;
  }

  getOutboxStats() {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        COUNT(*) AS total
      FROM sync_outbox
    `).get();
    return {
      queued: Number(row?.queued || 0),
      failed: Number(row?.failed || 0),
      total: Number(row?.total || 0),
    };
  }

  listOutbox(limit = 100) {
    return this.db.prepare(`
      SELECT id, op_type, method, endpoint, idempotency_key, status, retry_count,
             last_error, created_at, updated_at, expires_at
      FROM sync_outbox
      ORDER BY id ASC
      LIMIT ?
    `).all(limit);
  }

  nextQueued() {
    return this.db.prepare(`
      SELECT id, op_type, method, endpoint, headers_json, payload_text,
             idempotency_key, retry_count, created_at, expires_at
      FROM sync_outbox
      WHERE status = 'queued'
      ORDER BY id ASC
      LIMIT 1
    `).get();
  }

  markInflight(id) {
    this.db.prepare(`
      UPDATE sync_outbox
      SET status = 'inflight', updated_at = ?
      WHERE id = ?
    `).run(nowIso(), id);
  }

  markDone(id) {
    this.db.prepare("DELETE FROM sync_outbox WHERE id = ?").run(id);
  }

  markQueuedWithError(id, errMsg) {
    this.db.prepare(`
      UPDATE sync_outbox
      SET status = 'queued',
          retry_count = retry_count + 1,
          last_error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(String(errMsg || "retry"), nowIso(), id);
  }

  markFailed(id, errMsg) {
    this.db.prepare(`
      UPDATE sync_outbox
      SET status = 'failed',
          retry_count = retry_count + 1,
          last_error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(String(errMsg || "failed"), nowIso(), id);
  }

  requeueFailed(id) {
    this.db.prepare(`
      UPDATE sync_outbox
      SET status = 'queued', updated_at = ?
      WHERE id = ?
    `).run(nowIso(), id);
  }

  cleanupExpired() {
    const ts = nowIso();
    const result = this.db.prepare("DELETE FROM sync_outbox WHERE expires_at < ?").run(ts);
    return Number(result.changes || 0);
  }
}

module.exports = { SavantClientStore, newIdempotencyKey };
