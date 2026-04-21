// ── Task Board ─────────────────────────────────────────────
// Local date helper — returns YYYY-MM-DD based on browser timezone, not UTC
function _localDateStr(d) {
  if (!d) d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let _taskDate = _localDateStr();
let _endedDays = new Set();

function formatTaskDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = _localDateStr();
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const yesterday = _localDateStr(yd);
  const td = new Date(); td.setDate(td.getDate() + 1);
  const tomorrow = _localDateStr(td);
  const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (dateStr === today) return `${label} · TODAY`;
  if (dateStr === yesterday) return `${label} · YESTERDAY`;
  if (dateStr === tomorrow) return `${label} · TOMORROW`;
  return label;
}

function _isDayEnded() { return _endedDays.has(_taskDate); }

async function _fetchEndedDays() {
  try {
    const res = await fetch(`/api/tasks/ended-days?today=${_localDateStr()}&_=${Date.now()}`);
    const days = await res.json();
    _endedDays = new Set(days);
  } catch(e) { console.error('Failed to fetch ended days', e); }
}

function _applyDayLock() {
  const ended = _isDayEnded();
  const addBtn = document.querySelector('.task-day-btn.add');
  const endBtn = document.querySelector('.task-day-btn.end-day');
  const reopenBtn = document.getElementById('task-reopen-btn');
  if (addBtn) { addBtn.disabled = ended; addBtn.style.opacity = ended ? '0.3' : ''; addBtn.style.pointerEvents = ended ? 'none' : ''; }
  if (endBtn) { endBtn.style.display = ended ? 'none' : ''; }
  if (reopenBtn) { reopenBtn.style.display = ended ? '' : 'none'; }
  // Lock banner
  const banner = document.getElementById('task-locked-banner');
  if (banner) banner.style.display = ended ? 'flex' : 'none';
  // Disable drag on all task cards
  document.querySelectorAll('#kanban-board .task-card').forEach(card => {
    card.draggable = !ended;
    card.style.cursor = ended ? 'default' : 'grab';
  });
  // Hide move buttons
  document.querySelectorAll('#kanban-board .task-move-btns').forEach(el => {
    el.style.display = ended ? 'none' : '';
  });
  // Hide delete buttons
  document.querySelectorAll('#kanban-board .task-card-actions').forEach(el => {
    el.style.display = ended ? 'none' : '';
  });
}

function taskNavDate(delta) {
  const d = new Date(_taskDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  _taskDate = _localDateStr(d);
  fetchTasks();
}

function taskGoToday() {
  _taskDate = _localDateStr();
  fetchTasks();
}

async function fetchTasks() {
  document.getElementById('task-date-label').textContent = formatTaskDate(_taskDate);
  try {
    if (!_endedDays.size && !_endedDays._loaded) { await _fetchEndedDays(); _endedDays._loaded = true; }
    const res = await fetch(`/api/tasks?date=${_taskDate}&today=${_localDateStr()}&_=${Date.now()}`);
    _allTasks = (await res.json()).map(_normalizeTask);
    renderKanban();
    updateTaskCount();
    _populateTaskFilterDropdowns();
    _applyDayLock();
  } catch(e) { console.error('Failed to fetch tasks', e); }
}

// Normalize task_id → id so all frontend code can use t.id
function _normalizeTask(t) {
  if (t.task_id && !t.id) t.id = t.task_id;
  return t;
}

function updateTaskCount() {
  const el = document.getElementById('mode-tasks-count');
  const active = _allTasks.filter(t => t.status !== 'done').length;
  if (el) el.textContent = active || '';
}

// ── Task Filters ────────────────────────────────────────────
function _getTaskFilters() {
  return {
    search: (document.getElementById('task-filter-search')?.value || '').toLowerCase().trim(),
    workspace: document.getElementById('task-filter-workspace')?.value || '',
    priority: document.getElementById('task-filter-priority')?.value || '',
  };
}

function _taskMatchesFilters(t, f) {
  if (f.search && !(t.title||'').toLowerCase().includes(f.search) && !(t.description||'').toLowerCase().includes(f.search)) return false;
  if (f.workspace === '__none__' && t.workspace_id) return false;
  if (f.workspace && f.workspace !== '__none__' && t.workspace_id !== f.workspace) return false;
  if (f.priority && t.priority !== f.priority) return false;
  return true;
}

function applyTaskFilters() {
  renderKanban();
  _applyDayLock();
  // Badge
  const f = _getTaskFilters();
  const active = [f.search, f.workspace, f.project, f.priority].filter(Boolean).length;
  const badge = document.getElementById('task-filter-badge');
  if (badge) {
    badge.style.display = active ? '' : 'none';
    badge.textContent = `${active} filter${active !== 1 ? 's' : ''} active`;
  }
}

function clearTaskFilters() {
  const s = document.getElementById('task-filter-search'); if (s) s.value = '';
  const w = document.getElementById('task-filter-workspace'); if (w) w.value = '';
  const p = document.getElementById('task-filter-project'); if (p) p.value = '';
  const pr = document.getElementById('task-filter-priority'); if (pr) pr.value = '';
  applyTaskFilters();
}

function _populateTaskFilterDropdowns() {
  // Workspace dropdown — only show workspaces that have tasks on the board
  const wsSel = document.getElementById('task-filter-workspace');
  if (wsSel) {
    const val = wsSel.value;
    const wsIds = new Set(_allTasks.map(t => t.workspace_id).filter(Boolean));
    wsSel.innerHTML = '<option value="">All Workspaces</option><option value="__none__">Unassigned</option>';
    _workspaces.filter(ws => wsIds.has(ws.id)).forEach(ws => {
      wsSel.innerHTML += `<option value="${ws.id}">${escapeHtml(ws.name)}</option>`;
    });
    wsSel.value = val;
  }
  // Project dropdown — only projects from workspaces that have tasks
  const projSel = document.getElementById('task-filter-project');
  if (projSel) {
    const val = projSel.value;
    const wsIds = new Set(_allTasks.map(t => t.workspace_id).filter(Boolean));
    const projects = new Set();
    _workspaces.filter(ws => wsIds.has(ws.id)).forEach(ws => {
      if (ws.projects) ws.projects.forEach(p => projects.add(p));
    });
    projSel.innerHTML = '<option value="">All Projects</option>';
    [...projects].sort().forEach(p => {
      projSel.innerHTML += `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`;
    });
    projSel.value = val;
  }
  // Priority dropdown — only priorities present in current tasks
  const prioSel = document.getElementById('task-filter-priority');
  if (prioSel) {
    const val = prioSel.value;
    const prioIcons = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' };
    const prioOrder = ['critical', 'high', 'medium', 'low'];
    const present = new Set(_allTasks.map(t => t.priority).filter(Boolean));
    prioSel.innerHTML = '<option value="">All Priorities</option>';
    prioOrder.filter(p => present.has(p)).forEach(p => {
      prioSel.innerHTML += `<option value="${p}">${prioIcons[p] || ''} ${p.charAt(0).toUpperCase() + p.slice(1)}</option>`;
    });
    prioSel.value = val;
  }
}

function _countWeekdays(startDate, endDate) {
  let count = 0;
  const cur = new Date(startDate);
  cur.setHours(0,0,0,0);
  const end = new Date(endDate);
  end.setHours(0,0,0,0);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(0, count);
}

function _taskDaysInProgress(t) {
  if (!t.started_at) return null;
  const start = new Date(t.started_at);
  const end = t.completed_at ? new Date(t.completed_at) : new Date();
  return _countWeekdays(start, end);
}

function _ragColor(days) {
  if (days <= 2) return 'var(--green)';
  if (days <= 6) return 'var(--orange)';
  return 'var(--red)';
}

function _ragClass(days) {
  if (days <= 2) return 'rag-green';
  if (days <= 6) return 'rag-amber';
  return 'rag-red';
}

function _shortDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function _showTaskTimeInfo(t) {
  const el = document.getElementById('task-time-info');
  const parts = [];
  if (t.started_at) parts.push(`<span style="color:var(--cyan);">▶ Started:</span> ${_shortDate(t.started_at)}`);
  if (t.completed_at) parts.push(`<span style="color:var(--green);">✓ Completed:</span> ${_shortDate(t.completed_at)}`);
  const days = _taskDaysInProgress(t);
  if (days !== null) {
    const c = _ragColor(days);
    parts.push(`<span style="color:${c};">⏱ ${t.completed_at ? 'Total' : 'In progress'}:</span> ${days} weekday${days!==1?'s':''}`);
  }
  if (parts.length) { el.innerHTML = parts.join(' &nbsp;·&nbsp; '); el.style.display = ''; }
  else { el.style.display = 'none'; }
}

function _buildTaskTimeChips(t) {
  const parts = [];
  if (t.started_at) {
    parts.push(`<span class="task-time-chip started">▶ ${_shortDate(t.started_at)}</span>`);
  }
  if (t.completed_at) {
    parts.push(`<span class="task-time-chip completed">✓ ${_shortDate(t.completed_at)}</span>`);
  }
  const days = _taskDaysInProgress(t);
  if (days !== null) {
    const rc = _ragClass(days);
    const color = _ragColor(days);
    const label = t.completed_at ? `${days}d` : `${days}d+`;
    parts.push(`<span class="task-time-chip duration ${rc}" style="color:${color};border-color:${color};">${label}</span>`);
  }
  return parts.join('');
}

function renderKanban() {
  const f = _getTaskFilters();
  const filtered = _allTasks.filter(t => _taskMatchesFilters(t, f));
  const cols = { todo: [], 'in-progress': [], done: [], blocked: [] };
  filtered.forEach(t => {
    if (cols[t.status]) cols[t.status].push(t);
    else cols.todo.push(t);
  });

  // Stat cards
  const statsCards = document.getElementById('task-stats-cards');
  const total = _allTasks.length;
  const doneCount = cols.done.length;
  const inProgressCount = cols['in-progress'].length;
  const todoCount = cols.todo.length;
  const blockedCount = cols.blocked.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  // Priority counts
  const highCount = _allTasks.filter(t => t.priority === 'high').length;
  const medCount = _allTasks.filter(t => t.priority === 'medium').length;
  const lowCount = _allTasks.filter(t => t.priority === 'low').length;

  // Workspace distribution
  const wsMap = {};
  _allTasks.forEach(t => {
    const wsId = t.workspace_id;
    const ws = wsId ? _workspaces.find(w => w.id === wsId) : null;
    const name = ws ? ws.name : 'Unassigned';
    wsMap[name] = (wsMap[name] || 0) + 1;
  });
  const wsChips = Object.entries(wsMap).sort((a,b) => b[1] - a[1]).slice(0, 4)
    .map(([n, c]) => `<span style="font-size:0.5rem;">🗂 ${escapeHtml(n)} (${c})</span>`).join(' · ');

  // Avg days in progress
  const ipDays = _allTasks.filter(t => t.status === 'in-progress').map(t => _taskDaysInProgress(t)).filter(d => d !== null);
  const avgDays = ipDays.length ? (ipDays.reduce((a,b) => a+b, 0) / ipDays.length).toFixed(1) : '—';

  statsCards.innerHTML = `
    <div class="task-stat-card">
      <div class="ts-label">Total Tasks</div>
      <div class="ts-value" style="color:var(--cyan);">${total}</div>
      <div class="ts-sub">${todoCount} todo · ${inProgressCount} active</div>
    </div>
    <div class="task-stat-card">
      <div class="ts-label">Completed</div>
      <div class="ts-value" style="color:var(--green);">${pct}%</div>
      <div class="ts-sub">${doneCount} of ${total} done</div>
      ${total ? `<div style="margin-top:6px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:var(--green);border-radius:2px;"></div>
      </div>` : ''}
    </div>
    <div class="task-stat-card">
      <div class="ts-label">Blocked</div>
      <div class="ts-value" style="color:var(--red);">${blockedCount}</div>
      <div class="ts-sub">${blockedCount ? 'Needs attention' : 'All clear'}</div>
    </div>
    <div class="task-stat-card">
      <div class="ts-label">Priority</div>
      <div class="ts-value" style="color:var(--orange);">${highCount}</div>
      <div class="ts-sub">🔴 ${highCount} high · 🟡 ${medCount} med · 🔵 ${lowCount} low</div>
    </div>
    <div class="task-stat-card">
      <div class="ts-label">Avg Days Active</div>
      <div class="ts-value" style="color:${typeof avgDays === 'number' || avgDays !== '—' ? _ragColor(parseFloat(avgDays)||0) : 'var(--text)'};">${avgDays}</div>
      <div class="ts-sub">${ipDays.length} task${ipDays.length!==1?'s':''} in progress</div>
    </div>
    <div class="task-stat-card">
      <div class="ts-label">Workspaces</div>
      <div class="ts-value" style="color:var(--magenta);">${Object.keys(wsMap).length}</div>
      <div class="ts-sub">${wsChips || '—'}</div>
    </div>
  `;

  // Summary bar (compact)
  const summaryBar = document.getElementById('task-summary-bar');
  summaryBar.innerHTML = `
    <span class="task-summary-item"><span class="num" style="color:var(--cyan)">${total}</span> total</span>
    <span class="task-summary-item"><span class="num" style="color:var(--green)">${doneCount}</span> done</span>
    <span class="task-summary-item"><span class="num" style="color:var(--yellow)">${inProgressCount}</span> active</span>
    <span class="task-summary-item"><span class="num" style="color:var(--red)">${blockedCount}</span> blocked</span>
    <span class="task-summary-item" style="margin-left:auto;">${pct}% complete</span>
    <div style="flex:1;max-width:200px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;align-self:center;">
      <div style="width:${pct}%;height:100%;background:var(--green);border-radius:2px;transition:width 0.3s;"></div>
    </div>
  `;

  // Render columns
  for (const [status, tasks] of Object.entries(cols)) {
    const container = document.getElementById('col-' + status);
    const countEl = document.getElementById('col-count-' + status);
    if (countEl) countEl.textContent = tasks.length;
    if (!container) continue;

    if (!tasks.length) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-dim);font-size:0.6rem;font-family:var(--font-mono);opacity:0.5;">Drop tasks here</div>`;
      continue;
    }

    container.innerHTML = tasks.map(t => {
      const ws = _workspaces.find(w => w.id === t.workspace_id);
      const wsName = ws?.name;
      const wsChip = wsName ? `<span class="task-link-chip" title="Workspace: ${escapeHtml(wsName)}">🗂 ${escapeHtml(wsName)}</span>` : '';

      // Project chip from workspace
      const projChip = ws?.projects?.length ? `<span class="task-meta-chip project" title="Projects">📁 ${escapeHtml(ws.projects.join(', '))}</span>` : '';

      // Date chip
      const dateLabel = formatTaskDate(t.date);
      const dateChip = `<span class="task-meta-chip date">📅 ${dateLabel}</span>`;

      const statusOrder = ['todo', 'in-progress', 'done', 'blocked'];
      const curIdx = statusOrder.indexOf(t.status);
      const prevStatus = curIdx > 0 ? statusOrder[curIdx - 1] : null;
      const nextStatus = curIdx < statusOrder.length - 1 ? statusOrder[curIdx + 1] : null;

      // Time tracking line
      const timeChips = _buildTaskTimeChips(t);

      // Copy link chip
      const copyChip = t.copied_from ? `<span class="task-meta-chip copy" title="Copied from another task">📋 copy</span>` : '';

      return `
        <div class="task-card" data-task-id="${t.id}" draggable="true" ondragstart="_taskDragStart(event,'${t.id}')" ondragend="_taskDragEnd(event)" ondragover="_taskDragOver(event)" ondragleave="_taskDragLeave(event)" ondrop="_taskDrop(event,'${t.id}')" onclick="openTaskModal('${t.id}')">
          <div class="task-card-actions">
            <button onclick="event.stopPropagation();deleteTask('${t.id}')" title="Delete">🗑</button>
          </div>
          <div class="task-card-title">${t.seq ? `<span style="color:var(--cyan);font-family:'Orbitron',sans-serif;font-size:0.45rem;margin-right:4px;">T-${t.seq}</span>` : ''}${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="task-card-desc">${escapeHtml(t.description)}</div>` : ''}
          <div class="task-meta-row">
            ${dateChip}${projChip}${copyChip}
          </div>
          ${timeChips ? `<div class="task-time-row">${timeChips}</div>` : ''}
          <div class="task-card-footer">
            <span class="task-priority ${t.priority}">${t.priority.toUpperCase()}</span>
            ${wsChip}
            <div class="task-move-btns">
              ${prevStatus ? `<button class="task-move-btn" onclick="event.stopPropagation();moveTask('${t.id}','${prevStatus}')" title="Move to ${prevStatus}">◂</button>` : ''}
              ${nextStatus ? `<button class="task-move-btn" onclick="event.stopPropagation();moveTask('${t.id}','${nextStatus}')" title="Move to ${nextStatus}">▸</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  }
}

async function moveTask(taskId, newStatus) {
  if (_isDayEnded()) return;
  try {
    const res = await fetch(`/api/tasks/${taskId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status: newStatus}) });
    if (!res.ok) { const err = await res.text(); console.error('moveTask failed:', res.status, err); return; }
    const t = _allTasks.find(t => t.id === taskId);
    if (t) t.status = newStatus;
    renderKanban();
    _applyDayLock();
  } catch(e) { console.error(e); }
}



// ─── Task within-column drag-and-drop reorder ───────────────────────────
let _taskDragId = null;

function _taskDragStart(e, taskId) {
  _taskDragId = taskId;
  e.dataTransfer.setData('text/plain', taskId);
  e.dataTransfer.effectAllowed = 'move';
  e.target.closest('.task-card').classList.add('dragging');
}

function _taskDragEnd(e) {
  _taskDragId = null;
  document.querySelectorAll('.task-card.dragging, .task-card.task-drag-over-top, .task-card.task-drag-over-bottom').forEach(el => {
    el.classList.remove('dragging', 'task-drag-over-top', 'task-drag-over-bottom');
  });
}

function _taskDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.target.closest('.task-card');
  if (!card || card.dataset.taskId === _taskDragId) return;
  // Clear previous indicators in this column
  card.closest('.kanban-cards')?.querySelectorAll('.task-drag-over-top, .task-drag-over-bottom').forEach(el => {
    el.classList.remove('task-drag-over-top', 'task-drag-over-bottom');
  });
  const rect = card.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  if (e.clientY < midY) {
    card.classList.add('task-drag-over-top');
  } else {
    card.classList.add('task-drag-over-bottom');
  }
}

function _taskDragLeave(e) {
  const card = e.target.closest('.task-card');
  if (card) card.classList.remove('task-drag-over-top', 'task-drag-over-bottom');
}

function _taskDrop(e, targetId) {
  e.preventDefault();
  e.stopPropagation();
  if (!_taskDragId || _taskDragId === targetId) return;

  const dragTask = _allTasks.find(t => t.id === _taskDragId);
  const targetTask = _allTasks.find(t => t.id === targetId);
  if (!dragTask || !targetTask) return;

  // If different status, change status first (cross-column)
  const sameStatus = dragTask.status === targetTask.status;

  // Determine insert position
  const card = e.target.closest('.task-card');
  const rect = card?.getBoundingClientRect();
  const insertAfter = rect ? (e.clientY >= rect.top + rect.height / 2) : true;

  // Reorder within _allTasks
  const fromIdx = _allTasks.indexOf(dragTask);
  _allTasks.splice(fromIdx, 1);
  if (!sameStatus) dragTask.status = targetTask.status;
  let toIdx = _allTasks.indexOf(targetTask);
  if (insertAfter) toIdx++;
  _allTasks.splice(toIdx, 0, dragTask);

  renderKanban();

  // Persist order + possible status change
  const order = _allTasks.map(t => t.id);
  fetch('/api/tasks/reorder', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ order, date: _taskDate })
  }).then(r => { if (!r.ok) console.error('Reorder failed:', r.status); })
    .catch(err => console.error('Failed to persist task order:', err));

  if (!sameStatus) {
    fetch(`/api/tasks/${dragTask.id}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ status: dragTask.status })
    }).then(r => { if (!r.ok) { console.error('Status update failed:', r.status); fetchTasks(); } })
      .catch(err => { console.error('Failed to update task status:', err); fetchTasks(); });
  }
}

async function dropTask(event, newStatus) {
  event.preventDefault();
  if (_isDayEnded()) return;
  const taskId = event.dataTransfer.getData('text/plain');
  if (taskId) await moveTask(taskId, newStatus);
}

let _taskModalCallback = null;

async function openTaskModal(editId) {
  if (_isDayEnded() && !_taskModalCallback) {
    alert('Day has been ended. Reopen it to make changes.');
    return;
  }
  _taskModalCallback = null;
  const modal = document.getElementById('task-modal');
  modal.style.display = 'flex';

  // Populate workspace dropdown
  const wsSel = document.getElementById('task-ws-input');
  wsSel.innerHTML = '<option value="">— None —</option>' + _workspaces.filter(ws => ws.status !== 'closed').map(ws =>
    `<option value="${ws.id}">${escapeHtml(ws.name)}</option>`
  ).join('');
  wsSel.disabled = false;

  let editTask = null;
  if (editId) {
    editTask = _allTasks.find(t => t.id === editId);
    if (!editTask) return;
    wsSel.value = editTask.workspace_id || '';
  }

  if (editTask) {
    document.getElementById('task-modal-title').textContent = editTask.seq ? `EDIT TASK T-${editTask.seq}` : 'EDIT TASK';
    document.getElementById('task-title-input').value = editTask.title;
    document.getElementById('task-desc-input').value = editTask.description || '';
    document.getElementById('task-priority-input').value = editTask.priority;
    document.getElementById('task-status-input').value = editTask.status;
    document.getElementById('task-edit-id').value = editTask.id;
    document.getElementById('task-copy-from').value = '';
    document.getElementById('task-copy-btn').style.display = '';
    _showTaskTimeInfo(editTask);
    _showCopiedInfo(editTask);
    _showMoveDayBtns(editTask);
    _showTaskDeps(editTask);
  } else {
    document.getElementById('task-modal-title').textContent = 'ADD TASK';
    document.getElementById('task-title-input').value = '';
    document.getElementById('task-desc-input').value = '';
    document.getElementById('task-priority-input').value = 'medium';
    document.getElementById('task-status-input').value = 'todo';
    document.getElementById('task-edit-id').value = '';
    document.getElementById('task-copy-from').value = '';
    document.getElementById('task-copy-btn').style.display = 'none';
    document.getElementById('task-move-prev-btn').style.display = 'none';
    document.getElementById('task-move-next-btn').style.display = 'none';
    document.getElementById('task-move-label').style.display = 'none';
    document.getElementById('task-time-info').style.display = 'none';
    document.getElementById('task-copied-info').style.display = 'none';
    document.getElementById('task-deps-section').style.display = 'none';
  }
  setTimeout(() => document.getElementById('task-title-input').focus(), 100);
}

// Open task modal from workspace detail — pre-sets workspace, locks it, refreshes ws on save
async function openWsTaskModal(editId) {
  const wsId = _currentWsId;
  if (!wsId) return;

  _taskModalCallback = async () => {
    // Refresh the workspace detail tasks in-place
    await _refreshWsTasks(wsId);
  };

  const modal = document.getElementById('task-modal');
  modal.style.display = 'flex';

  const wsSel = document.getElementById('task-ws-input');
    wsSel.innerHTML = _workspaces.filter(ws => ws.status !== 'closed' || ws.id === wsId).map(ws =>
    `<option value="${ws.id}">${escapeHtml(ws.name)}</option>`
  ).join('');
  wsSel.value = wsId;
  wsSel.disabled = editId ? false : true;

  let editTask = null;
  if (editId) {
    // Task might not be in _allTasks (different date), fetch it
    try {
      const res = await fetch(`/api/tasks?workspace_id=${wsId}&_=${Date.now()}`);
      const allWsTasks = (await res.json()).map(_normalizeTask);
      editTask = allWsTasks.find(t => t.id === editId);
    } catch(e) {}
  }

  if (editTask) {
    document.getElementById('task-modal-title').textContent = editTask.seq ? `EDIT TASK T-${editTask.seq}` : 'EDIT TASK';
    document.getElementById('task-title-input').value = editTask.title;
    document.getElementById('task-desc-input').value = editTask.description || '';
    document.getElementById('task-priority-input').value = editTask.priority;
    document.getElementById('task-status-input').value = editTask.status;
    document.getElementById('task-edit-id').value = editTask.id;
    document.getElementById('task-copy-from').value = '';
    document.getElementById('task-copy-btn').style.display = '';
    _showTaskTimeInfo(editTask);
    _showCopiedInfo(editTask);
    _showMoveDayBtns(editTask);
    _showTaskDeps(editTask);
  } else {
    document.getElementById('task-modal-title').textContent = 'ADD TASK';
    document.getElementById('task-title-input').value = '';
    document.getElementById('task-desc-input').value = '';
    document.getElementById('task-priority-input').value = 'medium';
    document.getElementById('task-status-input').value = 'todo';
    document.getElementById('task-edit-id').value = '';
    document.getElementById('task-copy-from').value = '';
    document.getElementById('task-copy-btn').style.display = 'none';
    document.getElementById('task-move-prev-btn').style.display = 'none';
    document.getElementById('task-move-next-btn').style.display = 'none';
    document.getElementById('task-move-label').style.display = 'none';
    document.getElementById('task-time-info').style.display = 'none';
    document.getElementById('task-copied-info').style.display = 'none';
    document.getElementById('task-deps-section').style.display = 'none';
  }
  setTimeout(() => document.getElementById('task-title-input').focus(), 100);
}

// Refresh just the workspace tasks sub-tab in-place
async function _refreshWsTasks(wsId) {
  const tasksContainer = document.getElementById('ws-detail-tasks');
  if (!tasksContainer) return;
  try {
    const res = await fetch(`/api/tasks?workspace_id=${wsId}&_=${Date.now()}`);
    const wsTasks = (await res.json()).map(_normalizeTask);
    const taskDates = [...new Set(wsTasks.map(t => t.date))].sort().reverse();
    const statusIcons = {'todo':'📋','in-progress':'⚡','done':'✅','blocked':'🚫'};
    const statusOrder = ['todo','in-progress','done','blocked'];

    // If graph mode is active, render graph instead
    if (_wsGraphMode) { loadWsGraph(wsId); return; }

    let html = `<div style="margin-bottom:12px;">
      <button class="task-day-btn add" onclick="openWsTaskModal()" style="font-size:0.6rem;padding:5px 14px;">+ ADD TASK</button>
      <button class="task-day-btn" id="ws-graph-toggle" onclick="toggleWsGraphMode()" style="font-size:0.6rem;padding:5px 14px;margin-left:6px;">📊 GRAPH</button>
    </div>`;

    if (!wsTasks.length) {
      html += `<div style="text-align:center;padding:30px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.7rem;">
        No tasks yet. Add one above.</div>`;
    } else {
      const todayStr = _localDateStr();
      for (const d of taskDates) {
        const dayLabel = d === todayStr ? `${d} · TODAY` : d;
        const dayTasks = wsTasks.filter(t => t.date === d);
        html += `<div style="font-family:'Orbitron',sans-serif;font-size:0.55rem;color:var(--cyan);margin:14px 0 8px;letter-spacing:1px;">${dayLabel} <span style="color:var(--text-dim);font-family:var(--font-mono);">(${dayTasks.length})</span></div>`;
        dayTasks.forEach(t => {
          const nextStatus = statusOrder[(statusOrder.indexOf(t.status) + 1) % statusOrder.length];
          html += `<div class="ws-task-mini" style="cursor:pointer;" onclick="openWsTaskModal('${t.id}')">
            <span class="task-priority ${t.priority}">${t.priority.toUpperCase()}</span>
            <span class="ws-task-mini-title">${t.seq ? `<span style="color:var(--cyan);font-family:'Orbitron',sans-serif;font-size:0.4rem;margin-right:4px;">T-${t.seq}</span>` : ''}${escapeHtml(t.title)}</span>
            <span class="ws-task-mini-status ${t.status}">${statusIcons[t.status]||''} ${t.status}</span>
            <select class="task-move-ws-select" onclick="event.stopPropagation()" onchange="event.stopPropagation();moveTaskToWorkspace('${t.id}',this.value,this)" title="Move to workspace">
              <option value="">🗂 Move…</option>
              ${_workspaces.filter(w => w.id !== wsId && w.status !== 'closed').map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')}
              <option value="__none__">— No Workspace —</option>
            </select>
            <button class="task-move-btn" onclick="event.stopPropagation();wsTaskQuickStatus('${t.id}','${nextStatus}')" title="Move to ${nextStatus}" style="margin-left:4px;font-size:0.55rem;">▸ ${nextStatus}</button>
          </div>`;
        });
      }
    }
    tasksContainer.innerHTML = html;
  } catch(e) {
    console.error('Failed to refresh ws tasks', e);
  }
}

async function wsTaskQuickStatus(taskId, newStatus) {
  try {
    await fetch(`/api/tasks/${taskId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status: newStatus}) });
    if (_currentWsId) await _refreshWsTasks(_currentWsId);
  } catch(e) { console.error(e); }
}

async function moveTaskToWorkspace(taskId, newWsId, selectEl) {
  if (!newWsId) return;
  const wsValue = newWsId === '__none__' ? null : newWsId;
  const targetName = newWsId === '__none__' ? 'No Workspace' : (_workspaces.find(w => w.id === newWsId)?.name || 'another workspace');
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({workspace_id: wsValue})
    });
    if (!res.ok) throw new Error('Failed');
    // Update local cache
    const t = _allTasks.find(x => x.id === taskId);
    if (t) t.workspace_id = wsValue;
    // Refresh workspace detail (task disappears from current ws)
    if (_currentWsId) await _refreshWsTasks(_currentWsId);
    // Also refresh kanban if visible
    if (currentMode === 'tasks') renderKanban();
  } catch(e) {
    console.error(e);
    if (selectEl) selectEl.value = '';
  }
}

function copyTask() {
  const editId = document.getElementById('task-edit-id').value;
  if (!editId) return;
  // Switch modal from edit → create-copy mode
  document.getElementById('task-modal-title').textContent = 'COPY TASK';
  document.getElementById('task-edit-id').value = '';
  document.getElementById('task-copy-from').value = editId;
  document.getElementById('task-copy-btn').style.display = 'none';
  document.getElementById('task-move-prev-btn').style.display = 'none';
  document.getElementById('task-move-next-btn').style.display = 'none';
  document.getElementById('task-move-label').style.display = 'none';
  document.getElementById('task-deps-section').style.display = 'none';
  document.getElementById('task-status-input').value = 'todo';
  document.getElementById('task-time-info').style.display = 'none';
  // Show link info
  const origTitle = document.getElementById('task-title-input').value;
  const info = document.getElementById('task-copied-info');
  info.innerHTML = `📋 Copying from: <strong>${escapeHtml(origTitle)}</strong>`;
  info.style.display = '';
  // Prefix title so user can edit
  document.getElementById('task-title-input').value = origTitle;
  document.getElementById('task-title-input').focus();
  document.getElementById('task-title-input').select();
}

// Move task date to previous or next open working day
let _adjacentDays = { prev: null, next: null };

async function _fetchAdjacentDays(dateStr) {
  try {
    const res = await fetch(`/api/tasks/adjacent-days?date=${dateStr}&_=${Date.now()}`);
    _adjacentDays = await res.json();
  } catch(e) { _adjacentDays = { prev: null, next: null }; }
}

function _showMoveDayBtns(task) {
  const prevBtn = document.getElementById('task-move-prev-btn');
  const nextBtn = document.getElementById('task-move-next-btn');
  const label = document.getElementById('task-move-label');
  if (!task || !task.date) {
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
    label.style.display = 'none';
    return;
  }
  _fetchAdjacentDays(task.date).then(() => {
    const showAny = _adjacentDays.prev || _adjacentDays.next;
    prevBtn.style.display = _adjacentDays.prev ? '' : 'none';
    nextBtn.style.display = _adjacentDays.next ? '' : 'none';
    label.style.display = showAny ? '' : 'none';
    if (_adjacentDays.prev) prevBtn.title = `Move to ${_adjacentDays.prev}`;
    if (_adjacentDays.next) nextBtn.title = `Move to ${_adjacentDays.next}`;
  });
}

async function moveTaskDay(direction) {
  const editId = document.getElementById('task-edit-id').value;
  if (!editId) return;
  const targetDate = direction === 'prev' ? _adjacentDays.prev : _adjacentDays.next;
  if (!targetDate) return;
  try {
    const res = await fetch(`/api/tasks/${editId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: targetDate })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || `Move failed (${res.status})`);
      return;
    }
    const cb = _taskModalCallback;
    closeTaskModal();
    if (cb) await cb();
    else await fetchTasks();
  } catch(e) { alert('Failed: ' + e.message); }
}

// ── Task Dependencies (modal) ──────────────────────────────────
let _depAvailable = [];  // available tasks for autocomplete

async function _showTaskDeps(task) {
  const section = document.getElementById('task-deps-section');
  const list = document.getElementById('task-deps-list');
  const input = document.getElementById('task-dep-input');
  if (!task || !task.id) { section.style.display = 'none'; return; }
  const wsId = task.workspace_id;
  if (!wsId) { section.style.display = 'none'; return; }
  section.style.display = '';
  const deps = task.depends_on || [];
  let wsTasks = [];
  try {
    const res = await fetch(`/api/tasks?workspace_id=${wsId}&_=${Date.now()}`);
    wsTasks = (await res.json()).map(_normalizeTask);
  } catch(e) {}
  // Render pills
  list.innerHTML = deps.length === 0
    ? '<span style="font-size:0.45rem;color:var(--text-dim);">none</span>'
    : deps.map(depId => {
        const dt = wsTasks.find(t => t.id === depId) || _allTasks.find(t => t.id === depId);
        const seqTag = dt && dt.seq ? `T-${dt.seq} ` : '';
        const label = dt ? seqTag + escapeHtml(dt.title) : depId;
        return `<span class="task-dep-chip">${label}<span class="dep-remove" onclick="removeTaskDep('${task.id}','${depId}')">&times;</span></span>`;
      }).join('');
  // Store available for autocomplete
  _depAvailable = wsTasks.filter(t => t.id !== task.id && !deps.includes(t.id));
  input.value = '';
  _hideDepDropdown();
}

function _filterDepDropdown() {
  const input = document.getElementById('task-dep-input');
  const dd = document.getElementById('task-dep-dropdown');
  const q = (input.value || '').toLowerCase();
  const matches = _depAvailable.filter(t => t.title.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length || !q) { dd.style.display = 'none'; return; }
  dd.innerHTML = matches.map(t =>
    `<div class="dep-option" data-id="${t.id}" onmousedown="_selectDep('${t.id}')">${t.seq ? `<span style="color:var(--cyan);margin-right:4px;">T-${t.seq}</span>` : ''}${escapeHtml(t.title)}</div>`
  ).join('');
  dd.style.display = 'block';
}

function _hideDepDropdown() {
  const dd = document.getElementById('task-dep-dropdown');
  if (dd) dd.style.display = 'none';
}

async function _selectDep(depId) {
  const taskId = document.getElementById('task-edit-id').value;
  if (!taskId || !depId) return;
  _hideDepDropdown();
  try {
    const taskTitle = document.getElementById('task-title-input')?.value?.trim() || taskId;
    const depTask = _depAvailable.find(t => t.id === depId) || _allTasks.find(t => t.id === depId);
    const depTitle = depTask?.title || depId;
    const res = await fetch(`/api/tasks/${taskId}/deps`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ depends_on: depId })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg = e.error || `Request failed (${res.status})`;
      alert(`Could not add dependency.\n\nTask: ${taskTitle}\nDepends on: ${depTitle}\nReason: ${msg}`);
      return;
    }
    const updated = _normalizeTask(await res.json());
    _showTaskDeps(updated);
  } catch(e) { alert('Could not add dependency.\n\nReason: ' + e.message); }
}

async function removeTaskDep(taskId, depId) {
  try {
    const depTask = _allTasks.find(t => t.id === depId);
    const depTitle = depTask?.title || depId;
    const res = await fetch(`/api/tasks/${taskId}/deps/${depId}`, { method: 'DELETE' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg = e.error || `Request failed (${res.status})`;
      alert(`Could not remove dependency.\n\nDepends on: ${depTitle}\nReason: ${msg}`);
      return;
    }
    const updated = _normalizeTask(await res.json());
    _showTaskDeps(updated);
  } catch(e) { alert('Could not remove dependency.\n\nReason: ' + e.message); }
}

// Wire up autocomplete events after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('task-dep-input');
  if (input) {
    input.addEventListener('input', _filterDepDropdown);
    input.addEventListener('focus', _filterDepDropdown);
    input.addEventListener('blur', () => setTimeout(_hideDepDropdown, 150));
  }
});

// ── Dependency Graph (toggle inside workspace tasks view) ──────
let _wsGraphMode = false;

function toggleWsGraphMode() {
  _wsGraphMode = !_wsGraphMode;
  const btn = document.getElementById('ws-graph-toggle');
  if (btn) {
    btn.textContent = _wsGraphMode ? '☰ LIST' : '📊 GRAPH';
    btn.title = _wsGraphMode ? 'Switch to list view' : 'Switch to graph view';
  }
  if (_wsGraphMode && _currentWsId) {
    loadWsGraph(_currentWsId);
  } else if (_currentWsId) {
    _refreshWsTasks(_currentWsId);
  }
}

async function loadWsGraph(wsId) {
  const container = document.getElementById('ws-detail-tasks');
  if (!container) return;
  try {
    const res = await fetch(`/api/tasks/graph?workspace_id=${wsId}&_=${Date.now()}`);
    const data = await res.json();
    const { nodes, edges } = data;
    if (!nodes.length) {
      container.innerHTML = `<div style="margin-bottom:12px;">
        <button class="task-day-btn add" onclick="openWsTaskModal()" style="font-size:0.6rem;padding:5px 14px;">+ ADD TASK</button>
        <button class="task-day-btn" id="ws-graph-toggle" onclick="toggleWsGraphMode()" style="font-size:0.6rem;padding:5px 14px;margin-left:6px;">☰ LIST</button>
      </div>
      <div class="dep-graph-empty">No tasks in this workspace.</div>`;
      return;
    }
    container.innerHTML = `<div style="margin-bottom:12px;">
      <button class="task-day-btn add" onclick="openWsTaskModal()" style="font-size:0.6rem;padding:5px 14px;">+ ADD TASK</button>
      <button class="task-day-btn" id="ws-graph-toggle" onclick="toggleWsGraphMode()" style="font-size:0.6rem;padding:5px 14px;margin-left:6px;">☰ LIST</button>
    </div>
    <div class="dep-graph-container" id="dep-graph-box">
      <svg id="dep-graph-svg"></svg>
      <div class="dep-graph-tooltip" id="dep-graph-tooltip"></div>
    </div>`;
    _renderDepGraph(nodes, edges);
  } catch(e) {
    console.error('Graph load failed', e);
    container.innerHTML = '<div class="dep-graph-empty">Failed to load graph.</div>';
  }
}

function _renderDepGraph(nodes, edges) {
  const svg = document.getElementById('dep-graph-svg');
  const tooltip = document.getElementById('dep-graph-tooltip');
  const box = document.getElementById('dep-graph-box');
  if (!svg || !nodes.length) return;

  const priorityColors = {
    critical: '#ff4444', high: '#ff6b6b', medium: '#ffaa00', low: '#4dabf7'
  };
  const statusColors = {
    'todo': '#888', 'in-progress': '#00f0ff', 'done': '#44ff88', 'blocked': '#ff4444'
  };

  // Topological layering
  const idMap = {};
  nodes.forEach(n => { idMap[n.id] = n; });
  const layers = [];
  const assigned = new Set();
  let remaining = [...nodes];
  for (let safety = 0; safety < 50 && remaining.length; safety++) {
    const layer = remaining.filter(n => {
      const deps = (n.depends_on || []).filter(d => idMap[d] && !assigned.has(d));
      return deps.length === 0;
    });
    if (!layer.length) { layers.push(remaining); break; }
    layers.push(layer);
    layer.forEach(n => assigned.add(n.id));
    remaining = remaining.filter(n => !assigned.has(n.id));
  }

  // Layout
  const nodeW = 180, nodeH = 52, padX = 60, padY = 50, topPad = 30;
  const maxCols = Math.max(...layers.map(l => l.length));
  const svgW = Math.max(maxCols * (nodeW + padX) + padX, 600);
  const svgH = layers.length * (nodeH + padY) + topPad + padY;
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.style.height = svgH + 'px';

  const pos = {};
  layers.forEach((layer, li) => {
    const totalW = layer.length * nodeW + (layer.length - 1) * padX;
    const startX = (svgW - totalW) / 2;
    layer.forEach((n, ni) => {
      pos[n.id] = {
        x: startX + ni * (nodeW + padX),
        y: topPad + li * (nodeH + padY),
      };
    });
  });

  // Build SVG
  let svgContent = '<defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#00f0ff" opacity="0.5"/></marker></defs>';

  // Edges (from = task, to = dependency it depends on — arrow points to dependency)
  edges.forEach(e => {
    const from = pos[e.from], to = pos[e.to];
    if (!from || !to) return;
    const x1 = from.x + nodeW / 2, y1 = from.y;
    const x2 = to.x + nodeW / 2, y2 = to.y + nodeH;
    svgContent += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#00f0ff" stroke-opacity="0.3" stroke-width="1.5" marker-end="url(#arrowhead)"/>`;
  });

  // Nodes
  nodes.forEach(n => {
    const p = pos[n.id];
    if (!p) return;
    const fill = priorityColors[n.priority] || '#ffaa00';
    const statusClr = statusColors[n.status] || '#888';
    const titleTrunc = n.title.length > 22 ? n.title.slice(0, 20) + '…' : n.title;
    const statusIcon = {'todo':'📋','in-progress':'⚡','done':'✅','blocked':'🚫'}[n.status] || '';

    svgContent += `
      <g class="dep-node" data-id="${n.id}" style="cursor:pointer;"
         onclick="openWsTaskModal('${n.id}')"
         onmouseenter="_showGraphTooltip(event,'${n.id}')"
         onmousemove="_moveGraphTooltip(event)"
         onmouseleave="_hideGraphTooltip()">
        <rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="8"
              fill="rgba(20,20,30,0.9)" stroke="${fill}" stroke-width="1.5"/>
        <rect x="${p.x}" y="${p.y}" width="4" height="${nodeH}" rx="2" fill="${fill}"/>
        <text x="${p.x + 14}" y="${p.y + 20}" fill="#eee" font-family="'JetBrains Mono',monospace" font-size="11">${escapeHtml(titleTrunc)}</text>
        <text x="${p.x + 14}" y="${p.y + 38}" fill="${statusClr}" font-family="'JetBrains Mono',monospace" font-size="9">${statusIcon} ${n.status}  ·  ${n.priority}</text>
        <circle cx="${p.x + nodeW - 14}" cy="${p.y + nodeH / 2}" r="5" fill="${statusClr}" opacity="0.6"/>
      </g>`;
  });

  svg.innerHTML = svgContent;
  // Store nodes for tooltip
  svg._graphNodes = {};
  nodes.forEach(n => { svg._graphNodes[n.id] = n; });
}

function _showGraphTooltip(evt, nodeId) {
  const svg = document.getElementById('dep-graph-svg');
  const tt = document.getElementById('dep-graph-tooltip');
  const n = svg._graphNodes && svg._graphNodes[nodeId];
  if (!n || !tt) return;
  const desc = (n.description || '').slice(0, 150) + ((n.description || '').length > 150 ? '…' : '');
  const created = n.created_at ? new Date(n.created_at).toLocaleDateString() : '—';
  tt.innerHTML = `
    <div class="tt-title">${escapeHtml(n.title)}</div>
    <div class="tt-meta">Status: ${n.status} · Priority: ${n.priority}</div>
    <div class="tt-meta">Date: ${n.date || '—'} · Created: ${created}</div>
    ${desc ? `<div class="tt-desc">${escapeHtml(desc)}</div>` : ''}
    <div style="margin-top:6px;font-size:0.45rem;color:var(--cyan);opacity:0.7;">Click to edit</div>`;
  tt.style.display = 'block';
  _moveGraphTooltip(evt);
}

function _moveGraphTooltip(evt) {
  const tt = document.getElementById('dep-graph-tooltip');
  const box = document.getElementById('dep-graph-box');
  if (!tt || !box) return;
  const rect = box.getBoundingClientRect();
  let x = evt.clientX - rect.left + 16;
  let y = evt.clientY - rect.top + 10;
  if (x + 290 > rect.width) x = evt.clientX - rect.left - 290;
  if (y + 120 > rect.height) y = evt.clientY - rect.top - 120;
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
}

function _hideGraphTooltip() {
  const tt = document.getElementById('dep-graph-tooltip');
  if (tt) tt.style.display = 'none';
}

function _showCopiedInfo(t) {
  const el = document.getElementById('task-copied-info');
  if (!t.copied_from) { el.style.display = 'none'; return; }
  // Try to find the original task title
  const allTasks = _allTasks || [];
  const orig = allTasks.find(o => o.id === t.copied_from);
  const origLabel = orig ? escapeHtml(orig.title) : `#${t.copied_from}`;
  el.innerHTML = `📋 Copied from: <strong>${origLabel}</strong>`;
  el.style.display = '';
}

function closeTaskModal() {
  document.getElementById('task-modal').style.display = 'none';
  document.getElementById('task-ws-input').disabled = false;
  document.getElementById('task-modal-inner').classList.remove('expanded');
  document.getElementById('task-expand-btn').textContent = '⛶';
  _taskModalCallback = null;
}

function toggleTaskModalExpand() {
  const modal = document.getElementById('task-modal-inner');
  const btn = document.getElementById('task-expand-btn');
  modal.classList.toggle('expanded');
  btn.textContent = modal.classList.contains('expanded') ? '⛶̄' : '⛶';
}

async function saveTask() {
  const title = document.getElementById('task-title-input').value.trim();
  if (!title) return;
  const editId = document.getElementById('task-edit-id').value;
  const copyFrom = document.getElementById('task-copy-from').value;
  // Ensure ended days are loaded
  if (!_endedDays._loaded) { await _fetchEndedDays(); _endedDays._loaded = true; }
  // Use next available (non-ended) day when creating from workspace context
  const isWsContext = !!_taskModalCallback;
  let taskDate = (!editId && isWsContext) ? _localDateStr() : _taskDate;
  if (!editId) {
    let d = new Date(taskDate + 'T00:00:00');
    for (let i = 0; i < 60; i++) {
      const ds = _localDateStr(d);
      if (!_endedDays.has(ds)) { taskDate = ds; break; }
      d.setDate(d.getDate() + 1);
    }
  }
  const payload = {
    title,
    description: document.getElementById('task-desc-input').value.trim(),
    priority: document.getElementById('task-priority-input').value,
    status: document.getElementById('task-status-input').value,
    workspace_id: document.getElementById('task-ws-input').value || null,
    date: taskDate,
  };
  if (copyFrom) payload.copied_from = copyFrom;
  try {
    let res;
    if (editId) {
      res = await fetch(`/api/tasks/${editId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    } else {
      res = await fetch('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || `Save failed (${res.status})`);
      return;
    }
    const cb = _taskModalCallback;
    closeTaskModal();
    if (cb) await cb();
    else await fetchTasks();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;
  try {
    await fetch(`/api/tasks/${taskId}`, { method:'DELETE' });
    await fetchTasks();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function endDay() {
  try {
    const res = await fetch('/api/tasks/end-day', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({date: _taskDate}) });
    const data = await res.json();
    _endedDays.add(_taskDate);
    _taskDate = data.to || _localDateStr();
    await _fetchEndedDays();
    await fetchTasks();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function reopenDay() {
  if (!confirm(`Reopen ${formatTaskDate(_taskDate)}? You'll be able to add and move tasks again.`)) return;
  try {
    await fetch('/api/tasks/unend-day', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({date: _taskDate}) });
    _endedDays.delete(_taskDate);
    await fetchTasks();
  } catch(e) { alert('Failed: ' + e.message); }
}

// ── Preferences ──────────────────────────────────────────────────────

async function loadPreferences() {
  try {
    const res = await fetch('/api/preferences?_=' + Date.now());
    _prefs = await res.json();
  } catch(e) { console.error('Failed to load preferences', e); }
}

async function _loadClientServerConfig() {
  if (!window.savantClient || !window.savantClient.getServerConfig) return null;
  try {
    return await window.savantClient.getServerConfig();
  } catch (e) {
    return null;
  }
}

function _renderQueueRows(items) {
  const list = document.getElementById('pref-queue-list');
  if (!list) return;
  if (!Array.isArray(items) || items.length === 0) {
    list.innerHTML = '<div style="padding:6px;">No queued mutations</div>';
    return;
  }
  list.innerHTML = items.slice(0, 40).map(it => `
    <div style="display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(255,255,255,0.04);padding:5px 2px;">
      <span style="color:${it.status === 'failed' ? 'var(--red)' : 'var(--text-dim)'};min-width:56px;">${escapeHtml((it.status || '').toUpperCase())}</span>
      <span style="color:var(--cyan);min-width:44px;">${escapeHtml(it.method || '')}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(it.endpoint || '')}">${escapeHtml(it.endpoint || '')}</span>
      ${it.status === 'failed' ? `<button class="ctx-btn-sm" style="font-size:0.45rem;padding:1px 6px;" onclick="retryClientQueueItem(${Number(it.id || 0)})">Retry</button>` : ''}
    </div>
  `).join('');
}

async function refreshClientQueueInspector() {
  const statsEl = document.getElementById('pref-queue-stats');
  const statusEl = document.getElementById('pref-server-status');
  if (!statsEl || !statusEl) return;
  if (!window.savantClient) {
    statusEl.textContent = 'Status: unavailable (web mode)';
    statsEl.textContent = 'Queue: unavailable';
    return;
  }
  try {
    const [cfg, stats, items] = await Promise.all([
      window.savantClient.getServerConfig(),
      window.savantClient.getQueueStats(),
      window.savantClient.listQueue(100),
    ]);
    statusEl.textContent = `Status: ${cfg.online ? 'online' : 'offline'} · ${cfg.serverUrl || 'not configured'}`;
    statsEl.textContent = `Queue: ${stats.queued || 0} pending, ${stats.failed || 0} failed`;
    _renderQueueRows(items || []);
  } catch (e) {
    statusEl.textContent = `Status: error (${e.message})`;
  }
}

async function retryClientQueueItem(id) {
  if (!window.savantClient || !id) return;
  try {
    await window.savantClient.retryQueueItem(id);
    showToast('info', `Queued item ${id} marked for retry`);
    await refreshClientQueueInspector();
  } catch (e) {
    showToast('error', `Retry failed: ${e.message}`);
  }
}

async function flushClientQueueNow() {
  if (!window.savantClient) return;
  try {
    await window.savantClient.flushQueueNow();
    showToast('info', 'Queue sync triggered');
    await refreshClientQueueInspector();
  } catch (e) {
    showToast('error', `Sync failed: ${e.message}`);
  }
}

function _applyProviderVisibility() {
  const ep = _prefs.enabled_providers || ['hermes','copilot','claude','codex','gemini'];
  ['hermes','copilot','claude','codex','gemini'].forEach(p => {
    const btn = document.getElementById('prov-' + p);
    if (btn) btn.style.display = ep.includes(p) ? '' : 'none';
  });
  // If current provider is disabled, switch to first enabled
  if (!ep.includes(currentMode) && currentTab === 'sessions') {
    switchProvider(ep[0] || 'copilot');
  }
}

function _applyTheme(theme) {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add('theme-' + (theme || 'dark'));
}

let _pendingTheme = 'dark';
function selectTheme(t) {
  _pendingTheme = t;
  document.querySelectorAll('#pref-theme .theme-toggle-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.theme === t);
  });
}

async function openPreferences() {
  await loadPreferences();
  const clientCfg = await _loadClientServerConfig();
  if (clientCfg) {
    const srv = document.getElementById('pref-server-url');
    if (srv) srv.value = clientCfg.serverUrl || '';
  }
  document.getElementById('pref-name').value = _prefs.name || '';
  const ww = _prefs.work_week || [1,2,3,4,5];
  document.querySelectorAll('.pref-day-cb').forEach(cb => {
    cb.checked = ww.includes(parseInt(cb.value));
  });
  const ep = _prefs.enabled_providers || ['hermes','copilot','claude','codex','gemini'];
  document.querySelectorAll('.pref-provider-cb').forEach(cb => {
    cb.checked = ep.includes(cb.value);
  });
  _pendingTheme = _prefs.theme || 'dark';
  selectTheme(_pendingTheme);
  // Terminal prefs
  const tp = _prefs.terminal || {};
  document.getElementById('pref-ext-terminal').value = tp.externalTerminal || 'auto';
  document.getElementById('pref-shell').value = tp.shell || 'auto';
  document.getElementById('pref-term-fontsize').value = tp.fontSize || 13;
  document.getElementById('pref-term-scrollback').value = tp.scrollback || 5000;
  document.getElementById('pref-custom-cmd').value = tp.customCommand || '';
  document.getElementById('pref-custom-cmd-row').style.display = (tp.externalTerminal === 'custom') ? 'block' : 'none';
  document.getElementById('prefs-modal').style.display = 'flex';
  await refreshClientQueueInspector();
}

function closePreferences() {
  document.getElementById('prefs-modal').style.display = 'none';
}

if (window.savantClient && window.savantClient.onSyncStatus) {
  window.savantClient.onSyncStatus(() => {
    const modal = document.getElementById('prefs-modal');
    if (modal && modal.style.display === 'flex') {
      refreshClientQueueInspector();
    }
  });
}

// ── All MRs & Jira Modal ────────────────────────────────────────
let _mrsFilter = 'open';  // 'open' or 'closed'
let _allTrackerTab = 'mrs'; // 'mrs' or 'jira'

function openAllTrackersModal() {
  openAllMrsModal();
}

function switchAllTrackerTab(tab) {
  _allTrackerTab = tab;
  document.getElementById('all-tracker-tab-mrs').classList.toggle('active', tab === 'mrs');
  document.getElementById('all-tracker-tab-jira').classList.toggle('active', tab === 'jira');
  document.getElementById('all-mrs-tab').style.display = tab === 'mrs' ? 'flex' : 'none';
  document.getElementById('all-jira-tab').style.display = tab === 'jira' ? 'flex' : 'none';
  if (tab === 'jira') loadAllJiraTickets();
}

function toggleMrsFilter() {
  const cb = document.getElementById('mrs-filter-toggle');
  const knob = document.getElementById('mrs-switch-knob');
  const label = document.getElementById('mrs-switch-label');
  if (cb.checked) {
    _mrsFilter = 'closed';
    knob.style.transform = 'translateX(18px)';
    label.textContent = 'CLOSED';
    label.style.color = 'var(--text-dim)';
  } else {
    _mrsFilter = 'open';
    knob.style.transform = 'translateX(0)';
    label.textContent = 'OPEN';
    label.style.color = 'var(--text-dim)';
  }
  if (_allTrackerTab === 'mrs') openAllMrsModal();
  else loadAllJiraTickets();
}

async function openAllMrsModal() {
  const modal = document.getElementById('all-mrs-modal');
  const body = document.getElementById('all-mrs-body');
  modal.style.display = 'flex';
  body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-dim);font-size:0.6rem;">Loading merge requests…</div>';
  try {
    const res = await fetch(`/api/all-mrs?filter=${_mrsFilter}&_=${Date.now()}`);
    const mrs = await res.json();
    if (!mrs.length) {
      const label = _mrsFilter === 'open' ? 'open' : 'closed';
      body.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-dim);font-size:0.7rem;">No ${label} merge requests found</div>`;
      return;
    }
    // Group by project
    const groups = {};
    for (const mr of mrs) {
      const proj = mr.project || 'Other';
      if (!groups[proj]) groups[proj] = [];
      groups[proj].push(mr);
    }
    const sortedProjects = Object.keys(groups).sort((a, b) => a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b));
    const sc = {draft:'#ffc700',open:'#00a6ff',review:'#a855f7',reviewing:'#a855f7',approved:'#22c55e',testing:'#ff8c00','on-hold':'#ef4444',merged:'#00ff88',closed:'#6b7280'};
    const provIcons = {copilot:'⟐',claude:'🎭',codex:'🧠',gemini:'♊',hermes:'🪶'};
    let html = `<div style="font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border);">${mrs.length} merge request${mrs.length!==1?'s':''} across ${sortedProjects.length} project${sortedProjects.length!==1?'s':''}</div>`;
    let grpIdx = 0;
    for (const proj of sortedProjects) {
      const projMrs = groups[proj];
      const gid = `mrs-grp-${grpIdx++}`;
      html += `<div style="margin-bottom:16px;">`;
      // Project header (collapsible)
      html += `<div onclick="const b=document.getElementById('${gid}');const a=this.querySelector('.mrs-arrow');if(b.style.display==='none'){b.style.display='block';a.textContent='▾'}else{b.style.display='none';a.textContent='▸'}" style="cursor:pointer;font-family:'Orbitron',sans-serif;font-size:0.45rem;letter-spacing:2px;color:var(--magenta);margin-bottom:8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border);padding-bottom:4px;user-select:none;">
        <span class="mrs-arrow" style="font-size:0.6rem;width:10px;">▾</span>
        <span style="font-size:0.7rem;">📦</span> ${escapeHtml(proj)} <span style="color:var(--text-dim);font-size:0.4rem;">(${projMrs.length})</span>
      </div>`;
      // MR list
      html += `<div id="${gid}" style="display:block;">`;
      for (const mr of projMrs) {
        const color = sc[mr.status] || '#00a6ff';
        const iid = mr.url.match(/merge_requests\/(\d+)/)?.[1] || mr.url.match(/pull\/(\d+)/)?.[1] || '';
        const mrLabel = iid ? `!${iid}` : mr.url.split('/').pop();
        // Sessions as compact CSV
        const sessionChips = mr.sessions.map(s => {
          const icon = provIcons[s.provider] || '⟐';
          const name = s.summary ? s.summary.substring(0,25) : s.id.substring(0,8);
          const roleLetter = s.role === 'author' ? 'A' : 'R';
          const roleColor = s.role === 'author' ? 'var(--cyan)' : 'var(--yellow)';
          return `<span onclick="event.stopPropagation();closeAllMrsModal();navigateToSessionDirect('${s.id}','${s.provider}')" style="cursor:pointer;font-size:0.42rem;padding:1px 6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:3px;color:var(--text-dim);display:inline-flex;align-items:center;gap:3px;transition:border-color 0.15s;white-space:nowrap;" onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="this.style.borderColor='var(--border)'">${icon} ${escapeHtml(name)} <span style="color:${roleColor};font-weight:700;font-size:0.38rem;">${roleLetter}</span></span>`;
        }).join('');
        html += `<div style="padding:8px 12px;border-left:3px solid ${color};margin-bottom:6px;background:rgba(255,255,255,0.015);border-radius:0 4px 4px 0;">`;
        // Row 1: status dot + MR link + title + status badge + jira
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:${mr.sessions.length ? '5' : '0'}px;">`;
        html += `<a href="${escapeHtml(mr.url)}" target="_blank" style="color:var(--cyan);font-size:0.6rem;font-family:var(--font-mono);text-decoration:none;font-weight:600;flex-shrink:0;" title="${escapeHtml(mr.url)}">${escapeHtml(mrLabel)}</a>`;
        if (mr.title) html += `<span style="font-size:0.5rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(mr.title)}</span>`;
        else html += `<span style="flex:1;"></span>`;
        html += `<span style="font-size:0.4rem;text-transform:uppercase;letter-spacing:1px;color:${color};font-weight:700;flex-shrink:0;">${mr.status}</span>`;
        if (mr.jira) html += `<span style="font-size:0.42rem;color:var(--yellow);font-family:var(--font-mono);flex-shrink:0;">${escapeHtml(mr.jira)}</span>`;
        if (mr.author) html += `<span style="font-size:0.42rem;color:var(--text-dim);flex-shrink:0;">👤 ${escapeHtml(mr.author)}</span>`;
        html += `</div>`;
        // Row 2: session chips
        if (mr.sessions.length) {
          html += `<div style="display:flex;flex-wrap:wrap;gap:3px;">${sessionChips}</div>`;
        }
        html += `</div>`;
      }
      html += '</div></div>';
    }
    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<div style="color:var(--red);font-size:0.6rem;padding:20px;">Failed to load: ${e.message}</div>`;
  }
}
function closeAllMrsModal() {
  document.getElementById('all-mrs-modal').style.display = 'none';
}

async function loadAllJiraTickets() {
  const body = document.getElementById('all-jira-body');
  body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-dim);font-size:0.6rem;">Loading Jira tickets…</div>';

  const assignee = (document.getElementById('all-jira-filter-assignee')?.value || '').trim();
  const status = document.getElementById('all-jira-filter-status')?.value || '';

  try {
    let url = `/api/all-jira-tickets?filter=${_mrsFilter}&_=${Date.now()}`;
    if (assignee) url += `&assignee=${encodeURIComponent(assignee)}`;
    if (status) url += `&status=${encodeURIComponent(status)}`;

    const res = await fetch(url);
    const tickets = await res.json();

    if (!tickets.length) {
      const label = status || (_mrsFilter === 'open' ? 'open' : 'done');
      body.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-dim);font-size:0.7rem;">No ${label} Jira tickets found</div>`;
      return;
    }

    const sc = {'todo':'#ffc700','in-progress':'#00a6ff','in-review':'#a855f7','done':'#00ff88','blocked':'#ef4444'};
    const sl = {'todo':'Todo','in-progress':'In Progress','in-review':'In Review','done':'Done','blocked':'Blocked'};
    const prioIcons = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
    const provIcons = {copilot:'⟐',claude:'🎭',codex:'🧠',gemini:'♊',hermes:'🪶'};

    let html = `<div style="font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border);">${tickets.length} ticket${tickets.length!==1?'s':''}</div>`;

    for (const t of tickets) {
      const color = sc[t.status] || '#888';
      const statusLabel = sl[t.status] || t.status || 'N/A';
      const pIcon = prioIcons[t.priority] || '';
      const url = t.url || `https://icapitalnetwork.atlassian.net/browse/${t.ticket_key}`;

      html += `<div style="padding:8px 12px;border-left:3px solid ${color};margin-bottom:6px;background:rgba(255,255,255,0.015);border-radius:0 4px 4px 0;">`;
      // Row 1: key + title + status + priority + assignee
      html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:${(t.sessions||[]).length ? '5' : '0'}px;">`;
      html += `<a href="${escapeHtml(url)}" target="_blank" style="color:var(--cyan);font-size:0.6rem;font-family:var(--font-mono);text-decoration:none;font-weight:600;flex-shrink:0;">${escapeHtml(t.ticket_key || 'N/A')}</a>`;
      if (t.title) html += `<span style="font-size:0.5rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(t.title)}</span>`;
      else html += `<span style="flex:1;"></span>`;
      html += `<span style="font-size:0.4rem;text-transform:uppercase;letter-spacing:1px;color:${color};font-weight:700;flex-shrink:0;">${statusLabel}</span>`;
      if (pIcon) html += `<span style="font-size:0.5rem;flex-shrink:0;" title="Priority: ${t.priority}">${pIcon}</span>`;
      if (t.assignee) html += `<span style="font-size:0.42rem;color:var(--text-dim);flex-shrink:0;">👤 ${escapeHtml(t.assignee)}</span>`;
      html += `</div>`;
      // Row 2: session chips
      if ((t.sessions||[]).length) {
        const sessionChips = t.sessions.map(s => {
          const icon = provIcons[s.provider] || '⟐';
          const name = s.summary ? s.summary.substring(0,25) : s.id.substring(0,8);
          const roleLetter = s.role === 'assignee' ? 'A' : s.role === 'reviewer' ? 'R' : 'W';
          const roleColor = s.role === 'assignee' ? 'var(--cyan)' : s.role === 'reviewer' ? 'var(--yellow)' : 'var(--text-dim)';
          return `<span onclick="event.stopPropagation();closeAllMrsModal();navigateToSessionDirect('${s.id}','${s.provider}')" style="cursor:pointer;font-size:0.42rem;padding:1px 6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:3px;color:var(--text-dim);display:inline-flex;align-items:center;gap:3px;transition:border-color 0.15s;white-space:nowrap;" onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="this.style.borderColor='var(--border)'">${icon} ${escapeHtml(name)} <span style="color:${roleColor};font-weight:700;font-size:0.38rem;">${roleLetter}</span></span>`;
        }).join('');
        html += `<div style="display:flex;flex-wrap:wrap;gap:3px;">${sessionChips}</div>`;
      }
      html += `</div>`;
    }
    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<div style="color:var(--red);font-size:0.6rem;padding:20px;">Failed to load: ${e.message}</div>`;
  }
}

async function savePreferences() {
  const serverUrl = (document.getElementById('pref-server-url')?.value || '').trim();
  if (window.savantClient && serverUrl) {
    try {
      await window.savantClient.setServerUrl(serverUrl);
    } catch (e) {
      alert('Invalid or unreachable server URL: ' + e.message);
      return;
    }
  }

  const name = document.getElementById('pref-name').value.trim();
  const work_week = [];
  document.querySelectorAll('.pref-day-cb:checked').forEach(cb => {
    work_week.push(parseInt(cb.value));
  });
  if (!work_week.length) { alert('Select at least one work day'); return; }
  const enabled_providers = [];
  document.querySelectorAll('.pref-provider-cb:checked').forEach(cb => {
    enabled_providers.push(cb.value);
  });
  if (!enabled_providers.length) { alert('At least one session provider must be enabled'); return; }
  const theme = _pendingTheme || 'dark';
  const terminal = {
    externalTerminal: document.getElementById('pref-ext-terminal').value,
    shell: document.getElementById('pref-shell').value,
    fontSize: parseInt(document.getElementById('pref-term-fontsize').value) || 13,
    scrollback: parseInt(document.getElementById('pref-term-scrollback').value) || 5000,
    customCommand: document.getElementById('pref-custom-cmd').value.trim(),
  };

  // Detect newly enabled providers (compare with previous prefs)
  const prevEnabled = (_prefs && _prefs.enabled_providers) || [];
  const newlyEnabled = enabled_providers.filter(p => !prevEnabled.includes(p));

  try {
    const res = await fetch('/api/preferences', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, work_week, enabled_providers, theme, terminal })
    });
    const saved = await res.json();
    const isQueued = !!(saved && saved.queued);
    if (saved && saved.queued) {
      // Offline queue path — apply local optimistic state for UX consistency
      _prefs = { ..._prefs, name, work_week, enabled_providers, theme, terminal };
      showToast('info', 'Preferences queued; will sync when server is back');
    } else {
      _prefs = saved;
    }
    _applyProviderVisibility();
    _applyTheme(_prefs.theme);
    // Push terminal prefs to Electron main process
    if (window.terminalAPI) {
      const tp = terminal;
      window.terminalAPI.setPrefs({
        externalTerminal: tp.externalTerminal === 'auto' ? 'auto' : tp.externalTerminal,
        shell: tp.shell === 'auto' ? '' : tp.shell,
        customCommand: tp.customCommand,
      });
    }
    closePreferences();
    await refreshClientQueueInspector();

    // Auto-setup MCP for newly enabled providers (skip if already configured)
    if (!isQueued && newlyEnabled.length > 0) {
      _setupMcpForProviders(newlyEnabled);
    }
  } catch(e) { alert('Failed to save: ' + e.message); }
}

async function _setupMcpForProviders(providers) {
  try {
    const res = await fetch('/api/setup-mcp', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ providers })
    });
    const data = await res.json();
    const results = data.results || [];
    const configured = results.filter(r => r.status === 'configured');
    const already = results.filter(r => r.status === 'already_configured');
    const skipped = results.filter(r => r.status === 'skipped');
    const errors = results.filter(r => r.status === 'error');

    if (configured.length > 0) {
      const names = configured.map(r => r.label).join(', ');
      showToast('success', `Savant MCP servers configured for: ${names}`, 8000);
    }
    if (already.length > 0) {
      const names = already.map(r => r.label).join(', ');
      showToast('info', `MCP already configured for: ${names}`, 5000);
    }

    // Show Hermes SSE patch results
    const hermesPatchResults = results.filter(r => r.sse_patch);
    for (const r of hermesPatchResults) {
      const sp = r.sse_patch;
      if (sp.patches_applied && sp.patches_applied.length > 0) {
        showToast('success', `Hermes SSE patches applied: ${sp.patches_applied.join(', ')}`, 10000);
      } else if (sp.all_good) {
        showToast('info', `Hermes SSE support already present`, 5000);
      }
      if (sp.errors && sp.errors.length > 0) {
        showToast('warning', `Hermes SSE patch issues: ${sp.errors.join(', ')}`, 10000);
      }
    }
    if (skipped.length > 0) {
      const names = skipped.map(r => `${r.label || r.provider} (${r.reason})`).join(', ');
      showToast('warning', `MCP setup skipped: ${names}`, 6000);
    }
    if (errors.length > 0) {
      const names = errors.map(r => `${r.label}: ${r.error}`).join(', ');
      showToast('error', `MCP setup failed: ${names}`, 10000);
    }
  } catch (e) {
    showToast('error', `MCP setup error: ${e.message}`, 8000);
  }
}

// ── Task keyboard shortcuts ──────────────────────────────────────────
let _selectedTaskIdx = -1;
let _taskShortcutsEnabled = false;

function _getVisibleTasks() {
  // Return tasks in column order: todo, in-progress, done, blocked
  const order = ['todo', 'in-progress', 'done', 'blocked'];
  const all = [];
  order.forEach(st => {
    _allTasks.filter(t => t.status === st).forEach(t => all.push(t));
  });
  return all;
}

function _highlightTask(idx) {
  document.querySelectorAll('.task-card').forEach(c => c.classList.remove('task-selected'));
  const tasks = _getVisibleTasks();
  if (idx < 0 || idx >= tasks.length) return;
  const tid = tasks[idx].id;
  const el = document.querySelector(`.task-card[ondragstart*="${tid}"]`);
  if (el) {
    el.classList.add('task-selected');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function _showTaskShortcutHelp() {
  const el = document.getElementById('task-shortcut-help');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

document.addEventListener('keydown', (e) => {
  // Only active on tasks tab and when no modal/input is focused
  if (currentTab !== 'tasks') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.getElementById('task-modal').style.display === 'flex') {
    return; // global ESC handler covers closing
  }

  const tasks = _getVisibleTasks();
  const statusOrder = ['todo', 'in-progress', 'done', 'blocked'];

  switch(e.key.toLowerCase()) {
    case 'n': // New task
      e.preventDefault();
      openTaskModal();
      break;

    case 'j': // Next task
    case 'arrowdown':
      e.preventDefault();
      if (tasks.length) {
        _selectedTaskIdx = Math.min(_selectedTaskIdx + 1, tasks.length - 1);
        _highlightTask(_selectedTaskIdx);
      }
      break;

    case 'k': // Previous task
    case 'arrowup':
      e.preventDefault();
      if (tasks.length) {
        _selectedTaskIdx = Math.max(_selectedTaskIdx - 1, 0);
        _highlightTask(_selectedTaskIdx);
      }
      break;

    case 'enter': // Edit selected task
      if (_selectedTaskIdx >= 0 && _selectedTaskIdx < tasks.length) {
        e.preventDefault();
        openTaskModal(tasks[_selectedTaskIdx].id);
      }
      break;

    case 'l': // Move right (next status)
    case 'arrowright':
      if (_selectedTaskIdx >= 0 && _selectedTaskIdx < tasks.length) {
        e.preventDefault();
        const t = tasks[_selectedTaskIdx];
        const ci = statusOrder.indexOf(t.status);
        if (ci < statusOrder.length - 1) moveTask(t.id, statusOrder[ci + 1]);
      }
      break;

    case 'h': // Move left (prev status)
    case 'arrowleft':
      if (_selectedTaskIdx >= 0 && _selectedTaskIdx < tasks.length) {
        e.preventDefault();
        const t = tasks[_selectedTaskIdx];
        const ci = statusOrder.indexOf(t.status);
        if (ci > 0) moveTask(t.id, statusOrder[ci - 1]);
      }
      break;

    case 'd': // Quick mark done
      if (_selectedTaskIdx >= 0 && _selectedTaskIdx < tasks.length) {
        e.preventDefault();
        moveTask(tasks[_selectedTaskIdx].id, 'done');
      }
      break;

    case 'x': // Delete selected
      if (_selectedTaskIdx >= 0 && _selectedTaskIdx < tasks.length) {
        e.preventDefault();
        deleteTask(tasks[_selectedTaskIdx].id);
        _selectedTaskIdx = Math.min(_selectedTaskIdx, tasks.length - 2);
      }
      break;

    case 'e': // End day
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        endDay();
      }
      break;

    case '?': // Show help
      e.preventDefault();
      _showTaskShortcutHelp();
      break;

    case 'escape':
      _selectedTaskIdx = -1;
      document.querySelectorAll('.task-card').forEach(c => c.classList.remove('task-selected'));
      const helpEl = document.getElementById('task-shortcut-help');
      if (helpEl) helpEl.style.display = 'none';
      break;
  }
});
