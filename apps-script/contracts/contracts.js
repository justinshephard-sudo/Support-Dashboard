/* ==========================================================================
   Signed contracts — private store + gatekeeper for the Firm Lookup
   --------------------------------------------------------------------------
   Signed contracts live in Salesforce as files on the Account, named
   "merged_quote_<OpportunityId>.pdf". The support team has no Salesforce
   logins, so a daily Zapier workflow ("cs-dashboard-contract-sync") copies
   each new contract here:

     1. action "plan"   — Zapier posts the full list of contract files it found
                          in Salesforce; we reply with the accounts that still
                          have contracts we haven't saved.
     2. action "ingest" — for each of those accounts Zapier posts the account's
                          files (temporary Zapier download links); we save the
                          merged_quote PDFs into a private Drive folder and log
                          them in the dashboard sheet's "Contracts" tab.

   The dashboard then asks for a contract with action "get", sending the
   viewer's Google access token. We verify it was issued to the dashboard's
   OAuth client for a @lawmatics.com account before returning the PDF, so no
   one needs access to the Drive folder itself.

   This is a standalone project that runs as its owner (Justin). Setup:
     - Run setup() once from the editor and accept the permissions prompt.
     - Deploy › Web app › Execute as: Me · Who has access: Anyone.
   INGEST_SECRET lives in secret.js, which is pushed with clasp but never
   committed (see .gitignore). Optional Script Property ALLOWED_EMAILS
   (comma-separated) narrows "get" to specific people instead of the domain.
   ========================================================================== */

var DASHBOARD_SHEET_ID = '1eqPYnDmD194GREzSIlfceLWmQyaBRW18mptL_uVRKCc';   // holds the Accounts tab
var CONTRACTS_TAB = 'Contracts';
var CONTRACTS_HEADER = ['FirmId', 'AccountId', 'AccountName', 'ContentDocumentId', 'Title',
  'OpportunityId', 'UploadedAt', 'DriveFileId', 'SavedAt'];
var DASHBOARD_CLIENT_ID = '1056458394718-fk8r113mqg2f55a9il4d4kg2a745d3ns.apps.googleusercontent.com';
var ALLOWED_DOMAIN = 'lawmatics.com';
var FOLDER_NAME = 'CS Dashboard — Signed Contracts (private)';
// Zapier hands files over as short-lived links on its own file host; refuse anything else.
var ALLOWED_FILE_PREFIX = 'https://zapier-dev-files.s3.amazonaws.com/';
var CONTRACT_NAME = /^merged_quote_(006[A-Za-z0-9]{12,15})?.*\.pdf$/i;
var MAX_ACCOUNTS_PER_PLAN = 60;   // keeps each Zapier run well inside its time limits

function setup() {
  contractsSheet_();
  var folder = folder_();
  Logger.log('Contracts tab ready; Drive folder: ' + folder.getUrl());
}

function doGet() {
  return json_({ ok: true, message: 'Contracts endpoint is live.' });
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  try {
    if (b.action === 'get') return json_(serve_(b));
    if (typeof INGEST_SECRET === 'undefined' || !INGEST_SECRET || b.secret !== INGEST_SECRET) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    if (b.action === 'plan') return json_(plan_(b));
    if (b.action === 'ingest') return json_(ingest_(b));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- Zapier side ---------- */

// links: [{ accountId, docId, title }] for every contract file in Salesforce.
function plan_(b) {
  var saved = savedDocIds_();
  var pending = {};
  var pendingDocs = 0;
  (b.links || []).forEach(function (l) {
    if (!l || !l.accountId || !l.docId || saved[l.docId]) return;
    if (!CONTRACT_NAME.test(String(l.title || ''))) return;
    pending[l.accountId] = true;
    pendingDocs++;
  });
  var accounts = Object.keys(pending);
  var max = Math.min(Number(b.maxAccounts) || MAX_ACCOUNTS_PER_PLAN, 200);
  return { ok: true, totalLinks: (b.links || []).length, pendingDocs: pendingDocs,
    pendingAccounts: accounts.length, accounts: accounts.slice(0, max) };
}

// files: the account's Salesforce attachments as returned by Zapier's
// "Get Record Attachments" ({ Id, Name, CreatedDate, file }).
function ingest_(b) {
  if (!b.accountId) return { ok: false, error: 'missing accountId' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = contractsSheet_();
    var saved = savedDocIds_();
    var folder = folder_();
    var out = { ok: true, saved: 0, skipped: 0, errors: [] };
    (b.files || []).forEach(function (f) {
      var name = String((f && f.Name) || '');
      if (!CONTRACT_NAME.test(name)) return;
      if (saved[f.Id]) { out.skipped++; return; }
      var url = String(f.file || '');
      if (url.indexOf(ALLOWED_FILE_PREFIX) !== 0) { out.errors.push(name + ': unexpected file host'); return; }
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var blob = res.getBlob();
      if (res.getResponseCode() !== 200 || blob.getDataAsString().slice(0, 5) !== '%PDF-') {
        out.errors.push(name + ': download failed (' + res.getResponseCode() + ')');
        return;
      }
      var label = (b.firmId ? b.firmId + ' — ' : '') + (b.accountName ? b.accountName + ' — ' : '') + name;
      var file = folder.createFile(blob.setName(label).setContentType('application/pdf'));
      var m = name.match(CONTRACT_NAME);
      sheet.appendRow([String(b.firmId || ''), b.accountId, String(b.accountName || ''), f.Id, name,
        (m && m[1]) || '', String(f.CreatedDate || ''), file.getId(), new Date().toISOString()]);
      saved[f.Id] = true;
      out.saved++;
    });
    return out;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- dashboard side ---------- */

function serve_(b) {
  var who = verifyViewer_(b.token);
  if (!who.ok) return who;
  var rows = contractsSheet_().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][3]) === String(b.docId)) {
      var file = DriveApp.getFileById(String(rows[i][7]));
      return { ok: true, name: String(rows[i][4]), mime: 'application/pdf',
        data: Utilities.base64Encode(file.getBlob().getBytes()) };
    }
  }
  return { ok: false, error: 'not found' };
}

// The access token must have been issued to the dashboard's OAuth client for a
// verified @lawmatics.com account (and, if ALLOWED_EMAILS is set, a listed one).
function verifyViewer_(token) {
  if (!token) return { ok: false, error: 'not signed in' };
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var email = cache.get(key);
  if (!email) {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { ok: false, error: 'session expired — reload the dashboard' };
    var info = JSON.parse(res.getContentText());
    var audOk = info.aud === DASHBOARD_CLIENT_ID || info.azp === DASHBOARD_CLIENT_ID;
    email = String(info.email || '').toLowerCase();
    if (!audOk || String(info.email_verified) !== 'true' || !/@lawmatics\.com$/.test(email)) {
      return { ok: false, error: 'not allowed' };
    }
    cache.put(key, email, 300);
  }
  var allow = (PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '')
    .split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(String);
  if (allow.length && allow.indexOf(email) === -1) return { ok: false, error: 'not allowed' };
  return { ok: true, email: email };
}

/* ---------- helpers ---------- */

function contractsSheet_() {
  var ss = SpreadsheetApp.openById(DASHBOARD_SHEET_ID);
  var sh = ss.getSheetByName(CONTRACTS_TAB);
  if (!sh) {
    sh = ss.insertSheet(CONTRACTS_TAB);
    sh.appendRow(CONTRACTS_HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

function savedDocIds_() {
  var rows = contractsSheet_().getDataRange().getValues();
  var out = {};
  for (var i = 1; i < rows.length; i++) if (rows[i][3]) out[String(rows[i][3])] = true;
  return out;
}

function folder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ }
  }
  var folder = DriveApp.createFolder(FOLDER_NAME);
  folder.setDescription('Signed contracts copied from Salesforce for the CS Support Dashboard. Do not share — the dashboard serves them through its contracts web app.');
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
