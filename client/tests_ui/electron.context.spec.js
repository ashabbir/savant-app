"use strict";

const { test, expect } = require("@playwright/test");
const { launchWithMock } = require("./helpers/electronHarness");

async function openContext(page) {
  await page.click("#mode-abilities");
  await expect(page.locator("#mcp-subtabs")).toBeVisible({ timeout: 10000 });
  await page.click("#mcp-sub-context");
  await expect(page.locator("#context-view")).toBeVisible({ timeout: 10000 });
}

test.describe("Electron Context UI", () => {
  test("empty project list still renders explorer and add action", async () => {
    const h = await launchWithMock({ mockState: { repos: [] } });
    try {
      await openContext(h.page);
      const html = await h.page.evaluate(() => {
        const host = document.createElement("div");
        host.id = "e2e-empty-projects";
        document.body.appendChild(host);
        ctxRenderProjectExplorer("e2e-empty-projects", [], "", "ctxSelectProject", { indexStatus: {} });
        return host.innerHTML;
      });
      expect(html).toContain("ctx-project-explorer");
      expect(html).toContain("ctx-project-explorer-add");
      expect(html).toContain("No projects yet");
    } finally {
      await h.close();
    }
  });

  test("project actions show index/ast/purge/delete and exclude reindex", async () => {
    const h = await launchWithMock({
      mockState: {
        repos: [
          { name: "demo-repo", path: "/repo/demo-repo", status: "indexed", file_count: 12, chunk_count: 80, ast_node_count: 21 },
        ],
      },
    });
    try {
      await openContext(h.page);
      const html = await h.page.evaluate(() => {
        const target = document.createElement("div");
        target.id = "e2e-project-overview";
        document.body.appendChild(target);
        ctxRenderProjectOverview(target, {
          name: "demo-repo",
          path: "/repo/demo-repo",
          status: "indexed",
          file_count: 12,
          chunk_count: 80,
          ast_node_count: 21,
        }, {}, {});
        return target.innerHTML;
      });
      expect(html).toContain("Index");
      expect(html).toContain("AST");
      expect(html).toContain("Purge");
      expect(html).toContain("Delete");
      expect(html).not.toContain("Reindex");
    } finally {
      await h.close();
    }
  });

  test("indexing project includes stop action", async () => {
    const h = await launchWithMock({
      mockState: {
        repos: [
          { name: "indexing-repo", path: "/repo/indexing-repo", status: "indexing", file_count: 12, chunk_count: 0, ast_node_count: 0 },
        ],
      },
    });
    try {
      await openContext(h.page);
      const html = await h.page.evaluate(() => {
        const target = document.createElement("div");
        target.id = "e2e-project-overview-indexing";
        document.body.appendChild(target);
        ctxRenderProjectOverview(target, {
          name: "indexing-repo",
          path: "/repo/indexing-repo",
          status: "indexing",
          file_count: 12,
          chunk_count: 0,
          ast_node_count: 0,
        }, { "indexing-repo": { status: "indexing" } }, {});
        return target.innerHTML;
      });
      expect(html).toContain("Stop");
    } finally {
      await h.close();
    }
  });

  test("left rail does not expose open-in-browser action", async () => {
    const h = await launchWithMock();
    try {
      await expect(h.page.locator("#left-tab-browser")).toHaveCount(0);
      await expect(h.page.locator("#left-tab-bar")).not.toContainText("Open in browser");
    } finally {
      await h.close();
    }
  });
});
