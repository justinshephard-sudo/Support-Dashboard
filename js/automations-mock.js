/* ==========================================================================
   Automation Builder — MOCKUP for the test site only (tools/build-demo.sh loads it).
   What a ChurnZero-style automation engine could look like inside the CS Dashboard:
   automations list → builder with an entry block ("When this happens"), entry conditions,
   exit conditions, steps (email, Slack, wait, If/Else branches, field changes, tasks…),
   a settings panel for the selected step, a test run preview and an activity log.
   Nothing runs or sends: it's all made-up data kept in this browser.
   ========================================================================== */
(function () {
  if (!window.CS_DEMO) return;
  const KEY = 'cs-demo-automations';

  /* ---------- catalogs ---------- */
  const TRIGGERS = {
    call_completed: { icon: '🎧', label: 'Call completed', desc: 'A Zoom or Gong recording of a call with the firm finishes (matched to the firm by its contacts)' },
    call_missed: { icon: '🚫', label: 'Appointment marked missed', desc: 'The IM or CSM clicks “Missed” on the firm’s meeting in the dashboard' },
    button: { icon: '🖱️', label: 'Dashboard button', desc: 'Someone clicks a button on the dashboard' },
    usage: { icon: '📉', label: 'Usage threshold', desc: 'A usage metric crosses a threshold (checked daily from Segment)' },
    date: { icon: '📅', label: 'Date reached', desc: 'Days before or after a date on the firm (checked daily)' },
    field: { icon: '✏️', label: 'Field changes', desc: 'A firm field changes to a value' },
    health: { icon: '❤️', label: 'Health score changes', desc: 'Health score moves into a band (checked daily)' },
    sf: { icon: '☁️', label: 'Salesforce field changes', desc: 'A Salesforce field or form changes (synced hourly)' },
    match: { icon: '🎯', label: 'Match on fields', desc: 'Any firm matching the entry conditions (checked daily)' },
  };
  const ACTIONS = [
    { group: 'Communicate', items: [
      ['email', '✉️', 'Send email', 'From the CSM’s or IM’s Gmail, or support@ — links go in as fill-in fields'],
      ['slack', '🔔', 'Slack message', 'Ops Comms DM to the rep, or a post to a channel'],
    ] },
    { group: 'Logic & timing', items: [
      ['wait', '⏳', 'Add delay', 'Wait a length of time'],
      ['waituntil', '⏱️', 'Wait until', 'A reply, a booked meeting or a usage change, with a time limit'],
      ['if', '🔀', 'If / Else', 'Split into Yes and No paths'],
      ['end', '⏹️', 'End automation', 'Stop here'],
    ] },
    { group: 'Records', items: [
      ['stage', '🪜', 'Change onboarding stage', 'Move to the next call or a set stage'],
      ['field', '✏️', 'Change field', 'Update a firm field'],
      ['owner', '👤', 'Assign owner', 'IM, CSM or Support'],
      ['task', '✅', 'Create task', 'On the rep’s dashboard task list, with a due date'],
      ['sf', '☁️', 'Update Salesforce', 'Write a field back to the Salesforce account'],
      ['note', '📝', 'Log note', 'On the firm’s timeline'],
    ] },
  ];
  const ACTION = Object.fromEntries(ACTIONS.flatMap((g) => g.items.map(([k, icon, label, desc]) => [k, { icon, label, desc, group: g.group }])));
  const FIELDS = ['Onboarding status', 'Onboarding stage', 'CSM', 'IM', 'MRR', 'Health score', 'Plan', 'Days since go-live', 'Days until renewal',
    'Merlin AI credits used (30 days)', 'Merlin usage %', 'Logins (30 days)', 'Messages sent (30 days)', 'Open support tickets',
    'Replied to last email', 'Booked a meeting', 'Practice area', 'Has AI add-on', 'Partner firm', 'Last outreach (days ago)'];
  const OPS = ['is', 'is not', 'is greater than', 'is less than', 'is at least', 'contains', 'is empty', 'is not empty', 'changed in the last'];
  const MERGE = ['{{contact.first_name}}', '{{firm.name}}', '{{csm.first_name}}', '{{csm.name}}', '{{im.first_name}}', '{{merlin.credits_30d}}',
    '{{merlin.credits_monthly}}', '{{meeting.date}}', '{{reschedule_link}}', '{{booking_link}}'];

  /* ---------- sample automations ---------- */
  let uid = 1000;
  const id = () => 'n' + (uid++);
  const C = (field, op, value) => ({ field, op, value });
  const email = (from, subject, body, approval) => ({ id: id(), type: 'email', cfg: { from, to: 'Primary contact', subject, body, approval: !!approval, window: 'Weekdays 8am–5pm firm time' } });
  const node = (type, cfg) => ({ id: id(), type, cfg: cfg || {} });
  const branch = (conds, yes, no, match) => ({ id: id(), type: 'if', cfg: { match: match || 'all', conds }, yes, no });
  function seed() {
    return [
      {
        id: 'a1', name: 'Onboarding call completed → next stage', folder: 'Onboarding', active: true, edited: '2 days ago', by: 'Johnny',
        trigger: { type: 'call_completed', detail: 'Meeting title contains “Onboarding”' },
        entry: { match: 'all', conds: [C('Onboarding status', 'is', 'Open'), C('Onboarding stage', 'is not empty', '')] },
        reentry: 'Every time it triggers', exit: { match: 'any', conds: [C('Onboarding status', 'is', 'Complete')] },
        steps: [
          node('stage', { to: 'Next call in the plan' }),
          branch([C('Onboarding stage', 'is', 'Sixth Onboarding')], [node('task', { title: 'Wrap up onboarding and close it', who: 'Firm’s IM', due: '2 business days' })],
            [node('slack', { to: 'Firm’s IM (DM)', text: 'Moved {{firm.name}} to {{onboarding.stage}}. Book the next call within 7 days.' })]),
        ],
        stats: { enrolled: 214, running: 0, delayed: 0, finished: 212, exited: 2 },
      },
      {
        id: 'a2', name: 'Missed onboarding appointment → reschedule', folder: 'Onboarding', active: true, edited: 'yesterday', by: 'Clare',
        trigger: { type: 'call_missed', detail: 'IM clicks “Missed” on an onboarding meeting' },
        entry: { match: 'all', conds: [C('Onboarding status', 'is', 'Open')] }, reentry: 'Every time it triggers',
        exit: { match: 'any', conds: [C('Booked a meeting', 'is', 'Yes'), C('Onboarding status', 'is not', 'Open')] },
        steps: [
          email('Firm’s IM', 'Sorry we missed you today, {{contact.first_name}}', 'Hi {{contact.first_name}},\n\nLooks like we missed each other for today’s onboarding call. No problem — you can pick a new time here: {{reschedule_link}}\n\nTalk soon,\n{{im.first_name}}'),
          node('wait', { amount: 2, unit: 'business days' }),
          branch([C('Booked a meeting', 'is', 'No')],
            [email('Firm’s IM', 'Still want to finish setting up {{firm.name}}?', 'Hi {{contact.first_name}},\n\nJust checking in — grab any time that works: {{reschedule_link}}\n\n{{im.first_name}}'),
              node('wait', { amount: 3, unit: 'business days' }),
              node('task', { title: 'Call {{firm.name}} — no reschedule after 2 emails', who: 'Firm’s IM', due: 'Same day' })],
            [node('end', {})]),
        ],
        stats: { enrolled: 38, running: 5, delayed: 4, finished: 26, exited: 3 },
      },
      {
        id: 'a3', name: 'Low Merlin usage check-in', folder: 'Adoption', active: true, edited: '5 days ago', by: 'Justin',
        trigger: { type: 'usage', detail: 'Merlin usage % falls below 25% (checked daily)' },
        entry: { match: 'all', conds: [C('Has AI add-on', 'is', 'Yes'), C('Days since go-live', 'is at least', '30'), C('Last outreach (days ago)', 'is at least', '30')] },
        reentry: 'Once every 60 days', exit: { match: 'any', conds: [C('Merlin usage %', 'is at least', '50'), C('Replied to last email', 'is', 'Yes'), C('Booked a meeting', 'is', 'Yes')] },
        steps: [
          email('Firm’s CSM', 'Getting more out of Merlin at {{firm.name}}', 'Hi {{contact.first_name}},\n\nI noticed your team has used {{merlin.credits_30d}} of your {{merlin.credits_monthly}} monthly Merlin AI credits over the last 30 days. Is anything getting in the way, or are there questions I can answer?\n\nWould you have time for a short call this week or next?\n\n{{csm.name}}', true),
          node('waituntil', { what: 'They reply or book a meeting', limit: '5 business days' }),
          branch([C('Replied to last email', 'is', 'No'), C('Booked a meeting', 'is', 'No')],
            [email('Firm’s CSM', 'Quick Merlin tip for {{firm.name}}', 'Hi {{contact.first_name}},\n\nOne quick win: turning on lead scoring for your web form usually takes 10 minutes. Happy to walk you through it: {{booking_link}}\n\n{{csm.first_name}}'),
              node('wait', { amount: 7, unit: 'days' }),
              branch([C('Merlin usage %', 'is less than', '25')], [node('slack', { to: 'Firm’s CSM (DM)', text: '{{firm.name}} still under 25% Merlin usage after 2 emails — worth a call.' })], [node('end', {})])],
            [node('note', { text: 'Engaged after Merlin check-in' })], 'all'),
        ],
        stats: { enrolled: 61, running: 18, delayed: 12, finished: 22, exited: 9 },
      },
      {
        id: 'a4', name: 'Renewal 90 days out', folder: 'Renewals', active: false, edited: '3 weeks ago', by: 'Johnny',
        trigger: { type: 'date', detail: '90 days before Contract end' },
        entry: { match: 'all', conds: [C('Plan', 'contains', 'Annual')] }, reentry: 'Once per contract term',
        exit: { match: 'any', conds: [C('Days until renewal', 'is less than', '0')] },
        steps: [
          node('task', { title: 'Run Renewal prep for {{firm.name}}', who: 'Firm’s CSM', due: '5 business days' }),
          branch([C('Health score', 'is at least', '67')], [node('slack', { to: '#cs-renewals', text: '⚠️ {{firm.name}} renews in 90 days with bad health ({{health.score}}).' })], []),
          node('wait', { amount: 30, unit: 'days' }),
          node('task', { title: 'Renewal call booked with {{firm.name}}?', who: 'Firm’s CSM', due: '3 business days' }),
        ],
        stats: { enrolled: 0, running: 0, delayed: 0, finished: 0, exited: 0 },
      },
      {
        id: 'a5', name: 'First 90 days nurture', folder: 'Adoption', active: false, edited: 'just now', by: 'Erika',
        trigger: { type: 'field', detail: 'Onboarding status changes to Complete' },
        entry: { match: 'all', conds: [C('MRR', 'is greater than', '400')] }, reentry: 'Once', exit: { match: 'any', conds: [C('Health score', 'is at least', '67')] },
        steps: [node('wait', { amount: 14, unit: 'days' }), email('Firm’s CSM', 'Two weeks live — how is it going?', 'Hi {{contact.first_name}},\n\n…', true)],
        stats: { enrolled: 0, running: 0, delayed: 0, finished: 0, exited: 0 },
      },
    ];
  }
  let STATE;
  try { STATE = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { STATE = null; }
  if (!STATE || !Array.isArray(STATE.list)) STATE = { list: seed() };
  uid = 5000 + Math.floor(Math.random() * 1000);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(STATE)); } catch (e) { /* */ } };
  const passReset = window.DEMO_RESET;
  window.DEMO_RESET = () => { try { localStorage.removeItem(KEY); } catch (e) { /* */ } passReset(); };

  const UI = { view: 'list', autoId: null, sel: null, tab: 'build', picker: null };
  const cur = () => STATE.list.find((a) => a.id === UI.autoId);

  /* ---------- helpers ---------- */
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
  const condText = (c) => `<b>${e(c.field)}</b> ${e(c.op)}${c.value !== '' && c.value != null ? ` <b>${e(c.value)}</b>` : ''}`;
  const condList = (g, empty) => (g && g.conds.length ? g.conds.map((c, i) => `${i ? `<span class="au-join">${g.match === 'any' ? 'OR' : 'AND'}</span>` : ''}<span class="au-cond">${condText(c)}</span>`).join('') : `<span class="au-muted">${empty}</span>`);
  function summary(n) {
    const c = n.cfg || {};
    switch (n.type) {
      case 'email': return `From <b>${e(c.from)}</b> to ${e(c.to)} · “${e(c.subject)}”${c.approval ? ' · <span class="au-tag">CSM approves first</span>' : ''}`;
      case 'sms': return `To ${e(c.to || 'Primary contact')} · “${e((c.body || '').slice(0, 60))}”`;
      case 'slack': return `To <b>${e(c.to)}</b> · “${e((c.text || '').slice(0, 70))}${(c.text || '').length > 70 ? '…' : ''}”`;
      case 'booking': return `Send ${e(c.kind || 'reschedule link')} from ${e(c.from || 'Firm’s IM')}`;
      case 'wait': return `Wait <b>${e(c.amount)} ${e(c.unit)}</b>`;
      case 'waituntil': return `Until <b>${e(c.what)}</b> · give up after ${e(c.limit)}`;
      case 'stage': return `Move to <b>${e(c.to)}</b>`;
      case 'field': return `Set <b>${e(c.field || 'a field')}</b> to <b>${e(c.value || '…')}</b>`;
      case 'owner': return `Assign <b>${e(c.to || 'Firm’s CSM')}</b> as owner`;
      case 'task': return `“${e(c.title)}” for <b>${e(c.who)}</b>, due ${e(c.due)}`;
      case 'sf': return `Set Salesforce <b>${e(c.field || 'field')}</b> to <b>${e(c.value || '…')}</b>`;
      case 'note': return `“${e(c.text || '')}”`;
      case 'end': return 'The firm leaves the automation here';
      default: return '';
    }
  }

  // Walk a flow to find a node and the array that holds it.
  function find(steps, nid, parent) {
    for (let i = 0; i < steps.length; i++) {
      const n = steps[i];
      if (n.id === nid) return { n, arr: steps, i, parent };
      if (n.type === 'if') { const r = find(n.yes, nid, n) || find(n.no, nid, n); if (r) return r; }
    }
    return null;
  }
  function pathArr(a, path) {   // path: 'main' or '<ifId>:yes' / '<ifId>:no'
    if (path === 'main') return a.steps;
    const [nid, side] = path.split(':');
    const f = find(a.steps, nid);
    return f ? f.n[side] : null;
  }
  function newNode(type) {
    const d = {
      email: { from: 'Firm’s CSM', to: 'Primary contact', subject: 'Checking in, {{contact.first_name}}', body: 'Hi {{contact.first_name}},\n\n\n\n{{csm.first_name}}', approval: true, window: 'Weekdays 8am–5pm firm time' },
      sms: { to: 'Primary contact', body: 'Hi {{contact.first_name}}, it’s {{csm.first_name}} from Lawmatics…' },
      slack: { to: 'Firm’s CSM (DM)', text: '' }, booking: { kind: 'reschedule link', from: 'Firm’s IM' },
      wait: { amount: 3, unit: 'days' }, waituntil: { what: 'They reply or book a meeting', limit: '5 business days' },
      stage: { to: 'Next call in the plan' }, field: { field: 'Onboarding status', value: '' }, owner: { to: 'Firm’s CSM' },
      task: { title: 'Follow up with {{firm.name}}', who: 'Firm’s CSM', due: '2 business days' }, sf: { field: '', value: '' }, note: { text: '' }, end: {},
    }[type] || {};
    const n = { id: id(), type, cfg: JSON.parse(JSON.stringify(d)) };
    if (type === 'if') Object.assign(n, { cfg: { match: 'all', conds: [{ field: 'Replied to last email', op: 'is', value: 'No' }] }, yes: [], no: [] });
    return n;
  }

  /* ---------- page shell ---------- */
  function open() {
    const host = document.getElementById('auHost');
    if (!host) return;
    let page = document.getElementById('auPage');
    if (!page) {
      page = document.createElement('div');
      page.id = 'auPage';
      page.className = 'au-page';
      host.appendChild(page);
      page.addEventListener('click', onClick);
      page.addEventListener('input', onInput);
      page.addEventListener('change', onInput);
    }
    render();
  }

  function render() {
    const page = document.getElementById('auPage');
    if (!page) return;
    page.innerHTML = UI.view === 'list' ? listHtml() : builderHtml();
  }

  /* ---------- list ---------- */
  function listHtml() {
    const rows = STATE.list.map((a) => {
      const t = TRIGGERS[a.trigger.type] || {};
      const s = a.stats;
      return `<tr data-open="${a.id}">
        <td><div class="au-l-name">${e(a.name)}</div><div class="au-l-sub">${e(a.folder)} · edited ${e(a.edited)} by ${e(a.by)}</div></td>
        <td><span class="au-trig-pill">${t.icon || ''} ${e(t.label || a.trigger.type)}</span></td>
        <td class="au-num">${s.enrolled}</td>
        <td><div class="au-statbar">${s.running ? `<span class="st-run">${s.running} running</span>` : ''}${s.delayed ? `<span class="st-del">${s.delayed} delayed</span>` : ''}${s.finished ? `<span class="st-fin">${s.finished} finished</span>` : ''}${s.exited ? `<span class="st-ex">${s.exited} exited</span>` : ''}${!s.enrolled ? '<span class="au-muted">No firms yet</span>' : ''}</div></td>
        <td><button type="button" class="au-toggle${a.active ? ' on' : ''}" data-toggle="${a.id}" aria-pressed="${a.active}" aria-label="Active"><i></i></button><span class="au-tlabel">${a.active ? 'Active' : 'Inactive'}</span></td>
      </tr>`;
    }).join('');
    return `<header class="au-top"><div class="au-crumbs"><b>⚡ Automations</b><span class="au-mock">Mockup · nothing runs or sends</span></div>
        <div class="au-top-actions"><button type="button" class="au-btn primary" data-new>＋ New automation</button></div></header>
      <main class="au-listwrap">
        <section class="au-hero"><div><h2>Automate the busywork</h2><p>Triggers, conditions and steps that run on every firm — check-ins, reschedules, stage moves, renewal tasks — the way ChurnZero plays and Lawmatics automations do, built for the CS team.</p></div>
          <div class="au-kpis"><div><b>${STATE.list.filter((a) => a.active).length}</b><span>Active</span></div><div><b>${STATE.list.reduce((t, a) => t + a.stats.running + a.stats.delayed, 0)}</b><span>Firms in progress</span></div><div><b>6</b><span>Waiting for approval</span></div></div></section>
        <div class="au-tablewrap"><table class="au-table"><thead><tr><th>Automation</th><th>Trigger</th><th>Firms</th><th>Status of firms</th><th>On/off</th></tr></thead><tbody>${rows}</tbody></table></div>
      </main>`;
  }

  /* ---------- builder ---------- */
  function builderHtml() {
    const a = cur();
    const tabs = [['build', 'Build'], ['activity', 'Activity'], ['settings', 'Settings']];
    return `<header class="au-top">
        <div class="au-crumbs"><button type="button" class="au-link" data-back>← Automations</button><input class="au-title" data-f="name" value="${e(a.name)}" aria-label="Automation name"><span class="au-mock">Mockup</span></div>
        <div class="au-top-actions">
          <div class="au-tabs">${tabs.map(([k, l]) => `<button type="button" class="${UI.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
          <button type="button" class="au-btn" data-test>▶ Test run</button>
          <span class="au-activebox"><button type="button" class="au-toggle${a.active ? ' on' : ''}" data-toggle="${a.id}" aria-pressed="${a.active}" aria-label="Active"><i></i></button>${a.active ? 'Active' : 'Inactive'}</span>
          <button type="button" class="au-btn primary" data-save>Save</button>
        </div></header>
      ${UI.tab === 'build' ? `<div class="au-builder"><div class="au-canvas" id="auCanvas">${canvasHtml(a)}</div><aside class="au-panel">${panelHtml(a)}</aside></div>`
        : UI.tab === 'activity' ? activityHtml(a) : settingsHtml(a)}
      ${UI.picker ? pickerHtml() : ''}${UI.test ? testHtml(a) : ''}`;
  }

  function canvasHtml(a) {
    const t = TRIGGERS[a.trigger.type] || {};
    return `<div class="au-flow">
        <div class="au-node au-entry${UI.sel === 'entry' ? ' sel' : ''}" data-sel="entry">
          <div class="au-node-h"><span class="au-ico entry">⚡</span><span class="au-kind">When this happens</span></div>
          <div class="au-node-t">${t.icon || ''} ${e(t.label || '')}</div>
          <div class="au-node-s">${e(a.trigger.detail || t.desc || '')}</div>
          <div class="au-conds"><span class="au-condlbl">Only firms where</span>${condList(a.entry, 'Every firm')}</div>
          <div class="au-node-foot">Re-entry: ${e(a.reentry)}</div>
        </div>
        <div class="au-exit${UI.sel === 'exit' ? ' sel' : ''}" data-sel="exit"><span class="au-ico exit">⛔</span><div><div class="au-kind">Exit conditions</div><div class="au-conds">${condList(a.exit, 'None — firms run to the end')}</div><small>Checked before every step. A firm that matches leaves the automation.</small></div></div>
        ${stepsHtml(a.steps, 'main')}
        <div class="au-endcap">● End</div>
      </div>`;
  }
  function plus(path, i) { return `<div class="au-link-line"><button type="button" class="au-plus" data-add="${path}" data-at="${i}" aria-label="Add a step">＋</button></div>`; }
  function stepsHtml(steps, path) {
    let h = plus(path, 0);
    steps.forEach((n, i) => {
      h += n.type === 'if' ? ifHtml(n) : stepHtml(n);
      if (n.type !== 'end') h += plus(path, i + 1);
    });
    return h;
  }
  function stepHtml(n) {
    const A = ACTION[n.type] || {};
    return `<div class="au-node t-${n.type}${UI.sel === n.id ? ' sel' : ''}" data-sel="${n.id}">
        <div class="au-node-h"><span class="au-ico t-${n.type}">${A.icon || ''}</span><span class="au-kind">${e(A.group || '')}</span>
          <button type="button" class="au-x" data-del="${n.id}" aria-label="Delete step">✕</button></div>
        <div class="au-node-t">${e(A.label || n.type)}</div><div class="au-node-s">${summary(n)}</div></div>`;
  }
  function ifHtml(n) {
    return `<div class="au-node t-if${UI.sel === n.id ? ' sel' : ''}" data-sel="${n.id}">
        <div class="au-node-h"><span class="au-ico t-if">🔀</span><span class="au-kind">If / Else</span><button type="button" class="au-x" data-del="${n.id}" aria-label="Delete step">✕</button></div>
        <div class="au-conds">${condList(n.cfg, 'Add a condition')}</div></div>
      <div class="au-branches">
        <div class="au-branch yes"><div class="au-blabel yes">✓ Yes</div>${stepsHtml(n.yes, n.id + ':yes')}</div>
        <div class="au-branch no"><div class="au-blabel no">✕ No</div>${stepsHtml(n.no, n.id + ':no')}</div>
      </div><div class="au-merge"></div>`;
  }

  /* ---------- right panel ---------- */
  const sel = (f, opts, v) => `<select data-f="${f}">${opts.map((o) => `<option${o === v ? ' selected' : ''}>${e(o)}</option>`).join('')}</select>`;
  const inp = (f, v, ph) => `<input type="text" data-f="${f}" value="${e(v ?? '')}" placeholder="${e(ph || '')}">`;
  const row = (label, ctl, hint) => `<label class="au-row"><span>${label}</span>${ctl}${hint ? `<small>${hint}</small>` : ''}</label>`;
  function condEditor(g, base) {
    return `<div class="au-condedit">
      <div class="au-match">Match ${sel(base + '.match', ['all', 'any'], g.match)} of these</div>
      ${g.conds.map((c, i) => `<div class="au-crow">${sel(`${base}.conds.${i}.field`, FIELDS, c.field)}${sel(`${base}.conds.${i}.op`, OPS, c.op)}${inp(`${base}.conds.${i}.value`, c.value, 'value')}<button type="button" class="au-x" data-delcond="${base}" data-i="${i}" aria-label="Remove">✕</button></div>`).join('')}
      <button type="button" class="au-btn sm" data-addcond="${base}">＋ Add condition</button></div>`;
  }
  function panelHtml(a) {
    if (!UI.sel) return `<div class="au-empty"><b>Select a step</b><p>Click any step to edit it, or ＋ between steps to add one. Firms run top to bottom; exit conditions are checked before every step.</p>
      <ul class="au-legend"><li><span class="au-ico entry">⚡</span>Entry: what starts it and which firms</li><li><span class="au-ico exit">⛔</span>Exit: when a firm should stop</li><li><span class="au-ico t-if">🔀</span>If / Else: split on a condition</li><li><span class="au-ico t-wait">⏳</span>Delays: wait time or wait until</li></ul></div>`;
    if (UI.sel === 'entry') {
      return `<h3>⚡ Entry</h3>
        ${row('Trigger', `<select data-f="trigger.type">${Object.entries(TRIGGERS).map(([k, t]) => `<option value="${k}"${k === a.trigger.type ? ' selected' : ''}>${t.icon} ${e(t.label)}</option>`).join('')}</select>`, e((TRIGGERS[a.trigger.type] || {}).desc || ''))}
        ${row('Details', inp('trigger.detail', a.trigger.detail, 'e.g. Meeting title contains “Onboarding”'))}
        <div class="au-sub">Entry conditions</div>${condEditor(a.entry, 'entry')}
        ${row('Re-entry', sel('reentry', ['Once', 'Every time it triggers', 'Once every 30 days', 'Once every 60 days', 'Once per contract term'], a.reentry), 'Whether a firm can go through this again')}`;
    }
    if (UI.sel === 'exit') return `<h3>⛔ Exit conditions</h3><p class="au-help">Checked before every step. A firm that matches leaves and is marked <b>Exited</b>.</p>${condEditor(a.exit, 'exit')}`;
    const f = find(a.steps, UI.sel);
    if (!f) return '';
    const n = f.n, c = n.cfg, A = ACTION[n.type] || {}, p = 'node.';
    let body = '';
    if (n.type === 'email') {
      body = row('From', sel(p + 'from', ['Firm’s CSM', 'Firm’s IM', 'Support (support@lawmatics.com)', 'Firm’s owner'], c.from), 'Sends from that person’s Gmail, in their Sent folder')
        + row('To', sel(p + 'to', ['Primary contact', 'Decision maker', 'All onboarding contacts', 'All contacts'], c.to))
        + row('Subject', inp(p + 'subject', c.subject))
        + `<label class="au-row"><span>Message</span><textarea data-f="${p}body" rows="9">${e(c.body)}</textarea></label>
          <small class="au-mergehint">Fill-in fields · {{reschedule_link}} comes from meetings booked through the Lawmatics scheduler</small>
          <div class="au-merges">${MERGE.map((m) => `<button type="button" data-merge="${m}">${m}</button>`).join('')}</div>`
        + `<label class="au-check"><input type="checkbox" data-f="${p}approval"${c.approval ? ' checked' : ''}> Rep approves each email before it sends</label>`
        + row('Delivery window', sel(p + 'window', ['Any time', 'Weekdays 8am–5pm firm time', 'Weekdays 9am–12pm firm time'], c.window))
        + `<div class="au-preview"><div class="au-sub">Preview · Test – Harbor Point Injury Law</div><b>${e(fill(c.subject))}</b><pre>${e(fill(c.body))}</pre></div>`;
    } else if (n.type === 'sms') {
      body = row('To', sel(p + 'to', ['Primary contact', 'Decision maker'], c.to)) + `<label class="au-row"><span>Text</span><textarea data-f="${p}body" rows="4">${e(c.body)}</textarea></label>`;
    } else if (n.type === 'slack') {
      body = row('Send to', sel(p + 'to', ['Firm’s CSM (DM)', 'Firm’s IM (DM)', 'Firm’s manager (DM)', '#cs-renewals', '#cs-ops'], c.to)) + `<label class="au-row"><span>Message</span><textarea data-f="${p}text" rows="4">${e(c.text)}</textarea></label>`;
    } else if (n.type === 'booking') {
      body = row('Link', sel(p + 'kind', ['reschedule link', 'booking link', 'renewal call link'], c.kind)) + row('From', sel(p + 'from', ['Firm’s IM', 'Firm’s CSM'], c.from));
    } else if (n.type === 'wait') {
      body = `<div class="au-inline">${row('Wait', `<input type="number" min="1" data-f="${p}amount" value="${e(c.amount)}">`)}${row('&nbsp;', sel(p + 'unit', ['minutes', 'hours', 'days', 'business days', 'weeks'], c.unit))}</div>`;
    } else if (n.type === 'waituntil') {
      body = row('Wait until', sel(p + 'what', ['They reply or book a meeting', 'They reply', 'They book a meeting', 'Merlin usage % is at least 50', 'Their open support tickets are closed', 'The task is completed'], c.what))
        + row('Give up after', sel(p + 'limit', ['2 business days', '5 business days', '7 days', '14 days', '30 days'], c.limit), 'Then the firm moves to the next step');
    } else if (n.type === 'if') {
      body = `<p class="au-help">Firms that match go down <b>Yes</b>, everyone else goes down <b>No</b>.</p>` + condEditor(c, 'node');
    } else if (n.type === 'stage') {
      body = row('Move to', sel(p + 'to', ['Next call in the plan', 'Needs to Schedule', 'First Onboarding', 'Second Onboarding', 'Third Onboarding', 'Complete'], c.to));
    } else if (n.type === 'field' || n.type === 'sf') {
      body = row(n.type === 'sf' ? 'Salesforce field' : 'Field', n.type === 'sf' ? inp(p + 'field', c.field, 'e.g. Customer_Status__c') : sel(p + 'field', FIELDS, c.field)) + row('Set to', inp(p + 'value', c.value));
    } else if (n.type === 'owner') {
      body = row('Owner', sel(p + 'to', ['Firm’s CSM', 'Firm’s IM', 'Support', 'Round robin (IMs)'], c.to));
    } else if (n.type === 'task') {
      body = row('Task', inp(p + 'title', c.title)) + row('For', sel(p + 'who', ['Firm’s CSM', 'Firm’s IM', 'Firm’s manager'], c.who)) + row('Due', sel(p + 'due', ['Same day', '2 business days', '3 business days', '5 business days'], c.due));
    } else if (n.type === 'note') {
      body = `<label class="au-row"><span>Note</span><textarea data-f="${p}text" rows="3">${e(c.text)}</textarea></label>`;
    } else if (n.type === 'end') body = '<p class="au-help">Firms that reach this step finish the automation.</p>';
    return `<h3>${A.icon || ''} ${e(A.label || n.type)}</h3>${body}<div class="au-panel-foot"><button type="button" class="au-btn danger sm" data-del="${n.id}">Delete step</button></div>`;
  }
  function fill(s) {
    return String(s || '').replace(/\{\{contact\.first_name\}\}/g, 'Maria').replace(/\{\{firm\.name\}\}/g, 'Test – Harbor Point Injury Law')
      .replace(/\{\{csm\.first_name\}\}/g, 'Elliott').replace(/\{\{csm\.name\}\}/g, 'Elliott Jones').replace(/\{\{im\.first_name\}\}/g, 'Callie')
      .replace(/\{\{merlin\.credits_30d\}\}/g, '12').replace(/\{\{merlin\.credits_monthly\}\}/g, '100').replace(/\{\{meeting\.date\}\}/g, 'Tue, Nov 24')
      .replace(/\{\{reschedule_link\}\}/g, 'https://app.lawmatics.com/forms/share/…/reschedule').replace(/\{\{booking_link\}\}/g, 'https://app.lawmatics.com/booking/elliott');
  }

  function pickerHtml() {
    return `<div class="au-modal" data-pickclose><div class="au-picker" role="dialog" aria-label="Add a step"><div class="au-picker-h"><b>Add a step</b><button type="button" class="au-x" data-pickclose aria-label="Close">✕</button></div>
      ${ACTIONS.map((g) => `<div class="au-pgroup"><div class="au-sub">${g.group}</div><div class="au-pgrid">${g.items.map(([k, icon, label, desc]) => `<button type="button" class="au-pick" data-pick="${k}"><span class="au-ico t-${k}">${icon}</span><span><b>${label}</b><small>${desc}</small></span></button>`).join('')}</div></div>`).join('')}
    </div></div>`;
  }
  function testHtml(a) {
    const firms = ['Test – Harbor Point Injury Law', 'Test – Ridgeway Family Law', 'Test – Cedar & Stone Estate Planning', 'Test – Blue Mesa Criminal Defense', 'Test – Summit Employment Law', 'Test – Northgate Elder Law', 'Test – Oakline Bankruptcy'];
    const csms = ['Elliott Jones', 'Julio Ortiz', 'Jessie Hobbs'];
    return `<div class="au-modal" data-testclose><div class="au-picker au-testbox" role="dialog" aria-label="Test run"><div class="au-picker-h"><b>▶ Test run · ${e(a.name)}</b><button type="button" class="au-x" data-testclose aria-label="Close">✕</button></div>
      <p class="au-help">If this were switched on now, <b>${firms.length} firms</b> would enter. Nothing is sent in a test run — this is what each would get first.</p>
      <table class="au-table compact"><thead><tr><th>Firm</th><th>Rep</th><th>First step</th><th>When</th></tr></thead><tbody>
      ${firms.map((f, i) => `<tr><td>${e(f)}</td><td>${e(csms[i % 3])}</td><td>${e((ACTION[(a.steps[0] || {}).type] || {}).label || '—')}</td><td>${i % 3 ? 'Tomorrow 9:00 AM' : 'Now (in delivery window)'}</td></tr>`).join('')}
      </tbody></table><div class="au-test-foot"><span class="au-muted">3 more firms match but were emailed in the last 30 days (frequency cap).</span><button type="button" class="au-btn primary" data-testclose>Looks right</button></div></div></div>`;
  }
  function activityHtml(a) {
    const st = [['Running', 'st-run', 'Step 2 · Wait until they reply'], ['Waiting for approval', 'st-appr', 'Step 1 · Email to Maria (Elliott to approve)'], ['Delayed', 'st-del', 'Until Tue 9:00 AM'], ['Finished', 'st-fin', 'Completed all steps'], ['Exited', 'st-ex', 'Exit: Booked a meeting']];
    const firms = ['Test – Harbor Point Injury Law', 'Test – Ridgeway Family Law', 'Test – Cedar & Stone Estate Planning', 'Test – Blue Mesa Criminal Defense', 'Test – Summit Employment Law', 'Test – Northgate Elder Law', 'Test – Oakline Bankruptcy', 'Test – Willow Creek Legal', 'Test – Granite Law Group', 'Test – Bayview Immigration Group'];
    return `<main class="au-listwrap"><div class="au-kpis wide">${['running', 'delayed', 'finished', 'exited'].map((k) => `<div><b>${a.stats[k]}</b><span>${k[0].toUpperCase() + k.slice(1)}</span></div>`).join('')}<div><b>${a.stats.enrolled}</b><span>Entered all time</span></div></div>
      <div class="au-tablewrap"><table class="au-table"><thead><tr><th>Firm</th><th>Status</th><th>Where they are</th><th>Entered</th><th></th></tr></thead><tbody>
      ${firms.map((f, i) => { const s = st[i % st.length]; return `<tr><td>${e(f)}</td><td><span class="au-st ${s[1]}">${s[0]}</span></td><td>${e(s[2])}</td><td>${i + 1}d ago</td><td>${s[0] === 'Waiting for approval' ? '<button type="button" class="au-btn sm primary">Review email</button>' : s[0] === 'Delayed' ? '<button type="button" class="au-btn sm">Skip delay</button>' : s[0] === 'Running' ? '<button type="button" class="au-btn sm">Force exit</button>' : '<button type="button" class="au-btn sm">Restart</button>'}</td></tr>`; }).join('')}
      </tbody></table></div></main>`;
  }
  function settingsHtml(a) {
    return `<main class="au-listwrap"><div class="au-settings">
      ${row('Folder', sel('folder', ['Onboarding', 'Adoption', 'Renewals', 'Support'], a.folder))}
      ${row('Max emails per firm', sel('cap', ['1 every 7 days', '1 every 14 days', '1 every 30 days'], a.cap || '1 every 14 days'), 'Across all automations — protects firms from getting too much')}
      ${row('Quiet hours', sel('quiet', ['Weekdays 8am–5pm firm time', 'Any time'], a.quiet || 'Weekdays 8am–5pm firm time'))}
      ${row('Skip firms that', sel('skip', ['Have an open support ticket', 'Are flagged to cancel', 'Are excluded on the dashboard', 'Never skip'], a.skip || 'Are flagged to cancel'))}
      ${row('When switched on', sel('start', ['Run on future matches only', 'Run now on every firm that matches'], a.start || 'Run on future matches only'), 'Like Lawmatics: choose whether firms that already match start right away')}
      ${row('Daily limit', sel('limit', ['25 firms a day', '50 firms a day', 'No limit'], a.limit || '25 firms a day'), 'A safety cap while a new automation settles in')}
    </div></main>`;
  }

  /* ---------- events ---------- */
  function setPath(obj, path, val) {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  }
  function onInput(ev) {
    const t = ev.target, f = t.dataset && t.dataset.f;
    if (!f) return;
    const a = cur();
    const val = t.type === 'checkbox' ? t.checked : t.value;
    if (f.startsWith('node.')) { const n = find(a.steps, UI.sel).n; setPath(f === 'node.match' || f.startsWith('node.conds') ? n.cfg : n.cfg, f.slice(5), val); }
    else setPath(a, f, val);
    a.edited = 'just now';
    save();
    // Redraw the canvas only (keeps focus in the panel while typing).
    const cv = document.getElementById('auCanvas');
    if (cv) cv.innerHTML = canvasHtml(a);
    if (ev.type === 'change' && t.tagName === 'SELECT') render();
    if (t.dataset.f === 'node.subject' || t.dataset.f === 'node.body') {
      const pv = document.querySelector('.au-preview');
      if (pv) { const n = find(a.steps, UI.sel).n; pv.querySelector('b').textContent = fill(n.cfg.subject); pv.querySelector('pre').textContent = fill(n.cfg.body); }
    }
  }
  function onClick(ev) {
    const t = ev.target;
    const q = (s) => t.closest(s);
    const a = UI.autoId ? cur() : null;
    if (q('[data-toggle]')) { const x = STATE.list.find((y) => y.id === q('[data-toggle]').dataset.toggle); x.active = !x.active; save(); render(); return; }
    if (q('[data-open]')) { UI.autoId = q('[data-open]').dataset.open; UI.view = 'builder'; UI.tab = 'build'; UI.sel = null; render(); return; }
    if (q('[data-new]')) {
      const n = { id: 'a' + Date.now(), name: 'Untitled automation', folder: 'Adoption', active: false, edited: 'just now', by: (window.DEMO_PERSONA && DEMO_PERSONA().name.split(' ')[0]) || 'You',
        trigger: { type: 'usage', detail: '' }, entry: { match: 'all', conds: [] }, reentry: 'Once', exit: { match: 'any', conds: [] }, steps: [], stats: { enrolled: 0, running: 0, delayed: 0, finished: 0, exited: 0 } };
      STATE.list.unshift(n); save(); UI.autoId = n.id; UI.view = 'builder'; UI.tab = 'build'; UI.sel = 'entry'; render(); return;
    }
    if (q('[data-back]')) { UI.view = 'list'; render(); return; }
    if (q('[data-tab]')) { UI.tab = q('[data-tab]').dataset.tab; render(); return; }
    if (q('[data-save]')) { const b = q('[data-save]'); b.textContent = '✓ Saved'; setTimeout(() => { b.textContent = 'Save'; }, 1400); return; }
    if (q('[data-test]')) { UI.test = true; render(); return; }
    // A picked step is added first; the picker and test windows close only from their ✕/button or the dark backdrop.
    if (q('[data-pick]') && UI.picker) {
      const arr = pathArr(a, UI.picker.path), n = newNode(q('[data-pick]').dataset.pick);
      if (arr) { arr.splice(UI.picker.at, 0, n); UI.sel = n.id; a.edited = 'just now'; save(); }
      UI.picker = null; render(); return;
    }
    const closer = (attr) => t.matches('.au-modal[' + attr + ']') || !!t.closest('button[' + attr + ']');
    if (closer('data-testclose')) { UI.test = false; render(); return; }
    if (closer('data-pickclose')) { UI.picker = null; render(); return; }
    if (q('.au-modal')) return;
    if (q('[data-add]')) { const b = q('[data-add]'); UI.picker = { path: b.dataset.add, at: Number(b.dataset.at) }; render(); return; }
    if (q('[data-del]')) { const f = find(a.steps, q('[data-del]').dataset.del); if (f) { f.arr.splice(f.i, 1); if (UI.sel === f.n.id) UI.sel = null; save(); render(); } return; }
    if (q('[data-addcond]')) { const base = q('[data-addcond]').dataset.addcond; const g = base === 'node' ? find(a.steps, UI.sel).n.cfg : a[base]; g.conds.push({ field: FIELDS[0], op: 'is', value: '' }); save(); render(); return; }
    if (q('[data-delcond]')) { const b = q('[data-delcond]'); const g = b.dataset.delcond === 'node' ? find(a.steps, UI.sel).n.cfg : a[b.dataset.delcond]; g.conds.splice(Number(b.dataset.i), 1); save(); render(); return; }
    if (q('[data-merge]')) {
      const ta = document.querySelector('.au-panel textarea[data-f="node.body"]');
      if (ta) { const s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, s) + q('[data-merge]').dataset.merge + ta.value.slice(ta.selectionEnd ?? s); ta.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    if (q('[data-sel]') && !q('.au-x') && !q('.au-plus')) { UI.sel = q('[data-sel]').dataset.sel; render(); }
  }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && document.getElementById('auPage') && (UI.picker || UI.test)) { UI.picker = null; UI.test = false; render(); } });

  /* ---------- its own main tab, managers only ---------- */
  // Added before boot.js wires up the tabs, so the normal tab switching picks it up.
  const nav = document.querySelector('.tabbar');
  if (nav && !document.querySelector('[data-tab="auto"]')) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.dataset.tab = 'auto';
    tab.hidden = true;
    tab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> Automations';
    tab.addEventListener('click', () => setTimeout(open, 0));
    nav.appendChild(tab);
    const view = document.createElement('div');
    view.className = 'view';
    view.id = 'view-auto';
    view.innerHTML = '<div class="wrap"><div id="auHost"></div></div>';
    const last = document.getElementById('view-partners') || document.querySelector('.view:last-of-type');
    if (last) last.after(view); else document.body.appendChild(view);
    // Managers only: show once sign-in has settled, hide (and leave the tab) for everyone else.
    setInterval(() => {
      const mgr = typeof isManager === 'function' && typeof AUTH !== 'undefined' && AUTH.email && isManager();
      tab.hidden = !mgr;
      if (!mgr && tab.classList.contains('active')) document.querySelector('.tab[data-tab="team"]')?.click();
    }, 700);
  }
  window.openAutomations = open;
})();
