/* ==========================================================================
   Call signals — managers only, on the Implementation tab under the calendar. The IMs' Gong calls
   where the customer set off one of the tracked Gong trackers (churn risk, blocked by a bug,
   pushback on the onboarding), with the firm, the rep and what they said.
   Data: the "Call Signals" tab, refreshed hourly by syncCallSignals in apps-script/call-prep.
   ========================================================================== */
const SIG = { rows: null, loading: null, error: '', days: 7, tracker: '', all: false, reviewed: {}, showReviewed: false };
const SIG_TOP = 5;   // calls shown before "Show all"
// Most serious first; also the order of the filter chips.
const SIG_TRACKERS = [
  ['Onboarding – Churn risk', 'Churn risk', 'bad'],
  ['Onboarding – Blocked by a bug', 'Blocked by a bug', 'bad'],
  ['Onboarding – Pushback', 'Pushback', 'okay'],
];
const sigInfo = (name) => SIG_TRACKERS.find(([k]) => k === name) || [name, name, 'none'];
const sigRank = (name) => { const i = SIG_TRACKERS.findIndex(([k]) => k === name); return i < 0 ? 99 : i; };

function loadSignals(force) {
  if (SIG.loading) return SIG.loading;
  if (SIG.rows && !force && Date.now() - SIG.at < 10 * 60000) return Promise.resolve();
  SIG.loading = (async () => {
    try {
      const rows = await fetchTitleFrom(SHEET_ID, 'Call Signals');
      const head = (rows[0] || []).map((h) => String(h).trim());
      SIG.rows = rows.slice(1).map((r) => {
        const o = {};
        head.forEach((h, i) => { o[h] = r[i] == null ? '' : String(r[i]); });
        try { o.quotes = JSON.parse(o.Quotes || '[]'); } catch (e) { o.quotes = []; }
        o.count = Number(o.Count) || 0;
        o.customer = Number(o.CustomerCount) || 0;
        return o;
      });
      SIG.reviewed = {};
      try {
        (await fetchTitleFrom(SHEET_ID, 'Call Signal Reviews')).slice(1).forEach((r) => { if (r[0]) SIG.reviewed[String(r[0]).trim()] = { by: String(r[1] || ''), at: String(r[2] || '') }; });
      } catch (e) { /* no reviews yet */ }
      SIG.at = Date.now();
      SIG.error = '';
    } catch (e) {
      SIG.rows = SIG.rows || [];
      SIG.error = /Unable to parse range|not found/i.test(e.message) ? 'Waiting for the first Gong sync.' : 'Couldn’t load call signals: ' + e.message;
    } finally { SIG.loading = null; }
  })();
  return SIG.loading;
}

// Calls in the window for the rep being viewed (all reps on the whole-team view), newest first.
function sigCalls() {
  const since = new Date(Date.now() - SIG.days * 864e5).toISOString().slice(0, 10);
  const rep = IMPL.rep && IMPL.rep !== IMPL_NONE ? IMPL.rep : '';
  const by = new Map();
  (SIG.rows || []).filter((r) => r.Date.slice(0, 10) >= since && (!rep || r.Rep === rep)).forEach((r) => {
    if (!by.has(r.CallId)) by.set(r.CallId, { id: r.CallId, date: r.Date, rep: r.Rep, firmId: r.FirmId, firm: r.Firm, title: r.CallTitle, url: r.CallUrl, minutes: r.Minutes, hits: [] });
    by.get(r.CallId).hits.push(r);
  });
  const calls = [...by.values()];
  calls.forEach((c) => { c.reviewed = SIG.reviewed[c.id] || null; });
  calls.forEach((c) => c.hits.sort((a, b) => sigRank(a.Tracker) - sigRank(b.Tracker)));
  return calls.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Firms with signals in the last 30 days (for the marker on firm rows).
function sigByFirm() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const m = {};
  (SIG.rows || []).filter((r) => r.FirmId && r.Date.slice(0, 10) >= since && !SIG.reviewed[r.CallId]).forEach((r) => { (m[r.FirmId] = m[r.FirmId] || new Set()).add(r.Tracker); });
  return m;
}
function implSignalMark(row) {
  if (!isManager() || !SIG.rows || !row || !row.FirmId) return '';
  const t = sigByFirm()[row.FirmId];
  if (!t) return '';
  const list = [...t].sort((a, b) => sigRank(a) - sigRank(b));
  const tone = sigInfo(list[0])[2];
  return ` <span class="sig-mark h-${tone}" title="Call signals in the last 30 days: ${esc(list.map((x) => sigInfo(x)[1]).join(', '))}">⚑ ${list.length}</span>`;
}

// The quote with the phrase that set it off highlighted (each word may carry an ending: cancel → cancelling).
function sigQuote(q) {
  const text = String(q.text || '');
  if (!q.phrase) return esc(text);
  const re = new RegExp(q.phrase.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "[a-z']*").join("[^a-z0-9']+"), 'i');
  const m = text.replace(/[’‘]/g, "'").match(re);
  if (!m) return esc(text);
  return esc(text.slice(0, m.index)) + '<mark>' + esc(text.slice(m.index, m.index + m[0].length)) + '</mark>' + esc(text.slice(m.index + m[0].length));
}

const sigClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function renderSignals() {
  const el = document.getElementById('implSignals');
  if (!el) return;
  if (!isManager()) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  if (!SIG.rows) el.innerHTML = '<div class="section-head"><h2>Call signals</h2><span class="rule"></span></div><div class="panel"><div class="res-loading">Loading Gong signals…</div></div>';
  await loadSignals();
  const everything = sigCalls();
  const reviewedN = everything.filter((c) => c.reviewed).length;
  const calls = SIG.showReviewed ? everything : everything.filter((c) => !c.reviewed);
  const counts = {};
  calls.forEach((c) => c.hits.forEach((h) => { counts[h.Tracker] = (counts[h.Tracker] || 0) + 1; }));
  const matching = SIG.tracker ? calls.filter((c) => c.hits.some((h) => h.Tracker === SIG.tracker)) : calls;
  const shown = SIG.all ? matching : matching.slice(0, SIG_TOP);
  const chip = (k, label, n) => `<button type="button" data-sig-tracker="${esc(k)}" aria-pressed="${SIG.tracker === k}">${esc(label)}${n != null ? ` <b>${n}</b>` : ''}</button>`;
  const rep = IMPL.rep && IMPL.rep !== IMPL_NONE ? IMPL.rep : '';
  el.innerHTML = `<div class="section-head"><h2>Call signals</h2><span class="rule"></span>
      <span class="note">${rep ? esc(rep) + ' · ' : 'Every IM · '}Gong trackers on onboarding calls · managers only</span>
      ${reviewedN ? `<button type="button" class="pill-btn sig-rev-toggle" data-sig-showrev>${SIG.showReviewed ? 'Hide reviewed' : `Show reviewed (${reviewedN})`}</button>` : ''}
      <div class="mrr-seg">${[[7, 'This week'], [30, 'Last 30 days']].map(([d, l]) => `<button type="button" data-sig-days="${d}" aria-pressed="${SIG.days === d}">${l}</button>`).join('')}</div></div>
    ${SIG.error ? `<div class="empty-note">${esc(SIG.error)}</div>` : `
    <div class="mrr-seg sig-chips">${chip('', 'All', calls.length)}${SIG_TRACKERS.map(([k, l]) => chip(k, l, counts[k] || 0)).join('')}</div>
    <div class="panel"><div class="table-wrap"><table class="drill-table mrr-table sig-table">
      <thead><tr><th>When</th>${rep ? '' : '<th>IM</th>'}<th>Firm / call</th><th>Signals</th><th>What was said</th><th></th></tr></thead>
      <tbody>${shown.length ? shown.map((c) => {
        const q = c.hits.flatMap((h) => h.quotes.map((x) => ({ ...x, tracker: h.Tracker }))).sort((a, b) => (b.customer - a.customer) || (sigRank(a.tracker) - sigRank(b.tracker)));
        const first = q[0];
        const firmRow = c.firmId ? IMPL.open.find((f) => String(f.FirmId) === String(c.firmId)) : null;
        const who = c.reviewed ? (c.reviewed.by.split('@')[0].split('.')[0] || 'someone') : '';
        return `<tr data-sig-call="${esc(c.id)}"${c.reviewed ? ' class="sig-reviewed"' : ''}>
          <td class="nowrap">${esc(new Date(c.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</td>
          ${rep ? '' : `<td>${esc(c.rep)}</td>`}
          <td>${c.firm ? `<b>${esc(c.firm)}</b>` : '<span class="muted">No firm matched</span>'}<div class="muted sig-title">${c.url ? `<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)} · ${esc(c.minutes)} min</div>
            ${firmRow && canCallPrep(firmRow) ? `<button type="button" class="cp-btn" data-prep-firm="${esc(firmRow.FirmId)}">Call prep</button>` : ''}</td>
          <td>${c.hits.map((h) => `<span class="csm-pill h-${sigInfo(h.Tracker)[2]}">${esc(sigInfo(h.Tracker)[1])}${h.count > 1 ? ' ×' + h.count : ''}</span>`).join(' ')}</td>
          <td class="sig-quote">${first ? `<span class="sig-line" title="${esc(first.text)}"><span class="sig-who">${sigClock(first.t)}</span> “${sigQuote(first)}”</span>` : '<span class="muted">Transcript not ready yet</span>'}
            ${q.length > 1 ? `<details><summary>${q.length - 1} more</summary>${q.slice(1).map((x) => `<p><span class="sig-who">${esc(sigInfo(x.tracker)[1])} · ${sigClock(x.t)}</span> “${sigQuote(x)}”</p>`).join('')}</details>` : ''}</td>
          <td class="nowrap">${c.reviewed
            ? `<span class="sig-rev-by" title="${esc(c.reviewed.by)} · ${esc(c.reviewed.at ? new Date(c.reviewed.at).toLocaleString() : '')}">✓ ${esc(who.charAt(0).toUpperCase() + who.slice(1))}</span> <button type="button" class="pill-btn" data-sig-review="${esc(c.id)}" data-undo="1">Undo</button>`
            : `<button type="button" class="cp-btn" data-sig-review="${esc(c.id)}">Reviewed</button>`}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="${rep ? 5 : 6}" class="empty-note">No flagged calls ${SIG.days === 7 ? 'this week' : 'in the last 30 days'}.</td></tr>`}</tbody>
    </table></div>${matching.length > SIG_TOP ? `<button type="button" class="pill-btn sig-all" data-sig-all>${SIG.all ? 'Show fewer' : `Show all ${matching.length}`}</button>` : ''}</div>
    <p class="impl-note">What customers said that set off the Gong trackers ${SIG_TRACKERS.map(([k]) => `“${esc(k)}”`).join(', ')} on the IMs’ calls. Refreshed hourly. ⚑ on a firm’s row: signals in the last 30 days. Reviewed calls are hidden for every manager and don’t count toward ⚑.</p>`}`;
}

async function sigReview(btn) {
  const id = btn.dataset.sigReview, undo = !!btn.dataset.undo;
  btn.disabled = true;
  try {
    const res = await fetch(CALL_PREP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: AUTH.token, action: 'reviewSignal', callId: id, undo }) });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'failed');
    if (d.dryRun) { btn.textContent = 'Dry run ✓'; return; }
    if (undo) delete SIG.reviewed[id]; else SIG.reviewed[id] = { by: d.by, at: d.at };
    renderSignals();
  } catch (e) {
    btn.disabled = false;
    alert('Couldn’t save that: ' + e.message);
  }
}

function setupSignals() {
  document.addEventListener('click', (e) => {
    const sec = e.target.closest('#implSignals');
    if (!sec) return;
    const d = e.target.closest('[data-sig-days]');
    if (d) { SIG.days = Number(d.dataset.sigDays); renderSignals(); return; }
    const rv = e.target.closest('[data-sig-review]');
    if (rv) { sigReview(rv); return; }
    if (e.target.closest('[data-sig-showrev]')) { SIG.showReviewed = !SIG.showReviewed; renderSignals(); return; }
    if (e.target.closest('[data-sig-all]')) { SIG.all = !SIG.all; renderSignals(); return; }
    const t = e.target.closest('[data-sig-tracker]');
    if (t) { SIG.tracker = t.dataset.sigTracker; renderSignals(); return; }
    const p = e.target.closest('[data-prep-firm]');
    if (p) openCallPrep(IMPL.open.find((f) => String(f.FirmId) === p.dataset.prepFirm));
  });
}
document.addEventListener('DOMContentLoaded', setupSignals);
