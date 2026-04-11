// ── Knowledge Tab ──────────────────────────────────────────────────────────

let _kbInited = false;
let _kbSimulation = null;
let _kbZoom = null;
let _kbSvgRef = null;
let _kbGraphData = {nodes:[], edges:[]};
let _kbSelectedNode = null;
let _kbSelectedNodes = new Map(); // multi-select: nodeId -> nodeData
let _kbActiveFilter = '';
let _kbActiveLayer = 'all';
let _kbSearchTerms = [];   // accumulated search terms
let _kbAndMode = false;    // false = OR union, true = AND intersection
let _kbMatchedIds = new Set(); // IDs of nodes matched by current search

// ── Neighborhood Expansion State ──
let _kbFocalIds = new Set();      // center nodes (from type filter, search, or selection)
let _kbExpansionDepth = 1;        // current neighborhood depth (1 = direct neighbors)
let _kbExpansionActive = false;   // whether expansion mode is on
let _kbNeighborMap = new Map();   // nodeId -> hop distance from focal

// ── Workspace-scoped mode ──
let _kbWsId = null;               // non-null when viewing workspace KG


// Layer definitions

async function kbMcpTestConnection() { return _mcpTestConnection('knowledge', 8094, 'kb-mcp-dot', 'kb-mcp-status-text'); }

async function kbInit() {
  kbMcpTestConnection();
  const wasWs = _kbWsId !== null;
  _kbWsId = null; // clear workspace mode when entering main KG tab
  // Clear workspace-injected KG HTML to avoid duplicate element IDs
  const wsKg = document.getElementById('ws-detail-knowledge');
  if (wsKg) wsKg.innerHTML = '';
  // Force reload if coming from workspace mode
  if (wasWs) _kbInited = false;
  if (!_kbInited) { _kbInited = true; await kbLoadGraph(); }
}

async function kbLoadGraph() {
  const container = document.getElementById('kb-graph-container');
  const svg = d3.select('#kb-graph-svg');
  svg.selectAll('*').remove();
  try {
    let url = '/api/knowledge/graph?limit=500&_=' + Date.now();
    if (_kbWsId) url += '&workspace_id=' + _kbWsId;
    if (_kbWsId) url += '&include_staged=true';
    const res = await fetch(url);
    let raw = await res.json();

    // Apply layer filter client-side
    const layerTypes = KB_LAYERS[_kbActiveLayer];
    if (layerTypes) {
      const allowed = new Set(layerTypes);
      const kept = new Set(raw.nodes.filter(n => allowed.has(n.node_type)).map(n => n.node_id));
      raw = { nodes: raw.nodes.filter(n => kept.has(n.node_id)), edges: raw.edges.filter(e => kept.has(e.source_id) && kept.has(e.target_id)) };
    }
    _kbGraphData = raw;
    // Preserve search terms across layer/filter changes
    const savedSearchTerms = [..._kbSearchTerms];

    const empty = document.getElementById('kb-graph-empty');
    if (!_kbGraphData.nodes.length) {
      if (empty) empty.style.display = '';
      const stat = document.getElementById('kb-stat-count');
      if (stat) stat.textContent = '0 nodes';
      return;
    }
    if (empty) empty.style.display = 'none';
    const stat = document.getElementById('kb-stat-count');
    if (stat) stat.textContent = `${_kbGraphData.nodes.length} nodes · ${_kbGraphData.edges.length} edges`;
    _kbRenderGraph(container, svg);

    // Re-apply search or type filter after graph rebuild
    if (savedSearchTerms.length) {
      _kbSearchTerms = savedSearchTerms;
      _kbRenderSearchChips();
      // Re-run search matching against new graph data
      _kbApplySearchHighlight();
    } else if (_kbActiveFilter) {
      _kbActivateExpansion(_kbGraphData.nodes.filter(n => n.node_type === _kbActiveFilter).map(n => n.node_id));
    }
  } catch(e) {
    console.error('kbLoadGraph error:', e);
  }
}

function kbSetLayer(layer, btn) {
  _kbActiveLayer = layer;
  document.querySelectorAll('.kb-layer-btn').forEach(b => {
    b.style.background = 'var(--bg-main)';
    b.style.color = 'var(--text-dim)';
  });
  btn.style.background = 'var(--cyan)';
  btn.style.color = 'var(--bg)';
  _kbInited = false;
  kbInit();
}

function _kbRenderGraph(container, svg) {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const nodeMap = {};
  _kbGraphData.nodes.forEach(n => { nodeMap[n.node_id] = n; });
  const links = _kbGraphData.edges.filter(e => nodeMap[e.source_id] && nodeMap[e.target_id]).map(e => ({
    source: e.source_id,
    target: e.target_id,
    edge_type: e.edge_type,
    edge_id: e.edge_id,
    weight: e.weight || 1,
    label: e.label || ''
  }));
  const nodes = _kbGraphData.nodes.map(n => ({
    id: n.node_id,
    ...n,
    connections: links.filter(l => l.source === n.node_id || l.target === n.node_id).length
  }));

  const g = svg.append('g');
  _kbZoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (event) => {
    g.attr('transform', event.transform);
  });
  _kbSvgRef = svg;
  svg.call(_kbZoom);

  // Cluster centroids — arrange type groups in a circle around center
  const typeOrder = ['client','domain','service','library','technology','insight'];
  const clusterCenters = {};
  typeOrder.forEach((t, i) => {
    const angle = (i / typeOrder.length) * 2 * Math.PI - Math.PI / 2;
    const r = Math.min(width, height) * 0.28;
    clusterCenters[t] = { x: width / 2 + r * Math.cos(angle), y: height / 2 + r * Math.sin(angle) };
  });

  // Custom clustering force — pulls each node toward its type centroid
  function forceCluster(alpha) {
    for (const d of nodes) {
      const c = clusterCenters[d.node_type];
      if (!c) continue;
      d.vx += (c.x - d.x) * 0.04 * alpha;
      d.vy += (c.y - d.y) * 0.04 * alpha;
    }
  }

  if (_kbSimulation) _kbSimulation.stop();
  _kbSimulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(80).strength(0.4))
    .force('charge', d3.forceManyBody().strength(-180))
    .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
    .force('collision', d3.forceCollide().radius(d => 22 + d.connections * 2))
    .force('cluster', forceCluster);

  // Draw cluster halos (subtle background circles per type)
  const haloG = g.insert('g', ':first-child');
  Object.entries(clusterCenters).forEach(([type, c]) => {
    const typeNodes = nodes.filter(n => n.node_type === type);
    if (!typeNodes.length) return;
    haloG.append('circle')
      .attr('cx', c.x).attr('cy', c.y)
      .attr('r', 60 + typeNodes.length * 8)
      .attr('fill', KB_NODE_COLORS[type] || '#6b7280')
      .attr('opacity', 0.04)
      .attr('stroke', KB_NODE_COLORS[type] || '#6b7280')
      .attr('stroke-opacity', 0.12)
      .attr('stroke-width', 1);
    haloG.append('text')
      .attr('x', c.x).attr('y', c.y - 60 - typeNodes.length * 8 - 6)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'var(--font-mono)')
      .attr('font-size', '9px')
      .attr('fill', KB_NODE_COLORS[type] || '#6b7280')
      .attr('opacity', 0.5)
      .text(type.toUpperCase());
  });

  const link = g.append('g').selectAll('line')
    .data(links).join('line')
    .attr('class', 'link')
    .attr('stroke', d => KB_EDGE_COLORS[d.edge_type] || '#6b7280')
    .attr('stroke-width', d => Math.max(1, d.weight * 1.5));

  link.append('title').text(d => d.edge_type + (d.label ? ': ' + d.label : ''));

  const node = g.append('g').selectAll('g')
    .data(nodes).join('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', (event, d) => { if (!event.active) _kbSimulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active) _kbSimulation.alphaTarget(0); d.fx = null; d.fy = null; })
    )
    .on('click', (event, d) => {
      event.stopPropagation();
      if (event.metaKey || event.ctrlKey) {
        kbToggleMultiSelect(d);
      } else {
        _kbSelectedNodes.clear();
        kbSelectNode(d);
        _kbUpdateNodeHighlights();
      }
    });

  node.append('circle')
    .attr('r', d => Math.max(8, 6 + d.connections * 2))
    .attr('fill', d => KB_NODE_COLORS[d.node_type] || '#6b7280')
    .attr('stroke', '#1a1a2e')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', d => d.status === 'staged' ? '4,3' : 'none')
    .attr('opacity', d => d.status === 'staged' ? 0.6 : 1);

  node.append('text')
    .attr('dx', d => Math.max(8, 6 + d.connections * 2) + 4)
    .attr('dy', 4)
    .text(d => d.title.length > 25 ? d.title.slice(0, 25) + '…' : d.title);

  node.append('text')
    .attr('class', 'staged-badge')
    .attr('dx', d => d.status === 'staged' ? 18 : 0)
    .attr('dy', 14)
    .style('font-size', '7px')
    .style('fill', '#f59e0b')
    .style('text-transform', 'uppercase')
    .style('letter-spacing', '1px')
    .style('display', d => d.status === 'staged' ? 'block' : 'none')
    .text('STAGED');

  _kbSimulation.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // Auto-fit to viewport when simulation settles
  _kbSimulation.on('end', () => {
    const allNodes = nodes.filter(n => n.x != null && n.y != null);
    if (!allNodes.length) return;
    const xs = allNodes.map(n => n.x), ys = allNodes.map(n => n.y);
    const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 60;
    const y0 = Math.min(...ys) - 60, y1 = Math.max(...ys) + 60;
    const W = container.clientWidth, H = container.clientHeight;
    const scale = Math.min(2, 0.85 / Math.max((x1-x0)/W, (y1-y0)/H));
    const tx = W/2 - scale*(x0+x1)/2, ty = H/2 - scale*(y0+y1)/2;
    svg.transition().duration(500)
      .call(_kbZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  });

  svg.on('click', () => { _kbSelectedNode = null; _kbSelectedNodes.clear(); kbShowDetailEmpty(); _kbUpdateNodeHighlights(); });
}

function kbSelectNode(d) {
  _kbSelectedNode = d;
  const panel = document.getElementById('kb-detail-content');
  const nodeData = _kbGraphData.nodes.find(n => n.node_id === d.node_id) || d;
  const icon = KB_NODE_ICONS[d.node_type] || '❓';
  const color = KB_NODE_COLORS[d.node_type] || '#6b7280';
  const meta = nodeData.metadata || {};
  const date = nodeData.created_at ? new Date(nodeData.created_at).toLocaleString('en-US', {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';

  const edges = _kbGraphData.edges.filter(e => e.source_id === d.node_id || e.target_id === d.node_id);

  // Group edges by type, sort by connected node title within each group
  const edgeGroups = {};
  edges.forEach(e => {
    const otherId = e.source_id === d.node_id ? e.target_id : e.source_id;
    const other = _kbGraphData.nodes.find(n => n.node_id === otherId);
    if (!other) return;
    const type = e.edge_type || 'relates_to';
    if (!edgeGroups[type]) edgeGroups[type] = [];
    edgeGroups[type].push({ edge: e, other, otherId });
  });
  // Sort group keys alphabetically, sort items within each group by title
  const sortedTypes = Object.keys(edgeGroups).sort();
  sortedTypes.forEach(type => {
    edgeGroups[type].sort((a, b) => (a.other.title || '').localeCompare(b.other.title || ''));
  });

  let edgesHtml = '';
  sortedTypes.forEach(type => {
    const edgeColor = KB_EDGE_COLORS[type] || '#6b7280';
    edgesHtml += `<div style="font-size:0.45rem;color:${edgeColor};text-transform:uppercase;letter-spacing:1px;margin:8px 0 4px;font-weight:600;">${type.replace(/_/g,' ')} (${edgeGroups[type].length})</div>`;
    edgeGroups[type].forEach(({ edge: e, other, otherId }) => {
      const otherIcon = KB_NODE_ICONS[other.node_type] || '❓';
      const direction = e.source_id === d.node_id ? '→' : '←';
      edgesHtml += `<div class="kb-edge-item" onclick="kbSelectNodeById('${otherId}')">
        <span>${otherIcon}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(other.title)}</span>
        <span class="kb-edge-badge" style="background:${edgeColor}22;color:${edgeColor};">${direction} ${e.edge_type.replace('_',' ')}</span>
        <span onclick="event.stopPropagation();kbDeleteEdge('${e.edge_id}','${d.node_id}')" title="Remove this link" style="cursor:pointer;color:rgba(239,68,68,0.5);font-size:0.6rem;padding:0 2px;line-height:1;flex-shrink:0;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='rgba(239,68,68,0.5)'">✕</span>
      </div>`;
    });
  });

  let metaHtml = '';
  if (meta.source) metaHtml += `<div style="font-size:0.5rem;color:var(--text-dim);">Source: ${meta.source}</div>`;
  if (meta.repo) metaHtml += `<div style="font-size:0.5rem;color:var(--text-dim);">📦 ${escapeHtml(meta.repo)}</div>`;
  if (meta.files && meta.files.length) metaHtml += `<div style="font-size:0.5rem;color:var(--text-dim);">📂 ${meta.files.map(f=>escapeHtml(f)).join(', ')}</div>`;
  // Workspace chips (replaces legacy workspace_id display)
  const wsIds = (meta.workspaces && meta.workspaces.length) ? meta.workspaces : (meta.workspace_id ? [meta.workspace_id] : []);

  let wsChipsHtml = '';
  if (wsIds.length) {
    wsChipsHtml = `<div class="kb-detail-section"><h5>Workspaces</h5><div id="kb-ws-chips" style="display:flex;flex-wrap:wrap;gap:4px;">`;
    wsIds.forEach(wsId => {
      wsChipsHtml += `<span class="kb-ws-chip" data-ws-id="${wsId}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:12px;font-size:0.45rem;color:#60a5fa;">
        <span class="kb-ws-chip-name">${wsId}</span>
        <span onclick="kbUnlinkWorkspace('${nodeData.node_id}','${wsId}')" style="cursor:pointer;color:rgba(239,68,68,0.7);font-size:0.5rem;" title="Remove workspace">✕</span>
      </span>`;
    });
    wsChipsHtml += `</div></div>`;
  }

  panel.innerHTML = `
    <div style="margin-bottom:8px;">
      <span onclick="navigator.clipboard.writeText('${nodeData.node_id}')" title="Click to copy node ID" style="cursor:pointer;display:inline-block;padding:2px 8px;font-size:0.4rem;font-family:var(--font-mono);background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:10px;color:#818cf8;letter-spacing:0.5px;">${nodeData.node_id}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <span style="font-size:1.2rem;">${icon}</span>
      <div style="flex:1;">
        <div style="font-size:0.7rem;font-weight:bold;color:${color};word-break:break-word;">${escapeHtml(nodeData.title)}</div>
        <div style="font-size:0.5rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">${nodeData.node_type}${nodeData.status === 'staged' ? '<span style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:0.4rem;background:rgba(245,158,11,0.2);border:1px solid rgba(245,158,11,0.4);border-radius:3px;color:#f59e0b;text-transform:uppercase;">staged</span>' : '<span style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:0.4rem;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);border-radius:3px;color:#10b981;text-transform:uppercase;">committed</span>'}</div>
      </div>
    </div>
    ${nodeData.content ? `<div class="kb-detail-section"><h5>Content</h5><div class="markdown-body" style="font-size:0.6rem;color:var(--text);max-height:200px;overflow-y:auto;padding:8px;background:var(--bg-main);border-radius:4px;">${typeof marked !== 'undefined' ? marked.parse(nodeData.content) : escapeHtml(nodeData.content)}</div></div>` : ''}
    ${metaHtml ? `<div class="kb-detail-section"><h5>Metadata</h5>${metaHtml}</div>` : ''}
    ${wsChipsHtml}
    <div class="kb-detail-section">
      <h5>Connections (${edges.length})</h5>
      ${edgesHtml || '<div style="font-size:0.55rem;color:var(--text-dim);padding:8px;">No connections</div>'}
    </div>
    <div style="font-size:0.45rem;color:var(--text-dim);margin-top:8px;">${date}</div>
    <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
      <button class="ctx-btn-sm" onclick="kbConnectModal('${nodeData.node_id}')" style="font-size:0.5rem;">🔗 Connect</button>
      <button class="ctx-btn-sm" onclick="kbExploreNode('${nodeData.node_id}')" style="font-size:0.5rem;border-color:rgba(0,230,200,0.3);color:var(--cyan);">🔍 Explore</button>
      <button class="ctx-btn-sm" onclick="kbLinkWorkspaceModal('${nodeData.node_id}')" style="font-size:0.5rem;">🗂️ Link WS</button>
      <button class="ctx-btn-sm" onclick="kbEditNode('${nodeData.node_id}')" style="font-size:0.5rem;border-color:rgba(0,255,255,0.3);color:var(--cyan);">✏️ Edit</button>
      <button class="ctx-btn-sm" onclick="kbDeleteNode('${nodeData.node_id}')" style="font-size:0.5rem;border-color:rgba(239,68,68,0.3);color:var(--red);">✕ Delete</button>
    </div>
  `;

  // Async-resolve workspace names into chips
  if (wsIds.length) {
    fetch('/api/knowledge/resolve-workspaces', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({workspace_ids: wsIds})
    }).then(r => r.json()).then(data => {
      const wsMap = {};
      (data.workspaces || []).forEach(w => { wsMap[w.id] = w.name || w.id; });
      document.querySelectorAll('#kb-ws-chips .kb-ws-chip-name').forEach(el => {
        const id = el.parentElement.dataset.wsId;
        if (wsMap[id]) el.textContent = wsMap[id];
      });
    }).catch(() => {});
  }

  d3.selectAll('#kb-graph-svg .node circle')
    .attr('stroke', n => n.node_id === d.node_id ? '#fff' : '#1a1a2e')
    .attr('stroke-width', n => n.node_id === d.node_id ? 3 : 2)
    .attr('stroke-dasharray', n => n.status === 'staged' ? '4,3' : 'none');

  // Auto-explore with depth 1 when a node is clicked
  kbExploreNode(d.node_id);
}

function kbShowDetailEmpty() {
  const el = document.getElementById('kb-detail-content');
  if (el) el.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--text-dim);font-size:0.6rem;">Click a node to see details</div>`;
  d3.selectAll('#kb-graph-svg .node circle').attr('stroke', '#1a1a2e').attr('stroke-width', 2)
    .attr('stroke-dasharray', n => n.status === 'staged' ? '4,3' : 'none');
}

/** Re-render the detail panel for the currently selected node using fresh graph data. */
function kbReselectNode() {
  if (!_kbSelectedNode) return;
  const fresh = _kbGraphData && _kbGraphData.nodes.find(n => n.node_id === _kbSelectedNode.node_id);
  if (fresh) {
    _kbSelectedNode = fresh;
    kbSelectNode(fresh);
  }
}

function kbZoomIn() { if (_kbZoom && _kbSvgRef) _kbSvgRef.transition().duration(300).call(_kbZoom.scaleBy, 1.4); }
function kbZoomOut() { if (_kbZoom && _kbSvgRef) _kbSvgRef.transition().duration(300).call(_kbZoom.scaleBy, 0.7); }
function kbZoomReset() { if (_kbZoom && _kbSvgRef) _kbSvgRef.transition().duration(300).call(_kbZoom.transform, d3.zoomIdentity); }

function kbToggleDetailPanel() {
  const panel = document.getElementById('kb-detail-panel');
  const expandBtn = document.getElementById('kb-panel-expand-btn');
  const isCollapsed = panel.style.width === '0px';
  if (isCollapsed) {
    panel.style.width = '320px';
    panel.style.minWidth = '280px';
    panel.style.overflow = 'auto';
    expandBtn.style.display = 'none';
  } else {
    panel.style.width = '0px';
    panel.style.minWidth = '0px';
    panel.style.overflow = 'hidden';
    expandBtn.style.display = 'flex';
  }
}

function kbSelectNodeById(nodeId) {
  const node = _kbGraphData.nodes.find(n => n.node_id === nodeId);
  if (node) kbSelectNode(node);
}

function kbFilterType(btn, type) {
  document.querySelectorAll('.kb-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _kbActiveFilter = type;
  const label = document.getElementById('kb-filter-label');
  const KB_TYPE_LABELS = { client:'Clients', domain:'Domains', service:'Services', library:'Libraries', technology:'Technologies', insight:'Insights', project:'Projects', concept:'Concepts', repo:'Repos', session:'Sessions' };
  if (type && KB_TYPE_LABELS[type]) {
    label.textContent = '← ' + KB_TYPE_LABELS[type] + ' selected';
    label.style.display = '';
  } else {
    label.style.display = 'none';
  }

  if (!type) {
    // "All" — clear expansion
    _kbClearExpansion();
    return;
  }

  // Set focal to all nodes of this type, activate expansion
  const focalIds = _kbGraphData.nodes.filter(n => n.node_type === type).map(n => n.node_id);
  if (focalIds.length) {
    _kbActivateExpansion(focalIds);
  } else {
    _kbClearExpansion();
  }
}

function kbFilterRecent(range) {
  if (range === 'all') { _kbClearExpansion(); return; }

  const now = new Date();
  let cutoff;
  if (range === 'today') {
    cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (range === '2d') {
    cutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  } else {
    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  const focalIds = _kbGraphData.nodes
    .filter(n => n.created_at && new Date(n.created_at) >= cutoff)
    .map(n => n.node_id);

  if (focalIds.length) {
    _kbActivateExpansion(focalIds);
  } else {
    _kbClearExpansion();
    const labels = { today: 'Today', '2d': 'Last 2 Days', week: 'This Week' };
    document.getElementById('kb-stat-count').textContent =
      `No nodes in "${labels[range]}" · ${_kbGraphData.nodes.length} total`;
  }
}

async function kbGraphSearch() {
  const input = document.getElementById('kb-graph-search');
  const query = input.value.trim();
  if (!query) return;

  // Avoid duplicates (case-insensitive)
  if (_kbSearchTerms.some(t => t.toLowerCase() === query.toLowerCase())) {
    input.value = '';
    return;
  }

  _kbSearchTerms.push(query);
  input.value = '';
  _kbRenderSearchChips();
  await _kbApplySearchHighlight();
}

function _kbRenderSearchChips() {
  const chipsRow = document.getElementById('kb-search-chips-row');
  const chipsEl = document.getElementById('kb-search-chips');
  const clearBtn = document.getElementById('kb-search-clear-btn');
  const andBtn = document.getElementById('kb-and-toggle');
  const modeLabel = document.getElementById('kb-search-mode-label');

  if (!_kbSearchTerms.length) {
    chipsRow.style.display = 'none';
    clearBtn.style.display = 'none';
    _kbAndMode = false;
    return;
  }

  chipsRow.style.display = 'flex';
  clearBtn.style.display = '';

  // AND button only meaningful with 2+ terms
  if (_kbSearchTerms.length >= 2) {
    andBtn.style.display = '';
    andBtn.style.background = _kbAndMode ? 'var(--cyan)' : 'var(--bg-main)';
    andBtn.style.color = _kbAndMode ? 'var(--bg)' : 'var(--text-dim)';
    andBtn.style.borderColor = _kbAndMode ? 'var(--cyan)' : 'var(--border)';
  } else {
    andBtn.style.display = 'none';
    _kbAndMode = false;
  }

  modeLabel.textContent = _kbAndMode ? 'AND' : 'OR';
  modeLabel.style.color = _kbAndMode ? 'var(--cyan)' : 'var(--text-dim)';

  // Chips get different color when in AND mode
  const chipBg = _kbAndMode ? 'rgba(0,230,200,0.25)' : 'rgba(0,230,200,0.15)';
  chipsEl.innerHTML = _kbSearchTerms.map((t, i) =>
    `<span class="kb-search-chip" style="background:${chipBg};">${escapeHtml(t)}<button onclick="kbRemoveSearchTerm(${i})" title="Remove">×</button></span>`
  ).join('');
}

async function kbToggleAndMode() {
  _kbAndMode = !_kbAndMode;
  _kbRenderSearchChips();
  await _kbApplySearchHighlight();
}

async function kbRemoveSearchTerm(idx) {
  _kbSearchTerms.splice(idx, 1);
  if (_kbSearchTerms.length < 2) _kbAndMode = false;
  _kbRenderSearchChips();
  if (_kbSearchTerms.length === 0) {
    kbClearSearchHighlight();
  } else {
    await _kbApplySearchHighlight();
  }
}

async function _kbApplySearchHighlight() {
  if (!_kbSearchTerms.length) { kbClearSearchHighlight(); return; }

  // Resolve match set per term
  const perTermSets = [];
  for (const query of _kbSearchTerms) {
    const q = query.toLowerCase();
    const ids = new Set(
      _kbGraphData.nodes
        .filter(n => n.title.toLowerCase().includes(q) || (n.content||'').toLowerCase().includes(q))
        .map(n => n.node_id)
    );
    try {
      const res = await fetch('/api/knowledge/search', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ query, limit: 50 })
      });
      const data = await res.json();
      (data.result || data).forEach(n => { if (n.node_id) ids.add(n.node_id); });
    } catch(e) {}
    perTermSets.push(ids);
  }

  // OR = union, AND = intersection
  let matchIds;
  if (_kbAndMode && perTermSets.length >= 2) {
    matchIds = new Set(perTermSets[0]);
    for (let i = 1; i < perTermSets.length; i++) {
      for (const id of matchIds) {
        if (!perTermSets[i].has(id)) matchIds.delete(id);
      }
    }
  } else {
    matchIds = new Set();
    perTermSets.forEach(s => s.forEach(id => matchIds.add(id)));
  }

  if (!matchIds.size) {
    _kbMatchedIds = new Set();
    _kbUpdateGenerateBtn();
    document.getElementById('kb-stat-count').textContent =
      `No ${_kbAndMode ? 'AND' : 'OR'} matches · ${_kbGraphData.nodes.length} nodes`;
    d3.selectAll('#kb-graph-svg .node circle').attr('opacity', 0.1).attr('stroke-width', 1);
    d3.selectAll('#kb-graph-svg .node text').attr('opacity', 0.06);
    d3.selectAll('#kb-graph-svg .link').attr('opacity', 0.03);
    return;
  }

  _kbMatchedIds = matchIds;
  _kbUpdateGenerateBtn();

  // All matched nodes become focal nodes in explore depth 1 mode
  _kbExpansionDepth = 1;
  _kbActivateExpansion([...matchIds]);
}

function kbClearSearchHighlight() {
  _kbSearchTerms = [];
  _kbAndMode = false;
  _kbMatchedIds = new Set();
  _kbUpdateGenerateBtn();
  _kbRenderSearchChips();
  document.getElementById('kb-graph-search').value = '';
  _kbClearExpansion();
}

function _kbUpdateGenerateBtn() {
  const btn = document.getElementById('kb-generate-prompt-btn');
  if (!btn) return;
  const show = _kbSearchTerms.length > 0 && _kbMatchedIds.size > 0 && _kbMatchedIds.size <= 30;
  btn.style.display = show ? '' : 'none';
  if (show) btn.textContent = `🧠 Prompt (${_kbMatchedIds.size} nodes)`;
}

async function kbGeneratePrompt() {
  const nodeIds = [..._kbMatchedIds];
  if (!nodeIds.length) return;
  const modal = document.getElementById('kb-prompt-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  // Reset state
  document.getElementById('kb-prompt-question').value = '';
  document.getElementById('kb-prompt-preview').textContent = 'Loading…';
  // Pre-fetch preview with empty question
  await kbUpdatePromptPreview();
}

async function kbUpdatePromptPreview() {
  const nodeIds = [..._kbMatchedIds];
  const question = (document.getElementById('kb-prompt-question')?.value || '').trim();
  try {
    const res = await fetch('/api/knowledge/prompt', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ node_ids: nodeIds, question })
    });
    const data = await res.json();
    document.getElementById('kb-prompt-preview').textContent = data.prompt || '';
  } catch(e) {
    document.getElementById('kb-prompt-preview').textContent = 'Error building prompt: ' + e.message;
  }
}

function kbCopyPrompt() {
  const text = document.getElementById('kb-prompt-preview')?.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('kb-copy-prompt-btn');
    if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy Prompt'; }, 2000); }
  }).catch(() => {});
}

// ── Neighborhood Expansion ──────────────────────────────────────────────────

function _kbBuildAdjacency() {
  const adj = {};
  _kbGraphData.nodes.forEach(n => { adj[n.node_id] = []; });
  _kbGraphData.edges.forEach(e => {
    if (adj[e.source_id]) adj[e.source_id].push(e.target_id);
    if (adj[e.target_id]) adj[e.target_id].push(e.source_id);
  });
  return adj;
}

function _kbBFS(focalIds, depth) {
  const adj = _kbBuildAdjacency();
  const distances = new Map();
  const queue = [];
  focalIds.forEach(id => { distances.set(id, 0); queue.push(id); });
  let i = 0;
  while (i < queue.length) {
    const cur = queue[i++];
    const d = distances.get(cur);
    if (d >= depth) continue;
    for (const nb of (adj[cur] || [])) {
      if (!distances.has(nb)) {
        distances.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  return distances;
}

function _kbActivateExpansion(focalIdArray) {
  _kbFocalIds = new Set(focalIdArray);
  _kbExpansionActive = true;
  _kbNeighborMap = _kbBFS(_kbFocalIds, _kbExpansionDepth);
  _kbApplyExpansionVisuals();
  _kbShowExpansionBar();
}

function _kbClearExpansion() {
  _kbExpansionActive = false;
  _kbFocalIds = new Set();
  _kbNeighborMap = new Map();
  _kbExpansionDepth = 1;
  // Restore full visibility
  d3.selectAll('#kb-graph-svg .node circle').attr('opacity', n => n.status === 'staged' ? 0.6 : 1).attr('stroke-width', 2)
    .attr('stroke-dasharray', n => n.status === 'staged' ? '4,3' : 'none');
  d3.selectAll('#kb-graph-svg .node text').attr('opacity', 1);
  d3.selectAll('#kb-graph-svg .link').attr('opacity', 0.4);
  _kbHideExpansionBar();
  document.getElementById('kb-stat-count').textContent =
    `${_kbGraphData.nodes.length} nodes · ${_kbGraphData.edges.length} edges`;
}

function _kbApplyExpansionVisuals() {
  if (!_kbExpansionActive) return;
  const map = _kbNeighborMap;
  const maxD = _kbExpansionDepth;

  // Node opacity: focal=1, hop1=0.85, hop2=0.65, hop3=0.5, outside=0.06
  const nodeOpacity = (nodeId) => {
    if (!map.has(nodeId)) return 0.06;
    const d = map.get(nodeId);
    if (d === 0) return 1;
    return Math.max(0.4, 1 - d * 0.2);
  };
  const nodeStroke = (nodeId) => {
    if (!map.has(nodeId)) return 0.5;
    const d = map.get(nodeId);
    if (d === 0) return 3;
    return 2;
  };
  const nodeStrokeColor = (nodeId) => {
    if (!map.has(nodeId)) return '#1a1a2e';
    const d = map.get(nodeId);
    if (d === 0) return '#00e6c8';
    return '#1a1a2e';
  };

  d3.selectAll('#kb-graph-svg .node circle')
    .attr('opacity', d => nodeOpacity(d.node_id))
    .attr('stroke-width', d => nodeStroke(d.node_id))
    .attr('stroke', d => nodeStrokeColor(d.node_id));
  d3.selectAll('#kb-graph-svg .node text')
    .attr('opacity', d => map.has(d.node_id) ? Math.max(0.5, nodeOpacity(d.node_id)) : 0.04);
  d3.selectAll('#kb-graph-svg .link')
    .attr('opacity', e => {
      const sid = e.source.node_id || e.source;
      const tid = e.target.node_id || e.target;
      const sIn = map.has(sid), tIn = map.has(tid);
      if (sIn && tIn) return 0.7;
      if (sIn || tIn) return 0.15;
      return 0.02;
    });

  // Stats
  const focalCount = _kbFocalIds.size;
  const visibleCount = map.size;
  document.getElementById('kb-stat-count').textContent =
    `${focalCount} focal · ${visibleCount} visible (depth ${_kbExpansionDepth}) · ${_kbGraphData.nodes.length} total`;

  // Auto-zoom to visible neighborhood
  _kbZoomToNodes([...map.keys()]);
}

function _kbZoomToNodes(nodeIds) {
  const nodes = _kbGraphData.nodes.filter(n => nodeIds.includes(n.node_id) && n.x != null && n.y != null);
  if (!nodes.length || !_kbZoom || !_kbSvgRef) return;
  const container = document.getElementById('kb-graph-container');
  const W = container.clientWidth, H = container.clientHeight;
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const x0 = Math.min(...xs) - 80, x1 = Math.max(...xs) + 80;
  const y0 = Math.min(...ys) - 80, y1 = Math.max(...ys) + 80;
  const scale = Math.min(3, 0.85 / Math.max((x1-x0)/W, (y1-y0)/H));
  const tx = W/2 - scale*(x0+x1)/2, ty = H/2 - scale*(y0+y1)/2;
  _kbSvgRef.transition().duration(500)
    .call(_kbZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function kbExpandMore() {
  if (!_kbExpansionActive) return;
  _kbExpansionDepth++;
  _kbNeighborMap = _kbBFS(_kbFocalIds, _kbExpansionDepth);
  _kbApplyExpansionVisuals();
  _kbUpdateExpansionBar();
}

function kbExpandLess() {
  if (!_kbExpansionActive || _kbExpansionDepth <= 1) return;
  _kbExpansionDepth--;
  _kbNeighborMap = _kbBFS(_kbFocalIds, _kbExpansionDepth);
  _kbApplyExpansionVisuals();
  _kbUpdateExpansionBar();
}

function kbExpandClear() {
  _kbClearExpansion();
  // Reset type filter button
  _kbActiveFilter = '';
  document.querySelectorAll('.kb-filter-btn').forEach(b => b.classList.remove('active'));
  const allBtn = document.querySelector('.kb-filter-btn[data-type=""]');
  if (allBtn) allBtn.classList.add('active');
  document.getElementById('kb-filter-label').style.display = 'none';
  // Reset recency dropdown
  const sel = document.getElementById('kb-recency-select');
  if (sel) sel.value = 'all';
}

// Explore from a selected node
function kbExploreNode(nodeId) {
  _kbExpansionDepth = 1;
  _kbActivateExpansion([nodeId]);
}

function _kbShowExpansionBar() {
  let bar = document.getElementById('kb-expansion-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'kb-expansion-bar';
    bar.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:5px 12px;background:rgba(10,10,30,0.92);border:1px solid var(--cyan);border-radius:8px;z-index:20;font-family:var(--font-mono);backdrop-filter:blur(8px);';
    document.getElementById('kb-graph-container').appendChild(bar);
  }
  bar.style.display = 'flex';
  _kbUpdateExpansionBar();
}

function _kbHideExpansionBar() {
  const bar = document.getElementById('kb-expansion-bar');
  if (bar) bar.style.display = 'none';
}

function _kbUpdateExpansionBar() {
  const bar = document.getElementById('kb-expansion-bar');
  if (!bar) return;
  const canLess = _kbExpansionDepth > 1;
  bar.innerHTML = `
    <span style="font-size:0.45rem;color:var(--cyan);text-transform:uppercase;letter-spacing:1px;">Depth</span>
    <button onclick="kbExpandLess()" style="width:24px;height:24px;background:${canLess ? 'var(--bg-card)' : 'transparent'};color:${canLess ? 'var(--text)' : 'var(--text-dim)'};border:1px solid ${canLess ? 'var(--border)' : 'transparent'};border-radius:4px;cursor:${canLess ? 'pointer' : 'default'};font-size:0.7rem;display:flex;align-items:center;justify-content:center;" ${canLess ? '' : 'disabled'}>−</button>
    <span style="font-size:0.7rem;color:var(--text);min-width:20px;text-align:center;font-weight:bold;">${_kbExpansionDepth}</span>
    <button onclick="kbExpandMore()" style="width:24px;height:24px;background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:0.7rem;display:flex;align-items:center;justify-content:center;">+</button>
    <span style="font-size:0.45rem;color:var(--text-dim);margin:0 2px;">|</span>
    <span style="font-size:0.45rem;color:var(--text-dim);">${_kbFocalIds.size} focal · ${_kbNeighborMap.size} visible</span>
    <button onclick="kbExpandClear()" style="background:none;border:1px solid rgba(239,68,68,0.4);color:var(--red);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:0.45rem;font-family:var(--font-mono);">✕</button>
  `;
}


async function kbDeleteEdge(edgeId, nodeId) {
  try {
    const r = await fetch(`/api/knowledge/edges/${edgeId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed');
    _kbInited = false;
    await kbLoadGraph();
    kbReselectNode();
  } catch(e) { alert('Failed to remove link: ' + e.message); }
}

async function kbDeleteNode(nodeId) {
  if (!confirm('Delete this node and all its connections?')) return;
  try {
    await fetch(`/api/knowledge/${nodeId}`, { method: 'DELETE' });
    _kbSelectedNode = null;
    kbShowDetailEmpty();
    _kbInited = false;
    kbLoadGraph();
  } catch(e) { alert('Failed: ' + e.message); }
}

function kbEditNode(nodeId) {
  const nodeData = _kbGraphData.nodes.find(n => n.node_id === nodeId) || _kbSelectedNode;
  if (!nodeData) return;
  const panel = document.getElementById('kb-detail-content');
  const meta = nodeData.metadata || {};
  const types = ['insight','client','domain','service','library','technology','project','concept','repo','session','issue'];
  panel.innerHTML = `
    <div style="font-family:'Orbitron',sans-serif;font-size:0.55rem;color:var(--cyan);margin-bottom:12px;letter-spacing:1px;">EDIT NODE</div>
    <div style="margin-bottom:8px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">TITLE</label>
      <input type="text" id="kb-edit-title" value="${escapeHtml(nodeData.title)}" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.6rem;box-sizing:border-box;">
    </div>
    <div style="margin-bottom:8px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">TYPE</label>
      <select id="kb-edit-type" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.6rem;">
        ${types.map(t => `<option value="${t}"${t === nodeData.node_type ? ' selected' : ''}>${KB_NODE_ICONS[t] || ''} ${t}</option>`).join('')}
      </select>
    </div>
    <div style="margin-bottom:8px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">CONTENT</label>
      <textarea id="kb-edit-content" rows="4" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.6rem;resize:vertical;box-sizing:border-box;">${escapeHtml(nodeData.content || '')}</textarea>
    </div>
    <div style="margin-bottom:8px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">REPO</label>
      <input type="text" id="kb-edit-repo" value="${escapeHtml(meta.repo || '')}" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.6rem;box-sizing:border-box;">
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">FILES (comma-separated)</label>
      <input type="text" id="kb-edit-files" value="${escapeHtml((meta.files || []).join(', '))}" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.6rem;box-sizing:border-box;">
    </div>
    <div style="display:flex;gap:6px;">
      <button class="ws-mcp-run-btn" style="margin:0;font-size:0.5rem;" onclick="kbSaveNode('${nodeId}')">💾 Save</button>
      <button class="ctx-btn-sm" style="font-size:0.5rem;" onclick="kbCancelEdit('${nodeId}')">✕ Cancel</button>
    </div>
  `;
}

async function kbSaveNode(nodeId) {
  const title = document.getElementById('kb-edit-title')?.value.trim();
  const node_type = document.getElementById('kb-edit-type')?.value;
  const content = document.getElementById('kb-edit-content')?.value;
  const repo = document.getElementById('kb-edit-repo')?.value.trim();
  const filesStr = document.getElementById('kb-edit-files')?.value || '';
  const files = filesStr.split(',').map(f => f.trim()).filter(Boolean);

  if (!title) { alert('Title is required'); return; }

  // Preserve workspaces from the existing node — they are managed via link/unlink
  const existingNode = _kbGraphData?.nodes.find(n => n.node_id === nodeId) || _kbSelectedNode;
  const existingWorkspaces = existingNode?.metadata?.workspaces || [];

  try {
    const res = await fetch(`/api/knowledge/nodes/${nodeId}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ title, node_type, content, metadata: { repo, files, workspaces: existingWorkspaces } })
    });
    const data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || 'Save failed')); return; }
    // Update local graph data and refresh panel
    const idx = _kbGraphData.nodes.findIndex(n => n.node_id === nodeId);
    if (idx !== -1) _kbGraphData.nodes[idx] = { ..._kbGraphData.nodes[idx], ...data };
    _kbSelectedNode = data;
    kbSelectNode(data);
    _kbInited = false;
    await kbLoadGraph();
    kbReselectNode();
  } catch(e) { alert('Failed: ' + e.message); }
}

function kbCancelEdit(nodeId) {
  const node = _kbGraphData.nodes.find(n => n.node_id === nodeId) || _kbSelectedNode;
  if (node) kbSelectNode(node);
  else kbShowDetailEmpty();
}

function kbShowAddNodeModal() {
  const types = ['insight','client','domain','service','library','technology','project','concept','repo','session','issue'];
  let html = `<div style="font-family:'Orbitron',sans-serif;font-size:0.6rem;color:var(--cyan);margin-bottom:12px;">ADD KNOWLEDGE NODE</div>
    <div style="margin-bottom:8px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">TYPE</label>
      <select id="kb-add-type" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.6rem;">
        ${types.map(t => `<option value="${t}">${KB_NODE_ICONS[t]} ${t}</option>`).join('')}
      </select>
    </div>
    <div style="margin-bottom:8px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">TITLE</label>
      <input type="text" id="kb-add-title" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.6rem;box-sizing:border-box;" placeholder="Node title...">
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">CONTENT (optional)</label>
      <textarea id="kb-add-content" style="width:100%;min-height:80px;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.6rem;resize:vertical;box-sizing:border-box;" placeholder="Details..."></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="ctx-btn-sm" onclick="document.getElementById('kb-add-modal-overlay').style.display='none'">Cancel</button>
      <button class="ws-mcp-run-btn" style="margin:0;font-size:0.55rem;" onclick="kbAddNodeSubmit()">Create</button>
    </div>`;

  let overlay = document.getElementById('kb-add-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'kb-add-modal-overlay';
    overlay.className = 'ws-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
    overlay.innerHTML = `<div class="ws-modal" style="max-width:420px;" id="kb-add-modal-inner"></div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('kb-add-modal-inner').innerHTML = html;
  overlay.style.display = 'flex';
}

async function kbAddNodeSubmit() {
  const type = document.getElementById('kb-add-type').value;
  const title = document.getElementById('kb-add-title').value.trim();
  const content = document.getElementById('kb-add-content').value.trim();
  if (!title) { alert('Title is required'); return; }
  try {
    await fetch('/api/knowledge/nodes', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ node_type: type, title, content })
    });
    document.getElementById('kb-add-modal-overlay').style.display = 'none';
    _kbInited = false;
    kbLoadGraph();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function kbPruneGraph() {
  const removeOrphans = confirm(
    'Prune the knowledge graph?\n\n' +
    '• Click OK to remove dangling edges AND orphaned nodes (nodes with no connections).\n' +
    '• Click Cancel to remove only dangling edges (safer).'
  );
  // If user dismissed entirely, bail — but we can't distinguish Cancel from dismiss easily.
  // Use a two-step approach: first confirm prune at all, then ask about orphans.
  if (!confirm('Run graph prune? This will clean up dangling edges' + (removeOrphans ? ' and orphaned nodes.' : ' only.'))) return;
  try {
    const res = await fetch('/api/knowledge/prune', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ remove_orphan_nodes: removeOrphans })
    });
    const data = await res.json();
    if (!res.ok) { alert('Prune failed: ' + (data.error || 'Unknown error')); return; }
    alert(`✅ Prune complete\nEdges removed: ${data.edges_removed}\nNodes removed: ${data.nodes_removed}`);
    _kbInited = false;
    await kbLoadGraph();
  } catch(e) { alert('Prune failed: ' + e.message); }
}

async function kbConnectSubmit(sourceId) {
  const targetIds = [..._kbConnectSelectedIds];
  const edgeType = document.getElementById('kb-connect-type').value;
  if (!targetIds.length) { alert('Please select at least one target node'); return; }
  try {
    for (const targetId of targetIds) {
      await fetch('/api/knowledge/edges', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ source_id: sourceId, target_id: targetId, edge_type: edgeType })
      });
    }
    document.getElementById('kb-add-modal-overlay').style.display = 'none';
    _kbInited = false;
    await kbLoadGraph();
    kbReselectNode();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function kbLinkWorkspaceModal(nodeId) {
  // Load workspaces for picker
  let workspaces = [];
  try {
    const r = await fetch('/api/workspaces?_=' + Date.now());
    const d = await r.json();
    workspaces = d.result || d || [];
  } catch(e) {}

  const html = `<div style="font-family:'Orbitron',sans-serif;font-size:0.6rem;color:var(--cyan);margin-bottom:12px;">LINK TO WORKSPACE</div>
    <div style="font-size:0.55rem;color:var(--text-dim);margin-bottom:10px;">This node will appear in the workspace Knowledge tab and be filtered when viewing that workspace.</div>
    <div style="margin-bottom:12px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">WORKSPACE</label>
      <select id="kb-link-ws-select" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.55rem;">
        ${workspaces.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="ctx-btn-sm" onclick="document.getElementById('kb-add-modal-overlay').style.display='none'">Cancel</button>
      <button class="ws-mcp-run-btn" style="margin:0;font-size:0.55rem;" onclick="kbLinkWorkspaceSubmit('${nodeId}')">Link</button>
    </div>`;

  let overlay = document.getElementById('kb-add-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'kb-add-modal-overlay';
    overlay.className = 'ws-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
    overlay.innerHTML = `<div class="ws-modal" style="max-width:420px;" id="kb-add-modal-inner"></div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('kb-add-modal-inner').innerHTML = html;
  overlay.style.display = 'flex';
}

async function kbLinkWorkspaceSubmit(nodeId) {
  const wsId = document.getElementById('kb-link-ws-select').value;
  if (!wsId) return;
  try {
    const res = await fetch('/api/knowledge/link-workspace', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ node_id: nodeId, workspace_id: wsId })
    });
    if (!res.ok) { const t = await res.text(); throw new Error(t); }
    const data = await res.json();
    document.getElementById('kb-add-modal-overlay').style.display = 'none';
    if (data.linked) {
      _kbInited = false;
      kbLoadGraph();
    }
  } catch(e) { alert('Failed: ' + e.message); }
}

async function kbUnlinkWorkspace(nodeId, wsId) {
  if (!confirm('Remove this node from workspace?')) return;
  try {
    const res = await fetch('/api/knowledge/unlink-workspace', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ node_id: nodeId, workspace_id: wsId })
    });
    if (!res.ok) throw new Error(await res.text());
    const nodeData = _kbGraphData.nodes.find(n => n.node_id === nodeId);
    if (nodeData) {
      const meta = nodeData.metadata || {};
      meta.workspaces = (meta.workspaces || []).filter(w => w !== wsId);
      nodeData.metadata = meta;
      kbSelectNode(nodeData);
    }
  } catch(e) { alert('Failed to unlink: ' + e.message); }
}

// ── Multi-select + Merge ─────────────────────────────────────────────────

function kbToggleMultiSelect(d) {
  if (_kbSelectedNodes.has(d.node_id)) {
    _kbSelectedNodes.delete(d.node_id);
  } else {
    _kbSelectedNodes.set(d.node_id, d);
  }
  _kbUpdateNodeHighlights();
  if (_kbSelectedNodes.size >= 2) {
    kbShowMergePanel();
  } else if (_kbSelectedNodes.size === 1) {
    const [, node] = [..._kbSelectedNodes.entries()][0];
    kbSelectNode(node);
  } else {
    kbShowDetailEmpty();
  }
}

function _kbUpdateNodeHighlights() {
  // If expansion mode is active, let _kbApplyExpansionVisuals handle visuals
  if (_kbExpansionActive) {
    _kbApplyExpansionVisuals();
    return;
  }
  d3.selectAll('#kb-graph-svg .node circle')
    .attr('stroke', n => {
      if (_kbSelectedNodes.size > 0) {
        return _kbSelectedNodes.has(n.node_id) ? '#00e6c8' : '#1a1a2e';
      }
      return (_kbSelectedNode && n.node_id === _kbSelectedNode.node_id) ? '#fff' : '#1a1a2e';
    })
    .attr('stroke-width', n => {
      if (_kbSelectedNodes.size > 0) {
        return _kbSelectedNodes.has(n.node_id) ? 4 : 1.5;
      }
      return (_kbSelectedNode && n.node_id === _kbSelectedNode.node_id) ? 3 : 2;
    })
    .attr('opacity', n => {
      if (_kbSelectedNodes.size > 0) {
        return _kbSelectedNodes.has(n.node_id) ? (n.status === 'staged' ? 0.6 : 1) : 0.3;
      }
      return n.status === 'staged' ? 0.6 : 1;
    })
    .attr('stroke-dasharray', n => n.status === 'staged' ? '4,3' : 'none');
  d3.selectAll('#kb-graph-svg .node text')
    .attr('opacity', n => {
      if (_kbSelectedNodes.size > 0) return _kbSelectedNodes.has(n.node_id) ? 1 : 0.15;
      return 1;
    });
}

function kbShowMergePanel() {
  const panel = document.getElementById('kb-detail-content');
  const nodes = [..._kbSelectedNodes.values()];
  const types = ['insight','client','domain','service','library','technology','project','concept','repo','session','issue'];
  const firstType = nodes[0]?.node_type || 'insight';
  // Count total unique connections across all selected
  const selectedIds = new Set(nodes.map(n => n.node_id));
  const allEdges = _kbGraphData.edges.filter(e => selectedIds.has(e.source_id) || selectedIds.has(e.target_id));
  const externalEdges = allEdges.filter(e => !(selectedIds.has(e.source_id) && selectedIds.has(e.target_id)));

  let nodesHtml = nodes.map((n, i) => {
    const icon = KB_NODE_ICONS[n.node_type] || '❓';
    const color = KB_NODE_COLORS[n.node_type] || '#6b7280';
    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg-main);border-radius:4px;margin-bottom:4px;border-left:3px solid ${color};">
      <span style="font-size:0.7rem;">${icon}</span>
      <span style="flex:1;font-size:0.55rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(n.title)}</span>
      ${i === 0 ? '<span style="font-size:0.4rem;color:var(--cyan);text-transform:uppercase;letter-spacing:1px;">survivor</span>' : `<button onclick="kbDeselectNode('${n.node_id}')" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:0.55rem;padding:0;" title="Remove from selection">✕</button>`}
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div style="font-family:'Orbitron',sans-serif;font-size:0.55rem;color:var(--cyan);margin-bottom:8px;letter-spacing:1px;">MERGE ${nodes.length} NODES</div>
    <div style="font-size:0.45rem;color:var(--text-dim);margin-bottom:10px;">⌘+Click nodes to add/remove from selection. First node is the survivor — its title is kept.</div>
    <div style="margin-bottom:10px;">
      ${nodesHtml}
    </div>
    <div style="margin-bottom:8px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">FINAL TYPE</label>
      <select id="kb-merge-type" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.6rem;">
        ${types.map(t => `<option value="${t}"${t === firstType ? ' selected' : ''}>${KB_NODE_ICONS[t] || ''} ${t}</option>`).join('')}
      </select>
    </div>
    <div style="font-size:0.45rem;color:var(--text-dim);margin-bottom:10px;">
      📊 ${allEdges.length} total connections · ${externalEdges.length} external (will be merged onto survivor)
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button class="ws-mcp-run-btn" style="margin:0;font-size:0.5rem;" onclick="kbMergeSubmit()">🔗 Merge</button>
      <button class="ws-mcp-run-btn" style="margin:0;font-size:0.5rem;background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.4);color:#818cf8;" onclick="kbGenerateStartPrompt()">🚀 Start Prompt</button>
      <button class="ctx-btn-sm" style="font-size:0.5rem;" onclick="kbBulkConnect()">⚡ Connect All</button>
      <button class="ctx-btn-sm" style="font-size:0.5rem;" onclick="kbBulkLinkWorkspace()">🗂️ Add to WS</button>
      <button class="ctx-btn-sm" style="font-size:0.5rem;border-color:rgba(239,68,68,0.3);color:var(--red);" onclick="kbBulkDelete()">✕ Delete All</button>
      <button class="ctx-btn-sm" style="font-size:0.5rem;" onclick="kbClearMultiSelect()">Cancel</button>
    </div>
  `;
}

function kbDeselectNode(nodeId) {
  _kbSelectedNodes.delete(nodeId);
  _kbUpdateNodeHighlights();
  if (_kbSelectedNodes.size >= 2) {
    kbShowMergePanel();
  } else if (_kbSelectedNodes.size === 1) {
    const [, node] = [..._kbSelectedNodes.entries()][0];
    _kbSelectedNodes.clear();
    kbSelectNode(node);
    _kbUpdateNodeHighlights();
  } else {
    kbShowDetailEmpty();
  }
}

function kbClearMultiSelect() {
  _kbSelectedNodes.clear();
  _kbUpdateNodeHighlights();
  kbShowDetailEmpty();
}

async function kbMergeSubmit() {
  const nodeIds = [..._kbSelectedNodes.keys()];
  if (nodeIds.length < 2) return;
  const nodeType = document.getElementById('kb-merge-type')?.value || '';
  const survivorTitle = _kbSelectedNodes.get(nodeIds[0])?.title || 'node';
  if (!confirm(`Merge ${nodeIds.length} nodes into "${survivorTitle}"? This cannot be undone.`)) return;
  try {
    const res = await fetch('/api/knowledge/nodes/merge', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ node_ids: nodeIds, node_type: nodeType })
    });
    const data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || 'Merge failed')); return; }
    _kbSelectedNodes.clear();
    _kbSelectedNode = data;
    _kbInited = false;
    await kbLoadGraph();
    kbSelectNode(data);
  } catch(e) { alert('Failed: ' + e.message); }
}

// ── Start Prompt from selected nodes ─────────────────────────────────────

function kbGenerateStartPrompt() {
  const nodes = [..._kbSelectedNodes.values()];
  if (!nodes.length) return;

  const nodeLines = nodes.map(n => {
    const icon = KB_NODE_ICONS[n.node_type] || '';
    return `- ${icon} **${n.title}** (${n.node_type}) — \`${n.node_id}\``;
  }).join('\n');

  const nodeIds = nodes.map(n => n.node_id);

  const prompt = `Use the following knowledge graph nodes as context for this task.

Retrieve full details for each node using the savant-knowledge MCP \`neighbors\` tool with depth 1.

## Starting Nodes

${nodeLines}

## Node IDs (for tool calls)

${nodeIds.map(id => '`' + id + '`').join(', ')}

## Instructions

1. Call \`neighbors({ node_id: "<id>", depth: 1 })\` for each node above to load their content and connections.
2. Use the retrieved knowledge to inform your work.
3. When you create new insights or decisions, store them back using \`store()\` and connect them to the relevant nodes above using \`connect()\`.
`;

  navigator.clipboard.writeText(prompt).then(() => {
    showToast('success', `Prompt with ${nodes.length} node${nodes.length > 1 ? 's' : ''} copied to clipboard`);
  }).catch(() => {
    // Fallback: show in a modal/textarea
    const ta = document.createElement('textarea');
    ta.value = prompt;
    ta.style.cssText = 'position:fixed;top:10%;left:10%;width:80%;height:60%;z-index:99999;background:#1a1b26;color:#c0caf5;border:1px solid var(--cyan);border-radius:8px;padding:16px;font-family:var(--font-mono);font-size:0.6rem;';
    document.body.appendChild(ta);
    ta.select();
    ta.addEventListener('blur', () => ta.remove());
  });
}

// ── Type-ahead Connect ───────────────────────────────────────────────────

// Hidden input stores the selected node_ids (multi-select)
let _kbConnectSelectedIds = new Set();

function kbConnectModal(sourceId) {
  const nodes = _kbGraphData.nodes.filter(n => n.node_id !== sourceId);
  const edgeTypes = ['relates_to','learned_from','applies_to','uses','evolved_from','contributed_to','part_of','integrates_with','depends_on','built_with'];
  _kbConnectSelectedIds = new Set();

  // Group ALL node types (use full canonical list so every type shows even if empty)
  const allTypes = ['client','domain','service','library','technology','insight','project','concept','repo','session'];
  const grouped = {};
  allTypes.forEach(t => { grouped[t] = []; });
  nodes.forEach(n => {
    const t = n.node_type || 'other';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(n);
  });
  Object.values(grouped).forEach(arr => arr.sort((a, b) => (a.title || '').localeCompare(b.title || '')));
  // Only show types that have nodes
  const sortedTypes = allTypes.filter(t => grouped[t] && grouped[t].length > 0);
  // Also include any non-canonical types from the data
  Object.keys(grouped).forEach(t => { if (!allTypes.includes(t) && grouped[t].length) sortedTypes.push(t); });

  const listHtml = _kbBuildConnectList(sortedTypes, grouped, '');

  let html = `<div style="font-family:'Orbitron',sans-serif;font-size:0.6rem;color:var(--cyan);margin-bottom:12px;">CONNECT NODE</div>
    <div style="margin-bottom:8px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">TARGET NODES <span style="opacity:0.6;">(select one or more)</span></label>
      <input type="text" id="kb-connect-search" placeholder="🔍 Search nodes…" autocomplete="off"
        style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:7px 8px;font-family:var(--font-mono);font-size:0.55rem;box-sizing:border-box;margin-bottom:4px;"
        oninput="kbConnectFilter()">
      <div id="kb-connect-list" style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;background:var(--bg-main);">
        ${listHtml}
      </div>
      <div id="kb-connect-selected-label" style="font-size:0.45rem;color:var(--text-dim);margin-top:4px;min-height:14px;"></div>
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">EDGE TYPE</label>
      <select id="kb-connect-type" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.55rem;">
        ${edgeTypes.map(t => `<option value="${t}">${t.replace(/_/g,' ')}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="ctx-btn-sm" onclick="document.getElementById('kb-add-modal-overlay').style.display='none'">Cancel</button>
      <button class="ws-mcp-run-btn" style="margin:0;font-size:0.55rem;" id="kb-connect-submit-btn" onclick="kbConnectSubmit('${sourceId}')">Connect</button>
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

  // Store data for filtering
  window._kbConnectData = { sortedTypes, grouped };
}

function _kbBuildConnectList(sortedTypes, grouped, query) {
  const q = query.toLowerCase().trim();
  let html = '';
  sortedTypes.forEach(type => {
    const items = q
      ? grouped[type].filter(n => n.title.toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q))
      : grouped[type];
    if (!items.length) return;
    const icon = KB_NODE_ICONS[type] || '❓';
    const color = KB_NODE_COLORS[type] || '#6b7280';
    const groupId = `kb-cg-${type}`;
    html += `<div class="kb-connect-group" data-type="${type}">
      <div onclick="kbToggleConnectGroup('${groupId}')" style="display:flex;align-items:center;gap:6px;padding:5px 8px;cursor:pointer;user-select:none;background:rgba(255,255,255,0.03);border-bottom:1px solid var(--border);">
        <span id="${groupId}-arrow" style="font-size:0.5rem;color:var(--text-dim);transition:transform 0.15s;transform:rotate(-90deg);">▼</span>
        <span style="font-size:0.65rem;">${icon}</span>
        <span style="font-size:0.5rem;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.5px;flex:1;">${type}</span>
        <span style="font-size:0.4rem;color:var(--text-dim);background:var(--bg);padding:1px 5px;border-radius:8px;">${items.length}</span>
      </div>
      <div id="${groupId}" style="overflow:hidden;display:none;">
        ${items.map(n => {
          const checked = _kbConnectSelectedIds.has(n.node_id);
          const bg = checked ? 'background:rgba(0,230,200,0.12);' : '';
          return `<label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:6px;padding:4px 8px 4px 14px;cursor:pointer;font-size:0.5rem;color:var(--text);font-family:var(--font-mono);${bg}" onmouseenter="this.style.background='rgba(255,255,255,0.06)'" onmouseleave="this.style.background='${checked ? 'rgba(0,230,200,0.12)' : ''}'">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="kbToggleConnectNode('${n.node_id}')" style="accent-color:var(--cyan);width:13px;height:13px;cursor:pointer;flex-shrink:0;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(n.title)}</span>
          </label>`;
        }).join('')}
      </div>
    </div>`;
  });
  if (!html) html = '<div style="padding:12px;text-align:center;font-size:0.5rem;color:var(--text-dim);">No matching nodes</div>';
  return html;
}

function kbToggleConnectNode(nodeId) {
  if (_kbConnectSelectedIds.has(nodeId)) {
    _kbConnectSelectedIds.delete(nodeId);
  } else {
    _kbConnectSelectedIds.add(nodeId);
  }
  _kbUpdateConnectLabel();
  // Re-render to update checkbox bg highlights
  if (window._kbConnectData) {
    const q = document.getElementById('kb-connect-search')?.value || '';
    document.getElementById('kb-connect-list').innerHTML =
      _kbBuildConnectList(window._kbConnectData.sortedTypes, window._kbConnectData.grouped, q);
  }
}

function _kbUpdateConnectLabel() {
  const label = document.getElementById('kb-connect-selected-label');
  const btn = document.getElementById('kb-connect-submit-btn');
  const count = _kbConnectSelectedIds.size;
  if (label) {
    if (count === 0) {
      label.innerHTML = '';
    } else {
      const names = [..._kbConnectSelectedIds].map(id => {
        const n = _kbGraphData.nodes.find(x => x.node_id === id);
        return n ? escapeHtml(n.title) : id;
      });
      label.innerHTML = `<span style="color:var(--cyan);">${count} selected:</span> ${names.join(', ')}`;
    }
  }
  if (btn) btn.textContent = count > 1 ? `Connect (${count})` : 'Connect';
}

function kbConnectFilter() {
  const q = (document.getElementById('kb-connect-search')?.value || '');
  if (!window._kbConnectData) return;
  document.getElementById('kb-connect-list').innerHTML =
    _kbBuildConnectList(window._kbConnectData.sortedTypes, window._kbConnectData.grouped, q);
}

function kbToggleConnectGroup(groupId) {
  const el = document.getElementById(groupId);
  const arrow = document.getElementById(groupId + '-arrow');
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = '';
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  } else {
    el.style.display = 'none';
    if (arrow) arrow.style.transform = 'rotate(-90deg)';
  }
}


// ── Info Modal ────────────────────────────────────────────────────────────

async function kbShowInfoModal() {
  let url = '/api/knowledge/info?_=' + Date.now();
  if (_kbWsId) url += '&workspace_id=' + _kbWsId;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const nodeGroups = (data.nodes_by_type || []).map(g => {
      const color = KB_NODE_COLORS[g.type] || '#6b7280';
      const icon = KB_NODE_ICONS[g.type] || '❓';
      const items = g.items.map(i =>
        `<div class="kb-edge-item" onclick="kbSelectNodeById('${i.node_id}');document.getElementById('kb-add-modal-overlay').style.display='none';" style="cursor:pointer;">
          <span>${icon}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.5rem;">${escapeHtml(i.title)}</span>
        </div>`
      ).join('');
      return `<div style="margin-bottom:6px;">
        <div onclick="kbToggleConnectGroup('kb-info-ng-${g.type}')" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:4px 0;">
          <span id="kb-info-ng-${g.type}-arrow" style="font-size:0.5rem;transition:transform 0.15s;transform:rotate(-90deg);">▼</span>
          <span style="font-size:0.5rem;color:${color};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${icon} ${g.type} (${g.count})</span>
        </div>
        <div id="kb-info-ng-${g.type}" style="display:none;padding-left:12px;">${items}</div>
      </div>`;
    }).join('');

    const edgeGroups = (data.edges_by_type || []).map(g => {
      const color = KB_EDGE_COLORS[g.type] || '#6b7280';
      const items = g.items.map(i =>
        `<div style="font-size:0.45rem;color:var(--text-dim);padding:2px 0;display:flex;gap:4px;">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(i.source)}</span>
          <span style="color:${color};">→</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(i.target)}</span>
        </div>`
      ).join('');
      return `<div style="margin-bottom:6px;">
        <div onclick="kbToggleConnectGroup('kb-info-eg-${g.type}')" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:4px 0;">
          <span id="kb-info-eg-${g.type}-arrow" style="font-size:0.5rem;transition:transform 0.15s;transform:rotate(-90deg);">▼</span>
          <span style="font-size:0.5rem;color:${color};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${g.type.replace(/_/g,' ')} (${g.count})</span>
        </div>
        <div id="kb-info-eg-${g.type}" style="display:none;padding-left:12px;">${items}</div>
      </div>`;
    }).join('');

    const html = `<div style="font-family:'Orbitron',sans-serif;font-size:0.6rem;color:var(--cyan);margin-bottom:12px;">KNOWLEDGE GRAPH INFO</div>
      <div style="display:flex;gap:16px;margin-bottom:12px;">
        <div style="font-size:0.7rem;color:var(--text);"><strong>${data.total_nodes}</strong> <span style="font-size:0.5rem;color:var(--text-dim);">nodes</span></div>
        <div style="font-size:0.7rem;color:var(--text);"><strong>${data.total_edges}</strong> <span style="font-size:0.5rem;color:var(--text-dim);">edges</span></div>
      </div>
      <div style="display:flex;gap:12px;max-height:400px;">
        <div style="flex:1;overflow-y:auto;padding-right:8px;">
          <div style="font-size:0.45rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;font-weight:600;">NODES BY TYPE</div>
          ${nodeGroups || '<div style="font-size:0.5rem;color:var(--text-dim);">No nodes</div>'}
        </div>
        <div style="width:1px;background:var(--border);flex-shrink:0;"></div>
        <div style="flex:1;overflow-y:auto;padding-left:8px;">
          <div style="font-size:0.45rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;font-weight:600;">EDGES BY TYPE</div>
          ${edgeGroups || '<div style="font-size:0.5rem;color:var(--text-dim);">No edges</div>'}
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
        <button class="ctx-btn-sm" onclick="document.getElementById('kb-add-modal-overlay').style.display='none'">Close</button>
      </div>`;

    let overlay = document.getElementById('kb-add-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'kb-add-modal-overlay';
      overlay.className = 'ws-modal-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
      overlay.innerHTML = `<div class="ws-modal" style="max-width:620px;" id="kb-add-modal-inner"></div>`;
      document.body.appendChild(overlay);
    }
    document.getElementById('kb-add-modal-inner').innerHTML = html;
    overlay.querySelector('.ws-modal').style.maxWidth = '620px';
    overlay.style.display = 'flex';
  } catch(e) { console.error('Info modal error:', e); }
}



// ── Bulk Actions (multi-select) ──────────────────────────────────────────

async function kbBulkDelete() {
  const ids = [..._kbSelectedNodes.keys()];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} node(s)? This cannot be undone.`)) return;
  try {
    await fetch('/api/knowledge/nodes/bulk-delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ node_ids: ids }),
    });
    _kbSelectedNodes.clear();
    _kbSelectedNode = null;
    _kbInited = false;
    await kbLoadGraph();
    kbShowDetailEmpty();
  } catch(e) { alert('Bulk delete failed: ' + e.message); }
}

async function kbBulkLinkWorkspace() {
  let workspaces = [];
  try {
    const r = await fetch('/api/workspaces?_=' + Date.now());
    const d = await r.json();
    workspaces = d.result || d || [];
  } catch(e) {}

  const ids = [..._kbSelectedNodes.keys()];
  const html = `<div style="font-family:'Orbitron',sans-serif;font-size:0.6rem;color:var(--cyan);margin-bottom:12px;">ADD ${ids.length} NODES TO WORKSPACE</div>
    <div style="margin-bottom:12px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">WORKSPACE</label>
      <select id="kb-bulk-ws-select" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.55rem;">
        ${workspaces.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="ctx-btn-sm" onclick="document.getElementById('kb-add-modal-overlay').style.display='none'">Cancel</button>
      <button class="ws-mcp-run-btn" style="margin:0;font-size:0.55rem;" onclick="kbBulkLinkWorkspaceSubmit()">Link ${ids.length} Nodes</button>
    </div>`;

  let overlay = document.getElementById('kb-add-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'kb-add-modal-overlay';
    overlay.className = 'ws-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
    overlay.innerHTML = `<div class="ws-modal" style="max-width:420px;" id="kb-add-modal-inner"></div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('kb-add-modal-inner').innerHTML = html;
  overlay.style.display = 'flex';
}

async function kbBulkLinkWorkspaceSubmit() {
  const wsId = document.getElementById('kb-bulk-ws-select').value;
  const ids = [..._kbSelectedNodes.keys()];
  if (!wsId || !ids.length) return;
  try {
    await fetch('/api/knowledge/nodes/bulk-link-workspace', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ node_ids: ids, workspace_id: wsId }),
    });
    document.getElementById('kb-add-modal-overlay').style.display = 'none';
    _kbSelectedNodes.clear();
    _kbInited = false;
    await kbLoadGraph();
    kbShowDetailEmpty();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function kbBulkConnect() {
  if (_kbSelectedNodes.size < 2) return;
  const ids = [..._kbSelectedNodes.keys()];
  const edgeTypes = ['relates_to','learned_from','applies_to','uses','evolved_from','contributed_to','part_of','integrates_with','depends_on','built_with'];
  const html = `<div style="font-family:'Orbitron',sans-serif;font-size:0.6rem;color:var(--cyan);margin-bottom:12px;">CONNECT ${ids.length} NODES</div>
    <div style="font-size:0.5rem;color:var(--text-dim);margin-bottom:10px;">Create edges between the first selected node and all others.</div>
    <div style="margin-bottom:12px;">
      <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">EDGE TYPE</label>
      <select id="kb-bulk-edge-type" style="width:100%;background:var(--bg-main);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font-mono);font-size:0.55rem;">
        ${edgeTypes.map(t => `<option value="${t}">${t.replace(/_/g,' ')}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="ctx-btn-sm" onclick="document.getElementById('kb-add-modal-overlay').style.display='none'">Cancel</button>
      <button class="ws-mcp-run-btn" style="margin:0;font-size:0.55rem;" onclick="kbBulkConnectSubmit()">Connect</button>
    </div>`;

  let overlay = document.getElementById('kb-add-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'kb-add-modal-overlay';
    overlay.className = 'ws-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
    overlay.innerHTML = `<div class="ws-modal" style="max-width:420px;" id="kb-add-modal-inner"></div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('kb-add-modal-inner').innerHTML = html;
  overlay.style.display = 'flex';
}

async function kbBulkConnectSubmit() {
  const ids = [..._kbSelectedNodes.keys()];
  const edgeType = document.getElementById('kb-bulk-edge-type').value;
  const sourceId = ids[0];
  const targetIds = ids.slice(1);
  try {
    await fetch('/api/knowledge/edges/bulk', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ source_id: sourceId, target_ids: targetIds, edge_type: edgeType }),
    });
    document.getElementById('kb-add-modal-overlay').style.display = 'none';
    _kbSelectedNodes.clear();
    _kbInited = false;
    await kbLoadGraph();
    kbShowDetailEmpty();
  } catch(e) { alert('Failed: ' + e.message); }
}
