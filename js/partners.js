/* ==========================================================================
   Partnerships — a tab only managers (Dashboard Config) and PARTNER_VIEWERS see.
   Note: hiding the tab is a page-level check; any partner data added here should also come
   from a backend that checks the viewer (dashAuth_ + this same list).
   ========================================================================== */
const PARTNER_VIEWERS = ['kennedy@lawmatics.com'];

function canSeePartners() {
  return isManager() || PARTNER_VIEWERS.includes(String(AUTH.email || '').toLowerCase());
}

function updatePartnersTab() {
  const tab = document.querySelector('.tab[data-tab="partners"]');
  if (tab) tab.hidden = !canSeePartners();
}

function openPartners() {
  const root = document.getElementById('partners');
  if (!root) return;
  if (!canSeePartners()) { root.innerHTML = '<div class="empty-note">Partnerships is only available to managers and the partnerships team.</div>'; return; }
  if (root.innerHTML) return;
  root.innerHTML = `
    <div class="fa-hero partners-hero">
      <div class="fa-hero-text">
        <div class="loop-eyebrow">Partnerships</div>
        <h2>Partner <span>Program</span></h2>
        <p>Referral and affiliate partners, the firms they bring in, and how those firms are doing.</p>
      </div>
      <div class="fa-hero-art"><img src="assets/merlin-partnerships.webp" alt="Merlin in a suit shaking hands with Kennedy, with her dog beside them" loading="lazy"></div>
    </div>
    <div class="empty-note partners-soon">This tab is new. Its first sections are on the way.</div>`;
}
