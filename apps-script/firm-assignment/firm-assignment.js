/* ==========================================================================
   New Firm Assignment — backs the dashboard's "New Firm Assignment" page
   (Clare, Johnny and Justin only).
   --------------------------------------------------------------------------
   Replaces Clare's manual ChurnZero routine: spot the new firm, decide which
   AM is due for an onboarding, set the owner + Onboarding Type = Premium, and
   start the pre-kickoff play.

   load    → live from ChurnZero: the unassigned queue (active, Pre-Kickoff, no
             owner, started in the last QUEUE_DAYS), each AM's load, and a ranked
             suggestion per firm with the reasons behind it.
   assign  → writes the owner + Implementation Type through ChurnZero's HTTP
             (write) API, reads the account back to confirm, and logs the
             decision (suggested vs chosen) to the "Firm Assignment Log" tab.
   setRotation → include/skip an AM from suggestions (e.g. while out of office).

   The pre-kickoff play (#189 "Onboarding New Customer Kickoff (NEW)") can't be
   started through any ChurnZero API. The page links straight to the account so
   it's one click; or set the play to auto-start from a segment (owner set +
   Premium + Pre-Kickoff) and it fires on its own after Assign.

   Script Properties:
     CZ_USER, CZ_KEY   read API (same values as the Support Team Report script)
     CZ_APP_KEY        ChurnZero Admin → Application Keys (write API). Assign is
                       disabled until this is set.
     CZ_OWNER_ATTR     optional, attribute name for the owner (default OwnerUserAccount)
     CZ_TYPE_ATTR      optional, attribute name for Onboarding Type (default ImplementationType)

   Deploy: Web app · Execute as: Me · Who has access: Anyone. Each request must
   carry a Google access token issued to the dashboard client for an ALLOWED user.
   Redeploy with `clasp update-deployment <id>` to keep the URL.
   ========================================================================== */

var DASHBOARD_CLIENT_ID = '1056458394718-fk8r113mqg2f55a9il4d4kg2a745d3ns.apps.googleusercontent.com';
var ALLOWED = ['justin.shephard@lawmatics.com', 'clare@lawmatics.com', 'johnny@lawmatics.com'];
var CZ_BASE = 'https://lawmatics.us1app.churnzero.net/public/v1';
var CZ_WRITE = 'https://lawmatics.us1app.churnzero.net/i';
var LOG_SHEET_ID = '1eqPYnDmD194GREzSIlfceLWmQyaBRW18mptL_uVRKCc'; // Support Team Report 2026
var LOG_TAB = 'Firm Assignment Log';
var LOG_HEADERS = ['When', 'By', 'Firm', 'Firm ID', 'CZ Account', 'MRR', 'Suggested', 'Assigned', 'Took suggestion', 'Confirmed in ChurnZero', 'Note'];
var QUEUE_DAYS = 60;
var OPEN_STATUSES = ['Pre-Kickoff', 'Open'];
var MIN_START = '2025-01-01';
var PREMIUM = 'Premium Onboarding';
// How much each factor counts toward the suggestion (sums to 100).
var WEIGHTS = { open: 40, since: 30, book: 15, value: 15 };
// High-MRR tier: these AMs only get firms at or above the threshold, and those
// firms go only to them. Both are editable on the page (stored in TIER).
var TIER_DEFAULT = { reps: { 7: true, 71: true }, min: 1000 }; // Elliott Jones, Julio Ortiz

function authorize() {
  SpreadsheetApp.openById(LOG_SHEET_ID);
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=x', { muteHttpExceptions: true });
  Logger.log(JSON.stringify(load_()).slice(0, 2000));
}

function doGet() {
  return json_({ ok: true, message: 'New Firm Assignment endpoint is live.' });
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  try {
    var who = verify_(b.token);
    if (!who.ok) return json_(who);
    if (b.action === 'load') return json_(load_());
    if (b.action === 'assign') return json_(assign_(b, who.email));
    if (b.action === 'setRotation') return json_(setRotation_(b));
    if (b.action === 'setTier') return json_(setTier_(b));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- ChurnZero reads ---------- */

function czHeaders_() {
  var p = PropertiesService.getScriptProperties();
  var user = p.getProperty('CZ_USER'), key = p.getProperty('CZ_KEY');
  if (!user || !key) throw new Error('Set CZ_USER and CZ_KEY in Script Properties.');
  return { Authorization: 'Basic ' + Utilities.base64Encode(user + ':' + key) };
}

function czGet_(path, params) {
  var qs = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  var url = CZ_BASE + path + (qs ? '?' + qs : ''), out = [], guard = 0, headers = czHeaders_();
  while (url && guard++ < 200) {
    var res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('ChurnZero HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    var body = JSON.parse(res.getContentText());
    out = out.concat(body.value || []);
    url = body['@odata.nextLink'] || null;
  }
  return out;
}

function users_() {
  var map = {};
  czGet_('/UserAccount', { $select: 'Id,FirstName,LastName,Email,IsActive', $top: 100 }).forEach(function (u) {
    map[u.Id] = { id: u.Id, name: (String(u.FirstName || '').trim() + ' ' + String(u.LastName || '').trim()).trim(), email: u.Email, active: u.IsActive };
  });
  return map;
}

function sinceIso_(days) {
  return new Date(Date.now() - days * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
}

function load_() {
  var users = users_();
  var owned = czGet_('/Account', {
    $filter: 'IsActive eq true and UserAccountId ne null',
    $select: 'Id,StartDate,TotalContractAmount,UserAccountId,Cf', $top: 100,
  });
  var queueRaw = czGet_('/Account', {
    $filter: "IsActive eq true and UserAccountId eq null and Cf/OnboardingStatus eq 'Pre-Kickoff' and StartDate ge " + sinceIso_(QUEUE_DAYS),
    $select: 'Id,Name,ExternalId,StartDate,TotalContractAmount,LicenseCount,Cf', $top: 100,
  });

  // Per-owner load. The rotation = owners with an AM name who have an open onboarding.
  var reps = {};
  owned.forEach(function (a) {
    var cf = a.Cf || {}, id = a.UserAccountId;
    var r = reps[id] || (reps[id] = { id: id, name: (users[id] && users[id].name) || cf.AccountManager || ('User ' + id),
      am: false, firms: 0, mrr: 0, open: 0, openMrr: 0, lastStart: '' });
    if (cf.AccountManager) r.am = true;
    r.firms++;
    r.mrr += Number(a.TotalContractAmount) || 0;
    var start = String(a.StartDate || '').slice(0, 10);
    if (OPEN_STATUSES.indexOf(cf.OnboardingStatus) > -1 && start >= MIN_START) {
      r.open++;
      r.openMrr += Number(a.TotalContractAmount) || 0;
    }
    if (start > r.lastStart) r.lastStart = start;
  });

  // Assignments made from this page count as the rep's most recent assignment too.
  var log = readLog_(200);
  log.forEach(function (l) {
    var r = reps[l.userId];
    if (r && l.when.slice(0, 10) > r.lastStart) r.lastStart = l.when.slice(0, 10);
  });

  var skipped = rotationSkips_();
  var tier = tier_();
  var rotation = Object.keys(reps).map(function (k) { return reps[k]; })
    .filter(function (r) { return r.am && r.open > 0; })
    .map(function (r) {
      r.email = users[r.id] ? users[r.id].email : '';
      r.included = !skipped[r.id];
      r.high = !!tier.reps[r.id];
      r.mrr = Math.round(r.mrr); r.openMrr = Math.round(r.openMrr);
      return r;
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });

  var queue = queueRaw.map(function (a) {
    var cf = a.Cf || {};
    var ae = users[cf.OwnerId];
    return {
      czId: a.Id, firmId: String(cf.FirmId || a.ExternalId || ''), externalId: a.ExternalId, name: a.Name,
      start: String(a.StartDate || '').slice(0, 10), mrr: Number(a.TotalContractAmount) || 0,
      licenses: a.LicenseCount || '', ae: ae ? ae.name : '',
      practice: [].concat(cf.PracticeArea || []).join(', '),
      type: cf.ImplementationType || '',
      flags: [cf.AgencyFirm && 'Agency', cf.AgencyClientFirm && 'Agency client', cf.Consultant && 'Consultant',
        cf.PartnerType && String(cf.PartnerType)].filter(Boolean),
      notes: {
        sales: cf.SalesOnboardingNotes || '', intake: cf.IntakeProcess || '', challenges: cf.KeyChallenges || '',
        aiDemo: cf.AiDemoNotes || '',
      },
      links: { deck: cf.OnboardingDeckLink || '', docs: cf.OnboardingDocumentsFolder || '' },
    };
  }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });

  suggest_(queue, rotation, tier.min);
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true, queue: queue, reps: rotation, weights: WEIGHTS, highMin: tier.min, recent: log.slice(0, 25),
    canWrite: !!props.getProperty('CZ_APP_KEY'), generated: new Date().toISOString(),
  };
}

/* ---------- suggestion ----------
   Each included rep gets 0–100: fewer open onboardings, longer since their
   last new firm, smaller book, and less onboarding MRR in flight all score
   higher. Firms are suggested oldest first, and each pick counts against that
   rep for the next firm, so a batch of three new firms spreads out. */

function suggest_(queue, reps, highMin) {
  var all = reps.filter(function (r) { return r.included; })
    .map(function (r) { return { r: r, open: r.open, openMrr: r.openMrr, firms: r.firms, lastStart: r.lastStart }; });
  var today = new Date();
  queue.forEach(function (f) {
    f.high = f.mrr >= highMin;
    // Score only the tier this firm belongs to; fall back to everyone if that tier is empty.
    var sim = all.filter(function (s) { return !!s.r.high === f.high; });
    f.tierFallback = !sim.length;
    if (!sim.length) sim = all;
    if (!sim.length) { f.ranking = []; return; }
    var days = function (s) { return s.lastStart ? Math.max(0, Math.round((today - new Date(s.lastStart + 'T12:00:00')) / 864e5)) : 365; };
    var norm = function (vals, higherIsBetter) {
      var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
      return vals.map(function (v) { return mx === mn ? 1 : (higherIsBetter ? (v - mn) / (mx - mn) : (mx - v) / (mx - mn)); });
    };
    var o = norm(sim.map(function (s) { return s.open; }), false);
    var d = norm(sim.map(days), true);
    var b = norm(sim.map(function (s) { return s.firms; }), false);
    var v = norm(sim.map(function (s) { return s.openMrr; }), false);
    var ranked = sim.map(function (s, i) {
      return {
        userId: s.r.id, name: s.r.name,
        score: Math.round(o[i] * WEIGHTS.open + d[i] * WEIGHTS.since + b[i] * WEIGHTS.book + v[i] * WEIGHTS.value),
        open: s.open, daysSince: days(s), firms: s.firms, openMrr: Math.round(s.openMrr),
      };
    }).sort(function (x, y) { return y.score - x.score || x.open - y.open || y.daysSince - x.daysSince; });
    // Everyone else stays pickable in the dropdown, unscored.
    all.forEach(function (s) {
      if (sim.indexOf(s) === -1) ranked.push({ userId: s.r.id, name: s.r.name, score: null, outside: true,
        open: s.open, daysSince: days(s), firms: s.firms, openMrr: Math.round(s.openMrr) });
    });
    f.ranking = ranked;
    var top = sim.filter(function (s) { return s.r.id === ranked[0].userId; })[0];
    top.open++; top.firms++; top.openMrr += f.mrr; top.lastStart = Utilities.formatDate(today, 'America/Los_Angeles', 'yyyy-MM-dd');
  });
}

/* ---------- writes ---------- */

function assign_(b, by) {
  var props = PropertiesService.getScriptProperties();
  var appKey = props.getProperty('CZ_APP_KEY');
  if (!appKey) throw new Error('ChurnZero write key (CZ_APP_KEY) isn’t set up yet.');
  if (!b.czId || !b.externalId || !b.userId) throw new Error('missing firm or rep');

  // Re-read the account so a firm someone already assigned in ChurnZero isn't overwritten.
  var acct = czGet_('/Account', { $filter: 'Id eq ' + Number(b.czId), $select: 'Id,Name,ExternalId,UserAccountId,TotalContractAmount,Cf' })[0];
  if (!acct) throw new Error('account not found in ChurnZero');
  if (acct.UserAccountId && acct.UserAccountId !== Number(b.userId)) {
    throw new Error(acct.Name + ' was already assigned in ChurnZero. Reload to refresh the queue.');
  }
  var users = users_(), rep = users[b.userId];
  if (!rep || !rep.active) throw new Error('unknown or inactive ChurnZero user');

  var ownerAttr = props.getProperty('CZ_OWNER_ATTR') || 'OwnerUserAccount';
  var typeAttr = props.getProperty('CZ_TYPE_ATTR') || 'ImplementationType';
  czSet_(appKey, acct.ExternalId, ownerAttr, rep.email);
  czSet_(appKey, acct.ExternalId, typeAttr, PREMIUM);

  // ChurnZero applies writes asynchronously; check back a few times.
  var confirmed = false, after = null;
  for (var i = 0; i < 4 && !confirmed; i++) {
    Utilities.sleep(2500);
    after = czGet_('/Account', { $filter: 'Id eq ' + Number(b.czId), $select: 'Id,UserAccountId,Cf' })[0];
    confirmed = !!after && after.UserAccountId === Number(b.userId) && (after.Cf || {}).ImplementationType === PREMIUM;
  }
  appendLog_({
    by: by, firm: acct.Name, firmId: String((acct.Cf || {}).FirmId || acct.ExternalId), czId: acct.Id,
    mrr: acct.TotalContractAmount, suggested: b.suggestedName || '', assigned: rep.name, userId: rep.id,
    took: b.suggestedId ? String(Number(b.suggestedId) === Number(b.userId)) : '', confirmed: confirmed, note: b.note || '',
  });
  return {
    ok: true, confirmed: confirmed,
    owner: after ? after.UserAccountId : null, type: after ? (after.Cf || {}).ImplementationType : null,
  };
}

function czSet_(appKey, externalId, name, value) {
  var payload = { appKey: appKey, accountExternalId: externalId, action: 'setAttribute', entity: 'account', name: name, value: value };
  var res = UrlFetchApp.fetch(CZ_WRITE, { method: 'post', payload: payload, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error('ChurnZero write ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
}

function rotationSkips_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('ROTATION_SKIP') || '{}'); } catch (e) { return {}; }
}

function setRotation_(b) {
  var skip = rotationSkips_();
  if (b.included) delete skip[b.userId]; else skip[b.userId] = true;
  PropertiesService.getScriptProperties().setProperty('ROTATION_SKIP', JSON.stringify(skip));
  return load_();
}

function tier_() {
  try {
    var t = JSON.parse(PropertiesService.getScriptProperties().getProperty('TIER') || 'null');
    return t && t.reps ? t : TIER_DEFAULT;
  } catch (e) { return TIER_DEFAULT; }
}

function setTier_(b) {
  var t = tier_();
  if (b.userId != null) { if (b.high) t.reps[b.userId] = true; else delete t.reps[b.userId]; }
  if (b.min != null) {
    var m = Number(b.min);
    if (!(m >= 0)) throw new Error('enter a dollar amount');
    t.min = m;
  }
  PropertiesService.getScriptProperties().setProperty('TIER', JSON.stringify(t));
  return load_();
}

/* ---------- log ---------- */

function logSheet_() {
  var ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  var sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB);
    sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function appendLog_(x) {
  var sh = logSheet_();
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, LOG_HEADERS.length).setValues([[
    Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'), x.by, x.firm, x.firmId, x.czId,
    x.mrr || '', x.suggested, x.assigned + ' #' + x.userId, x.took, x.confirmed ? 'yes' : 'pending', x.note,
  ]]);
}

function readLog_(max) {
  var ss = SpreadsheetApp.openById(LOG_SHEET_ID), sh = ss.getSheetByName(LOG_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  var n = Math.min(max, sh.getLastRow() - 1);
  return sh.getRange(2, 1, n, LOG_HEADERS.length).getDisplayValues().map(function (r) {
    var m = /#(\d+)$/.exec(r[7]);
    return { when: r[0], by: r[1], firm: r[2], firmId: r[3], mrr: r[5], suggested: r[6],
      assigned: r[7].replace(/\s*#\d+$/, ''), userId: m ? Number(m[1]) : null, took: r[8], confirmed: r[9] };
  });
}

/* ---------- auth ---------- */

function verify_(token) {
  if (!token) return { ok: false, error: 'not signed in' };
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var email = cache.get(key);
  if (!email) {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { ok: false, error: 'session expired — reload the dashboard' };
    var info = JSON.parse(res.getContentText());
    var audOk = info.aud === DASHBOARD_CLIENT_ID || info.azp === DASHBOARD_CLIENT_ID;
    email = String(info.email || '').toLowerCase();
    if (!audOk || String(info.email_verified) !== 'true') return { ok: false, error: 'not allowed' };
    cache.put(key, email, 300);
  }
  if (ALLOWED.indexOf(email) === -1) return { ok: false, error: 'New Firm Assignment is limited to Clare, Johnny and Justin.' };
  return { ok: true, email: email };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
