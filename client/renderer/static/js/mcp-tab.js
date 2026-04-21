// ── MCP Tab — Subtab switching ──────────────────────────────────────────────


function switchMcpSubTab(sub) {
  _mcpSubTab = sub;
  document.querySelectorAll('#mcp-subtabs .savant-subtab').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('mcp-sub-' + sub);
  if (btn) btn.classList.add('active');
  document.getElementById('workspace-mcp-view').style.display = sub === 'workspace' ? 'block' : 'none';
  document.getElementById('abilities-view').style.display = sub === 'abilities' ? 'block' : 'none';
  document.getElementById('context-view').style.display = sub === 'context' ? 'block' : 'none';
  document.getElementById('knowledge-view').style.display = sub === 'knowledge' ? 'block' : 'none';
  if (sub === 'workspace') wsMcpInit();
  if (sub === 'abilities') fetchAbilities();
  if (sub === 'context') ctxInit();
  if (sub === 'knowledge') kbInit();
}

