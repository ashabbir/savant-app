// ── Shared Global State ─────────────────────────────────────────────────────
// Variables shared across multiple JS modules. Loaded first.

// from context-tab.js
let _ctxProjects = [];

// from core.js
let allSessions = [];
let currentFilter = 'all';
let currentProject = '';
let timeRange = '';
let searchQuery = '';
let _searchTitleOnly = false; // true when typing (filter by id/summary only), false on Enter (full search)
let currentMode = localStorage.getItem('wf-mode') || 'hermes';  // provider: hermes/copilot/claude/codex/gemini
let currentTab = 'workspaces';  // fresh launches land on workspace list
let fetchGeneration = 0; // bump on mode switch to discard stale responses
let hasMore = false;
let totalCount = 0;
const PAGE_SIZE = 30;

let _savantStartupReadyResolve = null;
window.savantStartupReady = new Promise(resolve => {
  _savantStartupReadyResolve = resolve;
});
window.savantStartupDelayMs = 3000;
window._resolveSavantStartupReady = function() {
  if (_savantStartupReadyResolve) {
    _savantStartupReadyResolve();
    _savantStartupReadyResolve = null;
  }
};
window._savantStartupTimer = null;
window._savantStartStartupDelay = function(delayMs = 3000) {
  if (window._savantStartupTimer) return;
  const ms = Math.max(0, Number(delayMs) || 0);
  window._savantStartupTimer = setTimeout(() => {
    window._savantStartupTimer = null;
    window._savantStartupProgress(92, 'Finalizing startup...', 'rendering');
    setTimeout(() => {
      window._savantStartupProgress(100, 'Startup complete', 'ready');
      setTimeout(() => {
        window._resolveSavantStartupReady();
        const overlay = document.getElementById('startup-overlay');
        if (overlay) overlay.style.display = 'none';
      }, 450);
    }, 180);
  }, ms);
};
window._savantRestartStartupDelay = function(delayMs = 3000) {
  if (window._savantStartupTimer) clearTimeout(window._savantStartupTimer);
  window._savantStartupTimer = null;
  window._savantStartStartupDelay(delayMs);
};
window._savantPauseStartupDelay = function() {
  if (window._savantStartupTimer) {
    clearTimeout(window._savantStartupTimer);
    window._savantStartupTimer = null;
  }
};
window._savantStartupProgress = function(percent, left, right) {
  const fill = document.getElementById('startup-fill');
  const leftEl = document.getElementById('startup-meta-left');
  const rightEl = document.getElementById('startup-meta-right');
  const subEl = document.getElementById('startup-sub');
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  if (leftEl) leftEl.textContent = `${Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))}%`;
  if (rightEl && right) rightEl.textContent = right;
  if (subEl && left) subEl.textContent = left;
};
window._savantStartupPhase = function(text, percent, detail) {
  window._savantStartupProgress(percent, text, detail);
};
window.savantAfterStartup = function(cb) {
  Promise.resolve(window.savantStartupReady).then(() => {
    if (typeof cb === 'function') cb();
  });
};

// from knowledge.js
const KB_NODE_COLORS = {
  client:     '#f97316',  // orange
  domain:     '#3b82f6',  // blue
  service:    '#06b6d4',  // cyan
  library:    '#84cc16',  // lime
  technology: '#8b5cf6',  // purple
  insight:    '#f59e0b',  // amber
  project:    '#10b981',  // emerald
  concept:    '#ec4899',  // pink
  repo:       '#6366f1',  // indigo
  session:    '#14b8a6',  // teal
  issue:      '#ef4444',  // red
};
const KB_NODE_ICONS = { client:'🏢', domain:'🗂️', service:'⚙️', library:'📚', technology:'🔧', insight:'💡', project:'📁', concept:'🏷️', repo:'📦', session:'💬', issue:'🐛' };
const KB_LAYERS = {
  all:      null,
  business: ['client','domain','insight'],
  stack:    ['service','library','technology','insight'],
};
const KB_EDGE_COLORS = {
  relates_to: '#6b7280',
  learned_from: '#f59e0b',
  applies_to: '#3b82f6',
  uses: '#10b981',
  evolved_from: '#8b5cf6',
  contributed_to: '#ec4899',
  part_of: '#14b8a6',
  integrates_with: '#f97316',
  depends_on: '#ef4444',
  built_with: '#84cc16',
};

// from mcp-tab.js
let _mcpSubTab = 'workspace';

// from sessions.js
let usageCache = null;

// from tasks.js
let _allTasks = [];
let _prefs = {};

// from workspaces.js
let _workspaces = [];
let _wsLoadError = '';
let _wsStatusFilter = 'open';
let _wsSearchTitleOnly = false; // true when typing (name only), false on Enter (all fields)
let _currentWsId = null;
let _wsSubTab = 'sessions';
let _wsDetailSessions = [];
