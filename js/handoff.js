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

function handoffField(f) {
  const id = `ho-${f.key}`;
  const req = f.required ? ' required' : '';
  const tag = f.saved ? '' : ' <span class="ho-ph" title="Placeholder question — not saved to ChurnZero yet">placeholder</span>';
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.key}" rows="3" maxlength="4000"${req}></textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${f.key}" class="fb-select"${req}><option value="">Choose…</option>${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
  else if (f.type === 'yesno') input = `<span class="ho-yesno">${['Yes', 'No'].map((o) => `<label><input type="radio" name="${f.key}" value="${o}"${req}> ${o}</label>`).join('')}</span>`;
  else input = `<input id="${id}" name="${f.key}" type="${f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}"${req}>`;
  return `<div class="ho-field" data-forms="${esc(f.forms.join(' '))}"><label for="${id}">${esc(f.label)}${f.required ? ' <b class="ho-req">*</b>' : ''}${tag}</label>${input}</div>`;
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
  const after = f.toSupport ? 'Owner moves to <b>Support</b> (new firm at $400/mo or under).'
    : f.csm ? `<b>${esc(f.csm)}</b> stays the Owner as CSM.` : `Owner stays <b>${esc(f.owner || '—')}</b>.`;
  body.innerHTML = `<form class="ho-form" novalidate>
      <p class="ho-facts">${esc(f.name)} · Firm ${esc(f.firmId)} · ${fmtMoney(f.mrr)}/mo · IM <b>${esc(f.im || '—')}</b><br>${after}</p>
      <fieldset class="ho-outcome"><legend>How did the onboarding end?</legend>
        <div class="ho-seg">${d.outcomes.map((o, i) => `<label><input type="radio" name="outcome" value="${esc(o.status)}" data-form="${o.form}"${i === 0 ? ' checked' : ''}> ${esc(o.label)}</label>`).join('')}</div></fieldset>
      ${d.fields.map(handoffField).join('')}
      <div class="ho-actions"><button type="submit" class="mgr-btn on">Close onboarding &amp; save</button><button type="button" class="mgr-btn" data-ho-cancel>Cancel</button></div>
      <div class="fa-msg" aria-live="polite"></div>
    </form>`;
  const form = body.querySelector('form');
  const showFor = () => {
    const kind = form.querySelector('input[name="outcome"]:checked').dataset.form;
    form.querySelectorAll('.ho-field').forEach((el) => {
      const on = el.dataset.forms.split(' ').includes(kind);
      el.hidden = !on;
      el.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = !on; });
    });
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
      body.innerHTML = `<div class="fa-done"><div class="fa-done-head">${res.confirmed ? '✓ Onboarding closed' : '⏳ Sent to ChurnZero'}</div>
        <p>${esc(f.name)} is marked <b>${esc(res.outcome)}</b>${res.ownerToSupport ? ' and the Owner moved to Support' : ''}.
          ${res.confirmed ? '' : 'ChurnZero hasn’t shown it yet — it can take a minute.'}
          ${res.unsaved ? `${res.unsaved} placeholder answer${res.unsaved === 1 ? ' was' : 's were'} logged but not sent to ChurnZero.` : ''}
          The Implementation numbers update with the next sync.</p>
        <button type="button" class="mgr-btn" data-ho-cancel>Done</button></div>`;
      body.querySelector('[data-ho-cancel]').addEventListener('click', handoffClose);
      IMPL.open = IMPL.open.filter((r) => String(r.FirmId) !== String(firmId));
      document.querySelectorAll(`#impl-drill [data-close-firm="${CSS.escape(String(firmId))}"]`).forEach((b) => { b.closest('tr').classList.add('row-muted'); b.replaceWith(Object.assign(document.createElement('span'), { className: 'muted', textContent: 'Closed' })); });
    } catch (err) {
      msg.className = 'fa-msg err';
      msg.textContent = err.message;
      form.querySelectorAll('button,input,select,textarea').forEach((x) => { x.disabled = x.dataset.was === '1'; });
    }
  });
}
