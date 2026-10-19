/* ==========================================================================
   Shared sign-in check for every CS Dashboard Apps Script backend.
   --------------------------------------------------------------------------
   ONE source: apps-script/shared/dash-auth.js. tools/push-scripts.sh copies it
   into each script project as dash-auth.js before `clasp push`, so never edit the
   copies.

   - dashAuth_(token): verifies a Google access token was issued to the dashboard's
     OAuth client for a verified @lawmatics.com user. Returns {ok, email, manager}.
     Cheap guards first (token shape, a per-minute ceiling on uncached lookups,
     remembered bad tokens) so junk requests can't burn the UrlFetch quota that the
     syncs and briefings share.
   - dashManagers_(): the manager list, read from the "Dashboard Config" tab of the
     Support Team Report 2026 sheet (column A under "Managers"). The page reads the
     same tab, so adding a manager there updates the dashboard and every backend.
   - dashSafe_(v): makes a value safe to write into a sheet cell (no formulas).
   ========================================================================== */

var DASH_CLIENT_ID = '1056458394718-fk8r113mqg2f55a9il4d4kg2a745d3ns.apps.googleusercontent.com';
var DASH_CONFIG_SHEET_ID = '1eqPYnDmD194GREzSIlfceLWmQyaBRW18mptL_uVRKCc';
var DASH_CONFIG_TAB = 'Dashboard Config';
var DASH_DEFAULT_MANAGERS = ['justin.shephard@lawmatics.com', 'clare@lawmatics.com', 'johnny@lawmatics.com', 'erika@lawmatics.com'];
var DASH_LOOKUPS_PER_MINUTE = 120;

function dashAuth_(token) {
  token = String(token || '');
  if (!token) return { ok: false, error: 'not signed in' };
  // Google access tokens look like "ya29.<url-safe chars>"; anything else is rejected without a lookup.
  if (token.length > 4096 || !/^ya29\.[\w\-.]+$/.test(token)) return { ok: false, error: 'session expired — reload the dashboard' };
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var email = cache.get(key);
  if (email === '!') return { ok: false, error: 'session expired — reload the dashboard' };
  if (!email) {
    var bucket = 'rl_' + Math.floor(Date.now() / 60000);
    var used = Number(cache.get(bucket) || 0);
    if (used >= DASH_LOOKUPS_PER_MINUTE) return { ok: false, error: 'busy — try again in a minute' };
    cache.put(bucket, String(used + 1), 120);
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    var info = {};
    try { info = JSON.parse(res.getContentText()); } catch (e) {}
    email = String(info.email || '').toLowerCase();
    var good = res.getResponseCode() === 200 && (info.aud === DASH_CLIENT_ID || info.azp === DASH_CLIENT_ID) &&
      String(info.email_verified) === 'true' && /@lawmatics\.com$/.test(email);
    if (res.getResponseCode() >= 500) return { ok: false, error: 'Google sign-in check failed — try again' };
    if (!good) { cache.put(key, '!', 600); return { ok: false, error: 'session expired — reload the dashboard' }; }
    cache.put(key, email, 300);
  }
  return { ok: true, email: email, manager: dashManagers_().indexOf(email) > -1 };
}

function dashManagers_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('dash_managers');
  if (hit) return JSON.parse(hit);
  var list = DASH_DEFAULT_MANAGERS;
  try {
    var ss = SpreadsheetApp.openById(DASH_CONFIG_SHEET_ID);
    var sh = ss.getSheetByName(DASH_CONFIG_TAB);
    if (!sh) {
      sh = ss.insertSheet(DASH_CONFIG_TAB);
      sh.getRange(1, 1, 1, 2).setValues([['Managers', 'Notes']]).setFontWeight('bold');
      sh.getRange(2, 1, DASH_DEFAULT_MANAGERS.length, 1).setValues(DASH_DEFAULT_MANAGERS.map(function (e) { return [e]; }));
      sh.getRange(2, 2).setValue('One email per row. Managers can edit the dashboard and see manager pages. Changes apply within 10 minutes.');
    }
    var vals = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues()
      .map(function (r) { return String(r[0] || '').trim().toLowerCase(); })
      .filter(function (e) { return /@lawmatics\.com$/.test(e); });
    if (vals.length) list = vals;
  } catch (e) { /* fall back to the defaults */ }
  cache.put('dash_managers', JSON.stringify(list), 600);
  return list;
}

// Run once from the editor after this file is first added to a project, so the
// web app is allowed to read the Dashboard Config tab and call Google's token check.
function authorizeDash() {
  dashManagers_();
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=x', { muteHttpExceptions: true });
  Logger.log('Ready. Managers: ' + dashManagers_().join(', '));
}

function dashSafe_(v) {
  if (v == null) return '';
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function dashJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
