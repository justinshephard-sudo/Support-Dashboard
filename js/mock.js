/* ==========================================================================
   Local test data (localhost only, off by default; toggle from the yellow local banner).
   Answers the firm-assignment backend's actions in the browser, so the IM/CSM split
   features can be tried end to end with made-up firms and nothing reaches ChurnZero:
     New Firm Assignment  → a queue of fake new firms, suggestions worked out the same
                            way as the backend (suggest_ / suggestCsm_ in firm-assignment.js)
     Assign               → the firm moves to the Implementation tab's open onboardings
     Close onboarding     → handoff form (fake contacts) → the CSM page's completed list
     CSM page             → "Completed onboardings this week" starts with a few sample handoffs
   State is kept in this browser (localStorage) until "Reset test data".
   ========================================================================== */
const MOCK_KEY = 'cs-mock', MOCK_STATE = 'cs-mock-state';
const MOCK_ON = LOCAL_ENV && (() => { try { return localStorage.getItem(MOCK_KEY) === 'on'; } catch (e) { return false; } })();

const MOCK_DAY = (n) => { const d = new Date(Date.now() - n * 864e5); return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); };
const MOCK_WEIGHTS = { open: 40, since: 30, book: 15, value: 15 }, MOCK_CSM_WEIGHTS = { fit: 50, book: 25, since: 25 };
const MOCK_CSM_MIN = 400, MOCK_PARTNER_ID = 11;
const MOCK_ROSTER = ['Elliott Jones', 'Julio Ortiz', 'Jessie Hobbs'];   // CSMs, biggest firms first

function mockSeed() {
  const c = (first, last, onboarding, title) => ({ first, last, onboarding, title });
  const firm = (i, name, mrr, daysAgo, extra) => Object.assign({
    czId: 900000 + i, firmId: String(99000 + i), externalId: String(99000 + i), name, mrr, start: MOCK_DAY(daysAgo),
    licenses: Math.max(1, Math.round(mrr / 120)), ae: ['Kyle Mercer', 'Dana Ruiz', 'Ben Ortega'][i % 3], practice: 'Personal Injury',
    type: '', flags: [], leadSource: 'Inbound', leadSourceDetail: 'Website demo request', partner: false,
    notes: { sales: 'Moving off Clio Grow. Wants intake automated before their busy season.', intake: 'Web form + phone calls into a shared inbox.', challenges: 'Leads slip through on weekends.', aiDemo: '' },
    links: { deck: '', docs: '' },
    contacts: [c('Maria', 'Lopez', true, 'Managing Partner'), c('Sam', 'Reed', false, 'Office Manager')],
  }, extra || {});
  return {
    reps: [
      { id: 97, name: 'Callie Burns', open: 22, openMrr: 10177, firms: 190, mrr: 83540, lastStart: MOCK_DAY(0), included: true, high: false },
      { id: 98, name: 'Andy Galindo', open: 15, openMrr: 7420, firms: 120, mrr: 61200, lastStart: MOCK_DAY(3), included: true, high: false },
      { id: 104, name: 'Admir Karamovic', open: 18, openMrr: 12850, firms: 140, mrr: 90310, lastStart: MOCK_DAY(1), included: true, high: true },
      { id: 112, name: 'Swetha Devakumar', open: 9, openMrr: 3980, firms: 45, mrr: 21400, lastStart: MOCK_DAY(6), included: true, high: false },
    ],
    csms: [
      { id: 7, name: 'Elliott Jones', open: 19, openMrr: 26413, firms: 133, mrr: 231549, lastStart: MOCK_DAY(4), included: true },
      { id: 9, name: 'Julio Ortiz', open: 12, openMrr: 9100, firms: 98, mrr: 88200, lastStart: MOCK_DAY(2), included: true },
      { id: 31, name: 'Jessie Hobbs', open: 8, openMrr: 4300, firms: 61, mrr: 39800, lastStart: MOCK_DAY(8), included: true },
    ],
    partner: { id: MOCK_PARTNER_ID, name: 'Kennedy Wickham', open: 6, firms: 52, openMrr: 3900, lastStart: MOCK_DAY(5) },
    highMin: 1000, bands: { top: 850, mid: 550 },
    queue: [
      firm(1, 'Test – Harbor Point Injury Law', 1450, 1, { practice: 'Personal Injury, Workers Comp', flags: ['Consultant'] }),
      firm(2, 'Test – Ridgeway Family Law', 920, 2, { practice: 'Family Law' }),
      firm(3, 'Test – Cedar & Stone Estate Planning', 780, 2, { practice: 'Estate Planning', leadSource: 'Partner', leadSourceDetail: 'Referral partner: LawPay', partner: true }),
      firm(4, 'Test – Alvarez Immigration Group', 610, 3, { practice: 'Immigration', flags: ['Affiliate'], affiliate: true, partner: true }),
      firm(5, 'Test – Blue Mesa Criminal Defense', 425, 4, { practice: 'Criminal Defense' }),
      firm(6, 'Test – Oakline Bankruptcy', 349, 5, { practice: 'Bankruptcy' }),
      firm(7, 'Test – Summit Employment Law', 289, 6, { practice: 'Employment', contacts: [c('Priya', 'Shah', false, 'Partner')] }),
      firm(8, 'Test – Northgate Elder Law', 199, 9, { practice: 'Elder Law', start: '' }),
    ],
    recent: [], open: [],
    completed: [
      mockDone('Test – Lakeside Personal Injury', '99101', 1120, 1, 'Complete', 'Callie Burns', 'Elliott Jones', 'Jordan Pike', 'Managing Partner', {
        intakeBuilt: 'Website form and Google Ads leads go straight into Lawmatics. Auto-texts within 2 minutes, consult booked through the scheduler, intake questionnaire sent before the call.',
        painPoints: 'Reports are confusing. They want a weekly lead-source report emailed to the partners.',
        goal: 'Stop losing weekend leads and sign 20% more cases.', techSavvy: '4', sentiment: 'Positive',
        openItems: 'Build the referral-partner report. Second training for the new intake hire on the 12th.',
        bugs: 'Text replies sometimes land on the wrong matter (ticket open with Support).',
        features: 'Two-way calendar sync with Outlook shared calendars.',
        notes: 'Jordan is the champion and very responsive. Office manager (Tess) runs day to day — loop her in on everything.' }),
      mockDone('Test – Greenfield Estate Law', '99102', 640, 3, 'Complete', 'Andy Galindo', 'Julio Ortiz', 'Helen Park', 'Owner', {
        intakeBuilt: 'Phone intake only for now; staff fill in the internal intake form during the call.',
        painPoints: 'Felt the build-out took too long.', goal: 'Get every estate client through a consistent onboarding flow.',
        techSavvy: '2', sentiment: 'Neutral', openItems: 'Engagement letter template still needs her edits.',
        bugs: '', features: 'Built-in e-notary.', notes: 'Prefers phone over email. Not technical — go slow and send recordings.' }),
      mockDone('Test – Vega Immigration', '99103', 520, 5, 'Complete', 'Swetha Devakumar', 'Jessie Hobbs', 'Luis Vega', 'Attorney', {
        intakeBuilt: 'Spanish and English intake forms, automations by case type (family petition, asylum, DACA).',
        painPoints: 'Spanish text templates need manual edits.', goal: 'Handle twice the consults without hiring.',
        techSavvy: '3', sentiment: 'Negative', openItems: 'Spanish email templates. Payment link setup.',
        bugs: 'Form conditional logic not hiding fields on mobile.', features: 'Spanish-language client portal.',
        notes: 'Frustrated by the mobile form bug — check in this week. Renewal risk if it drags on.' }),
      mockDone('Test – Pinecrest Legal', '99104', 310, 2, 'Complete', 'Callie Burns', '', 'Ava Chen', 'Partner', {
        intakeBuilt: 'Simple web form → consult scheduler.', goal: 'Look more professional to new clients.', techSavvy: '5',
        sentiment: 'Positive', notes: 'Self-sufficient. Support only.' }),
      mockDone('Test – Holloway Law Office', '99105', 450, 4, 'Complete - Never Engaged', 'Admir Karamovic', 'Elliott Jones', '', '', {}),
      mockDone('Test – Brightline Injury Partners', '99106', 980, 6, 'Onboarded by Third Party', 'Andy Galindo', 'Elliott Jones', 'Mark Bright', 'Owner', {}),
    ],
  };
}

function mockDone(name, firmId, mrr, daysAgo, outcome, im, csm, dm, title, answers) {
  return { firmId, name, mrr, completed: MOCK_DAY(daysAgo), outcome, im, csm, am: im, owner: csm || 'Support',
    closedBy: outcome === 'Complete' ? im.split(' ')[0].toLowerCase() + '@lawmatics.com' : '',
    decisionMakers: dm ? [{ name: dm, title, email: dm.split(' ')[0].toLowerCase() + '@example.com' }] : [], answers };
}

let MOCK = null;
function mockLoadState() {
  try { MOCK = JSON.parse(localStorage.getItem(MOCK_STATE) || 'null'); } catch (e) { MOCK = null; }
  if (!MOCK || !MOCK.queue) MOCK = mockSeed();
}
function mockSave() { try { localStorage.setItem(MOCK_STATE, JSON.stringify(MOCK)); } catch (e) { /* private mode */ } }

/* ---------- suggestions (same rules as suggest_ / suggestCsm_ in the backend) ---------- */
const mockDays = (d) => (d ? Math.max(0, Math.round((Date.now() - new Date(d + 'T12:00:00')) / 864e5)) : 365);
const mockNorm = (vals, higher) => {
  const mn = Math.min(...vals), mx = Math.max(...vals);
  return vals.map((v) => (mx === mn ? 1 : higher ? (v - mn) / (mx - mn) : (mx - v) / (mx - mn)));
};
function mockSuggest(queue) {
  const all = MOCK.reps.filter((r) => r.included).map((r) => ({ r, open: r.open, openMrr: r.openMrr, firms: r.firms, lastStart: r.lastStart }));
  const partner = Object.assign({}, MOCK.partner);
  queue.forEach((f) => {
    f.high = f.mrr >= MOCK.highMin;
    let sim = all.filter((s) => !!s.r.high === f.high);
    f.tierFallback = !sim.length;
    if (!sim.length) sim = all;
    if (!sim.length && !f.partner) { f.ranking = []; return; }
    const o = mockNorm(sim.map((s) => s.open), false), d = mockNorm(sim.map((s) => mockDays(s.lastStart)), true);
    const b = mockNorm(sim.map((s) => s.firms), false), v = mockNorm(sim.map((s) => s.openMrr), false);
    let ranked = sim.map((s, i) => ({
      userId: s.r.id, name: s.r.name,
      score: Math.round(o[i] * MOCK_WEIGHTS.open + d[i] * MOCK_WEIGHTS.since + b[i] * MOCK_WEIGHTS.book + v[i] * MOCK_WEIGHTS.value),
      parts: { open: Math.round(o[i] * MOCK_WEIGHTS.open), since: Math.round(d[i] * MOCK_WEIGHTS.since), book: Math.round(b[i] * MOCK_WEIGHTS.book), value: Math.round(v[i] * MOCK_WEIGHTS.value) },
      open: s.open, daysSince: mockDays(s.lastStart), firms: s.firms, openMrr: Math.round(s.openMrr),
    })).sort((x, y) => y.score - x.score || x.open - y.open || y.daysSince - x.daysSince);
    all.forEach((s) => { if (!sim.includes(s)) ranked.push({ userId: s.r.id, name: s.r.name, score: null, outside: true, open: s.open, daysSince: mockDays(s.lastStart), firms: s.firms, openMrr: Math.round(s.openMrr) }); });
    // Kennedy only takes partner-sourced firms; for the rest she's pickable at the bottom, unscored.
    if (!f.partner) ranked.push({ userId: partner.id, name: partner.name, score: null, partnerOnly: true, open: partner.open, daysSince: mockDays(partner.lastStart), firms: partner.firms, openMrr: partner.openMrr });
    if (f.partner) {
      ranked = ranked.filter((x) => x.userId !== partner.id);
      ranked.unshift({ userId: partner.id, name: partner.name, score: null, partnerRule: true, open: partner.open, daysSince: mockDays(partner.lastStart), firms: partner.firms, openMrr: partner.openMrr });
      partner.open++; partner.firms++; partner.openMrr += f.mrr;
    }
    f.ranking = ranked;
    const top = all.find((s) => s.r.id === ranked[0].userId);
    if (top) { top.open++; top.firms++; top.openMrr += f.mrr; top.lastStart = MOCK_DAY(0); }
  });
}
function mockSuggestCsm(queue) {
  const all = MOCK.csms.filter((r) => r.included).map((r) => ({ r, firms: r.firms, lastStart: r.lastStart, idx: MOCK_ROSTER.indexOf(r.name) }));
  const partner = Object.assign({}, MOCK.partner), bands = MOCK.bands;
  queue.forEach((f) => {
    f.needsCsm = f.mrr > MOCK_CSM_MIN;
    f.csmRanking = [];
    if (!f.needsCsm || !all.length) return;
    f.band = f.mrr >= bands.top ? 0 : f.mrr >= bands.mid ? 1 : 2;
    const b = mockNorm(all.map((s) => s.firms), false), d = mockNorm(all.map((s) => mockDays(s.lastStart)), true);
    let ranked = all.map((s, i) => {
      const fit = Math.max(0, 1 - Math.abs(s.idx - f.band) / 2);
      const parts = { fit: Math.round(fit * MOCK_CSM_WEIGHTS.fit), book: Math.round(b[i] * MOCK_CSM_WEIGHTS.book), since: Math.round(d[i] * MOCK_CSM_WEIGHTS.since) };
      return { userId: s.r.id, name: s.r.name, score: parts.fit + parts.book + parts.since, parts, firms: s.firms, daysSince: mockDays(s.lastStart), bandFit: s.idx === f.band };
    }).sort((x, y) => y.score - x.score || x.firms - y.firms);
    if (f.partner) {
      ranked = ranked.filter((x) => x.userId !== partner.id);
      ranked.unshift({ userId: partner.id, name: partner.name, score: null, partnerRule: true, firms: partner.firms, daysSince: mockDays(partner.lastStart) });
      partner.firms++;
    }
    f.csmRanking = ranked;
    const top = all.find((s) => ranked[0] && s.r.id === ranked[0].userId);
    if (top) { top.firms++; top.lastStart = MOCK_DAY(0); }
  });
}

function mockLoad() {
  const queue = JSON.parse(JSON.stringify(MOCK.queue)).map((f) => {
    f.contacts = f.contacts.map((c) => ({ name: `${c.first} ${c.last}`, email: `${c.first.toLowerCase()}@example.com`, onboarding: c.onboarding }));
    f.onboardingContacts = f.contacts.filter((c) => c.onboarding).map((c) => c.name);
    return f;
  }).sort((a, b) => ((a.start || '9999') < (b.start || '9999') ? -1 : 1));   // oldest first, like the backend
  mockSuggest(queue);
  mockSuggestCsm(queue);
  const rep = (r, role) => Object.assign({ email: r.name.split(' ')[0].toLowerCase() + '@lawmatics.com', role }, r);
  return {
    ok: true, queue, reps: MOCK.reps.map((r) => rep(r, 'IM')), csms: MOCK.csms.map((r) => rep(r, 'CSM')),
    weights: MOCK_WEIGHTS, csmWeights: MOCK_CSM_WEIGHTS, highMin: MOCK.highMin, csmMin: MOCK_CSM_MIN, bands: MOCK.bands,
    recent: MOCK.recent.slice(0, 10),
    stats: { judged: MOCK.recent.length, took: MOCK.recent.filter((l) => l.took === 'TRUE').length },
    canWrite: true, generated: new Date().toISOString(),
  };
}

/* ---------- writes ---------- */
const mockUser = (id) => [...MOCK.reps, ...MOCK.csms].find((r) => r.id === Number(id)) || (Number(id) === MOCK_PARTNER_ID ? MOCK.partner : null);

function mockAssign(b) {
  const f = MOCK.queue.find((x) => x.czId === Number(b.czId));
  if (!f) throw new Error('That test firm was already assigned. Reload to refresh the queue.');
  if (!f.contacts.some((c) => c.onboarding)) throw new Error(`${f.name} has no contact with “Include in Onboarding” turned on. Turn it on for at least one contact in ChurnZero, then refresh. (Test firm: this one is meant to be blocked.)`);
  const im = mockUser(b.userId), csm = b.csmId ? mockUser(b.csmId) : null;
  if (!im) throw new Error('unknown ChurnZero user for the IM');
  const needsCsm = f.mrr > MOCK_CSM_MIN;
  if (needsCsm && !csm) throw new Error(`${f.name} is over $${MOCK_CSM_MIN}/mo, so it needs a CSM too.`);
  const useCsm = needsCsm ? csm : null;
  MOCK.queue = MOCK.queue.filter((x) => x !== f);
  // The rep's load goes up, as it would in ChurnZero.
  const r = MOCK.reps.find((x) => x.id === im.id);
  if (r) { r.open++; r.firms++; r.openMrr += f.mrr; r.mrr += f.mrr; r.lastStart = MOCK_DAY(0); }
  const c = useCsm && MOCK.csms.find((x) => x.id === useCsm.id);
  if (c) { c.firms++; c.lastStart = MOCK_DAY(0); }
  const took = b.suggestedId ? String(Number(b.suggestedId) === im.id && (!useCsm || !b.suggestedCsmId || Number(b.suggestedCsmId) === useCsm.id)).toUpperCase() : '';
  MOCK.recent.unshift({ when: new Date().toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' }).slice(0, 16), by: (typeof AUTH !== 'undefined' && AUTH.email) || 'you',
    firm: f.name, firmId: f.firmId, mrr: String(f.mrr), suggested: b.suggestedName || '', assigned: im.name, userId: im.id, took, confirmed: 'yes',
    suggestedCsm: b.suggestedCsmName || '', csm: useCsm ? useCsm.name : '', csmId: useCsm ? useCsm.id : null, owner: im.name });
  MOCK.open.push({ firmId: f.firmId, name: f.name, mrr: f.mrr, im: im.name, csm: useCsm ? useCsm.name : '', contacts: f.contacts, start: f.start || MOCK_DAY(0) });
  mockSave();
  mockSyncImpl();
  return { ok: true, confirmed: true, owner: im.name, im: im.name, csm: useCsm ? useCsm.name : '' };
}

const MOCK_FIELDS = [
  { key: 'intakeBuilt', section: 'firm', label: 'Implemented intake process', type: 'textarea', required: true, hint: 'What we set up: forms, automations, how leads flow through.' },
  { key: 'painPoints', section: 'firm', label: 'Product pain points', type: 'textarea' },
  { key: 'goal', section: 'firm', label: 'Primary goal with Lawmatics', type: 'text' },
  { key: 'decisionMaker', section: 'firm', label: 'Main decision maker', type: 'contact', required: true, hint: 'Saved as the contact’s Role = Primary Decision Maker.' },
  { key: 'techSavvy', section: 'firm', label: 'Tech savvy score', type: 'scale', required: true, hint: '1 = needs a lot of help · 5 = very comfortable' },
  { key: 'sentiment', section: 'went', label: 'Onboarding sentiment', type: 'choice', options: ['Positive', 'Neutral', 'Negative'], required: true },
  { key: 'openItems', section: 'went', label: 'Open items', type: 'textarea', hint: 'Anything still owed to the firm.' },
  { key: 'bugs', section: 'went', label: 'Outstanding onboarding bugs', type: 'textarea' },
  { key: 'features', section: 'went', label: 'Feature requests', type: 'textarea' },
  { key: 'notes', section: 'went', label: 'Handoff notes', type: 'textarea', required: true, hint: 'Anything else the CSM should know.' },
];
const MOCK_SECTIONS = [{ key: 'firm', label: 'About the firm' }, { key: 'went', label: 'How onboarding went' }];
const MOCK_OUTCOMES = [
  { status: 'Complete', label: 'Complete', form: 'full' },
  { status: 'Complete - Never Engaged', label: 'Complete – never engaged', form: 'none' },
  { status: 'Onboarded by Third Party', label: 'Onboarded by a third party', form: 'none' },
];

// A test firm assigned in this session, or a real open onboarding from the Implementation tab
// (it gets made-up contacts and, if it has no IM / CSM, is treated as a new-model firm with none).
function mockOpenFirm(firmId) {
  const m = MOCK.open.find((x) => x.firmId === String(firmId));
  if (m) return m;
  const row = (IMPL.open || []).find((r) => String(r.FirmId) === String(firmId));
  if (!row) throw new Error('Firm not found in the test data. Reload the page.');
  return { firmId: String(firmId), name: row.Name, mrr: 0, im: row.AccountManager || '', csm: '', real: true,
    contacts: [{ first: 'Test', last: 'Contact', onboarding: true, title: 'Managing Partner' }, { first: 'Second', last: 'Contact', onboarding: false, title: 'Paralegal' }] };
}
const mockContacts = (f) => f.contacts.map((c, i) => ({ id: Number(f.firmId) * 10 + i, name: `${c.first} ${c.last}`, email: `${c.first.toLowerCase()}@example.com`, title: c.title || '', dm: i === 0 && !f.real }));

function mockHandoffStart(b) {
  const f = mockOpenFirm(b.firmId), contacts = mockContacts(f);
  const values = {};
  const dm = contacts.find((c) => c.dm);
  if (dm) values.decisionMaker = String(dm.id);
  return { ok: true, firm: { firmId: f.firmId, name: f.name, mrr: f.mrr, im: f.im, csm: f.csm, owner: f.im, ownerTo: f.csm ? 'csm' : 'support' },
    outcomes: MOCK_OUTCOMES, sections: MOCK_SECTIONS, contacts, values,
    fields: MOCK_FIELDS.map((x) => Object.assign({ options: null, required: false, hint: '', prefillFrom: '', saved: true, existing: true }, x)) };
}

function mockClose(b) {
  const f = mockOpenFirm(b.firmId), contacts = mockContacts(f);
  const outcome = MOCK_OUTCOMES.find((o) => o.status === b.outcome);
  if (!outcome) throw new Error('pick how the onboarding ended');
  const answers = {};
  if (outcome.form === 'full') MOCK_FIELDS.forEach((x) => {
    const v = String((b.answers || {})[x.key] || '').trim();
    if (x.required && !v) throw new Error(x.label + ' is required');
    if (v && x.type !== 'contact') answers[x.key] = v;
  });
  const dm = outcome.form === 'full' ? contacts.find((c) => String(c.id) === String((b.answers || {}).decisionMaker)) : null;
  MOCK.open = MOCK.open.filter((x) => x.firmId !== f.firmId);
  MOCK.completed.unshift({ firmId: f.firmId, name: f.name, mrr: f.mrr, completed: MOCK_DAY(0), outcome: outcome.status, im: f.im, csm: f.csm, am: f.im,
    owner: f.csm || 'Support', closedBy: (typeof AUTH !== 'undefined' && AUTH.email) || 'you',
    decisionMakers: dm ? [{ name: dm.name, title: dm.title, email: dm.email }] : [], answers });
  mockSave();
  CSM.handoffs = null;   // the CSM page picks it up next time it opens
  return { ok: true, confirmed: true, testData: true, outcome: outcome.status, ownerMovedTo: f.csm || 'Support', unsaved: 0 };
}

function mockHandoffs() {
  return { ok: true, days: 7, since: MOCK_DAY(6), sections: MOCK_SECTIONS, fields: MOCK_FIELDS.map(({ key, section, label, type }) => ({ key, section, label, type })),
    firms: MOCK.completed.filter((f) => f.completed >= MOCK_DAY(6)).sort((x, y) => y.completed.localeCompare(x.completed) || x.name.localeCompare(y.name)) };
}

function mockSet(b) {
  if (b.action === 'setRotation') { const r = mockUser(b.userId); if (r) r.included = !!b.included; }
  if (b.action === 'setTier') {
    if (b.userId != null) { const r = MOCK.reps.find((x) => x.id === Number(b.userId)); if (r) r.high = !!b.high; }
    if (b.min != null) { if (!(Number(b.min) >= 0)) throw new Error('enter a dollar amount'); MOCK.highMin = Number(b.min); }
  }
  if (b.action === 'setCsmBands') {
    if (!(b.mid > MOCK_CSM_MIN && b.top > b.mid)) throw new Error(`the top band must start above the middle one, and both above $${MOCK_CSM_MIN}`);
    MOCK.bands = { top: Number(b.top), mid: Number(b.mid) };
  }
  mockSave();
  return mockLoad();
}

// Test firms assigned this session show in the Implementation tab's open onboardings, owned by their IM.
function mockSyncImpl() {
  if (typeof IMPL === 'undefined' || !Array.isArray(IMPL.open)) return;
  IMPL.open = IMPL.open.filter((r) => !r.__mock);
  MOCK.open.forEach((f) => IMPL.open.unshift({ __mock: true, FirmId: f.firmId, Name: f.name, AccountManager: f.im, Specialist: f.im,
    Status: 'Pre-Kickoff', Stage: 'Kickoff', ImplementationType: 'Premium Onboarding', DaysInOnboarding: String(mockDays(f.start)), NextMeeting: '' }));
}

const MOCK_ACTIONS = {
  load: mockLoad, assign: mockAssign, handoffStart: mockHandoffStart, closeOnboarding: mockClose, handoffs: mockHandoffs,
  setRotation: mockSet, setTier: mockSet, setCsmBands: mockSet,
};

if (LOCAL_ENV) {
  if (MOCK_ON) {
    mockLoadState();
    const passFetch = window.fetch;
    window.fetch = async (url, opts = {}) => {
      if (String(url).split('?')[0] === ASSIGN_URL && opts.body) {
        let body = {};
        try { body = JSON.parse(opts.body); } catch (e) { /* not JSON */ }
        const fn = MOCK_ACTIONS[body.action];
        if (fn) {
          await new Promise((r) => setTimeout(r, 350));   // feel like a real request
          let out;
          try { out = fn(body); } catch (e) { out = { ok: false, error: e.message }; }
          return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
        }
      }
      return passFetch(url, opts);
    };
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (MOCK_ON) {
      // Re-add this session's test firms whenever the Implementation data (re)loads (boot.js defines it).
      const passEnsure = window.ensureTabData;
      window.ensureTabData = async (...a) => { const r = await passEnsure(...a); mockSyncImpl(); return r; };
      mockSyncImpl();
    }
    const banner = document.querySelector('.local-banner');
    if (!banner) return;
    if (MOCK_ON) banner.textContent += ' · TEST DATA: New Firm Assignment, Close onboarding and the CSM handoffs are made up';
    const btn = (label, fn) => Object.assign(document.createElement('button'), { type: 'button', className: 'local-banner-btn', textContent: label, onclick: fn });
    banner.append(btn(MOCK_ON ? 'Turn test data off' : 'Use test data', () => { try { localStorage.setItem(MOCK_KEY, MOCK_ON ? 'off' : 'on'); } catch (e) { /* */ } location.reload(); }));
    if (MOCK_ON) banner.append(btn('Reset test data', () => { try { localStorage.removeItem(MOCK_STATE); } catch (e) { /* */ } location.reload(); }));
  });
}
