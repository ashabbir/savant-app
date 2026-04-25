import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'tasks.js'), 'utf8');

const jiraBody = { innerHTML: '' };
const mrBody = { innerHTML: '' };

const sandbox = {
  document: {
    getElementById: id => {
      if (id === 'all-jira-modal') return { style: {} };
      if (id === 'all-mrs-modal') return { style: {} };
      if (id === 'all-jira-body') return jiraBody;
      if (id === 'all-mrs-body') return mrBody;
      if (id === 'all-jira-filter-assignee') return { value: '' };
      if (id === 'all-jira-filter-status') return { value: '' };
      return { textContent: '', style: {}, dataset: {} };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  window: {},
  console,
  fetch: async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => '<!doctype html><html><body>not json</body></html>',
  }),
  escapeHtml: s => s,
  navigateToSessionDirect: () => {},
  closeAllMrsModal: () => {},
  _mrsFilter: 'open',
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'tasks.js' });

await sandbox.loadAllJiraTickets();
assert.match(jiraBody.innerHTML, /Failed to load:/);
assert.match(jiraBody.innerHTML, /Load Jira tickets/);
assert.doesNotMatch(jiraBody.innerHTML, /Unexpected token/);

await sandbox.openAllMrsModal();
assert.match(mrBody.innerHTML, /Failed to load:/);
assert.match(mrBody.innerHTML, /Load merge requests/);
assert.doesNotMatch(mrBody.innerHTML, /Unexpected token/);

console.log('✓ tasks JIRA/MR modal JSON guard');
