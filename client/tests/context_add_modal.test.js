'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CORE_PATH = path.resolve(__dirname, '../renderer/static/js/context-core.js');

function makeElement() {
  return {
    value: '',
    innerHTML: '',
    textContent: '',
    disabled: false,
    style: { display: '' },
    className: '',
    classList: { add: () => {}, remove: () => {} },
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
  };
}

function buildSandbox(fetchImpl, toastLog) {
  const els = {
    'ctx-add-modal': makeElement(),
    'ctx-add-source': makeElement(),
    'ctx-add-fallback': makeElement(),
    'ctx-add-repo-fields': makeElement(),
    'ctx-add-directory-fields': makeElement(),
    'ctx-add-submit': makeElement(),
    'ctx-add-url': makeElement(),
    'ctx-add-branch': makeElement(),
    'ctx-add-directory': makeElement(),
  };

  const sandbox = {
    document: {
      getElementById: (id) => els[id] || makeElement(),
      querySelector: () => null,
      querySelectorAll: () => [],
      activeElement: null,
      createElement: () => makeElement(),
    },
    window: {
      location: { reload: () => {} },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    fetch: fetchImpl,
    confirm: () => true,
    showToast: (level, msg) => toastLog.push({ level, msg }),
    _mcpTestConnection: async () => ({}),
    _ctxProjects: [],
    console,
  };

  vm.createContext(sandbox);
  const code = fs.readFileSync(CORE_PATH, 'utf8');
  vm.runInContext(code, sandbox, { filename: 'context-core.js' });

  return { sandbox, els };
}

test('ctxAddProject renders enabled sources only', async () => {
  const toasts = [];
  const { sandbox, els } = buildSandbox(async (url) => {
    assert.equal(url, '/api/context/repos/sources');
    return {
      ok: true,
      json: async () => ({
        sources: {
          github: { enabled: true },
          gitlab: { enabled: false },
          directory: { enabled: true },
        },
      }),
    };
  }, toasts);

  await sandbox.ctxAddProject();

  assert.equal(els['ctx-add-modal'].style.display, 'flex');
  assert.match(els['ctx-add-source'].innerHTML, /github/i);
  assert.match(els['ctx-add-source'].innerHTML, /directory/i);
  assert.doesNotMatch(els['ctx-add-source'].innerHTML, /gitlab/i);
  assert.equal(els['ctx-add-source'].disabled, false);
  assert.equal(toasts.length, 0);
});

test('ctxAddProject shows fallback and disables submit when no sources are configured', async () => {
  const toasts = [];
  const { sandbox, els } = buildSandbox(async () => ({
    ok: true,
    json: async () => ({
      sources: {
        github: { enabled: false },
        gitlab: { enabled: false },
        directory: { enabled: false },
      },
    }),
  }), toasts);

  await sandbox.ctxAddProject();

  assert.equal(els['ctx-add-fallback'].style.display, 'block');
  assert.match(els['ctx-add-fallback'].textContent, /No project sources are configured/);
  assert.equal(els['ctx-add-submit'].disabled, true);
});

test('ctxConfirmAdd submits GitHub payload and toggles loading label', async () => {
  const toasts = [];
  const calls = [];
  let resolvePost;

  const { sandbox, els } = buildSandbox(async (url, init) => {
    calls.push({ url, init });
    if (url === '/api/context/repos/sources') {
      return {
        ok: true,
        json: async () => ({
          sources: {
            github: { enabled: true },
            gitlab: { enabled: false },
            directory: { enabled: false },
          },
        }),
      };
    }
    return await new Promise((resolve) => {
      resolvePost = () => resolve({ ok: true, json: async () => ({ name: 'repo-a' }) });
    });
  }, toasts);

  let refreshed = 0;
  sandbox.ctxLoadProjects = () => { refreshed += 1; };

  await sandbox.ctxAddProject();
  els['ctx-add-source'].value = 'github';
  sandbox.ctxUpdateAddSourceUI();
  els['ctx-add-url'].value = 'https://github.com/acme/repo-a.git';
  els['ctx-add-branch'].value = 'main';

  const pending = sandbox.ctxConfirmAdd();
  assert.equal(els['ctx-add-submit'].textContent, 'Preparing project...');
  assert.equal(els['ctx-add-submit'].disabled, true);

  resolvePost();
  await pending;

  const postCall = calls.find((c) => c.url === '/api/context/repos');
  assert.ok(postCall);
  assert.deepEqual(JSON.parse(postCall.init.body), {
    source: 'github',
    url: 'https://github.com/acme/repo-a.git',
    branch: 'main',
  });
  assert.equal(els['ctx-add-submit'].textContent, 'ADD PROJECT');
  assert.equal(refreshed, 1);
  assert.ok(toasts.some((t) => t.level === 'success'));
});

test('ctxConfirmAdd submits directory payload and reports API errors', async () => {
  const toasts = [];

  const { sandbox, els } = buildSandbox(async (url, init) => {
    if (url === '/api/context/repos/sources') {
      return {
        ok: true,
        json: async () => ({
          sources: {
            github: { enabled: false },
            gitlab: { enabled: false },
            directory: { enabled: true },
          },
        }),
      };
    }
    assert.equal(url, '/api/context/repos');
    assert.deepEqual(JSON.parse(init.body), {
      source: 'directory',
      directory: 'apps/service-x',
    });
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: 'Path must stay within BASE_CODE_DIR' }),
    };
  }, toasts);

  await sandbox.ctxAddProject();
  els['ctx-add-source'].value = 'directory';
  sandbox.ctxUpdateAddSourceUI();
  els['ctx-add-directory'].value = 'apps/service-x';

  await sandbox.ctxConfirmAdd();

  assert.ok(toasts.some((t) => t.level === 'error' && /BASE_CODE_DIR/.test(t.msg)));
});
