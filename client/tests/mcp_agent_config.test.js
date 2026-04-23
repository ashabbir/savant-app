"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  getMcpAgentConfigStatus,
  setupMcpAgentConfigProvider,
} = require("../mcp_agent_config");

function mkHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "savant-mcp-home-"));
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

test("detects existing copilot config.json on client home", () => {
  const home = mkHome();
  const cfgPath = path.join(home, ".copilot", "config.json");
  writeJson(cfgPath, {
    mcpServers: {
      "savant-workspace": {},
      "savant-abilities": {},
      "savant-context": {},
      "savant-knowledge": {},
    },
  });

  const status = getMcpAgentConfigStatus({ homeDir: home });
  assert.equal(status.copilot.config_exists, true);
  assert.equal(status.copilot.savant_configured, true);
  assert.equal(status.copilot.path, cfgPath);
});

test("marks provider as not configured when config file exists without savant entries", () => {
  const home = mkHome();
  const cfgPath = path.join(home, ".gemini", "settings.json");
  writeJson(cfgPath, { mcpServers: { other: { url: "http://127.0.0.1:9000/sse" } } });

  const status = getMcpAgentConfigStatus({ homeDir: home });
  assert.equal(status.gemini.config_exists, true);
  assert.equal(status.gemini.savant_configured, false);
  assert.equal(status.gemini.path, cfgPath);
});

test("setup writes savant entries for JSON provider configs", () => {
  const home = mkHome();
  const cfgPath = path.join(home, ".copilot", "config.json");
  writeJson(cfgPath, { mcpServers: {} });

  const result = setupMcpAgentConfigProvider("copilot", {
    homeDir: home,
    ports: { workspace: 8091, abilities: 8092, context: 8093, knowledge: 8094 },
  });
  assert.equal(result.status, "configured");

  const data = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  assert.ok(data.mcpServers["savant-workspace"]);
  assert.ok(data.mcpServers["savant-abilities"]);
  assert.ok(data.mcpServers["savant-context"]);
  assert.ok(data.mcpServers["savant-knowledge"]);
});

test("setup writes savant sections for codex TOML config", () => {
  const home = mkHome();
  const cfgPath = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, '[mcp_servers."existing"]\ntype = "stdio"\n', "utf8");

  const result = setupMcpAgentConfigProvider("codex", {
    homeDir: home,
    ports: { workspace: 8091, abilities: 8092, context: 8093, knowledge: 8094 },
    pythonCmd: "python3",
    stdioPath: "/tmp/stdio.py",
  });
  assert.equal(result.status, "configured");

  const raw = fs.readFileSync(cfgPath, "utf8");
  assert.ok(raw.includes('[mcp_servers."savant-workspace"]'));
  assert.ok(raw.includes('[mcp_servers."savant-abilities"]'));
  assert.ok(raw.includes('[mcp_servers."savant-context"]'));
  assert.ok(raw.includes('[mcp_servers."savant-knowledge"]'));
});
