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
        CB_API_KEY = <read-only Chargebee API key>  → MRR comes straight from Chargebee
      (without it, MRR falls back to ChurnZero's copy.)
   4. Run syncChurnZeroAccounts once (authorize when prompted) to test.
   5. Run installSyncTriggers once: daily syncChurnZeroAccounts (~4am) and
        syncImplementationDaily (~5am). Daily keeps the CZ key alive (it expires
        after 30 days of inactivity) and the data fresh. Each run writes its
        outcome to the "Sync Status" tab, which the dashboard shows.
   The CZ key lives only in Script Properties — never in the repo or the page.

   Pulls the Account table plus four related custom tables (joined on the
   internal ChurnZero AccountId): subscription add-ons, Chargebee plan,
   unpaid invoices (balance due), and legacy contracts.
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
  'ChargebeePlan', 'ChargebeeStart', 'AddOns', 'InvoiceBalance', 'LegacyContract', 'MRRSource',
  // Churn detail for the MRR Report (replaces the Salesforce Detail tab).
  'ChurnCategory', 'ChurnDetails', 'AvgLeadsMonthly',
];

var ACCOUNT_FIELDS = ['Id', 'Name', 'ExternalId', 'IsActive', 'TotalContractAmount', 'NextRenewalDate', 'LicenseCount',
  'PrimaryChurnScoreValue', 'UsageFrequency', 'TenureInDays', 'ContactsCount', 'BillingAddressCity', 'BillingAddressState'];
var ACCOUNT_CF = ['FirmId', 'PrimaryPracticeArea', 'PracticeArea', 'AccountManager', 'ChargebeeAccountStatus', 'ContractStatus',
  'CurrentTermEnd', 'RemainingBillingCycles', 'DangerZone', 'CancellationRequested', 'AverageCsatLast60', 'AvgMattersCreatedmonth',
  'LeadVolume', 'AvgMonthlyLeadVolumelifetime', 'TotalSms', 'SmsPlanType', 'OfActivitiesLoggedl30', 'Employees',
  'OnboardingStatus', 'Website', 'CurrentMrrStartingMrr', 'ChurnCategory', 'ChurnDetails'];

// Daily trigger entry point: the Accounts tab (Firm Lookup). Records the outcome on
// the "Sync Status" tab, which the dashboard shows, so a failure (e.g. an expired
// ChurnZero key) is visible instead of silent.
function syncChurnZeroAccounts() {
  var n = runSync_('Accounts (Firm Lookup)', syncAccounts_);
  // Until installSyncTriggers has given the Implementation sync its own trigger, keep running it here.
  var ownTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncImplementationDaily'; });
  if (!ownTrigger) { try { syncImplementationDaily(); } catch (e) { console.error('syncImplementation failed: ' + e); } }
  return n;
}

// Run once from the editor: a daily trigger for each sync, an hour apart, so neither
// risks Apps Script's 6-minute limit by running inside the other.
function installSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['syncChurnZeroAccounts', 'syncImplementationDaily'].indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncChurnZeroAccounts').timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger('syncImplementationDaily').timeBased().everyDays(1).atHour(5).create();
  Logger.log('Triggers set: Accounts ~4am, Implementation ~5am.');
}

function syncImplementationDaily() {
  return runSync_('Implementation', syncImplementation);
}

function runSync_(name, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) { writeSyncStatus_(name, false, 0, 0, 'Another sync was still running'); return 0; }
  var t0 = Date.now();
  try {
    var n = fn();
    writeSyncStatus_(name, true, n, (Date.now() - t0) / 1000, '');
    return n;
  } catch (e) {
    writeSyncStatus_(name, false, 0, (Date.now() - t0) / 1000, String((e && e.message) || e).slice(0, 300));
    throw e;   // still fail the run, so Google's trigger-failure email goes out too
  } finally {
    lock.releaseLock();
  }
}

// Sync Status tab: Sync | Last success | Last run | Result | Rows | Seconds | Error
function writeSyncStatus_(name, ok, rows, secs, err) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Sync Status') || ss.insertSheet('Sync Status');
    var head = ['Sync', 'Last success', 'Last run', 'Result', 'Rows', 'Seconds', 'Error'];
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    var vals = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), head.length).getValues();
    var row = -1;
    for (var i = 1; i < vals.length; i++) if (vals[i][0] === name) { row = i + 1; break; }
    if (row === -1) row = sh.getLastRow() + 1;
    var now = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
    var lastOk = ok ? now : (row <= vals.length ? vals[row - 1][1] : '');
    sh.getRange(row, 1, 1, head.length).setNumberFormat('@')
      .setValues([[name, String(lastOk || ''), now, ok ? 'OK' : 'FAILED', String(rows || 0), String(Math.round(secs || 0)), err || '']]);
  } catch (e) { console.error('Sync Status write failed: ' + e); }
}

function syncAccounts_() {
  var props = PropertiesService.getScriptProperties();
  var user = props.getProperty('CZ_USER');
  var key = props.getProperty('CZ_KEY');
  var base = props.getProperty('CZ_BASE') || 'https://lawmatics.us1app.churnzero.net/public/v1';
  if (!user || !key) throw new Error('Set CZ_USER and CZ_KEY in Script Properties first.');

  var headers = { Authorization: 'Basic ' + Utilities.base64Encode(user + ':' + key) };

  // Related custom tables, grouped by internal ChurnZero AccountId.
  var ctx = {
    cbMrr: fetchChargebeeMrr_(props.getProperty('CB_API_KEY')),
    addOns: groupBy_(fetchAllCZ_(base + '/CustomListSubscriptionAddOn?$top=' + CZ_PAGE_SIZE, headers), 'AccountId'),
    subs:   groupBy_(fetchAllCZ_(base + '/CustomListChargebeeSubscription?$top=' + CZ_PAGE_SIZE, headers), 'AccountId'),
    legacy: groupBy_(fetchAllCZ_(base + '/CustomListLegacyContracts?$top=' + CZ_PAGE_SIZE, headers), 'AccountId'),
    // Only unpaid invoices — keeps this fast and surfaces balance-due, the support-relevant signal.
    unpaid: groupBy_(fetchAllCZ_(base + '/CustomListInvoices?$top=' + CZ_PAGE_SIZE + '&$filter=' + encodeURIComponent('AmountDue gt 0'), headers), 'AccountId'),
  };

  // Accounts → rows. Only the fields the Accounts tab uses (all ~150 custom fields
  // made each 100-row page ~600 KB), fetched in parallel.
  var select = ACCOUNT_FIELDS.concat(ACCOUNT_CF.map(function (f) { return 'Cf/' + f; })).join(',');
  var rows = fetchAllCZ_(base + '/Account?$top=' + CZ_PAGE_SIZE + '&$select=' + encodeURIComponent(select), headers)
    .map(function (a) { return accountToRow_(a, ctx); });

  writeAccountsTab_(rows);
  return rows.length;
}

function accountToRow_(a, ctx) {
  var cf = a.Cf || {};
  var acctId = String(a.Id);
  var city = uniqJoin_([a.BillingAddressCity, a.BillingAddressState]);
  var lead = cf.LeadVolume || '';
  var leadAvg = cf.AvgMonthlyLeadVolumelifetime;
  if (lead && leadAvg != null && leadAvg !== '') lead = lead + ' (' + Math.round(leadAvg) + '/mo)';

  var mrr = mrrFor_(a, cf, ctx.cbMrr);
  var map = {
    Name: a.Name || '',
    FirmId: a.ExternalId || cf.FirmId || '',
    PracticeArea: cf.PrimaryPracticeArea || firstOf_(cf.PracticeArea) || '',
    AccountManager: cf.AccountManager || '',
    MRR: mrr.value,
    MRRSource: mrr.source,
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
    ChargebeePlan: planSummary_(ctx.subs[acctId]),
    ChargebeeStart: subStart_(ctx.subs[acctId]),
    AddOns: addOnSummary_(ctx.addOns[acctId]),
    InvoiceBalance: balanceSummary_(ctx.unpaid[acctId]),
    LegacyContract: legacySummary_(ctx.legacy[acctId]),
    ChurnCategory: cf.ChurnCategory || '',
    ChurnDetails: String(cf.ChurnDetails || '').slice(0, 600),
    AvgLeadsMonthly: leadAvg == null || leadAvg === '' ? '' : String(Math.round(leadAvg)),
  };
  return CZ_COLUMNS.map(function (c) { return map[c]; });
}

/* ---- MRR: Chargebee first (live), ChurnZero's synced copy as a fallback ---- */

// Firm ID → current MRR in dollars, summed across that firm's Chargebee customers.
// Chargebee keeps customer.mrr current with the customer's active subscriptions.
// Returns null when there's no key (or Chargebee is unreachable), so the sync still runs.
var CB_SITE = 'lawmatics';
function fetchChargebeeMrr_(key) {
  if (!key) return null;
  var headers = { Authorization: 'Basic ' + Utilities.base64Encode(key + ':') };
  var byFirm = {}, offset = '', guard = 0;
  try {
    do {
      var url = 'https://' + CB_SITE + '.chargebee.com/api/v2/customers?limit=100' + (offset ? '&offset=' + encodeURIComponent(offset) : '');
      var resp = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
      if (resp.getResponseCode() !== 200) throw new Error('Chargebee HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
      var body = JSON.parse(resp.getContentText());
      (body.list || []).forEach(function (row) {
        var c = row.customer || {};
        var id = firmKey_(c.cf_firm_id);
        if (!id || c.deleted) return;
        byFirm[id] = (byFirm[id] || 0) + (Number(c.mrr) || 0) / 100;
      });
      offset = body.next_offset || '';
    } while (offset && ++guard < 400);
  } catch (e) {
    console.error('Chargebee MRR unavailable, using ChurnZero: ' + e);
    return null;
  }
  return byFirm;
}

// ChurnZero ExternalId is sometimes "4492~|~001Pj…"; the Firm ID is the leading number.
function firmKey_(v) {
  var m = /^\s*(\d+)/.exec(String(v == null ? '' : v));
  return m ? m[1] : '';
}

function mrrFor_(a, cf, cbMrr) {
  var id = firmKey_(a.ExternalId || cf.FirmId);
  if (cbMrr && id && cbMrr.hasOwnProperty(id)) return { value: Math.round(cbMrr[id] * 100) / 100, source: 'Chargebee' };
  var cz = numOr_(cf.CurrentMrrStartingMrr, a.TotalContractAmount);
  // Only flag "ChurnZero" when Chargebee was checked and had no match for this firm.
  return { value: cz, source: cz !== '' && cbMrr ? 'ChurnZero' : '' };
}

/* ---- related-table summaries ---- */
function pickSub_(subs) {
  if (!subs || !subs.length) return null;
  var active = subs.filter(function (s) { return String(s.Status || '').toLowerCase() === 'active'; });
  var pool = active.length ? active : subs;
  return pool.slice().sort(function (a, b) { return new Date(b.CreatedAt || 0) - new Date(a.CreatedAt || 0); })[0];
}
function planSummary_(subs) { var s = pickSub_(subs); return s ? (s.PlanId || '') : ''; }
function subStart_(subs) { var s = pickSub_(subs); return s ? fmtDate_(s.CreatedAt || s.StartDate || '') : ''; }

function addOnSummary_(addons) {
  if (!addons || !addons.length) return '';
  return addons.map(function (a) {
    var name = String(a.Name || '').replace(/\s*USD\s*/i, ' ').trim();
    var amt = (a.Amount != null && a.Amount !== '') ? ' ($' + Math.round(a.Amount).toLocaleString() + ')' : '';
    return name + amt;
  }).filter(Boolean).join('; ');
}

function balanceSummary_(unpaid) {
  if (!unpaid || !unpaid.length) return '';
  var total = 0;
  unpaid.forEach(function (i) { total += Number(i.AmountDue) || 0; });
  if (total <= 0) return '';
  return '$' + Math.round(total).toLocaleString() + ' (' + unpaid.length + ' unpaid)';
}

function legacySummary_(contracts) {
  if (!contracts || !contracts.length) return '';
  var started = contracts.filter(function (c) {
    return c.OutreachStarted != null && c.OutreachStarted !== '' && c.OutreachStarted !== false;
  });
  if (!started.length) return '';
  return started[0].NewContractStatus || 'Outreach started';
}

/* ---- fetch / sheet ---- */
// Every page of an OData query. The first page asks for $count, then the rest
// are fetched in parallel batches by $skip (ChurnZero allows $top 100 at most).
function fetchAllCZ_(url, headers) {
  var get = function (urls) {
    return UrlFetchApp.fetchAll(urls.map(function (u) { return { url: u, headers: headers, muteHttpExceptions: true }; }))
      .map(function (resp) {
        if (resp.getResponseCode() !== 200) {
          throw new Error('ChurnZero HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
        }
        return JSON.parse(resp.getContentText());
      });
  };
  var sep = url.indexOf('?') === -1 ? '?' : '&';
  var first = get([url + sep + '$count=true'])[0];
  var rows = (first.value || []).slice();
  var total = first['@odata.count'];
  if (total == null) {           // no count support: fall back to following nextLink
    var next = first['@odata.nextLink'], guard = 0;
    while (next && guard++ < 500) { var b = get([next])[0]; rows = rows.concat(b.value || []); next = b['@odata.nextLink']; }
    return rows;
  }
  var urls = [];
  for (var skip = rows.length; skip < total; skip += CZ_PAGE_SIZE) urls.push(url + sep + '$skip=' + skip);
  for (var i = 0; i < urls.length; i += 20) {
    get(urls.slice(i, i + 20)).forEach(function (b) { rows = rows.concat(b.value || []); });
  }
  return rows;
}

function writeAccountsTab_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CZ_ACCOUNTS_TAB);
  if (!sheet) sheet = ss.insertSheet(CZ_ACCOUNTS_TAB);
  sheet.clearContents();
  // Free text from ChurnZero (e.g. churn details) can't run as a formula.
  var out = [CZ_COLUMNS].concat(rows.map(function (r) { return r.map(dashSafe_); }));
  // Plain text, so Sheets doesn't turn dates, IDs or "Oct 2026" into numbers or dates.
  if (out.length) sheet.getRange(1, 1, out.length, CZ_COLUMNS.length).setNumberFormat('@').setValues(out);
}

/* ---- helpers ---- */
function groupBy_(list, key) {
  var m = {};
  (list || []).forEach(function (r) { var k = String(r[key]); (m[k] = m[k] || []).push(r); });
  return m;
}
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
