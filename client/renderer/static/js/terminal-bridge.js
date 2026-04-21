/**
 * terminal-bridge.js — Shared BrowserView terminal bridge for index + detail pages.
 *
 * Bridges terminalAPI (from preload.js) to page-level functions
 * (toggleTerminalDrawer, termAddTab, etc.). Each page calls
 * setupTerminalBridge(options) with page-specific config.
 *
 * Options:
 *   containerSelector  — CSS selector for page content container (e.g. '.container')
 *   fullWidth          — if true, terminal covers full width (detail page)
 *   defaultWidthPct    — default width percent when not fullWidth (default 60)
 *   getSessionCwd      — fn returning session cwd (for detail page context)
 *   onDrawerToggle     — fn(open) called when drawer opens/closes (for detail left-tab active state)
 */

// eslint-disable-next-line no-unused-vars
function setupTerminalBridge(options = {}) {
  const api = window.terminalAPI;
  if (!api || !api.toggleDrawer) return;

  const {
    containerSelector = '.container',
    fullWidth = false,
    defaultWidthPct = 60,
    getSessionCwd = () => undefined,
    onDrawerToggle = null,
  } = options;

  // Remove legacy in-page drawer if present
  const oldDrawer = document.getElementById('terminal-drawer');
  if (oldDrawer) oldDrawer.style.display = 'none';

  // ── Window function overrides ─────────────────────────────────────────────
  window.toggleTerminalDrawer = fullWidth
    ? function() {
        api.isDrawerOpen().then(open => {
          if (open) api.hideDrawer();
          else api.showDrawer(getSessionCwd());
        }).catch(() => api.toggleDrawer());
      }
    : function() { api.toggleDrawer(); };

  window.termCollapse = function() { api.hideDrawer && api.hideDrawer(); };
  window.termRestore  = function() { api.showDrawer && api.showDrawer(); };
  window.termClose    = function() { api.hideDrawer && api.hideDrawer(); };
  window.termAddTab   = function(cwd) { api.addNewTab(cwd || getSessionCwd()); };
  window.termCloseTab = function() { /* handled by BrowserView terminal.html */ };
  window.termOpenExternal = function() { api.openExternal && api.openExternal(getSessionCwd()); };

  // Split/maximize — only meaningful on side-panel mode (index page)
  if (!fullWidth) {
    window.termSplitH = function() { api.splitPane && api.splitPane('h'); };
    window.termSplitV = function() { api.splitPane && api.splitPane('v'); };
    window.termMaximize = (function() {
      let _savedWidthPct = null;
      return function() {
        const state = document.body.style.getPropertyValue('--term-width-pct');
        const currentPct = parseFloat(state) || defaultWidthPct;
        if (currentPct >= 90) {
          api.setDrawerWidth && api.setDrawerWidth(_savedWidthPct || defaultWidthPct);
          _savedWidthPct = null;
        } else {
          _savedWidthPct = currentPct;
          api.setDrawerWidth && api.setDrawerWidth(95);
        }
      };
    })();
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault(); e.stopPropagation(); api.addNewTab(getSessionCwd());
    }
    if (e.metaKey && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault(); e.stopPropagation(); api.addNewTab(getSessionCwd());
    }
  });

  // ── Drawer state sync ─────────────────────────────────────────────────────
  function _applyDrawerState(state) {
    const ct = document.querySelector(containerSelector) || document.body;
    if (state.open) {
      ct.classList.add('term-open');
      document.body.classList.add('term-open');
      document.body.style.setProperty('--term-width-pct', state.widthPct + '%');
    } else {
      ct.classList.remove('term-open');
      document.body.classList.remove('term-open');
      document.body.style.setProperty('--term-width-pct', '0%');
    }
    _updateTermIndicator();
    if (onDrawerToggle) onDrawerToggle(state.open);
  }

  if (api.onDrawerState) api.onDrawerState(_applyDrawerState);

  async function _syncMargin() {
    try {
      const open = await api.isDrawerOpen();
      const widthPct = open ? (fullWidth ? 100 : (await api.getWidthPct?.() || defaultWidthPct)) : 0;
      _applyDrawerState({ open, widthPct });
    } catch {
      _applyDrawerState({ open: false, widthPct: 0 });
    }
  }
  _syncMargin();
  window.addEventListener('pageshow', (e) => { if (e.persisted) _syncMargin(); });

  // ── Terminal indicator dot ─────────────────────────────────────────────────
  function _updateTermIndicator() {
    const i = document.getElementById('term-indicator');
    if (!i) return;
    api.isDrawerOpen().then(open => i.classList.toggle('active', open)).catch(() => {});
  }
  _updateTermIndicator();
}
