// ── Context AST ───────────────────────────────────────────────────────────────
// AST tab listing, project AST modal, view toggle controller, D3 tree renderer.
// Depends on: context-core.js (_ctxProjects, _escHtml, etc.)
//             context-complexity.js (_renderComplexityHeatmap, _renderComplexityRadial)
//             D3.js (d3)

// State shared with complexity module
let _astViewMode    = 'tree';  // 'tree' | 'complexity' | 'radial'
let _astCurrentNodes = null;   // raw flat node list for the currently open modal

// ── File-list renderer (memory / code panels) ─────────────────────────────────
// (Moved here from core so that AST-specific openFn 'ctxReadAst' resolves correctly)

// ── AST tab: project card grid ────────────────────────────────────────────────

async function ctxLoadAst() {
  const container = document.getElementById('ctx-ast-list');
  try {
    const res = await fetch('/api/context/repos');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const repos = data.repos || data || [];
    if (!repos.length) {
      container.innerHTML = `<div class="ctx-welcome">🌳 No projects found</div>`;
      return;
    }
    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px; padding:10px 0;">
        ${repos.map(r => `
          <div class="ctx-result-card" onclick="ctxReadProjectAst('${_escHtml(r.name)}')" style="cursor:pointer;">
            <span style="color:var(--cyan);font-weight:700;">📦 ${r.name}</span>
          </div>
        `).join('')}
      </div>`;
  } catch (e) {
    container.innerHTML = '<div style="padding:30px;color:#ef4444;">Failed to load: ' + _escHtml(e.message) + '</div>';
  }
}

// ── Project AST: open full-screen modal ───────────────────────────────────────

async function ctxReadProjectAst(projectName) {
  const modalOverlay = document.getElementById('file-modal');
  const modal        = modalOverlay.querySelector('.modal');
  const title        = document.getElementById('modal-title');
  const content      = document.getElementById('modal-content');
  const contentMd    = document.getElementById('modal-content-md');
  const openBtn      = document.getElementById('open-browser-btn');
  const revealBtn    = document.getElementById('reveal-path-btn');
  const copyBtn      = document.getElementById('copy-file-btn');

  title.innerHTML          = `<span style="color:var(--cyan);">🌳 Project AST:</span> ${projectName}`;
  content.innerHTML        = '<div style="padding:40px;text-align:center;color:var(--text-dim);">Analyzing...</div>';
  content.style.display    = '';
  contentMd.style.display  = 'none';
  if (openBtn)   openBtn.style.display   = 'none';
  if (revealBtn) revealBtn.style.display = 'none';
  if (copyBtn)   copyBtn.style.display   = 'none';
  modal.classList.add('modal-full');
  modalOverlay.classList.add('active');

  const originalClose = window.closeModal;
  window.closeModal = function() {
    modal.classList.remove('modal-full');
    if (copyBtn) copyBtn.style.display = '';
    _astCurrentNodes = null;
    _astViewMode     = 'tree';
    originalClose();
    window.closeModal = originalClose;
  };

  try {
    const res = await fetch('/api/context/ast/list?repo=' + encodeURIComponent(projectName));
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (!data.nodes || !data.nodes.length) {
      content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);">No AST data.</div>';
      return;
    }
    _astCurrentNodes = data.nodes;
    _astViewMode     = 'tree';
    _renderAstModal(content);
  } catch (e) {
    content.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">Error: ${e.message}</div>`;
  }
}

// ── Modal shell: toggle bar ───────────────────────────────────────────────────

function _renderAstModal(container) {
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:10px 20px;border-bottom:1px solid var(--border);background:rgba(0,0,0,0.3);flex-shrink:0;">
      <span style="font-size:0.58rem;color:var(--text-dim);font-weight:600;letter-spacing:0.05em;margin-right:4px;">VIEW</span>
      <button id="ast-toggle-tree"
        onclick="_setAstView('tree')"
        style="padding:4px 14px;border-radius:6px;font-size:0.65rem;font-weight:600;cursor:pointer;border:1px solid var(--cyan);background:var(--cyan);color:#000;transition:all 0.15s;">
        🌳 Tree
      </button>
      <button id="ast-toggle-complexity"
        onclick="_setAstView('complexity')"
        style="padding:4px 14px;border-radius:6px;font-size:0.65rem;font-weight:600;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text-dim);transition:all 0.15s;">
        🔥 Complexity
      </button>
      <button id="ast-toggle-radial"
        onclick="_setAstView('radial')"
        style="padding:4px 14px;border-radius:6px;font-size:0.65rem;font-weight:600;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text-dim);transition:all 0.15s;">
        ◎ Radial
      </button>
      <button id="ast-toggle-cluster"
        onclick="_setAstView('cluster')"
        style="padding:4px 14px;border-radius:6px;font-size:0.65rem;font-weight:600;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text-dim);transition:all 0.15s;">
        ✦ Cluster
      </button>
    </div>
    <div id="ast-modal-view-area"></div>
  `;
  _renderAstView();
}

function _setAstView(mode) {
  _astViewMode = mode;
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
  _style(treeBtn,    mode === 'tree',       'var(--cyan)');
  _style(compBtn,    mode === 'complexity', '#f97316');
  _style(radialBtn,  mode === 'radial',     '#a78bfa');
  _style(clusterBtn, mode === 'cluster',    '#34d399');
  _renderAstView();
}

function _renderAstView() {
  const area = document.getElementById('ast-modal-view-area');
  if (!area || !_astCurrentNodes) return;
  if (_astViewMode === 'tree') {
    const root = _buildUnifiedAstTree(_astCurrentNodes);
    ctxRenderD3Tree(root, area, false, 3);
  } else if (_astViewMode === 'radial') {
    _renderComplexityRadial(_astCurrentNodes, area);
  } else if (_astViewMode === 'cluster') {
    const root = _buildUnifiedAstTree(_astCurrentNodes);
    _renderRadialClusterTree(root, area);
  } else {
    _renderComplexityHeatmap(_astCurrentNodes, area);
  }
}

// ── Hierarchical tree builder for D3 ─────────────────────────────────────────

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

// ── Radial cluster tree ───────────────────────────────────────────────────────

/**
 * Renders the unified AST hierarchy as a collapsible radial (polar) cluster tree.
 * - D3 tree() layout with [2π, radius] size → polar projection
 * - Curved Bezier links (linkRadial)
 * - Per-type node colours matching the legend
 * - Labels with white halo for legibility; truncated past 22 chars
 * - Click to collapse / expand; zoom & pan enabled
 * - Default: expanded to depth 2 (repo → directory level)
 */
function _renderRadialClusterTree(data, container) {
  const cid    = 'ast-cluster-' + Math.random().toString(36).substr(2, 9);
  const height = Math.round(container.clientHeight || window.innerHeight * 0.75);
  const width  = container.clientWidth  || 860;

  container.innerHTML = `
    <div style="display:flex;gap:16px;padding:8px 16px;font-size:0.58rem;color:var(--text-dim);align-items:center;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <span style="font-weight:600;color:var(--text);">Nodes:</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:9px;height:9px;border-radius:50%;background:#22d3ee;display:inline-block;"></span> repo</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:9px;height:9px;border-radius:50%;background:#a78bfa;display:inline-block;"></span> dir</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:9px;height:9px;border-radius:50%;background:#4ade80;display:inline-block;"></span> file</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:9px;height:9px;border-radius:50%;background:#fb923c;display:inline-block;"></span> fn/method</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:9px;height:9px;border-radius:50%;background:#f43f5e;display:inline-block;"></span> class</span>
      <span style="margin-left:auto;font-style:italic;">Click nodes to expand · scroll to zoom · drag to pan</span>
    </div>
    <div id="${cid}" style="width:100%;height:${height - 36}px;overflow:hidden;"></div>
  `;

  const el = document.getElementById(cid);
  const W  = el.clientWidth  || width;
  const H  = el.clientHeight || height - 36;
  const cx = W / 2;
  const cy = H / 2;

  const nodeColor = type => {
    const map = { repo: '#22d3ee', dir: '#a78bfa', file: '#4ade80', function: '#fb923c', method: '#fb923c', class: '#f43f5e' };
    return map[type] || '#94a3b8';
  };

  const svg  = d3.select('#' + cid).append('svg').attr('width', W).attr('height', H);
  const zoom = d3.zoom().scaleExtent([0.08, 4]).on('zoom', e => gRoot.attr('transform', e.transform));
  svg.call(zoom);

  const gRoot = svg.append('g').attr('transform', `translate(${cx},${cy})`);
  const gLinks = gRoot.append('g').attr('fill', 'none').attr('stroke', 'rgba(148,163,184,0.22)').attr('stroke-width', 1.2);
  const gNodes = gRoot.append('g');

  let nodeId = 0;

  // Build d3 hierarchy — fully expanded on first render
  const hierRoot = d3.hierarchy(data);
  hierRoot.descendants().forEach(d => { d._id = ++nodeId; });

  function radialPoint(angle, r) {
    return [r * Math.cos(angle - Math.PI / 2), r * Math.sin(angle - Math.PI / 2)];
  }

  function draw(source) {
    // Compute radius from current node count to keep density manageable
    const visCount = hierRoot.descendants().length;
    const radius   = Math.max(120, Math.min(Math.max(W, H) * 0.42, visCount * 18));

    d3.tree()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth)(hierRoot);

    const nodes = hierRoot.descendants();
    const links = hierRoot.links();

    // ── Links ──────────────────────────────────────────────────────────────────
    const linkSel = gLinks.selectAll('path').data(links, d => d.target._id);

    const diagonal = d3.linkRadial().angle(d => d.x).radius(d => d.y);

    linkSel.enter().append('path')
      .attr('d', () => {
        const o = { x: source._x0 ?? source.x, y: source._y0 ?? source.y };
        return diagonal({ source: o, target: o });
      })
      .merge(linkSel)
      .transition().duration(280)
      .attr('stroke', d => nodeColor(d.target.data.type) + '55')
      .attr('d', diagonal);

    linkSel.exit().transition().duration(200)
      .attr('d', () => {
        const o = { x: source.x, y: source.y };
        return diagonal({ source: o, target: o });
      }).remove();

    // ── Nodes ──────────────────────────────────────────────────────────────────
    const nodeSel = gNodes.selectAll('g.rc-node').data(nodes, d => d._id);

    const enter = nodeSel.enter().append('g')
      .attr('class', 'rc-node')
      .attr('transform', () => {
        const [x, y] = radialPoint(source._x0 ?? source.x, source._y0 ?? source.y);
        return `translate(${x},${y})`;
      })
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        if (d.children)   { d._children = d.children;  d.children  = null; }
        else if (d._children) { d.children  = d._children; d._children = null; }
        d._x0 = d.x; d._y0 = d.y;
        draw(d);
      });


    enter.append('circle')
      .attr('r', 0)
      .attr('stroke-width', 1.5);

    enter.append('title');


    const merged = enter.merge(nodeSel);

    merged.transition().duration(280)
      .attr('transform', d => {
        const [x, y] = radialPoint(d.x, d.y);
        return `translate(${x},${y})`;
      });

    merged.select('circle')
      .attr('r', d => d.depth === 0 ? 7 : (d._children ? 5 : 4))
      .attr('fill', d => nodeColor(d.data.type))
      .attr('fill-opacity', d => (d._children ? 0.35 : 0.9))
      .attr('stroke', d => nodeColor(d.data.type));

    merged.each(function(d) {
      d3.select(this).select('title')
        .text(d.data.name + (d.data.line ? ` · L${d.data.line}` : ''));
    });

    nodeSel.exit().transition().duration(200)
      .attr('transform', () => {
        const [x, y] = radialPoint(source.x, source.y);
        return `translate(${x},${y})`;
      }).remove();

    nodes.forEach(d => { d._x0 = d.x; d._y0 = d.y; });
  }

  draw(hierRoot);

  // Auto-fit: start zoomed out slightly so the whole cluster is visible
  svg.call(zoom.transform, d3.zoomIdentity.translate(cx, cy).scale(0.72));
}

function ctxRenderD3Tree(data, container, isTab = false, expandDepth = 1) {
  const containerId  = 'ast-tree-svg-container-' + Math.random().toString(36).substr(2, 9);
  const legendHtml = `
    <div style="display:flex;gap:16px;padding:8px 16px;font-size:0.58rem;color:var(--text-dim);flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--border);">
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:50%;background:#22d3ee;display:inline-block;"></span> repo</span>
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:50%;background:#a78bfa;display:inline-block;"></span> directory</span>
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:50%;background:#4ade80;display:inline-block;"></span> file</span>
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:50%;background:#fb923c;display:inline-block;"></span> function/method</span>
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:50%;background:#f43f5e;display:inline-block;"></span> class</span>
      <span style="margin-left:auto;font-style:italic;">Click nodes to expand/collapse</span>
    </div>`;

  container.innerHTML = legendHtml + `<div id="${containerId}" style="width:100%;height:${isTab ? 'calc(100vh - 140px)' : 'calc(80vh - 80px)'};overflow:hidden;"></div>`;

  const el     = document.getElementById(containerId);
  const width  = el.clientWidth  || 900;
  const height = el.clientHeight || 600;

  const nodeColor = type => {
    const map = { repo: '#22d3ee', dir: '#a78bfa', file: '#4ade80', function: '#fb923c', method: '#fb923c', class: '#f43f5e' };
    return map[type] || '#94a3b8';
  };

  const svg = d3.select('#' + containerId)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  const g    = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.1, 3]).on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom);

  const treeLayout = d3.tree().size([height - 80, width - 160]).separation((a, b) => (a.parent === b.parent ? 1 : 1.5));

  let i = 0;
  const root = d3.hierarchy(data);
  root.x0 = height / 2;
  root.y0 = 0;

  // Collapse beyond expandDepth
  root.descendants().forEach(d => { if (d.depth >= expandDepth && d.children) { d._children = d.children; d.children = null; } });

  function update(source, rootNode) {
    treeLayout(rootNode);
    const nodes = rootNode.descendants();
    const links = rootNode.links();
    nodes.forEach(d => { d.y = d.depth * 160; });

    // Nodes
    const node = g.selectAll('g.node').data(nodes, d => d.id || (d.id = ++i));
    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', () => { const s = source || rootNode; return `translate(${s.y0 ?? 0},${s.x0 ?? 0})`; })
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        if (d.children) { d._children = d.children; d.children = null; }
        else             { d.children  = d._children; d._children = null; }
        update(d, rootNode);
      });

    nodeEnter.append('circle')
      .attr('r', 0)
      .attr('fill', d => nodeColor(d.data.type))
      .attr('stroke', d => nodeColor(d.data.type))
      .attr('stroke-width', 2)
      .attr('fill-opacity', d => (d._children ? 0.3 : 0.9));

    nodeEnter.append('text')
      .attr('dy', '0.32em')
      .attr('x', d => (d.children || d._children) ? -10 : 10)
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .attr('fill', 'rgba(255,255,255,0.85)')
      .attr('font-size', '10px')
      .attr('font-family', 'var(--font-mono)')
      .text(d => {
        const name = d.data.name || '';
        const max  = 28;
        return name.length > max ? name.slice(0, max) + '…' : name;
      });

    nodeEnter.append('title').text(d => {
      const parts = [d.data.name, d.data.type];
      if (d.data.line) parts.push(`L${d.data.line}`);
      return parts.filter(Boolean).join(' · ');
    });

    const nodeUpdate = nodeEnter.merge(node);
    nodeUpdate.transition().duration(300)
      .attr('transform', d => `translate(${d.y},${d.x})`);
    nodeUpdate.select('circle')
      .attr('r', 5)
      .attr('fill', d => nodeColor(d.data.type))
      .attr('fill-opacity', d => (d._children ? 0.35 : 0.9));

    node.exit().transition().duration(200)
      .attr('transform', () => { const s = source || rootNode; return `translate(${s.y ?? 0},${s.x ?? 0})`; })
      .remove()
      .select('circle').attr('r', 0);

    // Links
    const diagonal = d3.linkHorizontal().x(d => d.y).y(d => d.x);
    const link  = g.selectAll('path.link').data(links, d => d.target.id);
    const linkEnter = link.enter().insert('path', 'g')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', 'rgba(148,163,184,0.25)')
      .attr('stroke-width', 1.5)
      .attr('d', () => { const s = source || rootNode; const o = { x: s.x0 ?? 0, y: s.y0 ?? 0 }; return diagonal({ source: o, target: o }); });

    linkEnter.merge(link).transition().duration(300).attr('d', diagonal);
    link.exit().transition().duration(200)
      .attr('d', () => { const s = source || rootNode; const o = { x: s.x ?? 0, y: s.y ?? 0 }; return diagonal({ source: o, target: o }); })
      .remove();

    nodes.forEach(d => { d.x0 = d.x; d.y0 = d.y; });
  }

  update(root, root);
  svg.call(zoom.transform, d3.zoomIdentity.translate(100, height / 2).scale(0.8));
}
