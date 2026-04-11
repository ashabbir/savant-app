// ── Shared Status Bar ────────────────────────────────────────────────────────
// Used by both index.html and detail.html. Call initStatusBar(options) on load.
// Page-specific behavior is injected via options.updateSessions and options.updateWorkspace.

let _statusBarRefreshCountdown = 30;

function updateStatusBarClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const clockEl = document.getElementById('status-bar-clock');
  if (clockEl) clockEl.textContent = `${hh}:${mm}`;
}

function tickStatusBarRefresh() {
  _statusBarRefreshCountdown--;
  if (_statusBarRefreshCountdown <= 0) _statusBarRefreshCountdown = 30;
  const el = document.getElementById('status-bar-refresh');
  if (el) el.textContent = `↻ ${_statusBarRefreshCountdown}s`;
}

function updateStatusBarMcp() {
  fetch('/api/mcp/health', { signal: AbortSignal.timeout(2000) })
    .then(r => r.json())
    .then(data => {
      const dot = document.getElementById('status-bar-mcp-dot');
      const txt = document.getElementById('status-bar-mcp-text');
      const allOk = data && data.workspace && data.abilities;
      if (dot) dot.className = 'status-bar-dot ' + (allOk ? 'mcp-ok' : 'mcp-err');
      if (txt) txt.textContent = allOk ? 'MCP ✓' : 'MCP';
    })
    .catch(() => {
      const dot = document.getElementById('status-bar-mcp-dot');
      if (dot) dot.className = 'status-bar-dot mcp-err';
    });
}

function updateBreadcrumb() {
  const el = document.getElementById('status-bar-breadcrumb-text');
  if (!el) return;
  const tab = typeof currentTab !== 'undefined' ? currentTab : 'sessions';
  const tabLabel = tab.charAt(0).toUpperCase() + tab.slice(1);
  const parts = [tabLabel];

  if (tab === 'workspaces' && typeof _currentWsId !== 'undefined' && _currentWsId) {
    const wsName = window._currentWsName || _currentWsId;
    parts.push(wsName);
    if (typeof _wsSubTab !== 'undefined' && _wsSubTab && _wsSubTab !== 'sessions') {
      parts.push(_wsSubTab.charAt(0).toUpperCase() + _wsSubTab.slice(1));
    }
  }

  el.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    return `<span style="color:${isLast ? 'var(--cyan)' : 'var(--text-dim)'}">${p}</span>`;
  }).join(' <span style="color:var(--text-dim);margin:0 3px;">›</span> ');
}

/**
 * Initialize the status bar with page-specific hooks.
 * @param {Object} options
 * @param {Function} [options.updateSessions] - Custom function to update the sessions segment
 * @param {Function} [options.updateWorkspace] - Custom function to update the workspace segment
 */
function initStatusBar(options = {}) {
  const updateSessions = options.updateSessions || function() {};
  const updateWorkspace = options.updateWorkspace || function() {};

  updateStatusBarClock();
  updateSessions();
  updateWorkspace();
  updateStatusBarMcp();
  updateBreadcrumb();

  setInterval(() => {
    updateStatusBarClock();
    tickStatusBarRefresh();
  }, 1000);

  setInterval(() => {
    updateSessions();
    updateWorkspace();
  }, 5000);

  setInterval(updateStatusBarMcp, 30000);
}
