// ── Shared Utility Functions ─────────────────────────────────────────────────
// Used by both index.html and detail.html. Loaded before page-specific scripts.

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTs(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
  catch { return ts; }
}

function formatDate(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

function formatDateTime(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
  catch { return ''; }
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatDuration(start, end) {
  if (!start || !end) return '—';
  const ms = new Date(end) - new Date(start);
  if (ms < 0) return '—';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function showLoadingThenNavigate(url) {
  if (window.electronAPI && typeof window.electronAPI.navigate === 'function') {
    window.electronAPI.navigate(url).then((result) => {
      if (!result || !result.ok) window.location.href = url;
    }).catch(() => {
      window.location.href = url;
    });
    return;
  }
  window.location.href = url;
}

(function setupNavigationErrorBridge() {
  if (typeof window === 'undefined') return;
  if (window.__savantNavErrorBridgeInstalled) return;
  window.__savantNavErrorBridgeInstalled = true;
  if (!window.electronAPI || typeof window.electronAPI.onNavigationError !== 'function') return;
  window.electronAPI.onNavigationError((payload) => {
    const code = payload && payload.errorCode != null ? payload.errorCode : 'unknown';
    const desc = payload && payload.errorDescription ? payload.errorDescription : 'Navigation failed';
    const url = payload && payload.url ? payload.url : '';
    const msg = `${desc} (code ${code})${url ? ` — ${url}` : ''}`;
    try { console.error('[navigation-error]', msg); } catch {}
    try { showToast('error', msg, 10000); } catch {}
  });
})();

function showToast(type, message, autoClose = 5000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = {
    success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️',
    workspace_created: '🏗️', workspace_closed: '🔒', workspace_reopened: '🔓',
    session_assigned: '📌', task_created: '📝', task_updated: '✅',
    note_created: '🗒️', mr_created: '🔀', mr_updated: '🔀',
    jira_created: '📋', jira_updated: '📋',
  };
  const titles = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' };
  const icon = icons[type] || '⚡';
  const label = titles[type] || (type || 'event').replace(/_/g, ' ').toUpperCase();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">
      <div class="toast-title">${label}</div>
      <div class="toast-msg">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.classList.add('toast-out');setTimeout(()=>this.parentElement.remove(),400)">×</button>
  `;
  container.appendChild(toast);
  if (autoClose > 0) {
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 400);
    }, autoClose);
  }
  // Log to notification history (bell icon panel) if available
  if (typeof _pushNotification === 'function') {
    _pushNotification({
      id: Date.now(),
      type: type,
      message: message,
      timestamp: new Date().toISOString(),
    });
  }
}
