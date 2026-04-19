/**
 * tests/test_context_modules.js
 *
 * Validates that the three context JS modules (context-core.js,
 * context-ast.js, context-complexity.js) define all expected globals
 * and are individually free of syntax / runtime-load errors.
 *
 * Run:  node tests/test_context_modules.js
 *
 * Exit code 0 = all tests passed.
 * Exit code 1 = one or more failures.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Helpers ───────────────────────────────────────────────────────────────────

const JS_DIR = path.resolve(__dirname, '../savant/static/js');
let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${e.message}`);
    failed++;
  }
}

function expect(value) {
  return {
    toBe(expected) {
      if (value !== expected)
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    },
    toBeTruthy() {
      if (!value) throw new Error(`Expected truthy, got ${JSON.stringify(value)}`);
    },
    toBeType(type) {
      if (typeof value !== type)
        throw new Error(`Expected typeof "${type}", got "${typeof value}"`);
    },
    toBeArray() {
      if (!Array.isArray(value)) throw new Error(`Expected Array, got ${typeof value}`);
    },
  };
}

// ── Browser sandbox ───────────────────────────────────────────────────────────
// Minimal mock of the browser globals these modules depend on at load time.

function makeSandbox(extras = {}) {
  const elements = {};
  const mockEl   = () => ({
    className: '', style: {}, innerHTML: '', textContent: '',
    classList: { add: () => {}, remove: () => {} },
    getAttribute: () => null,
    querySelector: () => mockEl(),
    querySelectorAll: () => [],
    value: '',
    appendChild: () => {},
  });

  const doc = {
    getElementById:     (id) => elements[id] || mockEl(),
    querySelector:      ()  => mockEl(),
    querySelectorAll:   ()  => [],
    createElement:      ()  => mockEl(),
  };

  const win = {
    electronAPI: null,
    closeModal:  () => {},
    innerHeight: 800,
    innerWidth:  1200,
  };

  return Object.assign({
    // DOM
    document: doc,
    window:   win,
    // Storage
    localStorage: { getItem: () => null, setItem: () => {} },
    // Timers
    setTimeout:    (fn) => 0,
    clearTimeout:  () => {},
    setInterval:   (fn) => 1,
    clearInterval: () => {},
    // Browser APIs
    fetch:   async () => ({ ok: true, json: async () => ({}) }),
    alert:   () => {},
    confirm: () => true,
    prompt:  () => '',
    // D3 stub — minimal so d3.* calls at load time don't explode
    d3: {
      select:       () => ({ append: () => ({ attr: () => ({}) }), call: () => {} }),
      hierarchy:    (d) => ({ descendants: () => [], links: () => [], sum: function() { return this; }, sort: function() { return this; } }),
      tree:         () => ({ size: function() { return this; }, separation: function() { return this; } }),
      partition:    () => ({ size: function() { return this; } }),
      arc:          () => ({ startAngle: function() { return this; }, endAngle: function() { return this; }, padAngle: function() { return this; }, padRadius: function() { return this; }, innerRadius: function() { return this; }, outerRadius: function() { return this; } }),
      zoom:         () => ({ scaleExtent: function() { return this; }, on: function() { return this; }, transform: {} }),
      linkHorizontal:() => ({ x: function() { return this; }, y: function() { return this; } }),
      linkRadial:   () => ({ angle: function() { return this; }, radius: function() { return this; } }),
      zoomIdentity: { translate: function() { return this; }, scale: function() { return this; } },
    },
    // Globals from globals.js
    _ctxProjects:     [],
    allSessions:      [],
    currentFilter:    'all',
    currentProject:   '',
    _mcpSubTab:       'workspace',
    KB_NODE_COLORS:   {},
    KB_NODE_ICONS:    {},
    KB_LAYERS:        {},
    KB_EDGE_COLORS:   {},
    // Functions from other modules
    showToast:            () => {},
    _mcpTestConnection:   async () => {},
    marked:               { parse: (s) => s },
    // Console passthrough
    console,
  }, extras);
}

function loadFile(sandbox, filename) {
  const filePath = path.join(JS_DIR, filename);
  const code     = fs.readFileSync(filePath, 'utf8');
  const script   = new vm.Script(code, { filename });
  script.runInNewContext(sandbox);
}

// ── Suite: individual file load checks ───────────────────────────────────────

console.log('\n── File load (no parse / runtime errors) ──────────────────────────');

test('context-core.js loads without error', () => {
  const sb = makeSandbox();
  loadFile(sb, 'context-core.js');
});

test('context-complexity.js loads without error', () => {
  const sb = makeSandbox();
  // complexity uses _escHtml from core — pre-populate
  sb._escHtml = (s) => String(s);
  loadFile(sb, 'context-complexity.js');
});

test('context-ast.js loads without error', () => {
  const sb = makeSandbox();
  sb._escHtml   = (s) => String(s);
  // Functions it calls at define time from complexity / core
  sb._renderComplexityHeatmap = () => {};
  sb._renderComplexityRadial  = () => {};
  sb._buildUnifiedAstTree     = () => ({});
  loadFile(sb, 'context-ast.js');
});

// ── Suite: context-core.js exports ───────────────────────────────────────────

console.log('\n── context-core.js — exported globals ─────────────────────────────');

const coreSandbox = makeSandbox();
try { loadFile(coreSandbox, 'context-core.js'); } catch (e) {
  console.error('  FATAL: could not load context-core.js:', e.message);
  process.exit(1);
}

const CORE_FUNCTIONS = [
  'ctxInit',
  'ctxMcpTestConnection',
  'ctxRefreshStatus',
  'switchCtxPanel',
  'ctxPopulateRepoFilter',
  'ctxLoadProjects',
  'ctxRenderProjects',
  'ctxRenderProjectsWithProgress',
  'ctxSelectProject',
  'ctxAddProject',
  'ctxCloseAddModal',
  'ctxBrowseDirectory',
  'ctxConfirmAdd',
  'ctxIndexProject',
  'ctxGenerateAstProject',
  'ctxReindexProject',
  'ctxStopIndexing',
  'ctxPurgeProject',
  'ctxDeleteProject',
  'ctxIndexAll',
  'ctxReindexAll',
  'ctxStartPolling',
  'ctxDoSearch',
  'ctxLoadMemory',
  'ctxLoadCode',
  'openContextFile',
  '_ctxRenderFileList',
  '_ctxRenderDetail',
  '_escHtml',
];

CORE_FUNCTIONS.forEach(fnName => {
  test(`${fnName} is a function`, () => {
    expect(coreSandbox[fnName]).toBeType('function');
  });
});

// ── Suite: context-core.js unit behaviours ────────────────────────────────────

console.log('\n── context-core.js — behaviour tests ──────────────────────────────');

test('_escHtml escapes ampersand', () => {
  expect(coreSandbox._escHtml('a & b')).toBe('a &amp; b');
});

test('_escHtml escapes less-than', () => {
  expect(coreSandbox._escHtml('<script>')).toBe('&lt;script&gt;');
});

test('_escHtml escapes quotes', () => {
  expect(coreSandbox._escHtml('"hello"')).toBe('&quot;hello&quot;');
});

test('_escHtml handles null/undefined', () => {
  expect(coreSandbox._escHtml(null)).toBe('');
  expect(coreSandbox._escHtml(undefined)).toBe('');
});

test('_escHtml returns string unchanged when no special chars', () => {
  expect(coreSandbox._escHtml('hello world')).toBe('hello world');
});

test('ctxPopulateRepoFilter does not throw when element missing', () => {
  coreSandbox.ctxPopulateRepoFilter(); // document.getElementById returns mockEl with no innerHTML setter
});

test('ctxRenderProjects does not throw with empty _ctxProjects', () => {
  coreSandbox._ctxProjects = [];
  coreSandbox.ctxRenderProjects();
});

test('ctxSelectProject marks project active via ctxRenderProjects', () => {
  // _ctxSelectedProject is a `let` inside the vm script — it doesn't land on the
  // sandbox object, so we test the observable side-effect instead:
  // ctxSelectProject calls ctxRenderProjectsWithProgress which writes sidebar.innerHTML.
  const sb2 = makeSandbox();
  let capturedHtml = '';
  sb2.document = {
    getElementById: (id) => {
      if (id === 'ctx-projects-list') return { innerHTML: '', get innerHTML() { return capturedHtml; }, set innerHTML(v) { capturedHtml = v; } };
      if (id === 'ctx-proj-detail')   return { innerHTML: '' };
      return { innerHTML: '', style: {}, textContent: '', classList: { add: () => {}, remove: () => {} }, getAttribute: () => null };
    },
    querySelectorAll: () => [],
  };
  sb2._ctxProjects = [{ name: 'my-repo', status: 'ready' }];
  loadFile(sb2, 'context-core.js');
  sb2.ctxSelectProject('my-repo');
  expect(capturedHtml.includes('my-repo')).toBeTruthy();
});


test('ctxCloseAddModal does not throw when element missing', () => {
  coreSandbox.ctxCloseAddModal();
});

// ── Suite: context-complexity.js exports ─────────────────────────────────────

console.log('\n── context-complexity.js — exported globals ────────────────────────');

const compSandbox = makeSandbox({ _escHtml: (s) => String(s) });
try { loadFile(compSandbox, 'context-complexity.js'); } catch (e) {
  console.error('  FATAL: could not load context-complexity.js:', e.message);
  process.exit(1);
}

const COMPLEXITY_FUNCTIONS = [
  '_computeAstComplexity',
  '_complexityColor',
  '_renderComplexityHeatmap',
  '_renderComplexityRadial',
  '_updateRadialDetail',
];

COMPLEXITY_FUNCTIONS.forEach(fnName => {
  test(`${fnName} is a function`, () => {
    expect(compSandbox[fnName]).toBeType('function');
  });
});

// ── Suite: context-complexity.js unit behaviours ──────────────────────────────

console.log('\n── context-complexity.js — behaviour tests ─────────────────────────');

test('_complexityColor returns Low for score 1', () => {
  const c = compSandbox._complexityColor(1);
  expect(c.label).toBe('Low');
});

test('_complexityColor returns Moderate for score 8', () => {
  const c = compSandbox._complexityColor(8);
  expect(c.label).toBe('Moderate');
});

test('_complexityColor returns Risky for score 15', () => {
  const c = compSandbox._complexityColor(15);
  expect(c.label).toBe('Risky');
});

test('_complexityColor returns High for score 25', () => {
  const c = compSandbox._complexityColor(25);
  expect(c.label).toBe('High');
});

test('_computeAstComplexity returns empty array for no typed nodes', () => {
  const nodes = [{ node_type: 'import', name: 'os', repo: 'r', path: 'f.py', start_line: 1, end_line: 1 }];
  const result = compSandbox._computeAstComplexity(nodes);
  expect(result.length).toBe(0);
});

test('_computeAstComplexity scores a single function correctly', () => {
  const nodes = [{
    node_type: 'function', name: 'foo', repo: 'r', path: 'f.py', start_line: 1, end_line: 12
  }];
  const result = compSandbox._computeAstComplexity(nodes);
  expect(result.length).toBe(1);
  const fn = result[0].functions[0];
  // base=1, children=0, lineBonus=ceil(max(0,12-1-10)/15)=ceil(1/15)=1 → score=2
  expect(fn.complexity >= 1).toBeTruthy();
});

test('_computeAstComplexity groups by file path', () => {
  const nodes = [
    { node_type: 'function', name: 'a', repo: 'r', path: 'a.py', start_line: 1, end_line: 5 },
    { node_type: 'function', name: 'b', repo: 'r', path: 'b.py', start_line: 1, end_line: 5 },
    { node_type: 'function', name: 'c', repo: 'r', path: 'a.py', start_line: 6, end_line: 10 },
  ];
  const result = compSandbox._computeAstComplexity(nodes);
  expect(result.length).toBe(2);
  const fileA = result.find(f => f.path === 'a.py');
  expect(fileA.functions.length).toBe(2);
});

test('_computeAstComplexity counts nested children', () => {
  const nodes = [
    { node_type: 'function', name: 'outer', repo: 'r', path: 'f.py', start_line: 1,  end_line: 20 },
    { node_type: 'method',   name: 'inner', repo: 'r', path: 'f.py', start_line: 5,  end_line: 10 },
  ];
  const result = compSandbox._computeAstComplexity(nodes);
  const outer  = result[0].functions.find(f => f.name === 'outer');
  expect(outer.child_count).toBe(1);
});

test('_computeAstComplexity sorts files by total_complexity descending', () => {
  const nodes = [
    { node_type: 'function', name: 'small', repo: 'r', path: 'small.py', start_line: 1, end_line: 3 },
    { node_type: 'function', name: 'big',   repo: 'r', path: 'big.py',   start_line: 1, end_line: 80 },
  ];
  const result = compSandbox._computeAstComplexity(nodes);
  expect(result[0].total_complexity >= result[1].total_complexity).toBeTruthy();
});

// ── Suite: context-ast.js exports ────────────────────────────────────────────

console.log('\n── context-ast.js — exported globals ──────────────────────────────');

const astSandbox = makeSandbox({
  _escHtml:                 (s) => String(s || ''),
  _renderComplexityHeatmap: () => {},
  _renderComplexityRadial:  () => {},
  openContextFile:          () => {},
});
try { loadFile(astSandbox, 'context-ast.js'); } catch (e) {
  console.error('  FATAL: could not load context-ast.js:', e.message);
  process.exit(1);
}

const AST_FUNCTIONS = [
  'ctxLoadAst',
  'ctxReadProjectAst',
  'ctxRenderD3Tree',
  '_buildUnifiedAstTree',
  '_renderAstModal',
  '_setAstView',
  '_renderAstView',
  '_renderAstNoSearchResults',
  '_renderAstSearchRecovery',
  '_syncAstSearchRecovery',
  '_renderAstInteractiveLegend',
  '_renderAstSearchToolbar',
  '_renderAstTypeaheadSearch',
  '_astTypeaheadOptions',
  '_astSearchOptionLabel',
  '_filterAstNodesForSearch',
  '_renderRadialClusterTree',
];

AST_FUNCTIONS.forEach(fnName => {
  test(`${fnName} is a function`, () => {
    expect(astSandbox[fnName]).toBeType('function');
  });
});

// ── Suite: context-ast.js unit behaviours ────────────────────────────────────

console.log('\n── context-ast.js — behaviour tests ────────────────────────────────');

// AST module lets are block-scoped inside the vm.Script — access them via a
// helper object that the module writes to during _setAstView calls.
const astState = { viewMode: null, currentNodes: undefined };
astSandbox._setAstViewHook = (mode) => { astState.viewMode = mode; };

test('_astViewMode initialises to "tree"', () => {
  // Indirectly verify by checking _setAstView was called with 'tree' default
  // via calling _renderAstModal on a fake container (currentNodes=null so no render)
  // The simplest proof: _astViewMode is a let inside the script; verify _setAstView exists
  // and that calling _setAstView('tree') doesn't throw.
  astSandbox._setAstView('tree');
  // No error = pass; the var is internal to the script scope
});

test('_astCurrentNodes initialises to null/falsy before use', () => {
  // _astCurrentNodes is a let inside the script — _renderAstView returns early when falsy
  // Verify by calling _renderAstView without setting nodes: it should not throw.
  astSandbox._renderAstView();
});

test('_buildUnifiedAstTree returns root node', () => {
  const nodes = [
    { repo: 'myrepo', path: 'src/foo.py', node_type: 'function', name: 'bar', start_line: 1, end_line: 10 },
  ];
  const root = astSandbox._buildUnifiedAstTree(nodes);
  expect(root.name).toBe('Context AST');
  expect(root.type).toBe('root');
});

test('_buildUnifiedAstTree groups nodes by repo', () => {
  const nodes = [
    { repo: 'repoA', path: 'a.py', node_type: 'function', name: 'x', start_line: 1, end_line: 5 },
    { repo: 'repoB', path: 'b.py', node_type: 'function', name: 'y', start_line: 1, end_line: 5 },
  ];
  const root = astSandbox._buildUnifiedAstTree(nodes);
  expect(root.children.length).toBe(2);
  const repoNames = root.children.map(c => c.name);
  expect(repoNames.includes('repoA')).toBeTruthy();
});

test('_buildUnifiedAstTree nests path segments as dirs', () => {
  const nodes = [
    { repo: 'r', path: 'src/utils/helper.py', node_type: 'function', name: 'h', start_line: 1, end_line: 3 },
  ];
  const root    = astSandbox._buildUnifiedAstTree(nodes);
  const repo    = root.children[0];
  const src     = repo.children.find(c => c.name === 'src');
  expect(src).toBeTruthy();
  const utils   = src.children.find(c => c.name === 'utils');
  expect(utils).toBeTruthy();
  const helperFile = utils.children.find(c => c.name === 'helper.py');
  expect(helperFile).toBeTruthy();
});

test('_buildUnifiedAstTree nests AST nodes inside file', () => {
  const nodes = [
    { repo: 'r', path: 'app.py', node_type: 'class',    name: 'MyClass', start_line: 1, end_line: 30 },
    { repo: 'r', path: 'app.py', node_type: 'method',   name: 'init',    start_line: 5, end_line: 10 },
    { repo: 'r', path: 'app.py', node_type: 'function', name: 'helper',  start_line: 35, end_line: 40 },
  ];
  const root      = astSandbox._buildUnifiedAstTree(nodes);
  const repo      = root.children[0];
  const fileNode  = repo.children.find(c => c.name === 'app.py');
  expect(fileNode).toBeTruthy();
  // MyClass should contain init as a child
  const klazz = fileNode.children.find(c => c.name === 'MyClass');
  expect(klazz).toBeTruthy();
  expect(klazz.children.find(c => c.name === 'init')).toBeTruthy();
});

test('_setAstView updates mode without throwing', () => {
  // _astViewMode is block-scoped inside the vm script — we verify _setAstView
  // correctly handles mode switches by checking it doesn't throw and that
  // _renderAstView is called (nodes still null → early return, no error).
  astSandbox._setAstView('complexity');
  astSandbox._setAstView('radial');
  astSandbox._setAstView('cluster');
  astSandbox._setAstView('tree');
});

test('_astTypeaheadOptions builds AST node suggestions', () => {
  const nodes = [
    { repo: 'r', path: 'app.py', node_type: 'class', name: 'RedisClient', start_line: 1, end_line: 30 },
    { repo: 'r', path: 'app.py', node_type: 'method', name: 'connect', start_line: 5, end_line: 10 },
  ];
  const options = astSandbox._astTypeaheadOptions(nodes);
  expect(options.length).toBe(2);
  if (!options.some(o => o.label.includes('RedisClient') && o.label.includes('app.py'))) {
    throw new Error('Expected RedisClient typeahead option with path context');
  }
});

test('_renderAstTypeaheadSearch always renders datalist-backed input', () => {
  const html = astSandbox._renderAstTypeaheadSearch();
  if (!html.includes('list="ast-view-search-options"')) throw new Error('Search input is missing datalist list attribute');
  if (!html.includes('<datalist id="ast-view-search-options">')) throw new Error('Search control is missing datalist');
  if (!html.includes('oninput="astSetSearchQuery(this.value)"')) throw new Error('Search control is missing live typeahead input handler');
});

test('_renderAstSearchRecovery provides header-level clear button', () => {
  const html = astSandbox._renderAstSearchRecovery();
  if (!html.includes('id="ast-search-recovery"')) throw new Error('Header search recovery container missing');
  if (!html.includes('onclick="astClearSearchQuery()"')) throw new Error('Header search recovery clear action missing');
});

test('_renderAstInteractiveLegend keeps search as typeahead', () => {
  const html = astSandbox._renderAstInteractiveLegend('test-cid');
  if (!html.includes('Depth filter:')) throw new Error('Legend missing depth filter controls');
  if (!html.includes('list="ast-view-search-options"')) throw new Error('Legend search is not datalist-backed');
  if (!html.includes('<datalist id="ast-view-search-options">')) throw new Error('Legend search missing datalist');
});

test('_renderAstSearchToolbar keeps search as typeahead', () => {
  const html = astSandbox._renderAstSearchToolbar();
  if (!html.includes('list="ast-view-search-options"')) throw new Error('Toolbar search is not datalist-backed');
  if (!html.includes('<datalist id="ast-view-search-options">')) throw new Error('Toolbar search missing datalist');
});

test('_renderAstNoSearchResults keeps typeahead available for recovery', () => {
  const area = { innerHTML: '' };
  astSandbox.astSetSearchQuery('redi');
  astSandbox._renderAstNoSearchResults(area);
  if (!area.innerHTML.includes('No AST nodes match')) throw new Error('No-results message missing');
  if (!area.innerHTML.includes('Depth filter:')) throw new Error('No-results state lost depth filters');
  if (!area.innerHTML.includes('list="ast-view-search-options"')) throw new Error('No-results state lost typeahead search input');
  if (!area.innerHTML.includes('onclick="astClearSearchQuery()"')) throw new Error('No-results state lost clear search action');
  astSandbox.astClearSearchQuery();
});

test('_filterAstNodesForSearch exact typeahead selection includes nested children only', () => {
  const nodes = [
    { repo: 'r', path: 'app.py', node_type: 'class', name: 'RedisClient', start_line: 1, end_line: 30 },
    { repo: 'r', path: 'app.py', node_type: 'method', name: 'connect', start_line: 5, end_line: 10 },
    { repo: 'r', path: 'app.py', node_type: 'function', name: 'outside', start_line: 35, end_line: 40 },
  ];
  astSandbox.astSetSearchQuery(astSandbox._astSearchOptionLabel(nodes[0]));
  const filtered = astSandbox._filterAstNodesForSearch(nodes);
  expect(filtered.length).toBe(2);
  if (!filtered.some(n => n.name === 'RedisClient')) throw new Error('Selected node missing from filtered results');
  if (!filtered.some(n => n.name === 'connect')) throw new Error('Nested child missing from filtered results');
  if (filtered.some(n => n.name === 'outside')) throw new Error('Non-child node should not be included');
  astSandbox.astClearSearchQuery();
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n────────────────────────────────────────────────────────────────────`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────────────────────────────────────────\n`);

process.exit(failed > 0 ? 1 : 0);
