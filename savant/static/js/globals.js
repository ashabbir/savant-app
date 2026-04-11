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
let currentMode = localStorage.getItem('wf-mode') || 'copilot';  // provider: copilot/claude
let currentTab = localStorage.getItem('savant-last-tab') || 'workspaces';  // top tab: workspaces/tasks/abilities/sessions
let fetchGeneration = 0; // bump on mode switch to discard stale responses
let hasMore = false;
let totalCount = 0;
const PAGE_SIZE = 30;

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
let _wsStatusFilter = 'open';
let _wsSearchTitleOnly = false; // true when typing (name only), false on Enter (all fields)
let _currentWsId = null;
let _wsSubTab = 'sessions';
let _wsDetailSessions = [];

