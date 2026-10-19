/* ==========================================================================
   MRR Report — backs the dashboard's MRR Report tab.
   --------------------------------------------------------------------------
   Reads the tabs Johnny's Chargebee sync writes (MRR Data sheet + the
   Scheduled Churn sheet), cleans them into one consistent set of events, and
   hands them to the page. Everyone signed in to the dashboard (@lawmatics.com)
   can read it; nothing is written anywhere.

   One set of rules for every view (the old page used several):
     - Live and historical exports are merged; an event that's in both
       (same subscription, type, month and amount) counts once.
     - A cancel and a reactivation of the same subscription in the same month
       cancel out; several up/downgrades of one subscription in a month are
       netted into one.
     - A cancellation lands in the Pacific month of its cancellation date;
       everything else in its Chargebee change month.
     - New business (NEW, FREE_TO_PAID, FUTURE) is left out.

   Actions (POST, with the viewer's Google access token):
     load → { events, scheduled, sf, retention, snapshots, synced }

   Deploy: Web app · Execute as: Me · Who has access: Anyone.
   Redeploy with `clasp update-deployment <id>` to keep the URL.
   ========================================================================== */

var MRR_SHEET_ID = '1zecFQqzYlxl7JQt1NYE_VgC5ak-UIf5MV01vjOYezgY';
var CHURN_SHEET_ID = '1_L7RujGPupKVNUWwseshAhfB2sz0B7FgU3xWl5GuD_8';
// Tabs by gid, so a rename doesn't break the report.
var GID = {
  live: 1275241620,          // MonthlyMRRImpact (rewritten by every sync)
  historical: 1854593398,    // one-time backfill export
  sf: 332446680,             // Salesforce Detail
  rate: 1332069135,          // Month 13 retention by checkpoint month
  detail: 1173296026,        // Month 13 retention, one row per firm
  am: 1195028226,            // Month 13 retention by AM
  scheduled: 0,              // Scheduled Churn (in CHURN_SHEET_ID)
};
var SNAPSHOT_TAB = 'MRR Snapshot';
var TZ = 'America/Los_Angeles';
var MONTHS_BACK = 26;          // enough for YTD, 12-month trends and the trailing averages
var EXCLUDED_FIRMS = /cardinal law/i;
var FRESH_MS = 10 * 60 * 1000; // the sync runs hourly, so 10 minutes is plenty fresh
var STALE_SECONDS = 6 * 3600;
var CHUNK = 90000;

/* ---------- web app ---------- */

function doGet() {
  return HtmlService.createHtmlOutput('MRR Report endpoint is live.');
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return dashJson_({ ok: false, error: 'bad request' }); }
  try {
    var who = dashAuth_(b.token);
    if (!who.ok) return dashJson_(who);
    if (b.action === 'load') return dashJson_(load_(!!b.force));
    return dashJson_({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error(err && err.stack || err);
    return dashJson_({ ok: false, error: 'Couldn’t read the MRR data — try again in a minute.' });
  }
}

/* ---------- cache (gzipped, split across keys) ---------- */

function load_(force) {
  var cache = CacheService.getScriptCache();
  var cached = readCache_(cache);
  if (!force && cached && Date.now() - cached.built < FRESH_MS) return cached;
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(20000);
  try {
    cached = readCache_(cache);
    if (!force && cached && Date.now() - cached.built < FRESH_MS) return cached;
    try {
      var data = build_();
      writeCache_(cache, data);
      return data;
    } catch (err) {
      console.error(err && err.stack || err);
      if (cached) { cached.stale = true; return cached; }
      throw err;
    }
  } finally {
    if (locked) lock.releaseLock();
  }
}

function writeCache_(cache, data) {
  var packed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(data))).getBytes());
  var parts = {};
  var n = Math.ceil(packed.length / CHUNK);
  for (var i = 0; i < n; i++) parts['mrr_' + i] = packed.slice(i * CHUNK, (i + 1) * CHUNK);
  parts.mrr_n = String(n);
  cache.putAll(parts, STALE_SECONDS);
}

function readCache_(cache) {
  try {
    var n = Number(cache.get('mrr_n') || 0);
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push('mrr_' + i);
    var got = cache.getAll(keys);
    var packed = keys.map(function (k) { return got[k] || ''; });
    if (packed.some(function (p) { return !p; })) return null;
    var blob = Utilities.newBlob(Utilities.base64Decode(packed.join('')), 'application/x-gzip');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString());
  } catch (e) { return null; }
}

/* ---------- build ---------- */

function build_() {
  var ss = SpreadsheetApp.openById(MRR_SHEET_ID);
  var cutoff = monthKey_(addMonths_(new Date(), -MONTHS_BACK));

  var live = readEvents_(tab_(ss, GID.live), 'l', cutoff);
  var hist = readEvents_(tab_(ss, GID.historical), 'h', cutoff);
  var events = netWithinMonth_(washCancelReactivate_(mergeFeeds_(live, hist)));

  var scheduled = readScheduled_();
  var retention = readRetention_(ss);
  var snapshots = readSnapshots_(ss);

  // Salesforce detail, only for firms that churned, are scheduled to, or sit in a retention cohort.
  var want = {};
  events.forEach(function (e) { if (e.cat === 'c') want[e.firm] = 1; });
  scheduled.forEach(function (s) { want[s.firm] = 1; });
  retention.detail.forEach(function (r) { want[r.firm] = 1; });
  var sf = readSalesforce_(tab_(ss, GID.sf), want);

  return {
    ok: true,
    built: Date.now(),
    today: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
    synced: snapshots.latest || '',
    sync: readSyncStatus_(ss),
    liveFrom: live.reduce(function (m, e) { return e.date && (!m || e.date < m) ? e.date : m; }, ''),
    events: pack_(events, EVENT_FIELDS),
    scheduled: pack_(scheduled, SCHEDULED_FIELDS),
    sf: sf,
    retention: retention,
    snapshots: snapshots.byMonth,
  };
}

var EVENT_FIELDS = ['ym', 'cat', 'amt', 'company', 'am', 'owner', 'firm', 'date', 'created', 'notPaid', 'agency', 'leads', 'src'];
var SCHEDULED_FIELDS = ['date', 'company', 'firm', 'mrr', 'agency', 'owner', 'am', 'leads', 'created'];

// Arrays instead of objects: about a third of the size on the wire.
function pack_(rows, fields) {
  return { fields: fields, rows: rows.map(function (r) { return fields.map(function (f) { return r[f] === undefined ? '' : r[f]; }); }) };
}

function tab_(ss, gid) {
  var sh = ss.getSheets().filter(function (s) { return s.getSheetId() === gid; })[0];
  if (!sh) throw new Error('MRR sheet tab ' + gid + ' is missing');
  return sh;
}

// Header-keyed rows. Values come from getValues (real dates, not "#####"), text from display values.
function rows_(sh) {
  var range = sh.getDataRange();
  var vals = range.getValues();
  var shown = range.getDisplayValues();
  var head = shown[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = {}, any = false;
    for (var j = 0; j < head.length; j++) {
      o[head[j]] = vals[i][j];
      o[head[j] + '#'] = shown[i][j];
      if (shown[i][j] !== '') any = true;
    }
    if (any) out.push(o);
  }
  return out;
}

var CATEGORY = {
  UPGRADE: 'u', REACTIVE: 'r', PAUSE_TO_PAID: 'r', DOWNGRADE: 'd',
  PAUSE_FROM_PAID: 'd', PAUSE_FROM_CANCEL: 'd', PAUSE_FROM_UNKNOWN: 'd',
  CANCEL_FROM_PAID: 'c', CANCEL_FROM_PAUSE: 'c', CANCEL_FROM_UNKNOWN: 'c',
};

function readEvents_(sh, src, cutoff) {
  var out = [];
  rows_(sh).forEach(function (r) {
    var status = String(r['Impact Sub status#']).trim().toUpperCase();
    var cat = CATEGORY[status];
    if (!cat) return;   // new business and blanks
    var company = String(r['Company#']).trim();
    if (EXCLUDED_FIRMS.test(company)) return;
    var changeYm = changeMonth_(r['Change Date#']);
    var cancel = dateKey_(r['Cancellation Date']);
    var ym = cat === 'c' && cancel ? cancel.slice(0, 7) : changeYm;
    if (!ym || ym < cutoff) return;
    out.push({
      ym: ym, changeYm: changeYm, status: status, cat: cat,
      amt: money_(r['MRR Impact']),
      company: company,
      am: name_(r['Customers.Account Manager#']),
      owner: name_(r['Customers.Owner#']),
      sub: String(r['Subscription ID#']).trim(),
      firm: firmId_(r['Customers.FirmID#']),
      date: cat === 'c' ? cancel : '',
      created: cat === 'c' ? dateKey_(r['Creation Date']) : '',   // only tenure-at-cancel needs it
      notPaid: /^not_paid$/i.test(String(r['Cancel Reason#']).trim()) ? 1 : 0,
      agency: truthy_(r['Customers.Agency Client Firm#']) ? 1 : 0,
      leads: String(r['Customers.Avg Lead Volume#'] || '').trim(),
      src: src,
    });
  });
  return out;
}

// Live wins; a historical event that's also in the live export is dropped.
function mergeFeeds_(live, hist) {
  var key = function (e) { return [e.sub, e.status, e.changeYm, Math.round(e.amt * 100)].join('|'); };
  var seen = {};
  live.forEach(function (e) { seen[key(e)] = 1; });
  return live.concat(hist.filter(function (e) { return !seen[key(e)]; }));
}

// Cancelled and reactivated in the same month: neither counts.
function washCancelReactivate_(events) {
  var groups = {};
  events.forEach(function (e) {
    if (!e.sub) return;
    var k = e.changeYm + '|' + e.sub;
    var g = groups[k] || (groups[k] = { c: 0, r: 0 });
    if (e.cat === 'c') g.c++;
    if (e.status === 'REACTIVE' || e.status === 'PAUSE_TO_PAID') g.r++;
  });
  return events.filter(function (e) {
    var g = e.sub && groups[e.changeYm + '|' + e.sub];
    if (!g || !g.c || !g.r) return true;
    return !(e.cat === 'c' || e.status === 'REACTIVE' || e.status === 'PAUSE_TO_PAID');
  });
}

// Several up/downgrades of one subscription in a month become one net change.
function netWithinMonth_(events) {
  var groups = {}, out = [];
  events.forEach(function (e) {
    if (e.sub && (e.status === 'UPGRADE' || e.status === 'DOWNGRADE')) {
      (groups[e.changeYm + '|' + e.sub] = groups[e.changeYm + '|' + e.sub] || []).push(e);
    } else out.push(e);
  });
  Object.keys(groups).forEach(function (k) {
    var g = groups[k];
    if (g.length === 1) { out.push(g[0]); return; }
    var net = g.reduce(function (s, e) { return s + e.amt; }, 0);
    if (Math.abs(net) < 0.005) return;
    var e = Object.assign({}, g[g.length - 1]);
    e.amt = Math.round(net * 100) / 100;
    e.cat = net > 0 ? 'u' : 'd';
    out.push(e);
  });
  return out;
}

function readScheduled_() {
  var sh = tab_(SpreadsheetApp.openById(CHURN_SHEET_ID), GID.scheduled);
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var out = [];
  rows_(sh).forEach(function (r) {
    var date = dateKey_(r['Cancellation Date']);
    var company = String(r['Company#']).trim();
    if (!date || date < today || EXCLUDED_FIRMS.test(company)) return;
    out.push({
      date: date, company: company,
      firm: firmId_(r['Customers.FirmID#']),
      mrr: Math.abs(money_(r['Current MRR'])),
      agency: truthy_(r['Customers.Agency Client Firm#']) ? 1 : 0,
      owner: name_(r['Customers.Owner#']),
      am: name_(r['Customers.Account Manager#']),
      leads: String(r['Customers.Avg Lead Volume#'] || '').trim(),
      created: dateKey_(r['Creation Date']),
    });
  });
  return out;
}

// firmId → [practice area, churn reason, churn details, churn score, onboarding CSAT, avg monthly leads]
function readSalesforce_(sh, want) {
  var out = {};
  rows_(sh).forEach(function (r) {
    var id = firmId_(r['Firm ID#']);
    if (!id || !want[id]) return;
    var reason = String(r['Churn Reason#']).trim();
    if (out[id] && (out[id][1] || !reason)) return;   // keep the row that has a reason
    out[id] = [
      String(r['Primary Practice Area#']).trim(), reason,
      String(r['Churn Details#']).trim().slice(0, 600),
      String(r['Primary ChurnScore#']).trim(), String(r['Onboarding CSAT#']).trim(),
      String(r['Avg Monthly Volume#']).trim(),
    ];
  });
  return out;
}

function readRetention_(ss) {
  var rate = rows_(tab_(ss, GID.rate)).map(function (r) {
    return { ym: ymNorm_(r['Checkpoint Month#']), signup: ymNorm_(r['Signup Month#']),
      cohort: num_(r['Cohort Size']), retained: num_(r['Retained']), cancelled: num_(r['Cancelled']) };
  }).filter(function (r) { return r.ym; });
  var detail = rows_(tab_(ss, GID.detail)).map(function (r) {
    return { ym: ymNorm_(r['Checkpoint Month#']), kept: /^retained$/i.test(String(r['Outcome#']).trim()) ? 1 : 0,
      date: dateKey_(r['Event Date']), company: String(r['Company#']).trim(),
      am: name_(r['Customers.Account Manager#']), owner: name_(r['Customers.Owner#']),
      firm: firmId_(r['Customers.FirmID#']), mrr: money_(r['Current MRR']), agency: truthy_(r['Agency#']) ? 1 : 0 };
  }).filter(function (r) { return r.ym && !EXCLUDED_FIRMS.test(r.company); });
  var am = rows_(tab_(ss, GID.am)).map(function (r) {
    return { am: name_(r['Account Manager#']), cohort: num_(r['Cohort Size']), retained: num_(r['Retained']) };
  }).filter(function (r) { return r.am && r.cohort; });
  return { rate: rate, detail: detail, am: am };
}

// Active MRR + customers at the start of each month (the earliest snapshot in it).
function readSnapshots_(ss) {
  var sh = ss.getSheetByName(SNAPSHOT_TAB);
  var byMonth = {}, latest = '';
  if (!sh) return { byMonth: byMonth, latest: latest };
  rows_(sh).forEach(function (r) {
    var t = r['Snapshot Time'] instanceof Date ? r['Snapshot Time'] : new Date(r['Snapshot Time']);
    if (isNaN(t)) return;
    var iso = t.toISOString();
    var ym = Utilities.formatDate(t, TZ, 'yyyy-MM');
    if (!byMonth[ym] || iso < byMonth[ym][2]) byMonth[ym] = [money_(r['Active MRR ($)']), num_(r['Active Customers']), iso];
    if (iso > latest) latest = iso;
  });
  Object.keys(byMonth).forEach(function (k) { byMonth[k] = byMonth[k].slice(0, 2); });
  return { byMonth: byMonth, latest: latest };
}

// The Chargebee sync's own status row (written by runDailySync in the MRR sheet's script).
function readSyncStatus_(ss) {
  var sh = ss.getSheetByName('Sync Status');
  if (!sh || sh.getLastRow() < 2) return null;
  var r = sh.getRange(2, 1, 1, 5).getDisplayValues()[0];
  return { lastSuccess: r[1], lastRun: r[2], result: r[3], failed: /^FAILED/.test(r[3]), error: r[4] ? 'One part of the sync failed — check the Sync Status tab.' : '' };
}

/* ---------- parsing ---------- */

function money_(v) {
  if (typeof v === 'number') return v;
  var s = String(v || '').trim();
  var neg = /^-|^\(.*\)$/.test(s);
  var n = parseFloat(s.replace(/[$,()\s-]/g, ''));
  return isNaN(n) ? 0 : (neg ? -n : n);
}
function num_(v) { var n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function truthy_(v) { return /^true$/i.test(String(v).trim()); }
function name_(v) { return String(v || '').trim().replace(/^Swetha Devakuma$/, 'Swetha Devakumar'); }

// "$4,864.00" / "4864.0" / 4864 → "4864"
function firmId_(v) {
  var s = String(v == null ? '' : v).trim();
  var n = s.replace(/[$,\s]/g, '');
  return /^\d+(\.0+)?$/.test(n) ? String(parseInt(n, 10)) : s;
}

// A Date, an ISO string, or "M/D/YY H:MM" → "YYYY-MM-DD" in Pacific time.
function dateKey_(v) {
  if (v === '' || v == null) return '';
  var d = v instanceof Date ? v : null;
  if (!d) {
    var s = String(v).trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) {
      var y = Number(m[3]); if (y < 100) y += 2000;
      d = new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2]), Number(m[4] || 0), Number(m[5] || 0)));
    } else d = new Date(s);
  }
  return isNaN(d) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

// Chargebee's change month: "Jul-26", "Jul 2026", or a date the sheet guessed from it.
var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function changeMonth_(v) {
  var m = String(v || '').trim().match(/^([A-Za-z]{3})[a-z]*[-\s](\d{2}|\d{4})$/);
  if (!m || !MON[m[1].toLowerCase()]) return '';
  var y = Number(m[2]); if (y < 100) y += 2000;
  return y + '-' + ('0' + MON[m[1].toLowerCase()]).slice(-2);
}

// "2026-1" → "2026-01"
function ymNorm_(v) {
  var m = String(v || '').trim().match(/^(\d{4})-(\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : '';
}

function monthKey_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM'); }
function addMonths_(d, n) { var x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

/* ---------- editor helpers ---------- */

// Run once from the editor: approves sheet + cache access and logs what the page will get.
function checkMrr() {
  var d = build_();
  Logger.log('events %s · scheduled %s · sf %s · retention %s/%s/%s · snapshot months %s · synced %s · live from %s',
    d.events.rows.length, d.scheduled.rows.length, Object.keys(d.sf).length,
    d.retention.rate.length, d.retention.detail.length, d.retention.am.length,
    Object.keys(d.snapshots).length, d.synced, d.liveFrom);
  Logger.log('payload %s KB', Math.round(JSON.stringify(d).length / 1024));
}
