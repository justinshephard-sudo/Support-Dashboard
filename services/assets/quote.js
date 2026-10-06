/* Quote builder view: pick services → live price, quote card, quote email → create the Asana card in Quote Sent. */
(function () {
  "use strict";
  const IS = window.IS;
  const { $, esc, money, fmtDate } = IS;
  let busy = false;

  const Q = (IS.quote = {});

  Q.init = function () {
    buildCsms(); buildCatalog(); render();
    loadFirms();
  };

  // ───────────── Firm lookup (firms on file, from the Support Dashboard's Accounts tab) ─────────────
  let firms = null;      // [{ name, firmId, area, am }]
  let picked = null;     // the firm chosen from the list
  let options = [];      // current dropdown matches
  let active = -1;

  async function loadFirms() {
    setStatus('<span class="hint" style="margin:0">Loading firms on file…</span>');
    try {
      const res = await IS.api("listFirms");
      firms = (res.firms || []).map(([name, firmId, area, am]) => ({ name, firmId, area, am }));
      setStatus("");
    } catch (e) {
      firms = [];
      setStatus(`<span class="off-file">Couldn't load firms on file (${esc(e.message)}).</span> Type the firm name and Firm ID by hand.`);
    }
  }
  function setStatus(html) { $("firmStatus").innerHTML = html; }
  const normId = (s) => String(s == null ? "" : s).toLowerCase().replace(/[,\s\u00a0]/g, "").replace(/\.0+$/, "");

  // Same ranking as the Support Dashboard: Firm ID exact > prefix > contains, then name contains, then letters in order.
  function score(q, f) {
    q = q.toLowerCase().trim();
    if (!q) return -1;
    const name = f.name.toLowerCase();
    const id = normId(f.firmId), qn = normId(q);
    if (id && qn && /^\d+$/.test(qn)) {
      if (id === qn) return 300;
      if (id.startsWith(qn)) return 200;
      if (id.includes(qn)) return 150;
    }
    if (name.startsWith(q)) return 120;
    const at = name.indexOf(q);
    if (at >= 0) return 100 - Math.min(at, 50);
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((w) => name.includes(w))) return 60;
    let qi = 0;
    for (let i = 0; i < name.length && qi < q.length; i++) if (name[i] === q[qi]) qi++;
    return qi === q.length && q.length >= 3 ? 30 : -1;
  }
  function highlight(name, q) {
    const i = name.toLowerCase().indexOf(q.toLowerCase().trim());
    if (!q.trim() || i < 0) return esc(name);
    return esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + q.trim().length)) + "</mark>" + esc(name.slice(i + q.trim().length));
  }
  function openList(q) {
    const list = $("firmList");
    if (!firms || !q.trim()) { closeList(); return; }
    options = firms.map((f) => ({ f, s: score(q, f) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name)).slice(0, 8).map((x) => x.f);
    active = options.length ? 0 : -1;
    list.innerHTML = options.length
      ? options.map((f, i) => `<div class="combo-opt" role="option" id="firmOpt${i}" data-i="${i}" aria-selected="${i === active}">
          <span class="n">${highlight(f.name, q)}</span>
          <span class="m">${esc(["Firm " + f.firmId, f.area, f.am && "AM " + f.am].filter(Boolean).join(" · "))}</span></div>`).join("")
      : `<div class="combo-empty">No firm on file matches "${esc(q.trim())}". You can still type the name and Firm ID by hand.</div>`;
    list.hidden = false;
    $("firm").setAttribute("aria-expanded", "true");
    $("firm").setAttribute("aria-activedescendant", active >= 0 ? "firmOpt" + active : "");
  }
  function closeList() {
    $("firmList").hidden = true; options = []; active = -1;
    $("firm").setAttribute("aria-expanded", "false");
    $("firm").removeAttribute("aria-activedescendant");
  }
  function moveActive(d) {
    if (!options.length) return;
    active = (active + d + options.length) % options.length;
    [...$("firmList").querySelectorAll(".combo-opt")].forEach((el, i) => {
      el.setAttribute("aria-selected", String(i === active));
      if (i === active) el.scrollIntoView({ block: "nearest" });
    });
    $("firm").setAttribute("aria-activedescendant", "firmOpt" + active);
  }
  function pickFirm(f) {
    picked = f;
    $("firm").value = f.name;
    $("firmId").value = f.firmId;
    $("firmId").readOnly = true;
    $("firm").classList.remove("invalid"); $("firmId").classList.remove("invalid");
    // practice area: select the matching option, adding it if the list doesn't have it
    if (f.area) {
      const sel = $("pa");
      let o = [...sel.options].find((x) => x.value.toLowerCase() === f.area.toLowerCase());
      if (!o) { o = new Option(f.area, f.area); sel.add(o); }
      sel.value = o.value;
    }
    // CSM: the firm's account manager, when they're in the CSM list
    if (f.am) {
      const c = (IS.config.csms || []).find((x) => x.name.toLowerCase() === f.am.toLowerCase());
      if (c) $("csm").value = c.email;
    }
    setStatus(`<span class="on-file">✓ On file</span><span>${esc(["Firm " + f.firmId, f.area, f.am && "AM " + f.am].filter(Boolean).join(" · "))}</span><button class="linkbtn" type="button" id="firmChange">Change firm</button>`);
    $("firmChange").addEventListener("click", clearFirm);
    closeList(); render();
  }
  function clearFirm() {
    picked = null;
    $("firm").value = ""; $("firmId").value = ""; $("firmId").readOnly = false;
    setStatus(""); render(); $("firm").focus();
  }
  Q.firmPicked = () => picked;

  // ───────────── files to attach once the card exists ─────────────
  let pending = [];
  function renderPending() {
    $("qFileList").innerHTML = pending.map((f, i) => `<div class="file">
        <span class="ext">${esc((/\.([a-z0-9]{1,5})$/i.exec(f.name) || [, "FILE"])[1].toUpperCase())}</span>
        <span class="fname static">${esc(f.name)}</span>
        <span class="fmeta">${esc(IS.fmtSize(f.size))}${f.size > IS.MAX_FILE_BYTES ? ' · <span class="err">over 25 MB</span>' : ""}</span>
        <span class="factions"><button type="button" class="linkbtn danger" data-rm="${i}">Remove</button></span></div>`).join("");
  }
  function addPending(list) {
    [...list].forEach((f) => { if (!pending.some((p) => p.name === f.name && p.size === f.size)) pending.push(f); });
    $("qFiles").value = ""; renderPending();
  }
  function wirePending() {
    $("qFiles").addEventListener("change", (e) => addPending(e.target.files));
    const dz = $("qDrop");
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (e) => addPending(e.dataTransfer.files));
    $("qFileList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rm]");
      if (b) { pending.splice(Number(b.dataset.rm), 1); renderPending(); }
    });
  }
  function wireFirm() {
    const input = $("firm");
    input.addEventListener("input", () => {
      if (picked) { picked = null; $("firmId").value = ""; $("firmId").readOnly = false; setStatus(""); }
      openList(input.value);
    });
    input.addEventListener("focus", () => { if (!picked && input.value.trim()) openList(input.value); });
    input.addEventListener("keydown", (e) => {
      if ($("firmList").hidden) { if (e.key === "ArrowDown" && input.value.trim()) { openList(input.value); e.preventDefault(); } return; }
      if (e.key === "ArrowDown") { moveActive(1); e.preventDefault(); }
      else if (e.key === "ArrowUp") { moveActive(-1); e.preventDefault(); }
      else if (e.key === "Enter") { if (active >= 0) { pickFirm(options[active]); e.preventDefault(); } }
      else if (e.key === "Escape") { closeList(); }
    });
    input.addEventListener("blur", () => setTimeout(closeList, 150));
    // mousedown (not click) so the choice lands before the input's blur closes the list
    $("firmList").addEventListener("mousedown", (e) => {
      const opt = e.target.closest(".combo-opt");
      if (opt) { e.preventDefault(); pickFirm(options[Number(opt.dataset.i)]); }
    });
    // typing a Firm ID by hand: if it's on file, fill in the firm
    $("firmId").addEventListener("input", () => {
      if (picked || !firms) return;
      const id = normId($("firmId").value);
      const f = id && firms.find((x) => x.firmId === id);
      if (f) pickFirm(f);
      else if (id && firms.length) setStatus('<span class="off-file">Firm ID not on file.</span> Double-check it, or pick the firm from the list.');
      else setStatus("");
    });
  }

  function buildCsms() {
    const sel = $("csm");
    const csms = IS.config.csms || [];
    sel.innerHTML = '<option value="">Select CSM…</option>' + csms.map((c) => `<option value="${esc(c.email)}">${esc(c.name)}</option>`).join("");
    const me = csms.find((c) => c.email === (IS.user.email || "").toLowerCase());
    if (me) sel.value = me.email;
  }

  function buildCatalog() {
    const catEl = $("catalog");
    catEl.innerHTML = "";
    IS.config.catalog.forEach((c) => {
      const box = document.createElement("div");
      box.className = "cat";
      box.innerHTML = `<div class="cat-head"><h3>${esc(c.cat)}</h3><span class="cat-sum" id="sum_${c.key}"></span></div>` +
        c.items.map((it) => `
          <div class="item" id="row_${it.id}">
            <div><div class="name">${esc(it.name)}</div><div class="unit">${money(it.price)} ${esc(it.unit)}</div>
              <label class="waive-toggle" hidden><input type="checkbox" id="w_${it.id}"> Waive</label></div>
            <div class="stepper">
              <button type="button" aria-label="Fewer ${esc(it.name)}" data-step="-1" data-id="${it.id}">−</button>
              <input type="number" min="0" step="1" value="0" id="q_${it.id}" aria-label="${esc(it.name)} quantity">
              <button type="button" aria-label="More ${esc(it.name)}" data-step="1" data-id="${it.id}">+</button>
            </div>
            <div class="amt" id="a_${it.id}">—</div>
          </div>`).join("") +
        `<div class="details" id="det_${c.key}" hidden>
          <div class="dlabel">${esc(c.cat)} details</div>
          <div class="fields">
            <label class="f full">What it does (shown on the quote)<input type="text" id="s_${c.key}" placeholder="One line for the quote email"></label>
            ${c.details.map((d) => d.type === "check"
              ? `<label class="check full"><input type="checkbox" id="d_${c.key}_${d.id}"> ${esc(d.label)}</label>`
              : `<label class="f">${esc(d.label)}<input type="text" id="d_${c.key}_${d.id}"></label>`).join("")}
          </div>
          ${c.key === "train" ? `<div class="note warn" id="trainWarn" hidden>Training calls are a last resort. Offer one only after the customer has watched the walkthrough video.</div>` : ""}
        </div>`;
      catEl.appendChild(box);
    });
  }

  function readState() {
    const lines = [];
    IS.config.catalog.forEach((c) => c.items.forEach((it) => {
      const q = Math.max(0, parseInt($("q_" + it.id).value, 10) || 0);
      const waived = $("w_" + it.id).checked;
      if (q > 0) lines.push(Object.assign({}, it, { key: c.key, qty: q, amount: q * it.price, waived, charged: waived ? 0 : q * it.price, what: $("s_" + c.key).value.trim() }));
    }));
    const list = lines.reduce((s, l) => s + l.amount, 0);
    const total = lines.reduce((s, l) => s + l.charged, 0);
    const waivedValue = list - total;
    return { lines, list, total, waivedValue, allWaived: lines.length > 0 && total === 0, someWaived: waivedValue > 0,
      firm: $("firm").value.trim(), firmId: $("firmId").value.trim(), dmName: $("dmName").value.trim(), dmEmail: $("dmEmail").value.trim(),
      csmEmail: $("csm").value, pa: $("pa").value, notes: $("notes").value.trim(), needBy: $("needBy").value, files: $("files").value.trim() };
  }

  const validUntil = () => new Date(Date.now() + (IS.config.quoteValidDays || 30) * 864e5);

  function render() {
    if (!IS.config) return;
    const s = readState();
    const today = new Date();
    IS.config.catalog.forEach((c) => {
      let catTotal = 0, any = false;
      c.items.forEach((it) => {
        const q = Math.max(0, parseInt($("q_" + it.id).value, 10) || 0);
        const w = $("w_" + it.id);
        if (q === 0) w.checked = false;
        w.closest(".waive-toggle").hidden = q === 0;
        $("row_" + it.id).classList.toggle("on", q > 0);
        $("row_" + it.id).classList.toggle("is-waived", q > 0 && w.checked);
        $("a_" + it.id).innerHTML = q === 0 ? "—" : w.checked ? `<s>${money(q * it.price)}</s><span class="wv">Waived</span>` : money(q * it.price);
        catTotal += w.checked ? 0 : q * it.price; if (q > 0) any = true;
      });
      $("sum_" + c.key).textContent = any ? money(catTotal) : "";
      $("det_" + c.key).hidden = !any;
    });
    const watched = $("d_train_watched");
    if ($("trainWarn")) $("trainWarn").hidden = watched.checked;

    $("tItems").textContent = s.lines.reduce((n, l) => n + l.qty, 0);
    $("tList").textContent = money(s.list);
    $("tWaivedRow").hidden = !s.someWaived;
    $("tWaived").textContent = "−" + money(s.waivedValue);
    $("tTotal").textContent = money(s.total);
    const master = $("waived");
    master.checked = s.allWaived;
    master.indeterminate = s.someWaived && !s.allWaived;

    const min = IS.config.minOrder || 0;
    const flags = [];
    if (s.allWaived) flags.push(`<span class="pill info">Fully waived · ${money(s.list)} list value recorded</span>`);
    else if (s.someWaived) flags.push(`<span class="pill info">${money(s.waivedValue)} waived</span>`);
    if (s.total > 0 && s.total < min) flags.push(`<span class="pill warn">Below the proposed ${money(min)} minimum order</span>`);
    if (s.total >= min && s.total > 0) flags.push(`<span class="pill ok">Meets ${money(min)} minimum</span>`);
    if (s.lines.some((l) => l.key === "train") && watched && !watched.checked) flags.push(`<span class="pill warn">Training call before video watched</span>`);
    $("flags").innerHTML = flags.join("");
    $("validCap").textContent = "Valid until " + fmtDate(validUntil());

    const rows = s.lines.map((l) => `<tr>
        <td><div>${esc(l.name)}${l.qty > 1 ? ` × ${l.qty}` : ""}</div>${l.what ? `<div class="what">${esc(l.what)}</div>` : ""}</td>
        <td class="r mono">${l.waived ? `<s class="was">${money(l.amount)}</s><br>${money(0)}` : money(l.amount)}</td></tr>`).join("");
    $("paper").innerHTML = `
      <div class="ph">
        <div><img class="brand-logo" src="assets/lawmatics-logo.svg" alt="Lawmatics" width="132" height="22"><div class="doc">Services quote</div></div>
        <div class="qno">${s.firmId ? "Q-" + today.toISOString().slice(2, 10).replace(/-/g, "") + "-" + esc(s.firmId) : "Quote"}<br>${fmtDate(today)}</div>
      </div>
      <div class="meta">
        <div><div class="k">Prepared for</div><div class="v">${esc(s.firm || "Firm name")}${s.firmId ? ` <span style="color:var(--paper-muted)">#${esc(s.firmId)}</span>` : ""}</div></div>
        <div><div class="k">Attention</div><div class="v">${esc(s.dmName || "Decision-maker")}</div></div>
        <div><div class="k">Valid until</div><div class="v">${fmtDate(validUntil())}</div></div>
        <div><div class="k">Delivery</div><div class="v">14+ days after payment</div></div>
      </div>
      ${s.lines.length ? `<table><thead><tr><th>Item</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="tot"><span class="lab">Total</span><span class="val">${money(s.total)}</span></div>
        ${s.someWaived ? `<div class="waived">${s.allWaived ? "Waived" : "Includes " + money(s.waivedValue) + " waived"} by your Customer Success Manager</div>` : ""}`
        : `<div class="empty">Add a service to build the quote.</div>`}
      <ul class="terms">
        <li>${s.allWaived ? "No charge for this request." : "Billed in full once you approve."} Payments are non-refundable once work has begun.</li>
        <li>Includes a short walkthrough video and one round of revisions.</li>
        <li>Anything not listed is quoted separately.</li>
        <li>To approve, reply "Approved" to the quote email.</li>
      </ul>`;
    if (!$("emailPanel").hidden) $("emailText").textContent = buildEmail(s);
  }

  function buildEmail(s) {
    const items = s.lines.map((l) => `• ${l.name}${l.qty > 1 ? ` (×${l.qty})` : ""}: ${l.what || "[what it does]"}: ${l.waived ? `$0 (waived, normally ${money(l.amount)})` : money(l.amount)}`).join("\n");
    const totalLine = s.allWaived
      ? `Total: $0. This work has been waived (list value ${money(s.list)}).`
      : `Total: ${money(s.total)}, billed in full once you approve.` + (s.someWaived ? ` This includes ${money(s.waivedValue)} in waived items.` : "");
    return `Subject: Your Lawmatics services quote: ${s.firm || "[Firm name]"}

Hi ${s.dmName ? s.dmName.split(" ")[0] : "[Name]"},

Here's the quote for the work you requested:

${items || "• [Item]: [what it does]: $[price]"}

${totalLine}

Your build will be delivered at least 14 days after payment, along with a short video showing how to use it. One round of revisions is included. Anything not listed above would be quoted separately. Payments are non-refundable once work has begun.

To approve, reply "Approved" to this email. This quote is valid for ${IS.config.quoteValidDays || 30} days (until ${fmtDate(validUntil())}).`;
  }

  function toast(msg) { const t = $("toast"); t.textContent = msg; clearTimeout(toast._t); if (msg) toast._t = setTimeout(() => (t.textContent = ""), 5000); }
  function toastErr(msg) { clearTimeout(toast._t); $("toast").innerHTML = `<span class="err">${esc(msg)}</span>`; }

  function validate(s) {
    const problems = [];
    const mark = (id, bad) => $(id).classList.toggle("invalid", bad);
    mark("firm", !s.firm); if (!s.firm) problems.push("firm name");
    const idOk = /^\d+$/.test(s.firmId); mark("firmId", !idOk); if (!idOk) problems.push("a numeric Firm ID");
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.dmEmail); mark("dmEmail", !emailOk); if (!emailOk) problems.push("the decision-maker's email");
    if (!s.lines.length) problems.push("at least one service");
    return problems;
  }

  function payload(s) {
    const summaries = {}, details = {};
    IS.config.catalog.forEach((c) => {
      if (!s.lines.some((l) => l.key === c.key)) return;
      summaries[c.key] = $("s_" + c.key).value.trim();
      details[c.key] = {};
      c.details.forEach((d) => {
        const el = $(`d_${c.key}_${d.id}`);
        details[c.key][d.id] = d.type === "check" ? el.checked : el.value.trim();
      });
    });
    return { firm: s.firm, firmId: s.firmId, dmName: s.dmName, dmEmail: s.dmEmail, csmEmail: s.csmEmail,
      practiceArea: s.pa, notes: s.notes, needBy: s.needBy, files: s.files,
      lines: s.lines.map((l) => ({ id: l.id, qty: l.qty, waived: l.waived })), summaries, details };
  }

  function resetForm() {
    $("qform").reset();
    picked = null; $("firmId").readOnly = false; setStatus(""); closeList();
    pending = []; renderPending();
    document.querySelectorAll("#qform .invalid").forEach((el) => el.classList.remove("invalid"));
    $("success").hidden = true; $("emailPanel").hidden = true; toast("");
    buildCsms(); render();
    window.scrollTo({ top: 0 });
  }

  Q.wire = function () {
    wireFirm();
    wirePending();
    $("catalog").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-step]");
      if (!b) return;
      const inp = $("q_" + b.dataset.id);
      inp.value = Math.max(0, (parseInt(inp.value, 10) || 0) + parseInt(b.dataset.step, 10));
      render();
    });
    $("qform").addEventListener("input", (e) => {
      if (e.target.id === "waived") {
        IS.config.catalog.forEach((c) => c.items.forEach((it) => {
          if ((parseInt($("q_" + it.id).value, 10) || 0) > 0) $("w_" + it.id).checked = e.target.checked;
        }));
      }
      render();
    });
    $("hideEmail").addEventListener("click", () => { $("emailPanel").hidden = true; });

    $("copyBtn").addEventListener("click", () => {
      const text = buildEmail(readState());
      $("emailPanel").hidden = false; $("emailText").textContent = text;
      const fallback = () => {
        const r = document.createRange(); r.selectNodeContents($("emailText"));
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        toast("Couldn't copy automatically. The email text is selected below; press Ctrl/⌘ + C.");
      };
      try { navigator.clipboard.writeText(text).then(() => toast("Quote email copied. Paste it into your email and cc the CSM."), fallback); }
      catch (e) { fallback(); }
    });

    $("qform").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      const s = readState();
      const problems = validate(s);
      if (problems.length) { toastErr("Add " + problems.join(", ") + " before creating the card."); return; }
      if (pending.some((f) => f.size > IS.MAX_FILE_BYTES)) { toastErr("Remove the files over 25 MB (attach those in Asana directly)."); return; }
      busy = true; $("createBtn").disabled = true; toast("Creating the Asana card…");
      try {
        const res = await IS.api("createRequest", { request: payload(s) });
        toast("");
        $("success").hidden = false;
        $("success").innerHTML = `<strong>Card created in Quote Sent.</strong>
          <span>${esc(res.task.name)} · ${esc(res.quoteId)}</span>
          ${res.task.url && res.task.url !== "#" ? `<a href="${esc(res.task.url)}" target="_blank" rel="noopener">Open in Asana ↗</a>` : "<span>(Test mode: nothing was written to Asana.)</span>"}
          <span><button class="linkbtn" type="button" id="viewOnBoard">See it on the Builds board</button> · <button class="linkbtn" type="button" id="newQuote">Start a new quote</button></span>`;
        $("newQuote").addEventListener("click", resetForm);
        $("viewOnBoard").addEventListener("click", () => { resetForm(); IS.showTab("builds"); IS.board.load(true); });
        if (pending.length) {
          const files = pending.slice();
          const line = document.createElement("span");
          $("success").insertBefore(line, $("success").lastElementChild);
          let done = 0; const failed = [];
          line.textContent = `Attaching ${files.length} file${files.length === 1 ? "" : "s"}…`;
          await IS.uploadFiles(res.task.gid, files, (f, ok, err) => {
            if (ok) done++; else failed.push(f.name + " (" + err.message + ")");
            line.textContent = `Attached ${done} of ${files.length} file${files.length === 1 ? "" : "s"}…`;
          });
          line.innerHTML = `${done} file${done === 1 ? "" : "s"} attached.` +
            (failed.length ? ` <span class="err">Not attached: ${esc(failed.join(", "))}. Add them from the card on the Builds board.</span>` : "");
          pending = []; renderPending();
        }
        IS.board.markStale();
      } catch (err) {
        toastErr("The card wasn't created: " + err.message);
      } finally {
        busy = false; $("createBtn").disabled = false;
      }
    });
  };
})();
