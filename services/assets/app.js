/* Core: config, sign-in, API client, shared helpers. Views live in quote.js and board.js; boot.js starts the app.
   ?mock=1 skips sign-in, uses fake sample data, and never writes to Asana. */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const MOCK = new URLSearchParams(location.search).get("mock") === "1";
  // Embedded as the CS Dashboard's "Additional Services" tab (same origin): reuse its Google sign-in.
  let EMBED = false;
  try { EMBED = window.parent !== window && !!window.parent.AUTH; } catch (e) { EMBED = false; }

  const IS = (window.IS = {
    CFG, MOCK, EMBED,
    user: null, idToken: null, accessToken: null, config: null,
    $: (id) => document.getElementById(id),
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    money: (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }),
    fmtDate: (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    // "2026-10-05" → "Oct 5" (or with year if not this year)
    shortDate(iso) {
      if (!iso) return "";
      const d = new Date(iso + "T12:00:00");
      const opts = { month: "short", day: "numeric" };
      if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
      return d.toLocaleDateString("en-US", opts);
    },
    todayIso() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); },
    initials: (name) => String(name || "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase(),
  });

  // ───────────── Files ─────────────
  IS.MAX_FILE_BYTES = 25 * 1024 * 1024;
  IS.fmtSize = (n) => n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB";
  IS.readBase64 = (file) => new Promise((ok, fail) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] || "");
    fr.onerror = () => fail(new Error("Couldn't read " + file.name));
    fr.readAsDataURL(file);
  });
  // Uploads one at a time (keeps each request well under Apps Script's size limit).
  // onEach(file, result | null, error | null, index, total)
  IS.uploadFiles = async function (gid, files, onEach) {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        if (f.size > IS.MAX_FILE_BYTES) throw new Error("is over the 25 MB limit");
        const data = await IS.readBase64(f);
        const res = await IS.api("uploadFile", { gid, file: { name: f.name, type: f.type, data } });
        out.push(res.file); onEach && onEach(f, res.file, null, i, files.length);
      } catch (e) { onEach && onEach(f, null, e, i, files.length); }
    }
    return out;
  };
  // Asana download links expire, so ask for a fresh one; open the tab first so popup blockers allow it.
  IS.openFile = async function (fileGid) {
    const w = window.open("about:blank", "_blank");
    try {
      const res = await IS.api("fileUrl", { fileGid });
      if (w) w.location.href = res.url; else location.href = res.url;
    } catch (e) { if (w) w.close(); throw e; }
  };

  // ───────────── API ─────────────
  IS.api = async function (action, payload) {
    if (MOCK) return IS.mockApi(action, payload || {});
    if (!CFG.API_URL) throw new Error("API_URL is not set in assets/config.js.");
    // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
    const res = await fetch(CFG.API_URL, { method: "POST", body: JSON.stringify(Object.assign({ idToken: IS.idToken, accessToken: IS.accessToken, action }, payload || {})) });
    const data = await res.json();
    if (!data.ok) {
      if (data.error === "unauthorized") {
        if (EMBED) throw new Error("Your sign-in expired. Reload the dashboard to sign in again.");
        IS.signOut("Your sign-in expired. Sign in again.");
      }
      throw new Error(data.message || data.error || "Request failed");
    }
    return data;
  };

  // ───────────── Sign-in ─────────────
  function decodeJwt(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch (e) { return null; }
  }
  IS.onCredential = function (resp) {
    const claims = decodeJwt(resp.credential);
    if (!claims || claims.hd !== CFG.ALLOWED_DOMAIN) { gateError("Use your @" + CFG.ALLOWED_DOMAIN + " Google account."); return; }
    IS.idToken = resp.credential;
    IS.user = { name: claims.name || claims.email, email: (claims.email || "").toLowerCase() };
    try { sessionStorage.setItem("is_idt", IS.idToken); } catch (e) { /* storage blocked */ }
    IS.start();
  };
  function gateError(msg) { const el = IS.$("gateErr"); el.textContent = msg; el.hidden = !msg; }
  IS.signOut = function (msg) {
    IS.idToken = null; IS.user = null;
    try { sessionStorage.removeItem("is_idt"); } catch (e) { /* ignore */ }
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    IS.$("app").hidden = true; IS.$("gate").hidden = false; gateError(msg || "");
    initGsi();
  };
  function initGsi() {
    if (!window.google || !google.accounts) { setTimeout(initGsi, 150); return; }
    google.accounts.id.initialize({ client_id: CFG.CLIENT_ID, callback: IS.onCredential, hd: CFG.ALLOWED_DOMAIN, auto_select: true });
    google.accounts.id.renderButton(IS.$("gsiButton"), { theme: "outline", size: "large", text: "signin_with" });
    google.accounts.id.prompt();
  }
  IS.resumeOrSignIn = function () {
    let saved = null;
    try { saved = sessionStorage.getItem("is_idt"); } catch (e) { /* ignore */ }
    const claims = saved && decodeJwt(saved);
    if (claims && claims.exp * 1000 > Date.now() + 60000) IS.onCredential({ credential: saved });
    else initGsi();
  };

  // ───────────── Mock backend (test mode) ─────────────
  const MOCK_CATALOG = [
    { cat: "Forms", key: "form", items: [
      { id: "form_std", name: "Form – standard", price: 10, unit: "per form" },
      { id: "form_logic", name: "Form – conditional logic", price: 20, unit: "per form" }],
      details: [{ id: "pages", label: "Page count", type: "text" }, { id: "dest", label: "Where should responses go?", type: "text" }] },
    { cat: "Documents", key: "doc", items: [
      { id: "doc_std", name: "Document – standard", price: 10, unit: "per document" },
      { id: "doc_logic", name: "Document – conditional logic", price: 20, unit: "per document" }],
      details: [{ id: "merge", label: "Merge fields needed", type: "text" }, { id: "sig", label: "Signature required", type: "check" }] },
    { cat: "Reports", key: "rep", items: [
      { id: "rep_std", name: "Report – standard", price: 10, unit: "per report" },
      { id: "rep_cx", name: "Report – complex or dashboard", price: 20, unit: "per report" }],
      details: [{ id: "data", label: "Data to include and filters", type: "text" }, { id: "aud", label: "Who reads it, how often", type: "text" }] },
    { cat: "Automations", key: "auto", items: [
      { id: "auto_simple", name: "Automation – simple", price: 30, unit: "1 trigger, up to 3 emails" },
      { id: "auto_cx", name: "Automation – complex", price: 40, unit: "per automation" }],
      details: [{ id: "trigger", label: "Trigger (what starts it)", type: "text" }, { id: "steps", label: "Steps, timing, # of emails/texts", type: "text" }, { id: "notify", label: "Who gets notified", type: "text" }] },
    { cat: "Email templates", key: "email", items: [
      { id: "email_one", name: "Email template", price: 5, unit: "per template" },
      { id: "email_pack", name: "Email template pack (5)", price: 15, unit: "per pack" }],
      details: [{ id: "copy", label: "Copy provided by firm", type: "check" }, { id: "attached", label: "Attached to an automation", type: "check" }] },
    { cat: "Training", key: "train", items: [
      { id: "training", name: "Additional training call", price: 25, unit: "per hour" }],
      details: [{ id: "topic", label: "Topic / which build", type: "text" }, { id: "watched", label: "Customer has watched the Zight video", type: "check" }] },
  ];
  const SECTIONS = ["Quote Sent", "Paid / Ready to assign", "In Build", "Review Video Sent", "In Revisions", "Signed Off / Closed"];
  const PEOPLE = [
    { name: "Elliott Jones", email: "elliott@example.com" }, { name: "Gideon Bermeo", email: "gideon@example.com" },
    { name: "Jevijoh Nulud", email: "jevi@example.com" }, { name: "Kennedy Wickham", email: "kennedy@example.com" },
    { name: "Marta Reyna", email: "marta@example.com" },
  ];
  function daysFromNow(n) { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); }
  function mockReq(i, section, firm, firmId, services, total, extra) {
    return Object.assign({
      gid: String(9000 + i), name: `${firm} (${firmId}) – Services request`, url: "#", section, completed: section === SECTIONS[5],
      createdAt: new Date(Date.now() - (20 - i) * 864e5).toISOString(), dueOn: "", assignee: null, numSubtasks: services.length + 2,
      firmId, practiceArea: "Personal Injury", am: "Elliott Jones", csm: "Elliott Jones", services, total, list: total,
      quoteId: "Q-SAMPLE-" + firmId, quoteSent: daysFromNow(-(20 - i)), validUntil: daysFromNow(10 + i), paymentStatus: "Not invoiced",
      paidDate: "", chargebeeId: "", dmEmail: "owner@" + firm.split(" ")[0].toLowerCase() + ".example", delivered: "", zight: "",
      revisions: 0, offshoreHours: null, closeReason: "",
    }, extra || {});
  }
  const mockDb = [
    mockReq(1, SECTIONS[0], "Sample Harper Law", "5531", ["Form – conditional logic", "Email template"], 35),
    mockReq(2, SECTIONS[0], "Sample Ortiz & Co", "5540", ["Automation – complex", "Email template"], 40, { list: 45, validUntil: daysFromNow(-2) }),
    mockReq(3, SECTIONS[1], "Sample Reyes Family Law", "5502", ["Document – standard", "Document – conditional logic"], 30,
      { paymentStatus: "Paid", paidDate: daysFromNow(-1), chargebeeId: "inv_sample_1" }),
    mockReq(4, SECTIONS[2], "Sample Kline Estate", "5488", ["Automation – simple", "Email template pack (5)"], 45,
      { paymentStatus: "Paid", paidDate: daysFromNow(-6), assignee: { name: "Jevijoh Nulud", email: "jevi@example.com" }, dueOn: daysFromNow(3) }),
    mockReq(5, SECTIONS[2], "Sample Park Immigration", "5470", ["Report – complex or dashboard"], 20,
      { paymentStatus: "Paid", paidDate: daysFromNow(-20), assignee: { name: "Gideon Bermeo", email: "gideon@example.com" }, dueOn: daysFromNow(-1) }),
    mockReq(6, SECTIONS[3], "Sample Moss PI Group", "5455", ["Form – standard", "Form – standard"], 20,
      { paymentStatus: "Paid", paidDate: daysFromNow(-16), assignee: { name: "Marta Reyna", email: "marta@example.com" }, delivered: daysFromNow(-2), dueOn: daysFromNow(-2) }),
    mockReq(7, SECTIONS[4], "Sample Lane Bankruptcy", "5420", ["Automation – simple"], 0,
      { paymentStatus: "Waived", list: 30, assignee: { name: "Jevijoh Nulud", email: "jevi@example.com" }, revisions: 1 }),
    mockReq(8, SECTIONS[5], "Sample Vale Defense", "5400", ["Training call"], 25,
      { paymentStatus: "Paid", paidDate: daysFromNow(-30), closeReason: "Signed off", assignee: { name: "Gideon Bermeo", email: "gideon@example.com" } }),
  ];
  const mockExtras = {}; // gid → { notes, subtasks, comments }
  function extrasFor(r) {
    if (!mockExtras[r.gid]) mockExtras[r.gid] = {
      notes: "Quote " + r.quoteId + " · sample data\n\nNotes\nThis is test-mode sample data.",
      subtasks: r.services.map((s, i) => ({ gid: r.gid + "-" + i, name: "1× " + s, completed: r.section !== SECTIONS[0] && i === 0 }))
        .concat([{ gid: r.gid + "-p", name: "Record payment (Chargebee invoice ID)", completed: !!r.paidDate }, { gid: r.gid + "-z", name: "Zight walkthrough video", completed: !!r.delivered }]),
      files: [{ gid: "f-" + r.gid, name: "Sample intake packet.pdf", size: 248000, at: new Date(Date.now() - 2 * 864e5).toISOString(), host: "asana" }],
      comments: [{ gid: "c1", text: "Elliott Jones: Customer approved by reply.", at: new Date(Date.now() - 864e5).toISOString(), by: "Justin Shephard" }],
    };
    return mockExtras[r.gid];
  }
  IS.mockApi = function (action, p) {
    const wait = (v) => new Promise((ok) => setTimeout(() => ok(Object.assign({ ok: true }, v)), 250));
    const find = (gid) => mockDb.find((r) => r.gid === gid);
    switch (action) {
      case "getConfig": return wait({ config: { catalog: MOCK_CATALOG, minOrder: 50, quoteValidDays: 30, sections: SECTIONS, csms: PEOPLE, people: PEOPLE,
        paymentStatuses: ["Not invoiced", "Invoiced", "Paid", "Refunded", "Waived"], closeReasons: ["Signed off", "Auto-accepted", "Inactive", "Cancelled", "Refunded"], projectUrl: "#" } });
      case "listRequests": return wait({ requests: mockDb.map((r) => Object.assign({}, r)) });
      case "listFirms": return wait({ firms: [
        ["Sample Harper Law", "5531", "Personal Injury", "Elliott Jones"], ["Sample Harper & Vale LLP", "5532", "Business", "Kennedy Wickham"],
        ["Sample Ortiz & Co", "5540", "Immigration", "Elliott Jones"], ["Sample Reyes Family Law", "5502", "Family Law", "Kennedy Wickham"],
        ["Sample Kline Estate Planning", "5488", "Estate Planning", "Elliott Jones"], ["Sample Park Immigration", "5470", "Immigration", "Kennedy Wickham"],
        ["Sample Moss PI Group", "5455", "Personal Injury", "Elliott Jones"], ["Sample Lane Bankruptcy", "5420", "Bankruptcy", "Kennedy Wickham"] ] });
      case "getRequest": { const r = find(p.gid); return wait({ request: JSON.parse(JSON.stringify(Object.assign({}, r, extrasFor(r)))) }); }
      case "updateRequest": {
        const r = find(p.gid); const c = p.changes; const log = [];
        if (c.paymentStatus === "Paid" && !r.paidDate && !c.paidDate) c.paidDate = IS.todayIso();
        Object.keys(c).forEach((k) => {
          if (k === "assignee") { const per = PEOPLE.find((x) => x.email === c.assignee); r.assignee = per ? Object.assign({}, per) : null; log.push("Assignee"); }
          else if (k === "section") { r.section = c.section; r.completed = c.section === SECTIONS[5]; log.push("Stage"); }
          else { r[k] = ["total", "revisions", "offshoreHours"].includes(k) ? (c[k] === "" ? null : Number(c[k])) : c[k]; log.push(k); }
        });
        const ex = extrasFor(r);
        ex.comments.push({ gid: "c" + Date.now(), text: "Updated by " + IS.user.name + " (test mode): " + log.join(", "), at: new Date().toISOString(), by: "Justin Shephard" });
        return wait({ request: Object.assign({}, r, ex) });
      }
      case "setSubtask": { const ex = mockExtras[p.parentGid]; const s = ex && ex.subtasks.find((x) => x.gid === p.gid); if (s) s.completed = p.completed; return wait({ subtask: { gid: p.gid, completed: p.completed } }); }
      case "uploadFile": { const ex = extrasFor(find(p.gid)); const f = { gid: "f" + Date.now() + Math.random().toString(36).slice(2, 6), name: p.file.name, size: Math.round(p.file.data.length * 0.75), at: new Date().toISOString(), host: "asana" }; if (ex) ex.files.push(f); return wait({ file: f }); }
      case "fileUrl": return wait({ url: "about:blank" });
      case "deleteFile": { Object.values(mockExtras).forEach((ex) => { ex.files = ex.files.filter((f) => f.gid !== p.fileGid); }); return wait({ deleted: true }); }
      case "addComment": { const ex = mockExtras[p.gid]; const cm = { gid: "c" + Date.now(), text: IS.user.name + ": " + p.text, at: new Date().toISOString(), by: "Justin Shephard" }; if (ex) ex.comments.push(cm); return wait({ comment: cm }); }
      case "createRequest": {
        const r = p.request;
        const items = MOCK_CATALOG.flatMap((c) => c.items);
        const price = (l) => l.qty * ((items.find((i) => i.id === l.id) || {}).price || 0);
        const list = r.lines.reduce((n, l) => n + price(l), 0);
        const total = r.lines.reduce((n, l) => n + (l.waived ? 0 : price(l)), 0);
        const card = mockReq(mockDb.length + 1, SECTIONS[0], r.firm, r.firmId, r.lines.map((l) => (items.find((i) => i.id === l.id) || {}).name), total,
          { list, paymentStatus: total === 0 ? "Waived" : "Not invoiced", quoteSent: IS.todayIso(), validUntil: daysFromNow(30) });
        mockDb.unshift(card);
        return wait({ quoteId: "Q-SAMPLE-" + r.firmId, task: { gid: card.gid, url: "#", name: card.name } });
      }
      default: return wait({});
    }
  };
})();
