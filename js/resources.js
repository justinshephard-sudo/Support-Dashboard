/* ==========================================================================
   Resources — the "CS Knowledge Base!" shared drive, read live with the viewer's
   own Google access (read-only Drive scope, requested the first time the tab is
   opened). Nothing is copied or synced, so new and edited docs show up at once
   and nobody sees a file they couldn't already open in Drive.
   Managers can pin docs to "Start here" and hide clutter; those choices are
   saved as Table='Resource' rows on the Overrides tab.
   ========================================================================== */
const RES_DRIVE_ID = '0AEyjoEA6mxmSUk9PVA';
const RES_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const RES_FOLDER = 'application/vnd.google-apps.folder';
const RES_GENERAL = 'General';
const RES_GROUP_PREVIEW = 6;
// "Start here" until managers change it: the docs a CS rep reaches for most. Matched by title, so
// the newest copy wins. Managers can unpin these or pin others (pin state lives in Overrides).
const RES_DEFAULT_START = [
  'CS Troubleshooting Guide',
  'Customer Support Phone Answering Guide +',
  'CS Escalation Standard Operating Procedure',
  'Intercom Best Practices',
  'Cancellation Playbook',
];
// Folders whose contents are archived, wherever they sit.
const RES_ARCHIVE_FOLDER = /^(outdated|archived?|old)\b/i;
const RES = {
  token: null, client: null, loading: false, loaded: false,
  files: [], folders: new Map(), cats: [],
  pinState: new Map(), hides: new Set(),   // pinState: fileId -> '1' pinned | '0' unpinned default
  cat: '', query: '', contentHits: null, contentFor: '', showHidden: false, browseAll: false, expanded: new Set(),
};

// Auto-filtered clutter: blank/untitled files, copies, archived "(OLD)" docs, raw exports.
const RES_JUNK_NAME = /^(untitled\b|copy of\s)|\((old|archived?)\)|\[(old|archived?)\]/i;
const RES_JUNK_TYPE = new Set(['text/csv', 'application/zip', 'application/x-zip-compressed', 'application/json']);

function resKind(mime) {
  if (/document|msword|wordprocessing|text\/plain/.test(mime)) return ['doc', 'DOC'];
  if (/spreadsheet|ms-excel|sheet/.test(mime)) return ['sheet', 'XLS'];
  if (/presentation|powerpoint/.test(mime)) return ['slides', 'PPT'];
  if (/pdf/.test(mime)) return ['pdf', 'PDF'];
  if (/video/.test(mime)) return ['video', 'VID'];
  return ['other', 'FILE'];
}

function resAgo(iso) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) { const m = Math.floor(days / 30); return `${m} month${m === 1 ? '' : 's'} ago`; }
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/* ---- auth (separate read-only Drive token; the rest of the dashboard is unchanged) ---- */
function resAuthClient() {
  if (!RES.client) {
    RES.client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: RES_SCOPE,
      include_granted_scopes: true,
      hint: AUTH.email || undefined,
      callback: (resp) => {
        if (resp.error || !resp.access_token) { resShowConnect('Google Drive access wasn’t granted. Connect to load the Knowledge Base.'); return; }
        RES.token = resp.access_token;
        document.getElementById('resConnect').hidden = true;
        loadResources();
      },
      error_callback: () => resShowConnect(),
    });
  }
  return RES.client;
}
function resConnect() { resAuthClient().requestAccessToken({ prompt: '' }); }
function resShowConnect(msg) {
  document.getElementById('resLoading').hidden = true;
  const box = document.getElementById('resConnect');
  box.hidden = false;
  if (msg) box.querySelector('p').textContent = msg;
}

async function resDrive(params) {
  const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams(Object.assign({
    corpora: 'drive', driveId: RES_DRIVE_ID, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true',
  }, params));
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + RES.token } });
  if (res.status === 401) { RES.token = null; resShowConnect('Your Drive connection expired. Reconnect to keep browsing.'); throw new Error('expired'); }
  if (res.status === 403) {
    let reason = '';
    try { const e = (await res.json()).error || {}; reason = (e.errors && e.errors[0] && e.errors[0].reason) || e.status || ''; reason = reason ? ` [${reason}: ${e.message || ''}]` : ''; } catch (err) { /* keep generic */ }
    throw new Error('Google refused the request (403). The Google Drive API may need to be enabled for the dashboard’s Google Cloud project.' + reason);
  }
  if (!res.ok) throw new Error('Drive HTTP ' + res.status);
  return res.json();
}

/* ---- load + organise ---- */
async function loadResources() {
  if (RES.loading) return;
  RES.loading = true;
  document.getElementById('resLoading').hidden = false;
  document.getElementById('resError').hidden = true;
  try {
    const all = [];
    let pageToken = '';
    do {
      const page = await resDrive({
        q: 'trashed = false', pageSize: '1000', pageToken,
        fields: 'nextPageToken,files(id,name,mimeType,parents,modifiedTime,lastModifyingUser(displayName),webViewLink,shortcutDetails(targetId,targetMimeType))',
      });
      all.push(...(page.files || []));
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    resIndex(all);
    RES.loaded = true;
    renderResources();
  } catch (err) {
    if (err.message !== 'expired') {
      const el = document.getElementById('resError');
      el.textContent = 'Couldn’t load the Knowledge Base: ' + err.message;
      el.hidden = false;
    }
  } finally {
    RES.loading = false;
    document.getElementById('resLoading').hidden = true;
  }
}

function resIndex(all) {
  RES.folders = new Map(all.filter((f) => f.mimeType === RES_FOLDER).map((f) => [f.id, f]));
  // Folder chain under the drive root: [top-level category, ...subfolders].
  const chainOf = (parentId) => {
    const names = [];
    let id = parentId, guard = 0;
    while (id && id !== RES_DRIVE_ID && RES.folders.has(id) && guard++ < 20) {
      const f = RES.folders.get(id);
      names.unshift(f.name);
      id = (f.parents || [])[0];
    }
    return names;
  };
  const files = [];
  all.forEach((f) => {
    if (f.mimeType === RES_FOLDER) return;
    const mime = f.shortcutDetails ? f.shortcutDetails.targetMimeType : f.mimeType;
    if (mime === RES_FOLDER) return;   // shortcuts to folders
    const chain = chainOf((f.parents || [])[0]);
    const [kind, label] = resKind(mime || '');
    files.push({
      id: f.id, name: f.name, mime, kind, label,
      url: f.shortcutDetails ? `https://drive.google.com/open?id=${f.shortcutDetails.targetId}` : f.webViewLink,
      cat: chain[0] || RES_GENERAL, sub: chain.slice(1).join(' › '),
      parent: (f.parents || [])[0] || '', modified: f.modifiedTime,
      by: f.lastModifyingUser ? f.lastModifyingUser.displayName : '',
      junk: RES_JUNK_NAME.test(f.name) || RES_JUNK_TYPE.has(mime) || chain.some((n) => RES_ARCHIVE_FOLDER.test(n)),
    });
  });
  // Several versions of one guide in the same folder ("Guide", "Guide v2", "Guide_v4"): keep the newest.
  const base = (n) => n.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\s_-]*\(?v(ersion)?\s*\d+(\.\d+)?\)?$/i, '').replace(/[\s_-]+/g, ' ').trim().toLowerCase();
  const newest = new Map();
  files.forEach((f) => {
    const k = f.parent + '|' + base(f.name);
    const cur = newest.get(k);
    if (!cur || f.modified > cur.modified) newest.set(k, f);
  });
  files.forEach((f) => { f.superseded = newest.get(f.parent + '|' + base(f.name)) !== f; });
  RES.files = files;
}

function resIsDefault(f) {
  return RES_DEFAULT_START.some((t) => t.toLowerCase() === f.name.trim().toLowerCase());
}
function resInStart(f) {
  const st = RES.pinState.get(f.id);
  return st === '1' || (st !== '0' && resIsDefault(f));
}

function resVisible(f) {
  if (RES.showHidden && overridesUnlocked) return true;
  return !f.junk && !f.superseded && !RES.hides.has(f.id);
}

/* ---- search ---- */
function resTitleMatch(f, q) {
  const hay = (f.name + ' ' + f.cat + ' ' + f.sub).toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
let resSearchTimer = null;
function resOnQuery(value) {
  RES.query = value.trim();
  renderResources();
  clearTimeout(resSearchTimer);
  if (RES.query.length < 3) { RES.contentHits = null; RES.contentFor = ''; return; }
  resSearchTimer = setTimeout(async () => {
    const q = RES.query;
    try {
      const page = await resDrive({
        q: `trashed = false and fullText contains '${q.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
        pageSize: '200', fields: 'files(id)',
      });
      if (RES.query !== q) return;
      RES.contentHits = new Set((page.files || []).map((f) => f.id));
      RES.contentFor = q;
      renderResources();
    } catch (e) { /* title matches still show */ }
  }, 350);
}

/* ---- render ---- */
function resCard(f, opts = {}) {
  const pinned = resInStart(f), hidden = RES.hides.has(f.id);
  const where = f.sub ? `${f.cat} › ${f.sub}` : f.cat;
  const acts = overridesUnlocked
    ? `<div class="res-acts"><button type="button" class="res-act${pinned ? ' on' : ''}" data-act="pin" data-id="${esc(f.id)}">${pinned ? '★ Pinned' : '☆ Pin'}</button>`
      + `<button type="button" class="res-act${hidden ? ' on' : ''}" data-act="hide" data-id="${esc(f.id)}">${hidden ? 'Hidden' : 'Hide'}</button></div>`
    : '';
  const flag = !overridesUnlocked && pinned && !opts.inPinned ? '<span class="res-pin-badge" title="Pinned">★</span>' : '';
  return `<a class="res-card${hidden || f.junk || f.superseded ? ' is-hidden' : ''}" href="${safeUrl(f.url)}" target="_blank" rel="noopener">
      ${flag}<span class="res-ico ${f.kind}" aria-hidden="true">${f.label}</span>
      <span class="res-main"><span class="res-title">${esc(f.name)}</span>
        <span class="res-path" style="display:block">${esc(where)}</span>
        <span class="res-meta" style="display:block">Updated ${esc(resAgo(f.modified))}${f.by ? ' · ' + esc(f.by) : ''}</span>
        ${opts.inside ? '<span class="res-match">Match inside the doc</span>' : ''}
        ${acts}</span></a>`;
}

function resSection(title, count, inner) {
  return `<section class="res-section"><div class="section-head"><h2>${esc(title)}${count != null ? ` <small>${fmtNum(count)}</small>` : ''}</h2><span class="rule"></span></div>${inner}</section>`;
}

function resGroups(list, keyFn, order) {
  const groups = new Map();
  list.forEach((f) => { const k = keyFn(f); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); });
  const keys = [...groups.keys()].sort(order || ((a, b) => a.localeCompare(b)));
  return keys.map((k) => {
    const files = groups.get(k).sort((a, b) => a.name.localeCompare(b.name));
    const open = RES.expanded.has(k) || files.length <= RES_GROUP_PREVIEW + 2;
    const shown = open ? files : files.slice(0, RES_GROUP_PREVIEW);
    const head = keys.length > 1 ? `<h3>${esc(k)} · ${files.length}</h3>` : '';
    return `<div class="res-group">${head}<div class="res-grid">${shown.map((f) => resCard(f)).join('')}</div>`
      + (open ? '' : `<button type="button" class="res-more" data-expand="${esc(k)}">Show all ${files.length}</button>`) + '</div>';
  }).join('');
}

function renderResChips(visible) {
  const counts = new Map();
  visible.forEach((f) => counts.set(f.cat, (counts.get(f.cat) || 0) + 1));
  RES.cats = [...counts.keys()].sort((a, b) => (a === RES_GENERAL) - (b === RES_GENERAL) || a.localeCompare(b));
  if (RES.cat && !counts.has(RES.cat)) RES.cat = '';
  const chip = (key, label, n) => `<button type="button" class="res-chip" role="tab" aria-selected="${RES.cat === key}" data-cat="${esc(key)}">${esc(label)} <small>${fmtNum(n)}</small></button>`;
  document.getElementById('resChips').innerHTML = chip('', 'All', visible.length) + RES.cats.map((c) => chip(c, c, counts.get(c))).join('');
}

function renderResources() {
  if (!RES.loaded) return;
  const body = document.getElementById('resBody');
  const visible = RES.files.filter(resVisible);
  renderResChips(visible);
  const bar = document.getElementById('resManagerBar');
  const hiddenCount = RES.files.length - RES.files.filter((f) => !f.junk && !f.superseded && !RES.hides.has(f.id)).length;
  bar.hidden = !overridesUnlocked;
  if (overridesUnlocked) {
    bar.innerHTML = `<label><input type="checkbox" id="resShowHidden"${RES.showHidden ? ' checked' : ''}> Show hidden &amp; auto-filtered files (${fmtNum(hiddenCount)})</label>`;
    bar.querySelector('input').addEventListener('change', (e) => { RES.showHidden = e.target.checked; renderResources(); });
  }
  const inCat = visible.filter((f) => !RES.cat || f.cat === RES.cat);
  const q = RES.query.toLowerCase();
  let html = '';

  if (q) {
    const titleHits = inCat.filter((f) => resTitleMatch(f, q));
    const titleIds = new Set(titleHits.map((f) => f.id));
    const inside = RES.contentHits && RES.contentFor === RES.query
      ? inCat.filter((f) => RES.contentHits.has(f.id) && !titleIds.has(f.id)) : [];
    const sortNewest = (a, b) => (b.modified > a.modified ? 1 : -1);
    const total = titleHits.length + inside.length;
    document.getElementById('resCount').textContent = `${fmtNum(total)} found`;
    html += titleHits.length ? resSection('Title matches', titleHits.length, `<div class="res-grid">${titleHits.sort(sortNewest).map((f) => resCard(f)).join('')}</div>`) : '';
    html += inside.length ? resSection('Mentioned inside', inside.length, `<div class="res-grid">${inside.sort(sortNewest).map((f) => resCard(f, { inside: true })).join('')}</div>`) : '';
    if (!total) {
      const searching = RES.query.length >= 3 && RES.contentFor !== RES.query;
      html = `<div class="res-empty"><img src="assets/merlin-detective.webp" alt="">${searching ? 'Searching inside the docs…' : `Nothing matches “${esc(RES.query)}”${RES.cat ? ` in ${esc(RES.cat)}` : ''}.`}</div>`;
    }
  } else {
    document.getElementById('resCount').textContent = `${fmtNum(visible.length)} docs`;
    if (!RES.cat && !RES.browseAll) {
      // Landing: just the essentials. Search or a category opens up the rest.
      const start = inCat.filter(resInStart).sort((a, b) => a.name.localeCompare(b.name));
      html += resSection('Start here', null, start.length
        ? `<div class="res-grid">${start.map((f) => resCard(f, { inPinned: true })).join('')}</div>`
        : '<div class="res-empty">Nothing pinned yet.</div>');
      html += `<p class="res-hint">Search above or pick a category to find anything else — <button type="button" class="res-more res-inline" data-browse="1">browse all ${fmtNum(visible.length)} docs</button></p>`;
    } else if (!RES.cat) {
      html += resSection('All resources', inCat.length,
        resGroups(inCat, (f) => f.cat, (a, b) => (a === RES_GENERAL) - (b === RES_GENERAL) || a.localeCompare(b)));
    } else {
      html += resSection(RES.cat, inCat.length, resGroups(inCat, (f) => f.sub || 'In this folder', (a, b) => (a === 'In this folder' ? -1 : b === 'In this folder' ? 1 : a.localeCompare(b))));
    }
    if (!inCat.length) html = '<div class="res-empty">No documents here yet.</div>';
  }
  body.innerHTML = '<div class="res-loading" id="resLoading" hidden>Loading the Knowledge Base…</div>' + html;
}

/* ---- manager: pin / hide (Overrides tab, Table = Resource) ---- */
function parseResourceFlags(overrideRows) {
  RES.pinState = new Map(); RES.hides = new Set();
  (overrideRows || []).slice(1).forEach((row) => {
    const [, table, id, column, value] = row.concat(['', '', '', '', '']);
    const v = String(value).trim();
    if (String(table).trim().toLowerCase() !== 'resource' || !id || v === '') return;
    if (String(column).trim() === 'pin') RES.pinState.set(String(id).trim(), v === '0' ? '0' : '1');
    if (String(column).trim() === 'hide') RES.hides.add(String(id).trim());
  });
  if (RES.loaded) renderResources();
}
function resToggleFlag(id, kind) {
  let value;
  if (kind === 'pin') {
    const f = RES.files.find((x) => x.id === id);
    const isDefault = f && resIsDefault(f);
    if (f && resInStart(f)) value = isDefault ? '0' : '';   // unpin (defaults need an explicit "0")
    else value = isDefault ? '' : '1';                       // pin (defaults just drop the "0")
    if (value === '') RES.pinState.delete(id); else RES.pinState.set(id, value);
  } else {
    const on = !RES.hides.has(id);
    if (on) RES.hides.add(id); else RES.hides.delete(id);
    value = on ? '1' : '';
  }
  renderResources();
  scheduleOverridePost(`resource:${id}:${kind}`, () => postDataOverride('all', 'Resource', id, kind, value, ''));
}

function setupResources() {
  document.getElementById('resConnectBtn').addEventListener('click', resConnect);
  const input = document.getElementById('resQ');
  input.addEventListener('input', (e) => resOnQuery(e.target.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; resOnQuery(''); } });
  document.getElementById('resChips').addEventListener('click', (e) => {
    const b = e.target.closest('.res-chip');
    if (!b) return;
    RES.cat = b.dataset.cat;
    RES.browseAll = false;
    renderResources();
  });
  document.getElementById('resBody').addEventListener('click', (e) => {
    const act = e.target.closest('.res-act');
    if (act) { e.preventDefault(); e.stopPropagation(); resToggleFlag(act.dataset.id, act.dataset.act); return; }
    const more = e.target.closest('.res-more');
    if (more && more.dataset.browse) { RES.browseAll = true; renderResources(); return; }
    if (more) { RES.expanded.add(more.dataset.expand); renderResources(); }
  });
}

// First open of the tab (a click, so Google's permission popup is allowed).
function openResources() {
  const view = document.querySelector('.res-switch-btn[aria-selected="true"]')?.dataset.resView || 'kb';
  setResourcesView(view);
}

// The Knowledge Base needs its own Drive token, so it only connects when that view is opened.
function openKnowledgeBase() {
  if (RES.loaded || RES.loading) return;
  if (RES.token) { loadResources(); return; }
  document.getElementById('resLoading').hidden = false;
  try { resConnect(); } catch (e) { resShowConnect(); }
}
