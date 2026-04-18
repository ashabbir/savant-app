function filterSessions(sessions) {
  const now = new Date();
  let result = sessions;

  // Status filter
  if (currentFilter === 'open') {
    result = result.filter(s => s.is_open);
  } else if (currentFilter === 'starred') {
    result = result.filter(s => s.starred);
  } else if (currentFilter === 'archived') {
    result = result.filter(s => s.archived);
  } else if (currentFilter !== 'all') {
    const upper = currentFilter.toUpperCase();
    result = result.filter(s => s.status === upper);
  }

  // Sort archived to end
  result.sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));

  // Project filter
  if (currentProject) {
    result = result.filter(s => (s.project || '') === currentProject);
  }

  // MR filter (updated for multiple MRs)
  if (mrFilter) {
    if (mrFilter === 'has-mr') {
      result = result.filter(s => s.mrs && s.mrs.length > 0);
    } else if (mrFilter === 'author') {
      result = result.filter(s => s.mrs && s.mrs.some(mr => mr.role === 'author'));
    } else if (mrFilter === 'reviewer') {
      result = result.filter(s => s.mrs && s.mrs.some(mr => mr.role === 'reviewer'));
    } else {
      // Status filter (draft, open, review, testing, merged, closed)
      result = result.filter(s => s.mrs && s.mrs.some(mr => mr.status === mrFilter));
    }
  }

  // Workspace filter
  const wsFilterVal = document.getElementById('filter-workspace')?.value || '';
  if (wsFilterVal === 'unassigned') {
    result = result.filter(s => !s.workspace);
  } else if (wsFilterVal) {
    result = result.filter(s => s.workspace === wsFilterVal);
  }

  // Time range filter (based on last activity)
  if (timeRange) {
    const multipliers = { h: 3600000, d: 86400000, w: 604800000 };
    const num = parseInt(timeRange);
    const unit = timeRange.slice(-1);
    const ms = num * (multipliers[unit] || 0);
    if (ms) {
      const cutoff = new Date(now.getTime() - ms);
      result = result.filter(s => {
        const lastActivity = s.updated_at || s.last_event_time || s.created_at;
        return lastActivity && new Date(lastActivity) >= cutoff;
      });
    }
  }

  // Free text search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(s => {
      if (_searchTitleOnly) {
        // Title-only filter: match session id, nickname, summary
        const haystack = [s.id, s.nickname, s.summary].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      }
      const haystack = [
        s.summary, s.nickname, s.project, s.cwd, s.git_root, s.branch,
        s.id, s.last_intent, s.status,
        ...(s.user_messages || []).map(m => m.content),
        ...(s.tools_used || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  return result;
}

function populateProjectFilter(sessions) {
  const select = document.getElementById('filter-project');
  const current = select.value;
  const projects = [...new Set(sessions.map(s => s.project).filter(Boolean))].sort();

  // Keep existing selection stable across refreshes
  select.innerHTML = '<option value="">ALL PROJECTS</option>' +
    projects.map(p => `<option value="${escapeHtml(p)}"${p === current ? ' selected' : ''}>${escapeHtml(p)}</option>`).join('');
}

function buildCardHtml(s, providerOverride) {
    const navProvider = providerOverride ? `'${providerOverride}'` : 'undefined';
    const summaryClass = s.summary ? '' : 'no-summary';
    const displayName = s.nickname || s.summary || 'No summary';
    const displayClass = (s.nickname || s.summary) ? '' : 'no-summary';
    const planBadge = s.plan ? `<span class="plan-badge">📋 ${escapeHtml(s.plan)}</span>` : '';

    const toolsHtml = (s.tools_used || []).slice(0, 8).map(t =>
      `<span class="tool-tag">${escapeHtml(t)}</span>`
    ).join('');

    const activeToolsHtml = (s.active_tools || []).map(t =>
      `<div class="active-tool-indicator">⚡ ${escapeHtml(t.name)} running</div>`
    ).join('');

    const messagesHtml = (s.user_messages || []).map(m => `
      <div class="msg-item">
        <div class="msg-time">${formatTime(m.timestamp)}</div>
        <div class="msg-content">${escapeHtml(m.content)}</div>
      </div>
    `).join('');

    const assets = [];
    if (s.checkpoint_count) assets.push(`<span class="asset-tag">📍 <span>${s.checkpoint_count}</span> checkpoints</span>`);
    if (s.file_count) assets.push(`<span class="asset-tag">📄 <span>${s.file_count}</span> files</span>`);
    if (s.research_count) assets.push(`<span class="asset-tag">🔬 <span>${s.research_count}</span> research</span>`);
    if (s.has_plan_file) assets.push(`<span class="asset-tag">📋 plan</span>`);
    const assetsHtml = assets.length ? `<div class="asset-counts">${assets.join('')}</div>` : '';

    const modelBadges = Object.entries(s.model_call_counts || {}).map(([m, c]) => {
      const cls = m.includes('opus') ? 'opus' : m.includes('sonnet') ? 'sonnet' : m.includes('haiku') ? 'haiku' : 'other';
      const short = m.replace('claude-','').replace('-',' ');
      return `<span class="card-model-badge ${cls}">${short} ×${c}</span>`;
    }).join('');

    // MR Badges (support multiple)
    let mrBadge = '';
    if (s.mrs && s.mrs.length > 0) {
      const mrColors = {
        'draft': '#ffc700',
        'open': '#00a6ff',
        'review': '#a855f7',
        'testing': '#ff8c00',
        'on-hold': '#ef4444',
        'merged': '#00ff88',
        'closed': '#6b7280'
      };
      const mrLabels = {
        'draft': 'Draft',
        'open': 'Open',
        'review': 'Review',
        'testing': 'Testing',
        'on-hold': 'On Hold',
        'merged': 'Merged',
        'closed': 'Closed'
      };
      const maxDisplay = 2;
      const displayMrs = s.mrs.slice(0, maxDisplay);
      mrBadge = displayMrs.map(mr => {
        const color = mrColors[mr.status] || '#888';
        const label = mrLabels[mr.status] || mr.status;
        const jiraText = mr.jira ? ` · ${mr.jira}` : '';
        const roleIcon = mr.role === 'reviewer' ? '👁️' : '✍️';
        return `<span class="mr-badge" style="background:${color};" title="${mr.url}${jiraText}">${roleIcon} ${label}</span>`;
      }).join(' ');
      if (s.mrs.length > maxDisplay) {
        mrBadge += ` <span class="mr-badge" style="background:#444;font-size:0.5rem;">+${s.mrs.length - maxDisplay}</span>`;
      }
    }

    // Workspace badge
    let wsBadge = '';
    if (s.workspace) {
      const ws = _workspaces.find(w => w.id === s.workspace);
      if (ws) wsBadge = `<span class="ws-badge" title="Workspace: ${escapeHtml(ws.name)}">🗂 ${escapeHtml(ws.name)}</span>`;
    }

    const cardStatsHtml = `<span class="meta-label">STATS</span><span class="meta-value" style="font-size:0.55rem;color:var(--text-dim)">${s.message_count||0} msgs · ${s.turn_count||0} turns · ${(s.tools_used||[]).length} tools</span>`;

    return `
      <div class="session-card${s.archived ? ' archived' : ''}" data-status="${s.status}" data-id="${s.id}" onclick="navigateToSession(event, '${s.id}', ${navProvider})">
        <input type="checkbox" class="bulk-check" data-id="${s.id}" data-size="${s.disk_size||0}" onclick="event.stopPropagation(); updateBulkCount()">
        <div class="card-header">
          <div class="card-row1">
            <div class="card-row1-left">
              <span class="status-badge ${s.status}">${s.status}</span>
              ${s.is_open ? '<span class="open-dot" title="Session is open"></span>' : ''}
              ${planBadge}
              ${mrBadge}
              ${wsBadge}
              ${modelBadges ? modelBadges : ''}
            </div>
            <div class="card-row1-right">
              <span class="card-info-icon" onclick="event.stopPropagation()">?
                <div class="card-info-tooltip"><b>UUID:</b> ${s.id}
<b>Model:</b> ${(s.models||[]).join(', ')||'unknown'}
<b>Repo:</b> ${escapeHtml(s.git_root||s.cwd||'—')}
<b>Branch:</b> ${escapeHtml(s.branch||'—')}
<b>Path:</b> ${escapeHtml(s.session_path||'—')}
<b>Duration:</b> ${formatDuration(s.first_event_time, s.last_event_time)||'—'}
<b>Last Event:</b> ${escapeHtml(s.last_event_type||'—')} ${timeAgo(s.last_event_time)}
<b>Events:</b> ${s.event_count||0}
<b>Messages:</b> ${s.message_count||0} · <b>Turns:</b> ${s.turn_count||0}
<b>Disk:</b> ${formatSize(s.disk_size||0)}
<b>Status:</b> ${s.status}</div>
              </span>
              <button class="export-btn" onclick="event.stopPropagation(); resumeInTerminal('${escapeHtml(s.resume_command)}', '${escapeHtml(s.cwd || s.git_root || '')}')" title="Resume in terminal">▶</button>
              <button class="export-btn" onclick="event.stopPropagation(); copyText('${escapeHtml(s.resume_command)}', this)" title="Copy resume command">📋</button>
              <button class="star-btn ${s.starred ? 'starred' : ''}" onclick="event.stopPropagation(); toggleStar('${s.id}', this)" title="Star session">${s.starred ? '★' : '☆'}</button>
              <button class="delete-btn" onclick="event.stopPropagation(); confirmDelete('${s.id}', '${escapeHtml(s.summary || s.project || s.id)}')" title="Delete session">🗑</button>
            </div>
          </div>
          <div class="card-row-title">
            <div class="session-summary ${displayClass}">
              <span class="summary-text">${escapeHtml(displayName)}</span>
              <button class="rename-btn" onclick="event.stopPropagation(); renameSession('${s.id}', this)" title="Rename">✏️</button>
            </div>
          </div>
          <div class="session-id-text">${s.id}</div>
        </div>
        <div class="card-meta">
          ${s.project ? `<span class="meta-label">PROJECT</span><span class="meta-value project">${escapeHtml(s.project)}</span>` : ''}
          ${s.last_intent ? `<span class="meta-label">INTENT</span><span class="meta-value intent">${escapeHtml(s.last_intent)}</span>` : ''}
          <span class="meta-label">STARTED</span><span class="meta-value">${formatTime(s.created_at)} <span class="time-ago">(${timeAgo(s.created_at)})</span></span>
          <span class="meta-label">UPDATED</span><span class="meta-value">${formatTime(s.updated_at)} <span class="time-ago">(${timeAgo(s.updated_at)})</span></span>
          ${cardStatsHtml}
        </div>
        ${activeToolsHtml}
        ${assetsHtml}
        ${buildTimelineHtml(s.activity_buckets)}
        <div class="card-footer">
        </div>
      </div>`;
}

function renderSessions(sessions) {
  const container = document.getElementById('sessions-container');
  populateProjectFilter(sessions);
  buildStatusFilters(sessions);
  const filtered = filterSessions(sessions);

  document.getElementById('session-count-label').textContent =
    `${allSessions.length} of ${totalCount || allSessions.length}`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="no-sessions">
        <div class="icon">◇</div>
        <div>NO SESSIONS MATCH CURRENT FILTER</div>
      </div>`;
    return;
  }

  if (viewMode === 'grouped') {
    renderGroupedView(container, filtered);
  } else {
    renderGridView(container, filtered);
  }
}

function renderGroupedView(container, filtered) {
  // Group sessions by project
  const groups = {};
  for (const s of filtered) {
    const proj = s.project || '(No Project)';
    if (!groups[proj]) groups[proj] = [];
    groups[proj].push(s);
  }

  // Sort groups: groups with active sessions first, then alphabetical
  const sortedGroups = Object.keys(groups).sort((a, b) => {
    const aActive = groups[a].some(s => ['RUNNING','PROCESSING','ACTIVE','WAITING'].includes(s.status));
    const bActive = groups[b].some(s => ['RUNNING','PROCESSING','ACTIVE','WAITING'].includes(s.status));
    if (aActive !== bActive) return bActive ? 1 : -1;
    return a.localeCompare(b);
  });

  // Track collapsed state
  const collapsedGroups = new Set();
  container.querySelectorAll('.project-group-header.collapsed').forEach(el => {
    collapsedGroups.add(el.dataset.project);
  });

  let html = '';
  for (const proj of sortedGroups) {
    const sessions = groups[proj];
    const activeCount = sessions.filter(s => ['RUNNING','PROCESSING','ACTIVE','WAITING'].includes(s.status)).length;
    const dormantCount = sessions.filter(s => ['DORMANT','IDLE'].includes(s.status)).length;
    const isCollapsed = collapsedGroups.has(proj);

    html += `<div class="project-group">`;
    html += `<div class="project-group-header${isCollapsed ? ' collapsed' : ''}" data-project="${escapeHtml(proj)}" onclick="toggleProjectGroup(this)">
      <span class="chevron">▼</span>
      <span class="project-group-name">${escapeHtml(proj)}</span>
      <div class="project-group-stats">
        ${activeCount ? `<span class="group-stat active">⚡ ${activeCount} active</span>` : ''}
        ${dormantCount ? `<span class="group-stat dormant">💤 ${dormantCount} idle</span>` : ''}
        <span class="group-stat total">${sessions.length} total</span>
      </div>
    </div>`;
    html += `<div class="project-group-grid">`;
    for (const s of sessions) {
      try {
        html += buildCardHtml(s);
      } catch (e) {
        console.error('Failed to render session card:', s, e);
      }
    }
    html += `</div></div>`;
  }
  container.innerHTML = html;
}

function toggleProjectGroup(header) {
  header.classList.toggle('collapsed');
}

function renderGridView(container, filtered) {
  // Clear grouped view artifacts if present
  if (container.querySelector('.project-group')) {
    container.innerHTML = '';
  }

  const expandedIds = new Set();
  const loadedFileIds = new Set();
  container.querySelectorAll('.session-card.expanded').forEach(el => {
    expandedIds.add(el.dataset.id);
    if (el.querySelector('.file-browser[data-loaded]')) {
      loadedFileIds.add(el.dataset.id);
    }
  });

  const filteredIds = new Set(filtered.map(s => s.id));
  const existingCards = {};
  container.querySelectorAll('.session-card[data-id]').forEach(el => {
    existingCards[el.dataset.id] = el;
  });

  // Ensure grid wrapper exists
  let grid = container.querySelector('.sessions-grid');
  if (!grid) {
    container.innerHTML = '<div class="sessions-grid"></div>';
    grid = container.querySelector('.sessions-grid');
  }

  // Build the new set of cards with in-place updates
  const newIds = filtered.map(s => s.id);

  // Remove cards no longer in filtered set
  Object.keys(existingCards).forEach(id => {
    if (!filteredIds.has(id)) {
      existingCards[id].remove();
      delete existingCards[id];
    }
  });

  // Update or insert cards in order
  let prevEl = null;
  for (const s of filtered) {
    const existing = existingCards[s.id];
    if (existing) {
      // Update non-expanded cards fully; for expanded, only update header/meta
      const wasExpanded = existing.classList.contains('expanded');
      if (!wasExpanded) {
        const tmp = document.createElement('div');
        tmp.innerHTML = buildCardHtml(s);
        const newCard = tmp.firstElementChild;
        grid.replaceChild(newCard, existing);
        existingCards[s.id] = newCard;
      } else {
        // Surgically update status badge, open dot, meta values
        const badge = existing.querySelector('.status-badge');
        if (badge) {
          badge.className = `status-badge ${s.status}`;
          badge.textContent = s.status;
        }
        existing.dataset.status = s.status;
        // Update open dot
        const headerRight = existing.querySelector('.card-row1-right');
        const existingDot = existing.querySelector('.open-dot');
        if (s.is_open && !existingDot) {
          const dot = document.createElement('span');
          dot.className = 'open-dot';
          dot.title = 'Session is open in Copilot';
          headerRight.insertBefore(dot, headerRight.firstChild);
        } else if (!s.is_open && existingDot) {
          existingDot.remove();
        }
        // Update event count
        const ec = existing.querySelector('.event-count span');
        if (ec) ec.textContent = s.event_count || 0;
        // Update time-ago values
        const timeAgos = existing.querySelectorAll('.time-ago');
        const times = [s.created_at, s.updated_at, s.last_event_time].filter(Boolean);
        timeAgos.forEach((el, i) => {
          if (times[i]) el.textContent = `(${timeAgo(times[i])})`;
        });
      }
      // Ensure correct order
      if (prevEl) {
        if (prevEl.nextElementSibling !== existingCards[s.id]) {
          grid.insertBefore(existingCards[s.id], prevEl.nextElementSibling);
        }
      } else {
        if (grid.firstElementChild !== existingCards[s.id]) {
          grid.insertBefore(existingCards[s.id], grid.firstElementChild);
        }
      }
      prevEl = existingCards[s.id];
    } else {
      // New card
      const tmp = document.createElement('div');
      tmp.innerHTML = buildCardHtml(s);
      const newCard = tmp.firstElementChild;
      // Restore expanded state if it was expanded before a filter change
      if (expandedIds.has(s.id)) {
        newCard.classList.add('expanded');
      }
      if (prevEl) {
        prevEl.after(newCard);
      } else {
        grid.insertBefore(newCard, grid.firstElementChild);
      }
      existingCards[s.id] = newCard;
      prevEl = newCard;
      // Re-load files if it was previously loaded
      if (expandedIds.has(s.id) && loadedFileIds.has(s.id)) {
        loadSessionFiles(s.id);
      }
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function buildTimelineHtml(buckets) {
  if (!buckets || !buckets.length) return '';
  const maxVal = Math.max(...buckets, 1);
  const blocks = buckets.map(count => {
    const ratio = count / maxVal;
    let lvl = 0;
    if (ratio > 0.8) lvl = 5;
    else if (ratio > 0.6) lvl = 4;
    else if (ratio > 0.4) lvl = 3;
    else if (ratio > 0.2) lvl = 2;
    else if (count > 0) lvl = 1;
    return `<div class="timeline-block lvl-${lvl}" title="${count} events"></div>`;
  }).join('');
  return `<div class="activity-timeline" title="Session activity over time">${blocks}</div>`;
}

let viewMode = 'grid';

function setViewMode(mode) {
  viewMode = mode;
  document.querySelectorAll('.view-toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === mode);
  });
  renderSessions(allSessions);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
}

// --- Dynamic Status Filters ---
function buildStatusFilters(sessions) {
  const select = document.getElementById('filter-status');
  const statuses = new Set(sessions.map(s => s.status));
  const hasStarred = sessions.some(s => s.starred);
  const hasOpen = sessions.some(s => s.is_open);
  const order = ['starred','archived','open','running','processing','active','waiting','idle','dormant','stuck','aborted'];
  const labels = { starred: '★ STARRED', open: 'OPEN', archived: '📦 ARCHIVED' };

  let html = `<option value="all">ALL</option>`;
  for (const key of order) {
    if (key === 'starred' && !hasStarred) continue;
    if (key === 'open' && !hasOpen) continue;
    if (key === 'archived' && !sessions.some(s => s.archived)) continue;
    if (key !== 'starred' && key !== 'open' && key !== 'archived' && !statuses.has(key.toUpperCase())) continue;
    const label = labels[key] || key.toUpperCase();
    html += `<option value="${key}">${label}</option>`;
  }
  select.innerHTML = html;
  select.value = currentFilter;
}

document.getElementById('filter-status').addEventListener('change', (e) => {
  currentFilter = e.target.value;
  renderSessions(allSessions);
});

// --- Analytics Panel ---
function renderAnalytics(sessions) {
  const body = document.getElementById('analytics-body');
  if (!sessions.length) { body.innerHTML = ''; return; }

  // 1. Sessions per day (last 7 days)
  const now = new Date();
  const dayLabels = [];
  const dayCounts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = _localDateStr(d);
    dayLabels.push(d.toLocaleDateString(undefined, { weekday: 'short' }));
    dayCounts.push(sessions.filter(s => s.created_at && s.created_at.slice(0,10) === key).length);
  }
  const maxDay = Math.max(...dayCounts, 1);
  const barsHtml = dayCounts.map((c, i) =>
    `<div class="bar-chart-col" style="height:${Math.max(c/maxDay*100,2)}%" title="${dayLabels[i]}: ${c}"></div>`
  ).join('');

  // 2. Most active projects
  const projCounts = {};
  sessions.forEach(s => { const p = s.project || '—'; projCounts[p] = (projCounts[p]||0) + 1; });
  const topProjects = Object.entries(projCounts).sort((a,b) => b[1]-a[1]).slice(0,6);
  const projColors = ['var(--cyan)','var(--magenta)','var(--green)','var(--yellow)','var(--orange)','var(--red)'];
  const donutHtml = topProjects.map((p,i) =>
    `<div class="donut-item"><div class="donut-dot" style="background:${projColors[i%6]}"></div><span class="donut-name">${escapeHtml(p[0])}</span><span class="donut-count">${p[1]}</span></div>`
  ).join('');

  // 3. Most used tools
  const toolCounts = {};
  sessions.forEach(s => (s.tools_used||[]).forEach(t => { toolCounts[t] = (toolCounts[t]||0) + 1; }));
  const topTools = Object.entries(toolCounts).sort((a,b) => b[1]-a[1]).slice(0,6);
  const maxTool = topTools.length ? topTools[0][1] : 1;
  const toolsHtml = topTools.map(t =>
    `<div class="tool-rank-item"><div class="tool-rank-bar" style="width:${Math.max(t[1]/maxTool*60,4)}px"></div><span class="tool-rank-name">${escapeHtml(t[0])}</span><span class="tool-rank-count">${t[1]}</span></div>`
  ).join('');

  // 4. Total session hours this week
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  let totalMs = 0;
  sessions.forEach(s => {
    if (!s.first_event_time || !s.last_event_time) return;
    const start = new Date(s.first_event_time);
    if (start < weekAgo) return;
    totalMs += new Date(s.last_event_time) - start;
  });
  const totalHrs = (totalMs / 3600000).toFixed(1);

  body.innerHTML = `
    <div class="analytics-section">
      <div class="analytics-section-title">SESSIONS / DAY (7d)</div>
      <div class="bar-chart">${barsHtml}</div>
      <div class="bar-chart-label"><span>${dayLabels[0]}</span><span>${dayLabels[6]}</span></div>
    </div>
    <div class="analytics-section">
      <div class="analytics-section-title">TOP PROJECTS</div>
      <div class="donut-chart">${donutHtml}</div>
    </div>
    <div class="analytics-section">
      <div class="analytics-section-title">TOP TOOLS</div>
      <div class="tool-rank-list">${toolsHtml || '<span style="color:var(--text-dim);font-size:0.6rem;">No tool data</span>'}</div>
    </div>
    <div class="analytics-section">
      <div class="analytics-section-title">THIS WEEK</div>
      <div class="analytics-big-stat">${totalHrs}h</div>
      <div class="analytics-big-label">TOTAL SESSION TIME</div>
      <div class="analytics-big-stat" style="font-size:1rem;margin-top:10px;">${sessions.filter(s => new Date(s.created_at||0) >= weekAgo).length}</div>
      <div class="analytics-big-label">SESSIONS STARTED</div>
    </div>`;
}

// --- Usage Intelligence ---

async function fetchUsage() {
  try {
    const gen = fetchGeneration;
    const res = await fetch(getUsageEndpoint());
    if (gen !== fetchGeneration) return;
    const data = await res.json();
    if (gen !== fetchGeneration) return;
    if (data.loading) {
      setTimeout(fetchUsage, 5000);
      return;
    }
    usageCache = data;
    renderUsage();
  } catch (e) {
    console.error('Usage fetch error:', e);
  }
}

function getModelClass(name) {
  if (name.includes('opus')) return 'opus';
  if (name.includes('sonnet')) return 'sonnet';
  if (name.includes('haiku')) return 'haiku';
  return 'other';
}

function getModelColor(name) {
  if (name.includes('opus')) return '#be4bff';
  if (name.includes('sonnet')) return 'var(--cyan)';
  if (name.includes('haiku')) return 'var(--green)';
  return 'var(--yellow)';
}

function renderUsage() {
  const body = document.getElementById('usage-body');
  if (!usageCache) { body.innerHTML = '<div style="font-size:0.7rem;color:var(--text-dim);">No data</div>'; return; }
  const u = usageCache;
  const t = u.totals;

  // Stats row
  const statsHtml = `
    <div class="usage-stats-row">
      <div class="usage-stat-card">
        <div class="usage-stat-value">${t.sessions}</div>
        <div class="usage-stat-label">SESSIONS</div>
      </div>
      <div class="usage-stat-card">
        <div class="usage-stat-value">${t.messages.toLocaleString()}</div>
        <div class="usage-stat-label">MESSAGES</div>
      </div>
      <div class="usage-stat-card">
        <div class="usage-stat-value">${t.turns.toLocaleString()}</div>
        <div class="usage-stat-label">TURNS</div>
      </div>
      <div class="usage-stat-card">
        <div class="usage-stat-value">${t.tool_calls.toLocaleString()}</div>
        <div class="usage-stat-label">TOOL CALLS</div>
      </div>
      <div class="usage-stat-card">
        <div class="usage-stat-value">${t.total_hours}h</div>
        <div class="usage-stat-label">TOTAL HOURS</div>
      </div>
      <div class="usage-stat-card">
        <div class="usage-stat-value">${t.avg_session_minutes}m</div>
        <div class="usage-stat-label">AVG SESSION</div>
      </div>
    </div>`;

  // Model usage
  const maxModelCalls = u.models.length ? u.models[0].calls : 1;
  const modelsHtml = u.models.map(m => {
    const cls = getModelClass(m.name);
    const pct = (m.calls / maxModelCalls * 100).toFixed(0);
    const color = getModelColor(m.name);
    const short = m.name.replace('claude-','');
    return `<div class="model-row">
      <span class="model-badge ${cls}">${short}</span>
      <div class="model-bar-wrap"><div class="model-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="model-count">${m.calls.toLocaleString()}</span>
    </div>`;
  }).join('');

  // Daily activity chart (stacked: messages + tools)
  const daily = u.daily || [];
  const maxDaily = Math.max(...daily.map(d => d.tools + d.messages), 1);
  const dailyBarsHtml = daily.map(d => {
    const msgH = (d.messages / maxDaily * 100).toFixed(1);
    const toolH = (d.tools / maxDaily * 100).toFixed(1);
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:stretch;gap:1px;justify-content:flex-end;height:80px" title="${d.date}\n${d.messages} msgs · ${d.tools} tools · ${d.turns} turns · ${d.sessions} sessions">
      <div class="usage-daily-bar" style="height:${Math.max(toolH,1)}%;background:var(--cyan);"></div>
      <div class="usage-daily-bar" style="height:${Math.max(msgH,1)}%;background:var(--magenta);"></div>
    </div>`;
  }).join('');
  const firstDay = daily.length ? daily[0].date.slice(5) : '';
  const lastDay = daily.length ? daily[daily.length-1].date.slice(5) : '';

  // Top tools
  const topTools = (u.tools || []).slice(0, 12);
  const maxToolCalls = topTools.length ? topTools[0].calls : 1;
  const toolRowsHtml = topTools.map((t, i) => {
    const pct = (t.calls / maxToolCalls * 100).toFixed(0);
    return `<div class="usage-tool-row">
      <span class="usage-tool-rank">${i+1}</span>
      <span class="usage-tool-name">${escapeHtml(t.name)}</span>
      <div class="usage-tool-bar-wrap"><div class="usage-tool-bar-fill" style="width:${pct}%"></div></div>
      <span class="usage-tool-count">${t.calls.toLocaleString()}</span>
    </div>`;
  }).join('');

  // Efficiency
  const efficiencyHtml = `
    <div class="efficiency-grid">
      <div class="efficiency-card">
        <div class="efficiency-value">${t.avg_tools_per_turn}</div>
        <div class="efficiency-label">TOOLS / TURN</div>
      </div>
      <div class="efficiency-card">
        <div class="efficiency-value">${t.avg_turns_per_message}</div>
        <div class="efficiency-label">TURNS / MESSAGE</div>
      </div>
      <div class="efficiency-card">
        <div class="efficiency-value">${t.events.toLocaleString()}</div>
        <div class="efficiency-label">TOTAL EVENTS</div>
      </div>
      <div class="efficiency-card">
        <div class="efficiency-value">${t.avg_session_minutes}m</div>
        <div class="efficiency-label">AVG DURATION</div>
      </div>
    </div>`;

  body.innerHTML = `
    ${statsHtml}
    <div class="usage-panels-grid">
      <div class="usage-section">
        <div class="usage-section-title">MODEL USAGE</div>
        ${modelsHtml || '<div style="color:var(--text-dim);font-size:0.6rem;">No model data</div>'}
      </div>
      <div class="usage-section">
        <div class="usage-section-title">DAILY ACTIVITY (14d)</div>
        <div style="display:flex;align-items:flex-end;gap:2px;height:80px;">${dailyBarsHtml}</div>
        <div class="usage-daily-labels"><span>${firstDay}</span><span>${lastDay}</span></div>
        <div class="usage-daily-legend">
          <span><i style="background:var(--cyan)"></i> Tool calls</span>
          <span><i style="background:var(--magenta)"></i> Messages</span>
        </div>
      </div>
      <div class="usage-section">
        <div class="usage-section-title">EFFICIENCY</div>
        ${efficiencyHtml}
      </div>
    </div>
    <div style="margin-top:16px;">
      <div class="usage-section">
        <div class="usage-section-title">TOP TOOLS (ALL SESSIONS)</div>
        ${toolRowsHtml || '<div style="color:var(--text-dim);font-size:0.6rem;">No tool data</div>'}
      </div>
    </div>`;
}

// Fetch usage on load, refresh every 60s
if (currentTab === 'sessions') fetchUsage();
setInterval(() => { if (currentTab === 'sessions') fetchUsage(); }, 60000);

// --- Cross-session conversation search (merged with card search) ---
let convSearchTimeout;
function closeConvResults() {
  const overlay = document.getElementById('conv-results-overlay');
  if (overlay) overlay.style.display = 'none';
}

function showUnifiedSearchResults(cardMatches, chatResults, query, noteResults) {
  noteResults = noteResults || [];
  let overlay = document.getElementById('conv-results-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'conv-results-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:40000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px;';
    overlay.onclick = (e) => { if (e.target === overlay) closeConvResults(); };
    document.body.appendChild(overlay);
  }
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  let html = `<div style="background:var(--bg-panel);border:1px solid var(--cyan);border-radius:10px;width:740px;max-height:75vh;overflow-y:auto;padding:20px;box-shadow:0 0 40px rgba(0,255,255,0.1);">`;

  // --- Card matches ---
  html += `<div style="font-family:'Orbitron',sans-serif;font-size:0.55rem;letter-spacing:2px;color:var(--cyan);margin-bottom:10px;display:flex;align-items:center;gap:8px;">
    <span style="font-size:0.9rem;">📋</span> MATCHING SESSIONS — ${cardMatches.length}
  </div>`;
  if (!cardMatches.length) {
    html += '<div style="color:var(--text-dim);font-size:0.65rem;padding:8px 0 16px;">No session matches</div>';
  } else {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">';
    cardMatches.forEach(s => {
      const name = escapeHtml(s.nickname || s.summary || s.id.slice(0,8));
      const proj = escapeHtml(s.project || '');
      const statusColor = s.status === 'RUNNING' ? 'var(--green)' : s.status === 'WAITING' ? 'var(--yellow)' : s.status === 'STUCK' ? 'var(--red)' : 'var(--text-dim)';
      html += `<a href="${getDetailPageUrl(s.id)}" style="text-decoration:none;display:block;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;flex:0 0 calc(50% - 3px);box-sizing:border-box;transition:border-color 0.15s;cursor:pointer;" onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
          <span style="font-size:0.6rem;color:var(--text);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
        </div>
        <div style="font-size:0.5rem;color:var(--text-dim);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${proj}</div>
      </a>`;
    });
    html += '</div>';
  }

  // --- Note matches ---
  // Also search client-side notes from allSessions
  const clientNoteMatches = [];
  const ql = query.toLowerCase();
  (allSessions || []).forEach(s => {
    (s.notes || []).forEach(n => {
      if (n.text && n.text.toLowerCase().includes(ql)) {
        clientNoteMatches.push({
          session_id: s.id,
          session_name: s.nickname || s.summary || s.id.slice(0,8),
          project: s.project || '',
          timestamp: n.timestamp || '',
          snippet: n.text,
        });
      }
    });
  });
  // Merge server + client note results, dedupe by session_id+timestamp
  const seen = new Set();
  const allNotes = [];
  [...noteResults, ...clientNoteMatches].forEach(n => {
    const key = n.session_id + '|' + n.timestamp;
    if (!seen.has(key)) { seen.add(key); allNotes.push(n); }
  });

  html += `<div style="font-family:'Orbitron',sans-serif;font-size:0.55rem;letter-spacing:2px;color:var(--yellow);margin-bottom:10px;display:flex;align-items:center;gap:8px;border-top:1px solid var(--border);padding-top:14px;">
    <span style="font-size:0.9rem;">📝</span> MATCHING NOTES — ${allNotes.length}
  </div>`;
  if (!allNotes.length) {
    html += '<div style="color:var(--text-dim);font-size:0.65rem;padding:8px 0 16px;">No note matches</div>';
  } else {
    allNotes.forEach(n => {
      const snippet = escapeHtml(n.snippet).replace(re, '<span style="background:rgba(255,199,0,0.3);color:var(--yellow);border-radius:2px;padding:0 2px;">$1</span>');
      const nNick = n.session_nickname;
      const nOrig = n.session_orig_name;
      const nNameHtml = nNick
        ? `<span style="font-size:0.6rem;color:var(--cyan);font-weight:700;">${escapeHtml(nNick)}</span><span style="font-size:0.45rem;color:var(--text-dim);margin-left:4px;opacity:0.6;">${escapeHtml(nOrig || n.session_id.slice(0,12))}</span>`
        : `<span style="font-size:0.6rem;color:var(--cyan);font-weight:700;">${escapeHtml(nOrig || n.session_name || n.session_id.slice(0,12))}</span>`;
      html += `<a href="${getDetailPageUrl(n.session_id)}" style="text-decoration:none;display:block;padding:10px;margin-bottom:5px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;transition:border-color 0.15s;cursor:pointer;" onmouseover="this.style.borderColor='var(--yellow)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
          <span>📝</span>
          ${nNameHtml}
          <span style="font-size:0.5rem;color:var(--text-dim);">${escapeHtml(n.project || '')}</span>
          <span style="font-size:0.5rem;color:var(--text-dim);margin-left:auto;">${escapeHtml(n.timestamp ? new Date(n.timestamp).toLocaleString() : '')}</span>
        </div>
        <div style="font-size:0.63rem;color:var(--text);line-height:1.5;">${snippet}</div>
      </a>`;
    });
  }

  // --- Chat matches ---
  html += `<div style="font-family:'Orbitron',sans-serif;font-size:0.55rem;letter-spacing:2px;color:var(--magenta);margin-bottom:10px;display:flex;align-items:center;gap:8px;border-top:1px solid var(--border);padding-top:14px;">
    <span style="font-size:0.9rem;">💬</span> MATCHING CONVERSATIONS — ${chatResults.length}
  </div>`;
  if (!chatResults.length) {
    html += '<div style="color:var(--text-dim);font-size:0.65rem;padding:8px 0;">No conversation matches</div>';
  } else {
    chatResults.forEach(r => {
      const snippet = escapeHtml(r.snippet).replace(re, '<span style="background:rgba(255,199,0,0.3);color:var(--yellow);border-radius:2px;padding:0 2px;">$1</span>');
      const icon = r.type === 'user' ? '👤' : '🤖';
      const nick = r.session_nickname;
      const orig = r.session_orig_name;
      const nameHtml = nick
        ? `<span style="font-size:0.6rem;color:var(--cyan);font-weight:700;">${escapeHtml(nick)}</span><span style="font-size:0.45rem;color:var(--text-dim);margin-left:4px;opacity:0.6;">${escapeHtml(orig || r.session_id.slice(0,12))}</span>`
        : `<span style="font-size:0.6rem;color:var(--cyan);font-weight:700;">${escapeHtml(orig || r.session_id.slice(0,12))}</span>`;
      html += `<a href="${getDetailPageUrl(r.session_id)}" style="text-decoration:none;display:block;padding:10px;margin-bottom:5px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;transition:border-color 0.15s;cursor:pointer;" onmouseover="this.style.borderColor='var(--magenta)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
          <span>${icon}</span>
          ${nameHtml}
          <span style="font-size:0.5rem;color:var(--text-dim);">${escapeHtml(r.project)}</span>
          <span style="font-size:0.5rem;color:var(--text-dim);margin-left:auto;">${escapeHtml(r.timestamp ? new Date(r.timestamp).toLocaleString() : '')}</span>
        </div>
        <div style="font-size:0.63rem;color:var(--text);line-height:1.5;">${snippet}</div>
      </a>`;
    });
  }
  html += '</div>';
  overlay.innerHTML = html;
  overlay.style.display = 'flex';
}

// --- Bulk Cleanup ---
let bulkMode = false;

function toggleBulkMode() {
  bulkMode = !bulkMode;
  document.body.classList.toggle('bulk-mode', bulkMode);
  document.getElementById('bulk-bar').classList.toggle('active', bulkMode);
  document.getElementById('purge-btn').style.borderColor = bulkMode ? 'var(--red)' : '';
  document.getElementById('purge-btn').style.color = bulkMode ? 'var(--red)' : '';
  if (!bulkMode) clearBulkSelection();
  updateBulkCount();
}

function clearBulkSelection() {
  document.querySelectorAll('.bulk-check').forEach(cb => cb.checked = false);
  updateBulkCount();
}

function selectAllDormant() {
  document.querySelectorAll('.session-card').forEach(card => {
    const cb = card.querySelector('.bulk-check');
    if (cb && card.dataset.status === 'DORMANT') cb.checked = true;
  });
  updateBulkCount();
}

function updateBulkCount() {
  const checked = document.querySelectorAll('.bulk-check:checked');
  let totalSize = 0;
  checked.forEach(cb => totalSize += parseInt(cb.dataset.size || 0));
  document.getElementById('bulk-count').textContent = `${checked.length} selected`;
  document.getElementById('bulk-size').textContent = checked.length ? `(${formatSize(totalSize)} to reclaim)` : '';
}

async function bulkDelete() {
  const checked = document.querySelectorAll('.bulk-check:checked');
  if (!checked.length) return;
  const ids = Array.from(checked).map(cb => cb.dataset.id);
  if (!confirm(`Delete ${ids.length} sessions? This cannot be undone.`)) return;
  try {
    const res = await fetch(getBulkDeleteEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    const deleted = new Set(data.deleted || []);
    allSessions = allSessions.filter(s => !deleted.has(s.id));
    if (data.errors && data.errors.length) {
      alert(`Deleted ${deleted.size} sessions. ${data.errors.length} failed: ${data.errors.map(e => e.error).join(', ')}`);
    }
    renderSessions(allSessions);
    updateBulkCount();
  } catch (e) {
    alert('Bulk delete failed.');
  }
}

// --- Export Session Summary ---
function exportSession(sessionId) {
  const s = allSessions.find(x => x.id === sessionId);
  if (!s) return;
  const lines = [
    `# Session: ${s.nickname || s.summary || 'Untitled'}`,
    '',
    `**ID:** \`${s.id}\``,
    `**Project:** ${s.project || '—'}`,
    `**Branch:** ${s.branch || '—'}`,
    `**Status:** ${s.status}`,
    `**Models:** ${(s.models||[]).join(', ') || 'unknown'}`,
    `**Started:** ${s.created_at || '—'}`,
    `**Updated:** ${s.updated_at || '—'}`,
    `**Duration:** ${formatDuration(s.first_event_time, s.last_event_time) || '—'}`,
    `**Events:** ${s.event_count || 0}`,
    `**Intent:** ${s.last_intent || '—'}`,
    '',
    '## User Messages',
    ...(s.user_messages || []).map(m => `- [${formatTime(m.timestamp)}] ${m.content}`),
    '',
    '## Tools Used',
    ...(s.tools_used || []).map(t => `- ${t}`),
    '',
    '## Assets',
    `- Checkpoints: ${s.checkpoint_count || 0}`,
    `- Files: ${s.file_count || 0}`,
    `- Research: ${s.research_count || 0}`,
    `- Plan: ${s.has_plan_file ? 'Yes' : 'No'}`,
    '',
    '## Resume',
    '```',
    s.resume_command,
    '```',
  ];
  const md = lines.join('\n');
  navigator.clipboard.writeText(md).then(() => {
    const btn = document.querySelector(`.session-card[data-id="${sessionId}"] .export-btn`);
    if (btn) { btn.textContent = '✅'; setTimeout(() => { btn.textContent = '📤'; }, 1500); }
  });
}

// --- Pinned Sessions Rail ---
function renderPinnedRail(sessions) {
  const rail = document.getElementById('pinned-rail');
  if (!rail) return;
  const statusColors = {
    RUNNING: 'var(--green)', PROCESSING: 'var(--green)', ACTIVE: 'var(--cyan)',
    WAITING: 'var(--yellow)', IDLE: 'var(--text-dim)', DORMANT: '#2a3a4a',
    STUCK: 'var(--red)', ABORTED: 'var(--orange)', UNKNOWN: '#4a5a6a'
  };
  const pinned = sessions.filter(s => s.starred || ['RUNNING','PROCESSING','ACTIVE','WAITING'].includes(s.status));
  if (!pinned.length) { rail.innerHTML = ''; return; }
  rail.innerHTML = pinned.map(s => {
    const color = statusColors[s.status] || 'var(--text-dim)';
    const label = s.project || s.nickname || s.id.slice(0,6);
    return `<div class="pinned-rail-item" onclick="jumpToCard('${s.id}')" title="${escapeHtml(s.nickname||s.summary||s.id)} — ${s.status}">
      <div class="pinned-rail-dot" style="background:${color};box-shadow:0 0 4px ${color}"></div>
      <div class="pinned-rail-label">${escapeHtml(label)}</div>
    </div>`;
  }).join('');
}

function jumpToCard(id) {
  const card = document.querySelector(`.session-card[data-id="${id}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.style.outline = '2px solid var(--cyan)';
    setTimeout(() => { card.style.outline = ''; }, 2000);
  }
}

// --- Browser Notifications ---
let previousStatuses = {};
let notificationsEnabled = false;

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    notificationsEnabled = true;
  }
}

function checkStatusTransitions(sessions) {
  if (!notificationsEnabled) return;
  for (const s of sessions) {
    const prev = previousStatuses[s.id];
    if (prev && prev !== s.status) {
      // Notify when transitioning to WAITING (needs user input)
      if (s.status === 'WAITING' && ['RUNNING','PROCESSING','ACTIVE'].includes(prev)) {
        new Notification('🟡 Session Ready', {
          body: `${s.project || 'Session'}: ${s.nickname || s.summary || s.id.slice(0,8)} is waiting for input`,
          icon: '⟐',
          tag: `session-${s.id}`,
        });
      }
      // Notify when a session gets stuck
      if (s.status === 'STUCK' && prev !== 'STUCK') {
        new Notification('🔴 Session Stuck', {
          body: `${s.project || 'Session'}: ${s.nickname || s.summary || s.id.slice(0,8)} appears stuck`,
          icon: '⟐',
          tag: `stuck-${s.id}`,
        });
      }
    }
    previousStatuses[s.id] = s.status;
  }
}

requestNotificationPermission();

async function fetchSessions(append = false) {
  try {
    const gen = fetchGeneration;
    const offset = append ? allSessions.length : 0;
    let url = getSessionsEndpoint();
    // Claude/Gemini use pagination; Copilot returns all
    if (currentMode === 'claude' || currentMode === 'gemini' || currentMode === 'hermes') {
      url += `?limit=${PAGE_SIZE}&offset=${offset}&_=${Date.now()}`;
    } else {
      url += `?_=${Date.now()}`;
    }
    const res = await fetch(url);
    if (gen !== fetchGeneration) return; // mode changed while fetching, discard
    const data = await res.json();
    if (gen !== fetchGeneration) return;

    // If backend cache is still building, show loading and retry sooner
    if (data.loading) {
      const container = document.getElementById('sessions-container');
      if (container && !append) {
      const modeLabel = currentMode === 'claude' ? 'CLAUDE' : currentMode === 'codex' ? 'CODEX' : currentMode === 'gemini' ? 'GEMINI' : currentMode === 'hermes' ? 'HERMES' : 'COPILOT';
      container.innerHTML = `<div class="loading"><div class="loading-spinner"></div><div style="color: var(--text-dim); font-size: 0.8rem;">BUILDING ${modeLabel} CACHE...</div></div>`;      }
      setTimeout(() => fetchSessions(false), 3000);
      return;
    }

    const newSessions = data.sessions || [];
    hasMore = !!data.has_more;
    totalCount = data.total || 0;

    if (append) {
      allSessions = allSessions.concat(newSessions);
    } else {
      allSessions = newSessions;
    }
    // Sort: starred first, then by updated_at desc
    const statusPriority = { RUNNING: 0, PROCESSING: 1, ACTIVE: 2, WAITING: 3, STUCK: 4, IDLE: 5, ABORTED: 6, DORMANT: 7, UNKNOWN: 8 };
    allSessions.sort((a, b) => {
      if (a.starred !== b.starred) return b.starred ? 1 : -1;
      const aPri = statusPriority[a.status] ?? 9;
      const bPri = statusPriority[b.status] ?? 9;
      if (aPri !== bPri) return aPri - bPri;
      const aTime = a.updated_at || a.created_at || '';
      const bTime = b.updated_at || b.created_at || '';
      return bTime.localeCompare(aTime);
    });
    checkStatusTransitions(allSessions);
    renderSessions(allSessions);
    renderPinnedRail(allSessions);
    renderAnalytics(allSessions);
    // Update mode count badge
    const countId = currentMode === 'claude' ? 'mode-claude-count' : currentMode === 'codex' ? 'mode-codex-count' : currentMode === 'gemini' ? 'mode-gemini-count' : currentMode === 'hermes' ? 'mode-hermes-count' : 'mode-copilot-count';
    const countEl = document.getElementById(countId);
    if (countEl) countEl.textContent = totalCount || allSessions.length;
    // Also update the parent Sessions tab count
    const sessCountEl = document.getElementById('mode-sessions-count');
    if (sessCountEl) sessCountEl.textContent = totalCount || allSessions.length;
    // Cache to sessionStorage for instant back-navigation
    try { sessionStorage.setItem('wf-sessions-' + currentMode, JSON.stringify({sessions: allSessions, total: totalCount, has_more: hasMore})); } catch(e) {}
    // Show/hide load more
    updateLoadMoreButton();
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

function updateLoadMoreButton() {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  if (hasMore) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btn.style.display = 'inline-block';
    btn.textContent = '▸▸';
    btn.title = `Load next ${PAGE_SIZE}`;
  } else {
    btn.disabled = true;
    btn.style.opacity = '0.25';
    btn.style.cursor = 'default';
    btn.style.display = allSessions.length > 0 ? 'inline-block' : 'none';
    btn.textContent = '▸▸';
    btn.title = 'All sessions loaded';
  }
}

// Project filter
document.getElementById('filter-project').addEventListener('change', (e) => {
  currentProject = e.target.value;
  renderSessions(allSessions);
});

// MR filter
let mrFilter = '';
document.getElementById('filter-mr').addEventListener('change', (e) => {
  mrFilter = e.target.value;
  renderSessions(allSessions);
});

// Time range filter
document.getElementById('filter-timerange').addEventListener('change', (e) => {
  timeRange = e.target.value;
  renderSessions(allSessions);
});

document.getElementById('filter-workspace').addEventListener('change', () => {
  renderSessions(allSessions);
});

// Search filter — input filters by id/summary (title) only
document.getElementById('filter-search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  _searchTitleOnly = true;
  renderSessions(allSessions);
  // Close context popup while typing
  closeConvResults();
});
// Enter triggers full search (all fields + API)
document.getElementById('filter-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchQuery.length >= 3) {
    e.preventDefault();
    _searchTitleOnly = false;
    clearTimeout(convSearchTimeout);
    const cardMatches = filterSessions(allSessions).slice(0, 20);
    fetch(`${getSearchEndpoint()}?q=${encodeURIComponent(searchQuery)}&limit=30`)
      .then(r => r.json())
      .then(data => showUnifiedSearchResults(cardMatches, data.results || [], searchQuery, data.note_results || []))
      .catch(() => {});
  }
  if (e.key === 'Escape') {
    e.target.value = '';
    searchQuery = '';
    _searchTitleOnly = false;
    renderSessions(allSessions);
    closeConvResults();
  }
});

// ── Workspace search — input filters by name only, Enter searches all fields ──
document.getElementById('ws-search-input').addEventListener('input', (e) => {
  _wsSearchTitleOnly = true;
  renderWorkspaces();
  closeWsSearchResults();
});
document.getElementById('ws-search-input').addEventListener('keydown', (e) => {
  const q = e.target.value.trim();
  if (e.key === 'Enter' && q.length >= 2) {
    e.preventDefault();
    _wsSearchTitleOnly = false;
    renderWorkspaces();
    openWsDeepSearch(q);
  }
  if (e.key === 'Escape') {
    e.target.value = '';
    _wsSearchTitleOnly = false;
    renderWorkspaces();
    closeWsSearchResults();
    e.target.blur();
  }
});

function closeWsSearchResults() {
  const overlay = document.getElementById('ws-search-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function openWsDeepSearch(query) {
  let overlay = document.getElementById('ws-search-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ws-search-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:40000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px;';
    overlay.onclick = (e) => { if (e.target === overlay) closeWsSearchResults(); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div style="background:var(--bg-panel);border:1px solid var(--cyan);border-radius:10px;width:740px;max-height:75vh;overflow-y:auto;padding:20px;box-shadow:0 0 40px rgba(0,255,255,0.1);">
    <div style="text-align:center;padding:20px;color:var(--text-dim);font-size:0.7rem;">Searching…</div></div>`;
  overlay.style.display = 'flex';

  try {
    const res = await fetch(`/api/workspaces/search?q=${encodeURIComponent(query)}&_=${Date.now()}`);
    const data = await res.json();
    renderWsSearchPopup(overlay, data, query);
  } catch(err) {
    overlay.innerHTML = `<div style="background:var(--bg-panel);border:1px solid var(--red);border-radius:10px;width:740px;padding:20px;">
      <div style="color:var(--red);font-size:0.7rem;">Search failed: ${err.message}</div></div>`;
  }
}

function renderWsSearchPopup(overlay, data, query) {
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const hl = (str) => escapeHtml(str).replace(re, '<span style="background:rgba(255,199,0,0.3);color:var(--yellow);border-radius:2px;padding:0 2px;">$1</span>');

  let html = `<div style="background:var(--bg-panel);border:1px solid var(--cyan);border-radius:10px;width:740px;max-height:75vh;overflow-y:auto;padding:20px;box-shadow:0 0 40px rgba(0,255,255,0.1);">`;
  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
    <span style="font-family:'Orbitron',sans-serif;font-size:0.65rem;color:var(--cyan);letter-spacing:2px;">🔍 WORKSPACE SEARCH</span>
    <span style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono);">"${escapeHtml(query)}"</span>
  </div>`;

  // Workspace matches
  const wsList = data.workspaces || [];
  html += `<div style="font-family:'Orbitron',sans-serif;font-size:0.5rem;letter-spacing:2px;color:var(--cyan);margin-bottom:8px;display:flex;align-items:center;gap:6px;">
    <span style="font-size:0.8rem;">🗂</span> WORKSPACES — ${wsList.length}
  </div>`;
  if (!wsList.length) {
    html += '<div style="color:var(--text-dim);font-size:0.6rem;padding:4px 0 12px;">No matches</div>';
  } else {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">';
    wsList.forEach(ws => {
      const priorityIcon = {critical:'🔴',high:'🟠',medium:'🟡',low:'🟢'}[ws.priority||'medium']||'🟡';
      const statusColor = (ws.status||'open') === 'open' ? 'var(--green)' : 'var(--red)';
      html += `<div onclick="closeWsSearchResults();openWsDetail('${ws.id}')" style="cursor:pointer;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;flex:0 0 calc(50% - 3px);box-sizing:border-box;transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
          <span style="font-size:0.6rem;color:var(--text);font-weight:600;">${hl(ws.name)}</span>
          <span style="font-size:0.45rem;">${priorityIcon}</span>
        </div>
        ${ws.description ? `<div style="font-size:0.5rem;color:var(--text-dim);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hl(ws.description)}</div>` : ''}
      </div>`;
    });
    html += '</div>';
  }

  // Session matches
  const sessList = data.sessions || [];
  html += `<div style="font-family:'Orbitron',sans-serif;font-size:0.5rem;letter-spacing:2px;color:var(--magenta);margin-bottom:8px;display:flex;align-items:center;gap:6px;border-top:1px solid var(--border);padding-top:12px;">
    <span style="font-size:0.8rem;">⟐</span> SESSIONS — ${sessList.length}
  </div>`;
  if (!sessList.length) {
    html += '<div style="color:var(--text-dim);font-size:0.6rem;padding:4px 0 12px;">No matches</div>';
  } else {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">';
    sessList.forEach(s => {
      const provIcon = {copilot:'⟐',claude:'🎭',codex:'🧠',gemini:'♊',hermes:'🪶'}[s.provider]||'⟐';
      html += `<div onclick="closeWsSearchResults();navigateToSessionDirect('${s.session_id}','${s.provider}')" style="cursor:pointer;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;flex:0 0 calc(50% - 3px);box-sizing:border-box;transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--magenta)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:0.7rem;">${provIcon}</span>
          <span style="font-size:0.6rem;color:var(--text);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hl(s.summary)}</span>
        </div>
        <div style="font-size:0.5rem;color:var(--text-dim);margin-top:3px;">${escapeHtml(s.workspace_name)} · ${escapeHtml(s.project||'')}</div>
      </div>`;
    });
    html += '</div>';
  }

  // Note matches
  const noteList = data.notes || [];
  html += `<div style="font-family:'Orbitron',sans-serif;font-size:0.5rem;letter-spacing:2px;color:var(--yellow);margin-bottom:8px;display:flex;align-items:center;gap:6px;border-top:1px solid var(--border);padding-top:12px;">
    <span style="font-size:0.8rem;">📝</span> NOTES — ${noteList.length}
  </div>`;
  if (!noteList.length) {
    html += '<div style="color:var(--text-dim);font-size:0.6rem;padding:4px 0 12px;">No matches</div>';
  } else {
    noteList.forEach(n => {
      html += `<div onclick="closeWsSearchResults();navigateToSessionDirect('${n.session_id}','${n.provider}')" style="cursor:pointer;padding:10px;margin-bottom:4px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--yellow)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
          <span>📝</span>
          <span style="font-size:0.55rem;color:var(--cyan);font-weight:600;">${escapeHtml(n.summary)}</span>
          <span style="font-size:0.45rem;color:var(--text-dim);">${escapeHtml(n.workspace_name)}</span>
          <span style="font-size:0.45rem;color:var(--text-dim);margin-left:auto;">${n.timestamp ? timeAgo(n.timestamp) : ''}</span>
        </div>
        <div style="font-size:0.6rem;color:var(--text);line-height:1.5;">${hl(n.text)}</div>
      </div>`;
    });
  }

  // Task matches
  const taskList = data.tasks || [];
  html += `<div style="font-family:'Orbitron',sans-serif;font-size:0.5rem;letter-spacing:2px;color:var(--green);margin-bottom:8px;display:flex;align-items:center;gap:6px;border-top:1px solid var(--border);padding-top:12px;">
    <span style="font-size:0.8rem;">☑</span> TASKS — ${taskList.length}
  </div>`;
  if (!taskList.length) {
    html += '<div style="color:var(--text-dim);font-size:0.6rem;padding:4px 0 12px;">No matches</div>';
  } else {
    const statusIcon = {todo:'📋','in-progress':'⚡',done:'✅',blocked:'🚫'};
    taskList.forEach(t => {
      html += `<div onclick="navigateToTask('${t.id}','${t.workspace_id}')" style="cursor:pointer;padding:8px 12px;margin-bottom:4px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--green)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:0.7rem;">${statusIcon[t.status]||'📋'}</span>
          <span style="font-size:0.6rem;color:var(--text);font-weight:600;">${t.seq ? `<span style="color:var(--cyan);font-family:'Orbitron',sans-serif;font-size:0.45rem;margin-right:4px;">T-${t.seq}</span>` : ''}${hl(t.title)}</span>
          <span style="font-size:0.45rem;color:var(--text-dim);margin-left:auto;">${escapeHtml(t.workspace_name)}</span>
        </div>
      </div>`;
    });
  }

  html += '</div>';
  overlay.innerHTML = html;
}

// Initial load — restore state from URL hash (or legacy query params)
(async function initMode() {
  // Load preferences first so provider visibility and theme are known
  await loadPreferences();
  _applyTheme(_prefs.theme);

  // Read state from hash (primary source for hard refresh)
  const hash = window.location.hash.slice(1);
  const hashParams = new URLSearchParams(hash);
  // Also support legacy query params (from older detail page back-nav)
  const urlParams = new URLSearchParams(window.location.search);

  // Hash takes priority, then query params, then localStorage defaults
  const navTab = hashParams.get('tab') || urlParams.get('tab');
  const navMode = hashParams.get('mode') || urlParams.get('mode');
  const navOpenWs = hashParams.get('ws') || urlParams.get('openWs');

  const ep = (_prefs && _prefs.enabled_providers) ? _prefs.enabled_providers : ['copilot','claude','codex','gemini','hermes'];
  if (navMode && ['copilot','claude','codex','gemini','hermes','workspaces','tasks'].includes(navMode)) {
    currentMode = ep.includes(navMode) ? navMode : (ep[0] || 'copilot');
    localStorage.setItem('wf-mode', currentMode);
  } else {
    // Ensure saved mode is still enabled
    if (!ep.includes(currentMode) && ['copilot','claude','codex','gemini','hermes'].includes(currentMode)) {
      currentMode = ep[0] || 'copilot';
      localStorage.setItem('wf-mode', currentMode);
    }
  }
  if (navTab && ['sessions','workspaces','tasks','abilities'].includes(navTab)) {
    currentTab = navTab;
  }
  // Convert legacy query params to hash and clean query string
  if (urlParams.toString()) {
    window.history.replaceState({}, '', '/');
  }

  _applyTabUI();
  _updateHash();

  if (currentTab === 'workspaces') {
    fetchWorkspaces().then(() => {
      if (navOpenWs) openWsDetail(navOpenWs);
    });
    return;
  }
  if (currentTab === 'tasks') {
    fetchTasks();
    return;
  }
  if (currentTab === 'abilities') {
    fetchAbilities();
    return;
  }

  // Sessions tab — set usage intelligence title
  const intTitles = { copilot: '🧠 COPILOT USAGE INTELLIGENCE', claude: '🧠 CLAUDE USAGE INTELLIGENCE', codex: '🧠 CODEX USAGE INTELLIGENCE', gemini: '🧠 GEMINI USAGE INTELLIGENCE', hermes: '🧠 HERMES USAGE INTELLIGENCE' };
  const titleEl = document.querySelector('#usage-panel .analytics-toggle-title');
  if (titleEl) titleEl.textContent = intTitles[currentMode] || intTitles.copilot;
  try {
    const cached = sessionStorage.getItem('wf-sessions-' + currentMode);
    if (cached) {
      const parsed = JSON.parse(cached);
      allSessions = parsed.sessions || [];
      hasMore = parsed.has_more || false;
      totalCount = parsed.total || allSessions.length;
      renderSessions(allSessions);
      renderPinnedRail(allSessions);
      renderAnalytics(allSessions);
      const countId = currentMode === 'claude' ? 'mode-claude-count' : currentMode === 'codex' ? 'mode-codex-count' : currentMode === 'gemini' ? 'mode-gemini-count' : currentMode === 'hermes' ? 'mode-hermes-count' : 'mode-copilot-count';
      const countEl = document.getElementById(countId);
      if (countEl) countEl.textContent = totalCount || allSessions.length;
      updateLoadMoreButton();
    }
  } catch(e) {}
})();
if (currentTab === 'sessions') {
  fetchSessions();
}
setInterval(() => { if (currentTab === 'sessions') fetchSessions(); }, 30000);

// --- MCP Servers ---
async function fetchMcp() {
  const mcpPanel = document.getElementById('mcp-bar');
  const content = document.getElementById('mcp-bar-content');

  if (currentMode === 'claude' || currentMode === 'gemini' || currentMode === 'hermes') {
    // Show MCP servers from provider usage data
    if (mcpPanel) mcpPanel.style.display = '';
    try {
      const res = await fetch(getUsageEndpoint());
      const data = await res.json();
      const tools = data.tools || [];
      // Extract MCP servers from tool names:
      //   Claude/Gemini style: "mcp:serverName/toolName"
      //   Hermes style: "mcp_serverName_toolName" (underscores, server has 2 parts like savant_workspace)
      const serverMap = {};
      for (const t of tools) {
        const name = t.name || '';
        const calls = t.calls || t.count || 0;
        // Try Claude/Gemini format first: mcp:server/tool
        let m = name.match(/^mcp:([^/]+)\/(.+)$/);
        if (m) {
          const srv = m[1], tool = m[2];
          if (!serverMap[srv]) serverMap[srv] = { name: srv, tools: [], totalCalls: 0 };
          serverMap[srv].tools.push({ name: tool, calls });
          serverMap[srv].totalCalls += calls;
          continue;
        }
        // Try Hermes format: mcp_server_subserver_toolName (e.g. mcp_savant_workspace_list_tasks)
        m = name.match(/^mcp_([^_]+_[^_]+)_(.+)$/);
        if (m) {
          const srv = m[1].replace(/_/g, '-'), tool = m[2].replace(/_/g, '-');
          if (!serverMap[srv]) serverMap[srv] = { name: srv, tools: [], totalCalls: 0 };
          serverMap[srv].tools.push({ name: tool, calls });
          serverMap[srv].totalCalls += calls;
        }
      }
      const servers = Object.values(serverMap).sort((a,b) => b.totalCalls - a.totalCalls);
      if (servers.length === 0) {
        content.innerHTML = `<div style="font-size:0.7rem; color:var(--text-dim); padding: 0 16px 16px;">No MCP servers detected</div>`;
        return;
      }
      let html = '';
      for (const s of servers) {
        const toolsHtml = s.tools.sort((a,b) => b.calls - a.calls)
          .map(t => `<span class="tool-tag" style="margin:2px 0">${escapeHtml(t.name)} <span style="color:var(--text-dim)">×${t.calls}</span></span>`).join('');
        html += `
          <div class="mcp-server">
            <div class="mcp-server-header">
              <span class="mcp-dot"></span>
              <span class="mcp-name">${escapeHtml(s.name)}</span>
              <span class="mcp-type">${s.totalCalls} calls</span>
            </div>
            <div class="mcp-tools-section">
              <div class="mcp-tools-title">TOOLS (${s.tools.length})</div>
              <div class="mcp-tools-grid" style="max-height:72px;overflow-y:auto;">${toolsHtml}</div>
            </div>
          </div>`;
      }
      content.innerHTML = html;
    } catch (e) {
      console.error('MCP fetch error:', e);
    }
    return;
  }

  if (mcpPanel) mcpPanel.style.display = '';
  try {
    const res = await fetch('/api/mcp');
    const data = await res.json();
    const content = document.getElementById('mcp-bar-content');
    const servers = data.servers || [];
    if (servers.length === 0) {
      content.innerHTML = `<div style="font-size:0.7rem; color:var(--text-dim); padding: 0 16px 16px;">No MCP servers configured</div>`;
      return;
    }
    let html = '';
    for (const s of servers) {
      const argsStr = (s.args || []).length ? s.args.join(' ') : '';
      const tools = s.tools || [];
      const toolCount = tools.length;
      const toolsHtml = tools.length
        ? tools.map(t => `<span class="tool-tag" style="margin:2px 0">${escapeHtml(t)}</span>`).join('')
        : (tools.length === 0 ? '<span style="color:var(--text-dim);font-size:0.55rem;">No tools discovered yet</span>' : '');

      html += `
        <div class="mcp-server">
          <div class="mcp-server-header">
            <span class="mcp-dot"></span>
            <span class="mcp-name">${escapeHtml(s.name)}</span>
            <span class="mcp-type">${escapeHtml(s.type)}</span>
          </div>
          <div class="mcp-info-row">
            <span class="meta-label">COMMAND</span>
            <span class="meta-value">${escapeHtml(s.command)}${argsStr ? ' ' + escapeHtml(argsStr) : ''}</span>
          </div>
          <div class="mcp-tools-section">
            <div class="mcp-tools-title">TOOLS (${toolCount})</div>
            <div class="mcp-tools-grid" style="max-height:72px;overflow-y:auto;">${toolsHtml}</div>
          </div>
        </div>`;
    }
    content.innerHTML = html;
  } catch (e) {
    console.error('MCP fetch error:', e);
  }
}
if (currentTab === 'sessions') fetchMcp();

// --- Card expand + lazy load files ---
function navigateToSession(event, sessionId, provider) {
  if (event.target.closest('.copy-btn, .delete-btn, .star-btn, .rename-btn, .rename-input, .export-btn, .bulk-check, .card-info-icon')) return;
  // Build a return-to descriptor for the current page state
  _pushNavState();
  let url;
    if (provider && provider !== 'copilot') {
    if (provider === 'claude') url = `/claude/session/${sessionId}`;
    else if (provider === 'codex') url = `/codex/session/${sessionId}`;
    else if (provider === 'gemini') url = `/gemini/session/${sessionId}`;
    else if (provider === 'hermes') url = `/hermes/session/${sessionId}`;
    else url = getDetailPageUrl(sessionId);
  } else {
    url = getDetailPageUrl(sessionId);
  }
  showLoadingThenNavigate(url);
}

async function loadSessionFiles(sessionId) {
  const container = document.getElementById(`files-${sessionId}`);
  if (!container || container.dataset.loaded) return;
  container.dataset.loaded = '1';

  try {
    const res = await fetch(getSessionDetailEndpoint(sessionId));
    const data = await res.json();
    const tree = data.tree || {};
    let html = '';

    const renderSection = (title, icon, items) => {
      if (!items || !items.length) return '';
      let h = `<div class="file-section-title">${icon} ${title} <span class="count">(${items.length})</span></div><div class="file-list">`;
      for (const f of items) {
        const sizeStr = f.size < 1024 ? f.size + 'B' : (f.size / 1024).toFixed(1) + 'KB';
        h += `<div class="file-item" onclick="event.stopPropagation(); openFile('${sessionId}', '${escapeHtml(f.path)}', '${escapeHtml(f.name)}')">
          <span class="file-icon">${icon}</span>
          <span class="file-name">${escapeHtml(f.name)}</span>
          <span class="file-size">${sizeStr}</span>
        </div>`;
      }
      h += '</div>';
      return h;
    };

    if (tree.plan) {
      html += renderSection('PLAN', '📋', [tree.plan]);
    }

    // Checkpoints with resume button
    const cps = tree.checkpoints || [];
    if (cps.length) {
      html += `<div class="file-section-title">📍 CHECKPOINTS <span class="count">(${cps.length})</span></div><div class="file-list">`;
      for (const f of cps) {
        const sizeStr = f.size < 1024 ? f.size + 'B' : (f.size / 1024).toFixed(1) + 'KB';
        html += `<div class="file-item" onclick="event.stopPropagation(); openFile('${sessionId}', '${escapeHtml(f.path)}', '${escapeHtml(f.name)}')">
          <span class="file-icon">📍</span>
          <span class="file-name">${escapeHtml(f.name)}</span>
          <span class="file-size">${sizeStr}</span>
        </div>`;
      }
      html += '</div>';
    }

    // Rewind snapshots
    const snaps = tree.rewind_snapshots || [];
    if (snaps.length) {
      const cwd = data.cwd || '~';
      const resumeCmd = `cd ${cwd} && copilot --allow-all-tools --resume ${sessionId}`;
      html += `<div class="file-section-title">⚠️ REWIND SNAPSHOTS <span class="count">(${snaps.length})</span></div><div class="file-list" style="max-height:${3 * 42}px;overflow-y:auto;">`;
      for (const snap of snaps) {
        const time = formatTime(snap.timestamp);
        const msg = snap.message || 'No message';
        html += `<div class="file-item" style="flex-wrap:wrap;gap:4px;">
          <span class="file-icon">⏪</span>
          <span class="file-name" style="flex:1;min-width:150px;" title="${escapeHtml(msg)}">${escapeHtml(msg.length > 60 ? msg.slice(0,60)+'...' : msg)}</span>
          <span class="file-size">${time} · ${snap.file_count} files</span>
          <button class="copy-btn" style="font-size:0.5rem;padding:1px 5px;border-color:var(--red);color:var(--red);margin-left:4px;" onclick="event.stopPropagation(); copyText('${escapeHtml(resumeCmd)}', this)" title="Resume session, then type /rewind to restore">⚠️ RESUME</button>
        </div>`;
      }
      html += '</div>';
    }

    html += renderSection('FILES', '📄', tree.files);
    html += renderSection('RESEARCH', '🔬', tree.research);

    container.innerHTML = html || '<div style="font-size:0.7rem; color:var(--text-dim); padding:4px 0;">No files in this session</div>';
  } catch (e) {
    container.innerHTML = '<div style="font-size:0.7rem; color:var(--red);">Failed to load files</div>';
  }
}

// --- File viewer modal ---
let _currentFileRawUrl = '';
let _currentFileHostPath = '';
let _currentFilePath = '';
let _currentFileSessionId = '';
let _currentFileName = '';
let _currentFileRaw = '';
let _currentFileEndpoint = '';
let _isEditing = false;

async function openFile(sessionId, path, name) {
  const modal = document.getElementById('file-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');
  const contentMd = document.getElementById('modal-content-md');
  const openBtn = document.getElementById('open-browser-btn');
  const revealBtn = document.getElementById('reveal-path-btn');
  const editBtn = document.getElementById('edit-file-btn');
  const editor = document.getElementById('modal-editor');
  const editorBar = document.getElementById('modal-editor-bar');
  title.textContent = name;
  content.textContent = 'Loading...';
  content.style.display = '';
  contentMd.style.display = 'none';
  contentMd.innerHTML = '';
  editor.style.display = 'none';
  editorBar.style.display = 'none';
  _currentFileRawUrl = `${getFileEndpoint(sessionId)}/raw?path=${encodeURIComponent(path)}`;
  _currentFileHostPath = '';
  _currentFilePath = path;
  _currentFileSessionId = sessionId;
  _currentFileName = name;
  _currentFileRaw = '';
  _currentFileEndpoint = getFileEndpoint(sessionId);
  _isEditing = false;
  openBtn.style.display = 'none';
  revealBtn.style.display = 'none';
  editBtn.style.display = 'none';
  modal.classList.add('active');

  const isMd = /\.(md|markdown)$/i.test(name);
  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name) || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(path);
  const isHtml = /\.(html?|htm)$/i.test(name);

  // Render images directly from the raw endpoint
  if (isImage) {
    content.style.display = 'none';
    contentMd.style.display = '';
    contentMd.innerHTML = `<div style="text-align:center;padding:20px;">
      <img src="${_currentFileRawUrl}" alt="${escapeHtml(name)}" style="max-width:100%;max-height:75vh;border-radius:8px;border:1px solid var(--border);box-shadow:0 0 20px rgba(0,0,0,0.3);" />
    </div>`;
    openBtn.style.display = '';
    // Still fetch metadata for host_path
    try {
      const res = await fetch(`${getFileEndpoint(sessionId)}?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.host_path) { _currentFileHostPath = data.host_path; revealBtn.style.display = ''; }
    } catch(e) {}
    return;
  }

  try {
    const res = await fetch(`${getFileEndpoint(sessionId)}?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (data.error) {
      content.textContent = `Error: ${data.error}`;
    } else {
      _currentFileRaw = data.content;
      openBtn.style.display = '';
      if (!data.truncated && !isImage && !isHtml) editBtn.style.display = '';
      if (data.host_path) {
        _currentFileHostPath = data.host_path;
        revealBtn.style.display = '';
      }
      if (isMd && typeof marked !== 'undefined') {
        content.style.display = 'none';
        contentMd.style.display = '';
        contentMd.innerHTML = marked.parse(data.content);
        contentMd.dataset.raw = data.content;
        if (data.truncated) {
          contentMd.innerHTML += '<hr><p style="color:var(--red);">--- FILE TRUNCATED (500KB limit) ---</p>';
        }
      } else {
        content.textContent = data.content;
        if (data.truncated) {
          content.textContent += '\n\n--- FILE TRUNCATED (500KB limit) ---';
        }
      }
    }
  } catch (e) {
    content.textContent = 'Failed to load file.';
  }
}

function openFileInBrowser() {
  // Use Electron shell.openPath for local files, fallback to window.open for API URLs
  if (_currentFileHostPath && window.electronAPI && window.electronAPI.openPath) {
    window.electronAPI.openPath(_currentFileHostPath);
  } else if (_currentFileHostPath) {
    window.open('file://' + _currentFileHostPath, '_blank');
  } else if (_currentFileRawUrl) {
    window.open(_currentFileRawUrl, '_blank');
  }
}

function copyFilePath() {
  if (!_currentFileHostPath) return;
  navigator.clipboard.writeText(_currentFileHostPath).then(() => {
    const btn = document.getElementById('reveal-path-btn');
    btn.textContent = '✅ COPIED';
    setTimeout(() => { btn.textContent = '📂 PATH'; }, 1500);
  });
}

function closeModal() {
  _isEditing = false;
  document.getElementById('file-modal').classList.remove('active');
}

function toggleEditMode() {
  if (_isEditing) { cancelEdit(); return; }
  _isEditing = true;
  const content = document.getElementById('modal-content');
  const contentMd = document.getElementById('modal-content-md');
  const editor = document.getElementById('modal-editor');
  const editorBar = document.getElementById('modal-editor-bar');
  const editBtn = document.getElementById('edit-file-btn');
  const statusEl = document.getElementById('modal-editor-status');
  content.style.display = 'none';
  contentMd.style.display = 'none';
  editor.value = _currentFileRaw;
  editor.style.display = '';
  editorBar.style.display = 'flex';
  editBtn.textContent = '👁 VIEW';
  statusEl.textContent = '';
  editor.focus();
}

function cancelEdit() {
  _isEditing = false;
  const editor = document.getElementById('modal-editor');
  const editorBar = document.getElementById('modal-editor-bar');
  const editBtn = document.getElementById('edit-file-btn');
  editor.style.display = 'none';
  editorBar.style.display = 'none';
  editBtn.textContent = '✏️ EDIT';
  openFile(_currentFileSessionId, _currentFilePath, _currentFileName);
}

async function saveFile() {
  const editor = document.getElementById('modal-editor');
  const statusEl = document.getElementById('modal-editor-status');
  const content = editor.value;
  statusEl.textContent = 'Saving...';
  statusEl.style.color = 'var(--text-dim)';
  try {
    const res = await fetch(_currentFileEndpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: _currentFilePath, content }),
    });
    const data = await res.json();
    if (data.ok) {
      _currentFileRaw = content;
      statusEl.textContent = '✅ Saved';
      statusEl.style.color = '#22c55e';
      setTimeout(() => { cancelEdit(); }, 600);
    } else {
      statusEl.textContent = `❌ ${data.error || 'Save failed'}`;
      statusEl.style.color = '#ff3355';
    }
  } catch (e) {
    statusEl.textContent = `❌ ${e.message}`;
    statusEl.style.color = '#ff3355';
  }
}

function copyFileContent() {
  const mdEl = document.getElementById('modal-content-md');
  const content = mdEl.style.display !== 'none' ? (mdEl.dataset.raw || mdEl.textContent) : document.getElementById('modal-content').textContent;
  navigator.clipboard.writeText(content).then(() => {
    const btn = document.getElementById('copy-file-btn');
    btn.textContent = '✅ COPIED';
    setTimeout(() => { btn.textContent = '📋 COPY'; }, 1500);
  });
}

/**
 * Unified file viewer — opens any context file (code or memory bank) in the file-modal.
 * @param {string} uri   - context URI like "repo:path/to/file.py"
 * @param {string} type  - "code" or "memory"
 */
async function openContextFile(uri, type) {
  const modal = document.getElementById('file-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');
  const contentMd = document.getElementById('modal-content-md');
  const openBtn = document.getElementById('open-browser-btn');
  const revealBtn = document.getElementById('reveal-path-btn');

  const unhashedUri = uri.split('#')[0];
  const hash = uri.includes('#') ? uri.substring(uri.indexOf('#') + 1) : '';
  const fileName = unhashedUri.includes(':') ? unhashedUri.split(':').slice(1).join(':') : unhashedUri;
  const repoName = unhashedUri.includes(':') ? unhashedUri.split(':')[0] : '';
  
  title.textContent = fileName;
  content.textContent = 'Loading...';
  content.style.display = '';
  contentMd.style.display = 'none';
  contentMd.innerHTML = '';
  _currentFileRawUrl = '';
  _currentFileHostPath = '';
  openBtn.style.display = 'none';
  revealBtn.style.display = 'none';
  modal.classList.add('active');

  const endpoint = type === 'memory' ? '/api/context/memory/read' : '/api/context/code/read';
  try {
    const res = await fetch(endpoint + '?uri=' + encodeURIComponent(unhashedUri));
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const raw = data.content || '(empty)';
    const isMd = /\.(md|mdx|markdown)$/i.test(fileName);

    // Enable Open (raw endpoint) and Path (resolve from project)
    _currentFileRawUrl = endpoint + '?uri=' + encodeURIComponent(unhashedUri);
    openBtn.style.display = '';

    // Resolve host path from project data
    const proj = _ctxProjects.find(p => p.name === repoName);
    if (proj && proj.path) {
      _currentFileHostPath = proj.path + '/' + fileName;
      revealBtn.style.display = '';
    }

    if (isMd && typeof marked !== 'undefined') {
      content.style.display = 'none';
      contentMd.style.display = '';
      contentMd.innerHTML = marked.parse(raw);
      contentMd.dataset.raw = raw;
    } else {
      const lines = raw.split('\n');
      content.style.display = 'none';
      contentMd.style.display = '';
      contentMd.dataset.raw = raw;
      contentMd.innerHTML = `<div class="ctx-code-view">${lines.map((ln, i) =>
        `<div class="ctx-code-line" id="line-${i + 1}"><span class="ctx-code-num">${i + 1}</span><span class="ctx-code-text">${_escHtml(ln)}</span></div>`
      ).join('')}</div>`;

      // Scroll to line if provided in hash
      if (hash && hash.startsWith('L')) {
        const lineNum = hash.substring(1);
        setTimeout(() => {
          const target = contentMd.querySelector('#line-' + lineNum);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.style.background = 'rgba(234, 179, 8, 0.2)'; // highlight color
            setTimeout(() => target.style.transition = 'background 1s ease', 100);
            setTimeout(() => target.style.background = '', 2000);
          }
        }, 100);
      }
    }
  } catch (e) {
    content.textContent = 'Failed to load file: ' + e.message;
  }
}

document.getElementById('file-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Close any visible modal — check all overlays
    const modals = [
      { id: 'notif-modal', close: () => closeNotifications() },
      { id: 'release-modal', close: () => toggleReleaseNotes() },
      { id: 'tutorial-modal', close: () => toggleTutorial() },
      { id: 'all-mrs-modal', close: () => closeAllMrsModal() },
      { id: 'ws-modal', close: () => closeWsModal() },
      { id: 'ctx-modal', close: () => document.getElementById('ctx-modal').style.display = 'none' },
      { id: 'prefs-modal', close: () => closePreferences() },
      { id: 'task-modal', close: () => closeTaskModal() },
      { id: 'ab-new-modal', close: () => closeAbNewModal() },
      { id: 'file-modal', close: () => closeModal() },
      { id: 'confirm-modal', close: () => closeConfirm() },
    ];
    for (const m of modals) {
      const el = document.getElementById(m.id);
      if (el && (el.style.display === 'flex' || el.classList.contains('active'))) {
        m.close();
        e.preventDefault();
        return;
      }
    }
  }
});

// --- Copy resume command ---
function resumeInTerminal(command, cwd) {
  if (!command) return;
  switchView('terminal');
  if (window.terminalAPI && window.terminalAPI.runInNewTab) {
    window.terminalAPI.runInNewTab(cwd || '', command);
  }
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ COPIED';
    btn.style.color = 'var(--green)';
    btn.style.borderColor = 'var(--green)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 1500);
  });
}

function copySessionInfo(sessionId, btn) {
  const s = allSessions.find(x => x.id === sessionId);
  if (!s) return;
  const info = [
    `UUID: ${s.id}`,
    `Project: ${s.project || '—'}`,
    `Model: ${(s.models||[]).join(', ')||'unknown'}`,
    `Repo: ${s.git_root||s.cwd||'—'}`,
    `Branch: ${s.branch||'—'}`,
    `Status: ${s.status}`,
    `Duration: ${formatDuration(s.first_event_time, s.last_event_time)||'—'}`,
    `Events: ${s.event_count||0}`,
    `Messages: ${s.message_count||0} · Turns: ${s.turn_count||0}`,
    `Disk: ${formatSize(s.disk_size||0)}`,
    `Resume: ${s.resume_command||'—'}`
  ].join('\n');
  copyText(info, btn);
}

// --- Star session ---
async function toggleStar(sessionId, btn) {
  try {
    const prov = _resolveProvider(sessionId);
    const res = await fetch(_endpointFor(prov, sessionId, 'star'), { method: 'POST' });
    const data = await res.json();
    btn.textContent = data.starred ? '★' : '☆';
    btn.classList.toggle('starred', data.starred);
    // Update local data
    const s = allSessions.find(s => s.id === sessionId);
    if (s) s.starred = data.starred;
    if (_currentWsId) {
      const ws = _wsDetailSessions.find(s => s.id === sessionId);
      if (ws) ws.starred = data.starred;
    }
  } catch (e) {
    console.error('Star failed:', e);
  }
}

async function toggleArchive(sessionId, btn) {
  try {
    const prov = _resolveProvider(sessionId);
    const res = await fetch(_endpointFor(prov, sessionId, 'archive'), { method: 'POST' });
    const data = await res.json();
    // Update local data
    const s = allSessions.find(s => s.id === sessionId);
    if (s) s.archived = data.archived;
    if (_currentWsId) {
      // Refresh workspace detail in-place
      const ws = _wsDetailSessions.find(s => s.id === sessionId);
      if (ws) ws.archived = data.archived;
      await _refreshWsDetailSessions();
    } else if (data.archived && currentFilter !== 'archived') {
      // Re-render to hide the archived session
      renderSessions(allSessions);
    } else {
      btn.textContent = data.archived ? '📦' : '📥';
      btn.classList.toggle('archived', data.archived);
      btn.title = data.archived ? 'Unarchive session' : 'Archive session';
    }
  } catch (e) {
    console.error('Archive failed:', e);
  }
}

// --- Rename session ---
function renameSession(sessionId, btn) {
  const summaryDiv = btn.closest('.session-summary');
  const textSpan = summaryDiv.querySelector('.summary-text');
  const current = textSpan.textContent === 'No summary' ? '' : textSpan.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = current;
  input.placeholder = 'Enter nickname...';
  textSpan.replaceWith(input);
  btn.style.display = 'none';
  input.focus();
  input.select();

  const prov = _resolveProvider(sessionId);
  async function save() {
    const nickname = input.value.trim();
    try {
      await fetch(_endpointFor(prov, sessionId, 'rename'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname })
      });
    } catch (e) { console.error('Rename failed:', e); }
    const span = document.createElement('span');
    span.className = 'summary-text';
    span.textContent = nickname || current || 'No summary';
    input.replaceWith(span);
    btn.style.display = '';
    // Update local data
    const s = allSessions.find(s => s.id === sessionId);
    if (s) s.nickname = nickname;
    if (_currentWsId) {
      const ws = _wsDetailSessions.find(s => s.id === sessionId);
      if (ws) ws.nickname = nickname;
    }
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') { input.replaceWith(textSpan); btn.style.display = ''; }
  });
  input.addEventListener('blur', save);
}

// --- Delete session ---
let pendingDeleteId = null;

function confirmDelete(sessionId, label) {
  pendingDeleteId = sessionId;
  document.getElementById('confirm-text').textContent = `Delete session "${label}"? This cannot be undone.`;
  document.getElementById('confirm-modal').classList.add('active');
}

function closeConfirm() {
  document.getElementById('confirm-modal').classList.remove('active');
  pendingDeleteId = null;
}

document.getElementById('confirm-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeConfirm();
});

document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  const prov = _resolveProvider(id);
  closeConfirm();
  try {
    const res = await fetch(_deleteEndpointFor(prov, id), { method: 'DELETE' });
    const data = await res.json();
    if (data.error) {
      alert(`Cannot delete: ${data.error}`);
    } else {
      allSessions = allSessions.filter(s => s.id !== id);
      if (_currentWsId) {
        _wsDetailSessions = _wsDetailSessions.filter(s => s.id !== id);
        await _refreshWsDetailSessions();
      } else {
        renderSessions(allSessions);
      }
    }
  } catch (e) {
    alert('Failed to delete session.');
  }
});
