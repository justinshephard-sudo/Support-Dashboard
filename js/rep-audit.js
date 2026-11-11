/* ==========================================================================
   Rep Audits (manager mode) — pick a support rep, run an audit of their last
   30 days: Intercom friction counts + the hardest conversations + their Zoom
   customer calls (AI Companion summaries), written up as a coaching report by
   Claude through the existing call-prep Zapier workflow. Reports are saved on
   the "Rep Audits" tab of the CS Dashboard Data sheet.
   Backend: apps-script/call-prep/rep-audit.js (actions auditList/auditRun/auditGet).
   ========================================================================== */
const RA = { list: null, appId: '', loading: false, open: null, polling: null, starting: null, tab: 'support' };
try { RA.tab = localStorage.getItem('cs-ra-tab') === 'im' ? 'im' : 'support'; } catch (e) { /* private mode */ }

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

function raHistory(list) {
  return list.length ? `<div class="table-wrap"><table class="ra-hist"><thead><tr><th class="txt">${RA.tab === 'im' ? 'IM / firm' : 'Rep'}</th><th class="txt">Run</th><th class="txt">By</th><th class="txt">Status</th></tr></thead><tbody>
      ${list.map((a) => `<tr data-ra-open="${esc(a.id)}"><td class="txt">${a.kind === 'firm' ? '🏢 ' : ''}${esc(a.rep)}</td><td class="txt">${esc(raWhen(a.requested))}</td><td class="txt">${esc(raFirst(String(a.requestedBy).split('@')[0]))}</td>
        <td class="txt"><span class="ra-st ${esc(a.status)}">${a.status === 'done' ? 'Ready' : a.status === 'running' ? 'Running' : 'Failed'}</span>${a.error ? ` <small>${esc(a.error)}</small>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="loop-empty">Run your first audit above. It takes 2–4 minutes.</p>';
}

function raRepCard(r, a, runAttr) {
  const busy = a && a.status === 'running';
  return `<div class="ra-rep">
      <div class="ra-rep-name">${esc(r.name)}</div>
      <div class="ra-rep-last">${r.open != null ? `${r.open} open onboarding${r.open === 1 ? '' : 's'} · ` : ''}${a ? (busy ? '⏳ Audit running…' : a.status === 'done' ? `Last audit ${esc(raWhen(a.requested))}` : '⚠️ Last audit failed') : 'No audits yet'}</div>
      <div class="ra-rep-actions">
        <button type="button" class="mgr-btn on" ${runAttr}="${esc(r.id)}"${busy || RA.starting === r.id ? ' disabled' : ''}>${RA.starting === r.id ? 'Starting…' : busy ? 'Running…' : 'Run audit'}</button>
        ${a && (a.status === 'done' || busy) ? `<button type="button" class="pill-btn" data-ra-open="${esc(a.id)}">${busy ? 'Watch' : 'Open latest'}</button>` : ''}
      </div>
    </div>`;
}

function renderAuditHome() {
  RA.open = null;
  const d = RA.list;
  const body = document.getElementById('raBody');
  const last = (key) => d.audits.find((a) => a.adminId === key);
  const tabs = `<div class="res-switch ra-tabs" role="tablist" aria-label="Team">
      <button type="button" role="tab" class="res-switch-btn" data-ra-tab="support" aria-selected="${RA.tab === 'support'}">Support</button>
      <button type="button" role="tab" class="res-switch-btn" data-ra-tab="im" aria-selected="${RA.tab === 'im'}">Implementation</button></div>`;
  if (RA.tab === 'im') {
    const firms = d.imFirms || [];
    const busyFirm = (id) => { const a = last('firm:' + id); return a && a.status === 'running'; };
    body.innerHTML = tabs + `
      ${d.imError ? `<div class="error-banner">${esc(d.imError)}</div>` : ''}
      <div class="ra-reps">
        ${(d.imReps || []).map((r) => raRepCard(r, last(r.id), 'data-ra-run-im')).join('') || '<p class="loop-empty">No AMs with open onboardings found.</p>'}
      </div>
      <div class="ra-firm-pick">
        <div><b>Audit one onboarding</b><span>Reads every call, email, milestone and usage number for a single firm since it started.</span></div>
        <select id="raFirm" aria-label="Firm"><option value="">Pick a firm in onboarding…</option>${firms.map((f) => `<option value="${esc(f.firmId)}" data-name="${esc(f.name)}">${esc(f.name)} · ${esc(f.rep)} · day ${f.days}</option>`).join('')}</select>
        <button type="button" class="mgr-btn on" id="raFirmRun">Audit firm</button>
      </div>
      <h3 class="ra-h">Past implementation audits</h3>
      ${raHistory(d.audits.filter((a) => a.kind === 'im' || a.kind === 'firm'))}
      <p class="loop-foot">An AM audit reads their last 30 days: every firm in their book (stage, days, milestones, product usage), Gong’s summary and talk stats for every call they led, every email thread they sent (reply times), real call signals and onboarding CSAT, plus a closer look at ~6 firms. Good = live in under 70 days; what counts most is progression, adoption and how the calls feel. Managers only.</p>`;
    return;
  }
  body.innerHTML = tabs + `
    ${d.error ? `<div class="error-banner">${esc(d.error)}</div>` : ''}
    <div class="ra-reps">
      ${d.reps.map((r) => raRepCard(r, last(r.id), 'data-ra-run')).join('') || '<p class="loop-empty">No reps found on the CS team in Intercom.</p>'}
    </div>
    <h3 class="ra-h">Past support audits</h3>
    ${raHistory(d.audits.filter((a) => (a.kind || 'support') === 'support'))}
    <p class="loop-foot">Each audit reads the rep’s last 30 days: every Intercom conversation assigned to them (friction counts), the ~25 hardest ones in full, and the Zoom AI Companion summaries of their customer calls. Managers only.</p>`;
}

async function runImAudit(payload, key) {
  RA.starting = key;
  RA.tab = 'im';
  if (RA.list) renderAuditHome();
  try {
    const d = await raCall({ action: 'auditRunIm', ...payload });
    RA.starting = null;
    await openAudit(d.id);
  } catch (e) {
    RA.starting = null;
    if (isSessionError(e)) showSessionBanner(true);
    alert('Couldn’t start the audit: ' + e.message);
    loadAudits();
  }
}

// From Firm Lookup (managers): open Rep Audits and audit this firm's onboarding.
function raAuditFirm(firmId, name) {
  showAudits();
  runImAudit({ firmId: String(firmId), firmName: name || '' }, 'firm:' + firmId);
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
  const m = String(ref).match(/^(ic|zoom|gong|firm):(.+)$/);
  if (!m) return '';
  const st = a.stats || {};
  if (m[1] === 'gong') {
    const c = (st.callList || []).find((x) => x.id === m[2]);
    const label = c ? `${c.date.slice(5)} · ${(st.firmNames || {})[c.firmId] || c.title}` : 'Gong call';
    return c && c.url ? `<a class="ra-ref gong" href="${safeUrl(c.url)}" target="_blank" rel="noopener">📞 ${esc(label)}</a>` : `<span class="ra-ref gong">📞 ${esc(label)}</span>`;
  }
  if (m[1] === 'firm') return `<span class="ra-ref firm">🏢 ${esc((st.firmNames || {})[m[2]] || 'Firm ' + m[2])}</span>`;
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
  if (a.kind === 'im' || a.kind === 'firm') { renderImAudit(a); return; }
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
    const runIm = e.target.closest('[data-ra-run-im]');
    if (runIm) { runImAudit({ repId: runIm.dataset.raRunIm }, runIm.dataset.raRunIm); return; }
    const tab = e.target.closest('[data-ra-tab]');
    if (tab) { RA.tab = tab.dataset.raTab; try { localStorage.setItem('cs-ra-tab', RA.tab); } catch (err) { /* private mode */ } renderAuditHome(); return; }
    if (e.target.closest('#raFirmRun')) {
      const sel = document.getElementById('raFirm');
      if (!sel.value) { sel.focus(); return; }
      runImAudit({ firmId: sel.value, firmName: sel.selectedOptions[0].dataset.name }, 'firm:' + sel.value); return;
    }
    const firmBtn = e.target.closest('[data-ra-firm]');
    if (firmBtn) { runImAudit({ firmId: firmBtn.dataset.raFirm, firmName: firmBtn.dataset.name }, 'firm:' + firmBtn.dataset.raFirm); return; }
    const open = e.target.closest('[data-ra-open]');
    if (open && !e.target.closest('a')) { openAudit(open.dataset.raOpen); window.scrollTo({ top: document.getElementById('view-audit').offsetTop - 70 }); return; }
    if (e.target.closest('#raBack')) { clearTimeout(RA.polling); RA.open = null; if (RA.list) renderAuditHome(); loadAudits(); return; }
    if (e.target.closest('#raRetry')) loadAudits();
  });
  document.getElementById('raRefresh').addEventListener('click', () => { if (RA.open) openAudit(RA.open); else loadAudits(); });
}

/* ---- Implementation reports (AM and single firm) ---- */
function renderImAudit(a) {
  const body = document.getElementById('raBody');
  const s = a.stats || {}, r = a.report || {};
  const firm = a.kind === 'firm';
  const head = `<div class="ra-head">
      <button type="button" class="mgr-btn" id="raBack">← All</button>
      <div><h3>${firm ? '🏢 ' : ''}${esc(a.rep)} <span>· ${firm ? 'onboarding review' : 'last 30 days'}</span></h3><p>Run ${esc(raWhen(a.requested))} by ${esc(raFirst(String(a.requestedBy).split('@')[0]))}</p></div>
    </div>`;
  if (a.status === 'running') {
    body.innerHTML = head + `<div class="ra-running"><div class="ra-spin"></div><p><b>Auditing…</b><br>ChurnZero, Gong and email are read; now writing the report. This page updates on its own — usually 2–4 minutes.</p>
      ${s.kind ? `<p class="loop-muted">${firm ? `${s.callsFound || 0} calls · ${s.emailThreads || 0} email threads` : `${s.firms || 0} firms · ${s.callsLed || 0} calls · ${s.emailThreads || 0} email threads`}</p>` : ''}</div>`;
    return;
  }
  if (a.status !== 'done') { body.innerHTML = head + `<div class="error-banner">This audit failed: ${esc(a.error || 'unknown error')}. Try running it again.</div>`; return; }
  const kpi = (v, l, bad, sub) => `<div class="ra-kpi${bad ? ' bad' : ''}"><b>${v == null || v === '' ? '—' : esc(String(v))}</b><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const t = (s.team && s.team.team) || {};
  const vs = (v) => (v == null ? '' : `team ${v}`);
  const kpis = firm ? `
      ${kpi(s.status === 'Open' || s.status === 'Pre-Kickoff' ? 'Day ' + s.days : s.days + ' days', s.completed ? 'Finished ' + s.completed : (s.stage || s.status), s.days > 70)}
      ${kpi(`${(s.milestones || []).filter((m) => m.done).length}/${(s.milestones || []).length}`, 'Milestones done')}
      ${kpi(s.callsFound, 'Calls')}
      ${kpi(s.emailThreads, 'Email threads')}
      ${kpi(s.replyMedianHours == null ? null : s.replyMedianHours + 'h', 'IM email reply (median)', s.replyMedianHours > 24)}
      ${kpi(s.signals, 'Real call signals', s.signals > 0)}
      ${kpi((s.csat || []).length ? s.csat.join(', ') : null, 'Onboarding CSAT')}` : `
      ${kpi(s.open, 'Open onboardings', false, vs(t.open))}
      ${kpi(s.over70, 'Open over 70 days', s.over70 > 0, vs(t.over70))}
      ${kpi(s.quiet14, 'No touch in 14+ days', s.quiet14 > 0)}
      ${kpi(s.finished, 'Finished (30 days)', false, s.finishedMedianDays != null ? `median ${s.finishedMedianDays} days` : '')}
      ${kpi(s.callsLed, 'Calls led')}
      ${kpi(s.talkMedian == null ? null : s.talkMedian + '%', 'Talk ratio (median)', s.talkMedian > 65)}
      ${kpi(s.replyMedianHours == null ? null : s.replyMedianHours + 'h', 'Email reply (median)', s.replyMedianHours > 24, s.slowReplies ? `${s.slowReplies} over 24h` : '')}
      ${kpi(s.csatPct == null ? null : s.csatPct + '%', `Onboarding CSAT (${s.csatN || 0})`, s.csatPct != null && s.csatPct < 80, vs(t.csatPct == null ? null : t.csatPct + '%'))}`;
  const usage = firm && s.usage ? `<p class="ra-usage"><b>Milestones:</b> ${(s.milestones || []).map((m) => `<span class="ra-ms${m.done ? ' done' : ''}">${m.done ? '✓' : '○'} ${esc(m.name)}</span>`).join(' ')}<br>
      <b>30-day usage:</b> ${s.usage.messages} messages · ${s.usage.activities} activities · ${s.usage.meetings} meetings · ${s.usage.matters} matters/mo · ${s.usage.sms} SMS · ${s.usage.ai} AI credits</p>` : '';
  const pts = (x) => `<li><p>${esc(x.point)}</p>${raRefs(x.refs, a)}</li>`;
  body.innerHTML = head + `
    <div class="ra-kpis">${kpis}</div>
    ${usage}
    ${r.headline ? `<div class="ra-headline">${firm && r.status ? `<span class="ra-status ${esc(String(r.status).replace(/\s+/g, '-'))}">${esc(r.status)}</span> ` : ''}${esc(r.headline)}</div>` : ''}
    ${firm && (r.timeline || []).length ? `<section class="ra-sec wide"><h3>🗓 Timeline</h3><ol class="ra-tl">${r.timeline.map((e) => `<li><b>${esc(e.date || '')}</b> ${esc(e.event || '')}</li>`).join('')}</ol></section>` : ''}
    <div class="ra-grid">
      ${raSection('Progression', '📈', r.progression, pts)}
      ${raSection('Product adoption', '🧩', r.adoption, pts)}
      ${r.sentiment ? `<section class="ra-sec"><h3>💬 Sentiment</h3><p>${esc(r.sentiment.overview || '')}</p>${(r.sentiment.observations || []).length ? `<ul>${r.sentiment.observations.map(pts).join('')}</ul>` : ''}</section>` : ''}
      ${firm ? raSection('Risks', '⚠️', r.risks, (x) => `<li><b>${esc(x.risk)}</b><p>${esc(x.detail || '')}</p>${raRefs(x.refs, a)}</li>`) : raSection('Strengths', '💪', r.strengths, pts)}
      ${firm ? raSection('What went well', '💪', r.went_well, pts) : raSection('Call craft', '🎙', r.call_craft, pts)}
      ${firm ? raSection('Notes on how the IM ran it', '🎯', r.im_notes, pts) : raSection('Communication', '✉️', r.communication, pts)}
    </div>
    ${!firm && (r.firm_spotlights || []).length ? `<section class="ra-sec wide"><h3>🏢 Firm spotlights</h3><div class="ra-spots">${r.firm_spotlights.map((f) => `<div class="ra-spot">
        <div class="ra-spot-head"><b>${esc(f.firm)}</b><span class="ra-status ${esc(String(f.status || '').replace(/\s+/g, '-'))}">${esc(f.status || '')}</span></div>
        <p>${esc(f.what_happened || '')}</p>${f.next_step ? `<p class="ra-next">Next: ${esc(f.next_step)}</p>` : ''}${raRefs(f.refs, a)}
        ${f.firm_id ? `<button type="button" class="pill-btn" data-ra-firm="${esc(f.firm_id)}" data-name="${esc(f.firm)}">Audit this onboarding</button>` : ''}</div>`).join('')}</div></section>` : ''}
    ${firm ? raSection('Next steps', '➡️', r.next_steps, (x) => `<li><b>${esc(x.action)}</b><p>Owner: ${esc(x.owner || '')}</p></li>`).replace('ra-sec', 'ra-sec wide coach')
      : raSection('Coaching focus', '🎯', r.coaching, (x) => `<li><b>${esc(x.action)}</b><p>${esc(x.why)}</p></li>`).replace('ra-sec', 'ra-sec wide coach')}
    ${!firm ? raSection('Follow up', '🚩', r.follow_up, (x) => `<li><p>${esc(x.item)}</p>${raRefs(x.refs, a)}</li>`).replace('ra-sec', 'ra-sec wide') : ''}
    <p class="loop-foot">AI-written from ChurnZero, Gong and email. Treat it as a starting point, not a verdict — click a 📞 chip to open the call in Gong.</p>`;
}
