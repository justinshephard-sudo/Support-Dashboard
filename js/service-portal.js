/* ==========================================================================
   Service Portal (Firm Lookup → "Service Portal" on a firm's profile).
   Upgrades for existing firms, through apps-script/service-portal → Salesforce
   (repo service-portal) → Chargebee:
     - quantity increases are applied right away (prorated, invoiced now) and an
       updated contract (amendment PDF) is saved to the Salesforce Account and
       emailed to the Chargebee billing contact;
     - new add-ons become a Chargebee quote on the existing subscription, which
       MattSign sends for signature + payment.
   Only the people in SP_USERS see it (the backend checks the same list).
   ========================================================================== */
const SP_URL = 'https://script.google.com/macros/s/AKfycbywDzVuKaiwpSdun9tA1H2FEbnARC9Qvd0ml4T0BVUgQNgxSGaGzM9_qhDhevbNc8c5Sg/exec';
const SP_USERS = ['justin.shephard@lawmatics.com'];
// Sandbox test firm (Chargebee TEST customer AzqNfpVYhdhNN1TMI, lmtest Account "Justin Shephard Test").
// Shown in Firm Lookup to SP_USERS only, so the portal can be tried without touching a real firm.
const SP_TEST_FIRM = {
  name: 'Justin Shephard Test', firmId: '999002', area: 'Test firm · sandbox only', am: 'Justin Shephard',
  mrr: '336', cb: 'Active', plan: 'premium-2024-USD-Monthly', lic: '3', addons: 'SMS Add-On (1,500)', onb: 'Complete', score: '0', freq: 'Daily',
};
function spAddTestFirm(list) {
  return canUsePortal() && !list.some((f) => f.firmId === SP_TEST_FIRM.firmId) ? [SP_TEST_FIRM, ...list] : list;
}
const SP = { firm: null, data: null, subId: null, qty: {}, adds: [], preview: null, requestId: null, busy: false, primary: null, cc: new Set() };

function canUsePortal() {
  return !!AUTH.email && SP_USERS.includes(AUTH.email.toLowerCase());
}

function spButtonHtml() {
  return canUsePortal() ? '<button type="button" class="sp-open" data-sp-open>🛠 Service Portal</button>' : '';
}

async function spCall(body) {
  const res = await fetch(SP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: AUTH.token, repName: spRepName() }, body)),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function spRepName() {
  try { return (JSON.parse(sessionStorage.getItem('cs-auth') || '{}').name) || ''; } catch (e) { return ''; }
}

const spMoney = (v) => (v == null || v === '' ? '—' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const spNum = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString());
const spNewId = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now() + Math.random().toString(16).slice(2));

/* ---------- dialog ---------- */

function openServicePortal(f) {
  if (!canUsePortal()) return;
  Object.assign(SP, { firm: f, data: null, subId: null, qty: {}, adds: [], preview: null, requestId: null, busy: false });
  document.getElementById('spDialog')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'spDialog';
  wrap.className = 'drill-backdrop sp-backdrop';
  wrap.innerHTML = `<div class="drill sp-dialog" role="dialog" aria-modal="true" aria-labelledby="spTitle">
    <div class="drill-head"><div><h3 id="spTitle">Service Portal · ${esc(f.name)}</h3>
      <div class="drill-note">Upgrade an existing firm: raise quantities now, or quote new add-ons for signature.</div></div>
      <button type="button" class="drill-close" data-sp-close aria-label="Close">×</button></div>
    <div class="drill-body sp-body">
      <form class="sp-firm" data-sp-firm>
        <label>Firm ID <input name="firmId" value="${esc(f.firmId || '')}" inputmode="numeric" autocomplete="off"></label>
        <button type="submit" class="loop-btn sp-ghost">Load</button>
      </form>
      <div id="spMain"></div>
    </div></div>`;
  wrap.addEventListener('click', (e) => {
    if (SP.busy) return;
    if (e.target === wrap || e.target.closest('[data-sp-close]')) wrap.remove();
  });
  wrap.addEventListener('submit', (e) => {
    if (e.target.matches('[data-sp-firm]')) { e.preventDefault(); spLoad(e.target.firmId.value.trim()); }
  });
  wrap.addEventListener('input', spOnInput);
  wrap.addEventListener('click', spOnClick);
  document.body.appendChild(wrap);
  spLoad(f.firmId);
}

async function spLoad(firmId) {
  const main = document.getElementById('spMain');
  if (!firmId) { main.innerHTML = '<div class="error-banner">This firm has no Firm ID, so it can’t be matched to Salesforce.</div>'; return; }
  main.innerHTML = '<div class="res-loading">Loading the subscription from Chargebee…</div>';
  try {
    const data = await spCall({ action: 'load', firmId });
    Object.assign(SP, { data, firmId, qty: {}, adds: [], preview: null, requestId: null, primary: data.defaultContactId || null, cc: new Set() });
    SP.subId = (data.subscriptions[0] || {}).id || null;
    spRender();
  } catch (e) {
    if (typeof isSessionError === 'function' && isSessionError(e)) showSessionBanner(true);
    main.innerHTML = `<div class="error-banner">${esc(e.message)}</div>`;
  }
}

function spSub() {
  return (SP.data.subscriptions || []).find((s) => s.id === SP.subId) || null;
}

/* ---------- render ---------- */

function spRender() {
  const d = SP.data;
  const main = document.getElementById('spMain');
  const sub = spSub();
  const env = d.environment === 'sandbox'
    ? `<div class="sp-env">SANDBOX · Chargebee TEST site${d.emailOverride ? ` · customer emails go to ${esc(d.emailOverride)}` : ''}</div>` : '';
  const head = `${env}<div class="sp-who"><b>${esc(d.account.name)}</b> · Salesforce <a href="${esc(d.salesforceUrl)}/lightning/r/Account/${esc(d.account.id)}/view" target="_blank" rel="noopener">account</a>
    · Chargebee <a href="${esc(d.chargebeeUrl || '')}/d/customers/${esc(d.customer.id)}" target="_blank" rel="noopener">customer</a>
    · Billing contact ${esc(d.customer.billingEmail || 'none in Chargebee')}</div>`;
  if (!sub) {
    main.innerHTML = head + '<div class="empty-note">No active subscription in Chargebee for this firm.</div>' + spHistoryHtml();
    return;
  }
  const picker = d.subscriptions.length > 1
    ? `<label class="sp-pick">Subscription <select data-sp-sub>${d.subscriptions.map((s) => `<option value="${esc(s.id)}" ${s.id === SP.subId ? 'selected' : ''}>${esc(s.id)} · ${esc(s.frequency)} · ${esc(s.status)}</option>`).join('')}</select></label>` : '';
  const facts = [sub.frequency, sub.status !== 'active' ? sub.status : '', sub.contractEnd ? `contract ${sub.contractStart} – ${sub.contractEnd}` : '',
    sub.nextBilling ? `next billing ${sub.nextBilling}` : ''].filter(Boolean).map(esc).join(' · ');
  const notes = [...(sub.blockers || []).map((t) => `<div class="error-banner">${esc(t)}</div>`),
    ...(sub.warnings || []).map((t) => `<div class="sp-warn">⚠ ${esc(t)}</div>`),
    ...(sub.openQuotes || []).map((q) => `<div class="sp-warn">⚠ Open quote #${esc(q.id)} (${esc(q.date)}, ${spMoney(q.total)}) is already waiting on this firm. Chargebee allows one quote per subscription, so new items can't be quoted until it's closed.</div>`)].join('');
  const blocked = (sub.blockers || []).length > 0;

  const rows = sub.items.map((it) => {
    const cur = it.quantity;
    const v = SP.qty[it.itemPriceId] != null ? SP.qty[it.itemPriceId] : cur;
    const input = it.editable && !blocked
      ? `<input type="number" class="sp-qty" min="${cur}" step="1" value="${esc(v)}" data-sp-qty="${esc(it.itemPriceId)}" aria-label="New quantity for ${esc(it.name)}">`
      : `<span class="muted">${it.metered ? 'usage' : '—'}</span>`;
    const changed = it.editable && Number(v) !== Number(cur);
    return `<tr class="${changed ? 'sp-changed' : ''}"><td>${esc(it.name)}</td><td class="num">${it.metered ? '<span class="muted">usage</span>' : spNum(cur)}</td>
      <td class="num">${it.unitPrice != null ? spMoney(it.unitPrice) : ''}</td><td>${input}</td></tr>`;
  }).join('');

  const onSub = new Set(sub.items.map((i) => i.itemPriceId));
  const picked = new Set(SP.adds.map((a) => a.itemPriceId));
  const options = ((d.addable || {})[sub.frequency] || []).filter((a) => !onSub.has(a.itemPriceId));
  const addRows = SP.adds.map((a, i) => {
    const item = options.find((o) => o.itemPriceId === a.itemPriceId) || { name: a.itemPriceId };
    return `<tr class="sp-changed"><td>${esc(item.name)} <span class="sp-tag">NEW</span></td><td class="num">—</td><td class="num">${item.pricingModel === 'PER_UNIT' ? spMoney(item.price) : ''}</td>
      <td><input type="number" class="sp-qty" min="${Math.max(1, item.minQuantity || 1)}" step="1" value="${esc(a.quantity)}" data-sp-addqty="${i}" aria-label="Quantity for ${esc(item.name)}">
      <button type="button" class="sp-x" data-sp-remove="${i}" aria-label="Remove ${esc(item.name)}">×</button></td></tr>`;
  }).join('');
  const addPicker = blocked || !options.length ? '' : `<div class="sp-add">
      <select data-sp-addsel aria-label="Add-on to add"><option value="">+ Add an item…</option>
      ${options.filter((o) => !picked.has(o.itemPriceId)).map((o) => `<option value="${esc(o.itemPriceId)}">${esc(o.name)}${o.pricingModel === 'PER_UNIT' && o.price ? ' · ' + spMoney(o.price) + '/unit' : ''}</option>`).join('')}
      </select></div>`;

  const mode = SP.adds.length ? 'quote' : 'apply';
  main.innerHTML = `${head}${picker}<div class="sp-facts">${facts}</div>${notes}
    <div class="table-wrap"><table class="drill-table sp-table"><thead><tr><th>Item</th><th class="num">Current</th><th class="num">Unit price</th><th>New quantity</th></tr></thead>
    <tbody>${rows}${addRows}</tbody></table></div>
    ${addPicker}
    <label class="sp-note">Note (optional, goes on the record) <input data-sp-note maxlength="200" placeholder="e.g. Intercom conversation link" value="${esc(SP.note || '')}"></label>
    ${mode === 'quote' ? spRecipientsHtml() : ''}
    <div class="sp-mode">${mode === 'quote'
      ? '📝 <b>New items → quote.</b> A Chargebee quote is created on this subscription and attached to a new Opportunity on this account; MattSign sends it to the contact above to sign and pay. Nothing changes until they do.'
      : '⚡ <b>Quantity increase → applied now.</b> Chargebee is updated immediately, the prorated amount is invoiced today, and the updated contract is saved to Salesforce and emailed to the billing contact.'}</div>
    <div class="sp-actions">
      <button type="button" class="loop-btn sp-ghost" data-sp-preview ${blocked || !spHasChanges() ? 'disabled' : ''}>Preview cost</button>
      <button type="button" class="loop-btn primary" data-sp-confirm ${!SP.preview || blocked || (mode === 'quote' && !SP.primary) ? 'disabled' : ''}>${mode === 'quote' ? 'Send quote' : 'Apply change'}</button>
    </div>
    <div id="spPreview">${SP.preview ? spPreviewHtml(SP.preview) : ''}</div>
    <div id="spResult"></div>
    ${spHistoryHtml()}`;
}

// Quote mode: who MattSign emails (contacts on the firm's Salesforce account) and who it comes from.
function spRecipientsHtml() {
  const d = SP.data;
  const contacts = d.contacts || [];
  if (!contacts.length) {
    return '<div class="error-banner">No contacts with an email on this firm\'s Salesforce account. Add one in Salesforce, then reload.</div>';
  }
  const opt = (c) => `${esc(c.name)} · ${esc(c.email)}${c.title ? ' · ' + esc(c.title) : ''}`;
  const sender = d.quoteSender || {};
  return `<div class="sp-recipients">
    <label class="sp-pick">MattSign sends the quote to
      <select data-sp-primary><option value="">Choose a contact…</option>
      ${contacts.map((c) => `<option value="${esc(c.id)}" ${c.id === SP.primary ? 'selected' : ''}>${opt(c)}</option>`).join('')}</select></label>
    ${contacts.length > 1 ? `<div class="sp-cc"><span>CC</span>${contacts.filter((c) => c.id !== SP.primary).map((c) =>
      `<label><input type="checkbox" data-sp-cc="${esc(c.id)}" ${SP.cc.has(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>` : ''}
    <div class="muted sp-mail">Sent from ${esc(sender.name || 'the account owner')}${sender.email ? ` (${esc(sender.email)})` : ''}${sender.isRep ? '' : ', the account owner, because you don\'t have a Salesforce user'}.
      ${d.sendViaMattSign ? '' : '<b>MattSign sending is switched off</b>: the Opportunity and quote are created, but nothing is emailed.'}</div>
  </div>`;
}

function spPreviewHtml(p) {
  const table = (rows, withPeriod) => `<table class="drill-table sp-table"><thead><tr><th>Item</th><th class="num">Qty</th>${withPeriod ? '<th>Period</th>' : ''}<th class="num">Discount</th><th class="num">Pays</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="${r.changed ? 'sp-changed' : ''}"><td>${esc(r.name)}</td><td class="num">${spNum(r.quantity)}</td>${withPeriod ? `<td>${esc(r.period || '')}</td>` : ''}
      <td class="num">${r.discount ? '-' + spMoney(r.discount) : ''}</td><td class="num"><b>${spMoney(r.youPay)}</b></td></tr>`).join('')}</tbody></table>`;
  const to = p.emailOverride ? `${p.emailOverride} (test override for ${p.billingEmail || 'no billing email'})` : (p.billingEmail || 'no billing email in Chargebee!');
  return `<div class="sp-preview">
    <h4>${p.mode === 'quote' ? 'If the firm accepts the quote' : 'Charged today (prorated)'} · ${spMoney(p.dueNowTotal)}</h4>
    ${p.dueNow.length ? table(p.dueNow, true) : '<div class="muted">Nothing due today.</div>'}
    <h4>New recurring amount · ${spMoney(p.recurringTotal)} ${esc((p.frequency || '').toLowerCase())}</h4>
    ${table(p.recurring, false)}
    ${p.mode === 'apply' ? `<div class="muted sp-mail">The amendment will be emailed to ${esc(to)}.</div>` : ''}
  </div>`;
}

function spHistoryHtml() {
  const h = (SP.data && SP.data.history) || [];
  if (!h.length) return '';
  const sf = SP.data.salesforceUrl;
  return `<details class="sp-history"><summary>Recent portal changes (${h.length})</summary>
    <table class="drill-table sp-table"><thead><tr><th>When</th><th>Change</th><th>Status</th><th>By</th><th></th></tr></thead><tbody>
    ${h.map((r) => `<tr><td>${esc(r.when)}</td><td>${esc(r.summary || '')}</td><td>${esc(r.status)}${r.error ? ` <span class="sp-warn-inline" title="${esc(r.error)}">⚠</span>` : ''}</td><td>${esc(r.by || '')}</td>
      <td>${r.fileId ? `<a href="${esc(sf)}/lightning/r/ContentDocument/${esc(r.fileId)}/view" target="_blank" rel="noopener">Amendment ${esc(r.amendment || '')}</a>`
        : r.opportunityId ? `<a href="${esc(sf)}/lightning/r/Opportunity/${esc(r.opportunityId)}/view" target="_blank" rel="noopener">Quote #${esc(r.quoteId)}</a>${r.mattSignStatus ? ` <span class="muted" title="${esc(r.mattSignStatus)}">· ${esc(r.mattSignStatus.split(':')[0])}</span>` : ''}`
        : r.quoteId ? `Quote #${esc(r.quoteId)}` : ''}</td></tr>`).join('')}
    </tbody></table></details>`;
}

/* ---------- interactions ---------- */

function spHasChanges() {
  const sub = spSub();
  if (!sub) return false;
  const qtyChanged = sub.items.some((it) => it.editable && SP.qty[it.itemPriceId] != null && Number(SP.qty[it.itemPriceId]) !== Number(it.quantity));
  return qtyChanged || SP.adds.length > 0;
}

function spPayload(action) {
  const sub = spSub();
  const changes = sub.items.filter((it) => it.editable && SP.qty[it.itemPriceId] != null && Number(SP.qty[it.itemPriceId]) !== Number(it.quantity))
    .map((it) => ({ itemPriceId: it.itemPriceId, quantity: Number(SP.qty[it.itemPriceId]) }));
  const out = { action, firmId: SP.firmId, subscriptionId: SP.subId, changes, adds: SP.adds.map((a) => ({ itemPriceId: a.itemPriceId, quantity: Number(a.quantity) })), note: SP.note || '' };
  if (SP.adds.length) Object.assign(out, { primaryContactId: SP.primary, ccContactIds: [...SP.cc].filter((id) => id !== SP.primary) });
  return out;
}

// Any edit throws away the preview, so what gets confirmed is always what was previewed.
function spInvalidate() {
  SP.preview = null;
  SP.requestId = null;
  const p = document.getElementById('spPreview');
  if (p) p.innerHTML = '';
  const c = document.querySelector('[data-sp-confirm]');
  if (c) c.disabled = true;
  const pv = document.querySelector('[data-sp-preview]');
  if (pv) pv.disabled = !spHasChanges();
  document.querySelectorAll('[data-sp-qty]').forEach((el) => {
    const it = spSub().items.find((i) => i.itemPriceId === el.dataset.spQty);
    el.closest('tr').classList.toggle('sp-changed', !!it && Number(el.value) !== Number(it.quantity));
  });
}

function spOnInput(e) {
  const t = e.target;
  if (t.dataset.spQty) { SP.qty[t.dataset.spQty] = t.value; spInvalidate(); }
  else if (t.dataset.spAddqty != null) { SP.adds[Number(t.dataset.spAddqty)].quantity = t.value; spInvalidate(); }
  else if (t.matches('[data-sp-note]')) { SP.note = t.value; }
}

async function spOnClick(e) {
  const t = e.target;
  if (SP.busy) return;
  if (t.matches('[data-sp-addsel]')) return;
  if (t.closest('[data-sp-remove]')) { SP.adds.splice(Number(t.closest('[data-sp-remove]').dataset.spRemove), 1); SP.preview = null; spRender(); return; }
  if (t.closest('[data-sp-preview]')) { spDoPreview(); return; }
  if (t.closest('[data-sp-confirm]')) { spDoConfirm(); }
}

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-sp-addsel]') && e.target.value) {
    const sub = spSub();
    const item = ((SP.data.addable || {})[sub.frequency] || []).find((o) => o.itemPriceId === e.target.value);
    SP.adds.push({ itemPriceId: e.target.value, quantity: Math.max(1, (item && item.minQuantity) || 1) });
    SP.preview = null;
    spRender();
  } else if (e.target.matches('[data-sp-primary]')) {
    SP.primary = e.target.value || null;
    SP.cc.delete(SP.primary);
    spRender();
  } else if (e.target.matches('[data-sp-cc]')) {
    if (e.target.checked) SP.cc.add(e.target.dataset.spCc); else SP.cc.delete(e.target.dataset.spCc);
  } else if (e.target.matches('[data-sp-sub]')) {
    Object.assign(SP, { subId: e.target.value, qty: {}, adds: [], preview: null });
    spRender();
  }
});

function spSetBusy(on, label) {
  SP.busy = on;
  document.querySelectorAll('#spDialog button, #spDialog input, #spDialog select').forEach((el) => { if (on) el.dataset.wasDisabled = el.disabled; el.disabled = on ? true : el.dataset.wasDisabled === 'true'; });
  const r = document.getElementById('spResult');
  if (r) r.innerHTML = on ? `<div class="res-loading">${esc(label)}</div>` : r.innerHTML;
}

async function spDoPreview() {
  const r = document.getElementById('spResult');
  spSetBusy(true, 'Asking Chargebee what this costs…');
  try {
    SP.preview = await spCall(spPayload('preview'));
    SP.requestId = spNewId();
    r.innerHTML = '';
  } catch (e) {
    SP.preview = null;
    r.innerHTML = `<div class="error-banner">${esc(e.message)}</div>`;
  } finally {
    spSetBusy(false);
    document.getElementById('spPreview').innerHTML = SP.preview ? spPreviewHtml(SP.preview) : '';
    document.querySelector('[data-sp-confirm]').disabled = !SP.preview || (SP.preview.mode === 'quote' && !SP.primary);
  }
}

async function spDoConfirm() {
  const p = SP.preview;
  if (!p || !SP.requestId) return;
  const quote = p.mode === 'quote';
  const lines = p.changes.map((c) => c.isNew ? `+ ${c.name}${c.to ? ' × ' + c.to : ''}` : `${c.name}: ${c.from} → ${c.to}`).join('\n');
  const primary = (SP.data.contacts || []).find((c) => c.id === SP.primary);
  const msg = quote
    ? `Send a quote to ${SP.data.account.name}?\n\n${lines}\n\nDue on acceptance: ${spMoney(p.dueNowTotal)}\nCreates an Opportunity on the account${SP.data.sendViaMattSign ? `; MattSign emails it to ${primary ? primary.name + ' (' + primary.email + ')' : 'the chosen contact'}` : ' (MattSign sending is off, so nothing is emailed)'}.`
    : `Apply this change to ${SP.data.account.name} now?\n\n${lines}\n\nCharged today: ${spMoney(p.dueNowTotal)}\nNew recurring: ${spMoney(p.recurringTotal)}\nThe updated contract is emailed to the billing contact.`;
  if (!window.confirm(msg)) return;
  const r = document.getElementById('spResult');
  spSetBusy(true, quote ? 'Creating the quote in Chargebee…' : 'Updating Chargebee and writing the amendment…');
  let out = null;
  try {
    out = await spCall(Object.assign(spPayload(quote ? 'quote' : 'apply'), { requestId: SP.requestId }));
  } catch (e) {
    spSetBusy(false);
    // Chargebee refused it, so nothing happened: a fresh request id lets a retry actually run (Chargebee replays
    // its answer for a repeated id). Any other error keeps the id, so a retry can never apply the change twice.
    if (/^Chargebee:/.test(e.message)) SP.requestId = spNewId();
    r.innerHTML = `<div class="error-banner">${esc(e.message)} — nothing was changed unless Chargebee shows otherwise. You can try again safely.</div>`;
    return;
  }
  spSetBusy(false);
  const sf = SP.data.salesforceUrl;
  const done = quote
    ? `✅ Quote <b>#${esc(out.quoteId)}</b> created (${spMoney(out.dueNowTotal)} due on acceptance)${out.opportunityId ? ` and attached to a new <a href="${esc(sf)}/lightning/r/Opportunity/${esc(out.opportunityId)}/view" target="_blank" rel="noopener">Opportunity</a>` : ''}.
       ${/^Queued/.test(out.mattSignStatus || '') ? `MattSign is emailing it to ${esc(out.emailedTo)}.` : esc(out.mattSignStatus || '')}`
    : `✅ Applied. ${spMoney(out.dueNowTotal)} invoiced${out.invoiceId ? ` (invoice #${esc(out.invoiceId)})` : ''}. New recurring ${spMoney(out.recurringTotal)}.
       ${out.fileId ? `<a href="${esc(sf)}/lightning/r/ContentDocument/${esc(out.fileId)}/view" target="_blank" rel="noopener">Amendment ${esc(out.amendmentNumber)}</a> saved to Salesforce` : ''}
       ${out.emailedTo ? ` · emailed to ${esc(out.emailedTo)}` : ''}`;
  const problems = out.problems ? `<div class="sp-warn">⚠ ${quote ? '' : 'The change went through, but: '}${esc(out.problems)}</div>` : '';
  const again = out.alreadyDone ? '<div class="muted">This change had already gone through; nothing was done twice.</div>' : '';
  // Reload so the table shows the new quantities, then show the outcome on top.
  await spLoad(SP.firmId);
  const res = document.getElementById('spResult');
  if (res) res.innerHTML = `<div class="sp-done">${done}${again}</div>${problems}`;
  res?.scrollIntoView({ block: 'nearest' });
}
