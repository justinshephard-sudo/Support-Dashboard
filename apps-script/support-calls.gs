/* ==========================================================================
   CS Training Sessions — counted automatically from the support reps' calendars.
   --------------------------------------------------------------------------
   Lives in the CS Report Master bound script (tools/push-scripts.sh master).
   A "CS Training Session" is a calendar event with "support call" in the title
   (e.g. "Success Support Call - Jane Doe") on a support rep's calendar that has
   already started. The same event on two calendars counts once; cancelled events
   and ones the rep declined don't count.

   Writes "CS Training Sessions" on Data - Monthly for the current month every
   morning, and fills the previous month once (only while its cell is empty, so a
   Locked month is never overwritten). Manager overrides still win on the dashboard.

   Run once from the editor: installSupportCallsTrigger (also grants Calendar access).
   Check without writing: previewSupportCalls.
   ========================================================================== */

var SUPPORT_CALL_REPS = [
  'rosa@lawmatics.com', 'mckenna@lawmatics.com', 'max.castro@lawmatics.com', 'keri@lawmatics.com',
  'claire.ortiz@lawmatics.com', 'dan@lawmatics.com', 'chelsea@lawmatics.com',
];
var SUPPORT_CALL_RE = /support call/i;
var SUPPORT_CALL_COL = 'CS Training Sessions';
var SUPPORT_CALL_TZ = 'America/Los_Angeles';

function supportCallsMonth_(y, m) {               // m = 0-11
  var start = new Date(y, m, 1), end = new Date(y, m + 1, 1), now = new Date();
  if (end > now) end = now;                         // only calls that have started
  var seen = {}, perRep = {};
  SUPPORT_CALL_REPS.forEach(function (email) {
    var cal = CalendarApp.getCalendarById(email);
    if (!cal) { perRep[email] = 'no access'; return; }
    var n = 0;
    cal.getEvents(start, end, { search: 'support call' }).forEach(function (ev) {
      if (!SUPPORT_CALL_RE.test(ev.getTitle())) return;
      if (/cancel/i.test(ev.getTitle())) return;
      try {                                          // the rep declined (e.g. handed it to someone else)
        var g = ev.getGuestByEmail(email);
        if (g && g.getGuestStatus() === CalendarApp.GuestStatus.NO) return;
      } catch (e) { /* no guest list */ }
      var id = ev.getId();
      if (seen[id]) return;
      seen[id] = true;
      n++;
    });
    perRep[email] = n;
  });
  return { total: Object.keys(seen).length, perRep: perRep };
}

function supportCallsLabel_(y, m) {
  return Utilities.formatDate(new Date(y, m, 15), SUPPORT_CALL_TZ, 'MMMM yyyy');
}

function syncSupportCalls() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Data - Monthly');
  var rows = sh.getDataRange().getDisplayValues();   // Month cells are dates; compare their displayed "November 2026" text
  var head = rows[0], col = head.indexOf(SUPPORT_CALL_COL);
  if (col < 0) throw new Error('No "' + SUPPORT_CALL_COL + '" column on Data - Monthly');
  var now = new Date();
  var y = Number(Utilities.formatDate(now, SUPPORT_CALL_TZ, 'yyyy')), m = Number(Utilities.formatDate(now, SUPPORT_CALL_TZ, 'M')) - 1;
  var months = [{ y: y, m: m, always: true }, { y: m === 0 ? y - 1 : y, m: m === 0 ? 11 : m - 1, always: false }];
  months.forEach(function (mm) {
    var label = supportCallsLabel_(mm.y, mm.m);
    var r = -1;
    for (var i = 1; i < rows.length; i++) if (String(rows[i][0]).trim() === label) { r = i; break; }
    if (r < 0) { console.log('No row for ' + label + ' yet'); return; }
    if (!mm.always && String(rows[r][col]).trim() !== '') return;   // already filled
    var res = supportCallsMonth_(mm.y, mm.m);
    sh.getRange(r + 1, col + 1).setValue(res.total);
    console.log(label + ': ' + res.total + ' ' + JSON.stringify(res.perRep));
  });
}

function previewSupportCalls() {
  var now = new Date();
  for (var back = 3; back >= 0; back--) {
    var d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    var res = supportCallsMonth_(d.getFullYear(), d.getMonth());
    console.log(supportCallsLabel_(d.getFullYear(), d.getMonth()) + ': ' + res.total + ' ' + JSON.stringify(res.perRep));
  }
}

function installSupportCallsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncSupportCalls') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncSupportCalls').timeBased().everyDays(1).atHour(6).inTimezone(SUPPORT_CALL_TZ).create();
  syncSupportCalls();
  console.log('Daily 6 AM trigger installed and this month synced.');
}
