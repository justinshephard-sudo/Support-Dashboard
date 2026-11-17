/* ==========================================================================
   Open Bugs — backs the dashboard's Resources ▸ Open Bugs view (read-only).
   --------------------------------------------------------------------------
   Reads Shortcut (workspace lawmatics-new) with an API token kept in Script
   Properties as SHORTCUT_TOKEN (Shortcut ▸ Settings ▸ API Tokens). Never put the
   token in this file — the repo is public.

   "Open" = story type bug, not archived, in a backlog/unstarted/started state of
   the workflows in BUG_WORKFLOWS (Customer Success by default — the bugs CS files
   for firms). Everyone signed in to the dashboard can read.

   Actions (POST via loop-tracker.js doPost):
     bugLoad   → every open bug (slim) + state, team and people names
     bugStory  → one bug's description and latest comments, for the side panel
     bugFirm   → open bugs that give one Firm ID (Firm Lookup)
     bugPlusOne     → anyone signed in: comment "+1 — Firm ID N (name) is also seeing this" + their note
     bugFixConfirmed → anyone signed in, bug in "Ready for Review": moves it to "Fix Confirmed" + a comment
   Writes post as the signed-in person when they're a Shortcut member (author_id, matched by email);
   otherwise as the token's owner, with "from <email>" in the text.
   ========================================================================== */

var SC_API = 'https://api.app.shortcut.com/api/v3';
var BUG_WORKFLOWS = [500005403];      // Customer Success
var BUG_FRESH_MS = 10 * 60 * 1000;

function sc_(method, path, payload) {
  var token = PropertiesService.getScriptProperties().getProperty('SHORTCUT_TOKEN');
  if (!token) throw new Error('Shortcut isn’t connected yet (no SHORTCUT_TOKEN in Script Properties).');
  var opts = { method: method, muteHttpExceptions: true, contentType: 'application/json', headers: { 'Shortcut-Token': token } };
  if (payload) opts.payload = JSON.stringify(payload);
  var r;
  for (var attempt = 0; attempt < 3; attempt++) {
    r = UrlFetchApp.fetch(SC_API + path, opts);
    var code = r.getResponseCode();
    if (code !== 429 && code < 500) break;
    Utilities.sleep(800 * (attempt + 1));
  }
  if (r.getResponseCode() >= 300) {
    console.error('Shortcut ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
    throw new Error('Shortcut didn’t respond (HTTP ' + r.getResponseCode() + ').');
  }
  return JSON.parse(r.getContentText() || 'null');
}

// Workflow states, teams and people change rarely: cache them for 6 hours.
function bugMeta_(force) {
  var cache = CacheService.getScriptCache();
  var hit = !force && chunkGet_('bugmeta_');
  if (hit) return hit;
  var states = {};
  (sc_('get', '/workflows') || []).forEach(function (w) {
    (w.states || []).forEach(function (s) {
      states[s.id] = { name: s.name, type: s.type, pos: s.position, wf: w.id, wfName: w.name };
    });
  });
  var groups = {};
  (sc_('get', '/groups') || []).forEach(function (g) { groups[g.id] = g.name; });
  var people = {}, emails = {};
  (sc_('get', '/members') || []).forEach(function (m) {
    var p = m.profile || {};
    people[m.id] = p.name || p.mention_name || '';
    if (p.email_address) emails[String(p.email_address).toLowerCase()] = m.id;
  });
  var meta = { states: states, groups: groups, people: people, emails: emails };
  chunkPut_('bugmeta_', meta, 6 * 3600);
  return meta;
}

function bugItem_(s) {
  var cf = (s.custom_fields || []).map(function (c) { return c.value; });
  var sev = cf.filter(function (v) { return /^Severity \d/.test(v); })[0] || '';
  var pri = cf.filter(function (v) { return /^(Highest|High|Medium|Low|Lowest)$/.test(v); })[0] || '';
  return {
    id: s.id, url: s.app_url, t: s.name, st: s.workflow_state_id, g: s.group_id || '',
    sev: sev ? Number(sev.replace(/\D/g, '')) : 0, pri: pri,
    req: s.requested_by_id || '', own: s.owner_ids || [],
    lab: (s.labels || []).map(function (l) { return l.name; }),
    c: String(s.created_at || '').slice(0, 10), u: String(s.updated_at || '').slice(0, 10),
    m: String(s.moved_at || s.updated_at || '').slice(0, 10),
    blk: !!s.blocked, nc: (s.comment_ids || s.comments || []).length,
  };
}

function bugFetch_() {
  var meta = bugMeta_(false);
  var stories = sc_('post', '/stories/search', {
    story_type: 'bug', archived: false, workflow_state_types: ['backlog', 'unstarted', 'started'],
  }) || [];
  var items = stories.filter(function (s) { return BUG_WORKFLOWS.indexOf(s.workflow_id) > -1; }).map(bugItem_);
  var states = {};
  Object.keys(meta.states).forEach(function (id) {
    var s = meta.states[id];
    if (BUG_WORKFLOWS.indexOf(s.wf) > -1 && s.type !== 'done') states[id] = { name: s.name, type: s.type, pos: s.pos };
  });
  // Only the names the list actually uses, so the payload stays small.
  var people = {}, groups = {};
  items.forEach(function (it) {
    [it.req].concat(it.own).forEach(function (id) { if (id && meta.people[id]) people[id] = meta.people[id]; });
    if (it.g && meta.groups[it.g]) groups[it.g] = meta.groups[it.g];
  });
  return { ok: true, items: items, states: states, people: people, groups: groups, at: new Date().toISOString(), fetched: Date.now() };
}

function bugLoad_(force) {
  var cached = chunkGet_('bug_');
  if (!force && cached && Date.now() - cached.fetched < BUG_FRESH_MS) return cached;
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(10000);
  try {
    cached = chunkGet_('bug_');
    if (!force && cached && Date.now() - cached.fetched < BUG_FRESH_MS) return cached;
    try {
      var data = bugFetch_();
      chunkPut_('bug_', data, 6 * 3600);
      return data;
    } catch (err) {
      if (cached) { cached.stale = true; return cached; }
      throw err;
    }
  } finally {
    if (locked) lock.releaseLock();
  }
}

function bugStory_(id) {
  id = Number(id);
  if (!id) throw new Error('missing bug');
  var s = sc_('get', '/stories/' + id);
  if (!s || s.story_type !== 'bug' || BUG_WORKFLOWS.indexOf(s.workflow_id) === -1) throw new Error('That isn’t an open CS bug.');
  var meta = bugMeta_(false);
  var comments = (s.comments || []).filter(function (c) { return !c.deleted && c.text; })
    .slice(-4).map(function (c) { return { who: meta.people[c.author_id] || 'Someone', at: String(c.created_at).slice(0, 10), text: String(c.text).slice(0, 1200) }; });
  return { ok: true, id: s.id, desc: String(s.description || '').slice(0, 6000), comments: comments, ncomments: (s.comments || []).length };
}

// Run from the editor after adding SHORTCUT_TOKEN: lists the workflows and how many open bugs each has.
function checkShortcut() {
  var meta = bugMeta_(true);
  var wfs = {};
  Object.keys(meta.states).forEach(function (id) { var s = meta.states[id]; wfs[s.wf] = s.wfName; });
  Logger.log('Workflows: ' + JSON.stringify(wfs));
  var d = bugLoad_(true);
  Logger.log('Open bugs in ' + BUG_WORKFLOWS.join(', ') + ': ' + d.items.length + ' · states: ' +
    Object.keys(d.states).map(function (k) { return d.states[k].name; }).join(', '));
}

/* ---------- bugs for one firm (Firm Lookup) ----------
   Shortcut full-text search for the Firm ID, then a strict check of each hit's own text (title,
   description, external links): the ID must appear as a Firm ID — next to the word "firm" (Firm ID 4323,
   firm #4323, firm: 4323) or in a Lawmatics app URL — not just anywhere as a number. Name matching was
   dropped (2026-11-16): firm names are too generic and pulled in other firms' bugs.
   Any workflow, not done, not archived. Cached 10 minutes per firm. */
function bugMentionsFirm_(text, id) {
  var t = String(text || '');
  var near = new RegExp('firm[\\s_-]*(?:id|#|no\\.?|number)?[\\s:#=-]*' + id + '(?!\\d)', 'i');
  var url = new RegExp('lawmatics\\.com/[^\\s)"]*?(?:firms?|accounts?)[/=]' + id + '(?!\\d)', 'i');
  return near.test(t) || url.test(t);
}
function bugFirm_(b) {
  var firmId = String(b.firmId || '').replace(/\D/g, '');
  if (!firmId) return { ok: true, items: [] };
  var cache = CacheService.getScriptCache(), key = 'bugfirm2_' + firmId;
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var meta = bugMeta_(false), items = [];
  var res = sc_('get', '/search/stories?page_size=25&query=' + encodeURIComponent('"' + firmId + '" type:bug !is:archived')) || {};
  (res.data || []).forEach(function (s) {
    var st = meta.states[s.workflow_state_id] || {};
    if (st.type === 'done' || s.archived || s.completed) return;
    var full = s;
    if (s.description == null) { try { full = sc_('get', '/stories/' + s.id) || s; } catch (e) { full = s; } }
    var text = [full.name, full.description].concat((full.external_links || [])).join('\n');
    if (!bugMentionsFirm_(text, firmId)) return;
    var it = bugItem_(full);
    it.state = st.name || '';
    items.push(it);
  });
  items.sort(function (x, y) { return (x.sev || 9) - (y.sev || 9) || y.u.localeCompare(x.u); });
  var out = { ok: true, items: items };
  cache.put(key, JSON.stringify(out), 600);
  return out;
}

/* ---------- writes: +1 for a firm, fix confirmed ---------- */
function bugAuthor_(who) {
  var meta = bugMeta_(false), id = meta.emails[String(who.email || '').toLowerCase()] || null;
  return { id: id, label: id ? '' : ' (from ' + who.email + ')' };
}
function bugComment_(storyId, text, author) {
  var body = { text: text };
  if (author.id) body.author_id = author.id;
  return sc_('post', '/stories/' + storyId + '/comments', body);
}
function bugDropCaches_(firmId) {
  var c = CacheService.getScriptCache();
  if (firmId) c.remove('bugfirm2_' + firmId);
  var d = chunkGet_('bug_');
  if (d) { d.fetched = 0; chunkPut_('bug_', d, 6 * 3600); }   // next list load refetches
}
function bugPlusOne_(b, who) {
  var id = Number(b.id), firmId = String(b.firmId || '').replace(/\D/g, ''), firm = String(b.firmName || '').trim().slice(0, 120);
  var note = String(b.note || '').trim().slice(0, 1500);
  if (!id) throw new Error('missing bug');
  if (!firmId) throw new Error('Pick the firm (it needs a Firm ID).');
  var st = sc_('get', '/stories/' + id);
  var text = [st.name, st.description].concat((st.comments || []).filter(function (c) { return !c.deleted; }).map(function (c) { return c.text; })).join('\n');
  if (bugMentionsFirm_(text, firmId)) return { ok: true, already: true };
  var author = bugAuthor_(who);
  bugComment_(id, '+1 — Firm ID ' + firmId + (firm ? ' (' + firm + ')' : '') + ' is also seeing this.' + author.label + (note ? '\n\n' + note : ''), author);
  bugDropCaches_(firmId);
  return { ok: true };
}
function bugFixConfirmed_(b, who) {
  var id = Number(b.id), note = String(b.note || '').trim().slice(0, 1500);
  if (!id) throw new Error('missing bug');
  var meta = bugMeta_(false), st = sc_('get', '/stories/' + id), cur = meta.states[st.workflow_state_id] || {};
  if (!/ready\s*for\s*review/i.test(cur.name || '')) throw new Error('This bug is in "' + (cur.name || 'another state') + '", not Ready for Review. Refresh the list.');
  var target = Object.keys(meta.states).filter(function (k) { return meta.states[k].wf === st.workflow_id && /fix\s*confirmed/i.test(meta.states[k].name); })[0];
  if (!target) throw new Error('This bug’s workflow has no "Fix Confirmed" state in Shortcut.');
  var author = bugAuthor_(who);
  sc_('put', '/stories/' + id, { workflow_state_id: Number(target) });
  bugComment_(id, '✅ Fix confirmed' + author.label + '.' + (note ? '\n\n' + note : ''), author);
  bugDropCaches_('');
  return { ok: true, state: meta.states[target].name };
}

function bugDoPost_(b, who) {
  if (b.action === 'bugLoad') {
    var d = bugLoad_(!!b.force);
    var me = null;
    try { me = bugMeta_(false).emails[who.email] || null; } catch (e) { /* list still loads */ }
    return { ok: true, items: d.items, states: d.states, people: d.people, groups: d.groups, at: d.at, stale: !!d.stale, me: me };
  }
  if (b.action === 'bugStory') return bugStory_(b.id);
  if (b.action === 'bugFirm') return bugFirm_(b);
  if (b.action === 'bugPlusOne') return bugPlusOne_(b, who);
  if (b.action === 'bugFixConfirmed') return bugFixConfirmed_(b, who);
  return null;
}

// Editor check for Firm Lookup's bug search: logs what one firm finds, and which search hits were rejected.
function checkBugFirm() {
  var id = '4323';
  var res = sc_('get', '/search/stories?page_size=25&query=' + encodeURIComponent('"' + id + '" type:bug !is:archived')) || {};
  Logger.log('Shortcut search hits: ' + (res.data || []).length);
  (res.data || []).forEach(function (s) {
    var text = [s.name, s.description].concat(s.external_links || []).join('\n');
    Logger.log((bugMentionsFirm_(text, id) ? 'KEEP   ' : 'reject ') + s.name);
  });
}
