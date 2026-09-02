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
// Web app that writes manager cell-corrections to the NEW sheet's Overrides tab.
// Deploy apps-script/data-overrides.gs on CS Report Master and paste its /exec URL here.
const DATA_OVERRIDES_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxcel6P0QYZm8m3FKYDFtOOBLpRL6_KvrmIcS5ShrAbuTUPFXSrLtQ3SLDhrDeg6-pSww/exec';
// Only these signed-in users see the Manager-mode toggle. Add manager emails here (lowercase).
const MANAGER_EMAILS = [
  'justin.shephard@lawmatics.com',
  'erika@lawmatics.com',
  'johnny@lawmatics.com',
];

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
  { key: 'declinedCalls', label: 'Declined Calls' },
  { key: 'phoneAnswerRate', label: 'Phone Answer %' },
  { key: 'csat', label: 'CSAT' },
  { key: 'csatPct', label: 'CSAT %' },
  { key: 'dsat', label: 'DSAT' },
  { key: 'dsatPct', label: 'DSAT %' },
  { key: 'reviewedPct', label: 'Reviewed %' },
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
  const [monthlyRows, teammateRows, overrideRows] = await Promise.all([
    fetchTitleFrom(REPORT_SHEET_ID, 'Data - Monthly'),
    fetchTitleFrom(REPORT_SHEET_ID, 'Data - Teammates'),
    fetchTitleFrom(REPORT_SHEET_ID, 'Overrides').catch(() => []),
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
  tiles.forEach(({ label, icon, slot, value, delta }) => {
    const div = document.createElement('div');
    div.className = 'tile';
    div.style.setProperty('--tile-accent', `var(--slot-${slot})`);
    let deltaHtml = '';
    if (delta) {
      const arrow = delta.pct > 0 ? '▲' : (delta.pct < 0 ? '▼' : '');
      const color = delta.good ? '#1f9d57' : '#d64545';
      deltaHtml = `<div class="tile-delta" style="color:${color};font-size:.8em;font-weight:600;margin-top:2px;">`
        + `${arrow} ${Math.abs(delta.pct).toFixed(1)}% <span style="opacity:.6;font-weight:400;">${deltaLabel}</span></div>`;
    }
    div.innerHTML = `<span class="icon">${icon}</span><div class="label">${label}</div>`
      + `<div class="value">${value != null ? value : '–'}</div>${deltaHtml}`;
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
    key: 'facetime',
    // No reliable "FaceTime calls" column exists in the sheet, so this
    // incentive is set entirely in manager mode — winners, a free-text stat
    // note, and (uniquely) an editable title + dollar amount.
    manualOnly: true,
    editableMeta: true,
    defaultTitle: 'Most FaceTime Calls',
    defaultAmount: '$35',
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
// FaceTime title/amount live in the NEW sheet's Overrides tab (Table='Incentive'),
// written via the data-overrides web app — a path we fully control and can verify.
// Keyed `${monthKey}:${incentiveKey}:${field}` -> value.
let incentiveMetaMap = new Map();

async function postIncentiveMeta(monthKey, incentiveKey, field, value) {
  await fetch(DATA_OVERRIDES_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: OVERRIDES_SECRET, month: monthKey, table: 'Incentive', rep: incentiveKey, column: field, value: value || '', note: '' }),
  });
  return { ok: true };
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
    const winners = override && override.winnerName
      ? override.winnerName.split(',').map((s) => s.trim()).filter(Boolean) : [];

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
      if (override.statText) displayStat = override.statText;
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
  const selected = new Set(
    (override && override.winnerName ? override.winnerName.split(',') : []).map((s) => s.trim()).filter(Boolean),
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
  statInput.value = override ? (override.statText || '') : '';
  wrap.appendChild(statInput);

  const commit = () => {
    const winnersStr = [...box.querySelectorAll('input:checked')].map((cb) => cb.value).join(', ');
    const stat = statInput.value.trim();
    const key = `${monthKey}:${def.key}`;
    if (winnersStr || stat) overridesMap.set(key, { winnerName: winnersStr, statText: stat });
    else overridesMap.delete(key);

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

    scheduleOverridePost(key, () => postOverride(monthKey, def.key, winnersStr, stat));
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
  const badge = document.getElementById('manager-mode-badge');
  if (on) showManagerBadge(); else if (badge) badge.remove();
}

function updateManagerToggleUI() {
  const btn = document.getElementById('manager-toggle');
  if (!btn) return;
  btn.textContent = overridesUnlocked ? '🔓 Manager mode: ON' : '🔒 Manager mode';
  btn.setAttribute('aria-pressed', overridesUnlocked ? 'true' : 'false');
  btn.style.background = overridesUnlocked ? '#1f7a4d' : 'var(--card, #fff)';
  btn.style.color = overridesUnlocked ? '#fff' : 'inherit';
}

function showManagerBadge() {
  if (document.getElementById('manager-mode-badge')) return;
  const b = document.createElement('div');
  b.id = 'manager-mode-badge';
  b.textContent = '🔓 Manager mode — click a leaderboard value to adjust';
  Object.assign(b.style, { position: 'fixed', bottom: '14px', right: '14px', zIndex: 1001,
    background: '#1f7a4d', color: '#fff', padding: '8px 14px', borderRadius: '20px',
    font: '13px system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,.3)' });
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
    Object.assign(btn.style, { position: 'fixed', top: '12px', right: '12px', zIndex: 1002,
      padding: '8px 14px', borderRadius: '20px', border: '1px solid rgba(128,128,128,.4)',
      cursor: 'pointer', font: '13px system-ui, sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,.15)' });
    btn.addEventListener('click', () => setManagerMode(!overridesUnlocked));
    document.body.appendChild(btn);
  }
  let restore = false;
  try { restore = sessionStorage.getItem('cs-manager-mode') === 'on'; } catch (e) {}
  setManagerMode(restore);
}

let currentMonthName = null;
let PARSED_BY_MONTH = {};   // month name (lowercase) -> parsed, for month-over-month deltas

async function postDataOverride(month, table, rep, column, value, note) {
  // Fire-and-forget, matching postOverride: Apps Script responses are cross-origin
  // opaque, so we don't read the body — a resolved fetch means the request was sent.
  await fetch(DATA_OVERRIDES_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: OVERRIDES_SECRET, month, table, rep, column, value, note }),
  });
  return { ok: true };
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
    `<div class="coe-title">${member.name} · ${col.label} <span class="coe-sub">${month}</span></div>` +
    `<div class="coe-row"><select id="coe-mode"><option value="adjust">Adjust by</option><option value="set">Set to</option></select>` +
    `<input id="coe-value" type="text" placeholder="-1" /></div>` +
    `<input id="coe-note" type="text" placeholder="Reason (e.g. 1 excused by manager)" />` +
    `<div class="coe-actions"><button id="coe-save">Save</button><button id="coe-clear" title="Remove override for this cell">Clear</button><button id="coe-cancel">Cancel</button></div>` +
    `<div class="coe-hint">“Adjust by” keeps new data accruing (recommended). “Set to” pins an exact value.</div>`;
  Object.assign(pop.style, { position: 'fixed', zIndex: 1000, background: 'var(--card, #fff)', color: 'inherit',
    border: '1px solid rgba(128,128,128,.35)', borderRadius: '10px', padding: '12px', width: '288px',
    boxShadow: '0 8px 30px rgba(0,0,0,.25)', font: '13px system-ui, sans-serif' });
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
      await new Promise((r) => setTimeout(r, 1400));   // let the write commit before re-reading
      location.reload();
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

function renderMonth(entry) {
  currentMonthName = entry.name;
  const idx = MONTH_NAMES.indexOf(entry.name);
  const prevRaw = idx > 0 ? PARSED_BY_MONTH[MONTH_NAMES[idx - 1].toLowerCase()] : null;
  const prevParsed = prevRaw && prevRaw.hasData ? prevRaw : null;
  renderTiles('tiles', extractTiles(entry.parsed, prevParsed));
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
const CB_COLORS = ['#ff2d75', '#ffd23f', '#3ec1ff', '#7cff5b', '#b06bff', '#ff8a3d', '#ff5bd0'];

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

function celebrate() {
  if (_celebrating) return;
  _celebrating = true;
  ensureCelebrateStyles();

  const layer = document.createElement('div');
  layer.id = 'celebrate-layer';
  Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: 99999, pointerEvents: 'none', overflow: 'hidden' });
  document.body.appendChild(layer);

  // rainbow flashes
  const flash = document.createElement('div');
  Object.assign(flash.style, { position: 'absolute', inset: '0',
    background: 'radial-gradient(circle at 50% 40%, rgba(255,45,117,.55), rgba(62,193,255,.4) 42%, rgba(176,107,255,.3) 72%, transparent)',
    animation: 'cbFlash 1.5s ease-in-out 3' });
  layer.appendChild(flash);

  // emoji monsoon
  const EMO = ['🎉', '🎊', '🥳', '🦄', '🚀', '⭐', '🏆', '💥', '✨', '💫', '🌈', '🔥', '👏', '💯', '🎈', '🍾', '🎆'];
  for (let i = 0; i < 170; i++) {
    const s = document.createElement('div');
    s.textContent = EMO[(Math.random() * EMO.length) | 0];
    Object.assign(s.style, { position: 'absolute', left: Math.random() * 100 + 'vw', top: '-12vh',
      fontSize: (18 + Math.random() * 40) + 'px', willChange: 'transform',
      animation: `cbFall ${2.4 + Math.random() * 3.2}s linear ${Math.random() * 2.8}s forwards` });
    layer.appendChild(s);
  }

  // confetti cannons (staggered)
  cbCannon(layer, 5); cbCannon(layer, 95);
  setTimeout(() => { cbCannon(layer, 22); cbCannon(layer, 78); }, 550);
  setTimeout(() => { cbCannon(layer, 50); }, 1150);

  // fireworks all over
  for (let k = 0; k < 9; k++) {
    setTimeout(() => cbFirework(layer, 12 + Math.random() * 76, 12 + Math.random() * 48), 300 + k * 520);
  }

  // giant cycling hero banners
  const PHRASES = ['🎉 WOOHOO! 🎉', '🏆 TEAM CRUSHED IT! 🏆', '🚀 ABSOLUTE LEGENDS! 🚀', '🥳 LET’S GOOO! 🥳', '💯 INCREDIBLE WORK! 💯', '⭐ SUPPORT SUPERSTARS! ⭐'];
  PHRASES.slice().sort(() => Math.random() - 0.5).slice(0, 4).forEach((txt, i) => {
    setTimeout(() => {
      const h = document.createElement('div');
      h.textContent = txt;
      Object.assign(h.style, { position: 'fixed', left: '50%', top: '42%', transform: 'translate(-50%,-50%)',
        font: '900 clamp(30px,6.5vw,72px) system-ui,sans-serif', textAlign: 'center', whiteSpace: 'nowrap',
        background: 'linear-gradient(90deg,#ff2d75,#ffd23f,#3ec1ff,#7cff5b,#b06bff)',
        WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
        filter: 'drop-shadow(0 6px 26px rgba(0,0,0,.45))', animation: 'cbHero 1.5s ease-out forwards', zIndex: 100000 });
      layer.appendChild(h);
      setTimeout(() => h.remove(), 1600);
    }, i * 1300);
  });

  // shake the whole app + spin the button
  const app = document.getElementById('app');
  if (app) { app.style.animation = 'cbShake .6s ease-in-out 2'; setTimeout(() => { app.style.animation = ''; }, 1300); }
  const btn = document.getElementById('celebrateBtn');
  if (btn) { btn.style.animation = 'cbSpin .6s linear 3'; setTimeout(() => { btn.style.animation = ''; }, 1900); }

  celebrateSound();

  setTimeout(() => { layer.remove(); _celebrating = false; }, 7000);
}

function setupCelebrate() {
  const btn = document.getElementById('celebrateBtn');
  if (btn && !btn._wired) { btn._wired = true; btn.addEventListener('click', celebrate); }
}

function renderQuarter(quarterKey, quarters, annualSeries, monthlyTileValues) {
  const q = quarters[quarterKey];
  if (!q) return;
  renderTiles('quarter-tiles', extractQuarterTiles(annualSeries, quarters, quarterKey), 'vs last qtr');
  renderQuarterlyLeaderboard(q.members);
}

async function main() {
  try {
    setupCelebrate();
    await loadGidTitleMap();
    initFirmLookup().catch((err) => console.error('Firm lookup load failed', err));

    await loadReportTables();
    await fetchSheet(OVERRIDES_GID)
      .then((rows) => { overridesMap = parseOverridesSheet(rows); })
      .catch((err) => console.error('Failed to load incentive overrides', err));
    const monthResults = MONTH_TABS.map((m) => ({ ...m, parsed: buildMonthParsed(m.name) }));
    PARSED_BY_MONTH = {};
    monthResults.forEach((m) => { PARSED_BY_MONTH[m.name.toLowerCase()] = m.parsed; });

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
    renderQoQTrends(annualSeries, quarters);
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
    setupManagerToggle();   // shows the toggle for allowlisted managers; restores per-tab state
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
