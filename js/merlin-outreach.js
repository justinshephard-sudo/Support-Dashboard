/* ==========================================================================
   Merlin outreach email (CSM tab → Merlin AI health → "✉️ Email" next to a firm).
   Drafts a check-in from the signed-in CSM to the firm's contacts (from ChurnZero, through the
   call-prep backend's firmContacts): "we noticed you haven't been using Merlin much — can we help?"
   The CSM edits it here and presses Send: it goes out from their own Gmail (Gmail API, gmail.send —
   Google asks once for that permission, the first time they send). "Open in Gmail instead" opens it
   as a Gmail draft. For the firm's CSM and managers.
   ========================================================================== */

// AI health row: [company, rep, usage %, leads, scored, engaged, credits used, add-on MRR, firmId, monthly credits]
function canMerlinEmail(f) { return !!f && !!f[8] && (isManager() || (!!f[1] && f[1] === myRepName([f[1]]))); }

// A short-lived token that can send mail as the signed-in person, asked for only when they press Send
// (Google shows a one-time consent the first time). Must be started from the click itself.
let MO_TOKEN = null;
function moGmailToken() {
  return new Promise((resolve, reject) => {
    if (MO_TOKEN && MO_TOKEN.exp > Date.now() + 60000) { resolve(MO_TOKEN.t); return; }
    if (!(window.google && google.accounts && google.accounts.oauth2)) { reject(new Error('Google sign-in isn’t loaded — reload the page.')); return; }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID, scope: 'https://www.googleapis.com/auth/gmail.send', include_granted_scopes: true, hint: AUTH.email,
      callback: (r) => {
        if (r.error) { reject(new Error('Gmail permission wasn’t given (' + r.error + ').')); return; }
        MO_TOKEN = { t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e && e.type === 'popup_closed' ? 'The Google window was closed before allowing sending.' : 'Google sign-in was blocked: ' + ((e && (e.message || e.type)) || 'unknown'))),
    });
    client.requestAccessToken({ prompt: '' });
  });
}
const moB64 = (s) => btoa(unescape(encodeURIComponent(s)));
async function moSend(to, subject, text) {
  const token = await moGmailToken();
  const mime = [`To: ${to}`, `Subject: =?UTF-8?B?${moB64(subject)}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', moB64(text)].join('\r\n');
  const raw = moB64(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
  if (res.status === 401) { MO_TOKEN = null; throw new Error('Gmail permission expired — press Send again.'); }
  if (!res.ok) {
    let m = ''; try { m = ((await res.json()).error || {}).message || ''; } catch (e) { /* not JSON */ }
    throw new Error(`Gmail said no (HTTP ${res.status})${m ? ': ' + m : ''}`);
  }
  return res.json();
}

function moClose() { document.getElementById('merlinmail')?.remove(); document.removeEventListener('keydown', moKey); }
function moKey(e) { if (e.key === 'Escape') moClose(); }

// The signed-in person's name: their rep name if they have a book, else from their email.
function moSender() {
  const reps = typeof csmReps === 'function' ? csmReps() : [];
  const rep = myRepName(reps);
  if (rep) return rep;
  const local = String(AUTH.email || '').split('@')[0];
  return local.split(/[._]/).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');
}

function moDraft(f, first) {
  const firm = String(f[0] || '').trim();
  const me = moSender();
  const used = Number(f[6]) || 0, quota = Number(f[9]) || 0;
  const usage = !quota ? 'your team hasn’t been using Merlin much lately'
    : used === 0 ? `your team hasn’t used any of your ${quota} monthly Merlin AI credits in the last 30 days`
      : `your team has used ${used} of your ${quota} monthly Merlin AI credits over the last 30 days`;
  return {
    subject: `Getting more out of Merlin at ${firm}`,
    body: `Hi ${first || 'there'},

I’m ${me.split(' ')[0]}, your Customer Success Manager at Lawmatics. I was looking at your account and noticed ${usage}.

I want to make sure you’re getting real value from it. Is anything getting in the way, or are there questions I can answer? Often a quick 20-minute call is all it takes to get lead scoring and follow-ups working the way you want.

Would you have time for a short call this week or next?

Thanks,
${me}
Customer Success Manager, Lawmatics`,
  };
}

async function openMerlinEmail(f) {
  moClose();
  const wrap = document.createElement('div');
  wrap.id = 'merlinmail';
  wrap.className = 'drill-backdrop cp-backdrop';
  wrap.innerHTML = `<div class="drill mo" role="dialog" aria-modal="true" aria-label="Email about Merlin">
      <div class="drill-head"><div><h3>✉️ Merlin check-in · ${esc(f[0])}</h3>
        <div class="drill-note">${f[2] == null ? 'No credit allowance found' : `${f[2]}% of their AI credits used`} · ${esc(String(f[6] || 0))}${f[9] ? ` of ${esc(String(f[9]))}` : ''} credits in 30 days</div></div>
        <button type="button" class="drill-close" aria-label="Close">×</button></div>
      <div class="drill-body"><div class="res-loading">Looking up the firm’s contacts…</div></div></div>`;
  document.body.appendChild(wrap);
  document.addEventListener('keydown', moKey);
  const body = wrap.querySelector('.drill-body');
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.drill-close')) moClose(); });
  let d;
  try {
    const res = await fetch(CALL_PREP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: AUTH.token, action: 'firmContacts', firmId: f[8] }) });
    d = await res.json();
    if (!d.ok) throw new Error(d.error || 'Request failed');
  } catch (e) {
    if (isSessionError(e)) showSessionBanner(true);
    body.innerHTML = `<div class="error-banner">Couldn’t load the firm’s contacts: ${esc(e.message)}</div>`;
    return;
  }
  const contacts = d.contacts || [];
  const firstPick = contacts[0];
  const draft = moDraft(f, firstPick && firstPick.first);
  body.innerHTML = `
    <div class="mo-field"><span class="mo-lbl">To</span>
      ${contacts.length ? `<div class="mo-to">${contacts.map((c, i) => `<label class="mo-contact"><input type="checkbox" value="${esc(c.email)}" data-first="${esc(c.first)}"${i === 0 ? ' checked' : ''}>
        <span><b>${esc((c.first + ' ' + c.last).trim() || c.email)}</b>${c.title || c.role ? ` · ${esc(c.title || c.role)}` : ''}<small>${esc(c.email)}</small></span></label>`).join('')}</div>`
        : '<p class="muted">No contacts with an email address in ChurnZero. Add the address in Gmail.</p>'}
    </div>
    <label class="mo-field"><span class="mo-lbl">Subject</span><input id="moSubject" type="text" value="${esc(draft.subject)}"></label>
    <label class="mo-field"><span class="mo-lbl">Message</span><textarea id="moBody" rows="14">${esc(draft.body)}</textarea></label>
    <div class="mo-actions">
      <button type="button" class="mo-send" id="moSend">Send</button>
      <button type="button" class="mgr-btn" id="moGmail">Open in Gmail instead</button>
      <button type="button" class="mgr-btn" id="moCopy">Copy message</button>
      <span class="mo-msg" aria-live="polite"></span>
    </div>
    <p class="cp-foot"><span>Sends from your own Gmail (${esc(AUTH.email)}) and shows in your Sent folder. The first time, Google asks you to allow sending.</span></p>`;
  const msg = body.querySelector('.mo-msg');
  // Ticking a different first contact swaps the greeting, unless the message was already edited.
  let edited = false;
  body.querySelector('#moBody').addEventListener('input', () => { edited = true; });
  body.addEventListener('change', (e) => {
    if (!e.target.matches('.mo-contact input') || edited) return;
    const first = body.querySelector('.mo-contact input:checked');
    body.querySelector('#moBody').value = moDraft(f, first && first.dataset.first).body;
  });
  const sendBtn = body.querySelector('#moSend');
  let armed = false;
  sendBtn.addEventListener('click', async () => {
    const to = [...body.querySelectorAll('.mo-contact input:checked')].map((x) => x.value);
    const subject = body.querySelector('#moSubject').value.trim(), text = body.querySelector('#moBody').value.trim();
    msg.className = 'mo-msg';
    if (!to.length) { msg.className = 'mo-msg err'; msg.textContent = 'Tick at least one contact (or use Open in Gmail to type an address).'; return; }
    if (!subject || !text) { msg.className = 'mo-msg err'; msg.textContent = 'Add a subject and a message.'; return; }
    // Two clicks: the first shows who it goes to.
    if (!armed) { armed = true; sendBtn.textContent = `Send to ${to.length === 1 ? to[0] : to.length + ' people'}?`; msg.textContent = 'Click again to send.'; return; }
    sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; msg.textContent = '';
    try {
      await moSend(to.join(', '), subject, text);
      sendBtn.textContent = '✓ Sent';
      msg.textContent = `Sent from ${AUTH.email} to ${to.join(', ')}.`;
      body.querySelectorAll('input, textarea, #moGmail').forEach((x) => { x.disabled = true; });
    } catch (e) {
      armed = false; sendBtn.disabled = false; sendBtn.textContent = 'Send';
      msg.className = 'mo-msg err'; msg.textContent = e.message;
    }
  });
  body.addEventListener('input', () => { if (armed) { armed = false; sendBtn.textContent = 'Send'; msg.textContent = ''; } });
  body.querySelector('#moGmail').addEventListener('click', () => {
    const to = [...body.querySelectorAll('.mo-contact input:checked')].map((x) => x.value).join(',');
    const url = 'https://mail.google.com/mail/?' + new URLSearchParams({ view: 'cm', fs: '1', to, su: body.querySelector('#moSubject').value, body: body.querySelector('#moBody').value, authuser: AUTH.email || '' });
    window.open(url, '_blank', 'noopener');
    msg.textContent = to ? 'Opened in Gmail — review and press Send there.' : 'Opened in Gmail — add who it goes to, then Send.';
  });
  body.querySelector('#moCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(body.querySelector('#moBody').value); msg.textContent = 'Message copied.'; }
    catch (e) { body.querySelector('#moBody').select(); msg.textContent = 'Press ⌘C to copy.'; }
  });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-merlin-email]');
  if (!b) return;
  e.preventDefault();
  const f = ((typeof CSM !== 'undefined' && CSM.data && CSM.data.ai && CSM.data.ai.firms) || []).find((x) => String(x[8]) === b.dataset.merlinEmail);
  if (f) openMerlinEmail(f);
});
