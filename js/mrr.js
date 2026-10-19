/* ==========================================================================
   MRR Report — existing-customer MRR movement, churn outlook, and retention.
   Data: apps-script/mrr-report (reads the Chargebee sync's sheets with one set
   of cleaning rules, so every view agrees). Everyone signed in can see it.
   Most detail lives behind clicks: every number, bar and row opens the firms
   behind it, and each forecast has a "How it's calculated" pop-up.
   ========================================================================== */
const MRR_URL = 'https://script.google.com/macros/s/AKfycbxWBNVsOhP027_V8jpCJ52lja3iMtVehZlQUVG9T2g2k2PLt84bgU_JtENO24LNd0DD/exec';
const MRR_CATS = [
  { key: 'u', label: 'Upgrades', color: '--st-good' },
  { key: 'r', label: 'Reactivations', color: '--slot-2' },
  { key: 'd', label: 'Downgrades', color: '--st-warn' },
  { key: 'c', label: 'Cancellations', color: '--st-critical' },
];
const MRR_REASON_ORDER = ['Product', 'Onboarding', 'Support', 'Pricing', 'Sales', 'Competitor', 'External', 'No Reason Provided', 'Non-payment', 'Other'];
const MRR_ICP_LEADS = 50;
const MRR_UNASSIGNED = '— Unassigned —';
const MRR = {
  data: null, loading: false, events: [], sched: [],
  view: 'leaderboard', lbRange: 'month', period: 'next120', monthYm: '', groupBy: 'am', insightsYm: '',
  charts: {}, drill: null,
};

/* ---------- formatting ---------- */
const mrrMoney = (n, signed) => {
  const v = Math.round(Math.abs(n || 0)).toLocaleString('en-US');
  if (signed) return (n > 0.5 ? '+$' : n < -0.5 ? '-$' : '$') + v;
  return '$' + v;
};
const mrrToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const mrrYm = (d) => d.slice(0, 7);
const mrrAddYm = (ym, n) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const mrrAddDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const MRR_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mrrYmLabel = (ym, short) => { const [y, m] = ym.split('-'); return short ? `${MRR_MON[m - 1]} ’${y.slice(2)}` : `${MRR_MON[m - 1]} ${y}`; };
const mrrDays = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const mrrSum = (rows, f = (e) => e.amt) => rows.reduce((s, e) => s + f(e), 0);
const mrrPlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------- data ---------- */
async function mrrCall(body) {
  const res = await fetch(MRR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: AUTH.token }, body)),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const mrrUnpack = (p) => p.rows.map((r) => Object.fromEntries(p.fields.map((f, i) => [f, r[i]])));

function mrrPrepare(d) {
  const today = mrrToday();
  const sf = d.sf || {};
  const enrich = (e) => {
    const s = sf[e.firm] || [];
    e.practice = s[0] || '';
    e.reason = s[1] || (e.notPaid ? 'Not paid' : '');
    e.details = s[2] || '';
    e.score = s[3] || '';
    e.csat = s[4] || '';
    e.leadsN = mrrLeads(s[5] || e.leads);
    e.am = e.am || '';
    return e;
  };
  MRR.events = mrrUnpack(d.events).map(enrich);
  // Scheduled cancellations become cancellation events on their cancel date.
  MRR.sched = mrrUnpack(d.scheduled).filter((s) => s.date >= today).map((s) => enrich({
    ym: mrrYm(s.date), cat: 'c', amt: -Math.abs(s.mrr), company: s.company, am: s.am, owner: s.owner, firm: s.firm,
    date: s.date, created: s.created, notPaid: 0, agency: s.agency, leads: s.leads, src: 's',
  }));
  MRR.all = MRR.events.concat(MRR.sched);
}

function mrrLeads(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) || n < 0 ? null : n;
}
const mrrReason = (e) => e.reason || 'Voluntary / unspecified';
const mrrReasonCat = (e) => {
  if (!e.reason) return 'Other';
  if (e.reason === 'Not paid') return 'Non-payment';
  const i = e.reason.indexOf(' - ');
  return i === -1 ? 'Other' : e.reason.slice(0, i).trim() || 'Other';
};
const mrrChurnDate = (e) => e.date || e.ym + '-01';
const mrrAm = (e) => (e.am || '').trim() || MRR_UNASSIGNED;

// The last copy lives in this browser tab (sessionStorage), so reopening the tab is instant
// while a fresh copy loads behind it.
const MRR_STORE = 'cs-mrr-cache';

async function loadMrr(force) {
  if (MRR.loading) return MRR.loading;
  const mounted = () => !!document.getElementById('mrrHero');
  MRR.loading = (async () => {
    document.getElementById('mrrRefresh')?.classList.add('spin');
    if (mounted() && !MRR.data) document.getElementById('mrrBody').innerHTML = '<div class="res-loading">Pulling MRR from Chargebee…</div>';
    try {
      const data = await mrrCall({ action: 'load', force: !!force });
      const changed = !MRR.data || data.built !== MRR.data.built;
      MRR.data = data;
      try { sessionStorage.setItem(MRR_STORE, JSON.stringify(data)); } catch (e) { /* full or private */ }
      if (changed) { mrrPrepare(data); if (mounted()) renderMrr(); }
      document.getElementById('mrrError')?.setAttribute('hidden', '');
    } catch (e) {
      if (isSessionError(e)) showSessionBanner(true);
      const box = document.getElementById('mrrError');
      if (box) { box.textContent = 'Couldn’t load the MRR Report: ' + e.message; box.hidden = false; }
      if (mounted() && !MRR.data) document.getElementById('mrrBody').innerHTML = '';
    } finally {
      MRR.loading = null;
      document.getElementById('mrrRefresh')?.classList.remove('spin');
    }
  })();
  return MRR.loading;
}

// Called once Support has loaded: warms the MRR data so the tab opens ready.
function prefetchMrr() {
  if (MRR.data || MRR.loading) return;
  try { MRR.data = JSON.parse(sessionStorage.getItem(MRR_STORE) || 'null'); } catch (e) { MRR.data = null; }
  if (MRR.data) mrrPrepare(MRR.data);
  loadMrr(false);
}

function openMrr() {
  if (!document.getElementById('mrrHero')) document.getElementById('mrr').innerHTML = mrrShell();
  if (!MRR.data) prefetchMrr();
  if (MRR.data) renderMrr();
  else if (MRR.loading) document.getElementById('mrrBody').innerHTML = '<div class="res-loading">Pulling MRR from Chargebee…</div>';
}

function mrrShell() {
  return `<div class="mrr-hero" id="mrrHero"></div>
    <div id="mrrError" class="error-banner" hidden></div>
    <div id="mrrBody"></div>`;
}

/* ---------- calculations ---------- */
const mrrCur = () => mrrYm(mrrToday());

function mrrMonthTotals(ym, rows = MRR.all) {
  const t = { u: 0, r: 0, d: 0, c: 0, n: { u: 0, r: 0, d: 0, c: 0 }, net: 0, sched: 0, schedN: 0 };
  rows.forEach((e) => {
    if (e.ym !== ym) return;
    t[e.cat] += e.amt; t.n[e.cat]++; t.net += e.amt;
    if (e.src === 's') { t.sched += e.amt; t.schedN++; }
  });
  return t;
}

// Month-end projection: actuals so far + scheduled cancels + trailing-3-month pace for the rest of the month.
function mrrProjection() {
  const cur = mrrCur(), today = mrrToday();
  const day = Number(today.slice(8)), last = mrrDays(cur);
  const frac = Math.max(0, (last - day) / last);
  const trail = [1, 2, 3].map((i) => mrrAddYm(cur, -i));
  const now = mrrMonthTotals(cur);
  const avg = {};
  MRR_CATS.forEach((c) => { avg[c.key] = mrrSum(MRR.events.filter((e) => e.cat === c.key && trail.includes(e.ym))) / 3; });
  // Cancellations come with 30 days' notice, so the only mid-month surprises are non-payment and agency-client cancels.
  const surprise = mrrSum(MRR.events.filter((e) => e.cat === 'c' && trail.includes(e.ym) && (e.notPaid || e.agency))) / 3;
  const rows = MRR_CATS.map((c) => {
    const mtd = c.key === 'c' ? now.c - now.sched : now[c.key];
    const sched = c.key === 'c' ? now.sched : 0;
    const rest = (c.key === 'c' ? surprise : avg[c.key]) * frac;
    return { ...c, mtd, sched, rest, end: mtd + sched + rest };
  });
  return { cur, day, last, frac, trail, avg, surprise, rows, net: mrrSum(rows, (r) => r.end), now };
}

// Churn forecast for the current month, in firms and dollars.
function mrrChurnForecast() {
  const cur = mrrCur(), today = mrrToday();
  const day = Number(today.slice(8)), last = mrrDays(cur);
  const frac = Math.max(0, (last - day) / last);
  const trail = [1, 2, 3].map((i) => mrrAddYm(cur, -i));
  const fired = MRR.events.filter((e) => e.cat === 'c' && e.ym === cur);
  const bucket = (e) => (e.notPaid ? 'notPaid' : e.agency ? 'agency' : 'other');
  const mtd = { notPaid: [], agency: [], other: [] };
  fired.forEach((e) => mtd[bucket(e)].push(e));
  const sched = MRR.sched.filter((e) => e.ym === cur);
  const past = MRR.events.filter((e) => e.cat === 'c' && trail.includes(e.ym));
  const pred = (k) => {
    const rows = past.filter((e) => bucket(e) === k);
    return { n: (rows.length / 3) * frac, amt: (mrrSum(rows, (e) => Math.abs(e.amt)) / 3) * frac, avgN: rows.length / 3, avgAmt: mrrSum(rows, (e) => Math.abs(e.amt)) / 3 };
  };
  const p = { agency: pred('agency'), notPaid: pred('notPaid') };
  const amt = (rows) => mrrSum(rows, (e) => Math.abs(e.amt));
  const totalN = fired.length + sched.length + p.agency.n + p.notPaid.n;
  const totalAmt = amt(fired) + amt(sched) + p.agency.amt + p.notPaid.amt;
  return { cur, day, last, trail, mtd, fired, sched, p, amt, totalN, totalAmt };
}

// Churn period: [start, end) as YYYY-MM-DD strings, Pacific.
function mrrPeriod() {
  const today = mrrToday(), cur = mrrCur();
  switch (MRR.period) {
    case 'month': { const m = MRR.monthYm; return { label: mrrYmLabel(m), start: m + '-01', end: mrrAddYm(m, 1) + '-01' }; }
    case 'thisMonth': return { label: mrrYmLabel(cur), start: cur + '-01', end: mrrAddYm(cur, 1) + '-01' };
    case 'nextMonth': { const n = mrrAddYm(cur, 1); return { label: mrrYmLabel(n), start: n + '-01', end: mrrAddYm(n, 1) + '-01' }; }
    case 'ytd': return { label: `${today.slice(0, 4)} year to date`, start: today.slice(0, 4) + '-01-01', end: mrrAddDays(today, 1) };
    default: return { label: 'the next 120 days', start: today, end: mrrAddDays(today, 120) };
  }
}
function mrrChurnRows(p = mrrPeriod()) {
  return MRR.all.filter((e) => e.cat === 'c' && mrrChurnDate(e) >= p.start && mrrChurnDate(e) < p.end);
}

const MRR_BUCKETS = [
  { label: 'Under $200', test: (x) => x < 200 },
  { label: '$200–299', test: (x) => x >= 200 && x < 300 },
  { label: '$300–399', test: (x) => x >= 300 && x < 400 },
  { label: '$400–499', test: (x) => x >= 400 && x < 500 },
  { label: '$500–699', test: (x) => x >= 500 && x < 700 },
  { label: '$700+', test: (x) => x >= 700 },
];
const MRR_LEAD_BUCKETS = [
  { label: 'Not set', test: (n) => n == null },
  { label: '0–10', test: (n) => n != null && n <= 10 },
  { label: '11–25', test: (n) => n > 10 && n <= 25 },
  { label: '26–50', test: (n) => n > 25 && n <= 50 },
  { label: '51–100', test: (n) => n > 50 && n <= 100 },
  { label: '100+', test: (n) => n > 100 },
];
const MRR_TENURE = [
  { label: 'Unknown', test: (m) => m == null },
  { label: 'Under 3 mo', test: (m) => m != null && m < 3 },
  { label: '3–6 mo', test: (m) => m >= 3 && m < 6 },
  { label: '6–12 mo', test: (m) => m >= 6 && m < 12 },
  { label: '12–15 mo', test: (m) => m >= 12 && m < 15 },
  { label: '15–24 mo', test: (m) => m >= 15 && m < 24 },
  { label: '24–36 mo', test: (m) => m >= 24 && m < 36 },
  { label: '36 mo+', test: (m) => m >= 36 },
];
const mrrTenure = (e) => {
  if (!e.created) return null;
  const m = (new Date(mrrChurnDate(e)) - new Date(e.created)) / (864e5 * 30.44);
  return isNaN(m) ? null : Math.max(0, m);
};

// Deep-dive groupings for the churn outlook.
const MRR_GROUPS = {
  am: { label: 'Account Manager', key: mrrAm, sort: 'size' },
  owner: { label: 'Owner (AE)', key: (e) => (e.owner || '').trim() || MRR_UNASSIGNED, sort: 'size' },
  reason: { label: 'Churn reason', key: mrrReasonCat, order: MRR_REASON_ORDER },
  leads: { label: 'Lead volume', key: (e) => MRR_LEAD_BUCKETS.find((b) => b.test(e.leadsN)).label, order: MRR_LEAD_BUCKETS.map((b) => b.label) },
  tenure: { label: 'Tenure', key: (e) => MRR_TENURE.find((b) => b.test(mrrTenure(e))).label, order: MRR_TENURE.map((b) => b.label) },
  practice: { label: 'Practice area', key: (e) => e.practice || '— Unknown —', sort: 'size' },
};

/* ---------- render ---------- */
function renderMrr() {
  const d = MRR.data;
  if (!MRR.monthYm) MRR.monthYm = mrrAddYm(mrrCur(), -1);
  if (!MRR.insightsYm) MRR.insightsYm = mrrCur();
  const cur = mrrCur();
  const t = mrrMonthTotals(cur);
  const proj = mrrProjection();
  const fc = mrrChurnForecast();
  // The Chargebee sync runs every 2 hours; flag it when the last run failed or it's gone quiet.
  const st = d.sync || {};
  const synced = st.lastSuccess || d.synced ? new Date(st.lastSuccess || d.synced) : null;
  const old = st.failed || (synced && Date.now() - synced > 5 * 3600e3);
  const when = synced ? synced.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const syncTxt = (synced ? `Synced from Chargebee ${when}` : 'Sync time unknown') +
    (st.failed ? ' — the latest sync failed, so some numbers may be out of date.' : old ? ' — over 5 hours ago, so the sync may have stopped.' : '');
  const bubble = t.net >= 0 ? `Up ${mrrMoney(t.net)} so far this month!` : `${mrrMoney(t.net)} so far — ${mrrPlural(t.schedN, 'firm')} already scheduled to leave.`;

  document.getElementById('mrrHero').innerHTML = `
    <div class="fa-hero-text">
      <div class="loop-eyebrow">Existing customers · ${esc(mrrYmLabel(cur))}</div>
      <h2>MRR <span>Report</span></h2>
      <p>Upgrades and reactivations minus downgrades and cancellations. New business isn’t counted. Click any number to see the firms behind it.</p>
      <div class="mrr-kpis">
        <button type="button" class="mrr-kpi ${t.net >= 0 ? 'up' : 'down'}" data-drill="month" data-ym="${cur}">
          <span>Net this month</span><b>${mrrMoney(t.net, true)}</b><small>Day ${proj.day} of ${proj.last}${t.schedN ? ` · incl. ${t.schedN} scheduled` : ''}</small></button>
        <button type="button" class="mrr-kpi ${proj.net >= 0 ? 'up' : 'down'}" data-explain="projection">
          <span>Projected month-end</span><b>${mrrMoney(proj.net, true)}</b><small>How it’s calculated ⓘ</small></button>
        <button type="button" class="mrr-kpi down" data-explain="churn">
          <span>Projected churn</span><b>${mrrMoney(-fc.totalAmt, true)}</b><small>~${Math.round(fc.totalN)} firms · how ⓘ</small></button>
      </div>
      <div class="loop-actions"><button type="button" class="loop-btn" id="mrrRefresh">↻ Refresh</button>
        <span class="mrr-sync${old ? ' bad' : ''}">${esc(syncTxt)}${d.stale ? ' · showing the last good copy' : ''}</span></div>
    </div>
    <div class="fa-hero-art">
      <div class="loop-bubble">${esc(bubble)}</div>
      <img src="assets/merlin-money.webp" width="520" height="511" alt="Merlin in a gold chain, throwing cash" loading="lazy">
    </div>`;

  const chips = MRR_CATS.map((c) => `<button type="button" class="mrr-chip c-${c.key}" data-drill="cat" data-cat="${c.key}" data-ym="${cur}">
      <i style="background:var(${c.color})"></i><span>${c.label}</span><b>${mrrMoney(t[c.key], true)}</b><small>${mrrPlural(t.n[c.key], 'firm')}</small></button>`).join('');

  const tabs = [['leaderboard', 'AM leaderboard'], ['movement', 'Monthly movement'], ['churn', 'Churn outlook'], ['history', 'Churn history'], ['retention', 'Month 13 retention'], ['insights', 'Insights']];
  document.getElementById('mrrBody').innerHTML = `
    <div class="mrr-chips">${chips}</div>
    <div class="res-switch mrr-tabs" role="tablist" aria-label="MRR Report sections">
      ${tabs.map(([k, l]) => `<button type="button" role="tab" class="res-switch-btn" data-mrr-view="${k}" aria-selected="${MRR.view === k}">${l}</button>`).join('')}
    </div>
    <section class="panel mrr-panel" id="mrrPanel"></section>`;
  renderMrrView();
}

function renderMrrView() {
  Object.values(MRR.charts).forEach((c) => c.destroy());
  MRR.charts = {};
  document.querySelectorAll('[data-mrr-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mrrView === MRR.view)));
  const el = document.getElementById('mrrPanel');
  const fn = { leaderboard: mrrLeaderboard, movement: mrrMovement, churn: mrrChurn, history: mrrHistory, retention: mrrRetention, insights: mrrInsights }[MRR.view];
  fn(el);
}

/* Leaderboard */
function mrrLeaderboard(el) {
  const cur = mrrCur();
  const yms = MRR.lbRange === 'month' ? [cur] : [cur, mrrAddYm(cur, -1), mrrAddYm(cur, -2)];
  const rows = MRR.all.filter((e) => yms.includes(e.ym));
  const by = new Map();
  rows.forEach((e) => {
    const k = mrrAm(e);
    const r = by.get(k) || { am: k, net: 0, u: [0, 0], r: [0, 0], d: [0, 0], c: [0, 0] };
    r.net += e.amt; r[e.cat][0] += e.amt; r[e.cat][1]++;
    by.set(k, r);
  });
  const ret = new Map((MRR.data.retention.am || []).map((r) => [r.am, r]));
  const list = [...by.values()].sort((a, b) => b.net - a.net);
  const cell = (v) => (v[1] ? `${mrrMoney(v[0], true)} <small>(${v[1]})</small>` : '<span class="muted">—</span>');
  const retCell = (r) => {
    if (!r) return '<span class="muted">—</span>';
    const pct = (r.retained / r.cohort) * 100;
    return `<span class="score-pill ${pct >= 90 ? 'good' : pct >= 75 ? '' : 'bad'}">${pct.toFixed(0)}%</span> <small>${r.retained}/${r.cohort}</small>`;
  };
  const team = { net: 0, u: [0, 0], r: [0, 0], d: [0, 0], c: [0, 0] };
  list.forEach((r) => { team.net += r.net; MRR_CATS.forEach((c) => { team[c.key][0] += r[c.key][0]; team[c.key][1] += r[c.key][1]; }); });
  const tr = MRR.data.retention.am.reduce((s, r) => ({ retained: s.retained + r.retained, cohort: s.cohort + r.cohort }), { retained: 0, cohort: 0 });
  const label = MRR.lbRange === 'month' ? mrrYmLabel(cur) : `${mrrYmLabel(yms[2], true)} – ${mrrYmLabel(cur, true)}`;

  el.innerHTML = `
    <div class="mrr-panel-head"><h3>Net movement by Account Manager <span class="muted">· ${esc(label)}</span></h3>
      <div class="mrr-seg">${[['month', 'This month'], ['3m', 'Last 3 months']].map(([k, l]) => `<button type="button" data-lb="${k}" aria-pressed="${MRR.lbRange === k}">${l}</button>`).join('')}</div></div>
    <p class="mrr-note">Click a row for that AM’s firms. Month 13 retention: of the firms an AM signed 13 months ago, the share still with us.${MRR.lbRange === 'month' ? ' Cancellations include firms scheduled to cancel later this month.' : ''}</p>
    ${list.length ? `<div class="table-wrap"><table class="mrr-table"><thead><tr><th>#</th><th>Account Manager</th><th>Net MRR</th>${MRR_CATS.map((c) => `<th>${c.label}</th>`).join('')}<th>Month 13 retention</th></tr></thead><tbody>
      ${list.map((r, i) => `<tr class="mrr-click" data-drill="am" data-am="${esc(r.am)}"><td>${i + 1}</td><td><b>${esc(r.am)}</b></td>
        <td class="${r.net >= 0 ? 'pos' : 'neg'}"><b>${mrrMoney(r.net, true)}</b></td>${MRR_CATS.map((c) => `<td>${cell(r[c.key])}</td>`).join('')}<td>${retCell(ret.get(r.am))}</td></tr>`).join('')}
      <tr class="mrr-total"><td></td><td>Team</td><td class="${team.net >= 0 ? 'pos' : 'neg'}">${mrrMoney(team.net, true)}</td>${MRR_CATS.map((c) => `<td>${cell(team[c.key])}</td>`).join('')}<td>${tr.cohort ? retCell(tr) : '—'}</td></tr>
    </tbody></table></div>` : '<div class="empty-note">No existing-customer movement yet this month.</div>'}`;
}

/* Movement chart */
function mrrMovement(el) {
  const cur = mrrCur();
  const yms = Array.from({ length: 13 }, (_, i) => mrrAddYm(cur, i - 12));
  const tots = yms.map((ym) => mrrMonthTotals(ym));
  el.innerHTML = `<div class="mrr-panel-head"><h3>Net customer movement by month</h3><span class="muted">Last 12 months + this month · click a bar for the firms</span></div>
    <div class="mrr-chart tall"><canvas id="mrrMoveChart"></canvas></div>`;
  MRR.charts.move = new Chart(document.getElementById('mrrMoveChart'), {
    type: 'bar',
    data: {
      labels: yms.map((y) => mrrYmLabel(y, true)),
      datasets: MRR_CATS.map((c) => ({ label: c.label, data: tots.map((t) => Math.round(t[c.key])), backgroundColor: cssVar(c.color), stack: c.key === 'u' || c.key === 'r' ? 'gain' : 'loss', borderRadius: 4 })),
    },
    options: mrrChartOpts({
      stacked: true,
      tooltip: { mode: 'index', intersect: false, callbacks: { label: (i) => ` ${i.dataset.label}: ${mrrMoney(i.raw, true)}`, footer: (items) => `Net: ${mrrMoney(tots[items[0].dataIndex].net, true)} — click for firms` } },
      onClick: (i) => mrrDrillMonth(yms[i]),
    }),
  });
}

/* Churn outlook */
function mrrChurn(el) {
  const p = mrrPeriod();
  const rows = mrrChurnRows(p);
  const amts = rows.map((e) => Math.abs(e.amt)).sort((a, b) => a - b);
  const total = mrrSum(amts, (x) => x);
  const median = amts.length ? (amts.length % 2 ? amts[(amts.length - 1) / 2] : (amts[amts.length / 2 - 1] + amts[amts.length / 2]) / 2) : 0;
  const agency = rows.filter((e) => e.agency);
  const cur = mrrCur();
  const minYm = mrrAddYm(cur, -12), maxYm = mrrAddYm(cur, -1);
  const periods = [['thisMonth', 'This month'], ['nextMonth', 'Next month'], ['next120', 'Next 120 days'], ['ytd', 'YTD']];

  el.innerHTML = `
    <div class="mrr-panel-head"><h3>Churn — ${esc(p.label)}</h3>
      <div class="mrr-seg">
        <span class="mrr-step"><button type="button" data-step="-1" ${MRR.monthYm <= minYm ? 'disabled' : ''} aria-label="Previous month">‹</button><button type="button" data-period="month" aria-pressed="${MRR.period === 'month'}">${esc(mrrYmLabel(MRR.monthYm))}</button><button type="button" data-step="1" ${MRR.monthYm >= maxYm ? 'disabled' : ''} aria-label="Next month">›</button></span>
        ${periods.map(([k, l]) => `<button type="button" data-period="${k}" aria-pressed="${MRR.period === k}">${l}</button>`).join('')}
      </div></div>
    <div class="mrr-stats">
      <button type="button" class="mrr-stat" data-drill="period"><b>${rows.length}</b><span>firms · view list</span></button>
      <div class="mrr-stat"><b>${mrrMoney(total)}</b><span>MRR lost</span></div>
      <div class="mrr-stat"><b>${mrrMoney(median)}</b><span>median firm</span></div>
      <div class="mrr-stat"><b>${mrrMoney(amts.length ? total / amts.length : 0)}</b><span>average firm</span></div>
      <button type="button" class="mrr-stat" data-drill="agency"><b>${agency.length}</b><span>agency clients · ${mrrMoney(mrrSum(agency, (e) => Math.abs(e.amt)))}</span></button>
    </div>
    <div class="mrr-grid2">
      <div><h4>By month</h4><div class="mrr-chart"><canvas id="mrrChurnMonth"></canvas></div></div>
      <div><h4>By firm MRR</h4><div class="mrr-chart"><canvas id="mrrChurnBucket"></canvas></div></div>
    </div>
    <div class="mrr-panel-head mrr-sub"><h4>Who’s churning, by</h4>
      <div class="mrr-seg small">${Object.entries(MRR_GROUPS).map(([k, g]) => `<button type="button" data-group="${k}" aria-pressed="${MRR.groupBy === k}">${g.label}</button>`).join('')}</div></div>
    <div class="mrr-chart tall"><canvas id="mrrChurnGroup"></canvas></div>`;

  if (!rows.length) {
    el.querySelectorAll('.mrr-chart').forEach((c) => { c.innerHTML = '<div class="empty-note">No cancellations in this period.</div>'; });
    return;
  }

  // By month: every month the period touches, including a partial last month.
  const yms = [];
  for (let ym = mrrYm(p.start); ym <= mrrYm(mrrAddDays(p.end, -1)); ym = mrrAddYm(ym, 1)) yms.push(ym);
  const byMonth = yms.map((ym) => rows.filter((e) => mrrYm(mrrChurnDate(e)) === ym));
  MRR.charts.month = new Chart(document.getElementById('mrrChurnMonth'), {
    type: 'bar',
    data: { labels: yms.map((y) => mrrYmLabel(y, true)), datasets: [{ label: 'MRR lost', data: byMonth.map((r) => Math.round(mrrSum(r, (e) => Math.abs(e.amt)))), backgroundColor: cssVar('--st-critical'), borderRadius: 4 }] },
    options: mrrChartOpts({
      legend: false,
      tooltip: { callbacks: { label: (i) => ` ${mrrMoney(i.raw)} — ${mrrPlural(byMonth[i.dataIndex].length, 'firm')}` } },
      onClick: (i) => mrrOpenDrill(`Churn — ${mrrYmLabel(yms[i])}`, `Cancellations in ${p.label}`, byMonth[i], 'churn'),
    }),
  });

  const byBucket = MRR_BUCKETS.map((b) => rows.filter((e) => b.test(Math.abs(e.amt))));
  MRR.charts.bucket = new Chart(document.getElementById('mrrChurnBucket'), {
    type: 'bar',
    data: { labels: MRR_BUCKETS.map((b) => b.label), datasets: [{ label: 'Firms', data: byBucket.map((r) => r.length), backgroundColor: cssVar('--slot-4'), borderRadius: 4 }] },
    options: mrrChartOpts({
      legend: false, count: true,
      tooltip: { callbacks: { label: (i) => ` ${mrrPlural(i.raw, 'firm')} — ${mrrMoney(mrrSum(byBucket[i.dataIndex], (e) => Math.abs(e.amt)))} MRR` } },
      onClick: (i) => mrrOpenDrill(`Churn — ${MRR_BUCKETS[i].label} firms`, p.label, byBucket[i], 'churn'),
    }),
  });

  const g = MRR_GROUPS[MRR.groupBy];
  const groups = new Map();
  rows.forEach((e) => { const k = g.key(e); groups.set(k, (groups.get(k) || []).concat(e)); });
  let keys = [...groups.keys()];
  keys = g.order ? g.order.filter((k) => groups.has(k)).concat(keys.filter((k) => !g.order.includes(k))) : keys.sort((a, b) => groups.get(b).length - groups.get(a).length);
  const horizontal = !g.order;
  const box = document.getElementById('mrrChurnGroup').parentElement;
  if (horizontal) box.style.height = Math.max(220, keys.length * 30 + 40) + 'px';
  MRR.charts.group = new Chart(document.getElementById('mrrChurnGroup'), {
    type: 'bar',
    data: { labels: keys, datasets: [{ label: 'Firms', data: keys.map((k) => groups.get(k).length), backgroundColor: cssVar('--slot-1'), borderRadius: 4, maxBarThickness: 22 }] },
    options: mrrChartOpts({
      legend: false, count: true, horizontal,
      tooltip: { callbacks: {
        label: (i) => ` ${mrrPlural(i.raw, 'firm')} — ${mrrMoney(mrrSum(groups.get(keys[i.dataIndex]), (e) => Math.abs(e.amt)))} MRR`,
        afterLabel: (i) => (MRR.groupBy === 'reason' ? mrrTopReasons(groups.get(keys[i.dataIndex]), 3).map((r) => `   ${r.reason} (${r.n})`).join('\n') : ''),
      } },
      onClick: (i) => mrrOpenDrill(`Churn — ${keys[i]}`, `${g.label} · ${p.label}`, groups.get(keys[i]), 'churn'),
    }),
  });
}

function mrrTopReasons(rows, n) {
  const m = new Map();
  rows.forEach((e) => { const k = mrrReason(e); const r = m.get(k) || { reason: k, n: 0, amt: 0 }; r.n++; r.amt += Math.abs(e.amt); m.set(k, r); });
  return [...m.values()].sort((a, b) => b.amt - a.amt).slice(0, n);
}

/* Churn history */
function mrrHistory(el) {
  const cur = mrrCur();
  const yms = Array.from({ length: 12 }, (_, i) => mrrAddYm(cur, i - 11));
  const rows = yms.map((ym) => MRR.all.filter((e) => e.cat === 'c' && e.ym === ym));
  const snaps = MRR.data.snapshots || {};
  const hasSnaps = yms.some((ym) => snaps[ym]);
  el.innerHTML = `<div class="mrr-panel-head"><h3>Churn history</h3><span class="muted">Last 12 months · ${esc(mrrYmLabel(cur))} includes firms scheduled to cancel later this month</span></div>
    <div class="mrr-grid2">
      <div><h4>MRR and firms churned</h4><div class="mrr-chart"><canvas id="mrrH1"></canvas></div></div>
      <div><h4>Monthly churn rate</h4><div class="mrr-chart"><canvas id="mrrH2"></canvas>${hasSnaps ? '' : '<div class="empty-note">Needs a month-start MRR snapshot — starts filling in from next month.</div>'}</div></div>
      <div><h4>MRR churned by reason</h4><div class="mrr-chart"><canvas id="mrrH3"></canvas></div></div>
      <div><h4>Firms churned by reason</h4><div class="mrr-chart"><canvas id="mrrH4"></canvas></div></div>
    </div>`;
  const labels = yms.map((y) => mrrYmLabel(y, true));
  const amt = rows.map((r) => Math.round(mrrSum(r, (e) => Math.abs(e.amt))));
  MRR.charts.h1 = new Chart(document.getElementById('mrrH1'), {
    type: 'bar',
    data: { labels, datasets: [
      { type: 'bar', label: 'MRR churned', data: amt, backgroundColor: cssVar('--st-critical'), borderRadius: 4, yAxisID: 'y' },
      { type: 'line', label: 'Firms', data: rows.map((r) => r.length), borderColor: cssVar('--slot-4'), backgroundColor: cssVar('--slot-4'), borderDash: [5, 4], tension: 0.3, yAxisID: 'y2' },
    ] },
    options: mrrChartOpts({ dual: true, tooltip: { mode: 'index', intersect: false, callbacks: { label: (i) => (i.datasetIndex ? ` ${mrrPlural(i.raw, 'firm')}` : ` ${mrrMoney(i.raw)}`) } }, onClick: (i) => mrrOpenDrill(`Churn — ${mrrYmLabel(yms[i])}`, 'Cancellations', rows[i], 'churn') }),
  });
  if (hasSnaps) {
    const rate = (i, f) => { const s = snaps[yms[i]]; return s && s[f] ? +((f ? rows[i].length / s[1] : amt[i] / s[0]) * 100).toFixed(2) : null; };
    MRR.charts.h2 = new Chart(document.getElementById('mrrH2'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'MRR churn %', data: yms.map((_, i) => rate(i, 0)), borderColor: cssVar('--st-critical'), backgroundColor: cssVar('--st-critical'), tension: 0.3, spanGaps: true },
        { label: 'Logo churn %', data: yms.map((_, i) => rate(i, 1)), borderColor: cssVar('--slot-4'), backgroundColor: cssVar('--slot-4'), tension: 0.3, spanGaps: true },
      ] },
      options: mrrChartOpts({ pct: true, tooltip: { callbacks: { label: (i) => ` ${i.dataset.label}: ${i.raw == null ? 'no snapshot' : i.raw + '%'}` } } }),
    });
  }
  const cats = MRR_REASON_ORDER.filter((c) => rows.some((r) => r.some((e) => mrrReasonCat(e) === c)));
  const colors = ['--slot-1', '--slot-2', '--slot-3', '--slot-6', '--slot-7', '--slot-5', '--slot-4', '--st-neutral', '--st-critical', '--slot-8'];
  const stacked = (id, val) => new Chart(document.getElementById(id), {
    type: 'bar',
    data: { labels, datasets: cats.map((c) => ({ label: c, data: rows.map((r) => val(r.filter((e) => mrrReasonCat(e) === c))), backgroundColor: cssVar(colors[MRR_REASON_ORDER.indexOf(c)]) })) },
    options: mrrChartOpts({
      stacked: true, count: val === mrrHistCount, legendBottom: true,
      tooltip: { callbacks: { label: (i) => (i.raw ? ` ${i.dataset.label}: ${val === mrrHistCount ? mrrPlural(i.raw, 'firm') : mrrMoney(i.raw)}` : null) } },
      onClick: (i, ds) => mrrOpenDrill(`${cats[ds]} churn — ${mrrYmLabel(yms[i])}`, 'Cancellations by reason', rows[i].filter((e) => mrrReasonCat(e) === cats[ds]), 'churn'),
    }),
  });
  MRR.charts.h3 = stacked('mrrH3', (r) => Math.round(mrrSum(r, (e) => Math.abs(e.amt))));
  MRR.charts.h4 = stacked('mrrH4', mrrHistCount);
}
const mrrHistCount = (r) => r.length;

/* Retention */
function mrrRetention(el) {
  const ret = MRR.data.retention;
  const rate = ret.rate.slice().sort((a, b) => (a.ym < b.ym ? -1 : 1));
  const yms = rate.map((r) => r.ym);
  const nonAgency = yms.map((ym) => { const d = ret.detail.filter((r) => r.ym === ym && !r.agency); return { n: d.length, kept: d.filter((r) => r.kept).length }; });
  el.innerHTML = `<div class="mrr-panel-head"><h3>Month 13 retention</h3><span class="muted">Of the firms that signed up 13 months before each month, the share still with us · click a bar for the firms</span></div>
    ${rate.length ? `<div class="mrr-chart tall"><canvas id="mrrRet"></canvas></div>` : '<div class="empty-note">No retention data yet.</div>'}`;
  if (!rate.length) return;
  MRR.charts.ret = new Chart(document.getElementById('mrrRet'), {
    type: 'bar',
    data: { labels: yms.map((y) => mrrYmLabel(y, true)), datasets: [
      { label: 'All firms', data: rate.map((r) => (r.cohort ? +((r.retained / r.cohort) * 100).toFixed(1) : null)), backgroundColor: cssVar('--slot-1'), borderRadius: 4 },
      { label: 'Excluding agency', data: nonAgency.map((r) => (r.n ? +((r.kept / r.n) * 100).toFixed(1) : null)), backgroundColor: cssVar('--slot-2'), borderRadius: 4 },
    ] },
    options: mrrChartOpts({
      pct: true, max: 100,
      tooltip: { callbacks: {
        label: (i) => ` ${i.dataset.label}: ${i.raw}%`,
        afterLabel: (i) => (i.datasetIndex ? `   ${nonAgency[i.dataIndex].kept} of ${nonAgency[i.dataIndex].n} non-agency firms` : `   ${rate[i.dataIndex].retained} of ${rate[i.dataIndex].cohort} signed up ${mrrYmLabel(rate[i.dataIndex].signup || mrrAddYm(yms[i.dataIndex], -13))}`),
      } },
      onClick: (i, ds) => mrrDrillRetention(yms[i], ds === 1),
    }),
  });
}

/* Insights */
function mrrInsights(el) {
  const ym = MRR.insightsYm, cur = mrrCur();
  const rows = MRR.all.filter((e) => e.cat === 'c' && e.ym === ym);
  const total = mrrSum(rows, (e) => Math.abs(e.amt));
  const known = rows.filter((e) => e.leadsN != null);
  const below = known.filter((e) => e.leadsN < MRR_ICP_LEADS);
  const agency = rows.filter((e) => e.agency);
  const notPaid = rows.filter((e) => e.notPaid || e.reason === 'Not paid' || /non payment/i.test(e.reason));
  const top = mrrTopReasons(rows, 5);
  const samples = rows.filter((e) => e.details).slice(0, 4);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  el.innerHTML = `
    <div class="mrr-panel-head"><h3>Churn insights</h3>
      <span class="mrr-step"><button type="button" data-iym="-1" aria-label="Previous month">‹</button><b>${esc(mrrYmLabel(ym))}</b><button type="button" data-iym="1" ${ym >= cur ? 'disabled' : ''} aria-label="Next month">›</button></span></div>
    ${rows.length ? `<div class="mrr-insights">
      <div class="mrr-insight big"><b>${rows.length}</b> firms churned, <b>${mrrMoney(total)}</b> in MRR${ym === cur ? ' (fired so far plus firms scheduled to cancel later this month)' : ''}.</div>
      <div class="mrr-insight"><b>${pct(below.length, known.length)}%</b> were below our ICP (under ${MRR_ICP_LEADS} leads/month): ${below.length} of ${known.length} firms with known lead volume, ${mrrMoney(mrrSum(below, (e) => Math.abs(e.amt)))} of MRR.${rows.length - known.length ? ` <span class="muted">${rows.length - known.length} have no lead volume on file.</span>` : ''}</div>
      <div class="mrr-insight"><b>${agency.length}</b> agency-client firms, ${mrrMoney(mrrSum(agency, (e) => Math.abs(e.amt)))} of the loss.</div>
      <div class="mrr-insight"><b>${notPaid.length}</b> non-payment cancellations (involuntary), ${mrrMoney(mrrSum(notPaid, (e) => Math.abs(e.amt)))}.</div>
      <div class="mrr-insight wide"><h4>Top reasons by MRR</h4><ol>${top.map((r) => `<li><button type="button" class="mrr-link" data-reason="${esc(r.reason)}">${esc(r.reason)}</button> — ${mrrPlural(r.n, 'firm')} · ${mrrMoney(r.amt)}</li>`).join('')}</ol></div>
      ${samples.length ? `<div class="mrr-insight wide"><h4>In their words (Salesforce churn details)</h4>${samples.map((e) => `<p><b>${esc(e.company)}:</b> ${esc(e.details)}</p>`).join('')}</div>` : ''}
    </div>` : '<div class="empty-note">No cancellations this month.</div>'}`;
}

/* ---------- pop-ups ---------- */
function mrrModal(title, sub, bodyHtml) {
  document.getElementById('mrrDrill')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'mrrDrill';
  wrap.className = 'drill-backdrop';
  wrap.innerHTML = `<div class="drill" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="drill-head"><div><h3>${esc(title)}</h3><div class="drill-note">${sub}</div></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body">${bodyHtml}</div></div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('.drill-close')) { mrrCloseModal(); return; }
    const th = e.target.closest('th[data-sort]');
    if (th && MRR.drill) {
      const k = th.dataset.sort;
      MRR.drill.dir = MRR.drill.sort === k ? -MRR.drill.dir : 1;
      MRR.drill.sort = k;
      wrap.querySelector('.drill-body').innerHTML = mrrDrillTable();
    }
  });
  document.addEventListener('keydown', mrrModalKey);
  wrap.querySelector('.drill-close').focus();
}
function mrrModalKey(e) { if (e.key === 'Escape') mrrCloseModal(); }
function mrrCloseModal() {
  document.getElementById('mrrDrill')?.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', mrrModalKey);
  MRR.drill = null;
}

const MRR_CAT_LABEL = { u: 'Upgrade', r: 'Reactivation', d: 'Downgrade', c: 'Cancellation' };
function mrrOpenDrill(title, sub, rows, kind) {
  // Churn lists run by cancel date; movement lists start with the biggest losses.
  MRR.drill = { rows, kind, sort: kind === 'churn' ? 'date' : 'amt', dir: 1 };
  const total = mrrSum(rows);
  mrrModal(title, `${esc(sub)} · ${mrrPlural(rows.length, 'firm')} · ${mrrMoney(total, true)}`, mrrDrillTable());
}

function mrrDrillTable() {
  const { rows, kind, sort, dir } = MRR.drill;
  if (!rows.length) return '<div class="empty-note">No firms match this slice.</div>';
  const churn = kind === 'churn' || rows.every((e) => e.cat === 'c');
  const val = (e) => ({ company: e.company.toLowerCase(), am: mrrAm(e), cat: e.cat, date: mrrChurnDate(e), reason: mrrReason(e), practice: e.practice, amt: e.amt, score: Number(e.score) || 0 }[sort]);
  const list = rows.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const cols = [
    ['company', 'Company', (e) => `${esc(e.company)}${e.src === 's' ? ' <span class="mrr-badge">scheduled</span>' : ''}`],
    ['am', 'Account Manager', (e) => esc(mrrAm(e))],
    churn ? null : ['cat', 'Type', (e) => MRR_CAT_LABEL[e.cat]],
    ['date', churn ? 'Cancel date' : 'Month', (e) => (churn && e.date ? esc(e.date) : esc(mrrYmLabel(e.ym)))],
    churn ? ['reason', 'Reason', (e) => esc(mrrReason(e))] : null,
    churn ? ['practice', 'Practice area', (e) => esc(e.practice || '—')] : null,
    churn ? [null, 'Churn details', (e) => (e.details ? `<span class="drill-comment" title="${esc(e.details)}">${esc(e.details.length > 110 ? e.details.slice(0, 110) + '…' : e.details)}</span>` : '<span class="muted">—</span>')] : null,
    churn ? ['score', 'Churn score', (e) => esc(e.score || '—')] : null,
    ['amt', 'MRR', (e) => `<b class="${e.amt >= 0 ? 'pos' : 'neg'}">${mrrMoney(e.amt, true)}</b>`],
  ].filter(Boolean);
  const arrow = (k) => (k === sort ? (dir === 1 ? ' ↑' : ' ↓') : '');
  return `<div class="table-wrap"><table class="drill-table mrr-table"><thead><tr>${cols.map(([k, l]) => `<th${k ? ` data-sort="${k}" class="sortable"` : ''}>${l}${k ? arrow(k) : ''}</th>`).join('')}</tr></thead>
    <tbody>${list.map((e) => `<tr>${cols.map((c) => `<td>${c[2](e)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function mrrDrillMonth(ym) { mrrOpenDrill(`Movement — ${mrrYmLabel(ym)}`, 'All existing-customer changes', MRR.all.filter((e) => e.ym === ym), 'move'); }

function mrrDrillRetention(ym, nonAgency) {
  const rows = MRR.data.retention.detail.filter((r) => r.ym === ym && (!nonAgency || !r.agency)).sort((a, b) => a.company.localeCompare(b.company));
  const kept = rows.filter((r) => r.kept).length;
  const sf = MRR.data.sf || {};
  MRR.drill = null;
  mrrModal(`Month 13 retention — ${mrrYmLabel(ym)}`, `${nonAgency ? 'Excluding agency · ' : ''}${mrrPlural(rows.length, 'firm')} · ${kept} retained · ${rows.length - kept} cancelled`,
    rows.length ? `<div class="table-wrap"><table class="drill-table mrr-table"><thead><tr><th>Company</th><th>Account Manager</th><th>Owner</th><th>Outcome</th><th>Cancelled</th><th>Reason</th><th>MRR</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.company)}${r.agency ? ' <span class="mrr-badge">agency</span>' : ''}</td><td>${esc(r.am || '—')}</td><td>${esc(r.owner || '—')}</td>
        <td><span class="score-pill ${r.kept ? 'good' : 'bad'}">${r.kept ? 'Retained' : 'Cancelled'}</span></td><td>${esc(r.kept ? '' : r.date)}</td>
        <td>${esc((sf[r.firm] || [])[1] || (r.kept ? '' : '—'))}</td><td>${r.kept ? mrrMoney(r.mrr) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-note">No firms match this slice.</div>');
}

function mrrExplain(which) {
  MRR.drill = null;
  if (which === 'projection') {
    const p = mrrProjection();
    const c = (v) => (Math.abs(v) < 0.5 ? '<span class="muted">—</span>' : mrrMoney(v, true));
    mrrModal(`Projected ${mrrYmLabel(p.cur)} month-end`, `${mrrMoney(p.net, true)} · day ${p.day} of ${p.last}`, `
      <div class="table-wrap"><table class="mrr-table"><thead><tr><th></th><th>So far</th><th>Scheduled</th><th>Rest of month (pace)</th><th>Month-end</th></tr></thead><tbody>
        ${p.rows.map((r) => `<tr><td><b>${r.label}</b></td><td>${c(r.mtd)}</td><td>${c(r.sched)}</td><td>${c(r.rest)}</td><td><b>${c(r.end)}</b></td></tr>`).join('')}
        <tr class="mrr-total"><td>Net</td><td>${c(mrrSum(p.rows, (r) => r.mtd))}</td><td>${c(mrrSum(p.rows, (r) => r.sched))}</td><td>${c(mrrSum(p.rows, (r) => r.rest))}</td><td>${c(p.net)}</td></tr>
      </tbody></table></div>
      <div class="mrr-method">
        <p><b>So far</b> is what’s happened since the 1st. <b>Scheduled</b> is firms with a cancellation date later this month.</p>
        <p><b>Rest of month</b> is the average month from ${p.trail.slice().reverse().map((y) => mrrYmLabel(y)).join(', ')}, scaled to the ${p.last - p.day} days left (${Math.round(p.frac * 100)}% of the month).</p>
        <p>Cancellations need 30 days’ notice, so they’re already in “Scheduled”. The only ones that can still surprise us are non-payment and agency-client cancels, which average ${mrrMoney(p.surprise, true)} a month.</p>
        <p class="muted">Straight-line pacing, no seasonality.</p>
      </div>`);
    return;
  }
  const f = mrrChurnForecast();
  const n = (v) => (v === 0 ? '<span class="muted">—</span>' : v < 1 ? '~' + v.toFixed(1) : Math.round(v));
  const a = (v) => (v < 0.5 ? '<span class="muted">—</span>' : mrrMoney(-v, true));
  const row = (l, rows, cls = '') => `<tr class="${cls}"><td>${l}</td><td>${n(rows.length)}</td><td>${a(f.amt(rows))}</td></tr>`;
  mrrModal(`Projected churn — ${mrrYmLabel(f.cur)}`, `${mrrMoney(-f.totalAmt, true)} · ~${Math.round(f.totalN)} firms`, `
    <div class="table-wrap"><table class="mrr-table"><thead><tr><th></th><th>Firms</th><th>MRR</th></tr></thead><tbody>
      ${row(`<b>Already cancelled</b> <small class="muted">days 1–${f.day}</small>`, f.fired)}
      ${row('<span class="mrr-indent">Non-payment</span>', f.mtd.notPaid)}${row('<span class="mrr-indent">Agency clients</span>', f.mtd.agency)}${row('<span class="mrr-indent">Other voluntary</span>', f.mtd.other)}
      ${row('<b>Scheduled for the rest of the month</b>', f.sched)}
      <tr><td><b>Likely surprises</b> <small class="muted">rest of month</small></td><td>${n(f.p.agency.n + f.p.notPaid.n)}</td><td>${a(f.p.agency.amt + f.p.notPaid.amt)}</td></tr>
      <tr><td><span class="mrr-indent">Agency clients</span></td><td>${n(f.p.agency.n)}</td><td>${a(f.p.agency.amt)}</td></tr>
      <tr><td><span class="mrr-indent">Non-payment</span></td><td>${n(f.p.notPaid.n)}</td><td>${a(f.p.notPaid.amt)}</td></tr>
      <tr class="mrr-total"><td>Month-end forecast</td><td>~${Math.round(f.totalN)}</td><td>${mrrMoney(-f.totalAmt, true)}</td></tr>
    </tbody></table></div>
    <div class="mrr-method">
      <p>Likely surprises use the average month from ${f.trail.slice().reverse().map((y) => mrrYmLabel(y)).join(', ')}: ${f.p.agency.avgN.toFixed(1)} agency-client cancels (${mrrMoney(f.p.agency.avgAmt)}) and ${f.p.notPaid.avgN.toFixed(1)} non-payment cancels (${mrrMoney(f.p.notPaid.avgAmt)}) a month, scaled to the days left.</p>
      <p class="muted">Everything else needs 30 days’ notice, so it’s already in Scheduled.</p>
    </div>`);
}

/* ---------- chart options ---------- */
function mrrChartOpts(o) {
  const tick = cssVar('--faint'), grid = cssVar('--border');
  const fmt = (v) => (o.pct ? v + '%' : o.count ? v : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US'));
  const valueAxis = { stacked: !!o.stacked, beginAtZero: true, grid: { color: grid }, ticks: { color: tick, callback: fmt, precision: 0 }, max: o.max };
  const catAxis = { stacked: !!o.stacked, grid: { display: false }, ticks: { color: cssVar('--text-2'), font: { weight: 600 }, autoSkip: !o.horizontal } };
  const scales = o.horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis };
  if (o.dual) scales.y2 = { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { color: tick, precision: 0 } };
  return {
    indexAxis: o.horizontal ? 'y' : 'x',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: o.legend === false ? { display: false } : { position: o.legendBottom ? 'bottom' : 'top', align: 'start', labels: { color: tick, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 12 } },
      tooltip: o.tooltip || {},
    },
    scales,
    onHover: (e, els) => { e.native.target.style.cursor = o.onClick && els.length ? 'pointer' : 'default'; },
    onClick: o.onClick ? (e, els) => { if (els[0]) o.onClick(els[0].index, els[0].datasetIndex); } : undefined,
  };
}

/* ---------- events ---------- */
function setupMrr() {
  const root = document.getElementById('mrr');
  if (!root) return;
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#mrrRefresh')) { loadMrr(true); return; }
    const v = t.closest('[data-mrr-view]');
    if (v) { MRR.view = v.dataset.mrrView; renderMrrView(); return; }
    const ex = t.closest('[data-explain]');
    if (ex) { mrrExplain(ex.dataset.explain); return; }
    const lb = t.closest('[data-lb]');
    if (lb) { MRR.lbRange = lb.dataset.lb; renderMrrView(); return; }
    const per = t.closest('[data-period]');
    if (per) { MRR.period = per.dataset.period; renderMrrView(); return; }
    const st = t.closest('[data-step]');
    if (st) { MRR.monthYm = mrrAddYm(MRR.monthYm, Number(st.dataset.step)); MRR.period = 'month'; renderMrrView(); return; }
    const gr = t.closest('[data-group]');
    if (gr) { MRR.groupBy = gr.dataset.group; renderMrrView(); return; }
    const iy = t.closest('[data-iym]');
    if (iy) { MRR.insightsYm = mrrAddYm(MRR.insightsYm, Number(iy.dataset.iym)); renderMrrView(); return; }
    const rs = t.closest('[data-reason]');
    if (rs) { const ym = MRR.insightsYm; mrrOpenDrill(`Churn — ${rs.dataset.reason}`, mrrYmLabel(ym), MRR.all.filter((x) => x.cat === 'c' && x.ym === ym && mrrReason(x) === rs.dataset.reason), 'churn'); return; }
    const dr = t.closest('[data-drill]');
    if (!dr) return;
    const cur = mrrCur();
    if (dr.dataset.drill === 'month') mrrDrillMonth(dr.dataset.ym);
    if (dr.dataset.drill === 'cat') {
      const c = MRR_CATS.find((x) => x.key === dr.dataset.cat);
      mrrOpenDrill(`${c.label} — ${mrrYmLabel(cur)}`, c.key === 'c' ? 'Includes firms scheduled to cancel later this month' : 'This month', MRR.all.filter((x) => x.ym === cur && x.cat === c.key), c.key === 'c' ? 'churn' : 'move');
    }
    if (dr.dataset.drill === 'am') {
      const yms = MRR.lbRange === 'month' ? [cur] : [cur, mrrAddYm(cur, -1), mrrAddYm(cur, -2)];
      mrrOpenDrill(dr.dataset.am, MRR.lbRange === 'month' ? mrrYmLabel(cur) : 'Last 3 months', MRR.all.filter((x) => yms.includes(x.ym) && mrrAm(x) === dr.dataset.am), 'move');
    }
    if (dr.dataset.drill === 'period') { const p = mrrPeriod(); mrrOpenDrill(`Churn — ${p.label}`, 'Cancellations', mrrChurnRows(p), 'churn'); }
    if (dr.dataset.drill === 'agency') { const p = mrrPeriod(); mrrOpenDrill(`Agency-client churn — ${p.label}`, 'Cancellations', mrrChurnRows(p).filter((x) => x.agency), 'churn'); }
  });
}
