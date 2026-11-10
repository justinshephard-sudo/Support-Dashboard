/* ==========================================================================
   CS weekly digest — Mondays 8 AM Pacific, posted to #cs-ops by Ops Comms through the Zapier
   workflow "CS weekly digest → #cs-ops" (01a1c1a7-0219-79be-a0af-92a404d5ce39). One summary line in
   the channel; every section is a thread reply, so the channel stays clean.

   Sections (each left out when empty, at most 5 firms listed, then "N more"):
     Renewals at risk   annual contracts (Chargebee contract term) ending in the next 30 days that have
                        bad health (churn score 67+), a cancellation flag, are set not to renew, or an
                        overdue invoice. Firms excluded from CSM are left out.
     New overdue        active firms whose oldest unpaid invoice crossed 7 days late this week ($25+).
     Call signals       Gong AI tracker hits from the last 7 days not yet marked Reviewed.
     70+ days           open onboardings that crossed 70 days this week (excluded firms left out).
     New partner firms  agency / affiliate firms that started in the last 7 days.

   Everything comes from tabs this sheet already has (Accounts, Impl - Open Firms, Call Signals,
   Call Signal Reviews, Excluded Firms) plus one small ChurnZero query for partner firms.

   Editor:
     previewDigest()          logs the digest, sends nothing
     sendDigestTest()         sends it to Justin's DM
     installDigestTrigger()   once: Mondays 8 AM Pacific (also authorizes)
   DIGEST_HOOK_URL / DIGEST_HOOK_KEY live in digest-secret.js, which exists only in the local clasp
   folder (never in the public repo).
   ========================================================================== */
var DIGEST_DASHBOARD = 'https://justinshephard-sudo.github.io/Support-Dashboard/';
var DIGEST_MAX = 5;
var DIGEST_RENEW_DAYS = 30;

function previewDigest() { var d = buildDigest_(); Logger.log(d.parent + '\n\n' + d.replies.join('\n\n———\n\n')); }
function sendDigestTest() { return postDigest_(true); }
function weeklyDigest() { return postDigest_(false); }

function installDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'weeklyDigest') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weeklyDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone('America/Los_Angeles').create();
  previewDigest();
}

function postDigest_(test) {
  if (typeof DIGEST_HOOK_URL === 'undefined' || !DIGEST_HOOK_URL) throw new Error('digest-secret.js is missing.');
  var d = buildDigest_();
  var res = UrlFetchApp.fetch(DIGEST_HOOK_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ id: 'digest-' + Date.now(), hookKey: DIGEST_HOOK_KEY, test: !!test, parent: d.parent, replies: d.replies }) });
  Logger.log('Digest sent (%s): HTTP %s, %s sections', test ? 'test → DM' : '#cs-ops', res.getResponseCode(), d.replies.length);
  return res.getResponseCode();
}

function buildDigest_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = 'America/Los_Angeles';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var dayMs = 864e5, t0 = Date.parse(today + 'T12:00:00Z');
  var plusDays = function (n) { return new Date(t0 + n * dayMs).toISOString().slice(0, 10); };
  var short = function (iso) { return Utilities.formatDate(new Date(iso + 'T12:00:00Z'), 'UTC', 'MMM d'); };
  var first = function (name) { return String(name || 'Unassigned').split(' ')[0]; };
  var money = function (n) { return '$' + Math.round(Number(n) || 0).toLocaleString(); };
  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var more = function (n) { return n > 0 ? '\n_' + n + ' more → <' + DIGEST_DASHBOARD + '|CS Dashboard>_' : ''; };
  var csmExcl = excludedFirmIds_('CSM'), imExcl = excludedFirmIds_('IM');
  var accounts = digestRows_(ss.getSheetByName('Accounts'));
  var live = accounts.filter(function (r) { return r.ContractStatus !== 'Inactive' && Number(r.MRR) > 0; });
  var replies = [], summary = [];

  // ---- Renewals at risk, next 30 days ----
  var end = plusDays(DIGEST_RENEW_DAYS);
  var renew = live.filter(function (r) { return r.ContractEnd && r.ContractEnd >= today && r.ContractEnd <= end && !csmExcl[excludedFirmKey_(r.FirmId)]; })
    .map(function (r) {
      var risks = [];
      var sc = r.ChurnScore === '' ? null : Number(r.ChurnScore);
      if (sc != null && sc >= 67) risks.push('bad health');
      if (r.CancellationRequested === 'Yes' || r.DangerZone === 'Yes') risks.push('cancellation flagged');
      if (r.NonRenewing === 'Yes') risks.push('set not to renew');
      if (r.Overdue) risks.push('invoice overdue');
      return { r: r, risks: risks };
    })
    .sort(function (a, b) { return a.r.ContractEnd < b.r.ContractEnd ? -1 : a.r.ContractEnd > b.r.ContractEnd ? 1 : 0; });
  var risky = renew.filter(function (x) { return x.risks.length; });
  if (risky.length) {
    var riskMrr = risky.reduce(function (s, x) { return s + Number(x.r.MRR); }, 0);
    replies.push('*🔁 Renewals at risk · next ' + DIGEST_RENEW_DAYS + ' days* — ' + risky.length + ' of ' + renew.length + ' contracts · ' + money(riskMrr) + ' MRR\n' +
      risky.slice(0, DIGEST_MAX).map(function (x) {
        return '• *' + esc(x.r.Name) + '* · ' + short(x.r.ContractEnd) + ' · ' + money(x.r.MRR) + ' · ' + esc(first(x.r.AccountManager)) + ' · ' + x.risks.join(', ');
      }).join('\n') + more(risky.length - DIGEST_MAX));
    summary.push(risky.length + ' renewal' + (risky.length === 1 ? '' : 's') + ' at risk (' + money(riskMrr) + ')');
  }

  // ---- New overdue: oldest due date 7–13 days ago (crossed the 7-day mark this week) ----
  var od = live.map(function (r) { var p = String(r.Overdue || '').split('|'); return { r: r, amt: Number(p[0]) || 0, since: p[2] || '' }; })
    .filter(function (x) { return x.amt > 0 && x.since >= plusDays(-13) && x.since <= plusDays(-7); })
    .sort(function (a, b) { return b.amt - a.amt; });
  if (od.length) {
    var odTotal = od.reduce(function (s, x) { return s + x.amt; }, 0);
    replies.push('*💸 New overdue invoices* — ' + od.length + ' · ' + money(odTotal) + '\n' +
      od.slice(0, DIGEST_MAX).map(function (x) {
        var late = Math.round((t0 - Date.parse(x.since + 'T12:00:00Z')) / dayMs);
        return '• *' + esc(x.r.Name) + '* · ' + money(x.amt) + ' · ' + late + ' days late · ' + esc(first(x.r.AccountManager));
      }).join('\n') + more(od.length - DIGEST_MAX));
    summary.push(od.length + ' new overdue');
  }

  // ---- Call signals, last 7 days, AI trackers, not reviewed ----
  var reviewed = {};
  digestRows_(ss.getSheetByName('Call Signal Reviews')).forEach(function (r) { reviewed[String(r.CallId).trim()] = true; });
  var label = { 'Onboarding – Churn risk': 'Churn risk', 'Onboarding – Blocked by a bug': 'Bug', 'Onboarding – Pushback': 'Pushback' };
  var calls = {}, order = [];
  digestRows_(ss.getSheetByName('Call Signals')).forEach(function (r) {
    if (String(r.Date).slice(0, 10) < plusDays(-7) || !/^ai\b/i.test(String(r.GongTracker).trim()) || r.Verdict !== 'yes' || reviewed[String(r.CallId).trim()]) return;
    var c = calls[r.CallId];
    if (!c) { c = calls[r.CallId] = { r: r, kinds: [], quote: '' }; order.push(r.CallId); }
    var k = label[r.Tracker] || r.Tracker;
    if (c.kinds.indexOf(k) < 0) c.kinds.push(k);
    if (!c.quote) { try { var q = JSON.parse(r.Quotes || '[]'); if (q[0] && q[0].text) c.quote = q[0].text; } catch (e) {} }
  });
  var sig = order.map(function (id) { return calls[id]; })
    .sort(function (a, b) { return (b.kinds.indexOf('Churn risk') >= 0) - (a.kinds.indexOf('Churn risk') >= 0) || (a.r.Date < b.r.Date ? 1 : -1); });
  if (sig.length) {
    replies.push('*🚩 Call signals this week* — ' + sig.length + ' call' + (sig.length === 1 ? '' : 's') + '\n' +
      sig.slice(0, DIGEST_MAX).map(function (c) {
        var who = c.r.Firm || String(c.r.CallTitle || 'Call').replace(/^.*? - /, '');
        var q = c.quote ? ' · “' + esc(c.quote.length > 140 ? c.quote.slice(0, 137) + '…' : c.quote) + '”' : '';
        return '• *' + esc(who) + '* · ' + c.kinds.join(', ') + ' · ' + esc(first(c.r.Rep)) + q;
      }).join('\n') + more(sig.length - DIGEST_MAX));
    summary.push(sig.length + ' call signal' + (sig.length === 1 ? '' : 's'));
  }

  // ---- Crossed 70 days in onboarding this week ----
  var crossed = digestRows_(ss.getSheetByName('Impl - Open Firms')).filter(function (r) {
    var d = Number(r.DaysInOnboarding);
    return d >= 70 && d <= 76 && r.Excluded !== '1' && !imExcl[excludedFirmKey_(r.FirmId)];
  }).sort(function (a, b) { return Number(b.DaysInOnboarding) - Number(a.DaysInOnboarding); });
  if (crossed.length) {
    var byRep = {};
    crossed.forEach(function (r) { (byRep[first(r.AccountManager)] = byRep[first(r.AccountManager)] || []).push(esc(r.Name)); });
    replies.push('*⏳ Crossed 70 days in onboarding* — ' + crossed.length + '\n' +
      Object.keys(byRep).sort().map(function (rep) { return '• ' + rep + ': ' + byRep[rep].join(', '); }).join('\n'));
    summary.push(crossed.length + ' crossed 70 days');
  }

  // ---- New partner firms (agency / affiliate), last 7 days ----
  try {
    var p = PropertiesService.getScriptProperties();
    var headers = { Authorization: 'Basic ' + Utilities.base64Encode(p.getProperty('CZ_USER') + ':' + p.getProperty('CZ_KEY')) };
    var base = p.getProperty('CZ_BASE') || 'https://lawmatics.us1app.churnzero.net/public/v1';
    var filter = "IsActive eq true and StartDate ge " + plusDays(-7) + "T00:00:00Z and (Cf/AgencyFirm eq true or Cf/AgencyClientFirm eq true or Cf/PartnerType eq 'Affiliate')";
    var partners = fetchAllCZ_(base + '/Account?$top=' + CZ_PAGE_SIZE + '&$select=Name,StartDate,Cf/ReferralPartner,Cf/PartnerType,Cf/AgencyFirm,Cf/AgencyClientFirm&$filter=' + encodeURIComponent(filter), headers)
      .filter(function (a) { return !/\bselna\b/i.test(String((a.Cf || {}).ReferralPartner || '') + ' ' + a.Name); });
    if (partners.length) {
      replies.push('*🆕 New partner firms* — ' + partners.length + '\n' + partners.slice(0, DIGEST_MAX).map(function (a) {
        var cf = a.Cf || {};
        var kind = /^affiliate/i.test(String(cf.PartnerType || '')) ? 'Affiliate' : 'Agency';
        return '• *' + esc(a.Name) + '* · ' + kind + (cf.ReferralPartner ? ' · ' + esc(cf.ReferralPartner) : '') + ' · started ' + short(String(a.StartDate).slice(0, 10));
      }).join('\n') + more(partners.length - DIGEST_MAX));
      summary.push(partners.length + ' new partner firm' + (partners.length === 1 ? '' : 's'));
    }
  } catch (e) { console.error('Digest partner firms: ' + (e && e.message)); }

  var dateLabel = Utilities.formatDate(new Date(), tz, 'EEE, MMM d');
  var parent = '📊 *CS weekly digest · ' + dateLabel + '*\n' +
    (summary.length ? summary.join(' · ') + '\nDetails in the thread 🧵 · <' + DIGEST_DASHBOARD + '|CS Dashboard>' : 'Nothing to flag this week. 🎉');
  return { parent: parent, replies: replies };
}

// Sheet tab → array of {header: display value}.
function digestRows_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getDisplayValues();
  var head = v[0].map(function (h) { return String(h).trim(); });
  return v.slice(1).map(function (r) { var o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}
