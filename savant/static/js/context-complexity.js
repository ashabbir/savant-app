// ── Context Complexity ────────────────────────────────────────────────────────
// McCabe-inspired complexity computation, heatmap renderer, and radial sunburst.
// Depends on: context-core.js (_escHtml)
//             D3.js (d3)

// ── Complexity computation ────────────────────────────────────────────────────

/**
 * Compute a McCabe-inspired complexity score for every function/method/class
 * node in the flat AST node list.
 *
 * Score = 1 (base)
 *       + child_count          (nested fn/method nodes within line range)
 *       + line_density_bonus   (ceil of (span-10)/15 clamped to ≥ 0)
 *
 * Thresholds: 1-5 Low · 6-10 Moderate · 11-20 Risky · 21+ High
 */
function _computeAstComplexity(nodes) {
  const TYPED   = new Set(['function', 'method', 'class']);
  const fnNodes = nodes.filter(n => TYPED.has(n.node_type));

  const byFile = {};
  fnNodes.forEach(n => {
    const key = n.repo + '::' + n.path;
    if (!byFile[key]) byFile[key] = { repo: n.repo, path: n.path, functions: [] };
    byFile[key].functions.push(Object.assign({}, n, { child_count: 0, complexity: 1 }));
  });

  Object.values(byFile).forEach(file => {
    const fns = file.functions;
    fns.forEach(fn => {
      fn.child_count = fns.filter(
        g => g !== fn && g.start_line > fn.start_line && g.end_line <= fn.end_line
      ).length;
      const span    = fn.end_line - fn.start_line;
      const lineBonus = Math.ceil(Math.max(0, span - 10) / 15);
      fn.complexity   = 1 + fn.child_count + lineBonus;
    });
    file.total_complexity = fns.reduce((s, f) => s + f.complexity, 0);
    file.functions.sort((a, b) => b.complexity - a.complexity);
  });

  return Object.values(byFile).sort((a, b) => b.total_complexity - a.total_complexity);
}

function _complexityColor(score) {
  if (score <= 5)  return { fg: '#4ade80', bg: 'rgba(74,222,128,0.12)',   label: 'Low' };
  if (score <= 10) return { fg: '#facc15', bg: 'rgba(250,204,21,0.12)',   label: 'Moderate' };
  if (score <= 20) return { fg: '#fb923c', bg: 'rgba(251,146,60,0.12)',   label: 'Risky' };
  return                   { fg: '#f87171', bg: 'rgba(248,113,113,0.12)', label: 'High' };
}

// ── Complexity explorer (left tree + right detail) ────────────────────────────

function _renderComplexityHeatmap(nodes, container) {
  const files = _computeAstComplexity(nodes);

  if (!files.length) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);">No function / method / class nodes found.<br><span style="font-size:0.65rem;">Generate an AST first via the Projects panel.</span></div>';
    return;
  }

  const totalFns   = files.reduce((s, f) => s + f.functions.length, 0);
  const totalScore = files.reduce((s, f) => s + f.total_complexity, 0);
  const avgFile    = files.length ? Math.round(totalScore / files.length) : 0;
  const highRisk   = files.filter(f => f.total_complexity > 20).length;
  const avgC       = _complexityColor(avgFile);

  const uid    = 'cx-' + Math.random().toString(36).substr(2, 6);
  const leftId = uid + '-left';
  const rightId= uid + '-right';

  const statsBar = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);background:rgba(0,0,0,0.15);">
      <div style="display:flex;align-items:center;gap:12px;padding:8px 16px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border);">
        <div style="font-size:1.6rem;font-weight:700;color:var(--cyan);line-height:1;">${files.length}</div>
        <div style="font-size:0.55rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;line-height:1.2;">Files<br>Analyzed</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;padding:8px 16px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border);">
        <div style="font-size:1.6rem;font-weight:700;color:var(--cyan);line-height:1;">${totalFns}</div>
        <div style="font-size:0.55rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;line-height:1.2;">Functions<br>Classes</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;padding:8px 16px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border);">
        <div style="font-size:1.6rem;font-weight:700;color:${avgC.fg};line-height:1;">${avgFile}</div>
        <div style="font-size:0.55rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;line-height:1.2;">Avg File<br>Score</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;padding:8px 16px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border);">
        <div style="font-size:1.6rem;font-weight:700;color:${highRisk > 0 ? '#f87171' : '#4ade80'};line-height:1;">${highRisk}</div>
        <div style="font-size:0.55rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;line-height:1.2;">High-Risk<br>Files</div>
      </div>
    </div>`;

  container.innerHTML = statsBar + `
    <div style="display:grid;grid-template-columns:260px 1fr;height:calc(80vh - 44px - 62px);overflow:hidden;">
      <div id="${leftId}" style="border-right:1px solid var(--border);overflow-y:auto;background:rgba(0,0,0,0.18);">
        <div id="${uid}-tree" style="padding:10px 0;"></div>
      </div>
      <div id="${rightId}" style="overflow-y:auto;"></div>
    </div>`;

  const treeEl  = document.getElementById(uid + '-tree');
  const rightEl = document.getElementById(rightId);

  _cxRenderTreeChildren(_cxBuildTree(files).children, treeEl, rightEl, 0);
  _cxRenderOverview(files, rightEl);
}

// ── Tree builder ──────────────────────────────────────────────────────────────

function _cxBuildTree(files) {
  const root = { children: {}, totalComplexity: 0 };
  files.forEach(f => {
    const parts = [f.repo, ...f.path.split('/')];
    let node = root;
    root.totalComplexity += f.total_complexity;
    parts.forEach((part, i) => {
      const isLast = (i === parts.length - 1);
      if (!node.children[part]) {
        node.children[part] = { name: part, type: i === 0 ? 'repo' : isLast ? 'file' : 'dir', children: {}, totalComplexity: 0, file: null };
      }
      node.children[part].totalComplexity += f.total_complexity;
      if (isLast) node.children[part].file = f;
      node = node.children[part];
    });
  });
  return root;
}

// ── Tree renderer ─────────────────────────────────────────────────────────────

function _cxRenderTreeChildren(childMap, parentEl, rightEl, depth) {
  const sorted = Object.values(childMap).sort((a, b) => {
    if (a.type !== 'file' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type !== 'file') return 1;
    return b.totalComplexity - a.totalComplexity;
  });

  sorted.forEach(node => {
    const c      = _complexityColor(node.totalComplexity);
    const pad    = 10 + depth * 14;
    const isFile = node.type === 'file';
    const icon   = node.type === 'repo' ? '📦' : isFile ? '📄' : '📁';

    const row = document.createElement('div');
    row.className = 'cx-tree-row';
    row.style.cssText = `display:flex;align-items:center;gap:5px;padding:4px 8px 4px ${pad}px;cursor:pointer;font-size:0.6rem;transition:background 0.1s;user-select:none;`;

    const arrowEl = document.createElement('span');
    arrowEl.style.cssText = 'color:var(--text-dim);font-size:0.5rem;width:9px;flex-shrink:0;';
    arrowEl.textContent   = isFile ? '' : '▾';

    const iconEl = document.createElement('span');
    iconEl.style.cssText = 'flex-shrink:0;opacity:0.75;';
    iconEl.textContent   = icon;

    const nameEl = document.createElement('span');
    nameEl.style.cssText = `flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);color:${node.type === 'repo' ? 'var(--cyan)' : 'var(--text)'};`;
    nameEl.textContent   = node.name;
    nameEl.title         = node.file ? node.file.path : node.name;

    const badgeEl = document.createElement('span');
    badgeEl.style.cssText = `background:${c.bg};color:${c.fg};padding:1px 6px;border-radius:8px;font-weight:700;flex-shrink:0;font-size:0.52rem;`;
    badgeEl.textContent   = node.totalComplexity;

    row.appendChild(arrowEl);
    row.appendChild(iconEl);
    row.appendChild(nameEl);
    row.appendChild(badgeEl);

    if (isFile) {
      row.addEventListener('mouseenter', () => { if (!row.classList.contains('cx-active')) row.style.background = 'rgba(255,255,255,0.04)'; });
      row.addEventListener('mouseleave', () => { if (!row.classList.contains('cx-active')) row.style.background = ''; });
      row.addEventListener('click', () => {
        document.querySelectorAll('.cx-tree-row.cx-active').forEach(r => { r.classList.remove('cx-active'); r.style.background = ''; });
        row.classList.add('cx-active');
        row.style.background = 'rgba(34,211,238,0.1)';
        _cxRenderFileDetail(node.file, rightEl);
      });
      parentEl.appendChild(row);
    } else {
      const childrenEl = document.createElement('div');
      let collapsed    = false;
      _cxRenderTreeChildren(node.children, childrenEl, rightEl, depth + 1);
      row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.03)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', () => {
        collapsed = !collapsed;
        childrenEl.style.display = collapsed ? 'none' : '';
        arrowEl.textContent      = collapsed ? '▸' : '▾';
      });
      parentEl.appendChild(row);
      parentEl.appendChild(childrenEl);
    }
  });
}

// ── Right panel: overview ─────────────────────────────────────────────────────

function _cxRenderOverview(files, container) {
  const maxScore = files[0] ? files[0].total_complexity : 1;

  const topRows = files.slice(0, 15).map(f => {
    const c   = _complexityColor(f.total_complexity);
    const pct = Math.round((f.total_complexity / maxScore) * 100);
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text);width:160px;min-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escHtml(f.path)}">${_escHtml(f.path)}</span>
        <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
          <div style="height:4px;background:${c.fg};border-radius:2px;width:${pct}%;opacity:0.8;"></div>
        </div>
        <span style="font-size:0.52rem;color:var(--text-dim);flex-shrink:0;width:35px;text-align:right;">${f.functions.length} fns</span>
        <span style="font-size:0.55rem;font-weight:700;color:${c.fg};flex-shrink:0;width:30px;text-align:right;">${f.total_complexity}</span>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div style="padding:20px 24px;">

      <div style="font-size:0.55rem;font-weight:700;color:var(--text-dim);letter-spacing:0.1em;margin-bottom:12px;">
        TOP COMPLEXITY FILES — click a file in the tree to inspect
      </div>
      <div>${topRows}</div>

      <div style="display:flex;gap:14px;padding-top:14px;margin-top:8px;border-top:1px solid var(--border);font-size:0.55rem;color:var(--text-dim);align-items:center;flex-wrap:wrap;">
        <span style="font-weight:600;color:var(--text);">Score:</span>
        <span><span style="color:#4ade80;">●</span> 1–5 Low</span>
        <span><span style="color:#facc15;">●</span> 6–10 Moderate</span>
        <span><span style="color:#fb923c;">●</span> 11–20 Risky</span>
        <span><span style="color:#f87171;">●</span> 21+ High</span>
        <span style="margin-left:auto;font-style:italic;">score = 1 + nested children + line-density bonus</span>
      </div>
    </div>`;
}

// ── Right panel: file detail ──────────────────────────────────────────────────

function _cxRenderFileDetail(file, container) {
  if (!file) return;
  const c    = _complexityColor(file.total_complexity);
  const maxC = file.functions.length ? file.functions[0].complexity : 1;

  const rows = file.functions.map(fn => {
    const fc   = _complexityColor(fn.complexity);
    const icon = fn.node_type === 'class' ? '🏛️' : fn.node_type === 'method' ? '◆' : 'λ';
    const span = fn.end_line - fn.start_line;
    const barW = Math.round((fn.complexity / Math.max(maxC, 1)) * 100);
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
        <td style="padding:7px 10px;font-size:0.72rem;">${icon}</td>
        <td style="padding:7px 6px;font-family:var(--font-mono);font-size:0.6rem;color:var(--text);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escHtml(fn.name)}">${_escHtml(fn.name)}</td>
        <td style="padding:7px 6px;font-size:0.57rem;color:var(--text-dim);white-space:nowrap;">L${fn.start_line}–${fn.end_line}</td>
        <td style="padding:7px 8px;font-size:0.57rem;color:var(--text-dim);text-align:center;">${span}</td>
        <td style="padding:7px 8px;font-size:0.57rem;color:var(--text-dim);text-align:center;">${fn.child_count}</td>
        <td style="padding:7px 10px;min-width:140px;">
          <div style="display:flex;align-items:center;gap:7px;">
            <div style="flex:1;height:4px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden;">
              <div style="height:4px;background:${fc.fg};width:${barW}%;border-radius:3px;"></div>
            </div>
            <span style="background:${fc.bg};color:${fc.fg};padding:1px 8px;border-radius:8px;font-weight:700;font-size:0.62rem;flex-shrink:0;">${fn.complexity}</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="padding:18px 22px;">
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.52rem;color:var(--text-dim);letter-spacing:0.08em;margin-bottom:5px;">📄 FILE ANALYSIS</div>
          <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text);word-break:break-all;line-height:1.5;">${_escHtml(file.path)}</div>
          <div style="font-size:0.52rem;color:var(--cyan);margin-top:3px;">📦 ${_escHtml(file.repo)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <div style="text-align:center;padding:10px 16px;background:${c.bg};border-radius:8px;border:1px solid ${c.fg}35;">
            <div style="color:${c.fg};font-size:1.5rem;font-weight:700;">${file.total_complexity}</div>
            <div style="color:var(--text-dim);font-size:0.5rem;margin-top:3px;">${c.label}</div>
          </div>
          <div style="text-align:center;padding:10px 16px;background:rgba(34,211,238,0.08);border-radius:8px;border:1px solid rgba(34,211,238,0.2);">
            <div style="color:var(--cyan);font-size:1.5rem;font-weight:700;">${file.functions.length}</div>
            <div style="color:var(--text-dim);font-size:0.5rem;margin-top:3px;">Functions</div>
          </div>
        </div>
      </div>

      <div style="font-size:0.55rem;font-weight:700;color:var(--text-dim);letter-spacing:0.1em;margin-bottom:10px;">FUNCTION BREAKDOWN</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);">
              <th style="padding:5px 10px;font-size:0.5rem;color:var(--text-dim);font-weight:600;text-align:left;"></th>
              <th style="padding:5px 6px;font-size:0.5rem;color:var(--text-dim);font-weight:600;text-align:left;">Name</th>
              <th style="padding:5px 6px;font-size:0.5rem;color:var(--text-dim);font-weight:600;text-align:left;">Lines</th>
              <th style="padding:5px 8px;font-size:0.5rem;color:var(--text-dim);font-weight:600;text-align:center;">Span</th>
              <th style="padding:5px 8px;font-size:0.5rem;color:var(--text-dim);font-weight:600;text-align:center;">Nested</th>
              <th style="padding:5px 10px;font-size:0.5rem;color:var(--text-dim);font-weight:600;text-align:left;">Score</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Radial sunburst ───────────────────────────────────────────────────────────

/**
 * Renders a two-ring D3 sunburst:
 *   inner ring = files,     arc size ∝ total file complexity, color = risk tier
 *   outer ring = functions, arc size ∝ function complexity,   color = score
 * Hovering a segment updates the detail panel on the right.
 */
function _renderComplexityRadial(nodes, container) {
  const files = _computeAstComplexity(nodes);
  if (!files.length) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);">No function / method / class nodes found.</div>';
    return;
  }

  const cid      = 'ast-radial-' + Math.random().toString(36).substr(2, 9);
  const detailId = cid + '-info';

  container.innerHTML = `
    <div style="display:flex; height:calc(80vh - 44px); overflow:hidden;">
      <div id="${cid}" style="flex:1; overflow:hidden; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.12);"></div>
      <div id="${detailId}" style="width:268px; overflow-y:auto; border-left:1px solid var(--border); padding:16px; flex-shrink:0; font-size:0.62rem;">
        <div style="text-align:center; color:var(--text-dim); margin-top:60px; line-height:1.8;">
          <div style="font-size:2.2rem; margin-bottom:8px; opacity:0.5;">◎</div>
          Hover a segment to<br>inspect complexity
        </div>
      </div>
    </div>
  `;

  const svgEl = document.getElementById(cid);
  const W     = svgEl.clientWidth  || 520;
  const H     = svgEl.clientHeight || 480;
  const R     = Math.min(W, H) / 2 * 0.88;

  // D3 hierarchy
  const hierData = {
    name: 'root',
    children: files.map(f => ({
      name:     f.path.split('/').pop(),
      fullPath: f.path,
      repo:     f.repo,
      total:    f.total_complexity,
      fnCount:  f.functions.length,
      isFile:   true,
      children: f.functions.length
        ? f.functions.map(fn => ({
            name:       fn.name,
            value:      Math.max(1, fn.complexity),
            complexity: fn.complexity,
            line:       fn.start_line,
            endLine:    fn.end_line,
            nodeType:   fn.node_type,
            childCount: fn.child_count,
            isFile:     false,
          }))
        : [{ name: '(none)', value: 1, complexity: 0, isFile: false }],
    }))
  };

  const root = d3.hierarchy(hierData)
    .sum(d => d.value || 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  d3.partition().size([2 * Math.PI, 2])(root);

  // Arc generator — inner ring: depth=1 (files), outer ring: depth=2 (fns)
  const arc = d3.arc()
    .startAngle(d  => d.x0)
    .endAngle(d    => d.x1)
    .padAngle(d    => Math.min((d.x1 - d.x0) / 2, 0.007))
    .padRadius(R * 0.5)
    .innerRadius(d => d.depth === 1 ? R * 0.22 : R * 0.52)
    .outerRadius(d => d.depth === 1 ? R * 0.50 : R * 0.92);

  const _fileColor = total => {
    if (total <= 10) return '#22d3ee';
    if (total <= 30) return '#a78bfa';
    if (total <= 60) return '#fb923c';
    return '#f87171';
  };
  const _fnColor = score => {
    if (!score || score <= 0) return 'rgba(255,255,255,0.07)';
    if (score <= 5)  return '#4ade80';
    if (score <= 10) return '#facc15';
    if (score <= 20) return '#fb923c';
    return '#f87171';
  };

  // SVG
  const svg = d3.select('#' + cid)
    .append('svg')
    .attr('width', W)
    .attr('height', H)
    .attr('viewBox', `${-W/2} ${-H/2} ${W} ${H}`);

  // Glow filter
  const glowId = 'glow-' + cid.slice(-6);
  const defs   = svg.append('defs');
  const filt   = defs.append('filter').attr('id', glowId);
  filt.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
  const merge  = filt.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  const g = svg.append('g');

  // Arcs
  g.selectAll('path')
    .data(root.descendants().filter(d => d.depth > 0))
    .join('path')
    .attr('d', arc)
    .attr('fill',         d => d.data.isFile ? _fileColor(d.data.total) : _fnColor(d.data.complexity))
    .attr('fill-opacity', d => d.depth === 1 ? 0.5 : 0.78)
    .attr('stroke', 'rgba(0,0,0,0.5)')
    .attr('stroke-width', 0.5)
    .style('cursor', 'pointer')
    .style('transition', 'fill-opacity 0.12s')
    .on('mouseover', function(event, d) {
      d3.select(this).attr('fill-opacity', 1).style('filter', `url(#${glowId})`);
      _updateRadialDetail(detailId, d);
    })
    .on('mouseout', function(event, d) {
      d3.select(this).attr('fill-opacity', d.depth === 1 ? 0.5 : 0.78).style('filter', null);
    });

  // Center circle & total score
  const totalScore = files.reduce((s, f) => s + f.total_complexity, 0);
  const avgScore   = Math.round(totalScore / Math.max(files.length, 1));
  const centerC    = _complexityColor(avgScore);

  g.append('circle')
    .attr('r', R * 0.20)
    .attr('fill', 'rgba(10,10,20,0.7)')
    .attr('stroke', 'rgba(255,255,255,0.1)')
    .attr('stroke-width', 1);

  g.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '-0.35em')
    .attr('fill', centerC.fg)
    .attr('font-size', `${Math.max(13, R * 0.075)}px`)
    .attr('font-weight', '700')
    .text(totalScore);

  g.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '1em')
    .attr('fill', 'rgba(255,255,255,0.35)')
    .attr('font-size', `${Math.max(8, R * 0.042)}px`)
    .text('total score');

  // Legend footnote
  svg.append('text')
    .attr('x', -W/2 + 8).attr('y', H/2 - 32)
    .attr('fill', 'rgba(255,255,255,0.3)').attr('font-size', '9px')
    .text('inner = files  ·  outer = functions');
  svg.append('text')
    .attr('x', -W/2 + 8).attr('y', H/2 - 18)
    .attr('fill', 'rgba(255,255,255,0.25)').attr('font-size', '9px')
    .text('arc size ∝ complexity score');
}

// ── Radial detail panel ───────────────────────────────────────────────────────

function _updateRadialDetail(detailId, d) {
  const el = document.getElementById(detailId);
  if (!el) return;

  if (d.data.isFile) {
    const c = _complexityColor(d.data.total);
    el.innerHTML = `
      <div style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:14px;">
        <div style="color:var(--text-dim);font-size:0.56rem;letter-spacing:0.08em;margin-bottom:5px;">📄 FILE</div>
        <div style="color:var(--text);font-weight:700;font-size:0.68rem;word-break:break-all;line-height:1.4;">${_escHtml(d.data.fullPath)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
        <div style="text-align:center;padding:10px 6px;background:${c.bg};border-radius:8px;border:1px solid ${c.fg}35;">
          <div style="color:${c.fg};font-size:1.4rem;font-weight:700;">${d.data.total}</div>
          <div style="color:var(--text-dim);font-size:0.55rem;margin-top:2px;">Total Score</div>
        </div>
        <div style="text-align:center;padding:10px 6px;background:rgba(34,211,238,0.08);border-radius:8px;border:1px solid rgba(34,211,238,0.2);">
          <div style="color:var(--cyan);font-size:1.4rem;font-weight:700;">${d.data.fnCount || 0}</div>
          <div style="color:var(--text-dim);font-size:0.55rem;margin-top:2px;">Functions</div>
        </div>
      </div>
      <div style="padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;">
        <div style="color:var(--text-dim);font-size:0.56rem;margin-bottom:4px;">Risk Level</div>
        <div style="color:${c.fg};font-weight:700;font-size:1rem;">${c.label}</div>
      </div>`;
  } else {
    const c    = _complexityColor(d.data.complexity);
    const icon = d.data.nodeType === 'class' ? '🏛️' : (d.data.nodeType === 'method' ? '◆' : 'λ');
    const span = (d.data.endLine || 0) - (d.data.line || 0);
    el.innerHTML = `
      <div style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:14px;">
        <div style="color:#a78bfa;font-size:0.58rem;letter-spacing:0.06em;margin-bottom:5px;">${icon} ${(d.data.nodeType || 'function').toUpperCase()}</div>
        <div style="color:var(--text);font-weight:700;font-size:0.68rem;word-break:break-all;line-height:1.4;">${_escHtml(d.data.name)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
        <div style="text-align:center;padding:10px 6px;background:${c.bg};border-radius:8px;border:1px solid ${c.fg}35;">
          <div style="color:${c.fg};font-size:1.4rem;font-weight:700;">${d.data.complexity}</div>
          <div style="color:var(--text-dim);font-size:0.55rem;margin-top:2px;">Score</div>
        </div>
        <div style="text-align:center;padding:10px 6px;background:rgba(167,139,250,0.1);border-radius:8px;border:1px solid rgba(167,139,250,0.2);">
          <div style="color:#a78bfa;font-size:1.4rem;font-weight:700;">${d.data.childCount || 0}</div>
          <div style="color:var(--text-dim);font-size:0.55rem;margin-top:2px;">Nested</div>
        </div>
      </div>
      <div style="padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:8px;">
        <div style="color:var(--text-dim);font-size:0.56rem;margin-bottom:3px;">Line Range</div>
        <div style="color:var(--text);font-size:0.65rem;font-family:var(--font-mono);">L${d.data.line} – ${d.data.endLine} &nbsp;(${span} lines)</div>
      </div>
      <div style="padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;">
        <div style="color:var(--text-dim);font-size:0.56rem;margin-bottom:4px;">Risk Level</div>
        <div style="color:${c.fg};font-weight:700;font-size:1rem;">${c.label}</div>
      </div>`;
  }
}
