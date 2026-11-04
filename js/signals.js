/* ==========================================================================
   Call signals — managers only, on the Implementation tab under the calendar. The IMs' Gong calls
   where the customer set off one of the tracked Gong trackers (churn risk, blocked by a bug,
   pushback on the onboarding), with the firm, the rep and what they said.
   Data: the "Call Signals" tab, refreshed hourly by syncCallSignals in apps-script/call-prep.
   ========================================================================== */
const SIG = { rows: null, loading: null, error: '', days: 7, tracker: '', all: false };
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
  calls.forEach((c) => c.hits.sort((a, b) => sigRank(a.Tracker) - sigRank(b.Tracker)));
  return calls.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Firms with signals in the last 30 days (for the marker on firm rows).
function sigByFirm() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const m = {};
  (SIG.rows || []).filter((r) => r.FirmId && r.Date.slice(0, 10) >= since).forEach((r) => { (m[r.FirmId] = m[r.FirmId] || new Set()).add(r.Tracker); });
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

const sigClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function renderSignals() {
  const el = document.getElementById('implSignals');
  if (!el) return;
  if (!isManager()) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  if (!SIG.rows) el.innerHTML = '<div class="section-head"><h2>Call signals</h2><span class="rule"></span></div><div class="panel"><div class="res-loading">Loading Gong signals…</div></div>';
  await loadSignals();
  const calls = sigCalls();
  const counts = {};
  calls.forEach((c) => c.hits.forEach((h) => { counts[h.Tracker] = (counts[h.Tracker] || 0) + 1; }));
  const matching = SIG.tracker ? calls.filter((c) => c.hits.some((h) => h.Tracker === SIG.tracker)) : calls;
  const shown = SIG.all ? matching : matching.slice(0, SIG_TOP);
  const chip = (k, label, n) => `<button type="button" data-sig-tracker="${esc(k)}" aria-pressed="${SIG.tracker === k}">${esc(label)}${n != null ? ` <b>${n}</b>` : ''}</button>`;
  const rep = IMPL.rep && IMPL.rep !== IMPL_NONE ? IMPL.rep : '';
  el.innerHTML = `<div class="section-head"><h2>Call signals</h2><span class="rule"></span>
      <span class="note">${rep ? esc(rep) + ' · ' : 'Every IM · '}Gong trackers on onboarding calls · managers only</span>
      <div class="mrr-seg">${[[7, 'This week'], [30, 'Last 30 days']].map(([d, l]) => `<button type="button" data-sig-days="${d}" aria-pressed="${SIG.days === d}">${l}</button>`).join('')}</div></div>
    ${SIG.error ? `<div class="empty-note">${esc(SIG.error)}</div>` : `
    <div class="mrr-seg sig-chips">${chip('', 'All', calls.length)}${SIG_TRACKERS.map(([k, l]) => chip(k, l, counts[k] || 0)).join('')}</div>
    <div class="panel"><div class="table-wrap"><table class="drill-table mrr-table sig-table">
      <thead><tr><th>When</th>${rep ? '' : '<th>IM</th>'}<th>Firm / call</th><th>Signals</th><th>What was said</th></tr></thead>
      <tbody>${shown.length ? shown.map((c) => {
        const q = c.hits.flatMap((h) => h.quotes.map((x) => ({ ...x, tracker: h.Tracker }))).sort((a, b) => (b.customer - a.customer) || (sigRank(a.tracker) - sigRank(b.tracker)));
        const first = q[0];
        const firmRow = c.firmId ? IMPL.open.find((f) => String(f.FirmId) === String(c.firmId)) : null;
        return `<tr data-sig-call="${esc(c.id)}">
          <td class="nowrap">${esc(new Date(c.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</td>
          ${rep ? '' : `<td>${esc(c.rep)}</td>`}
          <td>${c.firm ? `<b>${esc(c.firm)}</b>` : '<span class="muted">No firm matched</span>'}<div class="muted sig-title">${c.url ? `<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)} · ${esc(c.minutes)} min</div>
            ${firmRow && canCallPrep(firmRow) ? `<button type="button" class="cp-btn" data-prep-firm="${esc(firmRow.FirmId)}">Call prep</button>` : ''}</td>
          <td>${c.hits.map((h) => `<span class="csm-pill h-${sigInfo(h.Tracker)[2]}">${esc(sigInfo(h.Tracker)[1])}${h.count > 1 ? ' ×' + h.count : ''}</span>`).join(' ')}</td>
          <td class="sig-quote">${first ? `<span class="sig-line" title="${esc(first.text)}"><span class="sig-who">${sigClock(first.t)}</span> “${esc(first.text)}”</span>` : '<span class="muted">Transcript not ready yet</span>'}
            ${q.length > 1 ? `<details><summary>${q.length - 1} more</summary>${q.slice(1).map((x) => `<p><span class="sig-who">${esc(sigInfo(x.tracker)[1])} · ${sigClock(x.t)}</span> “${esc(x.text)}”</p>`).join('')}</details>` : ''}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="${rep ? 4 : 5}" class="empty-note">No flagged calls ${SIG.days === 7 ? 'this week' : 'in the last 30 days'}.</td></tr>`}</tbody>
    </table></div>${matching.length > SIG_TOP ? `<button type="button" class="cal-more sig-all" data-sig-all>${SIG.all ? 'Show fewer' : `Show all ${matching.length}`}</button>` : ''}</div>
    <p class="impl-note">What customers said that set off the Gong trackers ${SIG_TRACKERS.map(([k]) => `“${esc(k)}”`).join(', ')} on the IMs’ calls. Refreshed hourly. ⚑ on a firm’s row: signals in the last 30 days.</p>`}`;
}

function setupSignals() {
  document.addEventListener('click', (e) => {
    const sec = e.target.closest('#implSignals');
    if (!sec) return;
    const d = e.target.closest('[data-sig-days]');
    if (d) { SIG.days = Number(d.dataset.sigDays); renderSignals(); return; }
    if (e.target.closest('[data-sig-all]')) { SIG.all = !SIG.all; renderSignals(); return; }
    const t = e.target.closest('[data-sig-tracker]');
    if (t) { SIG.tracker = t.dataset.sigTracker; renderSignals(); return; }
    const p = e.target.closest('[data-prep-firm]');
    if (p) openCallPrep(IMPL.open.find((f) => String(f.FirmId) === p.dataset.prepFirm));
  });
}
document.addEventListener('DOMContentLoaded', setupSignals);
