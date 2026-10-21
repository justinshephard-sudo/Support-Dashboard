/* ==========================================================================
   CS Scorecards — manager mode only. Reads and writes the "CS Score Cards 2026"
   sheet through its Apps Script (apps-script/scorecards), which checks the
   viewer is a manager. The sheet stays the record: KPI inputs, score overrides,
   competencies and notes are written to the rep's tab, and the sheet's own
   formulas compute the monthly, KPI, competency and total scores.
   ========================================================================== */
const SCORECARDS_URL = 'https://script.google.com/macros/s/AKfycbyRXeF59TIeltQ27HSAIyDq7XMXOFZP_hdT7oq1v-TxJA7pdeQnfOl-QrptTxcw530iXg/exec';
const SC_FORMER = ['adele'];   // left the team; scorecard kept for the record
const SC_KPIS = [
  { col: 'B', ovr: 'N', idx: 1, key: 'csat', label: 'CSAT %', kind: 'pct' },
  { col: 'C', ovr: 'O', idx: 2, key: 'first', label: '1st Response', kind: 'time' },
  { col: 'D', ovr: 'P', idx: 3, key: 'avg', label: 'Avg. Response', kind: 'time' },
  { col: 'E', ovr: 'Q', idx: 4, key: 'ans', label: 'Answer Rate', kind: 'pct' },
];
const SC_COMPETENCIES = ['Problem-Solving & Advanced Issue Resolution', 'Team Collaboration & Communication',
  'Customer Relationships & Proactivity', 'Innovation & Process Improvement',
  'Professional Growth & Development', 'Alignment with Company Values'];
const SC_COL = (letter) => letter.charCodeAt(0) - 65;
const SC = { loaded: false, loading: false, reps: [], tabs: {}, rubric: [], current: null };
// The last copy lives in this browser tab, so the page opens instantly while a fresh copy loads.
const SC_STORE = 'cs-sc-cache';

/* ---- formatting + the rubric (mirrors the sheet's score formula) ---- */
function scLevel(total) {
  if (total == null || total === '') return null;
  const t = Number(total);
  if (t >= 4.5) return [5, '5 – Excellent'];
  if (t >= 3.5) return [4, '4 – Exceeds Expectations'];
  if (t >= 2.5) return [3, '3 – Meets Expectations'];
  if (t >= 1.5) return [2, '2 – Needs Improvement'];
  return [1, '1 – Poor'];
}
const scNum = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const scFmt2 = (v) => (scNum(v) == null ? '–' : Number(v).toFixed(2));
function scFmtPct(v) {
  const n = scNum(v);
  if (n == null) return '';
  return `${Math.round(n > 1.5 ? n : n * 100)}%`;   // a few months were typed as 98 instead of 0.98
}
function scFmtTime(v) {
  const n = scNum(v);
  if (n == null) return '';
  const mins = Math.round(n * 1440);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}
function scParse(kind, text) {
  const s = String(text).trim();
  if (!s) return '';
  if (kind === 'pct') {
    const n = parseFloat(s.replace('%', ''));
    if (Number.isNaN(n) || n < 0 || n > 100) return null;
    return n > 1 || s.includes('%') ? n / 100 : n;
  }
  // "1:05", "0:45:30", "65m", "1h 5m"
  let m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m) return (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400;
  const secs = parseTimeToSeconds(s);
  return secs == null ? null : secs / 86400;
}
// 1–5 for one KPI, using the same thresholds as the sheet (Q1 used older Avg. Response cutoffs).
function scKpiScore(kpi, v, q1) {
  const n = scNum(v);
  if (n == null) return null;
  const pct = n > 1.5 ? n / 100 : n;
  const hm = (h, m) => (h * 60 + m) / 1440;
  if (kpi.key === 'csat') return pct >= 0.96 ? 5 : pct >= 0.91 ? 4 : pct >= 0.85 ? 3 : pct >= 0.75 ? 2 : 1;
  if (kpi.key === 'ans') return pct >= 0.91 ? 5 : pct >= 0.86 ? 4 : pct >= 0.8 ? 3 : pct >= 0.7 ? 2 : 1;
  const cut = kpi.key === 'avg' && q1 ? [hm(1, 31), hm(2, 0), hm(2, 10), hm(2, 30)] : [hm(1, 1), hm(1, 30), hm(1, 40), hm(2, 0)];
  return n < cut[0] ? 5 : n < cut[1] ? 4 : n < cut[2] ? 3 : n < cut[3] ? 2 : 1;
}

/* ---- the rep's tab, as the sheet lays it out ---- */
function scParseTab(grid) {
  const out = { months: [], comps: [], kpiAvg: null, compAvg: null, total: null, annual: null };
  grid.forEach((r, i) => {
    const a = String(r[0] == null ? '' : r[0]).trim();
    const row = i + 1;
    if (/^\d{4}-\d{2}-\d{2}$/.test(a) && row >= 3 && row <= 14) {
      out.months.push({ row, date: a, q1: row <= 5, vals: SC_KPIS.map((k) => r[k.idx]), ovr: SC_KPIS.map((k) => r[SC_COL(k.ovr)]), note: r[SC_COL('R')] || '', score: r[5] });
    } else if (/^annual average/i.test(a)) {
      out.annual = r; out.kpiAvg = scNum(r[5]);
    } else if (/^competency average/i.test(a)) {
      out.compAvg = scNum(r[3]);
    } else if (/total score/i.test(a)) {
      out.total = scNum(r[3]);
    } else if (SC_COMPETENCIES.includes(a)) {
      out.comps.push({ row, name: a, score: r[3], note: r[4] || '' });
    }
  });
  return out;
}

/* ---- network ---- */
async function scCall(body) {
  const res = await fetch(SCORECARDS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: AUTH.token }, body)),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function scApply(data) {
  SC.reps = data.reps || [];
  SC.tabs = data.tabs || {};
  SC.rubric = data.rubric || [];
  SC.loaded = true;
}
function scRender() {
  // Don't redraw under someone mid-edit; their save redraws the tab anyway.
  if (document.getElementById('scBody').contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
  if (SC.current && SC.tabs[SC.current]) renderScorecard(SC.current); else renderScorecardList();
}

async function loadScorecards(force) {
  if (SC.loading || (SC.loaded && !force)) return;
  if (!SC.loaded) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SC_STORE) || 'null');
      if (saved && saved.tabs) { scApply(saved); scRender(); }
    } catch (e) { /* private mode */ }
  }
  SC.loading = true;
  document.getElementById('scRefresh')?.classList.add('spin');
  const err = document.getElementById('scError');
  err.hidden = true;
  try {
    const data = await scCall({ action: 'load', force: !!force });
    scApply(data);
    try { sessionStorage.setItem(SC_STORE, JSON.stringify(data)); } catch (e) { /* full or private */ }
    scRender();
  } catch (e) {
    if (isSessionError(e)) showSessionBanner(true);
    err.textContent = 'Couldn’t load scorecards: ' + e.message;
    err.hidden = false;
    if (!SC.loaded) document.getElementById('scBody').innerHTML = '';
  } finally {
    SC.loading = false;
    document.getElementById('scRefresh')?.classList.remove('spin');
  }
}

async function scSave(cell, value, el) {
  const tab = SC.current;
  if (el) { el.classList.add('saving'); el.classList.remove('err'); }
  try {
    const data = await scCall({ action: 'set', tab, cell, value });
    SC.tabs[tab] = data.tab;
    try { sessionStorage.setItem(SC_STORE, JSON.stringify({ reps: SC.reps, tabs: SC.tabs, rubric: SC.rubric })); } catch (e) { /* full or private */ }
    if (SC.current === tab) renderScorecard(tab);
  } catch (e) {
    if (el) { el.classList.remove('saving'); el.classList.add('err'); el.title = e.message; }
    const err = document.getElementById('scError');
    err.textContent = 'Couldn’t save: ' + e.message;
    err.hidden = false;
  }
}

/* ---- views ---- */
function showScorecards() {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
  document.getElementById('view-scorecards').classList.add('active');
  document.getElementById('view-scorecards').scrollIntoView({ block: 'start' });
  if (!SC.loaded) loadScorecards(); else if (SC.current) renderScorecard(SC.current); else renderScorecardList();
}
function leaveScorecards() {
  const v = document.getElementById('view-scorecards');
  if (!v.classList.contains('active')) return;
  v.classList.remove('active');
  const first = document.querySelector('.tab[data-tab="team"]');
  if (first) first.click();
}

function scRepCard(rep) {
  const p = scParseTab(SC.tabs[rep.name] || []);
  const lvl = scLevel(p.total);
  return `<button type="button" class="sc-rep" data-rep="${esc(rep.name)}">
      <span class="sc-rep-head"><span class="sc-rep-name">${esc(rep.name)}</span><span class="sc-rep-role">${esc(rep.role || '')}</span></span>
      <span class="sc-rep-total">${scFmt2(p.total)}</span>
      ${lvl ? `<span class="sc-level l${lvl[0]}">${esc(lvl[1])}</span>` : '<span class="sc-level l3">Not scored yet</span>'}
    </button>`;
}

function renderScorecardList() {
  SC.current = null;
  document.getElementById('scBack').hidden = true;
  document.getElementById('scTitle').textContent = 'CS Scorecards';
  document.getElementById('scSub').textContent = 'Pick a rep to open their 2026 scorecard.';
  const active = SC.reps.filter((r) => !SC_FORMER.includes(r.name.toLowerCase()));
  const former = SC.reps.filter((r) => SC_FORMER.includes(r.name.toLowerCase()));
  const addCard = `<details class="sc-rep sc-add"><summary>+ Add a rep</summary>
      <form id="scAddForm"><input class="sc-in sc-add-in" name="name" placeholder="First name" aria-label="New rep's name" required maxlength="31">
      <select class="sc-in sc-add-in" name="role" aria-label="Role"><option>CS Support</option><option>CS Ops</option></select>
      <button type="submit" class="res-btn sc-add-btn">Create scorecard</button><div class="sc-add-msg" id="scAddMsg"></div></form></details>`;
  document.getElementById('scBody').innerHTML = `<div class="sc-grid">${active.map(scRepCard).join('')}${addCard}</div>`
    + (former.length ? `<details class="sc-former"><summary>Former team members (${former.length})</summary><div class="sc-grid">${former.map(scRepCard).join('')}</div></details>` : '')
    + scRubricHtml();
}

// Collapsed by default — it's reference material for the conversation.
function scRubricHtml() {
  const g = SC.rubric || [];
  if (!g.length) return '';
  const legend = g.filter((r) => /^[1-5](\.0)?$/.test(String(r[0]).trim()) && r[1])
    .map((r) => { const n = parseInt(r[0], 10); return `<span class="sc-level l${n}" title="${esc(r[2] || '')}">${n} – ${esc(r[1])}</span>`; }).join('');
  const tables = [];
  g.forEach((r, i) => {
    if (!/^KPI Rubric/i.test(String(r[0] || ''))) return;
    const head = g[i + 1] || [];
    const rows = g.slice(i + 2, i + 7).filter((x) => x[0]);
    tables.push(`<div><h3>${esc(r[0])}</h3><div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
      + `<tbody>${rows.map((x) => `<tr>${x.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`);
  });
  return `<details class="sc-rubric-wrap"><summary>Rubric &amp; scoring</summary>
    <div class="sc-legend">${legend}</div>
    <p class="sc-sub">Each KPI scores 1–5 per month; the monthly score is their average. Total = average of the KPI average and the competency average.</p>
    <div class="sc-rubric">${tables.join('')}</div></details>`;
}

function renderScorecard(name) {
  // A save re-renders the page; keep whatever the manager is typing in right now.
  const active = document.activeElement;
  const keep = active && active.closest && active.closest('#scBody') && active.dataset.cell
    ? { cell: active.dataset.cell, value: active.value, start: active.selectionStart, end: active.selectionEnd, tag: active.tagName } : null;
  SC.current = name;
  const rep = SC.reps.find((r) => r.name === name) || { name };
  const p = scParseTab(SC.tabs[name] || []);
  const lvl = scLevel(p.total);
  document.getElementById('scBack').hidden = false;
  document.getElementById('scTitle').textContent = name;
  document.getElementById('scSub').textContent = `${rep.role || 'CS'} · 2026 scorecard`;
  document.getElementById('scError').hidden = true;

  const summary = `<div class="sc-summary">
      <div class="sc-total"><span class="lbl">Total score</span><span class="val">${scFmt2(p.total)}</span>${lvl ? `<span class="sc-level l${lvl[0]}">${esc(lvl[1])}</span>` : ''}</div>
      <div class="sc-split"><span><b>${p.months.length ? scFmt2(p.kpiAvg) : 'n/a'}</b> KPI average</span><span><b>${scFmt2(p.compAvg)}</b> Competency average</span></div>
    </div>`;

  let kpis = '';
  if (p.months.length) {
    // Months that have data, plus every month up to now — later months stay hidden until they arrive.
    const nowKey = new Date().toISOString().slice(0, 7);
    const months = p.months.filter((m) => m.date.slice(0, 7) <= nowKey || m.vals.some((v) => v !== '' && v != null));
    const rows = months.map((m) => {
      const label = new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
      const cells = SC_KPIS.map((k, i) => {
        const raw = m.vals[i];
        const ov = scNum(m.ovr[i]);
        const sc = ov != null ? ov : scKpiScore(k, raw, m.q1);
        const txt = k.kind === 'pct' ? scFmtPct(raw) : scFmtTime(raw);
        return `<td><span class="sc-cell"><button type="button" class="sc-val${txt ? '' : ' empty'}" data-cell="${k.col}${m.row}" data-kind="${k.kind}" aria-label="Edit ${esc(label + ' ' + k.label)}">${esc(txt || 'add')}</button>`
          + `<button type="button" class="sc-dot${sc ? ' s' + sc : ''}${ov != null ? ' ovr' : ''}" data-ovr="${k.ovr}${m.row}" title="${ov != null ? 'Overridden — click to change' : 'Score — click to override'}">${sc != null ? sc : '·'}</button></span></td>`;
      }).join('');
      const score = scNum(m.score);
      return `<tr><td class="sc-mo">${esc(label)}${m.note ? ` <span class="sc-note-ico" title="${esc(m.note)}">✎</span>` : ''}</td>${cells}<td class="sc-mscore">${score == null ? '–' : score.toFixed(2)}</td></tr>`;
    }).join('');
    const a = p.annual || [];
    const avgRow = `<tr class="sc-avg"><td>Average</td><td>${scFmtPct(a[1]) || '–'}</td><td>${scFmtTime(a[2]) || '–'}</td><td>${scFmtTime(a[3]) || '–'}</td><td>${scFmtPct(a[4]) || '–'}</td><td class="sc-mscore">${scFmt2(a[5])}</td></tr>`;
    kpis = `<section class="res-section"><div class="section-head"><h2>KPIs</h2><span class="rule"></span><span class="note">Click a value to edit · click a score to override</span></div>
      <div class="panel"><div class="table-wrap"><table class="sc-table"><thead><tr><th>Month</th>${SC_KPIS.map((k) => `<th>${k.label}</th>`).join('')}<th>Score</th></tr></thead>
      <tbody>${rows}${avgRow}</tbody></table></div></div></section>`;
  }

  const opts = (v) => ['', 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((o) => `<option value="${o}"${String(o) === String(scNum(v) == null ? '' : scNum(v)) ? ' selected' : ''}>${o === '' ? '—' : o}</option>`).join('');
  const comps = `<section class="res-section"><div class="section-head"><h2>Competencies</h2><span class="rule"></span></div>
    <div class="panel">${p.comps.map((c) => `<div class="sc-comp">
      <div class="sc-comp-name">${esc(c.name)}</div>
      <select data-cell="D${c.row}" aria-label="${esc(c.name)} score">${opts(c.score)}</select>
      <button type="button" class="sc-note${c.note ? '' : ' empty'}" data-note="E${c.row}" title="${esc(c.note || 'Add a note')}">${esc(c.note || 'Add note')}</button>
    </div>`).join('')}</div></section>`;

  document.getElementById('scBody').innerHTML = summary + kpis + comps + scRubricHtml();
  if (keep && SC.current === name) {
    let el = document.querySelector(`#scBody [data-cell="${keep.cell}"]`);
    if (el && keep.tag !== el.tagName) el = keep.tag === 'TEXTAREA' ? scOpenNote(document.querySelector(`#scBody [data-note="${keep.cell}"]`)) : scOpenValue(el);
    if (el) {
      el.value = keep.value;
      el.focus();
      try { if (keep.start != null) el.setSelectionRange(keep.start, keep.end); } catch (e) { /* selects */ }
    }
  }
}

// Turn a value into an input on click; Enter or leaving the field saves, Esc cancels.
function scOpenValue(btn) {
  if (!btn) return null;
  const input = document.createElement('input');
  input.className = 'sc-in';
  input.dataset.cell = btn.dataset.cell;
  input.dataset.kind = btn.dataset.kind;
  input.value = btn.classList.contains('empty') ? '' : btn.textContent;
  input.placeholder = btn.dataset.kind === 'pct' ? 'e.g. 97' : 'e.g. 1:05';
  input.setAttribute('aria-label', btn.getAttribute('aria-label') || '');
  if (input.value) input.dataset.saved = String(scParse(input.dataset.kind, input.value));   // unchanged → no save
  btn.replaceWith(input);
  input.focus();
  input.select();
  return input;
}
function scOpenNote(btn) {
  if (!btn) return null;
  const ta = document.createElement('textarea');
  ta.dataset.cell = btn.dataset.note;
  ta.className = 'sc-note-edit';
  ta.placeholder = 'Notes / supporting evidence';
  ta.value = btn.classList.contains('empty') ? '' : btn.title;
  btn.replaceWith(ta);
  ta.focus();
  return ta;
}

function scOverridePopover(btn) {
  document.querySelectorAll('.sc-pop').forEach((x) => x.remove());
  const cell = btn.dataset.ovr;                // e.g. N7
  const row = Number(cell.slice(1));
  const p = scParseTab(SC.tabs[SC.current] || []);
  const m = p.months.find((x) => x.row === row);
  const k = SC_KPIS.find((x) => x.ovr === cell[0]);
  const current = m ? scNum(m.ovr[SC_KPIS.indexOf(k)]) : null;
  const pop = document.createElement('div');
  pop.className = 'sc-pop';
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = `<h4>Override ${esc(k.label)} score</h4>
    <div class="row">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${current === n ? 'on' : ''}">${n}</button>`).join('')}</div>
    <textarea placeholder="Why? (saved as the month's override note)">${esc(m ? m.note : '')}</textarea>
    <div class="acts"><button type="button" data-clear>Use rubric</button><span><button type="button" data-cancel>Cancel</button> <button type="button" class="primary" data-save>Save</button></span></div>`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 270, r.left - 100))}px`;
  pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6)}px`;
  let chosen = current;
  pop.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => {
    chosen = Number(b.dataset.n);
    pop.querySelectorAll('[data-n]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const close = () => pop.remove();
  pop.querySelector('[data-cancel]').addEventListener('click', close);
  pop.querySelector('[data-clear]').addEventListener('click', async () => { close(); await scSave(cell, '', btn); });
  pop.querySelector('[data-save]').addEventListener('click', async () => {
    const note = pop.querySelector('textarea').value.trim();
    close();
    if (chosen != null) await scSave(cell, chosen, btn);
    if (m && note !== (m.note || '')) await scSave(`R${row}`, note, null);
  });
  pop.querySelector(current ? `[data-n="${current}"]` : '[data-n="3"]').focus();
}

async function scAddRep(form) {
  const msg = document.getElementById('scAddMsg');
  const name = form.name.value.trim();
  const btn = form.querySelector('button');
  btn.disabled = true;
  msg.textContent = 'Creating…';
  try {
    const data = await scCall({ action: 'addRep', name, role: form.role.value });
    SC.reps = data.reps || []; SC.tabs = data.tabs || {}; SC.rubric = data.rubric || SC.rubric;
    renderScorecard(name);
  } catch (e) {
    msg.textContent = e.message;
    btn.disabled = false;
  }
}

function setupScorecards() {
  document.getElementById('scRefresh')?.addEventListener('click', () => loadScorecards(true));
  const body = document.getElementById('scBody');
  body.addEventListener('submit', (e) => {
    if (e.target.id === 'scAddForm') { e.preventDefault(); scAddRep(e.target); }
  });
  body.addEventListener('click', (e) => {
    const rep = e.target.closest('.sc-rep:not(.sc-add)');
    if (rep) { renderScorecard(rep.dataset.rep); window.scrollTo({ top: document.getElementById('view-scorecards').offsetTop - 70 }); return; }
    const dot = e.target.closest('.sc-dot');
    if (dot) { scOverridePopover(dot); return; }
    const val = e.target.closest('.sc-val');
    if (val) { scOpenValue(val); return; }
    const note = e.target.closest('.sc-note');
    if (note) scOpenNote(note);
  });
  const commit = (el) => {
    const cell = el.dataset.cell;
    if (el.tagName === 'INPUT') {
      const v = scParse(el.dataset.kind, el.value);
      if (v === null) { el.classList.add('err'); el.title = el.dataset.kind === 'pct' ? 'Enter a percentage, e.g. 97' : 'Enter a time, e.g. 1:05'; return; }
      if (el.dataset.saved === String(v)) { el.blur(); return; }
      el.dataset.saved = String(v);
      scSave(cell, v, el);
    } else {
      scSave(cell, el.value, el);
    }
    // Done with this field: once the save lands it re-renders as plain text.
    if (el.tagName !== 'SELECT') el.blur();
  };
  body.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('sc-in') && e.key === 'Enter') { e.preventDefault(); commit(e.target); }
    if (e.key === 'Escape' && e.target.matches('.sc-in:not(.sc-add-in), .sc-note-edit')) { e.target.classList.add('saving'); e.target.blur(); renderScorecard(SC.current); }
  });
  body.addEventListener('change', (e) => { if (e.target.matches('.sc-in:not(.sc-add-in), .sc-comp select, .sc-note-edit')) commit(e.target); });
  // Leaving an unchanged field just puts the value back.
  body.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!t.matches('.sc-in:not(.sc-add-in), .sc-note-edit')) return;
    setTimeout(() => { if (document.body.contains(t) && document.activeElement !== t && !t.classList.contains('saving') && !t.classList.contains('err')) renderScorecard(SC.current); }, 150);
  });
  document.getElementById('scBack').addEventListener('click', renderScorecardList);
  document.addEventListener('click', (e) => {
    const pop = document.querySelector('.sc-pop');
    if (pop && !pop.contains(e.target) && !e.target.closest('.sc-dot')) pop.remove();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.sc-pop').forEach((x) => x.remove()); });
}

// The "CS Scorecards" button sits next to Manager mode and only shows while it's on.
function updateScorecardsButton() {
  let btn = document.getElementById('scorecards-btn');
  const toggle = document.getElementById('manager-toggle');
  if (!btn && toggle) {
    btn = document.createElement('button');
    btn.id = 'scorecards-btn';
    btn.className = 'mgr-btn';
    btn.textContent = '📋 CS Scorecards';
    btn.addEventListener('click', showScorecards);
    toggle.after(btn);
  }
  if (btn) btn.hidden = !overridesUnlocked;
  if (!overridesUnlocked) leaveScorecards();
}
