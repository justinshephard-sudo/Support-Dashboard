/* ==========================================================================
   Firm Lookup → Emails — MOCKUP for the test site only (tools/build-demo.sh loads it).
   What the firm's email history would look like once the dashboard syncs the CS team's Gmail
   (read-only, matched to firms by their contacts and email domain): conversations with the
   firm, newest first, sent/received, searchable, each message expandable.
   Every thread here is made up from the test firm's details.
   ========================================================================== */
(function () {
  if (!window.CS_DEMO) return;

  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
  const first = (n) => String(n || '').split(' ')[0];
  const slug = (s) => String(s || '').replace(/^Test – /, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'firm';
  const ago = (d) => new Date(Date.now() - d * 864e5 - Math.floor(rnd() * 8) * 3600e3);

  // Conversation templates: [subject, [who, text]...]. who: 'us' (the rep) or 'them' (the firm's contact).
  const ONB = [
    ['Kickoff recap + next steps', [['us', 'Hi {c},\n\nGreat meeting you today! Quick recap: we mapped your intake from the website form through to the signed engagement letter. Before our next call, could you send over your current intake questionnaire and engagement letter templates?\n\n{r}'], ['them', 'Thanks {rf}! Attaching both now. Our paralegal Sam will be joining next time too.'], ['us', 'Perfect, got them. See you Thursday.\n\n{r}']]],
    ['Forms review before Thursday', [['us', 'Hi {c},\n\nI built the intake form from your questionnaire — take a look before Thursday and note anything to change.\n\n{r}'], ['them', 'Looks great. Can we add a question about how they heard about us?'], ['us', 'Done — added as a dropdown with your referral sources.\n\n{r}']]],
    ['Automations ready for approval', [['us', 'Hi {c},\n\nThe first round of automations is ready: new lead follow-up, consult reminders and the no-show text. Could you approve them in the portal, or reply with changes?\n\n{r}'], ['them', 'Approved the first two. For the no-show one, can it wait 15 minutes instead of 5?']]],
    ['Rescheduling our training', [['them', 'Hi {rf}, something came up Friday — can we push the team training to next week?'], ['us', 'No problem! Here’s a link to pick a new time: https://app.lawmatics.com/forms/share/…/reschedule\n\n{r}']]],
  ];
  const CSM = [
    ['Checking in on {fs}', [['us', 'Hi {c},\n\nIt’s been a month since you went live — how is everything going? Anything I can help the team with?\n\n{r}'], ['them', 'Going well overall! The team loves the intake automations. We’re still not using the reporting much.'], ['us', 'Great to hear. Happy to do a 20-minute reporting walkthrough — does Tuesday work?\n\n{r}']]],
    ['Getting more out of Merlin', [['us', 'Hi {c},\n\nI noticed your team has used 12 of your 100 Merlin AI credits this month. Is anything getting in the way?\n\n{r}'], ['them', 'Honestly we weren’t sure how to turn on lead scoring. Can you show us?']]],
    ['Question about our invoice', [['them', 'Hi {rf}, our last invoice looks higher than usual — can you take a look?'], ['us', 'Hi {c}, that includes the 2 seats added in October, prorated. Happy to walk through it.\n\n{r}'], ['them', 'Makes sense, thanks for explaining!']]],
    ['Renewal coming up', [['us', 'Hi {c},\n\nYour annual agreement renews in about two months. I’d love to set up a quick review of the year and what’s next.\n\n{r}']]],
    ['Calendar sync duplicates', [['them', 'Hey {rf}, we’re seeing duplicate events on the calendar since yesterday.'], ['us', 'Thanks for flagging — I’ve opened a ticket with our support team and they’re on it. I’ll update you as soon as I hear back.\n\n{r}']]],
  ];

  function threadsFor(firmId) {
    const f = (window.DEMO_FIRM && window.DEMO_FIRM(firmId)) || null;
    const name = f ? f.name : 'this firm';
    seed = Number(String(firmId).replace(/\D/g, '')) || 7;
    const onb = !!(f && f.onboarding);
    const rep = f ? (onb ? f.im : (f.csm || f.im)) : 'Elliott Jones';
    const contact = pick(['Maria Lopez', 'Jordan Pike', 'Sam Reed', 'Priya Shah', 'Dana Ruiz', 'Chris Nolan']);
    const domain = slug(name) + '.com';
    const repEmail = first(rep).toLowerCase() + '@lawmatics.com';
    const contactEmail = first(contact).toLowerCase() + '@' + domain;
    const fill = (t) => t.replace(/\{c\}/g, first(contact)).replace(/\{rf\}/g, first(rep)).replace(/\{r\}/g, rep + '\n' + (onb ? 'Implementation Manager' : 'Customer Success Manager') + ', Lawmatics')
      .replace(/\{fs\}/g, name.replace(/^Test – /, ''));
    const pool = onb ? ONB.concat(CSM.slice(3, 4)) : CSM.concat(ONB.slice(0, 1));
    let day = 1 + Math.floor(rnd() * 4);
    return pool.slice(0, onb ? 4 : 5 + Math.floor(rnd() * 2)).map(([subj, msgs]) => {
      const startDay = day;
      day += 6 + Math.floor(rnd() * 18);
      const messages = msgs.map(([who, text], i) => ({
        from: who === 'us' ? `${rep} <${repEmail}>` : `${contact} <${contactEmail}>`, to: who === 'us' ? contactEmail : repEmail,
        us: who === 'us', at: ago(startDay + (msgs.length - 1 - i) * (1 + Math.floor(rnd() * 2))), body: fill(text),
      }));
      return { subject: fill(subj), messages, last: messages[messages.length - 1].at, rep, contact };
    }).sort((a, b) => b.last - a.last);
  }

  const S = { firm: null, threads: [], filter: 'all', q: '', open: new Set() };
  const when = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = (d) => Math.max(0, Math.round((Date.now() - d) / 864e5));

  function html() {
    const all = S.threads;
    const msgs = all.flatMap((t) => t.messages);
    const lastUs = msgs.filter((m) => m.us).sort((a, b) => b.at - a.at)[0];
    const lastThem = msgs.filter((m) => !m.us).sort((a, b) => b.at - a.at)[0];
    const q = S.q.trim().toLowerCase();
    const lastUsT = (t) => t.messages[t.messages.length - 1].us;
    const list = all.filter((t) => (S.filter === 'all' || (S.filter === 'them' ? t.messages.some((m) => !m.us) : lastUsT(t)))
      && (!q || (t.subject + ' ' + t.messages.map((m) => m.body + m.from).join(' ')).toLowerCase().includes(q)));
    return `<div class="em-head"><h4>✉️ Emails <span class="muted">${all.length} conversations · ${msgs.length} emails</span></h4>
        <span class="em-mock">Test data · synced from the team’s Gmail</span></div>
      <div class="em-stats">
        <div><span>Last email from us</span><b>${lastUs ? days(lastUs.at) + 'd ago' : '—'}</b><small>${lastUs ? e(lastUs.from.split(' <')[0]) : ''}</small></div>
        <div><span>Last reply from the firm</span><b class="${lastThem && days(lastThem.at) > 30 ? 'neg' : ''}">${lastThem ? days(lastThem.at) + 'd ago' : 'Never'}</b><small>${lastThem ? e(lastThem.from.split(' <')[0]) : ''}</small></div>
        <div><span>Emails, last 30 days</span><b>${msgs.filter((m) => days(m.at) <= 30).length}</b><small>${msgs.filter((m) => days(m.at) <= 30 && !m.us).length} from the firm</small></div>
      </div>
      <div class="em-tools"><div class="em-chips">${[['all', 'All'], ['them', 'Firm replied'], ['us', 'Waiting on the firm']].map(([k, l]) => `<button type="button" data-em-filter="${k}" class="${S.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <input type="search" data-em-q placeholder="Search emails" value="${e(S.q)}" aria-label="Search this firm’s emails"></div>
      <ul class="em-list">${list.map((t, i) => {
        const id = t.subject + t.last.getTime();
        const open = S.open.has(id);
        const lastM = t.messages[t.messages.length - 1];
        return `<li class="${open ? 'open' : ''}"><button type="button" class="em-thread" data-em-open="${e(id)}">
            <span class="em-dir ${lastM.us ? 'out' : 'in'}" title="${lastM.us ? 'Last email was from us' : 'Last email was from the firm'}">${lastM.us ? '↗' : '↙'}</span>
            <span class="em-main"><b>${e(t.subject)}</b><small>${e(t.contact)} · ${e(t.rep)}${t.messages.length > 1 ? ` · ${t.messages.length} emails` : ''}</small>
              ${open ? '' : `<span class="em-snip">${e(lastM.body.replace(/\s+/g, ' ').slice(0, 120))}…</span>`}</span>
            <span class="em-when">${e(when(t.last))}</span></button>
          ${open ? `<div class="em-msgs">${t.messages.map((m) => `<div class="em-msg ${m.us ? 'out' : 'in'}"><div class="em-mh"><b>${e(m.from.split(' <')[0])}</b><small>${e(m.from.split('<')[1]?.replace('>', '') || '')} → ${e(m.to)} · ${e(when(m.at))}</small></div><pre>${e(m.body)}</pre></div>`).join('')}
            <a class="em-gmail" href="https://mail.google.com/" target="_blank" rel="noopener">Open in Gmail ↗</a></div>` : ''}</li>`;
      }).join('') || '<li class="em-none">No emails match.</li>'}</ul>`;
  }
  function draw(card) { card.innerHTML = html(); }

  // Add the card under the firm's bugs & feature requests whenever a profile opens.
  const host = () => document.getElementById('profile');
  const obs = new MutationObserver(() => {
    const prod = document.getElementById('pfProduct');
    if (!prod || document.getElementById('pfEmails')) return;
    const card = document.createElement('div');
    card.className = 'pf-card em-card';
    card.id = 'pfEmails';
    S.firm = prod.dataset.firm; S.threads = threadsFor(S.firm); S.filter = 'all'; S.q = ''; S.open = new Set();
    prod.after(card);
    draw(card);
    card.addEventListener('click', (ev) => {
      const f = ev.target.closest('[data-em-filter]'), o = ev.target.closest('[data-em-open]');
      if (f) { S.filter = f.dataset.emFilter; draw(card); }
      if (o) { const k = o.dataset.emOpen; S.open.has(k) ? S.open.delete(k) : S.open.add(k); draw(card); }
    });
    card.addEventListener('input', (ev) => {
      if (!ev.target.matches('[data-em-q]')) return;
      S.q = ev.target.value; const pos = ev.target.selectionStart; draw(card);
      const i = card.querySelector('[data-em-q]'); i.focus(); i.setSelectionRange(pos, pos);
    });
  });
  const start = () => { const h = host(); if (h) obs.observe(h, { childList: true, subtree: true }); else setTimeout(start, 500); };
  start();
})();
