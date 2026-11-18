/* ==========================================================================
   Settings — MOCKUP for the test site only (tools/build-demo.sh loads it).
   One main tab with four pages:
   - My settings (everyone): your IDs and links; each becomes a fill-in field for emails and automations.
   - Churn score (managers): factors, goals, weights and bands, with a live preview of how many firms move.
   - System status (managers): every data sync and job, last run, status, Run now.
   - Team directory (managers): one list of reps and roles that replaces the hard-coded rep lists.
   Made-up data; changes are kept in this browser only.
   ========================================================================== */
(function () {
  if (!window.CS_DEMO) return;
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (x) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (x) { /* */ } };
  const KEY_ME = 'cs-demo-my-settings', KEY_SCORE = 'cs-demo-churn-config', KEY_DIR = 'cs-demo-directory';
  const persona = () => (window.DEMO_PERSONA ? window.DEMO_PERSONA() : { name: 'Test Manager', email: 'test.manager@lawmatics.com' });
  const isMgr = () => /manager/i.test(persona().name);
  const first = (n) => String(n || '').split(' ')[0].toLowerCase();
  const UI = { page: 'me', toast: '', runBusy: {} };

  /* ===================== My settings ===================== */
  const MY_FIELDS = [
    { group: 'Profile', items: [
      ['title', 'Job title', 'text', 'Customer Success Manager', '{{me.title}}'],
      ['phone', 'Phone', 'text', '(555) 010-2030', '{{me.phone}}'],
      ['signature', 'Email signature', 'long', '', '{{me.signature}}'],
    ] },
    { group: 'Links for customers', items: [
      ['booking', 'Booking link', 'url', 'https://app.lawmatics.com/booking/…', '{{me.booking_link}}', 'Your Lawmatics scheduler page. Automations use it for “book a call” emails.'],
      ['onboardingCall', 'Onboarding call link', 'url', 'https://app.lawmatics.com/booking/…/onboarding', '{{me.onboarding_link}}', 'IMs: the event type for onboarding sessions.'],
      ['checkinCall', 'Check-in / renewal call link', 'url', 'https://app.lawmatics.com/booking/…/check-in', '{{me.checkin_link}}', 'CSMs: the event type for check-ins and renewal reviews.'],
      ['zoom', 'Zoom personal room', 'url', 'https://lawmatics.zoom.us/j/…', '{{me.zoom_link}}'],
    ] },
    { group: 'IDs for our systems', items: [
      ['slack', 'Slack member ID', 'text', 'U0123ABCD', '', 'Slack ▸ your profile ▸ ⋮ ▸ Copy member ID. Ops Comms DMs you with it.'],
      ['salesforce', 'Salesforce user ID', 'text', '005…', '', 'Matches you to the Owner and IM fields synced from Salesforce.'],
      ['intercom', 'Intercom admin ID', 'text', '1234567', '', 'Matches your Intercom conversations and CSAT.'],
      ['gong', 'Gong user ID', 'text', '', '', 'Matches your call recordings.'],
      ['asana', 'Asana user ID', 'text', '', '', 'IMs: tasks for the offshore Implementation Specialists.'],
    ] },
  ];
  function seedMe(p) {
    const f = first(p.name);
    return { title: /IM/.test(p.label || '') ? 'Implementation Manager' : /CSM/.test(p.label || '') ? 'Customer Success Manager' : 'CS Manager', phone: '',
      signature: `${p.name}\n${/IM/.test(p.label || '') ? 'Implementation Manager' : 'Customer Success Manager'}, Lawmatics`,
      booking: `https://app.lawmatics.com/booking/test-${f}`, onboardingCall: '', checkinCall: `https://app.lawmatics.com/booking/test-${f}/check-in`,
      zoom: '', slack: 'U0TEST' + f.slice(0, 4).toUpperCase(), salesforce: '', intercom: '', gong: '', asana: '' };
  }
  function myHtml() {
    const p = persona(), all = load(KEY_ME, {}), v = all[p.email] || seedMe(p);
    const items = MY_FIELDS.flatMap((g) => g.items);
    const filled = items.filter(([k]) => String(v[k] || '').trim()).length;
    return `<div class="st-head"><div><h3>My settings</h3><p>${e(p.name)} · ${e(p.email)} · <b>${filled} of ${items.length}</b> filled</p></div>
        <button type="button" class="au-btn primary" data-me-save>Save</button></div>
      <div class="st-meter"><i style="width:${Math.round(filled / items.length * 100)}%"></i></div>
      ${MY_FIELDS.map((g) => `<section class="st-card"><h4>${e(g.group)}</h4>${g.items.map(([k, label, type, ph, token, hint]) => `
        <label class="st-row"><span class="st-l">${e(label)}${hint ? `<small>${e(hint)}</small>` : ''}</span>
          <span class="st-ctl">${type === 'long' ? `<textarea data-me="${k}" rows="3" placeholder="${e(ph)}">${e(v[k] || '')}</textarea>` : `<input data-me="${k}" type="${type === 'url' ? 'url' : 'text'}" value="${e(v[k] || '')}" placeholder="${e(ph)}">`}
            ${type === 'url' && v[k] ? `<a class="st-test" href="${e(v[k])}" target="_blank" rel="noopener">Test ↗</a>` : ''}</span>
          <span class="st-token">${token ? `<code>${e(token)}</code>` : ''}</span></label>`).join('')}</section>`).join('')}
      <section class="st-card st-help"><h4>How the fill-in fields work</h4>
        <p><code>{{me.booking_link}}</code> fills in <b>your</b> link in emails you send yourself (Merlin outreach, Renewal prep follow-ups).</p>
        <p>In automations, <code>{{csm.booking_link}}</code> and <code>{{im.booking_link}}</code> fill in the link of the <b>firm’s</b> CSM or IM, from their My settings. An email that needs a link someone hasn’t filled in waits, and the Team directory flags it.</p>
        ${v.signature ? `<div class="st-sig"><small>Signature preview</small><pre>${e(v.signature)}</pre></div>` : ''}</section>`;
  }

  /* ===================== Churn score ===================== */
  const FACTORS = {
    matters: { label: 'Matters created', unit: 'in 7 days', dir: 'min', goal: 10, max: 30 },
    minutes: { label: 'Time in app', unit: 'minutes in 7 days', dir: 'min', goal: 50, max: 200 },
    msgs: { label: 'Emails from the firm', unit: 'in 90 days', dir: 'min', goal: 3, max: 15 },
    csat: { label: 'CSAT', unit: 'average, 60 days', dir: 'min', goal: 4, max: 5 },
    logins: { label: 'Logins', unit: 'in 30 days', dir: 'min', goal: 20, max: 80 },
    merlin: { label: 'Merlin credits used', unit: '% of monthly credits', dir: 'min', goal: 25, max: 100 },
    convos: { label: 'Support conversations', unit: 'in 30 days (at most)', dir: 'max', goal: 6, max: 20 },
    meeting: { label: 'Days since last call', unit: 'days (at most)', dir: 'max', goal: 90, max: 365 },
    overdue: { label: 'Payment overdue', unit: '7+ days past due', dir: 'flag', goal: 0, max: 1 },
  };
  const DEFAULT_SCORE = { factors: [['matters', 25], ['minutes', 25], ['msgs', 25], ['csat', 25]].map(([k, w]) => ({ k, w, goal: FACTORS[k].goal, on: true })),
    healthy: 33, atRisk: 67, by: 'Default (ChurnZero General score)', at: '' };
  let DRAFT = null;
  const conf = () => load(KEY_SCORE, null) || DEFAULT_SCORE;
  // Made-up metrics for each firm, steady per firm and in line with its current score.
  let METRICS = null;
  function metrics() {
    if (METRICS) return METRICS;
    const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
    METRICS = (window.DEMO_FIRMS ? window.DEMO_FIRMS() : []).filter((f) => !f.cancelled && !f.onboarding).map((f) => {
      // Each metric lands near the goal × (1 − score), with ±40% noise, so today's scores come out close to the firm's churn score.
      const q = 1 - f.score / 100, n = (k) => 0.6 + 0.8 * (hash(f.id + k) % 1000) / 1000;
      const m = { matters: FACTORS.matters.goal * q * n('a'), minutes: FACTORS.minutes.goal * q * n('b'), msgs: FACTORS.msgs.goal * q * n('c'),
        csat: Math.min(5, 1 + 4 * q * n('d')), logins: FACTORS.logins.goal * q * n('e'), merlin: f.ai ? Math.round(f.ai.used / f.ai.quota * 100) : null,
        convos: Math.round(10 * (1 - q) * n('f')), meeting: Math.round(180 * (1 - q) * n('g')), overdue: !!f.overdue };
      return { f, m };
    });
    return METRICS;
  }
  function scoreOf(m, c) {
    const on = c.factors.filter((x) => x.on && !(x.k === 'merlin' && m.merlin == null));
    const tw = on.reduce((t, x) => t + Number(x.w || 0), 0) || 1;
    let s = 0;
    on.forEach((x) => {
      const F = FACTORS[x.k], v = m[x.k], g = Number(x.goal);
      const miss = F.dir === 'flag' ? (v ? 1 : 0) : F.dir === 'min' ? Math.max(0, Math.min(1, (g - v) / (g || 1))) : Math.max(0, Math.min(1, (v - g) / (g || 1)));
      s += (Number(x.w) / tw) * 100 * miss;
    });
    return Math.round(s);
  }
  const bandOf = (s, c) => (s < c.healthy ? 'Healthy' : s < c.atRisk ? 'Watch' : 'At risk');
  function scoreHtml() {
    const saved = conf(), c = DRAFT || JSON.parse(JSON.stringify(saved));
    DRAFT = c;
    const rows = metrics();
    const now = rows.map((r) => ({ r, a: scoreOf(r.m, saved), b: scoreOf(r.m, c) }));
    const count = (k, which) => now.filter((x) => bandOf(which === 'a' ? x.a : x.b, which === 'a' ? saved : c) === k).length;
    const moved = now.filter((x) => bandOf(x.a, saved) !== bandOf(x.b, c));
    const tw = c.factors.filter((x) => x.on).reduce((t, x) => t + Number(x.w || 0), 0) || 1;
    const unused = Object.keys(FACTORS).filter((k) => !c.factors.some((x) => x.k === k));
    const dirty = JSON.stringify(c) !== JSON.stringify(saved);
    const bar = (which) => { const n = now.length || 1; return ['Healthy', 'Watch', 'At risk'].map((k) => `<i class="b-${k.replace(' ', '').toLowerCase()}" style="width:${count(k, which) / n * 100}%" title="${k}: ${count(k, which)}"></i>`).join(''); };
    return `<div class="st-head"><div><h3>Churn score</h3><p>CSM health score for firms past onboarding · recalculated every night · <b>lower is healthier</b></p></div>
        <div class="st-acts">${dirty ? '<span class="rp-unsaved">Unsaved changes</span><button type="button" class="au-btn" data-sc-discard>Discard</button>' : ''}<button type="button" class="au-btn" data-sc-reset>Reset to default</button><button type="button" class="au-btn primary" data-sc-save ${dirty ? '' : 'disabled'}>Save</button></div></div>
      <section class="st-card"><h4>Factors <small>Each factor adds risk points when a firm misses its goal; weights are shares of 100.</small></h4>
        <table class="st-table"><thead><tr><th>On</th><th>Factor</th><th>Goal</th><th>Weight</th><th>Share</th><th></th></tr></thead><tbody>
        ${c.factors.map((x, i) => { const F = FACTORS[x.k]; return `<tr class="${x.on ? '' : 'off'}"><td><input type="checkbox" data-sc-on="${i}" ${x.on ? 'checked' : ''} aria-label="Use ${e(F.label)}"></td>
          <td><b>${e(F.label)}</b><small>${e(F.unit)}</small></td>
          <td>${F.dir === 'flag' ? '<span class="muted">Yes / no</span>' : `${F.dir === 'max' ? 'at most ' : 'at least '}<input type="number" class="st-num" data-sc-goal="${i}" value="${e(x.goal)}" min="0" max="${F.max}" aria-label="Goal for ${e(F.label)}">`}</td>
          <td><input type="range" min="0" max="50" step="5" data-sc-w="${i}" value="${e(x.w)}" aria-label="Weight for ${e(F.label)}"> <b>${e(x.w)}</b></td>
          <td>${x.on ? Math.round(x.w / tw * 100) + '%' : '—'}</td>
          <td><button type="button" class="fx-mini" data-sc-del="${i}" aria-label="Remove ${e(F.label)}">✕</button></td></tr>`; }).join('')}
        </tbody></table>
        ${unused.length ? `<div class="st-add"><select data-sc-addsel aria-label="Factor to add">${unused.map((k) => `<option value="${k}">${e(FACTORS[k].label)}</option>`).join('')}</select><button type="button" class="au-btn sm" data-sc-add>＋ Add factor</button></div>` : ''}
        <div class="st-bands"><span>Bands:</span> <b class="st-good">Healthy</b> under <input type="number" class="st-num" data-sc-band="healthy" value="${e(c.healthy)}" aria-label="Healthy below">
          · <b class="st-warn">Watch</b> to <input type="number" class="st-num" data-sc-band="atRisk" value="${e(c.atRisk)}" aria-label="At risk from"> · <b class="st-bad">At risk</b> from there up</div></section>
      <section class="st-card"><h4>Preview <small>${now.length} active firms past onboarding</small></h4>
        <div class="st-dist"><span>Now</span><div class="st-bar">${bar('a')}</div><span class="st-dnum">${count('Healthy', 'a')} · ${count('Watch', 'a')} · ${count('At risk', 'a')}</span></div>
        <div class="st-dist"><span>With changes</span><div class="st-bar">${bar('b')}</div><span class="st-dnum">${count('Healthy', 'b')} · ${count('Watch', 'b')} · ${count('At risk', 'b')}</span></div>
        <p class="st-legend"><i class="b-healthy"></i>Healthy <i class="b-watch"></i>Watch <i class="b-atrisk"></i>At risk</p>
        ${moved.length ? `<p><b>${moved.length} firm${moved.length === 1 ? '' : 's'} would change band</b>${moved.length > 12 ? ' (first 12)' : ''}:</p><table class="st-table compact"><thead><tr><th>Firm</th><th>CSM</th><th>Now</th><th>With changes</th></tr></thead><tbody>
          ${moved.slice(0, 12).map((x) => `<tr><td>${e(x.r.f.name.replace(/^Test – /, ''))}</td><td>${e(x.r.f.csm || 'Support')}</td><td>${x.a} · ${bandOf(x.a, saved)}</td><td><b>${x.b} · ${bandOf(x.b, c)}</b></td></tr>`).join('')}</tbody></table>`
          : '<p class="muted">No firm changes band with these settings.</p>'}
        <p class="st-foot">Saved by ${e(saved.by)}${saved.at ? ' · ' + e(saved.at) : ''}. Changes apply at the next nightly run; each night’s scores are kept, so trends aren’t rewritten.</p></section>`;
  }

  /* ===================== System status ===================== */
  const JOBS = [
    ['Salesforce', 'Accounts, contacts, owners, opportunities', 'Every hour', 52, 2569, 'ok'],
    ['Chargebee', 'Subscriptions, invoices, MRR, add-ons', 'Every hour', 38, 2241, 'ok'],
    ['Intercom', 'Conversations, CSAT, surveys, article views', 'Every 15 minutes', 6, 184, 'ok'],
    ['Segment', 'Product usage events', 'Streaming', 0.1, 1270000, 'ok'],
    ['Gmail', 'Team emails with customers', 'Every 5 minutes', 3, 412, 'ok'],
    ['Google Calendar', 'Meetings with firms', 'Every 5 minutes', 3, 61, 'ok'],
    ['Zoom + Gong', 'Call recordings and summaries', 'Every 30 minutes', 22, 18, 'warn', '2 calls couldn’t be matched to a firm (no contact email). Open them to match by hand.'],
    ['SendGrid', 'Sends, opens, bounces, unsubscribes', 'Webhook', 1, 96, 'ok'],
    ['Automation runner', 'Triggers, waits, sends, retries', 'Every minute', 0.5, 37, 'ok'],
    ['Churn score', 'Nightly score for every firm', 'Nightly, 2:00 AM', 410, 1980, 'ok'],
    ['Usage rollups', 'Daily totals per firm; raw events kept 90 days', 'Nightly, 2:30 AM', 380, 2241, 'ok'],
    ['Backups', 'Full database backup', 'Nightly, 3:00 AM', 330, 1, 'ok'],
  ];
  const ago = (min) => min < 1 ? 'seconds ago' : min < 60 ? `${Math.round(min)} min ago` : `${Math.round(min / 60)} h ago`;
  function statusHtml() {
    const warn = JOBS.filter((j) => j[5] !== 'ok').length;
    return `<div class="st-head"><div><h3>System status</h3><p>${warn ? `<b class="st-warn">${warn} needs a look</b>` : '<b class="st-good">All running</b>'} · failures post to #cs-ops through Ops Comms</p></div></div>
      <div class="st-jobs">${JOBS.map(([name, what, every, mins, rows, st, note], i) => `<div class="st-job ${st}">
        <div class="st-job-h"><span class="st-dot ${st}"></span><b>${e(name)}</b><button type="button" class="au-btn sm" data-run="${i}" ${UI.runBusy[i] ? 'disabled' : ''}>${UI.runBusy[i] ? 'Running…' : 'Run now'}</button></div>
        <small>${e(what)}</small>
        <div class="st-job-m"><span>${e(every)}</span><span>Last run ${e(UI.runBusy[i] === 'done' ? 'just now' : ago(mins))}</span><span>${rows.toLocaleString()} ${name === 'Segment' ? 'events today' : 'rows'}</span></div>
        <div class="st-runs" aria-label="Last 24 runs">${Array.from({ length: 24 }, (_, k) => `<i class="${st === 'warn' && (k === 20 || k === 23) ? 'warn' : 'ok'}"></i>`).join('')}</div>
        ${note ? `<p class="st-note">⚠️ ${e(note)}</p>` : ''}</div>`).join('')}</div>`;
  }

  /* ===================== Team directory ===================== */
  const ROSTER = [
    ['Callie Burns', 'IM'], ['Andy Galindo', 'IM'], ['Admir Karamovic', 'IM'], ['Swetha Devakumar', 'IM'],
    ['Elliott Jones', 'CSM'], ['Julio Ortiz', 'CSM'], ['Jessie Hobbs', 'CSM'], ['Kennedy Wickham', 'IM + CSM (partners)'],
    ['Claire Ortiz', 'Support'], ['Dan Serrano', 'Support'], ['Chelsea Lance', 'Support'], ['Clare Struzzi', 'Manager'], ['Johnny Bissell', 'Manager'],
  ];
  function dirRows() {
    const saved = load(KEY_DIR, null);
    if (saved) return saved;
    return ROSTER.map(([name, role], i) => ({ name, role, email: first(name) + '@lawmatics.com', slack: i % 5 === 3 ? '' : 'U0TEST' + first(name).slice(0, 4).toUpperCase(),
      booking: /IM|CSM/.test(role) && i !== 2 ? `https://app.lawmatics.com/booking/test-${first(name)}` : '', calendar: first(name) + '@lawmatics.com',
      rr: role === 'IM', active: true }));
  }
  function dirHtml() {
    const rows = dirRows(), ROLES = ['IM', 'CSM', 'IM + CSM (partners)', 'Support', 'Manager'];
    const missing = rows.filter((r) => r.active && (!r.slack || (/IM|CSM/.test(r.role) && !r.booking))).length;
    return `<div class="st-head"><div><h3>Team directory</h3><p>One list of who does what. Automations, Slack DMs, assignment and the rep pickers all read it, instead of ~30 hard-coded rep lists.${missing ? ` <b class="st-warn">${missing} missing a Slack ID or booking link.</b>` : ''}</p></div>
        <button type="button" class="au-btn" data-dir-add>＋ Add person</button></div>
      <section class="st-card"><table class="st-table"><thead><tr><th>Name</th><th>Role</th><th>Slack ID</th><th>Booking link</th><th>Calendar</th><th>New-firm rotation</th><th>Active</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.active ? '' : 'off'}"><td><b>${e(r.name)}</b><small>${e(r.email)}</small></td>
        <td><select data-dir="${i}" data-f="role" aria-label="Role for ${e(r.name)}">${ROLES.map((x) => `<option${x === r.role ? ' selected' : ''}>${e(x)}</option>`).join('')}</select></td>
        <td>${r.slack ? `<code>${e(r.slack)}</code>` : '<span class="st-miss">Missing</span>'}</td>
        <td>${r.booking ? '<span class="st-good">✓ Set</span>' : /IM|CSM/.test(r.role) ? '<span class="st-miss">Missing</span>' : '<span class="muted">—</span>'}</td>
        <td><small>${e(r.calendar)}</small></td>
        <td>${/IM/.test(r.role) ? `<input type="checkbox" data-dir="${i}" data-f="rr" ${r.rr ? 'checked' : ''} aria-label="${e(r.name)} gets new firms">` : '<span class="muted">—</span>'}</td>
        <td><input type="checkbox" data-dir="${i}" data-f="active" ${r.active ? 'checked' : ''} aria-label="${e(r.name)} active"></td></tr>`).join('')}
      </tbody></table><p class="st-foot">Slack ID and booking link come from each person’s My settings. A departed rep: untick Active and every list drops them, while their history stays.</p></section>`;
  }

  /* ===================== page ===================== */
  function render() {
    const page = document.getElementById('stPage'); if (!page) return;
    const mgr = isMgr();
    if (!mgr && UI.page !== 'me') UI.page = 'me';
    const tabs = [['me', '👤 My settings'], ['score', '❤️ Churn score', true], ['status', '🟢 System status', true], ['dir', '👥 Team directory', true]].filter((t) => !t[2] || mgr);
    page.innerHTML = `<header class="au-top"><div class="au-crumbs"><b>⚙️ Settings</b><span class="au-mock">Mockup · saved in this browser only</span></div>
        <div class="st-tabs">${tabs.map(([k, l]) => `<button type="button" class="${UI.page === k ? 'on' : ''}" data-page="${k}">${l}</button>`).join('')}</div></header>
      <div class="st-body">${UI.page === 'me' ? myHtml() : UI.page === 'score' ? scoreHtml() : UI.page === 'status' ? statusHtml() : dirHtml()}</div>
      ${UI.toast ? `<div class="rp-toast">${e(UI.toast)}</div>` : ''}`;
  }
  function flash(m) { UI.toast = m; render(); clearTimeout(flash.t); flash.t = setTimeout(() => { UI.toast = ''; render(); }, 2800); }
  function onClick(ev) {
    const q = (s) => ev.target.closest(s); let el;
    if ((el = q('[data-page]'))) { UI.page = el.dataset.page; render(); return; }
    if (q('[data-me-save]')) {
      const p = persona(), all = load(KEY_ME, {}), v = all[p.email] || seedMe(p);
      document.querySelectorAll('#stPage [data-me]').forEach((i) => { v[i.dataset.me] = i.value.trim(); });
      all[p.email] = v; store(KEY_ME, all); flash('Saved. Your fill-in fields update everywhere.'); return;
    }
    if (q('[data-sc-save]')) { DRAFT.by = persona().name === 'Test Manager' ? 'Clare Struzzi' : persona().name; DRAFT.at = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); store(KEY_SCORE, DRAFT); DRAFT = null; flash('Saved. Scores update at tonight’s run.'); return; }
    if (q('[data-sc-discard]')) { DRAFT = null; render(); return; }
    if (q('[data-sc-reset]')) { DRAFT = JSON.parse(JSON.stringify(DEFAULT_SCORE)); render(); return; }
    if ((el = q('[data-sc-del]'))) { DRAFT.factors.splice(+el.dataset.scDel, 1); render(); return; }
    if (q('[data-sc-add]')) { const k = document.querySelector('#stPage [data-sc-addsel]').value; DRAFT.factors.push({ k, w: 10, goal: FACTORS[k].goal, on: true }); render(); return; }
    if ((el = q('[data-run]'))) {
      const i = +el.dataset.run; UI.runBusy[i] = true; render();
      setTimeout(() => { UI.runBusy[i] = 'done'; if (JOBS[i][5] === 'warn') { JOBS[i][5] = 'ok'; JOBS[i][6] = ''; } flash(`${JOBS[i][0]} ran (test data, nothing synced).`); }, 1200);
      return;
    }
    if (q('[data-dir-add]')) { const rows = dirRows(); rows.push({ name: 'New person', role: 'Support', email: 'new.person@lawmatics.com', slack: '', booking: '', calendar: 'new.person@lawmatics.com', rr: false, active: true }); store(KEY_DIR, rows); render(); }
  }
  function onChange(ev) {
    const t = ev.target, d = t.dataset;
    if (DRAFT && 'scW' in d) { DRAFT.factors[+d.scW].w = Number(t.value); render(); return; }
    if (DRAFT && 'scOn' in d) { DRAFT.factors[+d.scOn].on = t.checked; render(); return; }
    if (DRAFT && 'scGoal' in d) { DRAFT.factors[+d.scGoal].goal = Number(t.value) || 0; render(); return; }
    if (DRAFT && 'scBand' in d) { DRAFT[d.scBand] = Number(t.value) || 0; render(); return; }
    if ('dir' in d) { const rows = dirRows(); rows[+d.dir][d.f] = t.type === 'checkbox' ? t.checked : t.value; store(KEY_DIR, rows); render(); }
  }
  function onInput(ev) {
    const t = ev.target;
    // While dragging, only the number next to the slider moves; the preview redraws when it's let go.
    if (DRAFT && 'scW' in t.dataset) { const b = t.nextElementSibling; if (b) b.textContent = t.value; }
  }
  function open() {
    const host = document.getElementById('stHost'); if (!host) return;
    let page = document.getElementById('stPage');
    if (!page) {
      page = document.createElement('div'); page.id = 'stPage'; page.className = 'st-page'; host.appendChild(page);
      page.addEventListener('click', onClick); page.addEventListener('change', onChange); page.addEventListener('input', onInput);
    }
    render();
  }
  const nav = document.querySelector('.tabbar');
  if (nav && !document.querySelector('[data-tab="settings"]')) {
    const tab = document.createElement('button');
    tab.className = 'tab'; tab.dataset.tab = 'settings';
    tab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg> Settings';
    tab.addEventListener('click', () => setTimeout(open, 0));
    nav.appendChild(tab);
    const view = document.createElement('div');
    view.className = 'view'; view.id = 'view-settings';
    view.innerHTML = '<div class="wrap"><div id="stHost"></div></div>';
    const last = document.getElementById('view-auto') || document.querySelector('.view:last-of-type');
    if (last) last.after(view); else document.body.appendChild(view);
  }
  let lastP = '';
  setInterval(() => { const p = persona().name; if (p !== lastP) { lastP = p; DRAFT = null; if (document.getElementById('stPage')) render(); } }, 900);
  window.DEMO_MY_SETTINGS = (email) => { const all = load(KEY_ME, {}); return all[email] || null; };
})();
