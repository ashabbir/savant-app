// ── Context AST ───────────────────────────────────────────────────────────────
// AST tab listing, embedded project viewer, view toggle controller, D3 tree renderer.
// Depends on: context-core.js (_ctxProjects, _escHtml, etc.)
//             context-complexity.js (_renderComplexityHeatmap, _renderComplexityRadial)
//             D3.js (d3)

// State shared with complexity module
let _astViewMode    = 'overview';  // 'overview' | 'complexity' | 'tree' | 'radial' | 'cluster'
let _astCurrentNodes = null;   // raw flat node list for the currently selected project
let _astSelectedProject = null;
let _astProjects = [];
let _astProjectPanelCollapsed = false;
let _astSearchQuery = '';
let _astSearchSelectionKey = '';
let _treeFileLimit    = 1500;
let _clusterFileLimit = 1500;
let _treeShowLabels   = false;
let _astAnalysisByProject = {};
let _astAnalysisInflight = {};

function ctxAstGetViewState() {
  return {
    selectedProject: _astSelectedProject,
    viewMode: _astViewMode,
    searchQuery: _astSearchQuery,
    searchSelectionKey: _astSearchSelectionKey,
    treeFileLimit: _treeFileLimit,
    clusterFileLimit: _clusterFileLimit,
    treeShowLabels: _treeShowLabels,
    projectPanelCollapsed: _astProjectPanelCollapsed,
  };
}

function ctxAstRestoreViewState(state = {}) {
  if (!state || typeof state !== 'object') return;
  if (typeof state.selectedProject === 'string') _astSelectedProject = state.selectedProject;
  if (typeof state.viewMode === 'string') _astViewMode = state.viewMode;
  if (typeof state.searchQuery === 'string') _astSearchQuery = state.searchQuery;
  if (typeof state.searchSelectionKey === 'string') _astSearchSelectionKey = state.searchSelectionKey;
  if (state.treeFileLimit === 'all' || typeof state.treeFileLimit === 'number') _treeFileLimit = state.treeFileLimit;
  if (state.clusterFileLimit === 'all' || typeof state.clusterFileLimit === 'number') _clusterFileLimit = state.clusterFileLimit;
  if (typeof state.treeShowLabels === 'boolean') _treeShowLabels = state.treeShowLabels;
  if (typeof state.projectPanelCollapsed === 'boolean') _astProjectPanelCollapsed = state.projectPanelCollapsed;
}

// ── File-list renderer (memory / code panels) ─────────────────────────────────
// (Moved here from core so that AST-specific openFn 'ctxReadAst' resolves correctly)

// ── AST tab: project tree + embedded visualizer ──────────────────────────────

async function ctxLoadAst() {
  const container = document.getElementById('ctx-ast-list');
  if (!container) return;
  try {
    const res = await fetch('/api/context/repos');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    _astProjects = data.repos || data || [];
    const hasProjects = _astProjects.length > 0;

    if (hasProjects && (!_astSelectedProject || !_astProjects.find(r => r.name === _astSelectedProject))) {
      _astSelectedProject = _astProjects[0].name;
    } else if (!hasProjects) {
      _astSelectedProject = null;
      _astCurrentNodes = null;
    }

    container.innerHTML = `
      <div class="ctx-proj-split" style="height:calc(100vh - 320px);min-height:520px;">
        <div class="ctx-proj-sidebar" id="ctx-ast-project-panel" style="transition:width 0.18s ease,min-width 0.18s ease;overflow:hidden;"></div>
        <div class="ctx-proj-detail" id="ctx-ast-visualization" style="background:rgba(0,0,0,0.08);">
          <div class="ctx-welcome" style="padding:60px 20px;">
            <div style="font-size:2rem;margin-bottom:12px;">🌳</div>
            <div>Select a project</div>
            <div style="color:var(--text-dim);font-size:0.55rem;margin-top:6px;">The AST visualization renders here</div>
          </div>
        </div>
      </div>`;
    _renderAstProjectTree();
    _applyAstProjectPanelState();
    if (hasProjects && _astSelectedProject) {
      await ctxReadProjectAst(_astSelectedProject, { preserveView: true });
    } else {
      const content = document.getElementById('ctx-ast-visualization');
      if (content) {
        content.innerHTML = `<div class="ctx-welcome" style="padding:60px 20px;">
          <div style="font-size:2rem;margin-bottom:12px;">🌳</div>
          <div>No projects found</div>
          <div style="color:var(--text-dim);font-size:0.6rem;margin-top:6px;">Use the + button in the project explorer to add one</div>
        </div>`;
      }
    }
  } catch (e) {
    container.innerHTML = '<div style="padding:30px;color:#ef4444;">Failed to load: ' + _escHtml(e.message) + '</div>';
  }
}

function _renderAstProjectTree() {
  ctxRenderProjectExplorer('ctx-ast-project-panel', _astProjects, _astSelectedProject, 'ctxReadProjectAst', { indexStatus: _ctxLastIndexStatus });
}

function ctxHandleProjectsUpdate() {
  const prevSelected = _astSelectedProject;
  _astProjects = (_ctxProjects || []).map(p => ({ ...p }));
  if (!_astSelectedProject || !_astProjects.find(r => r.name === _astSelectedProject)) {
    _astSelectedProject = _astProjects.length ? _astProjects[0].name : null;
  } else {
    _astSelectedProject = prevSelected;
  }
  const astPanel = document.getElementById('ctx-panel-ast');
  if (!astPanel || astPanel.style.display === 'none') return;
  _renderAstProjectTree();
  const content = document.getElementById('ctx-ast-visualization');
  if (!_astSelectedProject) {
    _astCurrentNodes = null;
    if (content) {
      content.innerHTML = `<div class="ctx-welcome" style="padding:60px 20px;">
        <div style="font-size:2rem;margin-bottom:12px;">🌳</div>
        <div>No projects found</div>
        <div style="color:var(--text-dim);font-size:0.6rem;margin-top:6px;">Use the + button in the project explorer to add one</div>
      </div>`;
    }
    return;
  }
  if (content && prevSelected !== _astSelectedProject) {
    ctxReadProjectAst(_astSelectedProject, { preserveView: true });
    return;
  }
  if (_astViewMode === 'overview' && document.getElementById('ast-modal-view-area')) {
    _renderAstView();
    _astPrimeAnalysis(_astSelectedProject);
  }
}

function ctxHandleIndexStatusUpdate(_status) {
  const s = (_status && _astSelectedProject) ? _status[_astSelectedProject] : null;
  if (s && s.status === 'indexing') {
    delete _astAnalysisByProject[_astSelectedProject];
  }
  const astPanel = document.getElementById('ctx-panel-ast');
  if (!astPanel || astPanel.style.display === 'none') return;
  _renderAstProjectTree();
  if (_astViewMode === 'overview' && document.getElementById('ast-modal-view-area')) {
    _renderAstView();
  }
}

function ctxToggleAstProjectPanel() {
  _astProjectPanelCollapsed = !_astProjectPanelCollapsed;
  _ctxProjectExplorerState['ctx-ast-project-panel'] = _ctxProjectExplorerState['ctx-ast-project-panel'] || {};
  _ctxProjectExplorerState['ctx-ast-project-panel'].collapsed = _astProjectPanelCollapsed;
  _applyAstProjectPanelState();
  if (_astCurrentNodes) setTimeout(_renderAstView, 220);
}

function _applyAstProjectPanelState() {
  _ctxProjectExplorerState['ctx-ast-project-panel'] = _ctxProjectExplorerState['ctx-ast-project-panel'] || {};
  if (typeof _ctxProjectExplorerState['ctx-ast-project-panel'].collapsed === 'boolean') {
    _astProjectPanelCollapsed = _ctxProjectExplorerState['ctx-ast-project-panel'].collapsed;
  } else {
    _ctxProjectExplorerState['ctx-ast-project-panel'].collapsed = _astProjectPanelCollapsed;
  }
  ctxSyncProjectExplorerLayout('ctx-ast-project-panel');
}

function _showAstPanel() {
  const astPanel = document.getElementById('ctx-panel-ast');
  if (!astPanel || astPanel.style.display !== 'none') return;
  document.querySelectorAll('.ctx-inner-tabs .savant-subtab').forEach(b => {
    const isAst = b.dataset && b.dataset.panel === 'ast';
    b.classList.toggle('active', isAst);
  });
  ['search', 'memory', 'code', 'ast'].forEach(p => {
    const el = document.getElementById('ctx-panel-' + p);
    if (el) el.style.display = p === 'ast' ? 'block' : 'none';
  });
}

// ── Project AST: render into the AST page right pane ─────────────────────────

async function ctxReadProjectAst(projectName, options = {}) {
  _astSelectedProject = projectName;
  _showAstPanel();
  _renderAstProjectTree();

  let content = document.getElementById('ctx-ast-visualization');
  if (!content) {
    await ctxLoadAst();
    content = document.getElementById('ctx-ast-visualization');
    if (!content) return;
  }

  content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);">Analyzing...</div>';
  try {
    const res = await fetch('/api/context/ast/list?repo=' + encodeURIComponent(projectName));
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    _astCurrentNodes = data.nodes || [];
    if (!options.preserveView) _astViewMode = 'overview';
    _renderAstModal(content);
    _astPrimeAnalysis(projectName);
  } catch (e) {
    content.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">Error: ${e.message}</div>`;
  }
}

function _astCurrentAnalysis() {
  return _astAnalysisByProject[_astSelectedProject] || null;
}

async function _astPrimeAnalysis(projectName) {
  if (!projectName) return;
  if (_astAnalysisByProject[projectName] || _astAnalysisInflight[projectName]) return;
  if (typeof window._anAnalyzeProjectSource !== 'function') return;
  _astAnalysisInflight[projectName] = true;
  try {
    const targetPaths = Array.from(new Set((_astCurrentNodes || []).map(n => n.path).filter(Boolean))).slice(0, 350);
    const docs = [];
    await Promise.all(targetPaths.map(async relPath => {
      try {
        const uri = `${projectName}:${relPath}`;
        const res = await fetch('/api/context/code/read?uri=' + encodeURIComponent(uri));
        if (!res.ok) return;
        const doc = await res.json();
        docs.push({ path: relPath, language: doc.language || '', content: doc.content || '' });
      } catch (e) { /* ignore per-file errors */ }
    }));
    _astAnalysisByProject[projectName] = window._anAnalyzeProjectSource(_astCurrentNodes || [], docs);
  } catch (e) {
    _astAnalysisByProject[projectName] = {
      summary: { filesAnalyzed: 0, totalFindings: 0, by_category: {}, by_severity: {} },
      findings: [],
      topFindings: [],
      error: String(e && e.message ? e.message : e),
    };
  } finally {
    delete _astAnalysisInflight[projectName];
    const astPanel = document.getElementById('ctx-panel-ast');
    if (_astSelectedProject === projectName && astPanel && astPanel.style.display !== 'none') {
      _renderAstView();
    }
  }
}

// ── Viewer shell: toggle bar ──────────────────────────────────────────────────

function _renderAstModal(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border);background:rgba(0,0,0,0.3);flex-shrink:0;flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🌳 ${_escHtml(_astSelectedProject || 'Project AST')}</div>
          <div style="font-family:var(--font-mono);font-size:0.48rem;color:var(--text-dim);margin-top:2px;">${(_astCurrentNodes || []).length} AST nodes</div>
        </div>
        <button id="ast-toggle-overview"
          onclick="_setAstView('overview')"
          style="padding:4px 14px;border-radius:6px;font-size:0.65rem;font-weight:600;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text-dim);transition:all 0.15s;"
          title="Project overview">
          📁
        </button>
        <button id="ast-toggle-complexity"
          onclick="_setAstView('complexity')"
          style="padding:4px 14px;border-radius:6px;font-size:0.65rem;font-weight:600;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text-dim);transition:all 0.15s;">
          🔥
        </button>
        <button id="ast-toggle-tree"
          onclick="_setAstView('tree')"
          style="padding:4px 14px;border-radius:6px;font-size:0.65rem;font-weight:600;cursor:pointer;border:1px solid var(--cyan);background:var(--cyan);color:#000;transition:all 0.15s;">
          🌳
        </button>
        <button id="ast-toggle-radial"
          onclick="_setAstView('radial')"
          style="padding:4px 14px;border-radius:6px;font-size:0.65rem;font-weight:600;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text-dim);transition:all 0.15s;">
          ◎
        </button>
        <button id="ast-toggle-cluster"
          onclick="_setAstView('cluster')"
          style="padding:4px 14px;border-radius:6px;font-size:0.65rem;font-weight:600;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text-dim);transition:all 0.15s;">
          ✦
        </button>
        <span style="width:1px;height:14px;background:var(--border);margin:0 4px;flex-shrink:0;"></span>
        <div id="ast-limit-bar" style="display:inline-flex;align-items:center;gap:3px;flex-shrink:0;"></div>
        <span style="flex:1;"></span>
        ${_renderAstTypeaheadSearch()}
        ${_renderAstSearchRecovery()}
      </div>
      <div id="ast-modal-view-area" style="flex:1;min-height:0;overflow:hidden;"></div>
    </div>
  `;
  _setAstView(_astViewMode);
}

function _setAstView(mode) {
  _astViewMode = mode;
  const overviewBtn = document.getElementById('ast-toggle-overview');
  const treeBtn    = document.getElementById('ast-toggle-tree');
  const compBtn    = document.getElementById('ast-toggle-complexity');
  const radialBtn  = document.getElementById('ast-toggle-radial');
  const clusterBtn = document.getElementById('ast-toggle-cluster');
  const _style     = (btn, active, activeColor) => {
    if (!btn) return;
    btn.style.background  = active ? activeColor : 'transparent';
    btn.style.color       = active ? '#000'       : 'var(--text-dim)';
    btn.style.borderColor = active ? activeColor  : 'var(--border)';
  };
  _style(overviewBtn, mode === 'overview', '#facc15');
  _style(treeBtn,    mode === 'tree',       'var(--cyan)');
  _style(compBtn,    mode === 'complexity', '#f97316');
  _style(radialBtn,  mode === 'radial',     '#a78bfa');
  _style(clusterBtn, mode === 'cluster',    '#34d399');
  _renderAstView();
}

function _renderAstView() {
  const area = document.getElementById('ast-modal-view-area');
  if (!area || !_astCurrentNodes) return;
  const analysis = _astCurrentAnalysis();
  if (_astViewMode === 'overview') {
    area.style.overflowY = 'auto';
    area.style.overflowX = 'hidden';
    _clearAstLimitBar();
    const project = _astProjects.find(p => p.name === _astSelectedProject);
    if (!project) {
      area.innerHTML = `<div class="ctx-welcome" style="padding:60px 20px;">
        <div style="font-size:2rem;margin-bottom:12px;">📁</div>
        <div>No project selected</div>
      </div>`;
      return;
    }
    ctxRenderProjectOverview(area, project, _ctxLastIndexStatus || {}, {
      actionsOnlyHeader: true,
      hideStatusText: true,
      hideProgressText: true,
      hideAstStatusText: true,
      complexityNodes: _astCurrentNodes || [],
      analysis,
    });
    return;
  }
  area.style.overflow = 'hidden';
  const hasAstNodes = (_astCurrentNodes || []).length > 0;
  const nodes = _filterAstNodesForSearch(_astCurrentNodes);
  if (!hasAstNodes) {
    _clearAstLimitBar();
    area.innerHTML = `<div class="ctx-welcome" style="padding:60px 20px;">
      <div style="font-size:2rem;margin-bottom:12px;">🌳</div>
      <div>No AST data for ${_escHtml(_astSelectedProject || 'this project')}</div>
      <div style="color:var(--text-dim);font-size:0.55rem;margin-top:6px;">Use Overview actions to run AST generation, then switch back to a visualization</div>
    </div>`;
    return;
  }
  _syncAstSearchRecovery(nodes.length);
  if (_astSearchQuery && !nodes.length) {
    _renderAstNoSearchResults(area);
    return;
  }
  if (_astViewMode === 'tree') {
    const totalFiles = _countUniqueFiles(nodes);
    _updateAstLimitBar('tree', totalFiles, _treeFileLimit);
    area.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
        <div id="tree-render-host" style="flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;">
          <span style="color:var(--text-dim);font-size:0.75rem;">Building tree…</span>
        </div>
      </div>`;
    window._astTreeRerender = newLimit => { _treeFileLimit = newLimit; _syncAstView(); };
    setTimeout(() => {
      const host = document.getElementById('tree-render-host');
      if (!host) return;
      host.style.display = 'block';
      const limited = _limitNodesByFile(nodes, _treeFileLimit);
      ctxRenderD3Tree(_buildUnifiedAstTree(limited), host, false, 3);
    }, 20);
  } else if (_astViewMode === 'radial') {
    _clearAstLimitBar();
    area.innerHTML = '<div id="ast-view-render-host" style="height:100%;overflow:hidden;"></div>';
    const host = document.getElementById('ast-view-render-host');
    if (!host) return;
    _renderComplexityRadial(nodes, host);
  } else if (_astViewMode === 'cluster') {
    const totalFiles = _countUniqueFiles(nodes);
    _updateAstLimitBar('cluster', totalFiles, _clusterFileLimit);
    area.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
        <div id="cluster-render-host" style="flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;">
          <span style="color:var(--text-dim);font-size:0.75rem;">Building cluster…</span>
        </div>
      </div>`;
    window._astClusterRerender = newLimit => { _clusterFileLimit = newLimit; _syncAstView(); };
    setTimeout(() => {
      const host = document.getElementById('cluster-render-host');
      if (!host) return;
      host.style.display = 'block';
      const limited = _limitNodesByFile(nodes, _clusterFileLimit);
      _renderRadialClusterTree(_buildUnifiedAstTree(limited), host);
    }, 20);
  } else {
    _clearAstLimitBar();
    area.innerHTML = '<div id="ast-view-render-host" style="height:100%;overflow:hidden;"></div>';
    const host = document.getElementById('ast-view-render-host');
    if (!host) return;
    window._ctxCurrentAstAnalysis = analysis;
    _renderComplexityHeatmap(nodes, host);
  }
}

function _renderAstNoSearchResults(area) {
  const cid = 'ast-empty-' + Math.random().toString(36).substr(2, 9);
  const msg = `
    <div style="height:100%;min-height:260px;display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;color:var(--text-dim);font-size:0.68rem;line-height:1.7;">
      <div style="max-width:420px;">
        <div style="font-size:1.8rem;margin-bottom:10px;opacity:0.55;">⌕</div>
        <div>No AST nodes match "${_escHtml(_astSearchQuery)}"</div>
        <button class="ctx-btn-sm" onclick="astClearSearchQuery()" style="margin-top:12px;background:var(--cyan);color:#001018;border-color:var(--cyan);">Clear search</button>
      </div>
    </div>`;
  area.innerHTML = _renderAstInteractiveLegend(cid) + msg;
}

function _filterAstNodesForSearch(nodes) {
  const q = (_astSearchQuery || '').trim().toLowerCase();
  if (!q) return nodes;
  const selected = _astSelectedSearchNode(nodes);
  if (selected) {
    return nodes.filter(n => _astNodeSearchKey(n) === _astNodeSearchKey(selected) || _astIsNestedAstNode(selected, n));
  }
  return nodes.filter(n => [
    n.name,
    n.node_type,
    n.path,
    n.repo,
    n.start_line != null ? `l${n.start_line}` : '',
  ].some(v => (v || '').toString().toLowerCase().includes(q)));
}

function astSetSearchQuery(value) {
  _astSearchQuery = value || '';
  _astSearchSelectionKey = '';
  const selected = _astSelectedSearchNode(_astCurrentNodes || []);
  _astSearchSelectionKey = selected ? _astNodeSearchKey(selected) : '';
  _renderAstView();
  setTimeout(() => {
    const input = document.getElementById('ast-view-search');
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 0);
}

function astClearSearchQuery() {
  _astSearchQuery = '';
  _astSearchSelectionKey = '';
  _syncAstSearchRecovery(0);
  _renderAstView();
}

function _renderAstSearchRecovery() {
  return `
    <div id="ast-search-recovery" style="display:none;align-items:center;gap:8px;margin-left:4px;padding:0;font-family:var(--font-mono);">
      <span id="ast-search-recovery-text" style="font-size:0.52rem;color:var(--text-dim);white-space:nowrap;"></span>
      <button class="ctx-btn-sm" onclick="astClearSearchQuery()" style="font-size:0.5rem;background:var(--cyan);color:#001018;border-color:var(--cyan);">Clear search</button>
    </div>`;
}

function _syncAstSearchRecovery(matchCount) {
  const el = document.getElementById('ast-search-recovery');
  if (!el) return;
  const text = document.getElementById('ast-search-recovery-text');
  const hasQuery = !!(_astSearchQuery || '').trim();
  el.style.display = hasQuery ? 'flex' : 'none';
  if (text && hasQuery) {
    const countText = matchCount === 0 ? 'no matches' : `${matchCount} match${matchCount === 1 ? '' : 'es'}`;
    text.textContent = countText;
  }
}

function _astNodeSearchKey(n) {
  if (!n) return '';
  return [n.repo || '', n.path || '', n.node_type || '', n.name || '', n.start_line ?? '', n.end_line ?? ''].join('::');
}

function _astSearchOptionLabel(n) {
  const line = n && n.start_line != null ? ` · L${n.start_line}${n.end_line != null ? `-${n.end_line}` : ''}` : '';
  return `${n.name || '(anonymous)'} · ${n.node_type || 'node'} · ${n.path || ''}${line}`;
}

function _astTypeaheadOptions(nodes = _astCurrentNodes || []) {
  const seen = new Set();
  return (nodes || []).reduce((acc, n) => {
    const key = _astNodeSearchKey(n);
    if (!key || seen.has(key)) return acc;
    seen.add(key);
    acc.push({ key, label: _astSearchOptionLabel(n), node: n });
    return acc;
  }, []).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 200);
}

function _astSelectedSearchNode(nodes = _astCurrentNodes || []) {
  const q = (_astSearchQuery || '').trim();
  if (!q) return null;
  const options = _astTypeaheadOptions(nodes);
  if (_astSearchSelectionKey) {
    const byKey = options.find(o => o.key === _astSearchSelectionKey);
    if (byKey) return byKey.node;
  }
  const exact = options.find(o => o.label === q);
  return exact ? exact.node : null;
}

function _astIsNestedAstNode(parent, child) {
  if (!parent || !child || parent.repo !== child.repo || parent.path !== child.path) return false;
  if (parent.start_line == null || parent.end_line == null || child.start_line == null || child.end_line == null) return false;
  return child.start_line >= parent.start_line && child.end_line <= parent.end_line;
}

function _astShowSearchDrop(input) {
  const drop = document.getElementById('ast-search-dropdown');
  if (!drop) return;
  const q = (input.value || '').trim().toLowerCase();
  const opts = _astTypeaheadOptions();
  const filtered = q ? opts.filter(o => o.label.toLowerCase().includes(q)) : opts;
  if (!filtered.length) { drop.style.display = 'none'; return; }
  drop.innerHTML = filtered.slice(0, 60).map(o => {
    const key = o.key.replace(/"/g, '&quot;');
    const lbl = o.label.replace(/"/g, '&quot;');
    return `<div onclick="_astSelectSearchOption(&quot;${key}&quot;,&quot;${lbl}&quot;)"
      style="padding:5px 10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);
             white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text);"
      onmouseenter="this.style.background='rgba(255,255,255,0.08)'"
      onmouseleave="this.style.background=''">
      ${_escHtml(o.label)}
    </div>`;
  }).join('');
  drop.style.display = 'block';
}

function _astHideSearchDrop() {
  const drop = document.getElementById('ast-search-dropdown');
  if (drop) drop.style.display = 'none';
}

function _astSelectSearchOption(key, label) {
  _astSearchSelectionKey = key;
  _astSearchQuery = label;
  const input = document.getElementById('ast-view-search');
  if (input) input.value = label;
  _astHideSearchDrop();
  _renderAstView();
}

function _renderAstTypeaheadSearch() {
  return `
    <div style="position:relative;display:flex;align-items:center;gap:5px;">
      <input id="ast-view-search" type="text" value="${_escHtml(_astSearchQuery)}" autocomplete="off"
        oninput="astSetSearchQuery(this.value);_astShowSearchDrop(this)"
        onfocus="_astShowSearchDrop(this)"
        onblur="setTimeout(_astHideSearchDrop, 200)"
        onkeydown="if(event.key==='Escape'){astClearSearchQuery();_astHideSearchDrop()}"
        placeholder="Search nodes…"
        style="width:200px;background:var(--bg-main);color:var(--text);border:1px solid var(--border);
               border-radius:5px;padding:4px 8px;font-family:var(--font-mono);font-size:0.58rem;">
      ${_astSearchQuery ? `<button class="ctx-btn-sm" onclick="astClearSearchQuery()" style="font-size:0.5rem;padding:2px 6px;">✕</button>` : ''}
      <div id="ast-search-dropdown"
           style="display:none;position:absolute;top:calc(100% + 3px);right:0;width:360px;max-height:260px;
                  overflow-y:auto;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;
                  z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.5);font-family:var(--font-mono);font-size:0.58rem;">
      </div>
    </div>`;
}

// ── Hierarchical tree builder for D3 ─────────────────────────────────────────

/**
 * Returns count of unique file paths in a flat node list.
 */
function _countUniqueFiles(nodes) {
  const s = new Set();
  for (const n of nodes) s.add((n.repo || '') + '::' + (n.path || ''));
  return s.size;
}

/**
 * Pre-filters nodes to the top N files by node count (descending).
 * Keeps ALL node types so the tree hierarchy is accurate.
 */
function _limitNodesByFile(nodes, limit) {
  if (limit === 'all') return nodes;
  const counts = {};
  for (const n of nodes) {
    const k = (n.repo || '') + '::' + (n.path || '');
    counts[k] = (counts[k] || 0) + 1;
  }
  const topKeys = new Set(
    Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(e => e[0])
  );
  return nodes.filter(n => topKeys.has((n.repo || '') + '::' + (n.path || '')));
}

/**
 * Populates the #ast-limit-bar in the top header with FILES + limit buttons + optional Labels toggle + capNote.
 * Called whenever the view switches or a new limit is selected.
 */
function _updateAstLimitBar(mode, totalFiles, currentLimit) {
  const bar = document.getElementById('ast-limit-bar');
  if (!bar) return;
  const limited = currentLimit !== 'all';
  const cap = limited ? Math.min(currentLimit, totalFiles) : totalFiles;
  const capNote = totalFiles > cap
    ? `<span style="font-size:0.55rem;color:var(--text-dim);">Top ${cap} of ${totalFiles}</span>`
    : `<span style="font-size:0.55rem;color:var(--text-dim);">${totalFiles} files</span>`;
  const opts = [500, 1000, 1500, 'all'];
  const btns = opts.map(v => {
    const active = (v === 'all' && !limited) || v === currentLimit;
    const warn   = v === 'all' && totalFiles > 1500 ? '⚠' : '';
    let onclick;
    if (mode === 'tree')    onclick = `window._astTreeRerender&&window._astTreeRerender(${v === 'all' ? "'all'" : v})`;
    else if (mode === 'cluster') onclick = `window._astClusterRerender&&window._astClusterRerender(${v === 'all' ? "'all'" : v})`;
    else                    onclick = `window._astRadialRerender&&window._astRadialRerender(${v === 'all' ? "'all'" : v})`;
    return `<button onclick="${onclick}"
      style="padding:2px 7px;border-radius:4px;border:1px solid ${active ? '#a78bfa' : 'var(--border)'};
             background:${active ? 'rgba(167,139,250,0.18)' : 'transparent'};
             color:${active ? '#a78bfa' : 'var(--text-dim)'};font-size:0.6rem;cursor:pointer;"
      >${v}${warn}</button>`;
  }).join('');
  const labelBtn = mode === 'tree' ? `
    <span style="width:1px;height:12px;background:var(--border);margin:0 2px;flex-shrink:0;"></span>
    <button id="tree-labels-btn" onclick="window._astTreeToggleLabels&&window._astTreeToggleLabels()"
      style="padding:2px 7px;border-radius:4px;border:1px solid ${_treeShowLabels ? '#22d3ee' : 'var(--border)'};
             background:${_treeShowLabels ? 'rgba(34,211,238,0.18)' : 'transparent'};
             color:${_treeShowLabels ? '#22d3ee' : 'var(--text-dim)'};font-size:0.6rem;cursor:pointer;">Labels</button>
  ` : '';
  bar.innerHTML = `
    <span style="font-size:0.55rem;color:var(--text-dim);opacity:0.55;margin-right:2px;flex-shrink:0;">FILES</span>
    ${btns}
    ${labelBtn}
    <span style="width:1px;height:12px;background:var(--border);margin:0 4px;flex-shrink:0;"></span>
    ${capNote}
  `;
}

function _clearAstLimitBar() {
  const bar = document.getElementById('ast-limit-bar');
  if (bar) bar.innerHTML = '';
}


function _buildUnifiedAstTree(nodes) {
  const root = { name: "Context AST", type: "root", children: [] };
  const repoNodes = {};
  nodes.forEach(n => {
    if (!repoNodes[n.repo]) {
      repoNodes[n.repo] = { name: n.repo, type: "repo", children: [], childrenMap: {} };
      root.children.push(repoNodes[n.repo]);
    }
    const repoRoot = repoNodes[n.repo];
    const pathParts = n.path.split('/');
    let current = repoRoot;
    for (let i = 0; i < pathParts.length; i++) {
      const part   = pathParts[i];
      const isFile = (i === pathParts.length - 1);
      if (!current.childrenMap[part]) {
        const newNode = { name: part, type: isFile ? "file" : "dir", children: [], childrenMap: {}, astNodes: [] };
        current.children.push(newNode);
        current.childrenMap[part] = newNode;
      }
      current = current.childrenMap[part];
    }
    current.astNodes.push(n);
  });

  const finalizeAst = (node) => {
    if (node.type === 'file' && node.astNodes.length) {
      const astNodes = node.astNodes;
      astNodes.sort((a, b) => (a.start_line - b.start_line) || (b.end_line - a.end_line));
      const fileRoot = { name: node.name, type: 'file', children: [], start_line: 0, end_line: 9999999 };
      const stack = [fileRoot];
      astNodes.forEach(an => {
        while (stack.length > 1) {
          const parent = stack[stack.length - 1];
          if (an.start_line >= parent.start_line && an.end_line <= parent.end_line) break;
          stack.pop();
        }
        const parent  = stack[stack.length - 1];
        const newNode = { name: an.name, type: an.node_type, line: an.start_line, start_line: an.start_line, end_line: an.end_line, children: [] };
        parent.children.push(newNode);
        stack.push(newNode);
      });
      node.children = fileRoot.children;
    }
    if (node.children) {
      node.children.forEach(finalizeAst);
      delete node.childrenMap;
      delete node.astNodes;
    }
  };
  finalizeAst(root);
  return root;
}


// ── D3 collapsible tree renderer ──────────────────────────────────────────────

// ── AST Interaction Helpers ───────────────────────────────────────────────────

/**
 * Depth-based collapse used for default initial state (e.g. "show up to class level").
 */
function _collapseAstToDepth(rootNode, targetType, updateFn) {
  const TYPE_LEVELS = { root:-1, repo:0, dir:1, file:2, class:3, function:4, method:4, variable:5 };
  const targetLvl = TYPE_LEVELS[targetType] ?? 99;

  rootNode.descendants().forEach(d => {
    let lvl = TYPE_LEVELS[d.data.type] ?? 99;
    if (d.data.type === 'method') lvl = 4;

    if (lvl >= targetLvl && d.children) {
      d._children = d.children;
      d.children = null;
    } else if (lvl < targetLvl && d._children) {
      d.children = d._children;
      d._children = null;
    }
  });
  if (updateFn) updateFn(rootNode);
}

/**
 * Expand the tree so that every node of `targetType` is visible, along with
 * all ancestors leading to it.  The rule per branch:
 *
 *   • Recurse into children first (depth-first).
 *   • A target-type node is kept EXPANDED if any of its descendants is also
 *     the target type (e.g. class→class→class all stay visible).
 *   • A target-type node is COLLAPSED (children hidden) only when none of its
 *     descendants share the target type — it is the deepest occurrence in that path.
 *   • A non-target node is collapsed when no descendant is the target type.
 *
 * Examples  (targetType = 'class'):
 *   dir → class → class → class → fn   →  dir → class → class → class(collapsed)
 *   dir → class → fn                   →  dir → class(collapsed)
 *
 * Examples  (targetType = 'dir'):
 *   dir → dir → class → fn             →  dir → dir(collapsed)
 *   dir → class → fn                   →  dir(collapsed)
 */
function _expandToType(rootNode, targetType, updateFn) {
  // Step 1 — fully expand the whole tree
  rootNode.descendants().forEach(d => {
    if (d._children) { d.children = d._children; d._children = null; }
  });

  // Step 2 — recurse depth-first; returns true if subtree contains targetType
  function pruneAndCheck(d) {
    const isTarget = d.data.type === targetType;

    if (!d.children || !d.children.length) {
      // Leaf — visible only if it IS the target
      return isTarget;
    }

    // Recurse into all children first
    let anyTargetBelow = false;
    for (const c of d.children) {
      if (pruneAndCheck(c)) anyTargetBelow = true;
    }

    if (isTarget) {
      if (!anyTargetBelow) {
        // This is the deepest target in this path — collapse its children
        d._children = d.children;
        d.children  = null;
      }
      // else: keep expanded so nested targets remain visible
      return true;
    } else {
      if (!anyTargetBelow) {
        // Dead end — collapse this whole branch
        d._children = d.children;
        d.children  = null;
      }
      return anyTargetBelow;
    }
  }

  pruneAndCheck(rootNode);
  if (updateFn) updateFn(rootNode);
}

function _showAstDrawer(d, drawerId, onCloseName = '', onToggleName = '') {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  _setAstDrawerOpen(drawerId, true);

  const path = [];
  let curr = d;
  while(curr) {
    if (curr.data.name !== 'Context AST' && curr.data.type !== 'root') path.unshift(curr.data.name);
    curr = curr.parent;
  }
  const typeColors = { repo: '#22d3ee', dir: '#a78bfa', file: '#4ade80', function: '#fb923c', method: '#fb923c', class: '#f43f5e' };
  const c = typeColors[d.data.type] || '#94a3b8';

  const ignoreKeys = ['children', 'astNodes', 'childrenMap', 'name', 'type', 'start_line', 'end_line', 'line'];
  const props = Object.entries(d.data).filter(([k]) => !ignoreKeys.includes(k))
    .map(([k,v]) => `<div style="display:flex;margin-bottom:4px;"><span style="color:var(--text-dim);width:70px;">${k}:</span> <span style="font-family:var(--font-mono);word-break:break-all;">${v}</span></div>`)
    .join('');

  let lineInfo = '';
  if (d.data.line || d.data.start_line) {
    lineInfo = `L${d.data.start_line || d.data.line}${d.data.end_line ? `–${d.data.end_line}` : ''}`;
  }

  const typeIcon = { repo: '📦', dir: '📁', file: '📄', class: '🏛️', function: 'λ', method: '◆' }[d.data.type] || '❓';
  const hasKids  = !!(d.children || d._children);
  const isExpanded = !!d.children;
  const hasFocusAction = !!window._astFocusNode;
  const childNodes = (d.children || d._children || []).slice().sort((a, b) => {
    const an = (a.data && a.data.name) || '';
    const bn = (b.data && b.data.name) || '';
    return an.localeCompare(bn);
  });

  let childrenHtml = '';
  if (childNodes.length) {
    childrenHtml = childNodes.map(child => {
      const childType = child.data.type || 'node';
      const childIcon = _astNodeIcon(childType);
      const childColor = _astNodeColor(childType);
      const childLine = child.data.line || child.data.start_line ? `L${child.data.start_line || child.data.line}${child.data.end_line ? `–${child.data.end_line}` : ''}` : '';
      return `<button onclick="window._astClusterJumpToNode && window._astClusterJumpToNode('${drawerId}', ${child._id})"
        style="width:100%;display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;background:var(--bg-main);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;text-align:left;"
        onmouseover="this.style.borderColor='${childColor}'" onmouseout="this.style.borderColor='var(--border)'">
        <span style="font-size:0.75rem;flex-shrink:0;">${childIcon}</span>
        <span style="flex:1;min-width:0;">
          <span style="display:block;font-size:0.55rem;font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escHtml(child.data.name)}</span>
          <span style="display:block;font-size:0.42rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;">${_escHtml(childType)}${childLine ? ` · ${_escHtml(childLine)}` : ''}</span>
        </span>
      </button>`;
    }).join('');
  }

  drawer.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin:-16px -16px 14px;border-bottom:1px solid var(--border);position:sticky;top:-16px;background:var(--bg-card);z-index:5;">
      <span style="font-size:0.45rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);font-family:var(--font-mono);">Node Detail</span>
      <div style="display:flex;align-items:center;gap:4px;">
        ${onToggleName && hasKids ? `<button onclick="${onToggleName}()" title="${isExpanded ? 'Collapse' : 'Expand'} node"
          style="background:none;border:1px solid var(--border);border-radius:3px;color:var(--text-dim);cursor:pointer;font-size:0.65rem;line-height:1;padding:2px 5px;"
          onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-dim)'">${isExpanded ? '⊖' : '⊕'}</button>` : ''}
        ${onCloseName ? `<button onclick="${onCloseName}()" title="Close panel"
          style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:0.9rem;line-height:1;padding:2px 4px;border-radius:3px;"
          onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-dim)'">‹</button>` : ''}
      </div>
    </div>
    <div style="margin-bottom:8px;">
      <span title="AST node type" style="cursor:default;display:inline-block;padding:2px 8px;font-size:0.4rem;font-family:var(--font-mono);background:${c}22;border:1px solid ${c}55;border-radius:10px;color:${c};letter-spacing:0.5px;">${_escHtml(d.data.type || 'node')}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <span style="font-size:1.2rem;">${typeIcon}</span>
      <div style="flex:1;">
        <div style="font-size:0.7rem;font-weight:bold;color:${c};word-break:break-word;">${_escHtml(d.data.name)} ${lineInfo ? `<span style="color:var(--text-dim);font-size:0.6rem;font-weight:normal;margin-left:4px;">${lineInfo}</span>` : ''}</div>
        <div style="font-size:0.5rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">${d.data.type}</div>
      </div>
    </div>

    <div class="kb-detail-section">
      <h5>Hierarchy Path</h5>
      <div style="font-family:var(--font-mono);opacity:0.8;font-size:0.55rem;line-height:1.4;">
        ${path.map(p => _escHtml(p)).join(' <span style="color:var(--cyan);opacity:0.5;">→</span> ')}
      </div>
    </div>

    ${props ? `
    <div class="kb-detail-section">
      <h5>Properties</h5>
      <div style="font-size:0.6rem;background:var(--bg-main);padding:8px;border-radius:4px;color:var(--text-dim);">
         ${props}
      </div>
    </div>` : ''}

    ${hasFocusAction ? `
    <div class="kb-detail-section">
      <h5>Actions</h5>
      <button onclick="window._astFocusNode('${drawerId}', ${d._id})"
        style="width:100%;padding:7px 10px;background:rgba(0,230,200,0.12);border:1px solid rgba(0,230,200,0.35);border-radius:4px;color:var(--cyan);cursor:pointer;font-family:var(--font-mono);font-size:0.55rem;text-align:left;">
        Focus
      </button>
    </div>` : ''}

    <div class="kb-detail-section">
       <h5>Descendants</h5>
       <div style="font-size:0.55rem;color:var(--text-dim);">${d.descendants().length - 1} nested child nodes</div>
    </div>

    <div class="kb-detail-section">
      <h5>Children</h5>
      ${childrenHtml || '<div style="font-size:0.55rem;color:var(--text-dim);">No child nodes</div>'}
    </div>
  `;
}

function _setAstDrawerOpen(drawerId, open) {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  drawer.style.transition = 'width 0.2s ease,min-width 0.2s ease,padding 0.2s ease';
  drawer.style.display = 'block';
  if (open) {
    drawer.style.width = '320px';
    drawer.style.minWidth = '280px';
    drawer.style.padding = '16px';
    drawer.style.borderLeft = '1px solid var(--border)';
    drawer.style.overflowY = 'auto';
  } else {
    drawer.style.width = '0px';
    drawer.style.minWidth = '0px';
    drawer.style.padding = '0';
    drawer.style.borderLeft = 'none';
    drawer.style.overflow = 'hidden';
  }
}

function _astAllDescendants(root) {
  const out = [];
  const visit = node => {
    out.push(node);
    [...(node.children || []), ...(node._children || [])].forEach(visit);
  };
  visit(root);
  return out;
}

function _astExpandSubtree(node) {
  if (!node) return;
  if (node._children) {
    node.children = node._children;
    node._children = null;
  }
  (node.children || []).forEach(_astExpandSubtree);
}

function _astReadablePath(d) {
  const parts = [];
  let curr = d;
  while (curr) {
    if (curr.data.type !== 'root' && curr.data.name !== 'Context AST') parts.unshift(curr.data.name);
    curr = curr.parent;
  }
  return parts.join(' / ');
}

function _astNodeColor(type) {
  const map = { repo: '#22d3ee', dir: '#a78bfa', file: '#4ade80', function: '#fb923c', method: '#fb923c', class: '#f43f5e' };
  return map[type] || '#94a3b8';
}

function _astNodeIcon(type) {
  return { repo: '📦', dir: '📁', file: '📄', class: '🏛️', function: 'λ', method: '◆', root: '🌳' }[type] || '•';
}

function _renderAstEmptyDrawer(drawerId, title, body) {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  _setAstDrawerOpen(drawerId, true);
  drawer.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin:-16px -16px 14px;border-bottom:1px solid var(--border);position:sticky;top:-16px;background:var(--bg-card);z-index:5;">
      <span style="font-size:0.45rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);font-family:var(--font-mono);">${_escHtml(title)}</span>
    </div>
    <div style="text-align:center;padding:34px 10px;color:var(--text-dim);font-size:0.6rem;line-height:1.7;">${body}</div>
  `;
}

function _renderAstInteractiveLegend(cid) {
  return `
    <div style="display:flex;gap:16px;padding:8px 16px;font-size:0.58rem;color:var(--text-dim);align-items:center;border-bottom:1px solid var(--border);flex-wrap:wrap;background:rgba(0,0,0,0.15);">
      <span style="font-weight:600;color:var(--text);">Depth filter:</span>
      ${['repo', 'dir', 'file', 'class', 'function'].map(type => {
        const typeColors = { repo: '#22d3ee', dir: '#a78bfa', file: '#4ade80', class: '#f43f5e', function: '#fb923c' };
        const color = typeColors[type];
        return `<span class="ast-leg-btn" onclick="window._astLegClick('${cid}', '${type}')" style="display:flex;align-items:center;gap:4px;cursor:pointer;padding:2px 6px;border-radius:4px;transition:background 0.1s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background=''">
          <span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block;"></span> ${type}
        </span>`;
      }).join('')}
    </div>`;
}

window._astActiveDrawMap = {};
window._astLegClick = function(cid, type) {
  const meta = window._astActiveDrawMap[cid];
  if (meta) _expandToType(meta.root, type, meta.draw);
};
window._astJumpToNode = function(drawerId, nodeId) {
  const cid = drawerId.replace(/-drawer$/, '');
  const meta = window._astActiveDrawMap[cid];
  if (!meta || !meta.root) return;
  const target = meta.root.descendants().find(n => n._id === nodeId);
  if (!target) return;
  _showAstDrawer(target, drawerId, meta.closeName || '', meta.toggleName || '');
};
window._astFocusNode = function(drawerId, nodeId) {
  const cid = drawerId.replace(/-drawer$/, '');
  const meta = window._astActiveDrawMap[cid];
  if (!meta || !meta.root) return;
  const target = meta.root.descendants().find(n => n._id === nodeId);
  if (!target) return;

  // Keep the selected node and its descendants visible, but remove everything else.
  _astExpandSubtree(target);

  // Re-root the visible scope at the selected node.
  if (typeof meta.draw === 'function') meta.draw(target, true);
  meta.root = target;
  window._astClusterCloseDrawer = window._astClusterCloseDrawer || {};
  window._astClusterCollapseNode = window._astClusterCollapseNode || {};
  window._astClusterCollapseNode[cid] = () => {
    if (target.children)      { target._children = target.children;  target.children  = null; }
    else if (target._children){ target.children  = target._children; target._children = null; }
    if (typeof meta.draw === 'function') meta.draw(target);
    _showAstDrawer(target, drawerId, meta.closeName || '', meta.toggleName || '');
  };
  _showAstDrawer(target, drawerId, meta.closeName || '', meta.toggleName || '');
};
window._astClusterJumpToNode = window._astJumpToNode;
window._astClusterFocusNode = window._astFocusNode;


// ── Radial cluster tree ───────────────────────────────────────────────────────

function _renderRadialClusterTree(data, container) {
  const cid    = 'ast-cluster-' + Math.random().toString(36).substr(2, 9);
  const height = Math.round(container.clientHeight || window.innerHeight * 0.75);
  const width  = container.clientWidth  || 860;
  const drawerId = cid + '-drawer';

  container.innerHTML = _renderAstInteractiveLegend(cid) + `
    <div style="display:flex;height:${height - 43}px;">
      <div id="${cid}" style="flex:1;overflow:hidden;position:relative;"></div>
      <div id="${drawerId}" style="width:0;min-width:0;border-left:none;background:var(--bg-card);font-family:var(--font-mono);padding:0;overflow:hidden;display:block;flex-shrink:0;"></div>
    </div>
  `;

  // Provide initial time for grid mapping
  setTimeout(() => {
    const el = document.getElementById(cid);
    if (!el) return;
    const W  = el.clientWidth;
    const H  = el.clientHeight;
    const cx = W / 2;
    const cy = H / 2;

    const svg  = d3.select('#' + cid).append('svg').attr('width', W).attr('height', H);
    const zoom = d3.zoom().scaleExtent([0.08, 4]).on('zoom', e => gRoot.attr('transform', e.transform));
    svg.call(zoom);

    const gRoot = svg.append('g').attr('transform', `translate(${cx},${cy})`);
    const gLinks = gRoot.append('g').attr('fill', 'none').attr('stroke', 'rgba(148,163,184,0.22)').attr('stroke-width', 1.2);
    const gNodes = gRoot.append('g');

    let nodeId = 0;
    const hierRoot = d3.hierarchy(data);
    hierRoot.descendants().forEach(d => { d._id = ++nodeId; });
    let activeRoot = hierRoot;
    let selectedNodeId = null;
    window._astClusterCloseDrawer = window._astClusterCloseDrawer || {};

    function radialPoint(angle, r) {
      return [r * Math.cos(angle - Math.PI / 2), r * Math.sin(angle - Math.PI / 2)];
    }

    function zoomToScope(scopeRoot) {
      const nodes = scopeRoot.descendants();
      if (!nodes.length) return;
      const pts = nodes.map(n => radialPoint(n.x || 0, n.y || 0));
      const xs = pts.map(p => p[0]);
      const ys = pts.map(p => p[1]);
      const x0 = Math.min(...xs) - 60;
      const x1 = Math.max(...xs) + 60;
      const y0 = Math.min(...ys) - 60;
      const y1 = Math.max(...ys) + 60;
      const scale = Math.min(1.5, 0.86 / Math.max((x1 - x0) / Math.max(W, 1), (y1 - y0) / Math.max(H, 1)));
      svg.transition().duration(420)
        .call(zoom.transform, d3.zoomIdentity.translate(cx - scale * (x0 + x1) / 2, cy - scale * (y0 + y1) / 2).scale(scale));
    }

    function draw(source, reset = false) {
      const scopeRoot = activeRoot || hierRoot;
      const visCount = scopeRoot.descendants().length;
      const radius   = Math.max(120, Math.min(Math.max(W, H) * 0.42, visCount * 18));
      d3.tree()
        .size([2 * Math.PI, radius])
        .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(scopeRoot);

      const nodes = scopeRoot.descendants();
      const links = scopeRoot.links();
      if (reset) {
        gLinks.selectAll('path').remove();
        gNodes.selectAll('g.rc-node').remove();
      }

      const linkSel = gLinks.selectAll('path').data(links, d => d.target._id);
      const diagonal = d3.linkRadial().angle(d => d.x).radius(d => d.y);

      linkSel.enter().append('path')
        .attr('d', () => {
          const o = { x: source._x0 ?? source.x, y: source._y0 ?? source.y };
          return diagonal({ source: o, target: o });
        })
        .merge(linkSel)
        .transition().duration(280)
        .attr('stroke', d => _astNodeColor(d.target.data.type) + '55')
        .attr('d', diagonal);

      linkSel.exit().transition().duration(200)
        .attr('d', () => { const o = { x: source.x, y: source.y }; return diagonal({ source: o, target: o }); }).remove();

      const nodeSel = gNodes.selectAll('g.rc-node').data(nodes, d => d._id);

      const enter = nodeSel.enter().append('g')
        .attr('class', 'rc-node')
        .attr('transform', () => {
          const [x, y] = radialPoint(source._x0 ?? source.x, source._y0 ?? source.y);
          return `translate(${x},${y})`;
        })
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
          d._x0 = d.x; d._y0 = d.y;
          selectedNodeId = d._id;
          draw(d);
          // Collapse/expand is only triggered from inside the info drawer
          window._astClusterCollapseNode = window._astClusterCollapseNode || {};
          window._astClusterCollapseNode[cid] = () => {
            if (d.children)      { d._children = d.children;  d.children  = null; }
            else if (d._children){ d.children  = d._children; d._children = null; }
            draw(d);
          };
          _showAstDrawer(d, drawerId, `window._astClusterCloseDrawer['${cid}']`, `window._astClusterCollapseNode['${cid}']`);
        });

      enter.append('circle').attr('r', 0).attr('stroke-width', 1.5);
      enter.append('title');

      const merged = enter.merge(nodeSel);
      merged.transition().duration(280).attr('transform', d => { const [x, y] = radialPoint(d.x, d.y); return `translate(${x},${y})`; });

      merged.select('circle')
        .attr('r', d => d.depth === 0 ? 7 : (d._children ? 5 : 4))
        .attr('fill', d => _astNodeColor(d.data.type))
        .attr('fill-opacity', d => (d._children ? 0.35 : 0.9))
        .attr('stroke', d => d._id === selectedNodeId ? '#fff' : _astNodeColor(d.data.type))
        .attr('stroke-width', d => d._id === selectedNodeId ? 3 : 1.5);

      merged.each(function(d) { d3.select(this).select('title').text(d.data.name + (d.data.line ? ` · L${d.data.line}` : '')); });
      nodeSel.exit().transition().duration(200).attr('transform', () => { const [x, y] = radialPoint(source.x, source.y); return `translate(${x},${y})`; }).remove();
      nodes.forEach(d => { d._x0 = d.x; d._y0 = d.y; });
    }

    function clearClusterFilter() {
      activeRoot = hierRoot;
      selectedNodeId = null;
      _collapseAstToDepth(hierRoot, 'class');
      draw(hierRoot, true);
      zoomToScope(hierRoot);
      _setAstDrawerOpen(drawerId, false);
    }

    window._astClusterCloseDrawer[cid] = function() {
      selectedNodeId = null;
      _setAstDrawerOpen(drawerId, false);
      draw(activeRoot || hierRoot);
    };

    window._astActiveDrawMap[cid] = {
      root: hierRoot,
      draw: draw,
      closeName: `window._astClusterCloseDrawer['${cid}']`,
      toggleName: `window._astClusterCollapseNode['${cid}']`,
    };

    // Collapse to 'class' by default for cluster
    _collapseAstToDepth(hierRoot, 'class');
    draw(hierRoot);
    svg.call(zoom.transform, d3.zoomIdentity.translate(cx, cy).scale(0.72));
    _setAstDrawerOpen(drawerId, false);
  }, 10);
}

// ── D3 Collapsible Tree ───────────────────────────────────────────────────────

function ctxRenderD3Tree(data, container, isTab = false, expandDepth = 1) {
  const cid  = 'ast-tree-' + Math.random().toString(36).substr(2, 9);
  const containerHeight = isTab ? 'calc(100vh - 140px)' : '100%';
  const drawerId = cid + '-drawer';

  container.innerHTML = _renderAstInteractiveLegend(cid) + `
    <div style="display:flex;height:${containerHeight};">
      <div id="${cid}" style="flex:1;overflow:hidden;position:relative;"></div>
      <div id="${drawerId}" style="width:0;min-width:0;border-left:none;background:var(--bg-card);font-family:var(--font-mono);padding:0;overflow:hidden;display:block;flex-shrink:0;"></div>
    </div>
  `;

  setTimeout(() => {
    const el = document.getElementById(cid);
    if (!el) return;
    const width  = el.clientWidth;
    const height = el.clientHeight;

    const nodeColor = type => {
      const map = { repo: '#22d3ee', dir: '#a78bfa', file: '#4ade80', function: '#fb923c', method: '#fb923c', class: '#f43f5e' };
      return map[type] || '#94a3b8';
    };

    const svg = d3.select('#' + cid).append('svg').attr('width', width).attr('height', height);
    const g    = svg.append('g');
    const zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', e => g.attr('transform', e.transform));
    svg.call(zoom);

    const treeLayout = d3.tree().size([height - 80, width - 280]).separation((a, b) => (a.parent === b.parent ? 1 : 1.5));

    let i = 0;
    const hierRoot = d3.hierarchy(data);
    hierRoot.x0 = height / 2;
    hierRoot.y0 = 0;

    function draw(source, scopeRoot = hierRoot) {
      treeLayout(scopeRoot);
      const nodes = scopeRoot.descendants();
      const links = scopeRoot.links();
      nodes.forEach(d => { d.y = d.depth * 170; });

      const node = g.selectAll('g.node').data(nodes, d => d.id || (d.id = ++i));
      const nodeEnter = node.enter().append('g')
        .attr('class', 'node')
        .attr('transform', () => { const s = source || scopeRoot; return `translate(${s.y0 ?? 0},${s.x0 ?? 0})`; })
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
          // Collapse/expand is only triggered from inside the info drawer
          window._astTreeCloseDrawer = window._astTreeCloseDrawer || {};
          window._astTreeCloseDrawer[cid] = () => _setAstDrawerOpen(drawerId, false);
          window._astTreeCollapseNode = window._astTreeCollapseNode || {};
          window._astTreeCollapseNode[cid] = () => {
            if (d.children)      { d._children = d.children;  d.children  = null; }
            else if (d._children){ d.children  = d._children; d._children = null; }
            draw(d, scopeRoot);
          };
          _showAstDrawer(d, drawerId, `window._astTreeCloseDrawer['${cid}']`, `window._astTreeCollapseNode['${cid}']`);
        });

      nodeEnter.append('circle')
        .attr('r', 0)
        .attr('fill', d => nodeColor(d.data.type))
        .attr('stroke', d => nodeColor(d.data.type))
        .attr('stroke-width', 2)
        .attr('fill-opacity', d => (d._children ? 0.3 : 0.9));

      nodeEnter.append('text')
        .attr('class', 'node-label')
        .attr('dy', '0.32em')
        .attr('x', d => (d.children || d._children) ? -10 : 10)
        .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
        .attr('fill', 'rgba(255,255,255,0.85)')
        .attr('font-size', '10px')
        .attr('font-family', 'var(--font-mono)')
        .text(d => {
          const name = d.data.name || '';
          return name.length > 25 ? name.slice(0, 25) + '…' : name;
        });

      nodeEnter.append('title');

      const nodeUpdate = nodeEnter.merge(node);
      nodeUpdate.transition().duration(300).attr('transform', d => `translate(${d.y},${d.x})`);
      nodeUpdate.select('circle')
        .attr('r', 5)
        .attr('fill', d => nodeColor(d.data.type))
        .attr('fill-opacity', d => (d._children ? 0.35 : 0.9));
      nodeUpdate.select('text.node-label')
        .style('display', _treeShowLabels ? null : 'none');
      nodeUpdate.each(function(d) { d3.select(this).select('title').text(d.data.name + (d.data.line ? ` · L${d.data.line}` : '')); });

      node.exit().transition().duration(200)
        .attr('transform', () => { const s = source || scopeRoot; return `translate(${s.y ?? 0},${s.x ?? 0})`; })
        .remove().select('circle').attr('r', 0);

      const diagonal = d3.linkHorizontal().x(d => d.y).y(d => d.x);
      const link  = g.selectAll('path.link').data(links, d => d.target.id);
      const linkEnter = link.enter().insert('path', 'g')
        .attr('class', 'link')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(148,163,184,0.25)')
        .attr('stroke-width', 1.5)
        .attr('d', () => { const s = source || scopeRoot; const o = { x: s.x0 ?? 0, y: s.y0 ?? 0 }; return diagonal({ source: o, target: o }); });

      linkEnter.merge(link).transition().duration(300).attr('d', diagonal);
      link.exit().transition().duration(200)
        .attr('d', () => { const s = source || scopeRoot; const o = { x: s.x ?? 0, y: s.y ?? 0 }; return diagonal({ source: o, target: o }); }).remove();

      nodes.forEach(d => { d.x0 = d.x; d.y0 = d.y; });
    }

    window._astActiveDrawMap[cid] = {
      root: hierRoot,
      draw: draw,
      closeName: `window._astTreeCloseDrawer['${cid}']`,
      toggleName: `window._astTreeCollapseNode['${cid}']`,
    };

    // Register label toggle
    window._astTreeToggleLabels = () => {
      _treeShowLabels = !_treeShowLabels;
      d3.selectAll('#' + cid + ' text.node-label')
        .style('display', _treeShowLabels ? null : 'none');
      const btn = document.getElementById('tree-labels-btn');
      if (btn) {
        btn.style.borderColor = _treeShowLabels ? '#22d3ee' : 'var(--border)';
        btn.style.background = _treeShowLabels ? 'rgba(34,211,238,0.18)' : 'transparent';
        btn.style.color = _treeShowLabels ? '#22d3ee' : 'var(--text-dim)';
      }
    };

    // Collapse to 'function' by default for tree
    _collapseAstToDepth(hierRoot, 'function');
    draw(hierRoot, hierRoot);
    svg.call(zoom.transform, d3.zoomIdentity.translate(80, height / 2).scale(0.85));
  }, 10);
}
