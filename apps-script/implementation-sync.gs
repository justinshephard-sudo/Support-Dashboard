/* ==========================================================================
   ChurnZero → Implementation tab data   (CS Dashboard "Implementation" tab)
   --------------------------------------------------------------------------
   Lives in the same bound project as sync-accounts.gs and reuses its Script
   Properties (CZ_USER / CZ_KEY / CZ_BASE) and fetchAllCZ_ helper. It runs at
   the end of syncChurnZeroAccounts (daily trigger), or on its own.

   Writes two tabs:
     "Impl - Monthly"    one row per month (Month = "October 2026")
        Snapshot of open onboardings, saved daily for the CURRENT month only
        and frozen once the month ends (ChurnZero keeps no status history):
          OpenOnboardings, PreKickoff, OpenStatus, NeedsScheduling, Over70, StageCounts (JSON)
        Recomputed from history for every month:
          ClosedOnboardings  firms whose OnboardingCompletedDate falls in the month
          MedianDays         median NewTimeInOnboarding of those firms (the field is the
                             final total, populated when onboarding completes)
          CsatPct / CsatResponses   "Onboarding CSAT" survey: share of 4–5 scores
     "Impl - Open Firms" today's open onboardings, one row per firm

   Definitions (active accounts only, IsActive eq true):
     open onboarding  = OnboardingStatus "Pre-Kickoff" or "Open"
     stage            = NewOnboardingCall (blank → "No stage set")
     needs scheduling = open onboarding with no upcoming ChurnZero meeting
     days in onboarding (open firms) = TenureInDays (days since account start)
   ========================================================================== */

var IMPL_MONTHLY_TAB = 'Impl - Monthly';
var IMPL_OPEN_TAB = 'Impl - Open Firms';
var IMPL_OPEN_STATUSES = ['Pre-Kickoff', 'Open'];
var IMPL_CSAT_SURVEY_ID = 2;          // ChurnZero survey "Onboarding CSAT"
var IMPL_OVER_DAYS = 70;
var IMPL_HISTORY_MONTHS = 24;         // months of completion/CSAT history kept in the tab
var IMPL_MONTHLY_COLUMNS = ['Month', 'OpenOnboardings', 'PreKickoff', 'OpenStatus', 'NeedsScheduling', 'Over70',
  'ClosedOnboardings', 'MedianDays', 'CsatPct', 'CsatResponses', 'StageCounts', 'UpdatedAt'];
var IMPL_OPEN_COLUMNS = ['Name', 'FirmId', 'Status', 'Stage', 'Specialist', 'AccountManager',
  'DaysInOnboarding', 'NextMeeting', 'ImplementationType'];

function syncImplementation() {
  var props = PropertiesService.getScriptProperties();
  var user = props.getProperty('CZ_USER');
  var key = props.getProperty('CZ_KEY');
  var base = props.getProperty('CZ_BASE') || 'https://lawmatics.us1app.churnzero.net/public/v1';
  if (!user || !key) throw new Error('Set CZ_USER and CZ_KEY in Script Properties first.');
  var headers = { Authorization: 'Basic ' + Utilities.base64Encode(user + ':' + key) };
  var tz = Session.getScriptTimeZone() || 'America/Los_Angeles';
  var now = new Date();

  var accounts = fetchAllCZ_(base + '/Account?$top=' + CZ_PAGE_SIZE + '&$filter=' + encodeURIComponent('IsActive eq true'), headers);
  var activeIds = {};
  accounts.forEach(function (a) { activeIds[String(a.Id)] = true; });

  // Upcoming meetings → next meeting per account.
  var meetings = fetchAllCZ_(base + '/Meeting?$top=' + CZ_PAGE_SIZE + '&$select=AccountId,StartDate&$filter=' +
    encodeURIComponent('StartDate ge ' + now.toISOString().replace(/\.\d+Z$/, 'Z')), headers);
  var nextMeeting = {};
  meetings.forEach(function (m) {
    var k = String(m.AccountId);
    if (!nextMeeting[k] || m.StartDate < nextMeeting[k]) nextMeeting[k] = m.StartDate;
  });

  // --- current snapshot of open onboardings ---
  var open = accounts.filter(function (a) { return IMPL_OPEN_STATUSES.indexOf((a.Cf || {}).OnboardingStatus) !== -1; });
  var stages = {}, preKick = 0, openStatus = 0, needsSched = 0, over = 0;
  var openRows = open.map(function (a) {
    var cf = a.Cf || {};
    var stage = cf.NewOnboardingCall || 'No stage set';
    stages[stage] = (stages[stage] || 0) + 1;
    if (cf.OnboardingStatus === 'Pre-Kickoff') preKick++; else openStatus++;
    var next = nextMeeting[String(a.Id)] || '';
    if (!next) needsSched++;
    var days = a.TenureInDays == null ? '' : Math.round(a.TenureInDays);
    if (days !== '' && days >= IMPL_OVER_DAYS) over++;
    return [a.Name || '', a.ExternalId || cf.FirmId || '', cf.OnboardingStatus || '', stage,
      cf.ImplementationSpecialist || '', cf.AccountManager || '', days,
      next ? Utilities.formatDate(new Date(next), tz, 'MMM d, yyyy') : '', cf.ImplementationType || ''];
  });
  openRows.sort(function (x, y) { return (Number(y[6]) || 0) - (Number(x[6]) || 0); });

  // --- completions per month (active firms) ---
  var completed = {};   // 'yyyy-MM' -> [days]
  accounts.forEach(function (a) {
    var cf = a.Cf || {};
    if (!cf.OnboardingCompletedDate) return;
    var mk = String(cf.OnboardingCompletedDate).slice(0, 7);
    (completed[mk] = completed[mk] || []).push(cf.NewTimeInOnboarding);
  });

  // --- Onboarding CSAT per month (active firms) ---
  var since = new Date(now.getFullYear(), now.getMonth() - IMPL_HISTORY_MONTHS + 1, 1);
  var responses = fetchAllCZ_(base + '/SurveyResponse?$top=' + CZ_PAGE_SIZE + '&$select=AccountId,Score,ResponseDate,IsPending&$filter=' +
    encodeURIComponent('SurveyId eq ' + IMPL_CSAT_SURVEY_ID + ' and ResponseDate ge ' + since.toISOString().replace(/\.\d+Z$/, 'Z')), headers);
  var csat = {};   // 'yyyy-MM' -> {pos, n}
  responses.forEach(function (r) {
    if (r.IsPending || r.Score == null || !r.ResponseDate || !activeIds[String(r.AccountId)]) return;
    var mk = Utilities.formatDate(new Date(r.ResponseDate), tz, 'yyyy-MM');
    var c = csat[mk] = csat[mk] || { pos: 0, n: 0 };
    c.n++;
    if (Number(r.Score) >= 4) c.pos++;
  });

  // --- merge into the monthly tab ---
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(IMPL_MONTHLY_TAB) || ss.insertSheet(IMPL_MONTHLY_TAB);
  var existing = {};
  sheet.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0]) existing[String(r[0])] = r; });

  var curKey = Utilities.formatDate(now, tz, 'yyyy-MM');
  var out = [];
  for (var i = IMPL_HISTORY_MONTHS - 1; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var mk = Utilities.formatDate(d, tz, 'yyyy-MM');
    var label = Utilities.formatDate(d, tz, 'MMMM yyyy');
    var prev = existing[label] || [];
    var snap = mk === curKey
      ? [open.length, preKick, openStatus, needsSched, over]
      : [prev[1], prev[2], prev[3], prev[4], prev[5]].map(function (v) { return v == null ? '' : v; });
    var stageJson = mk === curKey ? JSON.stringify(stages) : (prev[10] || '');
    var days = (completed[mk] || []).filter(function (v) { return v != null && v !== ''; });
    var c = csat[mk];
    out.push([label].concat(snap, [
      (completed[mk] || []).length,
      days.length ? median_(days) : '',
      c && c.n ? Math.round((c.pos / c.n) * 1000) / 10 : '',
      c ? c.n : 0,
      stageJson,
      mk === curKey ? now.toISOString() : (prev[11] || ''),
    ]));
  }
  sheet.clearContents();
  sheet.getRange(1, 1, out.length + 1, IMPL_MONTHLY_COLUMNS.length).setValues([IMPL_MONTHLY_COLUMNS].concat(out));

  var openSheet = ss.getSheetByName(IMPL_OPEN_TAB) || ss.insertSheet(IMPL_OPEN_TAB);
  openSheet.clearContents();
  var openOut = [IMPL_OPEN_COLUMNS].concat(openRows);
  openSheet.getRange(1, 1, openOut.length, IMPL_OPEN_COLUMNS.length).setValues(openOut);
  return { open: open.length, needsScheduling: needsSched, over70: over };
}

function median_(arr) {
  var s = arr.map(Number).filter(function (v) { return !isNaN(v); }).sort(function (a, b) { return a - b; });
  if (!s.length) return '';
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
