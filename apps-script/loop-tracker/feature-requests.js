/* ==========================================================================
   Feature Requests — backs the dashboard's Resources ▸ Feature Requests view.
   --------------------------------------------------------------------------
   Reads and writes the Notion "🌅 Feature Requests" database with the same
   Notion connection as the Loop Tracker (loop-tracker.js). The connection must
   be allowed to see this database too: run startNotionAuth again and tick both
   Team Loop Tracker AND Feature Requests on Notion's page picker.

   In Notion, "Total Requests" is the number of people in Requester, so a +1 adds
   the viewer's Notion user to Requester (and, if given, their firm to Firm ID and
   a dated line to notes). Anyone signed in to the dashboard can +1 or add.

   Actions (POST via loop-tracker.js doPost):
     frLoad    → every request (title, notes, area, firm, requesters…) + area options
     frPlus    → +1 a request {id, firm?, note?}
     frCreate  → add a request {title, notes?, area?, firm?}
   ========================================================================== */

var FR_DB = '1ede554974b98091a733d477c98c8cf3';
var FR_FRESH_MS = 10 * 60 * 1000;     // serve the cached list this long before re-reading Notion
var FR_STALE_SECONDS = 6 * 3600;      // keep the last good list for when Notion is slow
var FR_CHUNK = 90000;                 // CacheService holds at most 100 KB per key
var FR_NOTES_MAX = 1800;

/* ---------- cache (the list is bigger than one cache entry) ---------- */

// Shared by Feature Requests and Open Bugs: one value split across cache keys.
function chunkPut_(prefix, obj, seconds) {
  var s = JSON.stringify(obj), parts = {}, n = Math.ceil(s.length / FR_CHUNK);
  for (var i = 0; i < n; i++) parts[prefix + i] = s.slice(i * FR_CHUNK, (i + 1) * FR_CHUNK);
  parts[prefix + 'n'] = String(n);
  CacheService.getScriptCache().putAll(parts, seconds || FR_STALE_SECONDS);
}

function chunkGet_(prefix) {
  try {
    var c = CacheService.getScriptCache();
    var n = Number(c.get(prefix + 'n') || 0);
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(prefix + i);
    var got = c.getAll(keys), s = '';
    for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
    return JSON.parse(s);
  } catch (e) { return null; }
}

function frCachePut_(obj) { chunkPut_('fr_', obj); }
function frCacheGet_() { return chunkGet_('fr_'); }

/* ---------- Notion → items ---------- */

function frClean_(s) {
  return String(s || '').replace(/<\/?(p|br|div|span)[^>]*>/gi, ' ').replace(/[ \t]+\n/g, '\n').replace(/\s{3,}/g, '\n\n').trim();
}

function frItem_(pg) {
  var pr = pg.properties || {};
  var sel = function (n) { return pr[n] && pr[n].select ? pr[n].select.name : ''; };
  var notes = frClean_(plain_(pr.notes && pr.notes.rich_text));
  return {
    id: pg.id, url: pg.url,
    t: frClean_(plain_(pr.Title && pr.Title.title)) || 'Untitled',
    n: notes.length > FR_NOTES_MAX ? notes.slice(0, FR_NOTES_MAX) + '…' : notes,
    a: sel('Product Area'), r: sel('Added to Roadmap?'), dif: sel('Difficulty'),
    s: pr.Status && pr.Status.status ? pr.Status.status.name : '',
    f: plain_(pr['Firm ID'] && pr['Firm ID'].rich_text).trim(),
    d: (pr.Date && pr.Date.date && pr.Date.date.start) || pg.created_time.slice(0, 10),
    c: pg.created_time.slice(0, 10),
    req: ((pr.Requester && pr.Requester.people) || []).map(function (u) { return u.id; }),
  };
}

function frUsers_(force) {
  var cache = CacheService.getScriptCache();
  var hit = !force && cache.get('fr_users');
  if (hit) return JSON.parse(hit);
  var users = {}, cursor = null, guard = 0;
  do {
    var res = notion_('get', '/users?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
    (res.results || []).forEach(function (u) {
      if (u.type !== 'person') return;
      users[u.id] = { name: u.name || '', email: String((u.person && u.person.email) || '').toLowerCase() };
    });
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor && ++guard < 20);
  cache.put('fr_users', JSON.stringify(users), 6 * 3600);
  return users;
}

function frFetch_() {
  var db = notion_('get', '/databases/' + FR_DB);
  var areaProp = (db.properties || {})['Product Area'];
  var areas = areaProp && areaProp.select ? areaProp.select.options.map(function (o) { return o.name; }) : [];
  var items = [], cursor = null, guard = 0;
  do {
    var body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    var res = notion_('post', '/databases/' + FR_DB + '/query', body);
    items = items.concat((res.results || []).map(frItem_));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor && ++guard < 30);
  var users = frUsers_(true), names = {};
  Object.keys(users).forEach(function (id) { names[id] = users[id].name; });
  return { ok: true, items: items, areas: areas, names: names, at: new Date().toISOString(), fetched: Date.now() };
}

function frLoad_(force) {
  var cached = frCacheGet_();
  if (!force && cached && Date.now() - cached.fetched < FR_FRESH_MS) return cached;
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(10000);
  try {
    cached = frCacheGet_();
    if (!force && cached && Date.now() - cached.fetched < FR_FRESH_MS) return cached;
    try {
      var data = frFetch_();
      frCachePut_(data);
      return data;
    } catch (err) {
      if (cached) { cached.stale = true; return cached; }
      throw err;
    }
  } finally {
    if (locked) lock.releaseLock();
  }
}

// Swap one changed request into the cached list so everyone sees it right away.
function frCacheReplace_(item, isNew) {
  var cached = frCacheGet_();
  if (!cached) return;
  if (isNew) cached.items.push(item);
  else cached.items = cached.items.map(function (x) { return x.id === item.id ? item : x; });
  frCachePut_(cached);
}

/* ---------- who is the viewer in Notion? ---------- */

// Match the dashboard sign-in email to a Notion user: by email when Notion shares it,
// otherwise by name ("first.last@" → "First Last", or a unique first name for "first@").
function frMe_(email) {
  var memo = CacheService.getScriptCache().get('fr_me_' + email);
  if (memo) return memo === '!' ? null : memo;
  var find = function (users) {
    var ids = Object.keys(users);
    var hit = ids.filter(function (id) { return users[id].email === email; });
    if (hit.length) return hit[0];
    var local = email.split('@')[0].toLowerCase().split(/[._-]+/).filter(Boolean);
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/); };
    if (local.length >= 2) {
      hit = ids.filter(function (id) { var n = norm(users[id].name); return n[0] === local[0] && n[n.length - 1] === local[local.length - 1]; });
      if (hit.length === 1) return hit[0];
    }
    hit = ids.filter(function (id) { return norm(users[id].name)[0] === local[0]; });
    return hit.length === 1 ? hit[0] : null;
  };
  var id = find(frUsers_(false)) || find(frUsers_(true));
  CacheService.getScriptCache().put('fr_me_' + email, id || '!', id ? 6 * 3600 : 300);
  return id;
}

function frNeedMe_(email) {
  var me = frMe_(email);
  if (!me) throw new Error('Couldn’t match your sign-in (' + email + ') to a Notion user. Ask Justin to check your Notion account.');
  return me;
}

/* ---------- writes ---------- */

function frToday_() {
  return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'M/d/yy');
}

// Rewrite rich text as plain text runs (keeps formatting and links; mentions become their text).
function frRich_(rich) {
  return (rich || []).map(function (t) {
    var o = { type: 'text', text: { content: t.plain_text || '' }, annotations: t.annotations };
    if (t.type === 'text' && t.text && t.text.link) o.text.link = t.text.link;
    return o;
  });
}

function frPlus_(b, email) {
  if (!b.id) throw new Error('missing request');
  var me = frNeedMe_(email);
  var pg = notion_('get', '/pages/' + b.id);
  var pr = pg.properties || {};
  var people = ((pr.Requester && pr.Requester.people) || []).map(function (u) { return { id: u.id }; });
  var firm = String(b.firm || '').replace(/[^\d, ]/g, '').trim();
  var note = String(b.note || '').trim().slice(0, 800);
  var already = people.some(function (u) { return u.id === me; });
  if (already && !firm && !note) throw new Error('You’ve already +1’d this one. Add a firm ID or a note to give it more detail.');
  var props = {};
  if (!already) props.Requester = { people: people.concat([{ id: me }]) };
  if (firm) {
    var have = plain_(pr['Firm ID'] && pr['Firm ID'].rich_text).trim();
    var list = have.split(/[,\s]+/).filter(Boolean);
    firm.split(/[,\s]+/).filter(Boolean).forEach(function (f) { if (list.indexOf(f) === -1) list.push(f); });
    props['Firm ID'] = { rich_text: [{ text: { content: list.join(', ').slice(0, 1900) } }] };
  }
  if (note || firm) {
    var users = frUsers_(false);
    var who = (users[me] && users[me].name) || email;
    var line = '+1 from ' + who + ' (' + frToday_() + (firm ? ', firm ' + firm : '') + ')' + (note ? ': ' + note : '');
    var rich = frRich_(pr.notes && pr.notes.rich_text);
    rich.push({ type: 'text', text: { content: (rich.length ? '\n' : '') + line } });
    if (rich.length <= 100) props.notes = { rich_text: rich };
  }
  var out = notion_('patch', '/pages/' + b.id, { properties: props });
  var item = frItem_(out);
  frCacheReplace_(item, false);
  return { ok: true, item: item, me: me };
}

function frCreate_(b, email) {
  var title = String(b.title || '').trim();
  if (title.length < 8) throw new Error('Describe the request in a sentence.');
  var me = frNeedMe_(email);
  var props = {
    Title: { title: [{ text: { content: title.slice(0, 1900) } }] },
    Requester: { people: [{ id: me }] },
    Date: { date: { start: Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd') } },
  };
  var notes = String(b.notes || '').trim();
  if (notes) props.notes = { rich_text: [{ text: { content: notes.slice(0, 1900) } }] };
  var firm = String(b.firm || '').replace(/[^\d, ]/g, '').trim();
  if (firm) props['Firm ID'] = { rich_text: [{ text: { content: firm } }] };
  if (b.area) props['Product Area'] = { select: { name: String(b.area) } };
  var pg = notion_('post', '/pages', { parent: { database_id: FR_DB }, properties: props });
  var item = frItem_(pg);
  frCacheReplace_(item, true);
  return { ok: true, item: item, me: me };
}

/* ---------- editor helpers ---------- */

// Run from the editor after re-authorizing Notion: checks the database is visible
// and how many Notion users can be matched to a dashboard email.
function checkFeatureRequests() {
  var d = frLoad_(true);
  var users = frUsers_(true), ids = Object.keys(users);
  var withEmail = ids.filter(function (id) { return users[id].email; }).length;
  Logger.log('Feature Requests ✓ — ' + d.items.length + ' requests, ' + d.areas.length + ' product areas. Notion users: ' +
    ids.length + ' (' + withEmail + ' with email shared).');
  Logger.log('Justin matches Notion user: ' + frMe_('justin.shephard@lawmatics.com'));
}

function frDoPost_(b, who) {
  if (b.action === 'frLoad') {
    var d = frLoad_(!!b.force);
    var me = null;
    try { me = frMe_(who.email); } catch (e) { /* the list still loads */ }
    return { ok: true, items: d.items, areas: d.areas, names: d.names, at: d.at, stale: !!d.stale, me: me };
  }
  if (b.action === 'frPlus') return frPlus_(b, who.email);
  if (b.action === 'frCreate') return frCreate_(b, who.email);
  return null;
}
