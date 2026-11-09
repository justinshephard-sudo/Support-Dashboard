// LEGACY INCENTIVE OVERRIDES web app — bound to "Support Team Report 2026".
// Writes the "Overrides" tab there (Month | Incentive | Winner | Updated | Stat text), and
// (action exclude / unexclude) the "Excluded Firms" tab — see exclusions.gs, and (action
// refreshChurn, any signed-in viewer) today's churn reasons into the Accounts tab — see sync-accounts.gs.
//
// Security: only dashboard MANAGERS can write. Each request carries the viewer's
// Google access token, checked by dashAuth_ (shared/dash-auth.js, copied in by
// tools/push-scripts.sh). The old shared secret is no longer accepted. Values are
// written as plain text so nothing can become a formula.
//
// Deploy: this file is pushed to the bound project as Code.js; redeploy the
// existing web app with `clasp update-deployment` to keep its URL.

const OVERRIDES_SHEET_NAME = 'Overrides';
const MAX_LEN = 300;

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return dashJson_({ ok: false, error: 'bad request' }); }
  const who = dashAuth_(body.token);
  if (!who.ok) return dashJson_(who);
  // MRR Report "Update now" (anyone signed in): pull today's churn reasons from ChurnZero.
  if (body.action === 'refreshChurn') {
    try { return dashJson_(refreshChurnReasons_()); }
    catch (err) { console.error(err); return dashJson_({ ok: false, error: 'Couldn’t refresh churn reasons from ChurnZero.' }); }
  }
  // An IM just closed an onboarding (anyone signed in): rebuild the Implementation tabs in a minute,
  // so the firm leaves everyone's open list without waiting for the 5am sync. Back-to-back closes
  // share one re-sync (scheduleImplResync_ replaces a pending one).
  if (body.action === 'resyncImpl') {
    try { scheduleImplResync_(); return dashJson_({ ok: true }); }
    catch (err) { console.error(err); return dashJson_({ ok: false, error: 'Couldn’t schedule the Implementation refresh.' }); }
  }
  if (!who.manager) return dashJson_({ ok: false, error: 'Only managers can do that.' });
  if (body.action === 'exclude' || body.action === 'unexclude') {
    try { return dashJson_(handleExclusion_(body, who)); }
    catch (err) { console.error(err); return dashJson_({ ok: false, error: 'Couldn’t save the exclusion.' }); }
  }

  const monthKey = String(body.monthKey || '').trim().slice(0, 40);
  const incentiveKey = String(body.incentiveKey || '').trim().slice(0, 60);
  const winnerName = String(body.winnerName || '').trim().slice(0, MAX_LEN);
  const statText = String(body.statText || '').trim().slice(0, MAX_LEN);
  if (!monthKey || !incentiveKey) return dashJson_({ ok: false, error: 'missing monthKey or incentiveKey' });

  // Serialize writes so two quick edits update one row instead of appending two.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateOverridesSheet_();
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === monthKey && String(data[i][1]) === incentiveKey) { rowIndex = i + 1; break; }
    }
    const now = new Date().toISOString();
    if (winnerName) {
      const row = [monthKey, incentiveKey, winnerName, now, statText].map(dashSafe_);
      if (rowIndex === -1) rowIndex = sheet.getLastRow() + 1;
      sheet.getRange(rowIndex, 1, 1, 5).setNumberFormat('@').setValues([row]);
    } else if (rowIndex !== -1) {
      sheet.deleteRow(rowIndex);
    }
    return dashJson_({ ok: true });
  } catch (err) {
    console.error(err);
    return dashJson_({ ok: false, error: 'Couldn’t save the override.' });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return dashJson_({ ok: true, message: 'Overrides endpoint is live.' });
}

function getOrCreateOverridesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OVERRIDES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(OVERRIDES_SHEET_NAME);
    sheet.appendRow(['monthKey', 'incentiveKey', 'winnerName', 'updatedAt', 'statText']);
  }
  return sheet;
}
