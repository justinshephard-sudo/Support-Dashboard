/* ==========================================================================
   Renewal prep — the "Renewal prep" button in the CSM tab's Renewals list.
   For one firm whose annual contract ends soon: the facts a CSM needs (contract, plan, MRR over
   the last year, health and usage, AI credit use, overdue invoices, support tickets, Gong calls)
   plus a Claude-written brief (risk read, wins to mention, likely objections and answers, expansion
   angles, agenda). Read-only: nothing is written anywhere.

   renewalPrep → { firmId, regenerate } — the firm's CSM / account manager, or a manager.
     Returns a cached brief (12 hours per firm + latest Gong call), or starts one through the same
     Zapier AI workflow as Call prep and returns { pending, requestId } (the page polls prepStatus).
   ========================================================================== */

var RENEWAL_LOOKBACK_DAYS = 180;
var RENEWAL_MRR_SHEET_ID = '1zecFQqzYlxl7JQt1NYE_VgC5ak-UIf5MV01vjOYezgY';   // MRR Data (CSM Firm History, Merlin AI Usage)

var RENEWAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['oneLiner', 'risk', 'riskWhy', 'wins', 'risks', 'objections', 'expansion', 'agenda', 'beforeCall'],
  properties: {
    oneLiner: { type: 'string', description: 'One sentence on where this renewal stands' },
    risk: { type: 'string', enum: ['Low', 'Medium', 'High'], description: 'How likely the firm is to not renew or to cut back' },
    riskWhy: { type: 'string', description: 'Why that risk level, under 25 words' },
    wins: { type: 'array', items: { type: 'string' }, description: 'Concrete value the firm got from Lawmatics that is worth reminding them of' },
    risks: { type: 'array', items: { type: 'string' }, description: 'What could make them leave or cut back: usage drops, complaints, unpaid invoices, unresolved bugs, competitor mentions' },
    objections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['objection', 'response'],
      properties: { objection: { type: 'string' }, response: { type: 'string' } } }, description: 'Objections they are likely to raise and how to answer each' },
    expansion: { type: 'array', items: { type: 'string' }, description: 'Upsell or cross-sell angles that fit what they actually do (Merlin AI, more seats, add-ons), only when supported by the data' },
    agenda: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'why'],
      properties: { item: { type: 'string' }, why: { type: 'string' } } }, description: 'Renewal call agenda' },
    beforeCall: { type: 'array', items: { type: 'string' }, description: 'Things to check or fix before the call (open tickets, overdue invoice, a bug to chase)' },
  },
};

// The firm's row from the dashboard's Accounts tab (the daily ChurnZero + Chargebee sync).
function renewalAccountRow_(firmId) {
  var sh = SpreadsheetApp.openById(SIGNAL_SHEET_ID).getSheetByName('Accounts');
  if (!sh) return {};
  var v = sh.getDataRange().getDisplayValues(), h = v[0];
  var ix = h.indexOf('FirmId');
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][ix]).trim() === firmId) { var o = {}; h.forEach(function (k, j) { o[k] = v[i][j]; }); return o; }
  }
  return {};
}

// Monthly MRR for the last 13 months (CSM Firm History: one row per firm, "Monthly MRR" from its signup month).
function renewalMrrHistory_(firmId) {
  try {
    var sh = SpreadsheetApp.openById(RENEWAL_MRR_SHEET_ID).getSheetByName('CSM Firm History');
    if (!sh) return null;
    var v = sh.getDataRange().getDisplayValues(), h = v[0];
    var col = function (n) { return h.indexOf(n); };
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][col('Firm ID')]).replace(/\D/g, '') !== firmId) continue;
      var signup = String(v[i][col('Signup Month')]).slice(0, 7);
      var monthly = String(v[i][col('Monthly MRR')] || '').split('|').filter(String).map(Number);
      var out = [];
      var y = +signup.slice(0, 4), m = +signup.slice(5) - 1;
      monthly.forEach(function (x, k) {
        var d = new Date(y, m + k, 15);
        out.push({ ym: Utilities.formatDate(d, 'America/Los_Angeles', 'yyyy-MM'), mrr: x });
      });
      return { signup: signup, startMrr: Number(String(v[i][col('Start MRR')]).replace(/[^\d.]/g, '')) || 0, months: out.slice(-13) };
    }
  } catch (e) { console.warn('MRR history skipped: ' + e.message); }
  return null;
}

// Merlin AI use in the last 30 days (Merlin AI Usage tab, refreshed externally).
function renewalAiUsage_(firmId) {
  try {
    var sh = SpreadsheetApp.openById(RENEWAL_MRR_SHEET_ID).getSheetByName('Merlin AI Usage');
    if (!sh) return null;
    var v = sh.getDataRange().getDisplayValues(), h = v[0];
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][h.indexOf('firm_id')]) !== firmId) continue;
      return { leads: Number(v[i][h.indexOf('leads_30d')]) || 0, scored: Number(v[i][h.indexOf('leads_scored_30d')]) || 0, credits: Number(v[i][h.indexOf('ai_credits_30d')]) || 0 };
    }
  } catch (e) { console.warn('AI usage skipped: ' + e.message); }
  return null;
}

function renewalPrep_(b, who) {
  var firmId = String(b.firmId || '').replace(/[^\d]/g, '');
  if (!firmId) throw new Error('missing Firm ID');
  var a = czGet_('/Account', { $filter: "Cf/FirmId eq '" + firmId + "'",
    $select: 'Id,Name,StartDate,UserAccountId,PrimaryChurnScoreValue,Cf/FirmId,Cf/AccountManager,Cf/CustomerSuccessManager,Cf/PracticeArea,' +
      'Cf/OfMessagesSentl30,Cf/OfMeetingsl30,Cf/AvgMattersCreatedmonth,Cf/AvgMonthlyLeadVolumelifetime,Cf/TotalSmsSent,Cf/KeyChallenges,Cf/SalesOnboardingNotes' })[0];
  if (!a) throw new Error('Firm ' + firmId + ' wasn’t found in ChurnZero.');
  var cf = a.Cf || {}, users = czUsers_();
  var repName = String(cf.CustomerSuccessManager || cf.AccountManager || (users[a.UserAccountId] || {}).name || '').trim();
  var rep = Object.keys(users).map(function (k) { return users[k]; }).filter(function (u) { return u.name === repName; })[0] || null;
  var repEmail = rep ? String(rep.email).toLowerCase() : '';
  if (!who.manager && !(repEmail && repEmail === who.email)) throw new Error('Renewal prep is for the firm’s CSM or a manager.');

  var acct = renewalAccountRow_(firmId);
  var contacts = czGet_('/Contact', { $filter: 'AccountId eq ' + a.Id, $select: 'FirstName,LastName,Email,Title' });
  var emails = contacts.map(function (c) { return String(c.Email || '').toLowerCase(); }).filter(Boolean);
  var domains = {};
  emails.forEach(function (e) { var d = e.split('@')[1]; if (d && !FREE_MAIL.test(d + '.')) domains[d] = true; });

  // Gong: the rep's calls with the firm over the last 6 months (company-wide over 60 days as a fallback).
  var saved = GONG_LOOKBACK_DAYS, calls = [];
  try {
    GONG_LOOKBACK_DAYS = RENEWAL_LOOKBACK_DAYS;
    var people = emails.map(function (e) { return { Email: e }; });
    calls = rep ? gongCallsForFirm_(a.Name, domains, people, { email: repEmail }) : [];
    if (!calls.length) { GONG_LOOKBACK_DAYS = 60; calls = gongCallsForFirm_(a.Name, domains, people, null); }
  } catch (e) { console.warn('Gong skipped: ' + e.message); } finally { GONG_LOOKBACK_DAYS = saved; }
  var last = calls[0] || null;

  var key = 'renew_' + firmId + '_' + (last ? last.id : 'none');
  var cache = CacheService.getScriptCache();
  if (!b.regenerate) {
    var hit = cache.get(key);
    if (hit) { var c = JSON.parse(hit); c.cached = true; return c; }
  }

  var fromIso = new Date(Date.now() - RENEWAL_LOOKBACK_DAYS * 864e5).toISOString();
  var support = imFirmSupport_(emails, fromIso);
  var signals = [];
  try { signals = imSignals_(repName, fromIso.slice(0, 10), firmId); } catch (e) { /* no signals tab */ }
  var mrr = renewalMrrHistory_(firmId);
  var ai = renewalAiUsage_(firmId);
  var transcript = last ? gongTranscript_(last) : '';
  if (transcript.length > 30000) transcript = transcript.slice(0, 30000) + '\n(…trimmed)';

  var ago = function (n) { return mrr && mrr.months.length > n ? mrr.months[mrr.months.length - 1 - n].mrr : null; };
  var facts = {
    firm: a.Name, firmId: firmId, rep: repName, practiceArea: [].concat(cf.PracticeArea || []).join(', '),
    customerSince: String(a.StartDate || '').slice(0, 10), contractEnd: acct.ContractEnd || '', nonRenewing: /^yes$/i.test(acct.NonRenewing || ''),
    plan: acct.ChargebeePlan || '', addOns: acct.AddOns || '', licenses: acct.Licenses || '',
    mrrNow: Number(String(acct.MRR || '').replace(/[^\d.]/g, '')) || (mrr ? ago(0) : 0), mrr6: ago(6), mrr12: ago(12), mrrMonths: mrr ? mrr.months : [],
    health: acct.ChurnScore || String(a.PrimaryChurnScoreValue || ''), usage: acct.UsageFrequency || '',
    activities30: acct.Activities30 || String(cf.OfMessagesSentl30 || ''), meetings30: cf.OfMeetingsl30 || 0,
    mattersPerMonth: acct.MattersPerMonth || String(Math.round(cf.AvgMattersCreatedmonth || 0)), leadsPerMonth: acct.AvgLeadsMonthly || String(Math.round(cf.AvgMonthlyLeadVolumelifetime || 0)),
    csat60: acct.CSAT60 || '', danger: /^(yes|true)$/i.test(acct.DangerZone || ''), cancelRequested: /^(yes|true)$/i.test(acct.CancellationRequested || ''),
    overdue: acct.Overdue || '', ai: ai,
    tickets: { total: support.convos.length, open: support.convos.filter(function (c) { return c.state !== 'closed'; }).length,
      low: support.convos.filter(function (c) { return c.rating && c.rating <= 3; }).length,
      recent: support.convos.slice(0, 6).map(function (c) { return { date: c.date, title: c.title, state: c.state, rating: c.rating }; }) },
    signals: signals.slice(0, 6).map(function (s) { return { date: s.date, signal: s.signal, reason: s.reason }; }),
    contacts: contacts.map(function (c) { return { name: (String(c.FirstName || '') + ' ' + String(c.LastName || '')).trim(), title: c.Title || '' }; }).filter(function (c) { return c.name; }).slice(0, 8),
  };
  var shell = {
    ok: true, facts: facts,
    lastCall: last ? { title: last.title, date: last.started, url: last.url, minutes: Math.round((last.duration || 0) / 60) } : null,
    calls: calls.slice(0, 6).map(function (c) { return { title: c.title, date: String(c.started).slice(0, 10), url: c.url }; }),
    prep: null, generated: null,
  };

  var system = 'You prepare a Lawmatics customer success manager for a renewal conversation with a law firm whose annual contract ends soon. ' +
    'Use only the facts given: the account data, MRR history, usage, support tickets, call signals and the latest Gong call. Be specific (names, numbers, dates). ' +
    'Never invent what was said or promised. Leave a list empty rather than guessing. Keep it short: at most 5 bullets per list, 4 objections, 6 agenda items; ' +
    'each bullet under 18 words. Expansion ideas only when the data supports them (e.g. heavy lead volume with low AI use → Merlin; growing headcount → seats).';
  var context = 'ACCOUNT FACTS: ' + JSON.stringify(facts) +
    '\n\nGONG CALLS (last ' + RENEWAL_LOOKBACK_DAYS + ' days): ' + (calls.slice(0, 8).map(function (c) { return String(c.started).slice(0, 10) + ' ' + c.title; }).join('; ') || 'none') +
    (cf.KeyChallenges ? '\n\nKey challenges noted at sale: ' + String(cf.KeyChallenges).slice(0, 800) : '') +
    (support.text ? '\n\nSUPPORT TICKETS READ IN FULL:\n' + support.text.slice(0, 20000) : '');
  var task = 'Today is ' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'EEEE, MMM d, yyyy') + '. The contract ends ' + (facts.contractEnd || 'soon') +
    '. Write the renewal prep for ' + repName + '.';

  var hook = PropertiesService.getScriptProperties().getProperty('ZAPIER_HOOK_URL') || (typeof ZAPIER_HOOK_SECRET_URL === 'undefined' ? '' : ZAPIER_HOOK_SECRET_URL);
  if (!hook || typeof ZAPIER_HOOK_KEY === 'undefined') throw new Error('The Zapier hook (ZAPIER_HOOK_URL) isn’t set up yet.');
  var requestId = Utilities.getUuid(), secret = Utilities.getUuid();
  cache.put('req_' + requestId, JSON.stringify({ secret: secret, key: key, shell: shell, at: Date.now() }), 3600);
  var res = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ requestId: requestId, token: secret, hookKey: ZAPIER_HOOK_KEY, callbackUrl: CALLBACK_URL,
      instructions: system + '\n\n' + task + '\n\nReturn ONLY a JSON object (no code fence) with exactly these keys: ' + JSON.stringify(RENEWAL_SCHEMA.properties, null, 0),
      context: context, transcript: transcript || '' }) });
  if (res.getResponseCode() >= 300) { console.error('Zapier ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300)); throw new Error('Couldn’t start the renewal prep (Zapier HTTP ' + res.getResponseCode() + ').'); }
  return { ok: true, pending: true, requestId: requestId, facts: facts, lastCall: shell.lastCall };
}

// Editor check: the facts for one firm (no AI), e.g. checkRenewalPrep('5170').
function checkRenewalPrep(firmId) {
  firmId = String(firmId || '5170');
  var acct = renewalAccountRow_(firmId);
  console.log(JSON.stringify({ account: { name: acct.Name, contractEnd: acct.ContractEnd, plan: acct.ChargebeePlan, mrr: acct.MRR },
    mrr: renewalMrrHistory_(firmId), ai: renewalAiUsage_(firmId) }));
}
