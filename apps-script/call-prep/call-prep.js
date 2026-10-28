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

   The writing is done by Claude through AI by Zapier (workflow "CS Dashboard – Call Prep"), so
   no Anthropic key is needed. If ANTHROPIC_API_KEY is ever set, it calls Claude directly instead.

   Script Properties:
     CZ_USER, CZ_KEY        ChurnZero read API (same as the other dashboard scripts)
     GONG_BASIC             Gong API "Basic" token (base64 of key:secret), as used by the
                            first-onboarding Zap — or GONG_ACCESS_KEY + GONG_ACCESS_SECRET
     GONG_BASE_URL          optional, defaults to Lawmatics' https://us-32500.api.gong.io
     ZAPIER_HOOK_URL        optional, overrides the workflow's catch-hook URL below
     ANTHROPIC_API_KEY      optional (direct Claude instead of Zapier)

   Deploy: Web app · Execute as: Me · Who has access: Anyone. Each request must carry a
   Google access token issued to the dashboard client (shared/dash-auth.js).
   ========================================================================== */

var CZ_BASE = 'https://lawmatics.us1app.churnzero.net/public/v1';
var CLAUDE_MODEL = 'claude-opus-5-5';
var GONG_LOOKBACK_DAYS = 150;
var CACHE_HOURS = 12;
// Catch hook of the Zapier workflow "CS Dashboard – Call Prep" (ZAPIER_HOOK_URL overrides it).
// Where Zapier posts the finished prep: this web app's public /exec address. (ScriptApp.getService().getUrl()
// can give a lawmatics.com-only or /dev address, which Zapier can't reach.)
var CALLBACK_URL = 'https://script.google.com/macros/s/AKfycbwltwhfY4-dLO6F5uyfzxIXIMcb_N0_zrk-2q0atrk_c8fMj4USTTcEJK4QsChbmAVR/exec';
var ZAPIER_HOOK_DEFAULT = 'https://hooks.zapier.com/hooks/catch/14095940/UmLNkN2lGE4oKLuI/';

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
    return dashJson_({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error(err && err.stack || err);
    return dashJson_({ ok: false, error: String((err && err.message) || err) });
  }
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
    if (hit) { var c = JSON.parse(hit); c.cached = true; return c; }
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
  var out = {
    ok: true, firm: { name: firm.name, firmId: firmId, im: repName, stage: firm.stage, nextMeeting: firm.nextMeeting, mrr: firm.mrr },
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
  var hook = props.getProperty('ZAPIER_HOOK_URL') || ZAPIER_HOOK_DEFAULT;
  if (!hook) throw new Error('The Zapier hook (ZAPIER_HOOK_URL) isn’t set up yet.');
  var requestId = Utilities.getUuid(), secret = Utilities.getUuid();
  cache.put('req_' + requestId, JSON.stringify({ secret: secret, key: key, shell: out, at: Date.now() }), 3600);
  var res = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ requestId: requestId, token: secret, callbackUrl: CALLBACK_URL,
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
    'Leave a list empty rather than guessing. Never invent what was said.\n\n' +
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

/* ---------- checks (run from the editor) ---------- */

// Confirms the setup: Gong answers, and the Zapier hook is set.
function checkKeys() {
  var g = gongFetch_('/v2/users');
  Logger.log('Gong: ' + ((g && g.users) || []).length + ' users on the first page');
  var p = PropertiesService.getScriptProperties();
  Logger.log('Zapier hook: ' + (p.getProperty('ZAPIER_HOOK_URL') || ZAPIER_HOOK_DEFAULT) + ' · direct Claude key: ' + (p.getProperty('ANTHROPIC_API_KEY') ? 'set' : 'not set (uses Zapier)'));
  Logger.log('Zapier posts results to: ' + CALLBACK_URL);
  var ping = UrlFetchApp.fetch(CALLBACK_URL, { muteHttpExceptions: true, followRedirects: true });
  Logger.log('That address answers: HTTP ' + ping.getResponseCode() + ' ' + ping.getContentText().slice(0, 120));
}

// Starts a real prep for one firm (as a manager) and logs the request — e.g. checkPrep('5447').
// With Zapier it finishes in the background; the dashboard pop-up shows it.
function checkPrep(firmId) {
  var out = prep_({ firmId: firmId || '5447', stage: '' }, { ok: true, manager: true, email: '' });
  Logger.log(JSON.stringify(out, null, 2));
}
