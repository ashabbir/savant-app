"use strict";

const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { launchWithMock } = require("./helpers/electronHarness");

test.describe("Electron UI Smoke", () => {
  test("loads main window and exposes preload bridges", async () => {
    const h = await launchWithMock();
    try {
      const bridges = await h.page.evaluate(() => ({
        hasElectronAPI: !!window.electronAPI,
        hasSavantClient: !!window.savantClient,
      }));
      expect(bridges.hasElectronAPI).toBeTruthy();
      expect(bridges.hasSavantClient).toBeTruthy();
    } finally {
      await h.close();
    }
  });

  test("exposes log path bridge in renderer", async () => {
    const h = await launchWithMock();
    try {
      const logMeta = await h.page.evaluate(async () => window.electronAPI.getLogPaths());
      expect(logMeta && logMeta.ok).toBeTruthy();
      expect(String(logMeta.mainLogFile || "")).toContain("savant-main.log");
      expect(String(logMeta.userDataDir || "").length > 0).toBeTruthy();
    } finally {
      await h.close();
    }
  });

  test("shows abilities bootstrap control when server reports zero assets", async () => {
    const h = await launchWithMock();
    try {
      await h.page.evaluate(() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const url = String(input);
          if (url.includes("/api/system/info")) {
            return new Response(JSON.stringify({
              abilities: { asset_count: 0, bootstrap_available: true, seed_path: "/tmp/savant-abilities-seed/abilities" },
              directories: { abilities_dir: "/tmp/savant-data/abilities" },
            }), { status: 200, headers: { "content-type": "application/json" } });
          }
          if (url.includes("/api/abilities/stats")) {
            return new Response(JSON.stringify({ personas: 0, rules: 0, policies: 0, styles: 0, repos: 0 }), { status: 200, headers: { "content-type": "application/json" } });
          }
          return originalFetch(input, init);
        };
        return refreshAbilitiesGuideStatus();
      });
      await expect(h.page.locator("#abilities-guide-bootstrap")).toContainText("Bootstrap Abilities", { timeout: 10000 });
      const bootstrapHtml = await h.page.locator("#abilities-guide-bootstrap").innerHTML();
      expect(bootstrapHtml).toContain("bootstrapAbilitiesFromGuide");
    } finally {
      await h.close();
    }
  });

  test("navigates to detail page via main-process IPC without file root fallback", async () => {
    const h = await launchWithMock();
    try {
      const logMeta = await h.page.evaluate(async () => window.electronAPI.getLogPaths());
      const logFile = logMeta && logMeta.mainLogFile ? logMeta.mainLogFile : null;
      const marker = logFile && fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;

      await h.page.evaluate(() => {
        window.electronAPI.navigate("./detail.html?mode=codex&session_id=ui-e2e-session");
      });

      await expect.poll(async () => h.page.url(), { timeout: 20000 }).toContain("detail.html");
      await expect.poll(async () => h.page.url(), { timeout: 20000 }).toContain("session_id=ui-e2e-session");

      if (logFile && fs.existsSync(logFile)) {
        const next = fs.readFileSync(logFile, "utf8").slice(marker);
        expect(next).not.toContain("url=file:///detail.html");
        expect(next).not.toContain("ERR_FILE_NOT_FOUND");
      }
    } finally {
      await h.close();
    }
  });
});
