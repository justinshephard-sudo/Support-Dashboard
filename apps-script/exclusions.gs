/* ==========================================================================
   Excluded firms — firms managers take out of the Implementation (IM) and/or CSM
   numbers (e.g. test, internal or partner accounts). Stored in the "Excluded Firms"
   tab of the Support Team Report sheet, one row per firm:
     Firm ID | Firm | Exclude From (IM / CSM / Both) | Reason | Added By | Added At
   Read by implementation-sync.gs (IM) and the MRR Report backend (CSM). The MRR
   Report itself and Johnny's sync are never affected.
   Written only through the manager-checked web app (overrides.gs → handleExclusion_).
   ========================================================================== */
var EXCLUDED_TAB = 'Excluded Firms';
var EXCLUDED_HEADERS = ['Firm ID', 'Firm', 'Exclude From', 'Reason', 'Added By', 'Added At'];
var EXCLUDE_SCOPES = ['IM', 'CSM', 'Both'];

// "4492", "4492.0" or ChurnZero's "4492~|~001Pj…" → "4492".
function excludedFirmKey_(v) {
  var m = String(v == null ? '' : v).trim().match(/^\d+/);
  return m ? String(parseInt(m[0], 10)) : '';
}

// { firmId: true } for firms excluded from `area` ('IM' or 'CSM'), including 'Both'.
function excludedFirmIds_(area) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EXCLUDED_TAB);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
    var id = excludedFirmKey_(r[0]);
    if (id && (r[2] === area || r[2] === 'Both')) out[id] = true;
  });
  return out;
}

// body: { action: 'exclude', firmId, firm, scope, reason } or { action: 'unexclude', firmId }.
function handleExclusion_(body, who) {
  var firmId = excludedFirmKey_(body.firmId);
  if (!firmId) return { ok: false, error: 'Missing firm ID.' };
  var scope = String(body.scope || '');
  if (body.action === 'exclude' && EXCLUDE_SCOPES.indexOf(scope) < 0) return { ok: false, error: 'Pick IM, CSM or Both.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(EXCLUDED_TAB);
    if (!sh) {
      sh = ss.insertSheet(EXCLUDED_TAB);
      sh.getRange(1, 1, 1, EXCLUDED_HEADERS.length).setValues([EXCLUDED_HEADERS]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, EXCLUDED_HEADERS.length).getDisplayValues() : [];
    var at = -1, before = '';
    rows.forEach(function (r, i) { if (excludedFirmKey_(r[0]) === firmId) { at = i + 2; before = r[2]; } });
    if (body.action === 'exclude') {
      var row = [firmId, String(body.firm || '').slice(0, 200), scope, String(body.reason || '').slice(0, 300),
        who.email, new Date().toISOString()].map(dashSafe_);
      if (at < 0) at = sh.getLastRow() + 1;
      sh.getRange(at, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    } else if (at > 0) {
      sh.deleteRow(at);
    }
    // IM numbers are built by the ChurnZero sync, so re-run it shortly when IM is involved.
    var touchesIm = [scope, before].some(function (s) { return s === 'IM' || s === 'Both'; });
    if (touchesIm) scheduleImplResync_();
    return { ok: true, imResync: touchesIm };
  } finally {
    lock.releaseLock();
  }
}

function scheduleImplResync_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'resyncImplementationAfterExclusion') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('resyncImplementationAfterExclusion').timeBased().after(60 * 1000).create();
}

// One-off trigger target: rebuilds the Implementation tabs, then removes itself.
function resyncImplementationAfterExclusion() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'resyncImplementationAfterExclusion') ScriptApp.deleteTrigger(t);
  });
  runSync_('Implementation', syncImplementation);
}
