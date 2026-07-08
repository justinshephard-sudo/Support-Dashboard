// Deployment: open the Google Sheet this dashboard reads from, then
// Extensions > Apps Script, paste this whole file in (replacing the
// boilerplate), then Deploy > New deployment > type "Web app" >
// Execute as "Me" > Who has access "Anyone" > Deploy. Copy the resulting
// URL (ends in /exec) and send it back so the dashboard can be wired up.
//
// This creates/updates a plain "Overrides" tab in the same spreadsheet.
// Since the spreadsheet is already shared "Anyone with the link can view",
// that tab is automatically readable the same way every other tab is
// (via the public CSV export the dashboard already uses) — no extra
// sharing step needed.
//
// Security note: SHARED_SECRET only stops casual tampering, not someone
// who reads the dashboard's public JS source (it has to be embedded
// there too, to send matching requests). Given this only controls who's
// shown as winning a monthly shoutout — not anything sensitive — that's
// an intentional, proportionate tradeoff, not an oversight.

const SHARED_SECRET = 'cs-dash-9f2a7d3b1c8e4f6a';
const OVERRIDES_SHEET_NAME = 'Overrides';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }

    const monthKey = body.monthKey;
    const incentiveKey = body.incentiveKey;
    const winnerName = body.winnerName;
    if (!monthKey || !incentiveKey) {
      return jsonResponse({ ok: false, error: 'missing monthKey or incentiveKey' });
    }

    const sheet = getOrCreateOverridesSheet_();
    const data = sheet.getDataRange().getValues();

    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(monthKey) && String(data[i][1]) === String(incentiveKey)) {
        rowIndex = i + 1; // 1-indexed range for Sheets API
        break;
      }
    }

    const now = new Date().toISOString();
    if (winnerName) {
      if (rowIndex === -1) {
        sheet.appendRow([monthKey, incentiveKey, winnerName, now]);
      } else {
        sheet.getRange(rowIndex, 3).setValue(winnerName);
        sheet.getRange(rowIndex, 4).setValue(now);
      }
    } else if (rowIndex !== -1) {
      sheet.deleteRow(rowIndex);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  return jsonResponse({ ok: true, message: 'Overrides endpoint is live. Use POST to set an override.' });
}

function getOrCreateOverridesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OVERRIDES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(OVERRIDES_SHEET_NAME);
    sheet.appendRow(['MonthKey', 'IncentiveKey', 'WinnerName', 'UpdatedAt']);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
