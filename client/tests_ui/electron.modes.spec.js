"use strict";

const { test, expect } = require("@playwright/test");
const { launchWithMock } = require("./helpers/electronHarness");

test.describe("Electron UI Modes", () => {
  test("switches top-level tabs and updates active button", async () => {
    const h = await launchWithMock();
    try {
      const results = await h.page.evaluate(() => {
        const tabs = ["workspaces", "tasks", "abilities", "sessions"];
        const activeIds = [];
        for (const tab of tabs) {
          if (typeof _switchTabInner === "function") _switchTabInner(tab);
          const active = document.querySelector(".mode-btn.active");
          activeIds.push(active ? active.id : "");
        }
        return activeIds;
      });
      expect(results).toEqual(["mode-workspaces", "mode-tasks", "mode-abilities", "mode-sessions"]);
    } finally {
      await h.close();
    }
  });

  test("switches session provider subtabs", async () => {
    const h = await launchWithMock();
    try {
      const results = await h.page.evaluate(() => {
        const providers = ["hermes", "copilot", "claude", "codex", "gemini"];
        const activeIds = [];
        currentTab = "sessions";
        for (const p of providers) {
          currentMode = p;
          if (typeof _applyTabUI === "function") _applyTabUI();
          const active = document.querySelector("#provider-subtabs .savant-subtab.active");
          activeIds.push(active ? active.id : "");
        }
        return activeIds;
      });
      expect(results).toEqual(["prov-hermes", "prov-copilot", "prov-claude", "prov-codex", "prov-gemini"]);
    } finally {
      await h.close();
    }
  });

  test("left rail switches to terminal view and back", async () => {
    const h = await launchWithMock();
    try {
      const container = h.page.locator(".container");
      await expect(container).toBeVisible();

      await h.page.click("#left-tab-terminal");
      await expect(container).toBeHidden();
      await expect(h.page.locator("#left-tab-close")).toBeVisible();

      await h.page.click("#left-tab-close");
      await expect(container).toBeVisible();
      await expect(h.page.locator("#left-tab-close")).toBeHidden();
    } finally {
      await h.close();
    }
  });

  test("opens and closes preferences modal", async () => {
    const h = await launchWithMock();
    try {
      await h.page.click("button[title='Preferences']");
      await expect(h.page.locator("#prefs-modal")).toBeVisible();
      await expect(h.page.locator("#pref-server-url")).toBeVisible();
      await h.page.evaluate(() => closePreferences());
      await expect(h.page.locator("#prefs-modal")).toBeHidden();
    } finally {
      await h.close();
    }
  });
});
