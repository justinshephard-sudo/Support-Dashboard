/* ==========================================================================
   Close onboarding + handoff form (IM/CSM split) — backs the "Close onboarding"
   button on the Implementation tab's Open Onboardings list.

   handoffStart    → checks the signed-in person may close this firm (a manager, or
                     the firm's IM / account manager) and returns the firm, the
                     outcomes and the form fields.
   closeOnboarding → validates the answers, then in ChurnZero: sets Onboarding
                     Status + Onboarding Completed Date (today), saves each answer
                     that has a ChurnZero field, and for new-model firms (IM field
                     set) moves the Owner from the IM to the CSM, or to Support when there's no CSM. Reads the
                     account back to confirm and logs the handoff to the
                     "Onboarding Handoffs" tab.

   Fields with cz: null are placeholders: shown on the form and logged, never sent
   to ChurnZero (setAttribute with an unknown name CREATES a custom field there).
   ========================================================================== */

var HANDOFF_TAB = 'Onboarding Handoffs';
var SUPPORT_EMAIL = 'support@lawmatics.com';
// Never Engaged and Third Party need no form: just the status, the completed date and the Owner move.
var HANDOFF_OUTCOMES = [
  { status: 'Complete', label: 'Complete', form: 'full' },
  { status: 'Complete - Never Engaged', label: 'Complete – never engaged', form: 'none' },
  { status: 'Onboarded by Third Party', label: 'Onboarded by a third party', form: 'none' },
];
// type: text | textarea | choice (pills) | scale (1–5) | contact (pick one of the firm's contacts).
// prefill: the field's current value in ChurnZero. Only for fields the form saves to (never sales' fields:
// every handoff answer is its own field, written fresh by the IM).
// cz: the ChurnZero field the answer saves to. null = the field doesn't exist yet: shown and logged, never
// sent (setAttribute with an unknown name CREATES a custom field). Set each one once Justin creates it.
var HANDOFF_SECTIONS = [{ key: 'firm', label: 'About the firm' }, { key: 'went', label: 'How onboarding went' }];
var HANDOFF_FIELDS = [
  { key: 'intakeBuilt', section: 'firm', label: 'Implemented intake process', type: 'textarea', required: true, cz: 'ImplementedIntakeProcess',
    hint: 'What we set up: forms, automations, how leads flow through.' },
  { key: 'painPoints', section: 'firm', label: 'Product pain points', type: 'textarea', cz: 'ProductPainPoints' },
  { key: 'goal', section: 'firm', label: 'Primary goal with Lawmatics', type: 'text', cz: 'PrimaryGoalWithLawmatics' },
  { key: 'decisionMaker', section: 'firm', label: 'Main decision maker', type: 'contact', required: true, cz: null, existing: true,
    hint: 'Saved as the contact’s Role = Primary Decision Maker.' },
  { key: 'techSavvy', section: 'firm', label: 'Tech savvy score', type: 'scale', required: true, prefill: 'TechSavvyScore1Low5High', cz: 'TechSavvyScore1Low5High',
    hint: '1 = needs a lot of help · 5 = very comfortable' },
  { key: 'sentiment', section: 'went', label: 'Onboarding sentiment', type: 'choice', options: ['Positive', 'Neutral', 'Negative'], required: true, cz: 'OnboardingSentiment' },
  { key: 'openItems', section: 'went', label: 'Open items', type: 'textarea', cz: 'OpenItems', hint: 'Anything still owed to the firm.' },
  { key: 'bugs', section: 'went', label: 'Outstanding onboarding bugs', type: 'textarea', cz: 'OutstandingOnboardingBugs' },
  { key: 'features', section: 'went', label: 'Feature requests', type: 'textarea', cz: 'OnboardingFeatureRequests' },
  { key: 'notes', section: 'went', label: 'Handoff notes', type: 'textarea', required: true, cz: 'HandoffNotes', hint: 'Anything else the CSM should know.' },
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
  var contacts = czGet_('/Contact', { $filter: 'AccountId eq ' + acct.Id, $select: 'Id,FirstName,LastName,Email,Cf/Role,Cf/Title' })
    .map(function (c) {
      var ccf = c.Cf || {};
      return { id: c.Id, name: (String(c.FirstName || '') + ' ' + String(c.LastName || '')).trim() || String(c.Email || ''),
        email: String(c.Email || ''), title: String(ccf.Title || ''), dm: ccf.Role === 'Primary Decision Maker' };
    }).filter(function (c) { return c.name; })
    .sort(function (a, b) { return (b.dm - a.dm) || a.name.localeCompare(b.name); }).slice(0, 60);
  var values = {};
  HANDOFF_FIELDS.forEach(function (f) {
    var v = f.prefill ? cfGet_(cf, f.prefill) : '';
    if (v !== '' && v != null && String(v) !== 'None') values[f.key] = f.type === 'scale' ? String(Math.round(Number(v)) || '') : String(v).slice(0, 4000);
  });
  var dm = contacts.filter(function (c) { return c.dm; })[0];
  if (dm) values.decisionMaker = String(dm.id);
  return {
    ok: true, firm: { firmId: String(cf.FirmId || acct.ExternalId), name: acct.Name, mrr: mrr, im: im || String(cf.AccountManager || ''),
      csm: cfGet_(cf, CSM_FIELD), owner: (users[acct.UserAccountId] || {}).name || '',
      // New-model firms (IM field set): the Owner moves to the CSM if there is one, else to Support.
      ownerTo: !im ? '' : cfGet_(cf, CSM_FIELD) ? 'csm' : 'support' },
    outcomes: HANDOFF_OUTCOMES, sections: HANDOFF_SECTIONS, contacts: contacts, values: values,
    fields: HANDOFF_FIELDS.map(function (f) {
      return { key: f.key, section: f.section, label: f.label, type: f.type, options: f.options || null, required: !!f.required,
        hint: f.hint || '', prefillFrom: values[f.key] ? (f.prefillFrom || '') : '', saved: !!f.cz, existing: !!(f.cz || f.existing) };
    }),
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
  if (outcome.form === 'full') HANDOFF_FIELDS.forEach(function (f) {
    var v = answers[f.key] == null ? '' : String(answers[f.key]).trim().slice(0, 4000);
    if (f.type === 'choice' && v && f.options.indexOf(v) < 0) throw new Error(f.label + ': pick one of the options');
    if (f.type === 'scale' && v && !/^[1-5]$/.test(v)) throw new Error(f.label + ': pick 1 to 5');
    if (f.type === 'contact' && v && !/^\d+$/.test(v)) throw new Error(f.label + ': pick a contact');
    if (f.required && !v) throw new Error(f.label + ' is required');
    clean[f.key] = v;
  });

  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  var mrr = Number(acct.TotalContractAmount) || 0, im = cfGet_(cf, IM_FIELD);
  // New-model firms (IM field set): the Owner moves from the IM to the CSM, or to Support when there's no CSM.
  var support = null, csmName = cfGet_(cf, CSM_FIELD);
  if (im) {
    var all = Object.keys(users).map(function (k) { return users[k]; }).filter(function (u) { return u.active; });
    support = csmName ? all.filter(function (u) { return u.name === csmName; })[0]
      : all.filter(function (u) { return String(u.email || '').toLowerCase() === SUPPORT_EMAIL; })[0];
    if (!support) throw new Error((csmName || SUPPORT_EMAIL) + ' isn’t an active ChurnZero user, so the Owner can’t move.');
  }

  czSet_(appKey, acct.ExternalId, 'OnboardingStatus', outcome.status);
  czSet_(appKey, acct.ExternalId, 'OnboardingCompletedDate', today);
  HANDOFF_FIELDS.forEach(function (f) {
    if (f.cz && f.type !== 'contact' && clean[f.key]) czSet_(appKey, acct.ExternalId, f.cz, f.type === 'scale' ? Number(clean[f.key]) : clean[f.key]);
  });
  if (support) czSet_(appKey, acct.ExternalId, props.getProperty('CZ_OWNER_ATTR') || 'OwnerUserAccount', support.email);

  if (DRY) return { ok: true, dryRun: true, wouldWrite: DRY_WRITES, confirmed: false, outcome: outcome.status, ownerMovedTo: support ? support.name : '',
    unsaved: HANDOFF_FIELDS.filter(function (f) { return !f.cz && clean[f.key] != null; }).length };
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
  return { ok: true, confirmed: confirmed, outcome: outcome.status, ownerMovedTo: support ? support.name : '',
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
