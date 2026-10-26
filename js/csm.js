/* ==========================================================================
   CSM — each rep's book: retention (6- and 13-month cohort and all-time NRR / GRR, and a
   cohort-by-age grid), growth this
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
      const [csm] = await Promise.all([mrrCall({ action: 'csm', force: !!force }), ensureTabData('impl'), loadExclusions()]);
      if (force) loadMrr(true); else prefetchMrr();
      const changed = !CSM.data || csm.built !== CSM.data.built || force;
      CSM.data = Object.assign({ history: {}, health: { accounts: [] } }, csm);
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
    if (saved && saved.months && saved.history) CSM.data = Object.assign({ history: {}, health: { accounts: [] } }, saved);
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
// kind 6 / 13: the firms whose first paid month was 6 / 13 months before last month (they've just
// completed that month), measured at the end of last month. 'bob': every firm the rep has had,
// measured now. NRR = MRR then ÷ starting MRR (expansion counts); GRR = the same with no firm
// counting for more than it started with. Firms: [company, am, signupYm, startMrr, lastMonthMrr, mrrNow].
const CSM_WINDOWS = { 6: '6 mo', 13: '13 mo', bob: 'BoB' };
function csmRetention(kind, rep) {
  const h = CSM.data.history || {};
  const cohort = kind === 'bob' ? null : h[`cohort${kind}`];
  const at = cohort ? 4 : 5;
  const book = (h.firms || []).filter((f) => (!cohort || f[2] === cohort) && (rep == null || f[1] === rep));
  const start = book.reduce((s, f) => s + f[3], 0);
  const now = book.reduce((s, f) => s + f[at], 0);
  const kept = book.reduce((s, f) => s + Math.min(f[at], f[3]), 0);
  return { book, at, cohort, start, now, nrr: start ? (now / start) * 100 : null, grr: start ? (kept / start) * 100 : null };
}
// Colour thresholds [good, okay] per window.
const CSM_TONE = { nrr: { 6: [100, 95], 13: [100, 90], bob: [100, 90] }, grr: { 6: [95, 90], 13: [90, 80], bob: [90, 80] } };
const csmTo = (metric, kind, v) => csmTone(v, ...CSM_TONE[metric][kind]);

// Card totals come pre-summed from the backend: [net, expansion, changes, aiAdded, aiRemoved].
function csmMonth(ym, rep) {
  const t = ((CSM.data.months || {})[rep] || {})[ym] || [0, 0, 0, 0, 0];
  return { net: t[0], expansion: t[1], changes: t[2], aiAdded: t[3], aiRemoved: t[4] };
}

// The firms behind a card's growth / AI numbers (needs the full MRR event list).
function csmMonthRows(ym, rep) {
  const skip = new Set(CSM.data.excluded || []);   // firms managers took out of the CSM numbers
  const rows = MRR.all.filter((e) => e.ym === ym && mrrAm(e) === rep && !skip.has(String(e.firm)));
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

// ChurnZero churn scores run the other way: the lower the score, the healthier the account.
const CSM_HEALTH = { good: 33, bad: 67 };   // good under 33, okay 33–67, bad 67+
function csmHealth(rep) {
  const h = CSM_HEALTH;
  const accts = (CSM.data.health.accounts || []).filter((a) => rep == null || a[1] === rep);
  const grade = (a) => (a[2] == null ? 'none' : a[2] < h.good ? 'good' : a[2] < h.bad ? 'okay' : 'bad');
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
  const hist = CSM.data.history || {};
  const reps = csmReps();
  const team = { 6: csmRetention(6), 13: csmRetention(13), bob: csmRetention('bob') };
  const tile = (metric, kind, label) => `<button type="button" class="mrr-kpi ${csmTo(metric, kind, team[kind][metric])}" data-csm-ret="${metric}" data-kind="${kind}"><span>${label} ${metric.toUpperCase()}</span><b>${csmPct(team[kind][metric])}</b><small>Team · ${mrrPlural(team[kind].book.length, 'firm')} · how ⓘ</small></button>`;

  document.getElementById('csmHero').innerHTML = `
    <div class="fa-hero-text">
      <div class="loop-eyebrow">Customer Success Managers · ${esc(mrrYmLabel(cur))}</div>
      <h2>CSM <span>Scorecard</span></h2>
      <p>Retention, growth, AI upsells and account health for each rep’s book. Click any number for the firms behind it.</p>
      <div class="mrr-kpis csm-kpis">
        ${tile('nrr', 6, '6-month')}${tile('nrr', 13, '13-month')}${tile('nrr', 'bob', 'All-time')}${tile('grr', 6, '6-month')}${tile('grr', 13, '13-month')}${tile('grr', 'bob', 'All-time')}
      </div>
      <div class="loop-actions"><button type="button" class="loop-btn" id="csmRefresh">↻ Refresh</button><button type="button" class="loop-btn" data-csm-cohort="">Team cohort analysis</button>
        <span class="mrr-sync">${hist.checkpoint ? `6- and 13-month: firms that signed up in ${esc(mrrYmLabel(hist.cohort6))} and ${esc(mrrYmLabel(hist.cohort13))}, as of the end of ${esc(mrrYmLabel(hist.checkpoint))} · All-time: every firm since ${esc(mrrYmLabel(hist.first))}, as of now` : esc(hist.error || '')}</span></div>
    </div>
    <div class="fa-hero-art">
      <div class="loop-bubble">Every rep’s goal: ${mrrMoney(CSM_AI_TARGET)}/mo in new AI upsells.</div>
      <img src="assets/merlin-watering.webp" alt="Merlin watering a growing plant" loading="lazy">
    </div>`;

  const min = mrrAddYm(cur, -12);
  const cards = reps.map((rep) => {
    const r = { 6: csmRetention(6, rep), 13: csmRetention(13, rep), bob: csmRetention('bob', rep) };
    const cell = (metric, kind) => `<button type="button" data-csm-ret="${metric}" data-kind="${kind}" data-rep="${esc(rep)}" aria-label="${CSM_WINDOWS[kind]} ${metric.toUpperCase()}"><b class="${csmTo(metric, kind, r[kind][metric])}">${csmPct(r[kind][metric])}</b></button>`;
    const m = csmMonth(CSM.ym, rep);
    const h = csmHealth(rep);
    const total = h.good.length + h.okay.length + h.bad.length + h.none.length;
    const pct = Math.min(100, (m.aiAdded / CSM_AI_TARGET) * 100);
    const ai = csmAiHealth(rep);
    const aiTotal = ai.good.length + ai.okay.length + ai.bad.length + ai.none.length;
    return `<article class="csm-card">
      <header><span class="fa-av">${esc(rep.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span><h3>${esc(rep)}</h3>
        <button type="button" class="csm-cohort-btn" data-csm-cohort="${esc(rep)}">Cohort analysis</button></header>
      <div class="csm-ret">
        <span></span>${Object.values(CSM_WINDOWS).map((l) => `<span class="csm-ret-h">${l}</span>`).join('')}
        <span class="csm-ret-l">NRR</span>${cell('nrr', 6)}${cell('nrr', 13)}${cell('nrr', 'bob')}
        <span class="csm-ret-l">GRR</span>${cell('grr', 6)}${cell('grr', 13)}${cell('grr', 'bob')}
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
        ${!CSM.data.ai ? '<small>Loading…</small>' : CSM.data.ai.error ? `<small>${esc(CSM.data.ai.error)}</small>` : aiTotal ? csmHealthBar(ai, `under ${CSM.data.ai.minLeads || 5} leads`) : '<small>No firms with the AI credits add-on.</small>'}</button>
    </article>`;
  }).join('');

  document.getElementById('csmBody').innerHTML = `
    <div class="mrr-panel-head csm-head"><h3>By rep <span id="csmExcl">${exclEntry()}</span></h3>
      <span class="mrr-step"><button type="button" data-csm-ym="-1" ${CSM.ym <= min ? 'disabled' : ''} aria-label="Previous month">‹</button><b>Growth &amp; AI · ${esc(mrrYmLabel(CSM.ym))}</b><button type="button" data-csm-ym="1" ${CSM.ym >= cur ? 'disabled' : ''} aria-label="Next month">›</button></span></div>
    ${reps.length ? `<div class="csm-grid">${cards}</div>` : '<div class="empty-note">No reps found on the Implementation tab yet.</div>'}
    <p class="mrr-note csm-foot">6- and 13-month retention follow the firms that just completed that month; all-time covers every firm in the rep’s book, including ones that left. Health is ChurnZero’s churn score, where lower is healthier: good is under ${CSM_HEALTH.good}, okay ${CSM_HEALTH.good}–${CSM_HEALTH.bad}, bad ${CSM_HEALTH.bad}+. AI upsells are AI credits add-ons and Merlin Copilot seats added to existing firms.${CSM.data.ai && !CSM.data.ai.error ? ` Merlin AI health covers firms with the AI credits add-on: good when Merlin scored or worked ${CSM.data.ai.good}%+ of their new leads in the last 30 days, okay ${CSM.data.ai.bad}–${CSM.data.ai.good}%, bad under ${CSM.data.ai.bad}%; firms with fewer than ${CSM.data.ai.minLeads || 5} new leads aren’t graded.` : ''}</p>`;
}

/* ---------- pop-ups ---------- */
function csmRetentionDrill(kind, rep) {
  const h = CSM.data.history || {};
  const r = csmRetention(kind, rep || null);
  const then = (f) => f[3], now = (f) => f[r.at], delta = (f) => now(f) - then(f);
  const rows = r.book.slice().sort((x, y) => delta(x) - delta(y));
  const lost = rows.filter((f) => now(f) === 0).length;
  const when = r.cohort ? `the end of ${esc(mrrYmLabel(h.checkpoint))}` : 'now';
  const scope = r.cohort
    ? `${mrrPlural(rows.length, 'firm')} that signed up in ${esc(mrrYmLabel(r.cohort))} and just completed month ${kind}`
    : `${mrrPlural(rows.length, 'firm')} ${rep ? 'in the book' : 'in total'}, since ${esc(mrrYmLabel(h.first))}`;
  MRR.drill = null;
  mrrModal(`${rep || 'Team'} — ${kind === 'bob' ? 'all-time (book of business)' : `${kind}-month`} retention`,
    `NRR ${csmPct(r.nrr)} · GRR ${csmPct(r.grr)} · ${scope} · ${lost} since cancelled`,
    `<div class="mrr-method"><p>Each firm starts at its MRR in its <b>first paid month</b> and is compared with its MRR at ${when}.
      <b>NRR</b> = ${mrrMoney(r.now)} ÷ ${mrrMoney(r.start)}; upgrades count, so it can go over 100%.
      <b>GRR</b> counts each firm at no more than its starting MRR, so it only shows what was kept (cancellations and downgrades).
      Firms count for their current AM, or the AM they had when they cancelled.${kind === 'bob' ? ` Firms already paying in ${esc(mrrYmLabel(h.first))}, when the snapshots begin, start from that month.` : ''}</p></div>
    ${rows.length ? `<div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Company</th>${rep ? '' : '<th>AM</th>'}<th>Signed up</th><th>Starting MRR</th><th>MRR ${r.cohort ? 'end of ' + esc(mrrYmLabel(h.checkpoint)) : 'now'}</th><th>Change</th>${overridesUnlocked ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map((f) => `<tr><td>${esc(f[0])}${now(f) === 0 ? ' <span class="mrr-badge">cancelled</span>' : ''}</td>${rep ? '' : `<td>${esc(f[1] || '—')}</td>`}<td>${esc(mrrYmLabel(f[2]))}</td><td>${mrrMoney(then(f))}</td><td>${mrrMoney(now(f))}</td><td><b class="${delta(f) >= 0 ? 'pos' : 'neg'}">${mrrMoney(delta(f), true)}</b></td>${overridesUnlocked ? `<td>${exclButton(f[6], f[0], 'CSM')}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty-note">No firms in this group.</div>'}`);
}

function csmHealthDrill(rep) {
  const h = csmHealth(rep);
  const order = [['bad', 'Bad'], ['okay', 'Okay'], ['good', 'Good'], ['none', 'Unscored']];
  const rows = order.flatMap(([k, l]) => h[k].sort((a, b) => (b[2] ?? -1) - (a[2] ?? -1)).map((a) => ({ a, k, l })));   // highest (worst) score first
  MRR.drill = null;
  mrrModal(`${rep} — account health`, `${h.good.length} good · ${h.okay.length} okay · ${h.bad.length} bad${h.none.length ? ` · ${h.none.length} unscored` : ''} · worst first`,
    `<div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Account</th><th>Health</th><th>Churn score</th><th>MRR</th>${overridesUnlocked ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map(({ a, k, l }) => `<tr><td>${esc(a[0])}</td><td><span class="csm-pill h-${k}">${l}</span></td><td>${a[2] == null ? '—' : Math.round(a[2])}</td><td>${mrrMoney(a[3])}</td>${overridesUnlocked ? `<td>${exclButton(a[4], a[0], 'CSM')}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`);
}

function csmAiHealthDrill(rep) {
  const d = CSM.data.ai || {};
  const h = csmAiHealth(rep);
  const few = `Under ${d.minLeads || 5} leads`;
  const order = [['bad', 'Bad'], ['okay', 'Okay'], ['good', 'Good'], ['none', few]];
  const rows = order.flatMap(([k, l]) => h[k].sort((a, b) => (a[2] ?? 999) - (b[2] ?? 999)).map((f) => ({ f, k, l })));
  const asOf = d.asOf ? `usage as of ${new Date(d.asOf).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'usage from a one-time Metabase export';
  MRR.drill = null;
  mrrModal(`${rep} — Merlin AI health`, `${h.good.length} good · ${h.okay.length} okay · ${h.bad.length} bad${h.none.length ? ` · ${h.none.length} with under ${d.minLeads || 5} new leads (not graded)` : ''} · ${asOf}`,
    `<div class="mrr-method"><p><b>Coverage</b> = new leads Merlin scored or worked with Engage in the last 30 days ÷ the firm’s new leads in that time, capped at 100% (re-scoring older leads can push it over).
      Good is ${d.good}%+, okay ${d.bad}–${d.good}%, bad under ${d.bad}%. Firms with fewer than ${d.minLeads || 5} new leads aren’t graded. Every firm paying for the AI credits add-on is included, whenever it was added.</p></div>
    <div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Company</th><th>Health</th><th>Coverage</th><th>New leads</th><th>Scored</th><th>Engage</th><th>Credits used</th><th>Add-on MRR</th>${overridesUnlocked ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map(({ f, k, l }) => `<tr><td>${esc(f[0])}</td><td><span class="csm-pill h-${k}">${l}</span></td><td>${f[2] == null ? '—' : f[2] + '%'}</td><td>${f[3].toLocaleString()}</td><td>${f[4].toLocaleString()}</td><td>${f[5].toLocaleString()}</td><td>${mrrMoney(f[6])}</td><td>${mrrMoney(f[7])}</td>${overridesUnlocked ? `<td>${exclButton(f[8], f[0], 'CSM')}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`);
}

function csmAiDrill(rep) {
  const m = Object.assign(csmMonth(CSM.ym, rep), csmMonthRows(CSM.ym, rep));
  MRR.drill = null;
  mrrModal(`${rep} — AI upsells, ${mrrYmLabel(CSM.ym)}`, `${mrrMoney(m.aiAdded)} added of the ${mrrMoney(CSM_AI_TARGET)} target${m.aiRemoved ? ` · ${mrrMoney(m.aiRemoved, true)} removed` : ''}`,
    m.aiRows.length ? `<div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Company</th><th>AI MRR change</th><th>Total change</th>${overridesUnlocked ? '<th></th>' : ''}</tr></thead><tbody>
      ${m.aiRows.sort((a, b) => b.ai - a.ai).map((e) => `<tr><td>${esc(e.company)}</td><td><b class="${e.ai >= 0 ? 'pos' : 'neg'}">${mrrMoney(e.ai, true)}</b></td><td>${mrrMoney(e.amt, true)}</td>${overridesUnlocked ? `<td>${exclButton(e.firm, e.company, 'CSM')}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty-note">No AI credits add-ons or Copilot seats added to existing firms this month yet.</div>');
}

/* ---------- cohort analysis ---------- */
// Firms grouped by signup month (or quarter); each cell is the cohort's running NRR / GRR that many
// months (quarters) after signup, against its MRR in the signup month. Same firms, credit and
// GRR rule as the retention cells, so a cohort's M6 / M13 matches the 6- and 13-month numbers.
// Firms already paying when the snapshots begin aren't a real cohort, so they're left out.
const CSM_COH = { rep: '', period: 'month', metric: 'nrr', cohorts: 24, maxAge: 24 };
const csmYmDiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5));

function csmCohortGrid() {
  const h = CSM.data.history || {};
  const o = CSM_COH, step = o.period === 'quarter' ? 3 : 1;
  const key = (ym) => (step === 3 ? `${ym.slice(0, 4)}-Q${Math.ceil(+ym.slice(5) / 3)}` : ym);
  const label = (k) => (step === 3 ? `${k.slice(5)} ${k.slice(0, 4)}` : mrrYmLabel(k));
  const oldest = key(mrrAddYm(h.checkpoint, -(o.cohorts - 1)));
  const groups = {};
  (h.firms || []).forEach((f) => {
    if ((o.rep && f[1] !== o.rep) || !f[7] || !f[7].length || f[2] <= h.first || f[2] > h.checkpoint || key(f[2]) < oldest) return;
    (groups[key(f[2])] = groups[key(f[2])] || []).push(f);
  });
  const ages = Math.floor(o.maxAge / step);
  const rows = Object.keys(groups).sort().map((k) => {
    const firms = groups[k];
    const start = firms.reduce((s, f) => s + f[3], 0);
    const cells = [];
    for (let a = 1; a <= ages; a++) {
      const m = a * step;
      // Only once every firm in the cohort has finished that month.
      if (firms.some((f) => csmYmDiff(f[2], h.checkpoint) < m)) { cells.push(null); continue; }
      const at = (f) => f[7][m] || 0;
      const now = firms.reduce((s, f) => s + at(f), 0);
      const kept = firms.reduce((s, f) => s + Math.min(at(f), f[3]), 0);
      const paying = firms.filter((f) => at(f) > 0).length;
      cells.push({ age: a, v: start ? ((o.metric === 'nrr' ? now : kept) / start) * 100 : null, mrr: o.metric === 'nrr' ? now : kept, paying });
    }
    return { k, label: label(k), firms, start, cells };
  });
  return { rows, ages, step, customers: rows.reduce((s, r) => s + r.firms.length, 0) };
}

function csmCohortCell(c, r) {
  if (!c) return '<td class="coh-na">–</td>';
  if (c.v == null) return '<td>—</td>';
  const v = c.v;
  const bg = v >= 100 ? `rgba(20,184,166,${(0.14 + Math.min((v - 100) / 50, 1) * 0.5).toFixed(2)})` : `rgba(244,63,94,${(0.16 + Math.min((100 - v) / 60, 1) * 0.56).toFixed(2)})`;
  const tip = `${mrrMoney(c.mrr)} of ${mrrMoney(r.start)} starting MRR · ${c.paying} of ${r.firms.length} still paying`;
  return `<td class="coh-cell" style="background:${bg}" title="${esc(tip)} · click for the firms" data-coh-k="${esc(r.k)}" data-coh-age="${c.age}" tabindex="0" role="button">${Math.round(v * 10) / 10}%</td>`;
}

// The firms behind one cell: each one's starting MRR and its MRR at that age.
function csmCohortDrill(k, age) {
  const o = CSM_COH, g = csmCohortGrid(), r = g.rows.find((x) => x.k === k);
  if (!r) return;
  const m = age * g.step, at = (f) => f[7][m] || 0, c = r.cells[age - 1];
  const rows = r.firms.slice().sort((x, y) => (at(x) - x[3]) - (at(y) - y[3]));
  const lost = rows.filter((f) => at(f) === 0).length;
  const p = g.step === 3 ? `Q${age}` : `M${age}`;
  MRR.drill = null;
  mrrModal(`${o.rep || 'Team'} — ${r.label} cohort, ${p}`,
    `${o.metric.toUpperCase()} ${csmPct(c && c.v)} · ${mrrPlural(rows.length, 'firm')} · ${lost} cancelled by then · ${m} month${m === 1 ? '' : 's'} after signup`,
    `<div class="coh-back"><button type="button" class="csm-cohort-btn" data-coh-back>‹ Back to cohort analysis</button></div>
    <div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Company</th>${o.rep ? '' : '<th>AM</th>'}<th>Signed up</th><th>Starting MRR</th><th>MRR at ${p}</th><th>Change</th>${overridesUnlocked ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map((f) => { const d = at(f) - f[3]; return `<tr><td>${esc(f[0])}${at(f) === 0 ? ' <span class="mrr-badge">cancelled</span>' : ''}</td>${o.rep ? '' : `<td>${esc(f[1] || '—')}</td>`}<td>${esc(mrrYmLabel(f[2]))}</td><td>${mrrMoney(f[3])}</td><td>${mrrMoney(at(f))}</td><td><b class="${d >= 0 ? 'pos' : 'neg'}">${mrrMoney(d, true)}</b></td>${overridesUnlocked ? `<td>${exclButton(f[6], f[0], 'CSM')}</td>` : ''}</tr>`; }).join('')}
    </tbody></table></div>`, { back: () => csmCohortOpen(o.rep) });
  document.getElementById('mrrDrill').addEventListener('click', (e) => { if (e.target.closest('[data-coh-back]')) mrrCloseModal(); });
}

function csmCohortBody() {
  const o = CSM_COH, g = csmCohortGrid(), h = CSM.data.history || {};
  const seg = (k, opts) => `<div class="mrr-seg">${opts.map(([v, l]) => `<button type="button" data-coh-${k}="${v}" aria-pressed="${o[k] === v}">${l}</button>`).join('')}</div>`;
  const pick = (k, label) => `<label class="coh-pick">${label} <select class="fb-select" data-coh-sel="${k}">${[6, 12, 24, 36].map((n) => `<option value="${n}" ${o[k] === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
  const p = g.step === 3 ? 'Q' : 'M';
  return `<div class="coh-bar">${pick('cohorts', 'Cohorts (months)')}${pick('maxAge', 'Max age (months)')}
      <span class="coh-gap"></span>${seg('period', [['month', 'Monthly'], ['quarter', 'Quarterly']])}${seg('metric', [['nrr', 'NRR'], ['grr', 'GRR']])}</div>
    <div class="coh-totals">Total cohorts: <b>${g.rows.length}</b> <span>Total customers: <b>${g.customers}</b></span></div>
    ${g.rows.length ? `<div class="table-wrap coh-wrap"><table class="csm-cohort"><thead><tr><th>Cohort</th><th>#</th>${Array.from({ length: g.ages }, (_, i) => `<th>${p}${i + 1}</th>`).join('')}</tr></thead><tbody>
      ${g.rows.map((r) => `<tr><td title="${esc(mrrMoney(r.start))} starting MRR">${esc(r.label)}</td><td>${r.firms.length}</td>${r.cells.map((c) => csmCohortCell(c, r)).join('')}</tr>`).join('')}
    </tbody></table></div>` : `<div class="empty-note">${(h.firms || []).some((f) => f[7] && f[7].length) ? 'No firms signed up in this window.' : 'The month-by-month MRR arrives with the next hourly snapshot.'}</div>`}
    <div class="mrr-method"><p>Each row is the firms that signed up (first paid) in that ${g.step === 3 ? 'quarter' : 'month'}. ${p}${g.step === 3 ? '2 is 6 months' : '6 is 6 months'} after signup, measured at that month’s end against the cohort’s MRR in its signup month.
      <b>NRR</b> counts upgrades, so it can go over 100%; <b>GRR</b> counts each firm at no more than it started with. Firms count for their current AM, or the AM they had when they cancelled.
      Months run through ${esc(mrrYmLabel(h.checkpoint))} (the last full month); “–” is a month the cohort hasn’t reached yet. Hover a cell for the dollars behind it; click it for the firms.</p></div>`;
}

function csmCohortOpen(rep) {
  CSM_COH.rep = rep || '';
  MRR.drill = null;
  mrrModal(`${rep || 'Team'} — cohort analysis`, `Running ${CSM_COH.metric.toUpperCase()} by signup cohort and age`, csmCohortBody());
  const wrap = document.getElementById('mrrDrill');
  wrap.querySelector('.drill').classList.add('drill-wide');
  const redraw = () => {
    wrap.querySelector('.drill-body').innerHTML = csmCohortBody();
    wrap.querySelector('.drill-note').textContent = `Running ${CSM_COH.metric.toUpperCase()} by signup cohort and age`;
  };
  const cell = (e) => { const td = e.target.closest('[data-coh-age]'); if (td) csmCohortDrill(td.dataset.cohK, Number(td.dataset.cohAge)); return !!td; };
  wrap.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-coh-age]')) { e.preventDefault(); cell(e); } });
  wrap.addEventListener('click', (e) => {
    if (cell(e)) return;
    const b = e.target.closest('[data-coh-period],[data-coh-metric]');
    if (!b) return;
    if (b.dataset.cohPeriod) CSM_COH.period = b.dataset.cohPeriod;
    if (b.dataset.cohMetric) CSM_COH.metric = b.dataset.cohMetric;
    redraw();
  });
  wrap.addEventListener('change', (e) => {
    const s = e.target.closest('[data-coh-sel]');
    if (s) { CSM_COH[s.dataset.cohSel] = Number(s.value); redraw(); }
  });
}

function setupCsm() {
  const root = document.getElementById('csm');
  if (!root) return;
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#csmRefresh')) { loadCsm(true); return; }
    const co = t.closest('[data-csm-cohort]');
    if (co) { csmCohortOpen(co.dataset.csmCohort); return; }
    const ym = t.closest('[data-csm-ym]');
    if (ym) { CSM.ym = mrrAddYm(CSM.ym, Number(ym.dataset.csmYm)); renderCsm(); return; }
    const r = t.closest('[data-csm-ret]');
    if (r) { csmRetentionDrill(r.dataset.kind === 'bob' ? 'bob' : Number(r.dataset.kind), r.dataset.rep); return; }
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
