// ── Workspace functions ────────────────────────────────────

function setWsStatusFilter(val) {
  _wsStatusFilter = val;
  ['open','closed','all'].forEach(v => {
    const btn = document.getElementById('ws-filter-' + v);
    if (v === val) {
      btn.classList.add('active');
      btn.style.background = v === 'open' ? 'rgba(34,197,94,0.15)' : v === 'closed' ? 'rgba(239,68,68,0.15)' : 'rgba(34,211,238,0.15)';
      btn.style.color = v === 'open' ? 'var(--green)' : v === 'closed' ? 'var(--red)' : 'var(--cyan)';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text-dim)';
    }
  });
  renderWorkspaces();
}

function _filteredWorkspaces() {
  const search = (document.getElementById('ws-search-input')?.value || '').trim().toLowerCase();
  const priority = document.getElementById('ws-filter-priority')?.value || '';
  return _workspaces.filter(ws => {
    if (_wsStatusFilter !== 'all' && (ws.status || 'open') !== _wsStatusFilter) return false;
    if (priority && (ws.priority || 'medium') !== priority) return false;
    if (search) {
      // When typing (title-only mode), match name only; Enter expands to name+description
      const haystack = _wsSearchTitleOnly
        ? (ws.name || '').toLowerCase()
        : ((ws.name || '') + ' ' + (ws.description || '')).toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function _priorityBadge(p) {
  const map = {critical:'🔴',high:'🟠',medium:'🟡',low:'🟢'};
  return `<span style="font-size:0.5rem;font-family:var(--font-mono);padding:2px 6px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px solid var(--border);">${map[p]||'🟡'} ${(p||'medium').toUpperCase()}</span>`;
}

function _statusBadge(ws) {
  const closed = (ws.status || 'open') === 'closed';
  if (closed) return `<span style="font-size:0.45rem;font-family:var(--font-mono);padding:2px 7px;border-radius:6px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;">CLOSED</span>`;
  return `<span style="font-size:0.45rem;font-family:var(--font-mono);padding:2px 7px;border-radius:6px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#22c55e;">OPEN</span>`;
}

function _elapsedSince(dateStr) {
  if (!dateStr) return '';
  const start = new Date(dateStr);
  const now = new Date();
  const diffMs = now - start;
  if (diffMs < 0) return 'starts soon';
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return 'started today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month';
  return `${months} months`;
}

async function _toggleWsStatus(e, wsId) {
  e.stopPropagation();
  const ws = _workspaces.find(w => w.id === wsId);
  if (!ws) return;
  const newStatus = (ws.status || 'open') === 'open' ? 'closed' : 'open';
  try {
    await fetch(`/api/workspaces/${wsId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:newStatus}) });
    await fetchWorkspaces();
    if (_currentWsId === wsId) openWsDetail(wsId);
  } catch(err) { console.error(err); }
}

async function fetchWorkspaces() {
  try {
    const res = await fetch(`/api/workspaces?_=${Date.now()}`);
    _workspaces = await res.json();
    renderWorkspaces();
    updateWsCount();
    populateWsFilter();
    _populateTaskFilterDropdowns();
  } catch(e) { console.error('Failed to fetch workspaces', e); }
}

function updateWsCount() {
  const el = document.getElementById('mode-workspaces-count');
  if (el && _workspaces.length) el.textContent = _workspaces.length;
  else if (el) el.textContent = '';
}

function populateWsFilter() {
  const sel = document.getElementById('filter-workspace');
  if (!sel) return;
  const val = sel.value;
  sel.innerHTML = '<option value="">ALL</option><option value="unassigned">UNASSIGNED</option>';
  _workspaces.forEach(ws => {
    sel.innerHTML += `<option value="${ws.id}">${escapeHtml(ws.name)}</option>`;
  });
  sel.value = val;
}

// MR status color/label maps (shared)
const _mrColors = { draft:'#ffc700', open:'#00a6ff', review:'#a855f7', testing:'#ff8c00', 'on-hold':'#ef4444', merged:'#00ff88', closed:'#6b7280' };
const _mrLabels = { draft:'Draft', open:'Open', review:'Review', testing:'Testing', 'on-hold':'On Hold', merged:'Merged', closed:'Closed' };

function _mrStatusSummary(statusCounts) {
  const order = ['open','draft','review','testing','on-hold','merged','closed'];
  const parts = [];
  for (const st of order) {
    if (statusCounts[st]) parts.push(`${statusCounts[st]} ${_mrLabels[st] || st}`);
  }
  // Include any statuses not in the predefined order
  for (const [st, cnt] of Object.entries(statusCounts)) {
    if (!order.includes(st) && cnt) parts.push(`${cnt} ${st}`);
  }
  return parts.join(' · ') || 'none';
}

function _mrStatusChips(statusCounts) {
  const order = ['open','draft','review','testing','on-hold','merged','closed'];
  let html = '';
  for (const st of order) {
    if (statusCounts[st]) {
      html += `<span style="font-size:0.4rem;padding:1px 4px;border-radius:2px;background:${_mrColors[st] || '#888'}22;color:${_mrColors[st] || '#888'};font-family:var(--font-mono);">${statusCounts[st]} ${_mrLabels[st] || st}</span>`;
    }
  }
  for (const [st, cnt] of Object.entries(statusCounts)) {
    if (!order.includes(st) && cnt) {
      html += `<span style="font-size:0.4rem;padding:1px 4px;border-radius:2px;background:#88888822;color:#888;font-family:var(--font-mono);">${cnt} ${st}</span>`;
    }
  }
  return html;
}

function renderWorkspaces() {
  const grid = document.getElementById('ws-grid');
  const dash = document.getElementById('ws-dashboard');
  if (!grid) return;

  // Build dashboard stats
  if (_workspaces.length) {
    const totalWs = _workspaces.length;
    let totalSessions = 0, totalCopilot = 0, totalCline = 0, totalClaude = 0, totalCodex = 0, totalGemini = 0;
    let totalTasks = 0, tasksDone = 0, tasksActive = 0, tasksBlocked = 0;
    let totalMRs = 0;
    let totalKgNodes = 0;
    const globalMrStatusCounts = {};
    _workspaces.forEach(ws => {
      const c = ws.counts || {};
      totalSessions += c.total || 0;
      totalCopilot += c.copilot || 0;
      totalCline += c.cline || 0;
      totalClaude += c.claude || 0;
      totalCodex += c.codex || 0;
      totalGemini += c.gemini || 0;
      const ts = ws.task_stats || {};
      totalTasks += ts.total || 0;
      tasksDone += ts.done || 0;
      tasksActive += ts.in_progress || 0;
      tasksBlocked += ts.blocked || 0;
      totalMRs += ws.mr_count || 0;
      totalKgNodes += (ws.kg_stats || {}).total_nodes || 0;
      const msc = ws.mr_status_counts || {};
      for (const [st, cnt] of Object.entries(msc)) {
        globalMrStatusCounts[st] = (globalMrStatusCounts[st] || 0) + cnt;
      }
    });
    const pct = totalTasks ? Math.round((tasksDone / totalTasks) * 100) : 0;
    dash.innerHTML = `
      <div class="ws-dash-card accent-cyan">
        <div class="ws-dash-label">WORKSPACES</div>
        <div class="ws-dash-value" style="color:var(--cyan);">${totalWs}</div>
        <div class="ws-dash-sub">${totalSessions} sessions total</div>
      </div>
      <div class="ws-dash-card accent-magenta">
        <div class="ws-dash-label">PROVIDERS</div>
        <div class="ws-dash-value" style="color:var(--text);font-size:0.9rem;">⟐${totalCopilot} 🎭${totalClaude} 🧠${totalCodex} ♊${totalGemini}</div>
        <div class="ws-dash-sub">across all workspaces</div>
      </div>
      <div class="ws-dash-card accent-yellow">
        <div class="ws-dash-label">TASKS</div>
        <div class="ws-dash-value" style="color:var(--yellow);">${totalTasks}</div>
        <div class="ws-dash-sub">${tasksActive} active · ${tasksBlocked} blocked</div>
      </div>
      <div class="ws-dash-card accent-green">
        <div class="ws-dash-label">COMPLETION</div>
        <div class="ws-dash-value" style="color:var(--green);">${pct}%</div>
        <div class="ws-dash-sub">${tasksDone} of ${totalTasks} done</div>
        ${totalTasks ? `<div style="margin-top:6px;height:3px;background:var(--border);border-radius:2px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:var(--green);border-radius:2px;"></div>
        </div>` : ''}
      </div>
      <div class="ws-dash-card" style="border-color:rgba(168,85,247,0.3);">
        <div class="ws-dash-label">MERGE REQUESTS</div>
        <div class="ws-dash-value" style="color:#a855f7;">${totalMRs}</div>
        <div class="ws-dash-sub">${_mrStatusSummary(globalMrStatusCounts)}</div>
      </div>
      <div class="ws-dash-card" style="border-color:rgba(99,102,241,0.3);">
        <div class="ws-dash-label">KNOWLEDGE</div>
        <div class="ws-dash-value" style="color:#6366f1;">${totalKgNodes}</div>
        <div class="ws-dash-sub">KG nodes across all workspaces</div>
      </div>`;
  } else {
    dash.innerHTML = '';
  }

  if (!_workspaces.length) {
    grid.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;">
      No workspaces yet. Create one to group sessions across providers.</div>`;
    return;
  }
  const filtered = _filteredWorkspaces();
  if (!filtered.length) {
    grid.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.7rem;">
      No matching workspaces.</div>`;
    return;
  }
  grid.innerHTML = filtered.map(ws => {
    const c = ws.counts || {};
    const ts = ws.task_stats || {};
    const isClosed = (ws.status || 'open') === 'closed';
    const taskLine = ts.total ? `<div class="ws-provider-row" style="margin-top:4px;flex-wrap:wrap;">
      <span style="font-size:0.5rem;color:var(--text-dim);font-family:var(--font-mono);">☑ ${ts.total} task${ts.total!==1?'s':''}</span>
      ${ts.todo ? `<span style="font-size:0.45rem;color:var(--text-dim);">📋${ts.todo}</span>` : ''}
      ${ts.in_progress ? `<span style="font-size:0.45rem;color:var(--yellow);">⚡${ts.in_progress}</span>` : ''}
      ${ts.done ? `<span style="font-size:0.45rem;color:var(--green);">✅${ts.done}</span>` : ''}
      ${ts.blocked ? `<span style="font-size:0.45rem;color:var(--red);">🚫${ts.blocked}</span>` : ''}
    </div>` : '';
    const noteCount = ws.note_count || 0;
    const fileCount = ws.file_count || 0;
    const noteLine = noteCount ? `<span style="font-size:0.5rem;color:var(--text-dim);font-family:var(--font-mono);">📝 ${noteCount} note${noteCount!==1?'s':''}</span>` : '';
    const fileLine = fileCount ? `<span style="font-size:0.5rem;color:var(--text-dim);font-family:var(--font-mono);">📂 ${fileCount} file${fileCount!==1?'s':''}</span>` : '';
    const extrasLine = (noteLine || fileLine) ? `<div class="ws-provider-row" style="margin-top:4px;">${fileLine}${noteLine}</div>` : '';
    const kg = ws.kg_stats || {};
    const kgTotal = kg.total_nodes || 0;
    const kgEdges = kg.total_edges || 0;
    const kgTypes = kg.nodes_by_type || {};
    const kgTypeChips = Object.entries(kgTypes).sort((a,b) => b[1] - a[1]).map(([t, n]) =>
      `<span style="font-size:0.4rem;padding:1px 5px;border-radius:3px;background:rgba(99,102,241,0.08);color:#818cf8;font-family:var(--font-mono);border:1px solid rgba(99,102,241,0.2);">${t} ${n}</span>`
    ).join(' ');
    const kgStaged = kg.staged_count || 0;
    const kgStagedChip = kgStaged ? `<span style="font-size:0.4rem;padding:1px 6px;border-radius:3px;background:rgba(245,158,11,0.15);color:#f59e0b;font-family:var(--font-mono);border:1px solid rgba(245,158,11,0.3);">⚠ ${kgStaged} uncommitted</span>` : '';
    const kgLine = kgTotal ? `<div class="ws-provider-row" style="margin-top:4px;flex-wrap:wrap;gap:4px;">
      <span style="font-size:0.5rem;color:#6366f1;font-family:var(--font-mono);">🧠 ${kgTotal} node${kgTotal!==1?'s':''}</span>
      <span style="font-size:0.5rem;color:#818cf8;font-family:var(--font-mono);">🔗 ${kgEdges} edge${kgEdges!==1?'s':''}</span>
      ${kgTypeChips}
      ${kgStagedChip}
    </div>` : '';
    const mrCount = ws.mr_count || 0;
    const mrStatusHtml = _mrStatusChips(ws.mr_status_counts || {});
    const mrLine = mrCount ? `<div class="ws-provider-row" style="margin-top:4px;">
      <span style="font-size:0.5rem;color:#a855f7;font-family:var(--font-mono);">🔀 ${mrCount} MR${mrCount!==1?'s':''}</span>
      ${mrStatusHtml}
    </div>` : '';
    const elapsed = _elapsedSince(ws.start_date);
    const metaLine = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
      ${_statusBadge(ws)}
      ${_priorityBadge(ws.priority)}
      ${ws.start_date ? `<span style="font-size:0.45rem;color:var(--text-dim);font-family:var(--font-mono);">📅 ${ws.start_date}</span>` : ''}
      ${elapsed ? `<span style="font-size:0.45rem;color:var(--cyan);font-family:var(--font-mono);">⏱ ${elapsed}</span>` : ''}
    </div>`;
    const closedStyle = isClosed ? 'opacity:0.5;' : '';
    const toggleLabel = isClosed ? '▶ REOPEN' : '✕ CLOSE';
    const toggleColor = isClosed ? 'color:var(--green);' : 'color:var(--red);';
    const ssc = ws.session_status_counts || {};
    const statusColors = {RUNNING:'var(--green)',PROCESSING:'var(--green)',ACTIVE:'var(--cyan)',WAITING:'var(--yellow)',IDLE:'var(--text-dim)',DORMANT:'#2a3a4a',STUCK:'var(--red)',ABORTED:'var(--orange)',COMPLETED:'var(--green)',ERROR:'var(--red)'};
    const statusChips = Object.entries(ssc).sort((a,b) => a[0].localeCompare(b[0])).map(([st, cnt]) =>
      `<span style="font-size:0.4rem;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.05);color:${statusColors[st]||'var(--text-dim)'};font-family:var(--font-mono);border:1px solid ${statusColors[st]||'var(--border)'}30;">${st} ${cnt}</span>`
    ).join(' ');
    const _prioColorMap = {critical:'#ff3355',high:'#ff6b00',medium:'#ffbb00',low:'#22c55e'};
    const prioColor = _prioColorMap[ws.priority] || _prioColorMap.medium;
    return `
      <div class="ws-card ${ws.priority === 'critical' ? 'ws-critical' : ws.priority === 'high' ? 'ws-high' : ''}" style="${closedStyle}${ws.color ? `--ws-color:${ws.color};` : ''}--ws-prio-color:${prioColor};" data-ws-id="${ws.id}" draggable="true" onclick="openWsDetail('${ws.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="drag-handle" title="Drag to reorder" onmousedown="event.stopPropagation()">⠿</span>
            <div class="ws-card-name">${escapeHtml(ws.name)}</div>
          </div>
          <button onclick="_toggleWsStatus(event,'${ws.id}')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:0.45rem;font-family:var(--font-mono);cursor:pointer;${toggleColor}white-space:nowrap;">${toggleLabel}</button>
        </div>
        ${ws.description ? `<div class="ws-card-desc">${escapeHtml(ws.description)}</div>` : ''}
        ${metaLine}
        <div class="ws-provider-row">
          ${c.copilot ? `<span class="ws-provider-chip copilot">⟐ <span class="count">${c.copilot}</span></span>` : ''}
          ${c.claude ? `<span class="ws-provider-chip claude">🎭 <span class="count">${c.claude}</span></span>` : ''}
          ${c.codex ? `<span class="ws-provider-chip codex">🧠 <span class="count">${c.codex}</span></span>` : ''}
          ${c.gemini ? `<span class="ws-provider-chip gemini">♊ <span class="count">${c.gemini}</span></span>` : ''}
        </div>
        ${statusChips ? `<div class="ws-provider-row" style="margin-top:4px;flex-wrap:wrap;gap:4px;">${statusChips}</div>` : ''}
        ${taskLine}
        ${mrLine}
        ${extrasLine}
        ${kgLine}
        <div class="ws-card-footer">
          <span class="ws-total">${c.total || 0} sessions</span>
          <span>Created ${timeAgo(ws.created_at)}</span>
        </div>
      </div>`;
  }).join('');
  _initWsDragAndDrop();
}

// ─── Workspace drag-and-drop ────────────────────────────────────────────
let _wsDragId = null;
let _wsDragging = false;

function _initWsDragAndDrop() {
  const grid = document.getElementById('ws-grid');
  if (!grid) return;
  grid.querySelectorAll('.ws-card[data-ws-id]').forEach(card => {
    card.addEventListener('dragstart', _wsDragStart);
    card.addEventListener('dragend', _wsDragEnd);
    card.addEventListener('dragover', _wsDragOver);
    card.addEventListener('dragleave', _wsDragLeave);
    card.addEventListener('drop', _wsDrop);
    card.addEventListener('click', function(e) {
      if (_wsDragging) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  });
}

function _wsDragStart(e) {
  _wsDragId = this.dataset.wsId;
  _wsDragging = true;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _wsDragId);
}

function _wsDragEnd(e) {
  _wsDragId = null;
  setTimeout(() => { _wsDragging = false; }, 100);
  document.querySelectorAll('.ws-card.dragging, .ws-card.drag-over').forEach(el => {
    el.classList.remove('dragging', 'drag-over');
  });
}

function _wsDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = this.closest('.ws-card[data-ws-id]');
  if (target && target.dataset.wsId !== _wsDragId) {
    target.classList.add('drag-over');
  }
}

function _wsDragLeave(e) {
  this.classList.remove('drag-over');
}

function _wsDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const targetId = this.dataset.wsId;
  if (!_wsDragId || _wsDragId === targetId) return;

  // Reorder _workspaces array
  const fromIdx = _workspaces.findIndex(w => w.id === _wsDragId);
  const toIdx = _workspaces.findIndex(w => w.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const [moved] = _workspaces.splice(fromIdx, 1);
  _workspaces.splice(toIdx, 0, moved);

  // Re-render immediately
  renderWorkspaces();

  // Persist order to backend
  const order = _workspaces.map(w => w.id);
  fetch('/api/workspaces/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order })
  }).catch(err => console.error('Failed to persist workspace order:', err));
}

function openWsModal(editWs) {
  document.getElementById('ws-modal').style.display = 'flex';
  if (editWs) {
    document.getElementById('ws-modal-title').textContent = 'EDIT WORKSPACE';
    document.getElementById('ws-name-input').value = editWs.name || '';
    document.getElementById('ws-desc-input').value = editWs.description || '';
    document.getElementById('ws-start-date-input').value = editWs.start_date || '';
    document.getElementById('ws-priority-input').value = editWs.priority || 'medium';
    document.getElementById('ws-edit-id').value = editWs.id;
  } else {
    document.getElementById('ws-modal-title').textContent = 'CREATE WORKSPACE';
    document.getElementById('ws-name-input').value = '';
    document.getElementById('ws-desc-input').value = '';
    document.getElementById('ws-start-date-input').value = new Date().toISOString().slice(0, 10);
    document.getElementById('ws-priority-input').value = 'medium';
    document.getElementById('ws-edit-id').value = '';
  }
  setTimeout(() => document.getElementById('ws-name-input').focus(), 100);
}

function closeWsModal() {
  document.getElementById('ws-modal').style.display = 'none';
}

async function saveWorkspace() {
  const name = document.getElementById('ws-name-input').value.trim();
  if (!name) return;
  const desc = document.getElementById('ws-desc-input').value.trim();
  const startDate = document.getElementById('ws-start-date-input').value;
  const priority = document.getElementById('ws-priority-input').value;
  const editId = document.getElementById('ws-edit-id').value;

  try {
    if (editId) {
      await fetch(`/api/workspaces/${editId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, description:desc, start_date:startDate, priority}) });
    } else {
      await fetch('/api/workspaces', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, description:desc, start_date:startDate, priority}) });
    }
    closeWsModal();
    await fetchWorkspaces();
    if (_currentWsId) openWsDetail(_currentWsId);
  } catch(e) { alert('Failed: ' + e.message); }
}


function switchWsSubTab(tab) {
  _wsSubTab = tab;
  if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
  document.querySelectorAll('#ws-detail-tabs .savant-subtab').forEach(b => {
    const t = b.getAttribute('onclick').match(/'(\w+)'/)[1];
    b.classList.toggle('active', t === tab);
  });
  document.getElementById('ws-detail-sessions').style.display = tab === 'sessions' ? '' : 'none';
  document.getElementById('ws-detail-mrs').style.display = tab === 'mrs' ? '' : 'none';
  document.getElementById('ws-detail-jira').style.display = tab === 'jira' ? '' : 'none';
  document.getElementById('ws-detail-tasks').style.display = tab === 'tasks' ? '' : 'none';
  document.getElementById('ws-detail-files').style.display = tab === 'files' ? '' : 'none';
  document.getElementById('ws-detail-sfiles').style.display = tab === 'sfiles' ? '' : 'none';
  document.getElementById('ws-detail-notes').style.display = tab === 'notes' ? '' : 'none';
  document.getElementById('ws-detail-abilities').style.display = tab === 'abilities' ? '' : 'none';
  document.getElementById('ws-detail-knowledge').style.display = tab === 'knowledge' ? '' : 'none';
  // Clear workspace KG HTML when leaving to avoid duplicate IDs with main KG
  if (tab !== 'knowledge') {
    const wsKg = document.getElementById('ws-detail-knowledge');
    if (wsKg) wsKg.innerHTML = '';
    _kbWsId = null;
  }
  if (tab === 'mrs' && _currentWsId) loadWsMergeRequests();
  if (tab === 'jira' && _currentWsId) loadWsJiraTickets();
  if (tab === 'tasks' && _currentWsId) _refreshWsTasks(_currentWsId);
  if (tab === 'files' && _currentWsId) loadWsFiles(_currentWsId);
  if (tab === 'sfiles' && _currentWsId) loadWsSessionFiles(_currentWsId);
  if (tab === 'notes' && _currentWsId) loadWsNotes(_currentWsId);
  if (tab === 'abilities' && _currentWsId) loadWsAbilities(_currentWsId);
  if (tab === 'knowledge' && _currentWsId) loadWsKnowledge(_currentWsId);
  }
async function openWsDetail(wsId) {
  showLoadingScreen(() => { _openWsDetailInner(wsId); });
}
async function _openWsDetailInner(wsId) {
  _currentWsId = wsId;
  _updateHash();
  const ws = _workspaces.find(w => w.id === wsId);
  if (!ws) return;

  // Set global workspace name for status bar
  window._currentWsName = ws.name;
  if (typeof updateBreadcrumb === 'function') updateBreadcrumb();

  document.getElementById('workspace-view').style.display = 'none';
  const dv = document.getElementById('workspace-detail-view');
  dv.style.display = 'block';
  document.getElementById('ws-detail-title').textContent = ws.name;
  document.getElementById('ws-detail-desc').textContent = ws.description || '';
  document.getElementById('ws-detail-status-badge').innerHTML = _statusBadge(ws);
  document.getElementById('ws-detail-priority-badge').innerHTML = _priorityBadge(ws.priority);
  const elapsed = _elapsedSince(ws.start_date);
  document.getElementById('ws-detail-elapsed').textContent = elapsed ? `⏱ ${elapsed}` + (ws.start_date ? ` (since ${ws.start_date})` : '') : '';
  const toggleBtn = document.getElementById('ws-detail-toggle-btn');
  const isClosed = (ws.status || 'open') === 'closed';
  toggleBtn.textContent = isClosed ? '▶ REOPEN' : '✕ CLOSE';
  toggleBtn.style.color = isClosed ? 'var(--green)' : 'var(--red)';
  toggleBtn.style.borderColor = isClosed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';

  // Set color picker
  const colorInput = document.getElementById('ws-detail-color');
  colorInput.value = ws.color || '#00f0ff';

  // Reset to sessions tab
  _wsSubTab = 'sessions';
  document.querySelectorAll('#ws-detail-tabs .savant-subtab').forEach(b => {
    const match = (b.getAttribute('onclick') || '').match(/'(\w+)'/);
    const t = match ? match[1] : '';
    b.classList.toggle('active', t === 'sessions');
  });
  document.getElementById('ws-detail-tasks').style.display = 'none';
  document.getElementById('ws-detail-mrs').style.display = 'none';
  document.getElementById('ws-detail-jira').style.display = 'none';
  document.getElementById('ws-detail-files').style.display = 'none';
  document.getElementById('ws-detail-sfiles').style.display = 'none';
  document.getElementById('ws-detail-notes').style.display = 'none';
  document.getElementById('ws-detail-abilities').style.display = 'none';
  document.getElementById('ws-detail-knowledge').style.display = 'none';
  document.getElementById('ws-detail-sessions').style.display = '';

  const statsEl = document.getElementById('ws-detail-stats');
  const container = document.getElementById('ws-detail-sessions');
  const tasksContainer = document.getElementById('ws-detail-tasks');
  const mrsContainer = document.getElementById('ws-detail-mrs');
  const jiraContainer = document.getElementById('ws-detail-jira');
  const filesContainer = document.getElementById('ws-detail-files');
  const sFilesContainer = document.getElementById('ws-detail-sfiles');
  const notesContainer = document.getElementById('ws-detail-notes');
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  tasksContainer.innerHTML = '';
  mrsContainer.innerHTML = '';
  mrsContainer.dataset.loaded = '';
  jiraContainer.innerHTML = '';
  jiraContainer.dataset.loaded = '';
  filesContainer.innerHTML = '';
  filesContainer.dataset.loaded = '';
  sFilesContainer.innerHTML = '';
  sFilesContainer.dataset.loaded = '';
  notesContainer.innerHTML = '';
  notesContainer.dataset.loaded = '';
  statsEl.innerHTML = '';

  try {
    // Fetch sessions and tasks in parallel
    const [sessRes, taskRes] = await Promise.all([
      fetch(`/api/workspaces/${wsId}/sessions?_=${Date.now()}`),
      fetch(`/api/tasks?workspace_id=${wsId}&_=${Date.now()}`)
    ]);
    const sessData = await sessRes.json();
    _wsDetailSessions = sessData.sessions || sessData || [];
    // Sort archived sessions to end
    _wsDetailSessions.sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
    const wsTasks = (await taskRes.json()).map(_normalizeTask);

    _renderWsStats(ws, wsTasks, statsEl);

    // Sessions tab — reuse buildCardHtml with provider badge
    if (!_wsDetailSessions.length) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;">
        No sessions assigned to this workspace yet.<br>Assign sessions from their detail page.</div>`;
    } else {
      container.innerHTML = _wsDetailSessions.map(s => {
      const provIcon = s.provider === 'copilot' ? '⟐' : s.provider === 'cline' ? '🤖' : s.provider === 'codex' ? '🧠' : s.provider === 'gemini' ? '♊' : '🎭';
        const provBadge = `<span class="provider-badge ${s.provider}">${provIcon} ${s.provider}</span>`;
        // Build a full card via buildCardHtml, then inject provider badge
        const cardHtml = buildCardHtml(s, s.provider);
        // Insert provider badge after first status-badge
        return cardHtml.replace(
          /(<span class="status-badge [^"]*">[^<]*<\/span>)/,
          `$1 ${provBadge}`
        );
      }).join('');
    }

    // Tasks tab — use shared renderer
    await _refreshWsTasks(wsId);
  } catch(e) {
    container.innerHTML = `<div style="color:var(--red);font-size:0.7rem;">Failed to load: ${e.message}</div>`;
  }
}

function exitWsDetail() {
  showLoadingScreen(() => {
    _currentWsId = null;
    window._currentWsName = null;
    _wsDetailSessions = [];
    if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
    // Clear workspace KG HTML to avoid duplicate IDs and stale content
    const wsKg = document.getElementById('ws-detail-knowledge');
    if (wsKg) wsKg.innerHTML = '';
    _kbWsId = null;
    document.getElementById('workspace-detail-view').style.display = 'none';
    document.getElementById('workspace-view').style.display = 'block';
    _updateHash();
  });
}

async function loadWsFiles(wsId) {
  const container = document.getElementById('ws-detail-files');
  if (container.dataset.loaded === wsId) return; // already loaded
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  try {
    const res = await fetch(`/api/workspaces/${wsId}/files?_=${Date.now()}`);
    const data = await res.json();
    const groups = data.groups || [];
    if (!groups.length) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;">
        No files found across workspace sessions.</div>`;
      container.dataset.loaded = wsId;
      return;
    }
    const totalFiles = groups.reduce((s, g) => s + g.file_count, 0);
    let html = `<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);margin-bottom:12px;">
      ${groups.length} session${groups.length !== 1 ? 's' : ''} · ${totalFiles} file${totalFiles !== 1 ? 's' : ''} total</div>`;
    groups.forEach((g, idx) => {
      const provIcon = g.provider === 'copilot' ? '⟐' : g.provider === 'cline' ? '🤖' : g.provider === 'codex' ? '🧠' : g.provider === 'gemini' ? '♊' : '🎭';
      html += `<div class="ws-file-group">
        <div class="ws-file-group-header" onclick="this.classList.toggle('collapsed'); this.nextElementSibling.classList.toggle('hidden')">
          <span class="expand-icon">▼</span>
          <span class="provider-badge ${g.provider}" style="font-size:0.45rem;">${provIcon} ${g.provider}</span>
          <span class="ws-file-group-summary">${escapeHtml(g.summary)}</span>
          <span class="ws-file-group-count">${g.file_count} file${g.file_count !== 1 ? 's' : ''}</span>
        </div>
        <div class="ws-file-list">`;
      g.files.forEach(f => {
        html += `<div class="ws-file-item">
          <span class="ws-file-action ${f.action}">${f.action}</span>
          <span class="ws-file-path" title="${escapeHtml(f.path)}">${escapeHtml(f.relative || f.path)}</span>
          <span class="ws-file-count">${f.count}×</span>
        </div>`;
      });
      html += `</div></div>`;
    });
    container.innerHTML = html;
    container.dataset.loaded = wsId;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--red);font-size:0.7rem;">Failed to load files: ${e.message}</div>`;
  }
}

async function loadWsSessionFiles(wsId) {
  const container = document.getElementById('ws-detail-sfiles');
  if (container.dataset.loaded === wsId) return;
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  try {
    const res = await fetch(`/api/workspaces/${wsId}/session-files?_=${Date.now()}`);
    const data = await res.json();
    const groups = data.groups || [];
    if (!groups.length) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;">
        No session files found.</div>`;
      container.dataset.loaded = wsId;
      return;
    }
    const totalFiles = groups.reduce((s, g) => s + g.file_count, 0);
    const catIcons = {plan:'📝', checkpoint:'🔖', file:'📄', research:'🔬', rewind:'⏪'};
    let html = `<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);margin-bottom:12px;">
      ${groups.length} session${groups.length !== 1 ? 's' : ''} · ${totalFiles} file${totalFiles !== 1 ? 's' : ''} total</div>`;
    groups.forEach(g => {
      const provIcon = g.provider === 'copilot' ? '⟐' : g.provider === 'cline' ? '🤖' : g.provider === 'codex' ? '🧠' : g.provider === 'gemini' ? '♊' : '🎭';
      html += `<div class="ws-file-group">
        <div class="ws-file-group-header" onclick="this.classList.toggle('collapsed'); this.nextElementSibling.classList.toggle('hidden')">
          <span class="expand-icon">▼</span>
          <span class="provider-badge ${g.provider}" style="font-size:0.45rem;">${provIcon} ${g.provider}</span>
          <span class="ws-file-group-summary">${escapeHtml(g.summary)}</span>
          <span class="ws-file-group-count">${g.file_count} file${g.file_count !== 1 ? 's' : ''}</span>
        </div>
        <div class="ws-file-list">`;
      g.files.forEach(f => {
        const icon = catIcons[f.category] || '📄';
        const sizeStr = f.size ? (f.size < 1024 ? f.size + ' B' : (f.size / 1024).toFixed(1) + ' KB') : '';
        const eSid = escapeHtml(g.session_id);
        const ePath = escapeHtml(f.path);
        const eName = escapeHtml(f.name || f.path);
        html += `<div class="ws-file-item" style="cursor:pointer;" onclick="openWsSessionFile('${eSid}','${ePath}','${eName}','${g.provider}')">
          <span class="ws-file-action ${f.category}" style="min-width:72px;text-align:center;">${icon} ${f.category}</span>
          <span class="ws-file-path" title="${escapeHtml(f.path)}">${escapeHtml(f.name || f.path)}</span>
          <span class="ws-file-count" style="min-width:60px;text-align:right;">${sizeStr}</span>
        </div>`;
      });
      html += `</div></div>`;
    });
    container.innerHTML = html;
    container.dataset.loaded = wsId;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--red);font-size:0.7rem;">Failed to load session files: ${e.message}</div>`;
  }
}

function loadWsMergeRequests() {
  const el = document.getElementById('ws-detail-mrs');
  if (el.dataset.loaded) return;
  el.dataset.loaded = '1';

  // Fetch from registry API for this workspace
  fetch(`/api/merge-requests?workspace_id=${_currentWsId}&_=${Date.now()}`)
    .then(r => r.json())
    .then(registryMrs => {
      const regById = {};
      for (const m of registryMrs) regById[m.id] = m;

      const sessions = _wsDetailSessions || [];
      // Aggregate MRs: group by URL, collect all session appearances
      const mrMap = {};  // url → { url, jira, status, entries: [{session, status, role, mr_id}] }

      // Seed from registry
      for (const m of registryMrs) {
        const key = (m.url || '').toLowerCase().replace(/\/+$/, '');
        if (!key) continue;
        mrMap[key] = { url: m.url, jira: m.jira || '', status: m.status || 'open', entries: [] };
      }

      // Walk sessions
      for (const s of sessions) {
        if (!s.mrs || !s.mrs.length) continue;
        for (const mr of s.mrs) {
          let url = (mr.url || '').trim();
          let jira = mr.jira || '';
          let status = mr.status || 'open';
          let role = mr.role || 'author';
          // New format: resolve mr_id → registry
          if (!url && mr.mr_id) {
            const reg = regById[mr.mr_id];
            if (reg) {
              url = reg.url || '';
              jira = reg.jira || jira;
              status = reg.status || status;
            }
          }
          if (!url) continue;
          const key = url.toLowerCase().replace(/\/+$/, '');
          if (!mrMap[key]) mrMap[key] = { url: url, jira: jira, status: status, entries: [] };
          if (jira && !mrMap[key].jira) mrMap[key].jira = jira;
          mrMap[key].entries.push({
            session: s,
            status: status,
            role: role,
            mr_id: mr.id || mr.mr_id
          });
        }
      }

      const mrList = Object.values(mrMap);
      mrList.sort((a, b) => b.entries.length - a.entries.length);

  if (!mrList.length) {
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;">
      No merge requests found in this workspace's sessions.</div>`;
    return;
  }

  const mrColors = { draft:'#ffc700', open:'#00a6ff', review:'#a855f7', testing:'#ff8c00', 'on-hold':'#ef4444', merged:'#00ff88', closed:'#6b7280' };
  const mrLabels = { draft:'Draft', open:'Open', review:'Review', testing:'Testing', 'on-hold':'On Hold', merged:'Merged', closed:'Closed' };

  let html = `<div style="margin-bottom:10px;color:var(--text-dim);font-size:0.65rem;font-family:var(--font-mono);">
    ${mrList.length} merge request${mrList.length !== 1 ? 's' : ''} across ${sessions.filter(s => s.mrs && s.mrs.length).length} sessions</div>`;

  html += `<table class="ws-mr-table"><thead><tr>
    <th style="width:35%">MERGE REQUEST</th>
    <th style="width:10%">JIRA</th>
    <th style="width:55%">SESSIONS</th>
  </tr></thead><tbody>`;

  for (const mr of mrList) {
    // Extract short MR label from URL
    const urlParts = mr.url.match(/\/([^\/]+\/[^\/]+)\/(merge_requests|pull)\/(\d+)/);
    const shortLabel = urlParts ? `${urlParts[1]}!${urlParts[3]}` : mr.url.replace(/https?:\/\/[^\/]+\//, '');

    html += `<tr><td>
      <a href="${escapeHtml(mr.url)}" target="_blank" class="ws-mr-url" title="${escapeHtml(mr.url)}">${escapeHtml(shortLabel)}</a>
    </td><td>`;
    if (mr.jira) html += `<span class="ws-mr-jira">${escapeHtml(mr.jira)}</span>`;
    html += `</td><td>`;

    for (const e of mr.entries) {
      const sName = e.session.nickname || e.session.summary || e.session.id.slice(0, 8);
      const provIcon = e.session.provider === 'copilot' ? '⟐' : e.session.provider === 'cline' ? '🤖' : e.session.provider === 'codex' ? '🧠' : e.session.provider === 'gemini' ? '♊' : '🎭';
      const statusColor = mrColors[e.status] || '#888';
      const statusLabel = mrLabels[e.status] || e.status;
      const provStr = e.session.provider ? `<span class="chip-provider">${provIcon} ${e.session.provider}</span>` : '';
      const roleClass = e.role === 'reviewer' ? 'reviewer' : 'author';
      const roleIcon = e.role === 'reviewer' ? '👁️' : '✍️';
      const prov = e.session.provider || 'copilot';

      html += `<span class="ws-mr-session-chip" onclick="navigateToSession(event,'${e.session.id}','${prov}')" title="Go to session: ${escapeHtml(sName)}">
        ${provStr}
        <span style="color:var(--text);">${escapeHtml(sName)}</span>
        <span class="ws-mr-role ${roleClass}">${roleIcon} ${e.role}</span>
        <span class="chip-status" style="background:${statusColor};color:var(--bg);">${statusLabel}</span>
      </span>`;
    }
    html += `</td></tr>`;
  }

  html += `</tbody></table>`;
  el.innerHTML = html;
    }).catch(e => {
      el.innerHTML = `<div style="color:var(--red);font-size:0.6rem;padding:20px;">Failed to load: ${e.message}</div>`;
    });
}

function loadWsJiraTickets() {
  const el = document.getElementById('ws-detail-jira');
  if (el.dataset.loaded) return;
  el.dataset.loaded = '1';

  fetch(`/api/jira-tickets?workspace_id=${_currentWsId}&_=${Date.now()}`)
    .then(r => r.json())
    .then(tickets => {
      if (!tickets.length) {
        el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;">
          No Jira tickets found in this workspace.</div>`;
        return;
      }

      const statusColors = { 'todo':'#ffc700', 'in-progress':'#00a6ff', 'in-review':'#a855f7', 'done':'#00ff88', 'blocked':'#ef4444' };
      const statusLabels = { 'todo':'Todo', 'in-progress':'In Progress', 'in-review':'In Review', 'done':'Done', 'blocked':'Blocked' };

      // Filters
      let html = `<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="ws-jira-filter-assignee" placeholder="Filter by assignee..." oninput="filterWsJira()" style="flex:1;min-width:120px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;font-family:var(--font-mono);font-size:0.65rem;" />
        <select id="ws-jira-filter-status" onchange="filterWsJira()" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;font-family:var(--font-mono);font-size:0.65rem;">
          <option value="">All Statuses</option>
          <option value="todo">Todo</option>
          <option value="in-progress">In Progress</option>
          <option value="in-review">In Review</option>
          <option value="done">Done</option>
          <option value="blocked">Blocked</option>
        </select>
        <span style="color:var(--text-dim);font-size:0.6rem;">${tickets.length} ticket${tickets.length !== 1 ? 's' : ''}</span>
      </div>`;

      html += `<table class="ws-mr-table" id="ws-jira-table"><thead><tr>
        <th style="width:15%">KEY</th>
        <th style="width:30%">TITLE</th>
        <th style="width:12%">STATUS</th>
        <th style="width:12%">PRIORITY</th>
        <th style="width:15%">ASSIGNEE</th>
        <th style="width:16%">REPORTER</th>
      </tr></thead><tbody>`;

      for (const t of tickets) {
        const sColor = statusColors[t.status] || '#888';
        const sLabel = statusLabels[t.status] || t.status || 'N/A';
        const prioIcons = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
        const url = t.url || `https://icapitalnetwork.atlassian.net/browse/${t.ticket_key}`;
        html += `<tr data-assignee="${escapeHtml((t.assignee||'').toLowerCase())}" data-status="${t.status||''}">
          <td><a href="${escapeHtml(url)}" target="_blank" class="ws-mr-url">${escapeHtml(t.ticket_key || 'N/A')}</a></td>
          <td style="color:var(--text);font-size:0.65rem;">${escapeHtml(t.title || '—')}</td>
          <td><span class="chip-status" style="background:${sColor};color:var(--bg);">${sLabel}</span></td>
          <td style="font-size:0.65rem;">${prioIcons[t.priority] || ''} ${t.priority || '—'}</td>
          <td style="font-size:0.65rem;color:var(--text-dim);">${escapeHtml(t.assignee || '—')}</td>
          <td style="font-size:0.65rem;color:var(--text-dim);">${escapeHtml(t.reporter || '—')}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
      el.innerHTML = html;
    }).catch(e => {
      el.innerHTML = `<div style="color:var(--red);font-size:0.6rem;padding:20px;">Failed to load: ${e.message}</div>`;
    });
}

function filterWsJira() {
  const assignee = (document.getElementById('ws-jira-filter-assignee')?.value || '').toLowerCase();
  const status = document.getElementById('ws-jira-filter-status')?.value || '';
  const rows = document.querySelectorAll('#ws-jira-table tbody tr');
  for (const row of rows) {
    const rAssignee = row.dataset.assignee || '';
    const rStatus = row.dataset.status || '';
    const show = (!assignee || rAssignee.includes(assignee)) && (!status || rStatus === status);
    row.style.display = show ? '' : 'none';
  }
}

function openWsSessionFile(sessionId, path, name, provider) {
  const prev = currentMode;
  currentMode = provider;
  openFile(sessionId, path, name);
  currentMode = prev;
}

function editCurrentWs() {
  const ws = _workspaces.find(w => w.id === _currentWsId);
  if (ws) openWsModal(ws);
}

async function deleteCurrentWs() {
  if (!confirm('Delete this workspace? Sessions will NOT be deleted.')) return;
  try {
    await fetch(`/api/workspaces/${_currentWsId}`, { method:'DELETE' });
    _currentWsId = null;
    _updateHash();
    // Clear workspace KG HTML
    const wsKg = document.getElementById('ws-detail-knowledge');
    if (wsKg) wsKg.innerHTML = '';
    _kbWsId = null;
    document.getElementById('workspace-detail-view').style.display = 'none';
    document.getElementById('workspace-view').style.display = 'block';
    await fetchWorkspaces();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function toggleCurrentWsStatus() {
  if (!_currentWsId) return;
  const ws = _workspaces.find(w => w.id === _currentWsId);
  if (!ws) return;
  const newStatus = (ws.status || 'open') === 'open' ? 'closed' : 'open';
  try {
    await fetch(`/api/workspaces/${_currentWsId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:newStatus}) });
    await fetchWorkspaces();
    openWsDetail(_currentWsId);
  } catch(e) { alert('Failed: ' + e.message); }
}

async function saveWsColor(color) {
  if (!_currentWsId) return;
  try {
    await fetch(`/api/workspaces/${_currentWsId}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({color: color || ''})
    });
    const ws = _workspaces.find(w => w.id === _currentWsId);
    if (ws) ws.color = color || null;
    // Update color picker display
    const colorInput = document.getElementById('ws-detail-color');
    if (colorInput) colorInput.value = color || '#00f0ff';
  } catch(e) { console.error(e); }
}

async function loadWsNotes(wsId) {
  const container = document.getElementById('ws-detail-notes');
  if (container.dataset.loaded === wsId) return;
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  try {
    const res = await fetch(`/api/workspaces/${wsId}/notes?_=${Date.now()}`);
    const data = await res.json();
    const groups = data.groups || [];
    container.dataset.loaded = wsId;
    if (!groups.length) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.7rem;">No notes yet across sessions in this workspace.</div>`;
      return;
    }
    const providerIcon = {copilot:'⟐', cline:'🤖', claude:'🎭', codex:'🧠', gemini:'♊'};
    let totalNotes = 0;
    groups.forEach(g => totalNotes += g.note_count);
    let html = `<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);margin-bottom:14px;">${totalNotes} note${totalNotes!==1?'s':''} across ${groups.length} session${groups.length!==1?'s':''}</div>`;
    groups.forEach((g, gIdx) => {
      const icon = providerIcon[g.provider] || '⟐';
      const collapseId = `ws-notes-group-${gIdx}`;
      html += `<div style="margin-bottom:18px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border);cursor:pointer;user-select:none;" onclick="const el=document.getElementById('${collapseId}');const arr=this.querySelector('.ws-notes-arrow');if(el.style.display==='none'){el.style.display='';arr.textContent='▾'}else{el.style.display='none';arr.textContent='▸'}">
          <span class="ws-notes-arrow" style="font-size:0.6rem;color:var(--text-dim);width:10px;">▾</span>
          <span style="font-size:0.7rem;">${icon}</span>
          <span style="font-family:'Orbitron',sans-serif;font-size:0.65rem;color:var(--cyan);" onclick="event.stopPropagation();navigateToSession('${g.session_id}','${g.provider}')">${escapeHtml(g.summary)}</span>
          <span style="font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);margin-left:auto;">${g.note_count} note${g.note_count!==1?'s':''}</span>
        </div>
        <div class="notes-list" id="${collapseId}">`;
      g.notes.forEach(n => {
        const date = n.timestamp ? new Date(n.timestamp) : null;
        const formatted = date ? date.toLocaleString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) : '';
        const rendered = (typeof marked !== 'undefined') ? marked.parse(n.text) : escapeHtml(n.text);
        html += `
          <div class="note-card">
            <div class="note-header">
              <span class="note-timestamp">${formatted}</span>
            </div>
            <div class="note-text">${rendered}</div>
          </div>`;
      });
      html += `</div></div>`;
    });
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--red);font-size:0.7rem;">Failed to load notes: ${e.message}</div>`;
  }
}

function navigateToSessionDirect(sessionId, provider) {
  _pushNavState();
  let url;
  if (provider === 'cline') url = `/cline/task/${sessionId}`;
  else if (provider === 'claude') url = `/claude/session/${sessionId}`;
  else if (provider === 'codex') url = `/codex/session/${sessionId}`;
  else url = `/session/${sessionId}`;
  showLoadingThenNavigate(url);
}

// ── Knowledge Browser ─────────────────────────────────────────────────────

async function loadWsKnowledge(wsId) {
  const container = document.getElementById('ws-detail-knowledge');
  // Set workspace mode BEFORE loading
  _kbWsId = wsId;

  _kbInited = false;
  _kbSelectedNode = null;
  _kbSelectedNodes = new Map();

  // Inject workspace toolbar + the exact same KG viewer HTML
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-family:var(--font-mono);font-size:0.45rem;color:var(--cyan);padding:2px 6px;border:1px solid var(--cyan);border-radius:3px;opacity:0.7;">WORKSPACE FILTER</span>
        <span class="ctx-status-item" id="kb-stat-count" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;font-size:0.55rem;" onclick="kbShowInfoModal()" title="Click to see detailed breakdown"></span>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="ctx-btn-sm" onclick="kbExportWorkspace('${wsId}')" title="Export workspace KG as JSON">⬇ Export</button>
        <button class="ctx-btn-sm" onclick="kbImportWorkspace('${wsId}')" title="Import KG from JSON file">⬆ Import</button>
        <button class="ctx-btn-sm" onclick="kbPurgeWorkspaceModal('${wsId}')" title="Purge all KG nodes for this workspace" style="border-color:rgba(239,68,68,0.3);color:var(--red);">🗑 Purge</button>
        <button class="ctx-btn-sm" onclick="kbCommitWorkspace('${wsId}')" title="Commit all staged nodes to main graph" style="font-size:0.5rem;border-color:rgba(16,185,129,0.3);color:#10b981;">✓ Commit</button>
        <button class="ctx-btn-sm" onclick="loadWsKnowledge('${wsId}')">↻</button>
      </div>
    </div>
    <!-- Toolbar (same as main KG) -->
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;flex-wrap:wrap;">
      <input type="text" id="kb-graph-search" placeholder="Search & press Enter to add…" onkeydown="if(event.key==='Enter')kbGraphSearch(); if(event.key==='Escape'){this.value='';}" style="flex:1;max-width:260px;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:5px;padding:6px 10px;font-family:var(--font-mono);font-size:0.6rem;">
      <button class="ctx-btn-sm" onclick="kbClearSearchHighlight()" id="kb-search-clear-btn" style="display:none;font-size:0.5rem;">✕ Clear</button>
      <div style="display:flex;gap:2px;border:1px solid var(--border);border-radius:5px;overflow:hidden;">
        <button class="kb-layer-btn active" id="kb-layer-all" onclick="kbSetLayer('all',this)" style="padding:4px 10px;font-size:0.55rem;font-family:var(--font-mono);background:var(--cyan);color:var(--bg);border:none;cursor:pointer;">ALL</button>
        <button class="kb-layer-btn" id="kb-layer-business" onclick="kbSetLayer('business',this)" style="padding:4px 10px;font-size:0.55rem;font-family:var(--font-mono);background:var(--bg-main);color:var(--text-dim);border:none;cursor:pointer;">BUSINESS</button>
        <button class="kb-layer-btn" id="kb-layer-stack" onclick="kbSetLayer('stack',this)" style="padding:4px 10px;font-size:0.55rem;font-family:var(--font-mono);background:var(--bg-main);color:var(--text-dim);border:none;cursor:pointer;">STACK</button>
      </div>
      <div id="kb-type-filters" style="display:flex;gap:3px;flex-wrap:wrap;">
        ${['client','domain','service','library','technology','insight','project','concept','repo','session','issue'].map(t =>
          `<button class="kb-type-btn" onclick="kbFilterType(this,'${t}')" style="padding:3px 8px;font-size:0.45rem;background:var(--bg-main);color:${KB_NODE_COLORS[t]||'#6b7280'};border:1px solid ${KB_NODE_COLORS[t]||'#6b7280'}44;border-radius:4px;cursor:pointer;font-family:var(--font-mono);">${KB_NODE_ICONS[t]||'❓'} ${t}</button>`
        ).join('')}
      </div>
      <select id="kb-recency-select" onchange="kbFilterRecent(this.value)" style="background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:5px;padding:4px 8px;font-family:var(--font-mono);font-size:0.5rem;">
        <option value="">All Time</option><option value="1d">Today</option><option value="2d">Last 2 Days</option><option value="1w">This Week</option>
      </select>
      <button class="ws-mcp-run-btn" style="margin:0;padding:4px 12px;font-size:0.5rem;" onclick="kbShowAddNodeModal()">+ Node</button>
    </div>
    <!-- Search chips -->
    <div id="kb-search-chips-row" style="display:none;padding:4px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;"></div>
    <!-- Main graph + detail -->
    <div style="display:flex;gap:0;height:450px;border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-top:4px;">
      <div id="kb-graph-container" style="flex:1;position:relative;background:var(--bg-main);min-width:0;">
        <svg id="kb-graph-svg" style="width:100%;height:100%;"></svg>
        <div id="kb-graph-zoom-controls" style="position:absolute;bottom:10px;right:10px;display:flex;gap:4px;z-index:10;">
          <button class="ctx-btn-sm" onclick="kbZoomIn()" style="font-size:0.7rem;padding:4px 8px;">+</button>
          <button class="ctx-btn-sm" onclick="kbZoomOut()" style="font-size:0.7rem;padding:4px 8px;">−</button>
          <button class="ctx-btn-sm" onclick="kbZoomReset()" style="font-size:0.6rem;padding:4px 8px;">⟲</button>
        </div>
        <button id="kb-panel-expand-btn" onclick="kbToggleDetailPanel()" style="position:absolute;top:8px;right:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:4px 8px;cursor:pointer;font-size:0.5rem;color:var(--text-dim);z-index:10;">◀</button>
        <div id="kb-graph-empty" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:var(--text-dim);font-family:var(--font-mono);font-size:0.65rem;">No nodes to display</div>
      </div>
      <div id="kb-detail-panel" style="width:280px;min-width:240px;max-height:450px;border-left:1px solid var(--border);background:var(--bg-card);overflow-y:auto;font-family:var(--font-mono);padding:0;flex-shrink:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-card);z-index:5;">
          <span style="font-size:0.45rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);">Node Detail</span>
          <button onclick="kbToggleDetailPanel()" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:0.6rem;padding:0;">▶</button>
        </div>
        <div id="kb-detail-content" style="padding:12px;">
          <div style="text-align:center;padding:40px 16px;color:var(--text-dim);font-size:0.6rem;">Click a node to see details</div>
        </div>
      </div>
    </div>`;

  // Now load graph with workspace filter
  await kbLoadGraph();
}

// Export/Import workspace KG
async function kbExportWorkspace(wsId) {
  try {
    const res = await fetch(`/api/knowledge/export?workspace_id=${wsId}&_=${Date.now()}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `knowledge-${wsId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { alert('Export failed: ' + e.message); }
}

function kbImportWorkspace(wsId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch('/api/knowledge/import', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ workspace_id: wsId, nodes: data.nodes || [], edges: data.edges || [] }),
      });
      const result = await res.json();
      alert(`Import complete: ${result.nodes_created} created, ${result.nodes_skipped} existing, ${result.edges_created} edges`);
      loadWsKnowledge(wsId);
    } catch(err) { alert('Import failed: ' + err.message); }
  };
  input.click();
}

async function kbLinkToWsFromGraph(wsId) {
  let allNodes = [];
  try {
    const res = await fetch('/api/knowledge/graph?limit=500&_=' + Date.now());
    const data = await res.json();
    const wsNodeIds = new Set((_kbGraphData.nodes || []).map(n => n.node_id));
    allNodes = (data.nodes || []).filter(n => !wsNodeIds.has(n.node_id));
  } catch(e) {}

  if (!allNodes.length) { alert('No unlinked nodes available.'); return; }

  const grouped = {};
  allNodes.forEach(n => {
    const t = n.node_type || 'other';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(n);
  });
  Object.values(grouped).forEach(arr => arr.sort((a, b) => (a.title || '').localeCompare(b.title || '')));
  const sortedTypes = Object.keys(grouped).sort();

  // Multi-select with checkboxes
  let listHtml = sortedTypes.map(type => {
    const icon = KB_NODE_ICONS[type] || '❓';
    const color = KB_NODE_COLORS[type] || '#6b7280';
    const items = grouped[type].map(n =>
      `<label style="display:flex;align-items:center;gap:6px;padding:3px 4px;cursor:pointer;border-radius:3px;" onmouseover="this.style.background='var(--bg-main)'" onmouseout="this.style.background=''">
        <input type="checkbox" class="kb-ws-link-cb" value="${n.node_id}" style="accent-color:var(--cyan);">
        <span style="font-size:0.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(n.title)}</span>
      </label>`
    ).join('');
    return `<div style="margin-bottom:4px;">
      <div onclick="kbToggleConnectGroup('kb-ws-link-${type}')" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:3px 0;">
        <span id="kb-ws-link-${type}-arrow" style="font-size:0.5rem;transition:transform 0.15s;transform:rotate(-90deg);">▼</span>
        <span style="font-size:0.5rem;color:${color};font-weight:600;">${icon} ${type.toUpperCase()} (${grouped[type].length})</span>
      </div>
      <div id="kb-ws-link-${type}" style="display:none;padding-left:16px;">${items}</div>
    </div>`;
  }).join('');

  const html = `<div style="font-family:'Orbitron',sans-serif;font-size:0.6rem;color:var(--cyan);margin-bottom:12px;">LINK NODES TO WORKSPACE</div>
    <div style="font-size:0.5rem;color:var(--text-dim);margin-bottom:8px;">Select nodes to add to this workspace.</div>
    <div style="max-height:350px;overflow-y:auto;margin-bottom:12px;border:1px solid var(--border);border-radius:4px;padding:6px;">
      ${listHtml}
    </div>
    <div id="kb-ws-link-count" style="font-size:0.45rem;color:var(--cyan);margin-bottom:8px;">0 selected</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="ctx-btn-sm" onclick="document.getElementById('kb-add-modal-overlay').style.display='none'">Cancel</button>
      <button class="ws-mcp-run-btn" style="margin:0;font-size:0.55rem;" onclick="_kbWsLinkSubmit('${wsId}')">Link Selected</button>
    </div>`;

  let overlay = document.getElementById('kb-add-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'kb-add-modal-overlay';
    overlay.className = 'ws-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
    overlay.innerHTML = `<div class="ws-modal" style="max-width:440px;" id="kb-add-modal-inner"></div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('kb-add-modal-inner').innerHTML = html;
  overlay.style.display = 'flex';

  // Update count on checkbox change
  overlay.addEventListener('change', () => {
    const checked = overlay.querySelectorAll('.kb-ws-link-cb:checked').length;
    const countEl = document.getElementById('kb-ws-link-count');
    if (countEl) countEl.textContent = `${checked} selected`;
  });
}

async function _kbWsLinkSubmit(wsId) {
  const checkboxes = document.querySelectorAll('.kb-ws-link-cb:checked');
  const nodeIds = [...checkboxes].map(cb => cb.value);
  if (!nodeIds.length) { alert('Select at least one node'); return; }
  try {
    await fetch('/api/knowledge/nodes/bulk-link-workspace', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ node_ids: nodeIds, workspace_id: wsId })
    });
    document.getElementById('kb-add-modal-overlay').style.display = 'none';
    loadWsKnowledge(wsId);
  } catch(e) { alert('Failed: ' + e.message); }
}

async function deleteKnowledge(expId, wsId) {
  if (!confirm('Delete this knowledge entry?')) return;
  try {
    await fetch(`/api/knowledge/${expId}`, { method: 'DELETE' });
    const container = document.getElementById('ws-detail-knowledge');
    container.dataset.loaded = '';
    loadWsKnowledge(wsId);
  } catch(e) {
    alert('Failed to delete: ' + e.message);
  }
}

function showAddKnowledgeForm(wsId) {
  const container = document.getElementById('ws-detail-knowledge');
  const existing = document.getElementById('kb-add-form');
  if (existing) { existing.remove(); return; }
  const form = document.createElement('div');
  form.id = 'kb-add-form';
  form.style.cssText = 'margin-bottom:18px;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);';
  form.innerHTML = `
    <div style="font-family:'Orbitron',sans-serif;font-size:0.6rem;color:var(--cyan);margin-bottom:10px;">ADD KNOWLEDGE</div>
    <textarea id="kb-add-content" placeholder="What experience or insight to store..." style="width:100%;min-height:80px;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;font-family:var(--font-mono);font-size:0.65rem;resize:vertical;box-sizing:border-box;"></textarea>
    <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
      <select id="kb-add-source" style="background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-family:var(--font-mono);font-size:0.6rem;">
        <option value="note">📝 note</option>
        <option value="session">⟐ session</option>
        <option value="task">☑ task</option>
      </select>
      <input id="kb-add-repo" placeholder="repo (optional)" style="flex:1;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-family:var(--font-mono);font-size:0.6rem;" />
      <button onclick="submitKnowledge('${wsId}')" class="ws-mcp-run-btn" style="margin:0;">SAVE</button>
      <button onclick="document.getElementById('kb-add-form').remove()" style="background:none;border:1px solid var(--border);color:var(--text-dim);padding:4px 12px;border-radius:4px;cursor:pointer;font-family:var(--font-mono);font-size:0.55rem;">CANCEL</button>
    </div>`;
  container.insertBefore(form, container.firstChild);
  document.getElementById('kb-add-content').focus();
}

async function submitKnowledge(wsId) {
  const content = document.getElementById('kb-add-content').value.trim();
  if (!content) return;
  const source = document.getElementById('kb-add-source').value;
  const repo = document.getElementById('kb-add-repo').value.trim();
  try {
    await fetch('/api/knowledge/store', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ content, source, workspace_id: wsId, repo })
    });
    document.getElementById('kb-add-form').remove();
    const container = document.getElementById('ws-detail-knowledge');
    container.dataset.loaded = '';
    loadWsKnowledge(wsId);
  } catch(e) {
    alert('Failed to save: ' + e.message);
  }
}

async function loadWsAbilities(wsId) {
  const container = document.getElementById('ws-detail-abilities');
  if (!container) return;
  container.innerHTML = '<div class="loading">Resolving engineer abilities...</div>';
  
  try {
    // Resolve engineer persona for this workspace
    // We use the workspace name as repo_id since it's likely to match or be fuzzy-matched
    const ws = _workspaces.find(w => w.id === wsId) || {};
    const res = await fetch('/api/abilities/resolve', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        persona: 'engineer',
        repo_id: ws.name || wsId,
        tags: ['backend', 'frontend', 'python', 'javascript']
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const manifest = data.manifest || {};
    const applied = manifest.applied || {};
    
    let html = `<div style="margin-bottom:20px; border-bottom:1px solid var(--border); padding-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
      <h3 style="font-family:'Orbitron',sans-serif; font-size:0.8rem; color:var(--cyan);">RESOLVED ABILITIES</h3>
      <span style="font-size:0.5rem; color:var(--text-dim); font-family:var(--font-mono);">HASH: ${manifest.hash ? manifest.hash.slice(0,8) : 'N/A'}</span>
    </div>`;

    html += `<div class="ab-resolve-manifest" style="margin-bottom:20px; background:var(--bg-panel); border:1px solid var(--border); border-radius:8px; padding:12px 16px; font-family:var(--font-mono); font-size:0.55rem;">
      <div class="ab-manifest-row" style="margin-bottom:4px; color:var(--text-dim);"><span>Persona:</span> <code style="color:var(--magenta);">${applied.persona || 'engineer'}</code></div>
      <div class="ab-manifest-row" style="margin-bottom:4px; color:var(--text-dim);"><span>Repo Overlay:</span> <code style="color:var(--cyan);">${applied.repo || '(none)'}</code></div>
      <div class="ab-manifest-row" style="margin-bottom:4px; color:var(--text-dim);"><span>Applied Rules:</span> <code style="color:var(--green);">${(applied.rules || []).join(', ') || '(none)'}</code></div>
      <div class="ab-manifest-row" style="color:var(--text-dim);"><span>Applied Policies:</span> <code style="color:var(--yellow);">${(applied.policies || []).join(', ') || '(none)'}</code></div>
    </div>`;

    // Render the resolved prompt text
    const promptBody = data.prompt || '';
    const rendered = typeof marked !== 'undefined' ? marked.parse(promptBody) : promptBody;
    html += `<div class="markdown-body" style="background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:8px; padding:20px;">${rendered}</div>`;

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Failed to resolve abilities: ${e.message}</div>`;
  }
}

async function navigateToTask(taskId, workspaceId) {
  closeWsSearchResults();
  showLoadingScreen(async () => {
    _switchTabInner('tasks');
    await fetchTasks();
    const found = _allTasks.find(t => t.id === taskId);
    if (found) {
      openTaskModal(taskId);
    } else {
      alert('Task not found on the current date. It may be on a different day.');
    }
  });
}

async function generateWsContextPrompt() {
  if (!_currentWsId) return;
  const modal = document.getElementById('ctx-modal');
  const textarea = document.getElementById('ctx-prompt-text');
  const charCount = document.getElementById('ctx-char-count');
  textarea.value = 'Generating bridge prompt...';
  charCount.textContent = '';
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/workspaces/${_currentWsId}/context?_=${Date.now()}`);
    const data = await res.json();
    textarea.value = data.prompt;
    charCount.textContent = `${data.prompt.length.toLocaleString()} chars · ${data.session_count} sessions`;
  } catch(e) {
    textarea.value = 'Failed to generate bridge prompt: ' + e.message;
  }
}

function copyCtxPrompt() {
  const textarea = document.getElementById('ctx-prompt-text');
  navigator.clipboard.writeText(textarea.value).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = '✅ COPIED!';
    btn.style.borderColor = 'var(--green)';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.textContent = orig; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
  });
}

// ---------------------------------------------------------------------------
// Purge workspace KG
// ---------------------------------------------------------------------------

async function kbCommitWorkspace(wsId) {
  let stagedCount = 0;
  try {
    const res = await fetch('/api/knowledge/graph?workspace_id=' + wsId + '&include_staged=true&_=' + Date.now());
    const data = await res.json();
    const nodes = data.nodes || [];
    stagedCount = nodes.filter(n => n.status === 'staged').length;
  } catch(e) {}

  if (stagedCount === 0) {
    alert('No staged nodes to commit in this workspace.');
    return;
  }

  if (!confirm(`Commit ${stagedCount} staged node${stagedCount > 1 ? 's' : ''} to the main knowledge graph?`)) return;

  try {
    const res = await fetch('/api/knowledge/nodes/commit', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ workspace_id: wsId })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    loadWsKnowledge(wsId);
  } catch(e) {
    alert('Failed to commit: ' + e.message);
  }
}

async function kbPurgeWorkspaceModal(wsId) {
  let preview;
  try {
    const res = await fetch('/api/knowledge/purge-workspace-preview', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ workspace_id: wsId })
    });
    if (!res.ok) throw new Error(await res.text());
    preview = await res.json();
  } catch(e) {
    alert('Failed to load preview: ' + e.message);
    return;
  }

  const totalNodes = preview.to_delete + preview.to_unlink;
  if (totalNodes === 0) {
    alert('No knowledge nodes found for this workspace.');
    return;
  }

  const html = `
    <div style="font-family:'Orbitron',sans-serif;font-size:0.6rem;color:var(--red);margin-bottom:12px;">⚠️ PURGE WORKSPACE KNOWLEDGE</div>
    <div style="font-size:0.55rem;color:var(--text);margin-bottom:12px;">
      This will remove all knowledge graph data for this workspace:
    </div>
    <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:0.5rem;color:var(--text-dim);">Nodes to permanently delete:</span>
        <span style="font-size:0.55rem;font-weight:bold;color:var(--red);">${preview.to_delete}</span>
      </div>
      <div style="font-size:0.4rem;color:var(--text-dim);margin-bottom:8px;">These nodes belong only to this workspace and will be permanently removed along with all their connections.</div>
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:0.5rem;color:var(--text-dim);">Nodes to unlink (kept):</span>
        <span style="font-size:0.55rem;font-weight:bold;color:#f59e0b;">${preview.to_unlink}</span>
      </div>
      <div style="font-size:0.4rem;color:var(--text-dim);">These nodes belong to other workspaces too — only the workspace association will be removed.</div>
    </div>
    <div style="font-size:0.5rem;color:var(--red);margin-bottom:12px;">⚠️ This action cannot be undone.</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="ctx-btn-sm" onclick="document.getElementById('kb-add-modal-overlay').style.display='none'" style="font-size:0.5rem;">Cancel</button>
      <button class="ctx-btn-sm" onclick="kbPurgeWorkspaceConfirm('${wsId}')" style="font-size:0.5rem;background:rgba(239,68,68,0.2);border-color:rgba(239,68,68,0.5);color:var(--red);">🗑 Purge ${totalNodes} nodes</button>
    </div>
  `;

  let overlay = document.getElementById('kb-add-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'kb-add-modal-overlay';
    overlay.className = 'ws-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
    overlay.innerHTML = '<div class="ws-modal" style="max-width:420px;" id="kb-add-modal-inner"></div>';
    document.body.appendChild(overlay);
  }
  document.getElementById('kb-add-modal-inner').innerHTML = html;
  overlay.style.display = 'flex';
}

async function kbPurgeWorkspaceConfirm(wsId) {
  try {
    const res = await fetch('/api/knowledge/purge-workspace', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ workspace_id: wsId })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById('kb-add-modal-overlay').style.display = 'none';
    loadWsKnowledge(wsId);
  } catch(e) {
    alert('Purge failed: ' + e.message);
  }
}

// Fetch workspaces on load for the filter dropdown
fetchWorkspaces();
