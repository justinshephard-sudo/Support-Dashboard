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
  { key: 'decisionMaker', section: 'firm', label: 'Main decision maker', type: 'contact', required: true, cz: 'contact:Role', existing: true,
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
  if (im) return (userFor_(users, im) || {}).id === me.id;
  return nameKey_(cf.AccountManager) === nameKey_(me.name) || acct.UserAccountId === me.id;
}

function handoffStart_(b, who) {
  var acct = handoffAccount_(b.firmId), users = users_(), cf = acct.Cf || {};
  if (!handoffCanClose_(who, acct, users)) throw new Error('Only the firm’s IM or a manager can close this onboarding.');
  if (['Pre-Kickoff', 'Open'].indexOf(cf.OnboardingStatus) < 0) throw new Error(acct.Name + ' isn’t an open onboarding in ChurnZero (status: ' + (cf.OnboardingStatus || 'blank') + ').');
  var mrr = Number(acct.TotalContractAmount) || 0, im = cfGet_(cf, IM_FIELD);
  // Only contacts with an External ID can be written back, so only those are offered.
  var contacts = czGet_('/Contact', { $filter: 'AccountId eq ' + acct.Id, $select: 'Id,ExternalId,FirstName,LastName,Email,Cf/Role,Cf/Title' })
    .filter(function (c) { return c.ExternalId; })
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
    ok: true, firm: { firmId: String(cf.FirmId || acct.ExternalId), name: acct.Name, mrr: mrr, im: repLabel_(users, im || cf.AccountManager),
      csm: repLabel_(users, cfGet_(cf, CSM_FIELD)), owner: (users[acct.UserAccountId] || {}).name || '',
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
    support = csmName ? userFor_(users, csmName)
      : all.filter(function (u) { return String(u.email || '').toLowerCase() === SUPPORT_EMAIL; })[0];
    if (!support) throw new Error((csmName || SUPPORT_EMAIL) + ' isn’t an active ChurnZero user, so the Owner can’t move.');
  }

  // The decision maker first: it's the step most likely to be refused, so nothing else is half-written if it is.
  if (clean.decisionMaker) setDecisionMaker_(appKey, acct, Number(clean.decisionMaker));
  HANDOFF_FIELDS.forEach(function (f) {
    if (f.cz && f.type !== 'contact' && clean[f.key]) czSet_(appKey, acct.ExternalId, f.cz, f.type === 'scale' ? Number(clean[f.key]) : clean[f.key]);
  });
  if (support) czSet_(appKey, acct.ExternalId, props.getProperty('CZ_OWNER_ATTR') || 'OwnerUserAccount', support.email);
  // Status last: ChurnZero's completion email triggers on it and uses the Owner's scheduling link,
  // so the new Owner and the answers are already sent when it fires.
  czSet_(appKey, acct.ExternalId, 'OnboardingStatus', outcome.status);
  czSet_(appKey, acct.ExternalId, 'OnboardingCompletedDate', today);

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
  handoffLog_({ by: who.email, acct: acct, outcome: outcome.status, im: repLabel_(users, im || cf.AccountManager), mrr: mrr,
    owner: support ? support.name : '', answers: clean, confirmed: confirmed });
  // Firms with a CSM join the handoff queue; the CSM gets a Slack DM now (the daily job retries if it fails).
  if (csmName) {
    try {
      var qr = queueAdd_({ firmId: String(cf.FirmId || acct.ExternalId), name: acct.Name, czId: acct.Id, csm: repLabel_(users, csmName),
        csmEmail: support ? support.email : '', im: repLabel_(users, im || cf.AccountManager), outcome: outcome.status, completed: today });
      if (qr && qr['CSM Email'] && handoffSlack_([{ email: qr['CSM Email'], text: queueMsg_('arrival', qr) }])) queueSet_(qr.row, 'Arrival DM', queueNow_());
    } catch (e) { console.error('handoff queue: ' + e.message); }
  }
  return { ok: true, confirmed: confirmed, outcome: outcome.status, ownerMovedTo: support ? support.name : '',
    unsaved: HANDOFF_FIELDS.filter(function (f) { return !f.cz && clean[f.key] != null; }).length };
}

// The chosen contact gets Role = Primary Decision Maker. Anyone who already had it keeps it: ChurnZero's
// write API can't blank a field, and clearing isn't needed (Justin, 2026-11-02).
var DM_ROLE = 'Primary Decision Maker';
function setDecisionMaker_(appKey, acct, contactId) {
  var cs = czGet_('/Contact', { $filter: 'AccountId eq ' + acct.Id, $select: 'Id,ExternalId,Cf/Role' });
  var pick = cs.filter(function (c) { return c.Id === contactId; })[0];
  if (!pick || !pick.ExternalId) throw new Error('That decision maker isn’t a contact on this firm in ChurnZero. Refresh and pick again.');
  if ((pick.Cf || {}).Role !== DM_ROLE) czSetContact_(appKey, acct.ExternalId, pick.ExternalId, 'Role', DM_ROLE);
}

function czSetContact_(appKey, accountExternalId, contactExternalId, name, value) {
  if (DRY) { DRY_WRITES.push('contact ' + contactExternalId + ': ' + name + ' = ' + (value || '(cleared)')); return; }
  var payload = { appKey: appKey, accountExternalId: accountExternalId, contactExternalId: contactExternalId,
    action: 'setAttribute', entity: 'contact', name: name, value: value };
  var res = UrlFetchApp.fetch(CZ_WRITE, { method: 'post', payload: payload, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) { console.error('ChurnZero contact write ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500)); throw new Error('ChurnZero rejected the decision maker change (HTTP ' + res.getResponseCode() + ').'); }
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

/* ---------- handoff queue (CSM page) ----------
   A firm joins the queue when its onboarding closes and it has a CSM (firms with no CSM go to Support
   and skip it). It stays "waiting" until its CSM, or a manager, clicks Accept; accepted firms stay on
   the page for HANDOFF_DAYS more days. The Owner already moved at completion (Justin, 2026-11-16):
   Accept is the CSM confirming they've read the handoff.
   The "Handoff Queue" tab (Support Team Report sheet) is the record. Firms closed in ChurnZero itself,
   not through the dashboard, are added the next time the queue is read.
   Slack (Ops Comms, through the "CS handoff queue → Slack" Zapier workflow): a DM to the CSM when a
   firm arrives, a reminder after HANDOFF_REMIND business days, then a DM to the escalation list after
   HANDOFF_ESCALATE business days. handoffReminders() runs on a weekday-morning trigger. */
var HANDOFF_DAYS = 7;
var QUEUE_TAB = 'Handoff Queue';
var QUEUE_HEADERS = ['Firm ID', 'Firm', 'CZ Account', 'CSM', 'CSM Email', 'IM', 'Outcome', 'Completed', 'Added',
  'Accepted By', 'Accepted At', 'Arrival DM', 'Reminder DM', 'Escalated'];
var HANDOFF_REMIND = 2, HANDOFF_ESCALATE = 4;
// Who hears about a handoff still waiting after HANDOFF_ESCALATE business days (Justin, 2026-11-16): Clare Struzzi + Johnny Bissell.
var HANDOFF_ESCALATE_DEFAULT = ['clare@lawmatics.com', 'johnny@lawmatics.com'];
var QUEUE_BACKFILL_DAYS = 21;   // how far back a ChurnZero-closed firm is picked up
var DASH_LINK = 'https://justinshephard-sudo.github.io/Support-Dashboard/';
// Zapier workflow 01a1e5c7 "CS handoff queue → Slack DMs" (rejects anything without HANDOFF_SLACK_KEY).
var HANDOFF_HOOK_DEFAULT = 'https://hooks.zapier.com/hooks/catch/14095940/CbQZ57FjBJ5vKBpFs/';

function queueSheet_() {
  var ss = SpreadsheetApp.openById(LOG_SHEET_ID), sh = ss.getSheetByName(QUEUE_TAB);
  if (!sh) {
    sh = ss.insertSheet(QUEUE_TAB);
    sh.getRange(1, 1, 1, QUEUE_HEADERS.length).setValues([QUEUE_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
// Every queue row as an object; row = its sheet row number.
function queueRows_() {
  var sh = queueSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, QUEUE_HEADERS.length).getDisplayValues().map(function (r, i) {
    var o = { row: i + 2 };
    QUEUE_HEADERS.forEach(function (h, j) { o[h] = String(r[j] || '').replace(/^'/, ''); });
    return o;
  });
}
function queueSet_(row, header, value) {
  queueSheet_().getRange(row, QUEUE_HEADERS.indexOf(header) + 1).setValue(dashSafe_(value));
}
var queueNow_ = function () { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'); };

// Adds a firm (once). x: { firmId, name, czId, csm, csmEmail, im, outcome, completed }. Returns the new row or null.
function queueAdd_(x, rows) {
  rows = rows || queueRows_();
  if (rows.some(function (r) { return r['Firm ID'] === String(x.firmId); })) return null;
  var vals = {
    'Firm ID': String(x.firmId), 'Firm': x.name, 'CZ Account': String(x.czId || ''), 'CSM': x.csm, 'CSM Email': x.csmEmail || '',
    'IM': x.im || '', 'Outcome': x.outcome || '', 'Completed': x.completed, 'Added': queueNow_(),
  };
  var sh = queueSheet_();
  sh.appendRow(QUEUE_HEADERS.map(function (h) { return dashSafe_(vals[h] == null ? '' : vals[h]); }));
  var o = { row: sh.getLastRow() };
  QUEUE_HEADERS.forEach(function (h) { o[h] = vals[h] == null ? '' : String(vals[h]); });
  rows.push(o);
  return o;
}

// Firms closed in ChurnZero (not through the dashboard) with a CSM: add them to the queue.
function queueBackfill_(rows, users) {
  var since = Utilities.formatDate(new Date(Date.now() - QUEUE_BACKFILL_DAYS * 864e5), 'America/Los_Angeles', 'yyyy-MM-dd');
  var sel = 'Id,Name,ExternalId,Cf/FirmId,Cf/OnboardingStatus,Cf/OnboardingCompletedDate,Cf/AccountManager,Cf/' + IM_FIELD + ',Cf/' + CSM_FIELD;
  var accts;
  try { accts = czGet_('/Account', { $filter: 'Cf/OnboardingCompletedDate ge ' + since + 'T00:00:00Z', $select: sel }); }
  catch (e) { accts = czGet_('/Account', { $filter: 'Cf/OnboardingCompletedDate ne null', $select: sel }); }
  var added = [];
  accts.forEach(function (a) {
    var cf = a.Cf || {}, done = String(cf.OnboardingCompletedDate || '').slice(0, 10), csmName = cfGet_(cf, CSM_FIELD);
    if (done < since || !csmName) return;
    var csm = userFor_(users, csmName);
    var r = queueAdd_({ firmId: String(cf.FirmId || a.ExternalId), name: a.Name, czId: a.Id, csm: repLabel_(users, csmName),
      csmEmail: csm ? csm.email : '', im: repLabel_(users, cfGet_(cf, IM_FIELD) || cf.AccountManager),
      outcome: String(cf.OnboardingStatus || ''), completed: done }, rows);
    if (r) added.push(r);
  });
  return added;
}

// Weekdays between two yyyy-MM-dd[ HH:mm] dates (PT), not counting the first day.
function queueBizDays_(from, to) {
  var d = new Date(String(from).slice(0, 10) + 'T12:00:00'), end = new Date(String(to).slice(0, 10) + 'T12:00:00'), n = 0;
  while (d < end) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n++; }
  return n;
}

function handoffCanAccept_(who, row) {
  return !!who.manager || (row['CSM Email'] && row['CSM Email'].toLowerCase() === String(who.email || '').toLowerCase());
}

// Queue for the CSM page: waiting firms (any age) + firms accepted in the last HANDOFF_DAYS days, with the answers.
function recentHandoffs_(b, who) {
  var users = users_(), rows = queueRows_();
  try { queueBackfill_(rows, users); } catch (e) { console.error('queue backfill: ' + e.message); }
  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  var since = Utilities.formatDate(new Date(Date.now() - (HANDOFF_DAYS - 1) * 864e5), 'America/Los_Angeles', 'yyyy-MM-dd');
  var show = rows.filter(function (r) { return !r['Accepted At'] || r['Accepted At'].slice(0, 10) >= since; });
  var base = Object.assign({ ok: true, days: HANDOFF_DAYS, since: since, remind: HANDOFF_REMIND, escalate: HANDOFF_ESCALATE }, handoffShape_());
  return Object.assign(base, { firms: handoffDetails_(show, users, who, today) });
}

function handoffShape_() {
  return { sections: HANDOFF_SECTIONS,
    fields: HANDOFF_FIELDS.map(function (f) { return { key: f.key, section: f.section, label: f.label, type: f.type }; }) };
}

// Full handoff for each queue row (or log-only row, noQueue): ChurnZero fields, decision makers, the logged answers.
function handoffDetails_(show, users, who, today) {
  if (!show.length) return [];
  var cfSel = ['FirmId', 'OnboardingStatus', 'OnboardingCompletedDate', 'AccountManager', IM_FIELD, CSM_FIELD]
    .concat(HANDOFF_FIELDS.filter(function (f) { return f.cz && f.type !== 'contact'; }).map(function (f) { return f.cz; }));
  var sel = 'Id,Name,ExternalId,TotalContractAmount,UserAccountId,' + cfSel.map(function (f) { return 'Cf/' + f; }).join(',');
  var byId = {}, dms = {};
  var ids = show.map(function (r) { return r['CZ Account']; }).filter(function (x) { return /^\d+$/.test(x); });
  for (var i = 0; i < ids.length; i += 15) {
    var part = ids.slice(i, i + 15);
    czGet_('/Account', { $filter: part.map(function (x) { return 'Id eq ' + x; }).join(' or '), $select: sel }).forEach(function (a) { byId[a.Id] = a; });
    czGet_('/Contact', { $filter: '(' + part.map(function (x) { return 'AccountId eq ' + x; }).join(' or ') + ") and Cf/Role eq '" + DM_ROLE + "'",
      $select: 'Id,AccountId,FirstName,LastName,Email,Cf/Title' }).forEach(function (c) {
      (dms[c.AccountId] = dms[c.AccountId] || []).push({ name: (String(c.FirstName || '') + ' ' + String(c.LastName || '')).trim() || String(c.Email || ''),
        email: String(c.Email || ''), title: String((c.Cf || {}).Title || '') });
    });
  }
  var logged = handoffLogByFirm_('2000-01-01');
  var firms = show.map(function (r) {
    var a = byId[r['CZ Account']] || {}, cf = a.Cf || {}, log = logged[r['Firm ID']] || {}, la = log.answers || {}, answers = {};
    HANDOFF_FIELDS.forEach(function (f) {
      if (f.type === 'contact') return;
      var v = f.cz ? cfGet_(cf, f.cz) : '';
      if ((v === '' || v === 'None' || v == null) && la[f.key]) v = String(la[f.key]);
      if (v != null && v !== '' && v !== 'None') answers[f.key] = f.type === 'scale' ? String(Math.round(Number(v)) || v) : String(v);
    });
    var waiting = !r.noQueue && !r['Accepted At'];
    return { firmId: r['Firm ID'], name: a.Name || r['Firm'], mrr: Number(a.TotalContractAmount) || 0,
      completed: r['Completed'] || String(cf.OnboardingCompletedDate || '').slice(0, 10), outcome: r['Outcome'] || String(cf.OnboardingStatus || ''),
      im: r['IM'], csm: r['CSM'], am: repLabel_(users, cf.AccountManager), owner: (users[a.UserAccountId] || {}).name || '',
      closedBy: log.by || '', decisionMakers: dms[a.Id] || [], answers: answers,
      waiting: waiting, waitDays: waiting ? queueBizDays_(r['Added'] || r['Completed'], today) : 0,
      acceptedBy: r['Accepted By'] || '', acceptedAt: r['Accepted At'] || '', canAccept: waiting && !!who && handoffCanAccept_(who, r) };
  }).sort(function (x, y) { return (y.waiting - x.waiting) || (x.waiting ? x.completed.localeCompare(y.completed) : y.acceptedAt.localeCompare(x.acceptedAt)) || x.name.localeCompare(y.name); });
  return firms;
}

/* ---------- handoff history (CSM page ▸ History, Firm Lookup ▸ Onboarding handoff) ----------
   Every onboarding closed through the dashboard, newest first, from the "Onboarding Handoffs" log
   (it keeps each form's answers for good) joined to the queue (CSM, accepted). Light: no ChurnZero calls. */
function handoffLogByFirm_(since) {
  var sh = SpreadsheetApp.openById(LOG_SHEET_ID).getSheetByName(HANDOFF_TAB), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, Math.min(sh.getLastRow() - 1, 5000), 11).getDisplayValues().forEach(function (r) {
    var id = String(r[3]).replace(/^'/, '');
    if (String(r[0]).slice(0, 10) < since || !id || out[id]) return;   // newest first: the first row per firm wins
    var ans = {};
    try { ans = JSON.parse(String(r[9]).replace(/^'/, '')); } catch (e) { /* not JSON */ }
    out[id] = { when: r[0], by: r[1], name: r[2], czAccount: String(r[4]).replace(/^'/, ''), mrr: Number(String(r[5]).replace(/[^0-9.]/g, '')) || 0,
      im: r[6], outcome: r[7], owner: r[8], answers: ans || {} };
  });
  return out;
}

function handoffHistory_(b, who) {
  var users = users_(), logged = handoffLogByFirm_('2000-01-01'), queue = {};
  queueRows_().forEach(function (r) { queue[r['Firm ID']] = r; });
  var ids = Object.keys(logged);
  Object.keys(queue).forEach(function (id) { if (!logged[id]) ids.push(id); });   // queued before the log existed
  var firms = ids.map(function (id) {
    var l = logged[id] || {}, q = queue[id] || {}, a = l.answers || {};
    return { firmId: id, name: q['Firm'] || l.name || '', mrr: l.mrr || 0, completed: (q['Completed'] || String(l.when || '')).slice(0, 10),
      outcome: q['Outcome'] || l.outcome || '', im: q['IM'] || l.im || '', csm: q['CSM'] || '', owner: l.owner || '', closedBy: l.by || '',
      acceptedBy: q['Accepted By'] || '', acceptedAt: q['Accepted At'] || '', waiting: !!q['Firm ID'] && !q['Accepted At'],
      sentiment: String(a.sentiment || ''), techSavvy: String(a.techSavvy || '') };
  }).sort(function (x, y) { return y.completed.localeCompare(x.completed) || x.name.localeCompare(y.name); });
  return Object.assign({ ok: true }, handoffShape_(), { firms: firms });
}

// One firm's full handoff, or firm: null when it was never closed through the dashboard.
function handoffFor_(b, who) {
  var id = String(b.firmId || '').trim();
  if (!id) throw new Error('No Firm ID.');
  var users = users_(), q = queueRows_().filter(function (r) { return r['Firm ID'] === id; })[0];
  var row = q;
  if (!row) {
    var l = handoffLogByFirm_('2000-01-01')[id];
    if (!l) return Object.assign({ ok: true, firm: null }, handoffShape_());
    row = { noQueue: true, 'Firm ID': id, 'Firm': l.name, 'CZ Account': l.czAccount, 'CSM': '', 'IM': l.im, 'Outcome': l.outcome, 'Completed': String(l.when).slice(0, 10) };
  }
  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  return Object.assign({ ok: true }, handoffShape_(), { firm: handoffDetails_([row], users, who, today)[0] || null });
}

function acceptHandoff_(b, who) {
  var row = queueRows_().filter(function (r) { return r['Firm ID'] === String(b.firmId); })[0];
  if (!row) throw new Error('That firm isn’t in the handoff queue. Refresh the page.');
  if (row['Accepted At']) return { ok: true, already: true, acceptedBy: row['Accepted By'], acceptedAt: row['Accepted At'] };
  if (!handoffCanAccept_(who, row)) throw new Error('Only ' + (row['CSM'] || 'the firm’s CSM') + ' or a manager can accept this handoff.');
  var at = queueNow_();
  queueSet_(row.row, 'Accepted By', who.email);
  queueSet_(row.row, 'Accepted At', at);
  return { ok: true, acceptedBy: who.email, acceptedAt: at };
}

/* ---------- Slack (Ops Comms via Zapier) ---------- */
// Script Properties: HANDOFF_SLACK_HOOK (optional; defaults to HANDOFF_HOOK_DEFAULT), HANDOFF_SLACK_KEY (made by setupHandoffSlack),
// HANDOFF_SLACK_LIVE = 'yes' to DM the real people (anything else = everything goes to Justin's DM, marked TEST),
// HANDOFF_ESCALATE_TO = comma-separated emails for the escalation (default: HANDOFF_ESCALATE_DEFAULT).
function handoffSlack_(messages) {
  var p = PropertiesService.getScriptProperties(), hook = p.getProperty('HANDOFF_SLACK_HOOK') || HANDOFF_HOOK_DEFAULT, key = p.getProperty('HANDOFF_SLACK_KEY');
  if (!messages.length) return true;
  if (!hook || !key) { console.warn('Handoff Slack not set up (HANDOFF_SLACK_HOOK / HANDOFF_SLACK_KEY) — skipped ' + messages.length + ' DM(s).'); return false; }
  var res = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ id: Utilities.getUuid(), hookKey: key, test: p.getProperty('HANDOFF_SLACK_LIVE') !== 'yes', messages: messages }) });
  if (res.getResponseCode() >= 300) { console.error('Handoff Slack hook ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300)); return false; }
  return true;
}
function handoffEscalateTo_() {
  var v = PropertiesService.getScriptProperties().getProperty('HANDOFF_ESCALATE_TO');
  return v ? v.split(',').map(function (e) { return e.trim().toLowerCase(); }).filter(String) : HANDOFF_ESCALATE_DEFAULT;
}
function queueMsg_(kind, r, days) {
  var firm = '*' + r['Firm'] + '*', link = '<' + DASH_LINK + '|CSM page>';
  if (kind === 'arrival') return ':handshake: ' + firm + ' finished onboarding with ' + (r['IM'] || 'their IM') + ' and is handed off to you. '
    + 'Read the handoff and click *Accept* on the ' + link + '.';
  if (kind === 'reminder') return ':hourglass_flowing_sand: Reminder: ' + firm + ' has been waiting ' + days + ' business days for you to accept the handoff. '
    + 'Open the ' + link + ' to read it and accept.';
  return ':rotating_light: ' + firm + ' (handed off by ' + (r['IM'] || 'the IM') + ') has waited ' + days + ' business days and ' + (r['CSM'] || 'the CSM')
    + ' hasn’t accepted it yet. ' + link;
}

// Weekday-morning trigger: picks up ChurnZero-closed firms, then sends the arrival / reminder / escalation DMs that are due.
function handoffReminders() {
  var dow = Number(Utilities.formatDate(new Date(), 'America/Los_Angeles', 'u'));
  if (dow > 5) return;   // weekdays only
  var users = users_(), rows = queueRows_();
  try { queueBackfill_(rows, users); } catch (e) { console.error('queue backfill: ' + e.message); }
  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'), now = queueNow_();
  var esc = handoffEscalateTo_(), msgs = [], marks = [];
  rows.filter(function (r) { return !r['Accepted At'] && r['CSM Email']; }).forEach(function (r) {
    var days = queueBizDays_(r['Added'] || r['Completed'], today);
    if (!r['Arrival DM']) { msgs.push({ email: r['CSM Email'], text: queueMsg_('arrival', r) }); marks.push([r.row, 'Arrival DM']); }
    else if (days >= HANDOFF_ESCALATE && !r['Escalated']) {
      esc.forEach(function (e) { msgs.push({ email: e, text: queueMsg_('escalate', r, days) }); });
      marks.push([r.row, 'Escalated']);
    } else if (days >= HANDOFF_REMIND && !r['Reminder DM']) { msgs.push({ email: r['CSM Email'], text: queueMsg_('reminder', r, days) }); marks.push([r.row, 'Reminder DM']); }
  });
  if (msgs.length && handoffSlack_(msgs)) marks.forEach(function (m) { queueSet_(m[0], m[1], now); });
  console.log('Handoff queue: ' + rows.length + ' firms, ' + msgs.length + ' DM(s) sent');
}

// Run once from the editor: makes the Slack key (only its SHA-256 is logged; give that to Claude for the Zapier
// workflow). Safe to run again. Doesn't schedule anything: that's installHandoffTrigger(), at go-live.
function setupHandoffSlack() {
  var p = PropertiesService.getScriptProperties(), key = p.getProperty('HANDOFF_SLACK_KEY');
  if (!key) { key = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('HANDOFF_SLACK_KEY', key); }
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  Logger.log('HANDOFF_SLACK_KEY sha256: ' + hash);
  Logger.log('Hook: ' + (p.getProperty('HANDOFF_SLACK_HOOK') || HANDOFF_HOOK_DEFAULT) + ' · live: ' + (p.getProperty('HANDOFF_SLACK_LIVE') === 'yes') + ' · escalate to: ' + handoffEscalateTo_().join(', '));
}

// GO-LIVE (2027-01-01), not before: triggers run the project's latest code, not the pinned deployment.
// Weekdays ~9am PT: arrival retries, 2-day reminders, 4-day escalations.
function installHandoffTrigger() {
  if (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'handoffReminders'; })) return Logger.log('Already installed.');
  ScriptApp.newTrigger('handoffReminders').timeBased().everyDays(1).atHour(9).inTimezone('America/Los_Angeles').create();
  Logger.log('Installed: handoffReminders, daily ~9am PT (it skips weekends itself).');
}

// Editor check: sends one sample arrival DM through the real path (script → Zapier → Ops Comms).
// Always test mode, so it lands in Justin's DM marked TEST, whatever HANDOFF_SLACK_LIVE says.
function testHandoffSlack() {
  var p = PropertiesService.getScriptProperties(), live = p.getProperty('HANDOFF_SLACK_LIVE');
  p.deleteProperty('HANDOFF_SLACK_LIVE');
  try {
    var ok = handoffSlack_([{ email: HANDOFF_ESCALATE_DEFAULT[0], text: queueMsg_('arrival', { 'Firm': 'Test – Sample Firm LLP', 'IM': 'Callie Burns' }) }]);
    Logger.log(ok ? 'Sent — check your Slack DMs from Ops Comms (marked TEST).' : 'Not sent — see the error above.');
  } finally { if (live) p.setProperty('HANDOFF_SLACK_LIVE', live); }
}
