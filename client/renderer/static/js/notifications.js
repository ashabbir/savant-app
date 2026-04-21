// ── Toast Notification System ─────────────────────────────────────────────
const _toastIcons = {
  workspace_created: '🏗️', workspace_closed: '🔒', workspace_reopened: '🔓',
  session_assigned: '📌', task_created: '📝', task_updated: '✅',
  note_created: '🗒️', info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️',
  default: '⚡'
};

// ── Notification History (last 10, newest first) ─────────────────────────
const _notifHistory = [];
let _notifSeenId = 0;  // highest event id seen when modal was last opened

function _pushNotification(evt) {
  _notifHistory.unshift(evt);
  if (_notifHistory.length > 10) _notifHistory.length = 10;
  // Blink bell if there are unseen notifications
  if (evt.id > _notifSeenId) {
    document.getElementById('notif-bell').classList.add('has-new');
  }
}

function _formatNotifTime(ts) {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    if (diffMs < 60000) return 'just now';
    if (diffMs < 3600000) return Math.floor(diffMs / 60000) + 'm ago';
    if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + 'h ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) { return ''; }
}

function _renderNotifList() {
  const list = document.getElementById('notif-list');
  if (_notifHistory.length === 0) {
    list.innerHTML = '<div class="notif-empty">No notifications yet.<br>MCP actions will appear here.</div>';
    return;
  }
  list.innerHTML = _notifHistory.map(n => {
    const icon = _toastIcons[n.type] || _toastIcons.default;
    const label = (n.type || 'event').replace(/_/g, ' ').toUpperCase();
    const time = _formatNotifTime(n.timestamp);
    return `<div class="notif-item">
      <span class="notif-item-icon">${icon}</span>
      <div class="notif-item-body">
        <div class="notif-item-type">${label}</div>
        <div class="notif-item-msg">${n.message}</div>
      </div>
      <span class="notif-item-time">${time}</span>
    </div>`;
  }).join('');
}

function openNotifications() {
  _notifSeenId = _notifHistory.length ? _notifHistory[0].id : _notifSeenId;
  document.getElementById('notif-bell').classList.remove('has-new');
  _renderNotifList();
  document.getElementById('notif-modal').classList.add('active');
}

function closeNotifications() {
  document.getElementById('notif-modal').classList.remove('active');
}

function showToast(type, message, autoClose = 5000) {
  const container = document.getElementById('toast-container');
  const icon = _toastIcons[type] || _toastIcons.default;
  const label = (type || 'event').replace(/_/g, ' ').toUpperCase();
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon">${icon}</span><div class="toast-body"><div class="toast-title">${label}</div><div class="toast-msg">${message}</div></div><button class="toast-close" onclick="this.parentElement.classList.add('toast-out');setTimeout(()=>this.parentElement.remove(),400)">&times;</button>`;
  container.appendChild(el);
  if (autoClose > 0) {
    setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 400); }, autoClose);
  }
  // Always log to notification history (bell icon panel)
  _pushNotification({
    id: Date.now(),
    type: type,
    message: message,
    timestamp: new Date().toISOString(),
  });
}

// Event poller — checks /api/events every 5s for MCP-triggered actions
let _lastEventId = 0;
async function _pollEvents() {
  try {
    const res = await fetch(`/api/events?since=${_lastEventId}`);
    if (!res.ok) return;
    const events = await res.json();
    for (const evt of events) {
      _lastEventId = evt.id;
      // showToast now auto-pushes to notification history
      showToast(evt.type, evt.message);
      // Auto-refresh relevant views
      _handleEventRefresh(evt);
    }
  } catch (e) { /* ignore network errors */ }
}
function _handleEventRefresh(evt) {
  const t = evt.type;
  if (t === 'workspace_created' || t === 'workspace_closed' || t === 'workspace_reopened') {
    if (typeof fetchWorkspaces === 'function') fetchWorkspaces();
  }
  if (t === 'session_assigned') {
    if (typeof fetchSessions === 'function') fetchSessions();
    if (typeof fetchWorkspaces === 'function') fetchWorkspaces();
    if (typeof _refreshWsDetailSessions === 'function' && typeof _currentWsId !== 'undefined' && _currentWsId) _refreshWsDetailSessions();
  }
  if (t === 'task_created' || t === 'task_updated') {
    if (typeof fetchTasks === 'function') fetchTasks();
  }
  if (t === 'note_created') {
    if (typeof fetchSessions === 'function') fetchSessions();
    if (typeof _refreshWsDetailSessions === 'function' && typeof _currentWsId !== 'undefined' && _currentWsId) _refreshWsDetailSessions();
  }
}
// Start polling once page loads (initial fetch to get baseline, then every 5s)
(async function() {
  // Seed notification history from /api/notifications (returns all, including read)
  try {
    const nRes = await fetch('/api/notifications?limit=10');
    if (nRes.ok) {
      const notifs = await nRes.json();
      if (Array.isArray(notifs) && notifs.length) {
        for (const n of notifs) {
          _notifHistory.push({
            id: abs_hash(n.notification_id),
            type: n.event_type,
            message: n.message,
            timestamp: n.created_at,
            detail: n.detail || {}
          });
        }
        _notifSeenId = _notifHistory[0].id;
      }
    }
  } catch(e) {}
  // Also bootstrap _lastEventId so the poller only fetches genuinely new events
  try {
    const res = await fetch('/api/events?since=0');
    if (res.ok) {
      const evts = await res.json();
      if (evts.length) {
        _lastEventId = evts[evts.length - 1].id;
      }
    }
  } catch(e) {}
  setInterval(_pollEvents, 5000);
})();

// Simple stable hash for notification_id → numeric id (matches backend logic)
function abs_hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 1000000;
}

