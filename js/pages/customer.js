/**
 * Bijli Wala SIMS — Customer Experience ("My Solar")
 * Four dedicated customer views sharing one data layer:
 *   My Solar Home · Site Surveys · My Quotations · Installation & Warranty
 * Each page registers its own controller keyed by <body data-page>.
 */
window.BW = window.BW || {};
window.BW.controllers = window.BW.controllers || {};

(() => {
  "use strict";

  const el = (...a) => BW.ui.el(...a);
  const inr = (n) => BW.utils.formatINR(n);
  const PROJECT_STAGES = [
    "Planning",
    "Site assessment",
    "Design approval",
    "Procurement",
    "Installation",
    "Commissioning",
  ];

  /* ---------- Data scoped strictly to the signed-in customer ---------- */
  // Records carrying a customerEmail match on email only. Older records with no
  // email fall back to an exact name match (never a partial one), so one
  // customer can never see another customer's records.
  function mine(user) {
    const email = String(user.email || "").toLowerCase();
    const names = [user.name, `${user.name} Residence`];
    const owns = (row, nameKey) =>
      row.customerEmail
        ? String(row.customerEmail).toLowerCase() === email
        : names.includes(row[nameKey]);
    const newestFirst = (rows) =>
      rows.sort(
        (a, b) =>
          String(b.created || "").localeCompare(String(a.created || "")) ||
          String(b.id).localeCompare(String(a.id), undefined, { numeric: true }),
      );
    return {
      surveys: newestFirst(BW.store.get("Surveys").filter((r) => owns(r, "Customer"))),
      quotes: newestFirst(BW.store.get("Quotations").filter((r) => owns(r, "Customer"))),
      projects: newestFirst(BW.store.get("Projects").filter((r) => owns(r, "Project name"))),
      warranties: newestFirst(BW.store.get("Warranty").filter((r) => owns(r, "Customer"))),
    };
  }

  /* ---------- Journey: derived from the customer's LATEST live records ---------- */
  // Each step is done / active / rejected / warn / todo. Steps are sequential:
  // the first step that is not done stops the journey, so a rejected latest
  // survey always wins over older seeded installation data.
  function journey(d) {
    const survey = d.surveys[0];
    const quote = d.quotes[0];
    const project = d.projects[0];
    const QUOTE_BLOCKED = {
      Rejected: "Quotation Rejected",
      "Revision Required": "Quotation Under Revision",
      "On Hold": "Quotation On Hold",
      Cancelled: "Quotation Cancelled",
    };
    const steps = [];
    let blocked = false;
    const next = (label, done, pending) => {
      if (blocked) return steps.push({ label, state: "todo", hint: "Upcoming" });
      if (done) return steps.push({ label, state: "done", hint: "Completed" });
      blocked = true;
      steps.push({ label: pending.label || label, state: pending.state || "active", hint: pending.hint });
    };

    next("Site Survey", !!survey, { hint: "Pending submission" });
    next(
      "Survey Approved",
      survey?.status === "Approved",
      survey?.status === "Rejected"
        ? { label: "Survey Rejected", state: "rejected", hint: "Action needed" }
        : { label: "Survey Review", hint: "Engineer review in progress" },
    );
    next(
      "Quotation Ready",
      ["Sent", "Accepted"].includes(quote?.status),
      QUOTE_BLOCKED[quote?.status]
        ? {
            label: QUOTE_BLOCKED[quote.status],
            state: quote.status === "Cancelled" ? "rejected" : "warn",
            hint: quote.holdReason || "Our team is revising it",
          }
        : { hint: "Being prepared" },
    );
    next(
      "Installation",
      quote?.status === "Accepted" && !!project && (project.status === "Completed" || project.stage === "Commissioning"),
      quote?.status === "Sent"
        ? { label: "Accept Quotation", hint: "Waiting for your acceptance" }
        : project?.status === "On hold"
          ? { label: "Installation On Hold", state: "warn", hint: project.holdReason || "Paused by our team" }
          : { hint: project ? project.stage : "Scheduling crew" },
    );
    next("Live & Active", project?.status === "Completed", { hint: "Commissioning" });

    const idx = steps.findIndex((st) => st.state !== "done");
    const step = steps[idx];
    const stage =
      idx === -1
        ? { label: "Live & Active", tone: "green", detail: "Your system is generating power." }
        : !survey
          ? { label: "Awaiting Survey", tone: "blue", detail: "Request a site survey to begin." }
          : {
              label: step.label,
              tone: { rejected: "red", warn: "amber" }[step.state] || "teal",
              detail:
                step.state === "rejected"
                  ? `Reason: ${idx === 1 ? survey.rejectionReason || "See engineer notes." : step.hint}`
                  : step.state === "warn"
                    ? step.hint
                    : project && idx >= 3
                      ? `Project ${project.id} · ${project.stage}`
                      : step.hint,
            };
    return { steps, current: idx === -1 ? steps.length : idx, stage, survey, quote, project };
  }

  function rejectionBanner(survey) {
    const box = el("div", "cx-alert");
    box.setAttribute("role", "alert");
    const text = el("div");
    text.append(
      el("strong", "", `Survey ${survey.id} was not approved`),
      el("p", "", `Reason from our engineer: ${survey.rejectionReason || "No reason recorded."}`),
      el("small", "", "Fix the details and resubmit. A new survey will be scheduled."),
    );
    box.append(
      BW.ui.icon("alert-triangle", 22),
      text,
      BW.ui.button(
        "Resubmit Site Survey",
        () => (location.href = `customer-surveys.html#resubmit=${survey.id}`),
        "primary-btn",
        "clipboard-list",
      ),
    );
    return box;
  }

  function stepper(steps) {
    const ol = el("ol", "journey-stepper");
    const doneCount = steps.filter((s) => s.state === "done").length;
    ol.style.setProperty("--journey-progress", `${(Math.min(doneCount, steps.length - 1) / (steps.length - 1)) * 100}%`);
    ol.setAttribute("aria-label", "Solar installation journey");
    steps.forEach((s, i) => {
      const li = el("li", `journey-step is-${s.state}`);
      if (s.state === "active") li.setAttribute("aria-current", "step");
      const node = el("span", "journey-node");
      if (s.state === "done") node.append(BW.ui.icon("check", 16));
      else if (s.state === "rejected") node.append(BW.ui.icon("x", 16));
      else if (s.state === "warn") node.append(BW.ui.icon("alert-triangle", 16));
      else node.append(el("span", "", String(i + 1)));
      const text = el("span", "journey-text");
      text.append(el("strong", "", `${i + 1}. ${s.label}`), el("small", "", s.hint));
      li.append(node, text);
      ol.append(li);
    });
    return ol;
  }

  function page(title, subtitle, action) {
    const root = document.querySelector("#page-content");
    root.replaceChildren();
    root.classList.add("customer-page");
    root.append(BW.ui.heading(title, subtitle, action || null));
    return root;
  }

  function panel(title, meta) {
    const section = el("section", "panel cx-panel");
    const head = el("div", "panel-heading");
    head.append(el("h2", "", title));
    if (meta) head.append(meta instanceof Node ? meta : el("span", "muted", meta));
    section.append(head);
    return section;
  }

  function summaryCard(label, value, detail, glyph, tone, badge) {
    const card = el("article", `cx-card${badge ? ` is-${badge}` : ""}`);
    const top = el("div", "cx-card-top");
    const tile = el("span", `icon-tile ${tone}`);
    tile.append(BW.ui.icon(glyph));
    top.append(el("span", "", label), tile);
    const valueEl = el("strong", "cx-card-value");
    if (badge) valueEl.append(el("span", `badge ${badge}`, value));
    else valueEl.textContent = value;
    card.append(top, valueEl, el("p", "", detail));
    return card;
  }

  /* ======================= 1. My Solar Home ======================= */
  function renderHome() {
    const user = BW.auth.current();
    const d = mine(user);
    const j = journey(d);
    const { steps, current } = j;
    const rejected = j.survey?.status === "Rejected";
    const root = page(
      `Welcome back, ${user.name}`,
      "Here's where your rooftop solar system stands today.",
      BW.ui.button(
        rejected ? "Resubmit Site Survey" : "Request Site Survey",
        () =>
          (location.href = rejected
            ? `customer-surveys.html#resubmit=${j.survey.id}`
            : "customer-surveys.html#new"),
        "primary-btn",
        "plus",
      ),
    );
    if (rejected) root.append(rejectionBanner(j.survey));

    const track = panel("Your solar journey", current >= 5 ? "All steps complete" : `Step ${current + 1} of 5`);
    track.append(stepper(steps));

    const { project, quote } = j;
    const kw = project?.["Capacity (kW)"] ?? quote?.["Capacity (kW)"];
    const type = project?.["System type"] || quote?.["System type"] || "On-Grid";
    const subsidy = quote ? quoteLines(quote).subsidy : 0;
    // ~1,400 kWh per kW per year in India at about ₹8 per unit.
    const yearlySavings = kw ? Math.round(kw * 1400 * 8) : 0;

    const cards = el("div", "cx-cards");
    cards.append(
      summaryCard("System size", kw ? `${kw} kW ${type}` : "To be sized", kw ? "Rooftop solar system" : "Sized after your site survey", "zap", "amber"),
      summaryCard(
        "Current stage",
        j.stage.label,
        j.stage.detail,
        "activity",
        "teal",
        ["red", "amber"].includes(j.stage.tone) ? j.stage.tone : null,
      ),
      summaryCard(
        "Subsidy & savings",
        subsidy ? `${inr(subsidy)} subsidy` : kw ? "Not eligible" : "—",
        yearlySavings ? `Estimated ${inr(yearlySavings)} saved per year on bills` : "Estimated once your system is sized",
        "shield-check",
        "green",
      ),
    );

    const next = el("div", "cx-next");
    const nextLinks = [
      ["Site Surveys", "customer-surveys.html", "clipboard-list", `${d.surveys.length} submitted`],
      ["My Quotations", "customer-quotations.html", "file-text", `${d.quotes.length} proposal${d.quotes.length === 1 ? "" : "s"}`],
      ["Installation & Warranty", "customer-warranty.html", "shield-check", `${d.warranties.length} warranties active`],
    ];
    for (const [label, href, glyph, meta] of nextLinks) {
      const a = el("a", "cx-link");
      a.href = href;
      a.append(BW.ui.icon(glyph), el("span", "", label), el("small", "", meta), BW.ui.icon("chevron-right", 16));
      next.append(a);
    }
    root.append(track, cards, next);
  }

  /* ======================= 2. Site Surveys ======================= */
  function renderSurveys() {
    const user = BW.auth.current();
    const d = mine(user);
    const root = page("Site Surveys", "Request a rooftop assessment and follow its status.");
    const latest = d.surveys[0];
    const resubmitId = (location.hash.match(/^#resubmit=(.+)$/) || [])[1];
    const source =
      d.surveys.find((x) => x.id === resubmitId && x.status === "Rejected") ||
      (latest?.status === "Rejected" ? latest : null);
    if (latest?.status === "Rejected") root.append(rejectionBanner(latest));

    const formPanel = panel(source ? `Resubmit site survey (replaces ${source.id})` : "Request a new site survey");
    formPanel.id = "new";
    const form = el("form", "cx-form");
    form.noValidate = true;
    const grid = el("div", "form-grid");
    const alertEl = el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;
    const f = (o) => BW.ui.field(grid, { required: true, ...o });
    const roofTotal = f({ name: "roofTotal", label: "Total roof space (sq ft)", type: "number", min: 50, step: 1, placeholder: "e.g. 600" });
    const roofUsable = f({ name: "roofUsable", label: "Usable sunlit area (sq ft)", type: "number", min: 30, step: 1, placeholder: "e.g. 400", hint: "About 100 sq ft is needed per kW" });
    const direction = f({ name: "Roof Direction", label: "Roof direction", options: BW.catalog.lists.roofDirections, value: "South" });
    const roofType = f({ name: "Roof type", label: "Roof type", options: BW.catalog.lists.roofTypes, value: "RCC terrace" });
    const bill = f({ name: "bill", label: "Average monthly bill (₹)", type: "number", min: 100, step: 50, placeholder: "e.g. 3500" });
    const city = f({ name: "City", label: "City", options: BW.catalog.lists.cities, value: user.city || "Pune" });
    const phone = f({ name: "Phone", label: "Mobile number", type: "tel", value: user.phone || "", placeholder: "10-digit mobile" });
    const date = f({ name: "Survey date", label: "Preferred survey date", type: "date", value: BW.utils.getTodayISO() });
    const notes = f({ name: "Notes", label: "Address & access notes", type: "textarea", required: false, placeholder: "Floor, terrace access, nearby shade (trees, water tank)…" });
    notes.closest("label").classList.add("span-2");
    const checkDate = BW.utils.guardFutureDate(date, alertEl, "Survey date");
    if (source) {
      // Pre-fill from the rejected survey so the customer only fixes what's wrong.
      const pre = {
        roofTotal: source["Total roof space (sq ft)"],
        roofUsable: source["Usable sunlit area (sq ft)"],
        "Roof Direction": source["Roof Direction"],
        "Roof type": source["Roof type"],
        bill: source["Monthly Bill (₹)"],
        City: source.City,
        Phone: source.Phone || user.phone,
        Notes: source.Notes,
      };
      for (const [name, val] of Object.entries(pre))
        if (val != null && val !== "") grid.querySelector(`[name="${name}"]`).value = val;
    }

    const submit = BW.ui.button("Submit survey request", null, "primary-btn", "clipboard-list");
    submit.type = "submit";
    const actions = el("div", "modal-actions");
    actions.append(submit);
    form.append(grid, alertEl, actions);
    formPanel.append(form);

    const fail = (msg, input) => {
      alertEl.textContent = msg;
      alertEl.hidden = false;
      input?.classList.add("field-invalid");
      input?.focus();
    };
    form.oninput = (e) => e.target.classList?.remove("field-invalid");
    form.onsubmit = (e) => {
      e.preventDefault();
      alertEl.hidden = true;
      const total = Number(roofTotal.value);
      const usable = Number(roofUsable.value);
      if (!roofTotal.value || total < 50) return fail("Enter your total roof space (at least 50 sq ft).", roofTotal);
      if (!roofUsable.value || usable < 30) return fail("Enter the usable sunlit area (at least 30 sq ft).", roofUsable);
      if (usable > total) return fail("Usable sunlit area cannot be larger than the total roof space.", roofUsable);
      if (!bill.value || Number(bill.value) < 100) return fail("Enter your average monthly bill (at least ₹100).", bill);
      if (!BW.utils.phoneOk(phone.value)) return fail("Enter a 10-digit Indian mobile number starting with 6–9.", phone);
      if (checkDate()) return date.focus();
      try {
        const saved = BW.store.save("Surveys", {
          Customer: user.name,
          customerEmail: user.email,
          City: city.value,
          Phone: phone.value.trim(),
          "Roof type": roofType.value,
          "Roof Direction": direction.value,
          "Total roof space (sq ft)": total,
          "Usable sunlit area (sq ft)": usable,
          // ~100 sq ft per kW, capped at the 1–5 kW residential range.
          "Capacity (kW)": Math.max(1, Math.min(5, Math.floor(usable / 100))),
          "Monthly Bill (₹)": Number(bill.value),
          "Survey date": date.value,
          Notes: notes.value.trim(),
          status: "Scheduled",
          ...(source ? { resubmittedFrom: source.id } : {}),
          Surveyor: "Sneha Rao",
          "Grid suitability": "Suitable",
          "Tilt (0–90°)": 22,
          "Cable Distance (m)": 15,
        });
        const received = "We’ve received your survey. After review, we’ll send your quotation to your registered email address.";
        BW.ui.toast(received);
        history.replaceState(null, "", location.pathname);
        renderSurveys();
        // Keep the confirmation visible after the toast fades.
        const ok = el("div", "cx-success");
        ok.setAttribute("role", "status");
        ok.append(BW.ui.icon("circle-check", 20), el("p", "", `${received} (Reference: ${saved.id}, survey on ${BW.utils.formatDate(saved["Survey date"])})`));
        document.querySelector("#page-content .page-heading")?.after(ok);
      } catch (err) {
        fail(err.message);
      }
    };

    const list = panel("Your surveys", `${d.surveys.length} on record`);
    if (!d.surveys.length) list.append(el("p", "empty", "No surveys yet. Submit the form above to book your rooftop assessment."));
    const grid2 = el("div", "cx-survey-grid");
    for (const s of d.surveys) {
      const card = el("article", "cx-survey");
      const top = el("div", "cx-survey-top");
      top.append(el("strong", "", s.id), BW.ui.statusPill(s.status));
      const meta = el("dl", "cx-meta");
      for (const [k, v] of [
        ["Date", BW.utils.formatDate(s["Survey date"])],
        ["City", s.City],
        ["Roof", `${s["Roof type"]} · ${s["Roof Direction"] || "—"}`],
        ["Surveyor", s.Surveyor || "To be assigned"],
      ]) {
        const row = el("div");
        row.append(el("dt", "", k), el("dd", "", v));
        meta.append(row);
      }
      const note =
        s.status === "Approved"
          ? "Your roof is approved. A quotation is on its way."
          : s.status === "Rejected"
            ? `Not feasible: ${s.rejectionReason || "see engineer notes"}`
            : "Our engineer will visit on the scheduled date.";
      card.append(top, meta, el("p", `cx-survey-note ${s.status === "Rejected" ? "is-bad" : ""}`, note));
      grid2.append(card);
    }
    list.append(grid2);
    root.append(formPanel, list);
    if (location.hash === "#new" || source)
      requestAnimationFrame(() => {
        formPanel.scrollIntoView({ block: "start" });
        roofTotal.focus();
      });
  }

  /* ======================= 3. My Quotations ======================= */
  function acceptQuote(quote) {
    const t = quoteLines(quote);
    if (!confirm(`Accept ${quote.id} for a ${quote["Capacity (kW)"]} kW system at a net ${inr(t.net)}? This starts your installation project.`)) return;
    try {
      BW.store.save("Quotations", { ...quote, status: "Accepted" });
      if (!BW.store.get("Projects").some((p) => p.sourceQuotationId === quote.id)) {
        BW.store.save("Projects", {
          "Project name": `${quote.Customer} Residence`,
          customerEmail: quote.customerEmail,
          City: quote.City,
          "Capacity (kW)": quote["Capacity (kW)"],
          "Lead engineer": "Priya Shah",
          "Crew lead": "Vikram Singh (Crew Alpha)",
          "System type": quote["System type"] || "On-Grid",
          "Subsidy scheme": quote["Subsidy scheme"] || "PM Surya Ghar Subsidy",
          stage: "Planning",
          status: "Planning",
          revenue: quote["Amount (₹)"],
          sourceQuotationId: quote.id,
        });
      }
      BW.ui.toast("Quotation accepted. Your installation project has been created.");
      renderQuotations();
    } catch (err) {
      BW.ui.toast(err.message, "error");
    }
  }

  // Gross = Equipment + Installation + GST and Net = Gross − Subsidy, always
  // computed from the line items, never subtracted from a stored gross.
  function quoteLines(q) {
    const kit = q.kit || {};
    const calc = BW.catalog.calculateKit({
      capacityKw: q["Capacity (kW)"],
      systemType: q["System type"],
      subsidyScheme: q["Subsidy scheme"],
      ...kit,
    });
    const t = q.totals || {};
    const rate = kit.installRatePerKw || kit.installRate || 4500;
    const equipment = calc.bomLines.reduce((sum, l) => sum + l.total, 0);
    const install = Number(q["Capacity (kW)"]) * rate;
    const gstRate = t.gstRate ?? null;
    const taxes = gstRate != null
      ? Math.round(((equipment + install) * gstRate) / 100)
      : Math.round(calc.totalGst);
    const gross = equipment + install + taxes;
    const subsidy = BW.catalog.subsidyFor(q["Capacity (kW)"], q["Subsidy scheme"], q["System type"]);
    return {
      lines: calc.bomLines,
      rate,
      equipment,
      install,
      taxes,
      gstLabel: gstRate != null ? `GST (${gstRate}% composite)` : "GST (12% composite)",
      gross,
      subsidy,
      net: Math.max(0, gross - subsidy),
    };
  }

  function downloadSummary(q, s) {
    const rows = s.lines
      .map((l) => `<tr><td>${BW.utils.escapeHTML(l.slot)}</td><td>${BW.utils.escapeHTML(l.name)}</td><td>${l.qty}</td><td>${inr(l.total)}</td><td>${BW.utils.escapeHTML(l.warranty)}</td></tr>`)
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${q.id} · Quote summary</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:720px;margin:32px auto;color:#14202f}h1{margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{text-align:left;padding:6px;border-bottom:1px solid #ddd}.t{display:flex;justify-content:space-between}.net{font-weight:700;font-size:18px}</style></head><body>
<h1>Bijli Wala · Solar quotation ${q.id}</h1>
<p>${BW.utils.escapeHTML(q.Customer)} · ${BW.utils.escapeHTML(q.City)} · ${q["Capacity (kW)"]} kW ${BW.utils.escapeHTML(q["System type"] || "On-Grid")} · Status: ${q.status}</p>
<table><tr><th>Item</th><th>Model</th><th>Qty</th><th>Amount</th><th>Warranty</th></tr>${rows}
<tr><td>Installation</td><td>${q["Capacity (kW)"]} kW × ${inr(s.rate)}/kW</td><td>1</td><td>${inr(s.install)}</td><td>Workmanship</td></tr></table>
<div class="t"><span>Equipment</span><span>${inr(s.equipment)}</span></div>
<div class="t"><span>Installation</span><span>${inr(s.install)}</span></div>
<div class="t"><span>${BW.utils.escapeHTML(s.gstLabel)}</span><span>${inr(s.taxes)}</span></div>
<div class="t"><span>Gross total</span><span>${inr(s.gross)}</span></div>
<div class="t"><span>PM Surya Ghar subsidy</span><span>− ${inr(s.subsidy)}</span></div>
<div class="t net"><span>Net payable</span><span>${inr(s.net)}</span></div>
<p><small>Generated ${new Date().toLocaleString("en-IN")}. Subsidy is credited to your bank account after commissioning.</small></p>
</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${q.id}-quote-summary.html` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderQuotations() {
    const user = BW.auth.current();
    const d = mine(user);
    const root = page("My Quotations", "Your solar proposals, itemised with subsidy and net cost.");
    if (!d.quotes.length) {
      const p = panel("No quotation yet");
      p.append(el("p", "empty", "Once your site survey is approved, your engineer prepares a proposal and it appears here."));
      root.append(p);
      return;
    }
    for (const q of d.quotes) {
      const s = quoteLines(q);
      const card = el("article", "panel cx-quote");
      const head = el("div", "cx-quote-head");
      const title = el("div");
      title.append(
        el("small", "cx-eyebrow", `${q.id} · ${q["System type"] || "On-Grid"} · ${q.City}`),
        el("h2", "", `${q["Capacity (kW)"]} kW Rooftop Solar System`),
      );
      head.append(title, BW.ui.statusPill(q.status));

      const body = el("div", "cx-quote-body");
      const items = el("ul", "cx-items");
      for (const l of s.lines) {
        const li = el("li");
        const left = el("div");
        left.append(el("small", "", l.slot), el("strong", "", `${l.qty} × ${l.name}`), el("span", "", `Warranty ${l.warranty}`));
        li.append(left, el("b", "", inr(l.total)));
        items.append(li);
      }
      const inst = el("li");
      const instLeft = el("div");
      instLeft.append(el("small", "", "Installation"), el("strong", "", `${q["Capacity (kW)"]} kW × ${inr(s.rate)}/kW`), el("span", "", "Wiring, mounting and commissioning"));
      inst.append(instLeft, el("b", "", inr(s.install)));
      items.append(inst);

      const sum = el("dl", "cx-sum");
      const row = (k, v, cls = "") => {
        const r = el("div", cls);
        r.append(el("dt", "", k), el("dd", "", v));
        sum.append(r);
      };
      row("Equipment", inr(s.equipment));
      row("Installation", inr(s.install));
      row(s.gstLabel, inr(s.taxes));
      row("Gross total", inr(s.gross), "is-gross");
      row(s.subsidy ? "PM Surya Ghar subsidy" : "Subsidy", `− ${inr(s.subsidy)}`, "is-subsidy");
      row("Net payable", inr(s.net), "is-net");
      const side = el("div", "cx-quote-side");
      side.append(sum);
      if (s.subsidy) side.append(el("p", "cx-fine", "The subsidy is credited to your bank account by the government after commissioning."));

      const actions = el("div", "cx-quote-actions");
      if (q.status === "Accepted") {
        const tag = el("span", "accepted-badge");
        tag.append(BW.ui.icon("check"), " Accepted · installation underway");
        actions.append(tag);
      } else if (q.status === "Sent") {
        actions.append(BW.ui.button("Accept Quotation", () => acceptQuote(q), "primary-btn", "check"));
      } else {
        actions.append(
          el(
            "p",
            "cx-fine",
            q.holdReason
              ? `${q.status}: ${q.holdReason}`
              : q.status === "Draft"
                ? "Draft: your engineer is still finalising this proposal."
                : `${q.status}: our team is revising this proposal.`,
          ),
        );
      }
      actions.append(BW.ui.button("Download Quote Summary", () => downloadSummary(q, s), "secondary-btn", "file-text"));
      side.append(actions);

      body.append(items, side);
      card.append(head, body);
      root.append(card);
    }
  }

  /* ================== 4. Installation & Warranty ================== */
  function claimModal(w) {
    const { dialog, body } = BW.ui.modal(`Raise a service claim · ${w["Serial number"]}`, "spotlight");
    const form = el("form");
    form.noValidate = true;
    const grid = el("div", "form-grid");
    const alertEl = el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;
    const issue = BW.ui.field(grid, { name: "issue", label: "What's wrong?", type: "textarea", required: true, placeholder: "Error code, drop in generation, inverter lights…" });
    issue.closest("label").classList.add("span-2");
    const covered = w.status !== "Closed" && String(w["Expiry date"] || "") >= BW.utils.getTodayISO();
    const submit = BW.ui.button("Submit claim", null, "primary-btn", "wrench");
    submit.type = "submit";
    const actions = el("div", "modal-actions");
    actions.append(BW.ui.button("Cancel", () => dialog.close()), submit);
    form.append(
      el("p", "form-caption", `${w.Component} · ${covered ? "Under warranty: service is free" : "Warranty expired: service is billable"}`),
      grid,
      alertEl,
      actions,
    );
    body.append(form);
    form.onsubmit = (e) => {
      e.preventDefault();
      if (issue.value.trim().length < 5) {
        alertEl.textContent = "Describe the issue in a few words.";
        alertEl.hidden = false;
        issue.classList.add("field-invalid");
        return;
      }
      const tickets = w.tickets || [];
      BW.store.save("Warranty", {
        ...w,
        status: "Claim open",
        tickets: [{ id: `${w.id}-T${tickets.length + 1}`, opened: BW.utils.getTodayISO(), parts: 0, labour: 0, note: issue.value.trim() }, ...tickets],
        history: [{ date: BW.utils.getTodayISO(), title: "Service claim submitted by customer", detail: issue.value.trim() }, ...(w.history || [])],
      });
      dialog.close();
      BW.ui.toast("Claim submitted. A technician will contact you.");
      renderWarranty();
    };
  }

  function renderWarranty() {
    const user = BW.auth.current();
    const d = mine(user);
    const root = page("Installation & Warranty", "Track your installation and keep your equipment covered.");
    const project = d.projects[0];

    const timeline = panel("Installation milestones", project ? `${project.id} · ${project.status}` : "");
    if (!project) {
      timeline.append(el("p", "empty", "Your installation timeline starts once you accept a quotation."));
    } else {
      const idx = project.status === "Completed" ? PROJECT_STAGES.length : PROJECT_STAGES.indexOf(project.stage);
      const ol = el("ol", "cx-timeline");
      PROJECT_STAGES.forEach((stage, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "todo";
        const li = el("li", `is-${state}`);
        const dot = el("span", "cx-dot");
        if (state === "done") dot.append(BW.ui.icon("check", 12));
        const txt = el("div");
        txt.append(el("strong", "", stage), el("small", "", state === "done" ? "Completed" : state === "active" ? "In progress now" : "Upcoming"));
        li.append(dot, txt);
        ol.append(li);
      });
      const crew = el("aside", "cx-crew");
      crew.append(el("h3", "", "Your installation team"));
      for (const [k, v, g] of [
        ["Crew lead", project["Crew lead"] || "To be assigned", "hard-hat"],
        ["Lead engineer", project["Lead engineer"] || "To be assigned", "user"],
        ["Site", `${project["Project name"]}, ${project.City}`, "sun"],
      ]) {
        const row = el("div", "cx-crew-row");
        const t = el("div");
        t.append(el("small", "", k), el("strong", "", v));
        row.append(BW.ui.icon(g), t);
        crew.append(row);
      }
      const wrap = el("div", "cx-install");
      wrap.append(ol, crew);
      timeline.append(wrap);
    }

    const cov = panel("Equipment warranties", `${d.warranties.length} registered`);
    if (!d.warranties.length) {
      cov.append(el("p", "empty", "Warranties are registered automatically when your equipment is installed."));
    } else {
      const grid = el("div", "cx-warranty-grid");
      const today = BW.utils.getTodayISO();
      for (const w of d.warranties) {
        const years = w.coverageYears || Math.max(1, Math.round((new Date(w["Expiry date"]) - new Date(w.coverageStart || today)) / 3.156e10));
        const kind = /inverter/i.test(w.Component) ? "Inverter" : /panel|module/i.test(w.Component) ? "Panel" : "Equipment";
        const start = new Date((w.coverageStart || today) + "T00:00:00");
        const end = new Date(w["Expiry date"] + "T23:59:59");
        const pct = Math.round(Math.min(1, Math.max(0, (Date.now() - start) / (end - start || 1))) * 100);
        const active = w.status !== "Closed" && w["Expiry date"] >= today;
        const card = el("article", `cx-warranty ${active ? "" : "is-expired"}`);
        const top = el("div", "cx-warranty-top");
        const shield = el("span", "icon-tile green");
        shield.append(BW.ui.icon("shield-check"));
        top.append(shield, BW.ui.statusPill(w.status));
        const bar = el("progress");
        bar.max = 100;
        bar.value = pct;
        bar.setAttribute("aria-label", `${pct}% of coverage period used`);
        card.append(
          top,
          el("h3", "", `${years}-Year ${kind} Warranty`),
          el("p", "cx-warranty-model", w.Component),
          el("p", "cx-serial", w["Serial number"]),
          bar,
          el("small", "", `${active ? "Covered until" : "Expired on"} ${BW.utils.formatDate(w["Expiry date"])}`),
        );
        if (w.status !== "Closed" && w.status !== "Claim open")
          card.append(BW.ui.button("Raise service claim", () => claimModal(w), "secondary-btn", "wrench"));
        else if (w.status === "Claim open") card.append(el("p", "cx-fine", "Claim open: a technician will contact you."));
        grid.append(card);
      }
      cov.append(grid);
    }
    root.append(timeline, cov);
  }

  Object.assign(BW.controllers, {
    "My Solar Home": { render: renderHome },
    "Site Surveys": { render: renderSurveys },
    "My Quotations": { render: renderQuotations },
    "Installation & Warranty": { render: renderWarranty },
  });
})();
