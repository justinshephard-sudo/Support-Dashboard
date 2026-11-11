/* ==========================================================================
   Rep Audits (manager mode) — pick a support rep, run an audit of their last
   30 days: Intercom friction counts + the hardest conversations + their Zoom
   customer calls (AI Companion summaries), written up as a coaching report by
   Claude through the existing call-prep Zapier workflow. Reports are saved on
   the "Rep Audits" tab of the CS Dashboard Data sheet.
   Backend: apps-script/call-prep/rep-audit.js (actions auditList/auditRun/auditGet).
   ========================================================================== */
const RA = { list: null, appId: '', loading: false, open: null, polling: null, starting: null };

async function raCall(body) {
  const res = await fetch(CALL_PREP_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: AUTH.token, ...body }),
  });
  const d = await res.json();
  if (!d.ok) throw new Error(d.error || 'Request failed');
  return d;
}

const raWhen = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const raFirst = (name) => { const f = String(name || '').split(/[ .]/)[0]; return f.charAt(0).toUpperCase() + f.slice(1); };

async function loadAudits() {
  if (RA.loading) return;
  RA.loading = true;
  const body = document.getElementById('raBody');
  if (!RA.list) body.innerHTML = '<div class="res-loading">Loading reps…</div>';
  try {
    const d = await raCall({ action: 'auditList' });
    RA.list = d; RA.appId = d.appId || '';
    if (!RA.open) renderAuditHome();
  } catch (e) {
    if (isSessionError(e)) showSessionBanner(true);
    body.innerHTML = `<div class="error-banner">Couldn’t load Rep Audits: ${esc(e.message)} <button type="button" class="mgr-btn" id="raRetry">Try again</button></div>`;
  }
  RA.loading = false;
}

function renderAuditHome() {
  RA.open = null;
  const d = RA.list;
  const body = document.getElementById('raBody');
  const last = (repId) => d.audits.find((a) => a.adminId === repId);
  body.innerHTML = `
    <div class="ra-reps">
      ${d.reps.map((r) => {
        const a = last(r.id);
        const busy = a && a.status === 'running';
        return `<div class="ra-rep">
          <div class="ra-rep-name">${esc(r.name)}</div>
          <div class="ra-rep-last">${a ? (busy ? '⏳ Audit running…' : a.status === 'done' ? `Last audit ${esc(raWhen(a.requested))}` : '⚠️ Last audit failed') : 'No audits yet'}</div>
          <div class="ra-rep-actions">
            <button type="button" class="mgr-btn on" data-ra-run="${esc(r.id)}"${busy || RA.starting === r.id ? ' disabled' : ''}>${RA.starting === r.id ? 'Starting…' : busy ? 'Running…' : 'Run audit'}</button>
            ${a && (a.status === 'done' || busy) ? `<button type="button" class="pill-btn" data-ra-open="${esc(a.id)}">${busy ? 'Watch' : 'Open latest'}</button>` : ''}
          </div>
        </div>`;
      }).join('') || '<p class="loop-empty">No reps found on the CS team in Intercom.</p>'}
    </div>
    <h3 class="ra-h">Past audits</h3>
    ${d.audits.length ? `<div class="table-wrap"><table class="ra-hist"><thead><tr><th class="txt">Rep</th><th class="txt">Run</th><th class="txt">By</th><th class="txt">Status</th></tr></thead><tbody>
      ${d.audits.map((a) => `<tr data-ra-open="${esc(a.id)}"><td class="txt">${esc(a.rep)}</td><td class="txt">${esc(raWhen(a.requested))}</td><td class="txt">${esc(raFirst(String(a.requestedBy).split('@')[0]))}</td>
        <td class="txt"><span class="ra-st ${esc(a.status)}">${a.status === 'done' ? 'Ready' : a.status === 'running' ? 'Running' : 'Failed'}</span>${a.error ? ` <small>${esc(a.error)}</small>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="loop-empty">Run your first audit above. It takes 2–4 minutes.</p>'}
    <p class="loop-foot">Each audit reads the rep’s last 30 days: every Intercom conversation assigned to them (friction counts), the ~25 hardest ones in full, and the Zoom AI Companion summaries of their customer calls. Managers only.</p>`;
}

async function runAudit(adminId) {
  RA.starting = adminId;
  renderAuditHome();
  try {
    const d = await raCall({ action: 'auditRun', adminId });
    RA.starting = null;
    await openAudit(d.id);
  } catch (e) {
    RA.starting = null;
    if (isSessionError(e)) showSessionBanner(true);
    alert('Couldn’t start the audit: ' + e.message);
    loadAudits();
  }
}

async function openAudit(id) {
  clearTimeout(RA.polling);
  RA.open = id;
  const body = document.getElementById('raBody');
  body.innerHTML = '<div class="res-loading">Opening the audit…</div>';
  let a;
  try { a = (await raCall({ action: 'auditGet', id })).audit; } catch (e) {
    body.innerHTML = `<div class="error-banner">Couldn’t open it: ${esc(e.message)}</div>`; return;
  }
  if (RA.open !== id) return;
  renderAudit(a);
  if (a.status === 'running') RA.polling = setTimeout(() => { if (RA.open === id) openAudit(id); }, 8000);
  else if (RA.list) { const row = RA.list.audits.find((x) => x.id === id); if (row) row.status = a.status; }
}

function raRef(ref, a) {
  const m = String(ref).match(/^(ic|zoom):(.+)$/);
  if (!m) return '';
  if (m[1] === 'ic') {
    const url = RA.appId ? `https://app.intercom.com/a/inbox/${encodeURIComponent(RA.appId)}/inbox/conversation/${encodeURIComponent(m[2])}` : '';
    return url ? `<a class="ra-ref ic" href="${safeUrl(url)}" target="_blank" rel="noopener">💬 ${esc(m[2])}</a>` : `<span class="ra-ref ic">💬 ${esc(m[2])}</span>`;
  }
  const call = ((a.stats && a.stats.calls) || []).find((c) => c.id === m[2]);
  const label = call ? `${call.date ? call.date.slice(5) + ' · ' : ''}${call.topic.replace(/^Success Support Call\s*-\s*/i, '')}` : m[2];
  return `<span class="ra-ref zoom" title="Zoom meeting ${esc(m[2])}">🎥 ${esc(label)}</span>`;
}
const raRefs = (refs, a) => ((refs || []).length ? `<div class="ra-refs">${refs.map((r) => raRef(r, a)).join('')}</div>` : '');

function raSection(title, icon, items, render) {
  if (!items || !items.length) return '';
  return `<section class="ra-sec"><h3>${icon} ${esc(title)}</h3><ul>${items.map(render).join('')}</ul></section>`;
}

function renderAudit(a) {
  const body = document.getElementById('raBody');
  const s = a.stats || {}, r = a.report || {};
  const head = `<div class="ra-head">
      <button type="button" class="mgr-btn" id="raBack">← All reps</button>
      <div><h3>${esc(a.rep)} <span>· last 30 days</span></h3><p>Run ${esc(raWhen(a.requested))} by ${esc(raFirst(String(a.requestedBy).split('@')[0]))}</p></div>
    </div>`;
  if (a.status === 'running') {
    body.innerHTML = head + `<div class="ra-running"><div class="ra-spin"></div><p><b>Auditing ${esc(raFirst(a.rep))}…</b><br>Intercom is read; now pulling Zoom call summaries and writing the report. This page updates on its own — usually 2–4 minutes.</p>
      ${s.conversations != null ? `<p class="loop-muted">${s.conversations} conversations · ${(s.sampled || []).length} read in full · ${s.callsFound || 0} calls on the calendar</p>` : ''}</div>`;
    return;
  }
  if (a.status !== 'done') {
    body.innerHTML = head + `<div class="error-banner">This audit failed: ${esc(a.error || 'unknown error')}. Try running it again.</div>`;
    return;
  }
  const calls = s.calls || [];
  const kpi = (v, l, bad) => `<div class="ra-kpi${bad ? ' bad' : ''}"><b>${v == null ? '—' : esc(String(v))}</b><span>${esc(l)}</span></div>`;
  body.innerHTML = head + `
    <div class="ra-kpis">
      ${kpi(s.conversations, 'Conversations')}
      ${kpi(s.medianFirstReplyMin == null ? null : s.medianFirstReplyMin + 'm', 'Median first reply')}
      ${kpi(s.medianCloseHours == null ? null : s.medianCloseHours + 'h', 'Median time to close')}
      ${kpi(s.csatPct == null ? null : s.csatPct + '%', `CSAT (${s.csatRated || 0} rated${s.excusedRatings ? `, ${s.excusedRatings} excused` : ''})`, s.csatPct != null && s.csatPct < 90)}
      ${kpi((s.reopenedPct ?? 0) + '%', 'Reopened', s.reopenedPct >= 10)}
      ${kpi((s.reassignedPct ?? 0) + '%', 'Reassigned', s.reassignedPct >= 15)}
      ${kpi((s.longThreadPct ?? 0) + '%', 'Long threads (15+ msgs)', s.longThreadPct >= 15)}
      ${kpi(`${calls.filter((c) => c.summary).length}/${calls.length || s.callsFound || 0}`, 'Calls with AI summary')}
    </div>
    ${r.headline ? `<div class="ra-headline">${esc(r.headline)}</div>` : ''}
    <div class="ra-grid">
      ${raSection('Strengths', '💪', r.strengths, (x) => `<li><p>${esc(x.point)}</p>${raRefs(x.refs, a)}</li>`)}
      ${raSection('Friction points', '🧱', r.friction, (x) => `<li><b>${esc(x.theme)}</b><p>${esc(x.detail)}</p>${raRefs(x.refs, a)}</li>`)}
      ${raSection('Knowledge gaps', '📚', r.knowledge_gaps, (x) => `<li><b>${esc(x.topic)}</b><p>${esc(x.detail)}</p>${raRefs(x.refs, a)}</li>`)}
      ${raSection('Product limits (not on the rep)', '🧩', r.product_limits, (x) => `<li><b>${esc(x.issue)}</b><p>${esc(x.detail)}</p>${raRefs(x.refs, a)}</li>`)}
    </div>
    ${r.calls ? `<section class="ra-sec wide"><h3>🎥 Customer calls</h3><p>${esc(r.calls.overview || '')}</p>
      ${(r.calls.observations || []).length ? `<ul>${r.calls.observations.map((x) => `<li><p>${esc(x.point)}</p>${raRefs(x.refs, a)}</li>`).join('')}</ul>` : ''}</section>` : ''}
    ${raSection('Coaching focus', '🎯', r.coaching, (x) => `<li><b>${esc(x.action)}</b><p>${esc(x.why)}</p></li>`).replace('ra-sec', 'ra-sec wide coach')}
    ${raSection('Follow up', '🚩', r.follow_up, (x) => `<li><p>${esc(x.item)}</p>${raRefs(x.refs, a)}</li>`).replace('ra-sec', 'ra-sec wide')}
    <details class="ra-more"><summary>What the audit read</summary>
      ${(s.topTags || []).length ? `<p><b>Top tags:</b> ${s.topTags.map((t) => `${esc(t.tag)} (${t.count})`).join(' · ')}</p>` : ''}
      ${(s.lowRatings || []).length ? `<p><b>Low ratings:</b></p><ul>${s.lowRatings.map((l) => `<li>${raRef('ic:' + l.id, a)} ${'★'.repeat(l.rating)}${l.remark ? ` — “${esc(l.remark)}”` : ''}</li>`).join('')}</ul>` : ''}
      <p><b>Read in full:</b></p><ul>${(s.sampled || []).map((x) => `<li>${raRef('ic:' + x.id, a)} ${esc(x.title || '')} <small>${esc((x.why || []).join(', ') || 'typical')}</small></li>`).join('')}</ul>
      ${calls.length ? `<p><b>Calls:</b></p><ul>${calls.map((c) => `<li>${raRef('zoom:' + c.id, a)} ${c.minutes ? c.minutes + ' min' : ''} ${c.summary ? '' : '<small>(no AI summary)</small>'}</li>`).join('')}</ul>` : '<p>No customer calls found on their calendar.</p>'}
    </details>
    <p class="loop-foot">AI-written from the material above. Treat it as a starting point for the 1:1, not a verdict — click any chip to check the source.</p>`;
}

function showAudits() {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
  const v = document.getElementById('view-audit');
  v.classList.add('active');
  v.scrollIntoView({ block: 'start' });
  if (RA.open) openAudit(RA.open); else loadAudits();
}
function leaveAudits() {
  const v = document.getElementById('view-audit');
  if (!v || !v.classList.contains('active')) return;
  v.classList.remove('active');
  clearTimeout(RA.polling);
  const first = document.querySelector('.tab[data-tab="team"]');
  if (first) first.click();
}

// Sits with the other manager buttons; managers only, while Manager mode is on.
function updateAuditButton() {
  let btn = document.getElementById('audit-btn');
  const anchor = document.getElementById('assign-btn') || document.getElementById('scorecards-btn') || document.getElementById('manager-toggle');
  const allowed = !!AUTH.email && MANAGER_EMAILS.includes(AUTH.email.toLowerCase());
  if (!btn && anchor && allowed) {
    btn = document.createElement('button');
    btn.id = 'audit-btn';
    btn.className = 'mgr-btn';
    btn.textContent = '🔍 Rep Audits';
    btn.addEventListener('click', showAudits);
    anchor.after(btn);
  }
  if (btn) btn.hidden = !(overridesUnlocked && allowed);
  if (!overridesUnlocked) leaveAudits();
}

function setupAudits() {
  const body = document.getElementById('raBody');
  body.addEventListener('click', (e) => {
    const run = e.target.closest('[data-ra-run]');
    if (run) { runAudit(run.dataset.raRun); return; }
    const open = e.target.closest('[data-ra-open]');
    if (open && !e.target.closest('a')) { openAudit(open.dataset.raOpen); window.scrollTo({ top: document.getElementById('view-audit').offsetTop - 70 }); return; }
    if (e.target.closest('#raBack')) { clearTimeout(RA.polling); RA.open = null; if (RA.list) renderAuditHome(); loadAudits(); return; }
    if (e.target.closest('#raRetry')) loadAudits();
  });
  document.getElementById('raRefresh').addEventListener('click', () => { if (RA.open) openAudit(RA.open); else loadAudits(); });
}
