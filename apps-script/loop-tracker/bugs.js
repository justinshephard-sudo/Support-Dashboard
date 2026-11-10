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

function bugDoPost_(b, who) {
  if (b.action === 'bugLoad') {
    var d = bugLoad_(!!b.force);
    var me = null;
    try { me = bugMeta_(false).emails[who.email] || null; } catch (e) { /* list still loads */ }
    return { ok: true, items: d.items, states: d.states, people: d.people, groups: d.groups, at: d.at, stale: !!d.stale, me: me };
  }
  if (b.action === 'bugStory') return bugStory_(b.id);
  return null;
}
