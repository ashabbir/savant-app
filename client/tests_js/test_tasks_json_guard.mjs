import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'tasks.js'), 'utf8');

const sandbox = {
  document: {
    getElementById: () => ({ textContent: '', style: {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  console,
  window: { savantClient: {}, addEventListener: () => {} },
  fetch: async () => ({ ok: true, headers: new Map(), text: async () => '' }),
  renderKanban: () => {},
  updateTaskCount: () => {},
  _populateTaskFilterDropdowns: () => {},
  _applyDayLock: () => {},
  _normalizeTask: t => t,
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'tasks.js' });

const res = {
  ok: false,
  status: 404,
  statusText: 'Not Found',
  headers: { get: () => 'text/html' },
  text: async () => '<!doctype html><html><body>not found</body></html>',
};

try {
  await sandbox._readJsonResponse(res, 'Fetch tasks');
  assert.fail('Expected _readJsonResponse to throw');
} catch (e) {
  assert.match(String(e.message), /Fetch tasks failed/);
  assert.match(String(e.message), /404/);
}

console.log('✓ tasks JSON guard');
