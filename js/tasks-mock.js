/* ==========================================================================
   Tasks — MOCKUP for the test site only (tools/build-demo.sh loads it).
   Each rep's task list on the CS Dashboard (replacing ChurnZero tasks): tasks the automations create
   plus tasks added by hand, grouped Overdue / Today / This week / Later, with complete, undo, snooze,
   add, and a team view for managers. The firm timeline (js/timeline-mock.js) reads the same tasks.
   All made up; kept in this browser only.
   ========================================================================== */
(function () {
  if (!window.CS_DEMO) return;
  const KEY = 'cs-demo-tasks';
  const DAY = 864e5;
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const iso = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const TODAY = iso(Date.now());
  const plus = (n) => iso(Date.now() + n * DAY);
  const short = (n) => String(n || '').replace(/^Test – /, '');
  function rng(s) { s = s % 2147483647 || 7; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  /* ---------- seed ---------- */
  const ONB = [
    ['New customer: welcome + book the first call', 'Call {f} to welcome them and book the first call', 'High'],
    ['Open onboarding with no call booked', '{f} needs to schedule their next call', ''],
    ['Missed onboarding call: reschedule', 'Call {f} to reschedule', 'High'],
    ['Paused onboarding check-in', 'Check in with {f} about restarting onboarding', ''],
    ['', 'Send {f} the updated intake form', ''],
    ['', 'Review {f}’s uploaded templates before next call', ''],
  ];
  const CSM = [
    ['Low adoption outreach', 'Call {f}: low adoption', ''],
    ['Low adoption outreach', 'No response from {f} after 3 emails', ''],
    ['Renewal countdown', '{f} renews in 4 months: run Renewal prep', ''],
    ['Renewal countdown', '{f} renews in 2 months: confirm renewal call', 'High'],
    ['NPS detractor follow-up', 'Negative NPS (4) from {f}', 'High'],
    ['Contraction: update Chargebee', 'Update Chargebee for {f}’s contraction', ''],
    ['', 'Send {f} the Merlin lead-scoring walkthrough', ''],
    ['', 'Follow up with {f} on the reporting questions', ''],
  ];
  const BY = ['Clare Struzzi', 'Erika Lara'];
  function seed() {
    const R = rng(9090);
    const pick = (a) => a[Math.floor(R() * a.length)];
    const out = [];
    (window.DEMO_FIRMS ? window.DEMO_FIRMS() : []).filter((f) => !f.cancelled).forEach((f) => {
      const who = f.onboarding ? f.im : f.csm;
      if (!who) return;
      const n = R() < (f.onboarding ? 0.75 : 0.3) ? (R() < 0.25 ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        const [auto, title, pri] = pick(f.onboarding ? ONB : CSM);
        const due = Math.round(R() * 20) - 6;
        const done = due < 0 && R() < 0.35;
        out.push({
          id: 't' + f.id + k, firmId: f.id, firm: f.name, title: title.replace('{f}', short(f.name)), who, due: plus(due),
          source: auto ? 'auto' : 'manual', auto, by: auto ? '' : (R() < 0.6 ? who : pick(BY)), pri,
          done, doneAt: done ? plus(Math.max(-6, due + Math.round(R() * 3))) : '', created: plus(Math.min(due, 0) - 1 - Math.round(R() * 5)),
        });
      }
    });
    return out;
  }
  let LIST;
  try { LIST = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (x) { LIST = null; }
  if (!Array.isArray(LIST)) LIST = null;
  const all = () => { if (!LIST) LIST = seed(); return LIST; };
  const listeners = [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(LIST)); } catch (x) { /* */ } listeners.forEach((f) => { try { f(); } catch (x) { /* */ } }); };
  const me = () => (window.DEMO_PERSONA ? window.DEMO_PERSONA().name : 'Test Manager');
  const isMgr = () => /manager/i.test(me());
  const REPS = ['Callie Burns', 'Andy Galindo', 'Admir Karamovic', 'Swetha Devakumar', 'Max Castro', 'Rosa Flores', 'Elliott Jones', 'Julio Ortiz', 'Jessie Hobbs', 'Kennedy Wickham'];

  // Shared with the firm timeline.
  window.DEMO_TASKS = {
    forFirm: (id) => all().filter((t) => t.firmId === String(id)),
    toggle: (id) => toggle(id),
    add: (t) => { all().unshift(Object.assign({ id: 't' + Date.now(), source: 'manual', by: me() === 'Test Manager' ? 'Clare Struzzi' : me(), created: TODAY, done: false, doneAt: '', pri: '', auto: '' }, t)); save(); },
    onChange: (f) => listeners.push(f),
    me, reps: REPS,
  };
  function toggle(id) {
    const t = all().find((x) => x.id === id); if (!t) return;
    t.done = !t.done; t.doneAt = t.done ? TODAY : ''; save();
    return t;
  }

  /* ---------- page ---------- */
  const UI = { who: '', view: 'open', src: 'all', q: '', adding: false, toast: null, menu: null };
  const dueLabel = (d) => {
    const n = Math.round((new Date(d + 'T12:00:00') - new Date(TODAY + 'T12:00:00')) / DAY);
    if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
    if (n < 0) return `${-n} days overdue`;
    return new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: n < 7 ? 'short' : undefined, month: 'short', day: 'numeric' });
  };
  function scope() {
    const w = isMgr() ? (UI.who || 'team') : me();
    return all().filter((t) => w === 'team' || t.who === w);
  }
  function open() {
    const host = document.getElementById('tkHost'); if (!host) return;
    let page = document.getElementById('tkPage');
    if (!page) {
      page = document.createElement('div'); page.id = 'tkPage'; page.className = 'tk-page'; host.appendChild(page);
      page.addEventListener('click', onClick); page.addEventListener('change', onChange); page.addEventListener('input', onInput);
    }
    render();
  }
  function render() {
    const page = document.getElementById('tkPage'); if (!page) return;
    const S = scope();
    const openT = S.filter((t) => !t.done);
    const overdue = openT.filter((t) => t.due < TODAY), today = openT.filter((t) => t.due === TODAY);
    const week = openT.filter((t) => t.due > TODAY && t.due <= plus(7)), later = openT.filter((t) => t.due > plus(7));
    const doneWk = S.filter((t) => t.done && t.doneAt >= plus(-7));
    const q = UI.q.trim().toLowerCase();
    const match = (t) => (UI.src === 'all' || t.source === UI.src) && (!q || (t.title + ' ' + t.firm + ' ' + (t.auto || '')).toLowerCase().includes(q));
    const team = isMgr() && (UI.who || 'team') === 'team';
    const row = (t) => `<li class="tk-row${t.done ? ' done' : ''}${!t.done && t.due < TODAY ? ' late' : ''}">
        <button type="button" class="tk-check" data-done="${t.id}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${t.done ? '✓' : ''}</button>
        <div class="tk-main"><div class="tk-title">${t.pri === 'High' && !t.done ? '<span class="tk-pri">High</span>' : ''}${e(t.title)}</div>
          <div class="tk-meta"><button type="button" class="tk-firm" data-firm="${t.firmId}">${e(short(t.firm))}</button>
            <span class="tk-src ${t.source}">${t.source === 'auto' ? '⚡ ' + e(t.auto) : '✍️ Added by ' + e(t.by)}</span>${team ? `<span class="tk-who">${e(t.who)}</span>` : ''}</div></div>
        <div class="tk-due">${t.done ? `Done ${e(dueLabel(t.doneAt).replace(' days overdue', ' days ago').replace('Today', 'today'))}` : e(dueLabel(t.due))}</div>
        <div class="tk-acts">${t.done ? '' : UI.menu === t.id ? `<span class="tk-snooze">${[[1, '1 day'], [3, '3 days'], [7, '1 week']].map(([n, l]) => `<button type="button" class="au-btn sm" data-snooze="${t.id}" data-n="${n}">${l}</button>`).join('')}</span>` : `<button type="button" class="au-btn sm" data-menu="${t.id}" title="Snooze">💤 Snooze</button>`}</div>
      </li>`;
    const group = (label, cls, arr) => { const a = arr.filter(match).sort((x, y) => x.due.localeCompare(y.due) || (y.pri === 'High') - (x.pri === 'High')); return a.length ? `<section class="tk-group ${cls}"><h4>${label} <span>${a.length}</span></h4><ul>${a.map(row).join('')}</ul></section>` : ''; };
    let body = '';
    if (UI.view === 'done') body = group('Done in the last 7 days', 'g-done', doneWk.slice().sort((a, b) => b.doneAt.localeCompare(a.doneAt)));
    else body = (UI.view === 'open' || UI.view === 'overdue' ? group('Overdue', 'g-late', overdue) : '')
      + (UI.view === 'open' || UI.view === 'today' ? group('Today', 'g-today', today) : '')
      + (UI.view === 'open' ? group('This week', 'g-week', week) + group('Later', 'g-later', later) : '');
    if (!body) body = `<div class="tk-empty">🎉 Nothing here${q ? ' matches your search' : ''}.</div>`;
    const firms = (window.DEMO_FIRMS ? window.DEMO_FIRMS() : []).filter((f) => !f.cancelled);
    page.innerHTML = `<header class="au-top"><div class="au-crumbs"><b>✅ Tasks</b><span class="au-mock">Mockup · made-up data</span></div>
        <div class="au-top-actions">${isMgr() ? `<select class="tk-sel" data-who aria-label="Whose tasks"><option value="team">Whole team</option>${REPS.map((r) => `<option${UI.who === r ? ' selected' : ''}>${e(r)}</option>`).join('')}</select>` : `<span class="rp-dim">${e(me())}’s tasks</span>`}
          <button type="button" class="au-btn primary" data-add>＋ Add task</button></div></header>
      <div class="tk-body">
        <div class="tk-kpis">${[['open', 'Open', openT.length], ['overdue', 'Overdue', overdue.length], ['today', 'Due today', today.length], ['done', 'Done this week', doneWk.length]].map(([k, l, n]) => `<button type="button" class="${UI.view === k ? 'on' : ''} k-${k}" data-view="${k}"><b>${n}</b><span>${l}</span></button>`).join('')}</div>
        ${UI.adding ? `<form class="tk-add" data-addform>
            <input list="tkFirms" name="firm" placeholder="Firm" required aria-label="Firm"><datalist id="tkFirms">${firms.map((f) => `<option value="${e(short(f.name))}">`).join('')}</datalist>
            <input name="title" placeholder="What needs doing?" required aria-label="Task">
            <input type="date" name="due" value="${plus(1)}" aria-label="Due date">
            <select name="who" aria-label="Assign to">${REPS.map((r) => `<option${r === (isMgr() ? (UI.who || REPS[0]) : me()) ? ' selected' : ''}>${e(r)}</option>`).join('')}</select>
            <button type="submit" class="au-btn primary sm">Add</button><button type="button" class="au-btn sm" data-cancel>Cancel</button></form>` : ''}
        <div class="tk-tools"><div class="rp-seg">${[['all', 'All'], ['auto', '⚡ From automations'], ['manual', '✍️ Added by hand']].map(([k, l]) => `<button type="button" class="${UI.src === k ? 'on' : ''}" data-src="${k}">${l}</button>`).join('')}</div>
          <input type="search" data-q placeholder="Search tasks or firms" value="${e(UI.q)}" aria-label="Search tasks"></div>
        ${body}
      </div>
      ${UI.toast ? `<div class="rp-toast">${e(UI.toast.msg)}${UI.toast.undo ? ` <button type="button" data-undo="${UI.toast.undo}">Undo</button>` : ''}</div>` : ''}`;
    badge();
  }
  function flash(msg, undo) { UI.toast = { msg, undo }; render(); clearTimeout(flash.t); flash.t = setTimeout(() => { UI.toast = null; render(); }, 4000); }
  function onClick(ev) {
    const q = (s) => ev.target.closest(s); let el;
    if ((el = q('[data-done]'))) { const t = toggle(el.dataset.done); if (t) flash(t.done ? 'Task done ✓' : 'Task reopened', t.done ? t.id : ''); return; }
    if ((el = q('[data-undo]'))) { toggle(el.dataset.undo); UI.toast = null; render(); return; }
    if ((el = q('[data-view]'))) { UI.view = el.dataset.view; render(); return; }
    if ((el = q('[data-src]'))) { UI.src = el.dataset.src; render(); return; }
    if ((el = q('[data-menu]'))) { UI.menu = el.dataset.menu; render(); return; }
    if ((el = q('[data-snooze]'))) { const t = all().find((x) => x.id === el.dataset.snooze); const base = t.due < TODAY ? TODAY : t.due; t.due = iso(new Date(base + 'T12:00:00').getTime() + (+el.dataset.n) * DAY); UI.menu = null; save(); flash('Snoozed to ' + dueLabel(t.due)); return; }
    if (q('[data-add]')) { UI.adding = true; render(); document.querySelector('#tkPage .tk-add input')?.focus(); return; }
    if (q('[data-cancel]')) { UI.adding = false; render(); return; }
    if ((el = q('[data-firm]'))) { openFirmPage(el.dataset.firm); return; }
    if (UI.menu && !q('.tk-snooze')) { UI.menu = null; render(); }
  }
  function onChange(ev) { if (ev.target.matches('[data-who]')) { UI.who = ev.target.value; render(); } }
  function onInput(ev) {
    if (!ev.target.matches('[data-q]')) return;
    UI.q = ev.target.value; const pos = ev.target.selectionStart; render();
    const i = document.querySelector('#tkPage [data-q]'); i.focus(); i.setSelectionRange(pos, pos);
  }
  document.addEventListener('submit', (ev) => {
    if (!ev.target.matches('#tkPage [data-addform]')) return;
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const name = String(fd.get('firm') || '').trim().toLowerCase();
    const f = (window.DEMO_FIRMS ? window.DEMO_FIRMS() : []).find((x) => short(x.name).toLowerCase() === name || x.name.toLowerCase() === name);
    if (!f) { flash('Pick a firm from the list'); return; }
    window.DEMO_TASKS.add({ firmId: f.id, firm: f.name, title: String(fd.get('title')).trim(), due: fd.get('due') || plus(1), who: fd.get('who') });
    UI.adding = false; UI.view = 'open'; flash('Task added');
  });
  function openFirmPage(id) {
    document.querySelector('.tab[data-tab="resources"]')?.click();
    document.querySelector('#view-resources [data-res-view="firm"]')?.click();
    setTimeout(() => { if (typeof openFirm === 'function') openFirm(String(id)); document.getElementById('profile')?.scrollIntoView({ behavior: 'smooth' }); }, 150);
  }
  window.DEMO_OPEN_FIRM = openFirmPage;

  /* ---------- tab with a due-today badge ---------- */
  let tab;
  function badge() {
    if (!tab) return;
    const n = all().filter((t) => !t.done && t.due <= TODAY && (isMgr() || t.who === me())).length;
    let b = tab.querySelector('.tk-badge');
    if (!b) { b = document.createElement('span'); b.className = 'tk-badge'; tab.appendChild(b); }
    b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n;
  }
  const nav = document.querySelector('.tabbar');
  if (nav && !document.querySelector('[data-tab="tasks"]')) {
    tab = document.createElement('button');
    tab.className = 'tab'; tab.dataset.tab = 'tasks';
    tab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg> Tasks';
    tab.addEventListener('click', () => setTimeout(open, 0));
    const before = nav.querySelector('[data-tab="reports"]') || nav.querySelector('[data-tab="auto"]');
    if (before) before.before(tab); else nav.appendChild(tab);
    const view = document.createElement('div');
    view.className = 'view'; view.id = 'view-tasks';
    view.innerHTML = '<div class="wrap"><div id="tkHost"></div></div>';
    const anchor = document.getElementById('view-reports') || document.getElementById('view-auto');
    if (anchor) anchor.before(view); else (document.querySelector('.view:last-of-type') || document.body).after(view);
  }
  let lastP = '';
  setInterval(() => { const p = me(); if (p !== lastP) { lastP = p; UI.who = ''; badge(); if (document.getElementById('tkPage')) render(); } }, 900);
  listeners.push(() => { badge(); });
})();
