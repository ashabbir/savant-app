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
let _ctxFileCardCache = {}; // uri → {expanded, content, language}
let _ctxAddSources = null;
const _CTX_REFRESH_STATE_KEY = 'savant.ctx.refreshState.v1';
// _ctxProjects is declared in globals.js

// ── MCP connection ────────────────────────────────────────────────────────────

async function ctxMcpTestConnection() {
  return _mcpTestConnection('context', 8093, 'ctx-mcp-dot', 'ctx-mcp-status-text');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function ctxInit() {
  const pendingRefreshState = _ctxReadRefreshState();
  if (!_ctxInited) {
    _ctxInited = true;
    ctxMcpTestConnection();
    await ctxRefreshStatus();
  }
  if (pendingRefreshState && pendingRefreshState.ctx) {
    _ctxApplyRefreshStateSeed(pendingRefreshState.ctx);
  }
  await ctxLoadProjects();
  if (_ctxPollingTimer && Object.keys(_ctxLastIndexStatus).length) {
    ctxRenderProjectsWithProgress(_ctxLastIndexStatus);
  }
  if (_ctxProjects.some(p => p.status === 'indexing') && !_ctxPollingTimer) {
    ctxStartPolling();
  }
  if (pendingRefreshState && pendingRefreshState.ctx) {
    await _ctxRestoreRefreshState(pendingRefreshState.ctx);
  }
}

function _ctxGetActivePanel() {
  const active = document.querySelector('.ctx-inner-tabs .savant-subtab.active');
  return active ? (active.getAttribute('data-panel') || 'search') : 'search';
}

function _ctxCaptureRefreshState() {
  const searchInput = document.getElementById('ctx-search-input');
  const searchMode = document.getElementById('ctx-search-mode');
  const searchRepo = document.getElementById('ctx-search-repo');
  const astState = (typeof window.ctxAstGetViewState === 'function') ? window.ctxAstGetViewState() : null;
  return {
    savedAt: Date.now(),
    ctx: {
      panel: _ctxGetActivePanel(),
      selectedProject: _ctxSelectedProject,
      memorySelectedProject: _ctxMemorySelectedProject,
      codeSelectedProject: _ctxCodeSelectedProject,
      projectExplorerState: _ctxProjectExplorerState,
      searchInput: searchInput ? searchInput.value : '',
      searchMode: searchMode ? searchMode.value : 'all',
      searchRepo: searchRepo ? searchRepo.value : '',
      ast: astState,
    },
  };
}

function _ctxReadRefreshState() {
  try {
    const raw = sessionStorage.getItem(_CTX_REFRESH_STATE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(_CTX_REFRESH_STATE_KEY);
    return JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(_CTX_REFRESH_STATE_KEY);
    return null;
  }
}

function _ctxApplyRefreshStateSeed(state) {
  if (typeof state.selectedProject === 'string') _ctxSelectedProject = state.selectedProject;
  if (typeof state.memorySelectedProject === 'string') _ctxMemorySelectedProject = state.memorySelectedProject;
  if (typeof state.codeSelectedProject === 'string') _ctxCodeSelectedProject = state.codeSelectedProject;
  if (state.projectExplorerState && typeof state.projectExplorerState === 'object') {
    _ctxProjectExplorerState = state.projectExplorerState;
  }
  if (state.ast && typeof window.ctxAstRestoreViewState === 'function') {
    window.ctxAstRestoreViewState(state.ast);
  }
}

async function _ctxRestoreRefreshState(state) {
  const panel = ['search', 'memory', 'code', 'ast'].includes(state.panel) ? state.panel : 'search';
  switchCtxPanel(panel);
  const searchInput = document.getElementById('ctx-search-input');
  const searchMode = document.getElementById('ctx-search-mode');
  const searchRepo = document.getElementById('ctx-search-repo');
  if (searchInput && typeof state.searchInput === 'string') searchInput.value = state.searchInput;
  if (searchMode && typeof state.searchMode === 'string') searchMode.value = state.searchMode;
  if (searchRepo && typeof state.searchRepo === 'string') searchRepo.value = state.searchRepo;
}

function ctxRefreshPagePreserveState() {
  try {
    const state = _ctxCaptureRefreshState();
    sessionStorage.setItem(_CTX_REFRESH_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    // no-op; fall through to plain reload if storage unavailable
  }
  window.location.reload();
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

  ['search', 'memory', 'code', 'ast'].forEach(p => {
    const el = document.getElementById('ctx-panel-' + p);
    if (el) el.style.display = p === panel ? 'block' : 'none';
  });

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
    if (typeof window.ctxHandleProjectsUpdate === 'function') {
      window.ctxHandleProjectsUpdate();
    }
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
  const activeEl = document.activeElement;
  const wasSearchFocused = !!(
    activeEl &&
    activeEl.tagName === 'INPUT' &&
    activeEl.closest &&
    activeEl.closest('.ctx-project-explorer-search') &&
    sidebar.contains(activeEl)
  );
  const searchSelStart = wasSearchFocused && typeof activeEl.selectionStart === 'number' ? activeEl.selectionStart : null;
  const searchSelEnd = wasSearchFocused && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null;
  const state = _ctxProjectExplorerState[containerId] || { query: '', collapsed: false };
  _ctxProjectExplorerState[containerId] = state;
  _ctxProjectExplorerRegistry[containerId] = { projects, selectedName, onSelectFn, options };
  const query = (state.query || '').trim().toLowerCase();
  const filtered = query
    ? projects.filter(p => ((p.name || '') + ' ' + (p.path || '')).toLowerCase().includes(query))
    : projects;
  const headTitle = Object.prototype.hasOwnProperty.call(options, 'title')
    ? (options.title || '')
    : '';
  const collapsedLabel = Object.prototype.hasOwnProperty.call(options, 'collapsedLabel')
    ? (options.collapsedLabel || '')
    : headTitle;
  const showTitle = options.showTitle !== false && !!headTitle;
  const searchPlaceholder = options.searchPlaceholder || 'Search projects...';
  const addProjectBtn = options.showAddProject !== false
    ? '<button class="ctx-btn ctx-btn-primary ctx-project-explorer-add" onclick="ctxAddProject()" title="Add project">+</button>'
    : '';
  const refreshBtn = options.showRefresh !== false
    ? '<button class="ctx-btn ctx-project-explorer-refresh" onclick="ctxRefreshPagePreserveState()" title="Refresh page">↻</button>'
    : '';
  const bodyHtml = !filtered.length
    ? `<div class="ctx-welcome" style="padding:20px 10px;font-size:0.58rem;">${query ? 'No projects match search' : 'No projects yet'}</div>`
    : filtered.map(p => _ctxRenderProjectExplorerRow(p, selectedName, onSelectFn, options.indexStatus || {})).join('');

  if (state.collapsed) {
    sidebar.innerHTML = `
      <div class="ctx-project-explorer collapsed">
        <div class="ctx-explorer-collapsed-bar" onclick="ctxToggleProjectExplorer('${_ctxJsString(containerId)}')" title="Expand">
          <span class="ctx-explorer-collapsed-icon">›</span>
          ${collapsedLabel ? `<span class="ctx-explorer-collapsed-label">${_escHtml(collapsedLabel)}</span>` : ''}
        </div>
      </div>`;
  } else {
    sidebar.innerHTML = `
      <div class="ctx-project-explorer">
        <div class="ctx-project-explorer-head">
          <div class="ctx-project-explorer-head-left">
            ${showTitle ? `<div class="ctx-project-explorer-title">${_escHtml(headTitle)}</div>` : ''}
            ${addProjectBtn}
            ${refreshBtn}
          </div>
          <div class="ctx-project-explorer-head-right">
            <button class="ctx-project-explorer-toggle" onclick="ctxToggleProjectExplorer('${_ctxJsString(containerId)}')" title="Collapse project explorer">‹</button>
          </div>
        </div>
        <div class="ctx-project-explorer-search">
          <input type="text" value="${_escHtml(state.query || '')}" placeholder="${_escHtml(searchPlaceholder)}" oninput="ctxProjectExplorerSearch('${_ctxJsString(containerId)}', this.value)">
        </div>
        <div class="ctx-project-explorer-list">${bodyHtml}</div>
      </div>`;
  }
  if (!state.collapsed && wasSearchFocused) {
    const nextSearchInput = sidebar.querySelector('.ctx-project-explorer-search input');
    if (nextSearchInput) {
      nextSearchInput.focus({ preventScroll: true });
      if (searchSelStart != null && searchSelEnd != null && nextSearchInput.setSelectionRange) {
        nextSearchInput.setSelectionRange(searchSelStart, searchSelEnd);
      }
    }
  }
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
  const live      = indexStatus[project.name] || {};
  const liveStatus = (live.status || project.status || '').toString().toLowerCase();
  const phase      = (live.phase || '').toString();
  const indexed = !!(project.chunk_count > 0 || project.indexed_at);
  const ast     = !!(project.ast_node_count > 0);
  const failStates = new Set(['error', 'failed', 'off', 'stalled']);
  const busyStates = new Set(['indexing', 'generating', 'ast_generating', 'ast_generation', 'queued', 'running', 'processing']);
  if (failStates.has(liveStatus)) return { tone: 'red', indexed, ast, label: 'Failed' };
  if (busyStates.has(liveStatus)) {
    const isAst = live.job_type === 'ast';
    return { tone: 'orange', indexed, ast, label: isAst ? 'Generating AST' : 'Generating Index' };
  }
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
    sidebar.style.width = '28px';
    sidebar.style.minWidth = '28px';
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

function ctxRenderProjectOverview(detailEl, project, indexStatus = {}, options = {}) {
  if (!detailEl || !project) return;
  const actionsOnlyHeader = !!options.actionsOnlyHeader;
  const hideStatusText = !!options.hideStatusText;
  const hideProgressText = !!options.hideProgressText;
  const hideAstStatusText = !!options.hideAstStatusText;
  const complexityNodes = options.complexityNodes || [];
  const analysis = options.analysis || null;
  const p = project;
  const live = indexStatus[p.name] || {};
  const liveStatus = (live.status || p.status || 'ready').toString().toLowerCase();
  const phase = (live.phase || '').toString();
  const isAstPhase = live.job_type === 'ast';
  const statusCls  = liveStatus === 'indexing'  ? 'indexing'
                   : liveStatus === 'indexed'   ? 'ready'
                   : liveStatus === 'ast_only'  ? 'ready'
                   : liveStatus === 'stalled'   ? 'stalled'
                   : liveStatus === 'error'     ? 'error'
                   : liveStatus === 'ready'     ? 'ready'
                   : 'added';
  const statusLabel = liveStatus === 'indexing'
    ? (isAstPhase ? 'Generating AST' : 'Generating Index')
    : liveStatus === 'indexed'  ? 'Ready'
    : liveStatus === 'ast_only' ? 'AST Ready'
    : liveStatus.charAt(0).toUpperCase() + liveStatus.slice(1);

  let actionBtns = `
    <button class="ctx-btn-sm" onclick="ctxIndexProject('${_escHtml(p.name)}')">⚡ Index</button>
    <button class="ctx-btn-sm" onclick="ctxGenerateAstProject('${_escHtml(p.name)}')">🌳 AST</button>
    <button class="ctx-btn-sm" onclick="ctxPurgeProject('${_escHtml(p.name)}')">🗑 Purge</button>
    <button class="ctx-btn-sm" onclick="ctxDeleteProject('${_escHtml(p.name)}')">✕ Delete</button>`;

  if (liveStatus === 'indexing') {
    actionBtns = `<button class="ctx-btn-sm" onclick="ctxStopIndexing('${_escHtml(p.name)}')">⏹ Stop</button>` + actionBtns;
  }

  const codeFiles = p.file_count || 0;
  const memBank = p.memory_count || 0;
  let progressHtml = '';
  if (live.status === 'indexing' && live.progress != null) {
    const pct = Math.min(100, Math.round(live.progress || 0));
    if (isAstPhase) {
      if (hideProgressText) {
        progressHtml = `<div class="ctx-det-section">
          <div class="ctx-progress-bar">
            <div class="ctx-progress-fill ast" style="width:${pct}%"></div>
          </div>
        </div>`;
      } else {
        progressHtml = `<div class="ctx-det-section">
          <div class="ctx-det-section-title">AST Progress</div>
          <div class="ctx-progress-phase ast">${_escHtml(phase)}</div>
          <div class="ctx-progress-bar">
            <div class="ctx-progress-fill ast" style="width:${pct}%"></div>
          </div>
          <div class="ctx-progress-label">${pct}% complete${live.files_done != null ? ' · ' + live.files_done + (live.total ? '/' + live.total : '') + ' files' : ''}</div>
          ${live.current_file ? `<div class="ctx-progress-label" style="margin-top:2px;opacity:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escHtml(live.current_file)}">${_escHtml(live.current_file.split('/').slice(-2).join('/'))}</div>` : ''}
        </div>`;
      }
    } else {
      if (hideProgressText) {
        progressHtml = `<div class="ctx-det-section">
          <div class="ctx-progress-bar">
            <div class="ctx-progress-fill" style="width:${pct}%"></div>
          </div>
        </div>`;
      } else {
        progressHtml = `<div class="ctx-det-section">
          <div class="ctx-det-section-title">Index Progress</div>
          <div class="ctx-progress-phase">${_escHtml(phase)}</div>
          <div class="ctx-progress-bar">
            <div class="ctx-progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="ctx-progress-label">${pct}% complete${live.files_done != null ? ' · ' + live.files_done + (live.total ? '/' + live.total : '') + ' files' : ''}</div>
          ${live.current_file ? `<div class="ctx-progress-label" style="margin-top:2px;opacity:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escHtml(live.current_file)}">${_escHtml(live.current_file.split('/').slice(-2).join('/'))}</div>` : ''}
        </div>`;
      }
    }
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
          return `
            <div style="display:flex;align-items:center;gap:12px;font-size:0.55rem;font-family:var(--font-mono);">
              <span style="color:var(--text);width:75px;min-width:75px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escHtml(lang)}">${_escHtml(lang)}</span>
              <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                <div style="height:4px;background:var(--cyan);border-radius:2px;width:${pct}%;opacity:0.8;"></div>
              </div>
              <span style="color:var(--text-dim);flex-shrink:0;width:30px;text-align:right;">${count}</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  const astStatus = p.ast_node_count > 0 ? 'ready' : (liveStatus === 'indexing' && isAstPhase ? 'indexing' : 'added');
  const statusFailed = liveStatus === 'error' || liveStatus === 'failed' || liveStatus === 'stalled';
  const astGenerated = liveStatus === 'ast_only' || p.status === 'ast_only';
  const indexTone = statusFailed
    ? 'red'
    : (liveStatus === 'indexing' && !isAstPhase)
      ? 'orange'
      : ((p.chunk_count || 0) > 0 || p.indexed_at)
        ? 'green'
        : 'grey';
  const astTone = statusFailed
    ? 'red'
    : (liveStatus === 'indexing' && isAstPhase)
      ? 'orange'
      : astGenerated
        ? 'green'
        : 'grey';
  const indexLabel = statusFailed
    ? 'Failed'
    : (liveStatus === 'indexing' && !isAstPhase)
      ? 'Generating Index'
      : ((p.chunk_count || 0) > 0 || p.indexed_at)
        ? 'Indexed'
        : 'Not Indexed';
  const astLabel = statusFailed
    ? 'Failed'
    : (liveStatus === 'indexing' && isAstPhase)
      ? 'Generating AST'
      : astGenerated
        ? 'Generated'
        : 'Not Generated';
  const toneColor = tone => tone === 'green'
    ? '#22c55e'
    : tone === 'orange'
      ? '#f59e0b'
      : tone === 'red'
        ? '#ef4444'
        : '#94a3b8';
  const statusChip = (tone, label) => `<span title="${_escHtml(label)}" style="display:inline-flex;align-items:center;gap:6px;">
      <span style="
        display:inline-flex;
        width:10px;
        height:10px;
        border-radius:999px;
        border:1px solid ${toneColor(tone)};
        background:${toneColor(tone)};
        box-shadow:0 0 6px ${toneColor(tone)}55;
        vertical-align:middle;
      "></span>
      <span style="font-size:0.44rem;color:var(--text-dim);font-family:var(--font-mono);">${_escHtml(label)}</span>
    </span>`;

  const headerHtml = actionsOnlyHeader
    ? ''
    : `<div class="ctx-det-header">
      <div class="ctx-det-title">
        ${_escHtml(p.name)}
        ${hideStatusText ? '' : `<span class="ctx-project-status ${statusCls}">${_escHtml(statusLabel)}</span>`}
      </div>
      <div class="ctx-det-path">${_escHtml(p.path || '')}</div>
      <div class="ctx-det-actions">${actionBtns}</div>
    </div>`;
  const overviewActionsHtml = actionsOnlyHeader
    ? `<div class="ctx-det-actions" style="margin-top:12px;">${actionBtns}</div>`
    : '';
  let complexitySummaryHtml = '';
  if (actionsOnlyHeader) {
    const compute = (typeof window !== 'undefined' && typeof window._computeAstComplexity === 'function')
      ? window._computeAstComplexity
      : null;
    if (compute && Array.isArray(complexityNodes) && complexityNodes.length) {
      const files = compute(complexityNodes);
      const totalFns = files.reduce((s, f) => s + (f.functions ? f.functions.length : 0), 0);
      const totalScore = files.reduce((s, f) => s + (f.total_complexity || 0), 0);
      const avgFile = files.length ? Math.round(totalScore / files.length) : 0;
      const highRisk = files.filter(f => (f.total_complexity || 0) > 20).length;
      const avgColor = avgFile <= 5 ? '#4ade80' : avgFile <= 10 ? '#facc15' : avgFile <= 20 ? '#fb923c' : '#f87171';
      const riskColor = highRisk > 0 ? '#f87171' : '#4ade80';
      const card = (value, labelTop, labelBottom, color) => `
        <div class="ctx-det-stat">
          <div class="ctx-det-stat-val" style="color:${color};">${value}</div>
          <div class="ctx-det-stat-label">${labelTop} ${labelBottom}</div>
        </div>`;
      complexitySummaryHtml = `
        <div style="margin-top:12px;">
          <div style="font-family:var(--font-mono);font-size:0.48rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;">Complexity</div>
          <div style="display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;">
            ${card(files.length, 'Files', 'Analyzed', 'var(--cyan)')}
            ${card(totalFns, 'Functions', 'Classes', 'var(--cyan)')}
            ${card(avgFile, 'Avg File', 'Score', avgColor)}
            ${card(highRisk, 'High-Risk', 'Files', riskColor)}
          </div>
        </div>`;
    }
  }
  const analysisSummaryHtml = analysis && analysis.summary
    ? `<div style="margin-top:12px;">
        <div style="font-family:var(--font-mono);font-size:0.48rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;">Analysis</div>
        <div style="display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:8px;">
          <div class="ctx-det-stat"><div class="ctx-det-stat-val">${analysis.summary.totalFindings || 0}</div><div class="ctx-det-stat-label">Total Findings</div></div>
          <div class="ctx-det-stat"><div class="ctx-det-stat-val">${(analysis.summary.by_category && analysis.summary.by_category.structural) || 0}</div><div class="ctx-det-stat-label">Structural</div></div>
          <div class="ctx-det-stat"><div class="ctx-det-stat-val">${(analysis.summary.by_category && analysis.summary.by_category.security) || 0}</div><div class="ctx-det-stat-label">Security</div></div>
          <div class="ctx-det-stat"><div class="ctx-det-stat-val">${(analysis.summary.by_category && analysis.summary.by_category.modernization) || 0}</div><div class="ctx-det-stat-label">Modernization</div></div>
          <div class="ctx-det-stat"><div class="ctx-det-stat-val">${(analysis.summary.by_category && analysis.summary.by_category.dead_code) || 0}</div><div class="ctx-det-stat-label">Dead Code</div></div>
        </div>
      </div>`
    : '';

  detailEl.innerHTML = `
    ${headerHtml}
    <div class="ctx-det-section">
      <div class="ctx-det-section-title">Overview</div>
      <div class="ctx-det-grid">
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${codeFiles}</div><div class="ctx-det-stat-label">Total Files</div></div>
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${memBank}</div><div class="ctx-det-stat-label">Memory Bank</div></div>
        <div class="ctx-det-stat" title="Index status: ${_escHtml(indexLabel)}">
          <div class="ctx-det-stat-val">${p.chunk_count || 0}</div>
          <div class="ctx-det-stat-label">Index Chunks</div>
          <div style="margin-top:3px;">${statusChip(indexTone, indexLabel)}</div>
        </div>
        <div class="ctx-det-stat" title="AST status: ${_escHtml(astLabel)}">
          <div class="ctx-det-stat-val">${p.ast_node_count || 0}</div>
          <div class="ctx-det-stat-label">AST Nodes</div>
          <div style="margin-top:3px;">${statusChip(astTone, astLabel)}</div>
          ${hideAstStatusText ? '' : `<div style="margin-top:3px;"><span class="ctx-project-status ${astStatus}" style="font-size:0.42rem;padding:1px 5px;">${_escHtml(astLabel)}</span></div>`}
        </div>
      </div>
      ${complexitySummaryHtml}
      ${analysisSummaryHtml}
      ${overviewActionsHtml}
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

function _ctxRenderDetail(indexStatus) {
  const detail = document.getElementById('ctx-proj-detail');
  if (!detail) return;
  const p = _ctxProjects.find(pr => pr.name === _ctxSelectedProject);
  if (!p) return;
  ctxRenderProjectOverview(detail, p, indexStatus);
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

function _ctxGetAddEnabledSources() {
  if (!_ctxAddSources || !_ctxAddSources.sources) return [];
  return Object.entries(_ctxAddSources.sources)
    .filter(([, cfg]) => cfg && cfg.enabled)
    .map(([key]) => key);
}

function _ctxSourceLabel(source) {
  if (source === 'github') return 'GitHub';
  if (source === 'gitlab') return 'GitLab';
  if (source === 'directory') return 'Directory';
  return source || '';
}

function _ctxDirectorySourceConfig() {
  return ((_ctxAddSources || {}).sources || {}).directory || {};
}

function _ctxNormalizeFsPath(input) {
  return String(input || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _ctxRelativeToBase(selectedPath, basePath) {
  const selected = _ctxNormalizeFsPath(selectedPath);
  const base = _ctxNormalizeFsPath(basePath);
  if (!selected || !base) return '';
  if (selected === base) return '';
  if (!selected.startsWith(base + '/')) return '';
  return selected.slice(base.length + 1);
}

function _ctxRefreshDirectoryUi() {
  const cfg = _ctxDirectorySourceConfig();
  const baseHostDir = cfg.base_host_dir || '';
  const baseDir = cfg.base_dir || '';
  const label = document.getElementById('ctx-add-directory-label');
  const hint = document.getElementById('ctx-add-directory-hint');
  const input = document.getElementById('ctx-add-directory');

  if (label) {
    label.textContent = baseHostDir
      ? `DIRECTORY (RELATIVE TO ${baseHostDir})`
      : 'DIRECTORY (RELATIVE TO BASE_CODE_DIR)';
  }
  if (hint) {
    if (baseHostDir) {
      hint.textContent = `Browse and auto-fill relative path under: ${baseHostDir}`;
    } else if (baseDir) {
      hint.textContent = `Server base directory: ${baseDir}. Paste a relative path manually.`;
    } else {
      hint.textContent = 'Path must be relative to server BASE_CODE_DIR.';
    }
  }
  if (input && baseHostDir) {
    input.placeholder = 'team/project';
  }
}

function _ctxSetAddSubmitState(label, disabled) {
  const btn = document.getElementById('ctx-add-submit');
  if (!btn) return;
  btn.textContent = label;
  btn.disabled = !!disabled;
}

function _ctxApplyNoSourceFallback() {
  const fallback = document.getElementById('ctx-add-fallback');
  const sourceSelect = document.getElementById('ctx-add-source');
  const repoFields = document.getElementById('ctx-add-repo-fields');
  const dirFields = document.getElementById('ctx-add-directory-fields');
  if (fallback) {
    fallback.style.display = 'block';
    fallback.textContent = [
      'No project sources are configured.',
      '',
      'Please configure at least one of the following:',
      '',
      '* GITHUB_TOKEN',
      '* GITLAB_TOKEN',
      '* BASE_CODE_DIR',
    ].join('\n');
  }
  if (sourceSelect) {
    sourceSelect.innerHTML = '<option value="">No sources available</option>';
    sourceSelect.disabled = true;
  }
  if (repoFields) repoFields.style.display = 'none';
  if (dirFields) dirFields.style.display = 'none';
  _ctxRefreshDirectoryUi();
  _ctxSetAddSubmitState('ADD PROJECT', true);
}

function ctxUpdateAddSourceUI() {
  const source = (document.getElementById('ctx-add-source') || {}).value || '';
  const repoFields = document.getElementById('ctx-add-repo-fields');
  const dirFields = document.getElementById('ctx-add-directory-fields');
  if (repoFields) repoFields.style.display = source === 'directory' ? 'none' : 'block';
  if (dirFields) dirFields.style.display = source === 'directory' ? 'block' : 'none';
  _ctxRefreshDirectoryUi();
}

async function _ctxLoadAddSources() {
  const sourceSelect = document.getElementById('ctx-add-source');
  const fallback = document.getElementById('ctx-add-fallback');
  if (!sourceSelect) return;

  sourceSelect.disabled = true;
  sourceSelect.innerHTML = '<option value="">Loading sources...</option>';
  if (fallback) {
    fallback.style.display = 'none';
    fallback.textContent = '';
  }

  try {
    const res = await fetch('/api/context/repos/sources');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _ctxAddSources = await res.json();
  } catch (e) {
    _ctxAddSources = null;
    _ctxApplyNoSourceFallback();
    showToast('error', 'Failed to load project sources');
    return;
  }

  const enabled = _ctxGetAddEnabledSources();
  if (!enabled.length) {
    _ctxApplyNoSourceFallback();
    return;
  }

  sourceSelect.innerHTML = enabled
    .map((source) => `<option value="${_escHtml(source)}">${_escHtml(_ctxSourceLabel(source))}</option>`)
    .join('');
  sourceSelect.disabled = false;
  _ctxSetAddSubmitState('ADD PROJECT', false);
  ctxUpdateAddSourceUI();
}

async function ctxAddProject() {
  const urlEl = document.getElementById('ctx-add-url');
  const branchEl = document.getElementById('ctx-add-branch');
  const dirEl = document.getElementById('ctx-add-directory');
  if (urlEl) urlEl.value = '';
  if (branchEl) branchEl.value = '';
  if (dirEl) dirEl.value = '';
  _ctxSetAddSubmitState('ADD PROJECT', true);
  document.getElementById('ctx-add-modal').style.display = 'flex';
  await _ctxLoadAddSources();
}

function ctxCloseAddModal() {
  document.getElementById('ctx-add-modal').style.display = 'none';
}

async function ctxBrowseDirectory() {
  if (!window.electronAPI?.pickDirectory) {
    showToast('error', 'Directory picker is only available in the desktop app.');
    return;
  }

  const cfg = _ctxDirectorySourceConfig();
  const baseHostDir = cfg.base_host_dir || '';
  if (!baseHostDir) {
    showToast('error', 'Server is missing BASE_CODE_HOST_DIR. Enter a relative path manually.');
    return;
  }

  try {
    const selected = await window.electronAPI.pickDirectory();
    if (!selected) return;

    const relative = _ctxRelativeToBase(selected, baseHostDir);
    if (!relative) {
      showToast('error', `Selected directory must be inside: ${baseHostDir}`);
      return;
    }

    const dirEl = document.getElementById('ctx-add-directory');
    if (dirEl) dirEl.value = relative;
  } catch (e) {
    showToast('error', 'Failed to open directory picker: ' + (e.message || e));
  }
}

async function ctxConfirmAdd() {
  const enabled = _ctxGetAddEnabledSources();
  if (!enabled.length) {
    showToast('error', 'No project sources are configured');
    return;
  }

  const source = (document.getElementById('ctx-add-source') || {}).value || '';
  const payload = { source };

  if (source === 'directory') {
    const directory = (document.getElementById('ctx-add-directory') || {}).value?.trim() || '';
    if (!directory) {
      showToast('error', 'Directory path is required');
      return;
    }
    payload.directory = directory;
  } else {
    const url = (document.getElementById('ctx-add-url') || {}).value?.trim() || '';
    const branch = (document.getElementById('ctx-add-branch') || {}).value?.trim() || '';
    if (!url) {
      showToast('error', 'Repository URL is required');
      return;
    }
    payload.url = url;
    if (branch) payload.branch = branch;
  }

  _ctxSetAddSubmitState('Preparing project...', true);
  try {
    const res = await fetch('/api/context/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) { let _em = `HTTP ${res.status}`; try { const _ej = await res.json(); _em = _ej.error || _em; } catch {} throw new Error(_em); }
    const added = await res.json();
    const name = added && added.name ? added.name : 'Project';
    showToast('success', `Project "${name}" added`);
    ctxCloseAddModal();
    ctxLoadProjects();
  } catch (e) { showToast('error', e.message); }
  finally {
    _ctxSetAddSubmitState('ADD PROJECT', false);
  }
}

async function ctxIndexProject(name) {
  try {
    const res = await fetch('/api/context/repos/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) { let _em = `HTTP ${res.status}`; try { const _ej = await res.json(); _em = _ej.error || _em; } catch {} throw new Error(_em); }
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
    if (!res.ok) { let _em = `HTTP ${res.status}`; try { const _ej = await res.json(); _em = _ej.error || _em; } catch {} throw new Error(_em); }
    showToast('info', `Generating AST for "${name}"...`);
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
    if (!res.ok) { let _em = `HTTP ${res.status}`; try { const _ej = await res.json(); _em = _ej.error || _em; } catch {} throw new Error(_em); }
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
    if (!res.ok) { let _em = `HTTP ${res.status}`; try { const _ej = await res.json(); _em = _ej.error || _em; } catch {} throw new Error(_em); }
    showToast('success', `Index purged for "${name}"`);
    ctxLoadProjects();
  } catch (e) { showToast('error', e.message); }
}

async function ctxDeleteProject(name) {
  if (!confirm(`Delete project "${name}" and all its indexed data?`)) return;
  try {
    const res = await fetch(`/api/context/repos/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) { let _em = `HTTP ${res.status}`; try { const _ej = await res.json(); _em = _ej.error || _em; } catch {} throw new Error(_em); }
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
      if (typeof window.ctxHandleIndexStatusUpdate === 'function') {
        window.ctxHandleIndexStatusUpdate(status);
      }
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
  const filtered = (items || []).filter(i => (i.repo || i.repo_name) === projectName)
    .sort((a, b) => (a.path || a.uri || '').localeCompare(b.path || b.uri || ''));
  if (!filtered.length) {
    container.innerHTML = `<div class="ctx-welcome" style="padding:60px 20px;">
      <div style="font-size:1.7rem;margin-bottom:8px;">No files</div>
      <div style="font-size:0.58rem;">No ${type === 'memory' ? 'memory bank documents' : 'code files'} for "${_escHtml(projectName)}"</div>
    </div>`;
    return;
  }
  const count = filtered.length;
  const noun  = type === 'memory' ? 'document' : 'file';
  container.innerHTML = `<div class="ctx-file-cards">
    <div class="ctx-file-cards-header">${count} ${noun}${count === 1 ? '' : 's'}</div>
    ${filtered.map(item => _ctxBuildFileCard(item, type)).join('')}
  </div>`;
}

function _ctxBuildFileCard(item, type) {
  const uri      = item.uri || item.path || '';
  const path     = item.path || uri;
  const filename = path.split('/').pop() || path;
  const lang     = (item.language || '').toLowerCase();
  const chunks   = item.chunk_count || 0;
  const uid      = 'fc_' + uri.split('').reduce((h, c) => (((h << 5) - h) + c.charCodeAt(0)) | 0, 0).toString(36).replace('-','n');
  const icon     = type === 'memory' ? '📄' : _ctxLangIcon(lang);
  const cached   = _ctxFileCardCache[uri];
  const isExp    = !!(cached && cached.expanded);
  const safUri   = _escHtml(uri);
  const safType  = _escHtml(type);
  return `<div class="ctx-file-card${isExp ? ' expanded' : ''}" id="${uid}">
    <div class="ctx-file-card-head" onclick="ctxToggleFileCard('${safUri}','${safType}','${uid}')">
      <div class="ctx-file-card-info">
        <span class="ctx-file-card-icon">${icon}</span>
        <span class="ctx-file-card-name" title="${_escHtml(path)}">${_escHtml(filename)}</span>
        ${lang  ? `<span class="ctx-file-card-lang">${_escHtml(lang)}</span>` : ''}
        ${chunks ? `<span class="ctx-file-card-chunks">${chunks} chunk${chunks===1?'':'s'}</span>` : ''}
      </div>
      <div class="ctx-file-card-actions">
        <button class="ctx-file-card-open-btn" title="Open in viewer"
          onclick="event.stopPropagation();openContextFile('${safUri}','${safType}')">↗</button>
        <span class="ctx-file-card-toggle">${isExp ? '▲' : '▼'}</span>
      </div>
    </div>
    <div class="ctx-file-card-path">${_escHtml(path)}</div>
    <div class="ctx-file-card-body" id="${uid}_body" style="${isExp ? '' : 'display:none;'}">
      ${isExp && cached ? _ctxRenderFileBody(cached.content, cached.language, type) : ''}
    </div>
  </div>`;
}

function _ctxLangIcon(lang) {
  const m = { javascript:'🟨', js:'🟨', typescript:'🔷', ts:'🔷', jsx:'⚛', tsx:'⚛',
              python:'🐍', py:'🐍', scala:'⚡', ruby:'💎', rb:'💎', java:'☕', go:'🐹',
              rust:'🦀', css:'🎨', scss:'🎨', html:'🌐', json:'📋', markdown:'📝', md:'📝' };
  return m[lang] || '📄';
}

function _ctxRenderFileBody(content, lang, type) {
  if (!content) return '<div class="ctx-file-card-empty">No content</div>';
  if (type === 'memory') {
    const html = (window.marked) ? marked.parse(content) : `<pre>${_escHtml(content)}</pre>`;
    return `<div class="ctx-file-card-markdown markdown-body">${html}</div>`;
  }
  return `<div class="ctx-file-card-code">
    ${lang ? `<div class="ctx-file-card-code-lang">${_escHtml(lang)}</div>` : ''}
    <pre class="ctx-file-card-pre">${_escHtml(content)}</pre>
  </div>`;
}

async function ctxToggleFileCard(uri, type, uid) {
  const card   = document.getElementById(uid);
  const body   = document.getElementById(uid + '_body');
  const toggle = card ? card.querySelector('.ctx-file-card-toggle') : null;
  if (!card || !body) return;

  const cached = _ctxFileCardCache[uri];
  if (cached && cached.expanded) {
    cached.expanded = false;
    body.style.display = 'none';
    card.classList.remove('expanded');
    if (toggle) toggle.textContent = '▼';
    return;
  }

  card.classList.add('expanded');
  if (toggle) toggle.textContent = '▲';

  if (cached && cached.content !== undefined) {
    cached.expanded = true;
    body.innerHTML  = _ctxRenderFileBody(cached.content, cached.language, type);
    body.style.display = '';
    return;
  }

  body.innerHTML = '<div class="ctx-file-card-loading">Loading…</div>';
  body.style.display = '';

  const ep = type === 'memory'
    ? `/api/context/memory/read?uri=${encodeURIComponent(uri)}`
    : `/api/context/code/read?uri=${encodeURIComponent(uri)}`;
  try {
    const res  = await fetch(ep);
    let data = {};
    try { data = await res.json(); } catch { data = { error: 'Bad response' }; }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const content = data.content || data.text || '';
    _ctxFileCardCache[uri] = { expanded: true, content, language: data.language || '' };
    body.innerHTML = _ctxRenderFileBody(content, data.language || '', type);
  } catch (e) {
    body.innerHTML = `<div class="ctx-file-card-err">Failed to load: ${_escHtml(e.message)}</div>`;
    if (_ctxFileCardCache[uri]) _ctxFileCardCache[uri].expanded = false;
    else _ctxFileCardCache[uri] = { expanded: false };
  }
}

// Aliases so onclick="ctxReadMemory(...)" and onclick="ctxReadCodeFile(...)" work
function ctxReadMemory(uri)   { openContextFile(uri, 'memory'); }
function ctxReadCodeFile(uri) { openContextFile(uri, 'code');   }

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
    : `/api/context/code/read?uri=${encodeURIComponent(uri)}`;

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
