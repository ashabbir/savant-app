// ── Savant Client/Server Sync UX ────────────────────────────────────────────
// Handles Electron sync-status updates + best-effort SSE live stream hookup.

let _svSyncState = {
  online: false,
  serverUrl: '',
  queue: { queued: 0, failed: 0, total: 0 },
  sseConnected: false,
};

let _svEventSource = null;
let _svSseRetryTimer = null;

function _svUpdateServerStatusBar() {
  const dot = document.getElementById('status-bar-server-dot');
  const txt = document.getElementById('status-bar-server-text');
  if (!dot || !txt) return;
  const queue = _svSyncState.queue || {};
  if (_svSyncState.online) {
    dot.className = 'status-bar-dot active';
    txt.textContent = `Server ✓${_svSyncState.sseConnected ? ' · Live' : ''} · Q:${queue.queued || 0}`;
  } else {
    dot.className = 'status-bar-dot mcp-err';
    txt.textContent = `Server offline · Q:${queue.queued || 0}/${queue.failed || 0}`;
  }
}

function _svTeardownSse() {
  if (_svEventSource) {
    try { _svEventSource.close(); } catch {}
    _svEventSource = null;
  }
  _svSyncState.sseConnected = false;
  _svUpdateServerStatusBar();
}

function _svScheduleSseRetry() {
  if (_svSseRetryTimer) return;
  _svSseRetryTimer = setTimeout(() => {
    _svSseRetryTimer = null;
    _svConnectSse();
  }, 4000);
}

function _svHandleLiveEvent(payload) {
  try {
    // Reuse existing event refresh pipeline where available
    if (typeof _pollEvents === 'function') {
      _pollEvents();
      return;
    }
    // Fallback lightweight notification if payload is already an event
    if (payload && payload.type && payload.message && typeof showToast === 'function') {
      showToast(payload.type, payload.message, 3500);
    }
  } catch {}
}

function _svAttachEventSource(url) {
  try {
    const es = new EventSource(url, { withCredentials: true });
    es.onopen = () => {
      _svSyncState.sseConnected = true;
      _svUpdateServerStatusBar();
    };
    es.onmessage = (evt) => {
      if (!evt || !evt.data) return;
      try {
        const payload = JSON.parse(evt.data);
        _svHandleLiveEvent(payload);
      } catch {
        _svHandleLiveEvent({ type: 'info', message: evt.data });
      }
    };
    es.onerror = () => {
      _svSyncState.sseConnected = false;
      _svUpdateServerStatusBar();
      try { es.close(); } catch {}
      if (_svEventSource === es) _svEventSource = null;
      _svScheduleSseRetry();
    };
    _svEventSource = es;
    return true;
  } catch {
    return false;
  }
}

function _svConnectSse() {
  _svTeardownSse();
  if (!_svSyncState.online || !_svSyncState.serverUrl) return;
  const base = _svSyncState.serverUrl.replace(/\/$/, '');
  const endpoints = ['/api/events/stream', '/api/sse/events', '/events/stream'];
  for (const ep of endpoints) {
    const ok = _svAttachEventSource(base + ep);
    if (ok) return;
  }
}

async function _svRefreshQueueStats() {
  if (!window.savantClient || !window.savantClient.getQueueStats) return;
  try {
    _svSyncState.queue = await window.savantClient.getQueueStats();
    _svUpdateServerStatusBar();
  } catch {}
}

async function _svInitClientSync() {
  if (!window.savantClient) return;
  try {
    const cfg = await window.savantClient.getServerConfig();
    _svSyncState.online = !!cfg.online;
    _svSyncState.serverUrl = cfg.serverUrl || '';
    await _svRefreshQueueStats();
    _svUpdateServerStatusBar();
    _svConnectSse();
  } catch {}

  if (window.savantClient.onSyncStatus) {
    window.savantClient.onSyncStatus((evt) => {
      _svSyncState.online = !!evt.online;
      _svSyncState.serverUrl = evt.serverUrl || _svSyncState.serverUrl;
      if (evt.queue) _svSyncState.queue = evt.queue;
      _svUpdateServerStatusBar();
      if (_svSyncState.online) _svConnectSse();
      else _svTeardownSse();
    });
  }

  setInterval(_svRefreshQueueStats, 7000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _svInitClientSync);
} else {
  _svInitClientSync();
}
