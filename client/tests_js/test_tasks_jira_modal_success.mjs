import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'tasks.js'), 'utf8');

const jiraBody = { innerHTML: '' };
const requests = [];

const sandbox = {
  document: {
    getElementById: id => {
      if (id === 'all-jira-modal') return { style: {} };
      if (id === 'all-mrs-modal') return { style: {} };
      if (id === 'all-jira-body') return jiraBody;
      if (id === 'all-mrs-body') return { innerHTML: '' };
      if (id === 'all-jira-filter-assignee') return { value: 'Ada' };
      if (id === 'all-jira-filter-status') return { value: 'todo' };
      return { textContent: '', style: {}, dataset: {} };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  window: {},
  console,
  fetch: async (url) => {
    requests.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ([
        {
          ticket_key: 'ALL-123',
          title: 'Aggregate jira ticket',
          status: 'todo',
          priority: 'medium',
          assignee: 'Ada',
          sessions: [{ id: 'h-1', provider: 'hermes', summary: 'Hermes session', role: 'assignee' }],
        },
      ]),
      text: async () => JSON.stringify([
        {
          ticket_key: 'ALL-123',
          title: 'Aggregate jira ticket',
          status: 'todo',
          priority: 'medium',
          assignee: 'Ada',
          sessions: [{ id: 'h-1', provider: 'hermes', summary: 'Hermes session', role: 'assignee' }],
        },
      ]),
    };
  },
  escapeHtml: s => s,
  navigateToSessionDirect: () => {},
  closeAllMrsModal: () => {},
  _mrsFilter: 'open',
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'tasks.js' });

await sandbox.loadAllJiraTickets();

assert.equal(requests.length, 1);
assert.match(requests[0], /\/api\/all-jira-tickets/);
assert.match(jiraBody.innerHTML, /Aggregate jira ticket/);
assert.match(jiraBody.innerHTML, /ALL-123/);

console.log('✓ tasks JIRA modal success');
