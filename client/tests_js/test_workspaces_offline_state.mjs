import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'workspaces.js'), 'utf8');

const grid = { innerHTML: '' };
const dash = { innerHTML: '' };

const sandbox = {
  document: {
    getElementById: id => {
      if (id === 'ws-grid') return grid;
      if (id === 'ws-dashboard') return dash;
      return { value: '', innerHTML: '', style: {}, addEventListener: () => {} };
    },
    querySelectorAll: () => [],
  },
  window: {},
  console,
  escapeHtml: s => String(s),
  _workspaces: [],
  _wsLoadError: 'Failed to fetch workspaces',
  _wsStatusFilter: 'open',
  _populateTaskFilterDropdowns: () => {},
  renderSessions: () => {},
  updateWsCount: () => {},
  fetch: async () => ({
    ok: false,
    status: 404,
    headers: { get: () => 'text/html' },
    text: async () => '<!doctype html><html><body>offline</body></html>',
  }),
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'workspaces.js' });

sandbox.renderWorkspaces();
assert.match(grid.innerHTML, /WORKSPACES OFFLINE/);
assert.match(grid.innerHTML, /Could not load workspaces/);

console.log('✓ workspaces offline state');
