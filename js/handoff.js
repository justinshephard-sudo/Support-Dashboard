/* ==========================================================================
   Close onboarding + handoff form (IM/CSM split). Opened from the "Close
   onboarding" button on the Implementation tab's Open Onboardings list.
   Backend: apps-script/firm-assignment/handoff.js (through faCall). Submitting
   sets the onboarding status and completed date, saves the answers to
   ChurnZero, and moves the Owner to Support for new firms at $400/mo or under.
   ========================================================================== */

// The firm's IM (or a manager) can close it. Until the sync keys on the IM field, the IM is the
// open-firm list's Account Manager.
function canCloseOnboarding(row) {
  return isManager() || (!!row.AccountManager && row.AccountManager === implMyRepName());
}

function handoffClose() {
  document.getElementById('handoff')?.remove();
  document.removeEventListener('keydown', handoffKey);
}
function handoffKey(e) { if (e.key === 'Escape') handoffClose(); }

const HO_MOOD = { Positive: '😊', Neutral: '😐', Negative: '😟' };

function handoffField(f, d) {
  const id = `ho-${f.key}`;
  const v = d.values[f.key] || '';
  const req = f.required ? ' required' : '';
  const tag = f.saved ? '' : f.existing ? ' <span class="ho-ph" title="This field exists in ChurnZero; saving it gets connected next">connect next</span>'
    : ' <span class="ho-ph" title="ChurnZero field not created yet — the answer is logged but not saved to ChurnZero">new field</span>';
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.key}" rows="3" maxlength="4000"${req}>${esc(v)}</textarea>`;
  else if (f.type === 'choice') input = `<span class="ho-pills">${f.options.map((o) => `<label class="ho-mood-${o.toLowerCase()}"><input type="radio" name="${f.key}" value="${esc(o)}"${o === v ? ' checked' : ''}${req}> ${HO_MOOD[o] || ''} ${esc(o)}</label>`).join('')}</span>`;
  else if (f.type === 'scale') input = `<span class="ho-scale">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${f.key}" value="${n}"${String(n) === v ? ' checked' : ''}${req}><span>${n}</span></label>`).join('')}</span>`;
  else if (f.type === 'contact') input = d.contacts.length
    ? `<select id="${id}" name="${f.key}" class="fb-select"${req}><option value="">Choose a contact…</option>${d.contacts.map((c) => `<option value="${c.id}"${String(c.id) === v ? ' selected' : ''}>${esc(c.name)}${c.title ? ' · ' + esc(c.title) : ''}${c.dm ? ' (current)' : ''}</option>`).join('')}</select>`
    : `<p class="ho-hint">No contacts on this firm in ChurnZero.</p><input type="hidden" name="${f.key}" value="">`;
  else input = `<input id="${id}" name="${f.key}" type="text" maxlength="4000" value="${esc(v)}"${req}>`;
  const from = f.prefillFrom ? `<span class="ho-from">Started from ${esc(f.prefillFrom)} — edit as needed</span>` : '';
  return `<div class="ho-field ho-t-${f.type}"><label for="${id}">${esc(f.label)}${f.required ? ' <b class="ho-req">*</b>' : ''}${tag}</label>
    ${f.hint ? `<span class="ho-hint">${esc(f.hint)}</span>` : ''}${input}${from}</div>`;
}

async function openHandoff(firmId, name) {
  handoffClose();
  const wrap = document.createElement('div');
  wrap.id = 'handoff';
  wrap.className = 'drill-backdrop ho-backdrop';
  wrap.innerHTML = `<div class="drill ho" role="dialog" aria-modal="true" aria-label="Close onboarding">
      <div class="drill-head"><div><h3>Close onboarding</h3><div class="drill-note">${esc(name || 'Firm ' + firmId)}</div></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body"><div class="res-loading">Checking ChurnZero…</div></div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.drill-close')) handoffClose(); });
  document.addEventListener('keydown', handoffKey);
  const body = wrap.querySelector('.drill-body');
  let d;
  try {
    d = await faCall({ action: 'handoffStart', firmId });
  } catch (e) {
    body.innerHTML = `<div class="error-banner">${esc(e.message)}</div>`;
    return;
  }
  const f = d.firm;
  const after = f.ownerTo === 'csm' ? `Owner moves from ${esc(f.owner || 'the IM')} to the CSM, <b>${esc(f.csm)}</b>.`
    : f.ownerTo === 'support' ? `No CSM on this firm, so the Owner moves to <b>Support</b>.` : `Owner stays <b>${esc(f.owner || '—')}</b> (firm from before the split).`;
  body.innerHTML = `<form class="ho-form" novalidate>
      <p class="ho-facts">${esc(f.name)} · Firm ${esc(f.firmId)} · ${fmtMoney(f.mrr)}/mo · IM <b>${esc(f.im || '—')}</b><br>${after}</p>
      <fieldset class="ho-outcome"><legend>How did the onboarding end?</legend>
        <div class="ho-seg">${d.outcomes.map((o, i) => `<label><input type="radio" name="outcome" value="${esc(o.status)}" data-form="${o.form}"${i === 0 ? ' checked' : ''}> ${esc(o.label)}</label>`).join('')}</div></fieldset>
      <div class="ho-full">${d.sections.map((sec) => `<section class="ho-sec"><h4>${esc(sec.label)}</h4>
        ${d.fields.filter((x) => x.section === sec.key).map((x) => handoffField(x, d)).join('')}</section>`).join('')}</div>
      <p class="ho-none" hidden>No form needed — this just closes the onboarding and moves the Owner.</p>
      <div class="ho-actions"><button type="submit" class="mgr-btn on">Close onboarding &amp; save</button><button type="button" class="mgr-btn" data-ho-cancel>Cancel</button></div>
      <div class="fa-msg" aria-live="polite"></div>
    </form>`;
  const form = body.querySelector('form');
  const showFor = () => {
    const full = form.querySelector('input[name="outcome"]:checked').dataset.form === 'full';
    form.querySelector('.ho-full').hidden = !full;
    form.querySelector('.ho-none').hidden = full;
    form.querySelectorAll('.ho-full input,.ho-full select,.ho-full textarea').forEach((x) => { x.disabled = !full; });
    form.querySelector('[type="submit"]').textContent = full ? 'Close onboarding & save handoff' : 'Close onboarding';
  };
  showFor();
  form.addEventListener('change', (e) => { if (e.target.name === 'outcome') showFor(); });
  form.querySelector('[data-ho-cancel]').addEventListener('click', handoffClose);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('.fa-msg');
    if (!form.checkValidity()) { msg.className = 'fa-msg err'; msg.textContent = 'Fill in the required questions (*).'; form.reportValidity(); return; }
    const data = new FormData(form);
    const answers = {};
    d.fields.forEach((x) => { if (data.has(x.key)) answers[x.key] = data.get(x.key); });
    form.querySelectorAll('button,input,select,textarea').forEach((x) => { x.dataset.was = x.disabled ? '1' : ''; x.disabled = true; });
    msg.className = 'fa-msg';
    msg.textContent = 'Saving to ChurnZero…';
    try {
      const res = await faCall({ action: 'closeOnboarding', firmId, outcome: data.get('outcome'), answers });
      body.innerHTML = `<div class="fa-done"><div class="fa-done-head">${res.dryRun ? '🧪 Dry run' : res.confirmed ? '✓ Onboarding closed' : '⏳ Sent to ChurnZero'}</div>
        <p>${esc(f.name)} is marked <b>${esc(res.outcome)}</b>${res.ownerMovedTo ? ` and the Owner moved to ${esc(res.ownerMovedTo)}` : ''}.
          ${res.dryRun ? `<br><b>Dry run — nothing was written.</b> Would set: ${esc(res.wouldWrite.join(' · '))}.` : res.confirmed ? '' : 'ChurnZero hasn’t shown it yet — it can take a minute.'}
          ${res.unsaved ? `${res.unsaved} answer${res.unsaved === 1 ? ' was' : 's were'} logged but not sent to ChurnZero yet (fields still to be connected).` : ''}
          The Implementation numbers update with the next sync.</p>
        <button type="button" class="mgr-btn" data-ho-cancel>Done</button></div>`;
      body.querySelector('[data-ho-cancel]').addEventListener('click', handoffClose);
      // Johnny and Merlin dance for a completed onboarding (not for never engaged / third party).
      if (res.outcome === 'Complete') obDanceParty(f.name, res);
      if (res.dryRun) return;
      IMPL.open = IMPL.open.filter((r) => String(r.FirmId) !== String(firmId));
      document.querySelectorAll(`#impl-drill [data-close-firm="${CSS.escape(String(firmId))}"]`).forEach((b) => { b.closest('tr').classList.add('row-muted'); b.replaceWith(Object.assign(document.createElement('span'), { className: 'muted', textContent: 'Closed' })); });
    } catch (err) {
      msg.className = 'fa-msg err';
      msg.textContent = err.message;
      form.querySelectorAll('button,input,select,textarea').forEach((x) => { x.disabled = x.dataset.was === '1'; });
    }
  });
}
