/* ==========================================================================
   Implementation audits — the "Implementation" side of the Rep Audits page.
   --------------------------------------------------------------------------
   Two kinds, both saved on the "Rep Audits" tab (Kind column) and written by the
   same call-prep Zapier step (kind "audit"):

   Rep audit (Kind "im")   one AM / IM over the last IM_DAYS days
     Whole book, no AI:  every firm in onboarding (or finished in the window) with
       stage, days, pauses, checklist milestones and 30-day product usage (ChurnZero);
       every Gong call they led (Gong's brief + key points + talk stats); every email
       thread they sent (ChurnZero Gmail sync → response times); real call signals;
       onboarding CSAT. Team medians from the Implementation tab for comparison.
     Sample: ~IM_SAMPLE firms (most at-risk, best finished, one typical) get a
       timeline: all their calls' briefs + recent email text.
   Firm audit (Kind "firm") one onboarding end to end, since the firm started:
       every call brief (+ the latest call's transcript), every email thread,
       milestones, usage, signals.

   Good onboarding = finished in under 70 days; what matters most is progression,
   product adoption, and how the calls feel (sentiment).
   ========================================================================== */

var IM_DAYS = 30;
var IM_SAMPLE = 6;
var IM_FIRM_LOOKBACK_DAYS = 150;
var IM_GOOD_DAYS = 70;
var IM_ACCOUNT_FIELDS = 'Id,Name,StartDate,IsActive,PrimaryChurnScoreValue,TotalContractAmount,Cf/FirmId,Cf/AccountManager,Cf/CurrentTermStart,' +
  'Cf/OnboardingStatus,Cf/NewOnboardingCall,Cf/OnboardingCompletedDate,Cf/NewTimeInOnboarding,Cf/DateOnboardingPaused,Cf/DateOnboardingResumed,' +
  'Cf/TimeOnboardingPaused,Cf/LeadSourcesConnected,Cf/DocumentsFormsApproved,Cf/FirstHalfOfAutomationsApproved,Cf/SecondHalfOfAutomationsApproved,' +
  'Cf/TeamTrainingComplete,Cf/OnboardingDocumentsUploaded,Cf/OfMessagesSentl30,Cf/OfMeetingsl30,Cf/AvgMattersCreatedmonth,Cf/AvgMonthlyLeadVolumelifetime,' +
  'Cf/TotalSmsSent,Cf/OfMerlinEngageSessionsp30,Cf/AgencyFirm,Cf/AgencyClientFirm,Cf/Consultant,Cf/SalesOnboardingNotes,Cf/KeyChallenges,' +
  'Cf/CancellationRequested,Cf/DangerZone,Cf/AverageCsatLast60,Cf/OutstandingOnboardingBugs,Cf/OnboardingFeatureRequests,Cf/ProductPainPoints';
var IM_HIGH_CHURN = 67;     // ChurnZero churn score: lower is healthier (same bands as the CSM tab)
var IM_MILESTONES = [['LeadSourcesConnected', 'Lead sources connected'], ['OnboardingDocumentsUploaded', 'Docs uploaded'],
  ['DocumentsFormsApproved', 'Docs & forms approved'], ['FirstHalfOfAutomationsApproved', 'Automations (1st half) approved'],
  ['SecondHalfOfAutomationsApproved', 'Automations (2nd half) approved'], ['TeamTrainingComplete', 'Team trained']];

var IM_RUBRIC = [
  'Lawmatics onboarding (implementation): an IM / AM takes a newly signed law firm from kickoff to live in under 70 days. Calls follow',
  'stages (Kickoff, First Onboarding, Second, …); between calls the firm has homework (connect lead sources, upload docs/forms, approve',
  'automations, train the team). What matters most, in order: (1) PROGRESSION: steady movement through stages and milestones toward',
  'under 70 days, with no long gaps or stalls; (2) PRODUCT ADOPTION: the firm actually using Lawmatics (messages, activities, matters,',
  'leads, automations live), not just configuring it; (3) SENTIMENT: how the customer feels on calls and in email (confident, engaged,',
  'frustrated, confused, doubting the purchase). Strong IMs set a clear agenda, assign homework with dates, follow up between calls,',
  'answer email quickly, ask questions instead of monologuing, and spot and escalate risk early.',
  'DATA CAVEATS: ChurnZero milestone checkboxes are often not kept up to date (even finished firms show them unchecked), so treat them',
  'as a hint only and judge progress from stage, calls and emails. Don\'t comment on the data quality itself unless it changes a conclusion.',
].join('\n');

var IM_REP_PROMPT = [
  'You help the Customer Success managers at Lawmatics coach one account manager (AM; called implementation manager from January).',
  'An AM owns firms in two very different states, and the report treats them separately:',
  '',
  'IN ONBOARDING (getting a newly signed firm live in under 70 days). Judge: SENTIMENT (how the customer feels on calls and in email:',
  'confident, engaged, frustrated, confused, doubting the purchase), RESPONSIVENESS (email reply speed, gaps with no contact),',
  'ONBOARDING TIME (days vs 70 and vs the team), ROADBLOCKS (what is stalling each firm and whose side it is on: firm, AM, or product),',
  'and CALLS SCHEDULED (does every firm have its next call on the calendar). Do NOT judge product usage for these firms.',
  '',
  'LIVE ACCOUNTS (finished onboarding; the AM keeps them healthy). Judge: SENTIMENT, RESPONSIVENESS, ROADBLOCKS / FRUSTRATIONS',
  '(bugs, missing features, billing, confusion), and a USAGE DEEP DIVE: who is barely using Lawmatics, who never engaged, who is at churn',
  'risk, and whether the AM is doing anything about it. The whole book is summarized by counts; you see the flagged accounts and every',
  'account the AM touched in the last 30 days.',
  '',
  'DATA CAVEATS: ChurnZero milestone checkboxes are often stale (finished firms show them unchecked); treat them as a hint only.',
  'Usage numbers are 30-day ChurnZero totals (no trends). Don\'t comment on data quality unless it changes a conclusion.',
  '',
  'Find PATTERNS, not one-offs. Be specific, fair and kind; this is for coaching. Separate the AM\'s actions from the firm\'s own delays',
  'and from product limits. Credit what goes well. Every claim needs refs ("gong:ID" or "firm:FIRMID") from the material; never invent refs.',
  '',
  'Return ONLY a JSON object (no code fence) with exactly these keys:',
  '{"headline": "one or two sentences: the overall read across both groups",',
  ' "strengths": [{"point": "...", "refs": []}],',
  ' "onboarding": {',
  '   "sentiment": [{"point": "...", "refs": []}],',
  '   "responsiveness": [{"point": "...", "refs": []}],',
  '   "onboarding_time": [{"point": "pace vs 70 days and the team; stalls", "refs": []}],',
  '   "roadblocks": [{"point": "what is blocking which firms, and whose side", "refs": []}],',
  '   "scheduling": [{"point": "firms without a next call, gaps between calls", "refs": []}],',
  '   "spotlights": [{"firm": "name", "firm_id": "id", "status": "on track | at risk | stalled", "what_happened": "...", "next_step": "...", "refs": []}]},',
  ' "live": {',
  '   "sentiment": [{"point": "...", "refs": []}],',
  '   "responsiveness": [{"point": "...", "refs": []}],',
  '   "frustrations": [{"point": "roadblocks and frustrations live customers raise", "refs": []}],',
  '   "usage": [{"point": "who is and isn\'t using Lawmatics, never-engaged and churn-risk accounts, what the AM is doing about it", "refs": []}],',
  '   "spotlights": [{"firm": "name", "firm_id": "id", "status": "healthy | low usage | at risk", "what_happened": "...", "next_step": "...", "refs": []}]},',
  ' "bugs": [{"issue": "a Lawmatics bug customers hit", "firms": "which firms", "status": "what is known: fixed, ticket open, no update", "refs": []}],',
  ' "feature_requests": [{"request": "what customers asked Lawmatics to add or change", "firms": "which firms", "refs": []}],',
  ' "coaching": [{"action": "a concrete thing to work on", "why": "the evidence, briefly"}],',
  ' "follow_up": [{"item": "a firm or issue a manager should look at now", "refs": []}]}',
  'BUGS and FEATURE REQUESTS: list every distinct one raised on calls, in email, or in the ChurnZero bug / feature-request fields, from both',
  'groups, combining duplicates across firms (most firms first). These are product issues, not the AM\'s fault.',
  'Other lists: 2-4 items each (coaching 3-4, spotlights 3-5 per group). Plain language.',
].join('\n');

var IM_FIRM_PROMPT = [
  'You review ONE law firm\'s Lawmatics account for the Customer Success managers: its onboarding end to end, and, if it is live,',
  '  how it is going since (usage, sentiment, frustrations).',
  IM_RUBRIC,
  '',
  'You get: the firm\'s profile (stage, days, pauses, milestones, 30-day usage, sales notes); every recorded call with Gong\'s summary',
  '[gong:ID]; the full transcript of the latest call; the email threads with the firm; and any real call signals (churn risk, blocked by',
  'a bug, sold vs reality). Be specific and fair: separate the IM\'s actions from the firm\'s own delays and from product limits.',
  'If the firm is still IN ONBOARDING, focus on sentiment, responsiveness, onboarding time, roadblocks and whether the next call is scheduled;',
  'leave product usage out of "adoption" (say "in onboarding" there). If it is LIVE, go deep on usage in "adoption".',
  'List every bug and feature request the firm raised (calls, email, ChurnZero fields).',
  'Every claim needs refs ("gong:ID") where they exist; never invent refs.',
  '',
  'Return ONLY a JSON object (no code fence) with exactly these keys:',
  '{"headline": "one or two sentences: where this onboarding stands and why",',
  ' "status": "on track | at risk | stalled | done | healthy | low usage",',
  ' "timeline": [{"date": "YYYY-MM-DD", "event": "what happened (call, milestone, email, pause)"}],',
  ' "progression": [{"point": "...", "refs": []}],',
  ' "adoption": [{"point": "...", "refs": []}],',
  ' "sentiment": {"overview": "how the firm feels now and how that changed", "observations": [{"point": "...", "refs": []}]},',
  ' "risks": [{"risk": "...", "detail": "...", "refs": []}],',
  ' "bugs": [{"issue": "a Lawmatics bug this firm hit", "status": "fixed / ticket open / no update", "refs": []}],',
  ' "feature_requests": [{"request": "what the firm asked Lawmatics to add or change", "refs": []}],',
  ' "went_well": [{"point": "...", "refs": []}],',
  ' "next_steps": [{"action": "...", "owner": "IM | firm | manager | product"}],',
  ' "im_notes": [{"point": "coaching notes on how the IM ran this one", "refs": []}]}',
  'Timeline: the 6-12 moments that matter, oldest first. Other lists: 2-5 items. Plain language.',
].join('\n');

/* ---------- helpers ---------- */

function imDay_(iso) { return String(iso || '').slice(0, 10); }
function imDaysSince_(iso) { return iso ? Math.round((Date.now() - new Date(iso).getTime()) / 864e5) : null; }
// Same start date as the Implementation tab: StartDate, else the term start.
function imStart_(a) { return a.StartDate || (a.Cf && a.Cf.CurrentTermStart) || ''; }
function imOpen_(a) { return ['Pre-Kickoff', 'Open'].indexOf(String((a.Cf || {}).OnboardingStatus || '')) > -1; }
function imNorm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// AMs/IMs = everyone who owns a firm on the Implementation tab, with their ChurnZero email.
function imReps_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('im_reps');
  if (hit) return JSON.parse(hit);
  var sh = SpreadsheetApp.openById(SIGNAL_SHEET_ID).getSheetByName('Impl - Open Firms');
  var names = {};
  if (sh && sh.getLastRow() > 1) {
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var ci = head.indexOf('AccountManager');
    sh.getRange(2, ci + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { var n = String(r[0] || '').trim(); if (n && n !== 'Unassigned') names[n] = (names[n] || 0) + 1; });
  }
  var users = czUsers_(), out = [];
  Object.keys(names).sort().forEach(function (n) {
    var u = Object.keys(users).map(function (k) { return users[k]; }).filter(function (x) { return x.name === n && x.email; })[0];
    out.push({ id: 'im:' + imNorm_(n), name: n, email: u ? String(u.email).toLowerCase() : '', open: names[n] });
  });
  cache.put('im_reps', JSON.stringify(out), 6 * 3600);
  return out;
}

// Open onboardings for the firm picker.
function imOpenFirms_() {
  var sh = SpreadsheetApp.openById(SIGNAL_SHEET_ID).getSheetByName('Impl - Open Firms');
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  var h = rows.shift();
  var ix = function (k) { return h.indexOf(k); };
  return rows.filter(function (r) { return r[ix('FirmId')] && r[ix('Excluded')] !== '1'; }).map(function (r) {
    return { firmId: r[ix('FirmId')], name: r[ix('Name')], rep: r[ix('AccountManager')], days: Number(r[ix('DaysInOnboarding')]) || 0, stage: r[ix('Stage')] };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function imFirmLine_(a, extra) {
  var cf = a.Cf || {};
  var days = cf.OnboardingCompletedDate ? Number(cf.NewTimeInOnboarding) || null : imDaysSince_(imStart_(a));
  var ms = IM_MILESTONES.map(function (m) { return (cf[m[0]] === true ? '✓ ' : '✗ ') + m[1]; }).join(', ');
  var use = 'messages ' + (cf.OfMessagesSentl30 || 0) + ', meetings ' + (cf.OfMeetingsl30 || 0) +
    ', matters/mo ' + Math.round(cf.AvgMattersCreatedmonth || 0) + ', SMS ' + (cf.TotalSmsSent || 0) +
    (cf.OfMerlinEngageSessionsp30 ? ', Engage sessions ' + cf.OfMerlinEngageSessionsp30 : '');
  return '[firm:' + cf.FirmId + '] ' + a.Name + ' — ' + (cf.OnboardingCompletedDate ? 'DONE ' + imDay_(cf.OnboardingCompletedDate) + ' in ' + days + ' days'
    : (cf.OnboardingStatus || '') + ', stage "' + (cf.NewOnboardingCall || 'none') + '", day ' + days) +
    (cf.DateOnboardingPaused && !cf.DateOnboardingResumed ? ' (PAUSED since ' + imDay_(cf.DateOnboardingPaused) + ')' : '') +
    (a.PrimaryChurnScoreValue != null ? ', churn score ' + a.PrimaryChurnScoreValue : '') + '\n   milestones: ' + ms + '\n   30-day usage: ' + use + (extra || '');
}

function imContacts_(accountIds) {
  var out = {};
  for (var i = 0; i < accountIds.length; i += 15) {
    var f = accountIds.slice(i, i + 15).map(function (id) { return 'AccountId eq ' + id; }).join(' or ');
    czGet_('/Contact', { $filter: f, $select: 'AccountId,Email' }).forEach(function (c) {
      (out[c.AccountId] = out[c.AccountId] || []).push(String(c.Email || '').toLowerCase());
    });
  }
  return out;
}

// Email → firm (by contact email, else by the firm's non-free-mail domain).
function imFirmMatcher_(accounts, contacts) {
  var byEmail = {}, byDomain = {}, byName = {};
  accounts.forEach(function (a) {
    (contacts[a.Id] || []).forEach(function (em) {
      if (!em) return;
      byEmail[em] = a.Id;
      var d = em.split('@')[1];
      if (d && !FREE_MAIL.test(d + '.') && !/lawmatics\.com$/.test(d)) byDomain[d] = a.Id;
    });
    byName[imNorm_(a.Name)] = a.Id;
  });
  return {
    email: function (em) { em = String(em || '').toLowerCase(); return byEmail[em] || byDomain[em.split('@')[1]] || null; },
    name: function (n) { return byName[imNorm_(n)] || null; },
  };
}

/* ---------- Gong ---------- */

function imGongCalls_(uid, fromIso, callIds) {
  var filter = callIds ? { callIds: callIds } : { fromDateTime: fromIso, toDateTime: new Date().toISOString(), primaryUserIds: [uid] };
  var out = [], cursor = null, guard = 0;
  do {
    var r = gongFetch_('/v2/calls/extensive', { cursor: cursor || undefined, filter: filter, contentSelector: { context: 'Extended',
      exposedFields: { parties: true, content: { brief: true, keyPoints: true, callOutcome: true }, interaction: { personInteractionStats: true, speakers: true, questions: true } } } });
    (r && r.calls || []).forEach(function (c) { out.push(c); });
    cursor = r && r.records && r.records.cursor;
  } while (cursor && guard++ < 15);
  return out;
}

function imCallInfo_(c, repEmail) {
  var m = c.metaData || {}, content = c.content || {}, inter = c.interaction || {};
  var me = (c.parties || []).filter(function (p) { return String(p.emailAddress || '').toLowerCase() === repEmail; })[0];
  var stats = {};
  var ids = me ? [me.userId, me.id, me.speakerId].filter(Boolean).map(String) : [];
  var entry = (inter.personInteractionStats || []).filter(function (s) {
    return (repEmail && String(s.personEmailAddress || s.emailAddress || '').toLowerCase() === repEmail) || ids.indexOf(String(s.personId || s.userId || s.speakerId || '')) > -1;
  })[0];
  // Stat names vary in spacing/case ("Talk Ratio", "talkRatio"): compare them squashed.
  ((entry && entry.stats) || []).forEach(function (s) { stats[String(s.name || '').toLowerCase().replace(/[^a-z]/g, '')] = s.value; });
  var keyPoints = (content.keyPoints || []).map(function (k) { return k.text || k; }).filter(Boolean);
  return {
    id: String(m.id), title: m.title || 'Call', date: imDay_(m.started), minutes: Math.round((m.duration || 0) / 60), url: m.url || '',
    brief: String(content.brief || '').slice(0, 1400), keyPoints: keyPoints.slice(0, 8), outcome: content.callOutcome && content.callOutcome.name || '',
    talk: stats.talkratio != null ? Math.round(stats.talkratio <= 1 ? stats.talkratio * 100 : stats.talkratio) : imTalkShare_(inter.speakers, ids, m.duration),
    monologue: stats.longestmonologue != null ? Math.round(stats.longestmonologue) : null,
    patience: stats.patience != null ? Math.round(stats.patience * 10) / 10 : null,
    questions: inter.questions ? (inter.questions.companyCount || 0) : null,
    parties: (c.parties || []).map(function (p) { return { email: String(p.emailAddress || '').toLowerCase(), name: p.name || '', affiliation: p.affiliation || '' }; }),
    crmNames: (c.context || []).reduce(function (acc, ctx) {
      (ctx.objects || []).forEach(function (o) { if (o.objectType === 'Account') (o.fields || []).forEach(function (f) { if (f.name === 'Name') acc.push(f.value); }); });
      return acc;
    }, []),
  };
}

// Fallback when Gong has no per-person stats: the IM's talk time as a share of the call. Gong's speakers list
// only has Lawmatics people, so the call's length (not the speakers' total) is the denominator.
function imTalkShare_(speakers, ids, durationSec) {
  speakers = speakers || [];
  var total = 0, mine = 0;
  speakers.forEach(function (sp) {
    var t = Number(sp.talkTime) || 0;
    total += t;
    if (ids.indexOf(String(sp.userId || '')) > -1 || ids.indexOf(String(sp.id || '')) > -1) mine += t;
  });
  var denom = Number(durationSec) || 0;
  return denom > 60 && mine > 0 ? Math.min(100, Math.round(100 * mine / denom)) : null;
}

function imCallText_(c, firmName) {
  return '[gong:' + c.id + '] ' + c.date + ' · ' + (firmName || 'unmatched firm') + ' · ' + c.title + ' · ' + c.minutes + ' min' +
    (c.talk != null ? ' · IM talked ' + c.talk + '% of the call' : '') + (c.monologue != null ? ' · longest monologue ' + c.monologue + 's' : '') +
    (c.questions != null ? ' · IM questions ' + c.questions : '') + (c.outcome ? ' · outcome: ' + c.outcome : '') + '\n' +
    (c.brief || '(no Gong brief)') + (c.keyPoints.length ? '\nKey points: ' + c.keyPoints.join(' | ') : '');
}

/* ---------- email (ChurnZero Gmail sync) ---------- */

function imThreads_(repEmail, fromIso, matcher, onlyAccount) {
  var sent = czGet_('/Message', { $filter: "Type eq 'Gmail' and DeliveryDate gt " + fromIso + " and EmailFromAddress eq '" + repEmail.replace(/'/g, "''") + "'",
    $select: 'ThreadId', $top: 100 });
  var ids = {};
  sent.forEach(function (m) { if (m.ThreadId) ids[m.ThreadId] = true; });
  var threads = {};
  var list = Object.keys(ids);
  for (var i = 0; i < list.length; i += 15) {
    var f = list.slice(i, i + 15).map(function (t) { return "ThreadId eq '" + t + "'"; }).join(' or ');
    czGet_('/Message', { $filter: f, $select: 'Id,ThreadId,DeliveryDate,EmailFromAddress,Subject,Content,ToRecipients' }).forEach(function (m) {
      (threads[m.ThreadId] = threads[m.ThreadId] || []).push(m);
    });
  }
  var out = [];
  Object.keys(threads).forEach(function (t) {
    var msgs = threads[t].sort(function (a, b) { return a.DeliveryDate < b.DeliveryDate ? -1 : 1; });
    var acct = null;
    msgs.forEach(function (m) {
      if (acct) return;
      var addrs = [m.EmailFromAddress].concat((m.ToRecipients || []).map(function (r) { return r.Email; }));
      addrs.forEach(function (a) { if (!acct && !/@lawmatics\.com$/i.test(a || '')) acct = matcher.email(a); });
    });
    if (onlyAccount && acct !== onlyAccount) return;
    // Internal-only threads (everyone @lawmatics.com) aren't customer email.
    var external = msgs.some(function (m) { return !/@lawmatics\.com$/i.test(m.EmailFromAddress || '') || (m.ToRecipients || []).some(function (r) { return !/@lawmatics\.com$/i.test(r.Email || ''); }); });
    if (!external) return;
    // Waits: a customer message → the rep's next reply (weekend days don't count).
    var waits = [];
    msgs.forEach(function (m, i) {
      if (/@lawmatics\.com$/i.test(m.EmailFromAddress || '')) return;
      var reply = msgs.slice(i + 1).filter(function (x) { return String(x.EmailFromAddress || '').toLowerCase() === repEmail; })[0];
      if (reply) waits.push(imBusinessHours_(m.DeliveryDate, reply.DeliveryDate));
    });
    out.push({ id: t, accountId: acct, subject: String(msgs[0].Subject || '').slice(0, 120), first: imDay_(msgs[0].DeliveryDate), last: imDay_(msgs[msgs.length - 1].DeliveryDate),
      count: msgs.length, fromCustomer: msgs.filter(function (m) { return !/@lawmatics\.com$/i.test(m.EmailFromAddress || ''); }).length, waits: waits, msgs: msgs });
  });
  return out;
}

// Hours between two times that fall on weekdays 6am–6pm Pacific (a 5pm email answered at 9am = 4h).
function imBusinessHours_(fromIso, toIso) {
  var a = new Date(fromIso).getTime(), b = new Date(toIso).getTime(), h = 0;
  for (var t = a; t < b && h < 2000; t += 3600e3) {
    var d = new Date(t);
    var dow = Number(Utilities.formatDate(d, 'America/Los_Angeles', 'u')), hr = Number(Utilities.formatDate(d, 'America/Los_Angeles', 'H'));
    if (dow <= 5 && hr >= 6 && hr < 18) h++;
  }
  return h;
}

function imThreadText_(th, repEmail, maxChars) {
  var lines = th.msgs.map(function (m) {
    var who = String(m.EmailFromAddress || '').toLowerCase() === repEmail ? 'IM' : /@lawmatics\.com$/i.test(m.EmailFromAddress || '') ? 'Lawmatics teammate' : 'Customer';
    var body = auditStrip_(m.Content || '').split(/\n(On .+ wrote:|From: .+)/)[0].trim();   // drop quoted history
    return imDay_(m.DeliveryDate) + ' ' + who + ': ' + body.slice(0, 700);
  });
  var text = 'EMAIL "' + th.subject + '" (' + th.count + ' messages)\n' + lines.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) + '\n…' : text;
}

/* ---------- signals + CSAT + team ---------- */

function imSignals_(repName, fromDay, firmId) {
  var sh = SpreadsheetApp.openById(SIGNAL_SHEET_ID).getSheetByName(SIGNAL_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  var ix = function (k) { return SIGNAL_COLUMNS.indexOf(k); };
  return sh.getRange(2, 1, sh.getLastRow() - 1, SIGNAL_COLUMNS.length).getDisplayValues().filter(function (r) {
    return r[ix('Verdict')] === 'yes' && /^ai/i.test(r[ix('GongTracker')]) && r[ix('Date')] >= fromDay &&
      (firmId ? r[ix('FirmId')] === String(firmId) : r[ix('Rep')] === repName);
  }).map(function (r) { return { callId: r[ix('CallId')], date: r[ix('Date')], firmId: r[ix('FirmId')], firm: r[ix('Firm')], signal: r[ix('Tracker')].replace(/^Onboarding – /, ''), reason: r[ix('Reason')], quote: String(r[ix('Quotes')] || '').slice(0, 300) }; });
}

function imCsat_(repName, fromDay, firmId) {
  var sh = SpreadsheetApp.openById(SIGNAL_SHEET_ID).getSheetByName('Impl - Firm Events');
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  var h = rows.shift(), ix = function (k) { return h.indexOf(k); };
  return rows.filter(function (r) { return r[ix('Type')] === 'csat' && r[ix('Date')] >= fromDay && (firmId ? r[ix('FirmId')] === String(firmId) : r[ix('AccountManager')] === repName); })
    .map(function (r) { return { firmId: r[ix('FirmId')], firm: r[ix('Name')], score: Number(r[ix('Score')]) || 0, comment: String(r[ix('Comment')] || '').slice(0, 300), date: r[ix('Date')] }; });
}

// The Implementation tab's numbers for the rep and the team median across AMs, so the audit matches that tab:
// open / over 70 / median days open from "Impl - Open Firms"; finished + CSAT this month from "Impl - Monthly".
function imTeam_(repName) {
  var ss = SpreadsheetApp.openById(SIGNAL_SHEET_ID);
  var med = function (v) { v = v.filter(function (x) { return x != null && !isNaN(x); }).sort(function (a, b) { return a - b; }); return v.length ? v[Math.floor(v.length / 2)] : null; };
  var by = {};
  var os = ss.getSheetByName('Impl - Open Firms');
  if (os && os.getLastRow() > 1) {
    var rows = os.getRange(1, 1, os.getLastRow(), os.getLastColumn()).getDisplayValues();
    var h = rows.shift(), ix = function (k) { return h.indexOf(k); };
    rows.forEach(function (r) {
      if (r[ix('Excluded')] === '1') return;
      var rep = r[ix('AccountManager')] || 'Unassigned';
      if (rep === 'Unassigned') return;
      var d = Number(r[ix('DaysInOnboarding')]) || 0;
      var o = by[rep] = by[rep] || { open: 0, over70: 0, days: [] };
      o.open++; if (d > IM_GOOD_DAYS) o.over70++; o.days.push(d);
    });
  }
  var stats = {}, month = '';
  var ms = ss.getSheetByName('Impl - Monthly');
  if (ms && ms.getLastRow() > 1) {
    var head = ms.getRange(1, 1, 1, ms.getLastColumn()).getValues()[0];
    var row = ms.getRange(ms.getLastRow(), 1, 1, ms.getLastColumn()).getDisplayValues()[0];
    month = row[0];
    try { stats = JSON.parse(row[head.indexOf('RepStats')] || '{}'); } catch (e) { stats = {}; }
  }
  var reps = Object.keys(by);
  var pick = function (rep) {
    var o = by[rep] || { open: 0, over70: 0, days: [] }, m = stats[rep] || {};
    return { openNow: o.open, openOver70Days: o.over70, medianDaysOpenFirms: med(o.days),
      finishedThisMonth: m.closed || 0, finishedThisMonthMedianDays: m.medianDays || null, onboardingCsatPctThisMonth: m.csatPct == null ? null : m.csatPct };
  };
  var all = reps.map(pick);
  var team = {};
  ['openNow', 'openOver70Days', 'medianDaysOpenFirms', 'finishedThisMonth', 'finishedThisMonthMedianDays', 'onboardingCsatPctThisMonth'].forEach(function (k) {
    team[k] = med(all.map(function (x) { return x[k]; }).filter(function (x) { return x !== null && x !== ''; }));
  });
  return { month: month, rep: pick(repName), teamMedianPerAm: team };
}

/* ---------- rep audit ---------- */

// Next scheduled ChurnZero meeting per open firm, from the Implementation tab ("" = needs scheduling).
function imNextMeetings_() {
  var sh = SpreadsheetApp.openById(SIGNAL_SHEET_ID).getSheetByName('Impl - Open Firms');
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var rows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  var h = rows.shift(), ix = function (k) { return h.indexOf(k); };
  rows.forEach(function (r) { out[r[ix('FirmId')]] = r[ix('NextMeeting')] || ''; });
  return out;
}

// ChurnZero's free-text bug / feature-request / pain-point fields, when filled in.
function imProductNotes_(cf) {
  var out = [];
  if (cf.OutstandingOnboardingBugs) out.push('BUGS (ChurnZero): ' + String(cf.OutstandingOnboardingBugs).slice(0, 300));
  if (cf.OnboardingFeatureRequests) out.push('FEATURE REQUESTS (ChurnZero): ' + String(cf.OnboardingFeatureRequests).slice(0, 300));
  if (cf.ProductPainPoints) out.push('PAIN POINTS (ChurnZero): ' + String(cf.ProductPainPoints).slice(0, 300));
  return out.length ? '\n   ' + out.join(' · ') : '';
}

function imUsageLine_(a) {
  var cf = a.Cf || {};
  return 'msgs30 ' + (cf.OfMessagesSentl30 || 0) + ', SMS ' + (cf.TotalSmsSent || 0) + ', matters/mo ' + Math.round(cf.AvgMattersCreatedmonth || 0) +
    ', leads/mo ' + Math.round(cf.AvgMonthlyLeadVolumelifetime || 0) + ', meetings30 ' + (cf.OfMeetingsl30 || 0) +
    (cf.OfMerlinEngageSessionsp30 ? ', Engage30 ' + cf.OfMerlinEngageSessionsp30 : '');
}

// Live account flags (no AI): what makes it worth a look.
function imLiveFlags_(a) {
  var cf = a.Cf || {}, f = [];
  if (/never engaged/i.test(cf.OnboardingStatus || '')) f.push('never engaged');
  if ((cf.OfMessagesSentl30 || 0) < 10 && (cf.AvgMattersCreatedmonth || 0) < 2) f.push('low usage');
  if (a.PrimaryChurnScoreValue != null && a.PrimaryChurnScoreValue >= IM_HIGH_CHURN) f.push('churn ' + a.PrimaryChurnScoreValue);
  if (cf.CancellationRequested === true) f.push('cancellation requested');
  if (cf.DangerZone === true) f.push('danger zone');
  return f;
}

function imAuditRep_(rep, id) {
  var fromMs = Date.now() - IM_DAYS * 864e5, fromIso = new Date(fromMs).toISOString(), fromDay = fromIso.slice(0, 10);
  var accounts = czGet_('/Account', { $filter: "IsActive eq true and Cf/AccountManager eq '" + rep.name.replace(/'/g, "''") + "'", $select: IM_ACCOUNT_FIELDS })
    .filter(function (a) { var cf = a.Cf || {}; return !cf.AgencyFirm && !cf.AgencyClientFirm && !cf.Consultant; });
  var contacts = imContacts_(accounts.map(function (a) { return a.Id; }));
  var matcher = imFirmMatcher_(accounts, contacts);
  var byId = {}; accounts.forEach(function (a) { byId[a.Id] = a; });
  var next = imNextMeetings_();

  var uid = gongUserId_(rep.email);
  var calls = uid ? imGongCalls_(uid, fromIso).map(function (c) { return imCallInfo_(c, rep.email); }) : [];
  calls.forEach(function (c) {
    c.accountId = null;
    c.parties.forEach(function (p) { if (!c.accountId && !/@lawmatics\.com$/i.test(p.email)) c.accountId = matcher.email(p.email); });
    if (!c.accountId) c.crmNames.forEach(function (n) { if (!c.accountId) c.accountId = matcher.name(n); });
  });
  calls.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var threads = imThreads_(rep.email, fromIso, matcher, null);
  var signals = imSignals_(rep.name, fromDay);
  var csat = imCsat_(rep.name, new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10));
  var team = imTeam_(rep.name);
  var med = function (v) { v = v.slice().sort(function (a, b) { return a - b; }); return v.length ? v[Math.floor(v.length / 2)] : null; };

  var facts = accounts.map(function (a) {
    var cf = a.Cf || {};
    var myCalls = calls.filter(function (c) { return c.accountId === a.Id; });
    var myThreads = threads.filter(function (t) { return t.accountId === a.Id; });
    var lastTouch = [myCalls.length ? myCalls[myCalls.length - 1].date : '', myThreads.reduce(function (m, t) { return t.last > m ? t.last : m; }, '')].sort().pop() || '';
    var onboarding = imOpen_(a);
    var days = onboarding ? imDaysSince_(imStart_(a)) || 0 : Number(cf.NewTimeInOnboarding) || 0;
    var mySignals = signals.filter(function (s) { return s.firmId === String(cf.FirmId); });
    var myCsat = csat.filter(function (s) { return s.firmId === String(cf.FirmId); });
    var waits = myThreads.reduce(function (acc, t) { return acc.concat(t.waits); }, []);
    var nextCall = onboarding ? (next[String(cf.FirmId)] || '') : '';
    var risk = 0, flags = onboarding ? [] : imLiveFlags_(a);
    if (onboarding) {
      if (days > IM_GOOD_DAYS) risk += 4; else if (days > 50) risk += 2;
      if (!lastTouch || imDaysSince_(lastTouch) > 14) risk += 3;
      if (!nextCall) risk += 2;
    } else {
      risk += flags.length * 2 + (myCalls.length || myThreads.length ? 1 : 0);
    }
    risk += 3 * mySignals.length;
    if (myCsat.some(function (s) { return s.score && s.score <= 3; })) risk += 3;
    if (waits.some(function (w) { return w > 24; })) risk += 1;
    return { a: a, onboarding: onboarding, days: days, calls: myCalls, threads: myThreads, lastTouch: lastTouch, signals: mySignals, csat: myCsat,
      waits: waits, nextCall: nextCall, flags: flags, risk: risk, touched: myCalls.length + myThreads.length > 0 };
  });
  var onb = facts.filter(function (f) { return f.onboarding; }).sort(function (x, y) { return y.risk - x.risk; });
  var live = facts.filter(function (f) { return !f.onboarding; }).sort(function (x, y) { return y.risk - x.risk; });
  // Closer look: 4 onboarding (3 riskiest + 1 steady) and 4 live (3 riskiest touched/flagged + 1 healthy touched).
  var pickOnb = onb.slice(0, 3).concat(onb.slice(3).filter(function (f) { return f.risk < 3; }).slice(0, 1));
  var pickLive = live.filter(function (f) { return f.flags.length || f.touched; }).slice(0, 3)
    .concat(live.filter(function (f) { return !f.flags.length && f.touched; }).slice(0, 1));
  var sample = pickOnb.concat(pickLive);

  var waitsAll = function (list) { return list.reduce(function (acc, f) { return acc.concat(f.waits); }, []); };
  var talk = calls.map(function (c) { return c.talk; }).filter(function (x) { return x != null; });
  var lf = function (k) { return live.filter(function (f) { return f.flags.some(function (x) { return x.indexOf(k) === 0; }); }).length; };
  var stats = {
    kind: 'im', firms: accounts.length, callsLed: calls.length, callsMatched: calls.filter(function (c) { return c.accountId; }).length, talkMedian: med(talk),
    emailThreads: threads.length, replyMedianHours: med(waitsAll(facts)), slowReplies: waitsAll(facts).filter(function (w) { return w > 24; }).length,
    signals: signals.length, csatN: csat.length, csatPct: csat.length ? Math.round(100 * csat.filter(function (s) { return s.score >= 4; }).length / csat.length) : null,
    team: team,
    onboarding: { open: team ? team.rep.openNow : onb.length, over70: team ? team.rep.openOver70Days : onb.filter(function (f) { return f.days > IM_GOOD_DAYS; }).length,
      medianDaysOpen: team ? team.rep.medianDaysOpenFirms : med(onb.map(function (f) { return f.days; })),
      noNextCall: onb.filter(function (f) { return !f.nextCall; }).length, quiet14: onb.filter(function (f) { return !f.lastTouch || imDaysSince_(f.lastTouch) > 14; }).length,
      replyMedianHours: med(waitsAll(onb)) },
    live: { accounts: live.length, touched: live.filter(function (f) { return f.touched; }).length, lowUsage: lf('low usage'), neverEngaged: lf('never engaged'),
      highChurn: lf('churn'), cancelling: lf('cancellation'), replyMedianHours: med(waitsAll(live)),
      mrrAtRisk: Math.round(live.filter(function (f) { return f.flags.length; }).reduce(function (t, f) { return t + (Number(f.a.TotalContractAmount) || 0); }, 0)) },
    sampled: sample.map(function (f) { return { firmId: String(f.a.Cf.FirmId), name: f.a.Name, onboarding: f.onboarding }; }),
    firmNames: {}, callList: calls.map(function (c) { return { id: c.id, title: c.title, date: c.date, url: c.url, firmId: c.accountId && byId[c.accountId] ? String(byId[c.accountId].Cf.FirmId) : '' }; }),
  };
  accounts.forEach(function (a) { stats.firmNames[String(a.Cf.FirmId)] = a.Name; });

  var firmName = function (accountId) { return accountId && byId[accountId] ? byId[accountId].Name : ''; };
  var touch = function (f) {
    return ' · last touch ' + (f.lastTouch || 'none in 30 days') + ' · calls ' + f.calls.length + ' · email threads ' + f.threads.length +
      (f.waits.length ? ' · slowest reply ' + Math.max.apply(null, f.waits) + 'h' : '') +
      (f.signals.length ? ' · SIGNALS: ' + f.signals.map(function (s) { return s.signal; }).join(', ') : '') +
      (f.csat.length ? ' · CSAT ' + f.csat.map(function (s) { return s.score; }).join('/') : '');
  };
  var liveShown = live.filter(function (f) { return f.flags.length || f.touched; }).slice(0, 70);
  var context = 'AM: ' + rep.name + '\nWINDOW: last ' + IM_DAYS + ' days for calls and email\n\nIMPLEMENTATION TAB NUMBERS (this AM vs the median AM): ' + JSON.stringify(team) +
    '\nCALLS: ' + calls.length + ' led, AM talked ' + (stats.talkMedian == null ? '?' : stats.talkMedian + '%') + ' of the call (median)' +
    '\nEMAIL: ' + threads.length + ' customer threads, AM reply median ' + stats.replyMedianHours + ' business hours, ' + stats.slowReplies + ' replies over 24 business hours' +
    '\nONBOARDING CSAT (90 days): ' + (csat.map(function (s) { return s.firm + ' ' + s.score + '/5' + (s.comment ? ' — ' + s.comment : ''); }).join('; ') || 'none') +
    '\nREAL CALL SIGNALS: ' + (signals.map(function (s) { return '[gong:' + s.callId + '] ' + s.firm + ' — ' + s.signal + ': ' + s.reason; }).join('; ') || 'none') +
    '\n\n=== IN ONBOARDING (' + onb.length + ' firms) — numbers: ' + JSON.stringify(stats.onboarding) + '\n' +
    onb.map(function (f) {
      var cf = f.a.Cf || {};
      return '[firm:' + cf.FirmId + '] ' + f.a.Name + ' — ' + (cf.OnboardingStatus || '') + ', stage "' + (cf.NewOnboardingCall || 'none') + '", day ' + f.days +
        (cf.DateOnboardingPaused && !cf.DateOnboardingResumed ? ' (PAUSED since ' + imDay_(cf.DateOnboardingPaused) + ')' : '') +
        ' · next call ' + (f.nextCall || 'NONE SCHEDULED') + touch(f) + imProductNotes_(cf);
    }).join('\n') +
    '\n\n=== LIVE ACCOUNTS (' + live.length + ' in the whole book) — numbers: ' + JSON.stringify(stats.live) +
    '\nShown: every flagged account and every account the AM talked to in the window (' + liveShown.length + '). Unflagged, untouched accounts are left out.\n' +
    liveShown.map(function (f) {
      var cf = f.a.Cf || {};
      return '[firm:' + cf.FirmId + '] ' + f.a.Name + ' — live' + (cf.OnboardingCompletedDate ? ' since ' + imDay_(cf.OnboardingCompletedDate) : '') +
        ', MRR $' + Math.round(f.a.TotalContractAmount || 0) + (f.a.PrimaryChurnScoreValue != null ? ', churn ' + f.a.PrimaryChurnScoreValue : '') +
        (f.flags.length ? ' · FLAGS: ' + f.flags.join(', ') : '') + '\n   usage: ' + imUsageLine_(f.a) + touch(f) + imProductNotes_(cf);
    }).join('\n') +
    '\n\nCLOSER LOOK (email text):\n' + sample.map(function (f) {
      return '=== [firm:' + f.a.Cf.FirmId + '] ' + f.a.Name + (f.onboarding ? ' (onboarding)' : ' (live)') + ' ===\n' +
        (f.onboarding && f.a.Cf.SalesOnboardingNotes ? 'Sales notes: ' + String(f.a.Cf.SalesOnboardingNotes).slice(0, 400) + '\n' : '') +
        (f.threads.slice(-3).map(function (t) { return imThreadText_(t, rep.email, 1600); }).join('\n\n') || '(no email in the window)');
    }).join('\n\n');
  var callsText = calls.map(function (c) {
    var f = c.accountId ? facts.filter(function (x) { return x.a.Id === c.accountId; })[0] : null;
    return imCallText_(c, firmName(c.accountId) + (f ? (f.onboarding ? ' (onboarding)' : ' (live)') : ''));
  }).join('\n\n---\n\n') || '(No Gong calls led by this AM in the window.)';
  if (context.length > 75000) context = context.slice(0, 75000) + '\n…(trimmed)';
  if (callsText.length > 55000) callsText = callsText.slice(0, 55000) + '\n…(trimmed)';
  return { stats: stats, context: context, callsText: callsText, prompt: IM_REP_PROMPT };
}

/* ---------- firm audit ---------- */

function imAuditFirm_(firmId) {
  var a = czGet_('/Account', { $filter: "Cf/FirmId eq '" + String(firmId).replace(/[^\d]/g, '') + "'", $select: IM_ACCOUNT_FIELDS })[0];
  if (!a) throw new Error('Firm ' + firmId + ' wasn’t found in ChurnZero.');
  var cf = a.Cf || {};
  var users = czUsers_();
  var repName = String(cf.AccountManager || '').trim();
  var rep = Object.keys(users).map(function (k) { return users[k]; }).filter(function (u) { return u.name === repName; })[0] || null;
  var repEmail = rep ? String(rep.email).toLowerCase() : '';
  var start = imStart_(a);
  var fromMs = Math.max(Date.now() - IM_FIRM_LOOKBACK_DAYS * 864e5, start ? new Date(start).getTime() - 14 * 864e5 : 0);
  var fromIso = new Date(fromMs).toISOString();
  var contacts = imContacts_([a.Id]);
  var matcher = imFirmMatcher_([a], contacts);
  var domains = {};
  (contacts[a.Id] || []).forEach(function (em) { var d = em.split('@')[1]; if (d && !FREE_MAIL.test(d + '.')) domains[d] = true; });
  var found = gongCallsForFirm_(a.Name, domains, (contacts[a.Id] || []).map(function (e) { return { Email: e }; }), null)
    .filter(function (c) { return c.started >= fromIso; });
  var calls = found.length ? imGongCalls_(null, null, found.map(function (c) { return c.id; })).map(function (c) { return imCallInfo_(c, repEmail); }) : [];
  calls.sort(function (x, y) { return x.date < y.date ? -1 : 1; });
  var latest = calls[calls.length - 1];
  var transcript = latest ? gongTranscript_({ id: latest.id }) : '';
  if (transcript.length > 30000) transcript = transcript.slice(0, 30000) + '\n(…trimmed)';
  var threads = repEmail ? imThreads_(repEmail, fromIso, matcher, a.Id) : [];
  var fromDay = fromIso.slice(0, 10);
  var signals = imSignals_(repName, fromDay, cf.FirmId);
  var csat = imCsat_(repName, fromDay, cf.FirmId);
  var waits = threads.reduce(function (acc, t) { return acc.concat(t.waits); }, []).sort(function (x, y) { return x - y; });
  var days = cf.OnboardingCompletedDate ? Number(cf.NewTimeInOnboarding) || 0 : imDaysSince_(start) || 0;
  var stats = {
    kind: 'firm', firmId: String(cf.FirmId), firm: a.Name, rep: repName, status: cf.OnboardingStatus || '', stage: cf.NewOnboardingCall || '', days: days,
    started: imDay_(start), completed: imDay_(cf.OnboardingCompletedDate), milestones: IM_MILESTONES.map(function (m) { return { name: m[1], done: cf[m[0]] === true }; }),
    usage: { messages: cf.OfMessagesSentl30 || 0, meetings: cf.OfMeetingsl30 || 0, matters: Math.round(cf.AvgMattersCreatedmonth || 0), sms: cf.TotalSmsSent || 0 },
    callsFound: calls.length, emailThreads: threads.length, replyMedianHours: waits.length ? waits[Math.floor(waits.length / 2)] : null, signals: signals.length,
    csat: csat.map(function (s) { return s.score; }),
    callList: calls.map(function (c) { return { id: c.id, title: c.title, date: c.date, url: c.url, firmId: String(cf.FirmId) }; }),
    firmNames: {},
  };
  stats.firmNames[String(cf.FirmId)] = a.Name;
  var context = 'FIRM PROFILE (' + (imOpen_(a) ? 'IN ONBOARDING' : 'LIVE') + ')\n' + imFirmLine_(a, imProductNotes_(cf)) + (imOpen_(a) ? '' : '\n   full usage: ' + imUsageLine_(a)) +
    '\nAM: ' + repName + ' · started ' + imDay_(start) +
    (cf.SalesOnboardingNotes ? '\nSales notes: ' + String(cf.SalesOnboardingNotes).slice(0, 1500) : '') +
    (cf.KeyChallenges ? '\nKey challenges: ' + String(cf.KeyChallenges).slice(0, 800) : '') +
    '\n\nREAL CALL SIGNALS:\n' + (signals.map(function (s) { return '[gong:' + s.callId + '] ' + s.date + ' — ' + s.signal + ': ' + s.reason + (s.quote ? ' “' + s.quote + '”' : ''); }).join('\n') || '(none)') +
    '\n\nONBOARDING CSAT: ' + (csat.map(function (s) { return s.score + '/5' + (s.comment ? ' — ' + s.comment : ''); }).join('; ') || '(none)') +
    '\n\nEMAIL THREADS (' + threads.length + ', IM reply median ' + stats.replyMedianHours + ' business hours):\n' +
    threads.map(function (t) { return imThreadText_(t, repEmail, 2500); }).join('\n\n') +
    (transcript ? '\n\nLATEST CALL TRANSCRIPT [gong:' + latest.id + '] ' + latest.date + ':\n' + transcript : '');
  var callsText = calls.map(function (c) { return imCallText_(c, a.Name); }).join('\n\n---\n\n') || '(No Gong calls found for this firm.)';
  if (context.length > 90000) context = context.slice(0, 90000) + '\n…(trimmed)';
  if (callsText.length > 40000) callsText = callsText.slice(0, 40000) + '\n…(trimmed)';
  return { stats: stats, context: context, callsText: callsText, prompt: IM_FIRM_PROMPT, repName: repName, repEmail: repEmail, name: a.Name };
}

/* ---------- run / list ---------- */

function imRun_(b, who) {
  var kind = b.firmId ? 'firm' : 'im';
  var label, email, key;
  if (kind === 'im') {
    var rep = imReps_().filter(function (r) { return r.id === String(b.repId); })[0];
    if (!rep) throw new Error('Pick an implementation manager.');
    if (!rep.email) throw new Error('No ChurnZero email for ' + rep.name + '.');
    label = rep.name; email = rep.email; key = rep.id;
  } else {
    key = 'firm:' + String(b.firmId).replace(/[^\d]/g, '');
    label = String(b.firmName || 'Firm ' + b.firmId).slice(0, 80); email = '';
  }
  var running = auditRows_().filter(function (r) { return String(r.AdminId) === key && r.Status === 'running' && Date.now() - new Date(r.Requested) < 15 * 60000; })[0];
  if (running) return { ok: true, id: String(running.Id), already: true };
  var id = Utilities.getUuid().slice(0, 8);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { auditSheet_().appendRow([id, 'running', label, email, key, who.email, new Date(), '', '', '', '', kind]); } finally { lock.releaseLock(); }
  try {
    var built = kind === 'im' ? imAuditRep_(rep, id) : imAuditFirm_(b.firmId);
    if (kind === 'firm') auditSet_(id, { Rep: built.name + (built.repName ? ' · ' + built.repName : ''), RepEmail: built.repEmail });
    auditSet_(id, { Stats: JSON.stringify(built.stats) });
    var hook = PropertiesService.getScriptProperties().getProperty('ZAPIER_HOOK_URL') || (typeof ZAPIER_HOOK_SECRET_URL === 'undefined' ? '' : ZAPIER_HOOK_SECRET_URL);
    if (!hook || typeof ZAPIER_HOOK_KEY === 'undefined') throw new Error('The Zapier hook isn’t set up.');
    var requestId = Utilities.getUuid(), secret = Utilities.getUuid();
    CacheService.getScriptCache().put('audreq_' + requestId, JSON.stringify({ secret: secret, id: id }), 6 * 3600);
    var res = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ kind: 'audit', requestId: requestId, token: secret, hookKey: ZAPIER_HOOK_KEY, callbackUrl: CALLBACK_URL,
        instructions: built.prompt, context: built.context, transcript: built.callsText, items: '[]' }) });
    if (res.getResponseCode() >= 300) throw new Error('Couldn’t start the AI step (Zapier HTTP ' + res.getResponseCode() + ').');
    return { ok: true, id: id };
  } catch (err) {
    auditSet_(id, { Status: 'failed', Error: String(err.message || err).slice(0, 300), Finished: new Date().toISOString() });
    throw err;
  }
}

// Editor check: one IM's book size, Gong calls with briefs, and email threads (no AI, nothing saved).
function checkImAudit() {
  CacheService.getScriptCache().remove('im_reps');
  var reps = imReps_();
  Logger.log('IMs: ' + reps.map(function (r) { return r.name + ' <' + (r.email || 'no email') + '> ' + r.open + ' open'; }).join(', '));
  var rep = reps.filter(function (r) { return r.email; })[0];
  if (!rep) return;
  var built = imAuditRep_(rep, 'check');
  var s = built.stats;
  Logger.log(rep.name + ': ' + s.firms + ' accounts · onboarding ' + JSON.stringify(s.onboarding) + ' · live ' + JSON.stringify(s.live) + ' · ' + s.callsLed + ' Gong calls (' + s.callsMatched + ' matched to a firm) · talk median ' + s.talkMedian +
    '% · ' + s.emailThreads + ' email threads · reply median ' + s.replyMedianHours + 'h · ' + s.signals + ' signals · context ' + built.context.length + ' + calls ' + built.callsText.length + ' chars');
  Logger.log('First call brief: ' + built.callsText.slice(0, 400));
  var uid = gongUserId_(rep.email);
  var raw = uid ? imGongCalls_(uid, new Date(Date.now() - 7 * 864e5).toISOString())[0] : null;
  if (raw) Logger.log('Gong stats sample: ' + JSON.stringify({ me: (raw.parties || []).filter(function (p) { return String(p.emailAddress || '').toLowerCase() === rep.email; }),
    stats: (raw.interaction || {}).personInteractionStats, speakers: (raw.interaction || {}).speakers }).slice(0, 1500));
}
