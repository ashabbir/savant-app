# Loop 2

## Analysis
- Documentation/runtime drift existed after removing browser mode entry points.
- Risk: feature could reappear from future menu or renderer edits without a guard test.

## TDD Changes
- Added split-contract test in [test_terminal_integration.js](/Users/ahmedshabbir/code/savant-app/client/tests_js/test_terminal_integration.js):
  - `client no longer exposes open-in-browser surface`
- Updated guide layout docs in [guide.js](/Users/ahmedshabbir/code/savant-app/client/renderer/guide.js):
  - Removed browser icon from left bar diagram.
  - Removed browser row from left action bar table.

## Documentation
- README loop ledger updated.
- Guide engineering updates table updated.

## Verification
- `cd client && ./run-tests.sh`
- Result: all client suites passed.
