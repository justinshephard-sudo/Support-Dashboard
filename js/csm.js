/* ==========================================================================
   CSM — each rep's book: retention (6- and 13-month NRR / GRR), growth this
   month, AI upsells against the $500/mo target, and account health.
   Data: the MRR Report backend (apps-script/mrr-report): `csm` for the cards (month-end
   snapshots, ChurnZero health, per-rep monthly totals) and `load` — shared with the MRR
   Report tab — for the firm-level events behind the pop-ups. Reps are the ones on the
   Implementation tab.
   ========================================================================== */
const CSM_AI_TARGET = 500;
const CSM = { data: null, loading: null, ym: '', error: '' };

// Same reps as the Implementation tab's per-rep table (its latest month), else anyone with an open onboarding.
function csmReps() {
  const latest = [...IMPL.months].reverse().find((m) => m.RepStats);
  let reps = [];
  try { reps = Object.keys(JSON.parse(latest.RepStats)); } catch (e) { /* no stats yet */ }
  if (!reps.length) reps = IMPL.open.map((f) => f.AccountManager);
  return [...new Set(reps)].filter((r) => r && r !== 'Unassigned').sort((a, b) => a.localeCompare(b));
}

// The last copy lives in this browser tab (sessionStorage): reopening is instant while a
// fresh copy loads behind it. It's also fetched quietly once Support has loaded.
const CSM_STORE = 'cs-csm-cache';

async function loadCsm(force) {
  if (CSM.loading) return CSM.loading;
  CSM.loading = (async () => {
    document.getElementById('csmRefresh')?.classList.add('spin');
    try {
      // One small download: retention, health and per-rep monthly totals. The full MRR
      // event list (only needed inside pop-ups) loads separately in the background.
      const [csm] = await Promise.all([mrrCall({ action: 'csm', force: !!force }), ensureTabData('impl')]);
      if (force) loadMrr(true); else prefetchMrr();
      const changed = !CSM.data || csm.built !== CSM.data.built || force;
      CSM.data = Object.assign({ retention: {}, health: { accounts: [], bad: 33, good: 67 } }, csm);
      try { sessionStorage.setItem(CSM_STORE, JSON.stringify(csm)); } catch (e) { /* full or private */ }
      CSM.error = '';
      if (!changed && !force) return;
    } catch (e) {
      if (isSessionError(e)) showSessionBanner(true);
      CSM.error = e.message;
    } finally {
      CSM.loading = null;
      document.getElementById('csmRefresh')?.classList.remove('spin');
    }
    renderCsm();
  })();
  return CSM.loading;
}

function prefetchCsm() {
  if (CSM.data || CSM.loading) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(CSM_STORE) || 'null');
    if (saved && saved.months) CSM.data = Object.assign({ retention: {}, health: { accounts: [], bad: 33, good: 67 } }, saved);
  } catch (e) { /* private mode */ }
  loadCsm(false);
}

function openCsm() {
  const root = document.getElementById('csm');
  if (!root.innerHTML) root.innerHTML = '<div class="mrr-hero" id="csmHero"></div><div id="csmError" class="error-banner" hidden></div><div id="csmBody"><div class="res-loading">Pulling each rep’s book…</div></div>';
  if (!CSM.data) prefetchCsm();
  // Draw straight away from the saved copy (once Implementation's reps are in), then refresh behind it.
  if (CSM.data) ensureTabData('impl').then(renderCsm);
}

/* ---------- calculations ---------- */
// NRR = the book's MRR now ÷ its MRR at the window start (expansion counts).
// GRR = the same, but no firm counts for more than it started with (only what was kept).
function csmRetention(firms, startIdx, amIdx, rep) {
  const book = firms.filter((f) => f[startIdx] > 0 && (rep == null || f[amIdx] === rep));
  const start = book.reduce((s, f) => s + f[startIdx], 0);
  const now = book.reduce((s, f) => s + f[5], 0);
  const kept = book.reduce((s, f) => s + Math.min(f[5], f[startIdx]), 0);
  return { book, start, now, nrr: start ? (now / start) * 100 : null, grr: start ? (kept / start) * 100 : null };
}

// Card totals come pre-summed from the backend: [net, expansion, changes, aiAdded, aiRemoved].
function csmMonth(ym, rep) {
  const t = ((CSM.data.months || {})[rep] || {})[ym] || [0, 0, 0, 0, 0];
  return { net: t[0], expansion: t[1], changes: t[2], aiAdded: t[3], aiRemoved: t[4] };
}

// The firms behind a card's growth / AI numbers (needs the full MRR event list).
function csmMonthRows(ym, rep) {
  const rows = MRR.all.filter((e) => e.ym === ym && mrrAm(e) === rep);
  return { rows, aiRows: rows.filter((e) => e.ai) };
}

async function csmWithEvents(fn) {
  if (!MRR.data) {
    mrrModal('Loading…', '', '<div class="res-loading">Pulling the firm-level detail…</div>');
    prefetchMrr();
    await MRR.loading;
    mrrCloseModal();
    if (!MRR.data) return;
  }
  fn();
}

function csmHealth(rep) {
  const h = CSM.data.health;
  const accts = (h.accounts || []).filter((a) => rep == null || a[1] === rep);
  const grade = (a) => (a[2] == null ? 'none' : a[2] >= h.good ? 'good' : a[2] >= h.bad ? 'okay' : 'bad');
  const by = { good: [], okay: [], bad: [], none: [] };
  accts.forEach((a) => by[grade(a)].push(a));
  return by;
}

// Merlin AI Health: add-on firms graded by the share of new leads Merlin scored or worked.
function csmAiHealth(rep) {
  const h = CSM.data.ai || {};
  const grade = (f) => (f[2] == null ? 'none' : f[2] >= h.good ? 'good' : f[2] >= h.bad ? 'okay' : 'bad');
  const by = { good: [], okay: [], bad: [], none: [] };
  (h.firms || []).filter((f) => f[1] === rep).forEach((f) => by[grade(f)].push(f));
  return by;
}

// A good/okay/bad/none bar with its legend, shared by both health rows.
function csmHealthBar(h, noneLabel) {
  const total = h.good.length + h.okay.length + h.bad.length + h.none.length;
  const bar = (k) => (total ? `<i class="h-${k}" style="width:${(h[k].length / total) * 100}%"></i>` : '');
  return `<div class="csm-health">${bar('good')}${bar('okay')}${bar('bad')}${bar('none')}</div>
    <small class="csm-legend"><em class="h-good"></em>${h.good.length} good <em class="h-okay"></em>${h.okay.length} okay <em class="h-bad"></em>${h.bad.length} bad${h.none.length ? ` <em class="h-none"></em>${h.none.length} ${noneLabel}` : ''}</small>`;
}

const csmPct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
const csmTone = (v, good, ok) => (v == null ? '' : v >= good ? 'up' : v >= ok ? '' : 'down');

/* ---------- render ---------- */
function renderCsm() {
  const err = document.getElementById('csmError');
  if (!err) return;
  err.hidden = !CSM.error;
  err.textContent = CSM.error ? 'Couldn’t load the CSM page: ' + CSM.error : '';
  if (!CSM.data) { if (CSM.error) document.getElementById('csmBody').innerHTML = ''; return; }
  const cur = mrrCur();
  if (!CSM.ym) CSM.ym = cur;
  const ret = CSM.data.retention || {};
  const firms = ret.firms || [];
  const t6 = csmRetention(firms, 2, 1), t13 = csmRetention(firms, 4, 3);
  const reps = csmReps();
  const tile = (label, v, key, good, ok) => `<button type="button" class="mrr-kpi ${csmTone(v, good, ok)}" data-csm-ret="${key}"><span>${label}</span><b>${csmPct(v)}</b><small>Team · how ⓘ</small></button>`;

  document.getElementById('csmHero').innerHTML = `
    <div class="fa-hero-text">
      <div class="loop-eyebrow">Customer Success Managers · ${esc(mrrYmLabel(cur))}</div>
      <h2>CSM <span>Scorecard</span></h2>
      <p>Retention, growth, AI upsells and account health for each rep’s book. Click any number for the firms behind it.</p>
      <div class="mrr-kpis csm-kpis">
        ${tile('6-month NRR', t6.nrr, 'nrr6', 100, 95)}${tile('6-month GRR', t6.grr, 'grr6', 95, 90)}
        ${tile('13-month NRR', t13.nrr, 'nrr13', 100, 90)}${tile('13-month GRR', t13.grr, 'grr13', 90, 80)}
      </div>
      <div class="loop-actions"><button type="button" class="loop-btn" id="csmRefresh">↻ Refresh</button>
        <span class="mrr-sync">${ret.end ? `Book MRR as of ${esc(mrrYmLabel(ret.end))} · 6-month window from ${esc(ret.start6 ? mrrYmLabel(ret.start6) : '—')}, 13-month from ${esc(ret.start13 ? mrrYmLabel(ret.start13) : '—')}` : esc(ret.error || '')}</span></div>
    </div>
    <div class="fa-hero-art">
      <div class="loop-bubble">Every rep’s goal: ${mrrMoney(CSM_AI_TARGET)}/mo in new AI upsells.</div>
      <img src="assets/merlin-watering.webp" alt="Merlin watering a growing plant" loading="lazy">
    </div>`;

  const min = mrrAddYm(cur, -12);
  const cards = reps.map((rep) => {
    const r6 = csmRetention(firms, 2, 1, rep), r13 = csmRetention(firms, 4, 3, rep);
    const m = csmMonth(CSM.ym, rep);
    const h = csmHealth(rep);
    const total = h.good.length + h.okay.length + h.bad.length + h.none.length;
    const pct = Math.min(100, (m.aiAdded / CSM_AI_TARGET) * 100);
    const ai = csmAiHealth(rep);
    const aiTotal = ai.good.length + ai.okay.length + ai.bad.length + ai.none.length;
    return `<article class="csm-card">
      <header><span class="fa-av">${esc(rep.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span><h3>${esc(rep)}</h3></header>
      <div class="csm-ret">
        <span></span><span class="csm-ret-h">6 mo</span><span class="csm-ret-h">13 mo</span>
        <span class="csm-ret-l">NRR</span>
        <button type="button" data-csm-ret="nrr6" data-rep="${esc(rep)}" aria-label="6-month NRR"><b class="${csmTone(r6.nrr, 100, 95)}">${csmPct(r6.nrr)}</b></button>
        <button type="button" data-csm-ret="nrr13" data-rep="${esc(rep)}" aria-label="13-month NRR"><b class="${csmTone(r13.nrr, 100, 90)}">${csmPct(r13.nrr)}</b></button>
        <span class="csm-ret-l">GRR</span>
        <button type="button" data-csm-ret="grr6" data-rep="${esc(rep)}" aria-label="6-month GRR"><b class="${csmTone(r6.grr, 95, 90)}">${csmPct(r6.grr)}</b></button>
        <button type="button" data-csm-ret="grr13" data-rep="${esc(rep)}" aria-label="13-month GRR"><b class="${csmTone(r13.grr, 90, 80)}">${csmPct(r13.grr)}</b></button>
      </div>
      <button type="button" class="csm-row" data-csm-growth="${esc(rep)}">
        <span>Account growth</span><b class="${m.net >= 0 ? 'pos' : 'neg'}">${mrrMoney(m.net, true)}</b>
        <small>${mrrMoney(m.expansion, true)} expansion · ${mrrPlural(m.changes, 'change')}</small></button>
      <button type="button" class="csm-row" data-csm-ai="${esc(rep)}">
        <span>AI upsells</span><b>${mrrMoney(m.aiAdded)} <small>/ ${mrrMoney(CSM_AI_TARGET)}</small></b>
        <div class="csm-meter${m.aiAdded >= CSM_AI_TARGET ? ' hit' : ''}"><i style="width:${pct}%"></i></div>
        ${m.aiRemoved ? `<small>${mrrMoney(m.aiRemoved, true)} AI removed</small>` : ''}</button>
      <button type="button" class="csm-row" data-csm-health="${esc(rep)}">
        <span>Account health</span><b>${total} <small>accounts</small></b>
        ${csmHealthBar(h, 'unscored')}</button>
      <button type="button" class="csm-row" data-csm-aihealth="${esc(rep)}">
        <span>Merlin AI health</span><b>${aiTotal} <small>AI firms</small></b>
        ${!CSM.data.ai ? '<small>Loading…</small>' : CSM.data.ai.error ? `<small>${esc(CSM.data.ai.error)}</small>` : aiTotal ? csmHealthBar(ai, 'no new leads') : '<small>No firms with the AI credits add-on.</small>'}</button>
    </article>`;
  }).join('');

  document.getElementById('csmBody').innerHTML = `
    <div class="mrr-panel-head csm-head"><h3>By rep</h3>
      <span class="mrr-step"><button type="button" data-csm-ym="-1" ${CSM.ym <= min ? 'disabled' : ''} aria-label="Previous month">‹</button><b>Growth &amp; AI · ${esc(mrrYmLabel(CSM.ym))}</b><button type="button" data-csm-ym="1" ${CSM.ym >= cur ? 'disabled' : ''} aria-label="Next month">›</button></span></div>
    ${reps.length ? `<div class="csm-grid">${cards}</div>` : '<div class="empty-note">No reps found on the Implementation tab yet.</div>'}
    <p class="mrr-note csm-foot">Retention judges the book each rep held at the start of the window. Health is ChurnZero’s churn score: good is ${CSM.data.health.good}+, okay ${CSM.data.health.bad}–${CSM.data.health.good}, bad under ${CSM.data.health.bad}. AI upsells are AI credits add-ons and Merlin Copilot seats added to existing firms.${CSM.data.ai && !CSM.data.ai.error ? ` Merlin AI health covers firms with the AI credits add-on: good when Merlin scored or worked ${CSM.data.ai.good}%+ of their new leads in the last 30 days, okay ${CSM.data.ai.bad}–${CSM.data.ai.good}%, bad under ${CSM.data.ai.bad}%.` : ''}</p>`;
}

/* ---------- pop-ups ---------- */
function csmRetentionDrill(key, rep) {
  const ret = CSM.data.retention;
  const six = key.endsWith('6');
  const [si, ai] = six ? [2, 1] : [4, 3];
  const r = csmRetention(ret.firms || [], si, ai, rep || null);
  const start = six ? ret.start6 : ret.start13;
  const rows = r.book.slice().sort((a, b) => (a[5] - a[si]) - (b[5] - b[si]));
  const lost = rows.filter((f) => f[5] === 0).length;
  const delta = (f) => f[5] - f[si];
  MRR.drill = null;
  mrrModal(`${rep || 'Team'} — ${six ? '6' : '13'}-month retention`,
    `NRR ${csmPct(r.nrr)} · GRR ${csmPct(r.grr)} · ${mrrPlural(rows.length, 'firm')} owned at the end of ${esc(start ? mrrYmLabel(start) : '—')} · ${lost} since cancelled`,
    `<div class="mrr-method"><p><b>NRR</b> = the book’s MRR now (${mrrMoney(r.now)}) ÷ its MRR then (${mrrMoney(r.start)}). Upgrades count, so it can go over 100%.
      <b>GRR</b> counts each firm at no more than its starting MRR, so it only shows what was kept (cancellations and downgrades).</p></div>
    <div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Company</th>${rep ? '' : '<th>AM then</th>'}<th>MRR then</th><th>MRR now</th><th>Change</th></tr></thead><tbody>
      ${rows.map((f) => `<tr><td>${esc(f[0])}${f[5] === 0 ? ' <span class="mrr-badge">cancelled</span>' : ''}</td>${rep ? '' : `<td>${esc(f[ai] || '—')}</td>`}<td>${mrrMoney(f[si])}</td><td>${mrrMoney(f[5])}</td><td><b class="${delta(f) >= 0 ? 'pos' : 'neg'}">${mrrMoney(delta(f), true)}</b></td></tr>`).join('')}
    </tbody></table></div>`);
}

function csmHealthDrill(rep) {
  const h = csmHealth(rep);
  const order = [['bad', 'Bad'], ['okay', 'Okay'], ['good', 'Good'], ['none', 'Unscored']];
  const rows = order.flatMap(([k, l]) => h[k].sort((a, b) => (a[2] ?? 999) - (b[2] ?? 999)).map((a) => ({ a, k, l })));
  MRR.drill = null;
  mrrModal(`${rep} — account health`, `${h.good.length} good · ${h.okay.length} okay · ${h.bad.length} bad${h.none.length ? ` · ${h.none.length} unscored` : ''} · worst first`,
    `<div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Account</th><th>Health</th><th>Churn score</th><th>MRR</th></tr></thead><tbody>
      ${rows.map(({ a, k, l }) => `<tr><td>${esc(a[0])}</td><td><span class="csm-pill h-${k}">${l}</span></td><td>${a[2] == null ? '—' : Math.round(a[2])}</td><td>${mrrMoney(a[3])}</td></tr>`).join('')}
    </tbody></table></div>`);
}

function csmAiHealthDrill(rep) {
  const d = CSM.data.ai || {};
  const h = csmAiHealth(rep);
  const order = [['bad', 'Bad'], ['okay', 'Okay'], ['good', 'Good'], ['none', 'No new leads']];
  const rows = order.flatMap(([k, l]) => h[k].sort((a, b) => (a[2] ?? 999) - (b[2] ?? 999)).map((f) => ({ f, k, l })));
  const asOf = d.asOf ? `usage as of ${new Date(d.asOf).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'usage from a one-time Metabase export';
  MRR.drill = null;
  mrrModal(`${rep} — Merlin AI health`, `${h.good.length} good · ${h.okay.length} okay · ${h.bad.length} bad${h.none.length ? ` · ${h.none.length} with no new leads` : ''} · ${asOf}`,
    `<div class="mrr-method"><p><b>Coverage</b> = new leads Merlin scored or worked with Engage in the last 30 days ÷ the firm’s new leads in that time, capped at 100% (re-scoring older leads can push it over).
      Good is ${d.good}%+, okay ${d.bad}–${d.good}%, bad under ${d.bad}%. Every firm paying for the AI credits add-on is included, whenever it was added.</p></div>
    <div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Company</th><th>Health</th><th>Coverage</th><th>New leads</th><th>Scored</th><th>Engage</th><th>Credits used</th><th>Add-on MRR</th></tr></thead><tbody>
      ${rows.map(({ f, k, l }) => `<tr><td>${esc(f[0])}</td><td><span class="csm-pill h-${k}">${l}</span></td><td>${f[2] == null ? '—' : f[2] + '%'}</td><td>${f[3].toLocaleString()}</td><td>${f[4].toLocaleString()}</td><td>${f[5].toLocaleString()}</td><td>${mrrMoney(f[6])}</td><td>${mrrMoney(f[7])}</td></tr>`).join('')}
    </tbody></table></div>`);
}

function csmAiDrill(rep) {
  const m = Object.assign(csmMonth(CSM.ym, rep), csmMonthRows(CSM.ym, rep));
  MRR.drill = null;
  mrrModal(`${rep} — AI upsells, ${mrrYmLabel(CSM.ym)}`, `${mrrMoney(m.aiAdded)} added of the ${mrrMoney(CSM_AI_TARGET)} target${m.aiRemoved ? ` · ${mrrMoney(m.aiRemoved, true)} removed` : ''}`,
    m.aiRows.length ? `<div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Company</th><th>AI MRR change</th><th>Total change</th></tr></thead><tbody>
      ${m.aiRows.sort((a, b) => b.ai - a.ai).map((e) => `<tr><td>${esc(e.company)}</td><td><b class="${e.ai >= 0 ? 'pos' : 'neg'}">${mrrMoney(e.ai, true)}</b></td><td>${mrrMoney(e.amt, true)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty-note">No AI credits add-ons or Copilot seats added to existing firms this month yet.</div>');
}

function setupCsm() {
  const root = document.getElementById('csm');
  if (!root) return;
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#csmRefresh')) { loadCsm(true); return; }
    const ym = t.closest('[data-csm-ym]');
    if (ym) { CSM.ym = mrrAddYm(CSM.ym, Number(ym.dataset.csmYm)); renderCsm(); return; }
    const r = t.closest('[data-csm-ret]');
    if (r) { csmRetentionDrill(r.dataset.csmRet, r.dataset.rep); return; }
    const g = t.closest('[data-csm-growth]');
    if (g) { const rep = g.dataset.csmGrowth; csmWithEvents(() => mrrOpenDrill(`${rep} — account growth`, mrrYmLabel(CSM.ym), csmMonthRows(CSM.ym, rep).rows, 'move')); return; }
    const a = t.closest('[data-csm-ai]');
    if (a) { csmWithEvents(() => csmAiDrill(a.dataset.csmAi)); return; }
    const h = t.closest('[data-csm-health]');
    if (h) { csmHealthDrill(h.dataset.csmHealth); return; }
    const ah = t.closest('[data-csm-aihealth]');
    if (ah && CSM.data.ai && !CSM.data.ai.error) csmAiHealthDrill(ah.dataset.csmAihealth);
  });
}
