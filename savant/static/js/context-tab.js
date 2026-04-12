// ── Context Tab ────────────────────────────────────────────────────────────

let _ctxInited = false;
let _ctxPollingTimer = null;
let _ctxLastIndexStatus = {};
let _ctxSelectedProject = null;  // name of currently selected project

async function ctxMcpTestConnection() { return _mcpTestConnection('context', 8093, 'ctx-mcp-dot', 'ctx-mcp-status-text'); }

async function ctxInit() {
  if (!_ctxInited) {
    _ctxInited = true;
    ctxMcpTestConnection();
    await ctxRefreshStatus();
  }
  await ctxLoadProjects();
  // If polling is already running, immediately render with last known status
  if (_ctxPollingTimer && Object.keys(_ctxLastIndexStatus).length) {
    ctxRenderProjectsWithProgress(_ctxLastIndexStatus);
  }
  // Auto-start polling if any projects are currently indexing
  if (_ctxProjects.some(p => p.status === 'indexing') && !_ctxPollingTimer) {
    ctxStartPolling();
  }
}

async function ctxRefreshStatus() {
  try {
    const [healthRes, statsRes] = await Promise.all([
      fetch('/api/context/health'),
      fetch('/api/context/stats').catch(() => ({ ok: false }))
    ]);
    if (healthRes.ok) {
      const h = await healthRes.json();
      const vecDot = document.getElementById('ctx-dot-vec');
      const modelDot = document.getElementById('ctx-dot-model');
      const vecOk = h.sqlite_vec && h.sqlite_vec.loaded;
      const modelDownloaded = h.model && h.model.downloaded;
      const modelLoaded = h.model && h.model.loaded;
      vecDot.className = 'ctx-dot ' + (vecOk ? 'ok' : 'off');
      document.getElementById('ctx-vec-ver').textContent = vecOk ? (h.sqlite_vec.version || '✓') : '✗';
      modelDot.className = 'ctx-dot ' + (modelLoaded ? 'ok' : modelDownloaded ? 'warn' : 'off');
      document.getElementById('ctx-model-status').textContent = modelLoaded ? 'Loaded' : modelDownloaded ? 'Ready' : 'Not found';
      if (h.counts) {
        document.getElementById('ctx-stat-repos').textContent = h.counts.repos || 0;
        document.getElementById('ctx-stat-files').textContent = h.counts.files || 0;
        document.getElementById('ctx-stat-chunks').textContent = h.counts.chunks || 0;
      }
    }
    if (statsRes.ok) {
      const s = await statsRes.json();
      if (s.counts) {
        document.getElementById('ctx-stat-repos').textContent = s.counts.repos || 0;
        document.getElementById('ctx-stat-files').textContent = s.counts.files || 0;
        document.getElementById('ctx-stat-chunks').textContent = s.counts.chunks || 0;
      }
    }
  } catch (e) { /* status bar just stays default */ }
}

function switchCtxPanel(panel) {
  document.querySelectorAll('.ctx-inner-tabs .savant-subtab').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  ['search', 'projects', 'memory', 'code'].forEach(p => {
    const el = document.getElementById('ctx-panel-' + p);
    if (el) el.style.display = p === panel ? 'block' : 'none';
  });
  if (panel === 'projects') ctxLoadProjects();
  if (panel === 'memory') ctxLoadMemory();
  if (panel === 'code') ctxLoadCode();
  if (panel === 'search') ctxPopulateRepoFilter();
}

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

function ctxRenderProjects() {
  ctxRenderProjectsWithProgress({});
}

function ctxPopulateRepoFilter() {
  const sel = document.getElementById('ctx-search-repo');
  const val = sel.value;
  sel.innerHTML = '<option value="">All Projects</option>' +
    _ctxProjects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  sel.value = val;
}

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
  } catch (e) {
    showToast('error', e.message);
  }
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
    // Refresh projects after a short delay to pick up new status
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

function ctxStartPolling() {
  if (_ctxPollingTimer) return;
  ctxLoadProjects();
  _ctxPollingTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/context/repos/indexing-status');
      if (!res.ok) return;
      const status = await res.json();
      _ctxLastIndexStatus = status;
      const anyActive = Object.values(status).some(s => s.status === 'indexing');

      const reposRes = await fetch('/api/context/repos');
      if (reposRes.ok) {
        const data = await reposRes.json();
        _ctxProjects = data.repos || data || [];
        // Only re-render if the context tab is visible
        if (document.getElementById('context-view').style.display !== 'none') {
          ctxRenderProjectsWithProgress(status);
          ctxRefreshStatus();
        }
      }

      if (!anyActive) {
        const stalled = Object.entries(status).filter(([, s]) => s.status === 'stalled');
        const errored = Object.entries(status).filter(([, s]) => s.status === 'error');
        const cancelled = Object.entries(status).filter(([, s]) => s.status === 'cancelled');
        clearInterval(_ctxPollingTimer);
        _ctxPollingTimer = null;
        _ctxLastIndexStatus = {};
        ctxLoadProjects();
        if (stalled.length) {
          const [name, info] = stalled[0];
          showToast('error', `Indexing stalled for "${name}": ${info.error || info.phase || 'No active worker'}`);
        } else if (errored.length) {
          const [name, info] = errored[0];
          showToast('error', `Indexing failed for "${name}": ${info.error || 'Unknown error'}`);
        } else if (cancelled.length) {
          showToast('info', 'Indexing stopped');
        } else {
          showToast('success', 'Indexing complete');
        }
      }
    } catch (e) { /* ignore */ }
  }, 1500);
}

function ctxRenderProjectsWithProgress(indexStatus) {
  const sidebar = document.getElementById('ctx-projects-list');
  if (!_ctxProjects.length) {
    sidebar.innerHTML = `<div class="ctx-welcome" style="padding:30px 14px;">
      <div style="font-size:1.4rem;margin-bottom:8px;">📁</div>
      <div style="font-size:0.6rem;">No projects yet</div>
    </div>`;
    document.getElementById('ctx-proj-detail').innerHTML = `<div class="ctx-welcome" style="padding:60px 20px;">
      <div style="font-size:2rem;margin-bottom:12px;">📁</div>
      <div>Add a project to get started</div>
    </div>`;
    return;
  }

  // Auto-select first if none selected
  if (!_ctxSelectedProject || !_ctxProjects.find(p => p.name === _ctxSelectedProject)) {
    _ctxSelectedProject = _ctxProjects[0].name;
  }

  // Render sidebar list
  sidebar.innerHTML = _ctxProjects.map(p => {
    const idx = indexStatus[p.name];
    const st = idx ? idx.status : (p.status || 'added');
    const stCls = st.toLowerCase();
    const isActive = p.name === _ctxSelectedProject;
    const fc = p.file_count || 0;
    const cc = p.chunk_count || 0;
    return `<div class="ctx-proj-row${isActive ? ' active' : ''}" onclick="ctxSelectProject('${_escHtml(p.name)}')">
      <div class="ctx-proj-row-name"><span class="ctx-proj-row-dot ${stCls}"></span> ${_escHtml(p.name)}</div>
      <div class="ctx-proj-row-meta">${fc} files · ${cc} chunks</div>
    </div>`;
  }).join('');

  // Render detail pane for selected project
  _ctxRenderDetail(indexStatus);
}

function ctxSelectProject(name) {
  _ctxSelectedProject = name;
  ctxRenderProjectsWithProgress(_ctxLastIndexStatus);
}

function _ctxRenderDetail(indexStatus) {
  const detail = document.getElementById('ctx-proj-detail');
  const p = _ctxProjects.find(pr => pr.name === _ctxSelectedProject);
  if (!p) {
    detail.innerHTML = `<div class="ctx-welcome" style="padding:60px 20px;">
      <div style="font-size:2rem;margin-bottom:12px;">👈</div>
      <div>Select a project</div>
    </div>`;
    return;
  }

  const idx = indexStatus[p.name];
  const liveStatus = idx ? idx.status : (p.status || 'added');
  const statusCls = liveStatus.toLowerCase();
  const isIndexing = statusCls === 'indexing';
  const pct = idx ? (idx.progress || 0) : 0;
  const filesDone = idx ? (idx.files_done || 0) : (p.file_count || 0);
  const chunksDone = idx ? (idx.chunks_done || 0) : (p.chunk_count || 0);
  const totalFiles = idx ? (idx.total || 0) : 0;
  const phase = idx ? (idx.phase || '') : '';
  const currentFile = idx ? (idx.current_file || '') : '';
  const errCount = idx ? (idx.errors || 0) : 0;
  const memBank = idx ? (idx.memory_bank || 0) : (p.memory_bank_count || 0);
  const codeFiles = (p.file_count || 0) - memBank;
  const langs = idx ? (idx.languages || {}) : (p.languages || {});
  const hasError = idx && idx.error;
  const eName = _escHtml(p.name);

  // Action buttons
  let actionBtns = '';
  if (isIndexing) {
    actionBtns = `<button class="ctx-btn-sm ctx-btn-danger" onclick="ctxStopIndexing('${eName}')">⏹ Stop Indexing</button>`;
  } else {
    actionBtns = `
      <button class="ctx-btn-sm" onclick="ctxIndexProject('${eName}')">⚡ Index</button>
      <button class="ctx-btn-sm" onclick="ctxReindexProject('${eName}')">🔄 Re-index</button>
      <button class="ctx-btn-sm ctx-btn-warn" onclick="ctxPurgeProject('${eName}')">🧹 Purge</button>
      <button class="ctx-btn-sm ctx-btn-danger" onclick="ctxDeleteProject('${eName}')">🗑 Delete</button>`;
  }

  // Progress section
  let progressHtml = '';
  if (isIndexing) {
    const phaseIcon = {
      'Loading model':'🧠','Clearing old data':'🗑','Scanning directory':'📂',
      'Reading files':'📄','Embedding':'⚡','Finalizing':'✨','Cancelling':'⏹'
    }[phase] || '⏳';
    progressHtml = `
      <div class="ctx-det-section">
        <div class="ctx-det-section-title">Indexing Progress</div>
        <div class="ctx-progress-bar"><div class="ctx-progress-fill" style="width:${pct}%"></div></div>
        <div class="ctx-progress-phase" style="margin-top:8px;">${phaseIcon} ${_escHtml(phase)}</div>
        <div class="ctx-progress-label">${filesDone}/${totalFiles} files · ${chunksDone} chunks · ${pct}%${errCount ? ' · <span style="color:#ef4444;">' + errCount + ' errors</span>' : ''}</div>
        ${currentFile ? '<div class="ctx-progress-file">→ ' + _escHtml(currentFile) + '</div>' : ''}
      </div>`;
  } else if (statusCls === 'cancelled') {
    progressHtml = `<div class="ctx-det-section"><div class="ctx-progress-phase" style="color:#f59e0b;">⏹ Cancelled — ${filesDone} files, ${chunksDone} chunks indexed before stop</div></div>`;
  } else if (statusCls === 'stalled') {
    progressHtml = `<div class="ctx-det-section"><div class="ctx-progress-phase" style="color:#fb7185;">⚠ ${_escHtml(phase || 'Indexing stalled')}</div><div class="ctx-progress-label" style="margin-top:6px;color:#fca5a5;">${_escHtml((idx && idx.error) || 'No live background worker is reporting progress.')}</div></div>`;
  } else if (hasError) {
    progressHtml = `<div class="ctx-det-section"><div class="ctx-progress-phase" style="color:#ef4444;">❌ ${_escHtml(idx.error)}</div></div>`;
  }

  // Language breakdown
  const langEntries = Object.entries(langs).sort((a, b) => b[1] - a[1]);
  const maxLang = langEntries.length ? langEntries[0][1] : 1;
  const langColors = ['#22d3ee','#a855f7','#22c55e','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6','#f97316','#6366f1'];
  let langHtml = '';
  if (langEntries.length) {
    langHtml = `<div class="ctx-det-section">
      <div class="ctx-det-section-title">File Types</div>
      ${langEntries.map(([lang, count], i) => `
        <div class="ctx-det-lang-row">
          <span class="ctx-det-lang-name">${_escHtml(lang || 'unknown')}</span>
          <div style="flex:1;"><div class="ctx-det-lang-bar" style="width:${Math.max(4, count / maxLang * 100)}%;background:${langColors[i % langColors.length]};"></div></div>
          <span class="ctx-det-lang-count">${count}</span>
        </div>`).join('')}
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
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${p.file_count || 0}</div><div class="ctx-det-stat-label">Total Files</div></div>
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${codeFiles}</div><div class="ctx-det-stat-label">Code Files</div></div>
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${memBank}</div><div class="ctx-det-stat-label">Memory Bank</div></div>
        <div class="ctx-det-stat"><div class="ctx-det-stat-val">${p.chunk_count || 0}</div><div class="ctx-det-stat-label">Chunks</div></div>
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

async function ctxDoSearch() {
  const q = document.getElementById('ctx-search-input').value.trim();
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
    // Sort by distance ascending (lower = better match)
    results.sort((a, b) => (a.distance || 999) - (b.distance || 999));
    if (!results.length) {
      container.innerHTML = '<div class="ctx-welcome" style="padding:30px;">No results found</div>';
      return;
    }
    container.innerHTML = results.map(r => {
      const path = r.file_path || r.uri || '';
      const lang = r.language || '';
      const repo = r.repo_name || '';
      const score = r.distance != null ? (1 - r.distance).toFixed(3) : '';
      const preview = (r.content || '').substring(0, 400);
      const typeBadge = r._type === 'memory' ? '<span class="ctx-result-badge" style="color:#a855f7;border-color:#a855f7;">memory</span>' : '';
      return `<div class="ctx-result-card">
        <div class="ctx-result-header">
          <span class="ctx-result-path">${_escHtml(path)}</span>
          <div class="ctx-result-meta">
            ${typeBadge}
            ${lang ? '<span class="ctx-result-badge">' + _escHtml(lang) + '</span>' : ''}
            ${repo ? '<span class="ctx-result-badge">' + _escHtml(repo) + '</span>' : ''}
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

async function ctxLoadMemory() {
  const container = document.getElementById('ctx-memory-list');
  try {
    const res = await fetch('/api/context/memory/list');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const items = data.resources || data || [];
    if (!items.length) {
      container.innerHTML = `<div class="ctx-welcome">
        <div style="font-size:2rem;margin-bottom:12px;">🧠</div>
        <div>No memory bank documents found</div>
        <div style="color:var(--text-dim);font-size:0.6rem;margin-top:6px;">Index a project with a memory/ directory to see docs here</div>
      </div>`;
      return;
    }
    _ctxRenderFileList(container, items, 'ctx-mem', 'memory');
  } catch (e) {
    container.innerHTML = '<div class="ctx-welcome" style="padding:30px;color:#ef4444;">Failed to load: ' + _escHtml(e.message) + '</div>';
  }
}

async function ctxLoadCode() {
  const container = document.getElementById('ctx-code-list');
  try {
    const res = await fetch('/api/context/code/list');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const items = data.files || data || [];
    if (!items.length) {
      container.innerHTML = `<div class="ctx-welcome">
        <div style="font-size:2rem;margin-bottom:12px;">📄</div>
        <div>No code files found</div>
        <div style="color:var(--text-dim);font-size:0.6rem;margin-top:6px;">Index a project to browse its code files here</div>
      </div>`;
      return;
    }
    _ctxRenderFileList(container, items, 'ctx-code', 'code');
  } catch (e) {
    container.innerHTML = '<div class="ctx-welcome" style="padding:30px;color:#ef4444;">Failed to load: ' + _escHtml(e.message) + '</div>';
  }
}

function _ctxRenderFileList(container, items, prefix, type) {
  const byRepo = {};
  items.forEach(i => { const rn = i.repo || i.repo_name || 'unknown'; (byRepo[rn] = byRepo[rn] || []).push(i); });
  container.innerHTML = Object.entries(byRepo).map(([repo, docs]) => {
    const groupId = prefix + '-' + repo.replace(/[^a-zA-Z0-9]/g, '_');
    const openFn = type === 'memory' ? 'ctxReadMemory' : 'ctxReadCodeFile';
    return `<div style="margin-bottom:12px;">
      <div style="font-family:var(--font-mono);font-size:0.6rem;color:#22d3ee;margin-bottom:6px;padding:6px 10px;background:rgba(34,211,238,0.08);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;" onclick="document.getElementById('${groupId}').style.display=document.getElementById('${groupId}').style.display==='none'?'block':'none'; this.querySelector('.ctx-mem-arrow').textContent=document.getElementById('${groupId}').style.display==='none'?'▸':'▾'">
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

function ctxReadMemory(uri) { openContextFile(uri, 'memory'); }
function ctxReadCodeFile(uri) { openContextFile(uri, 'code'); }
