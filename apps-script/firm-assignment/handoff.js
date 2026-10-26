/* ==========================================================================
   Close onboarding + handoff form (IM/CSM split) — backs the "Close onboarding"
   button on the Implementation tab's Open Onboardings list.

   handoffStart    → checks the signed-in person may close this firm (a manager, or
                     the firm's IM / account manager) and returns the firm, the
                     outcomes and the form fields.
   closeOnboarding → validates the answers, then in ChurnZero: sets Onboarding
                     Status + Onboarding Completed Date (today), saves each answer
                     that has a ChurnZero field, and for new-model firms (IM field
                     set) at or under CSM_MIN moves the Owner to Support. Reads the
                     account back to confirm and logs the handoff to the
                     "Onboarding Handoffs" tab.

   Fields with cz: null are placeholders: shown on the form and logged, never sent
   to ChurnZero (setAttribute with an unknown name CREATES a custom field there).
   ========================================================================== */

var HANDOFF_TAB = 'Onboarding Handoffs';
var SUPPORT_EMAIL = 'support@lawmatics.com';
var HANDOFF_OUTCOMES = [
  { status: 'Complete', label: 'Complete', form: 'full' },
  { status: 'Complete - Never Engaged', label: 'Complete – never engaged', form: 'short' },
  { status: 'Onboarded by Third Party', label: 'Onboarded by a third party', form: 'short' },
];
// type: text | textarea | select | yesno | date | number. forms: which outcomes show it.
// PLACEHOLDERS until Justin's ChurnZero fields exist; set cz to each field's name then.
var HANDOFF_FIELDS = [
  { key: 'goals', label: 'What the firm wants to get out of Lawmatics', type: 'textarea', required: true, forms: ['full'], cz: null },
  { key: 'useCase', label: 'Main use case', type: 'select', options: ['Intake', 'Marketing automation', 'Matter management', 'Billing', 'Other'], required: true, forms: ['full'], cz: null },
  { key: 'health', label: 'How the firm feels at handoff', type: 'select', options: ['Happy', 'Some concerns', 'At risk'], required: true, forms: ['full'], cz: null },
  { key: 'aiInterest', label: 'Interested in AI features?', type: 'yesno', forms: ['full'], cz: null },
  { key: 'checkIn', label: 'Suggested first CSM check-in', type: 'date', forms: ['full'], cz: null },
  { key: 'notes', label: 'Anything the CSM should know', type: 'textarea', required: true, forms: ['full', 'short'], cz: null },
];

// Any signed-in Lawmatics user may call these; the per-firm check is below.
function handoffAuth_(token) { return dashAuth_(token); }

function handoffAccount_(firmId) {
  var id = String(firmId || '').replace(/[^\d]/g, '');
  if (!id) throw new Error('missing Firm ID');
  var a = czGet_('/Account', { $filter: "Cf/FirmId eq '" + id + "'", $select: 'Id,Name,ExternalId,IsActive,TotalContractAmount,UserAccountId,Cf' })[0];
  if (!a) throw new Error('Firm ' + id + ' wasn’t found in ChurnZero.');
  return a;
}

// Who the firm's onboarding belongs to: the IM field on new-model firms, else the AM / owner.
function handoffCanClose_(who, acct, users) {
  if (who.manager) return true;
  var me = Object.keys(users).map(function (k) { return users[k]; })
    .filter(function (u) { return u.active && String(u.email || '').toLowerCase() === who.email; })[0];
  if (!me) return false;
  var cf = acct.Cf || {};
  var im = cfGet_(cf, IM_FIELD);
  if (im) return im === me.name;
  return String(cf.AccountManager || '').trim() === me.name || acct.UserAccountId === me.id;
}

function handoffStart_(b, who) {
  var acct = handoffAccount_(b.firmId), users = users_(), cf = acct.Cf || {};
  if (!handoffCanClose_(who, acct, users)) throw new Error('Only the firm’s IM or a manager can close this onboarding.');
  if (['Pre-Kickoff', 'Open'].indexOf(cf.OnboardingStatus) < 0) throw new Error(acct.Name + ' isn’t an open onboarding in ChurnZero (status: ' + (cf.OnboardingStatus || 'blank') + ').');
  var mrr = Number(acct.TotalContractAmount) || 0, im = cfGet_(cf, IM_FIELD);
  return {
    ok: true, firm: { firmId: String(cf.FirmId || acct.ExternalId), name: acct.Name, mrr: mrr, im: im || String(cf.AccountManager || ''),
      csm: cfGet_(cf, CSM_FIELD), owner: (users[acct.UserAccountId] || {}).name || '',
      toSupport: !!im && mrr <= CSM_MIN },
    outcomes: HANDOFF_OUTCOMES, fields: HANDOFF_FIELDS.map(function (f) { return { key: f.key, label: f.label, type: f.type, options: f.options || null, required: !!f.required, forms: f.forms, saved: !!f.cz }; }),
  };
}

function closeOnboarding_(b, who) {
  var props = PropertiesService.getScriptProperties();
  var appKey = props.getProperty('CZ_APP_KEY');
  if (!appKey) throw new Error('ChurnZero write key (CZ_APP_KEY) isn’t set up yet.');
  var acct = handoffAccount_(b.firmId), users = users_(), cf = acct.Cf || {};
  if (!handoffCanClose_(who, acct, users)) throw new Error('Only the firm’s IM or a manager can close this onboarding.');
  if (['Pre-Kickoff', 'Open'].indexOf(cf.OnboardingStatus) < 0) throw new Error(acct.Name + ' isn’t an open onboarding anymore. Refresh to update the list.');
  var outcome = HANDOFF_OUTCOMES.filter(function (o) { return o.status === b.outcome; })[0];
  if (!outcome) throw new Error('pick how the onboarding ended');

  var answers = b.answers || {}, clean = {};
  HANDOFF_FIELDS.forEach(function (f) {
    if (f.forms.indexOf(outcome.form) < 0) return;
    var v = answers[f.key] == null ? '' : String(answers[f.key]).trim().slice(0, 4000);
    if (f.type === 'select' && v && f.options.indexOf(v) < 0) throw new Error(f.label + ': pick one of the options');
    if (f.type === 'yesno' && v && ['Yes', 'No'].indexOf(v) < 0) throw new Error(f.label + ': pick Yes or No');
    if (f.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(f.label + ': enter a date');
    if (f.type === 'number' && v && !isFinite(Number(v))) throw new Error(f.label + ': enter a number');
    if (f.required && !v) throw new Error(f.label + ' is required');
    clean[f.key] = v;
  });

  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  var mrr = Number(acct.TotalContractAmount) || 0, im = cfGet_(cf, IM_FIELD);
  var support = null;
  if (im && mrr <= CSM_MIN) {
    support = Object.keys(users).map(function (k) { return users[k]; })
      .filter(function (u) { return u.active && String(u.email || '').toLowerCase() === SUPPORT_EMAIL; })[0];
    if (!support) throw new Error(SUPPORT_EMAIL + ' isn’t an active ChurnZero user, so the Owner can’t move to Support.');
  }

  czSet_(appKey, acct.ExternalId, 'OnboardingStatus', outcome.status);
  czSet_(appKey, acct.ExternalId, 'OnboardingCompletedDate', today);
  HANDOFF_FIELDS.forEach(function (f) { if (f.cz && clean[f.key] != null) czSet_(appKey, acct.ExternalId, f.cz, clean[f.key]); });
  if (support) czSet_(appKey, acct.ExternalId, props.getProperty('CZ_OWNER_ATTR') || 'OwnerUserAccount', support.email);

  var confirmed = false;
  for (var i = 0; i < 4 && !confirmed; i++) {
    Utilities.sleep(2500);
    var after = czGet_('/Account', { $filter: 'Id eq ' + acct.Id, $select: 'Id,UserAccountId,Cf/OnboardingStatus,Cf/OnboardingCompletedDate' })[0];
    var acf = (after && after.Cf) || {};
    confirmed = !!after && acf.OnboardingStatus === outcome.status && String(acf.OnboardingCompletedDate || '').slice(0, 10) === today &&
      (!support || after.UserAccountId === support.id);
  }
  handoffLog_({ by: who.email, acct: acct, outcome: outcome.status, im: im || String(cf.AccountManager || ''), mrr: mrr,
    owner: support ? support.name : '', answers: clean, confirmed: confirmed });
  return { ok: true, confirmed: confirmed, outcome: outcome.status, ownerToSupport: !!support,
    unsaved: HANDOFF_FIELDS.filter(function (f) { return !f.cz && clean[f.key] != null; }).length };
}

function handoffLog_(x) {
  var headers = ['When', 'By', 'Firm', 'Firm ID', 'CZ Account', 'MRR', 'IM', 'Outcome', 'Owner moved to', 'Answers', 'Confirmed in ChurnZero'];
  var ss = SpreadsheetApp.openById(LOG_SHEET_ID), sh = ss.getSheetByName(HANDOFF_TAB);
  if (!sh) {
    sh = ss.insertSheet(HANDOFF_TAB);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, headers.length).setValues([[
    Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'), x.by, x.acct.Name, String((x.acct.Cf || {}).FirmId || x.acct.ExternalId),
    x.acct.Id, x.mrr, x.im, x.outcome, x.owner, JSON.stringify(x.answers), x.confirmed ? 'yes' : 'pending',
  ].map(dashSafe_)]);
}

/* One-off check (run from the editor): on VIP Law (OLD), sets Onboarding Status and Completed
   Date the way closeOnboarding does, reads them back, then puts both back the way they were.
   Both fields already exist, so this can't create stray fields. */
function testCloseWrite() {
  var appKey = PropertiesService.getScriptProperties().getProperty('CZ_APP_KEY');
  var read = function () { return czGet_('/Account', { $filter: 'Id eq ' + TEST_ACCOUNT_ID, $select: 'Id,Name,ExternalId,Cf/OnboardingStatus,Cf/OnboardingCompletedDate' })[0]; };
  var before = read(), bcf = before.Cf || {};
  Logger.log('Before: status "%s", completed "%s"', bcf.OnboardingStatus || '', bcf.OnboardingCompletedDate || '');
  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  czSet_(appKey, before.ExternalId, 'OnboardingStatus', 'Complete');
  czSet_(appKey, before.ExternalId, 'OnboardingCompletedDate', today);
  var ok = false, a;
  for (var i = 0; i < 6 && !ok; i++) { Utilities.sleep(4000); a = read(); ok = (a.Cf || {}).OnboardingStatus === 'Complete' && String((a.Cf || {}).OnboardingCompletedDate || '').slice(0, 10) === today; }
  Logger.log('Write: %s (status "%s", completed "%s")', ok ? 'WORKS' : 'no change', (a.Cf || {}).OnboardingStatus, (a.Cf || {}).OnboardingCompletedDate);
  czSet_(appKey, before.ExternalId, 'OnboardingStatus', bcf.OnboardingStatus || '');
  czSet_(appKey, before.ExternalId, 'OnboardingCompletedDate', bcf.OnboardingCompletedDate || '');
  Utilities.sleep(8000);
  a = read();
  Logger.log('After restore: status "%s", completed "%s"', (a.Cf || {}).OnboardingStatus || '', (a.Cf || {}).OnboardingCompletedDate || '');
}
