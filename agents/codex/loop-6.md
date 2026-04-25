# Loop 6

## Analysis
- Reindex handlers still existed in context-core even after UI decision to remove reindex actions.
- Keeping dead action handlers risks accidental UI reintroduction and API drift.

## TDD Changes
- Removed `ctxReindexProject` and `ctxReindexAll` from [context-core.js](/Users/ahmedshabbir/code/savant-app/client/renderer/static/js/context-core.js).
- Updated [test_context_modules.js](/Users/ahmedshabbir/code/savant-app/client/tests_js/test_context_modules.js):
  - removed reindex function expectations from export list
  - added `context action surface excludes reindex actions` regression assertion

## Documentation
- README loop ledger updated.
- Guide engineering updates table updated.

## Verification
- `cd client && node tests_js/test_context_modules.js`
- Result: 95 passed, 0 failed.
