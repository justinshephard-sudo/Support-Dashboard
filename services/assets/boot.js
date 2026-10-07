/* Starts the app: tabs, config load, then the Builds board. */
(function () {
  "use strict";
  const IS = window.IS;
  const { $ } = IS;
  const TABS = ["builds", "quote"];

  IS.showTab = function (name) {
    TABS.forEach((t) => {
      $("tab-" + t).setAttribute("aria-selected", String(t === name));
      $("view-" + t).hidden = t !== name;
    });
    const isBuilds = name === "builds";
    $("pageTitle").textContent = isBuilds ? "Current builds" : "New quote";
    $("pageSub").textContent = isBuilds
      ? "Every Additional Services request, by stage. Click a card to update it."
      : "Pick the services, send the quote email, then create the card. It lands in Quote Sent.";
    $("summary").hidden = !isBuilds;
    if (isBuilds && IS.board.stale && IS.config) IS.board.load(true);
    try { history.replaceState(null, "", location.pathname + location.search + (name === "quote" ? "#quote" : "")); } catch (e) { /* ignore */ }
  };

  IS.start = async function () {
    $("gate").hidden = true; $("app").hidden = false;
    $("whoName").textContent = IS.user.name;
    $("avatar").textContent = IS.initials(IS.user.name);
    $("board").innerHTML = '<div class="state">Loading builds…</div>';
    // One call for settings + the board; Apps Script round trips are slow, so don't chain two.
    let boot;
    try {
      boot = await IS.api("bootstrap");
    } catch (e) {
      $("board").innerHTML = `<div class="state"><span class="err">Couldn't load builds: ${IS.esc(e.message)}</span></div>`;
      return;
    }
    IS.config = boot.config;
    IS.quote.init();
    IS.board.setData(boot.requests);
    IS.showTab(location.hash === "#quote" ? "quote" : "builds");
  };

  TABS.forEach((t) => $("tab-" + t).addEventListener("click", () => IS.showTab(t)));
  $("signOut").addEventListener("click", () => IS.signOut());
  IS.quote.wire();
  IS.board.wire();

  if (IS.EMBED) {
    // The dashboard already signed this person in; borrow its OAuth access token.
    document.documentElement.classList.add("embedded");
    const begin = () => {
      const auth = window.parent.AUTH || {};
      if (!auth.token) { setTimeout(begin, 200); return; }
      IS.accessToken = auth.token;
      const email = String(auth.email || "");
      const name = email.split("@")[0].split(/[._-]+/).filter(String).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
      IS.user = { name: name || email, email };
      IS.start();
    };
    begin();
  } else if (IS.MOCK) {
    $("mockBar").hidden = false;
    IS.user = { name: "Test User", email: "test@lawmatics.com" };
    IS.start();
  } else {
    IS.resumeOrSignIn();
  }
})();
