/* ==========================================================================
   Open Bugs (Resources tab) — open bugs in Shortcut's Customer Success workflow,
   read-only. Filter by state, severity and team, search, or show only the ones
   you reported; click one for its description and latest comments. Reads go
   through apps-script/loop-tracker (bugs.js), which holds the Shortcut token.
   ========================================================================== */
const BUG_SC_URL = 'https://app.shortcut.com/lawmatics-new/stories';
const BUG_STORE = 'cs-bug-cache';
const BUG_PAGE = 20;
const BUG = { data: null, loading: false, q: '', state: '', sev: '', team: '', sort: 'sev', mine: false, page: 0, note: '' };

const bugSevLabel = (n) => (n ? 'S' + n : '—');
const bugStateName = (id) => BUG.data.states[id]?.name || 'Other';
const bugIsProd = (id) => /production/i.test(bugStateName(id));
const bugDays = (d) => (d ? Math.max(0, Math.round((Date.now() - new Date(d + 'T12:00:00')) / 864e5)) : 0);
const bugAge = (d) => {
  const n = bugDays(d);
  return n === 0 ? 'today' : n < 45 ? n + 'd' : new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', year: 'numeric' });
};

async function loadBugs(force) {
  if (BUG.loading || !AUTH.token) return;
  const root = document.getElementById('bugs');
  if (!BUG.data) {
    try { BUG.data = JSON.parse(sessionStorage.getItem(BUG_STORE) || 'null'); } catch (e) { /* private mode */ }
    if (BUG.data) { BUG.note = 'Showing your last copy — checking Shortcut…'; renderBugs(); }
    else root.innerHTML = '<div class="res-loading">Loading open bugs from Shortcut…</div>';
  }
  BUG.loading = true;
  document.getElementById('bugRefresh')?.classList.add('spin');
  try {
    const data = await loopCall({ action: 'bugLoad', force: !!force });
    BUG.data = data;
    BUG.note = data.stale ? 'Shortcut didn’t answer, so this is an older copy. Try Refresh in a minute.' : '';
    try { sessionStorage.setItem(BUG_STORE, JSON.stringify(data)); } catch (e) { /* full or private */ }
  } catch (e) {
    if (isSessionError(e)) showSessionBanner(true);
    if (BUG.data) BUG.note = 'Couldn’t reach Shortcut just now — showing the last copy. Try Refresh.';
    else root.innerHTML = `<div class="error-banner">Couldn’t load open bugs: ${esc(e.message)} <button type="button" class="mgr-btn" id="bugRetry">Try again</button></div>`;
  }
  BUG.loading = false;
  if (BUG.data) renderBugs();
}

function bugFiltered(skip) {
  const d = BUG.data;
  const words = BUG.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let list = d.items.filter((it) => {
    if (skip !== 'state' && BUG.state && String(it.st) !== BUG.state) return false;
    if (BUG.sev && String(it.sev) !== BUG.sev) return false;
    if (BUG.team && it.g !== BUG.team) return false;
    if (BUG.mine && it.req !== d.me) return false;
    if (words.length) {
      const hay = (it.t + ' ' + it.id + ' ' + it.lab.join(' ') + ' ' + (d.people[it.req] || '') + ' ' + (d.groups[it.g] || '')).toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const sorts = {
    sev: (a, b) => (a.sev || 9) - (b.sev || 9) || b.c.localeCompare(a.c),
    new: (a, b) => b.c.localeCompare(a.c),
    old: (a, b) => a.c.localeCompare(b.c),
    moved: (a, b) => b.m.localeCompare(a.m),
  };
  return list.sort(sorts[BUG.sort] || sorts.sev);
}

function bugRow(it) {
  const d = BUG.data;
  const prod = bugIsProd(it.st);
  return `<li class="bug-row">
      <span class="bug-sev s${it.sev || 0}" title="${it.sev ? 'Severity ' + it.sev : 'No severity set'}">${bugSevLabel(it.sev)}</span>
      <button type="button" class="bug-open" data-id="${it.id}">
        <span class="fr-title">${esc(it.t)}</span>
        <span class="fr-meta">
          <span class="bug-state${prod ? ' prod' : ''}">${esc(bugStateName(it.st))}</span>
          ${it.blk ? '<span class="loop-tag bug-blk">Blocked</span>' : ''}
          ${it.pri ? `<span class="loop-tag">${esc(it.pri)} priority</span>` : ''}
          ${d.groups[it.g] ? `<span class="loop-tag">${esc(d.groups[it.g])}</span>` : ''}
          ${d.people[it.req] ? `<span class="loop-tag">by ${esc(d.people[it.req])}</span>` : ''}
          ${it.nc ? `<span class="loop-tag">💬 ${it.nc}</span>` : ''}
          <span class="loop-when">#${it.id} · open ${esc(bugAge(it.c))}</span>
        </span>
      </button>
      <a class="bug-link" href="${safeUrl(it.url)}" target="_blank" rel="noopener" aria-label="Open #${it.id} in Shortcut">↗</a>
    </li>`;
}

function renderBugs() {
  const d = BUG.data;
  const root = document.getElementById('bugs');
  const keepFocus = document.activeElement?.id === 'bugQ';
  const all = d.items;
  const sev12 = all.filter((it) => it.sev === 1 || it.sev === 2).length;
  const week = all.filter((it) => bugDays(it.c) <= 7).length;
  const prodN = all.filter((it) => bugIsProd(it.st)).length;
  const mineN = d.me ? all.filter((it) => it.req === d.me).length : 0;
  const forStates = bugFiltered('state');
  const stateIds = Object.keys(d.states).sort((a, b) => d.states[a].pos - d.states[b].pos);
  const stateCount = (id) => forStates.filter((it) => String(it.st) === id).length;
  const list = bugFiltered();
  const pages = Math.max(1, Math.ceil(list.length / BUG_PAGE));
  BUG.page = Math.min(BUG.page, pages - 1);
  const shown = list.slice(BUG.page * BUG_PAGE, BUG.page * BUG_PAGE + BUG_PAGE);
  const teams = [...new Set(all.map((it) => it.g).filter((g) => d.groups[g]))].sort((a, b) => d.groups[a].localeCompare(d.groups[b]));
  const sevs = [...new Set(all.map((it) => it.sev))].sort((a, b) => (a || 9) - (b || 9));
  root.innerHTML = `
    <section class="loop-hero bug-hero">
      <div class="loop-hero-text">
        <div class="loop-eyebrow">From Shortcut · Customer Success workflow</div>
        <h2>Open <span>Bugs</span></h2>
        <p>Every open bug CS has filed, worst first. Check here before you file a new one, and tell the firm where theirs stands.</p>
        <div class="loop-stats">
          <button type="button" class="loop-stat fr-stat" data-bug-reset><b>${all.length}</b><span>Open bugs</span></button>
          <button type="button" class="loop-stat fr-stat bug-s12" data-bug-sev12><b>${sev12}</b><span>Severity 1–2</span></button>
          <button type="button" class="loop-stat fr-stat" data-bug-new><b>${week}</b><span>New this week</span></button>
          ${prodN ? `<button type="button" class="loop-stat fr-stat bug-prodstat" data-bug-prod><b>${prodN}</b><span>Fixed — confirm with firm</span></button>` : ''}
        </div>
        <div class="loop-actions">
          ${d.me ? `<button type="button" class="loop-btn${BUG.mine ? ' primary' : ''}" id="bugMine">${BUG.mine ? '✓ ' : ''}Reported by me (${mineN})</button>` : ''}
          <button type="button" class="loop-btn" id="bugRefresh">↻ Refresh</button>
          <a class="loop-btn" href="${BUG_SC_URL}" target="_blank" rel="noopener">Open Shortcut ↗</a>
        </div>
      </div>
      <div class="loop-hero-art bug-hero-art">
        <div class="loop-bubble">${prodN ? `${prodN} fix${prodN === 1 ? '' : 'es'} on production — go tell the firm${prodN === 1 ? '' : 's'}!` : sev12 ? `${sev12} big bug${sev12 === 1 ? '' : 's'} on my radar.` : 'No big bugs. Smooth flying!'}</div>
        <img src="assets/merlin-bug.webp?v=3" alt="Merlin in a bug costume with sunglasses" width="520" height="557">
      </div>
    </section>
    <div class="bug-states" role="tablist" aria-label="Workflow state">
      <button type="button" class="bug-chip${BUG.state ? '' : ' on'}" data-bug-state="">All <b>${forStates.length}</b></button>
      ${stateIds.filter((id) => stateCount(id)).map((id) => `<button type="button" class="bug-chip${BUG.state === id ? ' on' : ''}${bugIsProd(id) ? ' prod' : ''}" data-bug-state="${esc(id)}">${esc(d.states[id].name)} <b>${stateCount(id)}</b></button>`).join('')}
    </div>
    <div class="fr-tools">
      <div class="search-box fr-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
        <input id="bugQ" type="text" placeholder="Search bugs, #id, label, reporter…" autocomplete="off" aria-label="Search open bugs" value="${esc(BUG.q)}">
      </div>
      <select id="bugSev" aria-label="Severity"><option value="">All severities</option>${sevs.map((s) => `<option value="${s}"${String(s) === BUG.sev ? ' selected' : ''}>${s ? 'Severity ' + s : 'No severity'}</option>`).join('')}</select>
      ${teams.length > 1 ? `<select id="bugTeam" aria-label="Team"><option value="">All teams</option>${teams.map((g) => `<option value="${esc(g)}"${g === BUG.team ? ' selected' : ''}>${esc(d.groups[g])}</option>`).join('')}</select>` : ''}
      <select id="bugSort" aria-label="Sort">${[['sev', 'Worst first'], ['new', 'Newest'], ['old', 'Open longest'], ['moved', 'Recently moved']].map(([k, l]) => `<option value="${k}"${BUG.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="fr-scope"><span>${fmtNum(list.length)} bug${list.length === 1 ? '' : 's'}${BUG.mine ? ' you reported' : ''}</span></div>
    ${shown.length ? `<ul class="fr-list">${shown.map(bugRow).join('')}</ul>` : `<p class="loop-empty">${BUG.q ? 'No open bug matches that search.' : 'Nothing here.'}</p>`}
    ${pages > 1 ? `<div class="pager"><button type="button" class="pager-btn" data-bug-page="-1"${BUG.page === 0 ? ' disabled' : ''}>‹ Prev</button>
      <span class="pager-info">${fmtNum(BUG.page * BUG_PAGE + 1)}–${fmtNum(BUG.page * BUG_PAGE + shown.length)} of ${fmtNum(list.length)}</span>
      <button type="button" class="pager-btn" data-bug-page="1"${BUG.page >= pages - 1 ? ' disabled' : ''}>Next ›</button></div>` : ''}
    ${BUG.note ? `<p class="loop-note">${esc(BUG.note)}</p>` : ''}
    <p class="loop-foot">Severity 1 is the worst. · from Shortcut at ${new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>`;
  if (keepFocus) { const q = document.getElementById('bugQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

/* ---- detail panel: a little Markdown, escaped first ---- */
function bugMd(src) {
  const inline = (s) => esc(s)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, t, u) => `<a href="${safeUrl(u.replace(/&amp;/g, '&'))}" target="_blank" rel="noopener">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return String(src || '').split(/\n/).map((l) => {
    const t = l.trim();
    if (!t) return '';
    const h = t.match(/^#{1,6}\s+(.*)/);
    if (h) return `<h4>${inline(h[1])}</h4>`;
    const li = t.match(/^(?:[-*]|\d+\.)\s+(.*)/);
    if (li) return `<p class="bug-li">• ${inline(li[1])}</p>`;
    return `<p>${inline(t)}</p>`;
  }).join('');
}

async function bugOpenPanel(id) {
  const it = BUG.data.items.find((x) => String(x.id) === String(id));
  if (!it) return;
  const d = BUG.data;
  document.getElementById('bugPanelWrap')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'bugPanelWrap';
  wrap.className = 'drill-backdrop';
  wrap.innerHTML = `<div class="drill loop-drill bug-drill" role="dialog" aria-modal="true" aria-label="Bug #${it.id}">
      <div class="drill-head">
        <div><h3>${esc(it.t)}</h3><a class="drill-note" href="${safeUrl(it.url)}" target="_blank" rel="noopener">#${it.id} · Open in Shortcut ↗</a></div>
        <button type="button" class="drill-close" aria-label="Close">×</button>
      </div>
      <div class="drill-body">
        <p class="fr-meta"><span class="bug-sev s${it.sev || 0}">${bugSevLabel(it.sev)}</span>
          <span class="bug-state${bugIsProd(it.st) ? ' prod' : ''}">${esc(bugStateName(it.st))}</span>
          ${it.lab.map((l) => `<span class="loop-tag">${esc(l)}</span>`).join('')}</p>
        <div class="loop-facts"><span>Reported by ${esc(d.people[it.req] || '—')}</span><span>Opened ${esc(it.c)}</span><span>Last moved ${esc(it.m)}</span>
          ${it.own.length ? `<span>Owner: ${esc(it.own.map((o) => d.people[o] || '?').join(', '))}</span>` : ''}</div>
        <div class="bug-desc"><p class="loop-muted">Loading the details…</p></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.drill-close')) wrap.remove(); });
  try {
    const res = await loopCall({ action: 'bugStory', id: it.id });
    const box = wrap.querySelector('.bug-desc');
    box.innerHTML = (res.desc ? bugMd(res.desc) : '<p class="loop-muted">No description.</p>')
      + (res.comments.length ? `<h4 class="bug-ch">Latest comments${res.ncomments > res.comments.length ? ` (${res.comments.length} of ${res.ncomments})` : ''}</h4>`
        + res.comments.map((c) => `<div class="bug-comment"><div class="bug-cwho">${esc(c.who)} · ${esc(c.at)}</div>${bugMd(c.text)}</div>`).join('') : '');
  } catch (e) {
    const box = wrap.querySelector('.bug-desc');
    if (box) box.innerHTML = `<p class="loop-muted">Couldn’t load the details: ${esc(e.message)}</p>`;
  }
}

function setupBugs() {
  const root = document.getElementById('bugs');
  let qTimer;
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'bugQ') return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { BUG.q = e.target.value; BUG.page = 0; renderBugs(); }, 200);
  });
  root.addEventListener('change', (e) => {
    const key = { bugSev: 'sev', bugTeam: 'team', bugSort: 'sort' }[e.target.id];
    if (key) { BUG[key] = e.target.value; BUG.page = 0; renderBugs(); }
  });
  root.addEventListener('click', (e) => {
    const open = e.target.closest('.bug-open');
    if (open) { bugOpenPanel(open.dataset.id); return; }
    const chip = e.target.closest('[data-bug-state]');
    if (chip) { BUG.state = chip.dataset.bugState; BUG.page = 0; renderBugs(); return; }
    const pg = e.target.closest('[data-bug-page]');
    if (pg) { BUG.page += Number(pg.dataset.bugPage); renderBugs(); root.querySelector('.bug-states')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const reset = () => Object.assign(BUG, { q: '', state: '', sev: '', team: '', mine: false, page: 0, sort: 'sev' });
    if (e.target.closest('[data-bug-reset]')) { reset(); renderBugs(); return; }
    if (e.target.closest('[data-bug-sev12]')) { reset(); BUG.sort = 'sev'; renderBugs(); return; }
    if (e.target.closest('[data-bug-new]')) { reset(); BUG.sort = 'new'; renderBugs(); return; }
    if (e.target.closest('[data-bug-prod]')) {
      reset();
      BUG.state = Object.keys(BUG.data.states).find((id) => bugIsProd(id)) || '';
      renderBugs(); return;
    }
    if (e.target.closest('#bugMine')) { BUG.mine = !BUG.mine; BUG.page = 0; renderBugs(); return; }
    if (e.target.closest('#bugRefresh') || e.target.closest('#bugRetry')) loadBugs(true);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('bugPanelWrap')?.remove(); });
}
