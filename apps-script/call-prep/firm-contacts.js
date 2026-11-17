/* ==========================================================================
   firmContacts → { firmId } — the firm's ChurnZero contacts (name, email, title, role), decision
   makers first, for the Merlin AI health "Email" draft on the CSM tab. The firm's CSM / account
   manager or a manager. Read-only.
   ========================================================================== */
function firmContacts_(b, who) {
  var firmId = String(b.firmId || '').replace(/[^\d]/g, '');
  if (!firmId) throw new Error('missing Firm ID');
  var a = czGet_('/Account', { $filter: "Cf/FirmId eq '" + firmId + "'", $select: 'Id,Name,UserAccountId,Cf/AccountManager,Cf/CustomerSuccessManager' })[0];
  if (!a) throw new Error('Firm ' + firmId + ' wasn’t found in ChurnZero.');
  var cf = a.Cf || {}, users = czUsers_();
  var repName = String(cf.CustomerSuccessManager || cf.AccountManager || (users[a.UserAccountId] || {}).name || '').trim();
  var rep = Object.keys(users).map(function (k) { return users[k]; }).filter(function (u) { return u.name === repName; })[0] || null;
  if (!who.manager && !(rep && String(rep.email).toLowerCase() === who.email)) throw new Error('Only the firm’s CSM or a manager can email this firm from here.');
  var rank = function (c) {
    var t = (String(c.title) + ' ' + String(c.role)).toLowerCase();
    return (/owner|managing|partner|founder|principal|ceo|president|attorney/.test(t) ? 0 : /manager|director|admin|operations/.test(t) ? 1 : 2) + (c.onboarding ? 0 : 0.5);
  };
  var contacts = czGet_('/Contact', { $filter: 'AccountId eq ' + a.Id, $select: 'FirstName,LastName,Email,MarketingEmailUnsubscribed,Cf/Title,Cf/Role,Cf/AiRole,Cf/IncludeInOnboarding' })
    .map(function (c) {
      var x = c.Cf || {};
      return { first: String(c.FirstName || '').trim(), last: String(c.LastName || '').trim(), email: String(c.Email || '').trim().toLowerCase(),
        title: String(x.Title || '').trim(), role: String(x.Role || x.AiRole || '').trim(), onboarding: x.IncludeInOnboarding === true };
    })
    .filter(function (c) { return /@/.test(c.email) && !/@lawmatics\.com$/.test(c.email); })
    .sort(function (x, y) { return rank(x) - rank(y) || x.first.localeCompare(y.first); })
    .slice(0, 25);
  return { ok: true, firm: a.Name, rep: repName, contacts: contacts };
}
