"use strict";

const http = require("http");

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function _defaultState() {
  return {
    repos: [],
    sessions: [],
    workspaces: [],
    tasks: [],
    notifications: [],
    mcpServers: [
      { name: "workspace", type: "sse", command: "python", args: [], tools: [] },
      { name: "abilities", type: "sse", command: "python", args: [], tools: [] },
      { name: "context", type: "sse", command: "python", args: [], tools: [] },
      { name: "knowledge", type: "sse", command: "python", args: [], tools: [] },
    ],
    preferences: {
      name: "",
      enabled_providers: ["hermes", "copilot", "claude", "codex", "gemini"],
      theme: "dark",
    },
    contextHealth: {
      sqlite_vec: { loaded: true, version: "ok" },
      model: { downloaded: true, loaded: true },
      counts: { repos: 0, files: 0, chunks: 0 },
    },
    contextStats: { counts: { repos: 0, files: 0, chunks: 0 } },
  };
}

function createMockApiServer(override = {}) {
  const state = Object.assign(_defaultState(), override || {});
  if (state.contextHealth && state.contextHealth.counts) {
    state.contextHealth.counts.repos = state.repos.length;
  }
  if (state.contextStats && state.contextStats.counts) {
    state.contextStats.counts.repos = state.repos.length;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const p = url.pathname;
    const method = req.method || "GET";

    if (p === "/api/db/health") return json(res, 200, { status: "healthy", connected: true, engine: "sqlite" });
    if (p === "/health/live") return json(res, 200, { status: "ok" });
    if (p === "/health/ready") return json(res, 200, { status: "ready" });

    if (p === "/api/mcp") return json(res, 200, { servers: state.mcpServers });
    if (p === "/api/mcp/health") return json(res, 200, { workspace: true, abilities: true, context: true, knowledge: true });
    if (p.startsWith("/api/mcp/health/")) return json(res, 200, { status: "ok" });

    if (p === "/api/context/health") return json(res, 200, state.contextHealth);
    if (p === "/api/context/stats") return json(res, 200, state.contextStats);
    if (p === "/api/context/repos" && method === "GET") return json(res, 200, { repos: state.repos });
    if (p === "/api/context/repos/index" && method === "POST") return json(res, 200, { ok: true, started: true });
    if (p === "/api/context/repos/ast/generate" && method === "POST") return json(res, 200, { ok: true, started: true });
    if (p === "/api/context/repos/stop" && method === "POST") return json(res, 200, { ok: true, stopping: true });
    if (p === "/api/context/repos/purge" && method === "POST") return json(res, 200, { ok: true });
    if (p === "/api/context/repos/delete" && method === "POST") return json(res, 200, { ok: true });
    if (p === "/api/context/search") return json(res, 200, { results: [] });
    if (p === "/api/context/memory/list") return json(res, 200, { items: [] });
    if (p === "/api/context/code/list") return json(res, 200, { items: [] });
    if (p === "/api/context/ast/list") return json(res, 200, { nodes: [] });

    if (p === "/api/preferences" && method === "GET") return json(res, 200, state.preferences);
    if (p === "/api/preferences" && method === "POST") return json(res, 200, { ok: true });

    if (p === "/api/workspaces") return json(res, 200, state.workspaces);
    if (p === "/api/tasks") return json(res, 200, state.tasks);
    if (p === "/api/tasks/stats") return json(res, 200, { total: state.tasks.length, done: 0, blocked: 0, in_progress: 0, todo: state.tasks.length });
    if (p === "/api/tasks/ended-days") return json(res, 200, { days: [] });
    if (p === "/api/all-mrs") return json(res, 200, []);
    if (p === "/api/all-jira-tickets") return json(res, 200, []);

    if (p === "/api/sessions") return json(res, 200, { sessions: state.sessions });
    if (p === "/api/hermes/sessions") return json(res, 200, state.sessions);
    if (p === "/api/copilot/sessions") return json(res, 200, state.sessions);
    if (p === "/api/claude/sessions") return json(res, 200, state.sessions);
    if (p === "/api/codex/sessions") return json(res, 200, state.sessions);
    if (p === "/api/gemini/sessions") return json(res, 200, state.sessions);
    if (p.endsWith("/usage")) return json(res, 200, { today: 0, last_7_days: 0, last_30_days: 0 });

    if (p === "/api/notifications") return json(res, 200, { notifications: state.notifications });
    if (p === "/api/notifications/unread/count") return json(res, 200, { count: 0 });
    if (p.endsWith("/read") || p.endsWith("/read-all")) return json(res, 200, { ok: true });

    if (p.startsWith("/api/")) {
      if (method === "POST" || method === "PUT" || method === "DELETE") return json(res, 200, { ok: true });
      return json(res, 200, {
        ok: true,
        sessions: [],
        repos: [],
        tasks: [],
        workspaces: [],
        servers: [],
        notifications: [],
      });
    }

    return json(res, 404, { error: "not-found" });
  });

  return {
    state,
    async start() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address();
      return { baseUrl: `http://127.0.0.1:${addr.port}`, port: addr.port };
    },
    async stop() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createMockApiServer };
