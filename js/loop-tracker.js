/* ==========================================================================
   Loop Tracker (Resources tab) — the Notion "Team Loop Tracker", live, for the
   close-the-loop meeting. Everyone can read; managers change status with one
   click, open an item to edit it, or add one. Reads and writes go through
   apps-script/loop-tracker, which holds the Notion connection. The last list is
   kept for this browser tab so the view opens instantly; ↻ Refresh pulls the latest.
   ========================================================================== */
const LOOP_URL = 'https://script.google.com/macros/s/AKfycbxQVzKZdB8ecIFscQUDX3uoL8CCzzH1qFiL3VtfJymAAwZPGulkn34MQi2sLt-b7NdN/exec';
const LOOP_NOTION_URL = 'https://www.notion.so/e4a103fc90624ce1b0396a50fc9e76f8';
const LOOP_STORE = 'cs-loop-cache';
// The copy lives only for this browser tab (sessionStorage); clear any older long-lived copy.
try { localStorage.removeItem(LOOP_STORE); } catch (e) { /* private mode */ }
const LOOP_GROUPS = [
  { status: 'Open', title: 'Open' },
  { status: 'In Progress', title: 'In Progress' },
  { status: 'Closed', title: 'Closed this week' },
];
const LOOP = { data: null, loading: false, openId: null, saving: 0, note: '' };

async function loopCall(body) {
  const res = await fetch(LOOP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: AUTH.token }, body)),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadLoop(force) {
  if (LOOP.loading || !AUTH.token) return;
  const root = document.getElementById('loop');
  if (!LOOP.data) {
    try { LOOP.data = JSON.parse(sessionStorage.getItem(LOOP_STORE) || 'null'); } catch (e) { /* private mode */ }
    if (LOOP.data) { LOOP.data.canEdit = false; LOOP.note = 'Showing your last copy — checking Notion…'; renderLoop(); }
    else root.innerHTML = '<div class="res-loading">Loading the Loop Tracker…</div>';
  }
  LOOP.loading = true;
  document.getElementById('loopRefresh')?.classList.add('spin');
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await loopCall({ action: 'load', force: !!force });
      LOOP.data = data;
      LOOP.note = data.stale ? `Notion didn’t answer, so this is the list from ${new Date(data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Try Refresh in a minute.` : '';
      try { sessionStorage.setItem(LOOP_STORE, JSON.stringify(data)); } catch (e) { /* full or private */ }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (isSessionError(e)) { showSessionBanner(true); break; }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  LOOP.loading = false;
  if (lastErr) {
    if (LOOP.data) LOOP.note = isSessionError(lastErr) ? 'Your sign-in expired — click “Stay signed in”, then Refresh.' : 'Couldn’t reach Notion just now — showing the last copy. Try Refresh.';
    else root.innerHTML = `<div class="error-banner">Couldn’t load the Loop Tracker: ${esc(lastErr.message)} <button type="button" class="mgr-btn" id="loopRetry">Try again</button></div>`;
  }
  if (LOOP.data) renderLoop();
}

const loopAgo = (d) => {
  if (!d) return '';
  const n = Math.round((Date.now() - new Date(d.length === 10 ? d + 'T12:00:00' : d)) / 864e5);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + 'd ago';
};
const loopSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, '-');

function loopRow(it, canEdit) {
  const pill = `<span class="loop-pill s-${loopSlug(it.status)}">${esc(it.status || 'No status')}</span>`;
  return `<li class="loop-card s-${loopSlug(it.status)}" data-id="${esc(it.id)}">
      <div class="loop-card-top">
        ${canEdit ? `<button type="button" class="loop-status" data-id="${esc(it.id)}" aria-label="Change status (now ${esc(it.status)})">${pill}</button>` : pill}
        ${it.outcome && it.outcome !== 'Under Review' ? `<span class="loop-tag o-${loopSlug(it.outcome)}">${esc(it.outcome)}</span>` : ''}
      </div>
      <button type="button" class="loop-open" data-id="${esc(it.id)}">
        <span class="loop-item">${esc(it.item || 'Untitled')}</span>
        ${it.notes ? `<span class="loop-snip">${esc(it.notes)}</span>` : ''}
      </button>
      <div class="loop-card-foot">
        ${it.type ? `<span class="loop-tag">${esc(it.type)}</span>` : ''}
        ${it.raisedBy ? `<span class="loop-tag">${esc(it.raisedBy)}</span>` : ''}
        <span class="loop-when">${it.status === 'Closed' ? 'closed ' + esc(loopAgo(it.closed || it.edited)) : 'raised ' + esc(loopAgo(it.raised))}</span>
      </div>
    </li>`;
}

function renderLoop() {
  const d = LOOP.data;
  const root = document.getElementById('loop');
  const groups = LOOP_GROUPS.map((g) => ({ ...g, items: d.items.filter((x) => x.status === g.status) }));
  const oldest = groups[0].items.reduce((m, x) => (x.raised && (!m || x.raised < m) ? x.raised : m), '');
  root.innerHTML = `
    <section class="loop-hero">
      <div class="loop-hero-text">
        <div class="loop-eyebrow">Close the loop</div>
        <h2>Team <span>Loop Tracker</span></h2>
        <p>What the team raised, what we’re doing about it, and what we closed this week. From Notion.</p>
        <div class="loop-stats">
          ${groups.map((g) => `<a class="loop-stat s-${loopSlug(g.status)}" href="#loop-${loopSlug(g.status)}"><b>${g.items.length}</b><span>${esc(g.title)}</span></a>`).join('')}
        </div>
        <div class="loop-actions">
          ${d.canEdit ? '<button type="button" class="loop-btn primary" id="loopAdd">+ Add item</button>' : ''}
          <button type="button" class="loop-btn" id="loopRefresh">↻ Refresh</button>
          <a class="loop-btn" href="${LOOP_NOTION_URL}" target="_blank" rel="noopener">Open in Notion ↗</a>
        </div>
      </div>
      <div class="loop-hero-art">
        <div class="loop-bubble">${groups[0].items.length ? `${groups[0].items.length} loop${groups[0].items.length === 1 ? '' : 's'} to close${oldest ? ` — oldest from ${esc(loopAgo(oldest))}` : ''}!` : 'Every loop is closed. Nice!'}</div>
        <img src="assets/merlin-loopinator.webp" alt="Merlin and the Loop-in-ator" width="560" height="443">
      </div>
    </section>
    <div class="loop-board">
      ${groups.map((g) => `<section class="loop-col s-${loopSlug(g.status)}" id="loop-${loopSlug(g.status)}">
          <h3><span class="loop-dot"></span>${esc(g.title)} <span class="loop-count">${g.items.length}</span></h3>
          ${g.items.length ? `<ul class="loop-list">${g.items.map((it) => loopRow(it, d.canEdit)).join('')}</ul>` : `<p class="loop-empty">${g.status === 'Closed' ? 'Nothing closed yet this week.' : 'Nothing here.'}</p>`}
        </section>`).join('')}
    </div>
    ${LOOP.note ? `<p class="loop-note">${esc(LOOP.note)}</p>` : ''}
    <p class="loop-foot">${d.canEdit ? 'Click a status to change it, or a card to edit it.' : 'Click a card for details. Managers can edit.'} · from Notion at ${new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</p>`;
}

/* ---- saving ---- */
async function loopSave(id, fields) {
  const it = LOOP.data.items.find((x) => x.id === id);
  const before = { ...it };
  Object.assign(it, fields);
  if (fields.status === 'Closed') it.closed = new Date().toISOString().slice(0, 10);
  else if (fields.status) it.closed = '';
  renderLoop();
  LOOP.saving++;
  try {
    const res = await loopCall({ action: 'update', id, fields });
    Object.assign(it, res.item);
    return true;
  } catch (e) {
    Object.assign(it, before);
    if (isSessionError(e)) showSessionBanner(true);
    alert(isSessionError(e) ? 'Your Google sign-in expired. Click “Stay signed in” at the bottom of the page, then try again.' : 'Couldn’t save to Notion: ' + e.message);
    return false;
  } finally {
    LOOP.saving--;
    renderLoop();
    // Refresh the panel unless someone is mid-typing in it.
    if (LOOP.openId === id && !(document.activeElement && document.activeElement.matches('#loopPanel textarea'))) loopFillPanel(it);
  }
}

function loopStatusMenu(btn) {
  document.querySelectorAll('.loop-menu').forEach((m) => m.remove());
  const id = btn.dataset.id;
  const it = LOOP.data.items.find((x) => x.id === id);
  const menu = document.createElement('div');
  menu.className = 'loop-menu';
  menu.innerHTML = LOOP.data.options.Status.map((s) => `<button type="button" data-status="${esc(s)}" class="${s === it.status ? 'cur' : ''}"><span class="loop-pill s-${loopSlug(s)}">${esc(s)}</span></button>`).join('');
  btn.closest('.loop-card').appendChild(menu);
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    menu.remove();
    if (b.dataset.status !== it.status) loopSave(id, { status: b.dataset.status });
  });
}

/* ---- side panel ---- */
function loopSelect(name, key, it, opts) {
  return `<label class="loop-field"><span>${esc(name)}</span>
      <select data-field="${key}">${['', ...opts].map((o) => `<option value="${esc(o)}"${o === (it[key] || '') ? ' selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></label>`;
}

function loopFillPanel(it, keepText) {
  const box = document.getElementById('loopPanel');
  if (!box) return;
  const d = LOOP.data, o = d.options;
  const facts = `<span>Raised ${esc(it.raised || '')}</span>${it.closed ? `<span>Closed ${esc(it.closed)}</span>` : ''}`;
  const pageHtml = box.querySelector('.loop-page') ? box.querySelector('.loop-page').outerHTML : '<div class="loop-page"><p class="loop-muted">Loading details…</p></div>';
  if (d.canEdit) {
    box.querySelector('.drill-body').innerHTML = `
      <label class="loop-field wide"><span>Item</span><textarea data-field="item" rows="2">${esc(it.item)}</textarea></label>
      <div class="loop-grid">
        ${loopSelect('Status', 'status', it, o.Status)}
        ${loopSelect('Outcome', 'outcome', it, o.Outcome)}
        ${loopSelect('Type', 'type', it, o.Type)}
        ${loopSelect('Raised by', 'raisedBy', it, o['Raised By'])}
      </div>
      ${it.status === 'Closed' && (!it.outcome || it.outcome === 'Under Review') ? '<p class="loop-nudge">Closed but still “Under Review” — pick an outcome?</p>' : ''}
      <label class="loop-field wide"><span>Notes <em>why we did or didn’t act, and what changed</em></span><textarea data-field="notes" rows="4">${esc(it.notes)}</textarea></label>
      <div class="loop-facts">${facts}<span class="loop-saved" aria-live="polite"></span></div>
      ${pageHtml}`;
  } else {
    box.querySelector('.drill-body').innerHTML = `
      <div class="loop-ro">
        <p><span class="loop-pill s-${loopSlug(it.status)}">${esc(it.status)}</span>
          ${it.outcome ? `<span class="loop-tag">${esc(it.outcome)}</span>` : ''}
          ${it.type ? `<span class="loop-tag">${esc(it.type)}</span>` : ''}
          ${it.raisedBy ? `<span class="loop-tag">${esc(it.raisedBy)}</span>` : ''}</p>
        ${it.notes ? `<p class="loop-notes">${esc(it.notes)}</p>` : '<p class="loop-muted">No notes yet.</p>'}
        <div class="loop-facts">${facts}</div>
      </div>`;
  }
}

async function loopOpenPanel(id) {
  const it = LOOP.data.items.find((x) => x.id === id);
  if (!it) return;
  LOOP.openId = id;
  document.getElementById('loopPanelWrap')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'loopPanelWrap';
  wrap.className = 'drill-backdrop';
  wrap.innerHTML = `<div class="drill loop-drill" id="loopPanel" role="dialog" aria-modal="true" aria-label="Loop item">
      <div class="drill-head">
        <div><h3>${LOOP.data.canEdit ? 'Edit item' : esc(it.item)}</h3>
          <a class="drill-note" href="${safeUrl(it.url)}" target="_blank" rel="noopener">Open in Notion ↗</a></div>
        <button type="button" class="drill-close" aria-label="Close">×</button>
      </div>
      <div class="drill-body"></div>
    </div>`;
  document.body.appendChild(wrap);
  loopFillPanel(it);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.drill-close')) loopClosePanel(); });
  wrap.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-field]');
    if (!f || f.tagName !== 'SELECT') return;
    const flag = wrap.querySelector('.loop-saved');
    if (flag) flag.textContent = 'Saving…';
    const ok = await loopSave(id, { [f.dataset.field]: f.value });
    const flag2 = document.querySelector('#loopPanel .loop-saved');
    if (flag2) flag2.textContent = ok ? 'Saved ✓' : '';
  });
  wrap.addEventListener('focusout', async (e) => {
    const f = e.target.closest('textarea[data-field]');
    if (!f) return;
    const cur = LOOP.data.items.find((x) => x.id === id);
    if (f.value === (cur[f.dataset.field] || '')) return;
    const flag = wrap.querySelector('.loop-saved');
    if (flag) flag.textContent = 'Saving…';
    const ok = await loopSave(id, { [f.dataset.field]: f.value });
    const flag2 = document.querySelector('#loopPanel .loop-saved');
    if (flag2) flag2.textContent = ok ? 'Saved ✓' : '';
  });
  if (LOOP.data.canEdit) {
    try {
      const res = await loopCall({ action: 'page', id });
      const page = document.querySelector('#loopPanel .loop-page');
      if (page) page.innerHTML = res.lines.length
        ? '<h4>From Notion</h4>' + res.lines.map((l) => l.href
          ? `<p><a href="${safeUrl(l.href)}" target="_blank" rel="noopener">${esc(l.text || l.href)}</a></p>`
          : `<p class="${l.heading ? 'h' : ''}">${esc(l.text)}</p>`).join('')
        : '';
    } catch (e) {
      const page = document.querySelector('#loopPanel .loop-page');
      if (page) page.innerHTML = '';
    }
  }
}

function loopClosePanel() {
  const active = document.activeElement;
  if (active && active.matches && active.matches('#loopPanel textarea')) active.blur();
  document.getElementById('loopPanelWrap')?.remove();
  LOOP.openId = null;
}

function loopAddForm() {
  document.getElementById('loopPanelWrap')?.remove();
  const o = LOOP.data.options;
  const wrap = document.createElement('div');
  wrap.id = 'loopPanelWrap';
  wrap.className = 'drill-backdrop';
  wrap.innerHTML = `<form class="drill loop-drill" id="loopNew" role="dialog" aria-modal="true" aria-label="Add loop item">
      <div class="drill-head"><div><h3>Add item</h3><p class="drill-note">Starts as Open, Under Review.</p></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body">
        <label class="loop-field wide"><span>Item</span><textarea name="item" rows="2" required></textarea></label>
        <div class="loop-grid">
          <label class="loop-field"><span>Type</span><select name="type">${['', ...o.Type].map((x) => `<option value="${esc(x)}">${esc(x || '—')}</option>`).join('')}</select></label>
          <label class="loop-field"><span>Raised by</span><select name="raisedBy">${['', ...o['Raised By']].map((x) => `<option value="${esc(x)}">${esc(x || '—')}</option>`).join('')}</select></label>
        </div>
        <label class="loop-field wide"><span>Notes</span><textarea name="notes" rows="3"></textarea></label>
        <div class="loop-form-actions"><button type="submit" class="mgr-btn on">Add to tracker</button><span class="loop-saved"></span></div>
      </div>
    </form>`;
  document.body.appendChild(wrap);
  wrap.querySelector('textarea').focus();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.drill-close')) wrap.remove(); });
  wrap.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    f.querySelector('.loop-saved').textContent = 'Adding…';
    try {
      const res = await loopCall({ action: 'create', fields: { item: f.item.value, type: f.type.value, raisedBy: f.raisedBy.value, notes: f.notes.value } });
      LOOP.data.items.push(res.item);
      renderLoop();
      wrap.remove();
    } catch (err) {
      btn.disabled = false;
      f.querySelector('.loop-saved').textContent = err.message;
    }
  });
}

function setupLoop() {
  const root = document.getElementById('loop');
  root.addEventListener('click', (e) => {
    const st = e.target.closest('.loop-status');
    if (st) { e.stopPropagation(); loopStatusMenu(st); return; }
    const open = e.target.closest('.loop-open');
    if (open) { loopOpenPanel(open.dataset.id); return; }
    if (e.target.closest('#loopAdd')) loopAddForm();
    if (e.target.closest('#loopRefresh') || e.target.closest('#loopRetry')) loadLoop(true);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.loop-menu') && !e.target.closest('.loop-status')) document.querySelectorAll('.loop-menu').forEach((m) => m.remove());
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.loop-menu').forEach((m) => m.remove());
    if (document.getElementById('loopPanelWrap')) loopClosePanel();
  });
}
