/* ==========================================================================
   Rep Audits — backs the dashboard's manager-only Rep Audits page.
   --------------------------------------------------------------------------
   A manager picks a support rep and clicks Run audit:
     1. Intercom (INTERCOM_TOKEN in Script Properties): every conversation assigned to
        the rep in the last AUDIT_DAYS days → friction counts (reopens, reassignments,
        long threads, slow replies, slow closes, low CSAT + remarks, top tags). No AI.
     2. The ~AUDIT_SAMPLE most telling conversations (worst friction score) plus a few
        typical ones, trimmed to who said what.
     3. The rep's Google Calendar → Zoom meeting IDs of customer calls they ran.
     4. All of it goes to the call-prep Zapier workflow (kind "audit"), which pulls each
        call's Zoom AI Companion summary with the existing Zoom connection, has Claude
        (AI by Zapier) write the report, and posts it back here (auditResult).
   Reports are saved on the "Rep Audits" tab of the CS Dashboard Data sheet.
   ========================================================================== */

var AUDIT_TAB = 'Rep Audits';
var AUDIT_DAYS = 30;
var AUDIT_SAMPLE = 22;          // most-friction conversations read in full
var AUDIT_TYPICAL = 4;          // plus a few ordinary ones, for balance
var AUDIT_CONVO_CHARS = 4200;   // per conversation, after trimming (keeps how the hardest threads ended)
var AUDIT_MAX_CALLS = 30;
var AUDIT_CS_TEAM = '8108094';
var AUDIT_SKIP_ADMINS = ['6504887'];   // Fin / "The Lawmatician"
var AUDIT_COLUMNS = ['Id', 'Status', 'Rep', 'RepEmail', 'AdminId', 'RequestedBy', 'Requested', 'Finished', 'Stats', 'Report', 'Error', 'Kind'];   // Kind: support | im | firm (im-audit.js)
var INTERCOM = 'https://api.intercom.io';

var AUDIT_PROMPT = [
  'You help Erika, the support manager at Lawmatics (CRM, intake and automation software for law firms), coach one support rep.',
  'You get: (1) the rep\'s Intercom numbers for the last 30 days; (2) the full text of their most difficult Intercom conversations',
  'plus a few typical ones, each labeled [ic:ID]; (3) Zoom AI Companion summaries of the customer calls they ran, labeled [zoom:ID].',
  '',
  'Find PATTERNS that repeat across several conversations or calls, not one-off moments. Be specific, fair and kind; this is for coaching.',
  'Keep two things apart: product limits or bugs (not the rep\'s fault) vs. the rep\'s own skill, process or knowledge gaps.',
  'Things worth noticing: questions the rep answered wrong or had to escalate, slow or missing follow-ups, long back-and-forth that a',
  'clearer first answer would have avoided, tone, ownership, setting expectations, documentation/links shared, how calls are run.',
  'Always say what the rep does well. Every claim needs refs (e.g. "ic:123", "zoom:85108515942") from the material; never invent refs.',
  '',
  'Fairness rules:',
  '- Saved replies / macros / templated answers are standard team practice. Never criticize using them. Only flag a reply if it did not',
  '  answer what the customer actually asked (e.g. a canned answer to a different question), not because it was generic.',
  '- Judge only lines labeled "Rep". Lines from "Fin bot" (the AI agent before handoff) and from other teammates are not the rep\'s work.',
  '- Escalating to engineering, a bug ticket, or a teammate with an internal note is correct behavior when the issue is a bug or outside',
  '  support\'s scope; flag escalation only when the rep could clearly have answered it themselves.',
  '- Long or reopened threads are often caused by a product bug, a pending fix, or the customer going quiet. Before calling a thread rep',
  '  friction, check why it ran long. If the cause was a bug, put it under product_limits, not friction.',
  '- Ratings tagged "Excluded Review" were reviewed and excused by a manager; they are already left out. Do not bring them up.',
  '- A pattern needs at least 2 examples. A single clearly wrong answer may go under knowledge_gaps; otherwise leave one-offs out.',
  '- First-reply times outside weekday business hours are not the rep\'s fault. Each conversation header shows when it started (PT) and says',
  '  "(after hours)" when it began outside weekdays 6am-6pm; the FLAGGED reasons only list a slow first reply when it began in business hours.',
  '- Fin\'s rating requests and an account manager joining a thread make it look longer; don\'t count those as the rep\'s back-and-forth.',
  '- Rank coaching by how many customers it would help, most first.',
  'If the material is thin, say so in the headline rather than guessing.',
  '',
  'Return ONLY a JSON object (no code fence) with exactly these keys:',
  '{"headline": "one or two sentences: the overall read on this rep this month",',
  ' "strengths": [{"point": "...", "refs": ["ic:..."]}],',
  ' "friction": [{"theme": "short name", "detail": "what keeps happening and its effect on customers", "refs": []}],',
  ' "knowledge_gaps": [{"topic": "Lawmatics feature or area", "detail": "what they got wrong or escalated", "refs": []}],',
  ' "bugs": [{"issue": "a Lawmatics bug customers hit", "detail": "how often / impact / status if known", "refs": []}],',
  ' "feature_requests": [{"request": "what customers asked Lawmatics to add or change", "detail": "how many asked, why", "refs": []}],',
  ' "product_limits": [{"issue": "...", "detail": "other product limits customers hit (not bugs or requests above), not the rep\'s fault", "refs": []}],',
  ' "calls": {"overview": "how their customer calls go, or \\"No call summaries.\\"", "observations": [{"point": "...", "refs": ["zoom:..."]}]},',
  ' "coaching": [{"action": "a concrete thing to work on", "why": "the evidence, briefly"}],',
  ' "follow_up": [{"item": "a customer issue that looks unresolved or at risk", "refs": []}]}',
  'Keep each list to the 3-5 most important items (coaching: 3-4). Plain language, no jargon.',
].join('\n');

/* ---------- Intercom ---------- */

function ic_(method, path, payload) {
  var token = PropertiesService.getScriptProperties().getProperty('INTERCOM_TOKEN');
  if (!token) throw new Error('Intercom isn’t connected yet (add INTERCOM_TOKEN in Script Properties).');
  var opts = { method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Intercom-Version': '2.11' } };
  if (payload) opts.payload = JSON.stringify(payload);
  var r;
  for (var i = 0; i < 3; i++) {
    r = UrlFetchApp.fetch(INTERCOM + path, opts);
    if (r.getResponseCode() !== 429 && r.getResponseCode() < 500) break;
    Utilities.sleep(1500 * (i + 1));
  }
  if (r.getResponseCode() >= 300) {
    console.error('Intercom ' + r.getResponseCode() + ' ' + path + ': ' + r.getContentText().slice(0, 300));
    throw new Error('Intercom didn’t respond (HTTP ' + r.getResponseCode() + ').');
  }
  return JSON.parse(r.getContentText() || '{}');
}

// Support reps = members of the CS team in Intercom (so new reps show up on their own).
function auditReps_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('audit_reps2');
  if (hit) return JSON.parse(hit);
  var team = ic_('get', '/teams/' + AUDIT_CS_TEAM);
  var ids = (team.admin_ids || []).map(String);
  var managers = dashManagers_();   // managers aren't audited (Dashboard Config list)
  var admins = (ic_('get', '/admins').admins || []).filter(function (a) {
    return ids.indexOf(String(a.id)) > -1 && managers.indexOf(String(a.email || '').toLowerCase()) === -1 && AUDIT_SKIP_ADMINS.indexOf(String(a.id)) === -1 && a.email && /@lawmatics\.com$/i.test(a.email);
  }).map(function (a) { return { id: String(a.id), name: a.name, email: String(a.email).toLowerCase() }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
  var me = ic_('get', '/me');
  var out = { reps: admins, appId: (me.app && me.app.id_code) || '' };
  cache.put('audit_reps2', JSON.stringify(out), 6 * 3600);
  return out;
}

function auditConversations_(adminId, since) {
  var all = [], cursor = null, guard = 0;
  do {
    var body = { query: { operator: 'AND', value: [
      { field: 'admin_assignee_id', operator: '=', value: String(adminId) },
      { field: 'created_at', operator: '>', value: Math.floor(since / 1000) },
    ] }, pagination: { per_page: 150 } };
    if (cursor) body.pagination.starting_after = cursor;
    var res = ic_('post', '/conversations/search', body);
    all = all.concat(res.conversations || []);
    cursor = res.pages && res.pages.next && res.pages.next.starting_after;
  } while (cursor && ++guard < 12);
  return all;
}

function auditStrip_(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function auditMedian_(a) {
  var v = a.filter(function (x) { return typeof x === 'number' && x >= 0; }).sort(function (x, y) { return x - y; });
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

function auditTags_(c) { return ((c.tags && c.tags.tags) || []).map(function (t) { return String(t.name || ''); }); }
// A rating on a conversation tagged "Excluded Review" was reviewed and excused: it doesn't count as a rating.
function auditRating_(c) {
  var r = c.conversation_rating;
  if (!r || !r.rating) return null;
  if (auditTags_(c).some(function (t) { return /exclud\w*\s*review/i.test(t); })) return null;
  return r;
}
// Weekdays 6am–6pm Pacific: a slow first reply outside those hours isn't the rep's doing.
function auditBusinessHours_(unix) {
  var d = new Date(unix * 1000);
  var dow = Number(Utilities.formatDate(d, 'America/Los_Angeles', 'u')), h = Number(Utilities.formatDate(d, 'America/Los_Angeles', 'H'));
  return dow <= 5 && h >= 6 && h < 18;
}

// One number per conversation: how much friction it shows.
function auditFriction_(c) {
  var s = c.statistics || {}, r = auditRating_(c) || {};
  var score = 0, why = [];
  if (s.count_reopens > 0) { score += 3 * Math.min(s.count_reopens, 3); why.push('reopened ' + s.count_reopens + '×'); }
  if (r.rating && r.rating <= 3) { score += 6; why.push('CSAT ' + r.rating + '/5'); }
  if (s.count_assignments > 2) { score += 2; why.push('reassigned'); }
  if (s.count_conversation_parts > 14) { score += 2; why.push(s.count_conversation_parts + ' messages'); }
  if (s.time_to_last_close > 3 * 86400) { score += 2; why.push('open ' + Math.round(s.time_to_last_close / 86400) + ' days'); }
  if (s.time_to_admin_reply > 4 * 3600 && auditBusinessHours_(c.created_at)) { score += 1; why.push('first reply after ' + Math.round(s.time_to_admin_reply / 3600) + 'h'); }
  return { score: score, why: why };
}

function auditStats_(convos) {
  var n = convos.length, st = function (c) { return c.statistics || {}; };
  var rated = convos.filter(function (c) { return auditRating_(c); });
  var good = rated.filter(function (c) { return auditRating_(c).rating >= 4; }).length;
  var tags = {};
  convos.forEach(function (c) { ((c.tags && c.tags.tags) || []).forEach(function (t) { tags[t.name] = (tags[t.name] || 0) + 1; }); });
  var channels = {};
  convos.forEach(function (c) { var k = (c.source && (c.source.delivered_as === 'customer_initiated' ? c.source.type : c.source.delivered_as || c.source.type)) || 'other'; channels[k] = (channels[k] || 0) + 1; });
  var pct = function (k) { return n ? Math.round(100 * k / n) : 0; };
  return {
    conversations: n,
    stillOpen: convos.filter(function (c) { return c.state !== 'closed'; }).length,
    medianFirstReplyMin: (function (m) { return m == null ? null : Math.round(m / 60); })(auditMedian_(convos.map(function (c) { return st(c).time_to_admin_reply; }))),
    medianCloseHours: (function (m) { return m == null ? null : Math.round(m / 360) / 10; })(auditMedian_(convos.map(function (c) { return st(c).time_to_last_close; }))),
    reopenedPct: pct(convos.filter(function (c) { return st(c).count_reopens > 0; }).length),
    reassignedPct: pct(convos.filter(function (c) { return st(c).count_assignments > 2; }).length),
    longThreadPct: pct(convos.filter(function (c) { return st(c).count_conversation_parts > 14; }).length),
    csatRated: rated.length, csatPct: rated.length ? Math.round(100 * good / rated.length) : null,
    excusedRatings: convos.filter(function (c) { return c.conversation_rating && c.conversation_rating.rating && !auditRating_(c); }).length,
    lowRatings: rated.filter(function (c) { return auditRating_(c).rating <= 3; }).map(function (c) {
      return { id: String(c.id), rating: c.conversation_rating.rating, remark: auditStrip_(c.conversation_rating.remark || '').slice(0, 300) };
    }).slice(0, 15),
    topTags: Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 12).map(function (k) { return { tag: k, count: tags[k] }; }),
    channels: channels,
  };
}

// Who said what, trimmed. Notes and assignment events are kept short; bot replies are labeled.
function auditThread_(id, adminId) {
  var c = ic_('get', '/conversations/' + id + '?display_as=plaintext');
  var who = function (a) {
    if (!a) return 'Unknown';
    if (a.type === 'admin') return String(a.id) === String(adminId) ? 'Rep' : 'Teammate ' + (a.name || '');
    if (a.type === 'bot') return 'Fin bot';
    return 'Customer';
  };
  var lines = [];
  if (c.source && c.source.body) lines.push(who(c.source.author) + ': ' + auditStrip_(c.source.body));
  ((c.conversation_parts && c.conversation_parts.conversation_parts) || []).forEach(function (p) {
    var body = auditStrip_(p.body);
    if (p.part_type === 'note' && body) lines.push('[internal note] ' + who(p.author) + ': ' + body.slice(0, 400));
    else if (/comment|open|close/.test(p.part_type) && body) lines.push(who(p.author) + ': ' + body);
    else if (/assign/.test(p.part_type)) lines.push('[' + p.part_type.replace(/_/g, ' ') + (p.assigned_to && p.assigned_to.name ? ' → ' + p.assigned_to.name : '') + ']');
  });
  var text = lines.join('\n');
  if (text.length > AUDIT_CONVO_CHARS) text = text.slice(0, AUDIT_CONVO_CHARS * 0.6) + '\n…\n' + text.slice(-AUDIT_CONVO_CHARS * 0.35);
  return text;
}

/* ---------- Calendar → Zoom calls ---------- */

function auditCalls_(email, since) {
  var cal = CalendarApp.getCalendarById(email);
  if (!cal) { try { cal = CalendarApp.subscribeToCalendar(email, { hidden: true }); } catch (e) { cal = null; } }
  if (!cal) return [];
  var seen = {}, out = [];
  cal.getEvents(new Date(since), new Date()).forEach(function (ev) {
    var text = String(ev.getLocation() || '') + ' ' + String(ev.getDescription() || '');
    var m = text.match(/zoom\.us\/j\/(\d{9,11})/);
    if (!m || seen[m[1]]) return;
    var external = ev.getGuestList().some(function (g) { return !/@lawmatics\.com$/i.test(g.getEmail()) && !/calendar\.google\.com$/.test(g.getEmail()); });
    if (!external && !/support call|success support/i.test(ev.getTitle())) return;
    seen[m[1]] = true;
    out.push({ id: m[1], topic: ev.getTitle().slice(0, 120), date: Utilities.formatDate(ev.getStartTime(), 'America/Los_Angeles', 'yyyy-MM-dd') });
  });
  return out.slice(-AUDIT_MAX_CALLS);
}

/* ---------- sheet ---------- */

function auditSheet_() {
  var ss = SpreadsheetApp.openById(SIGNAL_SHEET_ID);
  var sh = ss.getSheetByName(AUDIT_TAB);
  if (!sh) {
    sh = ss.insertSheet(AUDIT_TAB);
    sh.getRange(1, 1, 1, AUDIT_COLUMNS.length).setValues([AUDIT_COLUMNS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < AUDIT_COLUMNS.length) {
    sh.getRange(1, 1, 1, AUDIT_COLUMNS.length).setValues([AUDIT_COLUMNS]).setFontWeight('bold');
  }
  return sh;
}

function auditRows_() {
  var sh = auditSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, AUDIT_COLUMNS.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    AUDIT_COLUMNS.forEach(function (k, j) { o[k] = r[j]; });
    return o;
  });
}

function auditSet_(id, fields) {
  var sh = auditSheet_();
  var row = auditRows_().filter(function (r) { return String(r.Id) === String(id); })[0];
  if (!row) return;
  Object.keys(fields).forEach(function (k) {
    var v = fields[k];
    if (typeof v === 'string' && v.length > 49000) v = v.slice(0, 49000);
    sh.getRange(row._row, AUDIT_COLUMNS.indexOf(k) + 1).setNumberFormat('@').setValue(v);
  });
}

function auditPublic_(r, full) {
  var o = { id: String(r.Id), kind: String(r.Kind || 'support'), status: r.Status, rep: r.Rep, adminId: String(r.AdminId), requestedBy: r.RequestedBy,
    requested: r.Requested ? new Date(r.Requested).toISOString() : '', finished: r.Finished ? new Date(r.Finished).toISOString() : '', error: r.Error || '' };
  if (full) {
    try { o.stats = JSON.parse(r.Stats || 'null'); } catch (e) { o.stats = null; }
    try { o.report = JSON.parse(r.Report || 'null'); } catch (e) { o.report = null; }
  }
  return o;
}

/* ---------- actions ---------- */

function auditList_() {
  var reps = { reps: [], appId: '' };
  try { reps = auditReps_(); } catch (e) { reps.error = String(e.message || e); }
  var rows = auditRows_().map(function (r) { return auditPublic_(r, false); }).reverse().slice(0, 60);
  // A run stuck for 15+ minutes failed somewhere along the way.
  rows.forEach(function (r) {
    if (r.status === 'running' && Date.now() - new Date(r.requested) > 15 * 60000) { r.status = 'failed'; r.error = r.error || 'Timed out — try again.'; }
  });
  var im = { reps: [], firms: [] };
  try { im = { reps: imReps_(), firms: imOpenFirms_() }; } catch (e) { im.error = String(e.message || e); }
  return { ok: true, reps: reps.reps, appId: reps.appId, audits: rows, imReps: im.reps, imFirms: im.firms, imError: im.error || '' };
}

function auditGet_(b) {
  var r = auditRows_().filter(function (x) { return String(x.Id) === String(b.id); })[0];
  if (!r) throw new Error('That audit wasn’t found.');
  var out = auditPublic_(r, true);
  if (out.status === 'running' && Date.now() - new Date(out.requested) > 15 * 60000) { out.status = 'failed'; out.error = out.error || 'Timed out — try again.'; }
  var appId = '';
  try { appId = auditReps_().appId; } catch (e) { /* Intercom down: IM audits still open */ }
  return { ok: true, audit: out, appId: appId };
}

function auditRun_(b, who) {
  var reps = auditReps_().reps;
  var rep = reps.filter(function (r) { return r.id === String(b.adminId); })[0];
  if (!rep) throw new Error('Pick a support rep.');
  var running = auditRows_().filter(function (r) { return String(r.AdminId) === rep.id && r.Status === 'running' && Date.now() - new Date(r.Requested) < 15 * 60000; })[0];
  if (running) return { ok: true, id: String(running.Id), already: true };

  var id = Utilities.getUuid().slice(0, 8);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    auditSheet_().appendRow([id, 'running', rep.name, rep.email, rep.id, who.email, new Date(), '', '', '', '', 'support']);
  } finally { lock.releaseLock(); }

  try {
    var since = Date.now() - AUDIT_DAYS * 864e5;
    // Same rule as the CS reports: conversations tagged "exclude from metrics" don't count at all.
    var convos = auditConversations_(rep.id, since).filter(function (c) { return !auditTags_(c).some(function (t) { return /exclude from metrics/i.test(t); }); });
    var stats = auditStats_(convos);
    var scored = convos.map(function (c) { var f = auditFriction_(c); return { c: c, score: f.score, why: f.why }; })
      .sort(function (a, b) { return b.score - a.score; });
    var hard = scored.filter(function (x) { return x.score > 0; }).slice(0, AUDIT_SAMPLE);
    var rest = scored.filter(function (x) { return x.score === 0 && hard.indexOf(x) === -1; });
    var typical = [];   // spread across the month
    for (var i = 0; i < AUDIT_TYPICAL && i < rest.length; i++) typical.push(rest[Math.floor(i * rest.length / Math.min(AUDIT_TYPICAL, rest.length))]);
    var sample = hard.concat(typical);
    var threads = sample.map(function (x) {
      var t = '';
      try { t = auditThread_(x.c.id, rep.id); } catch (e) { t = '(couldn’t load)'; }
      var title = auditStrip_(x.c.title || (x.c.source && x.c.source.subject) || '').slice(0, 120);
      var when = x.c.created_at ? Utilities.formatDate(new Date(x.c.created_at * 1000), 'America/Los_Angeles', 'EEE MMM d, h:mm a') + ' PT' + (auditBusinessHours_(x.c.created_at) ? '' : ' (after hours)') : '';
      return '[ic:' + x.c.id + '] ' + (when ? when + ' · ' : '') + (x.score ? 'FLAGGED (' + x.why.join(', ') + ')' : 'TYPICAL') + (title ? ' — ' + title : '') + '\n' + t;
    });
    stats.sampled = sample.map(function (x) { return { id: String(x.c.id), why: x.why, title: auditStrip_(x.c.title || '').slice(0, 100) }; });
    var calls = auditCalls_(rep.email, since);
    stats.callsFound = calls.length;

    var context = 'REP: ' + rep.name + '\nWINDOW: last ' + AUDIT_DAYS + ' days\n\nINTERCOM NUMBERS:\n' +
      JSON.stringify({ conversations: stats.conversations, stillOpen: stats.stillOpen, medianFirstReplyMin: stats.medianFirstReplyMin,
        medianCloseHours: stats.medianCloseHours, reopenedPct: stats.reopenedPct, reassignedPct: stats.reassignedPct,
        longThreadPct: stats.longThreadPct, csatPct: stats.csatPct, csatRated: stats.csatRated, excusedRatings: stats.excusedRatings, lowRatings: stats.lowRatings,
        topTags: stats.topTags, channels: stats.channels }) +
      '\n\nCONVERSATIONS (most difficult first, then a few typical ones):\n\n' + threads.join('\n\n---\n\n');
    if (context.length > 120000) context = context.slice(0, 120000) + '\n…(trimmed)';
    auditSet_(id, { Stats: JSON.stringify(stats) });

    var hook = PropertiesService.getScriptProperties().getProperty('ZAPIER_HOOK_URL') || (typeof ZAPIER_HOOK_SECRET_URL === 'undefined' ? '' : ZAPIER_HOOK_SECRET_URL);
    if (!hook || typeof ZAPIER_HOOK_KEY === 'undefined') throw new Error('The Zapier hook isn’t set up.');
    var requestId = Utilities.getUuid(), secret = Utilities.getUuid();
    CacheService.getScriptCache().put('audreq_' + requestId, JSON.stringify({ secret: secret, id: id }), 6 * 3600);
    var res = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ kind: 'audit', requestId: requestId, token: secret, hookKey: ZAPIER_HOOK_KEY, callbackUrl: CALLBACK_URL,
        instructions: AUDIT_PROMPT, context: context, items: JSON.stringify(calls) }) });
    if (res.getResponseCode() >= 300) throw new Error('Couldn’t start the AI step (Zapier HTTP ' + res.getResponseCode() + ').');
    return { ok: true, id: id };
  } catch (err) {
    auditSet_(id, { Status: 'failed', Error: String(err.message || err).slice(0, 300), Finished: new Date().toISOString() });
    throw err;
  }
}

// Zapier posts the report back here (checked by the one-time token).
function auditResult_(b) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('audreq_' + String(b.requestId || ''));
  if (!raw) return { ok: false, error: 'unknown or expired request' };
  var req = JSON.parse(raw);
  if (!b.token || b.token !== req.secret) return { ok: false, error: 'bad token' };
  cache.remove('audreq_' + b.requestId);
  var row = auditRows_().filter(function (r) { return String(r.Id) === String(req.id); })[0];
  var stats = {};
  try { stats = JSON.parse((row && row.Stats) || '{}') || {}; } catch (e) { stats = {}; }
  if (Array.isArray(b.calls) && b.calls.length) stats.calls = b.calls.slice(0, AUDIT_MAX_CALLS).map(function (c) {
    return { id: String(c.id || ''), uuid: String(c.uuid || ''), topic: String(c.topic || '').slice(0, 120), date: String(c.date || ''), minutes: Number(c.minutes) || 0, summary: !!c.summary };
  });
  if (b.report && typeof b.report === 'object') {
    auditSet_(req.id, { Status: 'done', Report: JSON.stringify(b.report), Stats: JSON.stringify(stats), Finished: new Date().toISOString(), Error: '' });
  } else {
    auditSet_(req.id, { Status: 'failed', Stats: JSON.stringify(stats), Finished: new Date().toISOString(), Error: String(b.error || 'The AI’s answer couldn’t be read.').slice(0, 300) });
  }
  return { ok: true };
}

// Editor check after adding INTERCOM_TOKEN: lists the reps and counts one rep's conversations.
function checkAudit() {
  CacheService.getScriptCache().remove('audit_reps2');
  var r = auditReps_();
  Logger.log('Intercom app ' + r.appId + ' · reps: ' + r.reps.map(function (x) { return x.name + ' (' + x.id + ')'; }).join(', '));
  if (r.reps.length) {
    var since = Date.now() - AUDIT_DAYS * 864e5;
    var c = auditConversations_(r.reps[0].id, since);
    Logger.log(r.reps[0].name + ': ' + c.length + ' conversations in ' + AUDIT_DAYS + ' days · calls on calendar: ' + auditCalls_(r.reps[0].email, since).length);
  }
}

function auditDoPost_(b, who) {
  if (!who.manager) throw new Error('Rep Audits are for managers.');
  if (b.action === 'auditList') return auditList_();
  if (b.action === 'auditGet') return auditGet_(b);
  if (b.action === 'auditRun') return auditRun_(b, who);
  if (b.action === 'auditRunIm') return imRun_(b, who);
  return null;
}
