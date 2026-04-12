
// Hash-based URL routing — keeps state in URL so hard refresh stays on same page
function _updateHash() {
  const parts = ['tab=' + currentTab];
  if (currentTab === 'sessions') parts.push('mode=' + currentMode);
  if (_currentWsId) parts.push('ws=' + _currentWsId);
  const newHash = '#' + parts.join('&');
  if ('#' + window.location.hash.slice(1) !== newHash) {
    history.replaceState(null, '', '/' + newHash);
  }
}

// Navigation stack — tracks where user came from for proper back navigation
function _pushNavState() {
  const stack = JSON.parse(sessionStorage.getItem('wf-nav-stack') || '[]');
  // Store the full URL with hash — contains all state needed to restore view
  const state = { url: window.location.pathname + window.location.hash };
  // Attach workspace name if we're inside a workspace view
  const hash = window.location.hash || '';
  const hp = new URLSearchParams(hash.replace(/^#/, ''));
  if (hp.get('ws') && typeof _workspaces !== 'undefined') {
    const ws = _workspaces.find(w => w.id === hp.get('ws'));
    if (ws) state.wsName = ws.name;
  }
  stack.push(state);
  // Keep stack reasonable (max 20 entries)
  if (stack.length > 20) stack.splice(0, stack.length - 20);
  sessionStorage.setItem('wf-nav-stack', JSON.stringify(stack));
}
function _popNavState() {
  const stack = JSON.parse(sessionStorage.getItem('wf-nav-stack') || '[]');
  const state = stack.pop();
  sessionStorage.setItem('wf-nav-stack', JSON.stringify(stack));
  return state || null;
}
function _peekNavState() {
  const stack = JSON.parse(sessionStorage.getItem('wf-nav-stack') || '[]');
  return stack.length ? stack[stack.length - 1] : null;
}

// Release notes
const RELEASES = [
  {
    version: 'v6.5.0',
    date: '2026-04-12',
    tag: 'major',
    tagline: 'Gemini is now a first-class provider. Session capture is tougher. UI flows are complete.',
    description: 'SAVANT v6.5.0 is the Gemini hardening release. Gemini sessions now show up reliably as soon as they start, the shared dashboard actions work end-to-end, and Savant stores the full chat stream with stronger fallback parsing for in-progress sessions and artifact directories. This release also hardens MCP startup and Codex/Gemini session plumbing so the dashboard is less fragile under real CLI usage.',
    abilities: [
      { icon: '♊', name: 'Full Gemini Session Support', desc: 'Gemini sessions are discovered from canonical chat files and artifact directories, then rendered as first-class Savant sessions.' },
      { icon: '🗂', name: 'Workspace-Ready Gemini UI', desc: 'Assign, rename, star, archive, search, inspect, and delete Gemini sessions from the same shared UI used by other providers.' },
      { icon: '💬', name: 'Stored Gemini Chat History', desc: 'Conversation parsing now keeps user prompts, assistant replies, thoughts, and tool calls together for the detail view.' },
      { icon: '🛡️', name: 'Provider Hardening', desc: 'More resilient MCP startup checks, stdio binding repair, and safer provider metadata handling across Codex and Gemini.' },
    ],
    items: [
      { type: 'feat', text: 'Gemini discovery now scans both session-*.json files and nested chat artifact directories, deduping to the canonical session ID' },
      { type: 'feat', text: 'Gemini session detail now includes nickname, workspace, artifact directory, file counts, live status, and active tool indicators' },
      { type: 'feat', text: 'Gemini provider now supports shared UI actions: rename, search, delete, bulk delete, project files, and git activity' },
      { type: 'feat', text: 'Gemini conversation parsing now preserves prompts, replies, thoughts, and tool call metadata for the detail page' },
      { type: 'fix', text: 'Gemini file browser now resolves the real artifact directory instead of assuming a flat session path' },
      { type: 'fix', text: 'Workspace assignment and provider metadata updates now validate the Gemini session before mutating cache or notes' },
      { type: 'fix', text: 'Savant stdio MCP launcher now auto-discovers the live Flask API base instead of defaulting blindly to localhost:8090' },
      { type: 'fix', text: 'MCP startup diagnostics now surface the real Python probe failure when dependencies are broken' },
      { type: 'chore', text: 'Package version bumped to 6.5.0 with hero release notes and new Gemini regression coverage' },
    ],
  },
  {
    version: 'v6.4.0',
    date: '2026-04-11',
    tag: 'minor',
    tagline: 'In-app guide. Status bar breadcrumb. Resume in terminal. KG auto-fit.',
    description: 'SAVANT v6.4.0 adds a searchable in-app developer guide, navigation breadcrumb in the status bar, one-click session resume in terminal, and auto-fit for the knowledge graph viewport. Session cards are decluttered and the left action bar is now context-aware.',
    abilities: [
      { icon: '📖', name: 'Savant Guide', desc: 'Full in-app guide with tree navigation, search, and sections covering architecture, components, and developer setup. Click the blinking (i) icon.' },
      { icon: '🧭', name: 'Navigation Breadcrumb', desc: 'Status bar now shows your current location: Workspaces > Project Name > Tasks.' },
      { icon: '▶', name: 'Resume in Terminal', desc: 'New play button on session cards opens terminal and runs the resume command directly.' },
      { icon: '🧠', name: 'KG Auto-Fit', desc: 'Knowledge graph auto-fits to viewport when simulation settles — no more scrolling to find nodes.' },
    ],
    items: [
      { type: 'feat', text: 'In-app Savant Guide — searchable tree with sections: What is Savant, Architecture, Components, Developer Guide, Keyboard Shortcuts' },
      { type: 'feat', text: 'Status bar navigation breadcrumb — updates on tab switch, workspace open/close, sub-tab change' },
      { type: 'feat', text: 'Resume in Terminal button (▶) on session cards — opens terminal tab in session cwd and runs resume command' },
      { type: 'feat', text: 'Open in Browser button (globe icon) in left action bar — opens current page in default browser' },
      { type: 'feat', text: 'Left action bar is context-aware: GUI shows logs + browser, Terminal shows tips + close' },
      { type: 'feat', text: 'Knowledge graph auto-fits to viewport when simulation ends' },
      { type: 'feat', text: 'Workspace start_date auto-defaults to today when not explicitly set' },
      { type: 'feat', text: 'Archive script (archive.sh) — copies build DMG to arch-version/<version>/' },
      { type: 'fix', text: 'Session cards decluttered — removed copy path, copy info, and archive icons (kept resume copy, star, delete)' },
      { type: 'fix', text: 'Session card tools list removed from footer' },
      { type: 'fix', text: 'Dev log panel no longer overlapped by right action bar (right: 36px)' },
      { type: 'fix', text: 'Workspace Assets total now sums files + session files + commits + notes' },
      { type: 'fix', text: 'Session files count shows actual number of sessions assigned to workspace' },
      { type: 'chore', text: 'INSTALL.md — distribution guide for macOS ARM64 (no code signing)' },
    ],
  },
  {
    version: 'v6.1.0',
    date: '2026-04-10',
    tag: 'major',
    tagline: 'App chrome. Nested splits. KG graph_type & staging via MCP. Unified terminal.',
    description: 'SAVANT v6.1.0 introduces a full app chrome layout (top bar, right bar, persistent sidebar and status bar), a tree-based nested split terminal, and major knowledge graph MCP enhancements. The in-page terminal is removed — one unified BrowserView terminal handles everything. All toasts now log to the notification bell panel.',
    abilities: [
      { icon: '🖥️', name: 'App Chrome Layout', desc: 'Top bar (logo), left sidebar, right bar, bottom status bar — all persistent. Terminal and UI fill the content area.' },
      { icon: '🌳', name: 'Nested Split Terminal', desc: 'Tree-based splits — split any pane horizontally or vertically, unlimited nesting. Each pane is independent.' },
      { icon: '🧠', name: 'KG MCP Enhancements', desc: 'graph_type on nodes, update_node tool, workspace-required staged workflow, commit_workspace for review-then-commit.' },
      { icon: '🔔', name: 'Unified Notifications', desc: 'All toasts (indexing, errors, MCP events) now appear in the bell icon notification history.' },
    ],
    items: [
      { type: 'feat', text: 'App chrome — persistent top bar with centered Savant logo, right bar placeholder, all 4 bars always visible' },
      { type: 'feat', text: 'Nested terminal splits — tree-based model replaces flat 2-slot system. Cmd+D splits right, Cmd+Shift+D splits down, unlimited nesting' },
      { type: 'feat', text: 'Unified BrowserView terminal — removed in-page terminal (terminal-view.js is now a thin stub). One terminal component.' },
      { type: 'feat', text: 'Terminal always fills 100% content area between the 4 bars. Resize handle removed.' },
      { type: 'feat', text: 'KG MCP: store() accepts graph_type and node_type with descriptive docstrings for AI agents' },
      { type: 'feat', text: 'KG MCP: new update_node() tool — update title, content, node_type, graph_type without workspace' },
      { type: 'feat', text: 'KG MCP: workspace-required staged creation — nodes start as staged, commit_workspace() to publish' },
      { type: 'feat', text: 'KG: auto-explore depth 1 on node click, node ID pill on detail panel (click to copy)' },
      { type: 'feat', text: 'KG: search persists across layer/filter changes (Business, Stack, All)' },
      { type: 'feat', text: 'Workspace cards show uncommitted KG node count (amber chip)' },
      { type: 'feat', text: 'All showToast calls now push to notification bell history — indexing, errors, everything' },
      { type: 'feat', text: 'Dev log panel sits next to sidebar (left: 48px) instead of covering it' },
      { type: 'feat', text: 'Header moved to top bar — mode switcher tabs stay in main page' },
      { type: 'fix', text: 'Terminal cursor not appearing — _buildTree used getElementById on detached elements (now uses Map)' },
      { type: 'fix', text: 'Terminal cursor focus — _ensureFocus calls focus() before fit() to restart cursor blink' },
      { type: 'fix', text: 'Flask base URL race — showTermView awaits _injectFlaskBase before sending add-tab command' },
      { type: 'fix', text: 'xterm module loading retry — catches import errors and retries after 500ms' },
      { type: 'fix', text: '_findParent defaulting to _treeRoot — was silently returning null for all non-root operations' },
      { type: 'fix', text: 'Terminal auto-switches back to UI when all tabs are closed' },
      { type: 'fix', text: 'BrowserView bounds respect all 4 bars (sidebar 48px, top 36px, right 36px, status 22px)' },
      { type: 'fix', text: 'Split labels corrected — "Split Right" and "Split Down" instead of "Horizontal/Vertical"' },
      { type: 'fix', text: 'Tab cycling crosses all panes (not just active slot)' },
      { type: 'chore', text: 'Workspace stat cards and cards made more compact (smaller padding, fonts)' },
      { type: 'chore', text: 'Major release version number font reduced from 2.2rem to 1.4rem' },
      { type: 'chore', text: '56 terminal regression tests + updated KG and UI structural tests (109+ total new tests)' },
    ],
  },
  {
    version: 'v6.0.0',
    date: '2026-04-03',
    tag: 'major',
    tagline: 'Terminal rework. KG staging. Copilot & Claude only. 32 MB leaner.',
    description: 'SAVANT v6.0.0 is a focused cleanup and polish release. The terminal is reimagined as a first-class view with a persistent left-side tab bar. The knowledge graph gains staged nodes, workspace purge, and multi-workspace linking. Themes are simplified to Dark (default) and Light — StarCraft is retired. Cline is removed; Savant now focuses exclusively on Copilot CLI and Claude Code. The bundle is ~32 MB leaner with all loading GIFs and legacy migration scripts gone.',
    abilities: [
      { icon: '🖥️', name: 'Terminal as First-Class View', desc: 'Left tab bar switches between UI and Terminal. Multi-tab splits with color-coded panes.' },
      { icon: '🔬', name: 'KG Staging & Commit', desc: 'Nodes start staged — commit them to the main graph when ready. Purge workspace KG cleanly.' },
      { icon: '🎨', name: 'Dark & Light Themes', desc: 'Corporate → Dark (default). Dev → Light. StarCraft removed. Bundle 32 MB leaner.' },
      { icon: '⟐', name: 'Copilot + Claude Only', desc: 'Cline support removed. Savant focuses on GitHub Copilot CLI and Claude Code exclusively.' },
    ],
    items: [
      { type: 'feat', text: 'Terminal rework — two-view app with persistent left tab bar (UI / Terminal), always visible' },
      { type: 'feat', text: 'Multi-tab terminal with split panes via keyboard shortcuts; color-coded sessions (black, grey, brown, blue)' },
      { type: 'feat', text: 'KG staged/committed workflow — nodes are staged on creation, committed via toolbar button or MCP commit_workspace tool' },
      { type: 'feat', text: 'Workspace KG purge — deletes exclusive nodes, unlinks shared nodes, full cascade edge cleanup' },
      { type: 'feat', text: 'Multi-workspace node linking — nodes show workspace chips in detail pane; add/remove via UI and MCP' },
      { type: 'feat', text: 'KG metadata on workspace cards — node/edge counts displayed on workspace overview cards' },
      { type: 'chore', text: 'Themes renamed: Corporate → Dark (now default), Dev → Light, StarCraft option removed' },
      { type: 'chore', text: 'Removed Cline agent support — Savant now supports GitHub Copilot CLI and Claude Code only' },
      { type: 'chore', text: 'Removed ~32 MB of loading GIFs — loading overlay uses spinner only' },
      { type: 'chore', text: 'Removed legacy MongoDB→SQLite migration script' },
    ],
  },
  {
    version: 'v5.5.0',
    date: '2026-03-31',
    tag: 'major',
    tagline: 'Workspace as metadata. Bulk actions. Export/Import. Shared KG viewer.',
    description: 'SAVANT v5.5.0 rethinks how workspaces connect to knowledge. Workspace associations are now metadata on nodes — not project-node edges — so a single node can belong to multiple workspaces. The workspace Knowledge tab uses the exact same viewer as the main KG explorer. Bulk actions let you multi-select nodes to merge, connect, assign to workspaces, or delete in one shot. Export any workspace KG as portable JSON and import it into another instance.',
    abilities: [
      { icon: '🗂️', name: 'Workspace as Metadata', desc: 'Nodes store workspaces in metadata.workspaces array — supports multi-workspace per node' },
      { icon: '📦', name: 'Export / Import', desc: 'Download workspace KG as JSON, import into another workspace with title+type deduplication' },
      { icon: '⚡', name: 'Bulk Actions', desc: 'Multi-select nodes → merge, connect all, add to workspace, or bulk delete' },
      { icon: '🔍', name: 'Info Modal', desc: 'Click node/edge counter for grouped breakdown by type — nodes and edges side by side' },
    ],
    items: [
      { type: 'feat', text: 'Workspace is now metadata — nodes store workspaces in metadata.workspaces array instead of project node edges. Supports multiple workspaces per node.' },
      { type: 'feat', text: 'Shared KG component — workspace Knowledge tab uses the exact same viewer as main KG (search, filters, expansion, merge, connect, multi-select)' },
      { type: 'feat', text: 'Bulk actions — multi-select nodes then: merge, connect all, add to workspace, or bulk delete' },
      { type: 'feat', text: 'KG Export — download workspace knowledge graph as portable JSON from workspace toolbar' },
      { type: 'feat', text: 'KG Import — upload JSON knowledge graph into a workspace with title+type deduplication' },
      { type: 'feat', text: 'Info modal — click "N nodes · M edges" counter for grouped breakdown of all nodes by type and edges by type' },
      { type: 'feat', text: 'Multi-workspace link — link existing nodes to workspace with checkbox multi-select picker' },
      { type: 'feat', text: 'Unlink workspace — remove a workspace from a node via API' },
      { type: 'fix',  text: 'MCP connect tool no longer 500s on duplicate edges — returns existing edge gracefully' },
      { type: 'fix',  text: 'Missing "session" in VALID_NODE_TYPES for API route validation' },
      { type: 'fix',  text: 'MCP store tool docs updated — workspace is metadata, not a project node' },
      { type: 'chore', text: '21 TDD tests covering workspace metadata, export/import, bulk actions, info endpoint, unlink' },
    ],
  },
  {
    version: 'v5.4.0',
    date: '2026-03-30',
    tag: '',
    items: [
      { type: 'feat', text: 'Neighborhood expansion — select a type, search, or click 🔍 Explore on any node to see 1st-degree neighbors, then expand to 2nd/3rd with depth controls' },
      { type: 'feat', text: 'Depth control bar — floating +/− depth indicator with focal/visible counts, appears on type filter, search, or node explore' },
      { type: 'feat', text: 'Recency dropdown — filter graph by All Time, Today, Last 2 Days, or This Week' },
      { type: 'feat', text: 'Node merge — CMD+Click to multi-select nodes, merge panel in detail panel with type picker and connection stats' },
      { type: 'feat', text: 'Type-ahead Connect modal — searchable grouped dropdown with collapsible type groups (replaces native select)' },
      { type: 'fix',  text: 'All 10 node types now present everywhere: added project, concept, repo, session to icons/colors/filters/type pickers' },
      { type: 'fix',  text: 'All 10 edge types now present in Connect modal and edge color map' },
      { type: 'fix',  text: 'Type filter is now client-side (no server reload) — instant switching with expansion' },
      { type: 'chore', text: '19 merge tests covering validation, edge re-pointing, dedup, content merging, 3-way merge' },
    ],
  },
  {
    version: 'v5.3.0',
    date: '2026-03-30',
    tag: '',
    items: [
      { type: 'feat', text: 'Debug log panel — click "LIVE" indicator in bottom-right to view startup & runtime logs anytime' },
      { type: 'feat', text: 'Logs are color-coded by level (flask, mcp, error, ok, sys) with timestamps' },
      { type: 'feat', text: 'Startup summary replayed into dashboard after navigation (Electron version, ports, PID, timing)' },
      { type: 'refactor', text: 'Modularized 372K inline JS into 14 separate files under /static/js/' },
      { type: 'refactor', text: 'index.html reduced from 15,759 to 6,945 lines' },
      { type: 'fix',  text: 'Fixed missing kbShowAddNodeModal() and kbDeleteNode() function declarations' },
      { type: 'fix',  text: 'Copyright updated to Project X' },
      { type: 'chore', text: '11 JS syntax tests: node --check, orphan detection, dev log panel validation' },
    ],
  },
  {
    version: 'v5.2.0',
    date: '2026-03-29',
    tag: 'new',
    tagline: 'Prompt Generation. Node Editing. Hardened & Battle-tested.',
    description: 'SAVANT v5.2.0 delivers AI prompt generation directly from KG search results, inline node editing in the detail panel, fully hardened knowledge routes with TDD test coverage, smarter title-only session & workspace filtering, and new terminal split/maximize buttons in the BrowserView bridge.',
    abilities: [
      { icon: '🧠', name: 'KG Prompt Generator', desc: 'Search nodes → click 🧠 Prompt → copy a structured AI prompt with full graph context' },
      { icon: '✏️', name: 'Inline Node Editing', desc: 'Edit any node\'s title, type, content, repo, and files directly in the detail panel' },
      { icon: '🛡️', name: 'Route Hardening (TDD)', desc: '30 new tests covering prompt API, node edit, and route hardening edge cases' },
      { icon: '🔍', name: 'Smart Search Filtering', desc: 'Typing filters by title only; Enter triggers full search across all fields' },
      { icon: '💻', name: 'Terminal Split Buttons', desc: 'Split vertical, split horizontal, and maximize buttons added to terminal toolbar' },
    ],
    items: [
      { type: 'feat', text: 'POST /api/knowledge/prompt — build AI prompt from KG node IDs (max 30 nodes)' },
      { type: 'feat', text: '🧠 Generate Prompt button in search chips row — only when 1–30 nodes matched' },
      { type: 'feat', text: 'Inline node edit mode in detail panel with title, type, content, repo, files fields' },
      { type: 'feat', text: 'Session search: typing filters id/summary only; Enter triggers full search + API' },
      { type: 'feat', text: 'Workspace search: typing filters name only; Enter triggers deep search + all fields' },
      { type: 'feat', text: 'Terminal toolbar: split vertical (┃), split horizontal (━), maximize/restore (⤢) buttons' },
      { type: 'feat', text: 'BrowserView bridge: termSplitH, termSplitV, termMaximize overrides added' },
      { type: 'fix',  text: 'Route hardening: get_node, update_node, delete_node validate IDs with _safe_id()' },
      { type: 'fix',  text: 'update_node: empty title → 400, invalid node_type → 400' },
      { type: 'fix',  text: 'create_edge: invalid edge_type coerced to relates_to instead of crashing' },
      { type: 'fix',  text: 'store_experience: content truncated to MAX_CONTENT_LEN (20,000 chars)' },
      { type: 'fix',  text: 'graph, neighbors, recent, search, list routes: int() guard replaced with _safe_int()' },
      { type: 'chore', text: 'KnowledgeGraphDB.VALID_NODE_TYPES expanded to include full business+stack taxonomy' },
      { type: 'chore', text: '30 new pytest tests across test_kg_prompt, test_kg_node_edit, test_kg_hardening' },
    ],
  },
  {
    version: 'v5.1.0',
    date: '2026-03-29',
    tag: 'new',
    tagline: 'Knowledge Graph — Hardened, Layered & Searchable',
    description: 'SAVANT v5.1.0 brings a fully hardened knowledge MCP server with the correct business & stack taxonomy, multi-term OR/AND search in the graph UI, a collapsible detail panel, and a completely rewritten MCP toolguide with accurate node types, edge types, and examples.',
    abilities: [
      { icon: '🏢', name: 'Business & Stack Taxonomy', desc: 'client, domain, service, library, technology, insight — two logical graph layers' },
      { icon: '🔍', name: 'OR / AND Multi-Term Search', desc: 'Add multiple search terms as chips; toggle ⋂ AND to intersect, OR for union; zoom to results' },
      { icon: '◀', name: 'Collapsible Detail Panel', desc: 'Collapse the right panel with ‹ to give the graph full width; re-expand with › button' },
      { icon: '🛡️', name: 'Hardened Knowledge MCP', desc: 'All tool params validated, correct edge types, clamped limits, schema-safe list handling' },
      { icon: '📖', name: 'Rewritten MCP Toolguide', desc: 'Full node taxonomy, accurate tool docs for all 8 tools, updated quick-start examples' },
    ],
    items: [
      { type: 'feat', text: 'Multi-term OR search with chip UI — add terms, remove individually, ✕ Clear all' },
      { type: 'feat', text: '⋂ AND toggle — intersect results across all search terms; auto-hides for single term' },
      { type: 'feat', text: 'Collapsible right detail panel with smooth animation; expand button in zoom controls' },
      { type: 'fix',  text: 'Knowledge MCP: list[str]/list[dict] params replaced with safe string types to fix schema errors' },
      { type: 'fix',  text: 'Knowledge MCP: edge types, node types, and limit/depth now validated on every tool call' },
      { type: 'fix',  text: 'Routes: int() crash on non-numeric limit/depth params now handled gracefully' },
      { type: 'chore', text: 'MCP toolguide fully rewritten — correct taxonomy, edge types, storage path, examples' },
      { type: 'chore', text: 'MCP server instructions updated to reflect iCapital graph context and current node types' },
    ],
  },
  {
    version: 'v5.0.0',
    date: '2026-03-25',
    tag: 'new',
    tagline: 'Knowledge Graph. Persistent Terminal. The AI Memory Layer.',
    description: 'SAVANT v5.0.0 is the knowledge release. Every session, task, insight, and repo is now connected in a living knowledge graph — traversable, searchable, and linkable across your entire dev history. Pair that with a rewritten BrowserView terminal that persists across every page navigation, and Savant becomes the first AI engineering tool with true long-term memory and a terminal that never dies.',
    abilities: [
      { icon: '🧬', name: 'Knowledge Graph', desc: 'Nodes, edges, and traversal — sessions, insights, concepts, repos all connected' },
      { icon: '🔗', name: 'Graph Store & Recall', desc: 'store(), search(), neighbors(), connect() — curate and retrieve dev experiences' },
      { icon: '💡', name: 'Insight Engine', desc: 'Save learned patterns from any session with source attribution and file links' },
      { icon: '🗺️', name: 'Project Context', desc: 'project_context() aggregates full workspace graph in a single call' },
      { icon: '💻', name: 'Persistent BrowserView Terminal', desc: 'Terminal lives in its own BrowserView — survives page navigations, never reloads' },
      { icon: '🔌', name: 'MCP Nav Everywhere', desc: 'MCP tab now present on every page — session detail, index, everywhere' },
      { icon: '🧭', name: 'Knowledge MCP Tools', desc: 'search, recent, store, connect, disconnect, neighbors, list_concepts, project_context' },
      { icon: '📐', name: 'Mobile Viewport Reflow', desc: 'Session detail adapts to single-column layout when terminal is open' },
    ],
    items: [
      { type: 'feat', text: 'Knowledge graph — nodes (insight, session, concept, repo, project) with typed edges' },
      { type: 'feat', text: 'savant-knowledge MCP server — 8 tools: search, recent, store, connect, disconnect, neighbors, list_concepts, project_context. Node types: client, domain, service, library, technology, insight' },
      { type: 'feat', text: 'store() — save curated dev experiences with source, files, repo, and workspace_id' },
      { type: 'feat', text: 'search() — semantic full-text search across all knowledge nodes' },
      { type: 'feat', text: 'neighbors() — traverse graph N hops from any node with optional edge_type filter' },
      { type: 'feat', text: 'project_context() — aggregate full workspace knowledge: insights, concepts, sessions, repos, tasks, notes' },
      { type: 'feat', text: 'connect() / disconnect() — create and remove typed edges between any two nodes' },
      { type: 'feat', text: 'list_concepts() — enumerate all concept nodes (technologies, patterns, topics)' },
      { type: 'feat', text: 'Persistent BrowserView terminal — terminal lives in dedicated BrowserView overlay, survives full page reloads' },
      { type: 'feat', text: 'Terminal served from Flask /terminal_view — dynamic port resolved, xterm loads correctly' },
      { type: 'feat', text: 'Session detail page reflows to single-column layout when terminal is open (term-open class)' },
      { type: 'feat', text: '🔌 MCP nav button added to session detail page — consistent nav bar everywhere' },
      { type: 'fix', text: 'Stale MCP orphan processes killed at startup via lsof port scan + SIGKILL' },
      { type: 'fix', text: 'Loading overlay no longer covers terminal when drawer is open' },
      { type: 'fix', text: 'Terminal focus restored on mousedown after clicking away' },
    ]
  },
  {
    version: 'v4.0.0',
    date: '2026-03-22',
    tag: 'new',
    tagline: 'Terminal. Three MCP Servers. Semantic Search. One App.',
    description: 'SAVANT v4.0.0 is the mega release — the largest feature drop in Savant history. Embedded terminal, three fully interactive MCP servers (Workspace, Abilities, Context), a semantic code search engine with bundled AI embeddings, a memory bank browser, project indexing with live phase tracking, and a unified file viewer that works everywhere. This is no longer a session monitor — it\'s a full AI engineering command center.',
    abilities: [
      { icon: '💻', name: 'Embedded Terminal', desc: 'Full PTY terminal inside the app — xterm.js with themes, scrollback, multi-session' },
      { icon: '🧭', name: 'Workspace MCP', desc: '13 interactive tools — workspaces, tasks, MRs, Jira — all playable from the UI' },
      { icon: '🧠', name: 'Abilities MCP', desc: 'Persona resolution, rule management, asset CRUD — the AI instruction layer' },
      { icon: '🔍', name: 'Context MCP', desc: 'Semantic code search, memory bank, repo indexing — powered by sqlite-vec embeddings' },
      { icon: '📦', name: 'Bundled AI Model', desc: '254MB DistilBERT model ships inside the .dmg — no downloads, works offline' },
      { icon: '📂', name: 'Unified File Viewer', desc: 'One component everywhere — markdown rendered, code with line numbers, copy & open' },
      { icon: '⏹', name: 'Index Control', desc: 'Stop, purge, re-index any project — live phase tracking with file-level progress' },
      { icon: '🗂️', name: 'Master-Detail Projects', desc: 'Split-pane project browser with file type breakdown, language bars, memory bank stats' },
    ],
    items: [
      { type: 'feat', text: 'Embedded terminal — full xterm.js PTY with node-pty, multiple sessions, theme support' },
      { type: 'feat', text: 'Workspace MCP interactive subtab — 13 tool cards with click-to-run playground and live JSON response' },
      { type: 'feat', text: 'Abilities MCP subtab — persona resolution, rule browsing, asset CRUD with live connection status' },
      { type: 'feat', text: 'Context MCP subtab — semantic search, project management, memory bank browser' },
      { type: 'feat', text: 'Context Engine — 8 Python modules: embeddings, indexer, chunker, walker, language detector, DB, routes, MCP server' },
      { type: 'feat', text: '16 Flask API endpoints for Context — search, memory, code files, project CRUD, indexing, stats' },
      { type: 'feat', text: 'sqlite-vec powered semantic search — vector embeddings with cosine similarity' },
      { type: 'feat', text: 'Bundled stsb-distilbert-base embedding model — 254MB, works offline, no download needed' },
      { type: 'feat', text: 'Three-state model status — Loaded (green), Ready (yellow), Not Found (red)' },
      { type: 'feat', text: 'Live indexing phases — Loading Model → Scanning Directory → Reading Files → Embedding → Complete' },
      { type: 'feat', text: 'Stop indexing — cancel in-progress jobs with graceful file-level cancellation' },
      { type: 'feat', text: 'Purge index — clear vectors and chunks but keep the project entry' },
      { type: 'feat', text: 'Master-detail project view — sidebar list + detail pane with overview stats, language breakdown bars, timeline' },
      { type: 'feat', text: 'File type breakdown — per-project language distribution with colored progress bars' },
      { type: 'feat', text: 'Memory bank count — separate tracking of memory bank vs code files per project' },
      { type: 'feat', text: 'Unified file viewer — openContextFile() reuses session file-modal for all context files' },
      { type: 'feat', text: 'Markdown rendering in file viewer — headings, code blocks, tables, blockquotes, links' },
      { type: 'feat', text: 'Code view with line numbers — monospaced, hover highlighting, scrollable' },
      { type: 'feat', text: 'Collapsible project groups in memory bank — click arrow to expand/collapse' },
      { type: 'feat', text: 'Connection status bars on all 3 MCP subtabs — auto-test on tab open, rich feedback' },
      { type: 'feat', text: 'Shared _mcpTestConnection() — green Connected with latency, red Offline with error, yellow Testing' },
      { type: 'feat', text: 'MCP Tools Guide modal — all 3 servers documented with quick-start workflows' },
      { type: 'feat', text: 'Persistent indexing polling — survives tab switches, shows cached progress on return' },
      { type: 'feat', text: 'Two-row Context status bar — connection info on top, data stats (projects/files/chunks) below' },
      { type: 'feat', text: 'Code file list and read API — /api/context/code/list and /api/context/code/read endpoints' },
      { type: 'refactor', text: 'Context MCP server fixed — FastMCP constructor gets host/port directly, matches workspace/abilities pattern' },
      { type: 'refactor', text: 'API route mapping fixed — workspace playground now uses correct Flask endpoints' },
      { type: 'refactor', text: 'Memory bank grouping fixed — uses repo field instead of repo_name' },
      { type: 'fix', text: 'Stop indexing no longer errors on non-active projects — resets to "added" state' },
      { type: 'fix', text: 'Indexing progress bar reads 0-100 int correctly (was treated as 0-1 float)' },
      { type: 'fix', text: 'Context center-aligned in fullscreen — max-width 900px with auto margins' },
    ]
  },
  {
    version: 'v3.0.0',
    date: '2026-03-21',
    tag: 'major',
    tagline: 'Native desktop app. Zero dependencies. One click install.',
    description: 'SAVANT v3.0.0 is a ground-up rewrite of the delivery stack. MongoDB is gone — replaced by SQLite with zero external dependencies. The entire dashboard now ships as a native macOS desktop app (.dmg) powered by Electron — double-click to install, menu bar tray to control, auto-configured MCP for all three AI providers. No Docker. No brew install mongodb. No terminal setup. Just Savant.',
    abilities: [
      { icon: '🖥️', name: 'Native Desktop App', desc: 'Electron shell with system tray, dock icon, auto-start — runs like any macOS app' },
      { icon: '🗄️', name: 'SQLite Backend', desc: 'All 6 MongoDB collections migrated to a single ~/.savant/savant.db file — zero external deps' },
      { icon: '⚡', name: 'Auto MCP Setup', desc: 'On launch, auto-configures savant-workspace MCP server in Copilot CLI, Cline, and Claude Code' },
      { icon: '📦', name: 'One-Click Install', desc: 'Download .dmg → drag to Applications → done. Flask + SQLite + MCP bundled inside' },
    ],
    items: [
      { type: 'feat', text: 'Electron desktop app — native macOS window, system tray, dock integration' },
      { type: 'feat', text: 'MongoDB → SQLite migration — 6 collections, 12 tables, nested arrays split into proper relations' },
      { type: 'feat', text: 'Migration script — python migrate_mongo_to_sqlite.py with verification and dry-run mode' },
      { type: 'feat', text: 'Native path detection — auto-switches between Docker container paths and macOS native paths' },
      { type: 'feat', text: 'MCP auto-configuration on every launch for Copilot CLI, Cline, and Claude Code' },
      { type: 'feat', text: 'Loading splash screen while Flask boots inside the Electron shell' },
      { type: 'feat', text: 'Dynamic task_stats — computed from live data instead of stale cached counters' },
      { type: 'refactor', text: 'pymongo removed from requirements — sqlite3 is Python stdlib, zero pip deps for DB' },
      { type: 'refactor', text: 'All 6 DB modules rewritten: workspaces, tasks, notes, merge_requests, jira_tickets, notifications' },
      { type: 'refactor', text: 'Task dependencies moved from embedded arrays to task_deps junction table' },
      { type: 'refactor', text: 'MR/Jira notes moved from embedded arrays to mr_notes/jira_notes tables' },
      { type: 'style', text: 'Compact session info card — tighter padding, smaller fonts, slimmer action buttons' },
      { type: 'style', text: 'Compact MR/Jira tracker tabs — reduced font size and padding' },
      { type: 'fix', text: 'Preferences save — added missing /api/preferences GET and POST routes' },
      { type: 'fix', text: 'GPU sandbox crash on ad-hoc signed macOS apps — added no-sandbox flags' },
    ]
  },
  {
    version: 'v2.4',
    date: '2026-03-16',
    tag: '',
    tagline: 'Serious business. Corporate theme for FinTech.',
    description: 'SAVANT v2.4.0 introduces a dual-theme system. The new Corporate theme is now the default — muted colors, clean lines, no animations, no GIFs. Built for professional environments where the dashboard needs to look like it belongs on a trading floor, not a LAN party. StarCraft theme is fully preserved and selectable via Preferences.',
    abilities: [],
    items: [
      { type: 'feat', text: 'Corporate theme — muted blue-grey palette, Inter font, no starfield, scanlines, or glow effects' },
      { type: 'feat', text: 'Theme switcher in Preferences modal — toggle between Corporate and StarCraft' },
      { type: 'feat', text: 'Theme persisted in backend preferences.json and applied on page load' },
      { type: 'feat', text: 'Corporate loading screen — clean CSS spinner, no GIF animations' },
      { type: 'feat', text: 'Both index and detail pages support theme switching' },
      { type: 'style', text: 'Corporate cards — no colored borders, top bars, priority pulses, or glow on hover' },
      { type: 'style', text: 'Corporate stat cards — neutral text color, no colored top gradients' },
      { type: 'style', text: 'Corporate workspace cards — flat borders, no rainbow top stripe or left priority bar' },
      { type: 'style', text: 'Desaturated logo in Corporate mode via grayscale filter' },
      { type: 'fix', text: 'StarCraft theme fully preserved — all neon, glow, and animation effects untouched' },
    ]
  },
  {
    version: 'v2.3.0',
    date: '2026-03-14',
    tag: 'major',
    tagline: 'Tasks evolved — dependencies, graphs, and a redesigned editor.',
    description: 'SAVANT v2.3.0 overhauls the task system with a full dependency graph, workspace-scoped task linking, and a redesigned edit modal. Move tasks between open days, visualize dependency chains as interactive SVG graphs, and manage everything from a cleaner, more compact UI.',
    abilities: [
      { icon: '🔗', name: 'add_task_dependency', desc: 'Link a task to its dependencies — workspace-scoped with cycle detection' },
      { icon: '✂️', name: 'remove_task_dependency', desc: 'Remove a dependency link between tasks' },
    ],
    items: [
      { type: 'feat', text: 'Task dependency system — add/remove deps via API and MCP with cycle detection' },
      { type: 'feat', text: 'Interactive dependency graph — SVG visualization with topological layering inside workspace tasks view' },
      { type: 'feat', text: 'Graph tooltips — hover nodes for task metadata, click to open edit modal' },
      { type: 'feat', text: 'List ↔ Graph toggle — flip between task list and dependency graph in workspace view' },
      { type: 'feat', text: 'Move task to open days — [◀] Day [▶] buttons move tasks to previous/next working day' },
      { type: 'feat', text: 'Task modal now 90% screen — full viewport for reading long descriptions' },
      { type: 'feat', text: 'Notification bell — last 10 notifications in a modal overlay' },
      { type: 'feat', text: 'Redesigned task edit layout — priority/status/workspace on one row, autocomplete deps' },
      { type: 'fix', text: 'Header rebalanced — 2 icons | tabs | 2 icons for even spacing' },
      { type: 'fix', text: 'Dependencies enforce same-workspace constraint' },
      { type: 'fix', text: 'Critical priority option was missing from dropdown' },
    ]
  },
  {
    version: 'v2.2.0',
    date: '2026-03-14',
    tag: 'major',
    tagline: 'Merge requests are no longer second-class citizens.',
    description: 'SAVANT v2.2.0 introduces Merge Requests as first-class entities with a central registry, 8 MCP tools, and an upgraded Bridge Prompt. No more duplicated MRs across sessions — one canonical entry per MR, linked to sessions with roles. Bridge sessions now auto-setup and treat the Knowledge Graph as a living, mandatory artifact.',
    abilities: [
      { icon: '🔀', name: 'create_merge_request', desc: 'Register an MR in the central registry — auto-dedup by URL' },
      { icon: '✏️', name: 'update_merge_request', desc: 'Update status, title, JIRA, priority on any MR' },
      { icon: '📋', name: 'list_merge_requests', desc: 'Filter MRs by workspace or status (open/closed)' },
      { icon: '🔍', name: 'get_merge_request', desc: 'Full details — notes, linked sessions, role assignments' },
      { icon: '🔗', name: 'assign_mr_to_session', desc: 'Link session to MR with auto-detected author/reviewer role' },
      { icon: '✂️', name: 'unassign_mr_from_session', desc: 'Remove a session-to-MR link' },
      { icon: '💬', name: 'add_mr_note', desc: 'Comment on an MR — attributed to the current session' },
      { icon: '📝', name: 'list_mr_notes', desc: 'Get all comments/notes for a merge request' },
    ],
    items: [
      { type: 'feat', text: 'MR central registry — merge_requests.json replaces duplicated per-session MR data' },
      { type: 'feat', text: 'Migration engine — 23 duplicated entries → 13 canonical MRs, zero data loss' },
      { type: 'feat', text: '8 MCP tools — full MR lifecycle from the terminal (create, update, assign, notes)' },
      { type: 'feat', text: '9 Flask API endpoints — CRUD, assign/unassign, notes, migration, all-MRs aggregation' },
      { type: 'feat', text: 'Auto-role detection — assigns author or reviewer based on MR author vs current user' },
      { type: 'feat', text: 'All-MRs modal with OPEN/CLOSED toggle — registry-backed, no more stale data' },
      { type: 'feat', text: 'Session MR enrichment — mr_id references resolve to full MR data everywhere' },
      { type: 'feat', text: 'Bridge Prompt auto-setup — sessions auto-assign to workspace and add bridge note' },
      { type: 'feat', text: 'Knowledge Graph as first-class entity — mandatory before any bridge session work' },
      { type: 'feat', text: 'Knowledge Graph referencing — consult before every task, update after every change' },
      { type: 'fix', text: 'All-MRs endpoint now seeds from registry instead of stale bg cache' },
      { type: 'fix', text: 'Workspace enrichment resolves mr_id via registry lookup' },
      { type: 'fix', text: 'Session detail GET/POST/DELETE endpoints handle new mr_id format' },
    ]
  },
  {
    version: 'v2.1.0',
    date: '2026-03-14',
    tag: '',
    items: [
      { type: 'feat', text: 'Real-time toast notifications — MCP actions now show cyberpunk toasts in the dashboard' },
      { type: 'feat', text: 'Auto-refresh views when MCP creates workspaces, assigns sessions, adds tasks or notes' },
      { type: 'feat', text: 'create_workspace, assign_session_to_workspace, close_workspace MCP tools' },
      { type: 'feat', text: 'delete_session_note MCP tool — delete notes from terminal' },
      { type: 'feat', text: 'File download button in session file viewer' },
      { type: 'feat', text: 'Workspace notes — identical rendering to session detail, collapsible by session' },
      { type: 'fix', text: 'assign_session_to_workspace uses correct POST method' },
      { type: 'docs', text: 'Enriched MCP tool descriptions for AI discoverability' },
    ]
  },
  {
    version: 'v2.0.1',
    date: '2026-03-13',
    tag: '',
    items: [
      { type: 'feat', text: 'Session notes via MCP — list_session_notes and create_session_note tools added to savant-workspace' },
      { type: 'feat', text: 'AI agents can read and write session notes without leaving the terminal' },
      { type: 'feat', text: 'Auto-detects current session — no need to pass session_id' },
      { type: 'feat', text: 'Bridge Prompt renamed from Context Prompt — clearer intent' },
      { type: 'fix', text: 'Bridge Prompt now excludes archived sessions' },
      { type: 'fix', text: 'Kanban columns equal width — no more first-column blowout' },
      { type: 'fix', text: 'Task board stat cards equal width (6-column grid)' },
    ]
  },
  {
    version: 'v2.0',
    date: '2026-03-13',
    tag: 'major',
    tagline: 'Your AI agents now know where they are.',
    description: 'SAVANT v2.0 introduces the Workspace MCP — a bridge that lets AI sessions auto-detect their workspace, pick up tasks, and report back. No copy-paste, no manual context. Just assign a workspace and go.',
    abilities: [
      { icon: '🧭', name: 'get_current_workspace', desc: 'Auto-detect which workspace this session belongs to' },
      { icon: '📋', name: 'list_tasks', desc: 'Get tasks for any workspace — defaults to yours' },
      { icon: '➕', name: 'create_task', desc: 'Create & assign tasks from the terminal' },
      { icon: '✅', name: 'complete_task', desc: 'Mark tasks done — syncs to dashboard instantly' },
      { icon: '🎯', name: 'get_next_task', desc: 'AI picks the highest-priority actionable task' },
      { icon: '🔄', name: 'update_task', desc: 'Update status, priority, description on any task' },
      { icon: '🗂', name: 'list_workspaces', desc: 'Browse all workspaces with live task stats' },
      { icon: '🔍', name: 'get_workspace', desc: 'Look up workspace by ID or fuzzy name match' },
    ],
    items: [
      { type: 'feat', text: 'savant-workspace MCP server — 8 tools bridging AI agents to the dashboard' },
      { type: 'feat', text: 'Auto-detect workspace from Copilot CLI session via PPID → lock file → meta chain' },
      { type: 'feat', text: 'Tasks created by AI agents appear in dashboard in real-time' },
      { type: 'feat', text: 'AI can query, create, update, and complete tasks without leaving the terminal' },
      { type: 'feat', text: 'Workspace defaults — omit workspace_id and the MCP uses your current workspace' },
      { type: 'feat', text: 'Fallback chain: PPID → grandparent PID → SAVANT_WORKSPACE_ID env var' },
      { type: 'feat', text: 'Zero Docker changes — MCP calls Flask API over HTTP at localhost:8090' },
      { type: 'feat', text: 'Major release hero modal — visual showcase for milestone versions' },
    ]
  },
  {
    version: 'v1.21.0',
    date: '2026-03-11',
    tag: null,
    items: [
      { type: 'feat', text: 'Session rename now syncs to agent — renaming in SAVANT updates Copilot workspace.yaml, Cline taskHistory.json, and Claude sessions-index.json' },
      { type: 'feat', text: 'Vice versa: if the agent changes its session name, SAVANT picks it up on next refresh' },
      { type: 'feat', text: 'Workspace cards can now be dragged and dropped to reorder — order persists across sessions' },
      { type: 'feat', text: 'Task cards can be dragged within and across kanban columns to reorder — order persists' },
    ]
  },
  {
    version: 'v1.20.0',
    date: '2026-03-10',
    tag: null,
    items: [
      { type: 'feat', text: 'Archived sessions now visible with dull styling (40% opacity, dashed border) and sorted to end of list' },
      { type: 'feat', text: 'Workspace cards show session status breakdown (RUNNING, IDLE, ACTIVE, etc.) with color-coded chips' },
      { type: 'fix', text: 'Tab navigation always works — clicking Workspaces/Tasks/Sessions switches tab from any nested view' },
    ]
  },
  {
    version: 'v1.19.0',
    date: '2026-03-10',
    tag: null,
    items: [
      { type: 'feat', text: 'All Merge Requests modal — 🔀 button in header shows every MR across all sessions and providers' },
      { type: 'feat', text: 'MR cards show status badge, URL, JIRA ticket, and clickable session chips' },
      { type: 'feat', text: 'Click any session chip to navigate directly to that session' },
      { type: 'feat', text: 'MRs grouped by project (extracted from GitLab/GitHub URL) with collapsible sections' },
      { type: 'feat', text: 'Merged and closed MRs excluded — only active MRs shown' },
    ]
  },
  {
    version: 'v1.18.0',
    date: '2026-03-10',
    tag: null,
    items: [
      { type: 'feat', text: 'Workspace search results are now fully clickable — sessions, notes, and tasks navigate to their pages' },
      { type: 'fix', text: 'Fixed navigateToSession shadowing bug that broke session/note navigation from search' },
      { type: 'feat', text: 'Task search results open the task editor modal directly' },
      { type: 'feat', text: 'Search overlay auto-closes before navigating to result' },
    ]
  },
  {
    version: 'v1.17.0',
    date: '2026-03-10',
    tag: null,
    items: [
      { type: 'feat', text: 'Loading screen GIFs on every page transition — random image, 0.5-2s display' },
      { type: 'feat', text: 'GIF fade-out effect: solid first half, image fades out second half with solid backdrop' },
      { type: 'feat', text: 'Hard refresh / page navigation auto-shows loading via DOMContentLoaded' },
      { type: 'feat', text: 'ESC key closes any open modal globally (all overlays on both pages)' },
      { type: 'style', text: '6 randomized loading GIFs with rotating phrases (THINKING, PROCESSING, etc.)' },
    ]
  },
  {
    version: 'v1.16.0',
    date: '2026-03-10',
    tag: null,
    items: [
      { type: 'feat', text: 'Rebranded to SAVANT — new name, new identity' },
      { type: 'feat', text: 'Custom AI brain SVG logo with cyan-to-purple gradient and circuit nodes' },
      { type: 'feat', text: 'Header title stays consistent across all tabs and modes' },
      { type: 'style', text: 'Page title, detail page, all references updated to SAVANT' },
    ]
  },
  {
    version: 'v1.15.0',
    date: '2026-03-10',
    tag: null,
    items: [
      { type: 'feat', text: 'Preferences modal (⚙️ button in tab bar) — set name and work week' },
      { type: 'feat', text: 'Work week checkboxes (Mon-Sun, default Mon-Fri) control task rollover' },
      { type: 'feat', text: 'Auto-close past work days on task fetch — no background jobs needed' },
      { type: 'feat', text: 'End Day skips non-work days (e.g. Fri → Mon for Mon-Fri work week)' },
      { type: 'feat', text: 'Auto-close uses browser local date — today stays open until midnight' },
      { type: 'fix', text: 'End Day no longer prompts — just does it' },
      { type: 'fix', text: 'MR add button always visible in card title bar' },
      { type: 'fix', text: 'Workspace sessions sort crash (mixed datetime/string types)' },
    ]
  },
  {
    version: 'v1.13.0',
    date: '2026-03-08',
    tag: null,
    items: [
      { type: 'feat', text: 'Multi-MR support for Cline tasks (/api/cline/task/<id>/mr)' },
      { type: 'feat', text: 'Multi-MR support for Claude sessions (/api/claude/session/<id>/mr)' },
      { type: 'fix', text: 'detail.html MR functions use apiBase() — MRs work for all providers' },
      { type: 'feat', text: 'Full MR parity across copilot, cline, and claude sessions' },
    ]
  },
  {
    version: 'v1.12.0',
    date: '2026-03-08',
    tag: null,
    items: [
      { type: 'feat', text: '/ shortcut focuses workspace search bar (same as session search)' },
      { type: 'feat', text: 'Instant title filter on type, deep search popup on Enter' },
      { type: 'feat', text: 'Deep search across workspaces, sessions, notes, tasks with highlighting' },
      { type: 'feat', text: 'Workspace cards show file count, note count, all task states' },
      { type: 'feat', text: 'Backend: GET /api/workspaces/search endpoint' },
    ]
  },
  {
    version: 'v1.11.0',
    date: '2026-03-08',
    tag: null,
    items: [
      { type: 'feat', text: 'Workspace metadata: start_date, priority, status (open/closed)' },
      { type: 'feat', text: 'Cards show status, priority, elapsed time, files, notes, task states' },
      { type: 'feat', text: 'Notes tab aggregates all session notes grouped by session' },
      { type: 'feat', text: 'Workspace index filters: search, status toggle (default open), priority' },
      { type: 'feat', text: 'Close/reopen workspaces from card and detail view' },
      { type: 'feat', text: 'Sort by open→closed, then priority, then start date' },
    ]
  },
  {
    version: 'v1.8.0',
    date: '2026-03-07',
    tag: null,
    items: [
      { type: 'feat', text: 'Session Files tab in workspace — browse plan.md, files/, research/ with file viewer modal' },
      { type: 'feat', text: 'Priority filter on task board — filter by High / Medium / Low' },
      { type: 'feat', text: 'RAG days-in-progress — green (1-2), amber (3-6), red (7+), weekdays only' },
      { type: 'feat', text: 'Task copy — duplicate tasks with link to original, editable before save' },
      { type: 'feat', text: 'MR status sync — updating an MR status propagates to all sessions sharing that MR' },
      { type: 'feat', text: 'Search shows human-readable nicknames with original name as fallback' },
      { type: 'fix', text: 'Workspace task creation uses today\'s date, auto-advances past ended days' },
      { type: 'fix', text: 'Task save now checks response status — errors shown instead of silent failure' },
      { type: 'fix', text: 'Cline/Claude workspace assignment uses correct API endpoint' },
      { type: 'fix', text: 'Project filter populated from workspace sessions' },
    ]
  },
  {
    version: 'v1.7.0',
    date: '2026-03-06',
    tag: null,
    items: [
      { type: 'feat', text: 'Task time tracking — started_at, completed_at, days-in-progress chips on cards' },
      { type: 'feat', text: 'End-day locking — freeze completed days, reopen with confirmation' },
      { type: 'feat', text: 'Task filters — search, workspace, project, and status dropdowns' },
      { type: 'feat', text: 'Browser-local dates — all task dates use local timezone, not UTC' },
      { type: 'feat', text: 'Task history log — separate task-history.json tracks all status changes' },
      { type: 'feat', text: 'Time info in edit modal — started, completed, duration at a glance' },
      { type: 'feat', text: 'Session detail page — conversation viewer, replay timeline, cross-session search' },
    ]
  },
  {
    version: 'v1.6.0',
    date: '2026-03-06',
    tag: null,
    items: [
      { type: 'feat', text: 'Workspace index dashboard with aggregate stats (sessions, tasks, completion %)' },
      { type: 'feat', text: 'Inline task management inside workspace detail — create, edit, quick-status' },
      { type: 'refactor', text: 'Tasks link to workspaces only (session linking removed)' },
      { type: 'feat', text: 'Contextual subtitles & tooltips per tab (Sessions / Tasks / Workspaces)' },
      { type: 'fix', text: 'Removed duplicate keyboard shortcut button from task toolbar' },
      { type: 'feat', text: 'Release notes viewer (you\'re looking at it!)' },
    ]
  },
  {
    version: 'v1.5.0',
    date: '2026-03-05',
    tag: null,
    items: [
      { type: 'feat', text: 'Workspace FILES tab — all session files grouped by session, with action badges' },
      { type: 'feat', text: 'Task board vim-style keyboard shortcuts (N/J/K/H/L/D/X/E/Enter/Esc)' },
      { type: 'style', text: 'Tier-1 workspace cards — gradient backgrounds, rainbow top border, glow effects' },
      { type: 'feat', text: 'Session cards inside workspace use full buildCardHtml with provider badge' },
    ]
  },
  {
    version: 'v1.4.0',
    date: '2026-03-04',
    tag: null,
    items: [
      { type: 'feat', text: 'Tab restructure — WORKSPACES | TASKS | SESSIONS with provider sub-tabs' },
      { type: 'feat', text: 'Workspace detail stats: session count, task progress, completion %, last activity' },
      { type: 'feat', text: 'Task board with kanban columns, drag-drop, end-day rollover, date navigation' },
      { type: 'feat', text: 'Bridge prompt generator for workspaces — AI-ready session summaries' },
      { type: 'feat', text: 'Workspaces feature — cross-provider session grouping with CRUD & typeahead' },
    ]
  }
];

function toggleReleaseNotes() {
  const modal = document.getElementById('release-modal');
  if (modal.style.display === 'flex') {
    modal.style.display = 'none';
    return;
  }
  const body = document.getElementById('release-notes-body');
  body.innerHTML = RELEASES.map(r => {
    const isMajor = r.tag === 'major' || r.tag === 'new';
    const tagLabel = r.tag === 'new' ? '🆕 NEW — CLICK TO EXPLORE' : '✨ MAJOR — CLICK TO EXPLORE';
    const tagHtml = isMajor
      ? '<span class="release-tag" style="background:linear-gradient(135deg,rgba(0,240,255,0.15),rgba(168,85,247,0.15));border-color:rgba(168,85,247,0.4);color:#a855f7;font-weight:700;cursor:pointer;" onclick="event.stopPropagation();showHeroRelease(\'' + r.version + '\')">' + tagLabel + '</span>'
      : (r.tag === 'latest' ? '<span class="release-tag latest">LATEST</span>' : '<span class="release-tag">STABLE</span>');
    return `
    <div class="release-block" ${isMajor ? 'style="border-color:rgba(168,85,247,0.3);background:linear-gradient(145deg,rgba(10,15,25,0.6),rgba(25,10,40,0.4));cursor:pointer;" onclick="showHeroRelease(\'' + r.version + '\')"' : ''}>
      <div class="release-version">
        ${r.version}
        ${tagHtml}
      </div>
      <div class="release-date">${r.date}</div>
      ${isMajor && r.description ? '<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text);opacity:0.8;margin-bottom:8px;line-height:1.4;">' + escapeHtml(r.description) + '</div>' : ''}
      <ul class="release-items">
        ${r.items.map(it => `<li><span class="release-badge ${it.type}">${it.type.toUpperCase()}</span>${escapeHtml(it.text)}</li>`).join('')}
      </ul>
    </div>
  `}).join('');
  modal.style.display = 'flex';
}

function toggleTutorial() {
  const modal = document.getElementById('tutorial-modal');
  modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
}

function switchTutorialTab(tabName) {
  const container = document.querySelector('.tutorial-body');
  container.querySelectorAll('.savant-subtab').forEach(t => t.classList.remove('active'));
  container.querySelectorAll('.tutorial-tab-panel').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('tutorial-panel-' + tabName).classList.add('active');
}

async function testMcpConnection(name, port, btn) {
  const statusEl = document.getElementById('mcp-test-' + name);
  btn.disabled = true;
  statusEl.className = 'mcp-test-status loading';
  statusEl.textContent = '● Testing...';
  try {
    const res = await fetch('/api/mcp/health/' + name, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.status === 'ok') {
      statusEl.className = 'mcp-test-status ok';
      statusEl.textContent = '● Connected — port ' + port + ' responding';
    } else {
      statusEl.className = 'mcp-test-status fail';
      statusEl.textContent = '● Offline — ' + (data.error || 'not responding on port ' + port);
    }
  } catch (e) {
    statusEl.className = 'mcp-test-status fail';
    statusEl.textContent = '● Error — could not reach health endpoint';
  }
  btn.disabled = false;
}

async function restartMcpServer(name, port, btn) {
  if (!window.electronAPI || !window.electronAPI.restartMcp) {
    alert('Restart only available in desktop app');
    return;
  }
  const statusEl = document.getElementById('mcp-test-' + name);
  btn.disabled = true;
  statusEl.className = 'mcp-test-status loading';
  statusEl.textContent = '● Restarting...';
  try {
    await window.electronAPI.restartMcp(name);
    // Wait a bit for server to come up
    setTimeout(() => {
      testMcpConnection(name, port, btn);
    }, 1500);
  } catch (e) {
    statusEl.className = 'mcp-test-status fail';
    statusEl.textContent = '● Restart failed: ' + e.message;
    btn.disabled = false;
  }
}

// ── Major Release Hero Modal ──

function showHeroRelease(version) {
  const release = RELEASES.find(r => r.version === version && (r.description || r.tagline));
  if (!release) return;

  // Close the regular release notes modal if open
  document.getElementById('release-modal').style.display = 'none';

  const hero = document.getElementById('release-hero-modal');
  document.getElementById('hero-version').textContent = release.version;
  document.getElementById('hero-label').textContent = release.tag === 'new' ? 'NEW RELEASE' : 'MAJOR RELEASE';
  document.getElementById('hero-tagline').textContent = release.tagline || '';

  let bodyHtml = '';

  // Description
  if (release.description) {
    bodyHtml += `<div class="release-hero-section">
      <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text);line-height:1.6;opacity:0.9;">
        ${escapeHtml(release.description)}
      </div>
    </div>`;
  }

  // Abilities grid
  if (release.abilities && release.abilities.length) {
    bodyHtml += `<div class="release-hero-section">
      <div class="release-hero-section-title">NEW ABILITIES</div>
      <div class="release-hero-abilities">
        ${release.abilities.map(a => `
          <div class="release-hero-ability">
            <div class="release-hero-ability-icon">${a.icon}</div>
            <div class="release-hero-ability-name">${escapeHtml(a.name)}</div>
            <div class="release-hero-ability-desc">${escapeHtml(a.desc)}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  // Changelog
  if (release.items && release.items.length) {
    bodyHtml += `<div class="release-hero-section">
      <div class="release-hero-section-title">CHANGELOG</div>
      <ul class="release-hero-changelog">
        ${release.items.map(it => `<li><span class="release-badge ${it.type}">${it.type.toUpperCase()}</span>${escapeHtml(it.text)}</li>`).join('')}
      </ul>
    </div>`;
  }

  document.getElementById('hero-body').innerHTML = bodyHtml;
  hero.style.display = 'flex';
}

function dismissHeroRelease() {
  const hero = document.getElementById('release-hero-modal');
  hero.style.display = 'none';
  // Mark as seen in localStorage
  const latest = RELEASES.find(r => r.tag === 'major' || r.tag === 'new');
  if (latest) {
    localStorage.setItem('savant_seen_release', latest.version);
  }
}

// Auto-show hero for new major releases on first visit
(function autoShowHero() {
  const latest = RELEASES.find(r => (r.tag === 'major' || r.tag === 'new') && (r.description || r.tagline));
  if (!latest) return;
  const seen = localStorage.getItem('savant_seen_release');
  if (seen !== latest.version) {
    // Delay slightly to let the page render first
    setTimeout(() => showHeroRelease(latest.version), 800);
  }
})();

function getApiPrefix() {
  if (currentMode === 'claude') return '/api/claude';
  if (currentMode === 'codex') return '/api/codex';
  if (currentMode === 'gemini') return '/api/gemini';
  return '/api';
}
function getSessionsEndpoint() {
  if (currentMode === 'claude') return '/api/claude/sessions';
  if (currentMode === 'codex') return '/api/codex/sessions';
  if (currentMode === 'gemini') return '/api/gemini/sessions';
  return '/api/sessions';
}
function getSessionDetailEndpoint(id) {
  if (currentMode === 'claude') return `/api/claude/session/${id}`;
  if (currentMode === 'codex') return `/api/codex/session/${id}`;
  if (currentMode === 'gemini') return `/api/gemini/session/${id}`;
  return `/api/session/${id}`;
}
function getConversationEndpoint(id) {
  if (currentMode === 'claude') return `/api/claude/session/${id}/conversation`;
  if (currentMode === 'codex') return `/api/codex/session/${id}/conversation`;
  if (currentMode === 'gemini') return `/api/gemini/session/${id}/conversation`;
  return `/api/session/${id}/conversation`;
}
function getSearchEndpoint() {
  if (currentMode === 'claude') return '/api/claude/search';
  if (currentMode === 'codex') return '/api/codex/search';
  if (currentMode === 'gemini') return '/api/gemini/search';
  return '/api/search';
}
function getUsageEndpoint() {
  if (currentMode === 'claude') return '/api/claude/usage';
  if (currentMode === 'codex') return '/api/codex/usage';
  if (currentMode === 'gemini') return '/api/gemini/usage';
  return '/api/usage';
}
function getBulkDeleteEndpoint() {
  if (currentMode === 'claude') return '/api/claude/sessions/bulk-delete';
  if (currentMode === 'codex') return '/api/codex/sessions/bulk-delete';
  if (currentMode === 'gemini') return '/api/gemini/sessions/bulk-delete';
  return '/api/sessions/bulk-delete';
}
function getDeleteEndpoint(id) {
  if (currentMode === 'claude') return `/api/claude/session/${id}`;
  if (currentMode === 'codex') return `/api/codex/session/${id}`;
  if (currentMode === 'gemini') return `/api/gemini/session/${id}`;
  return `/api/session/${id}`;
}
function getRenameEndpoint(id) {
  if (currentMode === 'claude') return `/api/claude/session/${id}/rename`;
  if (currentMode === 'codex') return `/api/codex/session/${id}/rename`;
  if (currentMode === 'gemini') return `/api/gemini/session/${id}/rename`;
  return `/api/session/${id}/rename`;
}
function getStarEndpoint(id) {
  if (currentMode === 'claude') return `/api/claude/session/${id}/star`;
  if (currentMode === 'codex') return `/api/codex/session/${id}/star`;
  if (currentMode === 'gemini') return `/api/gemini/session/${id}/star`;
  return `/api/session/${id}/star`;
}
function getArchiveEndpoint(id) {
  if (currentMode === 'claude') return `/api/claude/session/${id}/archive`;
  if (currentMode === 'codex') return `/api/codex/session/${id}/archive`;
  if (currentMode === 'gemini') return `/api/gemini/session/${id}/archive`;
  return `/api/session/${id}/archive`;
}
function getDetailPageUrl(id) {
  if (currentMode === 'claude') return `/claude/session/${id}`;
  if (currentMode === 'codex') return `/codex/session/${id}`;
  if (currentMode === 'gemini') return `/gemini/session/${id}`;
  return `/session/${id}`;
}
function getProjectFilesEndpoint(id) {
  if (currentMode === 'claude') return `/api/claude/session/${id}/project-files`;
  if (currentMode === 'codex') return `/api/codex/session/${id}/project-files`;
  if (currentMode === 'gemini') return `/api/gemini/session/${id}/project-files`;
  return `/api/session/${id}/project-files`;
}
function getGitChangesEndpoint(id) {
  if (currentMode === 'claude') return `/api/claude/session/${id}/git-changes`;
  if (currentMode === 'codex') return `/api/codex/session/${id}/git-changes`;
  if (currentMode === 'gemini') return `/api/gemini/session/${id}/git-changes`;
  return `/api/session/${id}/git-changes`;
}
function getFileEndpoint(id) {
  if (currentMode === 'claude') return `/api/claude/session/${id}/file`;
  if (currentMode === 'codex') return `/api/codex/session/${id}/file`;
  if (currentMode === 'gemini') return `/api/gemini/session/${id}/file`;
  return `/api/session/${id}/file`;
}

// ── Workspace-aware endpoint resolution ─────────────────────
function _resolveProvider(sessionId) {
  if (_currentWsId && _wsDetailSessions.length) {
    const s = _wsDetailSessions.find(s => s.id === sessionId);
    if (s && s.provider) return s.provider;
  }
  if (['copilot','claude','codex','gemini'].includes(currentMode)) return currentMode;
  return 'copilot';
}
function _endpointFor(provider, id, action) {
  if (provider === 'claude') return `/api/claude/session/${id}/${action}`;
  if (provider === 'codex') return `/api/codex/session/${id}/${action}`;
  if (provider === 'gemini') return `/api/gemini/session/${id}/${action}`;
  return `/api/session/${id}/${action}`;
}
function _deleteEndpointFor(provider, id) {
  if (provider === 'claude') return `/api/claude/session/${id}`;
  if (provider === 'codex') return `/api/codex/session/${id}`;
  if (provider === 'gemini') return `/api/gemini/session/${id}`;
  return `/api/session/${id}`;
}

function _renderWsStats(ws, wsTasks, statsEl) {
  const sessions = _wsDetailSessions;
  const c = ws.counts || {};
  const totalSessions = sessions.length;

  // Session status counts
  const archivedCount = sessions.filter(s => s.archived).length;
  const activeCount = totalSessions - archivedCount;

  // Provider counts
  const copilotCount = sessions.filter(s => s.provider === 'copilot').length;
  const claudeCount = sessions.filter(s => s.provider === 'claude').length;
  const codexCount = sessions.filter(s => s.provider === 'codex').length;
  const geminiCount = sessions.filter(s => s.provider === 'gemini').length;

  // Projects
  const projects = [...new Set(sessions.map(s => s.project).filter(Boolean))];

  // File counts
  const totalFiles = sessions.reduce((sum, s) => sum + (s.file_count || 0), 0);
  const totalSessionFiles = sessions.length;

  // Git commit count
  const totalGitCommits = sessions.reduce((sum, s) => sum + (s.git_commit_count || 0), 0);

  // Notes count
  const totalNotes = sessions.reduce((sum, s) => sum + ((s.notes || []).length), 0);

  // MR counts
  const mrUrls = new Set();
  sessions.forEach(s => (s.mrs || []).forEach(mr => { if (mr.url) mrUrls.add(mr.url.toLowerCase().replace(/\/+$/, '')); }));
  const totalMRs = mrUrls.size;

  // Task stats
  const taskDone = wsTasks.filter(t => t.status === 'done').length;
  const taskActive = wsTasks.filter(t => t.status === 'in-progress').length;
  const taskBlocked = wsTasks.filter(t => t.status === 'blocked').length;
  const taskTodo = wsTasks.filter(t => t.status === 'todo').length;
  const totalTasks = wsTasks.length;
  const pct = totalTasks ? Math.round((taskDone / totalTasks) * 100) : 0;

  // Last activity
  const lastActivity = totalSessions ? sessions.reduce((latest, s) => {
    const t = s.updated_at || s.last_event_time || '';
    return t > latest ? t : latest;
  }, '') : null;
  const todayStr = _localDateStr();
  const todayTasks = wsTasks.filter(t => t.date === todayStr);

  // Projects chips
  const projectChips = projects.length
    ? projects.map(p => `<span style="background:rgba(0,240,255,0.08);border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:0.5rem;color:var(--cyan);">📁 ${escapeHtml(p)}</span>`).join(' ')
    : '<span style="color:var(--text-dim);font-size:0.5rem;">—</span>';

  statsEl.innerHTML = `<div class="ws-detail-stats">
    <div class="ws-stat-card">
      <div class="ws-stat-label">Sessions</div>
      <div class="ws-stat-value" style="color:var(--cyan);">${totalSessions}</div>
      <div class="ws-stat-sub">${copilotCount} copilot · ${claudeCount} claude · ${codexCount} codex · ${geminiCount} gemini</div>
      <div class="ws-stat-sub" style="margin-top:3px;">${activeCount} active · ${archivedCount} archived</div>
    </div>
    <div class="ws-stat-card">
      <div class="ws-stat-label">Projects</div>
      <div class="ws-stat-value" style="color:var(--magenta);">${projects.length}</div>
      <div class="ws-stat-sub" style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">${projectChips}</div>
    </div>
    <div class="ws-stat-card">
      <div class="ws-stat-label">Assets</div>
      <div class="ws-stat-value" style="color:var(--orange);">${totalFiles + totalSessionFiles + totalGitCommits + totalNotes}</div>
      <div class="ws-stat-sub">📄 ${totalFiles} files · 📂 ${totalSessionFiles} session files</div>
      <div class="ws-stat-sub" style="margin-top:3px;">🔀 ${totalGitCommits} commits · 📝 ${totalNotes} notes</div>
    </div>
    <div class="ws-stat-card">
      <div class="ws-stat-label">Tasks</div>
      <div class="ws-stat-value" style="color:var(--yellow);">${totalTasks}</div>
      <div class="ws-stat-sub">${taskTodo} todo · ${taskActive} active · ${taskBlocked} blocked</div>
    </div>
    <div class="ws-stat-card">
      <div class="ws-stat-label">Completed</div>
      <div class="ws-stat-value" style="color:var(--green);">${pct}%</div>
      <div class="ws-stat-sub">${taskDone} of ${totalTasks} tasks done</div>
      ${totalTasks ? `<div style="margin-top:6px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:var(--green);border-radius:2px;"></div>
      </div>` : ''}
    </div>
    <div class="ws-stat-card">
      <div class="ws-stat-label">Last Activity</div>
      <div class="ws-stat-value" style="font-size:0.7rem;color:var(--text);">${lastActivity ? timeAgo(lastActivity) : '—'}</div>
      <div class="ws-stat-sub">${todayTasks.length} task${todayTasks.length!==1?'s':''} today · ${totalMRs} MR${totalMRs!==1?'s':''}</div>
    </div>
  </div>`;
}

async function _refreshWsDetailSessions() {
  if (!_currentWsId) return;
  try {
    const [sessRes, taskRes] = await Promise.all([
      fetch(`/api/workspaces/${_currentWsId}/sessions?_=${Date.now()}`),
      fetch(`/api/tasks?workspace_id=${_currentWsId}&_=${Date.now()}`)
    ]);
    const sessData = await sessRes.json();
    _wsDetailSessions = sessData.sessions || sessData || [];
    _wsDetailSessions.sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));

    const ws = _workspaces.find(w => w.id === _currentWsId);
    const wsTasks = (await taskRes.json()).map(_normalizeTask);
    const container = document.getElementById('ws-detail-sessions');
    const statsEl = document.getElementById('ws-detail-stats');

    // Re-render stats
    if (ws && statsEl) {
      _renderWsStats(ws, wsTasks, statsEl);
    }

    // Re-render sessions list
    if (container) {
      if (!_wsDetailSessions.length) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;">
          No sessions assigned to this workspace yet.<br>Assign sessions from their detail page.</div>`;
      } else {
        container.innerHTML = _wsDetailSessions.map(s => {
          const provIcon = s.provider === 'copilot' ? '⟐' : s.provider === 'codex' ? '🧠' : s.provider === 'gemini' ? '♊' : '🎭';
          const provBadge = `<span class="provider-badge ${s.provider}">${provIcon} ${s.provider}</span>`;
          const cardHtml = buildCardHtml(s, s.provider);
          return cardHtml.replace(
            /(<span class="status-badge [^"]*">[^<]*<\/span>)/,
            `$1 ${provBadge}`
          );
        }).join('');
      }
    }

    // Refresh tasks sub-tab too
    await _refreshWsTasks(_currentWsId);
  } catch(e) {
    console.error('Failed to refresh workspace detail:', e);
  }
}

function _applyTabUI() {
  // Top-level tabs
  ['workspaces','tasks','abilities','sessions'].forEach(t => {
    const btn = document.getElementById('mode-' + t);
    if (!btn) return;
    btn.classList.toggle('active', currentTab === t);
    btn.classList.remove('ws-active','tasks-active','abilities-active','sessions-active');
  });
  if (currentTab === 'workspaces') document.getElementById('mode-workspaces').classList.add('ws-active');
  if (currentTab === 'tasks') document.getElementById('mode-tasks').classList.add('tasks-active');
  if (currentTab === 'abilities') document.getElementById('mode-abilities').classList.add('abilities-active');
  if (currentTab === 'sessions') document.getElementById('mode-sessions').classList.add('sessions-active');

  // Provider sub-tabs
  const provBar = document.getElementById('provider-subtabs');
  const mcpBar = document.getElementById('mcp-subtabs');
  provBar.style.display = currentTab === 'sessions' ? '' : 'none';
  mcpBar.style.display = currentTab === 'abilities' ? '' : 'none';
  ['copilot','claude','codex','gemini'].forEach(p => {
    const btn = document.getElementById('prov-' + p);
    if (btn) btn.classList.toggle('active', currentMode === p);
  });
  _applyProviderVisibility();

  // Show/hide views
  const wsView = document.getElementById('workspace-view');
  const wsDetailView = document.getElementById('workspace-detail-view');
  const taskView = document.getElementById('task-view');
  const abilitiesView = document.getElementById('abilities-view');
  const sessionsContent = document.querySelectorAll('.usage-panel, .mcp-bar, .analytics-panel, .bulk-bar, .controls-row, #sessions-container, .refresh-indicator');

  wsView.style.display = currentTab === 'workspaces' ? 'block' : 'none';
  wsDetailView.style.display = 'none';
  taskView.style.display = currentTab === 'tasks' ? 'block' : 'none';
  // MCP tab — show the active subtab, not just abilities
  if (currentTab === 'abilities') {
    switchMcpSubTab(_mcpSubTab);
  } else {
    abilitiesView.style.display = 'none';
    document.getElementById('workspace-mcp-view').style.display = 'none';
    document.getElementById('context-view').style.display = 'none';
    document.getElementById('knowledge-view').style.display = 'none';
  }
  sessionsContent.forEach(el => el.style.display = currentTab === 'sessions' ? '' : 'none');

  // Header title — always SAVANT with AI brain icon
  const h = document.getElementById('header-title');
  const rocket = ' <span class="release-icon" onclick="toggleReleaseNotes()" title="Release Notes">🚀</span>';
  const svgIcon = '<svg class="savant-logo" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="brain-grd" x1="0" y1="0" x2="64" y2="64"><stop offset="0%" stop-color="#00f0ff"/><stop offset="100%" stop-color="#a855f7"/></linearGradient></defs><path d="M32 6C20 6 12 14 12 26c0 6 2 10 5 14 2 3 3 6 3 10v2a2 2 0 002 2h20a2 2 0 002-2v-2c0-4 1-7 3-10 3-4 5-8 5-14C52 14 44 6 32 6z" stroke="url(#brain-grd)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 6v48M22 18h20M20 28h24M22 38h20" stroke="url(#brain-grd)" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/><circle cx="32" cy="18" r="2.5" fill="#00f0ff"/><circle cx="26" cy="28" r="2" fill="#a855f7"/><circle cx="38" cy="28" r="2" fill="#a855f7"/><circle cx="32" cy="38" r="2.5" fill="#00f0ff"/><circle cx="22" cy="22" r="1.5" fill="#00f0ff" opacity="0.7"/><circle cx="42" cy="22" r="1.5" fill="#00f0ff" opacity="0.7"/><circle cx="20" cy="33" r="1.5" fill="#a855f7" opacity="0.7"/><circle cx="44" cy="33" r="1.5" fill="#a855f7" opacity="0.7"/><path d="M24 54h16M26 58h12" stroke="url(#brain-grd)" stroke-width="2" stroke-linecap="round"/><circle cx="11" cy="20" r="3" stroke="#00f0ff" stroke-width="1.2" fill="none" opacity="0.4"/><path d="M14 20h6" stroke="#00f0ff" stroke-width="1" opacity="0.4"/><circle cx="53" cy="20" r="3" stroke="#a855f7" stroke-width="1.2" fill="none" opacity="0.4"/><path d="M44 20h6" stroke="#a855f7" stroke-width="1" opacity="0.4"/><circle cx="9" cy="34" r="2.5" stroke="#00f0ff" stroke-width="1.2" fill="none" opacity="0.3"/><path d="M12 34h6" stroke="#00f0ff" stroke-width="1" opacity="0.3"/><circle cx="55" cy="34" r="2.5" stroke="#a855f7" stroke-width="1.2" fill="none" opacity="0.3"/><path d="M46 34h6" stroke="#a855f7" stroke-width="1" opacity="0.3"/></svg>';
  h.innerHTML = svgIcon + ' SAVANT ' + rocket;
  h.style.color = '';
  h.style.textShadow = '';

  // Contextual subtitles
  document.getElementById('subtitle-sessions').style.display = currentTab === 'sessions' ? '' : 'none';
  document.getElementById('subtitle-tasks').style.display = currentTab === 'tasks' ? '' : 'none';
  document.getElementById('subtitle-workspaces').style.display = currentTab === 'workspaces' ? '' : 'none';
  document.getElementById('subtitle-abilities').style.display = currentTab === 'abilities' ? '' : 'none';
}

function switchTab(tab) {
  showLoadingScreen(() => {
    // Always close workspace detail when switching tabs
    if (_currentWsId) {
      _currentWsId = null;
      _wsDetailSessions = [];
      const wsDetailView = document.getElementById('workspace-detail-view');
      const wsListView = document.getElementById('workspace-view');
      if (wsDetailView) wsDetailView.style.display = 'none';
      if (wsListView) wsListView.style.display = 'block';
    }
    // Clear workspace KG HTML to avoid duplicate IDs with main KG
    const wsKg = document.getElementById('ws-detail-knowledge');
    if (wsKg) wsKg.innerHTML = '';
    _kbWsId = null;
    _switchTabInner(tab);
    localStorage.setItem('savant-last-tab', tab);
  });
}
function _switchTabInner(tab) {
  currentTab = tab;
  fetchGeneration++;

  if (tab === 'sessions') {
    // Restore last provider or default to first enabled
    const saved = localStorage.getItem('wf-mode') || 'copilot';
    const ep = (_prefs && _prefs.enabled_providers) ? _prefs.enabled_providers : ['copilot','claude','codex','gemini'];
    if (ep.includes(saved)) {
      currentMode = saved;
    } else {
      currentMode = ep[0] || 'copilot';
    }
  } else {
    // For non-session tabs, store the tab name as mode
    currentMode = tab;
  }
  localStorage.setItem('wf-mode', currentMode);
  _applyTabUI();
  _updateHash();
  if (typeof updateBreadcrumb === 'function') updateBreadcrumb();

  if (tab === 'workspaces') {
    fetchWorkspaces();
  } else if (tab === 'tasks') {
    fetchTasks();
  } else if (tab === 'abilities') {
    fetchAbilities();
  } else {
    _loadSessionProvider();
  }
}

function switchProvider(provider) {
  if (provider === currentMode && currentTab === 'sessions') return;
  
  // Reset filters when changing provider
  currentFilter = 'all';
  currentProject = '';
  timeRange = '';
  searchQuery = '';
  const filterStatus = document.getElementById('filter-status');
  if (filterStatus) filterStatus.value = 'all';
  const filterProj = document.getElementById('filter-project');
  if (filterProj) filterProj.value = '';
  const filterTime = document.getElementById('filter-timerange');
  if (filterTime) filterTime.value = '';
  const filterSearch = document.getElementById('session-search');
  if (filterSearch) filterSearch.value = '';

  showLoadingScreen(() => {
    currentTab = 'sessions';
    currentMode = provider;
    localStorage.setItem('wf-mode', provider);
    fetchGeneration++;
    _applyTabUI();
    _updateHash();
    _loadSessionProvider();
  });
}

function _loadSessionProvider() {
  // Reset usage cache
  usageCache = null;
  document.getElementById('usage-body').innerHTML = '<div style="font-size:0.7rem; color:var(--text-dim);">Loading usage data...</div>';
  const intTitles = { 
    copilot: '🧠 COPILOT USAGE INTELLIGENCE', 
    claude: '🧠 CLAUDE USAGE INTELLIGENCE',
    codex: '🧠 CODEX USAGE INTELLIGENCE',
    gemini: '🧠 GEMINI USAGE INTELLIGENCE'
  };
  document.querySelector('#usage-panel .analytics-toggle-title').textContent = intTitles[currentMode] || intTitles.copilot;
  // Clear grid and show loading spinner
  allSessions = [];
  hasMore = false;
  totalCount = 0;
  const container = document.getElementById('sessions-container');
  if (container) {
    const modeLabel = currentMode === 'claude' ? 'CLAUDE' : currentMode === 'codex' ? 'CODEX' : currentMode === 'gemini' ? 'GEMINI' : 'COPILOT';
    container.innerHTML = `<div class="loading"><div class="loading-spinner"></div><div style="color: var(--text-dim); font-size: 0.8rem;">LOADING ${modeLabel} DATA...</div></div>`;
  }
  const lmBtn = document.getElementById('load-more-btn');
  if (lmBtn) lmBtn.style.display = 'none';
  fetchSessions();
  fetchUsage();
  fetchMcp();
}

// Compat wrapper — internal code that calls switchMode still works
function switchMode(mode) {
  if (['workspaces','tasks'].includes(mode)) {
    switchTab(mode);
  } else {
    switchProvider(mode);
  }
}

function timeAgo(ts) {
  if (!ts) return 'N/A';
  const now = new Date();
  const then = new Date(ts);
  const diff = (now - then) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false
  });
}

function formatDuration(start, end) {
  if (!start || !end) return '';
  const ms = new Date(end) - new Date(start);
  if (ms < 0) return '';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}
