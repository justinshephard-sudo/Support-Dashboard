/* ==========================================================================
   Implementation tab — onboarding metrics from ChurnZero, written daily by
   apps-script/implementation-sync.gs into "Impl - Monthly" / "Impl - Open Firms".
   ========================================================================== */
const IMPL = { months: [], byLabel: new Map(), open: [], events: [], loaded: false, chartsDrawn: false, current: null };
const IMPL_STAGE_ORDER = ['Needs to Schedule', 'First Onboarding', 'Second Onboarding', 'Third Onboarding',
  'Fourth Onboarding', 'Fifth Onboarding', 'Sixth Onboarding', 'Additional Onboarding'];

function sheetObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] == null ? '' : String(r[i]).trim(); });
    return o;
  });
}

async function initImplementation() {
  showSyncNote('implSync', 'Implementation');
  try {
    const [monthly, open, events] = await Promise.all([
      fetchSheetByTitle('Impl - Monthly'),
      fetchSheetByTitle('Impl - Open Firms').catch(() => []),
      fetchSheetByTitle('Impl - Firm Events').catch(() => []),
    ]);
    IMPL.events = sheetObjects(events);
    IMPL.months = sheetObjects(monthly).filter((m) => m.Month).map((m) => ({ ...m, Month: implMonthLabel(m.Month) }));
    IMPL.months.forEach((m) => IMPL.byLabel.set(m.Month, m));
    IMPL.open = sheetObjects(open);
    IMPL.loaded = true;
  } catch (err) {
    console.error('Implementation data not available', err);
    const el = document.getElementById('impl-error');
    el.textContent = 'Implementation data isn’t available yet — the ChurnZero sync hasn’t written the “Impl - Monthly” tab.';
    el.hidden = false;
    document.getElementById('impl-updated').textContent = '';
    return;
  }
  const withData = IMPL.months.filter((m) => toNumber(m.ClosedOnboardings) || m.OpenOnboardings !== '' || toNumber(m.CsatResponses));
  const options = withData.map((m) => ({ key: m.Month, label: m.Month.replace(/ \d{4}$/, (y) => (y.trim() === String(new Date().getFullYear()) ? '' : y)) }));
  const latest = withData[withData.length - 1];
  populateSelect('impl-month', options, latest ? latest.Month : '', 'key', 'label');
  document.getElementById('impl-month').addEventListener('change', (e) => renderImplMonth(e.target.value));
  const updated = latest && latest.UpdatedAt ? new Date(latest.UpdatedAt) : null;
  document.getElementById('impl-updated').textContent = updated && !Number.isNaN(updated.getTime())
    ? `ChurnZero data synced ${updated.toLocaleString()}` : 'ChurnZero data';
  if (latest) renderImplMonth(latest.Month);
  renderImplOverList();
  if (document.getElementById('view-impl').classList.contains('active')) drawImplCharts();
}

// "October 2026", or a date Sheets auto-converted it to (e.g. "10/1/2026") → "October 2026".
function implMonthLabel(v) {
  if (/^[A-Za-z]+ \d{4}$/.test(v)) return v;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const d = iso ? new Date(+iso[1], iso[2] - 1, +iso[3]) : new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function implPrevLabel(label) {
  const i = IMPL.months.findIndex((m) => m.Month === label);
  return i > 0 ? IMPL.months[i - 1].Month : null;
}

const IMPL_TILES = [
  { label: 'Open Onboardings', slot: 1, kind: 'count', col: 'OpenOnboardings',
    sub: (m) => (m.PreKickoff !== '' ? `${fmtNum(toNumber(m.PreKickoff))} Pre-Kickoff · ${fmtNum(toNumber(m.OpenStatus))} Open` : null) },
  { label: 'Median Time in Onboarding', slot: 4, kind: 'days', goodDir: 'down', col: 'MedianDays',
    sub: (m) => (toNumber(m.ClosedOnboardings) ? `Across ${fmtNum(toNumber(m.ClosedOnboardings))} closed this month` : null) },
  { label: 'Onboardings Closed', slot: 3, kind: 'count', goodDir: 'up', col: 'ClosedOnboardings' },
  { label: 'Onboarding CSAT', slot: 6, kind: 'pct', goodDir: 'up', col: 'CsatPct',
    sub: (m) => (toNumber(m.CsatResponses) ? `${fmtNum(toNumber(m.CsatResponses))} responses (4–5 = satisfied)` : null) },
  { label: 'Need to Schedule', slot: 5, kind: 'count', goodDir: 'down', col: 'NeedsScheduling', sub: () => 'Open, no upcoming meeting' },
  { label: '70+ Days, Still Open', slot: 7, kind: 'count', goodDir: 'down', col: 'Over70', sub: () => 'Days since account start' },
];

function renderImplMonth(label) {
  const m = IMPL.byLabel.get(label);
  if (!m) return;
  const prev = IMPL.byLabel.get(implPrevLabel(label)) || null;
  const isCurrent = label === IMPL.months[IMPL.months.length - 1].Month;
  const tiles = IMPL_TILES.map((d) => {
    const cur = toNumber(m[d.col]);
    let delta = null;
    const p = prev ? toNumber(prev[d.col]) : null;
    // Partial current month: skip the delta on counts that accumulate over the month.
    const partial = isCurrent && (d.col === 'ClosedOnboardings');
    if (d.goodDir && cur != null && p != null && p !== 0 && !partial) {
      const pct = ((cur - p) / Math.abs(p)) * 100;
      delta = { pct, good: d.goodDir === 'down' ? pct < 0 : pct > 0 };
    }
    const value = cur == null ? null : d.kind === 'pct' ? fmtPct(cur) : d.kind === 'days' ? `${fmtNum(cur)} days` : fmtNum(cur);
    return { label: d.label, slot: d.slot, value, delta, sub: d.sub ? d.sub(m) : null, onClick: () => openImplDrill(d.col, label) };
  });
  renderTiles('impl-tiles', tiles);
  const note = document.getElementById('impl-note');
  const snapshotMissing = m.OpenOnboardings === '';
  note.hidden = !snapshotMissing;
  note.textContent = snapshotMissing
    ? 'Open onboardings, need-to-schedule, 70+ days, and stages are daily snapshots — ChurnZero keeps no history for them, so they start October 2026.'
    : '';
  renderImplStages(m);
  renderImplReps(m);
  IMPL.current = label;
  // Chart.js can't size a canvas inside a hidden tab; drawImplCharts() catches up on open.
  if (document.getElementById('view-impl').classList.contains('active')) renderImplRepStages(label);
}

// Per-rep table for the selected month (RepStats JSON written by the sync).
const IMPL_REP_COLS = [
  { key: 'rep', label: 'Rep' },
  { key: 'open', label: 'Open' },
  { key: 'preKick', label: 'Pre-Kickoff' },
  { key: 'needsSched', label: 'Need to Schedule' },
  { key: 'over70', label: '70+ Days' },
  { key: 'closed', label: 'Closed' },
  { key: 'medianDays', label: 'Median Days' },
  { key: 'csatPct', label: 'CSAT' },
];
const implRepSort = { key: 'open', dir: -1 };

function renderImplReps(m) {
  const table = document.getElementById('impl-reps');
  let stats = {};
  try { stats = m.RepStats ? JSON.parse(m.RepStats) : {}; } catch (e) { stats = {}; }
  const rows = Object.entries(stats).map(([rep, s]) => ({ rep, ...s }));
  const head = document.createElement('tr');
  IMPL_REP_COLS.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (implRepSort.key === c.key) th.classList.add('sorted', ...(implRepSort.dir === 1 ? ['asc'] : []));
    th.addEventListener('click', () => {
      if (implRepSort.key === c.key) implRepSort.dir *= -1;
      else { implRepSort.key = c.key; implRepSort.dir = c.key === 'rep' ? 1 : -1; }
      renderImplReps(m);
    });
    head.appendChild(th);
  });
  table.querySelector('thead').replaceChildren(head);
  if (!rows.length) {
    table.querySelector('tbody').innerHTML = `<tr><td colspan="${IMPL_REP_COLS.length}">No rep breakdown for this month yet.</td></tr>`;
    return;
  }
  const { key, dir } = implRepSort;
  rows.sort((a, b) => {
    // "Unassigned" always sits at the bottom.
    if ((a.rep === 'Unassigned') !== (b.rep === 'Unassigned')) return a.rep === 'Unassigned' ? 1 : -1;
    if (key === 'rep') return a.rep.localeCompare(b.rep) * dir;
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return a.rep.localeCompare(b.rep);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir || a.rep.localeCompare(b.rep);
  });
  const cell = (r, k) => {
    const v = r[k];
    if (k === 'rep') return esc(v);
    if (k === 'closed' || k === 'csatPct') {
      if (k === 'closed') return fmtNum(v || 0);
      return v == null ? '–' : `${fmtPct(v)}<small class="muted"> (${fmtNum(r.csatN)})</small>`;
    }
    return v == null ? '–' : fmtNum(v);
  };
  table.querySelector('tbody').innerHTML = rows.map((r) =>
    `<tr${r.rep === 'Unassigned' ? ' class="row-muted"' : ''}>${IMPL_REP_COLS.map((c) => `<td>${cell(r, c.key)}</td>`).join('')}</tr>`).join('');
}

function renderImplStages(m) {
  const el = document.getElementById('impl-stages');
  let counts = {};
  try { counts = m.StageCounts ? JSON.parse(m.StageCounts) : {}; } catch (e) { counts = {}; }
  const rows = Object.entries(counts).map(([label, value]) => ({ label, value: Number(value) || 0 }))
    .sort((a, b) => {
      const ia = IMPL_STAGE_ORDER.indexOf(a.label), ib = IMPL_STAGE_ORDER.indexOf(b.label);
      const ra = a.label === 'No stage set' ? 999 : (ia < 0 ? 500 : ia), rb = b.label === 'No stage set' ? 999 : (ib < 0 ? 500 : ib);
      return ra - rb || b.value - a.value;
    });
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) { el.innerHTML = '<div class="empty-note">No stage snapshot for this month.</div>'; return; }
  const max = Math.max(...rows.map((r) => r.value));
  el.innerHTML = rows.map((r) => {
    const color = r.label === 'No stage set' ? 'var(--slot-8)' : r.label === 'Needs to Schedule' ? 'var(--slot-5)' : 'var(--slot-1)';
    return `<div class="chan-row stage-row"><span class="chan-label">${esc(r.label)}</span>`
      + `<span class="chan-track"><span class="chan-fill" style="width:${(r.value / max) * 100}%;background:${color}"></span></span>`
      + `<span class="chan-val">${fmtNum(r.value)}<small>${Math.round((r.value / total) * 100)}%</small></span></div>`;
  }).join('');
}

const IMPL_OVER_PAGE_SIZE = 15;
let implOverPage = 0;

/* ---- Tile drill-down: the firms behind each Implementation number ---- */
const IMPL_FIRM_COLS = [['Name', 'Firm'], ['DaysInOnboarding', 'Days'], ['Status', 'Status'], ['Stage', 'Stage'],
  ['AccountManager', 'Account Manager'], ['Specialist', 'Specialist'], ['NextMeeting', 'Next meeting']];

function implDrillSpec(col, label) {
  const latest = IMPL.months[IMPL.months.length - 1].Month;
  const snapshot = (title, note, rows) => (label === latest
    ? { title, note, cols: IMPL_FIRM_COLS, rows: rows.sort((a, b) => toNumber(b.DaysInOnboarding) - toNumber(a.DaysInOnboarding)) }
    : { title, empty: `Firm-level detail for this number is only kept for today — switch the month to ${latest}.` });
  const days = (f) => toNumber(f.DaysInOnboarding) || 0;
  const evs = (type) => IMPL.events.filter((e) => e.Type === type && e.Month === label);
  switch (col) {
    case 'OpenOnboardings':
      return snapshot('Open Onboardings', 'Pre-Kickoff and Open firms, as of today', [...IMPL.open]);
    case 'NeedsScheduling':
      return snapshot('Need to Schedule', 'Open onboardings with no upcoming meeting, as of today', IMPL.open.filter((f) => !f.NextMeeting));
    case 'Over70':
      return snapshot('70+ Days, Still Open', 'Open onboardings at 70 or more days since start, as of today', IMPL.open.filter((f) => days(f) >= 70));
    case 'ClosedOnboardings':
    case 'MedianDays': {
      const rows = evs('closed').sort((a, b) => (toNumber(a.Days) ?? 1e9) - (toNumber(b.Days) ?? 1e9));
      const m = IMPL.byLabel.get(label);
      return {
        title: col === 'MedianDays' ? 'Median Time in Onboarding' : 'Onboardings Closed',
        note: `Completed in ${label}` + (m && m.MedianDays !== '' ? ` · median ${fmtNum(toNumber(m.MedianDays))} days` : ''),
        cols: [['Name', 'Firm'], ['Date', 'Completed'], ['Days', 'Days in onboarding'], ['AccountManager', 'Account Manager'], ['Specialist', 'Specialist']],
        rows, median: col === 'MedianDays' && m ? toNumber(m.MedianDays) : null,
        empty: IMPL.events.length ? 'No onboardings completed this month.' : 'Firm detail appears after the next ChurnZero sync.',
      };
    }
    case 'CsatPct': {
      let rows = evs('csat').sort((a, b) => toNumber(a.Score) - toNumber(b.Score) || a.Date.localeCompare(b.Date));
      const noData = 'Firm detail appears after the next ChurnZero sync.';
      // The tile shows the team score; the list behind it is each rep's own (managers see everyone's).
      if (!isManager()) {
        const me = implMyRepName();
        if (!me) {
          return { title: 'Your Onboarding CSAT', empty: 'Your ratings show here once you’re the account manager on firms in ChurnZero.' };
        }
        rows = rows.filter((r) => r.AccountManager === me);
        const pos = rows.filter((r) => toNumber(r.Score) >= 4).length;
        return {
          title: 'Your Onboarding CSAT',
          note: `${me} · ${label}` + (rows.length ? ` · ${fmtPct((pos / rows.length) * 100)} satisfied (4–5)` : ''),
          cols: [['Name', 'Firm'], ['Score', 'Score'], ['Date', 'Date'], ['Comment', 'Comment']],
          rows, empty: IMPL.events.length ? 'No survey responses for your firms this month.' : noData,
        };
      }
      return {
        title: 'Onboarding CSAT', note: `Responses in ${label} · 4–5 counts as satisfied`,
        cols: [['Name', 'Firm'], ['Score', 'Score'], ['Date', 'Date'], ['AccountManager', 'Account Manager'], ['Comment', 'Comment']],
        rows, empty: IMPL.events.length ? 'No survey responses this month.' : noData,
      };
    }
    default: return null;
  }
}

// "2026-10-03" → "Oct 3, 2026" (parsed as a local date, so it never shifts a day).
function implFmtDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  return new Date(+m[1], m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Signed-in email → their ChurnZero "Account Manager" name. Emails here are mostly first@ or
// first.last@; add an entry to IMPL_REP_EMAILS for anyone who doesn't follow that pattern.
const IMPL_REP_EMAILS = {};   // e.g. 'kwickham@lawmatics.com': 'Kennedy Wickham'
function implMyRepName() {
  const email = (AUTH.email || '').toLowerCase();
  if (IMPL_REP_EMAILS[email]) return IMPL_REP_EMAILS[email];
  const local = email.split('@')[0];
  const reps = [...new Set(IMPL.events.map((e) => e.AccountManager).concat(IMPL.open.map((f) => f.AccountManager)))]
    .filter((r) => r && r !== 'Unassigned');
  return reps.find((rep) => {
    const parts = rep.toLowerCase().replace(/[^a-z\s-]/g, '').split(/[\s-]+/).filter(Boolean);
    const first = parts[0], last = parts[parts.length - 1];
    return [first, `${first}.${last}`, `${first}${last}`, `${first[0]}${last}`, `${first}_${last}`].includes(local);
  }) || null;
}

function implDrillCell(key, row, median) {
  const v = row[key];
  if (key === 'Date' && v) return esc(implFmtDate(v));
  if (key === 'Score' && v !== '') {
    const n = toNumber(v);
    return `<span class="score-pill ${n >= 4 ? 'good' : n === 3 ? 'mid' : 'bad'}">${esc(v)}</span>`;
  }
  if (key === 'Days' && median != null && toNumber(v) === median) return `${esc(v)} <span class="muted">· median</span>`;
  if (key === 'Comment') return v ? `<span class="drill-comment">${esc(v)}</span>` : '<span class="muted">–</span>';
  return esc(v || '–');
}

function openImplDrill(col, label) {
  const spec = implDrillSpec(col, label);
  if (!spec) return;
  closeImplDrill();
  const back = document.createElement('div');
  back.className = 'drill-backdrop';
  back.id = 'impl-drill';
  const count = spec.rows ? spec.rows.length : 0;
  const body = spec.rows && spec.rows.length
    ? `<div class="table-wrap"><table class="drill-table"><thead><tr>${spec.cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>`
      + `<tbody>${spec.rows.map((r) => `<tr>${spec.cols.map(([k]) => `<td>${implDrillCell(k, r, spec.median)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<div class="empty-note">${esc(spec.empty || 'Nothing to show.')}</div>`;
  back.innerHTML = `<div class="drill" role="dialog" aria-modal="true" aria-labelledby="impl-drill-title">
      <div class="drill-head">
        <div><h3 id="impl-drill-title">${esc(spec.title)}${spec.rows ? ` <span class="drill-count">${fmtNum(count)}</span>` : ''}</h3>
          ${spec.note ? `<div class="drill-note">${esc(spec.note)}</div>` : ''}</div>
        <button type="button" class="drill-close" aria-label="Close">×</button>
      </div>
      <div class="drill-body">${body}</div>
    </div>`;
  back.addEventListener('click', (e) => { if (e.target === back) closeImplDrill(); });
  back.querySelector('.drill-close').addEventListener('click', closeImplDrill);
  document.addEventListener('keydown', implDrillKey);
  document.body.appendChild(back);
  document.body.classList.add('drill-open');
  back.querySelector('.drill-close').focus();
}
function implDrillKey(e) { if (e.key === 'Escape') closeImplDrill(); }
function closeImplDrill() {
  const el = document.getElementById('impl-drill');
  if (!el) return;
  el.remove();
  document.body.classList.remove('drill-open');
  document.removeEventListener('keydown', implDrillKey);
}

// Stage colors: orange = still needs scheduling, light → dark blue = 1st → 6th call,
// purple = additional calls, grey = no stage set.
const IMPL_STAGE_COLORS = {
  'Needs to Schedule': '--slot-5',
  'First Onboarding': '#b9dcff', 'Second Onboarding': '#8cc5ff', 'Third Onboarding': '#5aaaff',
  'Fourth Onboarding': '--slot-1', 'Fifth Onboarding': '#0569c2', 'Sixth Onboarding': '#06478a',
  'Additional Onboarding': '--slot-6', 'No stage set': '--slot-8',
};
function implStageRank(label) {
  if (label === 'No stage set') return 999;
  const i = IMPL_STAGE_ORDER.indexOf(label);
  return i < 0 ? 500 : i;
}

// Per-rep stage counts for a month: saved in RepStats by the sync; for the current
// month, fall back to today's open-firm list (rows written before stages were tracked).
function implRepStageCounts(label) {
  const m = IMPL.byLabel.get(label);
  let stats = {};
  try { stats = m && m.RepStats ? JSON.parse(m.RepStats) : {}; } catch (e) { stats = {}; }
  const out = {};
  Object.entries(stats).forEach(([rep, st]) => { if (st.stages) out[rep] = st.stages; });
  const isCurrent = IMPL.months.length && label === IMPL.months[IMPL.months.length - 1].Month;
  if (!Object.keys(out).length && isCurrent) {
    IMPL.open.forEach((f) => {
      const rep = f.AccountManager || 'Unassigned';
      const stage = f.Stage || 'No stage set';
      out[rep] = out[rep] || {};
      out[rep][stage] = (out[rep][stage] || 0) + 1;
    });
  }
  return out;
}

function renderImplRepStages(label) {
  const counts = implRepStageCounts(label);
  const reps = Object.keys(counts).map((rep) => ({ rep, total: Object.values(counts[rep]).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => ((a.rep === 'Unassigned') - (b.rep === 'Unassigned')) || b.total - a.total || a.rep.localeCompare(b.rep));
  const wrap = document.getElementById('impl-rep-stages-wrap');
  const empty = document.getElementById('impl-rep-stages-empty');
  const id = 'chart-impl-rep-stages';
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  wrap.hidden = !reps.length;
  empty.hidden = !!reps.length;
  if (!reps.length) return;

  const stages = [...new Set(reps.flatMap((r) => Object.keys(counts[r.rep])))].sort((a, b) => implStageRank(a) - implStageRank(b));
  const color = (stage) => { const c = IMPL_STAGE_COLORS[stage] || '--slot-2'; return c.startsWith('--') ? cssVar(c) : c; };
  wrap.style.height = `${reps.length * 34 + 70}px`;
  const tickColor = cssVar('--faint');
  charts[id] = new Chart(document.getElementById(id), {
    type: 'bar',
    data: {
      labels: reps.map((r) => r.rep),
      datasets: stages.map((stage) => ({
        label: stage,
        data: reps.map((r) => counts[r.rep][stage] || 0),
        backgroundColor: color(stage),
        borderColor: cssVar('--surface-1'),
        borderWidth: 1,
        barThickness: 20,
      })),
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', axis: 'y', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { color: tickColor, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14 } },
        tooltip: {
          filter: (item) => item.raw > 0,
          callbacks: { footer: (items) => (items.length ? `Total: ${reps[items[0].dataIndex].total}` : '') },
        },
      },
      scales: {
        x: { stacked: true, beginAtZero: true, grid: { color: cssVar('--border') }, ticks: { color: tickColor, precision: 0 } },
        y: { stacked: true, grid: { display: false }, ticks: { color: cssVar('--text-2'), font: { weight: 600 } } },
      },
    },
  });
}

function renderImplOverList() {
  // Lowest days first: firms that just crossed 70 days are the easiest to rescue.
  const over = IMPL.open.filter((f) => (toNumber(f.DaysInOnboarding) || 0) >= 70)
    .sort((a, b) => toNumber(a.DaysInOnboarding) - toNumber(b.DaysInOnboarding) || a.Name.localeCompare(b.Name));
  document.getElementById('impl-over-note').textContent = `As of today · ${over.length} firm${over.length === 1 ? '' : 's'}`;
  const cols = [['Name', 'Firm'], ['DaysInOnboarding', 'Days'], ['Status', 'Status'], ['Stage', 'Stage'],
    ['Specialist', 'Specialist'], ['AccountManager', 'Account Manager'], ['NextMeeting', 'Next meeting']];
  const pages = Math.max(1, Math.ceil(over.length / IMPL_OVER_PAGE_SIZE));
  implOverPage = Math.min(Math.max(implOverPage, 0), pages - 1);
  const start = implOverPage * IMPL_OVER_PAGE_SIZE;
  const shown = over.slice(start, start + IMPL_OVER_PAGE_SIZE);
  const table = document.getElementById('impl-over');
  table.querySelector('thead').innerHTML = `<tr>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr>`;
  table.querySelector('tbody').innerHTML = shown.length
    ? shown.map((f) => `<tr>${cols.map(([k]) => `<td>${esc(f[k] || '–')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}">No open onboardings at 70+ days.</td></tr>`;

  const pager = document.getElementById('impl-over-pager');
  pager.hidden = pages <= 1;
  if (pages <= 1) return;
  pager.innerHTML = `<button type="button" class="pager-btn" data-dir="-1"${implOverPage === 0 ? ' disabled' : ''}>‹ Prev</button>`
    + `<span class="pager-info">${fmtNum(start + 1)}–${fmtNum(start + shown.length)} of ${fmtNum(over.length)}</span>`
    + `<button type="button" class="pager-btn" data-dir="1"${implOverPage >= pages - 1 ? ' disabled' : ''}>Next ›</button>`;
  pager.querySelectorAll('.pager-btn').forEach((b) => b.addEventListener('click', () => {
    implOverPage += Number(b.dataset.dir);
    renderImplOverList();
  }));
}

function drawImplCharts() {
  if (!IMPL.loaded) return;
  if (IMPL.current) renderImplRepStages(IMPL.current);
  if (IMPL.chartsDrawn) return;
  IMPL.chartsDrawn = true;
  const done = IMPL.months.slice(-13, -1);   // last 12 completed months
  const labels = done.map((m) => m.Month.replace(/ (\d{4})$/, (y, yr) => ` ’${yr.slice(2)}`).replace(/^(\w{3})\w*/, '$1'));
  const series = (col) => done.map((m) => toNumber(m[col]));
  drawLineChart('chart-impl-closed', labels, [{ label: 'Onboardings Closed', data: series('ClosedOnboardings'), borderColor: cssVar('--slot-3') }]);
  drawLineChart('chart-impl-median', labels, [{ label: 'Median days', data: series('MedianDays'), borderColor: cssVar('--slot-4') }]);
  drawLineChart('chart-impl-csat', labels, [{ label: 'Onboarding CSAT %', data: series('CsatPct'), borderColor: cssVar('--slot-6') }], { max: 100 });
}

// Additional Services: the Builds board + quote builder app (services/), embedded on first open.
// Same origin, so it borrows this page's Google sign-in (window.AUTH) instead of signing in again.
function mountServices() {
  const root = document.getElementById('services-root');
  if (!root || root.querySelector('iframe')) return;
  const frame = document.createElement('iframe');
  frame.src = 'services/index.html?v=2610200818';
  frame.title = 'Additional Services';
  frame.className = 'services-frame';
  root.appendChild(frame);
}
