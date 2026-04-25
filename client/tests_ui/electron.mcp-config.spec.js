"use strict";

const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { launchWithMock } = require("./helpers/electronHarness");

async function openMcpGuide(page) {
  await page.click("button[title='MCP Tools Guide']");
  await expect(page.locator("#tutorial-modal")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#sys-status-content")).toBeVisible({ timeout: 10000 });
}

test.describe("Electron MCP Config", () => {
  test("system info reads AI agent MCP config status from client bridge", async () => {
    const h = await launchWithMock();
    try {
      await openMcpGuide(h.page);
      const data = await h.page.evaluate(() => window.electronAPI.checkMcpAgentConfigs());
      const labels = Object.values(data).map((v) => v.label);
      await expect(h.page.locator("#sys-status-content")).toContainText("AI Agent MCP Config");
      for (const label of labels) {
        await expect(h.page.locator("#sys-status-content")).toContainText(label);
      }
      for (const [provider, info] of Object.entries(data)) {
        const expected = info.savant_configured ? "Configured" : (info.config_exists ? "Not configured" : "No config file");
        const row = h.page.locator("#sys-status-content .sys-row", { hasText: info.label });
        await expect(row, `${provider} should show ${expected}`).toContainText(expected);
      }
    } finally {
      await h.close();
    }
  });

  test("setup button uses client-side MCP config updater", async () => {
    const h = await launchWithMock();
    try {
      const status = await h.page.evaluate(() => window.electronAPI.checkMcpAgentConfigs());
      const copilotPath = status && status.copilot ? status.copilot.path : "";
      if (!copilotPath) test.skip(true, "copilot config path is unavailable");
      fs.mkdirSync(require("path").dirname(copilotPath), { recursive: true });
      fs.writeFileSync(copilotPath, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");

      await openMcpGuide(h.page);
      await h.page.evaluate(() => fetchSystemStatus());
      const row = h.page.locator("#sys-status-content .sys-row", { hasText: "Copilot CLI" });
      await expect(row.locator("button.mcp-setup-btn")).toBeVisible({ timeout: 10000 });
      await row.locator("button.mcp-setup-btn").click();
      await expect(row).toContainText("● Configured", { timeout: 15000 });
      const cfg = JSON.parse(fs.readFileSync(copilotPath, "utf8"));
      expect(Object.prototype.hasOwnProperty.call(cfg.mcpServers, "savant-workspace")).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(cfg.mcpServers, "savant-abilities")).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(cfg.mcpServers, "savant-context")).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(cfg.mcpServers, "savant-knowledge")).toBeTruthy();
    } finally {
      await h.close();
    }
  });
});
