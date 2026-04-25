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

// ── Deep analysis (source + AST heuristics) ─────────────────────────────────

function _anAnalyzeProjectSource(astNodes = [], codeDocs = []) {
  const docs = Array.isArray(codeDocs) ? codeDocs : [];
  const nodes = Array.isArray(astNodes) ? astNodes : [];
  const nodesByPath = {};
  nodes.forEach(n => {
    if (!n || !n.path) return;
    if (!nodesByPath[n.path]) nodesByPath[n.path] = [];
    nodesByPath[n.path].push(n);
  });

  const findings = [];
  const pushFinding = (f) => {
    findings.push({
      severity: f.severity || 'medium',
      category: f.category || 'structural',
      rule_id: f.rule_id || 'rule',
      path: f.path || '',
      line: f.line || 1,
      title: f.title || f.rule_id || 'Finding',
      detail: f.detail || '',
    });
  };

  docs.forEach(doc => {
    const path = doc.path || '';
    const content = (doc.content || '').toString();
    const lines = content.split(/\r?\n/);
    const fileNodes = (nodesByPath[path] || []).slice().sort((a, b) => (a.start_line || 0) - (b.start_line || 0));

    _anDetectStructural(lines, fileNodes, path, pushFinding);
    _anDetectSecurity(lines, path, pushFinding);
    _anDetectModernization(lines, path, pushFinding);
    _anDetectStyle(lines, fileNodes, path, pushFinding);
    _anDetectDeadCode(lines, path, pushFinding);
  });

  const sevRank = { high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => {
    const ds = (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
    if (ds) return ds;
    if (a.path !== b.path) return (a.path || '').localeCompare(b.path || '');
    return (a.line || 0) - (b.line || 0);
  });

  const byCategory = { structural: 0, security: 0, modernization: 0, style: 0, dead_code: 0 };
  const bySeverity = { high: 0, medium: 0, low: 0 };
  findings.forEach(f => {
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  });

  return {
    summary: {
      filesAnalyzed: docs.length,
      totalFindings: findings.length,
      by_category: byCategory,
      by_severity: bySeverity,
    },
    findings,
    topFindings: findings.slice(0, 12),
  };
}

function _anDetectStructural(lines, fileNodes, path, pushFinding) {
  // Deep nesting (control-flow depth > 4)
  let braceDepth = 0;
  let maxDepth = 0;
  let maxDepthLine = 1;
  const pyStack = [];
  lines.forEach((raw, idx) => {
    const line = raw || '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;
    const lineNo = idx + 1;
    const indent = line.match(/^\s*/)[0].length;
    while (pyStack.length && indent <= pyStack[pyStack.length - 1]) pyStack.pop();
    const isControl = /^(if|elif|for|while|try|except|catch|switch)\b/.test(trimmed);
    if (isControl) {
      if (trimmed.endsWith(':')) pyStack.push(indent);
      const depth = pyStack.length + Math.max(0, braceDepth);
      if (depth > maxDepth) { maxDepth = depth; maxDepthLine = lineNo; }
    }
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;
    braceDepth = Math.max(0, braceDepth + opens - closes);
  });
  if (maxDepth > 4) {
    pushFinding({
      severity: 'high',
      category: 'structural',
      rule_id: 'deep_nesting',
      path,
      line: maxDepthLine,
      title: 'Deep control nesting',
      detail: `Detected nesting depth ${maxDepth} (threshold: 4).`,
    });
  }

  // Large class/function bloat from AST spans + contained children
  fileNodes.forEach(n => {
    const span = Math.max(1, (n.end_line || 0) - (n.start_line || 0) + 1);
    const childCount = fileNodes.filter(c => c !== n && c.start_line > n.start_line && c.end_line <= n.end_line).length;
    const isClass = n.node_type === 'class';
    const spanThreshold = isClass ? 220 : 120;
    const childThreshold = isClass ? 12 : 8;
    if (span >= spanThreshold || childCount >= childThreshold) {
      pushFinding({
        severity: span >= spanThreshold * 1.5 ? 'high' : 'medium',
        category: 'structural',
        rule_id: 'large_block_bloat',
        path,
        line: n.start_line || 1,
        title: `${isClass ? 'Large class' : 'Large function'} bloat`,
        detail: `${n.name || n.node_type} spans ${span} lines with ${childCount} nested typed blocks.`,
      });
    }
  });

  // Parameter overload (JS/Python style signatures)
  lines.forEach((raw, idx) => {
    const line = raw || '';
    const py = line.match(/^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/);
    const jsFn = line.match(/^\s*function\s+([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/);
    const jsArrow = line.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>/);
    const hit = py || jsFn || jsArrow;
    if (!hit) return;
    const params = (hit[2] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (params.length > 5) {
      pushFinding({
        severity: params.length > 8 ? 'high' : 'medium',
        category: 'structural',
        rule_id: 'parameter_overload',
        path,
        line: idx + 1,
        title: 'Parameter overload',
        detail: `${hit[1] || 'Function'} has ${params.length} parameters.`,
      });
    }
  });

  // Empty blocks
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || '').trim();
    if (!line) continue;
    if (/(if|for|while|try|catch)\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      pushFinding({ severity: 'low', category: 'structural', rule_id: 'empty_block', path, line: i + 1, title: 'Empty block', detail: 'Control block has an empty body.' });
    }
    if (/^(if|for|while|try|except)\b.*:\s*$/.test(line)) {
      const next = (lines[i + 1] || '').trim();
      if (next === 'pass' || next === '') {
        pushFinding({ severity: 'low', category: 'structural', rule_id: 'empty_block', path, line: i + 1, title: 'Empty block', detail: 'Python block appears empty/pass-only.' });
      }
    }
  }
}

function _anDetectSecurity(lines, path, pushFinding) {
  lines.forEach((raw, idx) => {
    const line = (raw || '').trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const lineNo = idx + 1;

    if (/\b(API[_-]?KEY|PASSWORD|SECRET|TOKEN)\b\s*[:=]\s*['"][^'"]{6,}['"]/i.test(line)) {
      pushFinding({
        severity: 'high',
        category: 'security',
        rule_id: 'hardcoded_secret',
        path,
        line: lineNo,
        title: 'Hardcoded secret',
        detail: 'Literal secret-like value assigned in source.',
      });
    }
    if (/\b(eval|exec|os\.system)\s*\(/.test(line)) {
      pushFinding({
        severity: 'high',
        category: 'security',
        rule_id: 'insecure_call',
        path,
        line: lineNo,
        title: 'Insecure function call',
        detail: 'Use of eval/exec/os.system detected.',
      });
    }
    if (/\b(execute|query)\s*\(/i.test(line) && /(f["']|%|\.format\(|\+.*["'])/.test(line)) {
      pushFinding({
        severity: 'high',
        category: 'security',
        rule_id: 'sql_injection_pattern',
        path,
        line: lineNo,
        title: 'Potential SQL injection pattern',
        detail: 'Query call appears to use string interpolation/concatenation.',
      });
    }
  });
}

function _anDetectModernization(lines, path, pushFinding) {
  lines.forEach((raw, idx) => {
    const line = (raw || '').trim();
    if (!line) return;
    if (/\b\w+\.append\(/.test(line) && /\bpd\b|\bpandas\b|dataframe|df\./i.test(line)) {
      pushFinding({
        severity: 'low',
        category: 'modernization',
        rule_id: 'deprecated_append_api',
        path,
        line: idx + 1,
        title: 'Deprecated append-style API usage',
        detail: 'Consider replacing append-style flows with concat-style batching.',
      });
    }
  });
}

function _anDetectStyle(lines, fileNodes, path, pushFinding) {
  // Type-hinting compliance (python defs without return annotations)
  lines.forEach((raw, idx) => {
    const line = raw || '';
    const m = line.match(/^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/);
    if (m && !/->\s*[^:]+:/.test(line)) {
      pushFinding({
        severity: 'low',
        category: 'style',
        rule_id: 'missing_return_type_hint',
        path,
        line: idx + 1,
        title: 'Missing return type hint',
        detail: `${m[1]} has no return type annotation.`,
      });
    }
  });
}

function _anDetectDeadCode(lines, path, pushFinding) {
  for (let i = 0; i < lines.length - 1; i++) {
    const curr = (lines[i] || '').trim();
    if (!/^(return|break|raise|throw)\b/.test(curr)) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const next = (lines[j] || '').trim();
      if (!next || next.startsWith('#') || next.startsWith('//') || next === '}') continue;
      pushFinding({
        severity: 'medium',
        category: 'dead_code',
        rule_id: 'unreachable_code',
        path,
        line: j + 1,
        title: 'Potential unreachable code',
        detail: 'Code appears after an early exit statement in the same block.',
      });
      break;
    }
  }
}

// ── Complexity explorer (left tree + right detail) ────────────────────────────

function _renderComplexityHeatmap(nodes, container) {
  const files = _computeAstComplexity(nodes);

  if (!files.length) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);">No function / method / class nodes found.<br><span style="font-size:0.65rem;">Generate an AST first via the Projects panel.</span></div>';
    return;
  }

  const uid    = 'cx-' + Math.random().toString(36).substr(2, 6);
  const leftId = uid + '-left';
  const rightId= uid + '-right';
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:260px 1fr;height:100%;min-height:0;overflow:hidden;">
      <div id="${leftId}" style="border-right:1px solid var(--border);overflow-y:auto;min-height:0;background:rgba(0,0,0,0.18);">
        <div id="${uid}-tree" style="padding:10px 0;"></div>
      </div>
      <div id="${rightId}" style="overflow-y:auto;min-height:0;"></div>
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
        const scopedFiles = _cxCollectFiles(node);
        _cxRenderOverview(scopedFiles, rightEl, { highOnly: true, title: `${node.name} Overview` });
      });
      parentEl.appendChild(row);
      parentEl.appendChild(childrenEl);
    }
  });
}

function _cxCollectFiles(node) {
  if (!node) return [];
  if (node.type === 'file' && node.file) return [node.file];
  const out = [];
  const walk = n => {
    if (!n) return;
    if (n.type === 'file' && n.file) {
      out.push(n.file);
      return;
    }
    const kids = n.children ? Object.values(n.children) : [];
    kids.forEach(walk);
  };
  walk(node);
  return out;
}

// ── Right panel: overview ─────────────────────────────────────────────────────

function _cxRenderOverview(files, container, options = {}) {
  const highOnly = !!options.highOnly;
  const title = options.title || 'TOP COMPLEXITY FILES — click a file in the tree to inspect';
  const topRows = files.slice(0, 5).map(f => {
    const c   = _complexityColor(f.total_complexity);
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text); white-space:nowrap;">${_escHtml(f.path)}</span>
        <span style="font-size:0.52rem;color:var(--text-dim); white-space:nowrap;">${f.functions.length} fns</span>
        <span style="font-size:0.55rem;font-weight:700;color:${c.fg}; white-space:nowrap;">${f.total_complexity} &middot; ${c.label}</span>
      </div>`;
  }).join('');

  const analysis = (typeof window !== 'undefined' && window._ctxCurrentAstAnalysis) ? window._ctxCurrentAstAnalysis : null;
  const highFindings = analysis && Array.isArray(analysis.findings)
    ? analysis.findings.filter(f => (f.severity || '').toLowerCase() === 'high')
    : [];
  const highCategoryCounts = highFindings.reduce((acc, f) => {
    const c = f.category || 'other';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  const highGroupedByType = highFindings.reduce((acc, f) => {
    const key = (f.category || 'other').toString();
    if (!acc[key]) acc[key] = [];
    acc[key].push(f);
    return acc;
  }, {});
  const findingsHtml = analysis && analysis.topFindings && analysis.topFindings.length
    ? `
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
        <div style="font-size:0.55rem;font-weight:700;color:var(--text-dim);letter-spacing:0.08em;margin-bottom:8px;">ANALYSIS FINDINGS${highOnly ? ' (HIGH ONLY)' : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;font-size:0.5rem;color:var(--text-dim);">
          ${highOnly
            ? `<span>High Severity: <strong style="color:#f87171;">${highFindings.length}</strong></span>
               <span>Structural: <strong style="color:var(--text);">${highCategoryCounts.structural || 0}</strong></span>
               <span>Security: <strong style="color:var(--text);">${highCategoryCounts.security || 0}</strong></span>
               <span>Dead Code: <strong style="color:var(--text);">${highCategoryCounts.dead_code || 0}</strong></span>`
            : `<span>Total: <strong style="color:var(--text);">${analysis.summary.totalFindings}</strong></span>
               <span>Structural: <strong style="color:var(--text);">${analysis.summary.by_category.structural || 0}</strong></span>
               <span>Security: <strong style="color:var(--text);">${analysis.summary.by_category.security || 0}</strong></span>
               <span>Dead Code: <strong style="color:var(--text);">${analysis.summary.by_category.dead_code || 0}</strong></span>`
          }
        </div>
        ${highOnly
          ? Object.keys(highGroupedByType).sort((a, b) => a.localeCompare(b)).map(type => `
              <details open style="margin-bottom:6px;border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,0.02);">
                <summary style="cursor:pointer;list-style:none;padding:7px 10px;font-size:0.52rem;color:var(--text);font-weight:700;text-transform:capitalize;">
                  ${_escHtml(type.replace('_', ' '))} · ${highGroupedByType[type].length}
                </summary>
                <div style="padding:0 8px 8px;">
                  ${highGroupedByType[type].slice(0, 12).map(f => `
                    <div style="padding:6px 8px;border:1px solid rgba(255,255,255,0.08);border-radius:6px;background:rgba(255,255,255,0.01);margin-top:6px;">
                      <div style="font-size:0.52rem;color:var(--text);font-weight:600;">${_escHtml(f.title)} <span style="color:var(--text-dim);font-weight:400;">(${_escHtml(f.rule_id)})</span></div>
                      <div style="font-size:0.5rem;color:var(--text-dim);margin-top:2px;">${_escHtml(f.path)}:${f.line} · ${_escHtml(f.detail || '')}</div>
                    </div>
                  `).join('')}
                </div>
              </details>
            `).join('')
          : analysis.topFindings.slice(0, 8).map(f => `
              <div style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,0.02);margin-bottom:6px;">
                <div style="font-size:0.52rem;color:var(--text);font-weight:600;">${_escHtml(f.title)} <span style="color:var(--text-dim);font-weight:400;">(${_escHtml(f.rule_id)})</span></div>
                <div style="font-size:0.5rem;color:var(--text-dim);margin-top:2px;">${_escHtml(f.path)}:${f.line} · ${_escHtml(f.detail || '')}</div>
              </div>
            `).join('')
        }
      </div>`
    : '';

  container.innerHTML = `
    <div style="padding:20px 24px;">

      <div style="font-size:0.55rem;font-weight:700;color:var(--text-dim);letter-spacing:0.1em;margin-bottom:12px;">
        ${_escHtml(title)}
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
      ${findingsHtml}
    </div>`;
}

// ── Right panel: file detail ──────────────────────────────────────────────────

function _cxRenderFileDetail(file, container) {
  if (!file) return;
  const c    = _complexityColor(file.total_complexity);
  const maxC = file.functions.length ? file.functions[0].complexity : 1;
  const analysis = (typeof window !== 'undefined' && window._ctxCurrentAstAnalysis) ? window._ctxCurrentAstAnalysis : null;
  const fileFindings = analysis && Array.isArray(analysis.findings)
    ? analysis.findings.filter(f => (f.path || '') === file.path || (f.path || '').endsWith('/' + file.path))
    : [];
  const bySev = fileFindings.reduce((acc, f) => {
    const s = (f.severity || 'low').toLowerCase();
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, { high: 0, medium: 0, low: 0 });
  const byCat = fileFindings.reduce((acc, f) => {
    const c = f.category || 'other';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});

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
    <div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="font-size:1.2rem;">📄</span>
        <div style="flex:1;">
          <div style="font-size:0.7rem;font-weight:bold;color:var(--text);word-break:break-all;">${_escHtml(file.path.split('/').pop())}</div>
          <div style="font-size:0.5rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">FILE</div>
        </div>
      </div>

      <div class="kb-detail-section">
        <div style="font-size:0.55rem;color:var(--text-dim);">📦 ${_escHtml(file.repo)}</div>
        <div style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono);word-break:break-all;margin-top:2px;">📁 ${_escHtml(file.path)}</div>
      </div>

      <div class="kb-detail-section">
        <div style="display:grid;grid-template-columns:repeat(5,minmax(70px,1fr));gap:6px;margin-top:8px;">
          <div style="text-align:center;padding:6px 8px;background:${c.bg};border-radius:6px;border:1px solid ${c.fg}35;">
            <div style="color:${c.fg};font-size:0.95rem;font-weight:700;">${file.total_complexity}</div>
            <div style="color:var(--text-dim);font-size:0.42rem;">${c.label}</div>
          </div>
          <div style="text-align:center;padding:6px 8px;background:rgba(34,211,238,0.08);border-radius:6px;border:1px solid rgba(34,211,238,0.2);">
            <div style="color:var(--cyan);font-size:0.95rem;font-weight:700;">${file.functions.length}</div>
            <div style="color:var(--text-dim);font-size:0.42rem;">Functions</div>
          </div>
          <div style="text-align:center;padding:6px 8px;background:rgba(248,113,113,0.08);border-radius:6px;border:1px solid rgba(248,113,113,0.25);">
            <div style="color:#f87171;font-size:0.95rem;font-weight:700;">${bySev.high || 0}</div>
            <div style="color:var(--text-dim);font-size:0.42rem;">High</div>
          </div>
          <div style="text-align:center;padding:6px 8px;background:rgba(251,146,60,0.08);border-radius:6px;border:1px solid rgba(251,146,60,0.25);">
            <div style="color:#fb923c;font-size:0.95rem;font-weight:700;">${bySev.medium || 0}</div>
            <div style="color:var(--text-dim);font-size:0.42rem;">Medium</div>
          </div>
          <div style="text-align:center;padding:6px 8px;background:rgba(74,222,128,0.08);border-radius:6px;border:1px solid rgba(74,222,128,0.25);">
            <div style="color:#4ade80;font-size:0.95rem;font-weight:700;">${bySev.low || 0}</div>
            <div style="color:var(--text-dim);font-size:0.42rem;">Low</div>
          </div>
        </div>
      </div>

      <div class="kb-detail-section" style="margin-top:16px;">
        <details open style="border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,0.02);padding:0 8px 8px;">
          <summary style="cursor:pointer;list-style:none;padding:8px 0;font-size:0.62rem;color:var(--text);font-weight:700;">Function Breakdown</summary>
          <div style="overflow-x:auto;background:var(--bg-main);border-radius:4px;">
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
        </details>
      </div>
      <div class="kb-detail-section" style="margin-top:16px;">
        <details open style="border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,0.02);padding:0 8px 8px;">
          <summary style="cursor:pointer;list-style:none;padding:8px 0;font-size:0.62rem;color:var(--text);font-weight:700;">Analysis Findings</summary>
          ${fileFindings.length
            ? `
              <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.52rem;color:var(--text-dim);margin-bottom:8px;">
                <span>Total: <strong style="color:var(--text);">${fileFindings.length}</strong></span>
                <span>High: <strong style="color:#f87171;">${bySev.high || 0}</strong></span>
                <span>Medium: <strong style="color:#fb923c;">${bySev.medium || 0}</strong></span>
                <span>Low: <strong style="color:#4ade80;">${bySev.low || 0}</strong></span>
                ${Object.keys(byCat).slice(0, 4).map(cat => `<span>${_escHtml(cat)}: <strong style="color:var(--text);">${byCat[cat]}</strong></span>`).join('')}
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;padding-right:2px;">
                ${fileFindings.map(f => {
                  const sev = (f.severity || 'low').toLowerCase();
                  const sevColor = sev === 'high' ? '#f87171' : sev === 'medium' ? '#fb923c' : '#4ade80';
                  return `
                    <div style="padding:7px 8px;border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,0.02);">
                      <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:0.48rem;padding:1px 6px;border-radius:8px;border:1px solid ${sevColor};color:${sevColor};text-transform:uppercase;">${_escHtml(sev)}</span>
                        <span style="font-size:0.55rem;color:var(--text);font-weight:600;">${_escHtml(f.title || f.rule_id || 'Finding')}</span>
                        <span style="font-size:0.5rem;color:var(--text-dim);margin-left:auto;">L${f.line || 1}</span>
                      </div>
                      <div style="font-size:0.5rem;color:var(--text-dim);margin-top:3px;">${_escHtml(f.detail || '')}</div>
                    </div>`;
                }).join('')}
              </div>`
            : `<div style="font-size:0.55rem;color:var(--text-dim);">No analysis findings for this file.</div>`
          }
        </details>
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
function _renderComplexityRadial(nodes, container, _fileLimit = 1500) {
  const TYPED = new Set(['function', 'method', 'class']);

  // Step 1 — group by file in O(n), counting only typed nodes
  const byFile = {};
  for (const n of nodes) {
    if (!TYPED.has(n.node_type)) continue;
    const key = (n.repo || '') + '::' + (n.path || '');
    if (!byFile[key]) byFile[key] = [];
    byFile[key].push(n);
  }

  const totalFiles = Object.keys(byFile).length;
  if (!totalFiles) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);">No function / method / class nodes found.</div>';
    return;
  }

  // Limit-picker — update the top header bar (defined in context-ast.js)
  if (typeof _updateAstLimitBar === 'function') _updateAstLimitBar('radial', totalFiles, _fileLimit);

  const limited = _fileLimit !== 'all';
  const cap     = limited ? Math.min(_fileLimit, totalFiles) : totalFiles;

  const cid      = 'ast-radial-' + Math.random().toString(36).substr(2, 9);
  const detailId = cid + '-info';

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <div style="display:flex;flex:1;overflow:hidden;">
        <div id="${cid}" style="flex:1;overflow:hidden;position:relative;background:rgba(0,0,0,0.12);
             display:flex;align-items:center;justify-content:center;">
          <span style="color:var(--text-dim);font-size:0.75rem;">Computing complexity…</span>
        </div>
        <div id="${detailId}" style="width:0;min-width:0;overflow:hidden;border-left:none;padding:0;
             flex-shrink:0;font-size:0.62rem;background:var(--bg-card);font-family:var(--font-mono);
             transition:width 0.2s ease,min-width 0.2s ease,padding 0.2s ease;"></div>
      </div>
    </div>
  `;

  // Re-render hook (captures container + nodes via closure)
  window._astRadialRerender = newLimit => _renderComplexityRadial(nodes, container, newLimit);

  // Defer heavy work — lets the loading text paint first
  setTimeout(() => {
    const svgEl = document.getElementById(cid);
    if (!svgEl) return;

    // Step 2 — sort files by node count, take top cap, cap fns/file to 50
    const MAX_FNS_COMPUTE = 50;
    const MAX_FNS_RENDER  = 10;
    const topKeys = Object.keys(byFile)
      .sort((a, b) => byFile[b].length - byFile[a].length)
      .slice(0, cap);
    const filteredNodes = topKeys.flatMap(k => byFile[k].slice(0, MAX_FNS_COMPUTE));

    // Step 3 — run complexity on small, pre-filtered dataset
    const files = _computeAstComplexity(filteredNodes);
    if (!files.length) {
      svgEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);">No data.</div>';
      return;
    }

    // Step 4 — render
    _drawRadialChart(cid, detailId, files, MAX_FNS_RENDER);
  }, 20);
}

function _drawRadialChart(cid, detailId, files, MAX_FNS) {
  const svgEl = document.getElementById(cid);
  if (!svgEl) return;
  svgEl.innerHTML = ''; // clear loading text

  const W = svgEl.clientWidth  || 520;
  const H = svgEl.clientHeight || 520;
  const R = Math.min(W, H) / 2 * 0.86;

  const _selectedArc = {};

  window._astRadialCloseDetail = window._astRadialCloseDetail || {};
  window._astRadialCloseDetail[cid] = function() {
    _setRadialDetailOpen(detailId, false);
    d3.selectAll('#' + cid + ' path')
      .attr('stroke', 'rgba(0,0,0,0.5)').attr('stroke-width', 0.5).style('filter', null);
    _selectedArc[cid] = null;
  };

  // Build hierarchy
  const hierData = {
    name: 'root',
    children: files.map(f => {
      const topFns = f.functions.slice(0, MAX_FNS);
      return {
        name:      f.path.split('/').pop(),
        fullPath:  f.path,
        repo:      f.repo,
        total:     f.total_complexity,
        fnCount:   f.functions.length,
        functions: f.functions,
        isFile:    true,
        children: topFns.length
          ? topFns.map(fn => ({
              name:       fn.name,
              value:      Math.max(1, fn.complexity),
              complexity: fn.complexity,
              line:       fn.start_line,
              endLine:    fn.end_line,
              nodeType:   fn.node_type,
              childCount: fn.child_count,
              parentFile: f.path.split('/').pop(),
              parentPath: f.path,
              isFile:     false,
            }))
          : [{ name: '(none)', value: 1, complexity: 0, isFile: false }],
      };
    })
  };

  const root = d3.hierarchy(hierData)
    .sum(d => d.value || 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  d3.partition().size([2 * Math.PI, 2])(root);

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

  const svg = d3.select('#' + cid)
    .append('svg').attr('width', W).attr('height', H).style('display', 'block');

  const glowId = 'glow-' + cid.slice(-6);
  const defs   = svg.append('defs');
  const filt   = defs.append('filter').attr('id', glowId)
    .attr('x', '-30%').attr('y', '-30%').attr('width', '160%').attr('height', '160%');
  filt.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
  const fmerge = filt.append('feMerge');
  fmerge.append('feMergeNode').attr('in', 'blur');
  fmerge.append('feMergeNode').attr('in', 'SourceGraphic');

  const cx = W / 2, cy = H / 2;
  const initialTransform = d3.zoomIdentity.translate(cx, cy);
  const g = svg.append('g').attr('transform', initialTransform);

  const zoom = d3.zoom().scaleExtent([0.2, 8])
    .on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom).call(zoom.transform, initialTransform);

  g.selectAll('path')
    .data(root.descendants().filter(d => d.depth > 0))
    .join('path')
    .attr('d', arc)
    .attr('fill',         d => d.data.isFile ? _fileColor(d.data.total) : _fnColor(d.data.complexity))
    .attr('fill-opacity', d => d.depth === 1 ? 0.5 : 0.78)
    .attr('stroke', 'rgba(0,0,0,0.5)').attr('stroke-width', 0.5)
    .style('cursor', 'pointer')
    .on('click', function(event, d) {
      event.stopPropagation();
      if (_selectedArc[cid] && _selectedArc[cid] !== this) {
        const pd = d3.select(_selectedArc[cid]).datum();
        d3.select(_selectedArc[cid])
          .attr('stroke', 'rgba(0,0,0,0.5)').attr('stroke-width', 0.5)
          .attr('fill-opacity', pd.depth === 1 ? 0.5 : 0.78).style('filter', null);
      }
      if (_selectedArc[cid] === this) {
        _selectedArc[cid] = null;
        _setRadialDetailOpen(detailId, false);
        return;
      }
      _selectedArc[cid] = this;
      d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1.5)
        .attr('fill-opacity', 1).style('filter', `url(#${glowId})`);
      _updateRadialDetail(detailId, d, `window._astRadialCloseDetail['${cid}']`);
    });

  svg.on('click', () => {
    if (_selectedArc[cid]) {
      const pd = d3.select(_selectedArc[cid]).datum();
      d3.select(_selectedArc[cid])
        .attr('stroke', 'rgba(0,0,0,0.5)').attr('stroke-width', 0.5)
        .attr('fill-opacity', pd.depth === 1 ? 0.5 : 0.78).style('filter', null);
      _selectedArc[cid] = null;
    }
    _setRadialDetailOpen(detailId, false);
  });

  const totalScore = files.reduce((s, f) => s + f.total_complexity, 0);
  const centerC    = _complexityColor(Math.round(totalScore / Math.max(files.length, 1)));

  g.append('circle').attr('r', R * 0.20)
    .attr('fill', 'rgba(10,10,20,0.7)').attr('stroke', 'rgba(255,255,255,0.1)')
    .attr('stroke-width', 1).style('pointer-events', 'none');
  g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.35em')
    .attr('fill', centerC.fg).attr('font-size', `${Math.max(13, R * 0.075)}px`)
    .attr('font-weight', '700').style('pointer-events', 'none').text(totalScore);
  g.append('text').attr('text-anchor', 'middle').attr('dy', '1em')
    .attr('fill', 'rgba(255,255,255,0.35)').attr('font-size', `${Math.max(8, R * 0.042)}px`)
    .style('pointer-events', 'none').text('total score');

  const leg = svg.append('g').style('pointer-events', 'none');
  leg.append('text').attr('x', 10).attr('y', H - 10)
    .attr('fill', 'rgba(255,255,255,0.25)').attr('font-size', '9px')
    .text('inner = files  ·  outer = top functions  ·  scroll to zoom  ·  drag to pan  ·  click to inspect');
}

// ── Radial detail panel ───────────────────────────────────────────────────────

function _setRadialDetailOpen(detailId, open) {
  const el = document.getElementById(detailId);
  if (!el) return;
  el.style.transition = 'width 0.2s ease,min-width 0.2s ease,padding 0.2s ease';
  el.style.display = 'block';
  if (open) {
    el.style.width = '320px';
    el.style.minWidth = '280px';
    el.style.padding = '16px';
    el.style.borderLeft = '1px solid var(--border)';
    el.style.overflowY = 'auto';
  } else {
    el.style.width = '0px';
    el.style.minWidth = '0px';
    el.style.padding = '0';
    el.style.borderLeft = 'none';
    el.style.overflow = 'hidden';
  }
}

function _radialDetailHeader(onCloseName) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin:-16px -16px 14px;border-bottom:1px solid var(--border);position:sticky;top:-16px;background:var(--bg-card);z-index:5;">
      <span style="font-size:0.45rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);font-family:var(--font-mono);">Node Detail</span>
      ${onCloseName ? `<button onclick="${onCloseName}()" title="Collapse panel" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:0.9rem;line-height:1;padding:2px 4px;border-radius:3px;" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-dim)'">‹</button>` : ''}
    </div>`;
}

function _updateRadialDetail(detailId, d, onCloseName = '') {
  const el = document.getElementById(detailId);
  if (!el) return;
  _setRadialDetailOpen(detailId, true);

  if (d.data.isFile) {
    const c = _complexityColor(d.data.total);
    const parts = (d.data.fullPath || '').split('/');
    const fileName = parts.pop();
    const dirPath  = parts.join('/');
    const ext      = fileName.includes('.') ? fileName.split('.').pop() : '—';
    const avgScore = d.data.fnCount ? (d.data.total / d.data.fnCount).toFixed(1) : '—';
    const fnList   = (d.data.functions || []).slice(0, 8);
    el.innerHTML = `
      ${_radialDetailHeader(onCloseName)}
      <div style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:12px;">
        <div style="color:var(--text-dim);font-size:0.52rem;letter-spacing:0.08em;margin-bottom:5px;">📄 FILE</div>
        <div style="color:var(--text);font-weight:700;font-size:0.68rem;word-break:break-all;line-height:1.4;">${_escHtml(fileName)}</div>
        <div style="color:var(--text-dim);font-size:0.52rem;margin-top:4px;word-break:break-all;line-height:1.4;">${_escHtml(dirPath)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;">
        <div style="text-align:center;padding:9px 6px;background:${c.bg};border-radius:7px;border:1px solid ${c.fg}35;">
          <div style="color:${c.fg};font-size:1.3rem;font-weight:700;">${d.data.total}</div>
          <div style="color:var(--text-dim);font-size:0.5rem;margin-top:2px;">Total Score</div>
        </div>
        <div style="text-align:center;padding:9px 6px;background:rgba(34,211,238,0.08);border-radius:7px;border:1px solid rgba(34,211,238,0.2);">
          <div style="color:var(--cyan);font-size:1.3rem;font-weight:700;">${d.data.fnCount || 0}</div>
          <div style="color:var(--text-dim);font-size:0.5rem;margin-top:2px;">Functions</div>
        </div>
        <div style="text-align:center;padding:9px 6px;background:rgba(251,146,60,0.08);border-radius:7px;border:1px solid rgba(251,146,60,0.2);">
          <div style="color:#fb923c;font-size:1.3rem;font-weight:700;">${avgScore}</div>
          <div style="color:var(--text-dim);font-size:0.5rem;margin-top:2px;">Avg / fn</div>
        </div>
        <div style="text-align:center;padding:9px 6px;background:rgba(167,139,250,0.08);border-radius:7px;border:1px solid rgba(167,139,250,0.2);">
          <div style="color:#a78bfa;font-size:1rem;font-weight:700;">.${_escHtml(ext)}</div>
          <div style="color:var(--text-dim);font-size:0.5rem;margin-top:2px;">Extension</div>
        </div>
      </div>
      <div style="padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:7px;margin-bottom:10px;">
        <div style="color:var(--text-dim);font-size:0.52rem;margin-bottom:3px;">Risk Level</div>
        <div style="color:${c.fg};font-weight:700;font-size:0.9rem;">${c.label}</div>
      </div>
      ${d.data.repo ? `<div style="padding:6px 10px;background:rgba(34,211,238,0.06);border-radius:6px;margin-bottom:10px;">
        <span style="color:var(--text-dim);font-size:0.5rem;">Repo: </span><span style="color:var(--cyan);font-size:0.55rem;font-family:var(--font-mono);">${_escHtml(d.data.repo)}</span>
      </div>` : ''}
      ${fnList.length ? `
      <div style="margin-top:4px;">
        <div style="color:var(--text-dim);font-size:0.52rem;letter-spacing:0.06em;margin-bottom:6px;">TOP FUNCTIONS</div>
        ${fnList.map(fn => {
          const fc = _complexityColor(fn.complexity);
          return `<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;margin-bottom:3px;background:rgba(255,255,255,0.03);">
            <span style="font-size:0.45rem;padding:1px 5px;border-radius:4px;background:${fc.bg};color:${fc.fg};font-weight:700;flex-shrink:0;">${fn.complexity}</span>
            <span style="font-size:0.55rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_escHtml(fn.name || '(anon)')}</span>
            <span style="font-size:0.48rem;color:var(--text-dim);flex-shrink:0;margin-left:auto;">L${fn.start_line}</span>
          </div>`;
        }).join('')}
      </div>` : ''}`;
  } else {
    const c    = _complexityColor(d.data.complexity);
    const icon = d.data.nodeType === 'class' ? '🏛️' : (d.data.nodeType === 'method' ? '◆' : 'λ');
    const span = (d.data.endLine && d.data.line) ? (d.data.endLine - d.data.line) : 0;
    const grade = c.label;
    // Complexity thresholds explanation
    const threshold = d.data.complexity <= 5 ? 'Simple, easy to test'
      : d.data.complexity <= 10 ? 'Moderate complexity'
      : d.data.complexity <= 20 ? 'High — consider refactoring'
      : 'Very high — refactor strongly advised';
    el.innerHTML = `
      ${_radialDetailHeader(onCloseName)}
      <div style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:12px;">
        <div style="color:#a78bfa;font-size:0.52rem;letter-spacing:0.06em;margin-bottom:5px;">${icon} ${(d.data.nodeType || 'function').toUpperCase()}</div>
        <div style="color:var(--text);font-weight:700;font-size:0.68rem;word-break:break-all;line-height:1.4;">${_escHtml(d.data.name)}</div>
        ${d.data.parentPath ? `<div style="color:var(--text-dim);font-size:0.5rem;margin-top:4px;word-break:break-all;">${_escHtml(d.data.parentPath)}</div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;">
        <div style="text-align:center;padding:9px 6px;background:${c.bg};border-radius:7px;border:1px solid ${c.fg}35;">
          <div style="color:${c.fg};font-size:1.3rem;font-weight:700;">${d.data.complexity}</div>
          <div style="color:var(--text-dim);font-size:0.5rem;margin-top:2px;">Complexity</div>
        </div>
        <div style="text-align:center;padding:9px 6px;background:rgba(167,139,250,0.1);border-radius:7px;border:1px solid rgba(167,139,250,0.2);">
          <div style="color:#a78bfa;font-size:1.3rem;font-weight:700;">${d.data.childCount || 0}</div>
          <div style="color:var(--text-dim);font-size:0.5rem;margin-top:2px;">Nested</div>
        </div>
        <div style="text-align:center;padding:9px 6px;background:rgba(251,146,60,0.08);border-radius:7px;border:1px solid rgba(251,146,60,0.2);">
          <div style="color:#fb923c;font-size:1.3rem;font-weight:700;">${span}</div>
          <div style="color:var(--text-dim);font-size:0.5rem;margin-top:2px;">Lines</div>
        </div>
        <div style="text-align:center;padding:9px 6px;background:rgba(34,211,238,0.06);border-radius:7px;border:1px solid rgba(34,211,238,0.18);">
          <div style="color:var(--cyan);font-size:0.75rem;font-weight:700;">${_escHtml(grade)}</div>
          <div style="color:var(--text-dim);font-size:0.5rem;margin-top:2px;">Grade</div>
        </div>
      </div>
      <div style="padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:7px;margin-bottom:10px;">
        <div style="color:var(--text-dim);font-size:0.52rem;margin-bottom:3px;">Line Range</div>
        <div style="color:var(--text);font-size:0.62rem;font-family:var(--font-mono);">L${d.data.line || '?'} – ${d.data.endLine || '?'}</div>
      </div>
      <div style="padding:8px 10px;background:${c.bg};border-radius:7px;border-left:3px solid ${c.fg};margin-bottom:10px;">
        <div style="color:${c.fg};font-size:0.52rem;font-weight:600;margin-bottom:2px;">${threshold}</div>
        <div style="color:var(--text-dim);font-size:0.48rem;">McCabe cyclomatic complexity score</div>
      </div>`;
  }
}
