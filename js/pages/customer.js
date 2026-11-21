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

  /* Local demo quote math (used by the My Solar Home summary card). */
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

  /* ======================= 3. My Quotations (hosted API) ======================= */
  // Server data only: GET /v1/enquiries, /v1/enquiries/{id}, /v1/quotes/{id},
  // /v1/quotes/{id}/payment; POST decision / checkout / verify with Idempotency-Key.

  /** Paise (integer) -> "₹1,65,000" (keeps paise when not a whole rupee). */
  function paise(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const rupees = n / 100;
    return "₹" + rupees.toLocaleString("en-IN", {
      minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }
  const pick = (o, ...keys) => {
    for (const k of keys) {
      const v = k.split(".").reduce((x, part) => (x == null ? x : x[part]), o);
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  const human = (s) => String(s || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const quoteUrl = (enquiryId, quoteId) =>
    `customer-quotations.html?${new URLSearchParams({ ...(enquiryId ? { enquiry: enquiryId } : {}), ...(quoteId ? { quote: quoteId } : {}) })}`;

  function apiError(err) {
    if (err.status === 403 || err.status === 404) return null; // handled as access denied
    if (err.status === 503) return "The service is temporarily unavailable. Please try again shortly.";
    if (!err.status) return "Can't reach the server. Check your connection and try again.";
    return `Request failed (${err.status}${err.code ? " · " + err.code : ""}).`;
  }

  function deniedPanel(root, what) {
    const p = panel(`${what} not available`);
    const box = el("div", "cx-alert");
    box.setAttribute("role", "alert");
    const text = el("div");
    text.append(
      el("strong", "", "You don't have access to this record."),
      el("p", "", "It doesn't exist or belongs to another account. Taking you back to your own quotations…"),
    );
    box.append(BW.ui.icon("lock-keyhole", 22), text, BW.ui.button("Back to my quotations", () => location.replace("customer-quotations.html"), "primary-btn"));
    p.append(box);
    root.append(p);
    setTimeout(() => location.replace("customer-quotations.html"), 4000);
  }

  function errorPanel(root, message, retry) {
    const p = panel("Something went wrong");
    const box = el("div", "cx-alert");
    box.setAttribute("role", "alert");
    box.append(BW.ui.icon("alert-triangle", 22), el("p", "", message), BW.ui.button("Retry", retry, "primary-btn"));
    p.append(box);
    root.append(p);
  }

  async function listEnquiries() {
    const items = [];
    let after = 0;
    for (let page = 0; page < 10; page++) {
      const res = await BW.auth.request(`/v1/enquiries?after=${encodeURIComponent(after)}&limit=50`);
      items.push(...(res?.items || []));
      if (res?.next_after == null || res.next_after === after || !(res.items || []).length) break;
      after = res.next_after;
    }
    return items;
  }

  /** Quote references visible on an enquiry detail (customers see published ones). */
  function quoteRefs(detail) {
    const raw = pick(detail, "quotes", "quote_refs", "quote_references", "visible_quotes") || [];
    const refs = (Array.isArray(raw) ? raw : [raw]).map((q) =>
      typeof q === "string" ? { id: q } : { id: q.id || q.quote_id, state: q.state, revision: q.revision, total_paise: q.total_paise },
    );
    const single = pick(detail, "quote_id", "active_quote_id", "current_quote.id");
    if (single && !refs.some((r) => r.id === single)) refs.push({ id: single });
    return refs.filter((r) => r.id);
  }

  async function renderQuotations() {
    const root = page("My Quotations", "Your solar requests and the quotations issued for them.");
    const params = new URLSearchParams(location.search);
    const quoteId = params.get("quote");
    const enquiryId = params.get("enquiry");
    const loading = el("p", "muted", "Loading…");
    root.append(loading);
    try {
      if (quoteId) await showQuote(root, quoteId, enquiryId);
      else if (enquiryId) await showEnquiry(root, enquiryId);
      else await showEnquiryList(root);
    } catch (err) {
      const msg = apiError(err);
      if (msg === null) deniedPanel(root, quoteId ? "Quotation" : "Request");
      else errorPanel(root, msg, () => renderQuotations());
    } finally {
      loading.remove();
    }
  }

  async function showEnquiryList(root) {
    const items = await listEnquiries();
    const p = panel("Your requests", `${items.length} on record`);
    if (!items.length) {
      p.append(el("p", "empty", "No requests yet. Once you submit a site request it appears here with its quotation."));
    } else {
      const grid = el("div", "cx-survey-grid");
      for (const e of items) {
        const card = el("article", "cx-survey");
        const top = el("div", "cx-survey-top");
        top.append(el("strong", "", e.reference || e.id), BW.ui.statusPill(human(e.state)));
        const meta = el("dl", "cx-meta");
        for (const [k, v] of [
          ["Site", e.site],
          ["Submitted", e.created_at ? BW.utils.formatDate(e.created_at) : null],
          ["Revision", e.revision],
        ]) {
          if (v == null || v === "") continue;
          const r = el("div");
          r.append(el("dt", "", k), el("dd", "", String(v)));
          meta.append(r);
        }
        card.append(top, meta, BW.ui.button("Open request", () => (location.href = quoteUrl(e.id)), "secondary-btn", "file-text"));
        grid.append(card);
      }
      p.append(grid);
    }
    root.append(p);
  }

  async function showEnquiry(root, enquiryId) {
    const d = await BW.auth.request(`/v1/enquiries/${encodeURIComponent(enquiryId)}`);
    const refs = quoteRefs(d);
    // A single issued quote: go straight to it.
    if (refs.length === 1) {
      history.replaceState(null, "", quoteUrl(enquiryId, refs[0].id));
      return showQuote(root, refs[0].id, enquiryId, d);
    }
    const p = panel(`Request ${d.reference || d.id}`, BW.ui.statusPill(human(d.state)));
    p.append(BW.ui.button("← All requests", () => (location.href = "customer-quotations.html"), "secondary-btn"));
    if (!refs.length) p.append(el("p", "empty", "No quotation has been issued for this request yet."));
    for (const r of refs) {
      p.append(BW.ui.button(`View quotation ${r.revision != null ? "rev " + r.revision : r.id.slice(0, 8)}${r.state ? " · " + human(r.state) : ""}`, () => (location.href = quoteUrl(enquiryId, r.id)), "primary-btn", "file-text"));
    }
    root.append(p);
    renderHistory(root, d);
  }

  function renderHistory(root, d) {
    const hist = pick(d, "history", "events") || [];
    if (!Array.isArray(hist) || !hist.length) return;
    const p = panel("Request history");
    const ol = el("ol", "cx-timeline");
    for (const h of hist) {
      const li = el("li", "is-done");
      const dot = el("span", "cx-dot");
      dot.append(BW.ui.icon("check", 12));
      const t = el("div");
      t.append(
        el("strong", "", human(h.state || h.event || h.type || h.action || "Update")),
        el("small", "", [h.at || h.created_at ? BW.utils.formatDate(h.at || h.created_at) : "", h.reason || h.note || ""].filter(Boolean).join(" · ")),
      );
      li.append(dot, t);
      ol.append(li);
    }
    p.append(ol);
    root.append(p);
  }

  function quoteLineItems(q) {
    const raw = pick(q, "lines", "items", "line_items", "snapshot.lines", "snapshot.items") || [];
    return (Array.isArray(raw) ? raw : []).map((l) => {
      const qty = Number(pick(l, "quantity", "qty") ?? 1);
      const unit = pick(l, "unit_price_paise", "unit_paise", "price_paise");
      const total = pick(l, "line_total_paise", "total_paise", "amount_paise") ?? (unit != null ? unit * qty : undefined);
      return { name: pick(l, "name", "item_name", "description", "item_id") || "Item", qty, unit, total };
    });
  }

  async function showQuote(root, quoteId, enquiryId, enquiryDetail) {
    const q = await BW.auth.request(`/v1/quotes/${encodeURIComponent(quoteId)}`);
    if (!enquiryDetail && q.enquiry_id) {
      // Direct quote link: fetch the request only for its reference (e.g. ENQ-25).
      enquiryDetail = await BW.auth.request(`/v1/enquiries/${encodeURIComponent(q.enquiry_id)}`).catch(() => null);
    }
    const card = el("article", "panel cx-quote");
    const head = el("div", "cx-quote-head");
    const title = el("div");
    const ref = (enquiryDetail && enquiryDetail.reference) || pick(q, "enquiry_reference", "reference");
    title.append(
      el("small", "cx-eyebrow", [ref, `Quote ${String(q.id || quoteId).slice(0, 8)}`, q.revision != null ? `rev ${q.revision}` : null].filter(Boolean).join(" · ")),
      el("h2", "", "Solar installation quotation"),
    );
    head.append(title, BW.ui.statusPill(human(q.state)));

    const body = el("div", "cx-quote-body");
    const items = el("ul", "cx-items");
    for (const l of quoteLineItems(q)) {
      const li = el("li");
      const left = el("div");
      left.append(el("strong", "", `${l.qty} × ${l.name}`));
      if (l.unit != null) left.append(el("span", "", `${paise(l.unit)} each`));
      li.append(left, el("b", "", l.total != null ? paise(l.total) : "—"));
      items.append(li);
    }
    const inst = pick(q, "installation_paise", "pricing.installation_paise", "terms.installation_paise");
    if (inst != null) {
      const li = el("li");
      const left = el("div");
      left.append(el("small", "", "Installation"), el("strong", "", "Installation & commissioning"));
      li.append(left, el("b", "", paise(inst)));
      items.append(li);
    }
    const discount = pick(q, "discount_paise", "pricing.discount_paise", "terms.discount_paise");
    if (discount) {
      const li = el("li");
      const left = el("div");
      left.append(el("small", "", "Discount"), el("strong", "", "Discount"));
      li.append(left, el("b", "", "− " + paise(discount)));
      items.append(li);
    }

    const total = pick(q, "total_paise", "pricing.total_paise", "snapshot.total_paise");
    const advance = pick(q, "advance_paise", "pricing.advance_paise", "snapshot.advance_paise");
    const kind = pick(q, "advance_kind", "terms.advance_kind", "pricing.advance_kind");
    const value = pick(q, "advance_value", "terms.advance_value", "pricing.advance_value");
    const pct = kind === "percentage" && value != null ? ` (${Number(value) / 100}%)` : "";
    const sum = el("dl", "cx-sum");
    const row = (k, v, cls = "") => {
      const r = el("div", cls);
      r.append(el("dt", "", k), el("dd", "", v));
      sum.append(r);
    };
    row("Total", paise(total), "is-net");
    row(`Advance${pct}`, paise(advance), "is-gross");
    const validUntil = pick(q, "valid_until", "terms.valid_until");
    if (validUntil) row("Valid until", BW.utils.formatDate(validUntil));
    if (q.decided_at) row("Decided", BW.utils.formatDate(q.decided_at));

    const side = el("div", "cx-quote-side");
    const actions = el("div", "cx-quote-actions");
    const msg = el("p", "form-error");
    msg.setAttribute("role", "alert");
    msg.hidden = true;
    const allowed = (q.allowed_actions || []).map((a) => String(a).toLowerCase());
    const canAccept = allowed.some((a) => /accept|decide|decision/.test(a)) || (!q.allowed_actions && q.state === "issued");
    if (q.state === "accepted") {
      const tag = el("span", "accepted-badge");
      tag.append(BW.ui.icon("check"), " Accepted");
      actions.append(tag);
    } else if (canAccept) {
      const btn = BW.ui.button("Accept Quotation", () => accept(q.id, btn, msg, enquiryId), "primary-btn", "check");
      actions.append(btn);
    } else {
      actions.append(el("p", "cx-fine", `This quotation is ${human(q.state).toLowerCase()}.`));
    }
    side.append(sum, actions, msg);
    body.append(items, side);
    card.append(head, body);

    const back = BW.ui.button("← All requests", () => (location.href = "customer-quotations.html"), "secondary-btn");
    root.append(back, card);

    if (q.state === "accepted") {
      const pay = panel("Payment");
      pay.id = "payment";
      root.append(pay);
      await renderPayment(pay, q.id);
    }
  }

  async function accept(quoteId, btn, msg, enquiryId) {
    if (!confirm("Accept this quotation? You'll then be able to pay the advance or the full amount.")) return;
    const action = `decision:${quoteId}:accept`;
    const key = BW.auth.idempotencyKey(action); // reused if this action is retried
    btn.disabled = true;
    msg.hidden = true;
    try {
      await BW.auth.request(`/v1/quotes/${encodeURIComponent(quoteId)}/decision`, {
        method: "POST",
        body: { decision: "accept" },
        idempotencyKey: key,
      });
      BW.auth.clearIdempotencyKey(action);
      BW.ui.toast("Quotation accepted");
      // Reload server state: quote + payment
      history.replaceState(null, "", quoteUrl(enquiryId, quoteId));
      renderQuotations();
    } catch (err) {
      btn.disabled = false;
      if (err.status && err.status !== 503) BW.auth.clearIdempotencyKey(action); // definitive answer
      msg.textContent =
        err.status === 409
          ? `This quotation can't be accepted right now (${err.code}). It may have expired or already been decided. Refresh to see its current state.`
          : apiError(err) || "You don't have access to this quotation.";
      msg.hidden = false;
    }
  }

  /* ---------- Payment status & Razorpay Standard Checkout ---------- */
  async function renderPayment(container, quoteId, notice) {
    container.querySelectorAll(":scope > :not(.panel-heading)").forEach((n) => n.remove());
    let s;
    try {
      s = await BW.auth.request(`/v1/quotes/${encodeURIComponent(quoteId)}/payment`);
    } catch (err) {
      if (err.status === 503) s = { state: "checkout_unavailable" };
      else {
        const msg = apiError(err) || "Payment details are not available for this account.";
        container.append(el("p", "form-error", msg));
        return;
      }
    }

    const state = s.state || "unknown";
    const sum = el("dl", "cx-sum");
    const row = (k, v, cls = "") => {
      const r = el("div", cls);
      r.append(el("dt", "", k), el("dd", "", v));
      sum.append(r);
    };
    if (s.total_paise != null) row("Total", paise(s.total_paise));
    if (s.advance_paise != null) row("Advance", paise(s.advance_paise));
    if (s.collected_paise != null) row("Collected", paise(s.collected_paise), "is-subsidy");
    if (s.remaining_paise != null) row("Remaining balance", paise(s.remaining_paise), "is-net");

    const status = el("div", "cx-pay-status");
    const label = {
      checkout_available: "Choose how to pay",
      checkout_unavailable: "Checkout unavailable",
      payment_pending: "Payment pending",
      under_review: "Under review",
      confirmed: "Order confirmed",
    }[state] || human(state);
    const tone = { confirmed: "green", checkout_unavailable: "slate", under_review: "amber", payment_pending: "blue" }[state] || "teal";
    status.append(el("span", `badge ${tone}`, label));
    if (notice) status.append(el("p", "cx-fine", notice));

    const actions = el("div", "cx-quote-actions");
    const amountFor = (choice) =>
      choice === "advance" ? s.advance_paise : s.collected_paise ? s.remaining_paise : s.total_paise;
    const choices = Array.isArray(s.choices) ? s.choices : [];

    if (state === "checkout_unavailable") {
      for (const c of choices.length ? choices : ["advance", "full"]) {
        const b = BW.ui.button(`${c === "advance" ? "Pay advance" : "Pay in full"} · ${paise(amountFor(c))}`, null, "secondary-btn");
        b.disabled = true;
        actions.append(b);
      }
      status.append(el("p", "cx-fine", "Online payment isn't available right now. Your accepted quotation is saved."));
    } else if (state === "checkout_available" || (state === "confirmed" && choices.length)) {
      for (const c of choices) {
        actions.append(
          BW.ui.button(
            `${c === "advance" ? "Pay advance" : s.collected_paise ? "Pay balance" : "Pay in full"} · ${paise(amountFor(c))}`,
            () => startCheckout(container, quoteId, c),
            c === "advance" || choices.length === 1 ? "primary-btn" : "secondary-btn",
          ),
        );
      }
    } else if (state === "payment_pending" || state === "under_review") {
      status.append(el("p", "cx-fine", state === "under_review" ? "We're confirming your payment with the bank. This page refreshes the status on request." : "Complete the open payment, or refresh to check its status."));
    }
    actions.append(BW.ui.button("Refresh status", () => renderPayment(container, quoteId), "secondary-btn"));

    container.append(status, sum, actions);

    const receipts = s.receipts || [];
    if (receipts.length) {
      container.append(el("h3", "detail-title", "Receipts"));
      const ul = el("ul", "cx-items");
      for (const r of receipts) {
        const li = el("li");
        const left = el("div");
        left.append(el("strong", "", r.provider_payment_id || r.id), el("span", "", r.credited_at ? BW.utils.formatDate(r.credited_at) : ""));
        li.append(left, el("b", "", paise(r.amount_paise)));
        ul.append(li);
      }
      container.append(ul);
    }
    if (s.order) {
      const meta = el("dl", "cx-meta");
      for (const [k, v] of [
        ["Order", s.order.id],
        ["Confirmed", s.order.confirmed_at ? BW.utils.formatDate(s.order.confirmed_at) : null],
        ["Pick list", s.order.pick_list_id],
        ["Work order", s.order.work_order_id],
      ]) {
        if (!v) continue;
        const r = el("div");
        r.append(el("dt", "", k), el("dd", "", v));
        meta.append(r);
      }
      container.append(el("h3", "detail-title", "Order"), meta);
    }
  }

  async function startCheckout(container, quoteId, choice) {
    const action = `checkout:${quoteId}:${choice}`;
    const key = BW.auth.idempotencyKey(action);
    let res;
    try {
      res = await BW.auth.request(`/v1/quotes/${encodeURIComponent(quoteId)}/checkout`, {
        method: "POST",
        body: { choice },
        idempotencyKey: key,
      });
      BW.auth.clearIdempotencyKey(action);
    } catch (err) {
      const definitive = err.status && !(err.status === 503 && err.code === "checkout_creation_uncertain");
      if (definitive) BW.auth.clearIdempotencyKey(action);
      const notice =
        err.code === "stock_shortage"
          ? "Equipment unavailable. Some items are out of stock right now. Please retry later."
          : err.code === "payment_under_review" || err.code === "checkout_creation_uncertain"
            ? "Under review. We're checking an earlier payment attempt before starting a new one."
            : err.status === 503
              ? "Checkout unavailable. Please try again later."
              : apiError(err) || "You can't start a payment for this quotation.";
      await renderPayment(container, quoteId, notice);
      if (err.code === "stock_shortage") {
        container.querySelector(".cx-quote-actions")?.prepend(
          BW.ui.button("Retry", () => startCheckout(container, quoteId, choice), "primary-btn"),
        );
      }
      return;
    }
    const attemptId = res?.attempt?.id;
    const checkout = res?.checkout;
    if (!checkout) {
      await renderPayment(container, quoteId, "Preparing your payment… refresh in a moment.");
      return;
    }
    await openRazorpay(container, quoteId, attemptId, checkout);
  }

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://checkout.razorpay.com/v1/checkout.js";
      sc.onload = resolve;
      sc.onerror = () => reject(new Error("razorpay_load_failed"));
      document.head.append(sc);
    });
  }

  async function openRazorpay(container, quoteId, attemptId, checkout) {
    try {
      await loadRazorpay();
    } catch {
      await renderPayment(container, quoteId, "Couldn't load the payment window. Check your connection and try again.");
      return;
    }
    const user = BW.auth.current();
    const rzp = new window.Razorpay({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: "Bijli Wala",
      description: "Solar installation payment",
      prefill: { email: user?.email || "" },
      handler: async (resp) => {
        const action = `verify:${attemptId}`;
        const key = BW.auth.idempotencyKey(action);
        try {
          await BW.auth.request(`/v1/checkouts/${encodeURIComponent(attemptId)}/verify`, {
            method: "POST",
            body: { payment_id: resp.razorpay_payment_id, signature: resp.razorpay_signature },
            idempotencyKey: key,
          });
          BW.auth.clearIdempotencyKey(action);
          await renderPayment(container, quoteId, "Payment received. Thank you!");
        } catch (err) {
          await renderPayment(container, quoteId, `We couldn't verify the payment yet (${err.status || "network"}). Refresh status in a moment.`);
        }
      },
      modal: { ondismiss: () => renderPayment(container, quoteId) },
    });
    rzp.open();
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
