/* ==========================================================================
   Firm Lookup → Timeline — MOCKUP for the test site only (tools/build-demo.sh loads it).
   Everything that happened with a firm in one feed (replacing ChurnZero's account activity):
   emails, meetings, notes, tasks, surveys, support conversations, automation steps and field changes,
   plus the firm's open tasks and an "add a note" box. Made up from the test firm's details;
   notes and tasks people add are kept in this browser only.
   ========================================================================== */
(function () {
  if (!window.CS_DEMO) return;
  const KEY = 'cs-demo-notes';
  const DAY = 864e5;
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const first = (n) => String(n || '').split(' ')[0];
  const short = (n) => String(n || '').replace(/^Test – /, '');
  const iso = (t) => new Date(t).toISOString();
  const ago = (d, h) => Date.now() - d * DAY - (h || 0) * 3600e3;
  let NOTES = {};
  try { NOTES = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (x) { NOTES = {}; }
  const saveNotes = () => { try { localStorage.setItem(KEY, JSON.stringify(NOTES)); } catch (x) { /* */ } };

  const TYPES = {
    email: ['✉️', 'Emails'], meeting: ['🎧', 'Meetings'], note: ['📝', 'Notes'], task: ['✅', 'Tasks'],
    survey: ['⭐', 'Surveys'], support: ['💬', 'Support'], auto: ['⚡', 'Automations'], change: ['✏️', 'Changes'],
  };

  // Same contact the Emails card picks for this firm (same seed and first draw).
  function build(firmId) {
    const f = (window.DEMO_FIRM && window.DEMO_FIRM(firmId)) || null;
    if (!f) return { f: null, items: [] };
    let seed = Number(String(firmId).replace(/\D/g, '')) || 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const contact = pick(['Maria Lopez', 'Jordan Pike', 'Sam Reed', 'Priya Shah', 'Dana Ruiz', 'Chris Nolan']);
    const onb = !!f.onboarding;
    const rep = onb ? f.im : (f.csm || 'Support');
    const age = Math.max(10, Math.round((Date.now() - new Date(f.signup + 'T12:00:00')) / DAY));
    const span = Math.min(age, 180);
    const items = [];
    const add = (type, t, title, detail, who, extra) => items.push(Object.assign({ type, at: iso(t), title, detail: detail || '', who: who || '' }, extra || {}));

    // Meetings
    const calls = onb ? ['Kickoff', 'First Onboarding', 'Second Onboarding', 'Third Onboarding', 'Fourth Onboarding'].slice(0, Math.max(1, Math.min(5, Math.floor(age / 12))))
      : ['Check-in', 'Merlin walkthrough', 'Check-in', 'Renewal review'].slice(0, int(1, 3));
    calls.forEach((c, i) => {
      const d = Math.min(span - 1, Math.round(span * (calls.length - i) / (calls.length + 1)) + int(-2, 2));
      const missed = rnd() < 0.12;
      add('meeting', ago(Math.max(1, d), int(1, 6)), `${c} · ${missed ? 'Missed' : 'Completed'}`,
        missed ? 'Marked missed by ' + first(rep) + ' · reschedule emails started' : `${int(25, 55)} min on Zoom with ${contact} · ${pick(['Set up intake form and web form', 'Walked through automations and reminders', 'Reviewed reporting and pipeline', 'Turned on lead scoring', 'Covered calendar sync and booking links'])}`,
        rep, { tone: missed ? 'bad' : '' });
      if (!missed && onb) add('change', ago(Math.max(1, d), int(0, 1)), 'Onboarding stage', `${c} → next call in the plan`, 'Automation: Onboarding call completed');
    });
    if (f.next) add('meeting', new Date(f.next + 'T10:00:00').getTime(), (onb ? 'Next onboarding call' : 'Upcoming call') + ' · Scheduled', `With ${contact} · booked through the Lawmatics scheduler`, rep, { future: true });

    // Emails
    const subj = onb ? ['Kickoff recap + next steps', 'Forms review before Thursday', 'Automations ready for approval', 'Before our first call: what to send over']
      : ['Checking in on ' + short(f.name), 'Getting more out of Merlin', 'Question about our invoice', 'Renewal coming up', 'A few quick wins for ' + short(f.name)];
    for (let i = 0; i < int(3, 7); i++) {
      const out = rnd() < 0.6;
      add('email', ago(int(1, span), int(1, 9)), out ? `Email sent: ${pick(subj)}` : `Reply from ${first(contact)}: ${pick(subj)}`,
        out ? (rnd() < 0.3 ? 'Sent by automation through SendGrid · ' + (onb ? 'Open onboarding with no call booked' : 'Low adoption outreach') : 'From ' + rep + '’s Gmail') : `${contact} → ${first(rep)}`, out ? rep : contact);
    }
    // Support conversations
    for (let i = 0; i < int(0, 3); i++) {
      add('support', ago(int(2, span), int(1, 9)), 'Intercom conversation: ' + pick(['Calendar sync duplicates', 'Form not sending notifications', 'How do I add a user?', 'SMS not delivering', 'Merlin lead score missing']),
        pick(['Closed · CSAT 5', 'Closed · CSAT 4', 'Closed', 'Open · waiting on engineering']), pick(['Claire Ortiz', 'Dan Serrano', 'Chelsea Lance', 'Max Castro']));
    }
    // Surveys
    if (!onb && f.csat) add('survey', ago(int(5, span), 3), `Support CSAT: ${f.csat}/5`, f.csat >= 5 ? '“Super quick and helpful!” · G2 review email sent' : '“Took a couple of tries to fix.”', contact, { tone: f.csat >= 5 ? 'good' : '' });
    if (!onb && rnd() < 0.5) { const s = pick([10, 9, 8, 6, 4]); add('survey', ago(int(10, span), 2), `NPS: ${s}`, s >= 9 ? '“Lawmatics runs our whole intake now.” · Referral email sent' : s <= 6 ? '“Reporting is hard to use.” · Detractor follow-up started' : '“Good overall.”', contact, { tone: s >= 9 ? 'good' : s <= 6 ? 'bad' : '' }); }
    if (onb && age > 30 && rnd() < 0.5) add('survey', ago(int(1, 10), 2), 'Onboarding CSAT: 5/5', '“' + first(rep) + ' was fantastic.”', contact, { tone: 'good' });
    // Automations
    if (onb) add('auto', ago(Math.max(1, span - 1), 5), 'Entered “New customer: welcome + book the first call”', 'Welcome email from the AE · call task for ' + first(rep), 'Automation');
    else {
      if (f.score > 66) add('auto', ago(int(3, 30), 4), 'Entered “Low adoption outreach”', 'Churn score moved to At risk (' + f.score + ')', 'Automation', { tone: 'bad' });
      if (f.doneDay) add('auto', new Date(f.doneDay + 'T09:00:00').getTime(), 'Entered “Onboarding complete: welcome to live”', 'Onboarding closed · handed to ' + rep, 'Automation');
    }
    // Field changes
    (f.changes || []).forEach(([d, amt, cat]) => add('change', new Date(d + 'T12:00:00').getTime(), 'MRR', `${amt > 0 ? '+' : ''}$${Math.abs(amt)} ${cat === 'u' ? '(upgrade)' : cat === 'c' ? '(cancelled)' : '(downgrade)'}`, 'Chargebee'));
    if (!onb && f.doneDay) add('change', new Date(f.doneDay + 'T12:00:00').getTime(), 'Owner', `${f.im} → ${rep}`, 'IM → CSM handoff');
    add('change', new Date(f.signup + 'T12:00:00').getTime(), 'Became a customer', `Closed Won · starting MRR $${f.start}`, 'Salesforce');
    // Notes (seeded + added)
    if (rnd() < 0.7) add('note', ago(int(3, span), 2), 'Note', pick(['Managing partner is the decision maker; paralegal Sam runs day to day.', 'Wants to add a second practice area next quarter.', 'Sensitive about price — mention annual discount at renewal.', 'Heavy SMS users; watch overage.']), rep);
    (NOTES[firmId] || []).forEach((n) => add('note', new Date(n.at).getTime(), 'Note', n.text, n.by));
    // Completed tasks
    (window.DEMO_TASKS ? window.DEMO_TASKS.forFirm(firmId) : []).filter((t) => t.done).forEach((t) => add('task', new Date((t.doneAt || t.due) + 'T15:00:00').getTime(), 'Task done: ' + t.title, t.source === 'auto' ? 'From automation · ' + t.auto : 'Added by ' + t.by, t.who, { tone: 'good' }));

    items.sort((a, b) => b.at.localeCompare(a.at));
    return { f, items, contact, rep };
  }

  const S = { firm: null, filter: 'all', more: false, data: null };
  const when = (s) => { const d = new Date(s); return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const monthOf = (s) => new Date(s).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const dueLabel = (d) => { const n = Math.round((new Date(d + 'T12:00:00') - new Date(new Date().toDateString())) / DAY); return n < 0 ? `${-n}d overdue` : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }); };

  function html() {
    const D = S.data = build(S.firm);
    if (!D.f) return '';
    const counts = {}; D.items.forEach((i) => { counts[i.type] = (counts[i.type] || 0) + 1; });
    const list = D.items.filter((i) => S.filter === 'all' || i.type === S.filter);
    const future = list.filter((i) => i.future), past = list.filter((i) => !i.future);
    const shown = S.more ? past : past.slice(0, 18);
    let lastM = '';
    const rows = shown.map((i) => {
      const m = monthOf(i.at); const head = m !== lastM ? `<li class="tl-month">${e(m)}</li>` : ''; lastM = m;
      return head + item(i);
    }).join('');
    const tasks = window.DEMO_TASKS ? window.DEMO_TASKS.forFirm(S.firm).filter((t) => !t.done).sort((a, b) => a.due.localeCompare(b.due)) : [];
    return `<div class="em-head"><h4>🕑 Timeline <span class="muted">${D.items.length} events</span></h4><span class="em-mock">Test data · emails, calls, Intercom, Chargebee, automations</span></div>
      <div class="tl-top">
        <div class="tl-tasks"><div class="tl-sub">Open tasks <span>${tasks.length}</span><button type="button" class="tl-link" data-tl-addtask>＋ Task</button></div>
          ${S.addTask ? `<form class="tl-taskform" data-tl-taskform><input name="title" placeholder="What needs doing?" required aria-label="Task"><input type="date" name="due" aria-label="Due date" value="${new Date(Date.now() + DAY).toISOString().slice(0, 10)}"><button type="submit" class="au-btn sm primary">Add</button><button type="button" class="au-btn sm" data-tl-canceltask>Cancel</button></form>` : ''}
          <ul>${tasks.map((t) => `<li class="${t.due < new Date().toISOString().slice(0, 10) ? 'late' : ''}"><button type="button" class="tk-check" data-tl-done="${t.id}" aria-label="Mark done"></button><span>${e(t.title)}<small>${e(t.who)} · ${t.source === 'auto' ? '⚡ ' + e(t.auto) : '✍️ ' + e(t.by)}</small></span><b>${e(dueLabel(t.due))}</b></li>`).join('') || '<li class="tl-none">No open tasks.</li>'}</ul></div>
        <form class="tl-note" data-tl-note><textarea name="text" rows="3" placeholder="Add a note for the team about ${e(short(D.f.name))}…" aria-label="Add a note"></textarea><button type="submit" class="au-btn sm primary">Save note</button></form>
      </div>
      <div class="em-chips tl-chips"><button type="button" data-tl-filter="all" class="${S.filter === 'all' ? 'on' : ''}">All</button>${Object.entries(TYPES).filter(([k]) => counts[k]).map(([k, [ic, l]]) => `<button type="button" data-tl-filter="${k}" class="${S.filter === k ? 'on' : ''}">${ic} ${l} <span>${counts[k]}</span></button>`).join('')}</div>
      ${future.length ? `<ul class="tl-feed">${'<li class="tl-month">Coming up</li>' + future.map(item).join('')}</ul>` : ''}
      <ul class="tl-feed">${rows || '<li class="tl-none">Nothing here yet.</li>'}</ul>
      ${past.length > 18 && !S.more ? `<button type="button" class="au-btn sm tl-more" data-tl-more>Show ${past.length - 18} older</button>` : ''}`;
  }
  function item(i) {
    const [ic] = TYPES[i.type] || ['•'];
    return `<li class="tl-item t-${i.type}${i.tone ? ' ' + i.tone : ''}"><span class="tl-ic">${ic}</span><div class="tl-body"><b>${e(i.title)}</b>${i.detail ? `<p>${e(i.detail)}</p>` : ''}<small>${i.who ? e(i.who) + ' · ' : ''}${e(when(i.at))}</small></div></li>`;
  }
  function draw(card) { card.innerHTML = html(); }

  // Runs after the Emails card has been added (that observer is set up first), so the timeline sits under it.
  const check = () => { const prod = document.getElementById('pfProduct'); if (prod && !document.getElementById('pfTimeline')) insert(prod, document.getElementById('pfEmails') || prod); };
  const obs = new MutationObserver(() => setTimeout(check, 0));
  function insert(prod, after) {
    const card = document.createElement('div');
    card.className = 'pf-card em-card tl-card'; card.id = 'pfTimeline';
    S.firm = prod.dataset.firm; S.filter = 'all'; S.more = false; S.addTask = false;
    after.after(card); draw(card);
    card.addEventListener('click', (ev) => {
      const q = (s) => ev.target.closest(s); let el;
      if ((el = q('[data-tl-filter]'))) { S.filter = el.dataset.tlFilter; draw(card); }
      else if (q('[data-tl-more]')) { S.more = true; draw(card); }
      else if ((el = q('[data-tl-done]'))) { window.DEMO_TASKS.toggle(el.dataset.tlDone); draw(card); }
      else if (q('[data-tl-addtask]')) { S.addTask = true; draw(card); card.querySelector('[data-tl-taskform] input')?.focus(); }
      else if (q('[data-tl-canceltask]')) { S.addTask = false; draw(card); }
    });
    card.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target); const D = S.data;
      if (ev.target.matches('[data-tl-note]')) {
        const text = String(fd.get('text') || '').trim(); if (!text) return;
        const by = window.DEMO_PERSONA ? window.DEMO_PERSONA().name : 'You';
        (NOTES[S.firm] = NOTES[S.firm] || []).push({ at: new Date().toISOString(), text, by: by === 'Test Manager' ? 'Clare Struzzi' : by });
        saveNotes(); S.filter = 'all'; draw(card);
      } else if (ev.target.matches('[data-tl-taskform]')) {
        window.DEMO_TASKS.add({ firmId: S.firm, firm: D.f.name, title: String(fd.get('title')).trim(), due: fd.get('due'), who: D.rep === 'Support' ? 'Jessie Hobbs' : D.rep });
        S.addTask = false; draw(card);
      }
    });
  }
  const start = () => { const h = document.getElementById('profile'); if (h) obs.observe(h, { childList: true, subtree: true }); else setTimeout(start, 500); };
  start();
})();
