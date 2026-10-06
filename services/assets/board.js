/* Builds view: revenue summary, the stage board, filters, CSV export, and the request detail drawer (edits write to Asana). */
(function () {
  "use strict";
  const IS = window.IS;
  const { $, esc, money, shortDate } = IS;
  const B = (IS.board = { data: [], loadedAt: null, stale: true, current: null });
  const BUSINESS_DAYS_TO_ACCEPT = 5;

  // ───────────── data ─────────────
  B.markStale = () => { B.stale = true; };
  B.load = async function (fresh) {
    $("refresh").disabled = true;
    if (!B.data.length) $("board").innerHTML = '<div class="state">Loading builds…</div>';
    try {
      const res = await IS.api("listRequests", { fresh: !!fresh });
      B.data = res.requests || [];
      B.loadedAt = new Date(); B.stale = false;
      fillFilters(); render();
    } catch (e) {
      $("board").innerHTML = `<div class="state"><span class="err">Couldn't load builds: ${esc(e.message)}</span></div>`;
    } finally { $("refresh").disabled = false; }
  };

  function fillFilters() {
    const keep = (sel, opts, first) => {
      const v = sel.value;
      sel.innerHTML = first + opts.map(([val, label]) => `<option value="${esc(val)}">${esc(label)}</option>`).join("");
      if ([...sel.options].some((o) => o.value === v)) sel.value = v;
    };
    const assignees = {};
    B.data.forEach((r) => { if (r.assignee) assignees[r.assignee.email || r.assignee.name] = r.assignee.name; });
    keep($("fAssignee"), Object.entries(assignees).sort((a, b) => a[1].localeCompare(b[1])).concat([["__none", "Unassigned"]]), '<option value="">All assignees</option>');
    const csms = [...new Set(B.data.flatMap((r) => (r.csm ? r.csm.split(", ") : [])))].sort();
    keep($("fCsm"), csms.map((c) => [c, c]), '<option value="">All CSMs</option>');
  }

  // ───────────── derived state ─────────────
  const today = () => IS.todayIso();
  const sections = () => IS.config.sections;
  const lastSection = () => sections()[sections().length - 1];
  function addBusinessDays(iso, n) {
    const d = new Date(iso + "T12:00:00");
    while (n > 0) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n--; }
    return d.toISOString().slice(0, 10);
  }
  function flagsFor(r) {
    const f = [];
    const t = today();
    if (r.section === sections()[0] && r.validUntil && r.validUntil < t) f.push(["danger", "Quote expired"]);
    if (r.section !== sections()[0] && r.section !== lastSection() && r.dueOn && r.dueOn < t) f.push(["danger", "Overdue"]);
    if (r.section === "Review Video Sent" && r.delivered && addBusinessDays(r.delivered, BUSINESS_DAYS_TO_ACCEPT) <= t) f.push(["warn", "Auto-accept due"]);
    const waivedAmt = (Number(r.list) || 0) - (Number(r.total) || 0);
    if (r.paymentStatus === "Waived") f.push(["info", "Waived"]);
    else if (waivedAmt > 0) f.push(["info", money(waivedAmt) + " waived"]);
    else if (r.section !== sections()[0] && r.paymentStatus && r.paymentStatus !== "Paid") f.push(["warn", r.paymentStatus]);
    if (r.section !== sections()[0] && r.section !== lastSection() && !r.assignee) f.push(["muted", "Unassigned"]);
    return f;
  }
  function periodRange(p) {
    const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    if (p === "month") return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0)), "This month"];
    if (p === "lastmonth") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0)), "Last month"];
    if (p === "quarter") { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0)), "This quarter"]; }
    if (p === "ytd") return [iso(new Date(y, 0, 1)), iso(now), "Year to date"];
    return ["0000-01-01", "9999-12-31", "All time"];
  }
  function filtered() {
    const q = $("q").value.trim().toLowerCase();
    const a = $("fAssignee").value;
    const c = $("fCsm").value;
    return B.data.filter((r) => {
      if (q && ![r.name, r.firmId, r.quoteId, r.services.join(" "), r.dmEmail].join(" ").toLowerCase().includes(q)) return false;
      if (a === "__none" && r.assignee) return false;
      if (a && a !== "__none" && !(r.assignee && (r.assignee.email || r.assignee.name) === a)) return false;
      if (c && !(r.csm || "").split(", ").includes(c)) return false;
      return true;
    });
  }

  // ───────────── render: summary + board ─────────────
  function render() {
    const rows = filtered();
    const [from, to, label] = periodRange($("fPeriod").value);
    const inPeriod = (d) => d && d >= from && d <= to;
    const sum = (arr, k) => arr.reduce((n, r) => n + (Number(r[k]) || 0), 0);

    const paid = rows.filter((r) => r.paymentStatus === "Paid" && inPeriod(r.paidDate));
    const quotes = rows.filter((r) => r.section === sections()[0]);
    const expired = quotes.filter((r) => r.validUntil && r.validUntil < today());
    const active = rows.filter((r) => r.section !== sections()[0] && r.section !== lastSection());
    const overdue = active.filter((r) => r.dueOn && r.dueOn < today());
    const waivedAmt = (r) => Math.max(0, (Number(r.list) || 0) - (Number(r.total) || 0));
    const waived = rows.filter((r) => waivedAmt(r) > 0 && inPeriod(r.quoteSent));

    $("summary").innerHTML = [
      ["Revenue · " + label, money(sum(paid, "total")), `${paid.length} paid request${paid.length === 1 ? "" : "s"}`],
      ["Quotes out", money(sum(quotes, "total")), `${quotes.length} open${expired.length ? ` · ${expired.length} expired` : ""}`],
      ["Builds in progress", String(active.length), `${money(sum(active, "total"))} value${overdue.length ? ` · ${overdue.length} overdue` : ""}`],
      ["Waived · " + label, money(waived.reduce((n, r) => n + waivedAmt(r), 0)), `across ${waived.length} request${waived.length === 1 ? "" : "s"} (list value)`],
    ].map(([k, v, s]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join("");

    const byDue = (a, b) => (a.dueOn || "9999") < (b.dueOn || "9999") ? -1 : (a.dueOn || "9999") > (b.dueOn || "9999") ? 1 : 0;
    $("board").innerHTML = sections().map((sec, i) => {
      let items = rows.filter((r) => r.section === sec);
      if (i === 0) items.sort((a, b) => (b.quoteSent || "").localeCompare(a.quoteSent || ""));
      else if (sec === lastSection()) items.sort((a, b) => (b.modifiedAt || "").localeCompare(a.modifiedAt || ""));
      else items.sort(byDue);
      const total = sum(items, "total");
      const shown = sec === lastSection() ? items.slice(0, 15) : items;
      return `<div class="column" data-section="${esc(sec)}">
        <div class="col-head"><h3>${esc(sec)}</h3><span class="meta">${items.length} · ${money(total)}</span></div>
        ${shown.map(card).join("") || '<div class="col-empty">Nothing here.</div>'}
        ${items.length > shown.length ? `<div class="col-empty">Showing the 15 most recent of ${items.length}.</div>` : ""}
      </div>`;
    }).join("");
    $("updated").textContent = B.loadedAt ? "Updated " + B.loadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
  }

  function card(r) {
    const firm = r.name.replace(/\s+–\s+Services request$/, "");
    const flags = flagsFor(r);
    const when = r.section === sections()[0]
      ? (r.validUntil ? "Valid until " + shortDate(r.validUntil) : "")
      : r.section === lastSection() ? (r.closeReason || "Closed") : (r.dueOn ? "Due " + shortDate(r.dueOn) : "No target date");
    return `<button type="button" class="card" data-gid="${esc(r.gid)}">
      <div class="firm">${esc(firm)}</div>
      <div class="sub">${esc(r.services.join(", ") || "—")}</div>
      <div class="row"><span class="amt">${r.paymentStatus === "Waived" ? "Waived" : money(r.total)}</span><span class="sub">${esc(when)}</span></div>
      <div class="row">
        <div class="badges">${flags.map(([k, t]) => `<span class="pill ${k}">${esc(t)}</span>`).join("")}</div>
        ${r.assignee ? `<span class="avatar sm" title="${esc(r.assignee.name)}">${esc(IS.initials(r.assignee.name))}</span>` : ""}
      </div>
    </button>`;
  }

  // ───────────── CSV ─────────────
  function downloadCsv() {
    const cols = [["Request", "name"], ["Firm ID", "firmId"], ["Stage", "section"], ["Total Value", "total"], ["List Value", "list"],
      ["Payment Status", "paymentStatus"], ["Paid Date", "paidDate"], ["Chargebee Invoice ID", "chargebeeId"], ["Services", (r) => r.services.join("; ")],
      ["Quote ID", "quoteId"], ["Quote Sent", "quoteSent"], ["Valid Until", "validUntil"], ["Account Manager", "am"], ["CSM", "csm"],
      ["Assignee", (r) => (r.assignee ? r.assignee.name : "")], ["Target Delivery", "dueOn"], ["Delivered", "delivered"],
      ["Revision Count", "revisions"], ["Offshore Hours", "offshoreHours"], ["Close Reason", "closeReason"], ["Asana link", "url"]];
    const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.map((c) => c[0]).join(",")].concat(filtered().map((r) =>
      cols.map(([, k]) => cell(typeof k === "function" ? k(r) : r[k])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "additional-services-" + IS.todayIso() + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ───────────── drawer ─────────────
  let lastFocus = null;
  async function openDrawer(gid) {
    lastFocus = document.activeElement;
    const r = B.data.find((x) => x.gid === gid);
    $("dTitle").textContent = r ? r.name : "Loading…";
    $("dSub").textContent = "";
    $("dBody").innerHTML = '<div class="state">Loading request…</div>';
    $("scrim").hidden = false; $("drawer").hidden = false;
    $("dClose").focus();
    try {
      const res = await IS.api("getRequest", { gid });
      B.current = res.request;
      renderDrawer();
    } catch (e) {
      $("dBody").innerHTML = `<div class="state"><span class="err">Couldn't load this request: ${esc(e.message)}</span></div>`;
    }
  }
  function closeDrawer() {
    $("scrim").hidden = true; $("drawer").hidden = true; B.current = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  const opt = (vals, cur, blank) => (blank != null ? `<option value="">${esc(blank)}</option>` : "") +
    vals.map((v) => { const [val, label] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}"${val === cur ? " selected" : ""}>${esc(label)}</option>`; }).join("");

  function renderDrawer() {
    const r = B.current;
    const cfg = IS.config;
    $("dTitle").textContent = r.name;
    $("dSub").textContent = [r.quoteId, r.firmId && "Firm " + r.firmId, r.quoteSent && "Quoted " + shortDate(r.quoteSent)].filter(Boolean).join(" · ");
    const people = (cfg.people || []).slice();
    if (r.assignee && !people.some((p) => p.email === r.assignee.email)) people.push({ name: r.assignee.name, email: r.assignee.email });
    const done = r.subtasks.filter((s) => s.completed).length;
    const kv = (k, v) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : "—"}</dd>`;

    $("dBody").innerHTML = `
      <div class="flags">${flagsFor(r).map(([k, t]) => `<span class="pill ${k}">${esc(t)}</span>`).join("")}</div>

      <section class="block">
        <h3>Status</h3>
        <form id="editForm" class="fields" novalidate>
          <label class="f">Stage<select id="e_section">${opt(cfg.sections, r.section)}</select></label>
          <label class="f">Assignee (offshore rep)<select id="e_assignee">${opt(people.map((p) => [p.email, p.name]), r.assignee ? r.assignee.email : "", "Unassigned")}</select></label>
          <label class="f">Target delivery<input type="date" id="e_dueOn" value="${esc(r.dueOn)}"></label>
          <label class="f">Payment status<select id="e_paymentStatus">${opt(cfg.paymentStatuses, r.paymentStatus, "—")}</select></label>
          <label class="f">Paid date<input type="date" id="e_paidDate" value="${esc(r.paidDate)}"></label>
          <label class="f">Chargebee invoice ID<input type="text" id="e_chargebeeId" value="${esc(r.chargebeeId)}"></label>
          <label class="f">Total value ($)<input type="number" min="0" step="1" id="e_total" value="${r.total == null ? "" : esc(r.total)}"></label>
          <label class="f">Delivered<input type="date" id="e_delivered" value="${esc(r.delivered)}"></label>
          <label class="f full">Zight video link<input type="text" id="e_zight" value="${esc(r.zight)}" placeholder="https://share.zight.com/…"></label>
          <label class="f">Revision count<input type="number" min="0" step="1" id="e_revisions" value="${r.revisions == null ? "" : esc(r.revisions)}"></label>
          <label class="f">Offshore hours<input type="number" min="0" step="0.25" id="e_offshoreHours" value="${r.offshoreHours == null ? "" : esc(r.offshoreHours)}"></label>
          <label class="f">Close reason<select id="e_closeReason">${opt(cfg.closeReasons, r.closeReason, "—")}</select></label>
          <div class="savebar full">
            <button class="btn primary" type="submit" id="eSave" disabled>Save changes</button>
            <a class="btn small" href="${esc(r.url)}" target="_blank" rel="noopener">Open in Asana ↗</a>
            <span class="toast" id="eToast" role="status"></span>
          </div>
        </form>
      </section>

      <section class="block">
        <h3>Request</h3>
        <dl class="kv">
          ${kv("Services", r.services.join(", "))}
          ${kv("List value", r.list == null ? "" : money(r.list))}
          ${kv("Account Manager", r.am)}
          ${kv("CSM", r.csm)}
          ${kv("Decision-maker", r.dmEmail)}
          ${kv("Practice area", r.practiceArea)}
          ${kv("Quote valid until", r.validUntil && shortDate(r.validUntil))}
        </dl>
        ${r.notes ? `<pre class="notes">${esc(r.notes)}</pre>` : ""}
      </section>

      <section class="block">
        <h3>Checklist · ${done}/${r.subtasks.length}</h3>
        <div id="subtasks" style="display:grid;gap:8px">
          ${r.subtasks.map((s) => `<label class="subtask${s.completed ? " done" : ""}"><input type="checkbox" data-sub="${esc(s.gid)}"${s.completed ? " checked" : ""}><span>${esc(s.name)}</span></label>`).join("") || '<span class="hint" style="margin:0">No subtasks.</span>'}
        </div>
      </section>

      <section class="block" id="filesBlock">
        <h3 id="filesHead"></h3>
        <div id="fileList" class="files"></div>
        <label class="dropzone" id="dropzone">
          <input type="file" id="fileInput" multiple>
          <span><strong>Drop files here</strong> or <span class="linkbtn">choose files</span></span>
          <span class="dz-sub">Attached to the Asana task · up to 25 MB each</span>
        </label>
        <div id="uploadStatus" class="upload-status" aria-live="polite"></div>
      </section>

      <section class="block">
        <h3>Comments</h3>
        <div id="commentList">${r.comments.map(commentHtml).join("") || '<span class="hint" style="margin:0">No comments yet.</span>'}</div>
        <form id="commentForm" style="display:grid;gap:8px" novalidate>
          <label class="f">Add a comment<textarea id="cText" placeholder="Posts to the Asana task with your name"></textarea></label>
          <div class="savebar"><button class="btn" type="submit" id="cPost">Post comment</button><span class="toast" id="cToast" role="status"></span></div>
        </form>
      </section>`;

    wireFiles();

    const fields = ["section", "assignee", "dueOn", "paymentStatus", "paidDate", "chargebeeId", "total", "delivered", "zight", "revisions", "offshoreHours", "closeReason"];
    const original = {};
    const current = () => { const o = {}; fields.forEach((k) => { o[k] = $("e_" + k).value; }); return o; };
    Object.assign(original, current());
    const changes = () => { const c = current(); const out = {}; fields.forEach((k) => { if (c[k] !== original[k]) out[k] = c[k]; }); return out; };
    $("editForm").addEventListener("input", () => { $("eSave").disabled = !Object.keys(changes()).length; });
    $("editForm").addEventListener("change", () => { $("eSave").disabled = !Object.keys(changes()).length; });
    $("editForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const ch = changes();
      if (!Object.keys(ch).length) return;
      if (ch.section === lastSection() && !$("e_closeReason").value) {
        $("eToast").innerHTML = '<span class="err">Pick a close reason before closing the request.</span>'; return;
      }
      $("eSave").disabled = true; $("eToast").textContent = "Saving to Asana…";
      try {
        const res = await IS.api("updateRequest", { gid: r.gid, changes: ch });
        replace(res.request); B.current = res.request; renderDrawer();
        $("eToast").textContent = "Saved.";
      } catch (err) { $("eToast").innerHTML = `<span class="err">Not saved: ${esc(err.message)}</span>`; $("eSave").disabled = false; }
    });

    $("subtasks").addEventListener("change", async (e) => {
      const box = e.target.closest("input[data-sub]");
      if (!box) return;
      box.disabled = true;
      try {
        await IS.api("setSubtask", { parentGid: r.gid, gid: box.dataset.sub, completed: box.checked });
        const s = r.subtasks.find((x) => x.gid === box.dataset.sub); if (s) s.completed = box.checked;
        box.closest(".subtask").classList.toggle("done", box.checked);
        const n = r.subtasks.filter((x) => x.completed).length;
        box.closest(".block").querySelector("h3").textContent = `Checklist · ${n}/${r.subtasks.length}`;
      } catch (err) { box.checked = !box.checked; alertInline(box.closest(".block"), err.message); }
      finally { box.disabled = false; }
    });

    $("commentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("cText").value.trim();
      if (!text) { $("cToast").innerHTML = '<span class="err">Write a comment first.</span>'; return; }
      $("cPost").disabled = true; $("cToast").textContent = "Posting…";
      try {
        const res = await IS.api("addComment", { gid: r.gid, text });
        r.comments.push(res.comment);
        $("commentList").innerHTML = r.comments.map(commentHtml).join("");
        $("cText").value = ""; $("cPost").disabled = false;
        $("cToast").textContent = "Posted.";
      } catch (err) { $("cToast").innerHTML = `<span class="err">Not posted: ${esc(err.message)}</span>`; $("cPost").disabled = false; }
    });
  }
  function commentHtml(c) {
    return `<div class="comment"><div class="by">${esc(new Date(c.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</div><div class="text">${esc(c.text)}</div></div>`;
  }

  // ───────────── files in the drawer ─────────────
  const EXT_LABEL = (name) => { const m = /\.([a-z0-9]{1,5})$/i.exec(name || ""); return m ? m[1].toUpperCase() : "FILE"; };
  function renderFiles() {
    const r = B.current;
    r.files = r.files || [];
    $("filesHead").textContent = "Files" + (r.files.length ? " · " + r.files.length : "");
    $("fileList").innerHTML = r.files.length
      ? r.files.map((f) => `<div class="file" data-file="${esc(f.gid)}">
          <span class="ext">${esc(EXT_LABEL(f.name))}</span>
          <button type="button" class="fname" data-open="${esc(f.gid)}" title="Open ${esc(f.name)}">${esc(f.name)}</button>
          <span class="fmeta">${esc([IS.fmtSize(f.size), f.at && shortDate(f.at.slice(0, 10))].filter(Boolean).join(" · "))}</span>
          <span class="factions"><button type="button" class="linkbtn danger" data-del="${esc(f.gid)}">Delete</button></span>
        </div>`).join("")
      : '<span class="hint" style="margin:0">No files yet.</span>';
  }
  async function addFiles(fileList) {
    const r = B.current;
    const files = [...fileList];
    if (!files.length) return;
    const status = $("uploadStatus");
    const rows = files.map((f, i) => `<div id="up${i}"><span class="spin"></span> ${esc(f.name)} <span class="fmeta">${esc(IS.fmtSize(f.size))}</span></div>`);
    status.innerHTML = rows.join("");
    await IS.uploadFiles(r.gid, files, (f, res, err, i) => {
      const row = $("up" + i);
      if (res) { r.files.push(res); renderFiles(); if (row) row.remove(); }
      else if (row) row.innerHTML = `<span class="err">${esc(f.name)} wasn't attached: ${esc(err.message)}</span>`;
    });
    $("fileInput").value = "";
  }
  function wireFiles() {
    renderFiles();
    $("fileInput").addEventListener("change", (e) => addFiles(e.target.files));
    const dz = $("dropzone");
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
    $("fileList").addEventListener("click", async (e) => {
      const open = e.target.closest("[data-open]");
      if (open) {
        try { await IS.openFile(open.dataset.open); }
        catch (err) { alertInline($("filesBlock"), err.message); }
        return;
      }
      const del = e.target.closest("[data-del]");
      if (del) {
        const row = del.closest(".file");
        row.querySelector(".factions").innerHTML = `<span class="fmeta">Delete from Asana?</span> <button type="button" class="linkbtn danger" data-confirm="${esc(del.dataset.del)}">Delete</button> <button type="button" class="linkbtn" data-cancel>Keep</button>`;
        return;
      }
      if (e.target.closest("[data-cancel]")) { renderFiles(); return; }
      const conf = e.target.closest("[data-confirm]");
      if (conf) {
        conf.disabled = true;
        try {
          await IS.api("deleteFile", { fileGid: conf.dataset.confirm });
          B.current.files = B.current.files.filter((f) => f.gid !== conf.dataset.confirm); renderFiles();
        } catch (err) { alertInline($("filesBlock"), err.message); renderFiles(); }
      }
    });
  }

  function alertInline(block, msg) {
    const el = document.createElement("div"); el.className = "err"; el.textContent = "Couldn't update: " + msg;
    block.appendChild(el); setTimeout(() => el.remove(), 5000);
  }
  function replace(updated) {
    const i = B.data.findIndex((x) => x.gid === updated.gid);
    const slim = Object.assign({}, updated); delete slim.subtasks; delete slim.comments; delete slim.notes;
    if (i >= 0) B.data[i] = slim; else B.data.unshift(slim);
    fillFilters(); render();
  }

  // ───────────── wiring ─────────────
  B.wire = function () {
    ["q", "fAssignee", "fCsm", "fPeriod"].forEach((id) => $(id).addEventListener("input", render));
    $("refresh").addEventListener("click", () => B.load(true));
    $("csv").addEventListener("click", downloadCsv);
    $("board").addEventListener("click", (e) => { const c = e.target.closest(".card[data-gid]"); if (c) openDrawer(c.dataset.gid); });
    $("dClose").addEventListener("click", closeDrawer);
    $("scrim").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("drawer").hidden) closeDrawer(); });
  };
})();
