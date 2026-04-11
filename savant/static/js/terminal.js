// ── Terminal Drawer Logic ───────────────────────────────────────────────────
// Each tab has a pane tree. Leaves are terminal panes, nodes are splits.
// Pane tree node: { type:'pane', paneId, xterm, fitAddon, resizeObs }
// Split node:     { type:'split', dir:'h'|'v', children:[node,node], ratio:0.5 }
const _termTabs = new Map(); // tabId → { name, unread, root: paneTreeNode, el: DOM }
const _termPanes = new Map(); // paneId → { tabId, xterm, fitAddon, resizeObs }
let _termActiveTab = null;
let _termFocusedPane = null; // paneId of focused pane
let _termDrawerState = 'closed';
let _termCounter = 0;
let _termPaneCounter = 0;
let _termApi = null;

function _initTerminal() {
  _termApi = window.terminalAPI;
  if (!_termApi) return;
  _termApi.onData((paneId, data) => {
    const pane = _termPanes.get(paneId);
    if (!pane) return;
    pane.xterm.write(data);
    if (pane.tabId !== _termActiveTab) {
      const tab = _termTabs.get(pane.tabId);
      if (tab) { tab.unread = true; _renderTermTabs(); }
    }
  });
  _termApi.onClosed((paneId) => {
    _removePaneFromTree(paneId);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '`') {
      e.preventDefault();
      if (e.shiftKey && _termDrawerState !== 'closed') termAddTab();
      else toggleTerminalDrawer();
    }
    if (_termDrawerState === 'open' && (e.ctrlKey || e.metaKey) && e.key === 'Tab') {
      e.preventDefault();
      const keys = [..._termTabs.keys()];
      if (keys.length < 2) return;
      const idx = keys.indexOf(_termActiveTab);
      const next = e.shiftKey ? (idx - 1 + keys.length) % keys.length : (idx + 1) % keys.length;
      _termSwitchTab(keys[next]);
    }
    // Cmd+D = vertical split, Cmd+Shift+D = horizontal split (iTerm style)
    if (_termDrawerState === 'open' && (e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) termSplitH();
      else termSplitV();
    }
    // Cmd+[ / Cmd+] = navigate between split panes
    if (_termDrawerState === 'open' && (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === '[' || e.key === ']')) {
      e.preventDefault();
      e.stopPropagation();
      const panes = _collectPaneIds(_termTabs.get(_termActiveTab)?.root);
      if (panes.length > 1) {
        const idx = panes.indexOf(_termFocusedPane);
        const next = e.key === ']' ? (idx + 1) % panes.length : (idx - 1 + panes.length) % panes.length;
        _focusPane(panes[next]);
      }
    }
    // Cmd+{ / Cmd+} (Cmd+Shift+[ / Cmd+Shift+]) = navigate between tabs
    if (_termDrawerState === 'open' && (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '{' || e.key === '}' || e.key === '[' || e.key === ']')) {
      e.preventDefault();
      e.stopPropagation();
      const keys = [..._termTabs.keys()];
      if (keys.length > 1) {
        const idx = keys.indexOf(_termActiveTab);
        const forward = e.key === '}' || e.key === ']';
        const next = forward ? (idx + 1) % keys.length : (idx - 1 + keys.length) % keys.length;
        _termSwitchTab(keys[next]);
      }
    }
    // Ctrl+T = new tab (opens terminal if closed, adds tab if open)
    if (e.metaKey && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      e.stopPropagation();
      if (_termDrawerState === 'closed') {
        toggleTerminalDrawer();
      } else if (_termDrawerState === 'open') {
        termAddTab();
      } else if (_termDrawerState === 'collapsed') {
        termRestore();
        termAddTab();
      }
    }
  });
  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.term-add-dropdown')) {
      const m = document.getElementById('term-add-menu');
      if (m) m.classList.remove('show');
    }
    if (!e.target.closest('.term-help-wrap')) {
      document.querySelectorAll('.term-help-popup').forEach(p => p.classList.remove('show'));
    }
  });
  // Reconnect to any surviving PTYs from before page navigation
  _reconnectTerminals();
}

async function _reconnectTerminals() {
  if (!_termApi) return;
  try {
    const living = await _termApi.list();
    if (!living || living.length === 0) return;
    const { Terminal } = await _loadXterm();
    const { FitAddon } = await _loadFitAddon();
    for (const entry of living) {
      _termPaneCounter++;
      _termCounter++;
      const paneId = entry.tabId;
      const tabId = `rtab-${Date.now()}-${_termCounter}`;
      const fitAddon = new FitAddon();
      const xterm = new Terminal({
        fontSize: 13, fontFamily: "'JetBrains Mono','Menlo',monospace",
        theme: {
          background:'#1a1b26', foreground:'#c0caf5', cursor:'#c0caf5', cursorAccent:'#1a1b26',
          selectionBackground:'rgba(0,240,255,0.2)',
          black:'#15161e',red:'#f7768e',green:'#9ece6a',yellow:'#e0af68',
          blue:'#7aa2f7',magenta:'#bb9af7',cyan:'#7dcfff',white:'#a9b1d6',
          brightBlack:'#414868',brightRed:'#f7768e',brightGreen:'#9ece6a',
          brightYellow:'#e0af68',brightBlue:'#7aa2f7',brightMagenta:'#bb9af7',
          brightCyan:'#7dcfff',brightWhite:'#c0caf5',
        },
        cursorBlink: true, scrollback: 5000, allowProposedApi: true,
      });
      xterm.loadAddon(fitAddon);
      xterm.attachCustomKeyEventHandler((e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) return false;
        if ((e.metaKey || e.ctrlKey) && e.key === '`') return false;
        if ((e.metaKey || e.ctrlKey) && e.key === 'Tab') return false;
        if ((e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}')) return false;
        if (e.metaKey && (e.key === 't' || e.key === 'T')) return false;
        return true;
      });
      xterm.onData((data) => _termApi.write(paneId, data));
      _termPanes.set(paneId, { tabId, xterm, fitAddon, resizeObs: null });
      const paneNode = { type: 'pane', paneId };
      _termTabs.set(tabId, { name: `Terminal ${_termCounter}`, unread: false, root: paneNode });
    }
    if (_termTabs.size > 0) {
      _termDrawerState = 'open';
      const drawer = document.getElementById('terminal-drawer');
      drawer.classList.add('open');
      drawer.classList.remove('collapsed');
      drawer.style.width = _termDrawerWidth + '%';
      document.querySelector('.container').style.marginRight = _termDrawerWidth + '%';
      document.querySelector('.container').classList.add('term-open');
      const firstTab = [..._termTabs.keys()][0];
      _termSwitchTab(firstTab);
      _renderTermTabs();
      _updateTermIndicator();
      for (const entry of living) {
        const pane = _termPanes.get(entry.tabId);
        if (pane && entry.buffer) {
          pane.xterm.write(entry.buffer);
        }
      }
    }
  } catch(e) { console.error('Terminal reconnect failed:', e); }
}

// ── Pane creation ───────────────────────────────────────────────────────────
async function _createPane(tabId, cwd) {
  if (!_termApi) return null;
  _termPaneCounter++;
  const paneId = `pane-${Date.now()}-${_termPaneCounter}`;
  const { Terminal } = await _loadXterm();
  const { FitAddon } = await _loadFitAddon();
  const fitAddon = new FitAddon();
  const xterm = new Terminal({
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Menlo', monospace",
    theme: {
      background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', cursorAccent: '#1a1b26',
      selectionBackground: 'rgba(0,240,255,0.2)',
      black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
      blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
      brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a',
      brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff', brightWhite: '#c0caf5',
    },
    cursorBlink: true, scrollback: 5000, allowProposedApi: true,
  });
  xterm.loadAddon(fitAddon);
  // Intercept Cmd+D / Cmd+Shift+D / Cmd+` so they don't get swallowed by xterm
  xterm.attachCustomKeyEventHandler((e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) return false;
    if ((e.metaKey || e.ctrlKey) && e.key === '`') return false;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Tab') return false;
    if ((e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}')) return false;
    if (e.metaKey && (e.key === 't' || e.key === 'T')) return false;
    return true;
  });
  const result = await _termApi.create({ tabId: paneId, cwd: cwd || undefined });
  if (result.error) { xterm.dispose(); return null; }
  xterm.onData((data) => _termApi.write(paneId, data));
  _termPanes.set(paneId, { tabId, xterm, fitAddon, resizeObs: null });
  return { type: 'pane', paneId };
}

// ── Build DOM for pane tree ─────────────────────────────────────────────────
function _buildPaneDOM(node) {
  if (node.type === 'pane') {
    const pane = _termPanes.get(node.paneId);
    if (!pane) return document.createElement('div');
    const div = document.createElement('div');
    div.className = 'term-pane';
    div.id = `term-pane-${node.paneId}`;
    div.dataset.paneId = node.paneId;
    // Pane header with split/close buttons
    const hdr = document.createElement('div');
    hdr.className = 'term-pane-header';
    hdr.innerHTML = `
      <button onclick="event.stopPropagation();termSplitPane('${node.paneId}','h')" title="Split ─">━</button>
      <button onclick="event.stopPropagation();termSplitPane('${node.paneId}','v')" title="Split │">┃</button>
      <button onclick="event.stopPropagation();termClosePane('${node.paneId}')" title="Close pane">✕</button>
    `;
    div.appendChild(hdr);
    // xterm mount — reuse saved mount from pre-detach, or existing element, or create new
    if (pane._savedMount) {
      // Re-attach the pre-detached mount
      pane._savedMount.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;';
      div.appendChild(pane._savedMount);
    } else if (pane.xterm.element && pane.xterm.element.parentElement) {
      // Already in DOM somewhere — move it
      const mount = pane.xterm.element.parentElement;
      mount.remove();
      mount.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;';
      div.appendChild(mount);
    } else {
      // First time — create mount and open
      const mount = document.createElement('div');
      mount.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;';
      div.appendChild(mount);
      pane.xterm.open(mount);
    }
    // Focus tracking
    div.addEventListener('mousedown', () => _focusPane(node.paneId));
    // ResizeObserver for fit
    if (pane.resizeObs) pane.resizeObs.disconnect();
    pane.resizeObs = new ResizeObserver(() => {
      try {
        pane.fitAddon.fit();
        if (_termApi) _termApi.resize(node.paneId, pane.xterm.cols, pane.xterm.rows);
      } catch(e) {}
    });
    pane.resizeObs.observe(div);
    return div;
  }
  // Split node
  const div = document.createElement('div');
  div.className = `term-split ${node.dir === 'h' ? 'horizontal' : 'vertical'}`;
  const child0 = _buildPaneDOM(node.children[0]);
  const child1 = _buildPaneDOM(node.children[1]);
  const ratio = node.ratio || 0.5;
  if (node.dir === 'h') {
    child0.style.height = `calc(${ratio * 100}% - 1.5px)`;
    child0.style.flex = 'none';
    child1.style.flex = '1';
  } else {
    child0.style.width = `calc(${ratio * 100}% - 1.5px)`;
    child0.style.flex = 'none';
    child1.style.flex = '1';
  }
  // Splitter
  const splitter = document.createElement('div');
  splitter.className = 'term-splitter';
  _makeSplitterDraggable(splitter, node, child0, child1);
  div.appendChild(child0);
  div.appendChild(splitter);
  div.appendChild(child1);
  return div;
}

function _makeSplitterDraggable(splitter, node, child0, child1) {
  let dragging = false;
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    splitter.classList.add('dragging');
    const parent = splitter.parentElement;
    const rect = parent.getBoundingClientRect();
    const onMove = (ev) => {
      if (!dragging) return;
      let ratio;
      if (node.dir === 'h') {
        ratio = Math.max(0.1, Math.min(0.9, (ev.clientY - rect.top) / rect.height));
        child0.style.height = `calc(${ratio * 100}% - 1.5px)`;
      } else {
        ratio = Math.max(0.1, Math.min(0.9, (ev.clientX - rect.left) / rect.width));
        child0.style.width = `calc(${ratio * 100}% - 1.5px)`;
      }
      node.ratio = ratio;
    };
    const onUp = () => {
      dragging = false;
      splitter.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _fitAllPanesInTab(_termActiveTab);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function _focusPane(paneId) {
  _termFocusedPane = paneId;
  document.querySelectorAll('.term-pane').forEach(p => p.classList.remove('focused'));
  const el = document.getElementById(`term-pane-${paneId}`);
  if (el) el.classList.add('focused');
  const pane = _termPanes.get(paneId);
  if (pane) pane.xterm.focus();
}

function _fitAllPanesInTab(tabId) {
  for (const [paneId, pane] of _termPanes) {
    if (pane.tabId === tabId) {
      try {
        pane.fitAddon.fit();
        if (_termApi) _termApi.resize(paneId, pane.xterm.cols, pane.xterm.rows);
      } catch(e) {}
    }
  }
}

function _renderTabContent(tabId) {
  const tab = _termTabs.get(tabId);
  if (!tab || !tab.root) return;
  let containerEl = document.getElementById(`term-tc-${tabId}`);
  if (!containerEl) {
    containerEl = document.createElement('div');
    containerEl.className = 'term-container';
    containerEl.id = `term-tc-${tabId}`;
    document.getElementById('term-body').appendChild(containerEl);
  }
  // Detach existing xterm mount elements before clearing so they survive
  for (const [, pane] of _termPanes) {
    if (pane.tabId === tabId && pane.xterm.element && pane.xterm.element.parentElement) {
      pane._savedMount = pane.xterm.element.parentElement;
      pane._savedMount.remove();
    }
  }
  containerEl.innerHTML = '';
  const dom = _buildPaneDOM(tab.root);
  containerEl.appendChild(dom);
  containerEl.classList.toggle('active', tabId === _termActiveTab);
  // Clean up saved refs
  for (const [, pane] of _termPanes) { delete pane._savedMount; }
  // Fit after DOM settles
  setTimeout(() => _fitAllPanesInTab(tabId), 100);
  setTimeout(() => _fitAllPanesInTab(tabId), 350);
}

// ── Tab management ──────────────────────────────────────────────────────────
async function termAddTab(cwd) {
  if (!_termApi) { showToast('error', 'Terminal not available (requires Electron)'); return; }
  _termCounter++;
  const tabId = `tab-${Date.now()}-${_termCounter}`;
  const name = `Terminal ${_termCounter}`;
  const paneNode = await _createPane(tabId, cwd);
  if (!paneNode) return;
  _termTabs.set(tabId, { name, unread: false, root: paneNode });
  _termSwitchTab(tabId);
  _renderTermTabs();
  _updateTermIndicator();
  // Focus the pane
  setTimeout(() => _focusPane(paneNode.paneId), 200);
}

function _termSwitchTab(tabId) {
  _termActiveTab = tabId;
  document.querySelectorAll('.term-container').forEach(c => c.classList.remove('active'));
  let containerEl = document.getElementById(`term-tc-${tabId}`);
  if (!containerEl) _renderTabContent(tabId);
  else containerEl.classList.add('active');
  const tab = _termTabs.get(tabId);
  if (tab) tab.unread = false;
  _renderTermTabs();
  setTimeout(() => _fitAllPanesInTab(tabId), 100);
  setTimeout(() => _fitAllPanesInTab(tabId), 350);
  // Focus first pane
  const firstPane = _findFirstPane(tab && tab.root);
  if (firstPane) setTimeout(() => _focusPane(firstPane), 200);
}

function _findFirstPane(node) {
  if (!node) return null;
  if (node.type === 'pane') return node.paneId;
  return _findFirstPane(node.children[0]);
}

function _collectPaneIds(node) {
  if (!node) return [];
  if (node.type === 'pane') return [node.paneId];
  return [..._collectPaneIds(node.children[0]), ..._collectPaneIds(node.children[1])];
}

// ── Split operations ────────────────────────────────────────────────────────
async function termSplitH() {
  if (!_termFocusedPane) { if (_termActiveTab) termSplitPane(_findFirstPane(_termTabs.get(_termActiveTab)?.root), 'h'); return; }
  await termSplitPane(_termFocusedPane, 'h');
}

async function termSplitV() {
  if (!_termFocusedPane) { if (_termActiveTab) termSplitPane(_findFirstPane(_termTabs.get(_termActiveTab)?.root), 'v'); return; }
  await termSplitPane(_termFocusedPane, 'v');
}

async function termSplitPane(paneId, dir) {
  if (!paneId || !_termApi) return;
  const pane = _termPanes.get(paneId);
  if (!pane) return;
  const tabId = pane.tabId;
  const tab = _termTabs.get(tabId);
  if (!tab) return;
  const newPaneNode = await _createPane(tabId);
  if (!newPaneNode) return;
  // Find the node in the tree and replace it with a split
  const oldNode = _findNode(tab.root, paneId);
  if (!oldNode) return;
  const splitNode = {
    type: 'split', dir, ratio: 0.5,
    children: [{ type: 'pane', paneId }, newPaneNode]
  };
  tab.root = _replaceNode(tab.root, paneId, splitNode);
  _renderTabContent(tabId);
  setTimeout(() => _focusPane(newPaneNode.paneId), 200);
}

function _findNode(node, paneId) {
  if (!node) return null;
  if (node.type === 'pane' && node.paneId === paneId) return node;
  if (node.type === 'split') {
    return _findNode(node.children[0], paneId) || _findNode(node.children[1], paneId);
  }
  return null;
}

function _replaceNode(node, paneId, replacement) {
  if (!node) return replacement;
  if (node.type === 'pane' && node.paneId === paneId) return replacement;
  if (node.type === 'split') {
    return {
      ...node,
      children: [
        _replaceNode(node.children[0], paneId, replacement),
        _replaceNode(node.children[1], paneId, replacement)
      ]
    };
  }
  return node;
}

// ── Close pane ──────────────────────────────────────────────────────────────
async function termClosePane(paneId) {
  _removePaneFromTree(paneId);
}

function _removePaneFromTree(paneId) {
  const pane = _termPanes.get(paneId);
  if (!pane) return;
  const tabId = pane.tabId;
  // Cleanup PTY and xterm
  if (_termApi) _termApi.close(paneId).catch(() => {});
  pane.xterm.dispose();
  if (pane.resizeObs) pane.resizeObs.disconnect();
  _termPanes.delete(paneId);
  const tab = _termTabs.get(tabId);
  if (!tab) return;
  // Remove from tree — if this is the root pane, close the tab
  if (tab.root.type === 'pane' && tab.root.paneId === paneId) {
    _closeTab(tabId);
    return;
  }
  // Find parent split and replace with sibling
  tab.root = _removePaneNode(tab.root, paneId);
  _renderTabContent(tabId);
  // Focus the first remaining pane
  const first = _findFirstPane(tab.root);
  if (first) setTimeout(() => _focusPane(first), 100);
  _updateTermIndicator();
}

function _removePaneNode(node, paneId) {
  if (!node || node.type === 'pane') return node;
  if (node.type === 'split') {
    if (node.children[0].type === 'pane' && node.children[0].paneId === paneId) return node.children[1];
    if (node.children[1].type === 'pane' && node.children[1].paneId === paneId) return node.children[0];
    return {
      ...node,
      children: [
        _removePaneNode(node.children[0], paneId),
        _removePaneNode(node.children[1], paneId)
      ]
    };
  }
  return node;
}

function _closeTab(tabId) {
  // Kill all panes in this tab
  for (const [paneId, pane] of _termPanes) {
    if (pane.tabId === tabId) {
      if (_termApi) _termApi.close(paneId).catch(() => {});
      pane.xterm.dispose();
      if (pane.resizeObs) pane.resizeObs.disconnect();
      _termPanes.delete(paneId);
    }
  }
  const containerEl = document.getElementById(`term-tc-${tabId}`);
  if (containerEl) containerEl.remove();
  _termTabs.delete(tabId);
  if (_termActiveTab === tabId) {
    const remaining = [..._termTabs.keys()];
    if (remaining.length > 0) _termSwitchTab(remaining[remaining.length - 1]);
    else { _termActiveTab = null; _termFocusedPane = null; termClose(); }
  }
  _renderTermTabs();
  _updateTermIndicator();
}

async function termCloseTab(tabId) { _closeTab(tabId); }

// ── Tab bar rendering ───────────────────────────────────────────────────────
function _renderTermTabs() {
  const container = document.getElementById('term-tabs');
  if (!container) return;
  container.innerHTML = '';
  for (const [id, tab] of _termTabs) {
    const el = document.createElement('div');
    el.className = 'term-tab' + (id === _termActiveTab ? ' active' : '');
    el.innerHTML = `
      <span class="unread-dot${tab.unread ? ' visible' : ''}"></span>
      <span class="tab-name">${tab.name}</span>
      <span class="tab-close" onclick="event.stopPropagation();termCloseTab('${id}')">✕</span>
    `;
    el.onclick = () => _termSwitchTab(id);
    el.onmousedown = (e) => { if (e.button === 1) { e.preventDefault(); termCloseTab(id); } };
    container.appendChild(el);
  }
  const countEl = document.getElementById('term-collapsed-count');
  if (countEl) countEl.textContent = _termTabs.size;
}

// ── Drawer state ────────────────────────────────────────────────────────────
function toggleTerminalDrawer() {
  const ct = document.querySelector('.container');
  if (_termDrawerState === 'closed') {
    _termDrawerState = 'open';
    const drawer = document.getElementById('terminal-drawer');
    drawer.classList.add('open');
    drawer.classList.remove('collapsed');
    drawer.style.width = _termDrawerWidth + '%';
    ct.style.marginRight = _termDrawerWidth + '%';
    ct.classList.add('term-open');
    if (_termTabs.size === 0) termAddTab();
    else {
      _termSwitchTab(_termActiveTab || [..._termTabs.keys()][0]);
    }
  } else if (_termDrawerState === 'open') {
    termClose();
  } else if (_termDrawerState === 'collapsed') {
    termRestore();
  }
}

function termCollapse() {
  _termDrawerState = 'collapsed';
  document.getElementById('terminal-drawer').classList.add('collapsed');
  const ct = document.querySelector('.container');
  ct.style.marginRight = '40px';
  ct.classList.remove('term-open');
}

function termRestore() {
  _termDrawerState = 'open';
  const drawer = document.getElementById('terminal-drawer');
  drawer.classList.remove('collapsed');
  drawer.style.width = _termDrawerWidth + '%';
  const ct = document.querySelector('.container');
  ct.style.marginRight = _termDrawerWidth + '%';
  ct.classList.add('term-open');
  if (_termActiveTab) {
    setTimeout(() => _fitAllPanesInTab(_termActiveTab), 100);
    setTimeout(() => _fitAllPanesInTab(_termActiveTab), 350);
    const first = _findFirstPane(_termTabs.get(_termActiveTab)?.root);
    if (first) setTimeout(() => _focusPane(first), 200);
  }
}

async function termClose() {
  _termDrawerState = 'closed';
  const drawer = document.getElementById('terminal-drawer');
  drawer.classList.remove('open', 'collapsed');
  const ct = document.querySelector('.container');
  ct.style.marginRight = '';
  ct.classList.remove('term-open');
  for (const [paneId, pane] of _termPanes) {
    if (_termApi) await _termApi.close(paneId).catch(() => {});
    pane.xterm.dispose();
    if (pane.resizeObs) pane.resizeObs.disconnect();
  }
  _termPanes.clear();
  _termTabs.clear();
  _termActiveTab = null;
  _termFocusedPane = null;
  _termCounter = 0;
  _termPaneCounter = 0;
  document.getElementById('term-body').innerHTML = '';
  _renderTermTabs();
  _updateTermIndicator();
}

async function termOpenExternal() {
  if (!_termApi) return;
  const cwdEl = document.querySelector('.info-value[data-field="cwd"]');
  const cwd = cwdEl ? cwdEl.textContent : null;
  await _termApi.openExternal(cwd);
}

function _updateTermIndicator() {
  const indicator = document.getElementById('term-indicator');
  if (indicator) indicator.classList.toggle('active', _termPanes.size > 0);
}

// Lazy-load xterm.js modules
let _xtermModule = null, _fitModule = null;
async function _loadXterm() {
  if (_xtermModule) return _xtermModule;
  _xtermModule = await import('/static/xterm.mjs');
  return _xtermModule;
}
async function _loadFitAddon() {
  if (_fitModule) return _fitModule;
  _fitModule = await import('/static/xterm-addon-fit.mjs');
  return _fitModule;
}

// ── Drawer resize drag ──────────────────────────────────────────────────────
let _termDrawerWidth = 60; // percentage
function _initDrawerResize() {
  const handle = document.getElementById('term-resize-handle');
  if (!handle) return;
  let dragging = false;
  handle.addEventListener('mousedown', (e) => {
    if (_termDrawerState !== 'open') return;
    e.preventDefault();
    dragging = true;
    handle.classList.add('dragging');
    const drawer = document.getElementById('terminal-drawer');
    drawer.classList.add('dragging');
    const onMove = (ev) => {
      if (!dragging) return;
      const winW = window.innerWidth;
      const pct = Math.max(20, Math.min(85, ((winW - ev.clientX) / winW) * 100));
      _termDrawerWidth = pct;
      drawer.style.width = pct + '%';
      document.querySelector('.container').style.marginRight = pct + '%';
    };
    const onUp = () => {
      dragging = false;
      handle.classList.remove('dragging');
      const drawer = document.getElementById('terminal-drawer');
      drawer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Re-fit all panes after resize
      if (_termActiveTab) _fitAllPanesInTab(_termActiveTab);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

document.addEventListener('DOMContentLoaded', () => { _initTerminal(); _initDrawerResize(); });
