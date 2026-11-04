/* ==========================================================================
   Call prep — backs the "Call prep" button on the Implementation tab's Open
   Onboardings list. Works out which onboarding call is next, finds the firm's
   most recent Gong call with the rep, and has Claude write a short prep sheet
   from its transcript plus our standard plan for that call (the CS Onboarding
   Roadmap deck, 9/2026). Read-only: nothing is written anywhere.

   prep       → { firmId, stage, nextMeeting, regenerate } — the firm's IM / account manager or a
                manager. Returns a cached prep (12 hours per firm + Gong call), or starts one and
                returns { pending, requestId }.
   prepStatus → { requestId } — the dashboard polls this until the prep arrives.
   prepResult → from the Zapier workflow (no Google sign-in; checked against a one-time token).
   calendarMatch → { firmIds } — for the dashboard's weekly calendar: each open-onboarding firm's
                contacts (names, emails, email domains) so a meeting titled with the client's name
                ("Onboarding – Jane Doe") or with them invited finds its firm, plus rep name → email
                from ChurnZero users (whose calendars to read). Cached 3 hours.
   complete   → { firmId } — the "Onboarding complete" button: sets the firm's Onboarding Status to
                Complete in ChurnZero (the firm's IM / account manager or a manager). Until the IM/CSM
                split's handoff form goes live, that's all it does. dryRun: true (local test) writes nothing.

   The writing is done by Claude through AI by Zapier (workflow "CS Dashboard – Call Prep"), so
   no Anthropic key is needed. If ANTHROPIC_API_KEY is ever set, it calls Claude directly instead.

   Script Properties:
     CZ_USER, CZ_KEY        ChurnZero read API (same as the other dashboard scripts)
     GONG_BASIC             Gong API "Basic" token (base64 of key:secret), as used by the
                            first-onboarding Zap — or GONG_ACCESS_KEY + GONG_ACCESS_SECRET
     GONG_BASE_URL          optional, defaults to Lawmatics' https://us-32500.api.gong.io
     ZAPIER_HOOK_URL        optional, overrides the catch-hook URL in secret.js
     ANTHROPIC_API_KEY      optional (direct Claude instead of Zapier)
     CZ_APP_KEY             ChurnZero write key (Admin → Application Keys), for "Onboarding complete"
     ASANA_TOKEN            Asana personal access token (read), for the firm's build tasks in the prep

   Deploy: Web app · Execute as: Me · Who has access: Anyone. Each request must carry a
   Google access token issued to the dashboard client (shared/dash-auth.js).
   ========================================================================== */

var CZ_BASE = 'https://lawmatics.us1app.churnzero.net/public/v1';
var CLAUDE_MODEL = 'claude-opus-5-5';
var GONG_LOOKBACK_DAYS = 150;
var CACHE_HOURS = 12;
var ASANA_WORKSPACE = '1199511629835021';
// The Zapier workflow "CS Dashboard – Call Prep": its catch-hook URL (ZAPIER_HOOK_SECRET_URL) and the
// key it checks (ZAPIER_HOOK_KEY) live in secret.js, which is pushed with clasp but kept out of git.
// Where Zapier posts the finished prep: this web app's public /exec address. (ScriptApp.getService().getUrl()
// can give a lawmatics.com-only or /dev address, which Zapier can't reach.)
var CALLBACK_URL = 'https://script.google.com/macros/s/AKfycbwltwhfY4-dLO6F5uyfzxIXIMcb_N0_zrk-2q0atrk_c8fMj4USTTcEJK4QsChbmAVR/exec';

// What each call normally covers (CS Onboarding Roadmap deck). Call numbers follow the
// ChurnZero onboarding stages ("First Onboarding" = call 1, …).
var CALL_PLAN = [
  'Call 1 — Kickoff / intake pipeline build (Phase 1, discovery & asset collection). Attendees: the firm\'s primary decision-maker, the intake decision-maker, whoever runs intake day to day. Confirm goals and the intake workflow, review the current intake process and spot improvements, and set up the intake outline that guides the build. Collect: intake forms and custom fields (and current workflows), email templates / intake communications, contacts and matter data, e-signature templates and documents. Ready, Set, Launch! webinar comes before this call.',
  'Merlin call (if the firm has Merlin Qualify or Engage) — a dedicated 60-minute call at the start of Phase 2: set the intake criteria that decide which leads to chase and what happens for each recommendation, and build the outreach agents (tone, follow-up frequency, what they gather).',
  'Call 2 — Forms/documents review + initial automation review (Phase 2, automation build & review). Attendees: the intake decision-maker, whoever owns the forms and documents being sent out, anyone weighing in on automations. Review the forms and documents the firm sent and the automations built after call 1.',
  'Calls 2–4 — Automation approval rounds (Phase 2). Attendees: the intake decision-maker plus any staff whose day-to-day workflow the automation touches. Walk through each automation (routing, follow-ups, internal notifications), get feedback and revisions, work toward final approval and sign-off.',
  'Calls 5–6 — Team trainings (Phase 3, may be skipped for small firms whose key people joined Phase 2). Attendees: everyone who will use the platform day to day; the decision-maker usually doesn\'t need to lead. Train on the finalized intake workflow, walk a real intake scenario start to finish, answer "how" and "when" questions.',
  'Final — Migration & go-live (Phase 4). Confirm what data should be migrated, import contacts and matters, confirm data integrity and readiness, delivery call and final walkthrough. Onboarding is usually done within six calls (plus the Merlin call) and 6–10 weeks.',
].join('\n');

function doGet() { return dashJson_({ ok: true, message: 'Call prep endpoint is live.' }); }

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return dashJson_({ ok: false, error: 'bad request' }); }
  try {
    if (b.action === 'prepResult') return dashJson_(prepResult_(b));   // Zapier; checked by its token
    var who = dashAuth_(b.token);
    if (!who.ok) return dashJson_(who);
    if (b.action === 'prep') return dashJson_(prep_(b, who));
    if (b.action === 'prepStatus') return dashJson_(prepStatus_(b));
    if (b.action === 'complete') return dashJson_(complete_(b, who));
    if (b.action === 'calendarMatch') return dashJson_(calendarMatch_(b));
    return dashJson_({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error(err && err.stack || err);
    return dashJson_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- calendar matching ---------- */

var FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|icloud|aol|live|msn|me|mac|comcast|att|sbcglobal|verizon|protonmail|proton)\./;

function calendarMatch_(b) {
  var ids = (b.firmIds || []).map(function (x) { return String(x).replace(/[^\d]/g, ''); }).filter(Boolean)
    .filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 400).sort();
  var cache = CacheService.getScriptCache();
  var key = 'calm_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, ids.join(','))).slice(0, 22);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var byAcct = {};   // ChurnZero account Id → Firm ID
  for (var i = 0; i < ids.length; i += 15) {
    var f = ids.slice(i, i + 15).map(function (id) { return "Cf/FirmId eq '" + id + "'"; }).join(' or ');
    czGet_('/Account', { $filter: f, $select: 'Id,Cf/FirmId' }).forEach(function (a) { byAcct[a.Id] = String((a.Cf || {}).FirmId || ''); });
  }
  var firms = {};
  var acctIds = Object.keys(byAcct);
  for (var j = 0; j < acctIds.length; j += 15) {
    var g = acctIds.slice(j, j + 15).map(function (id) { return 'AccountId eq ' + id; }).join(' or ');
    czGet_('/Contact', { $filter: g, $select: 'AccountId,FirstName,LastName,Email' }).forEach(function (c) {
      var firmId = byAcct[c.AccountId];
      if (!firmId) return;
      var x = firms[firmId] = firms[firmId] || { names: [], emails: [], domains: [] };
      var name = (String(c.FirstName || '').trim() + ' ' + String(c.LastName || '').trim()).trim();
      if (name && name.indexOf(' ') > 0 && x.names.indexOf(name) < 0) x.names.push(name);   // first + last only; one word is too loose
      var email = String(c.Email || '').trim().toLowerCase();
      if (email && x.emails.indexOf(email) < 0) x.emails.push(email);
      var d = email.split('@')[1];
      if (d && !FREE_MAIL.test(d) && !/lawmatics\.com$/.test(d) && x.domains.indexOf(d) < 0) x.domains.push(d);
    });
  }
  var reps = {};
  var users = czUsers_();
  Object.keys(users).forEach(function (k) { var u = users[k]; if (u.name && u.email && u.active !== false) reps[u.name] = String(u.email).toLowerCase(); });
  var out = { ok: true, firms: firms, reps: reps };
  try { cache.put(key, JSON.stringify(out), 3 * 3600); } catch (e) { /* too big to cache */ }
  return out;
}

/* ---------- the prep ---------- */

function prep_(b, who) {
  var props = PropertiesService.getScriptProperties();
  var firmId = String(b.firmId || '').replace(/[^\d]/g, '');
  if (!firmId) throw new Error('missing Firm ID');
  var acct = czGet_('/Account', { $filter: "Cf/FirmId eq '" + firmId + "'",
    $select: 'Id,Name,ExternalId,StartDate,TotalContractAmount,LicenseCount,UserAccountId,Cf/AccountManager,Cf/ImplementationManager,Cf/OnboardingStatus,Cf/PracticeArea,Cf/IntakeProcess,Cf/KeyChallenges,Cf/SalesOnboardingNotes' })[0];
  if (!acct) throw new Error('Firm ' + firmId + ' wasn’t found in ChurnZero.');
  var cf = acct.Cf || {};
  var users = czUsers_();
  var repName = String(cf.ImplementationManager || cf.AccountManager || (users[acct.UserAccountId] || {}).name || '').trim();
  var rep = Object.keys(users).map(function (k) { return users[k]; }).filter(function (u) { return u.name === repName; })[0];
  if (!who.manager && !(rep && String(rep.email).toLowerCase() === who.email)) {
    throw new Error('Call prep is for the firm’s IM or a manager.');
  }

  var stage = String(b.stage || '').slice(0, 60);
  var contacts = czGet_('/Contact', { $filter: 'AccountId eq ' + acct.Id, $select: 'FirstName,LastName,Email,Cf/IncludeInOnboarding' });
  var domains = {};
  contacts.forEach(function (c) {
    var d = String(c.Email || '').toLowerCase().split('@')[1];
    if (d && !/^(gmail|yahoo|hotmail|outlook|icloud|aol|live|msn|me|comcast)\./.test(d)) domains[d] = true;
  });

  var calls = gongCallsForFirm_(acct.Name, domains, contacts, rep);
  var last = calls[0] || null;
  var key = 'prep_' + firmId + '_' + (last ? last.id : 'none') + '_' + stage;
  var cache = CacheService.getScriptCache();
  if (!b.regenerate) {
    var hit = cache.get(key);
    // The AI's prep keeps for 12 hours; the Asana list is always fresh.
    if (hit) { var c = JSON.parse(hit); c.cached = true; c.asana = asanaTasksSafe_(acct.Name); return c; }
  }

  var transcript = last ? gongTranscript_(last) : '';
  var firm = {
    name: acct.Name, firmId: firmId, im: repName, stage: stage || cf.OnboardingStatus || '',
    nextMeeting: String(b.nextMeeting || '').slice(0, 40), mrr: Number(acct.TotalContractAmount) || 0,
    started: String(acct.StartDate || '').slice(0, 10), licenses: acct.LicenseCount || '',
    practiceArea: [].concat(cf.PracticeArea || []).join(', '),
    salesNotes: String(cf.SalesOnboardingNotes || '').slice(0, 2000), intake: String(cf.IntakeProcess || '').slice(0, 1500),
    challenges: String(cf.KeyChallenges || '').slice(0, 1500),
    contacts: contacts.map(function (c) { return (String(c.FirstName || '') + ' ' + String(c.LastName || '')).trim() + (c.Cf && c.Cf.IncludeInOnboarding ? ' (onboarding contact)' : ''); }).filter(String).slice(0, 15),
  };
  var asana = asanaTasksSafe_(acct.Name);
  firm.asanaTasks = asana.tasks.map(function (t) {
    return t.name + ' — ' + (t.completed ? 'done ' + String(t.completedAt || '').slice(0, 10) : 'open' + (t.dueOn ? ', due ' + t.dueOn : '') + (t.section ? ', ' + t.section : ''));
  }).slice(0, 25);
  var out = {
    ok: true, asana: asana, firm: { name: firm.name, firmId: firmId, im: repName, stage: firm.stage, nextMeeting: firm.nextMeeting, mrr: firm.mrr },
    lastCall: last ? { title: last.title, date: last.started, url: last.url, minutes: Math.round((last.duration || 0) / 60) } : null,
    priorCalls: calls.length, prep: null, generated: null,
  };
  var prompt = prepPrompt_(firm, last, calls);
  if (props.getProperty('ANTHROPIC_API_KEY')) {
    out.prep = claudePrep_(props.getProperty('ANTHROPIC_API_KEY'), prompt, transcript);
    out.generated = new Date().toISOString();
    try { cache.put(key, JSON.stringify(out), CACHE_HOURS * 3600); } catch (e) { /* too big to cache */ }
    return out;
  }
  // Through Zapier: hand off, then the dashboard polls prepStatus until prepResult lands.
  var hook = props.getProperty('ZAPIER_HOOK_URL') || (typeof ZAPIER_HOOK_SECRET_URL === 'undefined' ? '' : ZAPIER_HOOK_SECRET_URL);
  if (!hook || typeof ZAPIER_HOOK_KEY === 'undefined') throw new Error('The Zapier hook (ZAPIER_HOOK_URL) isn’t set up yet.');
  var requestId = Utilities.getUuid(), secret = Utilities.getUuid();
  cache.put('req_' + requestId, JSON.stringify({ secret: secret, key: key, shell: out, at: Date.now() }), 3600);
  var res = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ requestId: requestId, token: secret, hookKey: ZAPIER_HOOK_KEY, callbackUrl: CALLBACK_URL,
      instructions: prompt.system + '\n\n' + prompt.task + '\n\nReturn ONLY a JSON object (no code fence) with exactly these keys: ' +
        JSON.stringify(PREP_SCHEMA.properties, null, 0),
      context: prompt.context, transcript: transcript || '' }) });
  if (res.getResponseCode() >= 300) { console.error('Zapier ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300)); throw new Error('Couldn’t start the prep (Zapier HTTP ' + res.getResponseCode() + ').'); }
  return { ok: true, pending: true, requestId: requestId, firm: out.firm, lastCall: out.lastCall };
}

function prepStatus_(b) {
  var cache = CacheService.getScriptCache();
  var done = cache.get('done_' + String(b.requestId || ''));
  if (done) return JSON.parse(done);
  if (!cache.get('req_' + String(b.requestId || ''))) return { ok: false, error: 'This prep expired — click Call prep again.' };
  return { ok: true, pending: true };
}

function prepResult_(b) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('req_' + String(b.requestId || ''));
  if (!raw) return { ok: false, error: 'unknown or expired request' };
  var req = JSON.parse(raw);
  if (!b.token || b.token !== req.secret) return { ok: false, error: 'bad token' };
  var out = req.shell;
  if (!b.prep) {
    out = { ok: false, error: String(b.error || 'The AI didn’t return a prep.').slice(0, 300) };
  } else {
    out.prep = b.prep;
    out.generated = new Date().toISOString();
    try { cache.put(req.key, JSON.stringify(out), CACHE_HOURS * 3600); } catch (e) { /* too big to cache */ }
  }
  cache.put('done_' + b.requestId, JSON.stringify(out), 3600);
  return { ok: true };
}

/* ---------- Onboarding complete ---------- */

var CZ_WRITE = 'https://lawmatics.us1app.churnzero.net/i';
var OPEN_STATUSES = ['Pre-Kickoff', 'Open'];

// The firm's IM / account manager (or a manager) marks the onboarding Complete.
function complete_(b, who) {
  var firmId = String(b.firmId || '').replace(/[^\d]/g, '');
  if (!firmId) throw new Error('missing Firm ID');
  var acct = czGet_('/Account', { $filter: "Cf/FirmId eq '" + firmId + "'",
    $select: 'Id,Name,ExternalId,UserAccountId,Cf/AccountManager,Cf/ImplementationManager,Cf/OnboardingStatus' })[0];
  if (!acct) throw new Error('Firm ' + firmId + ' wasn’t found in ChurnZero.');
  var cf = acct.Cf || {}, users = czUsers_();
  var repName = String(cf.ImplementationManager || cf.AccountManager || (users[acct.UserAccountId] || {}).name || '').trim();
  var rep = Object.keys(users).map(function (k) { return users[k]; }).filter(function (u) { return u.name === repName; })[0];
  if (!who.manager && !(rep && String(rep.email).toLowerCase() === who.email)) {
    throw new Error('Only the firm’s IM or a manager can mark this onboarding complete.');
  }
  if (OPEN_STATUSES.indexOf(cf.OnboardingStatus) < 0) {
    throw new Error(acct.Name + ' isn’t an open onboarding in ChurnZero (status: ' + (cf.OnboardingStatus || 'blank') + ').');
  }
  if (b.dryRun) return { ok: true, dryRun: true, firm: acct.Name };
  var appKey = PropertiesService.getScriptProperties().getProperty('CZ_APP_KEY');
  if (!appKey) throw new Error('The ChurnZero write key (CZ_APP_KEY) isn’t set up yet.');
  var res = UrlFetchApp.fetch(CZ_WRITE, { method: 'post', muteHttpExceptions: true, payload: {
    appKey: appKey, accountExternalId: acct.ExternalId, action: 'setAttribute', entity: 'account', name: 'OnboardingStatus', value: 'Complete' } });
  if (res.getResponseCode() >= 300) { console.error('ChurnZero write ' + res.getResponseCode()); throw new Error('ChurnZero rejected the change (HTTP ' + res.getResponseCode() + ').'); }
  // ChurnZero applies writes asynchronously; check back a few times.
  var confirmed = false;
  for (var i = 0; i < 4 && !confirmed; i++) {
    Utilities.sleep(2500);
    var after = czGet_('/Account', { $filter: 'Id eq ' + acct.Id, $select: 'Id,Cf/OnboardingStatus' })[0];
    confirmed = !!after && (after.Cf || {}).OnboardingStatus === 'Complete';
  }
  console.log('Onboarding complete: ' + acct.Name + ' (' + firmId + ') by ' + who.email + (confirmed ? '' : ' — not confirmed yet'));
  return { ok: true, firm: acct.Name, confirmed: confirmed };
}

/* ---------- Claude ---------- */

var PREP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['nextCall', 'oneLiner', 'lastCallRecap', 'firmCommitments', 'ourCommitments', 'openItems', 'agenda', 'attendees', 'watchFor'],
  properties: {
    nextCall: { type: 'string', description: 'Which call is next, short, e.g. "Call 2 — Forms & documents review" (no date)' },
    oneLiner: { type: 'string', description: 'One sentence on where this onboarding stands' },
    lastCallRecap: { type: 'array', items: { type: 'string' }, description: 'What was covered and decided on the last call' },
    firmCommitments: { type: 'array', items: { type: 'string' }, description: 'What the firm said they would do or send' },
    ourCommitments: { type: 'array', items: { type: 'string' }, description: 'What Lawmatics said it would do or build' },
    openItems: { type: 'array', items: { type: 'string' }, description: 'Unanswered questions, blockers, concerns or frustrations' },
    agenda: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'why'],
      properties: { item: { type: 'string' }, why: { type: 'string' } } } },
    attendees: { type: 'array', items: { type: 'string' }, description: 'Who from the firm should be on this call, by name when known' },
    watchFor: { type: 'array', items: { type: 'string' }, description: 'Risks or sensitivities to handle on this call' },
  },
};

// The same prompt goes to Claude directly or through Zapier: system rules + call plan, the firm,
// and the task. The transcript travels separately.
function prepPrompt_(firm, last, calls) {
  var system = 'You prepare Lawmatics implementation managers for their next onboarding call with a law firm. ' +
    'Be specific and practical: names, dates, documents and automations from the transcript, not generic advice. ' +
    'This is read in the minute before a call, so be brief: at most 5 bullets per list and at most 6 agenda items, ' +
    'each bullet under 15 words, the agenda "why" under 12 words, the one-liner under 30 words. Keep only what matters for the next call. ' +
    'Leave a list empty rather than guessing. Never invent what was said. ' +
    'The firm\'s Asana tasks (asanaTasks) show what our build team has finished and what is still open; ' +
    'use them to say what is ready to show and what is still being built.\n\n' +
    'Our standard onboarding plan:\n' + CALL_PLAN;
  var context = 'Firm: ' + JSON.stringify(firm) + '\n\n' +
    (last ? 'Most recent Gong call with this firm: "' + last.title + '" on ' + last.started + ' (' + Math.round((last.duration || 0) / 60) + ' min). ' +
      calls.length + ' Gong call(s) with the firm in the last ' + GONG_LOOKBACK_DAYS + ' days: ' +
      calls.slice(0, 8).map(function (c) { return c.started.slice(0, 10) + ' ' + c.title; }).join('; ')
      : 'There is no Gong recording with this firm yet, so base the prep on the stage, the sales notes and the standard plan.');
  var task = 'Today is ' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'EEEE, MMM d, yyyy') + '. ' +
    'Work out which call is next from the ChurnZero stage ("' + firm.stage + '") and the calls already held, then write the prep sheet for that call. ' +
    'The agenda should follow our plan for that call, adjusted for what is still open from the last call.';
  return { system: system, context: context, task: task };
}

function claudePrep_(apiKey, prompt, transcript) {
  var system = prompt.system;
  var user = prompt.context + '\n\n' + (transcript ? 'Transcript of the most recent call:\n' + transcript + '\n\n' : '') + prompt.task;
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 16000, fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PREP_SCHEMA } },
      system: system, messages: [{ role: 'user', content: user }],
    }),
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { /* not JSON */ }
  if (res.getResponseCode() !== 200) {
    console.error('Claude ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 800));
    throw new Error('The AI summary failed (HTTP ' + res.getResponseCode() + '). Try again in a minute.');
  }
  if (body.stop_reason === 'refusal') throw new Error('The AI declined to summarize this call.');
  var text = (body.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  try { return JSON.parse(text); } catch (e) { throw new Error('The AI summary came back incomplete (' + (body.stop_reason || 'unknown') + '). Try again.'); }
}

/* ---------- Gong ---------- */

function gongFetch_(path, payload) {
  var p = PropertiesService.getScriptProperties();
  var base = String(p.getProperty('GONG_BASE_URL') || 'https://us-32500.api.gong.io').replace(/\/+$/, '');
  var basic = p.getProperty('GONG_BASIC');
  var key = p.getProperty('GONG_ACCESS_KEY'), secret = p.getProperty('GONG_ACCESS_SECRET');
  if (!basic && !(key && secret)) throw new Error('The Gong API key (GONG_BASIC) isn’t set up yet.');
  var res = UrlFetchApp.fetch(base + path, {
    method: payload ? 'post' : 'get', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + (basic ? basic.replace(/^Basic\s+/i, '').trim() : Utilities.base64Encode(key + ':' + secret)) },
    payload: payload ? JSON.stringify(payload) : undefined,
  });
  if (res.getResponseCode() === 404) return null;   // Gong answers 404 when nothing matches
  if (res.getResponseCode() !== 200) {
    console.error('Gong ' + path + ' ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500));
    throw new Error('Gong didn’t respond (HTTP ' + res.getResponseCode() + ').');
  }
  return JSON.parse(res.getContentText());
}

// The rep's Gong user id, so we only page through their calls.
function gongUserId_(email) {
  if (!email) return null;
  var cache = CacheService.getScriptCache(), k = 'gu_' + email.toLowerCase();
  var hit = cache.get(k);
  if (hit) return hit === '-' ? null : hit;
  var id = null, cursor = null, guard = 0;
  do {
    var r = gongFetch_('/v2/users' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    (r && r.users || []).forEach(function (u) { if (String(u.emailAddress || '').toLowerCase() === email.toLowerCase()) id = u.id; });
    cursor = r && r.records && r.records.cursor;
  } while (!id && cursor && guard++ < 20);
  cache.put(k, id || '-', 21600);
  return id;
}

// The firm's calls, newest first: a participant from one of the firm's email domains or a
// known contact, or the Salesforce account on the call matching the firm's name.
function gongCallsForFirm_(firmName, domains, contacts, rep) {
  var emails = {};
  contacts.forEach(function (c) { if (c.Email) emails[String(c.Email).toLowerCase()] = true; });
  var filter = { fromDateTime: new Date(Date.now() - GONG_LOOKBACK_DAYS * 864e5).toISOString(), toDateTime: new Date().toISOString() };
  var uid = rep ? gongUserId_(rep.email) : null;
  if (uid) filter.primaryUserIds = [uid];
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var want = norm(firmName);
  var found = [], cursor = null, guard = 0;
  do {
    var r = gongFetch_('/v2/calls/extensive', { cursor: cursor || undefined, filter: filter,
      contentSelector: { context: 'Extended', exposedFields: { parties: true } } });
    (r && r.calls || []).forEach(function (c) {
      var parties = c.parties || [];
      var byPerson = parties.some(function (p) {
        var em = String(p.emailAddress || '').toLowerCase();
        return emails[em] || domains[em.split('@')[1]];
      });
      var byCrm = (c.context || []).some(function (ctx) {
        return (ctx.objects || []).some(function (o) {
          return o.objectType === 'Account' && (o.fields || []).some(function (f) { return f.name === 'Name' && want && norm(f.value) === want; });
        });
      });
      if (byPerson || byCrm) {
        var m = c.metaData || {};
        found.push({ id: m.id, title: m.title || 'Call', started: String(m.started || ''), duration: m.duration || 0, url: m.url || '' });
      }
    });
    cursor = r && r.records && r.records.cursor;
  } while (cursor && guard++ < 15);
  return found.sort(function (a, b) { return a.started < b.started ? 1 : -1; });
}

// Plain-text transcript ("Speaker: …"), trimmed to keep the request a sensible size.
function gongTranscript_(call) {
  var r = gongFetch_('/v2/calls/transcript', { filter: { callIds: [call.id] } });
  var t = (r && r.callTranscripts || [])[0];
  if (!t) return '(Transcript not available yet.)';
  var names = {};
  var meta = gongFetch_('/v2/calls/extensive', { filter: { callIds: [call.id] }, contentSelector: { exposedFields: { parties: true } } });
  ((meta && meta.calls && meta.calls[0] && meta.calls[0].parties) || []).forEach(function (p) { names[p.speakerId] = p.name || p.emailAddress || 'Speaker'; });
  var lines = [];
  (t.transcript || []).forEach(function (seg) {
    var text = (seg.sentences || []).map(function (s) { return s.text; }).join(' ');
    if (text) lines.push((names[seg.speakerId] || 'Speaker') + ': ' + text);
  });
  var all = lines.join('\n');
  return all.length > 80000 ? all.slice(0, 80000) + '\n(…transcript trimmed)' : all;
}

/* ---------- ChurnZero ---------- */

function czGet_(path, params) {
  var p = PropertiesService.getScriptProperties();
  var user = p.getProperty('CZ_USER'), key = p.getProperty('CZ_KEY');
  if (!user || !key) throw new Error('Set CZ_USER and CZ_KEY in Script Properties.');
  var qs = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  var url = CZ_BASE + path + (qs ? '?' + qs : ''), out = [], guard = 0;
  while (url && guard++ < 20) {
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Basic ' + Utilities.base64Encode(user + ':' + key) }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) { console.error('ChurnZero ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500)); throw new Error('ChurnZero didn’t respond (HTTP ' + res.getResponseCode() + ').'); }
    var body = JSON.parse(res.getContentText());
    out = out.concat(body.value || []);
    url = body['@odata.nextLink'] || null;
  }
  return out;
}

function czUsers_() {
  var map = {};
  czGet_('/UserAccount', { $select: 'Id,FirstName,LastName,Email,IsActive' }).forEach(function (u) {
    map[u.Id] = { id: u.Id, name: (String(u.FirstName || '').trim() + ' ' + String(u.LastName || '').trim()).trim(), email: u.Email, active: u.IsActive };
  });
  return map;
}

/* ---------- Asana ---------- */

// Lowercase words only, so "Garcia-Sheppard, L.L.P." and "garcia sheppard llp" compare equal.
function asanaNorm_(name) {
  return String(name || '').toLowerCase().replace(/[’'.]/g, '').replace(/[^a-z0-9&]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// "Garcia Sheppard, LLP" → "garcia sheppard": the part of the firm name the build team puts in task titles.
// Entity endings always go; "Law Group", "& Associates" and the like only while two or more words remain.
function firmCore_(name) {
  var s = asanaNorm_(name).replace(/^(the )?(law offices? of )?/, '');
  for (var i = 0; i < 4; i++) {
    s = s.replace(/ (llp|pllc|llc|pc|pa|apc|aplc|plc|ltd|inc|esq)$/, '');
    var t = s.replace(/ (attorneys?( at law)?|law( firm| group| office| offices| center| partners)?|& associates|and associates|group|firm)$/, '');
    if (t.split(' ').length >= 2) s = t;
  }
  return s;
}

// Every Asana task with the firm's name in its title, open ones first (by due date), then completed (newest first).
function asanaTasks_(firmName) {
  var token = PropertiesService.getScriptProperties().getProperty('ASANA_TOKEN');
  if (!token) return { ok: false, error: 'not set up', tasks: [] };
  var core = firmCore_(firmName);
  if (core.length < 3) return { ok: true, tasks: [] };
  var url = 'https://app.asana.com/api/1.0/workspaces/' + ASANA_WORKSPACE + '/tasks/search?limit=100&sort_by=modified_at' +
    '&text=' + encodeURIComponent(core) +
    '&opt_fields=' + encodeURIComponent('name,completed,completed_at,due_on,assignee.name,memberships.section.name,memberships.project.name,permalink_url');
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    console.error('Asana ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    return { ok: false, error: 'Asana HTTP ' + res.getResponseCode(), tasks: [] };
  }
  // Search also matches descriptions and comments; keep only tasks with the firm in the title.
  var tasks = (JSON.parse(res.getContentText()).data || []).filter(function (t) {
    return (' ' + asanaNorm_(t.name) + ' ').indexOf(' ' + core + ' ') >= 0;
  }).map(function (t) {
    var m = (t.memberships || [])[0] || {};
    return {
      name: t.name, completed: !!t.completed, completedAt: t.completed_at || '', dueOn: t.due_on || '',
      assignee: (t.assignee && t.assignee.name) || '', section: (m.section && m.section.name) || '',
      project: (m.project && m.project.name) || '', url: t.permalink_url || '',
    };
  });
  tasks.sort(function (a, b) {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (!a.completed) return (a.dueOn || '9999') < (b.dueOn || '9999') ? -1 : 1;
    return a.completedAt < b.completedAt ? 1 : -1;
  });
  return { ok: true, tasks: tasks };
}

// The prep still works if Asana is down or not set up; the pop-up just says so.
function asanaTasksSafe_(firmName) {
  try { return asanaTasks_(firmName); } catch (e) { console.error('Asana: ' + e); return { ok: false, error: 'Asana didn’t answer', tasks: [] }; }
}

/* ---------- checks (run from the editor) ---------- */

// Confirms the setup: Gong answers, and the Zapier hook is set.
function checkKeys() {
  var g = gongFetch_('/v2/users');
  Logger.log('Gong: ' + ((g && g.users) || []).length + ' users on the first page');
  var p = PropertiesService.getScriptProperties();
  Logger.log('Zapier hook: ' + (p.getProperty('ZAPIER_HOOK_URL') || (typeof ZAPIER_HOOK_SECRET_URL === 'undefined' ? 'not set' : 'secret.js')) + ' · direct Claude key: ' + (p.getProperty('ANTHROPIC_API_KEY') ? 'set' : 'not set (uses Zapier)'));
  Logger.log('Zapier posts results to: ' + CALLBACK_URL);
  var a = asanaTasks_('Garcia Sheppard');
  Logger.log('Asana: ' + (a.ok ? a.tasks.length + ' task(s) for Garcia Sheppard: ' + a.tasks.map(function (t) { return (t.completed ? '✓ ' : '○ ') + t.name; }).join(' | ') : a.error));
  var ping = UrlFetchApp.fetch(CALLBACK_URL, { muteHttpExceptions: true, followRedirects: true });
  Logger.log('That address answers: HTTP ' + ping.getResponseCode() + ' ' + ping.getContentText().slice(0, 120));
}

// Starts a real prep for one firm (as a manager) and logs the request — e.g. checkPrep('5447').
// With Zapier it finishes in the background; the dashboard pop-up shows it.
function checkPrep(firmId) {
  var out = prep_({ firmId: firmId || '5447', stage: '' }, { ok: true, manager: true, email: '' });
  Logger.log(JSON.stringify(out, null, 2));
}

// Run from the editor: lists the workspace's Gong trackers and checks whether this script's Gong key can
// read tracker hits on calls (for the planned Call signals panel). Logs names and counts only.
function checkGongTrackers() {
  try {
    var t = gongFetch_('/v2/settings/trackers');
    var list = (t && (t.keywordTrackers || t.trackers)) || [];
    Logger.log('Trackers in Gong: %s', list.length);
    list.forEach(function (x) {
      var n = x.trackerName || x.name;
      Logger.log(' - "%s"%s%s', n, x.enabled === false ? ' (off)' : '', signalTracker_(n) ? '  ← dashboard uses this as ' + signalTracker_(n) : '');
    });
  } catch (e) { Logger.log('Tracker list: %s', e.message); }
  // Hits per tracker on the last 7 days of calls (all reps), and how many the customer said.
  try {
    var to = new Date(), from = new Date(to.getTime() - 7 * 864e5), tally = {}, calls = 0, cursor = null, guard = 0;
    do {
      var c = gongFetch_('/v2/calls/extensive', { cursor: cursor || undefined, filter: { fromDateTime: from.toISOString(), toDateTime: to.toISOString() },
        contentSelector: { exposedFields: { parties: true, content: { trackers: true, trackerOccurrences: true } } } });
      ((c && c.calls) || []).forEach(function (x) {
        calls++;
        var ext = {};
        (x.parties || []).forEach(function (p) { if (p.affiliation === 'External') ext[p.speakerId] = true; });
        ((x.content || {}).trackers || []).forEach(function (k) {
          if (!k.count) return;
          var e = tally[k.name] = tally[k.name] || { calls: 0, hits: 0, customer: 0 };
          e.calls++; e.hits += k.count;
          e.customer += (k.occurrences || []).filter(function (o) { return ext[o.speakerId]; }).length;
        });
      });
      cursor = c && c.records && c.records.cursor;
    } while (cursor && guard++ < 10);
    Logger.log('Last 7 days: %s calls', calls);
    Object.keys(tally).sort().forEach(function (n) { var e = tally[n]; Logger.log(' - "%s": %s calls, %s hits, %s by the customer', n, e.calls, e.hits, e.customer); });
  } catch (e) { Logger.log('Tracker hits on calls: %s', e.message); }
}

/* ---------- Call signals ----------
   Hourly (installCallSignalsTrigger): the IMs' Gong calls from the last few days, with hits on
   the Gong trackers in SIGNAL_TRACKERS, matched to their onboarding firm, into the "Call Signals"
   tab of the Support Team Report sheet (one row per call × tracker, kept SIGNAL_KEEP_DAYS). The
   Implementation tab shows them to managers. Gong keeps processing calls for a while after they
   end, so every run re-reads the last SIGNAL_WINDOW_DAYS and replaces those calls' rows. */
var SIGNAL_SHEET_ID = '1eqPYnDmD194GREzSIlfceLWmQyaBRW18mptL_uVRKCc';
var SIGNAL_TAB = 'Call Signals';
// Only what the customer says counts (a hit by our IM is ignored), and only on calls with someone from outside.
// Feature Request was dropped 2026-11-04 as noise.
// Each signal and the Gong tracker names that feed it, preferred first (matched ignoring case and dash
// style). 2026-11-04: tightened onboarding trackers; Competitors and Feature Request dropped as noise.
var SIGNAL_TRACKERS = ['Onboarding – Churn risk', 'Onboarding – Blocked by a bug', 'Onboarding – Pushback'];
var SIGNAL_ALIASES = {
  'Onboarding – Churn risk': ['Onboarding – Churn risk'],
  'Onboarding – Blocked by a bug': ['Onboarding – Blocked by a bug', 'Product Bugs'],
  'Onboarding – Pushback': ['Onboarding – Pushback', 'Implementation Objection'],
};
var SIGNAL_VERSION = '5';      // bump when the rules change: the next run rebuilds the last SIGNAL_FIRST_DAYS
var SIGNAL_WINDOW_DAYS = 3;
var SIGNAL_FIRST_DAYS = 30;     // the first run fills in the last month
var SIGNAL_KEEP_DAYS = 90;
var SIGNAL_COLUMNS = ['CallId', 'Date', 'Rep', 'FirmId', 'Firm', 'CallTitle', 'CallUrl', 'Minutes', 'Tracker', 'Count', 'CustomerCount', 'Quotes'];

// Run once from the editor: authorizes the sheet access, installs the hourly run, and fills the tab.
function installCallSignalsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncCallSignals') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncCallSignals').timeBased().everyHours(1).create();
  syncCallSignals();
}

function syncCallSignals() {
  var ss = SpreadsheetApp.openById(SIGNAL_SHEET_ID);
  var sh = ss.getSheetByName(SIGNAL_TAB) || ss.insertSheet(SIGNAL_TAB);
  var props = PropertiesService.getScriptProperties();
  var rebuild = props.getProperty('SIGNAL_VERSION') !== SIGNAL_VERSION;
  var old = !rebuild && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, SIGNAL_COLUMNS.length).getDisplayValues() : [];
  var days = old.length ? SIGNAL_WINDOW_DAYS : SIGNAL_FIRST_DAYS;
  var to = new Date(), from = new Date(to.getTime() - days * 864e5);

  // The IMs: whoever owns an open onboarding (Impl - Open Firms), as Gong users.
  var open = sheetRows_(ss.getSheetByName('Impl - Open Firms'));
  var users = czUsers_(), byName = {};
  Object.keys(users).forEach(function (k) { if (users[k].name) byName[users[k].name] = users[k]; });
  var gongIds = {}, repByGong = {};
  open.forEach(function (f) {
    var u = byName[f.AccountManager];
    if (!u || gongIds[f.AccountManager] !== undefined) return;
    var id = gongUserId_(u.email);
    gongIds[f.AccountManager] = id;
    if (id) repByGong[id] = f.AccountManager;
  });
  var ids = Object.keys(repByGong);
  if (!ids.length) throw new Error('No IMs found in Gong.');
  var match = calendarMatch_({ firmIds: open.map(function (f) { return f.FirmId; }) }).firms;

  var calls = [], cursor = null, guard = 0;
  do {
    var r = gongFetch_('/v2/calls/extensive', { cursor: cursor || undefined,
      filter: { fromDateTime: from.toISOString(), toDateTime: to.toISOString(), primaryUserIds: ids },
      contentSelector: { context: 'Extended', exposedFields: { parties: true, content: { trackers: true, trackerOccurrences: true } } } });
    calls = calls.concat((r && r.calls) || []);
    cursor = r && r.records && r.records.cursor;
  } while (cursor && guard++ < 30);

  var rows = [], seen = {}, needQuotes = [];
  calls.forEach(function (c) {
    var m = c.metaData || {};
    seen[m.id] = true;
    var external = {};
    (c.parties || []).forEach(function (p) { if (p.affiliation === 'External' && p.speakerId) external[p.speakerId] = true; });
    var hits = ((c.content || {}).trackers || []).filter(function (t) {
      return signalTracker_(t.name) && (t.occurrences || []).some(function (o) { return external[o.speakerId]; });
    });
    // Where both the new and the old tracker fired for the same signal, keep only the preferred one.
    hits = hits.filter(function (t) {
      return !hits.some(function (u) { return u !== t && signalTracker_(u.name) === signalTracker_(t.name) && signalAliasRank_(u.name) < signalAliasRank_(t.name); });
    });
    if (!hits.length) return;
    var firm = signalFirm_(c, open, match);
    hits.forEach(function (t) {
      var occ = (t.occurrences || []).filter(function (o) { return external[o.speakerId]; }).sort(function (a, b) { return a.startTime - b.startTime; });
      var row = { CallId: m.id, Date: String(m.started || '').slice(0, 19), Rep: repByGong[m.primaryUserId] || '', FirmId: firm ? firm.FirmId : '',
        Firm: firm ? firm.Name : '', CallTitle: m.title || 'Call', CallUrl: m.url || '', Minutes: Math.round((m.duration || 0) / 60),
        Tracker: signalTracker_(t.name), Count: occ.length, CustomerCount: occ.length,
        _occ: occ.slice(0, 3), _ext: external };
      rows.push(row);
      if (needQuotes.indexOf(m.id) < 0) needQuotes.push(m.id);
    });
  });

  // The sentence at each hit, from the transcripts (20 calls per request).
  var quotes = {};
  for (var i = 0; i < needQuotes.length; i += 20) {
    var tr = gongFetch_('/v2/calls/transcript', { filter: { callIds: needQuotes.slice(i, i + 20) } });
    ((tr && tr.callTranscripts) || []).forEach(function (x) {
      var sents = [];
      (x.transcript || []).forEach(function (seg) { (seg.sentences || []).forEach(function (s) { sents.push({ start: s.start, end: s.end, text: s.text, who: seg.speakerId }); }); });
      quotes[x.callId] = sents;
    });
  }
  rows.forEach(function (row) {
    var sents = quotes[row.CallId] || [];
    row.Quotes = JSON.stringify(row._occ.map(function (o) {
      var ms = o.startTime * 1000;   // tracker hits are in seconds, transcript sentences in ms
      var k = -1;
      sents.forEach(function (s, j) { if (s.start <= ms + 500 && (k < 0 || s.start > sents[k].start)) k = j; });
      if (k < 0) return null;
      var text = sents[k].text + (sents[k + 1] && sents[k + 1].who === sents[k].who ? ' ' + sents[k + 1].text : '');
      return { t: Math.round(o.startTime), customer: !!row._ext[o.speakerId], text: text.slice(0, 280) };
    }).filter(Boolean));
  });

  // Keep older rows for calls this run didn't re-read; drop anything past SIGNAL_KEEP_DAYS.
  var cutoff = new Date(to.getTime() - SIGNAL_KEEP_DAYS * 864e5).toISOString().slice(0, 19);
  var keep = old.filter(function (r) { return !seen[r[0]] && r[1] >= cutoff; });
  var out = keep.concat(rows.map(function (r) { return SIGNAL_COLUMNS.map(function (c) { return r[c] === undefined ? '' : r[c]; }); }))
    .sort(function (a, b) { return a[1] < b[1] ? 1 : -1; });
  sh.clearContents();
  var all = [SIGNAL_COLUMNS].concat(out).map(function (r) { return r.map(function (v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }); });
  sh.getRange(1, 1, all.length, SIGNAL_COLUMNS.length).setNumberFormat('@').setValues(all);
  props.setProperty('SIGNAL_VERSION', SIGNAL_VERSION);
  console.log('Call signals: ' + calls.length + ' calls read, ' + rows.length + ' tracker rows written (' + out.length + ' kept in all)');
}

// Gong tracker name → our SIGNAL_TRACKERS spelling (ignoring case, spaces and -/–/—), or ''.
function signalTracker_(name) {
  var key = function (s) { return String(s || '').toLowerCase().replace(/[\s\-–—]+/g, ' ').trim(); };
  return SIGNAL_TRACKERS.filter(function (n) { return SIGNAL_ALIASES[n].some(function (a) { return key(a) === key(name); }); })[0] || '';
}
// Rank of a Gong tracker name among its signal's aliases (0 = preferred).
function signalAliasRank_(name) {
  var key = function (s) { return String(s || '').toLowerCase().replace(/[\s\-–—]+/g, ' ').trim(); };
  var sig = signalTracker_(name);
  return sig ? SIGNAL_ALIASES[sig].map(key).indexOf(key(name)) : 99;
}

// The call's onboarding firm: a firm contact on the call, then their email domain, then the call's
// Salesforce account name, then a contact's or the firm's name in the title.
function signalFirm_(c, open, match) {
  var norm = function (s) { return ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' '; };
  var emails = (c.parties || []).map(function (p) { return String(p.emailAddress || '').toLowerCase(); }).filter(Boolean);
  var title = norm((c.metaData || {}).title);
  var crm = [];
  (c.context || []).forEach(function (ctx) { (ctx.objects || []).forEach(function (o) {
    if (o.objectType === 'Account') (o.fields || []).forEach(function (f) { if (f.name === 'Name') crm.push(norm(f.value)); });
  }); });
  var info = function (f) { return match[String(f.FirmId)] || { names: [], emails: [], domains: [] }; };
  var tests = [
    function (f) { return emails.some(function (e) { return info(f).emails.indexOf(e) >= 0; }); },
    function (f) { return emails.some(function (e) { return info(f).domains.indexOf(e.split('@')[1]) >= 0; }); },
    function (f) { return crm.indexOf(norm(f.Name)) >= 0; },
    function (f) { return info(f).names.some(function (n) { return norm(n).trim().indexOf(' ') > 0 && title.indexOf(norm(n)) >= 0; }); },
    function (f) { var k = norm(firmCore_(f.Name)); return k.trim().length >= 4 && title.indexOf(k) >= 0; },
  ];
  for (var i = 0; i < tests.length; i++) { var hit = open.filter(tests[i])[0]; if (hit) return hit; }
  return null;
}

function sheetRows_(sh) {
  if (!sh) return [];
  var v = sh.getDataRange().getDisplayValues();
  var head = v[0] || [];
  return v.slice(1).map(function (r) { var o = {}; head.forEach(function (h, i) { o[String(h).trim()] = r[i]; }); return o; });
}

// Run from the editor: shows how Gong labels speakers on a few recent calls with tracker hits
// (field names, affiliations, speaker-id formats only — no names, emails or quotes).
function debugSignalSpeakers() {
  var to = new Date(), from = new Date(to.getTime() - 7 * 864e5);
  var r = gongFetch_('/v2/calls/extensive', { filter: { fromDateTime: from.toISOString(), toDateTime: to.toISOString() },
    contentSelector: { exposedFields: { parties: true, content: { trackers: true, trackerOccurrences: true } } } });
  var shown = 0;
  ((r && r.calls) || []).some(function (c) {
    var hits = ((c.content || {}).trackers || []).filter(function (t) { return signalTracker_(t.name) && t.count > 0; });
    if (!hits.length) return false;
    Logger.log('Call %s · parties: %s', ++shown, JSON.stringify((c.parties || []).map(function (p) {
      return { affiliation: p.affiliation, speakerId: p.speakerId ? String(p.speakerId).slice(0, 6) + '…' : null, keys: Object.keys(p).join(',') };
    })));
    var t = hits[0];
    Logger.log('  tracker keys: %s', Object.keys(t).join(','));
    Logger.log('  occurrence sample: %s', JSON.stringify((t.occurrences || []).slice(0, 2).map(function (o) {
      var x = {}; Object.keys(o).forEach(function (k) { x[k] = k === 'speakerId' ? String(o[k]).slice(0, 6) + '…' : o[k]; }); return x;
    })));
    Logger.log('  phrases sample: %s', JSON.stringify((t.phrases || []).slice(0, 1).map(function (p) { return { keys: Object.keys(p).join(','), occ: (p.occurrences || []).slice(0, 1) }; })));
    return shown >= 2;
  });
  if (!shown) Logger.log('No calls with these trackers in the last 7 days (first page).');
}
