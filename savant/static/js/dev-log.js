// ── Dev Debug Log Panel ───────────────────────────────────────────────────────
const _devLogs = [];
const _DEV_LOG_MAX = 500;

window._savantLog = function(msg, level) {
  level = level || 'info';
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  _devLogs.push({ ts, level, msg });
  if (_devLogs.length > _DEV_LOG_MAX) _devLogs.shift();
  const body = document.getElementById('dev-log-body');
  if (body && document.getElementById('dev-log-panel').style.display !== 'none') {
    _appendDevLogEntry(body, { ts, level, msg });
  }
  const countEl = document.getElementById('dev-log-count');
  if (countEl) countEl.textContent = _devLogs.length + ' entries';
  // Update the refresh indicator dot to flash on new logs
  const dot = document.querySelector('.refresh-indicator .dot');
  if (dot && document.getElementById('dev-log-panel').style.display === 'none') {
    dot.style.background = '#e0af68';
    setTimeout(() => { dot.style.background = ''; }, 600);
  }
};

window._savantSetPort = function(key, val) {
  _savantLog('Port ' + key + ' = ' + val, 'sys');
};

window._savantDone = function() {
  _savantLog('Startup complete — dashboard loaded', 'ok');
};

function _appendDevLogEntry(body, entry) {
  const row = document.createElement('div');
  row.className = 'dev-log-entry';
  row.innerHTML = '<span class="dev-log-ts">' + entry.ts + '</span>'
    + '<span class="dev-log-lvl ' + entry.level + '">' + entry.level + '</span>'
    + '<span class="dev-log-msg">' + _escHtml(entry.msg) + '</span>';
  body.appendChild(row);
  body.scrollTop = body.scrollHeight;
}

function toggleDevLogs() {
  const panel = document.getElementById('dev-log-panel');
  if (panel.style.display === 'none') {
    openDevLogs();
  } else {
    closeDevLogs();
  }
}

function openDevLogs() {
  const panel = document.getElementById('dev-log-panel');
  const body = document.getElementById('dev-log-body');
  body.innerHTML = '';
  _devLogs.forEach(e => _appendDevLogEntry(body, e));
  panel.style.display = 'flex';
  const countEl = document.getElementById('dev-log-count');
  if (countEl) countEl.textContent = _devLogs.length + ' entries';
}

function closeDevLogs() {
  document.getElementById('dev-log-panel').style.display = 'none';
}

function clearDevLogs() {
  _devLogs.length = 0;
  document.getElementById('dev-log-body').innerHTML = '';
  const countEl = document.getElementById('dev-log-count');
  if (countEl) countEl.textContent = '0 entries';
  const filterInput = document.getElementById('dev-log-filter');
  if (filterInput) filterInput.value = '';
  const levelFilter = document.getElementById('dev-log-level-filter');
  if (levelFilter) levelFilter.value = '';
}

function filterDevLogs() {
  const text = (document.getElementById('dev-log-filter')?.value || '').toLowerCase();
  const level = (document.getElementById('dev-log-level-filter')?.value || '').toLowerCase();
  const entries = document.querySelectorAll('#dev-log-body .dev-log-entry');
  let visible = 0;
  entries.forEach(entry => {
    const content = entry.textContent.toLowerCase();
    const lvlEl = entry.querySelector('.dev-log-lvl');
    const entryLevel = lvlEl ? lvlEl.className.replace('dev-log-lvl', '').trim() : '';
    const matchesText = !text || content.includes(text);
    const matchesLevel = !level || entryLevel === level;
    entry.style.display = (matchesText && matchesLevel) ? '' : 'none';
    if (matchesText && matchesLevel) visible++;
  });
  const countEl = document.getElementById('dev-log-count');
  if (countEl) {
    const total = entries.length;
    countEl.textContent = (text || level) ? `${visible}/${total} entries` : `${total} entries`;
  }
}
