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
