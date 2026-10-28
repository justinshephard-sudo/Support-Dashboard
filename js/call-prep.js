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

// One themed card per section; empty sections show a short friendly line (or nothing).
const CP_SECTIONS = [
  ['lastCallRecap', '📝', 'Last call recap', 'cp-blue', 'Nothing notable from the last call.'],
  ['openItems', '🚧', 'Still open', 'cp-red', 'Nothing hanging — nice.'],
  ['firmCommitments', '🤝', 'The firm said they’d…', 'cp-green', 'Nothing promised.'],
  ['ourCommitments', '🧙', 'We said we’d…', 'cp-purple', 'Nothing promised.'],
  ['watchFor', '👀', 'Watch for', 'cp-amber', ''],
];

function callPrepCard([key, icon, title, tone, empty], p) {
  const items = p[key] || [];
  if (!items.length && !empty) return '';
  return `<section class="cp-card ${tone}"><h4><span>${icon}</span>${esc(title)}</h4>
    ${items.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="cp-none">${esc(empty)}</p>`}</section>`;
}

function callPrepBody(d) {
  const p = d.prep || {};
  const when = (s) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
  const pills = [
    d.firm.nextMeeting && `📅 ${esc(d.firm.nextMeeting)}`,
    d.firm.im && `👤 ${esc(d.firm.im)}`,
    d.firm.mrr && `💰 ${fmtMoney(d.firm.mrr)}/mo`,
    d.lastCall ? `🎧 <a href="${safeUrl(d.lastCall.url)}" target="_blank" rel="noopener">Last call · ${esc(when(d.lastCall.date))} · ${d.lastCall.minutes} min</a>` : '🎧 No recording yet',
  ].filter(Boolean);
  return `<div class="cp-hero">
      <div class="cp-hero-text">
        <div class="cp-eyebrow">Up next</div>
        <div class="cp-next">${esc(p.nextCall || 'Next onboarding call')}</div>
        ${p.oneLiner ? `<p class="cp-one">${esc(p.oneLiner)}</p>` : ''}
        <div class="cp-pills">${pills.map((x) => `<span>${x}</span>`).join('')}</div>
      </div>
      <img class="cp-merlin" src="assets/merlin-teacher.webp" alt="" loading="lazy">
    </div>
    ${p.agenda && p.agenda.length ? `<section class="cp-agenda"><h4><span>🗺️</span>Game plan</h4><ol>${p.agenda.map((a) => `<li><b>${esc(a.item)}</b>${a.why ? `<span>${esc(a.why)}</span>` : ''}</li>`).join('')}</ol></section>` : ''}
    ${p.attendees && p.attendees.length ? `<div class="cp-who"><span class="cp-who-label">👥 Who should be there</span>${p.attendees.map((a) => `<span class="cp-chip">${esc(a)}</span>`).join('')}</div>` : ''}
    <div class="cp-grid">${CP_SECTIONS.map((sec) => callPrepCard(sec, p)).join('')}</div>
    <p class="cp-foot"><span>✨ Written by AI from the Gong call ${esc(new Date(d.generated).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${d.cached ? ' (saved copy)' : ''} — double-check anything important against the recording.</span>
      <button type="button" class="cp-btn" data-cp-regen>↻ Regenerate</button></p>`;
}

// Something to look at while Zapier and Claude work (30–60 seconds).
const CP_LOADING = ['Rewatching the last call…', 'Jotting down who promised what…', 'Lining up the game plan…', 'Polishing the agenda…', 'Almost there…'];
function callPrepLoading(body) {
  body.innerHTML = `<div class="cp-loading"><img src="assets/merlin-detective.webp" alt=""><b>Prepping your call</b><span class="cp-loading-msg">${CP_LOADING[0]}</span><small>Usually 30–60 seconds</small></div>`;
  let i = 0;
  const t = setInterval(() => {
    const el = body.querySelector('.cp-loading-msg');
    if (!el) { clearInterval(t); return; }
    el.textContent = CP_LOADING[Math.min(++i, CP_LOADING.length - 1)];
  }, 9000);
}

async function openCallPrep(row) {
  if (!row) return;
  callPrepClose();
  const wrap = document.createElement('div');
  wrap.id = 'callprep';
  wrap.className = 'drill-backdrop cp-backdrop';
  wrap.innerHTML = `<div class="drill cp" role="dialog" aria-modal="true" aria-label="Call prep">
      <div class="drill-head"><div><h3>✨ Call prep · ${esc(row.Name)}</h3><div class="drill-note">${esc(row.Stage || '')}${row.NextMeeting ? ' · next meeting ' + esc(row.NextMeeting) : ''}</div></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body"></div></div>`;
  document.body.appendChild(wrap);
  document.addEventListener('keydown', callPrepKey);
  const body = wrap.querySelector('.drill-body');
  const call = async (payload) => {
    const res = await fetch(CALL_PREP_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: AUTH.token, ...payload }),
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'Request failed');
    return d;
  };
  const load = async (regenerate) => {
    callPrepLoading(body);
    try {
      let d = await call({ action: 'prep', firmId: row.FirmId, stage: row.Stage || '', nextMeeting: row.NextMeeting || '', regenerate: !!regenerate });
      // New preps are written in the background (Zapier); check back every few seconds for up to 3 minutes.
      const requestId = d.requestId;
      for (let i = 0; d.pending && i < 60 && document.getElementById('callprep') === wrap; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        d = await call({ action: 'prepStatus', requestId });
      }
      if (document.getElementById('callprep') !== wrap) return;
      if (d.pending) throw new Error('it’s taking longer than usual — try again in a minute.');
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

/* ---------- "Onboarding complete" (current flow until the IM/CSM handoff form goes live) ----------
   Sets the firm's Onboarding Status to Complete in ChurnZero, then Johnny and Merlin dance. */
DRY_RUN_OK[CALL_PREP_URL] = ['complete'];   // local test: the backend checks everything but writes nothing

function obDoneClose() {
  document.getElementById('obdone')?.remove();
  document.removeEventListener('keydown', obDoneKey);
}
function obDoneKey(e) { if (e.key === 'Escape') obDoneClose(); }

function confirmOnboardingComplete(row, btn) {
  if (!row) return;
  obDoneClose();
  const wrap = document.createElement('div');
  wrap.id = 'obdone';
  wrap.className = 'drill-backdrop cp-backdrop';
  wrap.innerHTML = `<div class="drill ob-confirm" role="dialog" aria-modal="true" aria-label="Onboarding complete">
      <div class="drill-head"><div><h3>Mark onboarding complete?</h3><div class="drill-note">${esc(row.Name)} · ${esc(row.Stage || '')}</div></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body"><p class="ob-text">This sets <b>${esc(row.Name)}</b>’s Onboarding Status to <b>Complete</b> in ChurnZero.</p>
        <div class="ob-actions"><button type="button" class="ob-done-btn ob-go">🎉 Yes, it’s complete</button><button type="button" class="mgr-btn" data-ob-cancel>Cancel</button></div>
        <div class="fa-msg" aria-live="polite"></div></div></div>`;
  document.body.appendChild(wrap);
  document.addEventListener('keydown', obDoneKey);
  wrap.querySelector('.ob-go').focus();
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('.drill-close') || e.target.closest('[data-ob-cancel]')) { obDoneClose(); return; }
    const go = e.target.closest('.ob-go');
    if (!go) return;
    const msg = wrap.querySelector('.fa-msg');
    wrap.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    msg.className = 'fa-msg';
    msg.textContent = 'Updating ChurnZero…';
    try {
      const res = await fetch(CALL_PREP_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: AUTH.token, action: 'complete', firmId: row.FirmId }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'Request failed');
      obDoneClose();
      IMPL.open = IMPL.open.filter((r) => String(r.FirmId) !== String(row.FirmId));
      const tr = btn && btn.closest('tr');
      if (tr) { tr.classList.add('row-muted'); btn.replaceWith(Object.assign(document.createElement('span'), { className: 'ob-done-tag', textContent: d.dryRun ? 'Complete (dry run)' : '✓ Complete' })); }
      obDanceParty(row.Name, d);
    } catch (err) {
      if (isSessionError(err)) showSessionBanner(true);
      msg.className = 'fa-msg err';
      msg.textContent = err.message;
      wrap.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  });
}

// Johnny and Merlin's Woo-Hoo dance (the celebration clip) with confetti. Click anywhere to close.
function obDanceParty(firm, d) {
  ensureCelebrateStyles();
  const layer = document.createElement('div');
  layer.className = 'cb-layer ob-party';
  layer.title = 'Click anywhere to close';
  layer.innerHTML = `<div class="cb-stage">
      <video class="cb-star cb-star-video" muted playsinline loop autoplay aria-hidden="true">
        <source src="assets/merlin-woohoo.mov?v=5" type='video/quicktime; codecs="hvc1"'><source src="assets/merlin-woohoo.webm?v=5" type="video/webm"></video>
      <div class="eyebrow cb-eyebrow">Onboarding complete${d.preview ? ' · preview' : d.dryRun ? ' · dry run' : ''}</div>
      <div class="cb-headline pop">${esc(firm)}</div>
      <div class="cb-sub">${d.preview ? 'Just a preview — no firm was touched.' : d.dryRun ? 'Local test — nothing was written to ChurnZero.' : d.confirmed ? 'Marked Complete in ChurnZero. Nice work!' : 'Sent to ChurnZero — it can take a minute to show.'}</div>
    </div>`;
  document.body.appendChild(layer);
  cbRain(layer, 120, 8);
  cbCannon(layer, 6); cbCannon(layer, 94);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    layer.classList.add('out');
    setTimeout(() => layer.remove(), 450);
  };
  layer.addEventListener('click', close);
  setTimeout(close, 9000);
}
