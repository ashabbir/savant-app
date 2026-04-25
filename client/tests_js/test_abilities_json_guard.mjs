import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'abilities.js'), 'utf8');

const sandbox = {
  document: { getElementById: () => ({ addEventListener: () => {} }), readyState: 'complete' },
  showToast: () => {},
  _mcpTestConnection: async () => {},
  fetch: async () => ({ ok: true, text: async () => '' }),
  console,
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'abilities.js' });

const res = {
  status: 404,
  url: 'http://127.0.0.1/api/abilities/assets',
  text: async () => '<!doctype html><html><body>not found</body></html>',
};

try {
  await sandbox._readJsonResponse(res);
  assert.fail('Expected _readJsonResponse to throw');
} catch (e) {
  assert.match(String(e.message), /Non-JSON response/);
  assert.match(String(e.message), /not found/);
}

console.log('✓ abilities JSON guard');
