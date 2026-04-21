"use strict";

const fs = require("fs");
const path = require("path");
const { test, expect, _electron: electron } = require("@playwright/test");

const APP_DIR = path.resolve(__dirname, "..");

async function launchApp() {
  const app = await electron.launch({
    args: [APP_DIR],
    cwd: APP_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      SAVANT_SERVER_URL: process.env.SAVANT_SERVER_URL || "http://127.0.0.1:8090",
    },
  });
  await app.firstWindow();
  const window = await pickMainWindow(app);
  return { app, window };
}

async function pickMainWindow(app) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const wins = app.windows();
    for (const w of wins) {
      const state = await w.evaluate(() => {
        const hasElectronAPI = !!(window.electronAPI && window.electronAPI.navigate);
        const url = window.location.href || "";
        return { hasElectronAPI, url };
      }).catch(() => null);
      if (!state || !state.hasElectronAPI) continue;
      if (state.url.includes("terminal.html")) continue;
      await w.waitForLoadState("domcontentloaded");
      return w;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Could not find main Savant window");
}

test.describe("Electron UI Smoke", () => {
  test("loads main window and exposes preload bridges", async () => {
    const { app, window } = await launchApp();
    try {
      await expect
        .poll(async () => window.url(), { timeout: 20000 })
        .toMatch(/(loading\.html|index\.html|detail\.html)/);
      const bridges = await window.evaluate(() => ({
        hasElectronAPI: !!window.electronAPI,
        hasSavantClient: !!window.savantClient,
      }));
      expect(bridges.hasElectronAPI).toBeTruthy();
      expect(bridges.hasSavantClient).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  test("navigates to detail page via main-process IPC without file root fallback", async () => {
    const { app, window } = await launchApp();
    try {
      await expect
        .poll(async () => window.url(), { timeout: 20000 })
        .toMatch(/(loading\.html|index\.html|detail\.html)/);
      const logMeta = await window.evaluate(async () => window.electronAPI.getLogPaths());
      const logFile = logMeta && logMeta.mainLogFile ? logMeta.mainLogFile : null;
      const marker = logFile && fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;

      await window.evaluate(() => {
        window.electronAPI.navigate("./detail.html?mode=codex&session_id=ui-e2e-session");
      });

      await expect.poll(async () => window.url(), { timeout: 20000 }).toContain("detail.html");
      await expect.poll(async () => window.url(), { timeout: 20000 }).toContain("session_id=ui-e2e-session");

      if (logFile && fs.existsSync(logFile)) {
        const next = fs.readFileSync(logFile, "utf8").slice(marker);
        expect(next).not.toContain("url=file:///detail.html");
        expect(next).not.toContain("ERR_FILE_NOT_FOUND");
      }
    } finally {
      await app.close();
    }
  });
});
