// ── Savant Guide ─────────────────────────────────────────────────────────────
// Full-page guide overlay with tree navigation and search.

// Helper to build a styled flow diagram (horizontal boxes with arrows)
function _gFlow(steps, arrowColor) {
  arrowColor = arrowColor || 'var(--text-dim)';
  return '<div class="guide-flow">' + steps.map((s, i) => {
    const arrow = i < steps.length - 1 ? `<div class="guide-flow-arrow" style="color:${arrowColor}">&#x25B6;</div>` : '';
    return `<div class="guide-flow-step" style="border-color:${s.color || 'var(--border)'};${s.bg ? 'background:' + s.bg + ';' : ''}">
      ${s.icon ? '<div style="font-size:1.2rem;margin-bottom:4px;">' + s.icon + '</div>' : ''}
      <div style="font-weight:600;font-size:0.6rem;color:${s.color || 'var(--text)'};">${s.title}</div>
      ${s.desc ? '<div style="font-size:0.48rem;color:var(--text-dim);margin-top:3px;line-height:1.4;">' + s.desc + '</div>' : ''}
    </div>${arrow}`;
  }).join('') + '</div>';
}

// Helper to build a vertical step list with connectors
function _gSteps(steps) {
  return '<div class="guide-steps">' + steps.map((s, i) => {
    return `<div class="guide-step-row">
      <div class="guide-step-num" style="background:${s.color || 'var(--cyan)'};">${i + 1}</div>
      <div class="guide-step-content">
        <div style="font-weight:600;color:${s.color || 'var(--cyan)'};">${s.title}</div>
        <div style="color:var(--text-dim);font-size:0.5rem;line-height:1.5;margin-top:2px;">${s.desc}</div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

// Helper for a stat card row
function _gStats(stats) {
  return '<div class="guide-stats">' + stats.map(s => {
    return `<div class="guide-stat-card" style="border-color:${s.color || 'var(--border)'};">
      <div style="font-size:1.4rem;">${s.icon}</div>
      <div style="font-size:0.9rem;font-weight:700;color:${s.color || 'var(--cyan)'};">${s.value}</div>
      <div style="font-size:0.45rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;">${s.label}</div>
    </div>`;
  }).join('') + '</div>';
}

const _guideTree = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. WHAT IS SAVANT
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'what-is-savant', title: 'What is Savant?', children: [],
    content: `
      <h2>What is Savant?</h2>
      <p>Savant is a <strong>desktop application for macOS</strong> that monitors, manages, and enhances AI coding sessions. It tracks sessions from <strong>Hermes Agent</strong>, <strong>GitHub Copilot CLI</strong>, <strong>Claude Code</strong>, <strong>Codex</strong>, and <strong>Gemini</strong> — giving your team a unified dashboard to see what AI assistants are doing across all projects.</p>

      ${_gStats([
        { icon: '🤖', value: '5', label: 'AI Tools Supported', color: 'var(--cyan)' },
        { icon: '🧠', value: '4', label: 'MCP Servers', color: 'var(--magenta)' },
        { icon: '📊', value: '4', label: 'Dashboard Tabs', color: 'var(--orange)' },
        { icon: '⚡', value: 'Real-time', label: 'Session Monitoring', color: 'var(--green)' },
      ])}

      <h3>The Problem</h3>
      <p>When developers use AI coding assistants, sessions are scattered across tools and directories. There is no single place to see:</p>
      <ul>
        <li>Which AI sessions are running right now?</li>
        <li>What did that Claude session do 3 hours ago?</li>
        <li>How do I resume the Copilot session that was working on the auth feature?</li>
        <li>What files were changed across all sessions for this ticket?</li>
      </ul>

      <h3>The Solution</h3>
      ${_gFlow([
        { icon: '🔍', title: 'Detect', desc: 'Auto-discovers session files from Copilot, Claude, Codex, and Gemini', color: 'var(--cyan)' },
        { icon: '📊', title: 'Dashboard', desc: 'Real-time cards with status, models, activity', color: 'var(--green)' },
        { icon: '📁', title: 'Organize', desc: 'Group into workspaces, link tasks & Jira', color: 'var(--magenta)' },
        { icon: '🧠', title: 'Knowledge', desc: 'Build a graph of your engineering domain', color: 'var(--orange)' },
      ])}

      <h3>Key Capabilities</h3>
      <table class="guide-table">
        <tr><th>Capability</th><th>What it does</th></tr>
        <tr><td style="color:var(--cyan);">Session Monitoring</td><td>Live status tracking (running, active, idle, stuck) with auto-refresh every 30 seconds</td></tr>
        <tr><td style="color:var(--green);">Workspaces</td><td>Group sessions across providers into project-scoped containers with tasks, MRs, Jira tickets</td></tr>
        <tr><td style="color:var(--yellow);">Task Board</td><td>Kanban board with vim-style keyboard nav, daily planning, and workspace linking</td></tr>
        <tr><td style="color:var(--magenta);">MCP Integration</td><td>4 servers that let AI tools programmatically create workspaces, tasks, search code, and build knowledge</td></tr>
        <tr><td style="color:var(--orange);">Knowledge Graph</td><td>D3-powered force graph mapping clients, domains, services, technologies, and developer insights</td></tr>
        <tr><td style="color:var(--cyan);">Semantic Search</td><td>sqlite-vec powered vector search across indexed repositories</td></tr>
        <tr><td style="color:var(--green);">Terminal</td><td>Built-in xterm.js terminal with nested splits, tabs, and session resume</td></tr>
      </table>
    `
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. HOW TO USE SAVANT
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'how-to-use', title: 'How to Use Savant', children: [
      { id: 'use-layout', title: 'App Layout', children: [] },
      { id: 'use-sessions', title: 'Monitoring Sessions', children: [] },
      { id: 'use-workspaces', title: 'Using Workspaces', children: [] },
      { id: 'use-tasks', title: 'Managing Tasks', children: [] },
      { id: 'use-terminal', title: 'Terminal', children: [] },
      { id: 'use-mcp', title: 'MCP Tab', children: [] },
      { id: 'use-search', title: 'Search & Navigation', children: [] },
    ],
    content: `
      <h2>How to Use Savant</h2>
      <p>This section walks you through every part of the Savant interface. Start AI coding sessions as you normally would — Savant auto-discovers them.</p>

      ${_gFlow([
        { icon: '1', title: 'Launch Savant', desc: 'Open from /Applications or npm run dev', color: 'var(--cyan)', bg: 'rgba(0,240,255,0.05)' },
        { icon: '2', title: 'Start AI Sessions', desc: 'Use Copilot, Claude Code, Codex, or Gemini normally', color: 'var(--green)', bg: 'rgba(0,255,100,0.05)' },
        { icon: '3', title: 'Monitor', desc: 'Sessions appear automatically in the dashboard', color: 'var(--magenta)', bg: 'rgba(168,85,247,0.05)' },
        { icon: '4', title: 'Organize', desc: 'Group into workspaces, create tasks, build knowledge', color: 'var(--orange)', bg: 'rgba(255,165,0,0.05)' },
      ])}

      <h3>Quick Start Checklist</h3>
      <table class="guide-table">
        <tr><td style="color:var(--green);">1.</td><td>Launch Savant — the <strong>Sessions</strong> tab shows all detected AI sessions</td></tr>
        <tr><td style="color:var(--green);">2.</td><td>Click a session card to see its full event timeline and files</td></tr>
        <tr><td style="color:var(--green);">3.</td><td>Switch to <strong>Workspaces</strong> tab and create a workspace for your current feature/ticket</td></tr>
        <tr><td style="color:var(--green);">4.</td><td>Assign relevant sessions to the workspace from the session detail page</td></tr>
        <tr><td style="color:var(--green);">5.</td><td>Use the <strong>Tasks</strong> tab to break work into trackable items</td></tr>
        <tr><td style="color:var(--green);">6.</td><td>Explore the <strong>MCP</strong> tab for abilities, semantic search, and knowledge graph</td></tr>
      </table>
    `
  },
  {
    id: 'use-layout', title: 'App Layout', _sub: true, children: [],
    content: `
      <h2>App Layout</h2>
      <p>Savant has a persistent chrome layout with 5 zones:</p>

      <div class="guide-layout-diagram">
        <div class="guide-layout-top">TOP BAR — Savant logo, centered</div>
        <div class="guide-layout-middle">
          <div class="guide-layout-left">LEFT<br>BAR<br><br>📊<br>⌨<br>—<br>🌐<br>📋</div>
          <div class="guide-layout-content">
            <div style="color:var(--cyan);font-size:0.55rem;margin-bottom:4px;">TAB BAR: Workspaces | Tasks | MCP | Sessions</div>
            <div style="color:var(--text-dim);font-size:0.5rem;margin-bottom:8px;">SUBTITLE + (i) guide icon + (?) context help</div>
            <div style="border:1px dashed var(--border);border-radius:6px;padding:16px;text-align:center;color:var(--text-dim);font-size:0.55rem;">
              CONTENT AREA<br><br>
              Session cards, workspace detail, task board,<br>
              MCP tools, knowledge graph, etc.
            </div>
          </div>
          <div class="guide-layout-right">RIGHT<br>BAR</div>
        </div>
        <div class="guide-layout-bottom">STATUS BAR — Breadcrumb &gt; Navigation | Sessions | Workspace | MCP | Refresh | Clock</div>
      </div>

      <h3>Left Action Bar</h3>
      <table class="guide-table">
        <tr><th>Icon</th><th>Action</th><th>When Visible</th></tr>
        <tr><td>📊</td><td>Switch to Dashboard (GUI)</td><td>Always</td></tr>
        <tr><td>⌨</td><td>Switch to Terminal</td><td>Always</td></tr>
        <tr><td>🌐</td><td>Open current page in default browser</td><td>GUI mode</td></tr>
        <tr><td>📋</td><td>Toggle debug log panel</td><td>GUI mode</td></tr>
        <tr><td>?</td><td>Terminal keyboard shortcuts help</td><td>Terminal mode</td></tr>
        <tr><td>✕</td><td>Back to Dashboard</td><td>Terminal mode</td></tr>
      </table>

      <h3>Status Bar (Bottom)</h3>
      <p>The status bar shows a <strong>breadcrumb trail</strong> of your current location (e.g., <code>Workspaces &gt; Auth Migration &gt; Tasks</code>), session count, active workspace, MCP health, refresh countdown, and clock.</p>

      <h3>Tabs</h3>
      ${_gFlow([
        { icon: '📁', title: 'Workspaces', desc: 'Group & organize sessions', color: 'var(--magenta)' },
        { icon: '☑', title: 'Tasks', desc: 'Kanban task board', color: 'var(--yellow)' },
        { icon: '🧬', title: 'MCP', desc: 'Abilities, Context, Knowledge', color: 'var(--orange)' },
        { icon: '📊', title: 'Sessions', desc: 'Monitor AI sessions', color: 'var(--cyan)' },
      ])}
    `
  },
  {
    id: 'use-sessions', title: 'Monitoring Sessions', _sub: true, children: [],
    content: `
      <h2>Monitoring Sessions</h2>
      <p>The <strong>Sessions</strong> tab is the heart of Savant. It auto-discovers and displays AI coding sessions from Copilot CLI, Claude Code, Codex, and Gemini.</p>

      <h3>Session Discovery</h3>
      ${_gFlow([
        { icon: '📂', title: 'Telemetry Files', desc: 'AI tools write session logs to disk', color: 'var(--text-dim)' },
        { icon: '🔍', title: 'Scanner', desc: 'Savant scans known directories every 30s', color: 'var(--cyan)' },
        { icon: '📊', title: 'Parser', desc: 'Events extracted, status computed', color: 'var(--green)' },
        { icon: '🃏', title: 'Card', desc: 'Session card appears on dashboard', color: 'var(--magenta)' },
      ])}

      <h3>Session Card Anatomy</h3>
      <div class="guide-card-anatomy">
        <div class="guide-card-mock">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div><span style="background:var(--green);color:#000;padding:1px 6px;border-radius:3px;font-size:0.45rem;font-weight:700;">ACTIVE</span> <span style="background:rgba(168,85,247,0.2);color:var(--magenta);padding:1px 6px;border-radius:3px;font-size:0.45rem;">opus</span></div>
            <div style="font-size:0.55rem;">▶ 📋 ★ 🗑</div>
          </div>
          <div style="font-size:0.55rem;color:var(--text);font-weight:600;margin-bottom:4px;">Implementing auth middleware refactor</div>
          <div style="font-size:0.45rem;color:var(--text-dim);">abc123-def456-789</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:0.45rem;color:var(--text-dim);margin-top:6px;">
            <span style="color:var(--cyan);">PROJECT</span><span>icn-auth-service</span>
            <span style="color:var(--cyan);">STARTED</span><span>10:30 AM (2h ago)</span>
            <span style="color:var(--cyan);">STATS</span><span>42 msgs &middot; 18 turns &middot; 6 tools</span>
          </div>
          <div style="margin-top:6px;height:12px;background:rgba(0,240,255,0.05);border-radius:3px;display:flex;gap:1px;overflow:hidden;">
            <div style="flex:3;background:var(--green);opacity:0.3;"></div>
            <div style="flex:1;background:var(--yellow);opacity:0.3;"></div>
            <div style="flex:2;background:var(--cyan);opacity:0.3;"></div>
            <div style="flex:1;background:var(--text-dim);opacity:0.2;"></div>
          </div>
        </div>
      </div>

      <h3>Card Actions</h3>
      <table class="guide-table">
        <tr><th>Button</th><th>Action</th></tr>
        <tr><td><strong>▶</strong></td><td>Resume session in terminal — opens a new terminal tab in the session's working directory and runs the resume command</td></tr>
        <tr><td><strong>📋</strong></td><td>Copy the resume command to clipboard</td></tr>
        <tr><td><strong>★</strong></td><td>Star / unstar — starred sessions appear first</td></tr>
        <tr><td><strong>🗑</strong></td><td>Delete session from Savant (does not delete original files)</td></tr>
      </table>

      <h3>Session Statuses</h3>
      <div class="guide-status-grid">
        <div class="guide-status-item"><div class="guide-status-dot" style="background:var(--green);box-shadow:0 0 6px var(--green);"></div><span style="color:var(--green);">RUNNING</span><span>Tool actively executing, activity within 10 min</span></div>
        <div class="guide-status-item"><div class="guide-status-dot" style="background:var(--green);"></div><span style="color:var(--green);">PROCESSING</span><span>Assistant generating response, within 10 min</span></div>
        <div class="guide-status-item"><div class="guide-status-dot" style="background:var(--cyan);box-shadow:0 0 6px var(--cyan);"></div><span style="color:var(--cyan);">ACTIVE</span><span>Recent activity in last 2 minutes</span></div>
        <div class="guide-status-item"><div class="guide-status-dot" style="background:var(--yellow);"></div><span style="color:var(--yellow);">WAITING</span><span>Waiting for user input (&lt;5 min)</span></div>
        <div class="guide-status-item"><div class="guide-status-dot" style="background:var(--text-dim);"></div><span style="color:var(--text-dim);">IDLE</span><span>No activity for 2–30 minutes</span></div>
        <div class="guide-status-item"><div class="guide-status-dot" style="background:#2a3a4a;"></div><span style="color:#4a5a6a;">DORMANT</span><span>No activity for 30+ minutes</span></div>
        <div class="guide-status-item"><div class="guide-status-dot" style="background:var(--red);box-shadow:0 0 6px var(--red);"></div><span style="color:var(--red);">STUCK</span><span>Tool/response in progress but silent for 10+ min</span></div>
        <div class="guide-status-item"><div class="guide-status-dot" style="background:var(--orange);"></div><span style="color:var(--orange);">ABORTED</span><span>User cancelled the session</span></div>
      </div>

      <h3>Session Detail Page</h3>
      <p>Click any session card to navigate to its detail page, which shows:</p>
      <ul>
        <li><strong>Event Timeline</strong> — chronological list of every tool call, message, and status change</li>
        <li><strong>Files Changed</strong> — all files created/modified/deleted during the session</li>
        <li><strong>Git Commits</strong> — commits made during the session</li>
        <li><strong>Model info</strong> — which AI model was used (opus, sonnet, haiku, gpt-4, etc.)</li>
        <li><strong>Workspace assignment</strong> — link the session to a workspace</li>
      </ul>

      <h3>Filtering & Search</h3>
      <table class="guide-table">
        <tr><th>Filter</th><th>How</th></tr>
        <tr><td>Text search</td><td>Type in the search bar or press <kbd>/</kbd></td></tr>
        <tr><td>Status filter</td><td>Click status badges above the session list</td></tr>
        <tr><td>Project filter</td><td>Use the project dropdown</td></tr>
        <tr><td>Provider</td><td>Sub-tabs: Copilot | Claude | Codex | Gemini</td></tr>
        <tr><td>Starred only</td><td>Toggle the star filter</td></tr>
      </table>

      <h3>Activity Timeline</h3>
      <p>Each session card has an <strong>activity heatmap bar</strong> at the bottom showing the distribution of activity over the session's lifetime. Green = active coding, yellow = waiting, dim = idle.</p>
    `
  },
  {
    id: 'use-workspaces', title: 'Using Workspaces', _sub: true, children: [],
    content: `
      <h2>Using Workspaces</h2>
      <p>Workspaces are <strong>containers that group related work</strong> across AI tools and sessions. Think of a workspace as a project, a ticket, or a feature branch.</p>

      <h3>Why Workspaces?</h3>
      ${_gFlow([
        { icon: '🔀', title: 'Problem', desc: 'Sessions scattered across Copilot, Claude, Codex, and Gemini for one ticket', color: 'var(--red)' },
        { icon: '📁', title: 'Solution', desc: 'Workspace groups all sessions + tasks + MRs + Jira', color: 'var(--green)' },
        { icon: '📊', title: 'Result', desc: 'One place to see everything for this work', color: 'var(--cyan)' },
      ])}

      <h3>Creating a Workspace</h3>
      ${_gSteps([
        { title: 'Go to Workspaces tab', desc: 'Click "Workspaces" in the top tab bar', color: 'var(--cyan)' },
        { title: 'Click "+ NEW"', desc: 'Enter a name (e.g., "Auth Migration"), optional description and priority', color: 'var(--green)' },
        { title: 'Assign Sessions', desc: 'Open a session detail page and use the workspace dropdown to assign it', color: 'var(--magenta)' },
        { title: 'Add Tasks', desc: 'Create tasks from the workspace Tasks sub-tab or the main Task board', color: 'var(--yellow)' },
        { title: 'Link MRs & Jira', desc: 'Use MRs and Jira sub-tabs to track external items', color: 'var(--orange)' },
      ])}

      <h3>Workspace Detail View</h3>
      <p>Click a workspace card to open its detail view with these sub-tabs:</p>
      <table class="guide-table">
        <tr><th>Sub-tab</th><th>Content</th><th>Tip</th></tr>
        <tr><td style="color:var(--cyan);">Sessions</td><td>All assigned sessions with cards</td><td>Star important ones for quick access</td></tr>
        <tr><td style="color:var(--yellow);">Tasks</td><td>Linked tasks with kanban columns</td><td>Tasks sync with the main task board</td></tr>
        <tr><td style="color:var(--green);">Files</td><td>All files touched across sessions</td><td>Grouped by session, shows action badges</td></tr>
        <tr><td style="color:var(--magenta);">Session Files</td><td>Raw telemetry file listing</td><td>Useful for debugging session data</td></tr>
        <tr><td style="color:var(--orange);">MRs</td><td>Linked merge requests</td><td>Track review status and approvals</td></tr>
        <tr><td style="color:var(--red);">Jira</td><td>Linked Jira tickets</td><td>Sync status with your project tracker</td></tr>
        <tr><td style="color:var(--text-dim);">Notes</td><td>Session notes and annotations</td><td>AI agents can also create notes via MCP</td></tr>
        <tr><td style="color:var(--cyan);">Knowledge</td><td>KG nodes scoped to this workspace</td><td>Stage nodes during work, commit when done</td></tr>
      </table>

      <h3>Workspace Stats Dashboard</h3>
      <p>At the top of the detail view, you see stat cards for:</p>
      ${_gStats([
        { icon: '📊', value: 'N', label: 'Sessions', color: 'var(--cyan)' },
        { icon: '📁', value: 'N', label: 'Projects', color: 'var(--magenta)' },
        { icon: '📄', value: 'N', label: 'Assets', color: 'var(--orange)' },
        { icon: '☑', value: 'N', label: 'Tasks', color: 'var(--yellow)' },
        { icon: '✓', value: '%', label: 'Completed', color: 'var(--green)' },
      ])}

      <h3>MCP Integration</h3>
      <p>AI tools can create and manage workspaces via the <code>savant-workspace</code> MCP server:</p>
      <pre><code>create_workspace(name, description)
assign_session_to_workspace(workspace_id, session_id)
list_workspaces(status="open")</code></pre>
    `
  },
  {
    id: 'use-tasks', title: 'Managing Tasks', _sub: true, children: [],
    content: `
      <h2>Managing Tasks</h2>
      <p>The Task board is a <strong>Kanban-style planner</strong> with 4 columns. Tasks can be linked to workspaces and managed via keyboard.</p>

      <h3>Task Board Layout</h3>
      <div class="guide-kanban-mock">
        <div class="guide-kanban-col" style="border-top:2px solid var(--text-dim);">
          <div class="guide-kanban-title">TODO</div>
          <div class="guide-kanban-card">Research API options</div>
          <div class="guide-kanban-card">Write migration script</div>
        </div>
        <div class="guide-kanban-col" style="border-top:2px solid var(--cyan);">
          <div class="guide-kanban-title" style="color:var(--cyan);">IN PROGRESS</div>
          <div class="guide-kanban-card" style="border-color:var(--cyan);">Implement auth flow</div>
        </div>
        <div class="guide-kanban-col" style="border-top:2px solid var(--orange);">
          <div class="guide-kanban-title" style="color:var(--orange);">BLOCKED</div>
          <div class="guide-kanban-card" style="border-color:var(--orange);">Waiting on API access</div>
        </div>
        <div class="guide-kanban-col" style="border-top:2px solid var(--green);">
          <div class="guide-kanban-title" style="color:var(--green);">DONE</div>
          <div class="guide-kanban-card" style="border-color:var(--green);opacity:0.6;">Setup project scaffold</div>
        </div>
      </div>

      <h3>Creating Tasks</h3>
      ${_gSteps([
        { title: 'Press N or click + NEW', desc: 'Opens the new task modal', color: 'var(--cyan)' },
        { title: 'Fill in details', desc: 'Title (required), description, priority (low/medium/high/critical), workspace link', color: 'var(--green)' },
        { title: 'Set date', desc: 'Tasks default to today. Use the date picker at the top to view different days', color: 'var(--yellow)' },
        { title: 'Save', desc: 'Task appears in the TODO column', color: 'var(--magenta)' },
      ])}

      <h3>Moving Tasks</h3>
      <p>Move tasks between columns in two ways:</p>
      <ul>
        <li><strong>Drag & Drop</strong> — grab a task card and drop it in any column</li>
        <li><strong>Keyboard</strong> — select a task with J/K, then press <kbd>L</kbd> to move right or <kbd>H</kbd> to move left</li>
      </ul>

      <h3>Keyboard Shortcuts</h3>
      <table class="guide-table">
        <tr><th>Key</th><th>Action</th><th>Context</th></tr>
        <tr><td><kbd>N</kbd></td><td>New task</td><td>Task board</td></tr>
        <tr><td><kbd>J</kbd> / <kbd>K</kbd></td><td>Navigate down / up</td><td>Within a column</td></tr>
        <tr><td><kbd>H</kbd> / <kbd>L</kbd></td><td>Move task left / right</td><td>Changes status column</td></tr>
        <tr><td><kbd>D</kbd></td><td>Quick mark as done</td><td>Selected task</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Edit task details</td><td>Selected task</td></tr>
        <tr><td><kbd>X</kbd></td><td>Delete task</td><td>Selected task</td></tr>
        <tr><td><kbd>E</kbd></td><td>End day</td><td>Rolls incomplete tasks to next day</td></tr>
      </table>

      <h3>Daily Planning</h3>
      <p>Tasks are scoped to dates. Use the <strong>date picker</strong> at the top of the task board to navigate between days. Press <kbd>E</kbd> at end of day to automatically roll incomplete tasks (todo + in-progress) forward to tomorrow.</p>

      <h3>Task Dependencies</h3>
      <p>Open a task's edit modal and use the Dependencies section to link tasks that must complete first. Dependent tasks show a link icon on their card.</p>
    `
  },
  {
    id: 'use-terminal', title: 'Terminal', _sub: true, children: [],
    content: `
      <h2>Built-in Terminal</h2>
      <p>Savant includes a full terminal powered by <strong>xterm.js</strong> with nested splits, multiple tabs, and integration with session resume.</p>

      <h3>Switching to Terminal</h3>
      <p>Click the <strong>⌨ keyboard icon</strong> in the left action bar, or use the <strong>▶ resume button</strong> on a session card to open terminal with the session's resume command.</p>

      <h3>Terminal Layout</h3>
      <div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:rgba(0,0,0,0.3);margin:12px 0;">
        <div style="display:flex;gap:4px;margin-bottom:8px;">
          <span style="background:var(--cyan);color:#000;padding:1px 8px;border-radius:3px;font-size:0.45rem;font-weight:600;">Tab 1</span>
          <span style="background:var(--border);color:var(--text-dim);padding:1px 8px;border-radius:3px;font-size:0.45rem;">Tab 2</span>
          <span style="font-size:0.45rem;color:var(--text-dim);padding:1px 4px;">+</span>
        </div>
        <div style="display:flex;gap:2px;height:80px;">
          <div style="flex:1;border:1px solid var(--cyan);border-radius:4px;padding:4px;font-size:0.4rem;color:var(--green);font-family:monospace;">$ npm run build<br>Building...<br>Done in 4.2s</div>
          <div style="flex:1;display:flex;flex-direction:column;gap:2px;">
            <div style="flex:1;border:1px solid var(--border);border-radius:4px;padding:4px;font-size:0.4rem;color:var(--text-dim);font-family:monospace;">$ git status</div>
            <div style="flex:1;border:1px solid var(--border);border-radius:4px;padding:4px;font-size:0.4rem;color:var(--text-dim);font-family:monospace;">$ tail -f logs</div>
          </div>
        </div>
      </div>

      <h3>Keyboard Shortcuts</h3>
      <table class="guide-table">
        <tr><th>Key</th><th>Action</th></tr>
        <tr><td><kbd>⌘T</kbd></td><td>New tab</td></tr>
        <tr><td><kbd>⌘W</kbd></td><td>Close current tab/pane</td></tr>
        <tr><td><kbd>⌘D</kbd></td><td>Split pane vertically (right)</td></tr>
        <tr><td><kbd>⌘⇧D</kbd></td><td>Split pane horizontally (down)</td></tr>
        <tr><td><kbd>⌘[</kbd> / <kbd>⌘]</kbd></td><td>Previous / next pane</td></tr>
        <tr><td><kbd>⌘{</kbd> / <kbd>⌘}</kbd></td><td>Previous / next tab</td></tr>
      </table>

      <h3>Session Resume</h3>
      <p>Click the <strong>▶ button</strong> on any session card to:</p>
      ${_gSteps([
        { title: 'Switch to terminal view', desc: 'GUI hides, terminal fills the content area', color: 'var(--cyan)' },
        { title: 'Open new tab', desc: 'Terminal tab opens in the session working directory', color: 'var(--green)' },
        { title: 'Run resume command', desc: 'The resume command (e.g., claude --resume) executes automatically', color: 'var(--magenta)' },
      ])}
    `
  },
  {
    id: 'use-mcp', title: 'MCP Tab', _sub: true, children: [],
    content: `
      <h2>MCP Tab</h2>
      <p>The MCP tab has 4 sub-tabs, each backed by a dedicated MCP server:</p>

      ${_gFlow([
        { icon: '🧭', title: 'Workspace', desc: 'MCP server dashboard & tools', color: 'var(--cyan)' },
        { icon: '🧬', title: 'Abilities', desc: 'Prompt asset YAML editor', color: 'var(--magenta)' },
        { icon: '📡', title: 'Context', desc: 'Semantic code search', color: 'var(--green)' },
        { icon: '🧠', title: 'Knowledge', desc: 'Interactive knowledge graph', color: 'var(--orange)' },
      ])}

      <h3>Workspace MCP</h3>
      <p>Shows MCP server health, connected tools, and recent tool call activity. The savant-workspace server on port 8091 handles all workspace, task, note, MR, and Jira operations.</p>

      <h3>Abilities</h3>
      <p>A YAML asset editor with tree sidebar. Browse and edit personas, rules, policies, and styles. Use the <strong>Build</strong> tab to compile assets into a resolved prompt preview.</p>

      <h3>Context (Semantic Search)</h3>
      <p>Index repositories for semantic code search. Type a natural-language query and get relevant code chunks ranked by cosine similarity. Powered by sqlite-vec embeddings.</p>
      ${_gSteps([
        { title: 'Add a project', desc: 'Enter the path to a git repository', color: 'var(--cyan)' },
        { title: 'Index', desc: 'Savant walks the file tree, chunks code, and generates embeddings (~2 min for large repos)', color: 'var(--green)' },
        { title: 'Search', desc: 'Type a query like "authentication middleware" and get ranked results', color: 'var(--magenta)' },
      ])}

      <h3>Knowledge Graph</h3>
      <p>An interactive D3 force-directed graph. Click nodes to explore, use the search bar to filter, and switch between Business/Stack/All views. Nodes are color-coded by type.</p>
      <table class="guide-table">
        <tr><th style="width:30px;"></th><th>Node Type</th><th>Examples</th></tr>
        <tr><td style="color:#f97316;">●</td><td>client</td><td>Fidelity, UBS, Halo</td></tr>
        <tr><td style="color:#3b82f6;">●</td><td>domain</td><td>Auth/SSO, Holdings, Orders</td></tr>
        <tr><td style="color:#06b6d4;">●</td><td>service</td><td>icn, simonapp, auth-service</td></tr>
        <tr><td style="color:#84cc16;">●</td><td>library</td><td>icn-user-acl, shared-utils</td></tr>
        <tr><td style="color:#8b5cf6;">●</td><td>technology</td><td>Rails, Redis, Kafka, AWS</td></tr>
        <tr><td style="color:#f59e0b;">●</td><td>insight</td><td>Developer knowledge, patterns</td></tr>
        <tr><td style="color:#10b981;">●</td><td>project</td><td>Auth migration, dashboard refresh, platform initiatives</td></tr>
        <tr><td style="color:#ec4899;">●</td><td>concept</td><td>RBAC, PKCE, eventual consistency</td></tr>
        <tr><td style="color:#6366f1;">●</td><td>repo</td><td>savant-app, icn, simonapp</td></tr>
        <tr><td style="color:#14b8a6;">●</td><td>session</td><td>AI coding session traces and handoffs</td></tr>
        <tr><td style="color:#ef4444;">●</td><td>issue</td><td>Known bugs, tech debt</td></tr>
      </table>
    `
  },
  {
    id: 'use-search', title: 'Search & Navigation', _sub: true, children: [],
    content: `
      <h2>Search & Navigation</h2>

      <h3>Command Palette</h3>
      <p>Press <kbd>⌘K</kbd> anywhere to open the command palette — a quick-switch dialog for navigating to sessions, workspaces, and actions.</p>

      <h3>Global Search</h3>
      <p>Press <kbd>/</kbd> to focus the search bar on the current tab. Search works differently per tab:</p>
      <table class="guide-table">
        <tr><th>Tab</th><th>Searches</th></tr>
        <tr><td>Sessions</td><td>Session summary, project, ID, model</td></tr>
        <tr><td>Workspaces</td><td>Workspace name (title only while typing, all fields on Enter)</td></tr>
        <tr><td>Tasks</td><td>Task title, description</td></tr>
        <tr><td>Knowledge</td><td>Node title, content (fuzzy match)</td></tr>
      </table>

      <h3>Keyboard Navigation Summary</h3>
      <table class="guide-table">
        <tr><th>Key</th><th>Global</th></tr>
        <tr><td><kbd>⌘K</kbd></td><td>Command palette</td></tr>
        <tr><td><kbd>/</kbd></td><td>Focus search</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Clear focus, close overlays</td></tr>
        <tr><td><kbd>⌘N</kbd></td><td>New window (multi-monitor)</td></tr>
        <tr><td><kbd>⌘⇧B</kbd></td><td>Open in browser</td></tr>
      </table>

      <h3>Breadcrumb Navigation</h3>
      <p>The bottom status bar always shows where you are:</p>
      <div style="background:rgba(8,14,28,0.97);border:1px solid var(--border);border-radius:4px;padding:6px 12px;font-family:var(--font-mono);font-size:0.55rem;margin:8px 0;">
        <span style="color:var(--text-dim);">Workspaces</span>
        <span style="color:var(--text-dim);margin:0 4px;">›</span>
        <span style="color:var(--text-dim);">Auth Migration</span>
        <span style="color:var(--text-dim);margin:0 4px;">›</span>
        <span style="color:var(--cyan);">Tasks</span>
      </div>
    `
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. HOW IT'S BUILT (Architecture + Components + Dev Guide)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'how-its-built', title: 'How it\'s Built', children: [
      { id: 'architecture', title: 'Architecture', children: [
        { id: 'three-process', title: 'Three-Process Model', children: [] },
        { id: 'data-layer', title: 'Data Layer', children: [] },
        { id: 'data-flow', title: 'Data Flow', children: [] },
        { id: 'frontend', title: 'Frontend', children: [] },
      ]},
      { id: 'components', title: 'Components', children: [
        { id: 'comp-mcp', title: 'MCP Servers', children: [] },
        { id: 'comp-abilities', title: 'Abilities', children: [] },
        { id: 'comp-context', title: 'Context (Semantic Search)', children: [] },
        { id: 'comp-knowledge', title: 'Knowledge Graph', children: [] },
        { id: 'comp-notifications', title: 'Notifications', children: [] },
        { id: 'comp-debug', title: 'Debug Log', children: [] },
      ]},
      { id: 'dev-guide', title: 'Developer Guide', children: [
        { id: 'dev-setup', title: 'Setup & Run', children: [] },
        { id: 'dev-testing', title: 'Testing', children: [] },
        { id: 'dev-adding-features', title: 'Adding Features', children: [] },
        { id: 'dev-conventions', title: 'Conventions', children: [] },
      ]},
      { id: 'keyboard-shortcuts', title: 'Keyboard Shortcuts', children: [] },
    ],
    content: `
      <h2>How it's Built</h2>
      <p>Deep dive into Savant's architecture, components, and developer workflows. Select a section from the tree to explore.</p>

      ${_gFlow([
        { icon: '🏗', title: 'Architecture', desc: 'Three-process model, data layer, frontend', color: 'var(--cyan)' },
        { icon: '🧩', title: 'Components', desc: 'MCP servers, abilities, context, KG', color: 'var(--magenta)' },
        { icon: '🔧', title: 'Developer Guide', desc: 'Setup, testing, adding features', color: 'var(--green)' },
        { icon: '⌨', title: 'Shortcuts', desc: 'Keyboard navigation reference', color: 'var(--orange)' },
      ])}
    `
  },
  {
    id: 'architecture', title: 'Architecture', _sub: true, children: [],
    content: `
      <h2>Architecture</h2>
      <p>Savant uses a <strong>three-process model</strong>: an Electron shell, a Flask REST backend, and four MCP SSE servers.</p>

      <div class="guide-arch-diagram">
        <div class="guide-arch-row">
          <div class="guide-arch-box" style="border-color:var(--cyan);grid-column:1/-1;">
            <div style="font-weight:700;color:var(--cyan);">Electron Shell</div>
            <div style="font-size:0.45rem;color:var(--text-dim);">main.js — BrowserWindow, BrowserView (terminal), Tray, lifecycle management</div>
          </div>
        </div>
        <div class="guide-arch-connector">▼ spawns on startup ▼</div>
        <div class="guide-arch-row" style="grid-template-columns:1fr 1fr;">
          <div class="guide-arch-box" style="border-color:var(--magenta);">
            <div style="font-weight:700;color:var(--magenta);">Flask Backend</div>
            <div style="font-size:0.45rem;color:var(--text-dim);">REST API + Jinja2 templates<br>Dynamic port, SQLite + sqlite-vec</div>
          </div>
          <div class="guide-arch-box" style="border-color:var(--orange);">
            <div style="font-weight:700;color:var(--orange);">MCP Servers (x4)</div>
            <div style="font-size:0.45rem;color:var(--text-dim);">SSE bridges on ports 8091–8094<br>Proxy tool calls → Flask API</div>
          </div>
        </div>
        <div class="guide-arch-connector">▼ reads/writes ▼</div>
        <div class="guide-arch-row" style="grid-template-columns:1fr 1fr 1fr;">
          <div class="guide-arch-box" style="border-color:var(--green);">
            <div style="font-weight:700;color:var(--green);">SQLite DB</div>
            <div style="font-size:0.45rem;color:var(--text-dim);">~/.savant/savant.db</div>
          </div>
          <div class="guide-arch-box" style="border-color:var(--yellow);">
            <div style="font-weight:700;color:var(--yellow);">Session Files</div>
            <div style="font-size:0.45rem;color:var(--text-dim);">~/.copilot-cli/<br>~/.claude/projects/</div>
          </div>
          <div class="guide-arch-box" style="border-color:var(--text-dim);">
            <div style="font-weight:700;color:var(--text-dim);">YAML Assets</div>
            <div style="font-size:0.45rem;color:var(--text-dim);">savant/abilities/</div>
          </div>
        </div>
      </div>
    `
  },
  {
    id: 'three-process', title: 'Three-Process Model', _sub: true, children: [],
    content: `
      <h2>Three-Process Model</h2>
      <table class="guide-table">
        <tr><th>Process</th><th>Entry Point</th><th>Role</th></tr>
        <tr><td style="color:var(--cyan);">Electron</td><td><code>main.js</code></td><td>BrowserWindow, loading screen, spawns Flask on dynamic port, spawns MCP servers on fixed ports, hides to tray on close</td></tr>
        <tr><td style="color:var(--magenta);">Flask</td><td><code>savant/app.py</code></td><td>REST API + Jinja2 templates. Blueprints for abilities, context, knowledge. Background cache thread refreshes sessions</td></tr>
        <tr><td style="color:var(--orange);">MCP Servers</td><td><code>savant/mcp/*.py</code></td><td>FastMCP SSE bridges — proxy tool calls to Flask REST API</td></tr>
      </table>

      <h3>Startup Sequence</h3>
      ${_gSteps([
        { title: 'Find free port', desc: 'Electron scans for an available port for Flask', color: 'var(--cyan)' },
        { title: 'Spawn Flask', desc: 'Starts Python process with FLASK_PORT env var', color: 'var(--magenta)' },
        { title: 'Health check', desc: 'Polls GET /api/db/health until Flask responds', color: 'var(--green)' },
        { title: 'Kill orphans', desc: 'Uses lsof to find and kill any stale processes on MCP ports', color: 'var(--orange)' },
        { title: 'Spawn MCP servers', desc: '4 FastMCP processes on ports 8091, 8092, 8093, 8094', color: 'var(--yellow)' },
        { title: 'Patch AI configs', desc: 'setupMcpConfigs() injects MCP entries into Copilot, Claude, Gemini, and Codex config files', color: 'var(--magenta)' },
        { title: 'Navigate to Flask', desc: 'BrowserWindow loads the Flask URL — app is ready', color: 'var(--cyan)' },
      ])}

      <h3>Shutdown</h3>
      <p>When the window closes, Savant hides to the system tray. Quitting the app (⌘Q or tray menu) kills all child processes (Flask + 4 MCP servers).</p>
    `
  },
  {
    id: 'data-layer', title: 'Data Layer', _sub: true, children: [],
    content: `
      <h2>Data Layer</h2>

      <h3>Database</h3>
      <ul>
        <li><strong>SQLite</strong> at <code>~/.savant/savant.db</code> (WAL mode for concurrent reads)</li>
        <li><strong>sqlite-vec</strong> extension for 768-dim vector embeddings</li>
        <li>Schema auto-migrates on startup</li>
      </ul>

      <h3>Tables</h3>
      <table class="guide-table">
        <tr><th>Table</th><th>DB Class</th><th>Purpose</th></tr>
        <tr><td><code>workspaces</code></td><td><code>WorkspaceDB</code></td><td>Workspace containers</td></tr>
        <tr><td><code>tasks</code></td><td><code>TaskDB</code></td><td>Kanban tasks with status, priority, date</td></tr>
        <tr><td><code>notes</code></td><td><code>NoteDB</code></td><td>Session notes and annotations</td></tr>
        <tr><td><code>merge_requests</code></td><td><code>MergeRequestDB</code></td><td>Linked MRs from GitLab/GitHub</td></tr>
        <tr><td><code>jira_tickets</code></td><td><code>JiraTicketDB</code></td><td>Linked Jira issues</td></tr>
        <tr><td><code>notifications</code></td><td><code>NotificationDB</code></td><td>Bell icon notification history</td></tr>
        <tr><td><code>experiences</code></td><td><code>ExperienceDB</code></td><td>KG experience/insight entries</td></tr>
        <tr><td><code>kg_nodes / kg_edges</code></td><td><code>KnowledgeGraphDB</code></td><td>Knowledge graph nodes and edges</td></tr>
      </table>

      <h3>Data Model Pattern</h3>
      <pre><code># Every DB class follows this pattern:
class WorkspaceDB:
    @staticmethod
    def create(workspace: dict) -> dict:
        conn = get_connection()
        conn.execute("INSERT INTO workspaces ...", (...))
        conn.commit()
        return WorkspaceDB.get_by_id(workspace["workspace_id"])

    @staticmethod
    def get_by_id(workspace_id: str) -> dict | None:
        ...

    @staticmethod
    def list_all(status=None, limit=1000) -> list[dict]:
        ...

    @staticmethod
    def update(workspace_id: str, updates: dict) -> dict | None:
        ...

    @staticmethod
    def delete(workspace_id: str) -> bool:
        ...</code></pre>

      <h3>File Locations</h3>
      <table class="guide-table">
        <tr><th>What</th><th>Where</th></tr>
        <tr><td>Database</td><td><code>~/.savant/savant.db</code></td></tr>
        <tr><td>Meta / index</td><td><code>~/.savant/meta/</code></td></tr>
        <tr><td>Logs</td><td><code>~/Library/Application Support/savant/savant-main.log</code></td></tr>
        <tr><td>Copilot sessions</td><td><code>~/.copilot-cli/sessions/</code></td></tr>
        <tr><td>Claude sessions</td><td><code>~/.claude/projects/</code></td></tr>
        <tr><td>Codex sessions</td><td><code>~/.codex/sessions/</code></td></tr>
        <tr><td>Gemini sessions</td><td><code>~/.gemini/tmp/savant-app/chats/</code></td></tr>
        <tr><td>Hermes sessions</td><td><code>~/.hermes/sessions/</code></td></tr>
      </table>
    `
  },
  {
    id: 'data-flow', title: 'Data Flow', _sub: true, children: [],
    content: `
      <h2>Data Flow</h2>
      <p>Understanding how data moves through Savant:</p>

      <h3>Session Data Flow</h3>
      ${_gFlow([
        { icon: '🤖', title: 'AI Tool', desc: 'Hermes, Copilot, Claude, Codex, and Gemini write session data to disk', color: 'var(--green)' },
        { icon: '🔍', title: 'Scanner', desc: 'Background thread reads files every 30s', color: 'var(--cyan)' },
        { icon: '🗃', title: 'Cache', desc: 'Parsed sessions cached in memory', color: 'var(--magenta)' },
        { icon: '📡', title: 'REST API', desc: 'GET /api/sessions serves cached data', color: 'var(--orange)' },
        { icon: '📊', title: 'UI', desc: 'JS fetches and renders cards', color: 'var(--yellow)' },
      ])}

      <h3>MCP Tool Call Flow</h3>
      ${_gFlow([
        { icon: '🤖', title: 'AI Agent', desc: 'Claude Code calls create_task()', color: 'var(--green)' },
        { icon: '📡', title: 'MCP SSE', desc: 'savant-workspace receives on :8091', color: 'var(--cyan)' },
        { icon: '🔄', title: 'Proxy', desc: '_api() calls Flask REST endpoint', color: 'var(--magenta)' },
        { icon: '🗃', title: 'Flask', desc: 'POST /api/tasks creates in SQLite', color: 'var(--orange)' },
        { icon: '✓', title: 'Response', desc: 'Task dict returned to AI agent', color: 'var(--green)' },
      ])}

      <h3>Knowledge Graph Flow</h3>
      ${_gFlow([
        { icon: '📝', title: 'Stage', desc: 'store() creates node with status=staged', color: 'var(--yellow)' },
        { icon: '🔍', title: 'Review', desc: 'Staged nodes visible with amber badge', color: 'var(--orange)' },
        { icon: '✓', title: 'Commit', desc: 'commit_workspace() sets status=committed', color: 'var(--green)' },
        { icon: '🧠', title: 'Graph', desc: 'Node appears in main KG visualization', color: 'var(--cyan)' },
      ])}

      <h3>Embedding / Search Flow</h3>
      ${_gFlow([
        { icon: '📂', title: 'Repo', desc: 'Walk file tree, respect .gitignore', color: 'var(--text-dim)' },
        { icon: '✂', title: 'Chunk', desc: '~500-line segments, 50-line overlap', color: 'var(--cyan)' },
        { icon: '🧮', title: 'Embed', desc: '768-dim vectors via distilbert', color: 'var(--magenta)' },
        { icon: '💾', title: 'Store', desc: 'sqlite-vec table for KNN', color: 'var(--green)' },
        { icon: '🔍', title: 'Query', desc: 'Cosine similarity search', color: 'var(--orange)' },
      ])}
    `
  },
  {
    id: 'frontend', title: 'Frontend', _sub: true, children: [],
    content: `
      <h2>Frontend</h2>
      <ul>
        <li>Server-rendered <strong>Jinja2</strong> templates (<code>savant/templates/</code>)</li>
        <li><strong>Vanilla JS</strong> — no framework, no TypeScript, no bundler</li>
        <li>CSS in <code>savant/static/css/shared.css</code> + inline in <code>index.html</code></li>
        <li>JS modules in <code>savant/static/js/</code> — one file per feature</li>
        <li>xterm.js terminal in a persistent BrowserView</li>
      </ul>

      <h3>Key JS Files</h3>
      <table class="guide-table">
        <tr><th>File</th><th>Purpose</th><th>Lines</th></tr>
        <tr><td><code>sessions.js</code></td><td>Session cards, fetching, filtering, search, detail navigation</td><td>~2000</td></tr>
        <tr><td><code>workspaces.js</code></td><td>Workspace list, detail view, all sub-tabs, drag-and-drop</td><td>~1200</td></tr>
        <tr><td><code>tasks.js</code></td><td>Task board, kanban columns, keyboard nav, drag-and-drop</td><td>~1500</td></tr>
        <tr><td><code>core.js</code></td><td>Tab switching, workspace stats, release notes, loading screen</td><td>~1100</td></tr>
        <tr><td><code>knowledge.js</code></td><td>D3 force graph, node rendering, search, filtering, detail panel</td><td>~800</td></tr>
        <tr><td><code>abilities.js</code></td><td>YAML asset editor, tree sidebar, prompt builder</td><td>~500</td></tr>
        <tr><td><code>globals.js</code></td><td>Shared state variables, preferences, constants</td><td>~80</td></tr>
        <tr><td><code>status-bar.js</code></td><td>Bottom status bar, breadcrumb, MCP health, clock</td><td>~90</td></tr>
        <tr><td><code>terminal-view.js</code></td><td>Terminal view switching, open in browser, tips</td><td>~70</td></tr>
        <tr><td><code>dev-log.js</code></td><td>Debug log panel, filtering, level badges</td><td>~100</td></tr>
        <tr><td><code>guide.js</code></td><td>This guide you are reading right now</td><td>—</td></tr>
      </table>

      <h3>Rendering Flow</h3>
      ${_gFlow([
        { icon: '🌐', title: 'Flask', desc: 'Renders index.html via Jinja2', color: 'var(--magenta)' },
        { icon: '📜', title: 'JS Load', desc: 'Scripts load, globals initialize', color: 'var(--cyan)' },
        { icon: '📡', title: 'Fetch', desc: 'JS calls REST API (fetch)', color: 'var(--green)' },
        { icon: '🖼', title: 'Render', desc: 'innerHTML builds cards/tables', color: 'var(--orange)' },
        { icon: '🔄', title: 'Refresh', desc: 'setInterval every 30s', color: 'var(--yellow)' },
      ])}
    `
  },

  // Components overview
  {
    id: 'components', title: 'Components', _sub: true, children: [],
    content: `
      <h2>Components — Deep Dive</h2>
      <p>Detailed technical reference for each Savant subsystem.</p>
      <h3>Component Map</h3>
      <table class="guide-table">
        <tr><th>Component</th><th>Backend</th><th>MCP Port</th><th>UI Location</th></tr>
        <tr><td>Sessions</td><td><code>app.py</code> (cache thread)</td><td>—</td><td>Sessions tab</td></tr>
        <tr><td>Workspaces</td><td><code>db/workspaces.py</code></td><td>8091</td><td>Workspaces tab</td></tr>
        <tr><td>Tasks</td><td><code>db/tasks.py</code></td><td>8091</td><td>Tasks tab + WS sub-tab</td></tr>
        <tr><td>Abilities</td><td><code>abilities/</code></td><td>8092</td><td>MCP &gt; Abilities</td></tr>
        <tr><td>Context</td><td><code>context/</code></td><td>8093</td><td>MCP &gt; Context</td></tr>
        <tr><td>Knowledge</td><td><code>db/knowledge_graph.py</code></td><td>8094</td><td>MCP &gt; Knowledge</td></tr>
        <tr><td>Merge Requests</td><td><code>db/merge_requests.py</code></td><td>8091</td><td>Workspace &gt; MRs</td></tr>
        <tr><td>Jira Tickets</td><td><code>db/jira_tickets.py</code></td><td>8091</td><td>Workspace &gt; Jira</td></tr>
        <tr><td>Notifications</td><td><code>db/notifications.py</code></td><td>—</td><td>Bell icon (top bar)</td></tr>
      </table>
    `
  },
  {
    id: 'comp-mcp', title: 'MCP Servers', _sub: true, children: [],
    content: `
      <h2>MCP Servers</h2>
      <p>Savant runs <strong>4 MCP (Model Context Protocol) servers</strong> as SSE bridges. These let AI tools programmatically interact with Savant.</p>

      <h3>Server Registry</h3>
      <table class="guide-table">
        <tr><th>Server</th><th>Port</th><th>File</th><th>Tools</th></tr>
        <tr><td style="color:var(--cyan);">savant-workspace</td><td>8091</td><td><code>mcp/server.py</code></td><td>~30 tools (workspace, task, note, MR, Jira CRUD)</td></tr>
        <tr><td style="color:var(--magenta);">savant-abilities</td><td>8092</td><td><code>mcp/abilities_server.py</code></td><td>~10 tools (persona/rule resolution, YAML assets)</td></tr>
        <tr><td style="color:var(--green);">savant-context</td><td>8093</td><td><code>mcp/context_server.py</code></td><td>~6 tools (code search, memory bank, repo status)</td></tr>
        <tr><td style="color:var(--orange);">savant-knowledge</td><td>8094</td><td><code>mcp/knowledge_server.py</code></td><td>~15 tools (store, search, connect, commit, prune)</td></tr>
      </table>

      <h3>How MCP Tools Work</h3>
      ${_gFlow([
        { icon: '🤖', title: 'AI Tool', desc: 'Calls tool via MCP protocol', color: 'var(--green)' },
        { icon: '📡', title: 'SSE Server', desc: 'Receives call, validates params', color: 'var(--cyan)' },
        { icon: '🔄', title: '_api() proxy', desc: 'HTTP request to Flask endpoint', color: 'var(--magenta)' },
        { icon: '🗃', title: 'Flask', desc: 'Processes, writes to SQLite', color: 'var(--orange)' },
        { icon: '📤', title: 'Return', desc: 'dict/list back to AI tool', color: 'var(--green)' },
      ])}

      <h3>Tool Pattern</h3>
      <pre><code># Each MCP tool follows this pattern:
@mcp.tool()
def create_task(title: str, workspace_id: str,
                description: str = "",
                priority: str = "medium") -> dict:
    """Create a new task in a workspace.

    Args:
        title: Task title (required)
        workspace_id: Workspace to add task to
        description: Optional task description
        priority: low, medium, high, or critical
    """
    return _api("POST", "/api/tasks", json={
        "title": title,
        "workspace_id": workspace_id,
        "description": description,
        "priority": priority,
    })</code></pre>
      <p><strong>Key rules:</strong> Docstrings become tool descriptions shown to AI. Type hints are required for JSON schema generation. Return <code>dict</code> or <code>list</code>.</p>

      <h3>Auto-Configuration</h3>
      <p>On startup, <code>setupMcpConfigs()</code> in <code>main.js</code> automatically patches config files for:</p>
      <ul>
       <li><strong>Copilot CLI</strong> — <code>~/.copilot/config.json</code></li>
       <li><strong>Claude Desktop</strong> — <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
       <li><strong>Gemini CLI</strong> — <code>~/.gemini/settings.json</code></li>
       <li><strong>Codex CLI</strong> — <code>~/.codex/config.toml</code></li>
        <li><strong>Hermes Agent</strong> — <code>~/.hermes/config.yaml</code> <em>(preferred — also installs skills)</em></li>
      </ul>
      <p>This means AI tools automatically discover Savant's MCP servers without manual config.</p>
    `
  },
  {
    id: 'comp-abilities', title: 'Abilities', _sub: true, children: [],
    content: `
      <h2>Abilities — Prompt Asset Store</h2>
      <p>A YAML-driven system for defining reusable AI personas, rules, policies, and styles. Compile them into deterministic prompts for AI agents.</p>

      <h3>Asset Types</h3>
      <table class="guide-table">
        <tr><th>Type</th><th>Purpose</th><th>Example</th></tr>
        <tr><td style="color:var(--cyan);">Persona</td><td>AI agent base identity</td><td>"Senior Rails Engineer with 10 years experience"</td></tr>
        <tr><td style="color:var(--green);">Rule</td><td>Reusable injected rules</td><td>"Always use RSpec over Minitest"</td></tr>
        <tr><td style="color:var(--magenta);">Policy</td><td>Behavioural constraints</td><td>"Never commit directly to main branch"</td></tr>
        <tr><td style="color:var(--yellow);">Style</td><td>Output/code style</td><td>"Use 2-space indentation, trailing commas"</td></tr>
        <tr><td style="color:var(--orange);">Repo</td><td>Repository-specific overrides</td><td>"This repo uses Sidekiq for async jobs"</td></tr>
      </table>

      <h3>Prompt Resolution Flow</h3>
      ${_gFlow([
        { icon: '🎭', title: 'Select Persona', desc: 'Choose base identity', color: 'var(--cyan)' },
        { icon: '🏷', title: 'Add Tags', desc: 'Rules & policies by tag', color: 'var(--green)' },
        { icon: '📁', title: 'Set Repo', desc: 'Optional repo overlay', color: 'var(--magenta)' },
        { icon: '⚡', title: 'Resolve', desc: 'Compile into single prompt', color: 'var(--orange)' },
      ])}

      <h3>YAML Asset Format</h3>
      <pre><code># savant/abilities/personas/rails-engineer.yaml
id: rails-engineer
type: persona
name: Senior Rails Engineer
tags: [rails, backend, ruby]
content: |
  You are a senior Rails engineer with deep knowledge of
  ActiveRecord, Sidekiq, and API design patterns.

  ## Guidelines
  - Prefer service objects over fat models
  - Use strong parameters in controllers
  - Write RSpec tests for all new code</code></pre>

      <h3>UI — Editor & Builder</h3>
      <ul>
        <li><strong>Tree Sidebar</strong> — browse all assets organized by type</li>
        <li><strong>Editor</strong> — YAML editor with syntax highlighting for the selected asset</li>
        <li><strong>Build Tab</strong> — select persona + tags + repo, click Build, see the resolved prompt</li>
        <li><strong>Validate</strong> — checks all YAML assets for schema errors</li>
      </ul>
    `
  },
  {
    id: 'comp-context', title: 'Context (Semantic Search)', _sub: true, children: [],
    content: `
      <h2>Context — Semantic Code Search</h2>
      <p>Index repositories and search code using natural language. Powered by <code>sqlite-vec</code> vector embeddings.</p>

      <h3>Indexing Pipeline</h3>
      ${_gSteps([
        { title: 'Walk file tree', desc: 'Traverse the repo, respecting .gitignore rules. Skip binaries, node_modules, etc.', color: 'var(--cyan)' },
        { title: 'Chunk files', desc: 'Split into ~500-line segments with 50-line overlap for context continuity', color: 'var(--green)' },
        { title: 'Generate embeddings', desc: '768-dimensional vectors using stsb-distilbert-base model (~260 MB, auto-downloads)', color: 'var(--magenta)' },
        { title: 'Store in sqlite-vec', desc: 'Vectors stored alongside file path, line range, and content for fast KNN retrieval', color: 'var(--orange)' },
      ])}

      <h3>Search</h3>
      <p>Type a natural-language query (e.g., "authentication middleware for JWT tokens") and get ranked code chunks by cosine similarity. Results include file path, line numbers, and a relevance score.</p>

      <h3>MCP Tools</h3>
      <table class="guide-table">
        <tr><th>Tool</th><th>Purpose</th></tr>
        <tr><td><code>code_search(query, repo)</code></td><td>Semantic search across repo source code</td></tr>
        <tr><td><code>memory_bank_search(query, repo)</code></td><td>Search within memory bank markdown files</td></tr>
        <tr><td><code>repos_list()</code></td><td>List all indexed repos with README excerpts</td></tr>
        <tr><td><code>repo_status()</code></td><td>Index health: chunk count, last indexed, errors</td></tr>
        <tr><td><code>memory_resources_list(repo)</code></td><td>Browse available memory bank files</td></tr>
        <tr><td><code>memory_resources_read(uri)</code></td><td>Read a specific memory bank file</td></tr>
      </table>

      <h3>Memory Bank</h3>
      <p>The memory bank stores markdown documents that AI agents can search and reference. Think of it as a project-scoped knowledge base for common patterns, decisions, and documentation.</p>
    `
  },
  {
    id: 'comp-knowledge', title: 'Knowledge Graph', _sub: true, children: [],
    content: `
      <h2>Knowledge Graph</h2>
      <p>An interactive force-directed graph for mapping your engineering ecosystem — clients, domains, services, technologies, and developer insights.</p>

      <h3>Graph Visualization</h3>
      <div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:rgba(0,0,0,0.3);margin:12px 0;text-align:center;">
        <div style="display:inline-flex;gap:16px;flex-wrap:wrap;justify-content:center;">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(59,130,246,0.2);border:2px solid #3b82f6;display:flex;align-items:center;justify-content:center;font-size:0.5rem;color:#3b82f6;">UBS</div>
          <div style="width:28px;height:28px;border-radius:50%;background:rgba(6,182,212,0.2);border:2px solid #06b6d4;display:flex;align-items:center;justify-content:center;font-size:0.4rem;color:#06b6d4;">Auth</div>
          <div style="width:32px;height:32px;border-radius:50%;background:rgba(34,197,94,0.2);border:2px solid #22c55e;display:flex;align-items:center;justify-content:center;font-size:0.4rem;color:#22c55e;">icn</div>
          <div style="width:24px;height:24px;border-radius:50%;background:rgba(245,158,11,0.2);border:2px solid #f59e0b;display:flex;align-items:center;justify-content:center;font-size:0.4rem;color:#f59e0b;">Rails</div>
          <div style="width:30px;height:30px;border-radius:50%;background:rgba(168,85,247,0.2);border:2px solid #a855f7;display:flex;align-items:center;justify-content:center;font-size:0.35rem;color:#a855f7;">acl</div>
          <div style="width:26px;height:26px;border-radius:50%;background:rgba(239,68,68,0.2);border:2px solid #ef4444;display:flex;align-items:center;justify-content:center;font-size:0.35rem;color:#ef4444;">tip</div>
        </div>
        <div style="font-size:0.45rem;color:var(--text-dim);margin-top:10px;">Nodes are sized by connection count, colored by type, clustered by category</div>
      </div>

      <h3>Node Types & Colors</h3>
      <table class="guide-table">
        <tr><th style="width:30px;">Color</th><th>Type</th><th>Examples</th><th>Graph Layer</th></tr>
        <tr><td style="color:#f97316;">●</td><td>client</td><td>Fidelity, UBS, Halo</td><td>Business</td></tr>
        <tr><td style="color:#3b82f6;">●</td><td>domain</td><td>Auth/SSO, Holdings, Orders</td><td>Business</td></tr>
        <tr><td style="color:#06b6d4;">●</td><td>service</td><td>icn, simonapp, auth-service</td><td>Stack</td></tr>
        <tr><td style="color:#84cc16;">●</td><td>library</td><td>icn-user-acl, shared-utils</td><td>Stack</td></tr>
        <tr><td style="color:#8b5cf6;">●</td><td>technology</td><td>Rails, Redis, Kafka, Okta</td><td>Stack</td></tr>
        <tr><td style="color:#f59e0b;">●</td><td>insight</td><td>Developer knowledge, patterns</td><td>All</td></tr>
        <tr><td style="color:#10b981;">●</td><td>project</td><td>Workspace-scoped initiatives and delivery threads</td><td>All</td></tr>
        <tr><td style="color:#ec4899;">●</td><td>concept</td><td>Shared abstractions, patterns, and ideas</td><td>All</td></tr>
        <tr><td style="color:#6366f1;">●</td><td>repo</td><td>Source repositories and codebases</td><td>Stack</td></tr>
        <tr><td style="color:#14b8a6;">●</td><td>session</td><td>AI session history and execution context</td><td>All</td></tr>
        <tr><td style="color:#ef4444;">●</td><td>issue</td><td>Known bugs, tech debt items</td><td>All</td></tr>
      </table>

      <h3>Staged Workflow</h3>
      ${_gFlow([
        { icon: '📝', title: 'Store (staged)', desc: 'AI agent creates node via MCP', color: 'var(--yellow)' },
        { icon: '🔍', title: 'Review', desc: 'Staged nodes show amber "STAGED" badge', color: 'var(--orange)' },
        { icon: '✓', title: 'Commit', desc: 'commit_workspace() publishes to graph', color: 'var(--green)' },
      ])}

      <h3>Interactions</h3>
      <ul>
        <li><strong>Click node</strong> — select and show detail panel (title, type, content, edges)</li>
        <li><strong>Click node again</strong> — auto-explore depth 1 (load neighbors)</li>
        <li><strong>Search bar</strong> — filter nodes by title/content</li>
        <li><strong>Layer buttons</strong> — switch between Business, Stack, and All views</li>
        <li><strong>Filter chips</strong> — toggle individual node types on/off</li>
        <li><strong>Zoom</strong> — scroll to zoom, drag to pan. Reset with the zoom button</li>
      </ul>

      <h3>MCP Tools</h3>
      <table class="guide-table">
        <tr><th>Tool</th><th>Purpose</th></tr>
        <tr><td><code>store(title, content, ...)</code></td><td>Create a staged node (requires workspace_id)</td></tr>
        <tr><td><code>commit_workspace(workspace_id)</code></td><td>Publish all staged nodes for a workspace</td></tr>
        <tr><td><code>update_node(node_id, ...)</code></td><td>Edit an existing node (no workspace required)</td></tr>
        <tr><td><code>search(query)</code></td><td>Full-text search across nodes</td></tr>
        <tr><td><code>neighbors(node_id)</code></td><td>Get connected nodes and edges</td></tr>
        <tr><td><code>connect(source, target, type)</code></td><td>Create an edge between two nodes</td></tr>
        <tr><td><code>disconnect(edge_id)</code></td><td>Remove an edge</td></tr>
        <tr><td><code>prune()</code></td><td>Clean up dangling edges</td></tr>
      </table>
    `
  },
  {
    id: 'comp-notifications', title: 'Notifications', _sub: true, children: [],
    content: `
      <h2>Notifications</h2>
      <p>The <strong>bell icon</strong> in the top bar shows a history of all events and alerts. Every toast message (indexing progress, errors, MCP events) is logged here.</p>

      <h3>Notification Sources</h3>
      <ul>
        <li><strong>Session events</strong> — new sessions detected, sessions going stuck</li>
        <li><strong>MCP events</strong> — workspace created, task completed, nodes committed</li>
        <li><strong>Indexing</strong> — context indexing progress and completion</li>
        <li><strong>Errors</strong> — API failures, MCP disconnections, import errors</li>
        <li><strong>System</strong> — startup complete, config patched, server health changes</li>
      </ul>

      <p>Click the bell to open the notification panel. Unread notifications show as a count badge on the bell icon.</p>
    `
  },
  {
    id: 'comp-debug', title: 'Debug Log', _sub: true, children: [],
    content: `
      <h2>Debug Log</h2>
      <p>Click the <strong>📋 icon</strong> in the left action bar (GUI mode) to open the full-screen debug log panel.</p>

      <h3>Log Levels</h3>
      <table class="guide-table">
        <tr><th>Level</th><th>Color</th><th>Content</th></tr>
        <tr><td>OK</td><td style="color:var(--green);">Green</td><td>Successful operations (server started, data loaded)</td></tr>
        <tr><td>ERROR</td><td style="color:var(--red);">Red</td><td>Failures (API errors, parse failures, crashes)</td></tr>
        <tr><td>WARN</td><td style="color:var(--yellow);">Yellow</td><td>Non-critical issues (timeouts, fallbacks)</td></tr>
        <tr><td>MCP</td><td style="color:var(--magenta);">Magenta</td><td>MCP server events (tool calls, connections)</td></tr>
        <tr><td>FLASK</td><td style="color:var(--cyan);">Cyan</td><td>Flask backend logs (routes, queries)</td></tr>
        <tr><td>INFO</td><td style="color:var(--text-dim);">Dim</td><td>General informational messages</td></tr>
        <tr><td>SYS</td><td style="color:var(--text);">White</td><td>System-level events (startup, shutdown)</td></tr>
        <tr><td>STEP</td><td style="color:var(--orange);">Orange</td><td>Startup sequence step progress</td></tr>
      </table>

      <h3>Features</h3>
      <ul>
        <li><strong>Text filter</strong> — type to search within log messages</li>
        <li><strong>Level filter</strong> — dropdown to show only specific levels</li>
        <li><strong>Clear</strong> — wipe all entries (🗑 button)</li>
        <li><strong>Auto-scroll</strong> — new entries appear at the bottom</li>
      </ul>

      <h3>External Logs</h3>
      <p>The main process log file is at:<br><code>~/Library/Application Support/savant/savant-main.log</code></p>
      <p>View it with: <code>tail -f ~/Library/Application\\ Support/savant/savant-main.log</code></p>
    `
  },

  // Developer Guide overview
  {
    id: 'dev-guide', title: 'Developer Guide', _sub: true, children: [],
    content: `
      <h2>Developer Guide</h2>
      <p>Everything you need to start contributing to Savant.</p>
      ${_gFlow([
        { icon: '🔧', title: 'Setup', desc: 'Install deps, run dev mode', color: 'var(--cyan)' },
        { icon: '🧪', title: 'Test', desc: 'pytest + fixtures', color: 'var(--green)' },
        { icon: '🏗', title: 'Build', desc: 'Add features, MCP tools', color: 'var(--magenta)' },
        { icon: '📦', title: 'Package', desc: 'npm run build → DMG', color: 'var(--orange)' },
      ])}
      <h3>Project Structure</h3>
      <pre><code>savant-app/
├── main.js              # Electron entry point
├── preload.js           # IPC bridge for terminal
├── package.json         # Electron + build config
├── archive.sh           # Build archival script
├── INSTALL.md           # Distribution guide
├── CLAUDE.md            # AI coding instructions
└── savant/              # Flask app (extraResources)
    ├── app.py           # Flask REST API
    ├── sqlite_client.py # DB singleton + schema
    ├── models.py        # Pydantic models
    ├── db/              # DB entity classes
    ├── mcp/             # MCP server files
    ├── abilities/       # YAML prompt assets
    ├── context/         # Semantic search engine
    ├── knowledge/       # KG helpers
    ├── templates/       # Jinja2 HTML
    ├── static/          # CSS + JS
    │   ├── css/
    │   └── js/
    └── tests/           # pytest test suite</code></pre>
    `
  },
  {
    id: 'dev-setup', title: 'Setup & Run', _sub: true, children: [],
    content: `
      <h2>Setup & Run</h2>

      <h3>Prerequisites</h3>
      <table class="guide-table">
        <tr><th>Dependency</th><th>Version</th><th>Install</th></tr>
        <tr><td>Node.js</td><td>18+</td><td><code>brew install node</code></td></tr>
        <tr><td>Python</td><td>3.11+</td><td><code>brew install python3</code></td></tr>
        <tr><td>pip packages</td><td>—</td><td><code>pip3 install -r savant/requirements.txt</code></td></tr>
      </table>

      <h3>Dev Mode</h3>
      ${_gSteps([
        { title: 'Install Node deps', desc: '<code>npm install</code> — installs Electron, node-pty, and build tools', color: 'var(--cyan)' },
        { title: 'Install Python deps', desc: '<code>pip3 install -r savant/requirements.txt</code> — Flask, sqlite-vec, etc.', color: 'var(--green)' },
        { title: 'Run', desc: '<code>npm run dev</code> — starts Electron + Flask + 4 MCP servers', color: 'var(--magenta)' },
      ])}

      <h3>Production Build</h3>
      <pre><code>npm run build        # Build macOS DMG + .app directory
./archive.sh         # Copy DMG to arch-version/&lt;version&gt;/</code></pre>

      <h3>Deploy to /Applications</h3>
      <pre><code>osascript -e 'quit app "Savant"' && sleep 2
rm -rf dist && npm run build
rsync -a --delete dist/mac-arm64/Savant.app/ /Applications/Savant.app/
open /Applications/Savant.app</code></pre>

      <h3>Data Locations</h3>
      <table class="guide-table">
        <tr><th>What</th><th>Path</th></tr>
        <tr><td>Database</td><td><code>~/.savant/savant.db</code></td></tr>
        <tr><td>Logs</td><td><code>~/Library/Application Support/savant/savant-main.log</code></td></tr>
        <tr><td>Meta / session index</td><td><code>~/.savant/meta/</code></td></tr>
        <tr><td>Copilot sessions</td><td><code>~/.copilot-cli/sessions/</code></td></tr>
        <tr><td>Claude sessions</td><td><code>~/.claude/projects/</code></td></tr>
        <tr><td>Codex sessions</td><td><code>~/.codex/sessions/</code></td></tr>
        <tr><td>Gemini sessions</td><td><code>~/.gemini/tmp/savant-app/chats/</code></td></tr>
        <tr><td>Hermes sessions</td><td><code>~/.hermes/sessions/</code></td></tr>
      </table>
    `
  },
  {
    id: 'dev-testing', title: 'Testing', _sub: true, children: [],
    content: `
      <h2>Testing</h2>

      <h3>Running Tests</h3>
      <pre><code>cd savant
python3 -m pytest tests/ -v --timeout=10     # All tests
python3 -m pytest tests/test_foo.py -v        # Single file
python3 -m pytest tests/test_foo.py::test_bar # Single test</code></pre>

      <h3>Test Infrastructure</h3>
      <table class="guide-table">
        <tr><th>Fixture</th><th>Purpose</th></tr>
        <tr><td><code>_isolated_db</code></td><td>Creates a temp SQLite DB per test, auto-cleaned</td></tr>
        <tr><td><code>client</code></td><td>Flask test client for HTTP requests</td></tr>
        <tr><td><code>sample_workspace</code></td><td>Pre-populated workspace for testing</td></tr>
        <tr><td><code>sample_tasks</code></td><td>Pre-populated tasks across statuses</td></tr>
      </table>

      <h3>Test Flow</h3>
      ${_gFlow([
        { icon: '🗃', title: 'Fixture', desc: 'Create temp DB + test client', color: 'var(--cyan)' },
        { icon: '📡', title: 'Request', desc: 'Call Flask API endpoint', color: 'var(--green)' },
        { icon: '✓', title: 'Assert', desc: 'Check status code + response body', color: 'var(--magenta)' },
        { icon: '🧹', title: 'Cleanup', desc: 'Temp DB auto-deleted', color: 'var(--text-dim)' },
      ])}

      <h3>Writing a Test</h3>
      <pre><code>def test_create_workspace(client, _isolated_db):
    """Test workspace creation via REST API."""
    resp = client.post("/api/workspaces", json={
        "name": "Test Workspace",
        "description": "For testing",
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["name"] == "Test Workspace"
    assert data["status"] == "open"
    assert "workspace_id" in data</code></pre>

      <h3>Known Issues</h3>
      <ul>
        <li>Skip <code>test_ui.py</code> and <code>test_terminal.py</code> — they hang or segfault on Python 3.14</li>
        <li>Some teardown warnings about <code>RuntimeError: cannot schedule new futures</code> are harmless</li>
        <li>KG nodes created via POST default to <code>status=staged</code> — tests that need visible nodes must pass <code>"status": "committed"</code></li>
      </ul>
    `
  },
  {
    id: 'dev-adding-features', title: 'Adding Features', _sub: true, children: [],
    content: `
      <h2>Adding Features</h2>

      <h3>New DB Entity</h3>
      ${_gSteps([
        { title: 'Schema', desc: 'Add <code>CREATE TABLE</code> to <code>_SCHEMA_SQL</code> in <code>sqlite_client.py</code>', color: 'var(--cyan)' },
        { title: 'DB class', desc: 'Create <code>savant/db/&lt;entity&gt;.py</code> with <code>@staticmethod</code> CRUD methods', color: 'var(--green)' },
        { title: 'Pydantic model', desc: 'Add validation model in <code>models.py</code> (optional but recommended)', color: 'var(--magenta)' },
        { title: 'Flask routes', desc: 'Add REST endpoints in <code>app.py</code> or as a new Blueprint', color: 'var(--orange)' },
        { title: 'Tests', desc: 'Add test file in <code>savant/tests/</code> using <code>client</code> and <code>_isolated_db</code> fixtures', color: 'var(--yellow)' },
      ])}

      <h3>New MCP Server</h3>
      ${_gSteps([
        { title: 'Flask Blueprint', desc: 'Create REST endpoints for the new feature', color: 'var(--cyan)' },
        { title: 'MCP server file', desc: 'Create <code>savant/mcp/&lt;name&gt;_server.py</code> with FastMCP tools that proxy to Flask', color: 'var(--green)' },
        { title: 'Port registration', desc: 'Add entry to <code>MCP_SERVERS</code> in <code>main.js</code> (pick next port after 8094)', color: 'var(--magenta)' },
        { title: 'Config patching', desc: '<code>setupMcpConfigs()</code> auto-registers SSE entries for the new server', color: 'var(--orange)' },
        { title: 'UI tab', desc: 'Add sub-tab button and view container in the MCP tab', color: 'var(--yellow)' },
      ])}
      <p>See <code>.github/copilot-instructions.md</code> for the detailed checklist and template.</p>

      <h3>New Frontend Tab</h3>
      ${_gSteps([
        { title: 'Tab button', desc: 'Add button in the mode switcher component (<code>_header.html</code>)', color: 'var(--cyan)' },
        { title: 'View container', desc: 'Add <code>&lt;div id="new-view"&gt;</code> in <code>index.html</code>', color: 'var(--green)' },
        { title: 'JS file', desc: 'Create <code>savant/static/js/new-feature.js</code> and include via script tag', color: 'var(--magenta)' },
        { title: 'Tab switching', desc: 'Wire up in <code>_applyTabUI()</code> and <code>_switchTabInner()</code> in <code>core.js</code>', color: 'var(--orange)' },
        { title: 'Breadcrumb', desc: 'Update <code>updateBreadcrumb()</code> in <code>status-bar.js</code> if needed', color: 'var(--yellow)' },
      ])}
    `
  },
  {
    id: 'dev-conventions', title: 'Conventions', _sub: true, children: [],
    content: `
      <h2>Conventions</h2>

      <h3>Code Style</h3>
      <table class="guide-table">
        <tr><th>Language</th><th>Style</th></tr>
        <tr><td>Python</td><td>Standard library style, no Black/Ruff enforced. 4-space indent.</td></tr>
        <tr><td>JavaScript</td><td>Vanilla ES6+, no framework, no TypeScript. 2-space indent.</td></tr>
        <tr><td>CSS</td><td>Custom properties (vars), no preprocessor. Dark theme variables.</td></tr>
        <tr><td>HTML</td><td>Jinja2 templates with components in <code>templates/components/</code></td></tr>
      </table>

      <h3>DB Entity Pattern</h3>
      <pre><code># savant/db/&lt;entity&gt;.py
class EntityDB:
    @staticmethod
    def create(data: dict) -> dict:
        conn = get_connection()
        # INSERT INTO ...
        conn.commit()
        return EntityDB.get_by_id(data["id"])

    @staticmethod
    def get_by_id(id: str) -> dict | None: ...

    @staticmethod
    def list_all(**filters) -> list[dict]: ...

    @staticmethod
    def update(id: str, updates: dict) -> dict | None: ...

    @staticmethod
    def delete(id: str) -> bool: ...</code></pre>

      <h3>MCP Tool Pattern</h3>
      <pre><code>@mcp.tool()
def tool_name(param: str, optional: str = "default") -> dict:
    """Tool description shown to AI agents.

    Args:
        param: Description of required param
        optional: Description with default
    """
    return _api("POST", "/api/endpoint", json={...})</code></pre>

      <h3>ID Generation</h3>
      <p>All entity IDs use <code>_unique_ts_id()</code> — millisecond timestamp + random suffix to avoid collisions in rapid creation.</p>

      <h3>Timestamps</h3>
      <p>All timestamps are <strong>ISO 8601 UTC strings</strong>: <code>2026-04-11T14:30:00+00:00</code></p>

      <h3>Packaging</h3>
      <ul>
        <li><code>savant/</code> goes into Electron's <code>extraResources</code> (not asar)</li>
        <li>In packaged mode: <code>process.resourcesPath + "/savant"</code></li>
        <li>Python resolved from: <code>/opt/homebrew/bin/python3</code> → <code>/usr/local/bin/python3</code> → <code>/usr/bin/python3</code> → <code>python3</code></li>
        <li>Flask is verified at startup with <code>python3 -c "import flask"</code></li>
      </ul>
    `
  },

  // Keyboard Shortcuts (nested under "How it's Built" in tree)
  {
    id: 'keyboard-shortcuts', title: 'Keyboard Shortcuts', _sub: true, children: [],
    content: `
      <h2>Keyboard Shortcuts</h2>

      <h3>Global</h3>
      <table class="guide-table">
        <tr><th>Key</th><th>Action</th><th>Context</th></tr>
        <tr><td><kbd>⌘K</kbd></td><td>Command palette</td><td>Anywhere</td></tr>
        <tr><td><kbd>⌘N</kbd></td><td>New window (multi-monitor)</td><td>Anywhere</td></tr>
        <tr><td><kbd>⌘⇧B</kbd></td><td>Open in browser</td><td>Anywhere</td></tr>
        <tr><td><kbd>/</kbd></td><td>Focus search</td><td>Dashboard</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Clear focus / close overlay</td><td>Anywhere</td></tr>
      </table>

      <h3>Sessions Tab</h3>
      <table class="guide-table">
        <tr><th>Key</th><th>Action</th></tr>
        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Navigate cards down / up</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Expand / collapse focused card</td></tr>
        <tr><td><kbd>s</kbd></td><td>Star / unstar focused card</td></tr>
        <tr><td><kbd>/</kbd></td><td>Focus search bar</td></tr>
      </table>

      <h3>Tasks Tab</h3>
      <table class="guide-table">
        <tr><th>Key</th><th>Action</th></tr>
        <tr><td><kbd>N</kbd></td><td>New task</td></tr>
        <tr><td><kbd>J</kbd> / <kbd>K</kbd></td><td>Navigate down / up within column</td></tr>
        <tr><td><kbd>H</kbd> / <kbd>L</kbd></td><td>Move task to previous / next status column</td></tr>
        <tr><td><kbd>D</kbd></td><td>Quick mark as done</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Edit selected task</td></tr>
        <tr><td><kbd>X</kbd></td><td>Delete selected task</td></tr>
        <tr><td><kbd>E</kbd></td><td>End day — roll incomplete tasks to tomorrow</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Deselect task</td></tr>
      </table>

      <h3>Terminal</h3>
      <table class="guide-table">
        <tr><th>Key</th><th>Action</th></tr>
        <tr><td><kbd>⌘T</kbd></td><td>New terminal tab</td></tr>
        <tr><td><kbd>⌘W</kbd></td><td>Close current tab/pane</td></tr>
        <tr><td><kbd>⌘D</kbd></td><td>Split pane vertically (right)</td></tr>
        <tr><td><kbd>⌘⇧D</kbd></td><td>Split pane horizontally (down)</td></tr>
        <tr><td><kbd>⌘[</kbd> / <kbd>⌘]</kbd></td><td>Previous / next pane</td></tr>
        <tr><td><kbd>⌘{</kbd> / <kbd>⌘}</kbd></td><td>Previous / next tab</td></tr>
      </table>
    `
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. AI AGENT SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'ai-agent-setup', title: 'AI Agent Setup', children: [
      { id: 'agent-setup-flow', title: 'What Happens on Setup', children: [] },
      { id: 'agent-providers', title: 'Supported Providers', children: [] },
      { id: 'agent-mcp-servers', title: 'MCP Servers Configured', children: [] },
     { id: 'agent-hermes-skills', title: 'Hermes Skills', children: [] },
     { id: 'agent-env-vars', title: 'Environment Variables', children: [] },
      { id: 'agent-using-hermes', title: 'Using Hermes (Recommended)', children: [] },
    ],
    content: `
      <h2>AI Agent Setup</h2>
      <p>Savant acts as a <strong>central hub</strong> for your AI coding agents. When you enable a provider in Preferences, Savant automatically configures that agent's MCP connections — so the agent can talk to Savant's servers and any installed CLI-based MCP tools.</p>

      ${_gFlow([
        { icon: '⚙️', title: 'Enable Provider', desc: 'Toggle in Preferences or call POST /api/setup-mcp', color: 'var(--cyan)' },
        { icon: '📝', title: 'Write Config', desc: 'Savant writes MCP entries to the agent\\\'s config file', color: 'var(--green)' },
        { icon: '🔗', title: 'Connect', desc: 'Agent discovers Savant + stdio servers via MCP', color: 'var(--magenta)' },
        { icon: '🧠', title: 'Use Tools', desc: 'Agent can manage workspaces, search code, build knowledge', color: 'var(--orange)' },
      ])}

      <h3>Key Design Principles</h3>
      <table class="guide-table">
        <tr><th>Principle</th><th>Details</th></tr>
        <tr><td style="color:var(--cyan);">Idempotent</td><td>Running setup multiple times is safe — entries are skipped if already present</td></tr>
        <tr><td style="color:var(--green);">No Credentials in Config</td><td>Agents inherit tokens from shell environment variables, nothing is written to config files</td></tr>
        <tr><td style="color:var(--magenta);">Auto-detect Binaries</td><td>Stdio servers (gitlab, atlassian) are only added if the binary is found on the machine</td></tr>
        <tr><td style="color:var(--orange);">Content-based Dedup</td><td>Hermes skills are only overwritten if the source file has actually changed</td></tr>
      </table>
      <p>Select a sub-section from the tree to learn about each aspect.</p>
    `
  },
  {
    id: 'agent-setup-flow', title: 'What Happens on Setup', _sub: true, children: [],
    content: `
      <h2>What Happens on Setup</h2>
      <p>When you enable a provider (via the Preferences UI or <code>POST /api/setup-mcp</code>), Savant performs these steps:</p>

      ${_gSteps([
        { title: 'Locate Config File', desc: 'Each provider stores MCP config in a different location and format (JSON, YAML, or TOML). Savant knows where each one lives.', color: 'var(--cyan)' },
        { title: 'Add Savant SSE Servers', desc: 'Adds entries for savant-workspace (:8091), savant-abilities (:8092), savant-context (:8093), and savant-knowledge (:8094). These are HTTP-based MCP servers Savant runs locally.', color: 'var(--green)' },
        { title: 'Add Stdio Servers', desc: 'Checks if gitlab-mcp and mcp-atlassian binaries are installed. If found, adds them as stdio-type MCP entries. If not installed, silently skips.', color: 'var(--magenta)' },
        { title: 'Hermes Extras', desc: 'For Hermes only: patches SSE transport support into the agent, then installs/updates 4 Savant skill files to ~/.hermes/skills/savant/.', color: 'var(--orange)' },
      ])}

      <h3>Already Configured?</h3>
      <p>If MCP is already configured for a provider, Savant checks each entry individually. Missing servers are added, existing ones are left untouched. For Hermes, skill files are still checked for updates even if MCP config hasn't changed.</p>

      <h3>API</h3>
      <table class="guide-table">
        <tr><th>Endpoint</th><th>Method</th><th>Description</th></tr>
        <tr><td><code>/api/setup-mcp</code></td><td>POST</td><td>Configure MCP for a provider. Body: <code>{ "provider": "hermes" }</code></td></tr>
        <tr><td><code>/api/check-mcp</code></td><td>GET</td><td>Check which providers have MCP configured. Returns per-provider status.</td></tr>
      </table>
    `
  },
  {
    id: 'agent-providers', title: 'Supported Providers', _sub: true, children: [],
    content: `
      <h2>Supported Providers</h2>
      <p>Each AI coding agent stores its MCP configuration in a different file and format. Savant handles all of them:</p>

      <table class="guide-table">
        <tr><th>Provider</th><th>Config File</th><th>Format</th><th>Extra Setup</th></tr>
       <tr><td style="color:var(--cyan);">Copilot CLI</td><td><code>~/.copilot/mcp-config.json</code></td><td>JSON</td><td>—</td></tr>
       <tr><td style="color:var(--green);">Claude Code</td><td><code>.mcp.json</code> (project-level)</td><td>JSON</td><td>—</td></tr>
       <tr><td style="color:var(--magenta);">Codex</td><td><code>~/.codex/config.toml</code></td><td>TOML</td><td>—</td></tr>
        <tr><td style="color:var(--yellow);">Gemini CLI</td><td><code>~/.gemini/settings.json</code></td><td>JSON</td><td>—</td></tr>
        <tr><td style="color:var(--orange);">Hermes ⭐</td><td><code>~/.hermes/config.yaml</code></td><td>YAML</td><td>SSE patches + skill install</td></tr>
      </table>

      <h3>Format Differences</h3>
      <p>The same MCP server entry looks different in each format, but Savant handles the translation automatically:</p>

      <h4>JSON (Copilot / Claude)</h4>
      <pre style="background:var(--bg-main);color:var(--text);padding:10px;border-radius:6px;font-size:0.5rem;overflow-x:auto;">{
  "savant-workspace": {
    "url": "http://127.0.0.1:8091/sse",
    "type": "sse",
    "tools": ["*"],
    "headers": {}
  }
}</pre>

      <h4>YAML (Hermes)</h4>
      <pre style="background:var(--bg-main);color:var(--text);padding:10px;border-radius:6px;font-size:0.5rem;overflow-x:auto;">mcp_servers:
  savant-workspace:
    url: http://127.0.0.1:8091/sse
    timeout: 120</pre>

      <h4>TOML (Codex)</h4>
      <pre style="background:var(--bg-main);color:var(--text);padding:10px;border-radius:6px;font-size:0.5rem;overflow-x:auto;">[mcp_servers."savant-workspace"]
type = "stdio"
command = "/path/to/python3"
args = ["/path/to/savant/mcp/stdio.py", "workspace"]</pre>
      <p><em>Note: Codex uses stdio transport via a Python bridge script, while other providers connect directly over HTTP/SSE.</em></p>
    `
  },
  {
    id: 'agent-mcp-servers', title: 'MCP Servers Configured', _sub: true, children: [],
    content: `
      <h2>MCP Servers Configured</h2>
      <p>Savant adds two categories of MCP servers to each agent's config:</p>

      <h3>Savant SSE Servers (always added)</h3>
      <p>These are Savant's own MCP servers, running locally as HTTP services:</p>
      <table class="guide-table">
        <tr><th>Server</th><th>Port</th><th>What It Does</th></tr>
        <tr><td style="color:var(--cyan);">savant-workspace</td><td>8091</td><td>Workspaces, tasks, Jira tickets, merge requests, session notes, session assignment</td></tr>
        <tr><td style="color:var(--magenta);">savant-abilities</td><td>8092</td><td>Personas, rules, policies, styles — prompt resolution and YAML asset management</td></tr>
        <tr><td style="color:var(--green);">savant-context</td><td>8093</td><td>Semantic code search across indexed repos, memory bank search, repository info</td></tr>
        <tr><td style="color:var(--orange);">savant-knowledge</td><td>8094</td><td>Knowledge graph — store, search, traverse, and connect nodes (insights, services, domains, etc.)</td></tr>
      </table>

      <h3>Stdio MCP Servers (added if binary is installed)</h3>
      <p>These are standalone CLI tools that run as subprocesses:</p>
      <table class="guide-table">
        <tr><th>Server</th><th>Binary</th><th>Install</th><th>What It Does</th></tr>
        <tr><td style="color:var(--cyan);">gitlab</td><td><code>gitlab-mcp</code></td><td><code>pip install gitlab-mcp</code></td><td>GitLab issues, merge requests, pipelines, repos, discussions, snippets</td></tr>
        <tr><td style="color:var(--magenta);">atlassian</td><td><code>mcp-atlassian</code></td><td><code>pip install mcp-atlassian</code></td><td>Jira tickets and Confluence pages via Atlassian API</td></tr>
      </table>
      <p>Savant checks <code>which &lt;binary&gt;</code> before adding these entries. If the tool isn't installed, that entry is silently skipped — no errors, no broken config.</p>

      <h3>What Agents Can Do After Setup</h3>
      <p>Once configured, every agent gets access to these capabilities via MCP tools:</p>
      ${_gFlow([
        { icon: '🔍', title: 'Search Code', desc: 'Semantic search across all indexed repos', color: 'var(--cyan)' },
        { icon: '📋', title: 'Manage Work', desc: 'Create tasks, track Jira tickets & MRs', color: 'var(--green)' },
        { icon: '🧠', title: 'Build Knowledge', desc: 'Persistent graph across sessions', color: 'var(--orange)' },
        { icon: '🎭', title: 'Load Personas', desc: 'Consistent agent behavior via abilities', color: 'var(--magenta)' },
      ])}
    `
  },
  {
    id: 'agent-hermes-skills', title: 'Hermes Skills', _sub: true, children: [],
    content: `
      <h2>Hermes Skills</h2>
      <p>When Hermes is enabled, Savant installs 4 skill files into <code>~/.hermes/skills/savant/</code>. These give Hermes detailed knowledge about how to use Savant's MCP tools effectively.</p>

      <table class="guide-table">
        <tr><th>Skill</th><th>What It Covers</th></tr>
        <tr><td style="color:var(--cyan);">platform</td><td>Comprehensive guide to all 4 MCP servers — abilities (personas, rules, policies), workspaces (lifecycle, tasks, Jira, MRs, sessions), knowledge graph (node types, edges, store/search/traverse), and context (code search, memory bank, repos)</td></tr>
        <tr><td style="color:var(--green);">gitlab-mr-review</td><td>GitLab merge request review workflow — fetching diffs, leaving inline comments, creating Savant workspaces for reviews, writing structured review documents</td></tr>
        <tr><td style="color:var(--magenta);">session-provider</td><td>How to add new AI session providers to Savant — parser implementation, Flask routes, UI integration, background cache</td></tr>
        <tr><td style="color:var(--orange);">test-runner</td><td>Running Savant's pytest suite safely — avoiding segfaults from sqlite-vec, correct Python version, test isolation</td></tr>
      </table>

      <h3>How Installation Works</h3>
      ${_gSteps([
        { title: 'Source Files Live in Repo', desc: 'Skills are maintained as SKILL.md files inside the Savant codebase under savant/hermes_skill/ and savant/hermes_skills/.', color: 'var(--cyan)' },
        { title: 'Copied on Setup', desc: 'When POST /api/setup-mcp is called with provider=hermes, the installer copies each skill to ~/.hermes/skills/savant/<name>/SKILL.md.', color: 'var(--green)' },
        { title: 'Content-based Dedup', desc: 'Each file is compared byte-for-byte. Only changed files are overwritten — unchanged files are skipped. No unnecessary disk writes.', color: 'var(--magenta)' },
        { title: 'Auto-loaded by Hermes', desc: 'When Hermes encounters a task matching trigger conditions, it loads the skill automatically and follows its instructions.', color: 'var(--orange)' },
      ])}

      <h3>Updating Skills</h3>
      <p>To update a skill:</p>
      <ol>
        <li>Edit the source SKILL.md in the Savant repo (<code>savant/hermes_skill/</code> or <code>savant/hermes_skills/&lt;name&gt;/</code>)</li>
        <li>Rebuild and restart Savant (<code>bash build-and-deploy.sh</code>)</li>
        <li>The next MCP setup call will detect the change and overwrite the installed copy</li>
      </ol>
    `
  },
  {
    id: 'agent-env-vars', title: 'Environment Variables', _sub: true, children: [],
    content: `
      <h2>Environment Variables</h2>
      <p>No credentials are stored in agent config files. Agents inherit authentication tokens from shell environment variables. Set these in your shell profile (<code>~/.zshrc</code>, <code>~/.bashrc</code>, etc.):</p>

      <h3>GitLab</h3>
      <table class="guide-table">
        <tr><th>Variable</th><th>Description</th><th>Example</th></tr>
        <tr><td><code>GITLAB_TOKEN</code></td><td>Personal access token with API scope</td><td><code>glpat-xxxxxxxxxxxx</code></td></tr>
      </table>

      <h3>Atlassian (Jira + Confluence)</h3>
      <table class="guide-table">
        <tr><th>Variable</th><th>Description</th><th>Example</th></tr>
        <tr><td><code>JIRA_URL</code></td><td>Jira instance URL</td><td><code>https://your-org.atlassian.net</code></td></tr>
        <tr><td><code>JIRA_USERNAME</code></td><td>Email for Jira auth</td><td><code>you@company.com</code></td></tr>
        <tr><td><code>JIRA_API_TOKEN</code></td><td>Atlassian API token</td><td><code>xxxxx</code></td></tr>
        <tr><td><code>CONFLUENCE_URL</code></td><td>Confluence wiki URL</td><td><code>https://your-org.atlassian.net/wiki</code></td></tr>
        <tr><td><code>CONFLUENCE_USERNAME</code></td><td>Email for Confluence auth</td><td><code>you@company.com</code></td></tr>
        <tr><td><code>CONFLUENCE_API_TOKEN</code></td><td>Atlassian API token</td><td><code>xxxxx</code></td></tr>
      </table>

      <h3>Verifying Setup</h3>
      <p>Use the <code>GET /api/check-mcp</code> endpoint to verify all providers are configured. The response shows per-provider status and which servers are connected.</p>
      <p>In the MCP tab's Workspace sub-tab, the server health cards show real-time connectivity status for each Savant MCP server.</p>
    `
  },
  {
    id: 'agent-using-hermes', title: 'Using Hermes (Recommended)', _sub: true, children: [],
    content: `
      <h2>Using Hermes Agent <span style="color:var(--orange);">⭐ Recommended</span></h2>
      <p><strong>Hermes Agent</strong> is our preferred AI coding agent for working with Savant. It is an open-source agent by <a href="https://nousresearch.com" target="_blank" style="color:var(--cyan);">Nous Research</a> that runs in your terminal, messaging platforms, and IDEs. Unlike other agents, Hermes has persistent memory, a skill system, and deep MCP integration that makes it the most capable agent for Savant workflows.</p>

      <h3>Why Hermes?</h3>
      <table class="guide-table">
        <tr><th>Feature</th><th>Hermes</th><th>Other Agents</th></tr>
        <tr><td style="color:var(--cyan);">Skills</td><td>Learns from experience — saves reusable procedures as skill files that load into future sessions. Savant auto-installs 4 skills covering the full platform.</td><td>No skill system. Each session starts from scratch.</td></tr>
        <tr><td style="color:var(--green);">Persistent Memory</td><td>Remembers user preferences, environment details, and lessons across sessions. Never need to repeat yourself.</td><td>Limited or no cross-session memory.</td></tr>
        <tr><td style="color:var(--magenta);">Provider Agnostic</td><td>Works with 20+ LLM providers (OpenRouter, Anthropic, OpenAI, Google, DeepSeek, local models). Swap models mid-workflow.</td><td>Locked to one provider.</td></tr>
        <tr><td style="color:var(--orange);">MCP Integration</td><td>Native SSE + stdio MCP support. Savant auto-configures all servers and installs skills on setup.</td><td>Basic MCP support, manual config often needed.</td></tr>
        <tr><td style="color:var(--yellow);">Multi-Platform</td><td>CLI + Telegram + Discord + Slack + 10 more platforms. Same agent, same tools everywhere.</td><td>CLI only (most agents).</td></tr>
      </table>

      <h3>Installation</h3>
      <pre style="background:var(--bg-main);color:var(--text);padding:10px;border-radius:6px;font-size:0.5rem;overflow-x:auto;"># Install Hermes
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# Run setup wizard
hermes setup

# Pick your model/provider
hermes model

# Check everything works
hermes doctor</pre>

      <h3>Connecting to Savant</h3>
      <p>Once Hermes is installed, enable it in Savant:</p>
      ${_gSteps([
        { title: 'Enable in Preferences', desc: 'Open Savant Preferences, toggle Hermes ON. This triggers POST /api/setup-mcp automatically.', color: 'var(--cyan)' },
        { title: 'Auto-Config Happens', desc: 'Savant writes MCP server entries to ~/.hermes/config.yaml and copies 4 skill files to ~/.hermes/skills/savant/.', color: 'var(--green)' },
        { title: 'Start Hermes', desc: 'Run "hermes" in your terminal. It auto-discovers Savant MCP servers and loads skills when needed.', color: 'var(--magenta)' },
        { title: 'Verify', desc: 'In Hermes, type "/reload-mcp" to confirm all Savant servers connect. You should see workspace, abilities, context, and knowledge servers.', color: 'var(--orange)' },
      ])}

      <h3>Key Commands</h3>
      <table class="guide-table">
        <tr><th>Command</th><th>What It Does</th></tr>
        <tr><td><code>hermes</code></td><td>Start interactive chat (default)</td></tr>
        <tr><td><code>hermes chat -q "..."</code></td><td>Single query, non-interactive</td></tr>
        <tr><td><code>hermes --continue</code></td><td>Resume most recent session</td></tr>
        <tr><td><code>hermes --resume ID</code></td><td>Resume a specific session</td></tr>
        <tr><td><code>hermes -w</code></td><td>Worktree mode — isolated git branch per agent</td></tr>
        <tr><td><code>hermes -s savant:platform</code></td><td>Preload a specific skill</td></tr>
        <tr><td><code>hermes mcp list</code></td><td>List configured MCP servers</td></tr>
        <tr><td><code>hermes skills list</code></td><td>List installed skills</td></tr>
        <tr><td><code>hermes tools</code></td><td>Interactive tool enable/disable</td></tr>
      </table>

      <h3>Slash Commands (In-Session)</h3>
      <table class="guide-table">
        <tr><th>Command</th><th>What It Does</th></tr>
        <tr><td><code>/reload-mcp</code></td><td>Reconnect to all MCP servers (fixes dropped SSE connections)</td></tr>
        <tr><td><code>/skill platform</code></td><td>Load the Savant platform skill into current session</td></tr>
        <tr><td><code>/model</code></td><td>Switch model mid-session</td></tr>
        <tr><td><code>/new</code></td><td>Start a fresh session</td></tr>
        <tr><td><code>/tools</code></td><td>Manage enabled toolsets</td></tr>
        <tr><td><code>/voice on</code></td><td>Enable voice-to-voice mode</td></tr>
        <tr><td><code>/btw</code></td><td>Side question without interrupting the main task</td></tr>
      </table>

      <h3>What Hermes Can Do with Savant</h3>
      <p>Once connected, Hermes has access to ~150 MCP tools. Here are common workflows:</p>

      <h4 style="color:var(--cyan);">Workspace Management</h4>
      <pre style="background:var(--bg-main);color:var(--text);padding:8px;border-radius:6px;font-size:0.45rem;overflow-x:auto;">Ask Hermes: "Create a workspace for the auth refactor, add tasks for
the API changes and frontend updates, and link JIRA ticket AUTH-1234"

Hermes will:
  1. create_workspace("Auth Refactor")
  2. assign_session_to_workspace(workspace_id)
  3. create_task("Refactor auth API endpoints")
  4. create_task("Update frontend auth flow")
  5. create_jira_ticket(ticket_key="AUTH-1234")</pre>

      <h4 style="color:var(--green);">Code Search & Analysis</h4>
      <pre style="background:var(--bg-main);color:var(--text);padding:8px;border-radius:6px;font-size:0.45rem;overflow-x:auto;">Ask Hermes: "Find all code related to email notifications across our repos"

Hermes will:
  1. code_search(query="email notification send")
  2. Analyze results across indexed repos
  3. Summarize findings with file paths and line numbers</pre>

      <h4 style="color:var(--orange);">Knowledge Graph</h4>
      <pre style="background:var(--bg-main);color:var(--text);padding:8px;border-radius:6px;font-size:0.45rem;overflow-x:auto;">Ask Hermes: "Document what we learned about the caching architecture"

Hermes will:
  1. store(content="...", node_type="insight", workspace_id="...")
  2. connect(source_id, target_id, edge_type="relates_to")
  3. Knowledge persists across all future sessions</pre>

      <h4 style="color:var(--magenta);">MR Reviews</h4>
      <pre style="background:var(--bg-main);color:var(--text);padding:8px;border-radius:6px;font-size:0.45rem;overflow-x:auto;">Ask Hermes: "Review MR !456 in the networks project"

Hermes will:
  1. Load the gitlab-mr-review skill automatically
  2. Fetch MR diffs, discussions, and pipeline status
  3. Create a Savant workspace for the review
  4. Write a structured review with findings</pre>

      <h3>Tips</h3>
      <ul>
        <li><strong>SSE connections drop after idle periods.</strong> If tools stop working, type <code>/reload-mcp</code> to reconnect.</li>
        <li><strong>Skills auto-load.</strong> You rarely need to manually load a skill — Hermes matches tasks to skills automatically.</li>
        <li><strong>Memory is persistent.</strong> Tell Hermes your preferences once (coding style, project conventions, etc.) and it remembers across sessions.</li>
        <li><strong>Use worktree mode (<code>-w</code>)</strong> when running multiple Hermes instances on the same repo to avoid git conflicts.</li>
        <li><strong>Cron jobs</strong> let you schedule recurring tasks (daily standup summaries, monitoring, etc.) via the <code>cronjob</code> tool.</li>
      </ul>

      <h3>Docs & Resources</h3>
      <ul>
        <li><a href="https://hermes-agent.nousresearch.com/docs/" target="_blank" style="color:var(--cyan);">Full Documentation</a></li>
        <li><a href="https://github.com/NousResearch/hermes-agent" target="_blank" style="color:var(--green);">GitHub Repository</a></li>
        <li><a href="https://hermes-agent.nousresearch.com/docs/user-guide/configuration" target="_blank" style="color:var(--magenta);">Configuration Reference</a></li>
        <li><a href="https://hermes-agent.nousresearch.com/docs/integrations/providers" target="_blank" style="color:var(--orange);">Provider Setup Guide</a></li>
      </ul>
    `
  },
];

// Flatten for search
function _guideFlatten(nodes, result) {
  for (const n of nodes) {
    result.push(n);
    if (n.children && n.children.length) _guideFlatten(n.children, result);
  }
  return result;
}
const _guideFlat = _guideFlatten(_guideTree, []);

function _guideRenderTree(nodes, depth) {
  let html = '';
  for (const n of nodes) {
    // Skip _sub nodes at top level — they're content-only, referenced by nested tree
    if (depth === 0 && n._sub) continue;
    const indent = depth * 14;
    const hasKids = n.children && n.children.length > 0;
    const arrow = hasKids ? '<span class="guide-tree-arrow">▸</span>' : '<span class="guide-tree-arrow" style="visibility:hidden">▸</span>';
    html += `<div class="guide-tree-item" data-id="${n.id}" style="padding-left:${indent}px" onclick="guideTreeClick('${n.id}', ${hasKids})">
      ${arrow}<span class="guide-tree-label">${n.title}</span>
    </div>`;
    if (hasKids) {
      html += `<div class="guide-tree-children" data-parent="${n.id}">`;
      html += _guideRenderTree(n.children, depth + 1);
      html += '</div>';
    }
  }
  return html;
}

function openGuide(sectionId) {
  const overlay = document.getElementById('guide-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const tree = document.getElementById('guide-tree');
  tree.innerHTML = _guideRenderTree(_guideTree, 0);
  // Start collapsed — children hidden by CSS default
  guideNavigate(sectionId || 'what-is-savant');
  document.getElementById('guide-search').value = '';
  document.getElementById('guide-search').focus();
}

function closeGuide() {
  const overlay = document.getElementById('guide-overlay');
  if (overlay) overlay.style.display = 'none';
}

function guideTreeClick(id, hasKids) {
  if (hasKids) {
    // Toggle children visibility
    const children = document.querySelector(`.guide-tree-children[data-parent="${id}"]`);
    const item = document.querySelector(`.guide-tree-item[data-id="${id}"]`);
    const arrow = item?.querySelector('.guide-tree-arrow');
    if (children) {
      const computed = window.getComputedStyle(children).display;
      const isHidden = computed === 'none';
      children.style.display = isHidden ? 'block' : 'none';
      if (arrow) arrow.textContent = isHidden ? '▾' : '▸';
    }
  }
  guideNavigate(id);
}

function guideNavigate(id) {
  // Prefer the node that has content (sub nodes with content come after tree-structure stubs)
  const node = _guideFlat.find(n => n.id === id && n.content) || _guideFlat.find(n => n.id === id);
  if (!node) return;
  const content = document.getElementById('guide-content');
  content.innerHTML = node.content || `<h2>${node.title}</h2><p>Select a sub-section from the tree.</p>`;
  // Highlight active and expand parent tree sections
  document.querySelectorAll('.guide-tree-item').forEach(el => el.classList.remove('active'));
  const active = document.querySelector(`.guide-tree-item[data-id="${id}"]`);
  if (active) {
    active.classList.add('active');
    // Expand all ancestor tree-children containers
    let parent = active.parentElement;
    while (parent) {
      if (parent.classList && parent.classList.contains('guide-tree-children')) {
        parent.style.display = 'block';
        const parentId = parent.dataset.parent;
        const parentArrow = document.querySelector(`.guide-tree-item[data-id="${parentId}"] .guide-tree-arrow`);
        if (parentArrow) parentArrow.textContent = '▾';
      }
      parent = parent.parentElement;
    }
    active.scrollIntoView({ block: 'nearest' });
  }
  // Scroll content to top
  content.scrollTop = 0;
}

// Close on Esc
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('guide-overlay')?.style.display !== 'none') {
    closeGuide();
    e.stopPropagation();
  }
});

function guideSearch(query) {
  const q = query.toLowerCase().trim();
  const tree = document.getElementById('guide-tree');
  const items = tree.querySelectorAll('.guide-tree-item');
  if (!q) {
    items.forEach(el => el.style.display = '');
    tree.querySelectorAll('.guide-tree-children').forEach(el => el.style.display = 'block');
    return;
  }
  // Search in titles and content
  const matchIds = new Set();
  for (const n of _guideFlat) {
    const inTitle = n.title.toLowerCase().includes(q);
    const inContent = n.content && n.content.toLowerCase().includes(q);
    if (inTitle || inContent) matchIds.add(n.id);
  }
  items.forEach(el => {
    const id = el.dataset.id;
    el.style.display = matchIds.has(id) ? '' : 'none';
  });
  // Show all children containers so matched nested items are visible
  tree.querySelectorAll('.guide-tree-children').forEach(el => el.style.display = 'block');
}
