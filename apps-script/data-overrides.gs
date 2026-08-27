// DATA-CELL OVERRIDES web app — writes manager corrections to the "Overrides" tab
// of the CS Report Master sheet (Month | Table | Rep | Column | Value | Note).
//
// Deployment (one time):
//   1. Open the "CS Report Master" spreadsheet.
//   2. Extensions > Apps Script.
//   3. Paste THIS whole file into a new script file (replace the boilerplate).
//   4. Deploy > New deployment > type "Web app" > Execute as "Me" >
//      Who has access "Anyone" > Deploy. Authorize when prompted.
//   5. Copy the resulting /exec URL and send it back so the dashboard can POST to it.
//
// Security: SHARED_SECRET only deters casual tampering (it's also embedded in the
// dashboard's public JS so it can send matching requests). These overrides adjust
// internal support metrics — not anything sensitive — so that's a proportionate tradeoff.

const SHARED_SECRET = 'cs-dash-9f2a7d3b1c8e4f6a';
const OVERRIDES_SHEET_NAME = 'Overrides';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.secret !== SHARED_SECRET) return json_({ ok: false, error: 'unauthorized' });

    const month = String(b.month || '').trim();
    const table = String(b.table || '').trim();      // "Monthly" or "Teammates"
    const rep = String(b.rep || '').trim();           // blank for Monthly
    const column = String(b.column || '').trim();
    const value = (b.value == null ? '' : String(b.value).trim());
    const note = String(b.note || '').trim();
    if (!month || !table || !column) return json_({ ok: false, error: 'missing month/table/column' });

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
    } else if (row === -1) {
      sheet.appendRow([month, table, rep, column, value, note]);
    } else {
      sheet.getRange(row, 5).setValue(value);
      sheet.getRange(row, 6).setValue(note);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ ok: true, message: 'Data-overrides endpoint is live. POST to set an override.' });
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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
