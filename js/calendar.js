/* ==========================================================================
   This week's calendar — on the Implementation tab (under the rep's numbers) and the CSM tab
   (under the scorecard). Only reps' calendars are shown: a rep sees their own week; a manager
   sees every rep's (one row each), or one rep when they pick one — never their own.
   Read straight from Google Calendar with the viewer's sign-in (calendar.readonly), so it shows
   exactly what Google lets that person see: full events where a calendar is shared with
   details, "Busy" blocks where it's free/busy only. Meetings whose title names a firm in open
   onboarding get the Call prep button.
   Rep emails: REP_EMAILS (core.js) first, else worked out from the name (first.last@,
   firstlast@, flast@, first_last@, first@) with one free/busy lookup, remembered in this browser.
   ========================================================================== */
const CAL = { events: {}, loading: {}, emails: null, resolving: null, error: '', needsAccess: false };
const CAL_EMAIL_STORE = 'cs-cal-emails';
const CAL_API = 'https://www.googleapis.com/calendar/v3';

// Monday 00:00 → Saturday 00:00 of this week, in the viewer's time zone.
function calWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const end = new Date(d);
  end.setDate(d.getDate() + 5);
  return { start: d, end, key: d.toISOString().slice(0, 10) };
}

async function calFetch(path, opts) {
  const res = await fetch(CAL_API + path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + AUTH.token }, (opts || {}).headers) }));
  if (res.ok) return res.json();
  let reason = '';
  try { const e = (await res.json()).error || {}; reason = (e.errors && e.errors[0] && e.errors[0].reason) || e.status || ''; } catch (e) { /* no body */ }
  const err = new Error('Calendar HTTP ' + res.status + (reason ? ' (' + reason + ')' : ''));
  err.status = res.status;
  err.reason = reason;
  throw err;
}

// A sign-in from before the calendar was added has no calendar access yet.
function calAccessError(e) {
  if (e.status === 401 || /insufficient|scope/i.test(e.reason || '')) { CAL.needsAccess = true; return true; }
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(e.reason || '')) { CAL.error = 'The Google Calendar API isn’t turned on for the dashboard’s Google Cloud project yet.'; return true; }
  return false;
}

function calCandidates(rep) {
  const parts = rep.toLowerCase().replace(/[^a-z\s-]/g, '').split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return [];
  const first = parts[0], last = parts[parts.length - 1];
  const locals = parts.length > 1 ? [`${first}.${last}`, `${first}${last}`, `${first[0]}${last}`, `${first}_${last}`, first] : [first];
  return [...new Set(locals)].map((l) => `${l}@${CONFIG.ALLOWED_DOMAIN}`);
}

// rep name → calendar email. One free/busy call covers every guess; addresses that don't exist come back "notFound".
async function calResolve(reps) {
  if (!CAL.emails) { try { CAL.emails = JSON.parse(localStorage.getItem(CAL_EMAIL_STORE) || '{}'); } catch (e) { CAL.emails = {}; } }
  Object.entries(REP_EMAILS).forEach(([email, rep]) => { CAL.emails[rep] = email; });
  const todo = reps.filter((r) => !(r in CAL.emails));
  if (!todo.length) return;
  if (CAL.resolving) { await CAL.resolving; return calResolve(reps); }
  CAL.resolving = (async () => {
    const wk = calWeek();
    const guesses = todo.flatMap((r) => calCandidates(r));
    const found = {};
    for (let i = 0; i < guesses.length; i += 50) {
      const d = await calFetch('/freeBusy', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeMin: wk.start.toISOString(), timeMax: wk.end.toISOString(), items: guesses.slice(i, i + 50).map((id) => ({ id })) }) });
      Object.entries(d.calendars || {}).forEach(([id, c]) => { if (!(c.errors || []).length) found[id.toLowerCase()] = 1; });
    }
    todo.forEach((r) => { CAL.emails[r] = calCandidates(r).find((e) => found[e]) || ''; });
    // Only matches are remembered, so a rep whose address wasn't found is looked up again next visit.
    const keep = Object.fromEntries(Object.entries(CAL.emails).filter(([, e]) => e));
    try { localStorage.setItem(CAL_EMAIL_STORE, JSON.stringify(keep)); } catch (e) { /* private mode */ }
  })();
  try { await CAL.resolving; } finally { CAL.resolving = null; }
}

// One rep's week: full events when their calendar is shared with details, else free/busy blocks.
async function calLoadRep(email) {
  const wk = calWeek(), key = email + '|' + wk.key;
  if (CAL.events[key] && Date.now() - CAL.events[key].at < 5 * 60000) return CAL.events[key];
  if (CAL.loading[key]) return CAL.loading[key];
  CAL.loading[key] = (async () => {
    let out;
    try {
      const q = new URLSearchParams({ timeMin: wk.start.toISOString(), timeMax: wk.end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
        fields: 'items(id,summary,start,end,status,eventType,htmlLink,attendees(email,responseStatus))' });
      const d = await calFetch(`/calendars/${encodeURIComponent(email)}/events?${q}`);
      const items = (d.items || []).filter((e) => e.status !== 'cancelled' && e.eventType !== 'workingLocation'
        && !(e.attendees || []).some((a) => (a.email || '').toLowerCase() === email && a.responseStatus === 'declined'));
      out = { at: Date.now(), items: items.map((e) => ({ title: e.summary || '(no title)', start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date,
        allDay: !e.start.dateTime, link: e.htmlLink || '', attendees: (e.attendees || []).map((a) => (a.email || '').toLowerCase()) })) };
    } catch (e) {
      if (e.status !== 404 && e.status !== 403 || /insufficient|scope|accessNotConfigured|SERVICE_DISABLED/i.test(e.reason || '')) throw e;
      // Not shared with details: fall back to the free/busy view everyone in the company can see.
      const d = await calFetch('/freeBusy', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeMin: wk.start.toISOString(), timeMax: wk.end.toISOString(), items: [{ id: email }] }) });
      const c = (d.calendars || {})[email] || {};
      out = { at: Date.now(), busyOnly: true, items: (c.busy || []).map((b) => ({ title: 'Busy', start: b.start, end: b.end, busy: true })) };
    }
    CAL.events[key] = out;
    return out;
  })();
  try { return await CAL.loading[key]; } finally { delete CAL.loading[key]; }
}

/* ---- firm matching: "Kickoff – Garcia Sheppard Law" → the open onboarding Garcia Sheppard Law, PLLC ---- */
const CAL_FIRM_NOISE = new Set(['the', 'of', 'and', 'law', 'laws', 'firm', 'group', 'office', 'offices', 'llc', 'pllc', 'llp', 'pc', 'pa', 'plc', 'ltd', 'inc', 'apc', 'aplc', 'esq', 'attorney', 'attorneys', 'at', 'legal', 'associates', 'co']);
const calWords = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
function calFirmKey(name) {
  const core = calWords(name).filter((w) => !CAL_FIRM_NOISE.has(w));
  return core.join(' ').length >= 4 ? core : null;   // "The Law Firm" alone is too vague to match
}
function calMatchFirm(title, rep) {
  const words = calWords(title);
  if (!words.length) return null;
  const hay = ` ${words.join(' ')} `;
  // Longest firm name first, so "Smith Jones" wins over "Smith"; the rep's own firms before anyone else's.
  const firms = IMPL.open.map((f) => ({ f, key: calFirmKey(f.Name) })).filter((x) => x.key)
    .sort((a, b) => (b.f.AccountManager === rep) - (a.f.AccountManager === rep) || b.key.join(' ').length - a.key.join(' ').length);
  const hit = firms.find(({ key }) => hay.includes(` ${key.join(' ')} `));
  return hit ? hit.f : null;
}

/* ---- render ---- */
const calTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(/\s/g, '').toLowerCase();

// reps: whose rows to show ([] = the viewer isn't a rep and isn't a manager → nothing).
async function renderCalendar(elId, reps) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.dataset.reps = JSON.stringify(reps);
  if (!reps.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const wk = calWeek();
  const days = [...Array(5)].map((_, i) => { const d = new Date(wk.start); d.setDate(d.getDate() + i); return d; });
  const today = new Date().toDateString();
  const team = reps.length > 1;
  const head = `<div class="section-head"><h2>This week’s calendar</h2><span class="rule"></span><span class="note">${team ? 'Every rep · ' : esc(reps[0]) + ' · '}${days[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[4].toLocaleDateString([], { month: 'short', day: 'numeric' })} · from Google Calendar</span></div>`;
  if (!el.innerHTML) el.innerHTML = head + '<div class="panel cal-panel"><div class="res-loading">Loading calendars…</div></div>';

  let rows;
  try {
    CAL.error = ''; CAL.needsAccess = false;
    await calResolve(reps);
    rows = await Promise.all(reps.map(async (rep) => {
      const email = CAL.emails[rep];
      if (!email) return { rep, missing: true };
      try { return { rep, email, data: await calLoadRep(email) }; } catch (e) { if (calAccessError(e)) throw e; return { rep, email, failed: e.message }; }
    }));
  } catch (e) {
    if (!calAccessError(e)) CAL.error = 'Couldn’t load calendars: ' + e.message;
  }
  if (JSON.stringify(reps) !== el.dataset.reps) return;   // the rep picker changed while this loaded
  if (CAL.needsAccess || CAL.error) {
    el.innerHTML = head + `<div class="panel cal-panel cal-msg">${CAL.needsAccess
      ? '<p>Allow the dashboard to read calendars (read-only) to see this week’s meetings.</p><button type="button" class="loop-btn" data-cal-connect>Connect Google Calendar</button>'
      : `<p>${esc(CAL.error)}</p>`}</div>`;
    return;
  }

  const dayCell = (row, day) => {
    if (row.missing) return '';
    if (row.failed) return '';
    const items = row.data.items.filter((e) => (e.allDay ? new Date(e.start + 'T00:00:00') : new Date(e.start)).toDateString() === day.toDateString());
    if (!items.length) return '<span class="cal-free">—</span>';
    return items.map((e) => {
      const firm = e.busy ? null : calMatchFirm(e.title, row.rep);
      const prep = firm && canCallPrep(firm) ? `<button type="button" class="cp-btn" data-prep-firm="${esc(firm.FirmId)}">Call prep</button>` : '';
      const when = e.allDay ? 'All day' : `${calTime(e.start)}–${calTime(e.end)}`;
      const title = e.link ? `<a href="${esc(safeUrl(e.link))}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title);
      return `<div class="cal-ev${e.busy ? ' cal-busy' : ''}${firm ? ' cal-firm' : ''}${e.allDay ? ' cal-allday' : ''}"><span class="cal-when">${when}</span><span class="cal-title">${title}</span>${prep}</div>`;
    }).join('');
  };
  const note = (row) => (row.missing ? `<div class="cal-note">Couldn’t find ${esc(row.rep)}’s calendar.</div>`
    : row.failed ? `<div class="cal-note">Couldn’t load ${esc(row.rep)}’s calendar.</div>`
    : row.data.busyOnly ? '<div class="cal-note">Free/busy only — their calendar isn’t shared with details.</div>' : '');
  el.innerHTML = head + `<div class="panel cal-panel"><div class="table-wrap"><table class="cal-table${team ? '' : ' cal-solo'}">
    <thead><tr>${team ? '<th>Rep</th>' : ''}${days.map((d) => `<th class="${d.toDateString() === today ? 'cal-today' : ''}">${d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${team ? `<th scope="row" title="${esc(row.email || '')}">${esc(row.rep)}${note(row)}</th>` : ''}${days.map((d) => `<td class="${d.toDateString() === today ? 'cal-today' : ''}">${dayCell(row, d)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>${!team && rows[0] ? note(rows[0]) : ''}</div>`;
}

// Re-draw both tabs' calendars (after calendar access is granted).
function refreshCalendars() {
  ['implCal', 'csmCal'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.dataset.reps) { el.innerHTML = ''; renderCalendar(id, JSON.parse(el.dataset.reps)); }
  });
}

function setupCalendar() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-cal-connect]')) {
      AUTH.calPending = true;
      AUTH.tokenClient.requestAccessToken({ prompt: '', hint: AUTH.email });
      return;
    }
    const p = e.target.closest('.cal-panel [data-prep-firm]');
    if (p) openCallPrep(IMPL.open.find((f) => String(f.FirmId) === p.dataset.prepFirm));
  });
}
document.addEventListener('DOMContentLoaded', setupCalendar);
