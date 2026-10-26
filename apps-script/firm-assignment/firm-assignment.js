/* ==========================================================================
   New Firm Assignment — backs the dashboard's "New Firm Assignment" page
   (managers only).
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

var CZ_BASE = 'https://lawmatics.us1app.churnzero.net/public/v1';
var CZ_WRITE = 'https://lawmatics.us1app.churnzero.net/i';
var LOG_SHEET_ID = '1eqPYnDmD194GREzSIlfceLWmQyaBRW18mptL_uVRKCc'; // Support Team Report 2026
var LOG_TAB = 'Firm Assignment Log';
// Assigned = the IM. CSM and Owner were added for the IM/CSM split (older rows leave them blank).
var LOG_HEADERS = ['When', 'By', 'Firm', 'Firm ID', 'CZ Account', 'MRR', 'Suggested', 'Assigned', 'Took suggestion', 'Confirmed in ChurnZero', 'Note',
  'Suggested CSM', 'CSM', 'Owner'];
var QUEUE_DAYS = 60;
var OPEN_STATUSES = ['Pre-Kickoff', 'Open'];
var MIN_START = '2025-01-01';
var PREMIUM = 'Premium Onboarding';
// How much each factor counts toward the suggestion (sums to 100).
var WEIGHTS = { open: 40, since: 30, book: 15, value: 15 };
// High-MRR tier: these AMs only get firms at or above the threshold, and those
// firms go only to them. Both are editable on the page (stored in TIER).
// Partner-sourced firms (closed-won opp Lead Source starts with "Partner") always go to Kennedy.
var PARTNER_REP_ID = 11; // Kennedy Wickham's ChurnZero user (not the duplicate #120)
var TIER_DEFAULT = { reps: {}, min: 1000 };

/* IM/CSM split. Every new firm gets an Implementation Manager; firms over CSM_MIN also get a CSM,
   who is the Owner. Under that the IM is the Owner (Support takes over when onboarding completes).
   The IM and CSM go into two text fields that sync with Salesforce; a ChurnZero play sets the
   roles from them (the roles themselves can't be written through the API). Partner-sourced firms
   get Kennedy for both. Names as they appear in ChurnZero. */
var IM_ROSTER = ['Callie Burns', 'Admir Karamovic', 'Andy Galindo', 'Swetha Devakumar'];
var CSM_ROSTER = ['Elliott Jones', 'Julio Ortiz', 'Jessie Hobbs'];   // biggest firms first
var CSM_MIN = 400;                        // a CSM only when MRR is over this
var CSM_BANDS_DEFAULT = { top: 850, mid: 550 };   // ≈ thirds of 2026's new firms over $400
var CSM_WEIGHTS = { fit: 50, book: 25, since: 25 };
var IM_FIELD = 'ImplementationManager', CSM_FIELD = 'CustomerSuccessManager';
// The live page runs from this same project and shares its Script Properties. Until the split goes
// live, this version keeps its rotation / tier / band settings under their own names so trying it
// out can't change the live page's suggestions. Set to '' at go-live.
var SPLIT_PROP = 'SPLIT_';

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
    if (b.action === 'load') return json_(load_(!!b.force));
    if (b.action === 'assign') return json_(assign_(b, who.email));
    if (b.action === 'setRotation') return json_(setRotation_(b));
    if (b.action === 'setTier') return json_(setTier_(b));
    if (b.action === 'setCsmBands') return json_(setCsmBands_(b));
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
    if (res.getResponseCode() !== 200) { console.error('ChurnZero ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500)); throw new Error('ChurnZero didn’t respond (HTTP ' + res.getResponseCode() + '). Try Refresh in a minute.'); }
    var body = JSON.parse(res.getContentText());
    out = out.concat(body.value || []);
    url = body['@odata.nextLink'] || null;
  }
  return out;
}

function qs_(params) {
  return Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
}

// Several OData reads at once: first pages in parallel (with $count), then every
// remaining page in parallel via $skip. Returns one array of rows per request.
function czGetMany_(reqs) {
  var headers = czHeaders_();
  var fetch = function (urls) {
    return UrlFetchApp.fetchAll(urls.map(function (u) { return { url: u, headers: headers, muteHttpExceptions: true }; }))
      .map(function (res) {
        if (res.getResponseCode() !== 200) { console.error('ChurnZero ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500)); throw new Error('ChurnZero didn’t respond (HTTP ' + res.getResponseCode() + '). Try Refresh in a minute.'); }
        return JSON.parse(res.getContentText());
      });
  };
  var base = reqs.map(function (r) {
    var p = {}; Object.keys(r.params).forEach(function (k) { p[k] = r.params[k]; });
    p.$top = 100;
    return { path: r.path, params: p };
  });
  var first = fetch(base.map(function (r) { var p = JSON.parse(JSON.stringify(r.params)); p.$count = 'true'; return CZ_BASE + r.path + '?' + qs_(p); }));
  var out = first.map(function (b) { return b.value || []; });
  var more = [];
  first.forEach(function (b, i) {
    var total = b['@odata.count'] || 0;
    for (var skip = 100; skip < total; skip += 100) {
      var p = JSON.parse(JSON.stringify(base[i].params)); p.$skip = skip;
      more.push({ i: i, skip: skip, url: CZ_BASE + base[i].path + '?' + qs_(p) });
    }
  });
  if (more.length) {
    fetch(more.map(function (m) { return m.url; })).forEach(function (b, k) { out[more[k].i] = out[more[k].i].concat(b.value || []); });
  }
  return out;
}

function userMap_(rows) {
  var map = {};
  rows.forEach(function (u) {
    map[u.Id] = { id: u.Id, name: (String(u.FirstName || '').trim() + ' ' + String(u.LastName || '').trim()).trim(), email: u.Email, active: u.IsActive };
  });
  return map;
}

function users_() {
  var map = {};
  czGet_('/UserAccount', { $select: 'Id,FirstName,LastName,Email,IsActive', $top: 100 }).forEach(function (u) {
    map[u.Id] = { id: u.Id, name: (String(u.FirstName || '').trim() + ' ' + String(u.LastName || '').trim()).trim(), email: u.Email, active: u.IsActive };
  });
  return map;
}

// "5567" or "5567~|~001Pj…" → 5567 (0 when there's no Firm ID).
function firmNum_(v) {
  var m = String(v == null ? '' : v).match(/^\d+/);
  return m ? Number(m[0]) : 0;
}

function sinceIso_(days) {
  return new Date(Date.now() - days * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
}

var QUEUE_CF = ['FirmId', 'OwnerId', 'PracticeArea', 'ImplementationType', 'AgencyFirm', 'AgencyClientFirm', 'Consultant',
  'PartnerType', 'SalesOnboardingNotes', 'IntakeProcess', 'KeyChallenges', 'AiDemoNotes', 'OnboardingDeckLink', 'OnboardingDocumentsFolder'];
var LOAD_CACHE_SECONDS = 60;

function load_(force) {
  var cache = CacheService.getScriptCache();
  if (!force) {
    var hit = cache.get(SPLIT_PROP + 'load');
    if (hit) return JSON.parse(hit);
  }
  var out = buildLoad_();
  try { cache.put(SPLIT_PROP + 'load', JSON.stringify(out), LOAD_CACHE_SECONDS); } catch (e) { /* over 100KB: skip caching */ }
  return out;
}

function clearLoadCache_() { CacheService.getScriptCache().remove(SPLIT_PROP + 'load'); }

function buildLoad_() {
  // Only the fields we use: pulling every custom field made each 100-row page ~600 KB.
  var got = czGetMany_([
    { path: '/UserAccount', params: { $select: 'Id,FirstName,LastName,Email,IsActive' } },
    { path: '/Account', params: { $filter: 'IsActive eq true and UserAccountId ne null',
      $select: 'Id,ExternalId,StartDate,TotalContractAmount,UserAccountId,Cf/AccountManager,Cf/OnboardingStatus,Cf/' + IM_FIELD + ',Cf/' + CSM_FIELD } },
    { path: '/Account', params: {
      // A brand-new firm can reach ChurnZero before its start date does, so a blank start counts as new.
      $filter: "IsActive eq true and UserAccountId eq null and Cf/OnboardingStatus eq 'Pre-Kickoff' and (StartDate ge " + sinceIso_(QUEUE_DAYS) + ' or StartDate eq null)',
      $select: 'Id,Name,ExternalId,StartDate,TotalContractAmount,LicenseCount,' + QUEUE_CF.map(function (f) { return 'Cf/' + f; }).join(',') } },
  ]);
  var users = userMap_(got[0]), owned = got[1], queueRaw = got[2];

  // A blank start date only counts as new for a recent firm. Firm IDs are handed out in order, so
  // it must be at least the 20th-percentile Firm ID of firms that did start in the window (the
  // percentile skips old firms that re-signed). Old records with no start date stay out.
  var since = sinceIso_(QUEUE_DAYS);
  var recent = owned.concat(queueRaw).filter(function (a) { return a.StartDate && String(a.StartDate) >= since; })
    .map(function (a) { return firmNum_(a.ExternalId); }).filter(Boolean).sort(function (x, y) { return x - y; });
  var newFrom = recent.length ? recent[Math.floor(recent.length * 0.2)] : Infinity;
  queueRaw = queueRaw.filter(function (a) { return a.StartDate || firmNum_(a.ExternalId) >= newFrom; });

  // Load per rep. IMs: the firms they're onboarding (the IM field on new firms, the owner on older
  // ones). CSMs: the firms they own, plus new firms already handed to them in the CSM field.
  var byName = usersByName_(users);
  var blank = function () { return { firms: 0, mrr: 0, open: 0, openMrr: 0, lastStart: '' }; };
  var imStat = {}, csmStat = {};
  var add = function (map, id, a, cf) {
    if (!id) return;
    var r = map[id] || (map[id] = blank());
    var start = String(a.StartDate || '').slice(0, 10), mrr = Number(a.TotalContractAmount) || 0;
    r.firms++;
    r.mrr += mrr;
    if (OPEN_STATUSES.indexOf(cf.OnboardingStatus) > -1 && start >= MIN_START) { r.open++; r.openMrr += mrr; }
    if (start > r.lastStart) r.lastStart = start;
  };
  owned.forEach(function (a) {
    var cf = a.Cf || {};
    var im = cfGet_(cf, IM_FIELD), csm = cfGet_(cf, CSM_FIELD);
    add(imStat, im ? byName[im] : a.UserAccountId, a, cf);
    add(csmStat, csm ? byName[csm] : a.UserAccountId, a, cf);
  });

  // Assignments made from this page count as the rep's most recent assignment too.
  var log = readLog_(200);
  log.forEach(function (l) {
    var day = l.when.slice(0, 10);
    if (imStat[l.userId] && day > imStat[l.userId].lastStart) imStat[l.userId].lastStart = day;
    if (csmStat[l.csmId] && day > csmStat[l.csmId].lastStart) csmStat[l.csmId].lastStart = day;
  });

  var skipped = rotationSkips_();
  var tier = tier_();
  var roster = function (names, stats, role) {
    return names.map(function (n) {
      var id = byName[n];
      if (!id) return null;
      var r = stats[id] || blank();
      return { id: id, name: users[id].name, email: users[id].email, role: role, included: !skipped[id], high: role === 'IM' && !!tier.reps[id],
        firms: r.firms, mrr: Math.round(r.mrr), open: r.open, openMrr: Math.round(r.openMrr), lastStart: r.lastStart };
    }).filter(Boolean);
  };
  var rotation = roster(IM_ROSTER, imStat, 'IM');
  var csms = roster(CSM_ROSTER, csmStat, 'CSM');

  // Agency and agency-client firms aren't assigned through this rotation.
  var queue = queueRaw.filter(function (a) { var cf = a.Cf || {}; return !cf.AgencyFirm && !cf.AgencyClientFirm; }).map(function (a) {
    var cf = a.Cf || {};
    var ae = users[cf.OwnerId];
    return {
      czId: a.Id, firmId: String(cf.FirmId || a.ExternalId || ''), externalId: a.ExternalId, name: a.Name,
      start: String(a.StartDate || '').slice(0, 10), mrr: Number(a.TotalContractAmount) || 0,
      licenses: a.LicenseCount || '', ae: ae ? ae.name : '',
      practice: [].concat(cf.PracticeArea || []).join(', '),
      type: cf.ImplementationType || '',
      flags: [cf.Consultant && 'Consultant',
        cf.PartnerType && String(cf.PartnerType)].filter(Boolean),
      notes: {
        sales: cf.SalesOnboardingNotes || '', intake: cf.IntakeProcess || '', challenges: cf.KeyChallenges || '',
        aiDemo: cf.AiDemoNotes || '',
      },
      links: { deck: cf.OnboardingDeckLink || '', docs: cf.OnboardingDocumentsFolder || '' },
      leadSource: '', leadSourceDetail: '', partner: false, contacts: [], onboardingContacts: [],
    };
  }).sort(function (a, b) { return (a.start || '9999') < (b.start || '9999') ? -1 : 1; });   // no start date yet = newest

  addQueueDetails_(queue);
  var partner = function (stats) {
    var pr = stats[PARTNER_REP_ID];
    return { id: PARTNER_REP_ID, name: (users[PARTNER_REP_ID] && users[PARTNER_REP_ID].name) || 'Kennedy Wickham',
      open: pr ? pr.open : 0, firms: pr ? pr.firms : 0, openMrr: pr ? Math.round(pr.openMrr) : 0, lastStart: pr ? pr.lastStart : '' };
  };
  var bands = csmBands_();
  suggest_(queue, rotation, tier.min, partner(imStat));
  suggestCsm_(queue, csms, bands, partner(csmStat));
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true, queue: queue, reps: rotation, csms: csms, weights: WEIGHTS, csmWeights: CSM_WEIGHTS, highMin: tier.min,
    csmMin: CSM_MIN, bands: bands, recent: log.slice(0, 10),
    stats: { judged: log.filter(function (l) { return l.took; }).length, took: log.filter(function (l) { return /^true$/i.test(l.took); }).length },
    canWrite: !!props.getProperty('CZ_APP_KEY'), generated: new Date().toISOString(),
  };
}

/* ---------- suggestion ----------
   Each included rep gets 0–100: fewer open onboardings, longer since their
   last new firm, smaller book, and less onboarding MRR in flight all score
   higher. Firms are suggested oldest first, and each pick counts against that
   rep for the next firm, so a batch of three new firms spreads out. */

function suggest_(queue, reps, highMin, partnerRep) {
  var all = reps.filter(function (r) { return r.included; })
    .map(function (r) { return { r: r, open: r.open, openMrr: r.openMrr, firms: r.firms, lastStart: r.lastStart }; });
  var today = new Date();
  queue.forEach(function (f) {
    f.high = f.mrr >= highMin;
    // Score only the tier this firm belongs to; fall back to everyone if that tier is empty.
    var sim = all.filter(function (s) { return !!s.r.high === f.high; });
    f.tierFallback = !sim.length;
    if (!sim.length) sim = all;
    if (!sim.length && !f.partner) { f.ranking = []; return; }
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
        parts: { open: Math.round(o[i] * WEIGHTS.open), since: Math.round(d[i] * WEIGHTS.since),
          book: Math.round(b[i] * WEIGHTS.book), value: Math.round(v[i] * WEIGHTS.value) },
        open: s.open, daysSince: days(s), firms: s.firms, openMrr: Math.round(s.openMrr),
      };
    }).sort(function (x, y) { return y.score - x.score || x.open - y.open || y.daysSince - x.daysSince; });
    // Everyone else stays pickable in the dropdown, unscored.
    all.forEach(function (s) {
      if (sim.indexOf(s) === -1) ranked.push({ userId: s.r.id, name: s.r.name, score: null, outside: true,
        open: s.open, daysSince: days(s), firms: s.firms, openMrr: Math.round(s.openMrr) });
    });
    f.ranking = ranked;
    if (f.partner) {
      ranked = ranked.filter(function (x) { return x.userId !== partnerRep.id; });
      ranked.unshift({ userId: partnerRep.id, name: partnerRep.name, score: null, partnerRule: true,
        open: partnerRep.open, daysSince: partnerRep.lastStart ? Math.max(0, Math.round((today - new Date(partnerRep.lastStart + 'T12:00:00')) / 864e5)) : 365,
        firms: partnerRep.firms, openMrr: partnerRep.openMrr });
      f.ranking = ranked;
      partnerRep.open++; partnerRep.firms++; partnerRep.openMrr += f.mrr;
    }
    var top = all.filter(function (s) { return s.r.id === ranked[0].userId; })[0];
    if (!top) return;
    top.open++; top.firms++; top.openMrr += f.mrr; top.lastStart = Utilities.formatDate(today, 'America/Los_Angeles', 'yyyy-MM-dd');
  });
}

/* CSM suggestion, for firms over CSM_MIN. Each CSM covers a size band, biggest firms first
   (CSM_ROSTER order): the band's CSM gets full fit points, the next band over half. Book size
   (fewest firms) and time since their last new firm make up the rest. Partner firms go to Kennedy. */
function suggestCsm_(queue, csms, bands, partnerRep) {
  var all = csms.filter(function (r) { return r.included; })
    .map(function (r) { return { r: r, firms: r.firms, lastStart: r.lastStart, idx: CSM_ROSTER.indexOf(r.name) }; });
  var today = new Date();
  var days = function (d) { return d ? Math.max(0, Math.round((today - new Date(d + 'T12:00:00')) / 864e5)) : 365; };
  queue.forEach(function (f) {
    f.needsCsm = f.mrr > CSM_MIN;
    f.csmRanking = [];
    if (!f.needsCsm) return;
    f.band = f.mrr >= bands.top ? 0 : f.mrr >= bands.mid ? 1 : 2;
    var norm = function (vals, higherIsBetter) {
      var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
      return vals.map(function (v) { return mx === mn ? 1 : (higherIsBetter ? (v - mn) / (mx - mn) : (mx - v) / (mx - mn)); });
    };
    var b = norm(all.map(function (s) { return s.firms; }), false);
    var d = norm(all.map(function (s) { return days(s.lastStart); }), true);
    var ranked = all.map(function (s, i) {
      var fit = Math.max(0, 1 - Math.abs(s.idx - f.band) / 2);
      var parts = { fit: Math.round(fit * CSM_WEIGHTS.fit), book: Math.round(b[i] * CSM_WEIGHTS.book), since: Math.round(d[i] * CSM_WEIGHTS.since) };
      return { userId: s.r.id, name: s.r.name, score: parts.fit + parts.book + parts.since, parts: parts,
        firms: s.firms, daysSince: days(s.lastStart), bandFit: s.idx === f.band };
    }).sort(function (x, y) { return y.score - x.score || x.firms - y.firms; });
    if (f.partner) {
      ranked = ranked.filter(function (x) { return x.userId !== partnerRep.id; });
      ranked.unshift({ userId: partnerRep.id, name: partnerRep.name, score: null, partnerRule: true,
        firms: partnerRep.firms, daysSince: days(partnerRep.lastStart) });
      partnerRep.firms++;
    }
    f.csmRanking = ranked;
    var top = all.filter(function (s) { return ranked[0] && s.r.id === ranked[0].userId; })[0];
    if (top) { top.firms++; top.lastStart = Utilities.formatDate(today, 'America/Los_Angeles', 'yyyy-MM-dd'); }
  });
}

function csmBands_() {
  try {
    var b = JSON.parse(PropertiesService.getScriptProperties().getProperty(SPLIT_PROP + 'CSM_BANDS') || 'null');
    return b && b.top > b.mid ? b : CSM_BANDS_DEFAULT;
  } catch (e) { return CSM_BANDS_DEFAULT; }
}

function setCsmBands_(b) {
  var top = Number(b.top), mid = Number(b.mid);
  if (!(mid > CSM_MIN && top > mid)) throw new Error('the top band must start above the middle one, and both above $' + CSM_MIN);
  PropertiesService.getScriptProperties().setProperty(SPLIT_PROP + 'CSM_BANDS', JSON.stringify({ top: top, mid: mid }));
  return load_(true);
}

// Active ChurnZero users by full name (Kennedy has a duplicate user; the partner rep wins).
function usersByName_(users) {
  var by = {};
  Object.keys(users).forEach(function (id) {
    var u = users[id];
    if (u.active && u.name && (!by[u.name] || Number(id) === PARTNER_REP_ID)) by[u.name] = Number(id);
  });
  return by;
}

// ChurnZero hands custom field keys back in whatever case they were first created in.
function cfGet_(cf, name) {
  var want = name.toLowerCase();
  for (var k in cf) if (k.toLowerCase() === want) return cf[k] == null ? '' : String(cf[k]).trim();
  return '';
}

function addQueueDetails_(queue) {
  if (!queue.length) return;
  var ids = queue.map(function (f) { return 'AccountId eq ' + Number(f.czId); }).join(' or ');
  var got = czGetMany_([
    { path: '/CustomListOpportunity', params: { $filter: '(' + ids + ') and Won eq true', $select: 'AccountId,LeadSource,LeadSourceDetail,CreatedDate' } },
    { path: '/Contact', params: { $filter: ids, $select: 'Id,FirstName,LastName,Email,AccountId,Cf/IncludeInOnboarding' } },
  ]);
  applyLeadSource_(queue, got[0]);
  applyContacts_(queue, groupContacts_(got[1]));
}

// Lead source lives on the closed-won opportunity (ChurnZero's synced CustomListOpportunity),
// not the account — the account-level field is blank on new firms.
function applyLeadSource_(queue, opps) {
  var byAcct = {};
  opps.forEach(function (o) {
    var cur = byAcct[o.AccountId];
    if (!cur || String(o.CreatedDate) > String(cur.CreatedDate)) byAcct[o.AccountId] = o;
  });
  queue.forEach(function (f) {
    var o = byAcct[f.czId];
    if (!o) return;
    f.leadSource = o.LeadSource || '';
    f.leadSourceDetail = o.LeadSourceDetail || '';
    f.partner = /^partner/i.test(f.leadSource);
  });
}

// A firm can't be assigned until at least one contact has "Include in Onboarding" on;
// the kickoff play emails those contacts.
function contactsFor_(accountIds) {
  if (!accountIds.length) return {};
  return groupContacts_(czGet_('/Contact', {
    $filter: accountIds.map(function (id) { return 'AccountId eq ' + Number(id); }).join(' or '),
    $select: 'Id,FirstName,LastName,Email,AccountId,Cf/IncludeInOnboarding', $top: 100,
  }));
}

function groupContacts_(rows) {
  var by = {};
  rows.forEach(function (c) {
    (by[c.AccountId] = by[c.AccountId] || []).push({
      name: (String(c.FirstName || '') + ' ' + String(c.LastName || '')).trim() || c.Email || 'Contact ' + c.Id,
      email: c.Email || '', onboarding: !!(c.Cf || {}).IncludeInOnboarding,
    });
  });
  return by;
}

function applyContacts_(queue, by) {
  queue.forEach(function (f) {
    f.contacts = by[f.czId] || [];
    f.onboardingContacts = f.contacts.filter(function (c) { return c.onboarding; }).map(function (c) { return c.name; });
  });
}

/* ---------- writes ---------- */

function assign_(b, by) {
  var props = PropertiesService.getScriptProperties();
  var appKey = props.getProperty('CZ_APP_KEY');
  if (!appKey) throw new Error('ChurnZero write key (CZ_APP_KEY) isn’t set up yet.');
  if (!b.czId || !b.externalId || !b.userId) throw new Error('missing firm or rep');

  // Re-read the account so a firm someone already assigned in ChurnZero isn't overwritten.
  var acct = czGet_('/Account', { $filter: 'Id eq ' + Number(b.czId), $select: 'Id,Name,ExternalId,IsActive,StartDate,UserAccountId,TotalContractAmount,Cf' })[0];
  if (!acct) throw new Error('account not found in ChurnZero');
  // Only firms that would show in the queue can be assigned from here.
  var qcf = acct.Cf || {};
  if (!acct.IsActive || qcf.OnboardingStatus !== 'Pre-Kickoff' || qcf.AgencyFirm || qcf.AgencyClientFirm ||
      (acct.StartDate && String(acct.StartDate) < sinceIso_(QUEUE_DAYS))) {
    throw new Error(acct.Name + ' isn’t in the new-firm queue (it must be active, Pre-Kickoff, non-agency, and new). Reload to refresh.');
  }
  if (acct.UserAccountId && acct.UserAccountId !== Number(b.userId)) {
    throw new Error(acct.Name + ' was already assigned in ChurnZero. Reload to refresh the queue.');
  }
  var cs = contactsFor_([acct.Id])[acct.Id] || [];
  if (!cs.some(function (c) { return c.onboarding; })) {
    throw new Error(acct.Name + ' has no contact with “Include in Onboarding” turned on. Turn it on for at least one contact in ChurnZero, then refresh.');
  }
  var users = users_(), im = users[b.userId], csm = b.csmId ? users[b.csmId] : null;
  if (!im || !im.active) throw new Error('unknown or inactive ChurnZero user for the IM');
  var mrr = Number(acct.TotalContractAmount) || 0, needsCsm = mrr > CSM_MIN;
  if (needsCsm && (!csm || !csm.active)) throw new Error(acct.Name + ' is over $' + CSM_MIN + '/mo, so it needs a CSM too.');
  if (!needsCsm) csm = null;
  var owner = csm || im;
  if (acct.UserAccountId && acct.UserAccountId !== owner.id) {
    throw new Error(acct.Name + ' was already assigned in ChurnZero. Reload to refresh the queue.');
  }

  var ownerAttr = props.getProperty('CZ_OWNER_ATTR') || 'OwnerUserAccount';
  var typeAttr = props.getProperty('CZ_TYPE_ATTR') || 'ImplementationType';
  czSet_(appKey, acct.ExternalId, ownerAttr, owner.email);
  czSet_(appKey, acct.ExternalId, typeAttr, PREMIUM);
  czSet_(appKey, acct.ExternalId, IM_FIELD, im.name);
  if (csm) czSet_(appKey, acct.ExternalId, CSM_FIELD, csm.name);

  // ChurnZero applies writes asynchronously; check back a few times.
  var confirmed = false, after = null;
  for (var i = 0; i < 4 && !confirmed; i++) {
    Utilities.sleep(2500);
    after = czGet_('/Account', { $filter: 'Id eq ' + Number(b.czId), $select: 'Id,UserAccountId,Cf/ImplementationType,Cf/' + IM_FIELD + ',Cf/' + CSM_FIELD })[0];
    var cf = (after && after.Cf) || {};
    confirmed = !!after && after.UserAccountId === owner.id && cf.ImplementationType === PREMIUM &&
      cfGet_(cf, IM_FIELD) === im.name && (!csm || cfGet_(cf, CSM_FIELD) === csm.name);
  }
  clearLoadCache_();
  appendLog_({
    by: by, firm: acct.Name, firmId: String((acct.Cf || {}).FirmId || acct.ExternalId), czId: acct.Id,
    mrr: acct.TotalContractAmount, suggested: b.suggestedName || '', assigned: im.name, userId: im.id,
    took: b.suggestedId ? String(Number(b.suggestedId) === im.id && (!csm || !b.suggestedCsmId || Number(b.suggestedCsmId) === csm.id)) : '',
    confirmed: confirmed, note: b.note || '',
    suggestedCsm: b.suggestedCsmName || '', csm: csm ? csm.name + ' #' + csm.id : '', owner: owner.name,
  });
  return { ok: true, confirmed: confirmed, owner: owner.name, im: im.name, csm: csm ? csm.name : '' };
}

function czSet_(appKey, externalId, name, value) {
  var payload = { appKey: appKey, accountExternalId: externalId, action: 'setAttribute', entity: 'account', name: name, value: value };
  var res = UrlFetchApp.fetch(CZ_WRITE, { method: 'post', payload: payload, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) { console.error('ChurnZero write ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500)); throw new Error('ChurnZero rejected the change (HTTP ' + res.getResponseCode() + ').'); }
}

function rotationSkips_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(SPLIT_PROP + 'ROTATION_SKIP') || '{}'); } catch (e) { return {}; }
}

// Rotation settings only take ChurnZero users who are active.
function validRep_(id) {
  var u = users_()[Number(id)];
  return !!(u && u.active);
}

function setRotation_(b) {
  if (b.userId != null && !validRep_(b.userId)) throw new Error('unknown rep');
  var skip = rotationSkips_();
  if (b.included) delete skip[b.userId]; else skip[b.userId] = true;
  PropertiesService.getScriptProperties().setProperty(SPLIT_PROP + 'ROTATION_SKIP', JSON.stringify(skip));
  return load_(true);
}

function tier_() {
  try {
    var t = JSON.parse(PropertiesService.getScriptProperties().getProperty(SPLIT_PROP + 'TIER') || 'null');
    return t && t.reps ? t : TIER_DEFAULT;
  } catch (e) { return TIER_DEFAULT; }
}

function setTier_(b) {
  if (b.userId != null && !validRep_(b.userId)) throw new Error('unknown rep');
  var t = tier_();
  if (b.userId != null) { if (b.high) t.reps[b.userId] = true; else delete t.reps[b.userId]; }
  if (b.min != null) {
    var m = Number(b.min);
    if (!(m >= 0)) throw new Error('enter a dollar amount');
    t.min = m;
  }
  PropertiesService.getScriptProperties().setProperty(SPLIT_PROP + 'TIER', JSON.stringify(t));
  return load_(true);
}

/* ---------- one-off write test (run from the editor) ----------
   Uses VIP Law (OLD), Justin's test account: tries the likely attribute names
   until ChurnZero shows the change, saves the ones that work as CZ_OWNER_ATTR /
   CZ_TYPE_ATTR, then puts the account back the way it was. Check View ▸ Logs. */
var TEST_ACCOUNT_ID = 4323;      // VIP Law (OLD)
var TEST_OWNER_ID = 98;          // Andy Galindo (only one ChurnZero user with his email)
var OWNER_ATTR_CANDIDATES = ['OwnerUserAccount', 'Owner', 'OwnerEmail', 'OwnerUserAccountEmail', 'AccountOwner'];
var TYPE_ATTR_CANDIDATES = ['ImplementationType', 'Implementation Type', 'cf_ImplementationType'];

function testAssignWrite() {
  var props = PropertiesService.getScriptProperties();
  var appKey = props.getProperty('CZ_APP_KEY');
  if (!appKey) throw new Error('CZ_APP_KEY is not set.');
  var read = function () {
    return czGet_('/Account', { $filter: 'Id eq ' + TEST_ACCOUNT_ID, $select: 'Id,Name,ExternalId,UserAccountId,Cf' })[0];
  };
  var waitFor = function (check) {
    for (var i = 0; i < 6; i++) { Utilities.sleep(5000); var a = read(); if (check(a)) return a; }
    return null;
  };
  var users = users_();
  var before = read();
  var origOwner = before.UserAccountId, origType = (before.Cf || {}).ImplementationType || '';
  Logger.log('Before: ' + before.Name + ' owner #' + origOwner + ', type "' + origType + '"');

  var ownerAttr = null;
  for (var i = 0; i < OWNER_ATTR_CANDIDATES.length && !ownerAttr; i++) {
    czSet_(appKey, before.ExternalId, OWNER_ATTR_CANDIDATES[i], users[TEST_OWNER_ID].email);
    if (waitFor(function (a) { return a.UserAccountId === TEST_OWNER_ID; })) ownerAttr = OWNER_ATTR_CANDIDATES[i];
    Logger.log('Owner attribute "' + OWNER_ATTR_CANDIDATES[i] + '": ' + (ownerAttr ? 'WORKS' : 'no change'));
  }
  var typeAttr = null;
  for (var j = 0; j < TYPE_ATTR_CANDIDATES.length && !typeAttr; j++) {
    czSet_(appKey, before.ExternalId, TYPE_ATTR_CANDIDATES[j], PREMIUM);
    if (waitFor(function (a) { return (a.Cf || {}).ImplementationType === PREMIUM; })) typeAttr = TYPE_ATTR_CANDIDATES[j];
    Logger.log('Type attribute "' + TYPE_ATTR_CANDIDATES[j] + '": ' + (typeAttr ? 'WORKS' : 'no change'));
  }

  // Put it back.
  if (ownerAttr) {
    czSet_(appKey, before.ExternalId, ownerAttr, users[origOwner] ? users[origOwner].email : '');
    props.setProperty('CZ_OWNER_ATTR', ownerAttr);
  }
  if (typeAttr) {
    czSet_(appKey, before.ExternalId, typeAttr, origType);
    props.setProperty('CZ_TYPE_ATTR', typeAttr);
  }
  var after = waitFor(function (a) {
    return a.UserAccountId === origOwner && ((a.Cf || {}).ImplementationType || '') === origType;
  }) || read();
  Logger.log('After restore: owner #' + after.UserAccountId + ', type "' + ((after.Cf || {}).ImplementationType || '') + '"' +
    (after.UserAccountId === origOwner && ((after.Cf || {}).ImplementationType || '') === origType ? ' — restored ✓' : ' — NOT fully restored, fix by hand'));
  Logger.log('RESULT owner=' + (ownerAttr || 'none worked') + ' type=' + (typeAttr || 'none worked'));
}

/* ---------- IM/CSM split check (run from the editor; read-only) ---------- */
function checkSplitLoad() {
  var d = buildLoad_();
  var rep = function (r) { return r.name + (r.included ? '' : ' (out)') + ': ' + r.firms + ' firms, ' + r.open + ' open, last new firm ' + (r.lastStart || '—'); };
  Logger.log('IMs\n  ' + d.reps.map(rep).join('\n  '));
  Logger.log('CSMs (bands: $' + d.bands.top + '+ / $' + d.bands.mid + '+ / over $' + d.csmMin + ')\n  ' + d.csms.map(rep).join('\n  '));
  Logger.log(d.queue.length + ' firms in the queue');
  d.queue.forEach(function (f) {
    var im = f.ranking && f.ranking[0], csm = f.csmRanking[0];
    Logger.log(f.name + ' · $' + f.mrr + (f.partner ? ' · partner' : '') + ' → IM ' + (im ? im.name + ' (' + (im.partnerRule ? 'partner' : im.score) + ')' : '—') +
      (f.needsCsm ? ', CSM ' + (csm ? csm.name + ' (' + (csm.partnerRule ? 'partner' : csm.score) + ')' : '—') + ', Owner = CSM' : ', no CSM, Owner = IM'));
  });
}

/* ---------- one-off role write test (IM/CSM split; run from the editor) ----------
   Writing an unknown name makes ChurnZero create a new custom field, so this only uses
   CustomerSuccessManager, which ChurnZero already recognises (it didn't create a field for
   it). The value format is the open question: the ChurnZero user ID goes in with one rep and
   the full name with another, so whoever shows up in the role names the format that works. */
function testRoleWrite3() {
  var appKey = PropertiesService.getScriptProperties().getProperty('CZ_APP_KEY');
  if (!appKey) throw new Error('CZ_APP_KEY is not set.');
  var acct = czGet_('/Account', { $filter: 'Id eq ' + TEST_ACCOUNT_ID, $select: 'Id,Name,ExternalId' })[0];
  var byName = {}, users = users_();
  Object.keys(users).forEach(function (id) { var u = users[id]; if (u.active && !byName[u.name]) byName[u.name] = u; });
  [['Julio Ortiz', 'id'], ['Elliott Jones', 'name']].forEach(function (t) {
    var u = byName[t[0]];
    czSet_(appKey, acct.ExternalId, 'CustomerSuccessManager', t[1] === 'id' ? String(u.id) : u.name);
    Logger.log(u.name + ' ← CustomerSuccessManager = ' + t[1] + ' (' + (t[1] === 'id' ? u.id : u.name) + ')');
    Utilities.sleep(2000);
  });
  Logger.log('Done. In a minute, check who is in Customer Success Manager on ' + acct.Name + '.');
}

/* ---------- log ---------- */

function logSheet_() {
  var ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  var sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB);
    sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < LOG_HEADERS.length) {
    sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');   // the split's new columns
  }
  return sh;
}

function appendLog_(x) {
  var sh = logSheet_();
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, LOG_HEADERS.length).setValues([[
    Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'), x.by, x.firm, x.firmId, x.czId,
    x.mrr || '', x.suggested, x.assigned + ' #' + x.userId, x.took, x.confirmed ? 'yes' : 'pending', x.note,
    x.suggestedCsm || '', x.csm || '', x.owner || '',
  ].map(dashSafe_)]);
}

function readLog_(max) {
  var ss = SpreadsheetApp.openById(LOG_SHEET_ID), sh = ss.getSheetByName(LOG_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  var n = Math.min(max, sh.getLastRow() - 1);
  var w = Math.min(LOG_HEADERS.length, sh.getLastColumn());
  return sh.getRange(2, 1, n, w).getDisplayValues().map(function (r) {
    var m = /#(\d+)$/.exec(r[7]), c = /#(\d+)$/.exec(r[12] || '');
    return { when: r[0], by: r[1], firm: r[2], firmId: r[3], mrr: r[5], suggested: r[6],
      assigned: r[7].replace(/\s*#\d+$/, ''), userId: m ? Number(m[1]) : null, took: r[8], confirmed: r[9],
      csm: String(r[12] || '').replace(/\s*#\d+$/, ''), csmId: c ? Number(c[1]) : null, owner: r[13] || '' };
  });
}

/* ---------- auth ---------- */

function verify_(token) {
  // Shared check (shared/dash-auth.js): dashboard client, verified @lawmatics.com, manager list from Dashboard Config.
  var who = dashAuth_(token);
  if (!who.ok) return who;
  if (!who.manager) return { ok: false, error: 'New Firm Assignment is for managers only.' };
  return who;
}

function json_(obj) { return dashJson_(obj); }
