// --- Command Palette ---
let cmdSelectedIndex = 0;
let cmdFilteredSessions = [];

function openCmdPalette() {
  const overlay = document.getElementById('cmd-palette-overlay');
  const input = document.getElementById('cmd-input');
  overlay.classList.add('active');
  input.value = '';
  cmdSelectedIndex = 0;
  renderCmdResults('');
  input.focus();
}

function closeCmdPalette() {
  document.getElementById('cmd-palette-overlay').classList.remove('active');
  document.getElementById('cmd-input').value = '';
}

function renderCmdResults(query) {
  const container = document.getElementById('cmd-results');
  const q = query.toLowerCase().trim();
  const statusColors = {
    RUNNING: 'var(--green)', PROCESSING: 'var(--green)', ACTIVE: 'var(--cyan)',
    WAITING: 'var(--yellow)', IDLE: 'var(--text-dim)', DORMANT: '#2a3a4a',
    STUCK: 'var(--red)', ABORTED: 'var(--orange)', UNKNOWN: '#4a5a6a'
  };

  cmdFilteredSessions = allSessions;
  if (q) {
    cmdFilteredSessions = allSessions.filter(s => {
      const haystack = [
        s.summary, s.nickname, s.project, s.cwd, s.branch,
        s.id, s.last_intent, s.status
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  if (cmdSelectedIndex >= cmdFilteredSessions.length) cmdSelectedIndex = Math.max(0, cmdFilteredSessions.length - 1);

  if (!cmdFilteredSessions.length) {
    container.innerHTML = '<div class="cmd-empty">No matching sessions</div>';
    return;
  }

  container.innerHTML = cmdFilteredSessions.map((s, i) => {
    const name = s.nickname || s.summary || s.id.slice(0, 12);
    const color = statusColors[s.status] || 'var(--text-dim)';
    const meta = [s.project, s.branch, s.last_intent].filter(Boolean).join(' · ');
    return `<div class="cmd-item${i === cmdSelectedIndex ? ' selected' : ''}" data-index="${i}"
      onmouseenter="cmdSelectedIndex=${i}; renderCmdResults(document.getElementById('cmd-input').value)"
      onclick="cmdExecute(${i})">
      <div class="cmd-item-status" style="background:${color};box-shadow:0 0 4px ${color}"></div>
      <div class="cmd-item-body">
        <div class="cmd-item-title">${escapeHtml(name)}</div>
        <div class="cmd-item-meta">${s.status} · ${escapeHtml(meta)} · ${timeAgo(s.updated_at)}</div>
      </div>
      ${s.starred ? '<span style="color:#ffd700;">★</span>' : ''}
      <span class="cmd-item-action">⏎ RESUME</span>
    </div>`;
  }).join('');

  // Scroll selected into view
  const sel = container.querySelector('.cmd-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function cmdExecute(index, shiftKey) {
  const s = cmdFilteredSessions[index];
  if (!s) return;
  if (shiftKey) {
    // Expand card in main view
    closeCmdPalette();
    const card = document.querySelector(`.session-card[data-id="${s.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!card.classList.contains('expanded')) card.click();
      card.style.outline = '2px solid var(--cyan)';
      setTimeout(() => { card.style.outline = ''; }, 2000);
    }
  } else {
    // Copy resume command
    navigator.clipboard.writeText(s.resume_command).then(() => {
      const item = document.querySelectorAll('.cmd-item')[index];
      if (item) {
        const action = item.querySelector('.cmd-item-action');
        if (action) { action.textContent = '✓ COPIED'; action.style.color = 'var(--green)'; }
      }
      setTimeout(closeCmdPalette, 600);
    });
  }
}

document.getElementById('cmd-input').addEventListener('input', (e) => {
  cmdSelectedIndex = 0;
  renderCmdResults(e.target.value);
});

document.getElementById('cmd-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdSelectedIndex = Math.min(cmdSelectedIndex + 1, cmdFilteredSessions.length - 1);
    renderCmdResults(document.getElementById('cmd-input').value);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cmdSelectedIndex = Math.max(cmdSelectedIndex - 1, 0);
    renderCmdResults(document.getElementById('cmd-input').value);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    cmdExecute(cmdSelectedIndex, e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCmdPalette();
  }
});

document.getElementById('cmd-palette-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeCmdPalette();
});

// --- Keyboard shortcuts ---
let focusedCardIndex = -1;
document.addEventListener('keydown', (e) => {
  // ⌘K / Ctrl+K opens command palette (always, even from inputs)
  if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    const overlay = document.getElementById('cmd-palette-overlay');
    if (overlay.classList.contains('active')) closeCmdPalette();
    else openCmdPalette();
    return;
  }

  // Skip if command palette is open
  if (document.getElementById('cmd-palette-overlay').classList.contains('active')) return;

  // Skip if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }

  // / focuses the correct search bar based on current tab
  if (e.key === '/') {
    e.preventDefault();
    if (currentTab === 'workspaces') {
      document.getElementById('ws-search-input').focus();
    } else {
      document.getElementById('filter-search').focus();
    }
    return;
  }

  const cards = document.querySelectorAll('.session-card');
  if (!cards.length) return;

  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    focusedCardIndex = Math.min(focusedCardIndex + 1, cards.length - 1);
    cards[focusedCardIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    cards.forEach(c => c.style.outline = '');
    cards[focusedCardIndex].style.outline = '1px solid var(--cyan)';
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    focusedCardIndex = Math.max(focusedCardIndex - 1, 0);
    cards[focusedCardIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    cards.forEach(c => c.style.outline = '');
    cards[focusedCardIndex].style.outline = '1px solid var(--cyan)';
  } else if (e.key === 'Enter' && focusedCardIndex >= 0) {
    e.preventDefault();
    cards[focusedCardIndex].click();
  } else if (e.key === 's' && focusedCardIndex >= 0) {
    const btn = cards[focusedCardIndex].querySelector('.star-btn');
    if (btn) btn.click();
  } else if (e.key === 'Escape') {
    cards.forEach(c => c.style.outline = '');
    focusedCardIndex = -1;
  }
});

