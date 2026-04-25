import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'workspaces.js'), 'utf8');

const grid = { innerHTML: '', querySelectorAll: () => [], addEventListener: () => {} };
const dash = { innerHTML: '' };

const sandbox = {
  document: {
    getElementById: id => {
      if (id === 'ws-grid') return grid;
      if (id === 'ws-dashboard') return dash;
      if (id === 'mode-workspaces-count') return { textContent: '' };
      return { value: '', innerHTML: '', style: {}, addEventListener: () => {} };
    },
    querySelectorAll: () => [],
  },
  window: {},
  console,
  escapeHtml: s => String(s),
  _workspaces: [],
  _wsStatusFilter: 'open',
  _wsLoadError: '',
  _prefs: { enabled_providers: ['codex'] },
  timeAgo: () => 'recently',
  _populateTaskFilterDropdowns: () => {},
  renderSessions: () => {},
  updateWsCount: () => {},
  fetch: async () => ({
    ok: false,
    status: 404,
    headers: { get: () => 'text/html' },
    text: async () => '<!doctype html><html><body>not json</body></html>',
  }),
  setTimeout: (fn) => (fn(), 1),
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'workspaces.js' });

await sandbox.fetchWorkspaces();

assert.match(grid.innerHTML, /WORKSPACES OFFLINE/);
assert.match(grid.innerHTML, /Load workspaces failed \(404\):/);
assert.doesNotMatch(grid.innerHTML, /Unexpected token/);

console.log('✓ workspaces fetch guard');
