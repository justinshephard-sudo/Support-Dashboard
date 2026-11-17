/* ==========================================================================
   Renewal prep (CSM tab → Renewals · next 90 days → "Renewal prep" next to a firm).
   Backend: apps-script/call-prep (renewal-prep.js) — the firm's contract, MRR over the last year,
   health and usage, AI credit use, support tickets and Gong calls, plus a brief Claude writes from
   them (through the same Zapier AI as Call prep). Read-only; cached for 12 hours per firm.
   For the firm's CSM / account manager and managers.
   ========================================================================== */

// Firm row on the CSM tab: [name, rep, score, mrr, firmId, done, contractEnd, flags].
function canRenewalPrep(a) {
  if (!a || !a[4]) return false;
  return isManager() || (!!a[1] && a[1] === myRepName([a[1]]));
}

function renewalPrepClose() {
  document.getElementById('renewprep')?.remove();
  document.removeEventListener('keydown', renewalPrepKey);
}
function renewalPrepKey(e) { if (e.key === 'Escape') renewalPrepClose(); }

const RP_LOADING = ['Reading a year of MRR…', 'Checking usage and support tickets…', 'Rewatching the last call…', 'Weighing the risks…', 'Lining up talking points…', 'Almost there…'];

const RP_SECTIONS = [
  ['wins', '🏆', 'Wins to remind them of', 'cp-green', 'Nothing specific to point to — ask what’s working.'],
  ['risks', '⚠️', 'Risks', 'cp-red', 'No red flags in the data.'],
  ['expansion', '🚀', 'Expansion angles', 'cp-purple', ''],
  ['beforeCall', '✅', 'Before the call', 'cp-amber', ''],
];

function rpMoney(v) { return v == null || v === '' ? '—' : fmtMoney(Number(v)); }
function rpDay(s) { return s ? new Date(String(s).length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

// A small bar chart of month-end MRR, oldest to newest.
function rpTrend(months) {
  if (!months || months.length < 2) return '';
  const max = Math.max(...months.map((m) => m.mrr), 1);
  const lbl = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 15).toLocaleDateString('en-US', { month: 'short' });
  return `<div class="rp-trend" role="img" aria-label="MRR by month">${months.map((m, i) => `<span title="${esc(lbl(m.ym))}: ${esc(fmtMoney(m.mrr))}" style="height:${Math.max(4, Math.round((m.mrr / max) * 100))}%"${i === months.length - 1 ? ' class="is-now"' : ''}></span>`).join('')}</div>
    <div class="rp-trend-axis"><small>${esc(lbl(months[0].ym))}</small><small>${esc(lbl(months[months.length - 1].ym))}</small></div>`;
}

function rpChange(now, then) {
  if (then == null || !then) return '';
  const d = now - then, pct = Math.round((d / then) * 100);
  return `<em class="${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${pct}%</em>`;
}

function renewalPrepBody(d) {
  const f = d.facts || {}, p = d.prep || {};
  const days = f.contractEnd ? Math.round((Date.parse(f.contractEnd + 'T12:00:00') - Date.now()) / 864e5) : null;
  const ai = (typeof CSM !== 'undefined' && CSM.data && CSM.data.ai && (CSM.data.ai.firms || []).find((x) => String(x[8]) === String(f.firmId))) || null;
  const risk = String(p.risk || '').toLowerCase();
  const flags = [f.nonRenewing && 'Set not to renew', f.cancelRequested && 'Cancellation requested', f.danger && 'Danger zone',
    f.overdue && `Overdue ${fmtMoney(Number(String(f.overdue).split('|')[0]))}`].filter(Boolean);
  const pills = [
    `📅 Renews ${esc(rpDay(f.contractEnd))}${days != null ? ` · ${days} days` : ''}`,
    f.rep && `👤 ${esc(f.rep)}`,
    f.plan && `🧾 ${esc(f.plan)}`,
    d.lastCall ? `🎧 <a href="${safeUrl(d.lastCall.url)}" target="_blank" rel="noopener">Last call · ${esc(rpDay(d.lastCall.date))}</a>` : '🎧 No Gong call in 6 months',
  ].filter(Boolean);
  const stat = (label, value, note) => `<div class="rp-stat"><span>${esc(label)}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
  const t = f.tickets || {};
  return `<div class="cp-hero rp-hero">
      <div class="cp-hero-text">
        <div class="cp-eyebrow">Renewal prep</div>
        <div class="cp-next">${esc(f.firm || '')} ${p.risk ? `<span class="rp-risk rp-${esc(risk)}">${esc(p.risk)} risk</span>` : ''}</div>
        ${p.oneLiner ? `<p class="cp-one">${esc(p.oneLiner)}</p>` : ''}
        ${p.riskWhy ? `<p class="rp-why">${esc(p.riskWhy)}</p>` : ''}
        <div class="cp-pills">${pills.map((x) => `<span>${x}</span>`).join('')}</div>
      </div>
      <img class="cp-merlin" src="assets/merlin-money.webp" alt="" loading="lazy">
    </div>
    ${flags.length ? `<div class="rp-flags">${flags.map((x) => `<span class="neg">⚑ ${esc(x)}</span>`).join('')}</div>` : ''}
    <section class="rp-facts">
      <div class="rp-mrr">
        <div class="rp-stat"><span>MRR now</span><b>${rpMoney(f.mrrNow)}</b><small>6 mo ${rpMoney(f.mrr6)} ${rpChange(f.mrrNow, f.mrr6)} · 12 mo ${rpMoney(f.mrr12)} ${rpChange(f.mrrNow, f.mrr12)}</small></div>
        ${rpTrend(f.mrrMonths)}
      </div>
      <div class="rp-stats">
        ${stat('Health', f.health ? esc(f.health) : '—', 'churn score · lower is better')}
        ${stat('Usage', esc(f.usage || '—'), `${esc(f.activities30 || 0)} activities · ${esc(f.mattersPerMonth || 0)} matters/mo`)}
        ${stat('Leads', esc(f.leadsPerMonth || '—'), 'per month')}
        ${stat('Merlin AI', ai && ai[2] != null ? ai[2] + '%' : f.ai ? esc(f.ai.credits) : '—', ai && ai[9] ? `${ai[6]} of ${ai[9]} credits (30 days)` : f.ai ? 'credits used, 30 days' : 'no AI add-on')}
        ${stat('Support tickets', esc(t.total || 0), `${t.open || 0} open · ${t.low || 0} rated 3 or lower · 6 months`)}
        ${stat('Customer since', esc(rpDay(f.customerSince)), f.licenses ? `${esc(f.licenses)} licenses` : '')}
      </div>
    </section>
    ${p.agenda && p.agenda.length ? `<section class="cp-agenda"><h4><span>🗺️</span>Renewal call plan</h4><ol>${p.agenda.map((a) => `<li><b>${esc(a.item)}</b>${a.why ? `<span>${esc(a.why)}</span>` : ''}</li>`).join('')}</ol></section>` : ''}
    <div class="cp-grid">${RP_SECTIONS.map((sec) => callPrepCard(sec, p)).join('')}</div>
    ${p.objections && p.objections.length ? `<section class="cp-card cp-blue rp-obj"><h4><span>💬</span>Likely objections</h4>
      <dl>${p.objections.map((o) => `<dt>“${esc(o.objection)}”</dt><dd>${esc(o.response)}</dd>`).join('')}</dl></section>` : ''}
    ${(t.recent || []).length || (f.signals || []).length || (f.contacts || []).length ? `<details class="cp-done rp-more"><summary>Tickets, call signals and contacts</summary>
      ${(t.recent || []).length ? `<h5>Recent support tickets</h5><ul>${t.recent.map((c) => `<li>${esc(rpDay(c.date))} · ${esc(c.title || '(no subject)')} <small>${esc(c.state)}${c.rating ? ` · ${c.rating}/5` : ''}</small></li>`).join('')}</ul>` : ''}
      ${(f.signals || []).length ? `<h5>Call signals</h5><ul>${f.signals.map((s) => `<li>${esc(rpDay(s.date))} · <b>${esc(s.signal)}</b> — ${esc(s.reason)}</li>`).join('')}</ul>` : ''}
      ${(d.calls || []).length ? `<h5>Gong calls</h5><ul>${d.calls.map((c) => `<li><a href="${safeUrl(c.url)}" target="_blank" rel="noopener">${esc(rpDay(c.date))} · ${esc(c.title)}</a></li>`).join('')}</ul>` : ''}
      ${(f.contacts || []).length ? `<h5>Contacts</h5><p>${f.contacts.map((c) => `<span class="cp-chip">${esc(c.name)}${c.title ? ` · ${esc(c.title)}` : ''}</span>`).join(' ')}</p>` : ''}
    </details>` : ''}
    <p class="cp-foot"><span>✨ Written by AI from the account data and the last Gong call ${d.generated ? esc(new Date(d.generated).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}${d.cached ? ' (saved copy)' : ''}</span>
      <button type="button" class="cp-btn" data-rp-regen>↻ Regenerate</button></p>`;
}

async function openRenewalPrep(firmId, name, end) {
  renewalPrepClose();
  const wrap = document.createElement('div');
  wrap.id = 'renewprep';
  wrap.className = 'drill-backdrop cp-backdrop';
  wrap.innerHTML = `<div class="drill cp" role="dialog" aria-modal="true" aria-label="Renewal prep">
      <div class="drill-head"><div><h3>💰 Renewal prep · ${esc(name)}</h3><div class="drill-note">${end ? 'Contract ends ' + esc(rpDay(end)) : ''}</div></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body"></div></div>`;
  document.body.appendChild(wrap);
  document.addEventListener('keydown', renewalPrepKey);
  const body = wrap.querySelector('.drill-body');
  const call = async (payload) => {
    const res = await fetch(CALL_PREP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: AUTH.token, ...payload }) });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'Request failed');
    return d;
  };
  const load = async (regenerate) => {
    body.innerHTML = `<div class="cp-loading"><img src="assets/merlin-detective.webp" alt=""><b>Prepping the renewal</b><span class="cp-loading-msg">${RP_LOADING[0]}</span><small>Usually 30–90 seconds</small></div>`;
    let i = 0;
    const tick = setInterval(() => { const el = body.querySelector('.cp-loading-msg'); if (!el) { clearInterval(tick); return; } el.textContent = RP_LOADING[Math.min(++i, RP_LOADING.length - 1)]; }, 9000);
    try {
      let d = await call({ action: 'renewalPrep', firmId, regenerate: !!regenerate });
      const requestId = d.requestId;
      for (let k = 0; d.pending && k < 60 && document.getElementById('renewprep') === wrap; k++) {
        await new Promise((r) => setTimeout(r, 3000));
        d = await call({ action: 'prepStatus', requestId });
      }
      if (document.getElementById('renewprep') !== wrap) return;
      if (d.pending) throw new Error('it’s taking longer than usual — try again in a minute.');
      body.innerHTML = renewalPrepBody(d);
    } catch (e) {
      if (isSessionError(e)) showSessionBanner(true);
      body.innerHTML = `<div class="error-banner">Couldn’t prepare this renewal: ${esc(e.message)}</div>`;
    } finally { clearInterval(tick); }
  };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('.drill-close')) { renewalPrepClose(); return; }
    if (e.target.closest('[data-rp-regen]')) load(true);
  });
  load(false);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-renew-prep]');
  if (b) { e.preventDefault(); openRenewalPrep(b.dataset.renewPrep, b.dataset.name || '', b.dataset.end || ''); }
});
