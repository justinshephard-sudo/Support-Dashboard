/* ==========================================================================
   ChurnZero → "Accounts" tab sync   (Firm Lookup data source)
   --------------------------------------------------------------------------
   SETUP (one time):
   1. Open the dashboard's Google Sheet › Extensions › Apps Script.
   2. Add a new file, paste this in (alongside overrides.gs).
   3. Project Settings › Script Properties, add:
        CZ_USER  = justin.shephard@lawmatics.com
        CZ_KEY   = <your ChurnZero REST API key>     (never commit this)
      (CZ_BASE is optional; defaults to the lawmatics US1 instance.)
   4. Run syncChurnZeroAccounts once (authorize when prompted) to test.
   5. Triggers (clock icon) › Add Trigger › syncChurnZeroAccounts ›
        Time-driven › Day timer (e.g. 4–5am). Daily keeps the CZ key alive
        (it expires after 30 days of inactivity) and the data fresh.
   The CZ key lives only in Script Properties — never in the repo or the page.
   ========================================================================== */

var CZ_ACCOUNTS_TAB = 'Accounts';
var CZ_PAGE_SIZE = 100;   // ChurnZero caps $top at 100; pagination fetches the rest

// Output columns — must match the header the dashboard's parseAccounts() reads.
var CZ_COLUMNS = [
  'Name', 'FirmId', 'PracticeArea', 'AccountManager', 'MRR', 'TotalContract',
  'ChargebeeStatus', 'ContractStatus', 'TermEnd', 'RemainingCycles', 'Licenses',
  'ChurnScore', 'UsageFrequency', 'DangerZone', 'CancellationRequested', 'CSAT60',
  'TenureDays', 'MattersPerMonth', 'LeadVolume', 'TotalSms', 'SmsPlanType', 'Activities30',
  'Employees', 'Contacts', 'OnboardingStatus', 'City', 'Website',
];

function syncChurnZeroAccounts() {
  var props = PropertiesService.getScriptProperties();
  var user = props.getProperty('CZ_USER');
  var key = props.getProperty('CZ_KEY');
  var base = props.getProperty('CZ_BASE') || 'https://lawmatics.us1app.churnzero.net/public/v1';
  if (!user || !key) throw new Error('Set CZ_USER and CZ_KEY in Script Properties first.');

  var headers = { Authorization: 'Basic ' + Utilities.base64Encode(user + ':' + key) };
  var url = base + '/Account?$top=' + CZ_PAGE_SIZE + '&$count=true';
  var rows = [];
  var guard = 0;

  while (url && guard < 200) {
    guard++;
    var resp = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      throw new Error('ChurnZero HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
    }
    var body = JSON.parse(resp.getContentText());
    (body.value || []).forEach(function (a) { rows.push(accountToRow_(a)); });
    url = body['@odata.nextLink'] || null;
  }

  writeAccountsTab_(rows);
  return rows.length;
}

function accountToRow_(a) {
  var cf = a.Cf || {};
  var city = uniqJoin_([a.BillingAddressCity, a.BillingAddressState]);
  var lead = cf.LeadVolume || '';
  var leadAvg = cf.AvgMonthlyLeadVolumelifetime;
  if (lead && leadAvg != null && leadAvg !== '') lead = lead + ' (' + Math.round(leadAvg) + '/mo)';

  var map = {
    Name: a.Name || '',
    FirmId: a.ExternalId || cf.FirmId || '',
    PracticeArea: cf.PrimaryPracticeArea || firstOf_(cf.PracticeArea) || '',
    AccountManager: cf.AccountManager || '',
    MRR: numOr_(cf.CurrentMrrStartingMrr, a.TotalContractAmount),
    TotalContract: numOr_(a.TotalContractAmount, ''),
    ChargebeeStatus: cf.ChargebeeAccountStatus || '',
    ContractStatus: cf.ContractStatus || (a.IsActive === false ? 'Inactive' : 'Active'),
    TermEnd: fmtDate_(cf.CurrentTermEnd || a.NextRenewalDate || ''),
    RemainingCycles: numOr_(cf.RemainingBillingCycles, ''),
    Licenses: numOr_(a.LicenseCount, ''),
    ChurnScore: numOr_(a.PrimaryChurnScoreValue, ''),
    UsageFrequency: a.UsageFrequency || '',
    DangerZone: boolStr_(cf.DangerZone),
    CancellationRequested: boolStr_(cf.CancellationRequested),
    CSAT60: numOr_(cf.AverageCsatLast60, ''),
    TenureDays: numOr_(a.TenureInDays, ''),
    MattersPerMonth: numOr_(cf.AvgMattersCreatedmonth, ''),
    LeadVolume: lead,
    TotalSms: numOr_(cf.TotalSms, ''),
    SmsPlanType: cf.SmsPlanType == null ? '' : cf.SmsPlanType,
    Activities30: numOr_(cf.OfActivitiesLoggedl30, ''),
    Employees: numOr_(cf.Employees, ''),
    Contacts: numOr_(a.ContactsCount, ''),
    OnboardingStatus: cf.OnboardingStatus || '',
    City: city,
    Website: cf.Website || '',
  };
  return CZ_COLUMNS.map(function (c) { return map[c]; });
}

function writeAccountsTab_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CZ_ACCOUNTS_TAB);
  if (!sheet) sheet = ss.insertSheet(CZ_ACCOUNTS_TAB);
  sheet.clearContents();
  var out = [CZ_COLUMNS].concat(rows);
  if (out.length) sheet.getRange(1, 1, out.length, CZ_COLUMNS.length).setValues(out);
}

/* ---- helpers ---- */
function firstOf_(v) { return Array.isArray(v) ? (v[0] || '') : (v || ''); }
function boolStr_(v) { return v === true ? 'Yes' : v === false ? 'No' : ''; }
function numOr_(v, fallback) {
  if (v == null || v === '') return (fallback == null || fallback === '') ? '' : fallback;
  return v;
}
function uniqJoin_(parts) {
  var seen = {}, out = [];
  (parts || []).forEach(function (p) {
    p = (p == null ? '' : String(p)).trim();
    if (p && !seen[p.toLowerCase()]) { seen[p.toLowerCase()] = 1; out.push(p); }
  });
  return out.join(', ');
}
function fmtDate_(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Los_Angeles', 'MMM d, yyyy');
}
