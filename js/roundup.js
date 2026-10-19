/* ==========================================================================
   Product Roundup (Resources tab) — what's new and what's coming, from the CS
   engineer's "CS Product Roundup Dash" sheet, read with the viewer's own sign-in.
   The sheet is one tab of column groups; each header reads "Field (Section)",
   e.g. "Release ETA (Coming Out Soon)". The first column of a group names the
   item, so a row can carry items for several sections side by side. New columns
   or sections added to the sheet show up here without code changes.
   ========================================================================== */
const ROUNDUP_SHEET_ID = '1vhJ-1oPku6Hs86qGy_I_6_fhKiA4HuOp_Hj9_J6b7GY';
// Per-section look; anything unlisted gets the default.
const ROUNDUP_STYLE = {
  'coming out soon': { title: 'Coming Out Soon', note: 'Shipping next cycle', accent: 'orange', layout: 'cards' },
  'just launched': { title: 'Just Launched', note: 'Closing the loop on what went out', accent: 'green', layout: 'cards' },
  enhancements: { title: 'Enhancements', note: 'Smaller improvements', accent: 'teal', layout: 'list' },
  'plans and development': { title: 'Plans and Development', note: 'Awareness only — no action needed', accent: 'blue', layout: 'list' },
  'outside integrations/partners': { title: 'Integrations & Partners', note: 'Outside tools our customers use', accent: 'purple', layout: 'list' },
};
const ROUNDUP_DEFAULT = { note: '', accent: 'blue', layout: 'cards' };
// Fields shown as a pill next to the title rather than as a labeled fact.
const ROUNDUP_PILL_FIELD = /\b(eta|release|ship(ped)?|target|date)\b/i;
const ROUNDUP_VIDEO_FIELD = /\b(video|demo|recording|walkthrough|zight|loom)\b/i;
const ROUNDUP = { loaded: false, loading: false, sections: [] };

// rows[0] is the header row. Returns [{ key, title, items: [{ title, pill, facts: [[label, value]] }] }].
function roundupParse(rows) {
  if (!rows || rows.length < 2) return [];
  const groups = [];
  let last = null;
  rows[0].forEach((h, col) => {
    const text = String(h || '').trim();
    if (!text) return;
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(text);
    // A header without "(Section)" (e.g. "Demo Video") belongs to the section it sits inside.
    if (!m) { if (last) last.cols.push({ col, label: text }); return; }
    const key = m[2].trim().toLowerCase();
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push(g = { key, name: m[2].trim(), cols: [] });
    g.cols.push({ col, label: m[1].trim() });
    last = g;
  });
  return groups.map((g) => {
    const [nameCol, ...rest] = g.cols;
    const items = rows.slice(1).map((r) => {
      const title = String(r[nameCol.col] || '').trim();
      if (!title) return null;
      const item = { title, pill: '', facts: [], video: '', links: [] };
      rest.forEach(({ col, label }) => {
        const v = String(r[col] || '').trim();
        if (!v) return;
        // Links become buttons: a video/demo column → "Video Demo", any other URL → its column name.
        if (/^https?:\/\/\S+$/i.test(v)) {
          if (!item.video && ROUNDUP_VIDEO_FIELD.test(label)) item.video = v;
          else item.links.push([label.replace(/\?$/, ''), v]);
          return;
        }
        if (!item.pill && ROUNDUP_PILL_FIELD.test(label)) item.pill = v;
        else item.facts.push([label.replace(/\?$/, ''), v]);
      });
      return item;
    }).filter(Boolean);
    const style = ROUNDUP_STYLE[g.key] || ROUNDUP_DEFAULT;
    return { key: g.key, title: style.title || g.name, style, items };
  }).filter((s) => s.items.length);
}

async function loadRoundup() {
  if (ROUNDUP.loading || ROUNDUP.loaded || !AUTH.token) return;   // not signed in yet: openResources() calls again
  ROUNDUP.loading = true;
  const root = document.getElementById('roundup');
  root.innerHTML = '<div class="res-loading">Loading the Product Roundup…</div>';
  try {
    // First tab of the sheet, whatever it's called.
    const data = await sheetsApi('/values/' + encodeURIComponent('A1:ZZ500'), ROUNDUP_SHEET_ID);
    ROUNDUP.sections = roundupParse(data.values || []);
    ROUNDUP.loaded = true;
    renderRoundup();
  } catch (e) {
    root.innerHTML = /\b(403|404)\b/.test(e.message)
      ? '<div class="res-empty"><img src="assets/merlin-scientist.webp" alt="">You don’t have access to the Product Roundup sheet yet — ask Dakota to share it with you.</div>'
      : `<div class="error-banner">Couldn’t load the Product Roundup: ${esc(e.message)}</div>`;
  } finally {
    ROUNDUP.loading = false;
  }
}

// "▶ Video Demo" when the row has a video link, plus any other link columns. Nothing when there are none.
function roundupButtons(x) {
  const b = (x.video ? [`<a class="ru-video" href="${safeUrl(x.video)}" target="_blank" rel="noopener">▶ Video Demo</a>`] : [])
    .concat(x.links.map(([label, url]) => `<a class="ru-more" href="${safeUrl(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`));
  return b.length ? `<span class="ru-btns">${b.join('')}</span>` : '';
}

function roundupFacts(facts) {
  if (!facts.length) return '';
  return `<dl class="ru-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function renderRoundup() {
  const root = document.getElementById('roundup');
  const sections = ROUNDUP.sections;
  if (!sections.length) {
    root.innerHTML = '<div class="res-empty"><img src="assets/merlin-scientist.webp" alt="">Nothing in the Product Roundup yet.</div>';
    return;
  }
  const id = (s) => 'ru-' + s.key.replace(/[^a-z0-9]+/g, '-');
  const counts = sections.map((s) => `<a href="#${id(s)}" class="ru-count" data-jump="${id(s)}"><b>${s.items.length}</b> ${esc(s.title.toLowerCase())}</a>`).join('');
  const hero = `<div class="ru-hero">
      <div class="ru-eyebrow">Product Roundup</div>
      <h3>What’s new &amp; what’s coming</h3>
      <p>The latest from the CS engineer — skim what’s shipping, what just went out, and what’s on the horizon.</p>
      <div class="ru-counts">${counts}</div>
    </div>`;

  const body = sections.map((s) => {
    const a = s.style.accent;
    const inner = s.style.layout === 'list'
      ? `<div class="ru-card ru-list">${s.items.map((x) => `<div class="ru-plan">
          <div><b>${esc(x.title)}</b>${x.facts.map(([, v]) => `<span class="ru-line">${esc(v)}</span>`).join('')}</div>
          ${x.pill ? `<span class="ru-pill ${a}">${esc(x.pill)}</span>` : ''}${roundupButtons(x)}</div>`).join('')}</div>`
      : s.items.map((x) => `<article class="ru-card ac-${a}">
          <header><h4>${esc(x.title)}</h4>${x.pill ? `<span class="ru-pill ${a}">${esc(x.pill)}</span>` : ''}${roundupButtons(x)}</header>
          ${roundupFacts(x.facts)}</article>`).join('');
    return `<section class="res-section" id="${id(s)}"><div class="section-head"><h2>${esc(s.title)}</h2><span class="rule"></span><span class="note">${esc(s.style.note || '')}</span></div>${inner}</section>`;
  }).join('');

  root.innerHTML = hero + body;
}

function setResourcesView(view, load = true) {
  if (!['kb', 'roundup', 'loop', 'firm'].includes(view)) view = 'kb';
  document.querySelectorAll('.res-switch-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.resView === view)));
  document.getElementById('resKB').hidden = view !== 'kb';
  document.getElementById('roundup').hidden = view !== 'roundup';
  document.getElementById('loop').hidden = view !== 'loop';
  document.getElementById('resFirm').hidden = view !== 'firm';
  try { localStorage.setItem('cs-res-view', view); } catch (e) { /* private mode */ }
  if (view === 'loop' && load) loadLoop();
  if (view === 'roundup' && load) loadRoundup();
  if (view === 'kb' && load) openKnowledgeBase();
  if (view === 'firm' && load) { ensureTabData('firm'); document.getElementById('q')?.focus(); }
}

function setupRoundup() {
  document.querySelectorAll('.res-switch-btn').forEach((b) => b.addEventListener('click', () => setResourcesView(b.dataset.resView)));
  document.getElementById('roundup').addEventListener('click', (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) { e.preventDefault(); document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  let saved = 'kb';
  try { saved = localStorage.getItem('cs-res-view') || 'kb'; } catch (e) { /* private mode */ }
  // Restore the last view, but don't load until the person has signed in and opened Resources.
  if (saved !== 'kb') setResourcesView(saved, false);
}
