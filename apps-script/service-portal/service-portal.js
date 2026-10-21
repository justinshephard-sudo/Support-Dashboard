/* ==========================================================================
   Service Portal — backs the Firm Lookup's "Service Portal" panel.
   --------------------------------------------------------------------------
   Upgrades for existing firms. All the logic lives in Salesforce
   (Apex REST /services/apexrest/service-portal, repo service-portal); this
   script only checks who is asking and passes the request on.

   load    → the firm's Chargebee subscription(s), items, add-ons it can add
   preview → prorated amount due today + new recurring amount (Chargebee estimates)
   apply   → quantity increases: Chargebee updated now (prorated), amendment PDF
             saved to the Salesforce Account and emailed to the billing contact
   quote   → new add-ons: Chargebee quote on the existing subscription → MattSign

   Who can use it: PORTAL_USERS (Script Property, comma-separated emails).
   Default = Justin only while it's being tested.

   Salesforce sign-in: External Client App "CS Dashboard Service Portal",
   client credentials flow (runs as the app's run-as user).
   Script Properties:
     SF_LOGIN_URL      My Domain URL (default: the lmtest sandbox)
     SF_CLIENT_ID      the app's Consumer Key
     SF_CLIENT_SECRET  the app's Consumer Secret
     PORTAL_USERS      optional, who may use the portal

   Deploy: Web app · Execute as: Me · Who has access: Anyone. Each request must
   carry a Google access token issued to the dashboard client for an allowed user.
   ========================================================================== */

var SP_DEFAULT_LOGIN_URL = 'https://lawmatics2020--lmtest.sandbox.my.salesforce.com';
var SP_DEFAULT_USERS = ['justin.shephard@lawmatics.com'];
var SP_ACTIONS = { load: 1, preview: 1, apply: 1, quote: 1 };

function authorize() {
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=x', { muteHttpExceptions: true });
  dashManagers_();
  var t = sfToken_(true);
  Logger.log('Salesforce sign-in OK: ' + t.instanceUrl);
}

function doGet() {
  return dashJson_({ ok: true, message: 'Service Portal endpoint is live.' });
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return dashJson_({ ok: false, error: 'bad request' }); }
  try {
    var who = dashAuth_(b.token);
    if (!who.ok) return dashJson_(who);
    if (spUsers_().indexOf(who.email) < 0) return dashJson_({ ok: false, error: 'The Service Portal isn\'t open to you yet.' });
    if (b.action === 'access') return dashJson_({ ok: true });
    if (!SP_ACTIONS[b.action]) return dashJson_({ ok: false, error: 'unknown action' });
    var payload = {
      action: b.action,
      firmId: String(b.firmId || ''),
      subscriptionId: b.subscriptionId ? String(b.subscriptionId) : null,
      changes: spLines_(b.changes),
      adds: spLines_(b.adds),
      requestId: b.requestId ? String(b.requestId).slice(0, 64) : null,
      note: b.note ? String(b.note).slice(0, 255) : null,
      repEmail: who.email,
      repName: b.repName ? String(b.repName).slice(0, 80) : null
    };
    if (b.action === 'apply' || b.action === 'quote') {
      // One write at a time, so two quick clicks can't race each other into Chargebee.
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) return dashJson_({ ok: false, error: 'Busy with another change — try again in a moment.' });
      try { return dashJson_(sfCall_(payload)); } finally { lock.releaseLock(); }
    }
    return dashJson_(sfCall_(payload));
  } catch (err) {
    return dashJson_({ ok: false, error: String((err && err.message) || err) });
  }
}

function spUsers_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PORTAL_USERS');
  if (!raw) return SP_DEFAULT_USERS;
  return raw.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(function (s) { return /@lawmatics\.com$/.test(s); });
}

function spLines_(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).map(function (l) {
    var q = l && l.quantity != null && l.quantity !== '' ? Math.floor(Number(l.quantity)) : null;
    return { itemPriceId: String((l && l.itemPriceId) || ''), quantity: isFinite(q) ? q : null };
  }).filter(function (l) { return l.itemPriceId; });
}

/* ---------- Salesforce ---------- */

function sfProps_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('SF_CLIENT_ID') || (typeof SF_CLIENT_ID !== 'undefined' ? SF_CLIENT_ID : '');
  var secret = p.getProperty('SF_CLIENT_SECRET') || (typeof SF_CLIENT_SECRET !== 'undefined' ? SF_CLIENT_SECRET : '');
  if (!id || !secret) throw new Error('Salesforce sign-in isn\'t set up yet (SF_CLIENT_ID / SF_CLIENT_SECRET).');
  return { login: (p.getProperty('SF_LOGIN_URL') || SP_DEFAULT_LOGIN_URL).replace(/\/+$/, ''), id: id, secret: secret };
}

function sfToken_(force) {
  var cache = CacheService.getScriptCache();
  if (!force) {
    var hit = cache.get('sf_token');
    if (hit) return JSON.parse(hit);
  }
  var c = sfProps_();
  var res = UrlFetchApp.fetch(c.login + '/services/oauth2/token', {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret },
    muteHttpExceptions: true
  });
  var out = {};
  try { out = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() !== 200 || !out.access_token) {
    throw new Error('Salesforce sign-in failed: ' + (out.error_description || out.error || ('HTTP ' + res.getResponseCode())));
  }
  var t = { token: out.access_token, instanceUrl: out.instance_url || c.login };
  cache.put('sf_token', JSON.stringify(t), 1500);
  return t;
}

function sfCall_(payload) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var t = sfToken_(attempt > 0);
    var res = UrlFetchApp.fetch(t.instanceUrl + '/services/apexrest/service-portal', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + t.token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code === 401 && attempt === 0) continue; // token expired: sign in again once
    var body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) {}
    if (code !== 200) {
      var msg = Array.isArray(body) && body[0] ? body[0].message : ('HTTP ' + code);
      throw new Error('Salesforce: ' + msg);
    }
    return body;
  }
  throw new Error('Salesforce sign-in keeps failing.');
}
