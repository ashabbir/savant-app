# PRD: Test Case Coverage Status

Date: 2026-04-22
Branch audited: `feat/phase1-client-server-split`

## Executive answer to your questions

1) Do we have frontend unit test cases?
- Yes.
- But they are limited to a small subset of frontend modules.

2) Do we have 100% frontend coverage?
- No.
- Current measured frontend coverage is not 100%.

3) Do we have backend unit test cases?
- Yes.
- There are both focused refactored backend tests and a larger legacy/functional test suite.

4) Do we have 100% backend coverage?
- Yes for a constrained backend module set in `server/pytest.ini`.
- No evidence of 100% coverage for the entire backend codebase.

5) Do we have integration test cases for all backend and frontend?
- No.
- We have a small monorepo integration suite, not full end-to-end coverage of all backend/frontend features.

6) Do we have a full set of Playwright tests with 100% coverage?
- No.
- Playwright coverage instrumentation is not configured, and current run is not fully passing.

---

## What exists today

## A) Frontend tests (client)

### A.1 Node unit tests
- Test command: `npm test`
- Files covered by this command:
  - `client/tests/client_store.test.js`
  - `client/tests/session_service.test.js`
  - `client/tests/context_add_modal.test.js`
- Latest observed run: 15 tests passed.

### A.2 Frontend coverage run
- Test command: `npm run test:coverage`
- Script: `node --test --experimental-test-coverage tests/*.test.js`
- Latest observed coverage output:
  - `client_store.js`: 100% lines / 100% branches / 100% funcs
  - `session_service.js`: 64.01% lines / 45.24% branches / 82.50% funcs
  - `all files` (within this run scope): 74.31% lines / 56.60% branches / 87.72% funcs

Conclusion:
- Frontend measured coverage is **not** 100%.
- Coverage scope is narrow (only files loaded by `tests/*.test.js`).
- Renderer-heavy JS modules are not part of this numeric coverage report.

### A.3 Frontend contract/structural tests
- Test command: `npm run test:frontend`
- Files:
  - `client/tests_js/test_context_modules.js`
  - `client/tests_js/test_terminal_integration.js`
  - `client/tests_js/test_local_session_bridge.js`
- Latest observed run: passed.

Conclusion:
- Good contract-level checks exist.
- This layer does not provide full frontend code coverage %.

---

## B) Backend tests (server)

### B.1 Refactored unit test suite (the one run by default)
- Test command: `./server/run-tests.sh`
- Uses `server/pytest.ini`:
  - `testpaths = tests_refactored`
  - coverage target modules only:
    - `hardening`
    - `db.base`
    - `models`
    - `abilities.resolver`
    - `abilities.bootstrap`
    - `server_paths`
  - `--cov-fail-under=100`
- Latest observed run: 29 tests passed; coverage 100% for those modules.

Conclusion:
- Backend has enforced 100% coverage for a **selected subset** of modules.

### B.2 Additional backend test suite (not in default `pytest.ini` path)
- `server/tests/` contains many tests (42 test files; large functional/feature surface).
- This includes sessions, KG, UI/terminal structural checks, API behavior, ingestion tests, etc.

Conclusion:
- Backend test volume is substantial.
- Default coverage gate does not claim 100% for the full server app.

---

## C) Integration tests (monorepo)

- Command from root runner: `pytest tests -v`
- Current files:
  - `tests/test_client_server_integration.py`
  - `tests/test_repo_hygiene.py`
  - `tests/test_test_pipeline_contract.py`
- Latest observed run: 4 tests passed.

Conclusion:
- Integration coverage exists but is minimal.
- Not a complete integration matrix for all backend endpoints and frontend flows.

---

## D) Playwright UI/E2E tests

- Command: `npm run test:ui`
- Config: `client/playwright.config.js`
- Test files:
  - `tests_ui/electron.app.smoke.spec.js`
  - `tests_ui/electron.context.spec.js`
  - `tests_ui/electron.modes.spec.js`
- Latest observed run:
  - 10 passed
  - 1 failed (`left rail switches to terminal view and back` timeout)
  - worker teardown timeout reported

Conclusion:
- Playwright suite is present but not fully green currently.
- No code coverage instrumentation/reporting configured for Playwright, so 100% Playwright coverage cannot be claimed.

---

## Coverage gap matrix (missing areas)

1) Frontend unit coverage gap
- `session_service.js` branch/line gaps remain significant.
- Most renderer modules in `client/renderer/static/js/*` are not part of numeric unit coverage.

2) Frontend E2E stability gap
- One Playwright test currently timing out.
- Need deterministic terminal-view transition assertions.

3) Backend full-codebase coverage gap
- 100% gate applies to selected modules only.
- Large portions of `server/app.py`, `server/context/*`, `server/knowledge/*`, `server/mcp/*`, and many db modules are not included in that enforced 100% target set.

4) Integration breadth gap
- Current integration tests validate only a few contracts.
- Missing broad integration checks for:
  - project ingestion happy/error paths
  - workspace/task lifecycle end-to-end
  - context indexing + AST + search end-to-end
  - notification/event stream flows
  - session-linking end-to-end across providers

5) Playwright coverage observability gap
- No JS/CSS coverage collection pipeline in Playwright config.
- Cannot quantify “% UI coverage” today.

---

## Recommended target state

1) Frontend
- Raise `session_service.js` to >=90% branch coverage first, then 100% if required.
- Expand `tests/*.test.js` to include additional non-DOM logic modules.
- Keep `tests_js/*` as contract guards and add missing ingestion modal UX scenarios.

2) Backend
- Decide policy explicitly:
  - Option A: Keep 100% for critical core modules only (current style), OR
  - Option B: Expand coverage target list gradually to include major runtime modules.
- If Option B, add modules to `--cov=` incrementally with milestone thresholds.

3) Integration
- Add scenario-driven integration suite for major user journeys (ingestion, workspace/task, indexing/search, notifications).

4) Playwright
- Fix flaky timeout test.
- Add CI profile + retries/quarantine policy.
- If numeric UI coverage is desired, add Playwright + Istanbul instrumentation pipeline and publish artifacts.

---

## Current factual status snapshot

- Frontend unit tests: present ✅
- Frontend 100% coverage: no ❌
- Backend unit tests: present ✅
- Backend 100% coverage: yes for selected modules only ⚠️
- Full backend/frontend integration coverage: no ❌
- Full Playwright suite at 100% coverage: no ❌
