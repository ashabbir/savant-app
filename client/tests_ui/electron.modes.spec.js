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
        _prefs = { ...(typeof _prefs === "object" && _prefs ? _prefs : {}), enabled_providers: providers.slice() };
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

  test("terminal shortcuts: Cmd+` opens drawer and Cmd+T adds tab", async () => {
    const h = await launchWithMock();
    try {
      const state = await h.page.evaluate(async () => {
        const before = (await window.terminalAPI.list()).length;

        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: '`',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((r) => setTimeout(r, 400));

        const afterOpen = (await window.terminalAPI.list()).length;
        const open = await window.terminalAPI.isDrawerOpen();

        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 't',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((r) => setTimeout(r, 400));

        const afterNewTab = (await window.terminalAPI.list()).length;
        return { before, afterOpen, afterNewTab, open };
      });

      expect(state.open).toBeTruthy();
      expect(state.afterOpen).toBeGreaterThanOrEqual(state.before);
      expect(state.afterNewTab).toBe(state.afterOpen + 1);
    } finally {
      await h.close();
    }
  });

  test("terminal shortcuts: Cmd+Shift+E has no effect (binding removed)", async () => {
    const h = await launchWithMock();
    try {
      const state = await h.page.evaluate(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: '`',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((r) => setTimeout(r, 300));

        const before = {
          open: await window.terminalAPI.isDrawerOpen(),
          tabs: (await window.terminalAPI.list()).length,
        };

        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'E',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((r) => setTimeout(r, 300));

        const after = {
          open: await window.terminalAPI.isDrawerOpen(),
          tabs: (await window.terminalAPI.list()).length,
        };

        return { before, after };
      });

      expect(state.after.open).toBe(state.before.open);
      expect(state.after.tabs).toBe(state.before.tabs);
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

  test("top bar logo renders as a tech-style SVG mark", async () => {
    const h = await launchWithMock();
    try {
      const html = await h.page.locator("#header-title").innerHTML();
      expect(html).toContain("savant-logo");
      expect(html).toContain("logo-grd");
      expect(html).not.toContain(">S<");
    } finally {
      await h.close();
    }
  });
});
