// ── Terminal View Stub ──────────────────────────────────────────────────────
// Delegates to the persistent BrowserView terminal (terminal.html).
// The in-page terminal implementation has been removed — this file only
// provides the switchView / tips functions referenced from HTML onclick attrs.

let _tvCurrentView = 'ui';

function switchView(view) {
  _tvCurrentView = view;
  const container = document.querySelector('.container');
  const uiBtn = document.getElementById('left-tab-ui');
  const termBtn = document.getElementById('left-tab-terminal');
  const closeBtn = document.getElementById('left-tab-close');
  const tipsBtn = document.getElementById('left-tab-tips');
  const logsBtn = document.getElementById('left-tab-logs');
  const browserBtn = document.getElementById('left-tab-browser');

  if (view === 'terminal') {
    // Show the BrowserView terminal at full width
    if (window.terminalAPI) {
      if (window.terminalAPI.setWidthPct) window.terminalAPI.setWidthPct(100);
      if (window.terminalAPI.showDrawer) window.terminalAPI.showDrawer();
    }
    if (container) container.style.display = 'none';
    if (uiBtn) uiBtn.classList.remove('active');
    if (termBtn) termBtn.classList.add('active');
    if (closeBtn) closeBtn.style.display = '';
    if (tipsBtn) tipsBtn.style.display = '';
    if (logsBtn) logsBtn.style.display = 'none';
    if (browserBtn) browserBtn.style.display = 'none';
  } else {
    // Hide the BrowserView terminal and restore UI
    if (window.terminalAPI) {
      if (window.terminalAPI.setWidthPct) window.terminalAPI.setWidthPct(60);
      if (window.terminalAPI.hideDrawer) window.terminalAPI.hideDrawer();
    }
    if (container) container.style.display = '';
    if (uiBtn) uiBtn.classList.add('active');
    if (termBtn) termBtn.classList.remove('active');
    if (closeBtn) closeBtn.style.display = 'none';
    if (tipsBtn) tipsBtn.style.display = 'none';
    if (logsBtn) logsBtn.style.display = '';
    if (browserBtn) browserBtn.style.display = '';
    closeTerminalTips();
  }
}

function toggleTerminalTips() {
  const overlay = document.getElementById('terminal-tips-overlay');
  if (overlay) overlay.classList.toggle('show');
}

function closeTerminalTips() {
  const overlay = document.getElementById('terminal-tips-overlay');
  if (overlay) overlay.classList.remove('show');
}

function openInBrowser() {
  window.open(window.location.href, '_blank');
}
