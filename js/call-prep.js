/* ==========================================================================
   Call prep (Implementation → Open Onboardings → "Call prep" next to a firm).
   Backend: apps-script/call-prep — finds the firm's last Gong call with the rep
   and has Claude write a prep sheet for the next onboarding call, following our
   standard plan for each call. Read-only; cached for 12 hours per firm + call.
   ========================================================================== */
const CALL_PREP_URL = 'https://script.google.com/macros/s/AKfycbwltwhfY4-dLO6F5uyfzxIXIMcb_N0_zrk-2q0atrk_c8fMj4USTTcEJK4QsChbmAVR/exec';

// The firm's IM / account manager, or a manager.
function canCallPrep(row) {
  return !!row && !!row.FirmId && (isManager() || (!!row.AccountManager && row.AccountManager === implMyRepName()));
}

function callPrepClose() {
  document.getElementById('callprep')?.remove();
  document.removeEventListener('keydown', callPrepKey);
}
function callPrepKey(e) { if (e.key === 'Escape') callPrepClose(); }

function callPrepList(title, items, empty) {
  if (!items || !items.length) return empty ? `<section class="cp-sec"><h4>${esc(title)}</h4><p class="cp-none">${esc(empty)}</p></section>` : '';
  return `<section class="cp-sec"><h4>${esc(title)}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`;
}

function callPrepBody(d) {
  const p = d.prep || {};
  const when = (s) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const last = d.lastCall
    ? `Last Gong call: <a href="${safeUrl(d.lastCall.url)}" target="_blank" rel="noopener">${esc(d.lastCall.title)}</a> · ${esc(when(d.lastCall.date))} · ${d.lastCall.minutes} min${d.priorCalls > 1 ? ` · ${d.priorCalls} calls with this firm` : ''}`
    : 'No Gong recording with this firm yet — this prep is based on the stage and the sales notes.';
  return `<div class="cp-head">
      <div class="cp-next">${esc(p.nextCall || 'Next onboarding call')}</div>
      ${p.oneLiner ? `<p class="cp-one">${esc(p.oneLiner)}</p>` : ''}
      <p class="cp-meta">${d.firm.nextMeeting ? `Scheduled ${esc(d.firm.nextMeeting)} · ` : ''}${esc(d.firm.stage || '')} · IM ${esc(d.firm.im || '—')} · ${fmtMoney(d.firm.mrr)}/mo<br>${last}</p>
    </div>
    ${p.agenda && p.agenda.length ? `<section class="cp-sec cp-agenda"><h4>Suggested agenda</h4><ol>${p.agenda.map((a) => `<li><b>${esc(a.item)}</b>${a.why ? `<span>${esc(a.why)}</span>` : ''}</li>`).join('')}</ol></section>` : ''}
    <div class="cp-grid">
      ${callPrepList('Last call recap', p.lastCallRecap, d.lastCall ? 'Nothing notable.' : '')}
      ${callPrepList('Open items & concerns', p.openItems, 'None found.')}
      ${callPrepList('The firm said they’d…', p.firmCommitments, 'Nothing promised.')}
      ${callPrepList('We said we’d…', p.ourCommitments, 'Nothing promised.')}
      ${callPrepList('Who should attend', p.attendees, '')}
      ${callPrepList('Watch for', p.watchFor, '')}
    </div>
    <p class="cp-foot">Generated ${esc(new Date(d.generated).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${d.cached ? ' (saved copy)' : ''} by AI from the Gong transcript — check anything important against the recording.
      <button type="button" class="cp-btn" data-cp-regen>↻ Regenerate</button></p>`;
}

async function openCallPrep(row) {
  if (!row) return;
  callPrepClose();
  const wrap = document.createElement('div');
  wrap.id = 'callprep';
  wrap.className = 'drill-backdrop cp-backdrop';
  wrap.innerHTML = `<div class="drill cp" role="dialog" aria-modal="true" aria-label="Call prep">
      <div class="drill-head"><div><h3>Call prep · ${esc(row.Name)}</h3><div class="drill-note">${esc(row.Stage || '')}${row.NextMeeting ? ' · next meeting ' + esc(row.NextMeeting) : ''}</div></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body"></div></div>`;
  document.body.appendChild(wrap);
  document.addEventListener('keydown', callPrepKey);
  const body = wrap.querySelector('.drill-body');
  const load = async (regenerate) => {
    body.innerHTML = '<div class="res-loading">Reading the last Gong call and writing the prep… this takes about 15–30 seconds.</div>';
    try {
      const res = await fetch(CALL_PREP_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: AUTH.token, action: 'prep', firmId: row.FirmId, stage: row.Stage || '', nextMeeting: row.NextMeeting || '', regenerate: !!regenerate }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'Request failed');
      body.innerHTML = callPrepBody(d);
    } catch (e) {
      if (isSessionError(e)) showSessionBanner(true);
      body.innerHTML = `<div class="error-banner">Couldn’t prepare this call: ${esc(e.message)}</div>`;
    }
  };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('.drill-close')) { callPrepClose(); return; }
    if (e.target.closest('[data-cp-regen]')) load(true);
  });
  load(false);
}
