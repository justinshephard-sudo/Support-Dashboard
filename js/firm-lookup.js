/* ==========================================================================
   Firm Lookup — reads the "Accounts" tab (written by the ChurnZero sync),
   fuzzy-searches firms, and renders a customer profile.
   ========================================================================== */
const FIRMS = { list: [], loaded: false, contracts: new Map() };   // contracts: 'id:'/'name:' key -> newest-first list

/* Sync Status tab (written by the daily Apps Script syncs): shows when each data
   set was last refreshed, and warns if a sync failed or is more than a day old. */
let SYNC_STATUS = null;
function loadSyncStatus() {
  if (!SYNC_STATUS) {
    SYNC_STATUS = fetchSheetByTitle('Sync Status').then((rows) => {
      const m = new Map();
      rows.slice(1).forEach((r) => m.set(r[0], { lastOk: r[1], lastRun: r[2], result: r[3], error: r[6] || '' }));
      return m;
    }).catch(() => new Map());
  }
  return SYNC_STATUS;
}
async function showSyncNote(elId, name) {
  const el = document.getElementById(elId);
  if (!el) return;
  const st = (await loadSyncStatus()).get(name);
  if (!st) return;
  const fmt = (v) => { const d = new Date(String(v).replace(' ', 'T')); return isNaN(d) ? v : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const age = st.lastOk ? (Date.now() - new Date(String(st.lastOk).replace(' ', 'T'))) / 36e5 : Infinity;
  const bad = st.result !== 'OK' || age > 36;
  el.className = 'sync-note' + (bad ? ' bad' : '');
  el.textContent = bad
    ? `⚠ ChurnZero sync ${st.result !== 'OK' ? 'failed' : 'is late'}${st.error ? ` (${st.error})` : ''}. Data is from ${st.lastOk ? fmt(st.lastOk) : 'an earlier run'}.`
    : `Synced from ChurnZero ${fmt(st.lastOk)}`;
  el.hidden = false;
}

async function initFirmLookup() {
  showSyncNote('firmSync', 'Accounts (Firm Lookup)');
  const input = document.getElementById('q');
  const emptyMsg = document.getElementById('firmEmptyMsg');
  const cnt = document.getElementById('firmCount');
  try {
    const [rows, contractRows] = await Promise.all([
      fetchSheetByTitle(ACCOUNTS_TAB),
      fetchSheetByTitle(CONTRACTS_TAB).catch(() => []),
    ]);
    FIRMS.list = parseAccounts(rows);
    if (typeof spAddTestFirm === 'function') FIRMS.list = spAddTestFirm(FIRMS.list);
    FIRMS.contracts = parseContracts(contractRows);
    FIRMS.loaded = true;
    if (cnt) cnt.textContent = FIRMS.list.length ? `${FIRMS.list.length} firms` : '';
    if (emptyMsg) emptyMsg.textContent = FIRMS.list.length
      ? 'Start typing a firm name to pull up their profile.'
      : 'No account data yet — run the ChurnZero sync to populate the Accounts tab.';
  } catch (err) {
    console.error('Accounts tab not available', err);
    if (emptyMsg) emptyMsg.textContent = 'Account data unavailable — the “Accounts” tab hasn’t been created yet.';
  }
  if (input) input.addEventListener('input', onFirmSearch);
}

function parseAccounts(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  const get = (row, name) => { const i = idx[name.toLowerCase()]; return i == null ? '' : String(row[i] == null ? '' : row[i]).trim(); };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = get(r, 'Name');
    if (!name) continue;
    // Drop placeholder rows: ChurnZero "Account …" defaults and raw Chargebee "cus_…" ids.
    if (/^(account|cus_)/i.test(name.trim())) continue;
    out.push({
      name,
      firmId: get(r, 'FirmId'),
      area: get(r, 'PracticeArea'),
      am: get(r, 'AccountManager'),
      mrr: get(r, 'MRR'),
      mrrSource: get(r, 'MRRSource'),
      contract: get(r, 'TotalContract'),
      cb: get(r, 'ChargebeeStatus'),
      cstatus: get(r, 'ContractStatus'),
      term: get(r, 'TermEnd'),
      cycles: get(r, 'RemainingCycles'),
      lic: get(r, 'Licenses'),
      score: get(r, 'ChurnScore'),
      freq: get(r, 'UsageFrequency'),
      danger: /^(true|yes|1)$/i.test(get(r, 'DangerZone')),
      cancel: /^(true|yes|1)$/i.test(get(r, 'CancellationRequested')),
      csat60: get(r, 'CSAT60'),
      tenure: get(r, 'TenureDays'),
      matters: get(r, 'MattersPerMonth'),
      leads: get(r, 'LeadVolume'),
      sms: get(r, 'TotalSms'),
      smsPlan: get(r, 'SmsPlanType'),
      acts30: get(r, 'Activities30'),
      emp: get(r, 'Employees'),
      contacts: get(r, 'Contacts'),
      onb: get(r, 'OnboardingStatus'),
      city: get(r, 'City'),
      web: get(r, 'Website'),
      plan: get(r, 'ChargebeePlan'),
      cbStart: get(r, 'ChargebeeStart'),
      addons: get(r, 'AddOns'),
      invBalance: get(r, 'InvoiceBalance'),
      legacy: get(r, 'LegacyContract'),
    });
  }
  return out;
}

// Normalize an ID for comparison: the Sheets API returns values as displayed,
// so a numeric FirmId can arrive as "12,345", "12345.0", or with stray spaces.
// Strip grouping commas, all whitespace (incl. non-breaking), and a trailing ".0".
function parseContracts(rows) {
  const map = new Map();
  if (!rows.length) return map;
  const header = rows[0].map((h) => String(h || '').trim());
  const col = (name) => header.indexOf(name);
  const iFirm = col('FirmId'), iName = col('AccountName'), iDoc = col('ContentDocumentId'), iTitle = col('Title'), iAt = col('UploadedAt');
  // Indexed by Firm ID, and by name too: some Salesforce accounts have no Firm ID.
  const add = (key, entry) => { if (!map.has(key)) map.set(key, []); map.get(key).push(entry); };
  rows.slice(1).forEach((r) => {
    if (!r[iDoc]) return;
    const entry = { docId: String(r[iDoc]), title: String(r[iTitle] || ''), at: String(r[iAt] || '') };
    const firm = normId(r[iFirm]);
    if (firm) add('id:' + firm, entry);
    const name = normFirmName(r[iName]);
    if (name) add('name:' + name, entry);
  });
  map.forEach((list) => list.sort((a, b) => String(b.at).localeCompare(String(a.at))));
  return map;
}
function normFirmName(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(llc|pllc|llp|pc|p c|pa|inc|ltd|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function contractsFor(f) {
  return FIRMS.contracts.get('id:' + normId(f.firmId)) || FIRMS.contracts.get('name:' + normFirmName(f.name)) || [];
}
function fmtContractDate(s) {
  const d = new Date(String(s).replace(/\+0000$/, 'Z'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function contractRowHtml(f) {
  const list = contractsFor(f);
  if (!list.length) return pfRow('Signed contract', 'None on file');
  const newest = list[0];
  const date = fmtContractDate(newest.at);
  const more = list.length > 1 ? `<div class="pf-flag">⚠ ${list.length} contracts on file — showing newest</div>` : '';
  return `<div class="pf-row"><span class="k">Signed contract</span><span class="v">`
    + `<button type="button" class="pf-link" data-contract="${esc(newest.docId)}">View PDF${date ? ' · ' + esc(date) : ''}</button>${more}</span></div>`;
}
// Opens the window synchronously (so popup blockers allow it), then fills it with the PDF
// once the contracts web app has verified the viewer and returned the file.
async function openContract(docId, btn) {
  const w = window.open('', '_blank');
  if (w) w.document.write('<title>Loading contract…</title><p style="font:16px Barlow,system-ui,sans-serif;padding:24px;color:#516379">Loading contract…</p>');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const res = await fetch(CONTRACTS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'get', token: AUTH.token, docId }),
    });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'could not load the contract');
    const bytes = Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (w) w.location.href = url; else window.open(url, '_blank');
  } catch (err) {
    if (w) w.close();
    alert('Couldn’t open the contract: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
function normId(s) {
  return String(s == null ? '' : s).toLowerCase().trim().replace(/[,\s ]/g, '').replace(/\.0+$/, '');
}

function firmSearchScore(q, f) {
  q = q.toLowerCase().trim();
  if (!q) return -1;
  const name = String(f.name || '').toLowerCase();
  // FirmId match: exact wins outright, then prefix, then substring — ranked above name matches.
  const id = normId(f.firmId);
  const qn = normId(q);
  if (id && qn) {
    if (id === qn) return 300;
    if (id.startsWith(qn)) return 200;
    if (id.includes(qn)) return 150;
  }
  if (name.includes(q)) return 100 - name.indexOf(q);
  let qi = 0;
  for (let i = 0; i < name.length && qi < q.length; i++) if (name[i] === q[qi]) qi++;
  if (qi === q.length) return 40;
  let hit = 0;
  for (const ch of new Set(q.split(''))) if (name.includes(ch)) hit++;
  return hit >= Math.ceil(q.length * 0.6) ? 10 : -1;
}

const HEALTH = {
  good: ['Healthy', 'var(--st-good)', 'rgba(12,163,90,.15)', 'good'],
  warn: ['Watch', 'var(--st-warn)', 'rgba(230,148,26,.16)', 'warn'],
  bad: ['At Risk', 'var(--st-critical)', 'rgba(216,58,58,.15)', 'bad'],
};
function healthOf(f) {
  if (f.danger || f.cancel) return 'bad';
  const s = toNumber(f.score);
  if (s == null) return 'warn';
  // Same cut-offs as the CSM tab's account health (lower churn score is healthier).
  if (s < 33) return 'good';
  if (s < 67) return 'warn';
  return 'bad';
}
function firmInitials(n) {
  return String(n).replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '—';
}
function fmtMoney(v) {
  if (v == null || String(v).trim() === '') return '—';
  const n = toNumber(v);
  if (n == null) return String(v);
  return '$' + Math.round(n).toLocaleString();
}
const orDash = (v) => (v == null || String(v).trim() === '' ? '—' : String(v));

function onFirmSearch() {
  const v = document.getElementById('q').value;
  const results = document.getElementById('results');
  if (!v.trim()) { results.classList.remove('show'); return; }
  const list = FIRMS.list
    .map((f) => ({ f, s: firmSearchScore(v, f) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.f);
  renderFirmResults(list);
}

function renderFirmResults(list) {
  const results = document.getElementById('results');
  if (!list.length) { results.classList.remove('show'); return; }
  results.innerHTML = list.map((f) => {
    const h = HEALTH[healthOf(f)];
    const meta = [f.firmId ? 'ID ' + f.firmId : '', f.area, f.am ? 'AM ' + f.am : '', f.mrr ? fmtMoney(f.mrr) + '/mo' : ''].filter(Boolean).join(' · ');
    return `<div class="res" data-id="${esc(f.firmId)}" data-name="${esc(f.name)}">
      <div class="res-logo">${esc(firmInitials(f.name))}</div>
      <div class="res-main"><div class="res-name">${esc(f.name)}</div><div class="res-meta">${esc(meta)}</div></div>
      <span class="res-health" style="color:${h[1]};background:${h[2]}">${h[0]}</span>
    </div>`;
  }).join('');
  results.classList.add('show');
  results.querySelectorAll('.res').forEach((el) => el.addEventListener('click', () => openFirm(el.dataset.id, el.dataset.name)));
}

function pfRow(k, v, cls) { return `<div class="pf-row"><span class="k">${esc(k)}</span><span class="v ${cls || ''}">${esc(v)}</span></div>`; }

function openFirm(firmId, name) {
  const f = FIRMS.list.find((x) => (firmId && x.firmId === firmId) || x.name === name);
  if (!f) return;
  document.getElementById('results').classList.remove('show');
  document.getElementById('firmEmpty').style.display = 'none';
  document.getElementById('q').value = f.name;
  const hk = healthOf(f); const h = HEALTH[hk];
  const sub = [f.area, f.firmId ? 'FirmId ' + f.firmId : '', f.city ? '📍 ' + f.city : ''].filter(Boolean).map(esc).join(' · ');
  const web = f.web ? ` · <a href="https://${esc(f.web.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">🌐 ${esc(f.web)}</a>` : '';
  const badgeCls = hk === 'good' ? 'good' : hk === 'bad' ? 'bad' : 'warn';
  const dangerBadge = (f.danger || f.cancel) ? '<span class="pf-badge warn">⚠ Cancellation flagged</span>' : '';
  const scoreN = toNumber(f.score);
  const scoreCls = scoreN == null ? '' : scoreN < 25 ? 'good' : scoreN < 50 ? 'warn' : 'bad';
  document.getElementById('profile').innerHTML = `
    <div class="pf-hero">
      <div class="pf-logo">${esc(firmInitials(f.name))}</div>
      <div class="pf-htext"><h3>${esc(f.name)}</h3><div class="sub">${sub}${web}</div></div>
      <div class="pf-hbadges">
        <span class="pf-badge ${badgeCls}">${h[0]}</span>
        ${dangerBadge}
        ${f.freq ? `<span class="pf-badge">${esc(f.freq)} user</span>` : ''}
        ${typeof spButtonHtml === 'function' ? spButtonHtml() : ''}
      </div>
    </div>
    <div class="pf-grid">
      <div class="pf-card"><h4>👤 Ownership</h4>
        ${pfRow('Account Manager', orDash(f.am))}
        ${pfRow('Onboarding', orDash(f.onb), /complete/i.test(f.onb) ? 'good' : f.onb ? 'warn' : '')}
      </div>
      <div class="pf-card"><h4>💳 Billing</h4>
        ${pfRow('MRR', fmtMoney(f.mrr) + (f.mrrSource === 'ChurnZero' ? ' (ChurnZero — not found in Chargebee)' : ''), toNumber(f.mrr) && f.mrrSource !== 'ChurnZero' ? '' : 'warn')}
        ${f.plan ? pfRow('Plan', f.plan) : ''}
        ${pfRow('Chargebee', orDash(f.cb), /active/i.test(f.cb) ? 'good' : /past due|overdue/i.test(f.cb) ? 'bad' : '')}
        ${f.cbStart ? pfRow('Start date', f.cbStart) : ''}
        ${pfRow('Term ends', orDash(f.term))}
        ${pfRow('Licenses', orDash(f.lic))}
        ${contractRowHtml(f)}
        ${f.addons ? `<div class="pf-row"><span class="k">Add-ons</span><span class="v">${f.addons.split(';').map((s) => esc(s.trim())).filter(Boolean).join('<br>')}</span></div>` : ''}
        ${f.invBalance ? pfRow('Balance due', f.invBalance, 'bad') : ''}
        ${f.legacy ? pfRow('Legacy contract', f.legacy) : ''}
      </div>
      <div class="pf-card"><h4>❤️ Health &amp; Risk</h4>
        ${pfRow('Churn score', orDash(f.score), scoreCls)}
        ${pfRow('Usage', orDash(f.freq), /daily/i.test(f.freq) ? 'good' : /rare|never/i.test(f.freq) ? 'bad' : '')}
        ${pfRow('Cancellation', (f.danger || f.cancel) ? 'Flagged' : 'No', (f.danger || f.cancel) ? 'bad' : 'good')}
      </div>
      <div class="pf-card"><h4>📊 Usage Snapshot</h4>
        ${pfRow('Matters / mo', orDash(f.matters))}
        ${pfRow('Lead volume', orDash(f.leads))}
        ${pfRow('Total SMS', orDash(f.sms))}
        ${pfRow('SMS plan', orDash(f.smsPlan))}
      </div>
    </div>`;
  document.getElementById('profile').querySelectorAll('[data-contract]').forEach((b) => {
    b.addEventListener('click', () => openContract(b.dataset.contract, b));
  });
  document.getElementById('profile').querySelector('[data-sp-open]')?.addEventListener('click', () => openServicePortal(f));
  document.getElementById('profile').classList.add('show');
}
