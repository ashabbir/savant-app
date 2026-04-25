import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'core.js'), 'utf8');

const sysEl = { className: '', textContent: '', innerHTML: '' };
const releaseModal = { style: {} };
const genericEl = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add: () => {}, remove: () => {} } });

const sandbox = {
  document: {
    getElementById: id => {
      if (id === 'sys-status-content') return sysEl;
      if (id === 'release-modal') return releaseModal;
      if (id && id.startsWith('hero-')) return genericEl();
      return genericEl();
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  window: {},
  location: { origin: 'http://127.0.0.1:8090' },
  localStorage: {
    getItem: key => (key === 'savant_seen_release' ? 'v8.1.5' : null),
    setItem: () => {},
  },
  currentMode: 'codex',
  _prefs: { name: 'Ada', selected_provider: 'gemini' },
  console,
  setTimeout: (fn) => { fn(); return 1; },
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      mcp_servers: { workspace: '', abilities: '' },
      abilities: { asset_count: 2, bootstrap_available: false, seed_path: '/tmp/seed' },
      flask: undefined,
      database: undefined,
      directories: {},
      environment: {},
      build: {},
      blueprints: [],
      context_sources: {},
    }),
    text: async () => JSON.stringify({
      mcp_servers: { workspace: '', abilities: '' },
      abilities: { asset_count: 2, bootstrap_available: false, seed_path: '/tmp/seed' },
      flask: undefined,
      database: undefined,
      directories: {},
      environment: {},
      build: {},
      blueprints: [],
      context_sources: {},
    }),
    headers: { get: () => 'application/json' },
  }),
  AbortSignal: { timeout: () => ({}) },
  escapeHtml: s => String(s),
  logMcpGuide: () => {},
  showToast: () => {},
  bootstrapAbilities: () => {},
  setupMcpAgent: () => {},
  refreshSystemStatus: () => {},
  _fmtBytes: v => String(v),
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'core.js' });

await sandbox.fetchSystemStatus();

assert.match(sysEl.innerHTML, /MCP Servers/);
assert.match(sysEl.innerHTML, /Port/);
assert.match(sysEl.innerHTML, /Legend/);
assert.match(sysEl.innerHTML, /Server-owned/);
assert.match(sysEl.innerHTML, /Client-owned/);
assert.match(sysEl.innerHTML, /Context Sources/);
assert.match(sysEl.innerHTML, /Client Settings/);
assert.match(sysEl.innerHTML, /GITHUB_TOKEN/);
assert.match(sysEl.innerHTML, /SAVANT_SERVER_URL/);
assert.match(sysEl.innerHTML, /wf-mode/);
assert.match(sysEl.innerHTML, /prefs\.name/);
assert.match(sysEl.innerHTML, /prefs\.selected_provider/);
assert.doesNotMatch(sysEl.innerHTML, /Failed to load system info/);

console.log('✓ system info render');
