let _abAssets = {};
let _abCurrentId = null;
let _abCmEditor = null;
let _abDirty = false;
let _abBuilderTags = [];
let _abTreeExpanded = {};  // track expanded state: { 'type:persona': true, 'folder:rules/backend': true }

async function abMcpTestConnection() { return _mcpTestConnection('abilities', 8092, 'ab-mcp-dot', 'ab-mcp-status-text'); }

async function fetchAbilities() {
  abMcpTestConnection();
  try {
    const [assetsRes, statsRes] = await Promise.all([
      fetch('/api/abilities/assets'),
      fetch('/api/abilities/stats')
    ]);
    if (!assetsRes.ok || !statsRes.ok) throw new Error('API error');
    _abAssets = await assetsRes.json();
    const stats = await statsRes.json();
    renderAbTree();
    renderAbStats(stats);
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    const countEl = document.getElementById('mode-abilities-count');
    if (countEl) countEl.textContent = total || '';
  } catch (e) {
    showToast('error', 'Failed to load abilities: ' + e.message);
  }
}

function renderAbStats(stats) {
  const grid = document.getElementById('ab-stats-grid');
  if (!grid) return;
  const icons = { persona: '🎭', rule: '📏', policy: '📋', repo: '💾', style: '🎨' };
  grid.innerHTML = Object.entries(stats).map(([type, count]) =>
    `<div class="ab-stat-card">
      <span class="ab-stat-icon">${icons[type] || '📄'}</span>
      <span class="ab-stat-count">${count}</span>
      <span class="ab-stat-label">${type}s</span>
    </div>`
  ).join('');
}

function renderAbTree() {
  const tree = document.getElementById('ab-tree');
  if (!tree) return;
  const search = (document.getElementById('ab-search')?.value || '').toLowerCase();
  const typeOrder = ['persona', 'rule', 'policy', 'style', 'repo'];
  const icons = { persona: '🎭', rule: '📏', policy: '📋', repo: '💾', style: '🎨' };

  let html = '';
  for (const type of typeOrder) {
    let items = _abAssets[type] || [];
    if (search) {
      items = items.filter(a =>
        a.id.toLowerCase().includes(search) ||
        (a.name || '').toLowerCase().includes(search) ||
        (a.tags || []).some(t => t.toLowerCase().includes(search))
      );
    }
    if (items.length === 0 && search) continue;

    const groups = {};
    items.forEach(a => {
      const parts = (a.path || a.id).split('/');
      const folder = parts.length > 2 ? parts.slice(0, -1).join('/') : '';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(a);
    });

    const typeKey = 'type:' + type;
    const isTypeExpanded = search ? true : (_abTreeExpanded[typeKey] !== undefined ? _abTreeExpanded[typeKey] : false);
    const collapsed = isTypeExpanded ? '' : 'collapsed';
    html += `<div class="ab-tree-type ${collapsed}" data-tree-key="${typeKey}">
      <div class="ab-tree-type-header" onclick="toggleAbTree(this.parentElement)">
        <span class="ab-tree-chevron">▸</span>
        ${icons[type] || '📄'} ${type.toUpperCase()}S
        <span class="ab-tree-count">${items.length}</span>
      </div>
      <div class="ab-tree-children">`;

    const sortedGroups = Object.keys(groups).sort();
    for (const folder of sortedGroups) {
      const groupItems = groups[folder];
      if (folder && sortedGroups.length > 1) {
        const folderName = folder.split('/').pop();
        const folderKey = 'folder:' + folder;
        const isFolderExpanded = search ? true : (_abTreeExpanded[folderKey] !== undefined ? _abTreeExpanded[folderKey] : false);
        const fCollapsed = isFolderExpanded ? '' : 'collapsed';
        html += `<div class="ab-tree-folder ${fCollapsed}" data-tree-key="${folderKey}">
          <div class="ab-tree-folder-header" onclick="toggleAbTree(this.parentElement)">
            <span class="ab-tree-chevron">▸</span>📁 ${folderName}/
            <span class="ab-tree-count">${groupItems.length}</span>
          </div>
          <div class="ab-tree-children">`;
      }
      for (const asset of groupItems.sort((a, b) => a.id.localeCompare(b.id))) {
        const shortName = asset.name || asset.id.split('.').pop();
        const isActive = asset.id === _abCurrentId ? ' active' : '';
        const escapedId = asset.id.replace(/'/g, "\\'");
        html += `<div class="ab-tree-item${isActive}" onclick="openAbEditor('${escapedId}')" title="${asset.id}">
          ${shortName}
        </div>`;
      }
      if (folder && sortedGroups.length > 1) {
        html += `</div></div>`;
      }
    }

    html += `</div></div>`;
  }
  tree.innerHTML = html;
}

function toggleAbTree(el) {
  el.classList.toggle('collapsed');
  const key = el.getAttribute('data-tree-key');
  if (key) _abTreeExpanded[key] = !el.classList.contains('collapsed');
}

function switchAbPanel(panel) {
  document.getElementById('ab-welcome').style.display = panel === 'welcome' ? '' : 'none';
  document.getElementById('ab-editor-panel').style.display = panel === 'editor' ? '' : 'none';
  document.getElementById('ab-builder-panel').style.display = panel === 'builder' ? '' : 'none';
  if (panel === 'builder') loadAbBuilderDropdowns();
  if (panel === 'welcome') { _abCurrentId = null; renderAbTree(); }
}

async function openAbEditor(assetId) {
  if (_abDirty && !confirm('Discard unsaved changes?')) return;
  try {
    const res = await fetch('/api/abilities/assets/' + encodeURIComponent(assetId));
    if (!res.ok) throw new Error('Not found');
    const asset = await res.json();
    _abCurrentId = assetId;
    _abDirty = false;
    document.getElementById('ab-dirty-dot').style.display = 'none';

    document.getElementById('ab-editor-path').textContent = asset.path || assetId;
    document.getElementById('ab-fm-id').value = asset.id;
    document.getElementById('ab-fm-type').value = asset.type;
    document.getElementById('ab-fm-priority').value = asset.priority;

    renderAbChips('ab-fm-tags', asset.tags || [], () => { _abDirty = true; showAbDirty(); });
    renderAbChips('ab-fm-includes', asset.includes || [], () => { _abDirty = true; showAbDirty(); });

    const container = document.getElementById('ab-cm-container');
    container.innerHTML = '';
    _abCmEditor = CodeMirror(container, {
      value: asset.body || '',
      mode: 'gfm',
      theme: 'material-darker',
      lineNumbers: true,
      lineWrapping: true,
      viewportMargin: Infinity,
      extraKeys: {
        'Cmd-S': () => abSave(),
        'Ctrl-S': () => abSave(),
      }
    });
    _abCmEditor.on('change', () => { _abDirty = true; showAbDirty(); });
    setTimeout(() => _abCmEditor.refresh(), 50);

    switchAbPanel('editor');
    renderAbTree();
  } catch (e) {
    showToast('error', 'Failed to open asset: ' + e.message);
  }
}

function showAbDirty() {
  document.getElementById('ab-dirty-dot').style.display = _abDirty ? '' : 'none';
}

function renderAbChips(containerId, values, onChange) {
  const container = document.getElementById(containerId);
  container.innerHTML = values.map((v, i) =>
    `<span class="ab-chip">${v}<button onclick="removeAbChip('${containerId}',${i})">×</button></span>`
  ).join('');
  container._values = [...values];
  container._onChange = onChange;
}

function removeAbChip(containerId, index) {
  const container = document.getElementById(containerId);
  container._values.splice(index, 1);
  renderAbChips(containerId, container._values, container._onChange);
  if (container._onChange) container._onChange(container._values);
}

function addAbChip(inputId, containerId) {
  const input = document.getElementById(inputId);
  const val = input.value.trim();
  if (!val) return;
  const container = document.getElementById(containerId);
  container._values = container._values || [];
  container._values.push(val);
  renderAbChips(containerId, container._values, container._onChange);
  input.value = '';
  if (container._onChange) container._onChange(container._values);
}

(function() {
  function wireAbInputs() {
    const tagInput = document.getElementById('ab-tag-input');
    if (tagInput) tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAbChip('ab-tag-input', 'ab-fm-tags'); } });
    const incInput = document.getElementById('ab-include-input');
    if (incInput) incInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAbChip('ab-include-input', 'ab-fm-includes'); } });
    const buildTagInput = document.getElementById('ab-build-tag-input');
    if (buildTagInput) buildTagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAbBuilderTag(); } });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAbInputs);
  } else {
    wireAbInputs();
  }
})();

async function abSave() {
  if (!_abCurrentId || !_abCmEditor) return;
  const btn = document.getElementById('ab-save-btn');
  btn.textContent = 'SAVING...';
  btn.disabled = true;
  try {
    const body = {
      tags: document.getElementById('ab-fm-tags')._values || [],
      priority: parseInt(document.getElementById('ab-fm-priority').value) || 900,
      body: _abCmEditor.getValue(),
      includes: document.getElementById('ab-fm-includes')._values || [],
    };
    const res = await fetch('/api/abilities/assets/' + encodeURIComponent(_abCurrentId), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Save failed'); }
    _abDirty = false;
    showAbDirty();
    showToast('success', 'Saved ' + _abCurrentId);
  } catch (e) {
    showToast('error', 'Save failed: ' + e.message);
  }
  btn.textContent = 'SAVE';
  btn.disabled = false;
}

async function abDeleteCurrent() {
  if (!_abCurrentId) return;
  if (!confirm('Delete ' + _abCurrentId + '? This cannot be undone.')) return;
  try {
    const res = await fetch('/api/abilities/assets/' + encodeURIComponent(_abCurrentId), { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('success', 'Deleted ' + _abCurrentId);
    _abCurrentId = null;
    _abDirty = false;
    switchAbPanel('welcome');
    fetchAbilities();
  } catch (e) {
    showToast('error', 'Delete failed: ' + e.message);
  }
}

async function abValidate() {
  try {
    const res = await fetch('/api/abilities/validate');
    const data = await res.json();
    if (data.ok) {
      showToast('success', '✓ Store valid — ' + Object.entries(data.stats).map(([k, v]) => v + ' ' + k + 's').join(', '));
    } else {
      showToast('error', 'Validation failed: ' + data.error);
    }
  } catch (e) {
    showToast('error', 'Validation error: ' + e.message);
  }
}

function openAbNewModal() {
  document.getElementById('ab-new-id').value = '';
  document.getElementById('ab-new-tags').value = '';
  document.getElementById('ab-new-modal').style.display = 'flex';
}
function closeAbNewModal() {
  document.getElementById('ab-new-modal').style.display = 'none';
}
async function abCreateNew() {
  const id = document.getElementById('ab-new-id').value.trim();
  const type = document.getElementById('ab-new-type').value;
  const priority = parseInt(document.getElementById('ab-new-priority').value) || 900;
  const tags = document.getElementById('ab-new-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  if (!id) { showToast('error', 'ID is required'); return; }
  try {
    const res = await fetch('/api/abilities/assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type, priority, tags, body: '# ' + id.split('.').pop() + '\n\nContent here...\n' })
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Create failed'); }
    showToast('success', 'Created ' + id);
    closeAbNewModal();
    await fetchAbilities();
    openAbEditor(id);
  } catch (e) {
    showToast('error', 'Create failed: ' + e.message);
  }
}

async function loadAbBuilderDropdowns() {
  try {
    const res = await fetch('/api/abilities/assets');
    const data = await res.json();
    const personaSel = document.getElementById('ab-build-persona');
    const repoSel = document.getElementById('ab-build-repo');
    personaSel.innerHTML = (data.persona || []).map(p =>
      `<option value="${p.id.replace('persona.', '')}">${p.name || p.id}</option>`
    ).join('');
    repoSel.innerHTML = '<option value="">(none)</option>' + (data.repo || []).map(r =>
      `<option value="${r.id.replace('repo.', '')}">${r.name || r.id}</option>`
    ).join('');
  } catch (e) { /* silent */ }
}

function addAbBuilderTag() {
  const input = document.getElementById('ab-build-tag-input');
  const val = input.value.trim();
  if (!val) return;
  _abBuilderTags.push(val);
  renderAbBuilderTags();
  input.value = '';
}

function removeAbBuilderTag(i) {
  _abBuilderTags.splice(i, 1);
  renderAbBuilderTags();
}

function renderAbBuilderTags() {
  document.getElementById('ab-build-tags').innerHTML = _abBuilderTags.map((t, i) =>
    `<span class="ab-chip">${t}<button onclick="removeAbBuilderTag(${i})">×</button></span>`
  ).join('');
}

async function abResolve() {
  const persona = document.getElementById('ab-build-persona').value;
  const repo = document.getElementById('ab-build-repo').value;
  if (!persona) { showToast('error', 'Select a persona'); return; }
  try {
    const payload = { persona, tags: _abBuilderTags };
    if (repo) payload.repo_id = repo;
    const res = await fetch('/api/abilities/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const m = data.manifest || {};
    const applied = m.applied || {};
    let manifestHtml = '<div class="ab-manifest-row"><span>Persona:</span> <code>' + (applied.persona || persona) + '</code></div>';
    if (applied.repo) manifestHtml += '<div class="ab-manifest-row"><span>Repo:</span> <code>' + applied.repo + '</code></div>';
    manifestHtml += '<div class="ab-manifest-row"><span>Rules:</span> <code>' + (applied.rules || []).length + '</code> — ' + (applied.rules || []).map(r => '<code>' + r + '</code>').join(', ') + '</div>';
    manifestHtml += '<div class="ab-manifest-row"><span>Policies:</span> ' + ((applied.policies || []).map(p => '<code>' + p + '</code>').join(', ') || 'none') + '</div>';
    if (m.hash) manifestHtml += '<div class="ab-manifest-row"><span>Hash:</span> <code>' + m.hash.substring(0, 16) + '…</code></div>';
    manifestHtml += '<div class="ab-manifest-row"><span>Prompt:</span> <code>' + (data.prompt || '').length.toLocaleString() + ' chars</code></div>';

    document.getElementById('ab-resolve-manifest').innerHTML = manifestHtml;
    document.getElementById('ab-resolve-prompt').textContent = data.prompt || '';
    document.getElementById('ab-resolve-result').style.display = '';
    document.getElementById('ab-resolve-result')._prompt = data.prompt || '';
  } catch (e) {
    showToast('error', 'Resolve failed: ' + e.message);
  }
}

function abCopyPrompt() {
  const prompt = document.getElementById('ab-resolve-result')._prompt;
  if (!prompt) return;
  navigator.clipboard.writeText(prompt).then(() => showToast('success', 'Prompt copied to clipboard'));
}

