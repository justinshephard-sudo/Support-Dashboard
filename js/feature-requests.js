/* ==========================================================================
   Feature Requests (Resources tab) — the Notion "🌅 Feature Requests" database.
   Shows the requests with FR_MIN+ requesters, most requested first, paged and
   filterable; search covers every request. Anyone can +1 (adds them to Requester
   in Notion, which is what "Total Requests" counts) or add a new request — the add
   form suggests close matches first so people +1 instead of making duplicates.
   Reads and writes go through apps-script/loop-tracker (feature-requests.js).
   ========================================================================== */
const FR_NOTION_URL = 'https://www.notion.so/1ede554974b98091a733d477c98c8cf3?v=1ede554974b980989158000ca5c65f11';
const FR_STORE = 'cs-fr-cache';
const FR_MIN = 4;
const FR_PAGE = 15;
const FR = { data: null, loading: false, q: '', area: '', sort: 'req', all: false, page: 0, note: '' };

const frCount = (it) => it.req.length;
const frMine = (it) => !!FR.data?.me && it.req.includes(FR.data.me);
const frFirms = (it) => (it.f || '').split(/[,\s]+/).filter(Boolean);
const FR_STOP = new Set('as a user i would like to be able the and for that so with from this when have can our their into them there what about would want ability allow option more than also need able like should could being only just make each other some'.split(' '));
const frWords = (s) => [...new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !FR_STOP.has(w)))];

async function loadFR(force) {
  if (FR.loading || !AUTH.token) return;
  const root = document.getElementById('fr');
  if (!FR.data) {
    try { FR.data = JSON.parse(sessionStorage.getItem(FR_STORE) || 'null'); } catch (e) { /* private mode */ }
    if (FR.data) { FR.note = 'Showing your last copy — checking Notion…'; renderFR(); }
    else root.innerHTML = '<div class="res-loading">Loading feature requests…</div>';
  }
  FR.loading = true;
  document.getElementById('frRefresh')?.classList.add('spin');
  try {
    const data = await loopCall({ action: 'frLoad', force: !!force });
    FR.data = data;
    FR.note = data.stale ? 'Notion didn’t answer, so this is an older copy. Try Refresh in a minute.' : '';
    try { sessionStorage.setItem(FR_STORE, JSON.stringify(data)); } catch (e) { /* full or private */ }
  } catch (e) {
    if (isSessionError(e)) showSessionBanner(true);
    if (FR.data) FR.note = 'Couldn’t reach Notion just now — showing the last copy. Try Refresh.';
    else root.innerHTML = `<div class="error-banner">Couldn’t load feature requests: ${esc(e.message)} <button type="button" class="mgr-btn" id="frRetry">Try again</button></div>`;
  }
  FR.loading = false;
  if (FR.data) renderFR();
}

function frFiltered() {
  const d = FR.data;
  const q = FR.q.trim().toLowerCase();
  let list = d.items;
  if (q) {
    const words = q.split(/\s+/).filter(Boolean);
    list = list.filter((it) => {
      const hay = (it.t + ' ' + it.n + ' ' + it.a + ' ' + it.f).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  } else if (!FR.all) list = list.filter((it) => frCount(it) >= FR_MIN);
  if (FR.area) list = list.filter((it) => (it.a || 'No area') === FR.area);
  const byNew = (a, b) => (b.d || '').localeCompare(a.d || '');
  return list.slice().sort(FR.sort === 'new' ? byNew : (a, b) => frCount(b) - frCount(a) || byNew(a, b));
}

const frWhen = (d) => {
  if (!d) return '';
  const t = new Date(d + 'T12:00:00');
  return Date.now() - t < 45 * 864e5 ? loopAgo(d) : t.toLocaleDateString([], { month: 'short', year: 'numeric' });
};

function frTags(it) {
  const firms = frFirms(it).length;
  return `${it.a ? `<span class="loop-tag">${esc(it.a)}</span>` : ''}
    ${it.r === 'Yes' ? '<span class="loop-tag fr-road">On roadmap</span>' : ''}
    ${it.s && it.s !== 'Not started' ? `<span class="loop-tag fr-st">${esc(it.s)}</span>` : ''}
    ${firms ? `<span class="loop-tag">${firms} firm${firms === 1 ? '' : 's'}</span>` : ''}
    <span class="loop-when">${esc(frWhen(it.d))}</span>`;
}

function frVote(it) {
  const mine = frMine(it);
  return `<div class="fr-vote${mine ? ' mine' : ''}">
      <b>${frCount(it)}</b>
      <button type="button" class="fr-plus" data-id="${esc(it.id)}" aria-label="${mine ? 'You +1’d this — add a firm or note' : '+1 this request'}">${mine ? '✓ +1’d' : '+1'}</button>
    </div>`;
}

function frRow(it) {
  return `<li class="fr-row" data-id="${esc(it.id)}">
      ${frVote(it)}
      <button type="button" class="fr-open" data-id="${esc(it.id)}">
        <span class="fr-title">${esc(it.t)}</span>
        ${it.n ? `<span class="loop-snip">${esc(it.n)}</span>` : ''}
        <span class="fr-meta">${frTags(it)}</span>
      </button>
    </li>`;
}

function renderFR() {
  const d = FR.data;
  const root = document.getElementById('fr');
  const keepFocus = document.activeElement?.id === 'frQ';
  const top = d.items.filter((it) => frCount(it) >= FR_MIN);
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const fresh = d.items.filter((it) => (it.d || it.c) >= since).length;
  const road = d.items.filter((it) => it.r === 'Yes').length;
  const list = frFiltered();
  const pages = Math.max(1, Math.ceil(list.length / FR_PAGE));
  FR.page = Math.min(FR.page, pages - 1);
  const shown = list.slice(FR.page * FR_PAGE, FR.page * FR_PAGE + FR_PAGE);
  const areaCounts = {};
  (FR.q || FR.all ? d.items : top).forEach((it) => { const a = it.a || 'No area'; areaCounts[a] = (areaCounts[a] || 0) + 1; });
  const areas = Object.keys(areaCounts).sort((a, b) => areaCounts[b] - areaCounts[a]);
  const rest = d.items.length - top.length;
  const scope = FR.q ? `Searching all ${fmtNum(d.items.length)} requests` : FR.all ? `All ${fmtNum(d.items.length)} requests` : `Requests with ${FR_MIN}+ requesters`;
  root.innerHTML = `
    <section class="loop-hero fr-hero">
      <div class="loop-hero-text">
        <div class="loop-eyebrow">What customers keep asking for</div>
        <h2>Feature <span>Requests</span></h2>
        <p>The most-requested ideas rise to the top. Heard it from a customer? <b>+1 it</b> so Product sees the demand — or add it if it’s new.</p>
        <div class="loop-stats">
          <button type="button" class="loop-stat fr-stat" data-fr-all="0"><b>${top.length}</b><span>Top requests (${FR_MIN}+)</span></button>
          <button type="button" class="loop-stat fr-stat" data-fr-sort="new"><b>${fresh}</b><span>New in 30 days</span></button>
          <div class="loop-stat fr-stat"><b>${road}</b><span>On the roadmap</span></div>
        </div>
        <div class="loop-actions">
          <button type="button" class="loop-btn primary" id="frAdd">+ Add request</button>
          <button type="button" class="loop-btn" id="frRefresh">↻ Refresh</button>
          <a class="loop-btn" href="${FR_NOTION_URL}" target="_blank" rel="noopener">Open in Notion ↗</a>
        </div>
      </div>
    </section>
    <div class="fr-tools">
      <div class="search-box fr-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
        <input id="frQ" type="text" placeholder="Search all ${fmtNum(d.items.length)} requests…" autocomplete="off" aria-label="Search feature requests" value="${esc(FR.q)}">
      </div>
      <select id="frArea" aria-label="Product area"><option value="">All areas</option>${areas.map((a) => `<option value="${esc(a)}"${a === FR.area ? ' selected' : ''}>${esc(a)} (${areaCounts[a]})</option>`).join('')}</select>
      <select id="frSort" aria-label="Sort"><option value="req"${FR.sort === 'req' ? ' selected' : ''}>Most requested</option><option value="new"${FR.sort === 'new' ? ' selected' : ''}>Newest</option></select>
    </div>
    <div class="fr-scope"><span>${esc(scope)}${FR.area ? ` · ${esc(FR.area)}` : ''} · ${fmtNum(list.length)}</span>
      ${FR.q ? '' : `<button type="button" class="pill-btn" id="frAll">${FR.all ? `Show top only (${FR_MIN}+)` : `Show all ${fmtNum(d.items.length)}`}</button>`}</div>
    ${shown.length ? `<ul class="fr-list">${shown.map(frRow).join('')}</ul>` : `<p class="loop-empty">${FR.q ? 'No request matches that search — add it as a new one?' : 'Nothing here.'}</p>`}
    ${pages > 1 ? `<div class="pager"><button type="button" class="pager-btn" data-fr-page="-1"${FR.page === 0 ? ' disabled' : ''}>‹ Prev</button>
      <span class="pager-info">${fmtNum(FR.page * FR_PAGE + 1)}–${fmtNum(FR.page * FR_PAGE + shown.length)} of ${fmtNum(list.length)}</span>
      <button type="button" class="pager-btn" data-fr-page="1"${FR.page >= pages - 1 ? ' disabled' : ''}>Next ›</button></div>` : ''}
    ${FR.note ? `<p class="loop-note">${esc(FR.note)}</p>` : ''}
    <p class="loop-foot">${!FR.q && !FR.all ? `${fmtNum(rest)} more requests have fewer than ${FR_MIN} requesters — search to find them. · ` : ''}from Notion at ${new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>`;
  if (keepFocus) { const q = document.getElementById('frQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

/* ---- +1 ---- */
function frPlusForm(id) {
  const it = FR.data.items.find((x) => x.id === id);
  if (!it) return;
  const mine = frMine(it);
  document.getElementById('frPlusWrap')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'frPlusWrap';
  wrap.className = 'drill-backdrop';
  wrap.innerHTML = `<form class="drill loop-drill fr-plus-form" role="dialog" aria-modal="true" aria-label="+1 this request">
      <div class="drill-head"><div><h3>${mine ? 'Add another firm' : '+1 this request'}</h3><p class="drill-note">${esc(it.t)}</p></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body">
        ${mine ? '<p class="loop-nudge">You already +1’d this. Add the firm that’s asking, or a note, so Product sees it.</p>' : ''}
        <div class="loop-grid">
          <label class="loop-field"><span>Firm ID <em>optional</em></span><input name="firm" inputmode="numeric" placeholder="e.g. 5455" autocomplete="off"></label>
        </div>
        <label class="loop-field wide"><span>Anything new? <em>optional — their use case, how much it matters</em></span><textarea name="note" rows="3"></textarea></label>
        <div class="loop-form-actions"><button type="submit" class="mgr-btn on">${mine ? 'Add to request' : '+1 this request'}</button><span class="loop-saved" aria-live="polite"></span></div>
      </div>
    </form>`;
  document.body.appendChild(wrap);
  wrap.querySelector('input').focus();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.drill-close')) wrap.remove(); });
  wrap.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (mine && !f.firm.value.trim() && !f.note.value.trim()) { f.querySelector('.loop-saved').textContent = 'Add a firm ID or a note.'; return; }
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    f.querySelector('.loop-saved').textContent = 'Saving to Notion…';
    try {
      const res = await loopCall({ action: 'frPlus', id, firm: f.firm.value, note: f.note.value });
      frStore(res);
      wrap.remove();
      if (document.getElementById('frPanelWrap')) frOpenPanel(id);
    } catch (err) {
      btn.disabled = false;
      if (isSessionError(err)) showSessionBanner(true);
      f.querySelector('.loop-saved').textContent = err.message;
    }
  });
}

function frStore(res) {
  const d = FR.data;
  if (res.me) d.me = res.me;
  const i = d.items.findIndex((x) => x.id === res.item.id);
  if (i > -1) d.items[i] = res.item; else d.items.push(res.item);
  try { sessionStorage.setItem(FR_STORE, JSON.stringify(d)); } catch (e) { /* full or private */ }
  renderFR();
}

/* ---- detail panel ---- */
function frOpenPanel(id) {
  const it = FR.data.items.find((x) => x.id === id);
  if (!it) return;
  document.getElementById('frPanelWrap')?.remove();
  const names = it.req.map((u) => FR.data.names[u] || 'Someone').sort();
  const wrap = document.createElement('div');
  wrap.id = 'frPanelWrap';
  wrap.className = 'drill-backdrop';
  wrap.innerHTML = `<div class="drill loop-drill" role="dialog" aria-modal="true" aria-label="Feature request">
      <div class="drill-head">
        <div><h3>${esc(it.t)}</h3><a class="drill-note" href="${safeUrl(it.url)}" target="_blank" rel="noopener">Open in Notion ↗</a></div>
        <button type="button" class="drill-close" aria-label="Close">×</button>
      </div>
      <div class="drill-body">
        <div class="fr-panel-top">${frVote(it)}<p class="fr-meta">${frTags(it)}</p></div>
        ${it.n ? `<p class="loop-notes">${esc(it.n)}</p>` : '<p class="loop-muted">No notes.</p>'}
        <div class="loop-facts"><span>Requested by: ${esc(names.join(', ') || '—')}</span></div>
        ${frFirms(it).length ? `<div class="loop-facts"><span>Firm IDs: ${esc(frFirms(it).join(', '))}</span></div>` : ''}
        <div class="loop-facts"><span>Added ${esc(it.d)}</span>${it.dif ? `<span>Difficulty: ${esc(it.dif)}</span>` : ''}</div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('.drill-close')) { wrap.remove(); return; }
    const p = e.target.closest('.fr-plus');
    if (p) frPlusForm(p.dataset.id);
  });
}

/* ---- add ---- */
function frSimilar(text) {
  const w = frWords(text);
  if (w.length < 2) return [];
  return FR.data.items.map((it) => {
    const tw = new Set(frWords(it.t + ' ' + it.a));
    return { it, score: w.filter((x) => tw.has(x)).length };
  }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score || frCount(b.it) - frCount(a.it)).slice(0, 4).map((x) => x.it);
}

function frAddForm() {
  document.getElementById('frPanelWrap')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'frPanelWrap';
  wrap.className = 'drill-backdrop';
  wrap.innerHTML = `<form class="drill loop-drill" role="dialog" aria-modal="true" aria-label="Add feature request">
      <div class="drill-head"><div><h3>Add a feature request</h3><p class="drill-note">Check the matches below first — a +1 counts more than a duplicate.</p></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body">
        <label class="loop-field wide"><span>Request</span><textarea name="title" rows="2" required placeholder="As a user, I would like … so that …"></textarea></label>
        <div class="fr-similar" aria-live="polite"></div>
        <div class="loop-grid">
          <label class="loop-field"><span>Product area</span><select name="area"><option value="">—</option>${(FR.data.areas || []).map((a) => `<option>${esc(a)}</option>`).join('')}</select></label>
          <label class="loop-field"><span>Firm ID <em>optional</em></span><input name="firm" inputmode="numeric" autocomplete="off"></label>
        </div>
        <label class="loop-field wide"><span>Notes <em>the firm’s use case, workaround, how much it matters</em></span><textarea name="notes" rows="4"></textarea></label>
        <div class="loop-form-actions"><button type="submit" class="mgr-btn on">Add request</button><span class="loop-saved" aria-live="polite"></span></div>
      </div>
    </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form');
  form.title.focus();
  let timer;
  form.title.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const sim = frSimilar(form.title.value);
      wrap.querySelector('.fr-similar').innerHTML = sim.length
        ? '<h4>Already requested?</h4><ul class="fr-list compact">' + sim.map((it) => `<li class="fr-row">${frVote(it)}<span class="fr-title">${esc(it.t)}</span></li>`).join('') + '</ul>'
        : '';
    }, 250);
  });
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('.drill-close')) { wrap.remove(); return; }
    const p = e.target.closest('.fr-plus');
    if (p) { wrap.remove(); frPlusForm(p.dataset.id); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    form.querySelector('.loop-saved').textContent = 'Adding to Notion…';
    try {
      const res = await loopCall({ action: 'frCreate', title: form.title.value, notes: form.notes.value, area: form.area.value, firm: form.firm.value });
      FR.q = ''; FR.all = true; FR.sort = 'new'; FR.page = 0;
      frStore(res);
      wrap.remove();
    } catch (err) {
      btn.disabled = false;
      if (isSessionError(err)) showSessionBanner(true);
      form.querySelector('.loop-saved').textContent = err.message;
    }
  });
}

function setupFR() {
  const root = document.getElementById('fr');
  let qTimer;
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'frQ') return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { FR.q = e.target.value; FR.page = 0; renderFR(); }, 200);
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'frArea') { FR.area = e.target.value; FR.page = 0; renderFR(); }
    if (e.target.id === 'frSort') { FR.sort = e.target.value; FR.page = 0; renderFR(); }
  });
  root.addEventListener('click', (e) => {
    const plus = e.target.closest('.fr-plus');
    if (plus) { frPlusForm(plus.dataset.id); return; }
    const open = e.target.closest('.fr-open');
    if (open) { frOpenPanel(open.dataset.id); return; }
    const pg = e.target.closest('[data-fr-page]');
    if (pg) { FR.page += Number(pg.dataset.frPage); renderFR(); root.querySelector('.fr-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (e.target.closest('#frAll')) { FR.all = !FR.all; FR.page = 0; renderFR(); return; }
    const st = e.target.closest('.fr-stat');
    if (st?.dataset.frAll) { FR.all = false; FR.q = ''; FR.area = ''; FR.sort = 'req'; FR.page = 0; renderFR(); return; }
    if (st?.dataset.frSort) { FR.all = true; FR.q = ''; FR.sort = 'new'; FR.page = 0; renderFR(); return; }
    if (e.target.closest('#frAdd')) frAddForm();
    if (e.target.closest('#frRefresh') || e.target.closest('#frRetry')) loadFR(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = document.getElementById('frPlusWrap') || document.getElementById('frPanelWrap');
    if (top) top.remove();
  });
}
