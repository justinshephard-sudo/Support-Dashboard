/* CS Dashboard front end. Plain scripts sharing one global scope, loaded in order
   by index.html (all deferred):
     core.js            config, sign-in, Sheets transport, shared helpers
     support.js         Support tab (CS Report Master), incentives, manager mode, celebration, main()
     implementation.js  Implementation tab
     scorecards.js      CS Scorecards (manager page)
     firm-assignment.js New Firm Assignment (manager page)
     loop-tracker.js    Resources ▸ Loop Tracker
     roundup.js         Resources ▸ Product Roundup
     resources.js       Resources ▸ Knowledge Base
     firm-lookup.js     Firm Lookup tab
     boot.js            tabs, theme, Merlin, bootstrap()
   Top-level code may only use things defined in this file or earlier files; anything
   else belongs inside a function. tools/bump-version.sh updates the ?v= cache keys. */

// Don't let other sites embed the dashboard in a frame (clickjacking); GitHub Pages can't send frame-ancestors.
if (window.top !== window.self) { try { window.top.location = window.self.location.href; } catch (e) { document.documentElement.innerHTML = ''; } }

// Old "Support Team Report 2026" sheet — kept ONLY for the Accounts tab (firm lookup,
// written by the ChurnZero Apps Script) and the incentive Overrides tab/webapp.
const SHEET_ID = '1eqPYnDmD194GREzSIlfceLWmQyaBRW18mptL_uVRKCc';
// New "CS Report Master" — clean data source for the monthly report (Data - Monthly / Data - Teammates).
const REPORT_SHEET_ID = '1ymoTST_Yl_beQhzIVGyY2uXgQ9OMc5YWn5ZugcfWOik';
// Web app that writes manager cell-corrections to the NEW sheet's Overrides tab.
// Deploy apps-script/data-overrides.gs on CS Report Master and paste its /exec URL here.
const DATA_OVERRIDES_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxcel6P0QYZm8m3FKYDFtOOBLpRL6_KvrmIcS5ShrAbuTUPFXSrLtQ3SLDhrDeg6-pSww/exec';
// Managers see the Manager-mode toggle and manager pages. The live list is the "Dashboard
// Config" tab of the Support Team Report sheet (the backends read the same tab); this is
// the fallback if that tab can't be read. Each backend enforces it on its own as well.
const MANAGER_EMAILS = [
  'justin.shephard@lawmatics.com',
  'erika@lawmatics.com',
  'johnny@lawmatics.com',
  'clare@lawmatics.com',
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
// Signed contracts: metadata in the "Contracts" tab (written by apps-script/contracts), PDFs served
// by that web app only after it verifies the viewer's Google sign-in. No one needs Drive access.
const CONTRACTS_TAB = 'Contracts';
const CONTRACTS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzRJh5DWQxxDmkUAtyjKgvAlr2H0y758VlizVq09SkZ68EAoGEM2M9_m6CZoeVJg-xr9g/exec';

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
// Still counted in TEAM stats (tiles, CSAT, response times, trends) but not shown
// individually (leaderboard rows, incentive winners, manager-mode options) from the
// given month index on (0 = Jan). Earlier months still show them. Matched on first name.
const TEAM_ONLY_FROM = { adele: 8 };   // September 2026 onward
const isTeamOnly = (m, monthIdx) => {
  const from = TEAM_ONLY_FROM[String(m.name || '').trim().split(/\s+/)[0].toLowerCase()];
  return from != null && monthIdx >= from;
};
const individualsOnly = (members, monthIdx) => (members || []).filter((m) => !isTeamOnly(m, monthIdx));

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
   Google auth (lawmatics.com gate) + Sheets API transport. Tabs are read by
   title through the Sheets API with the signed-in user's own OAuth token, so
   the spreadsheets stay private to the domain.
   -------------------------------------------------------------------------- */
const AUTH = { token: null, email: null, tokenClient: null, expiresAt: 0 };
window.AUTH = AUTH;   // the embedded Additional Services app (services/) reuses this sign-in

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Links that come from data (ChurnZero, Notion, sheets, Drive) must be http(s); anything
// else (javascript:, data:, …) becomes a dead link. Returns an escaped attribute value.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? esc(String(u).trim()) : '#');

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
      AUTH.expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      // Renewing an expired session: keep the page as it is, just swap the token.
      if (AUTH.email) { hideSessionBanner(); return; }
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

/* Google access tokens last an hour. Near the end (or after a request comes back
   "session expired") a small banner offers one-click renewal; renewing needs a
   click because browsers block sign-in popups that open on their own. */
function showSessionBanner(expired) {
  let b = document.getElementById('sessionBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'sessionBanner';
    b.className = 'session-banner';
    b.innerHTML = '<span></span><button type="button">Stay signed in</button>';
    b.querySelector('button').addEventListener('click', () => AUTH.tokenClient.requestAccessToken({ prompt: '' }));
    document.body.appendChild(b);
  }
  b.querySelector('span').textContent = expired || Date.now() > AUTH.expiresAt
    ? 'Your Google sign-in expired.' : 'Your Google sign-in expires in a few minutes.';
}
function hideSessionBanner() { document.getElementById('sessionBanner')?.remove(); }
setInterval(() => {
  if (AUTH.email && AUTH.expiresAt && AUTH.expiresAt - Date.now() < 5 * 60000) showSessionBanner();
}, 30000);
const isSessionError = (e) => /session expired|not signed in/i.test(String(e && e.message));

async function loadManagerList() {
  try {
    const rows = await fetchTitleFrom(SHEET_ID, 'Dashboard Config');
    const list = rows.slice(1).map((r) => String(r[0] || '').trim().toLowerCase()).filter((e) => /@lawmatics\.com$/.test(e));
    if (list.length) MANAGER_EMAILS.splice(0, MANAGER_EMAILS.length, ...list);
  } catch (e) { /* keep the built-in list */ }
}

async function sheetsApi(path, sheetId = SHEET_ID) {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sheetId + path, {
    headers: { Authorization: 'Bearer ' + AUTH.token },
  });
  if (res.status === 401) { showSessionBanner(true); throw new Error('session expired (Sheets API HTTP 401)'); }
  if (!res.ok) throw new Error('Sheets API HTTP ' + res.status);
  return res.json();
}

function rangeForTitle(title) {
  return encodeURIComponent("'" + String(title).replace(/'/g, "''") + "'");
}

async function fetchSheetByTitle(title) {
  const data = await sheetsApi('/values/' + rangeForTitle(title));
  return (data.values || []).filter((r) => r.some((cell) => String(cell).trim() !== ''));
}


async function fetchTitleFrom(sheetId, title) {
  const data = await sheetsApi('/values/' + rangeForTitle(title), sheetId);
  return (data.values || []).filter((r) => r.some((cell) => String(cell).trim() !== ''));
}
