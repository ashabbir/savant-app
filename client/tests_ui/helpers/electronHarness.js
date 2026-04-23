"use strict";

const path = require("path");
const { _electron: electron, expect } = require("@playwright/test");
const { createMockApiServer } = require("./mockApiServer");

const APP_DIR = path.resolve(__dirname, "..", "..");

async function pickMainWindow(app) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const wins = app.windows();
    for (const w of wins) {
      const state = await w.evaluate(() => ({
        url: window.location.href || "",
        hasElectronAPI: !!(window.electronAPI && window.electronAPI.navigate),
      })).catch(() => null);
      if (!state || !state.hasElectronAPI) continue;
      if ((state.url || "").includes("terminal.html")) continue;
      await w.waitForLoadState("domcontentloaded");
      return w;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Could not find main Savant window");
}

async function waitForDashboardReady(page) {
  await expect(page.locator("#mode-sessions")).toBeVisible({ timeout: 25000 });
  await expect(page.locator("#mode-workspaces")).toBeVisible({ timeout: 25000 });
  await expect(page.locator("#mode-tasks")).toBeVisible({ timeout: 25000 });
  await expect(page.locator("#mode-abilities")).toBeVisible({ timeout: 25000 });
}

async function launchWithMock(options = {}) {
  const mock = createMockApiServer(options.mockState || {});
  const { baseUrl } = await mock.start();
  const extraEnv = options.env || {};

  const app = await electron.launch({
    args: [APP_DIR],
    cwd: APP_DIR,
    env: {
      ...process.env,
      ...extraEnv,
      NODE_ENV: "test",
      SAVANT_SERVER_URL: baseUrl,
    },
  });
  await app.firstWindow();
  const page = await pickMainWindow(app);
  await waitForDashboardReady(page);

  return {
    app,
    page,
    baseUrl,
    mock,
    async close() {
      try { await app.close(); } catch {}
      try { await mock.stop(); } catch {}
    },
  };
}

module.exports = {
  APP_DIR,
  launchWithMock,
  pickMainWindow,
  waitForDashboardReady,
};
