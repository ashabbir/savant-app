import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'knowledge.js'), 'utf8');

const panel = { innerHTML: '' };
const chain = { attr: () => chain, style: () => chain, text: () => chain, append: () => chain, selectAll: () => chain, remove: () => chain, call: () => chain };
let selectedNodeArg = null;
const requests = [];

const sandbox = {
  document: {
    getElementById: id => {
      if (id === 'kb-detail-content') return panel;
      if (id === 'kb-detail-panel') return { style: { width: '320px' } };
      if (id === 'kb-panel-expand-btn') return { style: {} };
      return { innerHTML: '', style: {}, classList: { add: () => {}, remove: () => {} }, querySelectorAll: () => [] };
    },
    querySelectorAll: () => [],
  },
  window: {},
  console,
  d3: {
    select: () => ({ selectAll: () => chain, call: () => {}, append: () => chain }),
    zoom: () => ({ scaleExtent: () => ({ on: () => ({}) }) }),
    forceSimulation: () => ({ stop: () => {}, force: () => {}, on: () => {} }),
    forceLink: () => ({ id: () => ({ distance: () => ({ strength: () => ({}) }) }) }),
    forceManyBody: () => ({ strength: () => ({}) }),
    forceCenter: () => ({ strength: () => ({}) }),
    forceCollide: () => ({ radius: () => ({}) }),
    zoomIdentity: {},
    drag: () => ({ on: () => ({}) }),
    selectAll: () => chain,
  },
  escapeHtml: s => String(s),
  marked: undefined,
  confirm: () => true,
  alert: () => {},
  navigator: { clipboard: { writeText: () => {} } },
  fetch: async (url, opts = {}) => {
    requests.push({ url, opts });
    return { ok: true, json: async () => ({ workspaces: [] }), text: async () => 'ok' };
  },
  loadWsKnowledge: async () => {},
  kbExploreNode: () => {},
  _kbGraphData: {
    nodes: [{
      node_id: 'node-1',
      node_type: 'insight',
      title: 'Knowledge Node',
      content: 'hello',
      metadata: { workspaces: ['ws-a', 'ws-b'], repo: 'repo-a', files: ['a.js'] },
    }],
    edges: [],
  },
  _kbWsId: 'ws-1',
  KB_NODE_ICONS: { insight: '💡' },
  KB_NODE_COLORS: { insight: '#818cf8' },
  KB_EDGE_COLORS: {},
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'knowledge.js' });

vm.runInContext(`
  _kbWsId = 'ws-1';
  _kbGraphData = {
    nodes: [{
      node_id: 'node-1',
      node_type: 'insight',
      title: 'Knowledge Node',
      content: 'hello',
      metadata: { workspaces: ['ws-a', 'ws-b'], repo: 'repo-a', files: ['a.js'] },
    }],
    edges: [],
  };
`, sandbox);

sandbox.kbEditNode('node-1');
assert.match(panel.innerHTML, /EDIT NODE/);
assert.match(panel.innerHTML, /kb-edit-title/);
assert.match(panel.innerHTML, /kb-edit-type/);
assert.match(panel.innerHTML, /kb-edit-content/);
assert.match(panel.innerHTML, /kb-edit-repo/);
assert.match(panel.innerHTML, /kb-edit-files/);
assert.match(panel.innerHTML, /kbSaveNode\('node-1'\)/);

panel.innerHTML = '';
requests.length = 0;

await sandbox.kbUnlinkWorkspace('node-1', 'ws-a');
assert.equal(requests[0].url, '/api/knowledge/unlink-workspace');
assert.match(requests[0].opts.body, /"workspace_id":"ws-a"/);
assert.ok(requests.length >= 1);

console.log('✓ knowledge edit/unlink render');
