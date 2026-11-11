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
var IM_ACCOUNT_FIELDS = 'Id,Name,StartDate,IsActive,PrimaryChurnScoreValue,UsageFrequency,Cf/FirmId,Cf/AccountManager,Cf/CurrentTermStart,' +
  'Cf/OnboardingStatus,Cf/NewOnboardingCall,Cf/OnboardingCompletedDate,Cf/NewTimeInOnboarding,Cf/DateOnboardingPaused,Cf/DateOnboardingResumed,' +
  'Cf/TimeOnboardingPaused,Cf/LeadSourcesConnected,Cf/DocumentsFormsApproved,Cf/FirstHalfOfAutomationsApproved,Cf/SecondHalfOfAutomationsApproved,' +
  'Cf/TeamTrainingComplete,Cf/OnboardingDocumentsUploaded,Cf/OfMessagesSentl30,Cf/OfActivitiesLoggedl30,Cf/OfMeetingsl30,Cf/AvgMattersCreatedmonth,' +
  'Cf/TotalSmsSent,Cf/AiCreditsUsedThisCycle,Cf/OfMerlinEngageSessionsp30,Cf/AgencyFirm,Cf/AgencyClientFirm,Cf/Consultant,Cf/SalesOnboardingNotes,Cf/KeyChallenges';
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
].join('\n');

var IM_REP_PROMPT = [
  'You help the Customer Success managers at Lawmatics coach one implementation manager (IM, called "AM" until January).',
  IM_RUBRIC,
  '',
  'You get: the IM\'s numbers for the last 30 days next to the team; one line per firm in their book (stage, days, milestones, usage);',
  'Gong summaries of every call they led, labeled [gong:ID] with the firm; email response-time facts; and a closer timeline for a few',
  'sample firms [firm:FIRMID]. Calls show Gong\'s talk ratio (IM share of talking), longest monologue and question counts.',
  '',
  'Find PATTERNS across firms and calls, not one-offs. Be specific, fair and kind; this is for coaching. Keep apart: product limits or',
  'bugs, and firms that stall for their own reasons (busy, no-shows), vs. the IM\'s own process and skills. Credit what goes well.',
  'Every claim needs refs ("gong:ID" or "firm:FIRMID") from the material; never invent refs. If the material is thin, say so.',
  '',
  'Return ONLY a JSON object (no code fence) with exactly these keys:',
  '{"headline": "one or two sentences: the overall read",',
  ' "strengths": [{"point": "...", "refs": []}],',
  ' "progression": [{"point": "pace, stalls, gaps, 70-day risk", "refs": []}],',
  ' "adoption": [{"point": "are their firms actually using Lawmatics, and what the IM does about it", "refs": []}],',
  ' "sentiment": {"overview": "how customers feel on this IM\'s calls and emails", "observations": [{"point": "...", "refs": []}]},',
  ' "call_craft": [{"point": "agenda, discovery, talk ratio, homework with dates, next steps", "refs": []}],',
  ' "communication": [{"point": "email speed and clarity, follow-up between calls", "refs": []}],',
  ' "firm_spotlights": [{"firm": "firm name", "firm_id": "id", "status": "on track | at risk | stalled | done", "what_happened": "...", "next_step": "...", "refs": []}],',
  ' "coaching": [{"action": "a concrete thing to work on", "why": "the evidence, briefly"}],',
  ' "follow_up": [{"item": "a firm or issue a manager should look at now", "refs": []}]}',
  'Keep each list to the 3-5 most important items (coaching: 3-4, firm_spotlights: one per sample firm). Plain language.',
].join('\n');

var IM_FIRM_PROMPT = [
  'You review ONE law firm\'s Lawmatics onboarding end to end for the Customer Success managers.',
  IM_RUBRIC,
  '',
  'You get: the firm\'s profile (stage, days, pauses, milestones, 30-day usage, sales notes); every recorded call with Gong\'s summary',
  '[gong:ID]; the full transcript of the latest call; the email threads with the firm; and any real call signals (churn risk, blocked by',
  'a bug, sold vs reality). Be specific and fair: separate the IM\'s actions from the firm\'s own delays and from product limits.',
  'Every claim needs refs ("gong:ID") where they exist; never invent refs.',
  '',
  'Return ONLY a JSON object (no code fence) with exactly these keys:',
  '{"headline": "one or two sentences: where this onboarding stands and why",',
  ' "status": "on track | at risk | stalled | done",',
  ' "timeline": [{"date": "YYYY-MM-DD", "event": "what happened (call, milestone, email, pause)"}],',
  ' "progression": [{"point": "...", "refs": []}],',
  ' "adoption": [{"point": "...", "refs": []}],',
  ' "sentiment": {"overview": "how the firm feels now and how that changed", "observations": [{"point": "...", "refs": []}]},',
  ' "risks": [{"risk": "...", "detail": "...", "refs": []}],',
  ' "went_well": [{"point": "...", "refs": []}],',
  ' "next_steps": [{"action": "...", "owner": "IM | firm | manager | product"}],',
  ' "im_notes": [{"point": "coaching notes on how the IM ran this one", "refs": []}]}',
  'Timeline: the 6-12 moments that matter, oldest first. Other lists: 2-5 items. Plain language.',
].join('\n');

/* ---------- helpers ---------- */

function imDay_(iso) { return String(iso || '').slice(0, 10); }
function imDaysSince_(iso) { return iso ? Math.round((Date.now() - new Date(iso).getTime()) / 864e5) : null; }
function imStart_(a) { return (a.Cf && a.Cf.CurrentTermStart) || a.StartDate || ''; }
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
  var use = 'messages ' + (cf.OfMessagesSentl30 || 0) + ', activities ' + (cf.OfActivitiesLoggedl30 || 0) + ', meetings ' + (cf.OfMeetingsl30 || 0) +
    ', matters/mo ' + Math.round(cf.AvgMattersCreatedmonth || 0) + ', SMS ' + (cf.TotalSmsSent || 0) + ', AI credits ' + (cf.AiCreditsUsedThisCycle || 0) +
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
      exposedFields: { parties: true, content: { brief: true, keyPoints: true, callOutcome: true }, interaction: { personInteractionStats: true, questions: true } } } });
    (r && r.calls || []).forEach(function (c) { out.push(c); });
    cursor = r && r.records && r.records.cursor;
  } while (cursor && guard++ < 15);
  return out;
}

function imCallInfo_(c, repEmail) {
  var m = c.metaData || {}, content = c.content || {}, inter = c.interaction || {};
  var me = (c.parties || []).filter(function (p) { return String(p.emailAddress || '').toLowerCase() === repEmail; })[0];
  var stats = {};
  ((inter.personInteractionStats || []).filter(function (s) { return (repEmail && String(s.personEmailAddress || '').toLowerCase() === repEmail) || (me && me.userId && s.personId === me.userId); })[0] || { stats: [] })
    .stats.forEach(function (s) { stats[s.name] = s.value; });
  var keyPoints = (content.keyPoints || []).map(function (k) { return k.text || k; }).filter(Boolean);
  return {
    id: String(m.id), title: m.title || 'Call', date: imDay_(m.started), minutes: Math.round((m.duration || 0) / 60), url: m.url || '',
    brief: String(content.brief || '').slice(0, 1400), keyPoints: keyPoints.slice(0, 8), outcome: content.callOutcome && content.callOutcome.name || '',
    talk: stats['Talk Ratio'] != null ? Math.round(stats['Talk Ratio'] * 100) : null, monologue: stats['Longest Monologue'] != null ? Math.round(stats['Longest Monologue']) : null,
    patience: stats['Patience'] != null ? Math.round(stats['Patience'] * 10) / 10 : null,
    questions: inter.questions ? (inter.questions.companyCount || 0) : null,
    parties: (c.parties || []).map(function (p) { return { email: String(p.emailAddress || '').toLowerCase(), name: p.name || '', affiliation: p.affiliation || '' }; }),
    crmNames: (c.context || []).reduce(function (acc, ctx) {
      (ctx.objects || []).forEach(function (o) { if (o.objectType === 'Account') (o.fields || []).forEach(function (f) { if (f.name === 'Name') acc.push(f.value); }); });
      return acc;
    }, []),
  };
}

function imCallText_(c, firmName) {
  return '[gong:' + c.id + '] ' + c.date + ' · ' + (firmName || 'unmatched firm') + ' · ' + c.title + ' · ' + c.minutes + ' min' +
    (c.talk != null ? ' · IM talk ' + c.talk + '%' : '') + (c.monologue != null ? ' · longest monologue ' + c.monologue + 's' : '') +
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

function imBusinessHours_(fromIso, toIso) {
  var a = new Date(fromIso).getTime(), b = new Date(toIso).getTime(), h = 0;
  for (var t = a; t < b; t += 3600e3) { var d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) h++; }
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

// This month's Implementation-tab numbers for the rep and the team (medians across reps).
function imTeam_(repName) {
  var sh = SpreadsheetApp.openById(SIGNAL_SHEET_ID).getSheetByName('Impl - Monthly');
  if (!sh || sh.getLastRow() < 2) return null;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = sh.getRange(sh.getLastRow(), 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  var stats = {};
  try { stats = JSON.parse(row[head.indexOf('RepStats')] || '{}'); } catch (e) { stats = {}; }
  var reps = Object.keys(stats).filter(function (k) { return k !== 'Unassigned'; });
  var med = function (f) { var v = reps.map(function (k) { return Number(stats[k][f]); }).filter(function (x) { return !isNaN(x) && x > 0; }).sort(function (a, b) { return a - b; }); return v.length ? v[Math.floor(v.length / 2)] : null; };
  var me = stats[repName] || {};
  return { month: row[0], rep: { open: me.open, over70: me.over70, closed: me.closed, medianDays: me.medianDays, csatPct: me.csatPct },
    team: { open: med('open'), over70: med('over70'), closed: med('closed'), medianDays: med('medianDays'), csatPct: med('csatPct') } };
}

/* ---------- rep audit ---------- */

function imAuditRep_(rep, id) {
  var fromMs = Date.now() - IM_DAYS * 864e5, fromIso = new Date(fromMs).toISOString(), fromDay = fromIso.slice(0, 10);
  var accounts = czGet_('/Account', { $filter: "IsActive eq true and Cf/AccountManager eq '" + rep.name.replace(/'/g, "''") + "'", $select: IM_ACCOUNT_FIELDS })
    .filter(function (a) { var cf = a.Cf || {}; return !cf.AgencyFirm && !cf.AgencyClientFirm && !cf.Consultant && (imOpen_(a) || (cf.OnboardingCompletedDate && imDay_(cf.OnboardingCompletedDate) >= fromDay)); });
  var contacts = imContacts_(accounts.map(function (a) { return a.Id; }));
  var matcher = imFirmMatcher_(accounts, contacts);
  var byId = {}; accounts.forEach(function (a) { byId[a.Id] = a; });

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

  // Per-firm facts → risk score → sample.
  var facts = accounts.map(function (a) {
    var cf = a.Cf || {};
    var myCalls = calls.filter(function (c) { return c.accountId === a.Id; });
    var myThreads = threads.filter(function (t) { return t.accountId === a.Id; });
    var lastTouch = [myCalls.length ? myCalls[myCalls.length - 1].date : '', myThreads.reduce(function (m, t) { return t.last > m ? t.last : m; }, '')].sort().pop() || '';
    var days = cf.OnboardingCompletedDate ? Number(cf.NewTimeInOnboarding) || 0 : imDaysSince_(imStart_(a)) || 0;
    var done = IM_MILESTONES.filter(function (m) { return cf[m[0]] === true; }).length;
    var mySignals = signals.filter(function (s) { return s.firmId === String(cf.FirmId); });
    var myCsat = csat.filter(function (s) { return s.firmId === String(cf.FirmId); });
    var risk = 0;
    if (!cf.OnboardingCompletedDate) {
      if (days > IM_GOOD_DAYS) risk += 4; else if (days > 50) risk += 2;
      if (!lastTouch || imDaysSince_(lastTouch) > 14) risk += 3;
      if (days > 30 && done < 2) risk += 2;
      if ((cf.OfMessagesSentl30 || 0) + (cf.OfActivitiesLoggedl30 || 0) < 5 && days > 30) risk += 1;
    }
    risk += 3 * mySignals.length;
    if (myCsat.some(function (s) { return s.score && s.score <= 3; })) risk += 3;
    return { a: a, days: days, done: done, calls: myCalls, threads: myThreads, lastTouch: lastTouch, signals: mySignals, csat: myCsat, risk: risk, finished: !!cf.OnboardingCompletedDate };
  });
  var openF = facts.filter(function (f) { return !f.finished; }).sort(function (x, y) { return y.risk - x.risk; });
  var doneF = facts.filter(function (f) { return f.finished; }).sort(function (x, y) { return x.days - y.days; });
  var sample = openF.slice(0, 3).concat(doneF.slice(0, 2));
  var mid = openF.slice(3).filter(function (f) { return f.risk === 0 || f.risk < 3; });
  if (mid.length) sample.push(mid[Math.floor(mid.length / 2)]);
  sample = sample.slice(0, IM_SAMPLE);

  var waits = threads.reduce(function (acc, t) { return acc.concat(t.waits); }, []).sort(function (a, b) { return a - b; });
  var talk = calls.map(function (c) { return c.talk; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
  var mono = calls.map(function (c) { return c.monologue; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
  var med = function (v) { return v.length ? v[Math.floor(v.length / 2)] : null; };
  var stats = {
    kind: 'im', firms: accounts.length, open: openF.length, finished: doneF.length,
    over70: openF.filter(function (f) { return f.days > IM_GOOD_DAYS; }).length,
    quiet14: openF.filter(function (f) { return !f.lastTouch || imDaysSince_(f.lastTouch) > 14; }).length,
    finishedMedianDays: med(doneF.map(function (f) { return f.days; }).sort(function (a, b) { return a - b; })),
    callsLed: calls.length, callsMatched: calls.filter(function (c) { return c.accountId; }).length,
    talkMedian: med(talk), monologueMedian: med(mono),
    emailThreads: threads.length, replyMedianHours: med(waits), slowReplies: waits.filter(function (w) { return w > 24; }).length,
    signals: signals.length, csatN: csat.length, csatPct: csat.length ? Math.round(100 * csat.filter(function (s) { return s.score >= 4; }).length / csat.length) : null,
    team: team,
    sampled: sample.map(function (f) { return { firmId: String(f.a.Cf.FirmId), name: f.a.Name, risk: f.risk, finished: f.finished }; }),
    firmNames: {}, callList: calls.map(function (c) { return { id: c.id, title: c.title, date: c.date, url: c.url, firmId: c.accountId && byId[c.accountId] ? String(byId[c.accountId].Cf.FirmId) : '' }; }),
  };
  accounts.forEach(function (a) { stats.firmNames[String(a.Cf.FirmId)] = a.Name; });

  var firmName = function (accountId) { return accountId && byId[accountId] ? byId[accountId].Name : ''; };
  var context = 'IM: ' + rep.name + '\nWINDOW: last ' + IM_DAYS + ' days\n\nNUMBERS (rep vs team median, this month from the Implementation tab): ' + JSON.stringify(team) +
    '\nTHIS AUDIT: ' + JSON.stringify({ firmsInBook: stats.firms, open: stats.open, finishedInWindow: stats.finished, finishedMedianDays: stats.finishedMedianDays,
      openOver70Days: stats.over70, openWithNoTouch14Days: stats.quiet14, callsLed: stats.callsLed, imTalkRatioMedianPct: stats.talkMedian,
      longestMonologueMedianSec: stats.monologueMedian, emailThreads: stats.emailThreads, emailReplyMedianBusinessHours: stats.replyMedianHours,
      emailRepliesOver24BusinessHours: stats.slowReplies, realCallSignals: stats.signals, onboardingCsat90d: { pct: stats.csatPct, n: stats.csatN } }) +
    '\n\nBOOK (one line per firm):\n' + facts.map(function (f) {
      return imFirmLine_(f.a, '\n   last touch ' + (f.lastTouch || 'none in 30 days') + ' · calls ' + f.calls.length + ' · email threads ' + f.threads.length +
        (f.signals.length ? ' · SIGNALS: ' + f.signals.map(function (s) { return s.signal; }).join(', ') : '') +
        (f.csat.length ? ' · CSAT ' + f.csat.map(function (s) { return s.score; }).join('/') : ''));
    }).join('\n') +
    '\n\nREAL CALL SIGNALS:\n' + (signals.map(function (s) { return '[gong:' + s.callId + '] ' + s.date + ' ' + s.firm + ' — ' + s.signal + ': ' + s.reason + (s.quote ? ' “' + s.quote + '”' : ''); }).join('\n') || '(none)') +
    '\n\nONBOARDING CSAT (90 days):\n' + (csat.map(function (s) { return s.date + ' ' + s.firm + ' ' + s.score + '/5' + (s.comment ? ' — ' + s.comment : ''); }).join('\n') || '(none)') +
    '\n\nSAMPLE FIRMS (closer look):\n' + sample.map(function (f) {
      return '=== [firm:' + f.a.Cf.FirmId + '] ' + f.a.Name + (f.finished ? ' (finished)' : '') + ' ===\n' +
        (f.a.Cf.SalesOnboardingNotes ? 'Sales notes: ' + String(f.a.Cf.SalesOnboardingNotes).slice(0, 500) + '\n' : '') +
        f.threads.slice(-3).map(function (t) { return imThreadText_(t, rep.email, 1800); }).join('\n\n');
    }).join('\n\n');
  var callsText = calls.map(function (c) { return imCallText_(c, firmName(c.accountId)); }).join('\n\n---\n\n') || '(No Gong calls led by this IM in the window.)';
  if (context.length > 70000) context = context.slice(0, 70000) + '\n…(trimmed)';
  if (callsText.length > 60000) callsText = callsText.slice(0, 60000) + '\n…(trimmed)';
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
    usage: { messages: cf.OfMessagesSentl30 || 0, activities: cf.OfActivitiesLoggedl30 || 0, meetings: cf.OfMeetingsl30 || 0, matters: Math.round(cf.AvgMattersCreatedmonth || 0), sms: cf.TotalSmsSent || 0, ai: cf.AiCreditsUsedThisCycle || 0 },
    callsFound: calls.length, emailThreads: threads.length, replyMedianHours: waits.length ? waits[Math.floor(waits.length / 2)] : null, signals: signals.length,
    csat: csat.map(function (s) { return s.score; }),
    callList: calls.map(function (c) { return { id: c.id, title: c.title, date: c.date, url: c.url, firmId: String(cf.FirmId) }; }),
    firmNames: {},
  };
  stats.firmNames[String(cf.FirmId)] = a.Name;
  var context = 'FIRM PROFILE\n' + imFirmLine_(a, '') + '\nIM: ' + repName + ' · started ' + imDay_(start) +
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
  Logger.log(rep.name + ': ' + s.firms + ' firms (' + s.open + ' open, ' + s.finished + ' finished) · ' + s.callsLed + ' Gong calls (' + s.callsMatched + ' matched to a firm) · talk median ' + s.talkMedian +
    '% · ' + s.emailThreads + ' email threads · reply median ' + s.replyMedianHours + 'h · ' + s.signals + ' signals · context ' + built.context.length + ' + calls ' + built.callsText.length + ' chars');
  Logger.log('First call brief: ' + built.callsText.slice(0, 600));
}
