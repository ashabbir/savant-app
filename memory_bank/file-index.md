# Savant File Index

This index covers the relevant tracked repository files and gives each one a short lookup description. Generated files, caches, `node_modules`, and build output are intentionally excluded.

## Root Files

1. `AGENTS.md` — Repository-specific operating instructions for coding agents working in this checkout.
2. `CLAUDE.md` — High-level architecture and workflow notes aimed at Claude-style agent sessions.
3. `GEMINI.md` — Product and architecture summary tuned for Gemini-oriented agent context.
4. `INSTALL.md` — macOS ARM64 installation instructions for local setup.
5. `package.json` — Electron package manifest, scripts, build settings, and JS dependencies.
6. `package-lock.json` — NPM dependency lockfile for deterministic installs.
7. `main.js` — Electron main process; starts Flask and MCP, manages BrowserWindow, BrowserView terminal, PTYs, and app lifecycle.
8. `preload.js` — Electron preload bridge exposing terminal and desktop IPC into renderer pages.
9. `loading.html` — Boot splash screen used while Flask and MCP services are starting.
10. `terminal.html` — Dedicated BrowserView terminal surface with xterm-based UI and split-pane shell behavior.
11. `mcp_servers.toml` — Static local MCP server registration file pointing at Savant SSE endpoints.
12. `build-and-deploy.sh` — One-line local build and deploy script for `/Applications/Savant.app`.
13. `archive.sh` — Archives build artifacts into versioned folders under `arch-version/`.
14. `icon.png` — Main app icon used by Electron packaging.
15. `icon_256.png` — Secondary app icon asset.

## Root Tests

16. `tests/test_terminal.js` — Node-based validation suite for preload APIs, PTY behavior, and terminal process logic.

## Backend Application

17. `savant/app.py` — Primary Flask application containing dashboard routes, provider session ingestion, workspace APIs, and app orchestration logic.
18. `savant/sqlite_client.py` — SQLite singleton, schema creation, migrations, and connection management.
19. `savant/models.py` — Pydantic models describing Savant entities such as workspaces, tasks, tickets, notifications, and knowledge nodes.
20. `savant/hardening.py` — Shared request validation, sanitization, retry, and rate-limiting utilities.
21. `savant/README.md` — Older product README describing Savant as an AI workflows dashboard.
22. `savant/Dockerfile` — Flask-layer container image definition for non-Electron runtime scenarios.
23. `savant/requirements.txt` — Python dependencies for the backend application and context subsystem.

## Abilities Subsystem

24. `savant/abilities/__init__.py` — Package marker for the abilities subsystem.
25. `savant/abilities/store.py` — Filesystem-backed loader, indexer, and validator for abilities assets.
26. `savant/abilities/resolver.py` — Prompt compiler that merges persona, repo overlay, rules, policies, and styles into deterministic output.
27. `savant/abilities/routes.py` — Flask blueprint exposing abilities asset CRUD, learning, validation, stats, and resolution APIs.

## Context Subsystem

28. `savant/context/__init__.py` — Package summary for semantic context and memory-bank indexing.
29. `savant/context/db.py` — SQLite plus `sqlite-vec` schema and query layer for repositories, files, chunks, and embeddings.
30. `savant/context/indexer.py` — Background repository indexing pipeline with progress tracking and cancellation support.
31. `savant/context/embeddings.py` — Embedding model resolver, downloader, loader, and encoder wrapper.
32. `savant/context/chunker.py` — Content chunking strategy for indexed files.
33. `savant/context/walker.py` — Repo file walker with ignore-pattern handling.
34. `savant/context/language.py` — Language and memory-bank file detection heuristics.
35. `savant/context/deps.py` — Helpers that auto-install or verify ML dependencies required by the embedding stack.
36. `savant/context/routes.py` — Flask blueprint for repo registration, indexing, semantic search, and memory-bank resource access.

## Knowledge Subsystem

37. `savant/knowledge/__init__.py` — Package marker for knowledge-graph routes.
38. `savant/knowledge/routes.py` — Flask blueprint for knowledge graph CRUD, search, commit, merge, import/export, and workspace-link workflows.

## MCP Subsystem

39. `savant/mcp/server.py` — Workspace MCP server exposing workspaces, tasks, notes, MRs, and Jira operations to agents.
40. `savant/mcp/abilities_server.py` — Abilities MCP bridge for prompt resolution and asset management.
41. `savant/mcp/context_server.py` — Context MCP bridge for semantic code search and memory-bank access.
42. `savant/mcp/knowledge_server.py` — Knowledge MCP bridge for graph search, storage, connection, and traversal tools.
43. `savant/mcp/session_detect.py` — Provider-aware session detection logic used by MCP tools to infer current workspace context.
44. `savant/mcp/stdio.py` — Unified stdio launcher for MCP servers when an AI tool cannot use SSE directly.
45. `savant/mcp/requirements.txt` — Python dependencies needed only for MCP bridge processes.

## Database Layer

46. `savant/db/__init__.py` — Package marker for DB helper modules.
47. `savant/db/base.py` — Shared timestamp and row-conversion helpers used across DB classes.
48. `savant/db/workspaces.py` — Workspace CRUD and workspace-stat queries.
49. `savant/db/tasks.py` — Task CRUD, ordering, and dependency storage logic.
50. `savant/db/notes.py` — Session and workspace note persistence helpers.
51. `savant/db/merge_requests.py` — Merge request persistence, note attachment, and session-assignment support.
52. `savant/db/jira_tickets.py` — Jira ticket persistence, note attachment, and session-assignment support.
53. `savant/db/notifications.py` — Notification persistence, read-state updates, and retention helpers.
54. `savant/db/experiences.py` — Legacy experience-layer storage retained for backward compatibility.
55. `savant/db/knowledge_graph.py` — Core knowledge graph node and edge persistence layer with commit and search behavior.

## Templates

56. `savant/templates/index.html` — Main dashboard page containing the top-level UI shells for sessions, workspaces, tasks, MCP, and supporting panels.
57. `savant/templates/detail.html` — Session detail page for conversation, files, metadata, notes, and related analysis views.
58. `savant/templates/components/_header.html` — Shared Jinja macros for the Savant top bar and mode switcher.

## Frontend Styles and Vendor Assets

59. `savant/static/css/shared.css` — Shared design system, layout chrome, and reusable UI styles for index and detail pages.
60. `savant/static/xterm.css` — xterm.js stylesheet used by the terminal view.
61. `savant/static/xterm.mjs` — Bundled xterm.js runtime.
62. `savant/static/xterm-addon-fit.mjs` — xterm addon used to resize terminals to their containers.
63. `savant/static/xterm-addon-web-links.mjs` — xterm addon for terminal URL detection.
64. `savant/static/d3.v7.min.js` — Bundled D3 runtime used by the knowledge graph UI.

## Frontend JavaScript Modules

65. `savant/static/js/globals.js` — Shared mutable frontend state declarations loaded before feature modules.
66. `savant/static/js/core.js` — Main dashboard orchestration including hash routing, release notes, boot logic, and cross-feature control flow.
67. `savant/static/js/sessions.js` — Session filtering, sorting, and session-list rendering logic.
68. `savant/static/js/workspaces.js` — Workspace list, workspace detail, and workspace-level action handlers.
69. `savant/static/js/tasks.js` — Daily task board logic, date navigation, and task interaction handlers.
70. `savant/static/js/context-tab.js` — Context tab UI logic for repo indexing, search, and memory-bank browsing.
71. `savant/static/js/knowledge.js` — Knowledge graph UI, D3 simulation control, search, selection, and graph editing behavior.
72. `savant/static/js/abilities.js` — Abilities asset tree, editor, and prompt-builder UI logic.
73. `savant/static/js/workspace-mcp.js` — Shared MCP health-check helper used by tab-specific MCP views.
74. `savant/static/js/mcp-tab.js` — Subtab switching logic across workspace, abilities, context, and knowledge MCP panels.
75. `savant/static/js/terminal.js` — Terminal BrowserView client logic for xterm tabs, panes, splits, focus, and reconnection.
76. `savant/static/js/terminal-bridge.js` — Page-side adapter that lets normal dashboard pages control the persistent terminal BrowserView.
77. `savant/static/js/terminal-view.js` — Stub UI adapter for switching between normal UI and terminal presentation modes.
78. `savant/static/js/status-bar.js` — Shared status bar timers, refresh state, breadcrumbs, and related footer behavior.
79. `savant/static/js/notifications.js` — Toast notifications and notification history panel behavior.
80. `savant/static/js/guide.js` — In-app Savant guide overlay, tree navigation, and guide-content rendering helpers.
81. `savant/static/js/command-palette.js` — Command palette overlay and keyboard navigation logic.
82. `savant/static/js/tabs.js` — Reusable tab-switching helper for shared tab and subtab UI patterns.
83. `savant/static/js/utils.js` — Shared frontend utility helpers such as escaping, timestamp formatting, and small rendering helpers.
84. `savant/static/js/dev-log.js` — Developer log panel used to surface startup and runtime diagnostics inside the UI.

## Backend Tests and Fixtures

85. `savant/tests/__init__.py` — Test package marker.
86. `savant/tests/conftest.py` — Shared pytest fixtures, isolated DB setup, and test client wiring.
87. `savant/tests/test_app_refactor.py` — Structural tests enforcing decomposition patterns in the large Flask app.
88. `savant/tests/test_bug_fixes.py` — Static regression tests that lock in source-level fixes for previously reported bugs.
89. `savant/tests/test_claude_session_workspace.py` — Tests for Claude session workspace assignment validation.
90. `savant/tests/test_codex_session_detect.py` — Tests for Codex session detection via environment variables and `.savant-meta`.
91. `savant/tests/test_codex_session_workspace.py` — Tests for assigning workspaces to valid Codex sessions.
92. `savant/tests/test_codex_sessions.py` — Tests for Codex session loading and related endpoints.
93. `savant/tests/test_cr7.py` — Regression tests for knowledge-graph change request behavior such as issue node type and metadata preservation.
94. `savant/tests/test_db_base.py` — Tests for shared DB utility helpers.
95. `savant/tests/test_detail_refactor.py` — Structural tests for detail-page refactoring invariants.
96. `savant/tests/test_gemini_sessions.py` — Tests for Gemini session ingestion and provider endpoints.
97. `savant/tests/test_jira_api.py` — End-to-end Jira API regression tests.
98. `savant/tests/test_js_syntax.py` — JS syntax and modularization integrity checks for the frontend files.
99. `savant/tests/test_kg_hardening.py` — Knowledge route hardening tests covering validation and safety behavior.
100. `savant/tests/test_kg_merge.py` — Tests for node merge behavior in the knowledge graph.
101. `savant/tests/test_kg_node_edit.py` — Tests for editing knowledge graph nodes through the API.
102. `savant/tests/test_kg_prompt.py` — Tests for generating AI prompts from knowledge graph nodes.
103. `savant/tests/test_kg_v55.py` — Tests for staging, export/import, bulk actions, and workspace metadata in the graph.
104. `savant/tests/test_kg_workspace_stats.py` — Tests for workspace responses including knowledge-graph statistics.
105. `savant/tests/test_knowledge.py` — Broad knowledge and experience layer tests across DB and REST behavior.
106. `savant/tests/test_knowledge_staging.py` — Tests for staged knowledge nodes, purge behavior, and multi-workspace graph features.
107. `savant/tests/test_shared_components.py` — Structural tests for shared CSS and shared frontend modules.
108. `savant/tests/test_tabs_component.py` — Tests for the shared tab component used across pages.
109. `savant/tests/test_task_api.py` — HTTP regression tests for task endpoints and serialization behavior.
110. `savant/tests/test_task_db.py` — Data-layer regression tests for the task DB module.
111. `savant/tests/test_terminal.py` — Tests for terminal preferences and terminal-related source invariants.
112. `savant/tests/test_terminal_structural.py` — Structural terminal regression tests for `terminal.html` and `main.js`.
113. `savant/tests/test_ui.py` — Playwright-based UI tests for the dashboard.
114. `savant/tests/test_ui_structural.py` — Structural regression tests for BrowserView terminal integration and UI fixes.

## Inventory Notes

- This index intentionally excludes generated caches, `dist/`, `node_modules/`, `__pycache__/`, and transient test artifacts.
- The largest implementation concentration is still `savant/app.py` plus the frontend modules under `savant/static/js/`.
- For agent work, the most useful entrypoints are usually `main.js`, `savant/app.py`, `savant/sqlite_client.py`, `savant/mcp/server.py`, `savant/context/routes.py`, `savant/knowledge/routes.py`, and the relevant frontend module in `savant/static/js/`.
