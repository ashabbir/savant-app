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

// ── AST Interaction Helpers ───────────────────────────────────────────────────

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

function _showAstDrawer(d, drawerId) {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  drawer.style.display = 'block';

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

  drawer.innerHTML = `
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

    <div class="kb-detail-section">
       <h5>Descendants</h5>
       <div style="font-size:0.55rem;color:var(--text-dim);">${d.descendants().length - 1} nested child nodes</div>
    </div>
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
      <span style="margin-left:auto;font-style:italic;">Click nodes to expand · Click type above to set depth</span>
    </div>`;
}

window._astActiveDrawMap = {};
window._astLegClick = function(cid, type) {
  const meta = window._astActiveDrawMap[cid];
  if (meta) _collapseAstToDepth(meta.root, type, meta.draw);
};


// ── Radial cluster tree ───────────────────────────────────────────────────────

function _renderRadialClusterTree(data, container) {
  const cid    = 'ast-cluster-' + Math.random().toString(36).substr(2, 9);
  const height = Math.round(container.clientHeight || window.innerHeight * 0.75);
  const width  = container.clientWidth  || 860;
  const drawerId = cid + '-drawer';

  container.innerHTML = _renderAstInteractiveLegend(cid) + `
    <div style="display:flex;height:${height - 36}px;">
      <div id="${cid}" style="flex:1;overflow:hidden;position:relative;"></div>
      <div id="${drawerId}" style="width:280px;border-left:1px solid var(--border);background:var(--bg-panel, rgba(0,0,0,0.15));padding:16px;overflow-y:auto;display:none;"></div>
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
    const hierRoot = d3.hierarchy(data);
    hierRoot.descendants().forEach(d => { d._id = ++nodeId; });

    function radialPoint(angle, r) {
      return [r * Math.cos(angle - Math.PI / 2), r * Math.sin(angle - Math.PI / 2)];
    }

    function draw(source) {
      const visCount = hierRoot.descendants().length;
      const radius   = Math.max(120, Math.min(Math.max(W, H) * 0.42, visCount * 18));
      d3.tree()
        .size([2 * Math.PI, radius])
        .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(hierRoot);

      const nodes = hierRoot.descendants();
      const links = hierRoot.links();

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
          if (d.children)   { d._children = d.children;  d.children  = null; }
          else if (d._children) { d.children  = d._children; d._children = null; }
          d._x0 = d.x; d._y0 = d.y;
          draw(d);
          _showAstDrawer(d, drawerId);
        });

      enter.append('circle').attr('r', 0).attr('stroke-width', 1.5);
      enter.append('title');

      const merged = enter.merge(nodeSel);
      merged.transition().duration(280).attr('transform', d => { const [x, y] = radialPoint(d.x, d.y); return `translate(${x},${y})`; });

      merged.select('circle')
        .attr('r', d => d.depth === 0 ? 7 : (d._children ? 5 : 4))
        .attr('fill', d => nodeColor(d.data.type))
        .attr('fill-opacity', d => (d._children ? 0.35 : 0.9))
        .attr('stroke', d => nodeColor(d.data.type));

      merged.each(function(d) { d3.select(this).select('title').text(d.data.name + (d.data.line ? ` · L${d.data.line}` : '')); });
      nodeSel.exit().transition().duration(200).attr('transform', () => { const [x, y] = radialPoint(source.x, source.y); return `translate(${x},${y})`; }).remove();
      nodes.forEach(d => { d._x0 = d.x; d._y0 = d.y; });
    }

    window._astActiveDrawMap[cid] = { root: hierRoot, draw: draw };

    // Collapse to 'class' by default for cluster
    _collapseAstToDepth(hierRoot, 'class');
    draw(hierRoot);
    svg.call(zoom.transform, d3.zoomIdentity.translate(cx, cy).scale(0.72));
  }, 10);
}

// ── D3 Collapsible Tree ───────────────────────────────────────────────────────

function ctxRenderD3Tree(data, container, isTab = false, expandDepth = 1) {
  const cid  = 'ast-tree-' + Math.random().toString(36).substr(2, 9);
  const containerHeight = isTab ? 'calc(100vh - 140px)' : 'calc(80vh - 80px)';
  const drawerId = cid + '-drawer';

  container.innerHTML = _renderAstInteractiveLegend(cid) + `
    <div style="display:flex;height:${containerHeight};">
      <div id="${cid}" style="flex:1;overflow:hidden;position:relative;"></div>
      <div id="${drawerId}" style="width:280px;border-left:1px solid var(--border);background:var(--bg-panel, rgba(0,0,0,0.15));padding:16px;overflow-y:auto;display:none;"></div>
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
          if (d.children) { d._children = d.children; d.children = null; }
          else            { d.children  = d._children; d._children = null; }
          draw(d, scopeRoot);
          _showAstDrawer(d, drawerId);
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
          return name.length > 25 ? name.slice(0, 25) + '…' : name;
        });

      nodeEnter.append('title');

      const nodeUpdate = nodeEnter.merge(node);
      nodeUpdate.transition().duration(300).attr('transform', d => `translate(${d.y},${d.x})`);
      nodeUpdate.select('circle')
        .attr('r', 5)
        .attr('fill', d => nodeColor(d.data.type))
        .attr('fill-opacity', d => (d._children ? 0.35 : 0.9));
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

    window._astActiveDrawMap[cid] = { root: hierRoot, draw: d => draw(hierRoot, hierRoot) };

    // Collapse to 'function' by default for tree
    _collapseAstToDepth(hierRoot, 'function');
    draw(hierRoot, hierRoot);
    svg.call(zoom.transform, d3.zoomIdentity.translate(80, height / 2).scale(0.85));
  }, 10);
}
