import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'workspaces.js'), 'utf8');

const jiraBody = { innerHTML: '', dataset: {} };
const requests = [];

const sandbox = {
  document: {
    getElementById: id => {
      if (id === 'ws-detail-jira') return jiraBody;
      if (id === 'ws-grid') return { querySelectorAll: () => [], addEventListener: () => {} };
      return { value: '', innerHTML: '', style: {}, dataset: {}, addEventListener: () => {} };
    },
    querySelectorAll: () => [],
  },
  window: {},
  console,
  escapeHtml: s => String(s),
  _workspaces: [],
  _wsStatusFilter: 'all',
  _currentWsId: 'ws-1',
  _wsDetailSessions: [],
  timeAgo: () => 'recently',
  renderWorkspaces: () => {},
  updateWsCount: () => {},
  populateWsFilter: () => {},
  _populateTaskFilterDropdowns: () => {},
  fetch: async (url) => {
    requests.push(url);
    if (String(url).includes('/api/tasks/jira')) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => 'text/html' },
        text: async () => '<!doctype html><html><body>not found</body></html>',
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify([{ ticket_key: 'ABC-1', title: 'Fallback ticket', status: 'todo' }]),
      json: async () => [{ ticket_key: 'ABC-1', title: 'Fallback ticket', status: 'todo' }],
    };
  },
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'workspaces.js' });

await sandbox.loadWsJiraTickets();
await new Promise(resolve => setImmediate(resolve));

assert.ok(requests.some(r => /\/api\/tasks\/jira/.test(r)));
assert.ok(requests.some(r => /\/api\/jira-tickets/.test(r)));
assert.match(jiraBody.innerHTML, /Fallback ticket/);
assert.doesNotMatch(jiraBody.innerHTML, /Failed to load:/);

console.log('✓ workspaces jira fallback');
