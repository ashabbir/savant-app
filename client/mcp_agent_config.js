"use strict";

const fs = require("fs");
const path = require("path");

const SERVER_NAMES = ["workspace", "abilities", "context", "knowledge"];

function requiredServerKeys() {
  return SERVER_NAMES.map((name) => `savant-${name}`);
}

function providerSpecs(homeDir) {
  return {
    copilot: {
      label: "Copilot CLI",
      format: "json",
      key: "mcpServers",
      paths: [
        path.join(homeDir, ".copilot", "mcp-config.json"),
        path.join(homeDir, ".copilot", "config.json"),
      ],
      extras: { type: "sse", tools: ["*"], headers: {} },
    },
    claude: {
      label: "Claude Desktop",
      format: "json",
      key: "mcpServers",
      paths: [path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")],
      extras: { type: "sse", tools: ["*"] },
    },
    gemini: {
      label: "Gemini CLI",
      format: "json",
      key: "mcpServers",
      paths: [path.join(homeDir, ".gemini", "settings.json")],
      extras: { type: "sse", trust: true },
    },
    codex: {
      label: "Codex CLI",
      format: "toml",
      paths: [path.join(homeDir, ".codex", "config.toml")],
    },
    hermes: {
      label: "Hermes Agent",
      format: "yaml",
      key: "mcp_servers",
      paths: [path.join(homeDir, ".hermes", "config.yaml")],
    },
  };
}

function _pickPath(spec) {
  for (const candidate of spec.paths || []) {
    if (fs.existsSync(candidate)) {
      return { path: candidate, exists: true };
    }
  }
  return { path: (spec.paths && spec.paths[0]) || "", exists: false };
}

function _isConfigured(spec, filePath) {
  const required = requiredServerKeys();
  try {
    if (spec.format === "json") {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      const servers = data[spec.key] || {};
      return required.every((k) => Object.prototype.hasOwnProperty.call(servers, k));
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return required.every((k) => raw.includes(k));
  } catch {
    return false;
  }
}

function getMcpAgentConfigStatus(options = {}) {
  const homeDir = String(options.homeDir || process.env.HOME || "");
  const specs = providerSpecs(homeDir);
  const result = {};
  for (const [provider, spec] of Object.entries(specs)) {
    const picked = _pickPath(spec);
    result[provider] = {
      label: spec.label,
      path: picked.path,
      config_exists: picked.exists,
      savant_configured: picked.exists ? _isConfigured(spec, picked.path) : false,
    };
  }
  return result;
}

function _sseEntries(ports, extras) {
  const entries = {};
  for (const name of SERVER_NAMES) {
    const port = Number((ports && ports[name]) || 0);
    if (!Number.isFinite(port) || port <= 0) continue;
    entries[`savant-${name}`] = { url: `http://127.0.0.1:${port}/sse`, ...(extras || {}) };
  }
  return entries;
}

function _setupJson(spec, filePath, ports) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const servers = data[spec.key] || {};
  const entries = _sseEntries(ports, spec.extras);
  for (const [name, entry] of Object.entries(entries)) {
    servers[name] = entry;
  }
  data[spec.key] = servers;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function _setupToml(filePath, ports, pythonCmd, stdioPath) {
  const raw = fs.readFileSync(filePath, "utf8");
  let updated = raw;
  const py = String(pythonCmd || "python3");
  for (const name of SERVER_NAMES) {
    const header = `[mcp_servers."savant-${name}"]`;
    if (updated.includes(header)) continue;
    updated += `\n${header}\ntype = "stdio"\ncommand = "${py}"\nargs = ["${stdioPath}", "${name}"]\n`;
  }
  if (updated !== raw) {
    fs.writeFileSync(filePath, updated, "utf8");
  }
}

function _setupYaml(spec, filePath, ports) {
  let raw = fs.readFileSync(filePath, "utf8");
  const key = spec.key || "mcp_servers";
  if (!raw.includes(`${key}:`)) {
    raw = raw.replace(/\s*$/, `\n${key}:\n`);
  }
  const idx = raw.indexOf(`${key}:`);
  const insertAt = idx >= 0 ? raw.indexOf("\n", idx) + 1 : raw.length;
  let prefix = raw.slice(0, insertAt);
  const suffix = raw.slice(insertAt);
  for (const name of SERVER_NAMES) {
    const serverName = `savant-${name}`;
    if (raw.includes(`${serverName}:`)) continue;
    const port = Number((ports && ports[name]) || 0);
    if (!Number.isFinite(port) || port <= 0) continue;
    prefix += `  ${serverName}:\n    url: http://127.0.0.1:${port}/sse\n    timeout: 120\n`;
  }
  const updated = prefix + suffix;
  if (updated !== raw) {
    fs.writeFileSync(filePath, updated, "utf8");
  }
}

function setupMcpAgentConfigProvider(provider, options = {}) {
  const homeDir = String(options.homeDir || process.env.HOME || "");
  const ports = options.ports || {};
  const pythonCmd = options.pythonCmd || "python3";
  const stdioPath = String(options.stdioPath || "");
  const specs = providerSpecs(homeDir);
  const spec = specs[String(provider || "").toLowerCase()];
  if (!spec) return { provider, status: "skipped", reason: "unknown provider" };

  const picked = _pickPath(spec);
  if (!picked.exists) {
    return {
      provider,
      status: "skipped",
      reason: "config file not found",
      label: spec.label,
      path: picked.path,
    };
  }

  try {
    if (spec.format === "json") {
      _setupJson(spec, picked.path, ports);
    } else if (spec.format === "toml") {
      _setupToml(picked.path, ports, pythonCmd, stdioPath);
    } else if (spec.format === "yaml") {
      _setupYaml(spec, picked.path, ports);
    } else {
      return { provider, status: "skipped", reason: "unsupported format", label: spec.label, path: picked.path };
    }
    const configured = _isConfigured(spec, picked.path);
    return {
      provider,
      status: configured ? "configured" : "error",
      label: spec.label,
      path: picked.path,
      error: configured ? undefined : "unable to verify configuration",
    };
  } catch (e) {
    return { provider, status: "error", label: spec.label, path: picked.path, error: String(e && e.message ? e.message : e) };
  }
}

module.exports = {
  SERVER_NAMES,
  providerSpecs,
  getMcpAgentConfigStatus,
  setupMcpAgentConfigProvider,
};
