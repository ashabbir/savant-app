// ── Context Core ─────────────────────────────────────────────────────────────
// State, init, status, panel routing, project list, search, memory, code.
// Depends on: globals.js (_ctxProjects, showToast, _mcpTestConnection, etc.)

let _ctxInited = false;
let _ctxPollingTimer = null;
let _ctxLastIndexStatus = {};
let _ctxSelectedProject = null;
let _ctxProjectsPanelCollapsed = false;
let _ctxProjectExplorerState = {};
let _ctxProjectExplorerRegistry = {};
let _ctxMemorySelectedProject = null;
let _ctxMemoryProjects = [];
let _ctxMemoryItems = [];
let _ctxCodeSelectedProject = null;
let _ctxCodeProjects = [];
let _ctxCodeItems = [];
// _ctxProjects is declared in globals.js

// ── MCP connection ────────────────────────────────────────────────────────────

async function ctxMcpTestConnection() {
  return _mcpTestConnection('context', 8093, 'ctx-mcp-dot', 'ctx-mcp-status-text');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function ctxInit() {
  if (!_ctxInited) {
    _ctxInited = true;
    ctxMcpTestConnection();
    await ctxRefreshStatus();
  }
  await ctxLoadProjects();
  if (_ctxPollingTimer && Object.keys(_ctxLastIndexStatus).length) {
    ctxRenderProjectsWithProgress(_ctxLastIndexStatus);
  }
  if (_ctxProjects.some(p => p.status === 'indexing') && !_ctxPollingTimer) {
    ctxStartPolling();
  }
}

// ── Status bar ────────────────────────────────────────────────────────────────

async function ctxRefreshStatus() {
  try {
    const [healthRes, statsRes] = await Promise.all([
      fetch('/api/context/health'),
      fetch('/api/context/stats').catch(() => ({ ok: false }))
    ]);
    if (healthRes.ok) {
      const h = await healthRes.json();
      const vecDot   = document.getElementById('ctx-dot-vec');
      const modelDot = document.getElementById('ctx-dot-model');
      const vecOk           = h.sqlite_vec && h.sqlite_vec.loaded;
      const modelDownloaded = h.model && h.model.downloaded;
      const modelLoaded     = h.model && h.model.loaded;
      vecDot.className   = 'ctx-dot ' + (vecOk ? 'ok' : 'off');
      document.getElementById('ctx-vec-ver').textContent       = vecOk ? (h.sqlite_vec.version || '✓') : '✗';
      modelDot.className = 'ctx-dot ' + (modelLoaded ? 'ok' : modelDownloaded ? 'warn' : 'off');
      document.getElementById('ctx-model-status').textContent  = modelLoaded ? 'Loaded' : modelDownloaded ? 'Ready' : 'Not found';
      if (h.counts) {
        document.getElementById('ctx-stat-repos').textContent  = h.counts.repos  || 0;
        document.getElementById('ctx-stat-files').textContent  = h.counts.files  || 0;
        document.getElementById('ctx-stat-chunks').textContent = h.counts.chunks || 0;
      }
    }
    if (statsRes.ok) {
      const s = await statsRes.json();
      if (s.counts) {
        document.getElementById('ctx-stat-repos').textContent  = s.counts.repos  || 0;
        document.getElementById('ctx-stat-files').textContent  = s.counts.files  || 0;
        document.getElementById('ctx-stat-chunks').textContent = s.counts.chunks || 0;
      }
    }
  } catch (e) { /* status bar just stays default */ }
}

// ── Panel routing ─────────────────────────────────────────────────────────────

function switchCtxPanel(panel, btnElement) {
  const tabs = document.querySelectorAll('.ctx-inner-tabs .savant-subtab');
  tabs.forEach(b => {
    b.classList.remove('active');
    if (btnElement && b === btnElement) {
      b.classList.add('active');
    } else if (!btnElement && b.getAttribute('data-panel') === panel) {
      b.classList.add('active');
    }
  });

  ['search', 'projects', 'memory', 'code', 'ast'].forEach(p => {
    const el = document.getElementById('ctx-panel-' + p);
    if (el) el.style.display = p === panel ? 'block' : 'none';
  });

  if (panel === 'projects') ctxLoadProjects();
  if (panel === 'memory')   ctxLoadMemory();
  if (panel === 'code')     ctxLoadCode();
  if (panel === 'ast')      ctxLoadAst();
  if (panel === 'search')   ctxPopulateRepoFilter();
}

// ── Repo filter ───────────────────────────────────────────────────────────────

function ctxPopulateRepoFilter() {
  const sel = document.getElementById('ctx-search-repo');
  if (!sel) return;
  const val = sel.value;
  sel.innerHTML = '<option value="">All Projects</option>' +
    _ctxProjects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  sel.value = val;
}

// ── Project list ──────────────────────────────────────────────────────────────

async function ctxLoadProjects() {
  try {
    const res = await fetch('/api/context/repos');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    _ctxProjects = data.repos || data || [];
    ctxRenderProjects();
    ctxPopulateRepoFilter();
    ctxRefreshStatus();
  } catch (e) {
    showToast('error', 'Failed to load projects: ' + e.message);
  }
}

function ctxRenderProjects() { ctxRenderProjectsWithProgress({}); }

function ctxRenderProjectsWithProgress(indexStatus) {
  if (!_ctxProjects.length) {
    ctxRenderProjectExplorer('ctx-projects-list', _ctxProjects, _ctxSelectedProject, 'ctxSelectProject', { indexStatus });
    ctxApplyProjectsPanelState();
    return;
  }
  if (!_ctxSelectedProject) _ctxSelectedProject = _ctxProjects[0].name;
  if (!ctxRenderProjectExplorer('ctx-projects-list', _ctxProjects, _ctxSelectedProject, 'ctxSelectProject', { indexStatus })) return;
  ctxApplyProjectsPanelState();
  _ctxRenderDetail(indexStatus);
}

function ctxSelectProject(name) { _ctxSelectedProject = name; ctxRenderProjects(); }

function ctxToggleProjectsPanel() {
  ctxToggleProjectExplorer('ctx-projects-list');
}

function ctxApplyProjectsPanelState() {
  _ctxProjectExplorerState['ctx-projects-list'] = _ctxProjectExplorerState['ctx-projects-list'] || {};
  if (typeof _ctxProjectExplorerState['ctx-projects-list'].collapsed === 'boolean') {
    _ctxProjectsPanelCollapsed = _ctxProjectExplorerState['ctx-projects-list'].collapsed;
  } else {
    _ctxProjectExplorerState['ctx-projects-list'].collapsed = !!_ctxProjectsPanelCollapsed;
  }
  ctxSyncProjectExplorerLayout('ctx-projects-list');
}

function ctxRenderProjectSidebar(containerId, projects, selectedName, onSelectFn, options = {}) {
  return ctxRenderProjectExplorer(containerId, projects, selectedName, onSelectFn, options);
}

function ctxRenderProjectExplorer(containerId, projects, selectedName, onSelectFn, options = {}) {
  const sidebar = document.getElementById(containerId);
  if (!sidebar) return false;
  const state = _ctxProjectExplorerState[containerId] || { query: '', collapsed: false };
  _ctxProjectExplorerState[containerId] = state;
  _ctxProjectExplorerRegistry[containerId] = { projects, selectedName, onSelectFn, options };
  const query = (state.query || '').trim().toLowerCase();
  const filtered = query
    ? projects.filter(p => ((p.name || '') + ' ' + (p.path || '')).toLowerCase().includes(query))
    : projects;
  const headTitle = options.title || 'Project Explorer';
  const searchPlaceholder = options.searchPlaceholder || 'Search projects...';
  const bodyHtml = !filtered.length
    ? `<div class="ctx-welcome" style="padding:20px 10px;font-size:0.58rem;">${query ? 'No projects match search' : 'No projects yet'}</div>`
    : filtered.map(p => _ctxRenderProjectExplorerRow(p, selectedName, onSelectFn, options.indexStatus || {})).join('');

  sidebar.innerHTML = `
    <div class="ctx-project-explorer${state.collapsed ? ' collapsed' : ''}">
      <div class="ctx-project-explorer-head">
        <div class="ctx-project-explorer-title">${_escHtml(headTitle)}</div>
        <button class="ctx-project-explorer-toggle" onclick="ctxToggleProjectExplorer('${_ctxJsString(containerId)}')" title="${state.collapsed ? 'Expand project explorer' : 'Collapse project explorer'}">${state.collapsed ? '›' : '‹'}</button>
      </div>
      ${state.collapsed ? '' : `
        <div class="ctx-project-explorer-search">
          <input type="text" value="${_escHtml(state.query || '')}" placeholder="${_escHtml(searchPlaceholder)}" oninput="ctxProjectExplorerSearch('${_ctxJsString(containerId)}', this.value)">
        </div>
        <div class="ctx-project-explorer-list">${bodyHtml}</div>
      `}
    </div>`;
  ctxSyncProjectExplorerLayout(containerId);
  return filtered.length > 0;
}

function _ctxRenderProjectExplorerRow(project, selectedName, onSelectFn, indexStatus = {}) {
  const isActive = project.name === selectedName;
  const st = _ctxProjectHealth(project, indexStatus);
  return `<div class="ctx-proj-row ctx-proj-row-${st.tone}${isActive ? ' active' : ''}" onclick="${onSelectFn}('${_ctxJsString(project.name)}')">
    <span class="ctx-proj-status-line ${st.tone}"></span>
    <div class="ctx-proj-row-main">
      <div class="ctx-proj-row-name">${_escHtml(project.name)}</div>
      <div class="ctx-proj-row-meta">
        <span class="ctx-mini-flag ${st.indexed ? 'on' : 'off'}" title="Indexed">I</span>
        <span class="ctx-mini-flag ${st.ast ? 'on' : 'off'}" title="AST Generated">A</span>
        <span>${_escHtml(st.label)}</span>
      </div>
    </div>
  </div>`;
}

function _ctxProjectHealth(project, indexStatus = {}) {
  const liveStatus = ((indexStatus[project.name] || {}).status || project.status || '').toString().toLowerCase();
  const indexed = !!(project.chunk_count > 0 || project.indexed_at);
  const ast = !!(project.ast_node_count > 0);
  const failStates = new Set(['error', 'failed', 'off', 'stalled']);
  const busyStates = new Set(['indexing', 'generating', 'ast_generating', 'ast_generation', 'queued', 'running', 'processing']);
  if (failStates.has(liveStatus)) return { tone: 'red', indexed, ast, label: 'Failed' };
  if (busyStates.has(liveStatus)) return { tone: 'orange', indexed, ast, label: 'In Progress' };
  if (indexed && ast) return { tone: 'green', indexed: true, ast: true, label: 'Ready' };
  return { tone: 'orange', indexed, ast, label: indexed ? 'Partial' : 'Pending' };
}

function ctxProjectExplorerSearch(containerId, value) {
  _ctxProjectExplorerState[containerId] = _ctxProjectExplorerState[containerId] || { query: '', collapsed: false };
  _ctxProjectExplorerState[containerId].query = value || '';
  const reg = _ctxProjectExplorerRegistry[containerId];
  if (!reg) return;
  ctxRenderProjectExplorer(containerId, reg.projects, reg.selectedName, reg.onSelectFn, reg.options);
}

function ctxToggleProjectExplorer(containerId) {
  _ctxProjectExplorerState[containerId] = _ctxProjectExplorerState[containerId] || { query: '', collapsed: false };
  _ctxProjectExplorerState[containerId].collapsed = !_ctxProjectExplorerState[containerId].collapsed;
  if (containerId === 'ctx-projects-list') _ctxProjectsPanelCollapsed = _ctxProjectExplorerState[containerId].collapsed;
  const reg = _ctxProjectExplorerRegistry[containerId];
  if (reg) ctxRenderProjectExplorer(containerId, reg.projects, reg.selectedName, reg.onSelectFn, reg.options);
}

function ctxSyncProjectExplorerLayout(containerId) {
  const sidebar = document.getElementById(containerId);
  if (!sidebar) return;
  if (!sidebar.style) sidebar.style = {};
  const state = _ctxProjectExplorerState[containerId] || {};
  sidebar.style.transition = 'width 0.18s ease,min-width 0.18s ease';
  sidebar.style.overflow = 'hidden';
  if (state.collapsed) {
    sidebar.style.width = '34px';
    sidebar.style.minWidth = '34px';
  } else {
    sidebar.style.width = '240px';
    sidebar.style.minWidth = '200px';
  }
  sidebar.style.borderRight = '1px solid var(--border)';
}

function _ctxJsString(value) {
  return (value || '').toString()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/</g, '\\x3c');
}

function _ctxRenderDetail(indexStatus) {
  const detail = document.getElementById('ctx-proj-detail');
  if (!detail) return;
  const p = _ctxProjects.find(pr => pr.name === _ctxSelectedProject);
  if (!p) return;

  const liveStatus = (indexStatus[p.name] || {}).status || p.status || 'ready';
  const statusCls  = liveStatus === 'indexing' ? 'indexing' : liveStatus === 'ready' ? 'ready' : 'off';

  let actionBtns = `
    <button class="ctx-btn-sm" onclick="ctxIndexProject('${_escHtml(p.name)}')">⚡ Index</button>
    <button class="ctx-btn-sm" onclick="ctxReindexProject('${_escHtml(p.name)}')">🔄 Re-index</button>
    <button class="ctx-btn-sm" onclick="ctxGenerateAstProject('${_escHtml(p.name)}')">🌳 AST</button>
    <button class="ctx-btn-sm" onclick="ctxReadProjectAst('${_escHtml(p.name)}')">👁 View AST</button>
    <button class="ctx-btn-sm" onclick="ctxPurgeProject('${_escHtml(p.name)}')">🗑 Purge</button>
    <button class="ctx-btn-sm" onclick="ctxDeleteProject('${_escHtml(p.name)}')">✕ Delete</button>`;

  if (liveStatus === 'indexing') {
    actionBtns = `<button class="ctx-btn-sm" onclick="ctxStopIndexing('${_escHtml(p.name)}')">⏹ Stop</button>` + actionBtns;
  }

  const codeFiles = p.file_count || 0;
  const memBank   = p.memory_count || 0;

  let progressHtml = '';
  if (indexStatus[p.name] && indexStatus[p.name].progress != null) {
    const pct = Math.round((indexStatus[p.name].progress || 0) * 100);
    progressHtml = `<div class="ctx-det-section">
      <div class="ctx-det-section-title">Indexing Progress</div>
      <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:6px;margin-top:6px;">
        <div style="background:var(--cyan);height:6px;border-radius:4px;width:${pct}%;transition:width 0.3s;"></div>
      </div>
      <div style="font-size:0.55rem;color:var(--text-dim);margin-top:4px;">${pct}% complete</div>
    </div>`;
  }

  let langHtml = '';
  if (p.languages && Object.keys(p.languages).length) {
    const topLangs = Object.entries(p.languages).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxCount = topLangs.length > 0 ? topLangs[0][1] : 1;
    langHtml = `<div class="ctx-det-section">
      <div class="ctx-det-section-title">Languages</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
        ${topLangs.map(([lang, count]) => {
          const pct = Math.max(1, Math.round((count / maxCount) * 100));
          // Use different colors for different languages optionally, or just use primary brand color
          const barColor = 'var(--cyan)';
          return `
            <div style="display:flex;align-items:center;gap:12px;font-size:0.55rem;font-family:var(--font-mono);">
              <span style="color:var(--text);width:75px;min-width:75px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escHtml(lang)}">${_escHtml(lang)}</span>
              <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                <div style="height:4px;background:${barColor};border-radius:2px;width:${pct}%;opacity:0.8;"></div>
              </div>
              <span style="color:var(--text-dim);flex-shrink:0;width:30px;text-align:right;">${count}</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  detail.innerHTML = `
    <div class="ctx-det-header">
      <div class="ctx-det-title">
        ${_escHtml(p.name)}
        <span class="ctx-project-status ${statusCls}">${liveStatus}</span>
      </div>
      <div class="ctx-det-path">${_escHtml(p.path || '')}</div>
      <div class="ctx-det-actions">${actionBtns}</div>
    </div>
    <div class="ctx-det-section">
      <div class="ctx-det-section-title">Overview</div>
      <div class="ctx-det-grid">
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${codeFiles}</div><div class="ctx-det-stat-label">Total Files</div></div>
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${memBank}</div><div class="ctx-det-stat-label">Memory Bank</div></div>
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${p.chunk_count || 0}</div><div class="ctx-det-stat-label">Chunks</div></div>
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${p.ast_node_count || 0}</div><div class="ctx-det-stat-label">AST Nodes</div></div>
      </div>
    </div>
    ${progressHtml}
    ${langHtml}
    ${p.indexed_at ? `<div class="ctx-det-section" style="border-bottom:none;">
      <div class="ctx-det-section-title">Timeline</div>
      <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);">
        Last indexed: ${new Date(p.indexed_at).toLocaleString()}<br>
        ${p.created_at ? 'Added: ' + new Date(p.created_at).toLocaleString() : ''}
      </div>
    </div>` : ''}
  `;
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

function ctxAddProject() {
  document.getElementById('ctx-add-path').value = '';
  document.getElementById('ctx-add-name').value = '';
  document.getElementById('ctx-add-modal').style.display = 'flex';
}

function ctxCloseAddModal() {
  document.getElementById('ctx-add-modal').style.display = 'none';
}

async function ctxBrowseDirectory() {
  if (window.electronAPI && window.electronAPI.pickDirectory) {
    const dir = await window.electronAPI.pickDirectory();
    if (dir) {
      document.getElementById('ctx-add-path').value = dir;
      if (!document.getElementById('ctx-add-name').value) {
        document.getElementById('ctx-add-name').value = dir.split('/').filter(Boolean).pop() || '';
      }
    }
  } else {
    showToast('info', 'Use the text field to enter path (native picker requires Electron)');
  }
}

async function ctxConfirmAdd() {
  const path = document.getElementById('ctx-add-path').value.trim();
  const name = document.getElementById('ctx-add-name').value.trim() || path.split('/').filter(Boolean).pop() || '';
  if (!path) { showToast('error', 'Directory path is required'); return; }
  try {
    const res = await fetch('/api/context/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
    showToast('success', `Project "${name}" added`);
    ctxCloseAddModal();
    ctxLoadProjects();
  } catch (e) { showToast('error', e.message); }
}

async function ctxIndexProject(name) {
  try {
    const res = await fetch('/api/context/repos/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
    showToast('info', `Indexing "${name}" started...`);
    ctxStartPolling();
  } catch (e) { showToast('error', e.message); }
}

async function ctxGenerateAstProject(name) {
  try {
    const res = await fetch('/api/context/repos/ast/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
    showToast('info', `Generating AST for "${name}"...`);
    ctxStartPolling();
  } catch (e) { showToast('error', e.message); }
}

async function ctxReindexProject(name) {
  try {
    const res = await fetch('/api/context/repos/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
    showToast('info', `Re-indexing "${name}" started...`);
    ctxStartPolling();
  } catch (e) { showToast('error', e.message); }
}

async function ctxStopIndexing(name) {
  try {
    const res = await fetch('/api/context/repos/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
    const data = await res.json();
    showToast('info', data.stopping ? `Stopping "${name}"...` : `"${name}" reset to ready`);
    setTimeout(() => ctxLoadProjects(), 1000);
  } catch (e) { showToast('error', e.message); }
}

async function ctxPurgeProject(name) {
  if (!confirm(`Purge all indexed data for "${name}"? The project will be kept but all vectors and chunks will be removed.`)) return;
  try {
    const res = await fetch('/api/context/repos/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
    showToast('success', `Index purged for "${name}"`);
    ctxLoadProjects();
  } catch (e) { showToast('error', e.message); }
}

async function ctxDeleteProject(name) {
  if (!confirm(`Delete project "${name}" and all its indexed data?`)) return;
  try {
    const res = await fetch(`/api/context/repos/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
    showToast('success', `Project "${name}" deleted`);
    ctxLoadProjects();
  } catch (e) { showToast('error', e.message); }
}

async function ctxIndexAll() {
  try {
    const res = await fetch('/api/context/repos/index-all', { method: 'POST' });
    if (!res.ok) throw new Error('Failed');
    showToast('info', 'Indexing all projects...');
    ctxStartPolling();
  } catch (e) { showToast('error', e.message); }
}

async function ctxReindexAll() {
  try {
    const res = await fetch('/api/context/repos/reindex-all', { method: 'POST' });
    if (!res.ok) throw new Error('Failed');
    showToast('info', 'Re-indexing all projects...');
    ctxStartPolling();
  } catch (e) { showToast('error', e.message); }
}

// ── Indexing polling ──────────────────────────────────────────────────────────

function ctxStartPolling() {
  if (_ctxPollingTimer) return;
  ctxLoadProjects();
  _ctxPollingTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/context/repos/indexing-status');
      if (!res.ok) return;
      const status = await res.json();
      _ctxLastIndexStatus = status;
      ctxRenderProjectsWithProgress(status);
      const anyIndexing = Object.values(status).some(s => s.status === 'indexing');
      if (!anyIndexing) {
        clearInterval(_ctxPollingTimer);
        _ctxPollingTimer = null;
        _ctxLastIndexStatus = {};
        ctxLoadProjects();
      }
    } catch (e) { /* ignore polling errors */ }
  }, 2000);
}

// ── Search ────────────────────────────────────────────────────────────────────

async function ctxDoSearch() {
  const q    = document.getElementById('ctx-search-input').value.trim();
  if (!q) return;
  const mode = document.getElementById('ctx-search-mode').value;
  const repo = document.getElementById('ctx-search-repo').value;
  const container = document.getElementById('ctx-search-results');
  container.innerHTML = '<div class="ctx-welcome" style="padding:30px;">Searching...</div>';

  try {
    let results = [];
    if (mode === 'all' || mode === 'code') {
      const params = new URLSearchParams({ q, limit: 15 });
      if (repo) params.set('repo', repo);
      const res = await fetch('/api/context/search?' + params);
      if (res.ok) { const data = await res.json(); results = results.concat((data.results || []).map(r => ({ ...r, _type: 'code' }))); }
    }
    if (mode === 'all' || mode === 'memory') {
      const params = new URLSearchParams({ q, limit: 10 });
      if (repo) params.set('repo', repo);
      const res = await fetch('/api/context/memory/search?' + params);
      if (res.ok) { const data = await res.json(); results = results.concat((data.results || []).map(r => ({ ...r, _type: 'memory' }))); }
    }
    results.sort((a, b) => (a.distance || 999) - (b.distance || 999));
    if (!results.length) {
      container.innerHTML = '<div class="ctx-welcome" style="padding:30px;">No results found</div>';
      return;
    }
    container.innerHTML = results.map(r => {
      const path    = r.file_path || r.uri || '';
      const lang    = r.language || '';
      const repoN   = r.repo_name || '';
      const score   = r.distance != null ? (1 - r.distance).toFixed(3) : '';
      const preview = (r.content || '').substring(0, 400);
      const typeBadge = r._type === 'memory'
        ? '<span class="ctx-result-badge" style="color:#a855f7;border-color:#a855f7;">memory</span>' : '';
      return `<div class="ctx-result-card">
        <div class="ctx-result-header">
          <span class="ctx-result-path">${_escHtml(path)}</span>
          <div class="ctx-result-meta">
            ${typeBadge}
            ${lang  ? '<span class="ctx-result-badge">' + _escHtml(lang)  + '</span>' : ''}
            ${repoN ? '<span class="ctx-result-badge">' + _escHtml(repoN) + '</span>' : ''}
            ${score ? '<span class="ctx-result-score">score: ' + score + '</span>' : ''}
          </div>
        </div>
        <div class="ctx-result-preview">${_escHtml(preview)}</div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="ctx-welcome" style="padding:30px;color:#ef4444;">Search failed: ' + _escHtml(e.message) + '</div>';
  }
}

// ── Memory panel ──────────────────────────────────────────────────────────────

async function ctxLoadMemory() {
  const container = document.getElementById('ctx-memory-list');
  try {
    await _ctxEnsureProjectsLoaded();
    const res = await fetch('/api/context/memory/list');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const items = data.resources || data || [];
    _ctxMemoryItems = items;
    if (!items.length) {
      container.innerHTML = `<div class="ctx-welcome">
        <div style="font-size:2rem;margin-bottom:12px;">🧠</div>
        <div>No memory bank documents found</div>
        <div style="color:var(--text-dim);font-size:0.6rem;margin-top:6px;">Index a project with a memory/ directory to see docs here</div>
      </div>`;
      return;
    }
    _ctxMemoryProjects = _ctxProjects.filter(p => _ctxMemoryItems.some(i => (i.repo || i.repo_name) === p.name));
    if (!_ctxMemoryProjects.length) {
      const names = Array.from(new Set(_ctxMemoryItems.map(i => i.repo || i.repo_name).filter(Boolean)));
      _ctxMemoryProjects = names.map(name => ({ name, status: 'ready', ast_node_count: 0, chunk_count: 0 }));
    }
    if (!_ctxMemorySelectedProject || !_ctxMemoryProjects.find(p => p.name === _ctxMemorySelectedProject)) {
      _ctxMemorySelectedProject = _ctxMemoryProjects[0].name;
    }
    container.innerHTML = `
      <div class="ctx-proj-split">
        <div class="ctx-proj-sidebar" id="ctx-memory-projects"></div>
        <div class="ctx-proj-detail" id="ctx-memory-detail"></div>
      </div>`;
    ctxRenderProjectExplorer('ctx-memory-projects', _ctxMemoryProjects, _ctxMemorySelectedProject, 'ctxSelectMemoryProject', { indexStatus: _ctxLastIndexStatus });
    _ctxRenderFilteredProjectFiles('ctx-memory-detail', _ctxMemoryItems, _ctxMemorySelectedProject, 'memory');
  } catch (e) {
    container.innerHTML = '<div class="ctx-welcome" style="padding:30px;color:#ef4444;">Failed to load: ' + _escHtml(e.message) + '</div>';
  }
}

function ctxSelectMemoryProject(name) {
  _ctxMemorySelectedProject = name;
  ctxRenderProjectExplorer('ctx-memory-projects', _ctxMemoryProjects, _ctxMemorySelectedProject, 'ctxSelectMemoryProject', { indexStatus: _ctxLastIndexStatus });
  _ctxRenderFilteredProjectFiles('ctx-memory-detail', _ctxMemoryItems, _ctxMemorySelectedProject, 'memory');
}

// ── Code panel ────────────────────────────────────────────────────────────────

async function ctxLoadCode() {
  const container = document.getElementById('ctx-code-list');
  try {
    await _ctxEnsureProjectsLoaded();
    const res = await fetch('/api/context/code/list');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const items = data.files || data || [];
    _ctxCodeItems = items;
    if (!items.length) {
      container.innerHTML = `<div class="ctx-welcome">
        <div style="font-size:2rem;margin-bottom:12px;">📄</div>
        <div>No code files found</div>
        <div style="color:var(--text-dim);font-size:0.6rem;margin-top:6px;">Index a project to browse its code files here</div>
      </div>`;
      return;
    }
    _ctxCodeProjects = _ctxProjects.filter(p => _ctxCodeItems.some(i => (i.repo || i.repo_name) === p.name));
    if (!_ctxCodeProjects.length) {
      const names = Array.from(new Set(_ctxCodeItems.map(i => i.repo || i.repo_name).filter(Boolean)));
      _ctxCodeProjects = names.map(name => ({ name, status: 'ready', ast_node_count: 0, chunk_count: 0 }));
    }
    if (!_ctxCodeSelectedProject || !_ctxCodeProjects.find(p => p.name === _ctxCodeSelectedProject)) {
      _ctxCodeSelectedProject = _ctxCodeProjects[0].name;
    }
    container.innerHTML = `
      <div class="ctx-proj-split">
        <div class="ctx-proj-sidebar" id="ctx-code-projects"></div>
        <div class="ctx-proj-detail" id="ctx-code-detail"></div>
      </div>`;
    ctxRenderProjectExplorer('ctx-code-projects', _ctxCodeProjects, _ctxCodeSelectedProject, 'ctxSelectCodeProject', { indexStatus: _ctxLastIndexStatus });
    _ctxRenderFilteredProjectFiles('ctx-code-detail', _ctxCodeItems, _ctxCodeSelectedProject, 'code');
  } catch (e) {
    container.innerHTML = '<div class="ctx-welcome" style="padding:30px;color:#ef4444;">Failed to load: ' + _escHtml(e.message) + '</div>';
  }
}

function ctxSelectCodeProject(name) {
  _ctxCodeSelectedProject = name;
  ctxRenderProjectExplorer('ctx-code-projects', _ctxCodeProjects, _ctxCodeSelectedProject, 'ctxSelectCodeProject', { indexStatus: _ctxLastIndexStatus });
  _ctxRenderFilteredProjectFiles('ctx-code-detail', _ctxCodeItems, _ctxCodeSelectedProject, 'code');
}

function _ctxRenderFilteredProjectFiles(containerId, items, projectName, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const openFn = type === 'memory' ? 'ctxReadMemory' : 'ctxReadCodeFile';
  const filtered = (items || []).filter(i => (i.repo || i.repo_name) === projectName)
    .sort((a, b) => (a.path || a.uri || '').localeCompare(b.path || b.uri || ''));
  if (!filtered.length) {
    container.innerHTML = `<div class="ctx-welcome" style="padding:60px 20px;">
      <div style="font-size:1.7rem;margin-bottom:8px;">No files</div>
      <div style="font-size:0.58rem;">No ${type === 'memory' ? 'memory bank documents' : 'code files'} for "${_escHtml(projectName)}"</div>
    </div>`;
    return;
  }
  container.innerHTML = `
    <div style="padding:12px;">
      <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);margin:2px 2px 10px;">${filtered.length} ${type === 'memory' ? 'document' : 'file'}${filtered.length === 1 ? '' : 's'}</div>
      ${filtered.map(d => `<div class="ctx-memory-item" onclick="${openFn}('${_escHtml(d.uri || d.path || '')}')">
        <span>${_escHtml(d.path || d.uri || '')}</span>
        <div style="display:flex;gap:8px;align-items:center;">
          ${d.language ? '<span style="color:var(--text-dim);font-size:0.45rem;background:rgba(0,0,0,0.2);padding:1px 6px;border-radius:3px;">' + _escHtml(d.language) + '</span>' : ''}
          ${d.chunk_count ? '<span style="color:var(--text-dim);font-size:0.5rem;">' + d.chunk_count + ' chunks</span>' : ''}
        </div>
      </div>`).join('')}
    </div>`;
}

async function _ctxEnsureProjectsLoaded() {
  if (_ctxProjects && _ctxProjects.length) return;
  try {
    const res = await fetch('/api/context/repos');
    if (!res.ok) return;
    const data = await res.json();
    _ctxProjects = data.repos || data || [];
  } catch (e) { /* no-op */ }
}

// ── File list renderer ────────────────────────────────────────────────────────

function _ctxRenderFileList(container, items, prefix, type) {
  const byRepo = {};
  items.forEach(i => {
    const rn = i.repo || i.repo_name || 'unknown';
    (byRepo[rn] = byRepo[rn] || []).push(i);
  });
  const openFn = type === 'memory' ? 'ctxReadMemory' : 'ctxReadCodeFile';
  container.innerHTML = Object.entries(byRepo).map(([repo, docs]) => {
    const groupId = prefix + '-' + repo.replace(/[^a-zA-Z0-9]/g, '_');
    return `<div style="margin-bottom:12px;">
      <div style="font-family:var(--font-mono);font-size:0.6rem;color:#22d3ee;margin-bottom:6px;padding:6px 10px;background:rgba(34,211,238,0.08);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;"
           onclick="document.getElementById('${groupId}').style.display=document.getElementById('${groupId}').style.display==='none'?'block':'none'; this.querySelector('.ctx-mem-arrow').textContent=document.getElementById('${groupId}').style.display==='none'?'▸':'▾'">
        <span>📁 ${_escHtml(repo)} <span style="color:var(--text-dim);">(${docs.length} files)</span></span>
        <span class="ctx-mem-arrow" style="font-size:0.7rem;">▸</span>
      </div>
      <div id="${groupId}" style="display:none;">
        ${docs.map(d => `<div class="ctx-memory-item" onclick="event.stopPropagation();${openFn}('${_escHtml(d.uri || d.path || '')}')">
          <span>${_escHtml(d.path || d.uri || '')}</span>
          <div style="display:flex;gap:8px;align-items:center;">
            ${d.language ? '<span style="color:var(--text-dim);font-size:0.45rem;background:rgba(0,0,0,0.2);padding:1px 6px;border-radius:3px;">' + _escHtml(d.language) + '</span>' : ''}
            ${d.chunk_count ? '<span style="color:var(--text-dim);font-size:0.5rem;">' + d.chunk_count + ' chunks</span>' : ''}
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

// ── File viewer ───────────────────────────────────────────────────────────────

function openContextFile(uri, type) {
  const modal     = document.getElementById('file-modal');
  const title     = document.getElementById('modal-title');
  const content   = document.getElementById('modal-content');
  const contentMd = document.getElementById('modal-content-md');
  const openBtn   = document.getElementById('open-browser-btn');
  const revealBtn = document.getElementById('reveal-path-btn');

  title.textContent       = uri.split('/').pop() || uri;
  content.innerHTML       = '<div style="padding:40px;text-align:center;color:var(--text-dim);">Loading...</div>';
  content.style.display   = 'block';
  contentMd.style.display = 'none';
  if (openBtn)   openBtn.style.display   = 'none';
  if (revealBtn) revealBtn.style.display = 'none';
  modal.classList.add('active');

  const endpoint = type === 'memory'
    ? `/api/context/memory/read?uri=${encodeURIComponent(uri)}`
    : `/api/context/code/read?path=${encodeURIComponent(uri)}`;

  fetch(endpoint).then(r => r.json()).then(data => {
    const text = data.content || data.text || '';
    if (type === 'memory') {
      contentMd.style.display = 'block';
      content.style.display   = 'none';
      if (window.marked) {
        contentMd.innerHTML = marked.parse(text);
      } else {
        contentMd.textContent = text;
      }
    } else {
      content.innerHTML = `<pre style="padding:20px;font-size:0.65rem;font-family:var(--font-mono);white-space:pre-wrap;word-break:break-word;">${_escHtml(text)}</pre>`;
    }
  }).catch(e => {
    content.innerHTML = `<div style="padding:30px;color:#ef4444;">Failed to load: ${_escHtml(e.message)}</div>`;
  });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function _escHtml(s) {
  if (!s) return '';
  return s.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
