/* ==========================================================================
   CS Scorecards — reads and writes the "CS Score Cards 2026" sheet for the
   dashboard's manager-only Scorecards page.
   --------------------------------------------------------------------------
   The sheet stays the record: one tab per rep (months in rows 3–14, KPI inputs
   in B:E, monthly score in F, competencies + notes below), a Template tab with
   the rubric, and a Team Overview. This script runs as its owner (Justin), so
   the sheet doesn't need to be shared with every manager — instead each request
   carries the viewer's Google access token, and we only answer if it was issued
   to the dashboard's OAuth client for one of the MANAGERS.

   Layout additions (made once, by ensureLayout_): on each KPI tab, columns N:Q
   hold optional 1–5 score overrides per KPI and R the override note; the F
   score formulas use an override when present and skip blank KPIs (previously a
   blank CSAT/Answer Rate scored 1 and a blank response time scored 5).

   Deploy: Web app · Execute as: Me · Who has access: Anyone. Redeploy with
   `clasp update-deployment <id>` to keep the URL.
   ========================================================================== */

var SCORECARD_SHEET_ID = '1j3Ry-8pZI_ccdl_AJoNTdTumXIcF8djRhlUFOaU4dq4';
var DASHBOARD_CLIENT_ID = '1056458394718-fk8r113mqg2f55a9il4d4kg2a745d3ns.apps.googleusercontent.com';
var MANAGERS = ['justin.shephard@lawmatics.com', 'erika@lawmatics.com', 'johnny@lawmatics.com', 'clare@lawmatics.com'];
var OVERVIEW_TAB = '📊 Team Overview';
var TEMPLATE_TAB = 'Template';
var LAYOUT_VERSION = '2';
var MONTH_FIRST_ROW = 3, MONTH_LAST_ROW = 14, Q1_LAST_ROW = 5;
var OVERRIDE_HEADERS = ['CSAT score override', '1st Resp. score override', 'Avg. Resp. score override',
  'Answer Rate score override', 'Override note'];
var COMPETENCIES = ['Problem-Solving & Advanced Issue Resolution', 'Team Collaboration & Communication',
  'Customer Relationships & Proactivity', 'Innovation & Process Improvement',
  'Professional Growth & Development', 'Alignment with Company Values'];

// Run once from the editor (Run ▸ authorize) to grant the script access to the sheet and to
// Google's token check. Also applies the layout upgrade.
function authorize() {
  var ss = SpreadsheetApp.openById(SCORECARD_SHEET_ID);
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=x', { muteHttpExceptions: true });
  ensureLayout_(ss);
  Logger.log('Ready: ' + ss.getName());
}

function doGet() {
  return json_({ ok: true, message: 'Scorecards endpoint is live.' });
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  try {
    var who = verifyManager_(b.token);
    if (!who.ok) return json_(who);
    if (b.action === 'load') return json_(load_());
    if (b.action === 'set') return json_(set_(b, who.email));
    if (b.action === 'addRep') return json_(addRep_(b, who.email));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- read ---------- */

function load_() {
  var ss = SpreadsheetApp.openById(SCORECARD_SHEET_ID);
  ensureLayout_(ss);
  var reps = [];
  var overview = ss.getSheetByName(OVERVIEW_TAB);
  if (overview) {
    overview.getDataRange().getValues().forEach(function (r, i) {
      if (i < 3 || !r[0]) return;
      if (ss.getSheetByName(String(r[0]).trim())) reps.push({ name: String(r[0]).trim(), role: String(r[5] || '').trim() });
    });
  }
  var tabs = {};
  reps.forEach(function (rep) { tabs[rep.name] = readTab_(ss.getSheetByName(rep.name)); });
  var tpl = ss.getSheetByName(TEMPLATE_TAB);
  return { ok: true, reps: reps, tabs: tabs, rubric: tpl ? tpl.getRange('H2:L31').getDisplayValues() : [] };
}

// Values as plain JSON: time-formatted cells come back from Apps Script as Dates on
// 1899-12-30, which we turn back into day fractions; real dates become yyyy-mm-dd.
function readTab_(sh) {
  var lastRow = Math.max(sh.getLastRow(), 31);
  var values = sh.getRange(1, 1, lastRow, 18).getValues();
  var epoch = new Date(1899, 11, 30).getTime();
  return values.map(function (row) {
    return row.map(function (v) {
      if (v instanceof Date) {
        if (v.getFullYear() < 1901) return (v.getTime() - epoch) / 864e5;
        return Utilities.formatDate(v, 'America/Los_Angeles', 'yyyy-MM-dd');
      }
      return v;
    });
  });
}

/* ---------- write ---------- */

// b: { tab, cell: "C7", value } — only KPI inputs, overrides/notes on month rows,
// and competency score/notes cells can be written.
function set_(b, email) {
  var ss = SpreadsheetApp.openById(SCORECARD_SHEET_ID);
  var sh = ss.getSheetByName(String(b.tab || ''));
  if (!sh || sh.getName() === OVERVIEW_TAB || sh.getName() === TEMPLATE_TAB) return { ok: false, error: 'unknown rep' };
  var m = /^([A-Z])(\d+)$/.exec(String(b.cell || ''));
  if (!m) return { ok: false, error: 'bad cell' };
  var col = m[1], row = Number(m[2]);
  var label = sh.getRange(row, 1).getValue();
  var isMonth = label instanceof Date && row >= MONTH_FIRST_ROW && row <= MONTH_LAST_ROW;
  var isComp = COMPETENCIES.indexOf(String(label).trim()) !== -1;
  var allowed = (isMonth && 'BCDENOPQR'.indexOf(col) !== -1) || (isComp && (col === 'D' || col === 'E'));
  if (!allowed) return { ok: false, error: 'that cell is not editable' };

  var v = b.value;
  var range = sh.getRange(b.cell);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (v === '' || v == null) {
      range.clearContent();
    } else if ('BCDENOPQ'.indexOf(col) !== -1 || (isComp && col === 'D')) {
      var n = Number(v);
      if (!isFinite(n)) return { ok: false, error: 'enter a number' };
      if ('NOPQ'.indexOf(col) !== -1 || (isComp && col === 'D')) {
        if (n < 1 || n > 5) return { ok: false, error: 'scores are 1–5' };
      }
      range.setValue(n);
      if (col === 'B' || col === 'E') range.setNumberFormat('0%');
      if (col === 'C' || col === 'D' && isMonth) range.setNumberFormat('[h]:mm');
    } else {
      range.setValue(String(v).slice(0, 5000));
    }
    // Who changed what, as a cell note, so the sheet documents itself.
    range.setNote((v === '' || v == null ? 'Cleared' : 'Set') + ' by ' + email + ' via CS Dashboard, ' +
      Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy h:mm a'));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, tab: readTab_(sh) };
}

/* ---------- new rep: copy the Template tab and add them to the overview ---------- */

function addRep_(b, email) {
  var name = String(b.name || '').trim();
  var role = String(b.role || 'CS Support').trim().slice(0, 40);
  if (!/^[A-Za-z][A-Za-z .'-]{0,30}$/.test(name)) return { ok: false, error: 'Use letters only for the name (e.g. "Jordan").' };
  var ss = SpreadsheetApp.openById(SCORECARD_SHEET_ID);
  ensureLayout_(ss);
  if (ss.getSheetByName(name) || [OVERVIEW_TAB, TEMPLATE_TAB].indexOf(name) !== -1) return { ok: false, error: name + ' already has a scorecard.' };
  var tpl = ss.getSheetByName(TEMPLATE_TAB);
  if (!tpl) return { ok: false, error: 'The Template tab is missing.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = tpl.copyTo(ss).setName(name);
    sh.getRange('A1').setValue('CS Performance Score Card 2026  —  ' + name);
    sh.getRange('B3:E14').clearContent();          // the Template's sample row
    sh.getRange('N3:R14').clearContent();
    sh.getRange('D18:E23').clearContent();
    sh.getRange('A1').setNote('Created by ' + email + ' via CS Dashboard, ' +
      Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy'));
    var ov = ss.getSheetByName(OVERVIEW_TAB);
    var row = ov.getLastRow() + 1;
    var q = "'" + name.replace(/'/g, "''") + "'";
    ov.getRange(row, 1, 1, 6).setValues([[name, '=' + q + '!F15', '=' + q + '!D24', '=' + q + '!D26',
      '=IFERROR(ifs(D' + row + '>=4.5,"5 - Excellent",D' + row + '>=3.5,"4 - Exceeds Exp.",D' + row + '>=2.5,"3 - Meets Exp.",D' + row + '>=1.5,"2 - Needs Impr.",TRUE,"1 - Poor"),"")',
      role]]);
    ov.getRange(row - 1, 1, 1, 6).copyFormatToRange(ov, 1, 6, row, row);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return load_();
}

/* ---------- one-time layout upgrade ---------- */

function ensureLayout_(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('LAYOUT_VERSION') === LAYOUT_VERSION) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (props.getProperty('LAYOUT_VERSION') === LAYOUT_VERSION) return;
    ss.getSheets().forEach(function (sh) {
      if (String(sh.getRange('A2').getValue()).trim() !== 'Date') return;   // KPI tabs (and Template) only
      // Percentages typed as whole numbers (98 instead of 98%) → fractions.
      ['B', 'E'].forEach(function (c) {
        var rng = sh.getRange(c + MONTH_FIRST_ROW + ':' + c + MONTH_LAST_ROW);
        var vals = rng.getValues(), changed = false;
        vals.forEach(function (row) { if (typeof row[0] === 'number' && row[0] > 1.5 && row[0] <= 100) { row[0] = row[0] / 100; changed = true; } });
        if (changed) rng.setValues(vals);
      });
      sh.getRange('N2:R2').setValues([OVERRIDE_HEADERS]).setFontWeight('bold').setWrap(true);
      var formulas = [];
      for (var r = MONTH_FIRST_ROW; r <= MONTH_LAST_ROW; r++) formulas.push([scoreFormula_(r, r <= Q1_LAST_ROW)]);
      sh.getRange('F' + MONTH_FIRST_ROW + ':F' + MONTH_LAST_ROW).setFormulas(formulas);
    });
    props.setProperty('LAYOUT_VERSION', LAYOUT_VERSION);
  } finally {
    lock.releaseLock();
  }
}

// Average of the four 1–5 KPI scores: an override in N:Q wins; blank KPIs are skipped.
// Q1 (Jan–Mar) uses the older Avg. Response Time thresholds.
function scoreFormula_(r, q1) {
  var avgResp = q1
    ? 'D' + r + '<TIME(1,31,0),5,D' + r + '<TIME(2,0,0),4,D' + r + '<TIME(2,10,0),3,D' + r + '<TIME(2,30,0),2'
    : 'D' + r + '<TIME(1,1,0),5,D' + r + '<TIME(1,30,0),4,D' + r + '<TIME(1,40,0),3,D' + r + '<TIME(2,0,0),2';
  var part = function (ovr, inp, tests) {
    return 'IF(' + ovr + r + '<>"",' + ovr + r + ',IF(' + inp + r + '="","",IFS(' + tests + ',TRUE,1)))';
  };
  return '=LET(' +
    'kcsat,' + part('N', 'B', 'B' + r + '>=0.96,5,B' + r + '>=0.91,4,B' + r + '>=0.85,3,B' + r + '>=0.75,2') + ',' +
    'kfirst,' + part('O', 'C', 'C' + r + '<TIME(1,1,0),5,C' + r + '<TIME(1,30,0),4,C' + r + '<TIME(1,40,0),3,C' + r + '<TIME(2,0,0),2') + ',' +
    'kavg,' + part('P', 'D', avgResp) + ',' +
    'kans,' + part('Q', 'E', 'E' + r + '>=0.91,5,E' + r + '>=0.86,4,E' + r + '>=0.8,3,E' + r + '>=0.7,2') + ',' +
    'kcount,COUNT(kcsat,kfirst,kavg,kans),' +
    'IF(kcount=0,"",(N(kcsat)+N(kfirst)+N(kavg)+N(kans))/kcount))';
}

/* ---------- auth ---------- */

function verifyManager_(token) {
  if (!token) return { ok: false, error: 'not signed in' };
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var email = cache.get(key);
  if (!email) {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { ok: false, error: 'session expired — reload the dashboard' };
    var info = JSON.parse(res.getContentText());
    var audOk = info.aud === DASHBOARD_CLIENT_ID || info.azp === DASHBOARD_CLIENT_ID;
    email = String(info.email || '').toLowerCase();
    if (!audOk || String(info.email_verified) !== 'true') return { ok: false, error: 'not allowed' };
    cache.put(key, email, 300);
  }
  if (MANAGERS.indexOf(email) === -1) return { ok: false, error: 'Scorecards are for managers only.' };
  return { ok: true, email: email };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
