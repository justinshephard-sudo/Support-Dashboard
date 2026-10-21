/* ==========================================================================
   New Firm Assignment (managers; shows with Manager mode on).
   Live from ChurnZero through apps-script/firm-assignment: new firms nobody
   owns yet, a suggested AM for each (with the reasons), and Approve / change.
   Assign writes the owner + Onboarding Type = Premium in ChurnZero and logs
   suggested vs chosen, so we can see how often the suggestion is trusted
   before switching to auto-assign.
   ========================================================================== */
const ASSIGN_URL = 'https://script.google.com/macros/s/AKfycbxkDLI7ldy0AtXq4iUjDB0b4MAdzkzJ0QSditt1sxFReXnoo5JPg8HzrC4feE1-flXyvg/exec';
const ASSIGN_EMAILS = MANAGER_EMAILS;
// ChurnZero account page; {id} = the ChurnZero account Id.
const CZ_ACCOUNT_URL = 'https://lawmatics.us1app.churnzero.net/#/app/account/{id}/details';
const ASSIGN_PLAY = 'Onboarding New Customer Kickoff';
const FA = { data: null, loading: false, done: {} };

function canAssign() {
  return !!AUTH.email && ASSIGN_EMAILS.includes(AUTH.email.toLowerCase());
}

async function faCall(body) {
  const res = await fetch(ASSIGN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: AUTH.token }, body)),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadAssign(force) {
  if (FA.loading) return;
  FA.loading = true;
  const err = document.getElementById('faError');
  err.hidden = true;
  document.getElementById('faRefresh')?.classList.add('spin');
  if (!FA.data) document.getElementById('faBody').innerHTML = '<div class="res-loading">Checking ChurnZero for new firms…</div>';
  try {
    FA.data = await faCall({ action: 'load', force: !!force });
    renderAssign();
  } catch (e) {
    if (isSessionError(e)) showSessionBanner(true);
    err.textContent = 'Couldn’t load from ChurnZero: ' + e.message;
    err.hidden = false;
    if (!FA.data) document.getElementById('faBody').innerHTML = '';
  } finally {
    FA.loading = false;
    document.getElementById('faRefresh')?.classList.remove('spin');
  }
}

const faDaysAgo = (d) => {
  if (!d) return 'just now (no start date in ChurnZero yet)';
  const n = Math.round((Date.now() - new Date(d + 'T12:00:00')) / 864e5);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
};
const faCzLink = (id) => CZ_ACCOUNT_URL.replace('{id}', encodeURIComponent(id));

function faReadiness(f) {
  const ob = f.onboardingContacts || [];
  const contactPill = ob.length
    ? `<span class="fa-chk ok" title="${esc(ob.join(', '))}">✓ Onboarding contact: ${esc(ob.length === 1 ? ob[0] : ob.length + ' contacts')}</span>`
    : `<span class="fa-chk miss fa-chk-block" title="${esc((f.contacts || []).map((c) => c.name).join(', ') || 'No contacts on this account')}">! No onboarding contact</span>`;
  const items = [
    ['Intake process', f.notes.intake], ['Key challenges', f.notes.challenges],
    ['Onboarding deck', f.links.deck], ['Docs folder', f.links.docs],
  ];
  return contactPill + items.map(([k, v]) => `<span class="fa-chk ${v ? 'ok' : 'miss'}">${v ? '✓' : '!'} ${esc(k)}</span>`).join('');
}

function faNotes(f) {
  const blocks = [['Intake process', f.notes.intake],
    ['Key challenges', f.notes.challenges], ['AI demo notes', f.notes.aiDemo]].filter(([, v]) => v);
  const links = [f.links.deck && `<a href="${safeUrl(f.links.deck)}" target="_blank" rel="noopener">Onboarding deck ↗</a>`,
    f.links.docs && `<a href="${safeUrl(f.links.docs)}" target="_blank" rel="noopener">Docs folder ↗</a>`].filter(Boolean).join(' · ');
  if (!blocks.length && !links) return '<p class="fa-nonotes">Nothing from sales on this account yet — check with the AE before assigning.</p>';
  return `<details class="fa-notes"><summary>Notes from sales</summary>
      ${blocks.map(([k, v]) => `<h4>${esc(k)}</h4><p>${esc(v)}</p>`).join('')}
      ${links ? `<p class="fa-links">${links}</p>` : ''}
    </details>`;
}

function faWhy(r) {
  return `${r.open} open onboarding${r.open === 1 ? '' : 's'} · last new firm ${r.daysSince === 0 ? 'today' : r.daysSince + 'd ago'} · ${r.firms} firms · ${fmtMoney(r.openMrr)} onboarding MRR`;
}

function faScoreTip(r, f) {
  const p = r.parts;
  const row = (label, pts, max) => `<span class="fa-tip-row"><span>${label}</span><b>${p ? pts : '—'} / ${max}</b></span>`;
  return `<b class="fa-tip-head">Fit score: ${r.score} out of 100</b>
    How strongly ${esc(r.name.split(' ')[0])} fits this firm compared with the other ${f.high ? 'high-MRR ' : ''}AMs in the rotation. Highest score is suggested.
    ${row('Fewest open onboardings', p && p.open, 40)}
    ${row('Longest since last new firm', p && p.since, 30)}
    ${row('Smallest book of firms', p && p.book, 15)}
    ${row('Least onboarding MRR in progress', p && p.value, 15)}
    <span class="fa-tip-foot">On each factor the best AM gets full points and the worst gets 0.</span>`;
}

function faFirmCard(f) {
  const done = FA.done[f.czId];
  const top = f.ranking && f.ranking[0];
  const write = FA.data.canWrite;
  const noContact = !(f.onboardingContacts || []).length;
  let right;
  if (done) {
    right = `<div class="fa-done">
        <div class="fa-done-head">${done.confirmed ? '✓ Assigned to' : '⏳ Sent to ChurnZero for'} <b>${esc(done.name)}</b></div>
        <p>${done.confirmed ? 'Owner and Premium Onboarding are set.' : 'ChurnZero hasn’t shown the change yet — it can take a minute. Refresh to check.'}
          Next: start <b>${esc(ASSIGN_PLAY)}</b>.</p>
        <a class="mgr-btn fa-go" href="${esc(faCzLink(f.czId))}" target="_blank" rel="noopener">Start play in ChurnZero ↗</a>
      </div>`;
  } else if (!top) {
    right = '<div class="fa-done"><p>No one is in the rotation. Add someone below.</p></div>';
  } else {
    right = `<div class="fa-pick">
        <div class="fa-sugg-lbl">Suggested</div>
        <div class="fa-sugg"><span class="fa-sugg-name">${esc(top.name)}</span>${top.partnerRule
          ? '<span class="fa-score fa-partner-rule">Partner rule</span>'
          : `<span class="fa-score" tabindex="0" aria-describedby="fa-tip-${f.czId}">${top.score}<span class="fa-tip" role="tooltip" id="fa-tip-${f.czId}">${faScoreTip(top, f)}</span></span>`}</div>
        <div class="fa-why">${top.partnerRule ? `Partner-sourced firm${f.leadSourceDetail ? ' (' + esc(f.leadSourceDetail) + ')' : ''}: partner firms always go to ${esc(top.name.split(' ')[0])}. ` : ''}${esc(faWhy(top))}</div>
        <label class="fa-change">Assign to
          <select class="fa-select" data-cz="${f.czId}">
            ${f.ranking.map((r, i) => `<option value="${r.userId}"${i === 0 ? ' selected' : ''}>${esc(r.name)} — ${r.partnerRule ? 'partner rule' : r.outside ? (f.high ? 'standard tier' : 'high-MRR tier') : r.score}${i === 0 ? ' (suggested)' : ''}</option>`).join('')}
          </select>
        </label>
        <div class="fa-why fa-why-alt" hidden></div>
        <div class="fa-actions">
          <button type="button" class="mgr-btn on fa-assign" data-cz="${f.czId}"${!write ? ' disabled title="ChurnZero write access isn’t set up yet"' : noContact ? ' disabled title="Needs a contact with Include in Onboarding on"' : ''}>Approve &amp; assign</button>
          <a class="mgr-btn" href="${esc(faCzLink(f.czId))}" target="_blank" rel="noopener">Open in ChurnZero ↗</a>
        </div>
        <div class="fa-msg${noContact ? ' err' : ''}" aria-live="polite">${noContact ? `Can’t assign yet: turn on <b>Include in Onboarding</b> for at least one contact${(f.contacts || []).length ? ` (${esc(f.contacts.map((c) => c.name).join(', '))})` : ''} in ChurnZero, then Refresh.` : ''}</div>
      </div>`;
  }
  return `<article class="fa-firm ${done ? 'is-done' : noContact ? 'is-blocked' : 'is-ready'}" data-cz="${f.czId}">
      <div class="fa-left">
        <div class="fa-firm-head">
          <h3>${esc(f.name)}</h3>
          ${f.partner ? `<span class="fa-flag fa-partner">Partner: ${esc(f.leadSourceDetail || 'not named in Salesforce')}</span>` : ''}
          ${f.high ? `<span class="fa-flag fa-high">High MRR${f.tierFallback ? ' · no high-MRR AM in rotation' : ''}</span>` : ''}
          ${f.flags.map((x) => `<span class="fa-flag">${esc(x)}</span>`).join('')}
        </div>
        <div class="fa-facts">
          <span><b>${fmtMoney(f.mrr)}</b>/mo</span>
          <span>Firm ID <b>${esc(f.firmId || '—')}</b></span>
          <span>Came in <b>${esc(faDaysAgo(f.start))}</b></span>
          ${f.ae ? `<span>AE <b>${esc(f.ae)}</b></span>` : ''}
          ${f.leadSource ? `<span>Lead source <b>${esc(f.leadSource)}${f.leadSourceDetail ? ' · ' + esc(f.leadSourceDetail) : ''}</b></span>` : ''}
          ${f.licenses ? `<span><b>${esc(f.licenses)}</b> licenses</span>` : ''}
          ${f.practice ? `<span>${esc(f.practice)}</span>` : ''}
          ${f.type ? `<span>Type <b>${esc(f.type)}</b></span>` : ''}
        </div>
        <div class="fa-ready">${faReadiness(f)}</div>
        ${faNotes(f)}
      </div>
      ${right}
    </article>`;
}

function renderAssign() {
  const d = FA.data;
  const body = document.getElementById('faBody');
  const queue = d.queue || [];
  const open = queue.filter((f) => !FA.done[f.czId]);
  const ready = open.filter((f) => (f.onboardingContacts || []).length).length;
  const blocked = open.length - ready;
  const { took = 0, judged = 0 } = d.stats || {};
  const maxOpen = Math.max(1, ...(d.reps || []).map((r) => r.open));

  document.getElementById('faHero').innerHTML = `
    <div class="fa-hero-text">
      <div class="loop-eyebrow">Manager mode · Onboarding</div>
      <h2>New Firm <span>Assignment</span></h2>
      <p>${open.length ? 'Suggestions balance open onboardings, time since each AM’s last new firm, book size and onboarding MRR.' : 'All caught up — every new firm has an owner.'}</p>
      <div class="loop-stats">
        <div class="loop-stat"><b>${open.length}</b><span>Waiting for an owner</span></div>
        <div class="loop-stat s-closed"><b>${ready}</b><span>Ready to assign</span></div>
        <div class="loop-stat s-open"><b>${blocked}</b><span>Need an onboarding contact</span></div>
        <div class="loop-stat s-in-progress"><b>${judged ? Math.round((took / judged) * 100) + '%' : '—'}</b><span>Suggestions taken</span></div>
      </div>
      <div class="loop-actions"><button type="button" class="loop-btn" id="faRefresh">↻ Refresh</button></div>
    </div>
    <div class="fa-hero-art">
      <div class="loop-bubble">${open.length ? `${open.length} new firm${open.length === 1 ? '' : 's'} to match up!` : 'Nothing to assign. Coffee time.'}</div>
      <img src="assets/merlin-teacher.webp" alt="Merlin the teacher" loading="lazy">
    </div>`;

  body.innerHTML = `
    ${d.canWrite ? '' : `<div class="fa-banner">Suggestion mode: ChurnZero write access isn’t connected yet, so use <b>Open in ChurnZero</b> to assign. Approve &amp; assign turns on once it is.</div>`}
    <section class="fa-panel">
      <div class="fa-panel-head"><h3>New firms</h3><span class="loop-count">${open.length}</span></div>
      <div class="fa-queue">${queue.length ? queue.map(faFirmCard).join('') : '<div class="fa-empty">No unassigned new firms in ChurnZero. 🎉</div>'}</div>
    </section>

    <div class="fa-lower">
      <section class="fa-panel">
        <div class="fa-panel-head"><h3>Rotation</h3><span class="fa-panel-note">AMs with an open onboarding. Untick anyone who’s out.</span></div>
        <form class="fa-tier" id="faTierForm">High-MRR tier: firms at
          <label>$<input type="number" min="0" step="50" id="faTierMin" value="${esc(d.highMin)}">/mo</label>+ go only to High-MRR AMs.
          <button type="submit" class="mgr-btn">Save</button></form>
        <div class="fa-reps">${(d.reps || []).map((r) => `<div class="fa-rep${r.included ? '' : ' off'}">
            <div class="fa-rep-head"><span class="fa-av">${esc(r.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>
              <span class="fa-rep-name">${esc(r.name)}${r.high ? '<span class="fa-flag fa-high">High MRR</span>' : ''}</span></div>
            <div class="fa-rep-open"><b>${r.open}</b> open onboardings</div>
            <div class="fa-bar"><span style="width:${Math.round((r.open / maxOpen) * 100)}%"></span></div>
            <div class="fa-rep-facts"><span>Last new firm <b>${r.lastStart ? esc(faDaysAgo(r.lastStart)) : '—'}</b></span><span><b>${r.firms}</b> firms</span><span><b>${fmtMoney(r.openMrr)}</b> in onboarding</span></div>
            <div class="fa-rep-toggles">
              <label><input type="checkbox" class="fa-rot" data-user="${r.id}"${r.included ? ' checked' : ''}> In rotation</label>
              <label><input type="checkbox" class="fa-tierrep" data-user="${r.id}"${r.high ? ' checked' : ''}> High MRR</label>
            </div>
          </div>`).join('')}</div>
      </section>

      <section class="fa-panel">
        <div class="fa-panel-head"><h3>Last 10 assignments</h3>${judged ? `<span class="fa-panel-note">Suggestion taken ${took} of ${judged}</span>` : ''}</div>
        ${(d.recent || []).length ? `<ul class="fa-recent">${d.recent.slice(0, 10).map((l) => `<li>
            <div><b>${esc(l.firm)}</b> → ${esc(l.assigned)}${l.took === 'false' || l.took === 'FALSE' ? ` <span class="fa-flag">changed from ${esc(l.suggested || '—')}</span>` : l.took ? ' <span class="fa-chk ok">✓ suggested</span>' : ''}</div>
            <span>${esc(l.when)} · ${esc(String(l.by).split('@')[0])}${l.confirmed && l.confirmed !== 'yes' ? ' · ' + esc(l.confirmed) : ''}</span>
          </li>`).join('')}</ul>` : '<p class="fa-panel-note fa-pad">Assignments made here will show up here.</p>'}
      </section>
    </div>
    <p class="fa-foot">Live from ChurnZero · checked ${new Date(d.generated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>`;
}

async function faAssign(btn) {
  const czId = Number(btn.dataset.cz);
  const f = FA.data.queue.find((x) => x.czId === czId);
  const card = btn.closest('.fa-firm');
  const sel = card.querySelector('.fa-select');
  const userId = Number(sel.value);
  const pick = f.ranking.find((r) => r.userId === userId);
  const msg = card.querySelector('.fa-msg');
  card.querySelectorAll('button,select').forEach((x) => { x.disabled = true; });
  msg.className = 'fa-msg';
  msg.textContent = `Assigning to ${pick.name}…`;
  try {
    const res = await faCall({
      action: 'assign', czId, externalId: f.externalId, userId,
      suggestedId: f.ranking[0].userId, suggestedName: f.ranking[0].name,
    });
    FA.done[czId] = { name: pick.name, confirmed: res.confirmed };
    renderAssign();
  } catch (e) {
    msg.className = 'fa-msg err';
    msg.textContent = e.message;
    card.querySelectorAll('button,select').forEach((x) => { x.disabled = false; });
  }
}

function showAssign() {
  const stale = FA.data && Date.now() - new Date(FA.data.generated) > 60000;
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
  const v = document.getElementById('view-assign');
  v.classList.add('active');
  v.scrollIntoView({ block: 'start' });
  if (!FA.data) loadAssign(); else { renderAssign(); if (stale) loadAssign(); }
}
function leaveAssign() {
  const v = document.getElementById('view-assign');
  if (!v || !v.classList.contains('active')) return;
  v.classList.remove('active');
  const first = document.querySelector('.tab[data-tab="team"]');
  if (first) first.click();
}

function setupAssign() {
  document.getElementById('faHero').addEventListener('click', (e) => { if (e.target.closest('#faRefresh')) { FA.done = {}; loadAssign(true); } });
  const body = document.getElementById('faBody');
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('.fa-assign');
    if (btn) faAssign(btn);
  });
  body.addEventListener('submit', async (e) => {
    if (e.target.id !== 'faTierForm') return;
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      FA.data = await faCall({ action: 'setTier', min: Number(document.getElementById('faTierMin').value) });
      renderAssign();
    } catch (err) {
      btn.disabled = false;
      const box = document.getElementById('faError');
      box.textContent = 'Couldn’t save the threshold: ' + err.message;
      box.hidden = false;
    }
  });
  body.addEventListener('change', async (e) => {
    const sel = e.target.closest('.fa-select');
    if (sel) {
      const f = FA.data.queue.find((x) => x.czId === Number(sel.dataset.cz));
      const r = f.ranking.find((x) => x.userId === Number(sel.value));
      const card = sel.closest('.fa-firm');
      const alt = card.querySelector('.fa-why-alt');
      const changed = r.userId !== f.ranking[0].userId;
      alt.hidden = !changed;
      alt.textContent = changed ? r.name + ': ' + faWhy(r) : '';
      card.querySelector('.fa-assign').textContent = changed ? `Assign to ${r.name.split(' ')[0]}` : 'Approve & assign';
      return;
    }
    const rot = e.target.closest('.fa-rot, .fa-tierrep');
    if (rot) {
      rot.disabled = true;
      const uid = Number(rot.dataset.user);
      try {
        FA.data = await faCall(rot.classList.contains('fa-rot')
          ? { action: 'setRotation', userId: uid, included: rot.checked }
          : { action: 'setTier', userId: uid, high: rot.checked });
        renderAssign();
      } catch (err) {
        rot.checked = !rot.checked;
        rot.disabled = false;
        const box = document.getElementById('faError');
        box.textContent = 'Couldn’t update the rotation: ' + err.message;
        box.hidden = false;
      }
    }
  });
}

// Sits next to CS Scorecards; managers only, while Manager mode is on.
function updateAssignButton() {
  let btn = document.getElementById('assign-btn');
  const anchor = document.getElementById('scorecards-btn') || document.getElementById('manager-toggle');
  if (!btn && anchor && canAssign()) {
    btn = document.createElement('button');
    btn.id = 'assign-btn';
    btn.className = 'mgr-btn';
    btn.textContent = '🧭 New Firm Assignment';
    btn.addEventListener('click', showAssign);
    anchor.after(btn);
  }
  if (btn) btn.hidden = !(overridesUnlocked && canAssign());
  // Warm it up in the background so the page opens with data already there.
  if (overridesUnlocked && canAssign() && !FA.data && !FA.loading && AUTH.token) loadAssign();
  if (!overridesUnlocked) leaveAssign();
}
