// ── Shared MCP connection test ─────────────────────────────────────────────

async function _mcpTestConnection(name, port, dotId, txtId) {
  const dot = document.getElementById(dotId);
  const txt = document.getElementById(txtId);
  dot.className = 'ctx-dot warn';
  txt.innerHTML = '<span style="color:#f59e0b;">● Testing...</span>';
  try {
    const t0 = performance.now();
    const res = await fetch('/api/mcp/health/' + name, { signal: AbortSignal.timeout(5000) });
    const ms = Math.round(performance.now() - t0);
    const data = await res.json();
    if (data.status === 'ok') {
      dot.className = 'ctx-dot ok';
      txt.innerHTML = `<span style="color:#22c55e;">● Connected</span> <span style="color:var(--text-dim);font-size:0.5rem;">— port ${port} responding (${ms}ms)</span>`;
    } else {
      dot.className = 'ctx-dot off';
      txt.innerHTML = `<span style="color:#ef4444;">● Offline</span> <span style="color:var(--text-dim);font-size:0.5rem;">— ${data.error || 'not responding on port ' + port}</span>`;
    }
  } catch (e) {
    dot.className = 'ctx-dot off';
    txt.innerHTML = `<span style="color:#ef4444;">● Unreachable</span> <span style="color:var(--text-dim);font-size:0.5rem;">— could not reach health endpoint</span>`;
  }
}

// ── Workspace MCP Subtab ───────────────────────────────────────────────────

const _wsMcpTools = [
  { name: 'get_current_workspace', desc: 'Auto-detect workspace for this session', icon: '🧭', params: [] },
  { name: 'list_workspaces', desc: 'List all workspaces (open/closed/all)', icon: '📋', params: [
    { key: 'status', label: 'Status', default: 'open', type: 'select', options: ['open','closed','all'] }
  ]},
  { name: 'create_workspace', desc: 'Create a new workspace', icon: '🏗️', params: [
    { key: 'name', label: 'Name', default: '' },
    { key: 'description', label: 'Description', default: '' },
    { key: 'priority', label: 'Priority', default: 'medium', type: 'select', options: ['critical','high','medium','low'] }
  ]},
  { name: 'get_workspace', desc: 'Get workspace by ID or name', icon: '🔍', params: [
    { key: 'workspace_id', label: 'Workspace ID', default: '' },
    { key: 'name', label: 'Or Name', default: '' }
  ]},
  { name: 'list_tasks', desc: 'List tasks for a workspace', icon: '📝', params: [
    { key: 'workspace_id', label: 'Workspace ID', default: '' },
    { key: 'status', label: 'Status', default: 'all', type: 'select', options: ['all','todo','in-progress','done','blocked'] },
    { key: 'date', label: 'Date (YYYY-MM-DD)', default: '' }
  ]},
  { name: 'create_task', desc: 'Create a task in a workspace', icon: '➕', params: [
    { key: 'title', label: 'Title', default: '' },
    { key: 'description', label: 'Description', default: '' },
    { key: 'priority', label: 'Priority', default: 'medium', type: 'select', options: ['critical','high','medium','low'] },
    { key: 'status', label: 'Status', default: 'todo', type: 'select', options: ['todo','in-progress','done','blocked'] },
    { key: 'workspace_id', label: 'Workspace ID', default: '' }
  ]},
  { name: 'update_task', desc: 'Update a task', icon: '✏️', params: [
    { key: 'task_id', label: 'Task ID', default: '' },
    { key: 'status', label: 'Status', default: '', type: 'select', options: ['','todo','in-progress','done','blocked'] },
    { key: 'title', label: 'Title', default: '' },
    { key: 'priority', label: 'Priority', default: '', type: 'select', options: ['','critical','high','medium','low'] }
  ]},
  { name: 'complete_task', desc: 'Mark a task as done', icon: '✅', params: [
    { key: 'task_id', label: 'Task ID', default: '' }
  ]},
  { name: 'get_next_task', desc: 'Get highest-priority actionable task', icon: '🎯', params: [
    { key: 'workspace_id', label: 'Workspace ID', default: '' }
  ]},
  { name: 'list_merge_requests', desc: 'List merge requests in workspace', icon: '🔀', params: [
    { key: 'workspace_id', label: 'Workspace ID', default: '' },
    { key: 'status', label: 'Status', default: '' }
  ]},
  { name: 'create_session_note', desc: 'Add a note to current session', icon: '📝', params: [
    { key: 'text', label: 'Note text', default: '' }
  ]},
  { name: 'list_session_notes', desc: 'List notes for current session', icon: '📋', params: [] },
  { name: 'list_jira_tickets', desc: 'List Jira tickets in workspace', icon: '🎫', params: [
    { key: 'workspace_id', label: 'Workspace ID', default: '' },
    { key: 'status', label: 'Status', default: '' }
  ]},
];

let _wsMcpActiveTool = null;

function wsMcpInit() {
  wsMcpTestConnection();
  wsMcpRenderTools();
}

async function wsMcpTestConnection() { return _mcpTestConnection('workspace', 8091, 'ws-mcp-dot', 'ws-mcp-status-text'); }

function wsMcpRenderTools() {
  const container = document.getElementById('ws-mcp-tools');
  container.innerHTML = _wsMcpTools.map(t =>
    `<div class="ws-mcp-tool-card${_wsMcpActiveTool === t.name ? ' active' : ''}" onclick="wsMcpSelectTool('${t.name}')">
      <div class="ws-mcp-tool-name">${t.icon} ${t.name}</div>
      <div class="ws-mcp-tool-desc">${t.desc}</div>
    </div>`
  ).join('');
}

function wsMcpSelectTool(name) {
  _wsMcpActiveTool = name;
  wsMcpRenderTools();
  const tool = _wsMcpTools.find(t => t.name === name);
  if (!tool) return;
  const pg = document.getElementById('ws-mcp-playground');
  pg.style.display = 'block';
  document.getElementById('ws-mcp-play-name').textContent = tool.icon + ' ' + tool.name;
  const paramsDiv = document.getElementById('ws-mcp-params');
  document.getElementById('ws-mcp-result').style.display = 'none';

  if (!tool.params.length) {
    paramsDiv.innerHTML = '<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);padding:4px 0;">No parameters — click RUN</div>';
    return;
  }
  paramsDiv.innerHTML = tool.params.map(p => {
    if (p.type === 'select') {
      const opts = p.options.map(o => `<option value="${o}"${o === p.default ? ' selected' : ''}>${o || '(any)'}</option>`).join('');
      return `<div class="ws-mcp-param-row">
        <span class="ws-mcp-param-label">${p.label}</span>
        <select class="ws-mcp-param-input" data-key="${p.key}">${opts}</select>
      </div>`;
    }
    return `<div class="ws-mcp-param-row">
      <span class="ws-mcp-param-label">${p.label}</span>
      <input class="ws-mcp-param-input" data-key="${p.key}" placeholder="${p.default || ''}" value="${p.default || ''}">
    </div>`;
  }).join('');
}

function wsMcpClosePg() {
  document.getElementById('ws-mcp-playground').style.display = 'none';
  _wsMcpActiveTool = null;
  wsMcpRenderTools();
}

async function wsMcpRun() {
  if (!_wsMcpActiveTool) return;
  const tool = _wsMcpTools.find(t => t.name === _wsMcpActiveTool);
  if (!tool) return;

  // Collect params
  const params = {};
  document.querySelectorAll('#ws-mcp-params [data-key]').forEach(el => {
    const v = el.value.trim();
    if (v) params[el.dataset.key] = v;
  });

  const resultDiv = document.getElementById('ws-mcp-result');
  resultDiv.style.display = 'block';
  resultDiv.textContent = '⏳ Running...';

  // Map tool name to Flask API endpoint
  const apiMap = {
    'get_current_workspace': { method: 'GET', url: '/api/workspaces' },
    'list_workspaces': { method: 'GET', url: () => '/api/workspaces' },
    'create_workspace': { method: 'POST', url: '/api/workspaces', body: params },
    'get_workspace': { method: 'GET', url: () => '/api/workspaces/' + encodeURIComponent(params.workspace_id || params.name || '') },
    'list_tasks': { method: 'GET', url: () => {
      const qs = new URLSearchParams();
      if (params.workspace_id) qs.set('workspace_id', params.workspace_id);
      if (params.status && params.status !== 'all') qs.set('status', params.status);
      if (params.date) qs.set('date', params.date);
      return '/api/tasks?' + qs;
    }},
    'create_task': { method: 'POST', url: '/api/tasks', body: params },
    'update_task': { method: 'PUT', url: () => '/api/tasks/' + encodeURIComponent(params.task_id || ''), body: params },
    'complete_task': { method: 'PUT', url: () => '/api/tasks/' + encodeURIComponent(params.task_id || ''), body: { status: 'done' } },
    'get_next_task': { method: 'GET', url: () => '/api/tasks?' + new URLSearchParams({ workspace_id: params.workspace_id || '', status: 'todo' }) },
    'list_merge_requests': { method: 'GET', url: () => {
      const qs = new URLSearchParams();
      if (params.workspace_id) qs.set('workspace_id', params.workspace_id);
      if (params.status) qs.set('status', params.status);
      return '/api/merge-requests?' + qs;
    }},
    'create_session_note': { method: 'POST', url: () => '/api/session/' + encodeURIComponent(params.session_id || 'current') + '/notes', body: { text: params.text } },
    'list_session_notes': { method: 'GET', url: () => '/api/session/' + encodeURIComponent(params.session_id || 'current') + '/notes' },
    'list_jira_tickets': { method: 'GET', url: () => {
      const qs = new URLSearchParams();
      if (params.workspace_id) qs.set('workspace_id', params.workspace_id);
      if (params.status) qs.set('status', params.status);
      return '/api/jira-tickets?' + qs;
    }},
  };

  const spec = apiMap[_wsMcpActiveTool];
  if (!spec) {
    resultDiv.textContent = '❌ No API mapping for tool: ' + _wsMcpActiveTool;
    return;
  }

  try {
    const url = typeof spec.url === 'function' ? spec.url() : spec.url;
    const opts = { method: spec.method, headers: {} };
    if (spec.body && spec.method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(spec.body);
    }
    const res = await fetch(url, opts);
    const data = await res.json();
    resultDiv.textContent = JSON.stringify(data, null, 2);
    if (!res.ok) resultDiv.textContent = '❌ ' + res.status + '\n' + resultDiv.textContent;
    else resultDiv.textContent = '✅ ' + res.status + '\n' + resultDiv.textContent;
  } catch (e) {
    resultDiv.textContent = '❌ Error: ' + e.message;
  }
}

function _escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

