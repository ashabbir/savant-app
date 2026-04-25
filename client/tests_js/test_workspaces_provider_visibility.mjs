import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'workspaces.js'), 'utf8');

const wsGrid = { innerHTML: '', querySelectorAll: () => [], addEventListener: () => {} };
const wsDash = { innerHTML: '' };

const sandbox = {
  document: {
    getElementById: id => {
      if (id === 'ws-grid') return wsGrid;
      if (id === 'ws-dashboard') return wsDash;
      return { value: '', innerHTML: '', style: {}, addEventListener: () => {} };
    },
    querySelectorAll: () => [],
  },
  window: {},
  console,
  escapeHtml: s => String(s),
  _workspaces: [
    {
      id: 'ws-1',
      name: 'Alpha',
      priority: 'medium',
      color: '#00f0ff',
      status: 'open',
      counts: { total: 4, copilot: 1, claude: 2, codex: 3, gemini: 4, hermes: 5 },
      task_stats: { total: 17, done: 14, in_progress: 1, blocked: 1 },
      jira_count: 6,
      jira_status_counts: { todo: 2, 'in-progress': 1, done: 3 },
      mr_status_counts: {},
      session_status_counts: {},
      kg_stats: {},
      created_at: '2026-04-25T00:00:00Z',
    },
  ],
  _wsStatusFilter: 'open',
  _wsLoadError: '',
  _prefs: { enabled_providers: ['hermes', 'codex'], selected_provider: 'codex' },
  timeAgo: () => 'recently',
  _populateTaskFilterDropdowns: () => {},
  renderSessions: () => {},
  updateWsCount: () => {},
  fetch: async () => ({ ok: true, json: async () => [] }),
  setTimeout: (fn) => (fn(), 1),
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'workspaces.js' });

sandbox.renderWorkspaces();
assert.match(wsGrid.innerHTML, /ws-provider-chip codex/);
assert.doesNotMatch(wsGrid.innerHTML, /ws-provider-chip hermes/);
assert.doesNotMatch(wsGrid.innerHTML, /ws-provider-chip copilot/);
assert.doesNotMatch(wsGrid.innerHTML, /ws-provider-chip claude/);
assert.doesNotMatch(wsGrid.innerHTML, /ws-provider-chip gemini/);
assert.match(wsDash.innerHTML, /TASKS/);
assert.match(wsDash.innerHTML, /17/);
assert.match(wsDash.innerHTML, /82% complete/);
assert.doesNotMatch(wsDash.innerHTML, /COMPLETION/);
assert.match(wsDash.innerHTML, /JIRA/);
assert.match(wsDash.innerHTML, /6/);
assert.match(wsDash.innerHTML, /2 Todo/);
assert.match(wsDash.innerHTML, /1 In Progress/);
assert.match(wsDash.innerHTML, /3 Done/);
assert.match(wsDash.innerHTML, /selected in profile: Codex/);

console.log('✓ workspaces provider visibility');
