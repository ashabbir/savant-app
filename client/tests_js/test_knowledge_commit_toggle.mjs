import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'knowledge.js'), 'utf8');

const panel = { innerHTML: '' };
const chain = {
  attr: () => chain,
  style: () => chain,
  text: () => chain,
  append: () => chain,
  selectAll: () => chain,
  remove: () => chain,
  call: () => chain,
};
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
    select: () => ({
      selectAll: () => chain,
      call: () => {},
      append: () => chain,
    }),
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
  fetch: async () => ({ ok: true, json: async () => ({ workspaces: [] }) }),
  confirm: () => true,
  alert: () => {},
  navigator: { clipboard: { writeText: () => {} } },
  loadWsKnowledge: async () => {},
  kbExploreNode: () => {},
  _kbGraphData: { nodes: [], edges: [] },
  _kbWsId: 'ws-1',
  KB_NODE_ICONS: { insight: '💡' },
  KB_NODE_COLORS: { insight: '#818cf8' },
  KB_EDGE_COLORS: {},
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'knowledge.js' });
vm.runInContext(`_kbWsId = 'ws-1';`, sandbox);

sandbox.kbSelectNode({
  node_id: 'node-staged',
  node_type: 'insight',
  title: 'Staged Node',
  status: 'staged',
  content: 'hello',
});
assert.match(panel.innerHTML, /✓ Commit/);
assert.doesNotMatch(panel.innerHTML, /↺ Uncommit/);

sandbox.kbSelectNode({
  node_id: 'node-committed',
  node_type: 'insight',
  title: 'Committed Node',
  status: 'committed',
  content: 'hello',
});
assert.match(panel.innerHTML, /↺ Uncommit/);
assert.doesNotMatch(panel.innerHTML, /✓ Commit/);

console.log('✓ knowledge commit toggle render');
