/* ==========================================================================
   Excluded firms (Manager mode) — take a firm out of the Implementation (IM) and/or
   CSM numbers, e.g. test, internal or partner accounts. Saved to the "Excluded Firms"
   tab of the Support Team Report sheet through the manager-checked web app
   (apps-script/exclusions.gs). The IM sync re-runs about a minute after a change;
   the CSM numbers rebuild straight away. The MRR Report is never affected.
   ========================================================================== */
const EXCL_URL = 'https://script.google.com/macros/s/AKfycbz5hzP2ADpdQVN0bsV6h8TYZgj_snLQWeZgzYsZlDoJhdWv4WysfqlB2D0UX8TXrt9V8g/exec';
const EXCL = { rows: [], loaded: null };
const EXCL_SCOPES = [['IM', 'Implementation only'], ['CSM', 'CSM only'], ['Both', 'Both']];

// "4492", "4492.0" or "4492~|~001Pj…" → "4492".
const exclKey = (v) => { const m = String(v ?? '').trim().match(/^\d+/); return m ? String(parseInt(m[0], 10)) : ''; };

function loadExclusions(force) {
  if (EXCL.loaded && !force) return EXCL.loaded;
  EXCL.loaded = fetchSheetByTitle('Excluded Firms').then((rows) => {
    EXCL.rows = rows.slice(1).map((r) => ({ id: exclKey(r[0]), firm: r[1] || '', scope: r[2] || '', reason: r[3] || '', by: r[4] || '', at: r[5] || '' }))
      .filter((r) => r.id);
  }).catch(() => { EXCL.rows = []; });
  return EXCL.loaded;
}
const exclScopeOf = (id) => (EXCL.rows.find((r) => r.id === exclKey(id)) || {}).scope || '';
const isExcludedFrom = (id, area) => ['Both', area].includes(exclScopeOf(id));

// Drop IM-excluded firms from the Implementation pop-up lists right away; the tiles catch up
// when the sync re-runs.
function exclApplyImpl() {
  IMPL.open = IMPL.open.filter((f) => !isExcludedFrom(f.FirmId, 'IM'));
  IMPL.events = IMPL.events.filter((e) => !isExcludedFrom(e.FirmId, 'IM'));
}

// The "Exclude" button on a firm row — Manager mode only.
function exclButton(id, name, area) {
  if (!overridesUnlocked || !exclKey(id)) return '';
  return `<button type="button" class="excl-btn" data-excl="${esc(exclKey(id))}" data-name="${esc(name || '')}" data-area="${area}" title="Take this firm out of the ${area} numbers">Exclude</button>`;
}
// The "Excluded firms (n)" link at the top of the IM and CSM tabs — Manager mode only.
function exclEntry() {
  return overridesUnlocked ? `<button type="button" class="loop-btn excl-entry" data-excl-list>Excluded firms (${EXCL.rows.length})</button>` : '';
}
function renderExclEntries() {
  const impl = document.getElementById('implExcl');
  if (impl) impl.innerHTML = exclEntry();
  const csm = document.getElementById('csmExcl');
  if (csm) csm.innerHTML = exclEntry();
}

async function exclSave(body) {
  const res = await fetch(EXCL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: AUTH.token }, body)),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Couldn’t save.');
  await loadExclusions(true);
  exclApplyImpl();
  renderExclEntries();
  // CSM rebuilds now; Implementation's totals follow the ChurnZero sync a minute later.
  if (typeof loadCsm === 'function' && CSM.data) loadCsm(true);
  return data;
}

function exclDialog(html, wide) {
  document.getElementById('exclDialog')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'exclDialog';
  wrap.className = 'drill-backdrop excl-backdrop';
  wrap.innerHTML = `<div class="drill ${wide ? '' : 'excl-dialog'}" role="dialog" aria-modal="true">${html}</div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-excl-close]')) wrap.remove(); });
  document.body.appendChild(wrap);
  return wrap;
}

function openExcludeDialog(id, name, area) {
  const wrap = exclDialog(`
    <div class="drill-head"><div><h3>Exclude ${esc(name || 'firm ' + id)}</h3><div class="drill-note">Firm ID ${esc(id)} · leaves the MRR Report untouched</div></div>
      <button type="button" class="drill-close" data-excl-close aria-label="Close">×</button></div>
    <form class="drill-body excl-form">
      <fieldset><legend>Take it out of</legend>
        ${EXCL_SCOPES.map(([v, l]) => `<label><input type="radio" name="scope" value="${v}" ${v === area ? 'checked' : ''}> ${l}</label>`).join('')}
      </fieldset>
      <label>Reason <input name="reason" maxlength="300" placeholder="e.g. internal test account"></label>
      <div class="excl-actions"><button type="button" class="loop-btn" data-excl-close>Cancel</button><button type="submit" class="loop-btn primary">Exclude</button></div>
      <p class="excl-msg muted" hidden></p>
    </form>`);
  const form = wrap.querySelector('form');
  form.reason.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('.excl-msg');
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    msg.hidden = false;
    msg.textContent = 'Saving…';
    const scope = form.scope.value;
    try {
      await exclSave({ action: 'exclude', firmId: id, firm: name, scope, reason: form.reason.value.trim() });
      wrap.remove();
      if (document.getElementById('mrrDrill')) { mrrBack = null; mrrCloseModal(); }   // all the way out, not back to a parent pop-up
      if (typeof closeImplDrill === 'function') closeImplDrill();
      document.body.style.overflow = '';
      exclToast(`${name || 'Firm ' + id} is excluded from ${scope === 'Both' ? 'IM and CSM' : scope}.`
        + (scope !== 'CSM' ? ' Implementation totals update in about a minute.' : ''));
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
    }
  });
}

function openExclusionList() {
  const rows = EXCL.rows.slice().sort((a, b) => a.firm.localeCompare(b.firm));
  const wrap = exclDialog(`
    <div class="drill-head"><div><h3>Excluded firms</h3><div class="drill-note">Taken out of the Implementation and/or CSM numbers · the MRR Report still counts them</div></div>
      <button type="button" class="drill-close" data-excl-close aria-label="Close">×</button></div>
    <div class="drill-body">${rows.length ? `<div class="table-wrap"><table class="drill-table"><thead><tr><th>Firm</th><th>Firm ID</th><th>From</th><th>Reason</th><th>By</th><th>Added</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.firm || '—')}</td><td>${esc(r.id)}</td><td>${esc(r.scope)}</td><td>${esc(r.reason || '—')}</td><td>${esc(r.by.split('@')[0])}</td>
        <td>${r.at ? esc(new Date(r.at).toLocaleDateString()) : '—'}</td><td><button type="button" class="excl-btn" data-unexcl="${esc(r.id)}">Include again</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty-note">No firms are excluded. Use “Exclude” on a firm in an Implementation or CSM pop-up (Manager mode).</div>'}</div>`, true);
  wrap.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-unexcl]');
    if (!b) return;
    b.disabled = true;
    b.textContent = 'Saving…';
    try {
      const r = EXCL.rows.find((x) => x.id === b.dataset.unexcl);
      await exclSave({ action: 'unexclude', firmId: b.dataset.unexcl });
      openExclusionList();
      exclToast(`${(r && r.firm) || 'The firm'} counts again.` + (r && r.scope !== 'CSM' ? ' Implementation totals update in about a minute.' : ''));
    } catch (err) { b.textContent = err.message; }
  });
}

function exclToast(text) {
  document.getElementById('exclToast')?.remove();
  const t = document.createElement('div');
  t.id = 'exclToast';
  t.className = 'excl-toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

function setupExclusions() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-excl]');
    if (b) { e.stopPropagation(); openExcludeDialog(b.dataset.excl, b.dataset.name, b.dataset.area); return; }
    if (e.target.closest('[data-excl-list]')) openExclusionList();
  }, true);
}
