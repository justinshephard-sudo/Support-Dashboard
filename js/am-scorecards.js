/* ==========================================================================
   CS Scorecards ▸ Account Managers (manager mode only; until the 2027-01-01 IM/CSM system).
   History (April 2025 – October 2026) comes from the scorecards Apps Script (am-history.js,
   private). Every month after that is calculated here with the same rubric:
     CSAT            onboarding CSAT responses that month (Implementation tab), average ÷ 5
     Onboarding days average days of the onboardings finished that month
     3/6/13-mo NRR   firms whose first paid month was 3/6/13 months before, MRR at that month ÷
     and GRR         starting MRR (GRR: no firm counts for more than it started with) — CSM tab data
   Firms excluded on the dashboard don't count. Total = average of the scores that have data.
   ========================================================================== */
let SC_TAB = 'support';
try { SC_TAB = localStorage.getItem('cs-sc-tab') === 'am' ? 'am' : 'support'; } catch (e) { /* private mode */ }
const AMS = { hist: null, exclusions: [], loading: null, current: null, chart: null };
const AM_FIRST_CALC = '2026-11';   // months before this come from the saved history

// Rubric bands (AM_Scorecard_Rubric.xlsx). Ratios are rounded to 3 places so 0.9999 reads as 100%.
const AM_METRICS = [
  { key: 'csat', label: 'CSAT', kind: 'pct', score: (v) => (v < 0.8 ? 1 : v < 0.88 ? 2 : v < 0.91 ? 3 : v < 0.95 ? 4 : 5) },
  { key: 'onb', label: 'Onboarding days', kind: 'days', score: (v) => (v >= 90 ? 1 : v >= 80 ? 2 : v >= 70 ? 3 : v >= 60 ? 4 : 5) },
  { key: 'nrr3', label: '3-mo NRR', kind: 'pct', score: (v) => (v < 0.95 ? 1 : v < 1 ? 2 : v === 1 ? 3 : v < 1.05 ? 4 : 5) },
  { key: 'grr3', label: '3-mo GRR', kind: 'pct', score: (v) => (v < 0.94 ? 1 : v < 1 ? 2 : 5) },
  { key: 'nrr6', label: '6-mo NRR', kind: 'pct', score: (v) => (v < 0.95 ? 1 : v < 1 ? 2 : v === 1 ? 3 : v < 1.05 ? 4 : 5) },
  { key: 'grr6', label: '6-mo GRR', kind: 'pct', score: (v) => (v < 0.94 ? 1 : v < 1 ? 2 : 5) },
  { key: 'nrr13', label: '13-mo NRR', kind: 'pct', score: (v) => (v < 0.81 ? 1 : v < 0.93 ? 2 : v <= 1 ? 3 : v < 1.05 ? 4 : 5) },
  { key: 'grr13', label: '13-mo GRR', kind: 'pct', score: (v) => (v < 0.75 ? 1 : v < 0.86 ? 2 : v < 0.94 ? 3 : v < 0.98 ? 4 : 5) },
];
const amR3 = (v) => Math.round(v * 1000) / 1000;
const amYmLabel = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 15).toLocaleDateString([], { month: 'short', year: 'numeric' });
const amAddYm = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 15); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
function amYm(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const d = new Date(s + ' 15');
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ---- data ---- */
async function amLoad(force) {
  if (AMS.loading && !force) return AMS.loading;
  AMS.loading = (async () => {
    const [h] = await Promise.all([
      scCall({ action: 'amHistory' }),
      CSM.data && !force ? null : loadCsm(!!force),
      ensureTabData('impl'),
    ]);
    AMS.hist = h.rows || [];
    AMS.exclusions = h.exclusions || [];
  })();
  try { await AMS.loading; } catch (e) { AMS.loading = null; throw e; }
  return AMS.loading;
}

// History row → { ym, am, values, scores, total, upsell, source }
function amFromHistory(r) {
  const v = {}, s = {};
  AM_METRICS.forEach((m, i) => { v[m.key] = r[2 + i * 2]; s[m.key] = r[3 + i * 2]; });
  return { ym: r[0], am: r[1], values: v, scores: s, total: r[18], upsell: r[19], source: 'history' };
}

// One AM's numbers for one month, from the dashboard's own data.
function amCalc(am, ym) {
  const v = {}, s = {};
  const ev = (IMPL.events || []).filter((e) => amYm(e.Month || e.Date) === ym && (e.AccountManager || '').trim() === am && String(e.Excluded) !== '1');
  const csat = ev.filter((e) => e.Type === 'csat' && toNumber(e.Score)).map((e) => toNumber(e.Score));
  v.csat = csat.length ? csat.reduce((a, b) => a + b, 0) / csat.length / 5 : null;
  const days = ev.filter((e) => e.Type === 'closed' && toNumber(e.Days) > 0).map((e) => toNumber(e.Days));
  v.onb = days.length ? days.reduce((a, b) => a + b, 0) / days.length : null;
  const h = (CSM.data && CSM.data.history) || {};
  [3, 6, 13].forEach((w) => {
    const cohort = amAddYm(ym, -w);
    const tooOld = h.first && cohort <= h.first;
    const book = tooOld ? [] : (h.firms || []).filter((f) => f[1] === am && f[2] === cohort);
    const val = (f) => { const m = f[7] || []; return m[w] != null ? m[w] : (ym === h.now ? f[5] : ym === h.checkpoint ? f[4] : 0); };
    const start = book.reduce((t, f) => t + f[3], 0);
    v['nrr' + w] = start ? book.reduce((t, f) => t + val(f), 0) / start : null;
    v['grr' + w] = start ? book.reduce((t, f) => t + Math.min(val(f), f[3]), 0) / start : null;
    v['book' + w] = book.length;
  });
  AM_METRICS.forEach((m) => { s[m.key] = v[m.key] == null ? null : m.score(m.kind === 'pct' ? amR3(v[m.key]) : v[m.key]); });
  const present = AM_METRICS.map((m) => s[m.key]).filter((x) => x != null);
  const months = (CSM.data && CSM.data.months && CSM.data.months[am]) || {};
  const upsell = months[ym] ? months[ym][1] : null;
  return { ym, am, values: v, scores: s, total: present.length ? present.reduce((a, b) => a + b, 0) / present.length : null, upsell,
    source: ym === ((CSM.data && CSM.data.history && CSM.data.history.now) || '') ? 'partial' : 'calc' };
}

function amNames() {
  const set = new Set((AMS.hist || []).map((r) => r[1]));
  return [...set].sort();
}

function amMonths(am) {
  const rows = (AMS.hist || []).filter((r) => r[1] === am).map(amFromHistory);
  const now = (CSM.data && CSM.data.history && CSM.data.history.now) || '';
  for (let ym = AM_FIRST_CALC; now && ym <= now; ym = amAddYm(ym, 1)) rows.push(amCalc(am, ym));
  return rows.sort((a, b) => (a.ym < b.ym ? 1 : -1));
}

/* ---- render ---- */
function amFmt(m, v) {
  if (v == null || v === '') return '–';
  return m.kind === 'pct' ? `${(v * 100).toFixed(1)}%` : `${Math.round(v * 10) / 10}`;
}
const amChip = (sc) => (sc == null ? '<span class="am-sc none">–</span>' : `<span class="am-sc s${Math.round(sc)}">${Math.round(sc)}</span>`);

function renderAmList() {
  const sheetLink = document.getElementById('scSheetLink');
  if (sheetLink) sheetLink.hidden = true;
  SC.current = null;
  AMS.current = null;
  document.getElementById('scBack').hidden = true;
  document.getElementById('scTitle').textContent = 'CS Scorecards';
  document.getElementById('scSub').textContent = 'Account Managers: monthly scores from CSAT, onboarding time and 3/6/13-month NRR and GRR.';
  const body = document.getElementById('scBody');
  if (!AMS.hist) { body.innerHTML = '<div class="res-loading">Loading the AM scorecards…</div>'; amLoad().then(() => SC_TAB === 'am' && !AMS.current && renderAmList()).catch((e) => { body.innerHTML = `<div class="error-banner">Couldn’t load: ${esc(e.message)}</div>`; }); return; }
  const cards = amNames().map((am) => {
    const ms = amMonths(am);
    const latest = ms.find((m) => m.source !== 'partial' && m.total != null) || ms[0];
    const lvl = latest ? scLevel(latest.total) : null;
    const spark = ms.slice(0, 6).reverse().map((m) => `<i style="height:${m.total == null ? 4 : Math.max(8, (m.total / 5) * 100)}%" class="${m.source === 'partial' ? 'p' : ''}" title="${esc(amYmLabel(m.ym))}: ${m.total == null ? '–' : m.total.toFixed(2)}"></i>`).join('');
    return `<button type="button" class="sc-rep am-rep" data-am="${esc(am)}">
        <span class="sc-rep-head"><span class="sc-rep-name">${esc(am)}</span><span class="sc-rep-role">${latest ? esc(amYmLabel(latest.ym)) : ''}</span></span>
        <span class="sc-rep-total">${latest && latest.total != null ? latest.total.toFixed(2) : '–'}</span>
        ${lvl ? `<span class="sc-level l${lvl[0]}">${esc(lvl[1])}</span>` : '<span class="sc-level l3">No score yet</span>'}
        <span class="am-spark">${spark}</span>
      </button>`;
  }).join('');
  body.innerHTML = `<div class="sc-grid">${cards}</div>${amCheckHtml()}${amRubricHtml()}`;
}

function renderAmCard(am) {
  const sheetLink = document.getElementById('scSheetLink');
  if (sheetLink) sheetLink.hidden = true;
  AMS.current = am;
  document.getElementById('scBack').hidden = false;
  document.getElementById('scTitle').textContent = am;
  document.getElementById('scSub').textContent = 'Account Manager scorecard · newest month first';
  const ms = amMonths(am);
  const head = `<tr><th class="txt">Month</th>${AM_METRICS.map((m) => `<th>${esc(m.label)}</th>`).join('')}<th>Total</th><th>Upsell MRR</th></tr>`;
  const rows = ms.map((m) => {
    const lvl = scLevel(m.total);
    return `<tr class="${m.source}"><td class="txt">${esc(amYmLabel(m.ym))}${m.source === 'partial' ? ' <small>to date</small>' : m.source === 'calc' ? ' <small>calculated</small>' : ''}</td>
      ${AM_METRICS.map((x) => `<td><span class="am-v">${amFmt(x, m.values[x.key])}</span>${amChip(m.scores[x.key])}</td>`).join('')}
      <td><b class="am-total">${m.total == null ? '–' : m.total.toFixed(2)}</b>${lvl ? `<span class="am-lvl l${lvl[0]}">${lvl[0]}</span>` : ''}</td>
      <td>${m.upsell == null ? '–' : fmtMoney(m.upsell)}</td></tr>`;
  }).join('');
  document.getElementById('scBody').innerHTML = `
    <div class="am-chart-wrap"><canvas id="amChart" height="90"></canvas></div>
    <div class="table-wrap am-table-wrap"><table class="am-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
    <p class="mrr-note">Each metric is scored 1–5 with the rubric below; the total is the average of the scores that have data. Months through October 2026 are the saved history (with its exclusions); later months are calculated from the dashboard’s CSM and Implementation data, leaving out firms excluded on the dashboard. The current month is “to date”.</p>
    ${amRubricHtml(true)}`;
  const pts = ms.slice().reverse().filter((m) => m.total != null);
  if (window.Chart && pts.length) {
    if (AMS.chart) AMS.chart.destroy();
    AMS.chart = new Chart(document.getElementById('amChart'), {
      type: 'line',
      data: { labels: pts.map((m) => amYmLabel(m.ym)), datasets: [{ label: 'Total score', data: pts.map((m) => Math.round(m.total * 100) / 100), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.12)', fill: true, tension: 0.3, pointRadius: 3 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 1, max: 5, ticks: { stepSize: 1 } }, x: { ticks: { maxRotation: 0, autoSkip: true } } } },
    });
  }
}

// Side-by-side for the last saved months, so the calculation can be trusted before it takes over.
function amCheckHtml() {
  const last = [...new Set((AMS.hist || []).map((r) => r[0]))].sort().slice(-2);
  if (!last.length || !CSM.data) return '';
  const rows = [];
  last.forEach((ym) => amNames().forEach((am) => {
    const h = (AMS.hist || []).filter((r) => r[0] === ym && r[1] === am).map(amFromHistory)[0];
    if (!h) return;
    const c = amCalc(am, ym);
    rows.push(`<tr><td class="txt">${esc(amYmLabel(ym))}</td><td class="txt">${esc(am)}</td>${AM_METRICS.map((m) => {
      const same = h.scores[m.key] == null && c.scores[m.key] == null ? true : h.scores[m.key] === c.scores[m.key];
      return `<td class="${same ? '' : 'am-diff'}">${amFmt(m, h.values[m.key])} → ${amFmt(m, c.values[m.key])}</td>`;
    }).join('')}<td>${h.total == null ? '–' : h.total.toFixed(2)} → ${c.total == null ? '–' : c.total.toFixed(2)}</td></tr>`);
  }));
  return `<details class="sc-former am-check"><summary>Check the calculation against the saved history (${last.map(amYmLabel).join(', ')})</summary>
    <p class="mrr-note">Saved value → what the dashboard calculates today. Highlighted cells score differently. Differences come from exclusions made in the old dashboard, later MRR corrections, or firms that changed AM.</p>
    <div class="table-wrap"><table class="am-table"><thead><tr><th class="txt">Month</th><th class="txt">AM</th>${AM_METRICS.map((m) => `<th>${esc(m.label)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}

function amRubricHtml(open) {
  const r = [
    ['CSAT (avg ÷ 5)', '< 80%', '80% – < 88%', '88% – < 91%', '91% – < 95%', '≥ 95%'],
    ['Onboarding time (days)', '≥ 90', '80 – < 90', '70 – < 80', '60 – < 70', '< 60'],
    ['3-mo & 6-mo NRR', '< 95%', '95% – < 100%', '100%', '> 100% – < 105%', '≥ 105%'],
    ['13-mo NRR', '< 81%', '81% – < 93%', '93% – 100%', '> 100% – < 105%', '≥ 105%'],
    ['3-mo & 6-mo GRR', '< 94%', '94% – < 100%', '—', '—', '100%'],
    ['13-mo GRR', '< 75%', '75% – < 86%', '86% – < 94%', '94% – < 98%', '≥ 98%'],
  ];
  return `<details class="sc-rubric-wrap am-rubric"><summary>AM rubric</summary><div class="table-wrap"><table><thead><tr><th class="txt">Metric</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr></thead>
    <tbody>${r.map((x) => `<tr><td class="txt">${esc(x[0])}</td>${x.slice(1).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="mrr-note">Total = average of the sub-scores that have data; blank metrics are skipped. Levels: 4.5+ Excellent, 3.5+ Exceeds, 2.5+ Meets, 1.5+ Needs Improvement.</p></details>`;
}

function setScTab(tab) {
  SC_TAB = tab;
  try { localStorage.setItem('cs-sc-tab', tab); } catch (e) { /* private mode */ }
  document.querySelectorAll('[data-sc-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.scTab === tab)));
  const link = document.getElementById('scSheetLink');
  if (link) link.hidden = tab === 'am';
  if (tab === 'am') renderAmList(); else if (SC.loaded) renderScorecardList(); else loadScorecards();
}

function setupAmScorecards() {
  document.getElementById('scRefresh')?.addEventListener('click', () => {
    if (SC_TAB !== 'am') return;
    AMS.hist = null;
    amLoad(true).then(() => (AMS.current ? renderAmCard(AMS.current) : renderAmList())).catch(() => {});
  });
  document.querySelectorAll('[data-sc-tab]').forEach((b) => b.addEventListener('click', () => setScTab(b.dataset.scTab)));
  document.querySelectorAll('[data-sc-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.scTab === SC_TAB)));
  document.getElementById('scBody').addEventListener('click', (e) => {
    const card = e.target.closest('.am-rep');
    if (card) { e.stopPropagation(); renderAmCard(card.dataset.am); window.scrollTo({ top: document.getElementById('view-scorecards').offsetTop - 70 }); }
  }, true);
}
