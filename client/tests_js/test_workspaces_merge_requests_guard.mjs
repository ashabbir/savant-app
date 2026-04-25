import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'workspaces.js'), 'utf8');

const mrs = { innerHTML: '', dataset: {} };

const sandbox = {
  document: {
    getElementById: id => {
      if (id === 'ws-detail-mrs') return mrs;
      return { value: '', innerHTML: '', style: {}, addEventListener: () => {}, dataset: {} };
    },
    querySelectorAll: () => [],
  },
  window: {},
  console,
  escapeHtml: s => String(s),
  _workspaces: [],
  _currentWsId: 'ws-1',
  _wsDetailSessions: [],
  renderWorkspaces: () => {},
  updateWsCount: () => {},
  populateWsFilter: () => {},
  _populateTaskFilterDropdowns: () => {},
  fetch: async () => ({
    ok: false,
    status: 404,
    headers: { get: () => 'text/html' },
    text: async () => '<!doctype html><html><body>not json</body></html>',
  }),
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'workspaces.js' });

await sandbox.loadWsMergeRequests();
await new Promise(resolve => setImmediate(resolve));

assert.match(mrs.innerHTML, /Failed to load:/);
assert.doesNotMatch(mrs.innerHTML, /Unexpected token/);

console.log('✓ workspaces merge requests guard');
