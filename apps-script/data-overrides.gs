// DATA-CELL OVERRIDES web app — bound to "CS Report Master". Writes manager
// corrections to its "Overrides" tab (Month | Table | Rep | Column | Value | Note).
//
// Security: only dashboard MANAGERS can write. Each request carries the viewer's
// Google access token, checked by dashAuth_ (shared/dash-auth.js, copied in by
// tools/push-scripts.sh). The old shared secret is no longer accepted. Values are
// written as plain text so nothing can become a formula.
//
// Deploy: pushed to the CS Report Master project (~/Projects/cs-report-master-bound)
// as data-overrides.js; redeploy with `clasp update-deployment` to keep the URL.

const OVERRIDES_SHEET_NAME = 'Overrides';
const OVERRIDE_TABLES = ['monthly', 'teammates', 'incentive', 'resource'];
const MAX_LEN = 500;

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return dashJson_({ ok: false, error: 'bad request' }); }
  const who = dashAuth_(b.token);
  if (!who.ok) return dashJson_(who);
  if (!who.manager) return dashJson_({ ok: false, error: 'Only managers can make corrections.' });

  const month = String(b.month || '').trim().slice(0, 40);
  const table = String(b.table || '').trim();
  const rep = String(b.rep || '').trim().slice(0, 120);
  const column = String(b.column || '').trim().slice(0, 120);
  const value = (b.value == null ? '' : String(b.value).trim()).slice(0, MAX_LEN);
  const note = String(b.note || '').trim().slice(0, MAX_LEN);
  if (!month || !table || !column) return dashJson_({ ok: false, error: 'missing month/table/column' });
  if (OVERRIDE_TABLES.indexOf(table.toLowerCase()) === -1) return dashJson_({ ok: false, error: 'unknown table' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreate_();
    const data = sheet.getDataRange().getValues();
    let row = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === month &&
          String(data[i][1]).trim().toLowerCase() === table.toLowerCase() &&
          String(data[i][2]).trim() === rep &&
          String(data[i][3]).trim() === column) { row = i + 1; break; }
    }
    if (value === '') {                 // empty value = delete the override
      if (row !== -1) sheet.deleteRow(row);
    } else {
      if (row === -1) row = sheet.getLastRow() + 1;
      sheet.getRange(row, 1, 1, 6).setNumberFormat('@')
        .setValues([[month, table, rep, column, value, note].map(dashSafe_)]);
    }
    return dashJson_({ ok: true });
  } catch (err) {
    console.error(err);
    return dashJson_({ ok: false, error: 'Couldn’t save the correction.' });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return dashJson_({ ok: true, message: 'Data-overrides endpoint is live.' });
}

function getOrCreate_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OVERRIDES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(OVERRIDES_SHEET_NAME);
    sheet.appendRow(['Month', 'Table', 'Rep', 'Column', 'Value', 'Note']);
  }
  return sheet;
}
