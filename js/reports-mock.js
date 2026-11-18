/* ==========================================================================
   Reports — MOCKUP for the test site only (tools/build-demo.sh loads it).
   The CS Dashboard's own report builder (replacing ChurnZero segments, churn-score views and reports),
   running on its own database: saved reports (shared with the team or private), a builder
   (source → columns → filters → group by → measure → chart), CSV export, and a firm drill-in
   that explains the churn score factor by factor with 12 months of usage.
   Every number is made up from the test site's firms. Saved reports live in this browser only.
   ========================================================================== */
(function () {
  if (!window.CS_DEMO) return;
  const KEY = 'cs-demo-reports';
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const DAY = 864e5;
  const iso = (d) => d.toISOString().slice(0, 10);
  const dOff = (n) => iso(new Date(Date.now() - n * DAY));
  const daysSince = (d) => (d ? Math.round((Date.now() - new Date(d + 'T12:00:00')) / DAY) : null);
  const money = (n) => '$' + Math.round(n).toLocaleString();
  const MONTHS = (() => { const out = []; const d = new Date(); d.setDate(1); for (let i = 11; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')); } return out; })();
  const monthLabel = (k) => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString([], { month: 'short', year: '2-digit' }); };
  function rng(s) { s = s % 2147483647 || 7; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  /* ---------- the made-up database ---------- */
  const AUTOS = ['Low adoption check-in', 'Missed onboarding call → reschedule', 'Onboarding follow-up after each call', 'Renewal in 90 days', 'SMS overage notice', 'NPS detractor follow-up', 'Positive CSAT → G2 review'];
  let DATA = null;
  function data() {
    if (DATA) return DATA;
    const R = rng(4242);
    const int = (a, b) => a + Math.floor(R() * (b - a + 1));
    const pick = (a) => a[Math.floor(R() * a.length)];
    const firms = [], usage = [], calls = [], emails = [], runs = [];
    (window.DEMO_FIRMS ? window.DEMO_FIRMS() : []).forEach((f) => {
      const status = f.cancelled ? 'Cancelled' : f.onboarding ? 'Onboarding' : 'Active';
      // Churn score = risk points from 4 factors (25 each). Lower is healthier.
      const w = [R(), R(), R(), R()]; const ws = w.reduce((a, b) => a + b, 0) || 1;
      let pts = w.map((x) => Math.min(25, Math.round((x / ws) * f.score)));
      let diff = f.score - pts.reduce((a, b) => a + b, 0);
      for (let i = 0; diff !== 0 && i < 40; i++) { const k = i % 4; if (diff > 0 && pts[k] < 25) { pts[k]++; diff--; } else if (diff < 0 && pts[k] > 0) { pts[k]--; diff++; } }
      const fac = { matters: Math.round(14 - pts[0] / 25 * 13), minutes: Math.round(75 - pts[1] / 25 * 70), msgs: Math.max(0, Math.round(5 - pts[2] / 25 * 5)), csat: +(5 - pts[3] / 25 * 2.6).toFixed(1) };
      const sd = new Date(f.signup + 'T12:00:00'); const ren = new Date(sd); while (ren < new Date()) ren.setFullYear(ren.getFullYear() + 1);
      const band = f.score < 33 ? 'Healthy' : f.score < 67 ? 'Watch' : 'At risk';
      const lastEmail = f.lastEmail || dOff(int(1, 120));
      const row = {
        id: f.id, firm: f.name, status, stage: f.onboarding ? f.stage : '', area: f.area, city: f.city, im: f.im, csm: f.csm || 'Support', owner: f.owner,
        mrr: f.mrr, signup: f.signup, renewal: f.cancelled ? '' : iso(ren), score: f.score, band,
        aiPct: f.ai ? Math.round(f.ai.used / f.ai.quota * 100) : null, lastEmail, emailDays: daysSince(lastEmail),
        nextCall: f.next || (status === 'Active' && R() < 0.3 ? dOff(-int(2, 40)) : ''), csat: f.csat || null, billing: f.annual ? 'Annual' : 'Monthly', overdue: f.overdue ? 'Yes' : 'No',
        _pts: pts, _fac: fac,
      };
      firms.push(row);
      // Monthly usage (from Segment, rolled up nightly). Size follows MRR; risky firms fade.
      const size = Math.max(0.3, (f.mrr || f.start) / 400);
      const fade = f.score > 66 ? -0.06 : f.score < 33 ? 0.02 : -0.01;
      const startM = f.signup.slice(0, 7), endM = f.cancelled ? f.cancelDay.slice(0, 7) : '9999';
      MONTHS.forEach((m, i) => {
        if (m < startM || m > endM) return;
        const t = Math.max(0.05, 1 + fade * (i - 11)) * (0.94 + R() * 0.12) * (m === startM ? 0.5 : 1);
        usage.push({ id: f.id, firm: f.name, csm: row.csm, im: row.im, status, month: m,
          logins: Math.round(60 * size * t), matters: Math.round(42 * size * t), contacts: Math.round(95 * size * t),
          sms: Math.round((R() < 0.6 ? 380 : 40) * size * t), ai: f.ai ? Math.round(f.ai.used * (0.7 + R() * 0.6)) : 0, minutes: Math.round(260 * size * t) });
      });
      // Calls in the last 180 days
      const nCalls = f.onboarding ? int(1, 6) : int(0, 3);
      for (let k = 0; k < nCalls; k++) {
        const d = int(1, f.onboarding ? 90 : 180);
        const type = f.onboarding ? pick(['First Onboarding', 'Second Onboarding', 'Third Onboarding', 'Fourth Onboarding']) : pick(['Check-in', 'Check-in', 'Renewal review', 'Merlin walkthrough']);
        const out = R() < 0.14 ? 'Missed' : R() < 0.1 ? 'Rescheduled' : 'Completed';
        calls.push({ id: f.id, firm: f.name, date: dOff(d), rep: f.onboarding ? f.im : row.csm, type, outcome: out, minutes: out === 'Completed' ? int(20, 60) : 0 });
      }
      // Emails in the last 180 days (Gmail sync)
      const nE = int(0, f.onboarding ? 12 : 6);
      for (let k = 0; k < nE; k++) {
        const out = R() < 0.6;
        emails.push({ id: f.id, firm: f.name, date: dOff(int(0, 180)), rep: f.onboarding ? f.im : row.csm, direction: out ? 'Sent' : 'Received', replied: out ? (R() < 0.45 ? 'Yes' : 'No') : '—' });
      }
      // Automation runs in the last 90 days
      if (R() < 0.55) {
        const a = f.onboarding ? pick(AUTOS.slice(1, 3)) : pick(AUTOS);
        runs.push({ id: f.id, firm: f.name, automation: a, entered: dOff(int(0, 90)), rep: row.owner, status: pick(['Running', 'Finished', 'Finished', 'Exited']) });
      }
    });
    DATA = { firms, usage, calls, emails, runs };
    return DATA;
  }

  /* ---------- sources and fields ---------- */
  // type: text | enum | num | money | pct | date | month
  const SOURCES = {
    firms: { label: 'Firms', icon: '🏢', desc: 'One row per firm', fields: {
      firm: ['Firm', 'text'], status: ['Status', 'enum'], stage: ['Onboarding stage', 'enum'], area: ['Practice area', 'enum'], city: ['City', 'enum'],
      im: ['IM', 'enum'], csm: ['CSM', 'enum'], mrr: ['MRR', 'money'], score: ['Churn score', 'num'], band: ['Health', 'enum'],
      aiPct: ['Merlin credits used', 'pct'], emailDays: ['Days since last email', 'num'], nextCall: ['Next call', 'date'], renewal: ['Renewal date', 'date'],
      signup: ['Signed up', 'date'], csat: ['Last CSAT', 'num'], billing: ['Billing', 'enum'], overdue: ['Payment overdue', 'enum'] } },
    usage: { label: 'Usage by month', icon: '📈', desc: 'Per firm per month, from Segment', fields: {
      firm: ['Firm', 'text'], month: ['Month', 'month'], csm: ['CSM', 'enum'], im: ['IM', 'enum'], status: ['Status', 'enum'], logins: ['Logins', 'num'], matters: ['Matters created', 'num'],
      contacts: ['Contacts created', 'num'], sms: ['SMS sent', 'num'], ai: ['Merlin credits', 'num'], minutes: ['Minutes in app', 'num'] } },
    calls: { label: 'Calls', icon: '🎧', desc: 'Zoom and Gong calls, last 180 days', fields: {
      firm: ['Firm', 'text'], date: ['Date', 'date'], rep: ['Rep', 'enum'], type: ['Call type', 'enum'], outcome: ['Outcome', 'enum'], minutes: ['Minutes', 'num'] } },
    emails: { label: 'Emails', icon: '✉️', desc: 'From the team’s Gmail, last 180 days', fields: {
      firm: ['Firm', 'text'], date: ['Date', 'date'], rep: ['Rep', 'enum'], direction: ['Direction', 'enum'], replied: ['Firm replied', 'enum'] } },
    runs: { label: 'Automation runs', icon: '⚡', desc: 'Firms entering automations, last 90 days', fields: {
      firm: ['Firm', 'text'], automation: ['Automation', 'enum'], entered: ['Entered', 'date'], rep: ['Owner', 'enum'], status: ['Status', 'enum'] } },
  };
  const OPS = { text: ['contains', 'is'], enum: ['is', 'is not'], num: ['>', '<', '='], money: ['>', '<'], pct: ['<', '>'], date: ['in last (days)', 'in next (days)', 'older than (days)'], month: ['is', 'last N months'] };
  const isNum = (t) => t === 'num' || t === 'money' || t === 'pct';

  /* ---------- saved reports ---------- */
  const SEED = [
    { id: 'r1', name: 'At-risk firms by churn score', folder: 'Shared', by: 'Clare Struzzi', src: 'firms', cols: ['firm', 'csm', 'mrr', 'score', 'band', 'emailDays', 'renewal'], filters: [{ f: 'status', op: 'is', v: 'Active' }, { f: 'band', op: 'is', v: 'At risk' }], group: '', measure: { agg: 'count', f: '' }, chart: 'table', sort: ['score', -1] },
    { id: 'r2', name: 'MRR by CSM', folder: 'Shared', by: 'Clare Struzzi', src: 'firms', cols: ['firm', 'csm', 'mrr'], filters: [{ f: 'status', op: 'is', v: 'Active' }], group: 'csm', measure: { agg: 'sum', f: 'mrr' }, chart: 'bar', sort: ['mrr', -1] },
    { id: 'r3', name: 'Matters created per month, all firms', folder: 'Shared', by: 'Erika Lara', src: 'usage', cols: ['firm', 'month', 'matters'], filters: [], group: 'month', measure: { agg: 'sum', f: 'matters' }, chart: 'line', sort: ['month', 1] },
    { id: 'r4', name: 'Missed onboarding calls by IM, last 90 days', folder: 'Shared', by: 'Clare Struzzi', src: 'calls', cols: ['firm', 'date', 'rep', 'type', 'outcome'], filters: [{ f: 'outcome', op: 'is', v: 'Missed' }, { f: 'date', op: 'in last (days)', v: '90' }, { f: 'type', op: 'is not', v: 'Check-in' }], group: 'rep', measure: { agg: 'count', f: '' }, chart: 'bar', sort: ['date', -1] },
    { id: 'r5', name: 'Firms not emailed in 60+ days', folder: 'Shared', by: 'Erika Lara', src: 'firms', cols: ['firm', 'csm', 'mrr', 'emailDays', 'score'], filters: [{ f: 'status', op: 'is', v: 'Active' }, { f: 'emailDays', op: '>', v: '60' }], group: '', measure: { agg: 'count', f: '' }, chart: 'table', sort: ['emailDays', -1] },
    { id: 'r6', name: 'Onboarding firms by stage', folder: 'Shared', by: 'Clare Struzzi', src: 'firms', cols: ['firm', 'im', 'stage', 'nextCall'], filters: [{ f: 'status', op: 'is', v: 'Onboarding' }], group: 'stage', measure: { agg: 'count', f: '' }, chart: 'bar', sort: ['stage', 1] },
    { id: 'r7', name: 'Merlin credits under 25%', folder: 'Shared', by: 'Erika Lara', src: 'firms', cols: ['firm', 'csm', 'aiPct', 'mrr'], filters: [{ f: 'status', op: 'is', v: 'Active' }, { f: 'aiPct', op: '<', v: '25' }], group: '', measure: { agg: 'count', f: '' }, chart: 'table', sort: ['aiPct', 1] },
    { id: 'r8', name: 'Automation entries by automation', folder: 'Shared', by: 'Clare Struzzi', src: 'runs', cols: ['firm', 'automation', 'entered', 'status'], filters: [{ f: 'entered', op: 'in last (days)', v: '30' }], group: 'automation', measure: { agg: 'count', f: '' }, chart: 'bar', sort: ['entered', -1] },
    { id: 'r9', name: 'Renewals in the next 90 days', folder: 'Only me', by: 'you', src: 'firms', cols: ['firm', 'csm', 'mrr', 'score', 'renewal', 'billing'], filters: [{ f: 'renewal', op: 'in next (days)', v: '90' }], group: '', measure: { agg: 'count', f: '' }, chart: 'table', sort: ['renewal', 1] },
  ];
  let LIST;
  try { LIST = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (x) { LIST = null; }
  if (!Array.isArray(LIST) || !LIST.length) LIST = JSON.parse(JSON.stringify(SEED));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(LIST)); } catch (x) { /* */ } };
  const UI = { id: LIST[0].id, draft: null, mine: false, drill: null, confirmDel: null, page: 0, toast: '' };
  const cur = () => UI.draft || LIST.find((r) => r.id === UI.id) || LIST[0];
  const dirty = () => !!UI.draft;
  const edit = () => { if (!UI.draft) UI.draft = JSON.parse(JSON.stringify(cur())); return UI.draft; };

  /* ---------- who is looking ---------- */
  const persona = () => (window.DEMO_PERSONA ? window.DEMO_PERSONA() : { name: 'Test Manager' });
  const isMgr = () => /manager/i.test(persona().name);
  function bookFilter(src, rows) {
    if (isMgr() && !UI.mine) return rows;
    const me = persona().name;
    const key = src === 'firms' ? (r) => r.csm === me || r.im === me || r.owner === me : src === 'usage' ? (r) => r.csm === me || r.im === me : (r) => r.rep === me;
    return rows.filter(key);
  }

  /* ---------- run a report ---------- */
  function test(r, row, flt) {
    const t = (SOURCES[r.src].fields[flt.f] || [])[1]; const x = row[flt.f]; const v = flt.v;
    if (v === '' || v == null) return true;
    if (t === 'date') {
      if (!x) return false; const ds = daysSince(x);
      return flt.op === 'in last (days)' ? ds >= 0 && ds <= +v : flt.op === 'in next (days)' ? ds <= 0 && -ds <= +v : ds > +v;
    }
    if (t === 'month') return flt.op === 'is' ? x === v : MONTHS.slice(-(+v || 1)).includes(x);
    if (isNum(t)) { if (x == null) return false; return flt.op === '>' ? x > +v : flt.op === '<' ? x < +v : x === +v; }
    if (flt.op === 'contains') return String(x || '').toLowerCase().includes(String(v).toLowerCase());
    return flt.op === 'is not' ? String(x) !== v : String(x) === v;
  }
  function run(r) {
    let rows = bookFilter(r.src, data()[r.src]);
    rows = rows.filter((row) => r.filters.every((f) => test(r, row, f)));
    const [sk, sd] = r.sort || [];
    if (sk) rows = rows.slice().sort((a, b) => { const x = a[sk], y = b[sk]; if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (x > y ? 1 : x < y ? -1 : 0) * (sd || 1); });
    let groups = null;
    if (r.group) {
      const m = new Map();
      rows.forEach((row) => { const k = row[r.group] || '(blank)'; if (!m.has(k)) m.set(k, []); m.get(k).push(row); });
      groups = [...m.entries()].map(([k, rs]) => {
        const vals = rs.map((x) => +x[r.measure.f] || 0);
        const val = r.measure.agg === 'count' ? rs.length : r.measure.agg === 'sum' ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
        return { key: k, val, n: rs.length };
      });
      if ((SOURCES[r.src].fields[r.group] || [])[1] === 'month') groups.sort((a, b) => a.key.localeCompare(b.key));
      else if (r.group === 'stage') groups.sort((a, b) => STAGE_ORDER(a.key) - STAGE_ORDER(b.key));
      else groups.sort((a, b) => b.val - a.val);
    }
    return { rows, groups };
  }
  const STAGE_ORDER = (s) => { const i = ['Needs to Schedule', 'First Onboarding', 'Second Onboarding', 'Third Onboarding', 'Fourth Onboarding', 'Fifth Onboarding', 'Sixth Onboarding'].indexOf(s); return i < 0 ? 99 : i; };
  function fmt(t, v, key) {
    if (v == null || v === '') return '<span class="rp-dim">—</span>';
    if (t === 'money') return money(v);
    if (t === 'pct') return v + '%';
    if (t === 'month') return monthLabel(v);
    if (t === 'date') { const d = new Date(v + 'T12:00:00'); return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }); }
    if (key === 'band') return `<span class="rp-band ${v === 'Healthy' ? 'good' : v === 'Watch' ? 'warn' : 'bad'}">${e(v)}</span>`;
    if (key === 'score') return `<span class="rp-score ${v < 33 ? 'good' : v < 67 ? 'warn' : 'bad'}">${v}</span>`;
    if (t === 'num') return Number(v).toLocaleString();
    return e(v);
  }
  const measureLabel = (r) => r.measure.agg === 'count' ? 'Count' : (r.measure.agg === 'sum' ? 'Total ' : 'Average ') + ((SOURCES[r.src].fields[r.measure.f] || [])[0] || '').toLowerCase();
  const fmtMeasure = (r, v) => { const t = (SOURCES[r.src].fields[r.measure.f] || [])[1]; if (r.measure.agg === 'count') return Number(v).toLocaleString(); if (t === 'money') return money(v); if (t === 'pct') return Math.round(v) + '%'; return (r.measure.agg === 'avg' ? Math.round(v * 10) / 10 : Math.round(v)).toLocaleString(); };

  /* ---------- charts (plain SVG) ---------- */
  function barChart(r, groups) {
    const g = groups.slice(0, 14); const max = Math.max(1, ...g.map((x) => x.val));
    const t = (SOURCES[r.src].fields[r.group] || [])[1];
    return `<div class="rp-bars">${g.map((x) => `<div class="rp-bar"><span class="rp-bl" title="${e(x.key)}">${t === 'month' ? monthLabel(x.key) : e(x.key)}</span><span class="rp-bt"><i style="width:${Math.max(1.5, x.val / max * 100)}%"></i></span><b>${fmtMeasure(r, x.val)}</b></div>`).join('')}${groups.length > 14 ? `<div class="rp-dim">+ ${groups.length - 14} more</div>` : ''}</div>`;
  }
  function lineChart(r, groups) {
    if (groups.length < 2) return barChart(r, groups);
    const W = 640, H = 220, P = { l: 52, r: 16, t: 14, b: 28 };
    const max = Math.max(1, ...groups.map((x) => x.val)) * 1.08;
    const X = (i) => P.l + i * (W - P.l - P.r) / (groups.length - 1);
    const Y = (v) => H - P.b - v / max * (H - P.t - P.b);
    const pts = groups.map((x, i) => `${X(i).toFixed(1)},${Y(x.val).toFixed(1)}`).join(' ');
    const ticks = [0, 0.5, 1].map((f) => max / 1.08 * f);
    const t = (SOURCES[r.src].fields[r.group] || [])[1];
    return `<svg class="rp-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="${e(measureLabel(r))} by ${e(r.group)}">
      ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="rp-grid"/><text x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end" class="rp-ax">${fmtMeasure(r, v)}</text>`).join('')}
      <polygon points="${P.l},${H - P.b} ${pts} ${X(groups.length - 1)},${H - P.b}" class="rp-area"/>
      <polyline points="${pts}" class="rp-pl"/>
      ${groups.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.val)}" r="3.5" class="rp-dot"><title>${t === 'month' ? monthLabel(x.key) : e(x.key)}: ${fmtMeasure(r, x.val)}</title></circle>${i % Math.ceil(groups.length / 8) === 0 || i === groups.length - 1 ? `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" class="rp-ax">${t === 'month' ? monthLabel(x.key) : e(String(x.key).slice(0, 10))}</text>` : ''}`).join('')}
    </svg>`;
  }

  /* ---------- page ---------- */
  function open() {
    const host = document.getElementById('rpHost'); if (!host) return;
    let page = document.getElementById('rpPage');
    if (!page) {
      page = document.createElement('div'); page.id = 'rpPage'; page.className = 'rp-page'; host.appendChild(page);
      page.addEventListener('click', onClick); page.addEventListener('change', onChange); page.addEventListener('input', onInput);
    }
    render();
  }
  function render() {
    const page = document.getElementById('rpPage'); if (!page) return;
    const r = cur(); const S = SOURCES[r.src]; const res = run(r);
    const mgr = isMgr();
    const folders = ['Shared', 'Only me'].map((fo) => {
      const items = LIST.filter((x) => x.folder === fo);
      return `<div class="rp-folder"><h5>${fo === 'Shared' ? '👥 Shared with the team' : '🔒 Only me'}</h5>${items.map((x) => `<div class="rp-item${x.id === UI.id ? ' on' : ''}">
          <button type="button" class="rp-open" data-open="${x.id}"><span>${SOURCES[x.src].icon}</span><span class="rp-in"><b>${e(x.name)}</b><small>${e(SOURCES[x.src].label)} · ${e(x.by)}</small></span></button>
          ${UI.confirmDel === x.id ? `<span class="rp-del"><button type="button" class="au-btn sm danger-solid" data-del="${x.id}">Delete?</button><button type="button" class="au-btn sm" data-delno>Keep</button></span>` : (mgr || x.folder === 'Only me') ? `<button type="button" class="rp-trash" data-del="${x.id}" aria-label="Delete ${e(x.name)}" title="Delete">🗑</button>` : ''}
        </div>`).join('') || '<p class="rp-dim">None yet.</p>'}</div>`;
    }).join('');

    const fieldOpts = (sel, filter) => Object.entries(S.fields).filter(([, [, t]]) => !filter || filter(t)).map(([k, [l]]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${e(l)}</option>`).join('');
    const values = (f) => [...new Set(data()[r.src].map((x) => x[f]).filter((x) => x !== '' && x != null))].sort();
    const filters = r.filters.map((f, i) => {
      const t = S.fields[f.f][1];
      const ops = OPS[t].map((o) => `<option${o === f.op ? ' selected' : ''}>${e(o)}</option>`).join('');
      const val = t === 'enum' ? `<select data-fv="${i}"><option value="">any</option>${values(f.f).map((v) => `<option${String(v) === f.v ? ' selected' : ''}>${e(v)}</option>`).join('')}</select>`
        : t === 'month' && f.op === 'is' ? `<select data-fv="${i}">${MONTHS.slice().reverse().map((m) => `<option value="${m}"${m === f.v ? ' selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>`
          : `<input data-fv="${i}" value="${e(f.v)}" ${t === 'text' ? '' : 'type="number"'} placeholder="value">`;
      return `<div class="rp-filter"><select data-ff="${i}">${fieldOpts(f.f)}</select><select data-fo="${i}">${ops}</select>${val}<button type="button" class="rp-x" data-frm="${i}" aria-label="Remove filter">×</button></div>`;
    }).join('');
    const cols = r.cols.map((c) => `<span class="rp-chip">${e(S.fields[c][0])}<button type="button" data-crm="${c}" aria-label="Remove column">×</button></span>`).join('');
    const addable = Object.keys(S.fields).filter((k) => !r.cols.includes(k));

    let body = '';
    const N = res.rows.length;
    if (r.group && res.groups) {
      const total = r.measure.agg === 'avg' ? res.groups.reduce((a, g) => a + g.val * g.n, 0) / (N || 1) : res.groups.reduce((a, g) => a + g.val, 0);
      body += `<div class="rp-kpis"><div><span>${e(measureLabel(r))}</span><b>${fmtMeasure(r, total)}</b></div><div><span>Rows</span><b>${N.toLocaleString()}</b></div><div><span>Groups</span><b>${res.groups.length}</b></div></div>`;
      body += `<div class="rp-chart">${r.chart === 'line' ? lineChart(r, res.groups) : r.chart === 'bar' ? barChart(r, res.groups) : ''}</div>`;
      if (r.chart === 'table' || r.chart === 'bar' || r.chart === 'line') {
        const gt = S.fields[r.group][1];
        body += `<div class="rp-tablewrap"><table class="rp-table"><thead><tr><th>${e(S.fields[r.group][0])}</th><th class="num">${e(measureLabel(r))}</th><th class="num">Rows</th></tr></thead><tbody>${res.groups.map((g) => `<tr data-gkey="${e(g.key)}"><td>${gt === 'month' ? monthLabel(g.key) : e(g.key)}</td><td class="num">${fmtMeasure(r, g.val)}</td><td class="num">${g.n}</td></tr>`).join('')}</tbody></table></div>`;
      }
    } else {
      const per = 50; const pages = Math.max(1, Math.ceil(N / per)); UI.page = Math.min(UI.page, pages - 1);
      const slice = res.rows.slice(UI.page * per, UI.page * per + per);
      const mrrTotal = r.src === 'firms' ? res.rows.reduce((a, x) => a + (x.mrr || 0), 0) : 0;
      body += `<div class="rp-kpis"><div><span>${e(S.label)}</span><b>${N.toLocaleString()}</b></div>${r.src === 'firms' ? `<div><span>MRR</span><b>${money(mrrTotal)}</b></div><div><span>Avg churn score</span><b>${N ? Math.round(res.rows.reduce((a, x) => a + x.score, 0) / N) : '—'}</b></div>` : ''}</div>`;
      body += `<div class="rp-tablewrap"><table class="rp-table"><thead><tr>${r.cols.map((c) => { const [l, t] = S.fields[c]; const on = r.sort && r.sort[0] === c; return `<th class="${isNum(t) ? 'num' : ''}"><button type="button" data-sort="${c}">${e(l)}${on ? (r.sort[1] > 0 ? ' ▲' : ' ▼') : ''}</button></th>`; }).join('')}</tr></thead>
        <tbody>${slice.map((row) => `<tr data-drill="${row.id}">${r.cols.map((c) => `<td class="${isNum(S.fields[c][1]) ? 'num' : ''}">${c === 'firm' ? `<b>${e(String(row.firm).replace(/^Test – /, ''))}</b>` : fmt(S.fields[c][1], row[c], c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${r.cols.length}" class="rp-dim">No rows match these filters.</td></tr>`}</tbody></table></div>
        ${pages > 1 ? `<div class="rp-pager"><button type="button" class="au-btn sm" data-pg="-1" ${UI.page ? '' : 'disabled'}>‹ Prev</button><span>${UI.page * per + 1}–${Math.min(N, UI.page * per + per)} of ${N}</span><button type="button" class="au-btn sm" data-pg="1" ${UI.page < pages - 1 ? '' : 'disabled'}>Next ›</button></div>` : ''}`;
    }

    const canShare = mgr;
    page.innerHTML = `<header class="au-top"><div class="au-crumbs"><b>📊 Reports</b><span class="au-mock">Mockup · made-up data</span></div>
        <div class="au-top-actions">${mgr ? `<label class="rp-mine"><input type="checkbox" data-mine ${UI.mine ? 'checked' : ''}> My book only</label>` : `<span class="rp-dim">Showing ${e(persona().name)}’s book</span>`}
          <button type="button" class="au-btn primary" data-new>＋ New report</button></div></header>
      <div class="rp-body">
        <aside class="rp-side">${folders}<p class="rp-note">Saved reports replace ChurnZero segments: one report per role, filtered to each rep’s own book.</p></aside>
        <main class="rp-main">
          <div class="rp-titlebar"><input class="rp-name" data-name value="${e(r.name)}" aria-label="Report name">
            <div class="rp-tactions">${dirty() ? '<span class="rp-unsaved">Unsaved changes</span><button type="button" class="au-btn sm" data-discard>Discard</button>' : ''}
              <button type="button" class="au-btn sm" data-save>${dirty() ? 'Save' : 'Saved ✓'}</button><button type="button" class="au-btn sm" data-saveas>Save as new</button>
              <select data-share ${canShare ? '' : 'disabled title="Only managers share reports with the team"'}><option${r.folder === 'Shared' ? ' selected' : ''}>Shared</option><option${r.folder === 'Only me' ? ' selected' : ''}>Only me</option></select>
              <button type="button" class="au-btn sm" data-csv>⬇ CSV</button></div></div>
          <section class="rp-build">
            <div class="rp-row"><label>Data</label><div class="rp-srcs">${Object.entries(SOURCES).map(([k, s]) => `<button type="button" class="rp-src${k === r.src ? ' on' : ''}" data-src="${k}" title="${e(s.desc)}">${s.icon} ${e(s.label)}</button>`).join('')}</div></div>
            <div class="rp-row"><label>Filters</label><div class="rp-filters">${filters}<button type="button" class="rp-add" data-fadd>＋ Filter</button></div></div>
            <div class="rp-row"><label>Group by</label><div class="rp-inline"><select data-group><option value="">No grouping (list of rows)</option>${fieldOpts(r.group, (t) => t === 'enum' || t === 'month')}</select>
              ${r.group ? `<select data-agg>${['count', 'sum', 'avg'].map((a) => `<option value="${a}"${a === r.measure.agg ? ' selected' : ''}>${{ count: 'Count of rows', sum: 'Total of', avg: 'Average of' }[a]}</option>`).join('')}</select>
                ${r.measure.agg !== 'count' ? `<select data-mf>${fieldOpts(r.measure.f, isNum)}</select>` : ''}
                <span class="rp-seg">${[['bar', '▤ Bars'], ['line', '📈 Line'], ['table', '▦ Table']].map(([k, l]) => `<button type="button" class="${r.chart === k ? 'on' : ''}" data-chart="${k}">${l}</button>`).join('')}</span>` : ''}</div></div>
            ${r.group ? '' : `<div class="rp-row"><label>Columns</label><div class="rp-cols">${cols}${addable.length ? `<select data-cadd><option value="">＋ Column</option>${addable.map((k) => `<option value="${k}">${e(S.fields[k][0])}</option>`).join('')}</select>` : ''}</div></div>`}
          </section>
          <section class="rp-out">${body}</section>
        </main>
        ${UI.drill ? drillHtml(UI.drill) : ''}
      </div>
      ${UI.toast ? `<div class="rp-toast">${e(UI.toast)}</div>` : ''}`;
  }

  /* ---------- firm drill-in: churn score explained + usage ---------- */
  function drillHtml(id) {
    const D = data(); const f = D.firms.find((x) => x.id === id); if (!f) return '';
    const u = D.usage.filter((x) => x.id === id);
    const metric = (k) => MONTHS.map((m) => (u.find((x) => x.month === m) || {})[k] || 0);
    const spark = (vals) => { const max = Math.max(1, ...vals); return `<svg viewBox="0 0 120 30" class="rp-spark" aria-hidden="true"><polyline points="${vals.map((v, i) => `${(i * 120 / 11).toFixed(1)},${(28 - v / max * 26).toFixed(1)}`).join(' ')}"/></svg>`; };
    const pct = (vals) => { const a = vals[10], b = vals[11]; if (!a) return ''; const d = Math.round((b - a) / a * 100); return `<small class="${d < -10 ? 'neg' : d > 10 ? 'pos' : ''}">${d > 0 ? '+' : ''}${d}% vs last month</small>`; };
    const F = [
      ['Matters created', `${f._fac.matters} in the last 7 days`, 'Goal 10+', f._pts[0]],
      ['Time in app', `${f._fac.minutes} min in the last 7 days`, 'Goal 50+ min', f._pts[1]],
      ['Emails from the firm', `${f._fac.msgs} in the last 90 days`, 'Goal 3+', f._pts[2]],
      ['CSAT', `${f._fac.csat} average, last 60 days`, 'Goal above 4.0', f._pts[3]],
    ];
    const top = F.slice().sort((a, b) => b[3] - a[3])[0];
    const calls = D.calls.filter((x) => x.id === id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
    return `<aside class="rp-drill" aria-label="Firm details">
      <div class="rp-dh"><div><h4>${e(f.firm.replace(/^Test – /, ''))}</h4><small>${e(f.status)} · ${e(f.area)} · ${f.status === 'Onboarding' ? 'IM ' + e(f.im) : 'CSM ' + e(f.csm)} · ${money(f.mrr)}/mo</small></div><button type="button" class="rp-x" data-dclose aria-label="Close">×</button></div>
      <div class="rp-scorebox ${f.score < 33 ? 'good' : f.score < 67 ? 'warn' : 'bad'}"><b>${f.score}</b><div><span>Churn score · ${e(f.band)}</span><small>${f.score >= 33 ? `Biggest drag: <b>${e(top[0].toLowerCase())}</b>` : 'All factors close to goal'}</small></div></div>
      <h5>What makes up the score</h5>
      <div class="rp-factors">${F.map(([n, v, g, p]) => `<div class="rp-factor"><div><b>${n}</b><small>${e(v)} · ${g}</small></div><span class="rp-fbar"><i class="${p >= 17 ? 'bad' : p >= 9 ? 'warn' : 'good'}" style="width:${p / 25 * 100}%"></i></span><span class="rp-fp">${p}/25</span></div>`).join('')}</div>
      <p class="rp-note">Each factor adds up to 25 risk points when the firm misses its goal. Recalculated every night from usage, email and CSAT data.</p>
      <h5>Usage, last 12 months</h5>
      <div class="rp-usage">${[['Logins', 'logins'], ['Matters created', 'matters'], ['SMS sent', 'sms'], ['Minutes in app', 'minutes']].map(([l, k]) => { const v = metric(k); return `<div><span>${l}</span><b>${v[11].toLocaleString()}</b>${spark(v)}${pct(v)}</div>`; }).join('')}</div>
      <h5>Recent calls</h5>
      <ul class="rp-calls">${calls.map((c) => `<li><span class="rp-out-${c.outcome.toLowerCase()}">${e(c.outcome)}</span> ${e(c.type)} · ${e(c.rep)} <small>${fmt('date', c.date)}</small></li>`).join('') || '<li class="rp-dim">No calls in the last 180 days.</li>'}</ul>
      <div class="rp-dfoot"><button type="button" class="au-btn primary" data-firmpage="${id}">Open firm page</button>${f.renewal ? `<small>Renews ${fmt('date', f.renewal)}</small>` : ''}</div>
    </aside>`;
  }

  /* ---------- events ---------- */
  function flash(msg) { UI.toast = msg; render(); clearTimeout(flash.t); flash.t = setTimeout(() => { UI.toast = ''; render(); }, 2600); }
  function onClick(ev) {
    const q = (s) => ev.target.closest(s);
    let el;
    if ((el = q('[data-open]'))) { if (q('[data-del]')) return; UI.id = el.dataset.open; UI.draft = null; UI.page = 0; UI.confirmDel = null; render(); return; }
    if ((el = q('[data-del]'))) {
      const id = el.dataset.del;
      if (UI.confirmDel !== id) { UI.confirmDel = id; render(); return; }
      LIST = LIST.filter((x) => x.id !== id); if (!LIST.length) LIST = JSON.parse(JSON.stringify(SEED));
      save(); UI.confirmDel = null; if (UI.id === id) { UI.id = LIST[0].id; UI.draft = null; } flash('Report deleted'); return;
    }
    if (q('[data-delno]')) { UI.confirmDel = null; render(); return; }
    if (q('[data-new]')) {
      UI.draft = { id: 'r' + Date.now(), name: 'Untitled report', folder: 'Only me', by: 'you', src: 'firms', cols: ['firm', 'csm', 'mrr', 'score'], filters: [{ f: 'status', op: 'is', v: 'Active' }], group: '', measure: { agg: 'count', f: '' }, chart: 'table', sort: ['firm', 1], isNew: true };
      UI.id = UI.draft.id; UI.page = 0; render(); document.querySelector('#rpPage [data-name]')?.select(); return;
    }
    if ((el = q('[data-src]'))) {
      const r = edit(); if (r.src === el.dataset.src) return;
      const S = SOURCES[el.dataset.src]; r.src = el.dataset.src; r.cols = Object.keys(S.fields).slice(0, 5); r.filters = []; r.group = ''; r.measure = { agg: 'count', f: '' }; r.chart = 'table'; r.sort = [r.cols[0], 1]; UI.page = 0; render(); return;
    }
    if (q('[data-fadd]')) { const r = edit(); const k = Object.keys(SOURCES[r.src].fields).find((x) => SOURCES[r.src].fields[x][1] === 'enum') || 'firm'; r.filters.push({ f: k, op: OPS[SOURCES[r.src].fields[k][1]][0], v: '' }); render(); return; }
    if ((el = q('[data-frm]'))) { edit().filters.splice(+el.dataset.frm, 1); UI.page = 0; render(); return; }
    if ((el = q('[data-crm]'))) { const r = edit(); if (r.cols.length > 1) r.cols = r.cols.filter((c) => c !== el.dataset.crm); render(); return; }
    if ((el = q('[data-sort]'))) { const r = edit(); const k = el.dataset.sort; r.sort = [k, r.sort && r.sort[0] === k ? -r.sort[1] : (isNum(SOURCES[r.src].fields[k][1]) ? -1 : 1)]; render(); return; }
    if ((el = q('[data-chart]'))) { edit().chart = el.dataset.chart; render(); return; }
    if ((el = q('[data-pg]'))) { UI.page = Math.max(0, UI.page + +el.dataset.pg); render(); return; }
    if ((el = q('[data-drill]'))) { UI.drill = el.dataset.drill; render(); return; }
    if ((el = q('[data-gkey]'))) {
      // Clicking a group drills into its rows: same report, filtered to that group, no grouping.
      const r = edit(); const t = SOURCES[r.src].fields[r.group][1];
      r.filters = r.filters.concat([{ f: r.group, op: t === 'month' ? 'is' : 'is', v: el.dataset.gkey }]); r.group = ''; r.chart = 'table'; r.name = r.name + ' · ' + (t === 'month' ? monthLabel(el.dataset.gkey) : el.dataset.gkey);
      if (!r.cols.includes('firm')) r.cols.unshift('firm'); UI.page = 0; render(); return;
    }
    if (q('[data-dclose]')) { UI.drill = null; render(); return; }
    if ((el = q('[data-firmpage]'))) {
      const id = el.dataset.firmpage; UI.drill = null; render();
      document.querySelector('.tab[data-tab="resources"]')?.click();
      document.querySelector('#view-resources [data-res-view="firm"]')?.click();
      setTimeout(() => { if (typeof openFirm === 'function') openFirm(id); document.getElementById('profile')?.scrollIntoView({ behavior: 'smooth' }); }, 150);
      return;
    }
    if (q('[data-discard]')) { const wasNew = UI.draft && UI.draft.isNew; UI.draft = null; if (wasNew) UI.id = LIST[0].id; render(); return; }
    if (q('[data-save]')) {
      if (!UI.draft) return; const r = UI.draft; delete r.isNew; UI.draft = null;
      const i = LIST.findIndex((x) => x.id === r.id); if (i >= 0) LIST[i] = r; else LIST.unshift(r); save(); flash('Report saved'); return;
    }
    if (q('[data-saveas]')) {
      const r = JSON.parse(JSON.stringify(cur())); delete r.isNew; r.id = 'r' + Date.now(); r.name = r.name.replace(/ \(copy\)$/, '') + ' (copy)'; r.folder = 'Only me'; r.by = 'you';
      LIST.unshift(r); save(); UI.draft = null; UI.id = r.id; flash('Saved as a new report in Only me'); return;
    }
    if (q('[data-csv]')) { csv(); return; }
  }
  function onChange(ev) {
    const t = ev.target; const d = t.dataset;
    if ('mine' in d) { UI.mine = t.checked; UI.page = 0; render(); return; }
    if ('share' in d) { edit().folder = t.value; render(); return; }
    if ('ff' in d) { const r = edit(); const f = r.filters[+d.ff]; f.f = t.value; f.op = OPS[SOURCES[r.src].fields[t.value][1]][0]; f.v = ''; render(); return; }
    if ('fo' in d) { const f = edit().filters[+d.fo]; f.op = t.value; if (f.op === 'last N months') f.v = '3'; render(); return; }
    if ('fv' in d && t.tagName === 'SELECT') { edit().filters[+d.fv].v = t.value; UI.page = 0; render(); return; }
    if ('group' in d) { const r = edit(); r.group = t.value; r.chart = r.group ? ((SOURCES[r.src].fields[r.group] || [])[1] === 'month' ? 'line' : 'bar') : 'table'; render(); return; }
    if ('agg' in d) { const r = edit(); r.measure.agg = t.value; if (t.value !== 'count' && !r.measure.f) r.measure.f = Object.keys(SOURCES[r.src].fields).find((k) => isNum(SOURCES[r.src].fields[k][1])); render(); return; }
    if ('mf' in d) { edit().measure.f = t.value; render(); return; }
    if ('cadd' in d) { if (t.value) { edit().cols.push(t.value); render(); } }
  }
  function onInput(ev) {
    const t = ev.target; const d = t.dataset;
    if ('name' in d) { edit().name = t.value; const bar = t.closest('.rp-titlebar'); if (bar && !bar.querySelector('.rp-unsaved')) { const pos = t.selectionStart; render(); const i = document.querySelector('#rpPage [data-name]'); i.focus(); i.setSelectionRange(pos, pos); } return; }
    if ('fv' in d && t.tagName === 'INPUT') {
      edit().filters[+d.fv].v = t.value; UI.page = 0; const pos = t.selectionStart; render();
      const i = document.querySelector(`#rpPage input[data-fv="${d.fv}"]`); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (x) { /* number inputs */ } }
    }
  }
  function csv() {
    const r = cur(); const S = SOURCES[r.src]; const res = run(r);
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = r.group
      ? [[S.fields[r.group][0], measureLabel(r), 'Rows'].map(q).join(',')].concat(res.groups.map((g) => [g.key, Math.round(g.val * 100) / 100, g.n].map(q).join(',')))
      : [r.cols.map((c) => q(S.fields[c][0])).join(',')].concat(res.rows.map((row) => r.cols.map((c) => q(row[c])).join(',')));
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      a.download = r.name.replace(/[^\w -]+/g, '').trim() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
      flash(`CSV with ${lines.length - 1} rows downloaded`);
    } catch (x) { flash('This viewer blocks downloads; on the real dashboard the CSV saves to your computer.'); }
  }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && UI.drill && document.getElementById('rpPage')) { UI.drill = null; render(); } });
  // Switching "View as" in the banner changes whose book shows.
  let lastP = '';
  setInterval(() => { const p = persona().name; if (p !== lastP) { lastP = p; UI.drill = null; if (document.getElementById('rpPage')) render(); } }, 900);

  /* ---------- its own main tab ---------- */
  const nav = document.querySelector('.tabbar');
  if (nav && !document.querySelector('[data-tab="reports"]')) {
    const tab = document.createElement('button');
    tab.className = 'tab'; tab.dataset.tab = 'reports';
    tab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg> Reports';
    tab.addEventListener('click', () => setTimeout(open, 0));
    const auto = nav.querySelector('[data-tab="auto"]');
    if (auto) auto.before(tab); else nav.appendChild(tab);
    const view = document.createElement('div');
    view.className = 'view'; view.id = 'view-reports';
    view.innerHTML = '<div class="wrap"><div id="rpHost"></div></div>';
    const last = document.getElementById('view-auto') || document.getElementById('view-partners') || document.querySelector('.view:last-of-type');
    if (last) last.before ? (document.getElementById('view-auto') ? last.before(view) : last.after(view)) : document.body.appendChild(view);
  }
  window.openReports = open;
})();
