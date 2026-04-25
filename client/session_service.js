"use strict";

const fs = require("fs");
const path = require("path");

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function safeWriteJson(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function toIso(value, fallback = "") {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  return fallback;
}

function inferStatus(updatedAt) {
  if (!updatedAt) return "IDLE";
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return "IDLE";
  return (Date.now() - ts) < 10 * 60 * 1000 ? "RUNNING" : "IDLE";
}

function projectName(projectPath) {
  if (!projectPath) return "";
  return path.basename(String(projectPath).replace(/[\\\/]+$/, ""));
}

function normalizeRecord(provider, record = {}) {
  const updatedAt = record.updated_at || record.updatedAt || record.created_at || "";
  const createdAt = record.created_at || record.createdAt || updatedAt || new Date().toISOString();
  return {
    id: record.id || "",
    provider,
    summary: record.summary || "",
    nickname: record.nickname || "",
    project: record.project || "",
    cwd: record.cwd || "",
    git_root: record.git_root || "",
    branch: record.branch || "",
    created_at: toIso(createdAt, ""),
    updated_at: toIso(updatedAt, toIso(createdAt, "")),
    status: record.status || inferStatus(updatedAt),
    is_open: Boolean(record.is_open),
    starred: Boolean(record.starred),
    archived: Boolean(record.archived),
    workspace: record.workspace || null,
    notes: Array.isArray(record.notes) ? record.notes : [],
    mrs: Array.isArray(record.mrs) ? record.mrs : [],
    user_messages: Array.isArray(record.user_messages) ? record.user_messages : [],
    tools_used: Array.isArray(record.tools_used) ? record.tools_used : [],
    model_call_counts: record.model_call_counts || {},
    tool_call_counts: record.tool_call_counts || {},
    models: Array.isArray(record.models) ? record.models : [],
    active_tools: Array.isArray(record.active_tools) ? record.active_tools : [],
    event_count: Number(record.event_count || 0),
    message_count: Number(record.message_count || 0),
    turn_count: Number(record.turn_count || 0),
    checkpoint_count: Number(record.checkpoint_count || 0),
    file_count: Number(record.file_count || 0),
    research_count: Number(record.research_count || 0),
    disk_size: Number(record.disk_size || 0),
    last_event_type: record.last_event_type || "",
    last_event_time: record.last_event_time || "",
    first_event_time: record.first_event_time || "",
    last_intent: record.last_intent || "",
    resume_command: record.resume_command || "",
    session_path: record.session_path || "",
    tree: record.tree || undefined,
  };
}

class LocalSessionService {
  constructor(opts = {}) {
    this.homeDir = opts.homeDir || "";
    this.onSessionsChanged = typeof opts.onSessionsChanged === "function" ? opts.onSessionsChanged : () => {};
    this.cacheTtlMs = Number(opts.cacheTtlMs || 5000);
    this.cache = new Map();
    this.watchers = [];
  }

  providerRoot(provider) {
    if (provider === "copilot") return process.env.SESSION_DIR || path.join(this.homeDir, ".copilot", "session-state");
    if (provider === "claude") return process.env.CLAUDE_DIR || path.join(this.homeDir, ".claude");
    if (provider === "codex") return process.env.CODEX_DIR || path.join(this.homeDir, ".codex");
    if (provider === "gemini") return process.env.GEMINI_DIR || path.join(this.homeDir, ".gemini");
    if (provider === "hermes") return process.env.HERMES_DIR || path.join(this.homeDir, ".hermes");
    return "";
  }

  metadataPath(provider, session) {
    if (!session || !session.id) return "";
    if (provider === "copilot" && session.session_path) return path.join(session.session_path, ".copilot-meta.json");
    return path.join(this.providerRoot(provider), ".savant-meta", `${session.id}.json`);
  }

  readMeta(provider, session) {
    const p = this.metadataPath(provider, session);
    return p ? (safeReadJson(p) || {}) : {};
  }

  writeMeta(provider, session, patch = {}) {
    const current = this.readMeta(provider, session);
    const next = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    const p = this.metadataPath(provider, session);
    if (!p) return false;
    return safeWriteJson(p, next);
  }

  _collectCopilot() {
    const root = this.providerRoot("copilot");
    if (!root || !fs.existsSync(root)) return [];
    const out = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isUuid(entry.name)) continue;
      const sessionPath = path.join(root, entry.name);
      const st = safeStat(sessionPath);
      const ws = safeReadJson(path.join(sessionPath, "workspace.json")) || {};
      const meta = safeReadJson(path.join(sessionPath, ".copilot-meta.json")) || {};
      const cwd = ws.cwd || "";
      const created = ws.created_at || (st ? st.birthtime.toISOString() : "");
      const updated = ws.updated_at || (st ? st.mtime.toISOString() : created);
      out.push(normalizeRecord("copilot", {
        id: entry.name,
        summary: ws.summary || "",
        nickname: meta.nickname || "",
        project: projectName(cwd),
        cwd,
        git_root: ws.git_root || "",
        branch: ws.branch || "",
        created_at: created,
        updated_at: updated,
        status: inferStatus(updated),
        starred: meta.starred,
        archived: meta.archived,
        workspace: meta.workspace || null,
        notes: meta.notes || [],
        session_path: sessionPath,
        resume_command: `cd ${cwd || "~"} && copilot --allow-all-tools --resume ${entry.name}`,
      }));
    }
    return out;
  }

  _collectClaude() {
    const projectsDir = path.join(this.providerRoot("claude"), "projects");
    if (!fs.existsSync(projectsDir)) return [];
    const out = [];
    for (const dirent of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const projectDir = path.join(projectsDir, dirent.name);
      const index = safeReadJson(path.join(projectDir, "sessions-index.json"));
      if (!Array.isArray(index)) continue;
      for (const row of index) {
        const id = row && row.sessionId ? String(row.sessionId) : "";
        if (!id) continue;
        const projectPath = row.projectPath || "";
        const updated = row.modified || row.created || "";
        out.push(normalizeRecord("claude", {
          id,
          summary: row.summary || row.firstPrompt || "",
          project: projectName(projectPath),
          cwd: projectPath,
          branch: row.gitBranch || "",
          created_at: row.created || updated,
          updated_at: updated,
          status: inferStatus(updated),
          message_count: Number(row.messageCount || 0),
          session_path: projectDir,
          resume_command: `cd ${projectPath || "~"} && claude --resume ${id}`,
        }));
      }
    }
    return out;
  }

  _collectCodex() {
    const sessionsRoot = path.join(this.providerRoot("codex"), "sessions");
    if (!fs.existsSync(sessionsRoot)) return [];
    const out = [];
    const stack = [sessionsRoot];
    while (stack.length) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const idMatch = full.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
        const id = idMatch ? idMatch[0] : path.basename(entry.name, ".jsonl");
        const st = safeStat(full);
        const updated = st ? st.mtime.toISOString() : "";
        out.push(normalizeRecord("codex", {
          id,
          summary: `Codex Session ${String(id).slice(0, 8)}`,
          created_at: st ? st.birthtime.toISOString() : updated,
          updated_at: updated,
          status: inferStatus(updated),
          session_path: full,
          resume_command: `codex resume ${id}`,
        }));
      }
    }
    return out;
  }

  _collectGemini() {
    const chatsRoot = path.join(this.providerRoot("gemini"), "tmp", "savant-app", "chats");
    if (!fs.existsSync(chatsRoot)) return [];
    const out = [];
    for (const entry of fs.readdirSync(chatsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const full = path.join(chatsRoot, entry.name);
      const raw = safeReadJson(full) || {};
      const id = path.basename(entry.name, ".json");
      const start = raw.startTime || "";
      const updated = raw.lastUpdated || start;
      let summary = raw.summary || "";
      const messages = Array.isArray(raw.messages) ? raw.messages : [];
      if (!summary) {
        const firstUser = messages.find(m => m && m.type === "user" && typeof m.content === "string" && m.content.trim());
        summary = firstUser ? firstUser.content.trim().split("\n")[0].slice(0, 140) : "";
      }
      out.push(normalizeRecord("gemini", {
        id,
        summary,
        created_at: start,
        updated_at: updated,
        status: inferStatus(updated),
        message_count: messages.length,
        turn_count: messages.filter(m => m && m.type === "user").length,
        session_path: full,
        resume_command: `gemini --resume ${id}`,
      }));
    }
    return out;
  }

  _collectHermes() {
    const sessionsRoot = path.join(this.providerRoot("hermes"), "sessions");
    if (!fs.existsSync(sessionsRoot)) return [];
    const out = [];
    for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const full = path.join(sessionsRoot, entry.name);
      const raw = safeReadJson(full) || {};
      const id = raw.session_id || path.basename(entry.name, ".json");
      const messages = Array.isArray(raw.messages) ? raw.messages : [];
      const firstUser = messages.find(m => m && m.role === "user" && typeof m.content === "string" && m.content.trim());
      const summary = firstUser ? firstUser.content.trim().split("\n")[0].slice(0, 140) : "";
      const created = raw.session_start || "";
      const updated = raw.last_updated || created;
      const projectPath = raw.project_path || "";
      out.push(normalizeRecord("hermes", {
        id,
        summary,
        project: projectName(projectPath),
        cwd: projectPath,
        created_at: created,
        updated_at: updated,
        status: inferStatus(updated),
        message_count: messages.length,
        turn_count: messages.filter(m => m && m.role === "user").length,
        session_path: full,
        resume_command: `cd ${projectPath || "~"} && hermes --resume ${id}`,
      }));
    }
    return out;
  }

  _providerName(input) {
    return ["claude", "codex", "gemini", "hermes"].includes(input) ? input : "copilot";
  }

  _collect(provider) {
    if (provider === "claude") return this._collectClaude();
    if (provider === "codex") return this._collectCodex();
    if (provider === "gemini") return this._collectGemini();
    if (provider === "hermes") return this._collectHermes();
    return this._collectCopilot();
  }

  _withMeta(provider, sessions) {
    return sessions.map((session) => {
      const meta = this.readMeta(provider, session);
      return {
        ...session,
        nickname: meta.nickname || session.nickname || "",
        starred: Boolean(meta.starred || session.starred),
        archived: Boolean(meta.archived || session.archived),
        workspace: meta.workspace || session.workspace || null,
      };
    });
  }

  _getAll(provider, forceRefresh = false) {
    const p = this._providerName(provider);
    const now = Date.now();
    const cached = this.cache.get(p);
    if (!forceRefresh && cached && now - cached.ts < this.cacheTtlMs) return cached.sessions;
    const rows = this._withMeta(p, this._collect(p)).sort((a, b) => {
      const aTime = a.updated_at || a.created_at || "";
      const bTime = b.updated_at || b.created_at || "";
      return bTime.localeCompare(aTime);
    });
    this.cache.set(p, { ts: now, sessions: rows });
    return rows;
  }

  listSessions(provider, opts = {}) {
    const rows = this._getAll(provider);
    const limit = Math.max(0, Number(opts.limit || 0));
    const offset = Math.max(0, Number(opts.offset || 0));
    const page = limit > 0 ? rows.slice(offset, offset + limit) : rows;
    return {
      sessions: page,
      total: rows.length,
      has_more: limit > 0 ? (offset + limit) < rows.length : false,
    };
  }

  _tree(sessionPath) {
    const empty = { plan: null, checkpoints: [], rewind_snapshots: [], files: [], research: [] };
    const st = safeStat(sessionPath);
    if (!st || !st.isDirectory()) return empty;
    const stack = [sessionPath];
    const files = [];
    while (stack.length && files.length < 600) {
      const dir = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          stack.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const fStat = safeStat(full);
        if (!fStat) continue;
        const rel = path.relative(sessionPath, full).split(path.sep).join("/");
        files.push({ name: entry.name, path: rel, size: Number(fStat.size || 0) });
        if (files.length >= 600) break;
      }
    }
    const tree = { plan: null, checkpoints: [], rewind_snapshots: [], files: [], research: [] };
    for (const f of files) {
      const lower = f.path.toLowerCase();
      if (lower === "plan.md" && !tree.plan) tree.plan = f;
      else if (lower.includes("checkpoint")) tree.checkpoints.push(f);
      else if (lower.includes("research") || lower.includes("analysis")) tree.research.push(f);
      else tree.files.push(f);
    }
    return tree;
  }

  getSession(provider, sessionId) {
    const p = this._providerName(provider);
    const found = this._getAll(p).find((s) => s.id === sessionId);
    if (!found) return null;
    return { ...found, tree: this._tree(found.session_path) };
  }

  renameSession(provider, sessionId, nickname) {
    const p = this._providerName(provider);
    const s = this._getAll(p).find((row) => row.id === sessionId);
    if (!s) return null;
    this.writeMeta(p, s, { nickname: String(nickname || "") });
    this.invalidate(p);
    return this.getSession(p, sessionId);
  }

  setStar(provider, sessionId, starred) {
    const p = this._providerName(provider);
    const s = this._getAll(p).find((row) => row.id === sessionId);
    if (!s) return null;
    this.writeMeta(p, s, { starred: Boolean(starred) });
    this.invalidate(p);
    return this.getSession(p, sessionId);
  }

  setArchive(provider, sessionId, archived) {
    const p = this._providerName(provider);
    const s = this._getAll(p).find((row) => row.id === sessionId);
    if (!s) return null;
    this.writeMeta(p, s, { archived: Boolean(archived) });
    this.invalidate(p);
    return this.getSession(p, sessionId);
  }

  deleteSession(provider, sessionId) {
    const p = this._providerName(provider);
    const s = this._getAll(p).find((row) => row.id === sessionId);
    if (!s) return { ok: false, error: "Session not found" };
    try {
      const st = safeStat(s.session_path);
      if (st && st.isDirectory()) fs.rmSync(s.session_path, { recursive: true, force: true });
      else if (st) fs.rmSync(s.session_path, { force: true });
      this.invalidate(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : "delete_failed" };
    }
  }

  invalidate(provider) {
    const p = this._providerName(provider);
    this.cache.delete(p);
    this.onSessionsChanged({ provider: p, ts: Date.now() });
  }

  startWatching() {
    this.stopWatching();
    const watchRoots = {
      copilot: this.providerRoot("copilot"),
      claude: path.join(this.providerRoot("claude"), "projects"),
      codex: path.join(this.providerRoot("codex"), "sessions"),
      gemini: path.join(this.providerRoot("gemini"), "tmp", "savant-app", "chats"),
      hermes: path.join(this.providerRoot("hermes"), "sessions"),
    };
    for (const [provider, root] of Object.entries(watchRoots)) {
      if (!root || !fs.existsSync(root)) continue;
      try {
        const watcher = fs.watch(root, { recursive: true }, () => {
          this.invalidate(provider);
        });
        this.watchers.push(watcher);
      } catch {}
    }
  }

  stopWatching() {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {}
    }
    this.watchers = [];
  }
}

module.exports = {
  LocalSessionService,
};

