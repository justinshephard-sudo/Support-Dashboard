/* ==========================================================================
   TEST SITE (100% made-up data). Loaded first, only in the shareable test build
   (tools/build-demo.sh) — never by the live dashboard.
   - No sign-in: "View as" in the yellow banner picks who you are (a manager, an IM or a CSM).
   - Every request is answered here in the browser from a made-up book of firms ("Test – …"),
     so nothing reaches Google, ChurnZero, Chargebee, Slack or the Apps Scripts.
   - New Firm Assignment, Close onboarding and the CSM handoff queue run on js/mock.js.
   - Anything you change lives only in this browser until "Reset test data".
   Rep names are the real team (so testers can view as themselves); firms, contacts and every
   number are invented. Support tab numbers come from js/demo-support.js (shuffled ±20%).
   ========================================================================== */
window.CS_DEMO = true;
(function () {
  // The page may run inside a viewer that blocks confirm/alert pop-ups: confirmations go ahead,
  // alerts show as a short notice at the bottom of the page.
  window.confirm = () => true;
  window.alert = (msg) => {
    const t = document.createElement('div');
    t.className = 'demo-toast'; t.textContent = String(msg);
    document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
  };
  const KEY_AS = 'cs-demo-as', KEY_STATE = 'cs-demo-state';
  const TZ = 'America/Los_Angeles';
  const IMS = ['Callie Burns', 'Andy Galindo', 'Admir Karamovic', 'Swetha Devakumar', 'Max Castro', 'Rosa Flores'];
  const CSMS = ['Elliott Jones', 'Julio Ortiz', 'Jessie Hobbs'];
  const PARTNER = 'Kennedy Wickham';
  const emailOf = (n) => n.split(' ')[0].toLowerCase() + '@lawmatics.com';
  const PERSONAS = [{ email: 'test.manager@lawmatics.com', name: 'Test Manager', label: 'Manager (whole team)' }]
    .concat(IMS.map((n) => ({ email: emailOf(n), name: n, label: n + ' · IM' })))
    .concat(CSMS.map((n) => ({ email: emailOf(n), name: n, label: n + ' · CSM' })))
    .concat([{ email: emailOf(PARTNER), name: PARTNER, label: PARTNER + ' · partner firms' }]);
  const persona = () => { let e = ''; try { e = localStorage.getItem(KEY_AS) || ''; } catch (x) { /* */ } return PERSONAS.find((p) => p.email === e) || PERSONAS[0]; };
  window.DEMO_PERSONA = persona;

  // Changes testers make that aren't in js/mock.js: exclusions.
  let ST = {};
  try { ST = JSON.parse(localStorage.getItem(KEY_STATE) || '{}') || {}; } catch (e) { ST = {}; }
  ST.excluded = ST.excluded || [];
  const saveSt = () => { try { localStorage.setItem(KEY_STATE, JSON.stringify(ST)); } catch (e) { /* */ } };
  window.DEMO_RESET = () => { try { [KEY_STATE, 'cs-mock-state', 'cs-demo-automations', 'cs-demo-automations-v2', 'cs-demo-reports', 'cs-demo-tasks', 'cs-demo-notes'].forEach((k) => localStorage.removeItem(k)); sessionStorage.clear(); } catch (e) { /* */ } location.reload(); };

  /* ---------- deterministic made-up book ---------- */
  let seed = 20261117;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const now = new Date();
  const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
  const today = ymd(now);
  const dayOff = (n) => ymd(new Date(now.getTime() - n * 864e5));
  const ymOf = (d) => d.slice(0, 7);
  const addYm = (ym, n) => { const y = +ym.slice(0, 4), m = +ym.slice(5) - 1 + n; const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; return yy + '-' + String(mm + 1).padStart(2, '0'); };
  const curYm = ymOf(today);
  const label = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 15).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const SUR = ['Whitaker', 'Delgado', 'Brennan', 'Okafor', 'Lindqvist', 'Marchetti', 'Haddad', 'Castellanos', 'Pemberton', 'Nakamura', 'Ashford', 'Valdez',
    'Kowalski', 'Rourke', 'Sandoval', 'Fairbanks', 'Thornton', 'Iverson', 'Molina', 'Prescott', 'Galloway', 'Bianchi', 'Underwood', 'Harlow', 'Quinlan',
    'Esposito', 'Calloway', 'Ferreira', 'Langston', 'Mercado', 'Holloway', 'Abernathy', 'Navarro', 'Sterling', 'Whitfield', 'Ocampo', 'Kensington',
    'Bradford', 'Montoya', 'Hargrove', 'Linwood', 'Rasmussen', 'Townsend', 'Villalobos', 'Winslow', 'Yardley', 'Zamora', 'Beaumont', 'Corrigan', 'Dunmore'];
  const PLACE = ['Harbor Point', 'Ridgeway', 'Cedar & Stone', 'Blue Mesa', 'Oakline', 'Summit', 'Northgate', 'Lakeside', 'Pinecrest', 'Riverbend', 'Granite',
    'Willow Creek', 'Ironwood', 'Silverlake', 'Bayview', 'Copper Hill', 'Eastbrook', 'Maple Grove', 'Redstone', 'Westfield'];
  const KIND = [['Injury Law', 'Personal Injury'], ['Family Law', 'Family Law'], ['Estate Planning', 'Estate Planning'], ['Immigration Group', 'Immigration'],
    ['Criminal Defense', 'Criminal Defense'], ['Bankruptcy', 'Bankruptcy'], ['Employment Law', 'Employment'], ['Elder Law', 'Elder Law'],
    ['Law Group', 'Personal Injury'], ['Legal', 'Family Law'], ['& Associates', 'Estate Planning'], ['Trial Lawyers', 'Personal Injury']];
  const CITY = ['Austin, TX', 'Denver, CO', 'Tampa, FL', 'Phoenix, AZ', 'Columbus, OH', 'Raleigh, NC', 'Boise, ID', 'Sacramento, CA', 'Nashville, TN', 'Omaha, NE'];
  const STAGES = ['Needs to Schedule', 'First Onboarding', 'Second Onboarding', 'Third Onboarding', 'Fourth Onboarding', 'Fifth Onboarding', 'Sixth Onboarding'];
  const COMMENTS = ['Super helpful, walked us through every automation.', 'Great onboarding, very patient with our questions.', 'Good, but scheduling took a while.',
    'Loved the intake form setup!', 'Would like more help with reporting.', 'Fast and friendly.', 'A bit rushed at the end.', 'Exactly what we needed.'];

  const used = new Set();
  const firmName = (kind) => {
    for (let i = 0; i < 50; i++) {
      const n = 'Test – ' + (rnd() < 0.55 ? pick(SUR) : pick(PLACE)) + ' ' + kind;
      if (!used.has(n)) { used.add(n); return n; }
    }
    return 'Test – Firm ' + used.size;
  };
  const mrrDraw = () => { const r = rnd(); return Math.round(r < 0.45 ? int(99, 399) : r < 0.75 ? int(400, 849) : r < 0.93 ? int(850, 1600) : int(1601, 3200)); };
  const csmFor = (mrr) => (mrr <= 400 ? '' : mrr >= 850 ? pick(['Elliott Jones', 'Elliott Jones', 'Julio Ortiz']) : mrr >= 550 ? pick(['Julio Ortiz', 'Julio Ortiz', 'Jessie Hobbs']) : 'Jessie Hobbs');

  const FIRMS = [];
  for (let i = 0; i < 260; i++) {
    const [kind, area] = pick(KIND);
    const age = i < 34 ? int(2, 95) : int(96, 980);   // the first ~34 are still onboarding
    const signup = dayOff(age);
    const start = mrrDraw();
    const partner = rnd() < 0.08;
    const im = partner ? PARTNER : pick(IMS.slice(0, age < 120 ? 6 : 4));
    const csm = partner ? PARTNER : csmFor(start);
    const onboarding = age <= 95 && i < 34;
    const cancelled = !onboarding && rnd() < 0.13;
    const cancelDay = cancelled ? dayOff(int(5, Math.max(10, age - 40))) : '';
    let mrr = start;
    const changes = [];   // [date, amount, cat, ai]
    if (!onboarding) {
      const n = int(0, 3);
      for (let k = 0; k < n; k++) {
        const d = dayOff(int(5, Math.max(6, age - 30)));
        const up = rnd() < 0.68, ai = up && rnd() < 0.35 ? pick([149, 249, 399]) : 0;
        const amt = up ? (ai || int(25, 260)) : -Math.min(mrr - 49, int(20, 180));
        if (cancelled && d >= cancelDay) continue;
        mrr += amt; changes.push([d, amt, up ? 'u' : 'd', ai]);
      }
    }
    if (cancelled) changes.push([cancelDay, -mrr, 'c', 0]);
    const doneDay = onboarding ? '' : i < 52 ? dayOff(int(0, 25)) : dayOff(Math.max(0, age - int(25, 85)));
    FIRMS.push({
      i, id: String(80001 + i), name: firmName(kind), area, city: pick(CITY), signup, start, mrr: cancelled ? 0 : mrr, changes: changes.sort((a, b) => a[0].localeCompare(b[0])),
      im, csm, owner: onboarding ? im : (csm || 'Support'), partner, cancelled, cancelDay, onboarding, doneDay,
      status: onboarding ? (age < 12 ? 'Pre-Kickoff' : 'Open') : 'Complete',
      stage: onboarding ? (age < 12 ? 'Needs to Schedule' : STAGES[Math.min(STAGES.length - 1, 1 + Math.floor(age / 15))]) : '',
      next: onboarding && rnd() < 0.7 ? dayOff(-int(1, 14)) : '',
      lastEmail: onboarding ? dayOff(int(0, 24)) : '',
      score: Math.round(Math.min(98, Math.max(4, (rnd() * rnd()) * 100 + (cancelled ? 40 : 0)))),
      onbDays: onboarding ? age : int(22, 75),
      csat: !onboarding && rnd() < 0.55 ? (rnd() < 0.8 ? 5 : rnd() < 0.6 ? 4 : 3) : 0,
      ai: !onboarding && !cancelled && rnd() < 0.3 ? { quota: pick([50, 100, 200, 500]), used: 0 } : null,
      annual: rnd() < 0.3, overdue: !cancelled && rnd() < 0.05,
    });
  }
  FIRMS.forEach((f) => { if (f.ai) f.ai.used = Math.round(f.ai.quota * (rnd() < 0.45 ? 0 : rnd() * 1.4)); });
  const live = () => FIRMS.filter((f) => !f.cancelled);
  const closedIds = () => new Set((typeof MOCK !== 'undefined' && MOCK && MOCK.closedIds) || []);
  const isOpen = (f) => f.onboarding && !closedIds().has(f.id);
  const exclIds = () => new Set(ST.excluded.map((x) => x.id));
  window.DEMO_FIRM = (id) => FIRMS.find((f) => f.id === String(id));
  window.DEMO_FIRMS = () => FIRMS;

  /* ---------- sheet tabs ---------- */
  const SUP = window.DEMO_SUPPORT || {};
  const CZ_COLUMNS = ['Name', 'FirmId', 'PracticeArea', 'AccountManager', 'MRR', 'TotalContract', 'ChargebeeStatus', 'ContractStatus', 'TermEnd', 'RemainingCycles',
    'Licenses', 'ChurnScore', 'UsageFrequency', 'DangerZone', 'CancellationRequested', 'CSAT60', 'TenureDays', 'MattersPerMonth', 'LeadVolume', 'TotalSms',
    'SmsPlanType', 'Activities30', 'Employees', 'Contacts', 'OnboardingStatus', 'City', 'Website', 'ChargebeePlan', 'ChargebeeStart', 'AddOns', 'InvoiceBalance',
    'LegacyContract', 'MRRSource', 'ChurnCategory', 'ChurnDetails', 'AvgLeadsMonthly', 'ImplementationManager', 'CustomerSuccessManager', 'OnboardingCompletedDate',
    'Overdue', 'ContractEnd', 'NonRenewing'];
  function accountsTab() {
    const rows = FIRMS.map((f) => {
      const o = {
        Name: f.name, FirmId: f.id, PracticeArea: f.area, AccountManager: isOpen(f) ? f.im : (f.csm || 'Support'), MRR: f.mrr.toFixed(2),
        TotalContract: (f.mrr * 12).toFixed(2), ChargebeeStatus: f.cancelled ? 'cancelled' : 'active', ContractStatus: f.cancelled ? 'Inactive' : 'Active',
        TermEnd: dayOff(-int(5, 300)), RemainingCycles: String(int(1, 12)), Licenses: String(Math.max(1, Math.round(f.start / 110))), ChurnScore: String(f.score),
        UsageFrequency: pick(['Daily', 'Weekly', 'Monthly']), DangerZone: f.score > 80 ? 'Yes' : 'No', CancellationRequested: f.score > 90 ? 'Yes' : 'No',
        CSAT60: f.csat ? String(f.csat) : '', TenureDays: String(Math.round((now - new Date(f.signup)) / 864e5)), MattersPerMonth: String(int(2, 60)),
        LeadVolume: String(int(5, 400)), TotalSms: String(int(0, 3000)), SmsPlanType: pick(['Standard', 'Pro', '']), Activities30: String(int(0, 900)),
        Employees: String(int(1, 40)), Contacts: String(int(50, 9000)), OnboardingStatus: isOpen(f) ? f.status : 'Complete', City: f.city,
        Website: 'https://example.com', ChargebeePlan: pick(['Pro', 'Premium', 'Growth']) + (f.annual ? ' (Annual)' : ' (Monthly)'), ChargebeeStart: f.signup,
        AddOns: f.ai ? `AI credits (${f.ai.quota}/mo)` : '', InvoiceBalance: f.overdue ? String(int(150, 900)) : '0', LegacyContract: '', MRRSource: 'Chargebee',
        ChurnCategory: f.cancelled ? pick(['Price', 'Switched tools', 'Closed practice']) : '', ChurnDetails: '', AvgLeadsMonthly: String(int(5, 300)),
        ImplementationManager: f.im, CustomerSuccessManager: f.csm, OnboardingCompletedDate: isOpen(f) ? '' : f.doneDay,
        Overdue: f.overdue ? `${int(150, 900)}|1|${dayOff(int(8, 40))}` : '', ContractEnd: f.annual && !f.cancelled ? dayOff(-int(3, 330)) : '', NonRenewing: f.annual && f.score > 75 ? 'Yes' : '',
      };
      return CZ_COLUMNS.map((c) => o[c] == null ? '' : String(o[c]));
    });
    return [CZ_COLUMNS].concat(rows);
  }
  function implOpenTab() {
    const hdr = ['Name', 'FirmId', 'Status', 'Stage', 'Specialist', 'AccountManager', 'DaysInOnboarding', 'NextMeeting', 'ImplementationType', 'Excluded', 'LastEmail', 'LastCustomerEmail'];
    const ex = exclIds();
    const fmt = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
    return [hdr].concat(FIRMS.filter(isOpen).map((f) => [f.name, f.id, f.status, f.stage, f.im, f.im, String(f.onbDays), fmt(f.next),
      f.start >= 850 ? 'Premium Onboarding' : 'Standard Onboarding', ex.has(f.id) ? '1' : '', f.lastEmail, f.lastEmail && rnd() < 0.6 ? f.lastEmail : '']));
  }
  function implEvents() {
    const hdr = ['Type', 'Month', 'Date', 'Name', 'FirmId', 'AccountManager', 'Specialist', 'Days', 'Score', 'Comment', 'Excluded'];
    const ex = exclIds(), from = addYm(curYm, -12), rows = [];
    FIRMS.forEach((f) => {
      if (!f.doneDay || ymOf(f.doneDay) < from) return;
      const x = ex.has(f.id) ? '1' : '';
      rows.push(['closed', label(ymOf(f.doneDay)), f.doneDay, f.name, f.id, f.im, f.im, String(f.onbDays), '', '', x]);
      if (f.csat) rows.push(['csat', label(ymOf(f.doneDay)), f.doneDay, f.name, f.id, f.im, f.im, '', String(f.csat), f.csat >= 4 ? pick(COMMENTS) : 'Scheduling took a while.', x]);
    });
    rows.sort((a, b) => b[2].localeCompare(a[2]));
    return [hdr].concat(rows);
  }
  function implMonthly() {
    const hdr = ['Month', 'OpenOnboardings', 'PreKickoff', 'OpenStatus', 'NeedsScheduling', 'Over70', 'ClosedOnboardings', 'MedianDays', 'CsatPct', 'CsatResponses', 'StageCounts', 'UpdatedAt', 'RepStats'];
    const ex = exclIds(), rows = [];
    const med = (a) => { if (!a.length) return ''; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    for (let k = 12; k >= 0; k--) {
      const ym = addYm(curYm, -k), cur = k === 0;
      const done = FIRMS.filter((f) => f.doneDay && ymOf(f.doneDay) === ym && !ex.has(f.id));
      const reps = {};
      const rep = (n) => (reps[n] = reps[n] || {});
      done.forEach((f) => { const r = rep(f.im); r.closed = (r.closed || 0) + 1; (r._d = r._d || []).push(f.onbDays); if (f.csat) { r.csatN = (r.csatN || 0) + 1; r._p = (r._p || 0) + (f.csat >= 4 ? 1 : 0); } });
      let open = 0, pre = 0, needs = 0, over = 0; const stages = {};
      if (cur) {
        FIRMS.filter((f) => isOpen(f) && !ex.has(f.id)).forEach((f) => {
          const r = rep(f.im); open++; r.open = (r.open || 0) + 1; stages[f.stage] = (stages[f.stage] || 0) + 1; (r.stages = r.stages || {})[f.stage] = (r.stages[f.stage] || 0) + 1;
          if (f.status === 'Pre-Kickoff') { pre++; r.preKick = (r.preKick || 0) + 1; }
          if (!f.next) { needs++; r.needsSched = (r.needsSched || 0) + 1; }
          if (f.onbDays >= 70) { over++; r.over70 = (r.over70 || 0) + 1; }
        });
      } else {
        IMS.slice(0, 4).forEach((n) => { const r = rep(n); r.open = int(4, 14); r.preKick = int(0, 3); r.needsSched = int(0, 4); r.over70 = int(0, 3); open += r.open; pre += r.preKick; needs += r.needsSched; over += r.over70; });
      }
      Object.values(reps).forEach((r) => { if (r._d) r.medianDays = med(r._d); if (r.csatN) r.csatPct = Math.round((r._p / r.csatN) * 1000) / 10; delete r._d; delete r._p; });
      const cs = done.filter((f) => f.csat);
      rows.push([label(ym), String(open), String(pre), String(open - pre), String(needs), String(over), String(done.length), String(med(done.map((f) => f.onbDays))),
        cs.length ? String(Math.round((cs.filter((f) => f.csat >= 4).length / cs.length) * 1000) / 10) : '', String(cs.length), cur ? JSON.stringify(stages) : '',
        cur ? now.toISOString() : '', JSON.stringify(reps)]);
    }
    return [hdr].concat(rows);
  }
  function excludedTab() {
    return [['Firm ID', 'Firm', 'Scope', 'Reason', 'By', 'At']].concat(ST.excluded.map((x) => [x.id, x.firm, x.scope, x.reason, x.by, x.at]));
  }
  const nowStr = () => new Date().toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16);
  function tab(sheetId, title) {
    switch (title) {
      case 'Accounts': return accountsTab();
      case 'Impl - Open Firms': return implOpenTab();
      case 'Impl - Firm Events': return implEvents();
      case 'Impl - Monthly': return implMonthly();
      case 'Excluded Firms': return excludedTab();
      case 'Dashboard Config': return [['Manager emails'], ['test.manager@lawmatics.com']];
      case 'Sync Status': return [['Sync', 'Last success', 'Last run', 'Result', 'Steps', 'Rows', 'Error']].concat(
        ['Accounts (Firm Lookup)', 'Implementation', 'Accounts', 'ChurnZero'].map((n) => [n, nowStr(), nowStr(), 'OK', '', '', '']));
      default:
        if (SUP[title]) return SUP[title];
        return [];
    }
  }

  /* ---------- MRR / CSM backend ---------- */
  const repOf = (f) => (f.csm || (f.onboarding ? f.im : 'Support'));
  function mrrAt(f, ym) {   // MRR at the end of a month
    if (ymOf(f.signup) > ym) return 0;
    let m = f.start;
    f.changes.forEach(([d, amt]) => { if (ymOf(d) <= ym) m += amt; });
    return Math.max(0, Math.round(m * 100) / 100);
  }
  function csmPayload() {
    const ex = exclIds();
    const checkpoint = addYm(curYm, -1);
    const first = addYm(curYm, -30);
    const firms = FIRMS.filter((f) => !ex.has(f.id)).map((f) => {
      const s = ymOf(f.signup) < first ? first : ymOf(f.signup);
      const monthly = []; for (let ym = s; ym <= curYm; ym = addYm(ym, 1)) monthly.push(mrrAt(f, ym));
      return [f.name, repOf(f), s, mrrAt(f, s) || f.start, mrrAt(f, checkpoint), f.mrr, f.id, monthly];
    });
    const flags = (f) => [f.score > 90 ? 'cancel' : '', f.annual && f.score > 75 ? 'nonrenew' : '', f.overdue ? 'overdue' : ''].filter(Boolean).join(',');
    const accounts = live().filter((f) => !ex.has(f.id) && repOf(f) !== 'Support').map((f) => [f.name, repOf(f), f.score, f.mrr, f.id, isOpen(f) ? '' : f.doneDay,
      f.annual ? dayOff(-int(3, 330)) : '', flags(f)]);
    const months = {};
    FIRMS.forEach((f) => {
      if (ex.has(f.id)) return;
      const rep = repOf(f);
      const add = (ym, amt, cat, ai) => {
        if (ym < addYm(curYm, -13)) return;
        const t = ((months[rep] = months[rep] || {})[ym] = months[rep][ym] || [0, 0, 0, 0, 0]);
        t[0] += amt; t[2]++; if (cat === 'u' || cat === 'r') t[1] += amt; if (ai > 0) t[3] += ai; else if (ai < 0) t[4] += ai;
      };
      add(ymOf(f.signup), f.start, 'n', 0);
      f.changes.forEach(([d, amt, cat, ai]) => add(ymOf(d), amt, cat, ai));
    });
    const ai = live().filter((f) => f.ai && !isOpen(f) && !ex.has(f.id)).map((f) => [f.name, repOf(f), Math.round(f.ai.used / f.ai.quota * 100), int(5, 400),
      f.ai.used, 0, f.ai.used, { 50: 149, 100: 249, 200: 399, 500: 749 }[f.ai.quota], f.id, f.ai.quota]);
    return {
      ok: true, built: Date.now(),
      history: { now: curYm, checkpoint, cohort6: addYm(checkpoint, -6), cohort13: addYm(checkpoint, -13), first, firms },
      health: { bad: 67, good: 33, accounts, hasDone: true, hasRenewals: true },
      months, ai: { bad: 25, good: 75, asOf: now.toISOString(), firms: ai }, excluded: [...ex], x: {},
    };
  }
  function mrrLoad() {
    const EF = ['ym', 'cat', 'amt', 'company', 'am', 'owner', 'firm', 'date', 'created', 'notPaid', 'agency', 'leads', 'src', 'ai'];
    const SF = ['date', 'company', 'firm', 'mrr', 'agency', 'owner', 'am', 'leads', 'created'];
    const ev = [];
    FIRMS.forEach((f) => {
      const rep = repOf(f);
      if (f.signup >= dayOff(400)) ev.push([ymOf(f.signup), 'n', f.start, f.name, rep, f.owner, f.id, f.signup, f.signup, 0, 0, int(5, 300), 'Inbound', 0]);
      f.changes.forEach(([d, amt, cat, ai]) => { if (d >= dayOff(400)) ev.push([ymOf(d), cat, amt, f.name, rep, f.owner, f.id, d, f.signup, 0, 0, int(5, 300), '', ai]); });
    });
    const sched = live().filter((f) => f.score > 92).slice(0, 4).map((f) => [dayOff(-int(5, 40)), f.name, f.id, f.mrr, 0, f.owner, repOf(f), int(5, 200), f.signup]);
    const snapshots = {};
    for (let k = 14; k >= 0; k--) { const ym = addYm(curYm, -k); const act = FIRMS.filter((f) => mrrAt(f, ym) > 0); snapshots[ym] = [Math.round(act.reduce((t, f) => t + mrrAt(f, ym), 0)), act.length]; }
    return { ok: true, built: Date.now(), today, synced: now.toISOString(), sync: { lastSuccess: nowStr(), lastRun: nowStr(), result: 'OK', failed: false, partial: false, steps: [] },
      liveFrom: dayOff(90), events: { fields: EF, rows: ev }, scheduled: { fields: SF, rows: sched }, sf: {}, retention: { rate: [], detail: [], am: [] }, snapshots };
  }

  /* ---------- Partnerships: agency, agency-client and affiliate firms with made-up referral partners ---------- */
  function partnersPayload() {
    const PARTNERS = ['Test – Summit Legal Marketing', 'Test – LexGrowth Partners', 'Test – Bright Path Advisors', 'Test – Counsel Collective', 'Test – Harbor Digital'];
    let s2 = 4242;
    const r2 = () => { s2 = (s2 * 9301 + 49297) % 233280; return s2 / 233280; };
    const firms = FIRMS.filter((f, i) => f.partner || i % 9 === 0).slice(0, 48).map((f, i) => {
      const kind = i % 7 === 0 ? 'agency' : i % 3 === 0 ? 'affiliate' : 'client';
      return { czId: 900000 + f.i, id: f.id, name: f.name, partner: kind === 'agency' ? '' : PARTNERS[Math.floor(r2() * PARTNERS.length)],
        type: kind === 'affiliate' ? 'Affiliate' : '', agency: kind === 'agency', agencyClient: kind === 'client', start: f.signup, mrr: f.mrr || f.start,
        active: !f.cancelled, onboarding: isOpen(f) ? f.status : 'Complete', partnerFrom: r2() < 0.15 ? 'chargebee' : '' };
    });
    return { ok: true, firms, built: Date.now() };
  }

  /* ---------- calendars: each rep's week of made-up meetings ---------- */
  function calendarItems(email, url) {
    const q = new URL(url).searchParams;
    const t0 = new Date(q.get('timeMin') || now), t1 = new Date(q.get('timeMax') || new Date(now.getTime() + 7 * 864e5));
    const who = IMS.concat(CSMS, [PARTNER]).find((n) => emailOf(n) === email);
    if (!who) return [];
    const mine = FIRMS.filter((f) => (CSMS.includes(who) ? f.csm === who && !isOpen(f) : f.im === who && isOpen(f)) && !f.cancelled);
    const items = [];
    const days = []; for (let d = new Date(t0); d < t1; d = new Date(d.getTime() + 864e5)) if (d.getDay() % 6) days.push(new Date(d));
    let k = 0;
    days.forEach((d, di) => {
      const n = 1 + ((di + who.length) % 3);
      for (let j = 0; j < n && mine.length; j++) {
        const f = mine[(k++ * 7 + who.length) % mine.length];
        const st = new Date(d); st.setHours(9 + ((j * 3 + di) % 7), j % 2 ? 30 : 0, 0, 0);
        const en = new Date(st.getTime() + (CSMS.includes(who) ? 30 : 60) * 60000);
        const kind = CSMS.includes(who) ? pick(['Check-in', 'Quarterly review', 'Success call']) : pick(['First Onboarding', 'Second Onboarding', 'Onboarding']);
        items.push({ id: 'ev' + f.id + di + j, summary: `${kind} – ${f.name}`, status: 'confirmed', eventType: 'default', htmlLink: '',
          start: { dateTime: st.toISOString() }, end: { dateTime: en.toISOString() },
          attendees: [{ email, responseStatus: 'accepted' }, { email: 'client' + f.id + '@example.com', responseStatus: 'accepted' }] });
      }
      if (di === 1) { const st = new Date(d); st.setHours(15, 0, 0, 0); items.push({ id: 'team' + di, summary: 'CS team sync', status: 'confirmed', eventType: 'default', start: { dateTime: st.toISOString() }, end: { dateTime: new Date(st.getTime() + 30 * 60000).toISOString() }, attendees: [{ email, responseStatus: 'accepted' }] }); }
    });
    return items;
  }

  /* ---------- request router ---------- */
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  const notHere = (what) => ({ ok: false, error: `${what} isn’t part of the test site.` });
  const nothingSaved = { ok: false, error: 'Test site: that isn’t saved anywhere.' };
  function scriptCall(url, b) {
    const a = b.action || '';
    if (a === 'csm') return csmPayload();
    if (a === 'load' && typeof MRR_URL !== 'undefined' && url === MRR_URL) return mrrLoad();
    if (a === 'exclude' || a === 'unexclude') {
      ST.excluded = ST.excluded.filter((x) => x.id !== String(b.firmId));
      if (a === 'exclude') ST.excluded.push({ id: String(b.firmId), firm: b.firm || '', scope: b.scope || 'Both', reason: b.reason || '', by: persona().email, at: nowStr() });
      saveSt();
      sessionStorage.clear();
      return { ok: true };
    }
    if (a === 'resyncImpl') return { ok: true };
    if (a === 'partners') return partnersPayload();
    if (a === 'closeThirdParty') return { ok: true, testData: true };
    if (a === 'calendarMatch') return { ok: true, reps: Object.fromEntries(IMS.concat(CSMS, [PARTNER]).map((n) => [n, emailOf(n)])) };
    if (/^(bug|fr)/.test(a) || a === 'load' || a === 'page') return notHere('Shortcut, Notion and Loop Tracker data');
    if (/prep|audit/i.test(a)) return notHere('Call prep and audits');
    if (typeof SCORECARDS_URL !== 'undefined' && url === SCORECARDS_URL) return notHere('Scorecards');
    return nothingSaved;
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const url = String(input && input.url || input);
    await new Promise((r) => setTimeout(r, 120));
    const sheet = url.match(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/?]+)(\/values\/([^?]+))?/);
    if (sheet) {
      if (!sheet[3]) return json({ sheets: [] });
      let t = decodeURIComponent(sheet[3]);
      t = t.replace(/^'(.*)'(!.*)?$/, '$1').replace(/''/g, "'");
      return json({ values: tab(sheet[1], t) });
    }
    if (/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      let b = {};
      try { b = JSON.parse(opts.body || '{}'); } catch (e) { /* */ }
      return json(scriptCall(url.split('?')[0], b));
    }
    if (/googleapis\.com\/calendar\/v3\/freeBusy/.test(url)) {
      let b = {}; try { b = JSON.parse(opts.body || '{}'); } catch (e) { /* */ }
      return json({ calendars: Object.fromEntries((b.items || []).map((x) => [x.id, { busy: [], errors: [] }])) });
    }
    const cal = url.match(/googleapis\.com\/calendar\/v3\/calendars\/([^/]+)\/events/);
    if (cal) return json({ items: calendarItems(decodeURIComponent(cal[1]).toLowerCase(), url) });
    if (/googleapis\.com\/calendar/.test(url)) return json({ items: [] });
    if (/googleapis\.com\/oauth2/.test(url)) return json({ email: persona().email, name: persona().name });
    if (/googleapis\.com|notion|shortcut|chargebee|churnzero|zapier/i.test(url)) return json({ files: [], items: [], values: [] });
    return realFetch(input, opts);   // the page's own files (css, js, images)
  };

  /* ---------- banner ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.className = 'local-banner demo-banner';
    const p = persona();
    b.innerHTML = `<b>TEST SITE</b> · every firm and number is made up · nothing you do is saved outside this browser
      <label class="demo-as">View as <select id="demoAs">${PERSONAS.map((x) => `<option value="${x.email}"${x.email === p.email ? ' selected' : ''}>${x.label}</option>`).join('')}</select></label>`;
    const reset = Object.assign(document.createElement('button'), { type: 'button', className: 'local-banner-btn', textContent: 'Reset test data', title: 'Put all the test data back the way it started', onclick: () => window.DEMO_RESET() });
    b.append(reset);
    document.body.prepend(b);
    b.querySelector('#demoAs').addEventListener('change', (e) => {
      try { localStorage.setItem(KEY_AS, e.target.value); sessionStorage.clear(); } catch (x) { /* */ }
      location.reload();
    });
  });
})();
