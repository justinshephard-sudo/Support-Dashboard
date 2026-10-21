/* ==========================================================================
   CS Report Master (clean source): build the {members, groups, hasData} month
   shape, annual series, and quarterly aggregates the existing renderers expect,
   from the flat "Data - Monthly" + "Data - Teammates" tabs. The old sheet's
   Accounts (firm lookup) + Overrides tabs are still read from SHEET_ID above.
   ========================================================================== */
const REPORT = { monthly: new Map(), teammates: new Map(), categories: new Map() };  // monthKey -> rowObj / [members] / Map(section -> [{cat, val}])
const monthKeyOf = (label) => String(label || '').trim().split(/\s+/)[0].toLowerCase();

// Data-Teammates columns, by exact sheet header name -> member key. Looked up by name (not
// position), so columns can be reordered or appended without breaking this mapping.
// "FaceTime + Live Screenshares" has no key on purpose — it's not surfaced on the dashboard.
const TEAM_COL_TO_KEY = {
  'Conv. Assigned': 'convAssigned',
  'Conv. Replied': 'convReplied',
  'Total Phone Calls': 'totalCalls',
  'Missed Phone Calls': 'missedCalls',
  'Declined Phone Calls': 'declinedCalls',
  'Phone Answer Rate': 'phoneAnswerRate',
  'CSAT': 'csat',
  'CSAT %': 'csatPct',
  'DSAT': 'dsat',
  'DSAT %': 'dsatPct',
  'Reviewd CSAT': 'reviewedPct',
  'CX': 'cx',
  'New Tickets': 'newTickets',
  'Avg. Teammate Assign to 1st response': 'avg1stResponse',
  'Avg. Resp Time': 'avgRespTime',
  'Closed Conv.': 'closedConv',
  'Closing Time': 'closingTime',
  'Support Calls': 'supportCalls',
  'TB Demos': 'tbDemos',
  'Total': 'totalDemos',
  'Avg Handling Time': 'avgHandlingTime',
};

async function loadReportTables() {
  const [monthlyRows, teammateRows, overrideRows, categoryRows] = await Promise.all([
    fetchTitleFrom(REPORT_SHEET_ID, 'Data - Monthly'),
    fetchTitleFrom(REPORT_SHEET_ID, 'Data - Teammates'),
    fetchTitleFrom(REPORT_SHEET_ID, 'Overrides').catch(() => []),
    fetchTitleFrom(REPORT_SHEET_ID, 'Data - Categories').catch(() => []),
  ]);
  // Data - Categories: Month | Section | Category | Value (e.g. Section "Channel" -> Email/Chat/Phone/SMS).
  categoryRows.slice(1).forEach(([month, section, cat, val]) => {
    const mk = monthKeyOf(month);
    if (!mk || !section || !cat) return;
    if (!REPORT.categories.has(mk)) REPORT.categories.set(mk, new Map());
    const secs = REPORT.categories.get(mk);
    if (!secs.has(section.trim())) secs.set(section.trim(), []);
    secs.get(section.trim()).push({ cat: cat.trim(), val: val == null ? '' : String(val).trim() });
  });
  const mHeader = (monthlyRows[0] || []).map((h) => String(h || '').trim());
  monthlyRows.slice(1).forEach((r) => {
    const o = {};
    mHeader.forEach((h, i) => { o[h] = (r[i] == null ? '' : String(r[i]).trim()); });
    if (o.Month) REPORT.monthly.set(monthKeyOf(o.Month), o);
  });
  const tHeader = (teammateRows[0] || []).map((h) => String(h || '').trim());
  const mIdx = tHeader.indexOf('Month'), rIdx = tHeader.indexOf('Rep');
  teammateRows.slice(1).forEach((r) => {
    const mk = monthKeyOf(r[mIdx]);
    const name = (r[rIdx] || '').trim();
    if (!mk || !name || EXCLUDED_NAMES.has(name.toLowerCase())) return;
    const member = { name };
    tHeader.forEach((colName, i) => {
      const key = TEAM_COL_TO_KEY[colName];
      if (key) member[key] = (r[i] == null ? '' : String(r[i]).trim());
    });
    if (!REPORT.teammates.has(mk)) REPORT.teammates.set(mk, []);
    REPORT.teammates.get(mk).push(member);
  });
  REPORT.keyToSheetCol = {};   // member key -> sheet column name (for override write-back)
  Object.entries(TEAM_COL_TO_KEY).forEach(([colName, key]) => { REPORT.keyToSheetCol[key] = colName; });
  applyOverridesLive(overrideRows);
  parseResourceFlags(overrideRows);

  // Incentive meta (FaceTime title/amount): rows where Table === 'Incentive'.
  incentiveMetaMap = new Map();
  (overrideRows || []).slice(1).forEach((row) => {
    const [month, table, rep, column, value] = row.concat(['', '', '', '', '', '']);
    if (String(table).trim().toLowerCase() !== 'incentive') return;
    if (!month || !rep || !column || value === '' || value == null) return;
    incentiveMetaMap.set(`${String(month).trim()}:${String(rep).trim()}:${String(column).trim()}`, String(value).trim());
  });
}

const fullMonthLabel = (monthName) => {
  const o = REPORT.monthly.get(String(monthName).toLowerCase());
  return o && o.Month ? o.Month : monthName;
};

// Apply the Overrides tab live at read time so manual corrections show on the
// dashboard immediately (no write-job run needed). Value is absolute, or a delta
// if it starts with + / - (adjusts the raw report value; new data still accrues).
function adjustValue(cur, value) {
  const v = String(value).trim();
  if (/^[+-]\d/.test(v)) {
    const base = parseFloat(String(cur).replace(/[%,]/g, '')) || 0;
    const n = base + parseFloat(v);
    return String(n) + (String(cur).trim().endsWith('%') ? '%' : '');
  }
  return v;
}
function applyOverridesLive(overrideRows) {
  if (!overrideRows || overrideRows.length < 2) return;
  const touchedMonthly = new Set();          // mk whose Missed/Declined/Inbound changed
  const touchedMembers = new Set();          // "mk::repname" whose Missed/Declined/Total changed
  overrideRows.slice(1).forEach((row) => {
    const [oMonth, table, rep, column, value] = row.concat(['', '', '', '', '', '']);
    if (!column || value === '' || value == null) return;
    const mk = monthKeyOf(oMonth);
    if (String(table).toLowerCase().startsWith('month')) {
      const o = REPORT.monthly.get(mk);
      if (o && column in o) {
        o[column] = adjustValue(o[column], value);
        if (/^(missed calls|declined calls|inbound calls)$/i.test(column.trim())) touchedMonthly.add(mk);
      }
    } else {
      const key = TEAM_COL_TO_KEY[String(column).trim()];
      if (!key) return;
      const m = (REPORT.teammates.get(mk) || []).find((x) => x.name.trim().toLowerCase() === String(rep).trim().toLowerCase());
      if (m) {
        m[key] = adjustValue(m[key], value);
        if (key === 'missedCalls' || key === 'declinedCalls' || key === 'totalCalls') touchedMembers.add(`${mk}::${m.name.toLowerCase()}`);
      }
    }
  });
  // Missed + declined calls both drive the answer-rate %, so recompute it wherever those changed.
  const pct = (whole, against) => (whole && whole > 0 && against != null) ? `${Math.round(((whole - against) / whole) * 100)}%` : null;
  touchedMonthly.forEach((mk) => {
    const o = REPORT.monthly.get(mk); if (!o) return;
    const against = (toNumber(o['Missed Calls']) || 0) + (toNumber(o['Declined Calls']) || 0);
    const r = pct(toNumber(o['Inbound Calls']), against);   // monthly uses Inbound
    if (r != null) o['Phone Answer Rate'] = r;
  });
  touchedMembers.forEach((tag) => {
    const [mk, repl] = tag.split('::');
    const m = (REPORT.teammates.get(mk) || []).find((x) => x.name.toLowerCase() === repl); if (!m) return;
    const against = (toNumber(m.missedCalls) || 0) + (toNumber(m.declinedCalls) || 0);
    const r = pct(toNumber(m.totalCalls), against);             // per-rep uses Total calls
    if (r != null) m.phoneAnswerRate = r;
  });
}

const mval = (mk, col) => { const o = REPORT.monthly.get(mk); return o ? (o[col] || '') : ''; };

function buildMonthParsed(monthName) {
  const mk = monthName.toLowerCase();
  const members = REPORT.teammates.get(mk) || [];
  const g0 = new Map(), g6 = new Map(), g11 = new Map();
  const put = (map, label, col) => map.set(label, { current: mval(mk, col), prior: '', pct: '' });
  put(g0, 'new conversations', 'New Conversations');
  put(g0, 'ai resolution rate', 'AI Resolution Rate');
  put(g0, 'avg response time', 'Avg Response Time');
  put(g0, 'total calls', 'Total Calls');
  put(g6, 'answer rate', 'Phone Answer Rate');
  put(g11, 'total attendees', 'OH Total Attendees');
  put(g11, 'total article views', 'Total Article Views');
  put(g11, 'total artcile views', 'Total Article Views');
  return { mk, members, groups: { 0: g0, 6: g6, 11: g11 }, hasData: members.some(memberHasData) };
}

function overallCsatPct(mk) {
  let c = 0, d = 0;
  (REPORT.teammates.get(mk) || []).forEach((m) => { c += toNumber(m.csat) || 0; d += toNumber(m.dsat) || 0; });
  return (c + d) ? String(Math.round((c / (c + d)) * 1000) / 10) : '';
}
function avgAssignedPerMember(mk) {
  const members = (REPORT.teammates.get(mk) || []).filter(memberHasData);
  if (!members.length) return '';
  const total = members.reduce((s, m) => s + (toNumber(m.convAssigned) || 0), 0);
  return String(Math.round(total / members.length));
}

function buildAnnualSeries() {
  const series = new Map();
  const set = (label, colOrFn) => series.set(label.toLowerCase(), MONTH_NAMES.map((name) => {
    const mk = name.toLowerCase();
    if (!REPORT.monthly.has(mk)) return '';
    return typeof colOrFn === 'function' ? colOrFn(mk) : mval(mk, colOrFn);
  }));
  set('New Conversations', 'New Conversations');
  set('Conversations Assigned', 'Conversations Assigned');
  set('Answer Rate', 'Phone Answer Rate');
  set('AI Resolution Rate', 'AI Resolution Rate');
  set('Total Calls', 'Total Calls');
  set('Avg Response Time', 'Avg Response Time');
  set('Total Help Article Search', 'Total Article Views');
  set('CSAT%', overallCsatPct);
  set('Avg Assigned Convers Per Team Member', avgAssignedPerMember);
  return series;
}

function secToTime(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${h}:${p(mm)}:${p(ss)}`;
}

function buildQuarters() {
  const SUM = ['convAssigned', 'convReplied', 'totalCalls', 'missedCalls', 'declinedCalls', 'csat', 'dsat', 'newTickets', 'closedConv', 'supportCalls', 'tbDemos', 'totalDemos'];
  const AVG_PCT = ['phoneAnswerRate', 'csatPct', 'dsatPct', 'reviewedPct'];
  const AVG_TIME = ['avg1stResponse', 'avgRespTime', 'closingTime'];
  const out = {};
  QUARTER_NAMES.forEach((q) => {
    const monthKeys = QUARTER_MONTH_INDEXES[q]
      .map((i) => MONTH_NAMES[i].toLowerCase())
      .filter((mk) => REPORT.teammates.has(mk));
    const byRep = new Map();
    monthKeys.forEach((mk) => (REPORT.teammates.get(mk) || []).forEach((m) => {
      if (!byRep.has(m.name)) byRep.set(m.name, []);
      byRep.get(m.name).push(m);
    }));
    const members = [];
    byRep.forEach((rows, name) => {
      const m = { name };
      SUM.forEach((k) => { const v = rows.map((r) => toNumber(r[k])).filter((x) => x != null); m[k] = v.length ? String(v.reduce((a, b) => a + b, 0)) : ''; });
      AVG_PCT.forEach((k) => { const v = rows.map((r) => toNumber(r[k])).filter((x) => x != null); m[k] = v.length ? `${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}%` : ''; });
      AVG_TIME.forEach((k) => { const v = rows.map((r) => parseTimeToSeconds(r[k])).filter((x) => x != null); m[k] = v.length ? secToTime(v.reduce((a, b) => a + b, 0) / v.length) : ''; });
      members.push(m);
    });
    out[q] = { members, hasData: members.some(memberHasData) };
  });
  return out;
}

function readMemberRow(row) {
  const name = (row[0] || '').trim();
  if (!name || EXCLUDED_NAMES.has(name.toLowerCase())) return null;
  const member = { name };
  LEADERBOARD_COLUMNS.forEach((col, idx) => {
    member[col.key] = (row[idx + 1] || '').trim();
  });
  return member;
}

function memberHasData(m) {
  const n = parseFloat((m.convAssigned || '').replace(/,/g, ''));
  return !Number.isNaN(n) && n > 0;
}

function parseMonthSheet(rows) {
  const members = [];
  let totalRowIdx = -1;

  for (let i = 1; i < rows.length; i++) {
    const rawName = (rows[i][0] || '').trim();
    if (!rawName) continue;
    if (rawName.toLowerCase() === 'total') { totalRowIdx = i; break; }
    const member = readMemberRow(rows[i]);
    if (member) members.push(member);
  }

  const groups = { 0: new Map(), 6: new Map(), 11: new Map() };
  if (totalRowIdx !== -1) {
    for (let i = totalRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      for (const start of [0, 6, 11]) {
        const label = (row[start] || '').trim();
        if (!label) continue;
        groups[start].set(label.toLowerCase(), {
          current: (row[start + 1] || '').trim(),
          prior: (row[start + 2] || '').trim(),
          pct: (row[start + 3] || '').trim(),
        });
      }
    }
  }

  const hasData = members.some(memberHasData);
  return { members, groups, hasData };
}

function parseQuarterlySheet(rows) {
  const quarters = {};

  const readBlock = (startIdx) => {
    const members = [];
    for (let i = startIdx; i < startIdx + 8 && i < rows.length; i++) {
      const member = readMemberRow(rows[i]);
      if (member) members.push(member);
    }
    return { members, hasData: members.some(memberHasData) };
  };

  quarters.Q1 = readBlock(1);
  for (let i = 0; i < rows.length; i++) {
    const label = (rows[i][0] || '').trim().toUpperCase();
    if (label === 'Q2' || label === 'Q3' || label === 'Q4') {
      quarters[label] = readBlock(i + 2);
    }
  }
  return quarters;
}

function lookup(map, candidates) {
  for (const c of candidates) {
    const hit = map.get(c.toLowerCase());
    if (hit && hit.current !== '') return hit.current;
  }
  return null;
}

const TILE_DEFS = [
  { label: 'New Conversations', icon: '💬', slot: 1, kind: 'num', goodDir: 'up', showDelta: true, get: (p) => lookup(p.groups[0], ['New Conversations']) },
  { label: 'Phone Answer Rate', icon: '📞', slot: 2, kind: 'pct', goodDir: 'up', showDelta: true, get: (p) => lookup(p.groups[6], ['Answer Rate']) },
  { label: 'Team CSAT', icon: '⭐', slot: 3, kind: 'pct', goodDir: 'up', showDelta: true, get: (p) => teamCsatPct(p) },
  { label: 'Avg Response Time', icon: '⏱️', slot: 4, kind: 'duration', goodDir: 'down', showDelta: true, get: (p) => lookup(p.groups[0], ['Avg Response Time']) },
  { label: 'AI Resolution Rate', icon: '🤖', slot: 5, kind: 'num', goodDir: 'up', showDelta: true, get: (p) => lookup(p.groups[0], ['AI Resolution Rate', 'AI Confirmed Resolution Rate']) },
  { label: 'Total Calls', icon: '☎️', slot: 6, kind: 'num', goodDir: 'up', showDelta: true, get: (p) => lookup(p.groups[0], ['Total Calls']) },
];

function extractTiles(parsed, prevParsed) {
  return TILE_DEFS.map((def) => {
    const value = def.get(parsed);
    let delta = null; // { pct, good }
    if (def.showDelta && prevParsed) {
      const cur = tileNum(def.kind, value);
      const prev = tileNum(def.kind, def.get(prevParsed));
      if (cur != null && prev != null && prev !== 0) {
        const pct = ((cur - prev) / Math.abs(prev)) * 100;
        const good = def.goodDir === 'down' ? pct < 0 : pct > 0;
        delta = { pct, good };
      }
    }
    return { label: def.label, icon: def.icon, slot: def.slot, value, delta };
  });
}

function parseAnnualSheet(rows) {
  const series = new Map();
  for (let i = 1; i < rows.length; i++) {
    const label = (rows[i][0] || '').trim();
    if (!label) continue;
    const values = MONTH_NAMES.map((_, idx) => (rows[i][idx + 1] || '').trim());
    series.set(label.toLowerCase(), values);
  }
  return series;
}

function toNumber(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[%,]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function fmtNum(n) {
  return n == null ? null : Math.round(n).toLocaleString();
}

// ACTUAL team CSAT = Σ positive ratings / Σ total ratings (weighted by volume),
// NOT the mean of each rep's percentage.
function teamCsatPct(parsed) {
  let pos = 0, tot = 0, any = false;
  (parsed.members || []).forEach((m) => {
    const c = toNumber(m.csat);
    if (c != null) { any = true; pos += c; tot += c + (toNumber(m.dsat) || 0); }
  });
  return any && tot > 0 ? fmtPct((pos / tot) * 100) : null;
}

// Numeric value of a tile (for % change); durations use seconds.
function tileNum(kind, value) {
  return kind === 'duration' ? parseTimeToSeconds(value) : toNumber(value);
}

function fmtPct(n) {
  return n == null ? null : `${(Math.round(n * 10) / 10)}%`;
}

// Quarter aggregators over a metric's monthly values (idxs = the quarter's month indexes).
const qSeriesVals = (s, label, idxs) => idxs.map((i) => toNumber((s.get(label.toLowerCase()) || [])[i])).filter((v) => v != null);
const qSum = (s, label, idxs) => { const v = qSeriesVals(s, label, idxs); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const qAvg = (s, label, idxs) => { const v = qSeriesVals(s, label, idxs); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const qAvgTime = (s, label, idxs) => {
  const v = idxs.map((i) => parseTimeToSeconds((s.get(label.toLowerCase()) || [])[i])).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
// True weighted team CSAT for the quarter: Σ positive ratings / Σ all ratings.
const qTeamCsat = (members) => {
  let pos = 0, tot = 0;
  (members || []).forEach((m) => { const c = toNumber(m.csat), d = toNumber(m.dsat); if (c != null) { pos += c; tot += c + (d || 0); } });
  return tot > 0 ? (pos / tot) * 100 : null;
};

// Same team cards as the monthly tiles, aggregated correctly for a quarter.
const QUARTER_TILE_DEFS = [
  { label: 'New Conversations', icon: '💬', slot: 1, goodDir: 'up', num: (i, s) => qSum(s, 'New Conversations', i), fmt: fmtNum },
  { label: 'Phone Answer Rate', icon: '📞', slot: 2, goodDir: 'up', num: (i, s) => qAvg(s, 'Answer Rate', i), fmt: fmtPct },
  { label: 'Team CSAT', icon: '⭐', slot: 3, goodDir: 'up', num: (i, s, m) => qTeamCsat(m), fmt: fmtPct },
  { label: 'Avg Response Time', icon: '⏱️', slot: 4, goodDir: 'down', num: (i, s) => qAvgTime(s, 'Avg Response Time', i), fmt: (n) => (n != null ? secToTime(n) : null) },
  { label: 'AI Resolution Rate', icon: '🤖', slot: 5, goodDir: 'up', num: (i, s) => qAvg(s, 'AI Resolution Rate', i), fmt: fmtPct },
  { label: 'Total Calls', icon: '☎️', slot: 6, goodDir: 'up', num: (i, s) => qSum(s, 'Total Calls', i), fmt: fmtNum },
];

function extractQuarterTiles(annualSeries, quarters, quarterKey) {
  const idxs = QUARTER_MONTH_INDEXES[quarterKey];
  const members = (quarters[quarterKey] || {}).members || [];
  const pIdx = QUARTER_NAMES.indexOf(quarterKey) - 1;
  const prevKey = pIdx >= 0 ? QUARTER_NAMES[pIdx] : null;
  const prevOk = prevKey && quarters[prevKey] && quarters[prevKey].hasData;
  const prevIdxs = prevKey ? QUARTER_MONTH_INDEXES[prevKey] : null;
  const prevMembers = prevKey ? ((quarters[prevKey] || {}).members || []) : [];
  return QUARTER_TILE_DEFS.map((def) => {
    const cur = def.num(idxs, annualSeries, members);
    let delta = null;
    if (prevOk) {
      const prev = def.num(prevIdxs, annualSeries, prevMembers);
      if (cur != null && prev != null && prev !== 0) {
        const pct = ((cur - prev) / Math.abs(prev)) * 100;
        delta = { pct, good: def.goodDir === 'down' ? pct < 0 : pct > 0 };
      }
    }
    return { label: def.label, icon: def.icon, slot: def.slot, value: def.fmt(cur), delta };
  });
}

function trimTrailingEmpty(labels, arrays) {
  let lastIdx = -1;
  arrays.forEach((arr) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] != null) { lastIdx = Math.max(lastIdx, i); break; }
    }
  });
  if (lastIdx === -1) return { labels: [], arrays: arrays.map(() => []) };
  return {
    labels: labels.slice(0, lastIdx + 1),
    arrays: arrays.map((arr) => arr.slice(0, lastIdx + 1)),
  };
}

function parseTimeToSeconds(str) {
  if (str == null || String(str).trim() === '' || str === '-') return null;
  const s = String(str).trim();
  // Colon format: H:MM:SS or M:SS
  if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(s)) {
    return s.split(':').map(Number).reduce((acc, v) => acc * 60 + v, 0);
  }
  // Text format the Intercom reports use: "1h 34m 5s", "1h 6m", "27m", "45s", "2h", "13d20h"
  const m = s.match(/^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i);
  if (m && (m[1] || m[2] || m[3] || m[4])) {
    const d = +(m[1] || 0), h = +(m[2] || 0), mi = +(m[3] || 0), se = +(m[4] || 0);
    return ((d * 24 + h) * 60 + mi) * 60 + se;
  }
  return null;
}

function sortValue(str) {
  if (str == null || String(str).trim() === '' || str === '-') return null;
  const s = String(str).trim();
  const asTime = parseTimeToSeconds(s);
  if (asTime != null) return asTime;
  const cleaned = s.replace(/[%,]/g, '');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? s.toLowerCase() : n;
}

function showError(message) {
  const el = document.getElementById('error-banner');
  el.textContent = message;
  el.hidden = false;
}

function renderTiles(containerId, tiles, deltaLabel = 'vs last mo') {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  tiles.forEach(({ label, icon, slot, value, delta, sub, hero, onEdit, onClick }) => {
    const div = document.createElement('div');
    div.className = 'tile' + (hero ? ' tile-hero' : '');
    div.style.setProperty('--tile-accent', `var(--slot-${slot})`);
    let deltaHtml = '';
    if (delta) {
      const arrow = delta.pct > 0 ? '▲' : (delta.pct < 0 ? '▼' : '');
      const color = delta.good ? '#1f9d57' : '#d64545';
      deltaHtml = `<div class="tile-delta" style="color:${color};font-size:.8em;font-weight:600;margin-top:2px;">`
        + `${arrow} ${Math.abs(delta.pct).toFixed(1)}% <span style="opacity:.6;font-weight:400;">${deltaLabel}</span></div>`;
    }
    div.innerHTML = `<span class="icon">${icon}</span><div class="label">${esc(label)}</div>`
      + `<div class="value">${value != null ? esc(value) : '–'}</div>${deltaHtml}`
      + (sub ? `<div class="tile-sub">${esc(sub)}</div>` : '');
    if (onEdit) {
      div.classList.add('tile-editable');
      div.title = 'Manager: click to enter a value';
      div.addEventListener('click', () => onEdit(div));
    } else if (onClick) {
      div.classList.add('tile-clickable');
      div.setAttribute('role', 'button');
      div.tabIndex = 0;
      div.title = 'Click to see the firms behind this number';
      div.addEventListener('click', () => onClick(div));
      div.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(div); } });
    }
    el.appendChild(div);
  });
}

function computeIncentiveWinner(members, def) {
  let winner = null;
  let bestVal = def.better === 'lower' ? Infinity : -Infinity;
  members.forEach((m) => {
    const v = def.metric(m);
    if (v == null) return;
    if ((def.better === 'lower' && v < bestVal) || (def.better === 'higher' && v > bestVal)) {
      bestVal = v;
      winner = m;
    }
  });
  return winner ? { name: winner.name, member: winner, tiedWith: [] } : null;
}

// Best Answer Rate: ties on the rate itself are broken by total call volume
// (more calls at the same rate is the stronger result), but everyone who tied
// on the rate still gets surfaced in the card, not just the tiebreak winner.
function computeAnswerRateWinner(members) {
  const withRate = members
    .map((m) => ({ m, rate: toNumber(m.phoneAnswerRate) }))
    .filter((x) => x.rate != null);
  if (!withRate.length) return null;

  const maxRate = Math.max(...withRate.map((x) => x.rate));
  const tiedGroup = withRate.filter((x) => x.rate === maxRate).map((x) => x.m);

  let winner = tiedGroup[0];
  if (tiedGroup.length > 1) {
    winner = tiedGroup.reduce((best, m) => {
      const calls = toNumber(m.totalCalls) ?? -Infinity;
      const bestCalls = toNumber(best.totalCalls) ?? -Infinity;
      return calls > bestCalls ? m : best;
    }, tiedGroup[0]);
  }

  const tiedWith = tiedGroup.filter((m) => m.name !== winner.name).map((m) => m.name);
  return { name: winner.name, member: winner, tiedWith, tiedStatLabel: winner.phoneAnswerRate };
}

const INCENTIVE_DEFS = [
  {
    key: 'speed',
    displayStat: (m) => `${m.avgRespTime} avg response`,
    compute: (members) => computeIncentiveWinner(members, {
      metric: (m) => parseTimeToSeconds(m.avgRespTime),
      better: 'lower',
    }),
  },
  {
    key: 'answer',
    displayStat: (m) => `${m.phoneAnswerRate} answer rate${m.totalCalls ? ` · ${m.totalCalls} calls` : ''}`,
    compute: computeAnswerRateWinner,
  },
  {
    key: 'csat',
    displayStat: (m) => `${m.csat} CSAT ratings`,
    compute: (members) => computeIncentiveWinner(members, {
      metric: (m) => toNumber(m.csat),
      better: 'higher',
    }),
  },
  {
    key: 'closing',
    title: 'Lowest Closing Time',
    amount: '$135',
    emoji: '⏱️',
    displayStat: (m) => `${fmtDur(parseTimeToSeconds(m.closingTime)) || m.closingTime} avg closing time`,
    compute: (members) => computeIncentiveWinner(members, {
      metric: (m) => parseTimeToSeconds(m.closingTime),
      better: 'lower',
    }),
    // Until October 2026 this card was a manager-set custom award ("facetime" key, with its own
    // title + amount). Months that saved one keep showing it instead of Lowest Closing Time.
    legacy: {
      key: 'facetime',
      manualOnly: true,
      editableMeta: true,
      defaultTitle: 'Most FaceTime Calls',
      defaultAmount: '$35',
      emoji: '🏅',
      statPlaceholder: 'e.g. 12 FaceTime calls',
      compute: () => null,
    },
  },
];

function parseOverridesSheet(rows) {
  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const [monthKey, incentiveKey, winnerName, , statText] = rows[i];
    if (!monthKey || !incentiveKey || !winnerName) continue;
    map.set(`${monthKey}:${incentiveKey}`, { winnerName: winnerName.trim(), statText: (statText || '').trim() });
  }
  return map;
}

let overridesUnlocked = false;
let currentIncentiveMembers = [];
let currentIncentiveMonthKey = null;
let overridesMap = new Map();
// FaceTime title/amount live in the NEW sheet's Overrides tab (Table='Incentive'),
// written via the data-overrides web app — a path we fully control and can verify.
// Keyed `${monthKey}:${incentiveKey}:${field}` -> value.
let incentiveMetaMap = new Map();

async function postIncentiveMeta(monthKey, incentiveKey, field, value) {
  return postDataOverride(monthKey, 'Incentive', incentiveKey, field, value || '', '');
}
const overridePostTimers = new Map();

// Debounce writes per (month:incentive[:field]) so rapid edits send one request,
// not a race that can duplicate rows in the sheet backend.
function scheduleOverridePost(timerKey, fn) {
  clearTimeout(overridePostTimers.get(timerKey));
  overridePostTimers.set(timerKey, setTimeout(async () => {
    try { await fn(); } catch (err) { console.error('Failed to save override', err); }
  }, 800));
}

// The card's legacy definition applies to months that saved a custom award under its old key —
// unless that saved award is this same incentive (managers set "Lowest Closing Time" by hand
// in October 2026 before it was computed).
function incentiveDefFor(def, monthKey) {
  if (!def.legacy) return def;
  const prefix = `${monthKey}:${def.legacy.key}:`;
  const saved = [...incentiveMetaMap.keys()].filter((k) => k.startsWith(prefix));
  if (!saved.length) return def;
  const title = String(incentiveMetaMap.get(`${prefix}title`) || '').trim().toLowerCase();
  return title === def.title.toLowerCase() ? def : def.legacy;
}

function renderIncentives(members, monthKey) {
  currentIncentiveMembers = members;
  currentIncentiveMonthKey = monthKey;

  INCENTIVE_DEFS.forEach((baseDef) => {
    const card = document.querySelector(`[data-incentive="${baseDef.key}"]`);
    if (!card) return;
    const def = incentiveDefFor(baseDef, monthKey);
    if (!def.editableMeta && def.title) {
      // Fixed card text (the legacy custom award may have changed it for another month).
      card.querySelector('.incentive-title').textContent = def.title;
      card.querySelector('.incentive-amount').textContent = def.amount;
    }
    if (def.emoji) card.querySelector('.incentive-emoji').textContent = def.emoji;
    const nameEl = card.querySelector('.incentive-winner');
    const statEl = card.querySelector('.incentive-stat');
    const tiedEl = card.querySelector('.incentive-tied');

    const winnersOv = incentiveMetaMap.get(`${monthKey}:${def.key}:winners`);
    const noteOv = incentiveMetaMap.get(`${monthKey}:${def.key}:note`);
    const winners = winnersOv
      ? winnersOv.split(',').map((s) => s.trim()).filter(Boolean) : [];

    // Editable title + $ amount (FaceTime): apply overrides, else fall back to defaults.
    if (def.editableMeta) {
      const titleOv = incentiveMetaMap.get(`${monthKey}:${def.key}:title`);
      const amountOv = incentiveMetaMap.get(`${monthKey}:${def.key}:amount`);
      const titleElm = card.querySelector('.incentive-title');
      const amountElm = card.querySelector('.incentive-amount');
      if (titleElm) titleElm.textContent = titleOv || def.defaultTitle || titleElm.textContent;
      if (amountElm) amountElm.textContent = amountOv || def.defaultAmount || amountElm.textContent;
    }

    let displayName = null;
    let displayStat = null;
    let tiedWith = [];
    let tiedStatLabel = '';

    if (winners.length) {
      displayName = winners.join(', ');
      if (noteOv) displayStat = noteOv;
      else if (!def.manualOnly && winners.length === 1) {
        const m = members.find((x) => x.name === winners[0]);
        displayStat = m ? def.displayStat(m) : '–';
      } else displayStat = '–';
    } else if (!def.manualOnly) {
      const result = def.compute(members);
      if (result) {
        displayName = result.name;
        displayStat = def.displayStat(result.member);
        tiedWith = result.tiedWith || [];
        tiedStatLabel = result.tiedStatLabel || '';
      }
    }

    if (nameEl) nameEl.textContent = displayName || 'No winner yet';
    if (statEl) statEl.textContent = displayStat || '–';
    if (tiedEl) {
      const hasTie = tiedWith.length > 0;
      tiedEl.textContent = hasTie ? `🤝 Also tied at ${tiedStatLabel}: ${tiedWith.join(', ')}` : '';
      tiedEl.hidden = !hasTie;
    }
    card.classList.toggle('is-empty', !displayName);

    renderOverrideControl(card, def, members, monthKey);
  });
}

function renderOverrideControl(card, def, members, monthKey) {
  let wrap = card.querySelector('.incentive-override-wrap');
  if (!overridesUnlocked) {
    if (wrap) wrap.remove();
    return;
  }
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'incentive-override-wrap';
    card.appendChild(wrap);
  }
  wrap.innerHTML = '';

  // Editable title + $ amount (FaceTime only).
  let titleInput = null, amountInput = null;
  if (def.editableMeta) {
    const titleOv = incentiveMetaMap.get(`${monthKey}:${def.key}:title`);
    const amountOv = incentiveMetaMap.get(`${monthKey}:${def.key}:amount`);
    titleInput = document.createElement('input');
    titleInput.type = 'text'; titleInput.className = 'incentive-override-stat-input';
    titleInput.placeholder = 'Incentive title';
    titleInput.value = titleOv || def.defaultTitle || '';
    amountInput = document.createElement('input');
    amountInput.type = 'text'; amountInput.className = 'incentive-override-stat-input';
    amountInput.placeholder = 'Amount (e.g. $50)';
    amountInput.value = amountOv || def.defaultAmount || '';
    wrap.appendChild(titleInput);
    wrap.appendChild(amountInput);
  }

  // Multi-select winners (checkboxes).
  const winnersOv = incentiveMetaMap.get(`${monthKey}:${def.key}:winners`);
  const selected = new Set(
    (winnersOv ? winnersOv.split(',') : []).map((s) => s.trim()).filter(Boolean),
  );
  const box = document.createElement('div');
  box.className = 'incentive-winner-checks';
  box.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:4px 0;';
  members.forEach((m) => {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = m.name; cb.checked = selected.has(m.name);
    lbl.appendChild(cb); lbl.appendChild(document.createTextNode(m.name));
    box.appendChild(lbl);
  });
  wrap.appendChild(box);

  // Optional stat note (shown under the winners).
  const statInput = document.createElement('input');
  statInput.type = 'text'; statInput.className = 'incentive-override-stat-input';
  statInput.placeholder = def.statPlaceholder || 'Optional note (shown under winners)';
  statInput.value = incentiveMetaMap.get(`${monthKey}:${def.key}:note`) || '';
  wrap.appendChild(statInput);

  const commit = () => {
    const winnersStr = [...box.querySelectorAll('input:checked')].map((cb) => cb.value).join(', ');
    const stat = statInput.value.trim();
    const key = `${monthKey}:${def.key}`;
    const wkey = `${key}:winners`, nkey = `${key}:note`;
    if (winnersStr) incentiveMetaMap.set(wkey, winnersStr); else incentiveMetaMap.delete(wkey);
    if (stat) incentiveMetaMap.set(nkey, stat); else incentiveMetaMap.delete(nkey);

    let tPost = '', aPost = '';
    if (def.editableMeta) {
      const titleVal = titleInput.value.trim();
      const amountVal = amountInput.value.trim();
      tPost = (titleVal && titleVal !== def.defaultTitle) ? titleVal : '';
      aPost = (amountVal && amountVal !== def.defaultAmount) ? amountVal : '';
      const tkey = `${key}:title`, akey = `${key}:amount`;
      if (tPost) incentiveMetaMap.set(tkey, tPost); else incentiveMetaMap.delete(tkey);
      if (aPost) incentiveMetaMap.set(akey, aPost); else incentiveMetaMap.delete(akey);
    }

    renderIncentives(currentIncentiveMembers, currentIncentiveMonthKey);

    scheduleOverridePost(wkey, () => postIncentiveMeta(monthKey, def.key, 'winners', winnersStr));
    scheduleOverridePost(nkey, () => postIncentiveMeta(monthKey, def.key, 'note', stat));
    if (def.editableMeta) {
      scheduleOverridePost(`${key}:title`, () => postIncentiveMeta(monthKey, def.key, 'title', tPost));
      scheduleOverridePost(`${key}:amount`, () => postIncentiveMeta(monthKey, def.key, 'amount', aPost));
    }
  };

  box.addEventListener('change', commit);
  [statInput, titleInput, amountInput].forEach((inp) => {
    if (!inp) return;
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  });
}

const CORNER_UNLOCK_WINDOW_MS = 4000;
let cornerClickState = { corners: new Set(), firstClickAt: 0 };

function isManager() {
  return !!AUTH.email && MANAGER_EMAILS.map((e) => e.toLowerCase()).includes(AUTH.email.toLowerCase());
}

function setManagerMode(on) {
  overridesUnlocked = on;
  try { sessionStorage.setItem('cs-manager-mode', on ? 'on' : 'off'); } catch (e) {}
  updateManagerToggleUI();
  try { renderIncentives(currentIncentiveMembers, currentIncentiveMonthKey); } catch (e) {}
  try { renderMonthlyLeaderboard(currentIncentiveMembers); } catch (e) {}
  try { if (currentMonthName) renderManualSection(currentMonthName); } catch (e) {}
  try { renderResources(); } catch (e) {}
  try { updateScorecardsButton(); } catch (e) {}
  try { updateAssignButton(); } catch (e) {}
  try { renderExclEntries(); if (CSM.data) renderCsm(); } catch (e) {}
  const badge = document.getElementById('manager-mode-badge');
  if (on) showManagerBadge(); else if (badge) badge.remove();
}

function updateManagerToggleUI() {
  const btn = document.getElementById('manager-toggle');
  if (!btn) return;
  btn.textContent = overridesUnlocked ? '🔓 Manager mode: ON' : '🔒 Manager mode';
  btn.setAttribute('aria-pressed', overridesUnlocked ? 'true' : 'false');
  btn.classList.toggle('on', overridesUnlocked);
}

function showManagerBadge() {
  if (document.getElementById('manager-mode-badge')) return;
  const b = document.createElement('div');
  b.id = 'manager-mode-badge';
  b.textContent = '🔓 Manager mode — click a leaderboard value or a manual metric to edit';
  Object.assign(b.style, { position: 'fixed', bottom: '14px', right: '14px', zIndex: 1001,
    background: '#233043', color: '#fff', padding: '9px 16px', borderRadius: '999px',
    font: '600 14px Barlow, system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,.3)' });
  document.body.appendChild(b);
}

// Shows a Manager-mode toggle ONLY for allowlisted signed-in users (MANAGER_EMAILS).
// Replaces the old hidden corner/keyboard gesture. State persists per tab so a
// save-triggered reload stays in manager mode.
function setupManagerToggle() {
  if (!isManager()) return;
  if (!document.getElementById('manager-toggle')) {
    const btn = document.createElement('button');
    btn.id = 'manager-toggle';
    btn.className = 'mgr-btn';
    btn.addEventListener('click', () => setManagerMode(!overridesUnlocked));
    const bar = document.querySelector('.topbar-actions');
    if (bar) bar.insertBefore(btn, document.getElementById('userChip')); else document.body.appendChild(btn);
  }
  let restore = false;
  try { restore = sessionStorage.getItem('cs-manager-mode') === 'on'; } catch (e) {}
  setManagerMode(restore);
}

let currentMonthName = null;
let PARSED_BY_MONTH = {};   // month name (lowercase) -> parsed, for month-over-month deltas

// Manager corrections. The web app checks the viewer's Google sign-in and that
// they're a manager; a failed save is shown instead of silently dropped.
async function postDataOverride(month, table, rep, column, value, note) {
  try {
    const res = await fetch(DATA_OVERRIDES_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: AUTH.token, month, table, rep, column, value, note }),
    });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'Save failed');
    return out;
  } catch (e) {
    if (isSessionError(e)) showSessionBanner(true);
    showSaveError(e.message);
    return { ok: false, error: e.message };
  }
}

function showSaveError(msg) {
  let t = document.getElementById('saveToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'saveToast';
    t.className = 'save-toast';
    t.setAttribute('role', 'alert');
    document.body.appendChild(t);
  }
  t.textContent = 'Couldn’t save: ' + msg;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.remove(), 6000);
}

function closeCellEditor() {
  const ex = document.getElementById('cell-override-editor');
  if (ex) {
    if (ex._outside) document.removeEventListener('mousedown', ex._outside);
    ex.remove();
  }
}

function openCellEditor(member, col, td) {
  if (!DATA_OVERRIDES_WEBAPP_URL) { alert('Manager edits aren’t wired up yet — deploy the data-overrides web app and set DATA_OVERRIDES_WEBAPP_URL.'); return; }
  closeCellEditor();
  const month = fullMonthLabel(currentMonthName);
  const sheetCol = (REPORT.keyToSheetCol || {})[col.key] || col.label;
  const pop = document.createElement('div');
  pop.id = 'cell-override-editor';
  pop.innerHTML =
    `<div class="coe-title">${esc(member.name)} · ${esc(col.label)} <span class="coe-sub">${esc(month)}</span></div>` +
    `<div class="coe-row"><select id="coe-mode"><option value="adjust">Adjust by</option><option value="set">Set to</option></select>` +
    `<input id="coe-value" type="text" placeholder="-1" /></div>` +
    `<input id="coe-note" type="text" placeholder="Reason (e.g. 1 excused by manager)" />` +
    `<div class="coe-actions"><button id="coe-save">Save</button><button id="coe-clear" title="Remove override for this cell">Clear</button><button id="coe-cancel">Cancel</button></div>` +
    `<div class="coe-hint">“Adjust by” keeps new data accruing (recommended). “Set to” pins an exact value.</div>`;
  Object.assign(pop.style, { position: 'fixed', zIndex: 1000, background: 'var(--card, #fff)', color: 'inherit',
    border: '1px solid rgba(128,128,128,.35)', borderRadius: '10px', padding: '12px', width: '288px',
    boxShadow: '0 8px 30px rgba(0,0,0,.25)', font: '400 14px Barlow, system-ui, sans-serif' });
  document.body.appendChild(pop);
  const r = td.getBoundingClientRect();
  pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 210)}px`;
  pop.style.left = `${Math.min(r.left, window.innerWidth - 300)}px`;
  pop.querySelectorAll('button').forEach((b) => Object.assign(b.style, { marginRight: '6px', padding: '5px 10px', borderRadius: '7px', cursor: 'pointer', border: '1px solid rgba(128,128,128,.35)' }));
  pop.querySelectorAll('input,select').forEach((el) => Object.assign(el.style, { padding: '5px 7px', borderRadius: '7px', border: '1px solid rgba(128,128,128,.35)', margin: '4px 4px 4px 0', maxWidth: '100%' }));
  const valEl = pop.querySelector('#coe-value');
  valEl.focus();
  const submit = async (rawValue) => {
    const mode = pop.querySelector('#coe-mode').value;
    const note = pop.querySelector('#coe-note').value.trim();
    let value = rawValue;
    if (value !== '' && mode === 'adjust' && !/^[+-]/.test(value)) value = (parseFloat(value) >= 0 ? '+' : '') + value;
    pop.querySelector('#coe-save').textContent = 'Saving…';
    try {
      const out = await postDataOverride(month, 'Teammates', member.name, sheetCol, value, note);
      if (out && out.ok === false) throw new Error(out.error || 'save failed');
      pop.querySelector('#coe-save').textContent = 'Saved ✓';
      await new Promise((r) => setTimeout(r, 1200));   // let the write commit before re-reading
      await refreshSupport();
      closeCellEditor();
    } catch (err) {
      alert('Could not save override: ' + err.message);
      pop.querySelector('#coe-save').textContent = 'Save';
    }
  };
  pop.querySelector('#coe-save').addEventListener('click', () => submit(valEl.value.trim()));
  pop.querySelector('#coe-clear').addEventListener('click', () => submit(''));
  pop.querySelector('#coe-cancel').addEventListener('click', closeCellEditor);
  valEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(valEl.value.trim()); if (e.key === 'Escape') closeCellEditor(); });
  // Close when clicking anywhere outside the editor (deferred so this opening click doesn't trigger it).
  const outside = (e) => { if (!pop.contains(e.target)) closeCellEditor(); };
  pop._outside = outside;
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
}

function createLeaderboardRenderer(tableId, editable) {
  const sortState = { key: null, dir: 1 };

  return function renderLeaderboard(members) {
    const thead = document.querySelector(`#${tableId} thead`);
    const tbody = document.querySelector(`#${tableId} tbody`);
    const columns = [{ key: 'name', label: 'Name' }, ...LEADERBOARD_COLUMNS];

    thead.innerHTML = '';
    const headRow = document.createElement('tr');
    columns.forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.dataset.key = col.key;
      if (sortState.key === col.key) {
        th.classList.add('sorted');
        if (sortState.dir === -1) th.classList.add('asc');
      }
      th.addEventListener('click', () => {
        if (sortState.key === col.key) sortState.dir *= -1;
        else { sortState.key = col.key; sortState.dir = 1; }
        renderLeaderboard(members);
      });
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    let rows = [...members];
    if (sortState.key) {
      rows.sort((a, b) => {
        const av = sortValue(a[sortState.key]);
        const bv = sortValue(b[sortState.key]);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'string' || typeof bv === 'string') {
          return String(av).localeCompare(String(bv)) * sortState.dir;
        }
        return (av - bv) * sortState.dir;
      });
    }

    let fastestName = null;
    let fastestTime = Infinity;
    members.forEach((m) => {
      const secs = parseTimeToSeconds(m.avgRespTime);
      if (secs != null && secs < fastestTime) { fastestTime = secs; fastestName = m.name; }
    });

    tbody.innerHTML = '';
    rows.forEach((m) => {
      const tr = document.createElement('tr');
      columns.forEach((col) => {
        const td = document.createElement('td');
        if (col.key === 'name') {
          td.textContent = m.name;
          if (m.name === fastestName) {
            const crown = document.createElement('span');
            crown.className = 'crown';
            crown.textContent = '👑';
            crown.title = `${m.name} has the fastest average response time this period!`;
            td.appendChild(crown);
          }
        } else {
          const v = m[col.key];
          td.textContent = v && v !== '' ? v : '–';
          if (editable && overridesUnlocked && DATA_OVERRIDES_WEBAPP_URL) {
            td.style.cursor = 'pointer';
            td.title = 'Manager: click to adjust';
            td.style.outline = '1px dashed rgba(128,128,128,.4)';
            td.addEventListener('click', (e) => { e.stopPropagation(); openCellEditor(m, col, td); });
          }
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  };
}

const renderMonthlyLeaderboard = createLeaderboardRenderer('leaderboard', true);
const renderQuarterlyLeaderboard = createLeaderboardRenderer('quarterly-leaderboard', false);

/* ==========================================================================
   Monthly sections — headline tiles (closing time + CSAT), Fin, conversation
   volume, phones, and manually entered metrics. All read Data - Monthly (plus
   Data - Teammates for CSAT and Data - Categories for channels) for one month.
   ========================================================================== */
const colNum = (col) => (mk) => toNumber(mval(mk, col));
const colDur = (col) => (mk) => parseTimeToSeconds(mval(mk, col));

function fmtDur(sec) {
  if (sec == null) return null;
  sec = Math.round(sec);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${s}s` : `${s}s`;
}
const fmtKind = (kind, n) => (kind === 'dur' ? fmtDur(n) : kind === 'pct' ? fmtPct(n) : fmtNum(n));

// Teammate CSAT, raw vs revised. Raw = Σ positive / Σ all ratings. Revised uses each rep's
// "Adjusted Teammate CSAT" % (Reviewd CSAT): Intercom drops excused/rebutted ratings, so the
// rep's revised total = positives / adjusted %, and the difference is the excluded count.
function csatBreakdown(mk) {
  let pos = 0, raw = 0, revised = 0, any = false;
  (REPORT.teammates.get(mk) || []).forEach((m) => {
    const c = toNumber(m.csat);
    if (c == null) return;
    any = true;
    const total = c + (toNumber(m.dsat) || 0);
    const adj = toNumber(m.reviewedPct);
    const revTotal = adj && adj > 0 ? Math.min(total, Math.round(c / (adj / 100))) : total;
    pos += c; raw += total; revised += revTotal;
  });
  if (!any || !raw) return null;
  return { pos, raw, excluded: raw - revised, rawPct: (pos / raw) * 100, revPct: revised ? (pos / revised) * 100 : null };
}

const TOP_DEFS = [
  { label: 'Closing Time', icon: '🏁', slot: 1, kind: 'dur', goodDir: 'down', hero: true,
    get: colDur('Avg Assign to Close'), sub: () => 'Avg time from assignment to close' },
  { label: 'Teammate CSAT · Raw', icon: '⭐', slot: 3, kind: 'pct', goodDir: 'up',
    get: (mk) => { const b = csatBreakdown(mk); return b ? b.rawPct : null; },
    sub: (mk) => { const b = csatBreakdown(mk); return b ? `${b.pos} of ${b.raw} ratings positive` : null; } },
  { label: 'Teammate CSAT · Revised', icon: '✅', slot: 3, kind: 'pct', goodDir: 'up',
    get: (mk) => { const b = csatBreakdown(mk); return b ? b.revPct : null; },
    sub: (mk) => { const b = csatBreakdown(mk); return b ? `${b.excluded} rating${b.excluded === 1 ? '' : 's'} excluded` : null; } },
  { label: 'Fin CSAT', icon: '🤖', slot: 6, kind: 'pct', goodDir: 'up',
    get: colNum('AI CSAT Score'),
    sub: (mk) => { const n = toNumber(mval(mk, 'AI Total CSAT')); return n != null ? `${fmtNum(n)} ratings` : null; } },
  { label: 'Avg Response Time', icon: '⏱️', slot: 4, kind: 'dur', goodDir: 'down', get: colDur('Avg Response Time') },
];

const FIN_DEFS = [
  { label: 'Resolved', icon: '✅', slot: 3, kind: 'count', goodDir: 'up', get: colNum('AI Resolved') },
  { label: 'Unresolved', icon: '↩️', slot: 8, kind: 'count', goodDir: 'down', get: colNum('AI Unresolved') },
  { label: 'Resolution Rate', icon: '🎯', slot: 6, kind: 'pct', goodDir: 'up', get: colNum('AI Resolution Rate') },
  { label: 'Routed to Teammate', icon: '🙋', slot: 1, kind: 'pct', goodDir: 'down', get: colNum('AI Routed to Teammate') },
  { label: 'Abandonment Rate', icon: '🚪', slot: 5, kind: 'pct', goodDir: 'down', get: colNum('AI Abandonment Rate') },
  { label: 'Deflection Rate', icon: '🛡️', slot: 2, kind: 'pct', goodDir: 'up', get: colNum('AI Deflection Rate') },
];

const PHONE_DEFS = [
  { label: 'Total Calls', icon: '☎️', slot: 1, kind: 'count', goodDir: 'up', get: colNum('Total Calls') },
  { label: 'Inbound', icon: '📥', slot: 2, kind: 'count', goodDir: 'up', get: colNum('Inbound Calls') },
  { label: 'Outbound', icon: '📤', slot: 4, kind: 'count', goodDir: 'up', get: colNum('Outbound Calls') },
  { label: 'Answer Rate', icon: '📞', slot: 3, kind: 'pct', goodDir: 'up', get: colNum('Phone Answer Rate') },
  { label: 'Outside Business Hours', icon: '🌙', slot: 6, kind: 'pct', goodDir: 'down', get: colNum('Calls Outside Business Hours') },
  { label: 'Avg Talk Time', icon: '🎧', slot: 7, kind: 'dur', get: colDur('Avg Call Talk Time') },
];

// Entered by managers (stored as Monthly rows on the Overrides tab, applied live at read time).
const MANUAL_DEFS = [
  { label: 'Office Hours Sessions', icon: '🗓️', slot: 1, kind: 'count', goodDir: 'up', col: 'OH Total Sessions' },
  { label: 'Office Hours Attendees', icon: '👥', slot: 2, kind: 'count', goodDir: 'up', col: 'OH Total Attendees' },
  { label: 'Office Hours Avg Duration', icon: '⏳', slot: 4, kind: 'dur', col: 'OH Avg Duration' },
  { label: 'Wednesday Workshop Attendance', icon: '🛠️', slot: 5, kind: 'count', goodDir: 'up', col: 'Wednesday Workshop Attendance' },
  { label: 'CS Training Sessions', icon: '🎓', slot: 6, kind: 'count', goodDir: 'up', col: 'CS Training Sessions' },
  { label: 'Help Article Views', icon: '📚', slot: 3, kind: 'count', goodDir: 'up', col: 'Total Article Views' },
].map((d) => ({ ...d, get: d.kind === 'dur' ? colDur(d.col) : colNum(d.col) }));

const prevMonthKey = (monthName) => {
  const i = MONTH_NAMES.indexOf(monthName);
  return i > 0 ? MONTH_NAMES[i - 1].toLowerCase() : null;
};

// Month-over-month deltas; count metrics skip the delta on the in-progress month
// (a partial month vs a full one would always read as a big drop).
function statTiles(defs, monthName) {
  const mk = monthName.toLowerCase();
  const prevMk = prevMonthKey(monthName);
  const inProgress = MONTH_NAMES.indexOf(monthName) === incompleteMonthIndex();
  return defs.map((d) => {
    const cur = d.get(mk);
    let delta = null;
    if (prevMk && d.goodDir && !(inProgress && d.kind === 'count')) {
      const prev = d.get(prevMk);
      if (cur != null && prev != null && prev !== 0) {
        const pct = ((cur - prev) / Math.abs(prev)) * 100;
        delta = { pct, good: d.goodDir === 'down' ? pct < 0 : pct > 0 };
      }
    }
    return { label: d.label, icon: d.icon, slot: d.slot, value: fmtKind(d.kind, cur), delta, sub: d.sub ? d.sub(mk) : null, hero: d.hero };
  });
}

// One stacked bar + legend. parts: [{ label, value, color }]; fmt formats each value.
function splitBarHtml(title, parts, fmt) {
  const total = parts.reduce((s, p) => s + (p.value || 0), 0);
  if (!total) return '';
  const segs = parts.filter((p) => p.value > 0)
    .map((p) => `<span style="width:${(p.value / total) * 100}%;background:${p.color}" title="${esc(p.label)}"></span>`).join('');
  const legend = parts.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${esc(fmt(p.value, total))}</b></span>`).join('');
  return `<div class="split"><div class="split-head">${esc(title)}</div><div class="split-bar">${segs}</div><div class="split-legend">${legend}</div></div>`;
}
const pctOf = (v, total) => `${Math.round((v / total) * 100)}%`;

function renderFinSplits(mk) {
  const el = document.getElementById('fin-splits');
  const confirmed = toNumber(mval(mk, 'AI Confirmed Resolution Rate'));
  const assumed = toNumber(mval(mk, 'AI Assumed Resolution Rate'));
  const resolved = toNumber(mval(mk, 'AI Resolved'));
  const unresolved = toNumber(mval(mk, 'AI Unresolved'));
  const html = splitBarHtml('Resolved vs. unresolved', [
    { label: 'Resolved', value: resolved, color: 'var(--slot-3)' },
    { label: 'Unresolved', value: unresolved, color: 'var(--slot-8)' },
  ], (v, t) => `${fmtNum(v)} (${pctOf(v, t)})`) + splitBarHtml('How Fin’s resolutions were confirmed', [
    { label: 'Confirmed', value: confirmed, color: 'var(--slot-6)' },
    { label: 'Assumed', value: assumed, color: 'color-mix(in srgb, var(--slot-6) 45%, transparent)' },
  ], (v) => fmtPct(v));
  el.innerHTML = html;
  el.hidden = !html;
}

const CHANNEL_ORDER = ['Email', 'Chat', 'Phone', 'SMS'];
const CHANNEL_COLORS = { Email: '--slot-1', Chat: '--slot-2', Phone: '--slot-3', SMS: '--slot-6' };

function renderChannels(mk) {
  const el = document.getElementById('channel-panel');
  const rows = (((REPORT.categories.get(mk) || new Map()).get('Channel')) || [])
    .map((r) => ({ label: r.cat, value: toNumber(r.val) || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => {
      const ia = CHANNEL_ORDER.indexOf(a.label), ib = CHANNEL_ORDER.indexOf(b.label);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.value - a.value;
    });
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) { el.innerHTML = '<div class="empty-note">No channel breakdown recorded for this month.</div>'; return; }
  const max = Math.max(...rows.map((r) => r.value));
  el.innerHTML = `<div class="chan-total"><span>Conversations by channel</span><b>${fmtNum(total)}</b></div>`
    + rows.map((r) => `<div class="chan-row"><span class="chan-label">${esc(r.label)}</span>`
      + `<span class="chan-track"><span class="chan-fill" style="width:${(r.value / max) * 100}%;background:var(${CHANNEL_COLORS[r.label] || '--slot-8'})"></span></span>`
      + `<span class="chan-val">${fmtNum(r.value)}<small>${pctOf(r.value, total)}</small></span></div>`).join('');
}

function renderPhoneSplit(mk) {
  const el = document.getElementById('phone-split');
  const html = splitBarHtml('Inbound vs. outbound', [
    { label: 'Inbound', value: toNumber(mval(mk, 'Inbound Calls')), color: 'var(--slot-2)' },
    { label: 'Outbound', value: toNumber(mval(mk, 'Outbound Calls')), color: 'var(--slot-4)' },
  ], (v, t) => `${fmtNum(v)} (${pctOf(v, t)})`);
  el.innerHTML = html;
  el.hidden = !html;
}

// Phones, per rep: from the same teammate rows as the leaderboard (manager overrides applied).
const PHONE_REP_COLS = [
  { key: 'name', label: 'Rep' },
  { key: 'totalCalls', label: 'Total Calls' },
  { key: 'answered', label: 'Answered' },
  { key: 'missedCalls', label: 'Missed' },
  { key: 'declinedCalls', label: 'Declined' },
  { key: 'phoneAnswerRate', label: 'Answer Rate' },
  { key: 'supportCalls', label: 'Support Calls' },
];
const phoneRepSort = { key: 'totalCalls', dir: -1 };

function renderPhoneReps(people) {
  const table = document.getElementById('phone-reps');
  if (!table) return;
  const rows = (people || []).map((m) => {
    const total = toNumber(m.totalCalls);
    const against = (toNumber(m.missedCalls) || 0) + (toNumber(m.declinedCalls) || 0);
    return { ...m, answered: total == null ? null : String(Math.max(0, total - against)) };
  }).filter((m) => toNumber(m.totalCalls) || toNumber(m.supportCalls));

  const head = document.createElement('tr');
  PHONE_REP_COLS.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (phoneRepSort.key === c.key) th.classList.add('sorted', ...(phoneRepSort.dir === 1 ? ['asc'] : []));
    th.addEventListener('click', () => {
      if (phoneRepSort.key === c.key) phoneRepSort.dir *= -1;
      else { phoneRepSort.key = c.key; phoneRepSort.dir = c.key === 'name' ? 1 : -1; }
      renderPhoneReps(people);
    });
    head.appendChild(th);
  });
  table.querySelector('thead').replaceChildren(head);
  if (!rows.length) {
    table.querySelector('tbody').innerHTML = `<tr><td colspan="${PHONE_REP_COLS.length}">No phone activity by rep this month.</td></tr>`;
    return;
  }
  const { key, dir } = phoneRepSort;
  rows.sort((a, b) => {
    const av = sortValue(a[key]), bv = sortValue(b[key]);
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
    return (av - bv) * dir || a.name.localeCompare(b.name);
  });
  table.querySelector('tbody').innerHTML = rows.map((m) => `<tr>${PHONE_REP_COLS.map((c) => {
    const v = m[c.key];
    return `<td>${esc(v != null && String(v).trim() !== '' ? v : '–')}</td>`;
  }).join('')}</tr>`).join('');
}

function renderManualSection(monthName) {
  const tiles = statTiles(MANUAL_DEFS, monthName);
  if (overridesUnlocked && DATA_OVERRIDES_WEBAPP_URL) {
    tiles.forEach((t, i) => {
      t.onEdit = (el) => openManualEditor(MANUAL_DEFS[i], el);
      if (t.value == null) t.sub = 'Click to enter';
    });
  }
  renderTiles('manual-tiles', tiles);
}

function renderMonthSections(monthName) {
  const mk = monthName.toLowerCase();
  renderTiles('tiles', statTiles(TOP_DEFS, monthName));
  renderTiles('fin-tiles', statTiles(FIN_DEFS, monthName));
  renderFinSplits(mk);
  renderChannels(mk);
  renderTiles('phone-tiles', statTiles(PHONE_DEFS, monthName));
  renderPhoneSplit(mk);
  renderManualSection(monthName);
}

// Manager editor for a manual metric: writes an absolute Monthly override for the month.
function openManualEditor(def, anchor) {
  closeCellEditor();
  const month = fullMonthLabel(currentMonthName);
  const current = mval(currentMonthName.toLowerCase(), def.col);
  const pop = document.createElement('div');
  pop.id = 'cell-override-editor';
  pop.innerHTML =
    `<div class="coe-title">${esc(def.label)} <span class="coe-sub">${esc(month)}</span></div>` +
    `<input id="coe-value" type="text" placeholder="${def.kind === 'dur' ? 'e.g. 1h 30m' : 'e.g. 12'}" value="${esc(current)}" />` +
    `<input id="coe-note" type="text" placeholder="Note (optional)" />` +
    `<div class="coe-actions"><button id="coe-save">Save</button><button id="coe-clear" title="Remove the entered value">Clear</button><button id="coe-cancel">Cancel</button></div>`;
  Object.assign(pop.style, { position: 'fixed', zIndex: 1000, background: 'var(--surface-1, #fff)', color: 'inherit',
    border: '1px solid rgba(128,128,128,.35)', borderRadius: '10px', padding: '12px', width: '260px',
    boxShadow: '0 8px 30px rgba(0,0,0,.25)', font: '400 14px Barlow, system-ui, sans-serif' });
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 170)}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 272))}px`;
  pop.querySelectorAll('button').forEach((b) => Object.assign(b.style, { marginRight: '6px', padding: '5px 10px', borderRadius: '7px', cursor: 'pointer', border: '1px solid rgba(128,128,128,.35)' }));
  pop.querySelectorAll('input').forEach((el) => Object.assign(el.style, { padding: '5px 7px', borderRadius: '7px', border: '1px solid rgba(128,128,128,.35)', margin: '4px 0', width: '100%', boxSizing: 'border-box' }));
  const valEl = pop.querySelector('#coe-value');
  valEl.focus(); valEl.select();
  const submit = async (rawValue) => {
    // A leading +/- would be read as a delta by applyOverridesLive; manual metrics are absolute.
    const value = rawValue.replace(/^\+/, '');
    if (value && def.kind !== 'dur' && toNumber(value) == null) { alert('Please enter a number.'); return; }
    if (value && def.kind === 'dur' && parseTimeToSeconds(value) == null) { alert('Please enter a duration like 1h 30m or 1:30:00.'); return; }
    pop.querySelector('#coe-save').textContent = 'Saving…';
    try {
      await postDataOverride(month, 'Monthly', '', def.col, value, pop.querySelector('#coe-note').value.trim());
      pop.querySelector('#coe-save').textContent = 'Saved ✓';
      await new Promise((res) => setTimeout(res, 1200));   // let the write commit before re-reading
      await refreshSupport();
      closeCellEditor();
    } catch (err) {
      alert('Could not save: ' + err.message);
      pop.querySelector('#coe-save').textContent = 'Save';
    }
  };
  pop.querySelector('#coe-save').addEventListener('click', () => submit(valEl.value.trim()));
  pop.querySelector('#coe-clear').addEventListener('click', () => submit(''));
  pop.querySelector('#coe-cancel').addEventListener('click', closeCellEditor);
  valEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(valEl.value.trim()); if (e.key === 'Escape') closeCellEditor(); });
  const outside = (e) => { if (!pop.contains(e.target)) closeCellEditor(); };
  pop._outside = outside;
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
}

function renderMonth(entry) {
  currentMonthName = entry.name;
  const idx = MONTH_NAMES.indexOf(entry.name);
  const prevRaw = idx > 0 ? PARSED_BY_MONTH[MONTH_NAMES[idx - 1].toLowerCase()] : null;
  const prevParsed = prevRaw && prevRaw.hasData ? prevRaw : null;
  renderMonthSections(entry.name);
  const people = individualsOnly(entry.parsed.members, idx);
  renderMonthlyLeaderboard(people);
  renderPhoneReps(people);
  renderIncentives(people, entry.gid);
  updateMascot(people, entry.name);
}

function populateSelect(selectId, entries, selectedValue, valueKey, labelKey) {
  const select = document.getElementById(selectId);
  select.innerHTML = '';
  entries.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry[valueKey];
    opt.textContent = entry[labelKey];
    if (entry[valueKey] === selectedValue) opt.selected = true;
    select.appendChild(opt);
  });
}

const charts = {};
const chartBuddyEmoji = { up: ['🚀', '🎉', '🔥'], flat: ['😌', '👍'], down: ['😅', '💪'] };

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateChartBuddy(canvasId, data) {
  const buddy = document.querySelector(`[data-buddy-for="${canvasId}"]`);
  if (!buddy) return;
  const valid = data.filter((v) => v != null);
  if (valid.length < 2) { buddy.textContent = '🧐'; return; }
  const delta = valid[valid.length - 1] - valid[0];
  const magnitude = Math.abs(delta) / (Math.abs(valid[0]) || 1);
  let bucket = 'flat';
  if (magnitude > 0.03) bucket = delta > 0 ? 'up' : 'down';
  const choices = chartBuddyEmoji[bucket];
  buddy.textContent = choices[Math.floor(Math.random() * choices.length)];
  buddy.dataset.mood = bucket;
}

function drawLineChart(canvasId, labels, datasets, yOpts = {}) {
  const ctx = document.getElementById(canvasId);
  if (charts[canvasId]) charts[canvasId].destroy();
  const gridColor = cssVar('--border');
  const tickColor = cssVar('--faint');
  // Anchoring the y-axis at 0 (and at 100 for percentage metrics), rather than
  // letting Chart.js auto-fit tightly to the data's min/max, keeps normal
  // month-to-month wobble from reading as a dramatic swing.
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d) => ({
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: d.borderColor,
        pointBorderColor: cssVar('--surface'),
        pointBorderWidth: 2,
        backgroundColor: withAlpha(d.borderColor, 0.12),
        fill: datasets.length === 1,
        tension: 0.3,
        ...d,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      spanGaps: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { color: tickColor, boxWidth: 10, boxHeight: 10, usePointStyle: true },
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor } },
        y: {
          beginAtZero: true,
          min: yOpts.min ?? 0,
          max: yOpts.max,
          grid: { color: gridColor },
          ticks: { color: tickColor },
        },
      },
    },
  });
  updateChartBuddy(canvasId, datasets[0].data);
}

// Index of the current, still-in-progress month (0=Jan). -1 if the data is from
// a past year (then every month counts as complete). Used to keep incomplete
// months/quarters out of the trend charts.
function incompleteMonthIndex() {
  const now = new Date();
  let dataYear = null;
  for (const o of REPORT.monthly.values()) {
    const mm = String(o.Month || '').match(/(20\d\d)/);
    if (mm) { dataYear = +mm[1]; break; }
  }
  if (dataYear != null && dataYear !== now.getFullYear()) return -1;
  return now.getMonth();
}

function renderQoQTrends(series, quarters) {
  const inc = incompleteMonthIndex();
  const completeQ = QUARTER_NAMES.filter((q) => {
    const idxs = QUARTER_MONTH_INDEXES[q];
    const last = idxs[idxs.length - 1];
    return quarters[q] && quarters[q].hasData && (inc < 0 || last < inc);
  });
  const at = (label, i) => toNumber((series.get(label.toLowerCase()) || [])[i]);
  const sumMetric = (label, q) => {
    let s = 0, any = false;
    QUARTER_MONTH_INDEXES[q].forEach((i) => { const v = at(label, i); if (v != null) { s += v; any = true; } });
    return any ? s : null;
  };
  const avgMetric = (label, q) => {
    const vs = [];
    QUARTER_MONTH_INDEXES[q].forEach((i) => { const v = at(label, i); if (v != null) vs.push(v); });
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  // Weighted team CSAT for the quarter (Σ positives / Σ ratings), not a mean of monthly %s.
  const csatQ = (q) => {
    let pos = 0, tot = 0;
    (quarters[q]?.members || []).forEach((m) => { const c = toNumber(m.csat), d = toNumber(m.dsat); if (c != null) { pos += c; tot += c + (d || 0); } });
    return tot > 0 ? (pos / tot) * 100 : null;
  };
  drawLineChart('chart-qoq-conversations', completeQ, [
    { label: 'New Conversations', data: completeQ.map((q) => sumMetric('New Conversations', q)), borderColor: cssVar('--slot-1') },
  ]);
  drawLineChart('chart-qoq-answer-rate', completeQ, [
    { label: 'Answer Rate %', data: completeQ.map((q) => avgMetric('Answer Rate', q)), borderColor: cssVar('--slot-2') },
  ], { max: 100 });
  drawLineChart('chart-qoq-csat', completeQ, [
    { label: 'Team CSAT %', data: completeQ.map(csatQ), borderColor: cssVar('--slot-3') },
  ], { max: 100 });
  drawLineChart('chart-qoq-ai-resolution', completeQ, [
    { label: 'AI Resolution %', data: completeQ.map((q) => avgMetric('AI Resolution Rate', q)), borderColor: cssVar('--slot-5') },
  ], { max: 100 });
}

function renderTrends(series, monthlyTileValues) {
  const seriesFor = (label) => MONTH_NAMES.map((_, i) => toNumber((series.get(label.toLowerCase()) || [])[i]));
  const inc = incompleteMonthIndex();
  const mask = (arr) => (inc < 0 ? arr : arr.map((v, i) => (i >= inc ? null : v)));  // hide the in-progress month

  const newConv = mask(seriesFor('New Conversations'));
  const assigned = mask(seriesFor('Conversations Assigned'));
  const answerRate = mask(seriesFor('Answer Rate'));
  const csatPct = mask(seriesFor('CSAT%'));
  const aiResolution = mask(seriesFor('AI Resolution Rate'));
  const avgPerTeammate = mask(seriesFor('Avg Assigned Convers Per Team Member'));

  const trimmed = trimTrailingEmpty(MONTH_NAMES, [newConv, assigned, answerRate, csatPct, aiResolution, avgPerTeammate]);
  const [tNewConv, tAssigned, tAnswerRate, tCsatPct, tAiResolution, tAvgPerTeammate] = trimmed.arrays;

  drawLineChart('chart-conversations', trimmed.labels, [
    { label: 'New Conversations', data: tNewConv, borderColor: cssVar('--slot-1') },
    { label: 'Conversations Assigned', data: tAssigned, borderColor: cssVar('--slot-2') },
  ]);
  drawLineChart('chart-answer-rate', trimmed.labels, [
    { label: 'Answer Rate %', data: tAnswerRate, borderColor: cssVar('--slot-2') },
  ], { max: 100 });
  drawLineChart('chart-csat', trimmed.labels, [
    { label: 'CSAT %', data: tCsatPct, borderColor: cssVar('--slot-3') },
  ], { max: 100 });
  drawLineChart('chart-ai-resolution', trimmed.labels, [
    { label: 'AI Resolution Rate %', data: tAiResolution, borderColor: cssVar('--slot-5') },
  ], { max: 100 });
  drawLineChart('chart-avg-per-teammate', trimmed.labels, [
    { label: 'Avg Conversations / Teammate', data: tAvgPerTeammate, borderColor: cssVar('--slot-8') },
  ]);
}

const MASCOT_FACES = { great: '🦄', good: '🦉', meh: '🐢', rough: '🐌' };

function updateMascot(members, periodName) {
  const bubble = document.getElementById('mascot-bubble');
  const mascot = document.getElementById('mascot');
  if (!bubble || !mascot) return;

  let topName = null;
  let topCsat = -Infinity;
  const csatValues = [];
  members.forEach((m) => {
    const n = toNumber(m.csatPct);
    if (n != null) {
      csatValues.push(n);
      if (n > topCsat) { topCsat = n; topName = m.name; }
    }
  });

  if (!csatValues.length) {
    mascot.textContent = MASCOT_FACES.meh;
    bubble.textContent = `Waiting on the ${periodName} numbers to roll in... 👀`;
    return;
  }

  const avgCsat = csatValues.reduce((a, b) => a + b, 0) / csatValues.length;
  let face = MASCOT_FACES.good;
  let line = `${periodName} is looking solid! ${topName} is leading CSAT at ${topCsat}% 👑`;
  if (avgCsat >= 95) {
    face = MASCOT_FACES.great;
    line = `Whoa! ${periodName} CSAT is on fire 🔥 ${topName} is crushing it at ${topCsat}%!`;
  } else if (avgCsat < 85) {
    face = MASCOT_FACES.rough;
    line = `${periodName}'s a bit bumpy, but ${topName} is holding the line at ${topCsat}% CSAT 💪`;
  }
  mascot.textContent = face;
  bubble.textContent = line;
  mascot.classList.remove('bounce-once');
  requestAnimationFrame(() => mascot.classList.add('bounce-once'));
}

function launchConfetti() {
  const layer = document.getElementById('confetti-layer');
  if (!layer) return;
  const pieces = ['🎉', '✨', '🎊', '⭐', '💫'];
  for (let i = 0; i < 24; i++) {
    const span = document.createElement('span');
    span.className = 'confetti-piece';
    span.textContent = pieces[Math.floor(Math.random() * pieces.length)];
    span.style.left = `${Math.random() * 100}%`;
    span.style.animationDelay = `${Math.random() * 0.6}s`;
    span.style.animationDuration = `${2.2 + Math.random() * 1.2}s`;
    span.style.fontSize = `${14 + Math.random() * 14}px`;
    layer.appendChild(span);
    setTimeout(() => span.remove(), 4000);
  }
}

/* ======================= 🎉 THE CELEBRATION ======================= */
let _celebrating = false;
// Lawmatics palette: blue, cyan, orange, amber, plus a pop of pink/violet and white.
const CB_COLORS = ['#068bff', '#00cfdc', '#ff9011', '#ff612c', '#ffd23f', '#ff4fa3', '#8a6bff', '#ffffff'];
// Merlin's playdate parade — every scene of Merlin playing with a pet.
const CB_PLAYMATES = [
  'merlin-play-cat-feather', 'merlin-play-corgi-ball', 'merlin-play-pitbull-tug', 'merlin-play-kitten-wand',
  'merlin-play-pup-highfive', 'merlin-play-sphynx-ribbon', 'merlin-play-golden-fetch', 'merlin-play-stbernard-tug',
  'merlin-play-bluepit-tug', 'merlin-dog',
];
const CB_PHRASES = ['Team crushed it!', 'Support superstars!', 'Absolute legends!', 'Incredible work!', 'Let’s gooo!'];

function ensureCelebrateStyles() {
  if (document.getElementById('cb-styles')) return;
  const st = document.createElement('style');
  st.id = 'cb-styles';
  st.textContent = `
  @keyframes cbFall{0%{transform:translateY(-12vh) rotate(0)}100%{transform:translateY(115vh) rotate(720deg)}}
  @keyframes cbShoot{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--dr));opacity:0}}
  @keyframes cbFw{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--fx),var(--fy)) scale(.2);opacity:0}}
  @keyframes cbHero{0%{transform:translate(-50%,-50%) scale(0) rotate(-16deg);opacity:0}
    14%{transform:translate(-50%,-50%) scale(1.28) rotate(7deg);opacity:1}
    28%{transform:translate(-50%,-50%) scale(1) rotate(-3deg)}
    78%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(0)}
    100%{opacity:0;transform:translate(-50%,-50%) scale(1.5)}}
  @keyframes cbShake{10%,90%{transform:translate(-2px,1px)}20%,80%{transform:translate(5px,-2px)}30%,50%,70%{transform:translate(-7px,3px)}40%,60%{transform:translate(7px,-1px)}}
  @keyframes cbFlash{0%{opacity:0}50%{opacity:.30}100%{opacity:0}}
  @keyframes cbSpin{to{transform:rotate(360deg)}}
  #celebrateBtn:hover{transform:scale(1.06)}`;
  document.head.appendChild(st);
}

// 🔊 LOUD reggae/dancehall air horn — the classic "bip! bip! bwaaaap!" pull-up.
function celebrateSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = 0.95;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.25;
    master.connect(comp).connect(ctx.destination);

    // one horn blast: thick detuned saws + square, lowpassed, with vibrato and a pitch wail
    const blast = (t, dur, f0, f1, wail) => {
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800; lp.Q.value = 0.8;
      g.connect(lp).connect(master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.85, t + 0.015);      // punchy attack
      g.gain.setValueAtTime(0.85, Math.max(t + 0.02, t + dur - 0.06));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      [['sawtooth', 0], ['sawtooth', 8], ['square', -7]].forEach(([type, det]) => {
        const o = ctx.createOscillator(); o.type = type; o.detune.value = det;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.linearRampToValueAtTime(f1, t + (wail ? dur * 0.55 : 0.07));
        if (wail) o.frequency.linearRampToValueAtTime(f1 * 1.06, t + dur);
        const lfo = ctx.createOscillator(); lfo.frequency.value = wail ? 6.5 : 5;
        const lg = ctx.createGain(); lg.gain.value = wail ? 16 : 9;   // vibrato depth
        lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur);
        o.connect(g); o.start(t); o.stop(t + dur + 0.02);
      });
    };

    const n = ctx.currentTime + 0.02;
    blast(n,        0.17, 440, 510, false);   // bip!
    blast(n + 0.25, 0.17, 440, 510, false);   // bip!
    blast(n + 0.52, 1.05, 400, 640, true);    // bwaaaaap! (the pull-up wail)
    setTimeout(() => ctx.close(), 2400);
  } catch (e) { /* audio blocked — visuals still party */ }
}

function cbCannon(layer, originXvw) {
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('div');
    const size = 6 + Math.random() * 9;
    Object.assign(p.style, { position: 'absolute', bottom: '2vh', left: originXvw + 'vw',
      width: size + 'px', height: (size * 0.5) + 'px', background: CB_COLORS[(Math.random() * CB_COLORS.length) | 0], borderRadius: '2px' });
    const ang = (originXvw < 50 ? -62 : -118) * (Math.PI / 180) + (Math.random() - 0.5) * 1.4;
    const dist = 45 + Math.random() * 60;
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'vw');
    p.style.setProperty('--dy', (Math.sin(ang) * dist - 25 - Math.random() * 35) + 'vh');
    p.style.setProperty('--dr', (Math.random() * 1440 - 720) + 'deg');
    p.style.animation = `cbShoot ${1.6 + Math.random() * 1.4}s cubic-bezier(.15,.6,.3,1) ${Math.random() * 0.35}s forwards`;
    layer.appendChild(p);
  }
}

function cbFirework(layer, xvw, yvh) {
  for (let i = 0; i < 30; i++) {
    const d = document.createElement('div');
    const size = 5 + Math.random() * 5;
    const color = CB_COLORS[(Math.random() * CB_COLORS.length) | 0];
    Object.assign(d.style, { position: 'absolute', left: xvw + 'vw', top: yvh + 'vh', width: size + 'px', height: size + 'px',
      borderRadius: '50%', background: color, color, boxShadow: '0 0 10px currentColor' });
    const a = (i / 30) * Math.PI * 2, r = 9 + Math.random() * 11;
    d.style.setProperty('--fx', Math.cos(a) * r + 'vw');
    d.style.setProperty('--fy', Math.sin(a) * r + 'vh');
    d.style.animation = `cbFw ${0.9 + Math.random() * 0.6}s ease-out forwards`;
    layer.appendChild(d);
  }
}

// Gentle brand-colored confetti falling for the whole celebration.
function cbRain(layer, count, seconds) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const w = 6 + Math.random() * 7;
    Object.assign(p.style, { position: 'absolute', top: '-4vh', left: Math.random() * 100 + 'vw', width: w + 'px', height: (w * 0.45) + 'px',
      background: CB_COLORS[(Math.random() * CB_COLORS.length) | 0], borderRadius: '2px', opacity: '.9', zIndex: 1,
      animation: `cbFall ${3.5 + Math.random() * 3}s linear ${Math.random() * Math.max(0, seconds - 4)}s forwards` });
    layer.appendChild(p);
  }
}

function celebrate() {
  if (_celebrating) return;
  _celebrating = true;
  ensureCelebrateStyles();
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DURATION = reduced ? 5000 : 11500;

  const layer = document.createElement('div');
  layer.id = 'celebrate-layer';
  layer.className = 'cb-layer';
  layer.title = 'Click anywhere to close';
  document.body.appendChild(layer);

  // center stage: confetti Merlin + rotating headline
  const stage = document.createElement('div');
  stage.className = 'cb-stage';
  stage.innerHTML = '<img class="cb-star" src="assets/merlin-confetti.webp" alt="">'
    + '<div class="eyebrow cb-eyebrow">CS Support Team</div>'
    + '<div class="cb-headline"></div>'
    + '<div class="cb-sub">Merlin and friends are celebrating with you.</div>';
  layer.appendChild(stage);
  const headline = stage.querySelector('.cb-headline');
  const phrases = CB_PHRASES.slice().sort(() => Math.random() - 0.5);
  let pi = 0;
  const nextPhrase = () => {
    headline.textContent = phrases[pi++ % phrases.length];
    headline.classList.remove('pop'); void headline.offsetWidth; headline.classList.add('pop');
  };
  nextPhrase();
  const phraseTimer = setInterval(nextPhrase, 1900);

  // the parade: two lanes of Merlin playing with pets, hopping across the screen
  const mates = CB_PLAYMATES.slice().sort(() => Math.random() - 0.5);
  if (reduced) {
    const row = document.createElement('div');
    row.className = 'cb-static-row';
    row.innerHTML = mates.slice(0, 6).map((n) => `<img src="assets/${n}.webp" alt="">`).join('');
    layer.appendChild(row);
  } else {
    // Each lane loops continuously; negative delays spread the walkers out so the
    // screen is full of playmates from the very first frame.
    const narrow = window.innerWidth < 700;
    const LAP = narrow ? 7 : 9;   // seconds for one crossing
    const perLane = narrow ? 3 : 5;  // fewer walkers on phones so they don't pile up
    const lanes = { top: mates.filter((_, i) => i % 2 === 0).slice(0, perLane), bottom: mates.filter((_, i) => i % 2 === 1).slice(0, perLane) };
    Object.entries(lanes).forEach(([lane, names]) => {
      names.forEach((name, k) => {
        const walker = document.createElement('div');
        walker.className = `cb-walker cb-lane-${lane}`;
        walker.style.animationDuration = `${LAP}s`;
        walker.style.animationDelay = `${-(k * LAP / names.length + (lane === 'bottom' ? LAP / names.length / 2 : 0)).toFixed(2)}s`;
        walker.innerHTML = `<img src="assets/${name}.webp" alt="" style="animation-delay:${(Math.random() * 0.4).toFixed(2)}s">`;
        layer.appendChild(walker);
      });
    });
    cbRain(layer, 140, DURATION / 1000);

    // brand-colored confetti cannons + a few fireworks behind the stage
    cbCannon(layer, 4); cbCannon(layer, 96);
    setTimeout(() => { cbCannon(layer, 20); cbCannon(layer, 80); }, 600);
    setTimeout(() => { cbCannon(layer, 8); cbCannon(layer, 92); }, 4200);
    for (let k = 0; k < 6; k++) {
      setTimeout(() => cbFirework(layer, 18 + Math.random() * 64, 22 + Math.random() * 30), 500 + k * 900);
    }
    const btn = document.getElementById('celebrateBtn');
    if (btn) { btn.style.animation = 'cbSpin .6s linear 3'; setTimeout(() => { btn.style.animation = ''; }, 1900); }
  }

  celebrateSound();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(phraseTimer);
    layer.classList.add('out');
    setTimeout(() => { layer.remove(); _celebrating = false; }, 450);
  };
  layer.addEventListener('click', close);
  setTimeout(close, DURATION);
}

function setupCelebrate() {
  const btn = document.getElementById('celebrateBtn');
  if (btn && !btn._wired) { btn._wired = true; btn.addEventListener('click', celebrate); }
}

function renderQuarter(quarterKey, quarters, annualSeries, monthlyTileValues) {
  const q = quarters[quarterKey];
  if (!q) return;
  renderTiles('quarter-tiles', extractQuarterTiles(annualSeries, quarters, quarterKey), 'vs last qtr');
  const qMonths = QUARTER_MONTH_INDEXES[quarterKey];
  renderQuarterlyLeaderboard(individualsOnly(q.members, qMonths[qMonths.length - 1]));
}

/* Support tab data. Loaded at sign-in, and re-read in place after a manager saves a
   correction (a full page reload would drop the in-page Google sign-in). */
const SUPPORT = { monthResults: [], quarters: {}, annualSeries: null, monthlyTileValues: [] };

async function loadSupportData() {
  // Start from clean maps: corrections are applied on top of the sheet values as they load.
  REPORT.monthly.clear();
  REPORT.teammates.clear();
  REPORT.categories.clear();
  await loadReportTables();
  SUPPORT.monthResults = MONTH_TABS.map((m) => ({ ...m, parsed: buildMonthParsed(m.name) }));
  PARSED_BY_MONTH = {};
  SUPPORT.monthResults.forEach((m) => { PARSED_BY_MONTH[m.name.toLowerCase()] = m.parsed; });
  SUPPORT.monthlyTileValues = SUPPORT.monthResults.map((m) => extractTiles(m.parsed));
  SUPPORT.annualSeries = buildAnnualSeries();
  SUPPORT.quarters = buildQuarters();
}

// Renders the Support tab; keeps the chosen month/quarter when given.
function renderSupport(keepMonthGid, keepQuarter) {
  const { monthResults, quarters, annualSeries, monthlyTileValues } = SUPPORT;
  const monthsWithData = monthResults.filter((m) => m.parsed.hasData);
  const optionList = monthsWithData.length ? monthsWithData : monthResults;
  // Default to the current calendar month; if it has no data yet (e.g. the 1st),
  // fall back to the latest month that does.
  const currentMonth = MONTH_NAMES[new Date().getMonth()];
  const monthEntry = optionList.find((m) => m.gid === keepMonthGid)
    || optionList.find((m) => m.name === currentMonth) || optionList[optionList.length - 1];
  populateSelect('month-select', optionList, monthEntry.gid, 'gid', 'name');
  renderMonth(monthEntry);
  renderTrends(annualSeries, monthlyTileValues);
  renderQoQTrends(annualSeries, quarters);

  const quarterOptions = QUARTER_NAMES.filter((q) => quarters[q] && quarters[q].hasData).map((q) => ({ key: q, label: q }));
  const finalQuarterOptions = quarterOptions.length ? quarterOptions : [{ key: 'Q1', label: 'Q1' }];
  // Same rule as the month selector: default to the current quarter, falling
  // back to the latest quarter with data if it has none yet.
  const currentQuarter = QUARTER_NAMES[Math.floor(new Date().getMonth() / 3)];
  const quarter = (finalQuarterOptions.find((o) => o.key === keepQuarter)
    || finalQuarterOptions.find((o) => o.key === currentQuarter)
    || finalQuarterOptions[finalQuarterOptions.length - 1]).key;
  populateSelect('quarter-select', finalQuarterOptions, quarter, 'key', 'label');
  renderQuarter(quarter, quarters, annualSeries, monthlyTileValues);
}

async function refreshSupport() {
  const monthGid = document.getElementById('month-select').value;
  const quarter = document.getElementById('quarter-select').value;
  await loadSupportData();
  renderSupport(monthGid, quarter);
  document.getElementById('last-updated').textContent = `Data loaded ${new Date().toLocaleString()}`;
}

async function main() {
  try {
    setupCelebrate();
    // Warm up Additional Services in the background (its backend is slow to start), so the
    // tab is usually ready by the time someone clicks it.
    const warmServices = () => mountServices();
    setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(warmServices, { timeout: 4000 }) : warmServices()), 1500);

    // Everything the Support tab needs, in parallel.
    await Promise.all([
      loadManagerList(),
      loadSupportData(),
      fetchTitleFrom(SHEET_ID, 'Overrides')
        .then((rows) => { overridesMap = parseOverridesSheet(rows); })
        .catch((err) => console.error('Failed to load incentive overrides', err)),
    ]);
    renderSupport();
    document.getElementById('month-select').addEventListener('change', (e) => {
      const selected = SUPPORT.monthResults.find((m) => m.gid === e.target.value);
      if (selected) renderMonth(selected);
    });
    document.getElementById('quarter-select').addEventListener('change', (e) => {
      renderQuarter(e.target.value, SUPPORT.quarters, SUPPORT.annualSeries, SUPPORT.monthlyTileValues);
    });

    document.getElementById('last-updated').textContent = `Data loaded ${new Date().toLocaleString()}`;
    // Firm Lookup, Implementation, MRR and CSM load when first opened, or quietly once the Support tab is up.
    const prefetch = () => { ensureTabData('impl'); ensureTabData('firm'); prefetchMrr(); prefetchCsm(); };
    setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(prefetch, { timeout: 5000 }) : prefetch()), 2500);
    setupManagerToggle();   // shows the toggle for allowlisted managers; restores per-tab state
    launchConfetti();
  } catch (err) {
    console.error(err);
    showError(`Couldn't load dashboard data: ${err.message}`);
  }
}
