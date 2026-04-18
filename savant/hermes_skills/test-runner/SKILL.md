---
name: test-runner
description: Run Savant backend pytest suite safely — avoid segfaults from the background session preloader by running tests in batches. Use when running tests in the savant-app or hermes-integration worktree.
tags: [savant, testing, pytest, python]
triggers:
  - run tests for savant
  - run the test suite
  - check if tests pass
  - test what changed on this branch
---

# Savant Test Runner

## Context

The Savant Flask backend has ~750+ tests across ~36 test files in `savant/tests/`.
A known pre-existing bug causes **segfaults (exit code 139)** when running the full
suite in one `pytest` invocation. The crash occurs in the background session preloader
(`_bg_worker` / `_bg_build_copilot_sessions`) which spawns a `ThreadPoolExecutor` that
does concurrent `os.walk`/`os.path.isfile`/`os.path.getsize` on real filesystem paths.
When multiple test fixtures trigger this concurrently, CPython segfaults.

## How to Run Tests

### Step 1: Determine what changed (if branch-specific)

```bash
cd ~/Developer/<org>/hermes-integration && git diff main --name-only
```

Focus on `.py` files under `savant/` to identify which test files are relevant.

### Step 2: Run in batches (NOT all at once)

**Always exclude** `test_ui.py` and `test_terminal.py` (Electron/Node tests, not pytest).

Run tests in groups of 5-8 files max to avoid the segfault:

```bash
cd ~/Developer/<org>/hermes-integration/savant

# Batch 1: Hermes tests (most likely to be affected by app.py changes)
python3.13 -m pytest tests/test_hermes_sessions.py tests/test_hermes_integration.py \
  tests/test_hermes_file_mr_jira.py tests/test_hermes_enriched_fields.py \
  tests/test_hermes_checkpoint_merge.py tests/test_hermes_conversation_parity.py \
  tests/test_hermes_session_detect.py tests/test_hermes_usage_parity.py \
  -q --tb=short

# Batch 2: Session provider tests
python3.13 -m pytest tests/test_claude_session_workspace.py \
  tests/test_codex_session_detect.py tests/test_codex_session_workspace.py \
  tests/test_codex_sessions.py tests/test_gemini_sessions.py \
  -q --tb=short

# Batch 3: Knowledge graph tests
python3.13 -m pytest tests/test_knowledge.py tests/test_knowledge_staging.py \
  tests/test_kg_hardening.py tests/test_kg_merge.py tests/test_kg_node_edit.py \
  tests/test_kg_prompt.py tests/test_kg_v55.py tests/test_kg_workspace_stats.py \
  -q --tb=short

# Batch 4: DB/API/core tests (run individually — these trigger the preloader most)
python3.13 -m pytest tests/test_db_base.py -q --tb=short
python3.13 -m pytest tests/test_jira_api.py -q --tb=short
python3.13 -m pytest tests/test_app_refactor.py -q --tb=short

# Batch 5: Remaining tests
python3.13 -m pytest tests/test_bug_fixes.py tests/test_detail_refactor.py \
  tests/test_shared_components.py tests/test_cr7.py tests/test_js_syntax.py \
  tests/test_tabs_component.py tests/test_task_api.py tests/test_task_db.py \
  -q --tb=short
```

### Step 3: Run independent batches in parallel

Batches 1-3 can run concurrently (no dependencies between them). Use separate
terminal calls. Batch 4 should run files individually. Batch 5 can also run
in parallel with the others.

## Pitfalls

- **DO NOT** run `python3.13 -m pytest tests/ -q --tb=short --ignore=tests/test_ui.py --ignore=tests/test_terminal.py` as a single command — it will segfault.
- The segfault is **not caused by test failures** — it's a CPython-level crash in the background thread pool doing filesystem ops.
- If a batch segfaults, split it into smaller groups or run files individually.
- The `test_jira_api.py` and `test_db_base.py` files are most prone to triggering it because they exercise DB fixtures that cause the session preloader to fire.
- Use `python3.13` specifically (that's what's installed via Homebrew on this machine).

## Worktree Note

Default worktree is `~/Developer/<org>/hermes-integration` (branch: hermes-integration).
Main repo is at `~/Developer/<org>/savant-app` (branch: main).
User prefers working in the hermes-integration worktree.
