// Old "Support Team Report 2026" sheet — kept ONLY for the Accounts tab (firm lookup,
// written by the ChurnZero Apps Script) and the incentive Overrides tab/webapp.
const SHEET_ID = '1eqPYnDmD194GREzSIlfceLWmQyaBRW18mptL_uVRKCc';
// New "CS Report Master" — clean data source for the monthly report (Data - Monthly / Data - Teammates).
const REPORT_SHEET_ID = '1ymoTST_Yl_beQhzIVGyY2uXgQ9OMc5YWn5ZugcfWOik';
const ANNUAL_GID = '1501069044';
const QUARTERLY_GID = '1582468207';
const OVERRIDES_GID = '1979946321';
const OVERRIDES_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbz5hzP2ADpdQVN0bsV6h8TYZgj_snLQWeZgzYsZlDoJhdWv4WysfqlB2D0UX8TXrt9V8g/exec';
const OVERRIDES_SECRET = 'cs-dash-9f2a7d3b1c8e4f6a';

// Google sign-in gate (restricted to lawmatics.com) + Sheets API read config.
// NOTE: reuses the Merlin OAuth client — its Authorized JavaScript origins must
// include this dashboard's Pages origin (https://justinshephard-sudo.github.io).
const CONFIG = {
  CLIENT_ID: '1056458394718-fk8r113mqg2f55a9il4d4kg2a745d3ns.apps.googleusercontent.com',
  ALLOWED_DOMAIN: 'lawmatics.com',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/userinfo.email',
};
const ACCOUNTS_TAB = 'Accounts';   // tab the ChurnZero sync writes (see apps-script/sync-accounts.gs)

const MONTH_TABS = [
  { name: 'January', gid: '749310542' },
  { name: 'February', gid: '629761774' },
  { name: 'March', gid: '427211915' },
  { name: 'April', gid: '1191771043' },
  { name: 'May', gid: '1345375097' },
  { name: 'June', gid: '180112901' },
  { name: 'July', gid: '2102059487' },
  { name: 'August', gid: '356947838' },
  { name: 'September', gid: '1159895850' },
  { name: 'October', gid: '444084634' },
  { name: 'November', gid: '2021455964' },
  { name: 'December', gid: '142641585' },
];

const QUARTER_NAMES = ['Q1', 'Q2', 'Q3', 'Q4'];
const QUARTER_MONTH_INDEXES = {
  Q1: [0, 1, 2],
  Q2: [3, 4, 5],
  Q3: [6, 7, 8],
  Q4: [9, 10, 11],
};

const EXCLUDED_NAMES = new Set(['justin', 'dakota', 'erika']);

const LEADERBOARD_COLUMNS = [
  { key: 'convAssigned', label: 'Conv Assigned' },
  { key: 'convReplied', label: 'Conv Replied' },
  { key: 'totalCalls', label: 'Total Calls' },
  { key: 'missedCalls', label: 'Missed Calls' },
  { key: 'phoneAnswerRate', label: 'Phone Answer %' },
  { key: 'csat', label: 'CSAT' },
  { key: 'csatPct', label: 'CSAT %' },
  { key: 'dsat', label: 'DSAT' },
  { key: 'dsatPct', label: 'DSAT %' },
  { key: 'reviewedPct', label: 'Reviewed %' },
  { key: 'cx', label: 'CX' },
  { key: 'newTickets', label: 'New Tickets' },
  { key: 'avg1stResponse', label: 'Avg 1st Response' },
  { key: 'avgRespTime', label: 'Avg Resp Time' },
  { key: 'closedConv', label: 'Closed Conv' },
  { key: 'closingTime', label: 'Closing Time' },
  { key: 'supportCalls', label: 'Support Calls' },
  { key: 'tbDemos', label: 'TB Demos' },
  { key: 'totalDemos', label: 'Total Demos' },
];

const MONTH_NAMES = MONTH_TABS.map((m) => m.name);

/* --------------------------------------------------------------------------
   Google auth (lawmatics.com gate) + Sheets API transport.
   fetchSheet(gid) keeps its old signature, so every call site is unchanged —
   it now reads via the Sheets API using the signed-in user's OAuth token,
   which lets the spreadsheet be private instead of "anyone with the link".
   -------------------------------------------------------------------------- */
const AUTH = { token: null, email: null, tokenClient: null, gidTitle: {} };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function gateError(msg) {
  const el = document.getElementById('gateError');
  if (el) { el.textContent = msg || ''; el.hidden = !msg; }
}

function setUserChip(info) {
  const chip = document.getElementById('userChip');
  if (!chip) return;
  const email = info.email || '';
  const handle = email.split('@')[0];
  const init = (info.name || handle).split(/[.\s]+/).slice(0, 2).map((s) => s[0] || '').join('').toUpperCase();
  chip.innerHTML = `<span class="av">${esc(init)}</span>${esc(handle)}`;
  chip.classList.remove('hidden');
}

function initAuth(onReady) {
  AUTH.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: async (resp) => {
      if (resp.error) { gateError('Sign-in failed — please try again.'); return; }
      AUTH.token = resp.access_token;
      let info;
      try {
        info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: 'Bearer ' + AUTH.token },
        }).then((r) => r.json());
      } catch (e) { gateError('Could not verify your account. Try again.'); return; }
      const email = (info && info.email ? info.email : '').toLowerCase();
      if (!email.endsWith('@' + CONFIG.ALLOWED_DOMAIN)) {
        AUTH.token = null;
        gateError('Please sign in with your @' + CONFIG.ALLOWED_DOMAIN + ' account.');
        return;
      }
      AUTH.email = email;
      gateError('');
      document.getElementById('gate').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      setUserChip(info);
      onReady();
    },
  });
  const btn = document.getElementById('gateBtn');
  if (btn) btn.addEventListener('click', () => AUTH.tokenClient.requestAccessToken({ prompt: '' }));
}

async function sheetsApi(path, sheetId = SHEET_ID) {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sheetId + path, {
    headers: { Authorization: 'Bearer ' + AUTH.token },
  });
  if (!res.ok) throw new Error('Sheets API HTTP ' + res.status);
  return res.json();
}

async function loadGidTitleMap() {
  const meta = await sheetsApi('?fields=sheets(properties(sheetId,title))');
  (meta.sheets || []).forEach((s) => { AUTH.gidTitle[String(s.properties.sheetId)] = s.properties.title; });
}

function rangeForTitle(title) {
  return encodeURIComponent("'" + String(title).replace(/'/g, "''") + "'");
}

async function fetchSheetByTitle(title) {
  const data = await sheetsApi('/values/' + rangeForTitle(title));
  return (data.values || []).filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

async function fetchSheet(gid) {
  const title = AUTH.gidTitle[String(gid)];
  if (!title) throw new Error('No tab found for gid ' + gid);
  return fetchSheetByTitle(title);
}

async function fetchTitleFrom(sheetId, title) {
  const data = await sheetsApi('/values/' + rangeForTitle(title), sheetId);
  return (data.values || []).filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/* ==========================================================================
   CS Report Master (clean source): build the {members, groups, hasData} month
   shape, annual series, and quarterly aggregates the existing renderers expect,
   from the flat "Data - Monthly" + "Data - Teammates" tabs. The old sheet's
   Accounts (firm lookup) + Overrides tabs are still read from SHEET_ID above.
   ========================================================================== */
const REPORT = { monthly: new Map(), teammates: new Map() };  // monthKey -> rowObj / [members]
const monthKeyOf = (label) => String(label || '').trim().split(/\s+/)[0].toLowerCase();

// Data-Teammates columns after [Month, Rep], in order -> member keys (20th col "FaceTime..." unused).
const TEAM_COL_TO_KEY = [
  'convAssigned', 'convReplied', 'totalCalls', 'missedCalls', 'phoneAnswerRate', 'csat', 'csatPct',
  'dsat', 'dsatPct', 'reviewedPct', 'cx', 'newTickets', 'avg1stResponse', 'avgRespTime', 'closedConv',
  'closingTime', 'supportCalls', 'tbDemos', 'totalDemos',
];

async function loadReportTables() {
  const [monthlyRows, teammateRows] = await Promise.all([
    fetchTitleFrom(REPORT_SHEET_ID, 'Data - Monthly'),
    fetchTitleFrom(REPORT_SHEET_ID, 'Data - Teammates'),
  ]);
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
    TEAM_COL_TO_KEY.forEach((key, i) => { member[key] = (r[i + 2] == null ? '' : String(r[i + 2]).trim()); });
    if (!REPORT.teammates.has(mk)) REPORT.teammates.set(mk, []);
    REPORT.teammates.get(mk).push(member);
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
  put(g6, 'answer rate', 'Phone Answer Rate');
  put(g11, 'total attendees', 'OH Total Attendees');
  put(g11, 'total article views', 'Total Article Views');
  put(g11, 'total artcile views', 'Total Article Views');
  return { members, groups: { 0: g0, 6: g6, 11: g11 }, hasData: members.some(memberHasData) };
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
  const SUM = ['convAssigned', 'convReplied', 'totalCalls', 'missedCalls', 'csat', 'dsat', 'newTickets', 'closedConv', 'supportCalls', 'tbDemos', 'totalDemos'];
  const AVG_PCT = ['phoneAnswerRate', 'csatPct', 'dsatPct', 'reviewedPct', 'cx'];
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
  { label: 'New Conversations', icon: '💬', slot: 1, get: (p) => lookup(p.groups[0], ['New Conversations']) },
  { label: 'Phone Answer Rate', icon: '📞', slot: 2, get: (p) => lookup(p.groups[6], ['Answer Rate']) },
  { label: 'Office Hours Attendees', icon: '🎓', slot: 3, get: (p) => lookup(p.groups[11], ['Total Attendees', 'Total Atendees']) },
  { label: 'AI Resolution Rate', icon: '🤖', slot: 5, get: (p) => lookup(p.groups[0], ['AI Resolution Rate', 'AI Confirmed Resolution Rate']) },
  { label: 'Article Views', icon: '📄', slot: 8, get: (p) => lookup(p.groups[11], ['Total Artcile Views', 'Total Article Views', 'Total Help Article Search']) },
];

function extractTiles(parsed) {
  return TILE_DEFS.map((def) => ({
    label: def.label,
    icon: def.icon,
    slot: def.slot,
    value: def.get(parsed),
  }));
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

function fmtPct(n) {
  return n == null ? null : `${(Math.round(n * 10) / 10)}%`;
}

const QUARTER_TILE_DEFS = [
  { label: 'New Conversations', icon: '💬', slot: 1, source: 'annual', series: 'New Conversations', agg: 'sum', fmt: fmtNum },
  { label: 'Phone Answer Rate', icon: '📞', slot: 2, source: 'annual', series: 'Answer Rate', agg: 'avg', fmt: fmtPct },
  // "Total Atendees" in the Annual tab has a pre-existing formatting bug in most months
  // (values render as bogus percentages); each month tab's own cell is clean, so sum those instead.
  { label: 'Office Hours Attendees', icon: '🎓', slot: 3, source: 'monthlyTile', series: 'Office Hours Attendees', agg: 'sum', fmt: fmtNum },
  { label: 'AI Resolution Rate', icon: '🤖', slot: 5, source: 'annual', series: 'AI Resolution Rate', agg: 'avg', fmt: fmtPct },
  { label: 'Article Views', icon: '📄', slot: 8, source: 'annual', series: 'Total Help Article Search', agg: 'sum', fmt: fmtNum },
];

function extractQuarterTiles(annualSeries, monthlyTileValues, monthIndexes) {
  return QUARTER_TILE_DEFS.map((def) => {
    const values = monthIndexes
      .map((idx) => {
        if (def.source === 'monthlyTile') {
          const tile = (monthlyTileValues[idx] || []).find((t) => t.label === def.series);
          return tile ? toNumber(tile.value) : null;
        }
        return toNumber((annualSeries.get(def.series.toLowerCase()) || [])[idx]);
      })
      .filter((v) => v != null);
    let agg = null;
    if (values.length) {
      agg = def.agg === 'sum' ? values.reduce((a, b) => a + b, 0) : values.reduce((a, b) => a + b, 0) / values.length;
    }
    return { label: def.label, icon: def.icon, slot: def.slot, value: def.fmt(agg) };
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
  if (!/^\d{1,3}:\d{2}(:\d{2})?$/.test(s)) return null;
  const parts = s.split(':').map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
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

function renderTiles(containerId, tiles) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  tiles.forEach(({ label, icon, slot, value }) => {
    const div = document.createElement('div');
    div.className = 'tile';
    div.style.setProperty('--tile-accent', `var(--slot-${slot})`);
    div.innerHTML = `<span class="icon">${icon}</span><div class="label">${label}</div><div class="value">${value != null ? value : '–'}</div>`;
    el.appendChild(div);
  });
}

function moodFace(csatPct) {
  const n = toNumber(csatPct);
  if (n == null) return '';
  if (n >= 97) return '🤩';
  if (n >= 92) return '😄';
  if (n >= 85) return '🙂';
  if (n >= 75) return '😐';
  return '😟';
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
    key: 'facetime',
    // No reliable "FaceTime calls" column exists in the sheet, so this
    // incentive has no automatic winner at all — it's set entirely via
    // the secret override panel, including a free-text stat note.
    manualOnly: true,
    statPlaceholder: 'e.g. 12 FaceTime calls',
    compute: () => null,
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

async function postOverride(monthKey, incentiveKey, winnerName, statText) {
  await fetch(OVERRIDES_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      secret: OVERRIDES_SECRET,
      monthKey,
      incentiveKey,
      winnerName: winnerName || '',
      statText: statText || '',
    }),
  });
}

let overridesUnlocked = false;
let currentIncentiveMembers = [];
let currentIncentiveMonthKey = null;
let overridesMap = new Map();
const overridePostTimers = new Map();

function renderIncentives(members, monthKey) {
  currentIncentiveMembers = members;
  currentIncentiveMonthKey = monthKey;

  INCENTIVE_DEFS.forEach((def) => {
    const card = document.querySelector(`[data-incentive="${def.key}"]`);
    if (!card) return;
    const nameEl = card.querySelector('.incentive-winner');
    const statEl = card.querySelector('.incentive-stat');
    const tiedEl = card.querySelector('.incentive-tied');

    const override = overridesMap.get(`${monthKey}:${def.key}`);
    const overrideMember = override ? members.find((m) => m.name === override.winnerName) : null;

    let displayName = null;
    let displayStat = null;
    let tiedWith = [];
    let tiedStatLabel = '';

    if (def.manualOnly) {
      if (override) {
        displayName = override.winnerName;
        displayStat = override.statText || '–';
      }
    } else if (overrideMember) {
      displayName = overrideMember.name;
      displayStat = def.displayStat(overrideMember);
    } else {
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

    renderOverrideControl(card, def, members, monthKey, override);
  });
}

function renderOverrideControl(card, def, members, monthKey, override) {
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

  const select = document.createElement('select');
  select.className = 'incentive-override-select';
  const autoOpt = document.createElement('option');
  autoOpt.value = '';
  autoOpt.textContent = def.manualOnly ? '— None —' : '— Auto —';
  select.appendChild(autoOpt);
  members.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = m.name;
    select.appendChild(opt);
  });
  select.value = override ? override.winnerName : '';
  wrap.appendChild(select);

  let statInput = null;
  if (def.manualOnly) {
    statInput = document.createElement('input');
    statInput.type = 'text';
    statInput.className = 'incentive-override-stat-input';
    statInput.placeholder = def.statPlaceholder || 'Optional note';
    statInput.value = override ? override.statText : '';
    wrap.appendChild(statInput);
  }

  const commit = () => {
    const chosenName = select.value;
    const chosenStat = statInput ? statInput.value.trim() : '';
    if (chosenName) overridesMap.set(`${monthKey}:${def.key}`, { winnerName: chosenName, statText: chosenStat });
    else overridesMap.delete(`${monthKey}:${def.key}`);
    renderIncentives(currentIncentiveMembers, currentIncentiveMonthKey);

    // Debounced so picking a name and then typing a stat note a moment
    // later sends one write instead of two racing requests (the sheet
    // backend can end up with duplicate rows if two writes for the same
    // month+incentive land close together).
    const timerKey = `${monthKey}:${def.key}`;
    clearTimeout(overridePostTimers.get(timerKey));
    overridePostTimers.set(timerKey, setTimeout(async () => {
      try {
        await postOverride(monthKey, def.key, chosenName, chosenStat);
      } catch (err) {
        console.error('Failed to save override', err);
      }
    }, 800));
  };

  select.onchange = commit;
  if (statInput) {
    statInput.addEventListener('blur', commit);
    statInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
    });
  }
}

const CORNER_UNLOCK_WINDOW_MS = 4000;
let cornerClickState = { corners: new Set(), firstClickAt: 0 };

function setupSecretCornerUnlock() {
  document.querySelectorAll('.incentive-secret-corner').forEach((el) => {
    el.addEventListener('click', () => {
      if (overridesUnlocked) return;
      const now = Date.now();
      if (cornerClickState.corners.size === 0 || now - cornerClickState.firstClickAt > CORNER_UNLOCK_WINDOW_MS) {
        cornerClickState = { corners: new Set(), firstClickAt: now };
      }
      cornerClickState.corners.add(el.dataset.corner);
      if (cornerClickState.corners.size === 4) {
        cornerClickState = { corners: new Set(), firstClickAt: 0 };
        overridesUnlocked = true;
        renderIncentives(currentIncentiveMembers, currentIncentiveMonthKey);
      }
    });
  });
}

function createLeaderboardRenderer(tableId) {
  const sortState = { key: null, dir: 1 };

  return function renderLeaderboard(members) {
    const thead = document.querySelector(`#${tableId} thead`);
    const tbody = document.querySelector(`#${tableId} tbody`);
    const columns = [{ key: 'name', label: 'Name' }, { key: 'mood', label: '' }, ...LEADERBOARD_COLUMNS];

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
      if (col.key !== 'mood') {
        th.addEventListener('click', () => {
          if (sortState.key === col.key) sortState.dir *= -1;
          else { sortState.key = col.key; sortState.dir = 1; }
          renderLeaderboard(members);
        });
      } else {
        th.style.cursor = 'default';
      }
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
        } else if (col.key === 'mood') {
          td.textContent = moodFace(m.csatPct);
          td.className = 'mood-cell';
        } else {
          const v = m[col.key];
          td.textContent = v && v !== '' ? v : '–';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  };
}

const renderMonthlyLeaderboard = createLeaderboardRenderer('leaderboard');
const renderQuarterlyLeaderboard = createLeaderboardRenderer('quarterly-leaderboard');

function renderMonth(entry) {
  renderTiles('tiles', extractTiles(entry.parsed));
  renderMonthlyLeaderboard(entry.parsed.members);
  renderIncentives(entry.parsed.members, entry.gid);
  updateMascot(entry.parsed.members, entry.name);
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

function renderTrends(series, monthlyTileValues) {
  const seriesFor = (label) => MONTH_NAMES.map((_, i) => toNumber((series.get(label.toLowerCase()) || [])[i]));

  const newConv = seriesFor('New Conversations');
  const assigned = seriesFor('Conversations Assigned');
  const answerRate = seriesFor('Answer Rate');
  const csatPct = seriesFor('CSAT%');
  const aiResolution = seriesFor('AI Resolution Rate');
  const avgPerTeammate = seriesFor('Avg Assigned Convers Per Team Member');
  // Sourced from each month's own tab (not the Annual tab's "Total Atendees" row,
  // which has a pre-existing formatting bug for most months — see quarterly tiles).
  const officeAttendees = monthlyTileValues.map((tiles) => {
    const tile = tiles.find((t) => t.label === 'Office Hours Attendees');
    return tile ? toNumber(tile.value) : null;
  });

  const trimmed = trimTrailingEmpty(MONTH_NAMES, [newConv, assigned, answerRate, csatPct, aiResolution, avgPerTeammate, officeAttendees]);
  const [tNewConv, tAssigned, tAnswerRate, tCsatPct, tAiResolution, tAvgPerTeammate, tOfficeAttendees] = trimmed.arrays;

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
  drawLineChart('chart-office-attendees', trimmed.labels, [
    { label: 'Office Hours Attendees', data: tOfficeAttendees, borderColor: cssVar('--slot-4') },
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

function renderQuarter(quarterKey, quarters, annualSeries, monthlyTileValues) {
  const q = quarters[quarterKey];
  if (!q) return;
  renderTiles('quarter-tiles', extractQuarterTiles(annualSeries, monthlyTileValues, QUARTER_MONTH_INDEXES[quarterKey]));
  renderQuarterlyLeaderboard(q.members);
}

async function main() {
  try {
    setupSecretCornerUnlock();
    await loadGidTitleMap();
    initFirmLookup().catch((err) => console.error('Firm lookup load failed', err));

    await loadReportTables();
    await fetchSheet(OVERRIDES_GID)
      .then((rows) => { overridesMap = parseOverridesSheet(rows); })
      .catch((err) => console.error('Failed to load incentive overrides', err));
    const monthResults = MONTH_TABS.map((m) => ({ ...m, parsed: buildMonthParsed(m.name) }));

    const monthlyTileValues = monthResults.map((m) => extractTiles(m.parsed));

    const monthsWithData = monthResults.filter((m) => m.parsed.hasData);
    const optionList = monthsWithData.length ? monthsWithData : monthResults;
    const defaultEntry = optionList[optionList.length - 1];

    populateSelect('month-select', optionList, defaultEntry.gid, 'gid', 'name');
    renderMonth(defaultEntry);

    document.getElementById('month-select').addEventListener('change', (e) => {
      const selected = monthResults.find((m) => m.gid === e.target.value);
      if (selected) renderMonth(selected);
    });

    const annualSeries = buildAnnualSeries();
    renderTrends(annualSeries, monthlyTileValues);

    const quarters = buildQuarters();
    const quarterOptions = QUARTER_NAMES
      .filter((q) => quarters[q] && quarters[q].hasData)
      .map((q) => ({ key: q, label: q }));
    const finalQuarterOptions = quarterOptions.length ? quarterOptions : [{ key: 'Q1', label: 'Q1' }];
    const defaultQuarter = finalQuarterOptions[finalQuarterOptions.length - 1].key;

    populateSelect('quarter-select', finalQuarterOptions, defaultQuarter, 'key', 'label');
    renderQuarter(defaultQuarter, quarters, annualSeries, monthlyTileValues);

    document.getElementById('quarter-select').addEventListener('change', (e) => {
      renderQuarter(e.target.value, quarters, annualSeries, monthlyTileValues);
    });

    document.getElementById('last-updated').textContent = `Data loaded ${new Date().toLocaleString()}`;
    launchConfetti();
  } catch (err) {
    console.error(err);
    showError(`Couldn't load dashboard data: ${err.message}`);
  }
}

/* ==========================================================================
   Firm Lookup — reads the "Accounts" tab (written by the ChurnZero sync),
   fuzzy-searches firms, and renders a customer profile.
   ========================================================================== */
const FIRMS = { list: [], loaded: false };

async function initFirmLookup() {
  const input = document.getElementById('q');
  const emptyMsg = document.getElementById('firmEmptyMsg');
  const cnt = document.getElementById('firmCount');
  try {
    const rows = await fetchSheetByTitle(ACCOUNTS_TAB);
    FIRMS.list = parseAccounts(rows);
    FIRMS.loaded = true;
    if (cnt) cnt.textContent = FIRMS.list.length ? `${FIRMS.list.length} firms` : '';
    if (emptyMsg) emptyMsg.textContent = FIRMS.list.length
      ? 'Start typing a firm name to pull up their profile.'
      : 'No account data yet — run the ChurnZero sync to populate the Accounts tab.';
  } catch (err) {
    console.error('Accounts tab not available', err);
    if (emptyMsg) emptyMsg.textContent = 'Account data unavailable — the “Accounts” tab hasn’t been created yet.';
  }
  if (input) input.addEventListener('input', onFirmSearch);
}

function parseAccounts(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  const get = (row, name) => { const i = idx[name.toLowerCase()]; return i == null ? '' : String(row[i] == null ? '' : row[i]).trim(); };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = get(r, 'Name');
    if (!name) continue;
    out.push({
      name,
      firmId: get(r, 'FirmId'),
      area: get(r, 'PracticeArea'),
      am: get(r, 'AccountManager'),
      mrr: get(r, 'MRR'),
      contract: get(r, 'TotalContract'),
      cb: get(r, 'ChargebeeStatus'),
      cstatus: get(r, 'ContractStatus'),
      term: get(r, 'TermEnd'),
      cycles: get(r, 'RemainingCycles'),
      lic: get(r, 'Licenses'),
      score: get(r, 'ChurnScore'),
      freq: get(r, 'UsageFrequency'),
      danger: /^(true|yes|1)$/i.test(get(r, 'DangerZone')),
      cancel: /^(true|yes|1)$/i.test(get(r, 'CancellationRequested')),
      csat60: get(r, 'CSAT60'),
      tenure: get(r, 'TenureDays'),
      matters: get(r, 'MattersPerMonth'),
      leads: get(r, 'LeadVolume'),
      sms: get(r, 'TotalSms'),
      smsPlan: get(r, 'SmsPlanType'),
      acts30: get(r, 'Activities30'),
      emp: get(r, 'Employees'),
      contacts: get(r, 'Contacts'),
      onb: get(r, 'OnboardingStatus'),
      city: get(r, 'City'),
      web: get(r, 'Website'),
      plan: get(r, 'ChargebeePlan'),
      cbStart: get(r, 'ChargebeeStart'),
      addons: get(r, 'AddOns'),
      invBalance: get(r, 'InvoiceBalance'),
      legacy: get(r, 'LegacyContract'),
    });
  }
  return out;
}

function firmSearchScore(q, name) {
  q = q.toLowerCase().trim(); name = String(name).toLowerCase();
  if (!q) return -1;
  if (name.includes(q)) return 100 - name.indexOf(q);
  let qi = 0;
  for (let i = 0; i < name.length && qi < q.length; i++) if (name[i] === q[qi]) qi++;
  if (qi === q.length) return 40;
  let hit = 0;
  for (const ch of new Set(q.split(''))) if (name.includes(ch)) hit++;
  return hit >= Math.ceil(q.length * 0.6) ? 10 : -1;
}

const HEALTH = {
  good: ['Healthy', 'var(--st-good)', 'rgba(12,163,90,.15)', 'good'],
  warn: ['Watch', 'var(--st-warn)', 'rgba(230,148,26,.16)', 'warn'],
  bad: ['At Risk', 'var(--st-critical)', 'rgba(216,58,58,.15)', 'bad'],
};
function healthOf(f) {
  if (f.danger || f.cancel) return 'bad';
  const s = toNumber(f.score);
  if (s == null) return 'warn';
  if (s < 25) return 'good';
  if (s < 50) return 'warn';
  return 'bad';
}
function firmInitials(n) {
  return String(n).replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '—';
}
function fmtMoney(v) {
  if (v == null || String(v).trim() === '') return '—';
  const n = toNumber(v);
  if (n == null) return String(v);
  return '$' + Math.round(n).toLocaleString();
}
const orDash = (v) => (v == null || String(v).trim() === '' ? '—' : String(v));

function onFirmSearch() {
  const v = document.getElementById('q').value;
  const results = document.getElementById('results');
  if (!v.trim()) { results.classList.remove('show'); return; }
  const list = FIRMS.list
    .map((f) => ({ f, s: firmSearchScore(v, f.name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.f);
  renderFirmResults(list);
}

function renderFirmResults(list) {
  const results = document.getElementById('results');
  if (!list.length) { results.classList.remove('show'); return; }
  results.innerHTML = list.map((f) => {
    const h = HEALTH[healthOf(f)];
    const meta = [f.area, f.am ? 'AM ' + f.am : '', f.mrr ? fmtMoney(f.mrr) + '/mo' : ''].filter(Boolean).join(' · ');
    return `<div class="res" data-id="${esc(f.firmId)}" data-name="${esc(f.name)}">
      <div class="res-logo">${esc(firmInitials(f.name))}</div>
      <div class="res-main"><div class="res-name">${esc(f.name)}</div><div class="res-meta">${esc(meta)}</div></div>
      <span class="res-health" style="color:${h[1]};background:${h[2]}">${h[0]}</span>
    </div>`;
  }).join('');
  results.classList.add('show');
  results.querySelectorAll('.res').forEach((el) => el.addEventListener('click', () => openFirm(el.dataset.id, el.dataset.name)));
}

function pfRow(k, v, cls) { return `<div class="pf-row"><span class="k">${esc(k)}</span><span class="v ${cls || ''}">${esc(v)}</span></div>`; }

function openFirm(firmId, name) {
  const f = FIRMS.list.find((x) => (firmId && x.firmId === firmId) || x.name === name);
  if (!f) return;
  document.getElementById('results').classList.remove('show');
  document.getElementById('firmEmpty').style.display = 'none';
  document.getElementById('q').value = f.name;
  const hk = healthOf(f); const h = HEALTH[hk];
  const sub = [f.area, f.firmId ? 'FirmId ' + f.firmId : '', f.city ? '📍 ' + f.city : ''].filter(Boolean).map(esc).join(' · ');
  const web = f.web ? ` · <a href="https://${esc(f.web.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">🌐 ${esc(f.web)}</a>` : '';
  const badgeCls = hk === 'good' ? 'good' : hk === 'bad' ? 'bad' : 'warn';
  const dangerBadge = (f.danger || f.cancel) ? '<span class="pf-badge warn">⚠ Cancellation flagged</span>' : '';
  const scoreN = toNumber(f.score);
  const scoreCls = scoreN == null ? '' : scoreN < 25 ? 'good' : scoreN < 50 ? 'warn' : 'bad';
  document.getElementById('profile').innerHTML = `
    <div class="pf-hero">
      <div class="pf-logo">${esc(firmInitials(f.name))}</div>
      <div class="pf-htext"><h3>${esc(f.name)}</h3><div class="sub">${sub}${web}</div></div>
      <div class="pf-hbadges">
        <span class="pf-badge ${badgeCls}">${h[0]}</span>
        ${dangerBadge}
        ${f.freq ? `<span class="pf-badge">${esc(f.freq)} user</span>` : ''}
      </div>
    </div>
    <div class="pf-grid">
      <div class="pf-card"><h4>👤 Ownership</h4>
        ${pfRow('Account Manager', orDash(f.am))}
        ${pfRow('Onboarding', orDash(f.onb), /complete/i.test(f.onb) ? 'good' : f.onb ? 'warn' : '')}
      </div>
      <div class="pf-card"><h4>💳 Billing</h4>
        ${pfRow('MRR', fmtMoney(f.mrr), toNumber(f.mrr) ? '' : 'warn')}
        ${f.plan ? pfRow('Plan', f.plan) : ''}
        ${pfRow('Chargebee', orDash(f.cb), /active/i.test(f.cb) ? 'good' : /past due|overdue/i.test(f.cb) ? 'bad' : '')}
        ${f.cbStart ? pfRow('Start date', f.cbStart) : ''}
        ${pfRow('Term ends', orDash(f.term))}
        ${pfRow('Licenses', orDash(f.lic))}
        ${f.addons ? `<div class="pf-row"><span class="k">Add-ons</span><span class="v">${f.addons.split(';').map((s) => esc(s.trim())).filter(Boolean).join('<br>')}</span></div>` : ''}
        ${f.invBalance ? pfRow('Balance due', f.invBalance, 'bad') : ''}
        ${f.legacy ? pfRow('Legacy contract', f.legacy) : ''}
      </div>
      <div class="pf-card"><h4>❤️ Health &amp; Risk</h4>
        ${pfRow('Churn score', orDash(f.score), scoreCls)}
        ${pfRow('Usage', orDash(f.freq), /daily/i.test(f.freq) ? 'good' : /rare|never/i.test(f.freq) ? 'bad' : '')}
        ${pfRow('Cancellation', (f.danger || f.cancel) ? 'Flagged' : 'No', (f.danger || f.cancel) ? 'bad' : 'good')}
      </div>
      <div class="pf-card"><h4>📊 Usage Snapshot</h4>
        ${pfRow('Matters / mo', orDash(f.matters))}
        ${pfRow('Lead volume', orDash(f.leads))}
        ${pfRow('Total SMS', orDash(f.sms))}
        ${pfRow('SMS plan', orDash(f.smsPlan))}
      </div>
    </div>`;
  document.getElementById('profile').classList.add('show');
}

/* ==========================================================================
   Tabs, theme, and auth bootstrap
   ========================================================================== */
function setupTabs() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const v = document.getElementById('view-' + t.dataset.tab);
    if (v) v.classList.add('active');
    if (t.dataset.tab === 'firm') { const q = document.getElementById('q'); if (q) q.focus(); }
  }));
}

function setupTheme() {
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const r = document.documentElement;
    r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
}

function bootstrap() {
  setupTabs();
  setupTheme();
  const start = () => initAuth(main);
  if (window.google && google.accounts && google.accounts.oauth2) {
    start();
  } else {
    const t = setInterval(() => {
      if (window.google && google.accounts && google.accounts.oauth2) { clearInterval(t); start(); }
    }, 120);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
