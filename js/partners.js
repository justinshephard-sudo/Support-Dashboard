/* ==========================================================================
   Partnerships — a tab only managers (Dashboard Config) and PARTNER_VIEWERS see.
   Data: live from ChurnZero through the call-prep backend ("partners" action), which checks the
   viewer against the same list. Cached there for 30 minutes.
     Agency    = Agency Firm or Agency Client Firm is true
     Affiliate = Partner Type is Affiliate
   Grouped by the account's Referral Partner. "New" = the account's Start Date.
   ========================================================================== */
const PARTNER_VIEWERS = ['kennedy@lawmatics.com'];
const PT = { data: null, loading: null, error: '', charts: [], all: {}, active: true };
const PT_GROUPS = [
  { key: 'agency', title: 'Agency', note: 'Agency Firm or Agency Client Firm', test: (f) => f.agency || f.agencyClient, color: '--slot-1' },
  { key: 'affiliate', title: 'Affiliate', note: 'Partner Type = Affiliate', test: (f) => /^affiliate/i.test(f.type), color: '--slot-2' },
];
const PT_NONE = 'No partner listed';
const PT_TOP = 8;
// SELNA's firms are left off the whole page (the SELNA agency itself and every firm it referred).
const PT_EXCLUDE = /\bselna\b/i;
const PT_THIRD_PARTY = 'Onboarded by Third Party';
// New agency-client firms whose onboarding is still open can be closed as onboarded by their agency.
const ptCanClose = (f) => f.agencyClient && f.active && f.czId && ['', 'Pre-Kickoff', 'Open'].includes(f.onboarding) && f.start >= ptDaysAgo(30);
const ptCloseBtn = (f) => (ptCanClose(f) ? `<button type="button" class="cp-btn pt-close" data-pt-close="${esc(f.czId)}" title="Set Onboarding Status to ${PT_THIRD_PARTY}">Close</button>` : '');

function canSeePartners() {
  return isManager() || PARTNER_VIEWERS.includes(String(AUTH.email || '').toLowerCase());
}

function updatePartnersTab() {
  const tab = document.querySelector('.tab[data-tab="partners"]');
  if (tab) tab.hidden = !canSeePartners();
}

function ptLoad(force) {
  if (PT.loading) return PT.loading;
  if (PT.data && !force) return Promise.resolve();
  PT.loading = (async () => {
    try {
      const res = await fetch(CALL_PREP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: AUTH.token, action: 'partners', force: !!force }) });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'no data');
      d.firms = d.firms.filter((f) => !PT_EXCLUDE.test(f.partner) && !PT_EXCLUDE.test(f.name));
      PT.data = d;
      PT.error = '';
    } catch (e) {
      PT.error = 'Couldn’t load partner firms: ' + e.message;
    } finally { PT.loading = null; }
  })();
  return PT.loading;
}

const ptDaysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const ptMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');
const ptDate = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: d.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric' }) : '—');
const ptPartner = (f) => f.partner || PT_NONE;
const ptKind = (f) => [f.agency ? 'Agency' : '', f.agencyClient ? 'Agency client' : '', /^affiliate/i.test(f.type) ? 'Affiliate' : ''].filter(Boolean).join(' · ');

// Referral partners in a group, busiest first (by firms in the current Active/All view).
function ptPartners(firms) {
  const m = new Map();
  firms.forEach((f) => {
    const k = ptPartner(f);
    if (!m.has(k)) m.set(k, { name: k, firms: [], active: 0, mrr: 0, recent: 0 });
    const p = m.get(k);
    p.firms.push(f);
    if (f.active) { p.active++; p.mrr += f.mrr; }
    if (f.start >= ptDaysAgo(90)) p.recent++;
  });
  return [...m.values()].sort((a, b) => ((a.name === PT_NONE) - (b.name === PT_NONE)) || (PT.active ? b.active - a.active : b.firms.length - a.firms.length) || b.mrr - a.mrr || a.name.localeCompare(b.name));
}

function ptMonths() {
  const out = [];
  const d = new Date(); d.setDate(1);
  for (let i = 11; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); }
  return out;
}

function ptFirmTable(firms, withGroup) {
  return `<div class="table-wrap"><table class="drill-table pt-table"><thead><tr><th>Firm</th>${withGroup ? '<th>Type</th>' : ''}<th>Referral partner</th><th>Start</th><th class="num">MRR</th><th>Status</th></tr></thead><tbody>
    ${firms.map((f) => `<tr><td><b>${esc(f.name)}</b>${f.id ? ` <span class="muted">#${esc(f.id)}</span>` : ''}</td>${withGroup ? `<td>${esc(ptKind(f))}</td>` : ''}
      <td>${esc(ptPartner(f))}</td><td class="nowrap">${esc(ptDate(f.start))}</td><td class="num">${ptMoney(f.mrr)}</td>
      <td>${f.active ? (f.onboarding && f.onboarding !== 'Complete' ? `Onboarding · ${esc(f.onboarding)}` : 'Active') : '<span class="muted">Inactive</span>'} ${ptCloseBtn(f)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function ptOpenFirms(title, sub, firms) {
  const rows = [...firms].sort((a, b) => b.active - a.active || (a.start < b.start ? 1 : -1));
  mrrModal(title, sub, ptFirmTable(rows, true));
}

async function openPartners(force) {
  const root = document.getElementById('partners');
  if (!root) return;
  if (!canSeePartners()) { root.innerHTML = '<div class="empty-note">Partnerships is only available to managers and the partnerships team.</div>'; return; }
  if (!root.querySelector('.partners-hero')) {
    root.innerHTML = `
    <div class="fa-hero partners-hero">
      <div class="fa-hero-text">
        <div class="loop-eyebrow">Partnerships</div>
        <h2>Partner <span>Program</span></h2>
        <p>Agency and affiliate firms, who referred them, and what’s new this week.</p>
      </div>
      <div class="fa-hero-art"><img src="assets/merlin-partnerships.webp" alt="Merlin in a suit shaking hands with Kennedy, with her dog beside them" loading="lazy"></div>
    </div>
    <div id="ptBody"><div class="panel"><div class="res-loading">Loading partner firms from ChurnZero…</div></div></div>`;
  }
  if (!PT.data || force) await ptLoad(force);
  ptRender();
}

function ptRender() {
  const body = document.getElementById('ptBody');
  if (!body) return;
  PT.charts.forEach((c) => c.destroy());
  PT.charts = [];
  if (PT.error && !PT.data) { body.innerHTML = `<div class="empty-note">${esc(PT.error)}</div>`; return; }
  const firms = PT.data.firms;
  const week = ptDaysAgo(7), month = ptDaysAgo(30);
  const fresh = firms.filter((f) => f.start >= week && PT_GROUPS.some((g) => g.test(f))).sort((a, b) => (a.start < b.start ? 1 : -1));
  const lastNew = firms.filter((f) => f.start).sort((a, b) => (a.start < b.start ? 1 : -1))[0];
  const updated = new Date(PT.data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  body.innerHTML = `
    <div class="pt-toolbar">
      <div class="mrr-seg">${[[true, 'Active firms'], [false, 'All firms']].map(([v, l]) => `<button type="button" data-pt-active="${v}" aria-pressed="${PT.active === v}">${l}</button>`).join('')}</div>
      <span class="muted">ChurnZero · as of ${esc(updated)}</span>
      <button type="button" class="cal-more" data-pt-refresh>Refresh</button>
    </div>

    <div class="section-head"><h2>New this week</h2><span class="rule"></span><span class="note">Start date in the last 7 days</span></div>
    <div class="panel pt-new">${fresh.length ? `<ul class="pt-new-list">${fresh.map((f) => `
      <li><span class="pt-when">${esc(ptDate(f.start))}</span><b>${esc(f.name)}</b>
        ${PT_GROUPS.filter((g) => g.test(f)).map((g) => `<span class="pt-tag pt-${g.key}">${g.title}</span>`).join('')}
        <span class="muted">${esc(ptPartner(f))}</span>${f.onboarding ? `<span class="muted">· ${esc(f.onboarding)}</span>` : ''}<span class="pt-mrr">${ptMoney(f.mrr)}</span>${ptCloseBtn(f)}</li>`).join('')}</ul>`
      : `<div class="empty-note">No new agency or affiliate firms in the last 7 days.${lastNew ? ` Latest: <b>${esc(lastNew.name)}</b> (${esc(ptDate(lastNew.start))}).` : ''}</div>`}</div>

    ${PT_GROUPS.map((g) => {
      const all = firms.filter(g.test);
      const view = PT.active ? all.filter((f) => f.active) : all;
      const act = all.filter((f) => f.active);
      const partners = ptPartners(view);
      const named = partners.filter((p) => p.name !== PT_NONE).length;
      const stat = (label, value, sub, drill) => `<button type="button" class="pt-stat" ${drill ? `data-pt-drill="${g.key}:${drill}"` : 'disabled'}><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
      const shown = PT.all[g.key] ? partners : partners.slice(0, PT_TOP);
      return `
      <section class="pt-group">
        <div class="section-head"><h2>${g.title}</h2><span class="rule"></span><span class="note">${g.note}</span></div>
        <div class="pt-stats">
          ${stat('Active firms', act.length.toLocaleString(), g.key === 'agency' ? `${act.filter((f) => f.agency).length} agencies · ${act.filter((f) => f.agencyClient).length} clients` : `${named} referral partners`, 'active')}
          ${stat('Active MRR', ptMoney(act.reduce((s, f) => s + f.mrr, 0)), act.length ? `avg ${ptMoney(act.reduce((s, f) => s + f.mrr, 0) / act.length)}` : '')}
          ${stat('New · 30 days', all.filter((f) => f.start >= month).length, `${all.filter((f) => f.start >= week).length} this week`, 'new30')}
          ${stat('Inactive', all.length - act.length, `of ${all.length} all-time`, 'inactive')}
        </div>
        <div class="pt-grid">
          <div class="panel"><h4>New firms by month</h4><div class="pt-chart"><canvas id="ptMonth-${g.key}"></canvas></div></div>
          <div class="panel"><h4>Top referral partners <span class="muted">· ${PT.active ? 'active' : 'all'} firms</span></h4><div class="pt-chart"><canvas id="ptTop-${g.key}"></canvas></div></div>
          <div class="panel pt-partners">
            <h4>Referral partners <span class="muted">· ${partners.length}</span></h4>
            <table class="drill-table pt-table"><thead><tr><th>Partner</th><th class="num">Firms</th><th class="num">MRR</th><th class="num" title="Started in the last 90 days">New 90d</th></tr></thead><tbody>
              ${shown.map((p) => `<tr class="pt-row" data-pt-partner="${g.key}" data-name="${esc(p.name)}"><td>${p.name === PT_NONE ? `<span class="muted">${PT_NONE}</span>` : esc(p.name)}</td>
                <td class="num">${PT.active ? p.active : p.firms.length}</td><td class="num">${ptMoney(p.mrr)}</td><td class="num">${p.recent || '<span class="muted">0</span>'}</td></tr>`).join('')}
            </tbody></table>
            ${partners.length > PT_TOP ? `<button type="button" class="cal-more" data-pt-all="${g.key}">${PT.all[g.key] ? 'Show fewer' : `Show all ${partners.length}`}</button>` : ''}
          </div>
        </div>
      </section>`;
    }).join('')}
    <p class="impl-note">Live from ChurnZero. Agency: Agency Firm or Agency Client Firm is checked. Affiliate: Partner Type is Affiliate (a firm can be in both). Partner = the Referral Partner field. New = Start Date. MRR = ChurnZero contract amount. SELNA firms are left out. Click a number, bar or partner to see the firms.</p>`;

  if (typeof Chart === 'undefined') return;
  const months = ptMonths();
  PT_GROUPS.forEach((g) => {
    const all = firms.filter(g.test);
    const byMonth = months.map((ym) => all.filter((f) => f.start.slice(0, 7) === ym));
    PT.charts.push(new Chart(document.getElementById(`ptMonth-${g.key}`), {
      type: 'bar',
      data: { labels: months.map((ym) => new Date(ym + '-15').toLocaleDateString([], { month: 'short' })), datasets: [
        { label: 'Still active', data: byMonth.map((r) => r.filter((f) => f.active).length), backgroundColor: cssVar(g.color), borderRadius: 3, stack: 's' },
        { label: 'Inactive now', data: byMonth.map((r) => r.filter((f) => !f.active).length), backgroundColor: cssVar('--st-neutral'), borderRadius: 3, stack: 's' },
      ] },
      options: mrrChartOpts({ count: true, stacked: true, legendBottom: true,
        tooltip: { callbacks: { title: (i) => new Date(months[i[0].dataIndex] + '-15').toLocaleDateString([], { month: 'long', year: 'numeric' }) } },
        onClick: (i) => ptOpenFirms(`${g.title} — new in ${new Date(months[i] + '-15').toLocaleDateString([], { month: 'long', year: 'numeric' })}`, mrrPlural(byMonth[i].length, 'firm'), byMonth[i]) }),
    }));
    const top = ptPartners(PT.active ? all.filter((f) => f.active) : all).filter((p) => p.name !== PT_NONE).slice(0, 6);
    const n = (p) => (PT.active ? p.active : p.firms.length);
    PT.charts.push(new Chart(document.getElementById(`ptTop-${g.key}`), {
      type: 'bar',
      data: { labels: top.map((p) => (p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name)), datasets: [{ label: 'Firms', data: top.map(n), backgroundColor: cssVar(g.color), borderRadius: 3, maxBarThickness: 18 }] },
      options: mrrChartOpts({ count: true, horizontal: true, legend: false,
        tooltip: { callbacks: { title: (i) => top[i[0].dataIndex].name, label: (i) => ` ${mrrPlural(i.raw, 'firm')} · ${ptMoney(top[i.dataIndex].mrr)} MRR` } },
        onClick: (i) => ptOpenPartner(g.key, top[i].name) }),
    }));
  });
}

function ptOpenPartner(key, name) {
  const g = PT_GROUPS.find((x) => x.key === key);
  const firms = PT.data.firms.filter(g.test).filter((f) => ptPartner(f) === name);
  const act = firms.filter((f) => f.active);
  ptOpenFirms(`${name}`, `${g.title} · ${mrrPlural(act.length, 'active firm')} · ${ptMoney(act.reduce((s, f) => s + f.mrr, 0))} MRR · ${firms.length - act.length} inactive`, firms);
}

async function ptClose(btn) {
  const f = PT.data.firms.find((x) => String(x.czId) === btn.dataset.ptClose);
  if (!f || !confirm(`Close ${f.name}'s onboarding?\n\nThis sets its ChurnZero Onboarding Status to “${PT_THIRD_PARTY}”.`)) return;
  btn.disabled = true;
  btn.textContent = 'Closing…';
  try {
    const res = await fetch(CALL_PREP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: AUTH.token, action: 'closeThirdParty', czId: f.czId }) });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'failed');
    if (d.dryRun) { btn.textContent = 'Dry run ✓'; return; }
    f.onboarding = PT_THIRD_PARTY;
    btn.replaceWith(Object.assign(document.createElement('span'), { className: 'pt-closed', textContent: d.confirmed ? 'Closed ✓' : 'Closed · ChurnZero catching up' }));
    if (!document.getElementById('mrrDrill')) ptRender();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Close';
    alert('Couldn’t close it: ' + e.message);
  }
}

function setupPartners() {
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-pt-close]');
    if (c) { ptClose(c); return; }
    if (!e.target.closest('#ptBody')) return;
    const a = e.target.closest('[data-pt-active]');
    if (a) { PT.active = a.dataset.ptActive === 'true'; ptRender(); return; }
    if (e.target.closest('[data-pt-refresh]')) { openPartners(true); return; }
    const all = e.target.closest('[data-pt-all]');
    if (all) { PT.all[all.dataset.ptAll] = !PT.all[all.dataset.ptAll]; ptRender(); return; }
    const p = e.target.closest('[data-pt-partner]');
    if (p) { ptOpenPartner(p.dataset.ptPartner, p.dataset.name); return; }
    const d = e.target.closest('[data-pt-drill]');
    if (d) {
      const [key, kind] = d.dataset.ptDrill.split(':');
      const g = PT_GROUPS.find((x) => x.key === key);
      const all = PT.data.firms.filter(g.test);
      const pick = { active: [all.filter((f) => f.active), 'Active firms'], new30: [all.filter((f) => f.start >= ptDaysAgo(30)), 'New in the last 30 days'], inactive: [all.filter((f) => !f.active), 'Inactive firms'] }[kind];
      ptOpenFirms(`${g.title} — ${pick[1]}`, mrrPlural(pick[0].length, 'firm'), pick[0]);
    }
  });
}
document.addEventListener('DOMContentLoaded', setupPartners);
