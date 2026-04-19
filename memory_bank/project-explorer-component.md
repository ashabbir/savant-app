# Project Explorer Component

## Purpose

`Project Explorer` is the shared left-side project selector used across Context tabs.
It centralizes project search, status visualization, project selection, and panel collapse behavior.

## Location

- UI logic: `savant/static/js/context-core.js`
- Shared renderer: `ctxRenderProjectExplorer(containerId, projects, selectedName, onSelectFn, options)`
- Shared interactions:
  - `ctxProjectExplorerSearch(containerId, value)`
  - `ctxToggleProjectExplorer(containerId)`
  - `ctxSyncProjectExplorerLayout(containerId)`

## UI Contract

Each `Project Explorer` instance includes these pieces inside the component:

1. Status line on the left edge of every project row
2. Search box above the project list
3. List of selectable projects
4. Collapse button in the component header

## Status Color Semantics

The left status line follows this mapping:

- Green: project is fully ready (indexed + AST generated)
- Orange: indexing/AST work is in progress, or project is partially complete
- Red: indexing/AST run failed

Status is computed from live indexing state (`/api/context/repos/indexing-status`) plus per-project metadata (`chunk_count`, `ast_node_count`, `indexed_at`, `status`).

## Project Row Indicators

Under each project name there are mini indicators:

- `I`: indexing completed
- `A`: AST generated

These indicate completion state independent of the left status line.

## Current Usage

`Project Explorer` is now used in all Context tabs that need project selection:

1. Context > Projects
2. Context > AST
3. Context > Memory Bank
4. Context > Code

Each usage binds row selection to a tab-specific callback and reuses the same component behavior and styling.
