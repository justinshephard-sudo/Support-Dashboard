/* ==========================================================================
   Loop Tracker — backs the dashboard's Resources ▸ Loop Tracker view.
   --------------------------------------------------------------------------
   Reads and writes the Notion "Team Loop Tracker" database for the weekly
   close-the-loop meeting. Everyone signed in to the dashboard (@lawmatics.com)
   can read the items and Notes (the item's page text is managers only); only MANAGERS can change status, edit fields or add items.

   Notion access is a public integration authorized once with OAuth:
     1. Script Properties: NOTION_CLIENT_ID, NOTION_CLIENT_SECRET.
     2. Run startNotionAuth() in the editor, open the logged link, click Allow
        and pick the Team Loop Tracker page. Notion redirects back to this web
        app (doGet), which stores the token in NOTION_TOKEN.
   The redirect URI registered in Notion must be this web app's /exec URL.

   Actions (POST, each with the viewer's Google access token):
     load    → items: Open, In Progress, and Closed in the last CLOSED_DAYS
     page    → one item's page text (for the side panel)
     update  → change fields (managers); closing stamps Date Closed, reopening clears it
     create  → add an item (managers)

   Deploy: Web app · Execute as: Me · Who has access: Anyone.
   Redeploy with `clasp update-deployment <id>` to keep the URL.
   ========================================================================== */

var DATABASE_ID = 'e4a103fc90624ce1b0396a50fc9e76f8'; // Team Loop Tracker
var NOTION_VERSION = '2022-06-28';
var CLOSED_DAYS = 6;
var FRESH_MS = 15000;          // serve the cached list if it's newer than this
var STALE_SECONDS = 6 * 3600;  // keep the last good list this long, for when Notion is slow or down
var SELECTS = {
  Status: ['Open', 'In Progress', 'Closed'],
  Outcome: ['Under Review', 'Implementing', 'Partially Implementing', 'Not Implementing', 'N/A'],
  Type: ['Question', 'Request', 'Suggestion'],
  'Raised By': ['AM Team', 'Support Team', 'Justin', 'Clare', 'Erika', 'Elliott', 'Gideon'],
};

/* ---------- OAuth (one-time) ---------- */

function startNotionAuth() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('NOTION_CLIENT_ID');
  if (!id) throw new Error('Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in Script Properties first.');
  var state = Utilities.getUuid();
  p.setProperty('NOTION_STATE', state);
  var url = 'https://api.notion.com/v1/oauth/authorize?owner=user&response_type=code' +
    '&client_id=' + encodeURIComponent(id) +
    '&redirect_uri=' + encodeURIComponent(redirectUri_()) +
    '&state=' + encodeURIComponent(state);
  Logger.log('Open this link, click Allow, and pick the Team Loop Tracker page:\n' + url);
}

var WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxQVzKZdB8ecIFscQUDX3uoL8CCzzH1qFiL3VtfJymAAwZPGulkn34MQi2sLt-b7NdN/exec';
function redirectUri_() {
  return WEB_APP_URL;
}

function doGet(e) {
  var q = (e && e.parameter) || {};
  if (!q.code) return HtmlService.createHtmlOutput('Loop Tracker endpoint is live.');
  var p = PropertiesService.getScriptProperties();
  if (!q.state || q.state !== p.getProperty('NOTION_STATE')) {
    return HtmlService.createHtmlOutput('This sign-in link has expired. Run startNotionAuth again.');
  }
  var res = tokenRequest_({ grant_type: 'authorization_code', code: q.code, redirect_uri: redirectUri_() });
  p.deleteProperty('NOTION_STATE');
  if (!res.ok) return HtmlService.createHtmlOutput('Notion said no: ' + htmlEsc_(res.error));
  return HtmlService.createHtmlOutput('<p style="font:16px sans-serif">✅ Notion is connected (' +
    htmlEsc_(res.body.workspace_name || 'workspace') + '). You can close this tab.</p>');
}

function htmlEsc_(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function tokenRequest_(payload) {
  var p = PropertiesService.getScriptProperties();
  var auth = Utilities.base64Encode(p.getProperty('NOTION_CLIENT_ID') + ':' + p.getProperty('NOTION_CLIENT_SECRET'));
  var r = UrlFetchApp.fetch('https://api.notion.com/v1/oauth/token', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + auth, 'Notion-Version': NOTION_VERSION },
    payload: JSON.stringify(payload),
  });
  var body = {};
  try { body = JSON.parse(r.getContentText()); } catch (e) {}
  if (r.getResponseCode() !== 200) return { ok: false, error: body.error_description || body.message || r.getContentText().slice(0, 200) };
  p.setProperty('NOTION_TOKEN', body.access_token);
  if (body.refresh_token) p.setProperty('NOTION_REFRESH', body.refresh_token);
  return { ok: true, body: body };
}

// Run from the editor to see whether the Notion connection is stored and working.
function checkNotion() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('Client ID set: ' + !!p.getProperty('NOTION_CLIENT_ID') + ' · secret set: ' + !!p.getProperty('NOTION_CLIENT_SECRET') +
    ' · token stored: ' + !!p.getProperty('NOTION_TOKEN'));
  if (!p.getProperty('NOTION_TOKEN')) { Logger.log('Not connected: run startNotionAuth and finish the Allow step.'); return; }
  var d = load_(true);
  Logger.log('Connected ✓ — ' + d.items.length + ' items visible.');
}

/* ---------- Notion API ---------- */

function notion_(method, path, payload, retried) {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty('NOTION_TOKEN');
  if (!token) throw new Error('Notion isn’t connected yet.');
  var opts = {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION },
  };
  if (payload) opts.payload = JSON.stringify(payload);
  var r;
  for (var attempt = 0; attempt < 3; attempt++) {
    r = UrlFetchApp.fetch('https://api.notion.com/v1' + path, opts);
    var code = r.getResponseCode();
    if (code !== 429 && code < 500) break;
    // Rate-limited or Notion hiccup: wait (Retry-After if given) and try again.
    var wait = Number((r.getHeaders() || {})['Retry-After'] || (r.getHeaders() || {})['retry-after'] || 0) * 1000 || 700 * (attempt + 1);
    Utilities.sleep(Math.min(wait, 3000));
  }
  if (r.getResponseCode() === 401 && !retried && p.getProperty('NOTION_REFRESH')) {
    var ref = tokenRequest_({ grant_type: 'refresh_token', refresh_token: p.getProperty('NOTION_REFRESH') });
    if (ref.ok) return notion_(method, path, payload, true);
  }
  var body = JSON.parse(r.getContentText() || '{}');
  if (r.getResponseCode() >= 300) { console.error('Notion ' + r.getResponseCode() + ': ' + (body.message || '')); throw new Error('Notion didn’t respond (HTTP ' + r.getResponseCode() + ').'); }
  return body;
}

function plain_(rich) {
  return (rich || []).map(function (t) { return t.plain_text; }).join('');
}

function toItem_(pg) {
  var pr = pg.properties || {};
  var sel = function (n) { return pr[n] && pr[n].select ? pr[n].select.name : ''; };
  var date = function (n) { return pr[n] && pr[n].date ? pr[n].date.start : ''; };
  return {
    id: pg.id, url: pg.url, edited: pg.last_edited_time, created: pg.created_time,
    item: plain_(pr.Item && pr.Item.title), status: sel('Status'), outcome: sel('Outcome'),
    type: sel('Type'), raisedBy: sel('Raised By'), notes: plain_(pr.Notes && pr.Notes.rich_text),
    shortcut: plain_(pr.Shortcut && pr.Shortcut.rich_text),
    raised: date('Date Raised') || pg.created_time.slice(0, 10), closed: date('Date Closed'),
  };
}

/* ---------- actions ---------- */

// One shared copy of the list: fresh for FRESH_MS, refreshed by whichever request
// gets the lock first (the rest wait and reuse it), and the last good copy is
// served if Notion fails.
function load_(force) {
  var cache = CacheService.getScriptCache();
  var cached = readCache_(cache);
  if (!force && cached && Date.now() - cached.fetched < FRESH_MS) return cached.data;
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(8000);
  try {
    cached = readCache_(cache);
    if (!force && cached && Date.now() - cached.fetched < FRESH_MS) return cached.data;
    try {
      var data = fetchItems_();
      cache.put('items2', JSON.stringify({ fetched: Date.now(), data: data }), STALE_SECONDS);
      return data;
    } catch (err) {
      if (cached) { var d = cached.data; d.stale = true; d.staleReason = String(err.message || err); return d; }
      throw err;
    }
  } finally {
    if (locked) lock.releaseLock();
  }
}

function readCache_(cache) {
  try { var c = cache.get('items2'); return c ? JSON.parse(c) : null; } catch (e) { return null; }
}

function fetchItems_() {
  var since = Utilities.formatDate(new Date(Date.now() - CLOSED_DAYS * 864e5), 'America/Los_Angeles', 'yyyy-MM-dd');
  var closed = { property: 'Status', select: { equals: 'Closed' } };
  var filter = { or: [
    { property: 'Status', select: { equals: 'Open' } },
    { property: 'Status', select: { equals: 'In Progress' } },
    { and: [closed, { property: 'Date Closed', date: { on_or_after: since } }] },
    // Older closed items never got a Date Closed; use when they were last edited.
    { and: [closed, { property: 'Date Closed', date: { is_empty: true } }, { timestamp: 'last_edited_time', last_edited_time: { on_or_after: since } }] },
  ] };
  var items = [], cursor = null, guard = 0;
  do {
    var body = { filter: filter, page_size: 100, sorts: [{ property: 'Date Raised', direction: 'ascending' }] };
    if (cursor) body.start_cursor = cursor;
    var res = notion_('post', '/databases/' + DATABASE_ID + '/query', body);
    items = items.concat((res.results || []).map(toItem_));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor && ++guard < 10);
  return { ok: true, items: items, options: SELECTS, closedDays: CLOSED_DAYS, at: new Date().toISOString() };
}

function pageText_(id) {
  var res = notion_('get', '/blocks/' + id + '/children?page_size=100');
  var lines = (res.results || []).map(function (b) {
    var v = b[b.type] || {};
    var txt = plain_(v.rich_text);
    var links = (v.rich_text || []).filter(function (t) { return t.href; }).map(function (t) { return t.href; });
    if (b.type === 'bookmark' || b.type === 'embed' || b.type === 'link_preview') return { text: v.url || '', href: v.url || '' };
    if (!txt) return null;
    var prefix = /bulleted|numbered/.test(b.type) ? '• ' : b.type === 'to_do' ? (v.checked ? '☑ ' : '☐ ') : '';
    return { text: prefix + txt, href: links[0] || '', heading: /^heading/.test(b.type) };
  }).filter(Boolean);
  return { ok: true, lines: lines };
}

function propsFrom_(f) {
  var props = {};
  if (f.item != null) props.Item = { title: [{ text: { content: String(f.item).slice(0, 2000) } }] };
  if (f.notes != null) props.Notes = { rich_text: [{ text: { content: String(f.notes).slice(0, 2000) } }] };
  Object.keys(SELECTS).forEach(function (name) {
    var key = { Status: 'status', Outcome: 'outcome', Type: 'type', 'Raised By': 'raisedBy' }[name];
    if (f[key] === undefined) return;
    if (f[key] === '' || f[key] === null) { props[name] = { select: null }; return; }
    if (SELECTS[name].indexOf(f[key]) === -1) throw new Error('Unknown ' + name + ': ' + f[key]);
    props[name] = { select: { name: f[key] } };
  });
  return props;
}

function today_() {
  return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
}

function update_(b) {
  if (!b.id) throw new Error('missing item');
  var f = b.fields || {};
  var props = propsFrom_(f);
  if (f.status === 'Closed') props['Date Closed'] = { date: { start: today_() } };
  else if (f.status) props['Date Closed'] = { date: null };
  var pg = notion_('patch', '/pages/' + b.id, { properties: props });
  CacheService.getScriptCache().remove('items2');
  return { ok: true, item: toItem_(pg) };
}

function create_(b) {
  var f = b.fields || {};
  if (!String(f.item || '').trim()) throw new Error('Give the item a title.');
  var props = propsFrom_({ item: f.item, notes: f.notes || '', status: 'Open', outcome: 'Under Review',
    type: f.type || undefined, raisedBy: f.raisedBy || undefined });
  props['Date Raised'] = { date: { start: today_() } };
  var pg = notion_('post', '/pages', { parent: { database_id: DATABASE_ID }, properties: props });
  CacheService.getScriptCache().remove('items2');
  return { ok: true, item: toItem_(pg) };
}

// Optional: run installWarmTrigger once from the editor. Every minute on weekday
// working hours it refreshes the shared list, so people opening the tab rarely wait on Notion.
function warmLoopCache() {
  var h = Number(Utilities.formatDate(new Date(), 'America/Los_Angeles', 'H'));
  var dow = Number(Utilities.formatDate(new Date(), 'America/Los_Angeles', 'u'));
  if (dow > 5 || h < 6 || h > 18) return;
  load_(true);
}
function installWarmTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'warmLoopCache') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('warmLoopCache').timeBased().everyMinutes(1).create();
  Logger.log('Warm-up trigger installed.');
}

/* ---------- entry ---------- */

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  try {
    var who = verify_(b.token);
    if (!who.ok) return json_(who);
    if (b.action === 'load') {
      var d = load_(!!b.force);
      d.canEdit = who.manager;
      return json_(d);
    }
    if (b.action === 'page') {
      if (!who.manager) return json_({ ok: true, lines: [] });
      return json_(pageText_(b.id));
    }
    if (b.action === 'update' || b.action === 'create') {
      if (!who.manager) return json_({ ok: false, error: 'Only managers can edit the Loop Tracker.' });
      return json_(b.action === 'update' ? update_(b) : create_(b));
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function verify_(token) {
  // Shared check (shared/dash-auth.js): any verified @lawmatics.com viewer; .manager from Dashboard Config.
  return dashAuth_(token);
}

function json_(obj) { return dashJson_(obj); }
