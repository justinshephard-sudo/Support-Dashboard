/* ==========================================================================
   Tabs, theme, and auth bootstrap
   ========================================================================== */
// Tabs whose data loads on first use (each loader runs once).
const TAB_LOADERS = { firm: () => initFirmLookup(), impl: () => initImplementation() };
const TAB_LOADED = {};
function ensureTabData(tab) {
  if (!TAB_LOADED[tab] && TAB_LOADERS[tab]) {
    TAB_LOADED[tab] = TAB_LOADERS[tab]().catch((err) => console.error(tab + ' load failed', err));
  }
  return TAB_LOADED[tab] || Promise.resolve();
}

function setupChartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.font.family = 'Barlow, Arial, sans-serif';
  Chart.defaults.font.size = 13;
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const v = document.getElementById('view-' + t.dataset.tab);
    if (v) v.classList.add('active');
    if (t.dataset.tab === 'mrr') openMrr();
    if (t.dataset.tab === 'impl') ensureTabData('impl').then(drawImplCharts);
    if (t.dataset.tab === 'services') mountServices();
    if (t.dataset.tab === 'resources') openResources();
  }));
}

// Merlin wears different hats: clicking him in the hero cycles through his looks.
function setupMerlin() {
  const btn = document.getElementById('heroMerlin');
  if (!btn) return;
  const img = btn.querySelector('img');
  const hats = [
    { src: 'assets/merlin-dog.webp', alt: 'Merlin, the Lawmatics wizard, playing with a boxer pup' },
    { src: 'assets/merlin-lasso.webp', alt: 'Merlin in a cowboy hat, twirling a lasso' },
    { src: 'assets/merlin-confetti.webp', alt: 'Merlin celebrating in a shower of confetti' },
  ];
  let i = 0;
  btn.addEventListener('click', () => {
    i = (i + 1) % hats.length;
    img.src = hats[i].src;
    img.alt = hats[i].alt;
    btn.classList.remove('swap');
    void btn.offsetWidth;   // restart the hop animation
    btn.classList.add('swap');
  });
}

function setupTheme() {
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const r = document.documentElement;
    r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
}

function bootstrap() {
  setupChartDefaults();
  setupTabs();
  setupResources();
  setupRoundup();
  setupLoop();
  setupMrr();
  setupScorecards();
  setupAssign();
  setupTheme();
  setupMerlin();
  const start = () => initAuth(main);
  if (window.google && google.accounts && google.accounts.oauth2) {
    start();
  } else {
    const t = setInterval(() => {
      if (window.google && google.accounts && google.accounts.oauth2) { clearInterval(t); start(); }
    }, 120);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
