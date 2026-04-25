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

  test("AST cluster drawer shows children and Focus action", async () => {
    const h = await launchWithMock({
      mockState: {
        repos: [
          { name: "ast-repo", path: "/repo/ast-repo", status: "indexed", file_count: 4, chunk_count: 8, ast_node_count: 3 },
        ],
      },
    });
    try {
      await openContext(h.page);
      const html = await h.page.evaluate(() => {
        const drawer = document.createElement("div");
        drawer.id = "e2e-ast-drawer";
        drawer.style = {};
        document.body.appendChild(drawer);
        const node = {
          data: { name: "Parent", type: "class", line: 1, start_line: 1, end_line: 20 },
          _id: 1,
          children: [
            { data: { name: "Child", type: "function", line: 5, start_line: 5, end_line: 8 }, _id: 2, children: [], descendants() { return [this]; } },
          ],
          descendants() { return [this, ...this.children]; },
        };
        window._astActiveDrawMap = {
          "e2e-ast-drawer": {
            root: node,
            draw: () => {},
            closeName: "",
            toggleName: "",
          },
        };
        _showAstDrawer(node, "e2e-ast-drawer", "", "");
        return drawer.innerHTML;
      });
      expect(html).toContain("Focus");
      expect(html).toContain("Children");
      expect(html).toContain("Child");
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

  test("guide context section documents analyze_code", async () => {
    const h = await launchWithMock();
    try {
      await h.page.evaluate(() => window.openGuide && window.openGuide());
      await expect(h.page.locator("#guide-overlay")).toBeVisible({ timeout: 10000 });
      await h.page.evaluate(() => window.guideNavigate && window.guideNavigate('comp-context'));
      await expect(h.page.locator("#guide-content")).toContainText("analyze_code", { timeout: 10000 });
      await expect(h.page.locator("#guide-content")).toContainText("before/after class or file analysis");
    } finally {
      await h.close();
    }
  });

  test("workspace task graph renders from the graph endpoint", async () => {
    const h = await launchWithMock({
      mockState: {
        workspaces: [{ id: "ws-graph", name: "Graph WS", status: "open" }],
        tasks: [
          { id: "task-parent", task_id: "task-parent", title: "Parent", workspace_id: "ws-graph", status: "todo", priority: "high", depends_on: ["task-child"] },
          { id: "task-child", task_id: "task-child", title: "Child", workspace_id: "ws-graph", status: "todo", priority: "medium", depends_on: [] },
        ],
      },
    });
    try {
      await h.page.evaluate(() => {
        currentTab = "tasks";
        currentMode = "tasks";
        _currentWsId = "ws-graph";
        _wsGraphMode = true;
      });
      await h.page.evaluate(() => loadWsGraph("ws-graph"));
      await expect(h.page.locator("#dep-graph-svg .dep-node")).toHaveCount(2);
      await expect(h.page.locator("#ws-detail-tasks")).toContainText("☰ LIST");
      await expect(h.page.locator("#ws-graph-toggle")).toHaveText("☰ LIST");
    } finally {
      await h.close();
    }
  });
});
