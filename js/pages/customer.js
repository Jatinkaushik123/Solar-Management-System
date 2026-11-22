/**
 * Bijli Wala SIMS — Customer Experience ("My Solar"), hosted Supabase API
 * Four dedicated customer views, all reading and writing the live API:
 *   My Solar Home · Site Surveys · My Quotations · Installation & Warranty
 * Each page registers its own controller keyed by <body data-page>.
 */
window.BW = window.BW || {};
window.BW.controllers = window.BW.controllers || {};

(() => {
  "use strict";

  const el = (...a) => BW.ui.el(...a);

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
    const quoteId = params.get("quote") || params.get("quote_id");
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
    const estimate = q.lines?.[0]?.estimate;
    const inst = estimate?.installation_paise ?? pick(q, "installation_paise", "pricing.installation_paise", "terms.installation_paise");
    if (inst != null) {
      const li = el("li");
      const left = el("div");
      left.append(el("small", "", "Installation"), el("strong", "", "Installation & commissioning"));
      li.append(left, el("b", "", paise(inst)));
      items.append(li);
    }
    if (estimate?.gst_paise != null) {
      const li = el("li");
      li.append(el("strong", "", "GST (included in total)"), el("b", "", paise(estimate.gst_paise)));
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
    if (estimate?.subsidy_paise > 0 && total != null) {
      row("Estimated PM Surya Ghar subsidy", paise(estimate.subsidy_paise), "is-subsidy");
      row("Estimated cost after subsidy", paise(total - estimate.subsidy_paise));
    }
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
      const openChoice = s.attempt && s.attempt.state !== "expired" ? s.attempt.choice : null;
      if (state === "payment_pending" && openChoice) {
        // Re-sending the same choice returns the original attempt and gateway order.
        actions.append(BW.ui.button(`Resume payment · ${paise(s.attempt.amount_paise ?? amountFor(openChoice))}`, () => startCheckout(container, quoteId, openChoice), "primary-btn"));
      }
    }
    if (s.attempt?.state === "expired") {
      status.append(el("p", "cx-fine", "Your previous payment window expired (equipment is held for 15 minutes). Choose an option to start a new one."));
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
      container.append(
        el("h3", "detail-title", "Order"),
        meta,
        BW.ui.button("Track installation & warranty", () => (location.href = `customer-warranty.html?order=${encodeURIComponent(s.order.id)}`), "secondary-btn", "shield-check"),
      );
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
        err.code === "open_checkout_exists"
          ? "A payment for the other option is already open. Resume it, or start again after it expires (15 minutes)."
          : err.code === "stock_shortage"
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
          if (err.status && err.status !== 503) BW.auth.clearIdempotencyKey(action);
          await renderPayment(
            container,
            quoteId,
            err.status === 503 || !err.status
              ? "Payment pending: the gateway hasn't confirmed it yet. Refresh status shortly; verification will be retried safely."
              : `We couldn't verify the payment (${err.status} · ${err.code}). Refresh status in a moment.`,
          );
        }
      },
      modal: { ondismiss: () => renderPayment(container, quoteId) },
    });
    rzp.open();
  }

  /* ============ Server-backed request tracking (My Solar Home + Site Surveys) ============ */
  // States from the hosted workflow: submitted → (assigned) → technical_approved →
  // under_review (inventory/pricing) → issued → accepted | declined, plus
  // correction (survey returned to the technician with a reason).
  const STATE_RANK = {
    submitted: 1, assigned: 1, correction: 1,
    technical_approved: 2, under_review: 2, changes_requested: 2, draft: 2, priced: 2,
    issued: 3, accepted: 4, declined: 4,
  };

  /** Latest request (list is ascending by request number) with detail + quote + payment. */
  async function latestRequest() {
    const items = await listEnquiries();
    if (!items.length) return { items, latest: null };
    const latest = items[items.length - 1];
    const detail = await BW.auth.request(`/v1/enquiries/${encodeURIComponent(latest.id)}`).catch(() => null);
    const ref = detail ? quoteRefs(detail).slice(-1)[0] : null;
    const quote = ref ? await BW.auth.request(`/v1/quotes/${encodeURIComponent(ref.id)}`).catch(() => null) : null;
    const payment =
      quote?.state === "accepted"
        ? await BW.auth.request(`/v1/quotes/${encodeURIComponent(quote.id)}/payment`).catch(() => null)
        : null;
    return { items, latest, detail, quote, payment };
  }

  /** Reason attached to the most recent "return"/correction history entry. */
  function returnReason(detail) {
    const hist = (detail?.history || []).slice().reverse();
    const h = hist.find((x) => /return|correction/i.test(x.action || x.state || "") && (x.reason || x.note));
    return h?.reason || h?.note || detail?.return_reason || null;
  }

  function serverJourney({ latest, detail, quote, payment }) {
    const state = detail?.state || latest?.state;
    const rank = STATE_RANK[state] || 0;
    const steps = [];
    let blocked = false;
    const next = (label, done, pending) => {
      if (blocked) return steps.push({ label, state: "todo", hint: "Upcoming" });
      if (done) return steps.push({ label, state: "done", hint: "Completed" });
      blocked = true;
      steps.push({ label: pending.label || label, state: pending.state || "active", hint: pending.hint });
    };
    next("Request Submitted", !!latest, { hint: "Pending submission" });
    next(
      "Site Survey & Design",
      rank >= 2 && state !== "correction",
      state === "correction"
        ? { label: "Survey Returned", state: "rejected", hint: "Engineer revisit needed" }
        : { hint: state === "assigned" ? "Engineer assigned" : "Awaiting engineer visit" },
    );
    next(
      "Quotation Ready",
      ["issued", "accepted"].includes(state) || ["issued", "accepted"].includes(quote?.state),
      state === "declined"
        ? { label: "Quotation Declined", state: "rejected", hint: "You declined this quotation" }
        : state === "changes_requested"
          ? { label: "Quotation Under Revision", state: "warn", hint: "Changes requested" }
          : { hint: "Stock check & pricing" },
    );
    next("Order & Payment", payment?.state === "confirmed", {
      label: quote?.state === "accepted" ? "Order & Payment" : "Accept Quotation",
      state: payment?.state === "checkout_unavailable" ? "warn" : "active",
      hint:
        quote?.state !== "accepted"
          ? "Review and accept your quotation"
          : { checkout_available: "Choose advance or full payment", checkout_unavailable: "Checkout unavailable", payment_pending: "Payment pending", under_review: "Payment under review" }[payment?.state] || "Payment",
    });
    next("Installation", false, { hint: payment?.order?.work_order_id ? `Work order ${String(payment.order.work_order_id).slice(0, 8)}` : "Scheduling crew" });
    const idx = steps.findIndex((s) => s.state !== "done");
    const step = steps[idx];
    const reason = state === "correction" ? returnReason(detail) : null;
    const stage = !latest
      ? { label: "Awaiting Request", tone: "blue", detail: "Submit a site request to begin." }
      : {
          label: step.label,
          tone: { rejected: "red", warn: "amber" }[step.state] || "teal",
          detail: reason ? `Reason: ${reason}` : `${latest.reference} · ${step.hint}`,
        };
    return { steps, current: idx === -1 ? steps.length : idx, stage, reason };
  }

  function correctionBanner(latest, reason) {
    const box = el("div", "cx-alert");
    box.setAttribute("role", "alert");
    const text = el("div");
    text.append(
      el("strong", "", `${latest.reference}: our engineer needs to revisit your site`),
      el("p", "", `Reason: ${reason || "See request history for details."}`),
      el("small", "", "No action is needed from you. The engineer will submit a corrected survey."),
    );
    box.append(BW.ui.icon("alert-triangle", 22), text, BW.ui.button("View request", () => (location.href = quoteUrl(latest.id)), "primary-btn", "file-text"));
    return box;
  }

  /* ======================= 1. My Solar Home (server) ======================= */
  async function renderHome() {
    const user = BW.auth.current();
    const root = page(
      `Welcome back, ${user.name}`,
      "Here's where your rooftop solar request stands today.",
      BW.ui.button("New Site Request", () => (location.href = "customer-surveys.html#new"), "primary-btn", "plus"),
    );
    const loading = el("p", "muted", "Loading your requests…");
    root.append(loading);
    let data;
    try {
      data = await latestRequest();
    } catch (err) {
      loading.remove();
      errorPanel(root, apiError(err) || "Your requests aren't available right now.", () => renderHome());
      return;
    }
    loading.remove();
    const j = serverJourney(data);
    const { latest, detail, quote, payment, items } = data;
    if (detail?.state === "correction") root.append(correctionBanner(latest, j.reason));

    const track = panel("Your solar journey", j.current >= 5 ? "All steps complete" : `Step ${j.current + 1} of 5`);
    track.append(stepper(j.steps));

    const cards = el("div", "cx-cards");
    cards.append(
      summaryCard(
        "Your request",
        latest ? latest.reference : "None yet",
        latest ? `${human(detail?.state || latest.state)} · ${detail?.site || "Site request"}` : "Submit a site request to get a quotation",
        "file-text",
        "amber",
      ),
      summaryCard("Current stage", j.stage.label, j.stage.detail, "activity", "teal", ["red", "amber"].includes(j.stage.tone) ? j.stage.tone : null),
      summaryCard(
        "Quotation",
        quote ? paise(quote.total_paise) : "—",
        quote ? `Advance ${paise(quote.advance_paise)} · ${human(quote.state)}` : "Issued after survey, stock check and pricing",
        "shield-check",
        "green",
      ),
    );

    const nextLinks = el("div", "cx-next");
    for (const [label, href, glyph, meta] of [
      ["Site Requests", "customer-surveys.html", "clipboard-list", `${items.length} submitted`],
      ["My Quotations", "customer-quotations.html", "file-text", quote ? human(quote.state) : "None issued yet"],
      ["Installation & Warranty", "customer-warranty.html", "shield-check", payment?.order ? "Order confirmed" : "After payment"],
    ]) {
      const a = el("a", "cx-link");
      a.href = href;
      a.append(BW.ui.icon(glyph), el("span", "", label), el("small", "", meta), BW.ui.icon("chevron-right", 16));
      nextLinks.append(a);
    }
    root.append(track, cards, nextLinks);
  }

  /* ======================= 2. Site Requests (server intake) ======================= */
  async function renderSurveys() {
    const user = BW.auth.current();
    const root = page("Site Requests", "Request a rooftop assessment and follow its progress.");

    const formPanel = panel("Request a site survey");
    formPanel.id = "new";
    const form = el("form", "cx-form");
    form.noValidate = true;
    const grid = el("div", "form-grid");
    const alertEl = el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;
    const f = (o) => BW.ui.field(grid, { required: true, ...o });
    const site = f({ name: "site", label: "Site address", placeholder: "House / building, area, city" });
    site.closest("label").classList.add("span-2");
    const contact = f({ name: "contact_email", label: "Contact email", type: "email", value: user.email || "" });
    const system = f({ name: "system", label: "System type", options: ["On-grid rooftop installation", "Off-grid rooftop installation (with batteries)", "Hybrid rooftop installation"], value: "On-grid rooftop installation" });
    const roof = f({ name: "roof_space_m2", label: "Usable roof space (m²)", type: "number", min: 1, step: 1, placeholder: "e.g. 40" });
    const bill = f({ name: "bill", label: "Average monthly bill (₹)", type: "number", min: 1, step: 1, placeholder: "e.g. 4500" });
    const gridType = f({ name: "grid_details", label: "Electricity connection", options: ["Single phase", "Three phase"], value: "Single phase" });
    const notes = f({ name: "notes", label: "Anything else we should know?", type: "textarea", required: false, placeholder: "Terrace access, shading, floor…" });
    notes.closest("label").classList.add("span-2");

    const submit = BW.ui.button("Submit request", null, "primary-btn", "clipboard-list");
    submit.type = "submit";
    const actions = el("div", "modal-actions");
    actions.append(submit);
    form.append(grid, alertEl, actions);
    formPanel.append(form);

    const ACTION = "intake";
    // One key per submission; editing the form after a failed attempt starts a new action.
    form.oninput = (e) => {
      e.target.classList?.remove("field-invalid");
      BW.auth.clearIdempotencyKey(ACTION);
    };
    const fail = (msg, input) => {
      alertEl.textContent = msg;
      alertEl.hidden = false;
      input?.classList.add("field-invalid");
      input?.focus();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      alertEl.hidden = true;
      if (site.value.trim().length < 5) return fail("Enter the site address.", site);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.value.trim())) return fail("Enter a valid contact email.", contact);
      const m2 = Number(roof.value);
      if (!roof.value || !Number.isFinite(m2) || m2 <= 0) return fail("Enter the usable roof space in square metres.", roof);
      const rupees = Number(bill.value);
      if (!bill.value || !Number.isFinite(rupees) || rupees <= 0) return fail("Enter your average monthly bill.", bill);
      const body = {
        site: site.value.trim(),
        contact_email: contact.value.trim(),
        requirements: [system.value, notes.value.trim()].filter(Boolean).join(". "),
        roof_space_m2: Math.round(m2),
        monthly_bill_paise: Math.round(rupees * 100),
        grid_details: gridType.value,
      };
      submit.disabled = true;
      try {
        const res = await BW.auth.request("/v1/enquiries", {
          method: "POST",
          body,
          idempotencyKey: BW.auth.idempotencyKey(ACTION),
        });
        BW.auth.clearIdempotencyKey(ACTION);
        const ack = res.acknowledgement || "We’ve received your request. We’ll email your quotation once it’s approved.";
        BW.ui.toast(ack);
        history.replaceState(null, "", location.pathname);
        await renderSurveys();
        const ok = el("div", "cx-success");
        ok.setAttribute("role", "status");
        ok.append(BW.ui.icon("circle-check", 20), el("p", "", `${ack} (Reference: ${res.reference || res.id})`));
        document.querySelector("#page-content .page-heading")?.after(ok);
      } catch (err) {
        // 503 / network: keep the key so a retry is the same request.
        if (err.status && err.status !== 503) BW.auth.clearIdempotencyKey(ACTION);
        fail(
          err.status === 400
            ? `Some details were rejected (${err.code}). Please check the form.`
            : apiError(err) || "You can't submit a request from this account.",
        );
      } finally {
        submit.disabled = false;
      }
    };

    const list = panel("Your requests");
    root.append(formPanel, list);
    try {
      const items = await listEnquiries();
      list.querySelector(".panel-heading").append(el("span", "muted", `${items.length} on record`));
      const latest = items[items.length - 1];
      if (latest?.state === "correction") {
        const d = await BW.auth.request(`/v1/enquiries/${encodeURIComponent(latest.id)}`).catch(() => null);
        root.insertBefore(correctionBanner(latest, returnReason(d)), formPanel);
      }
      if (!items.length) list.append(el("p", "empty", "No requests yet. Submit the form above to book your rooftop assessment."));
      const cards = el("div", "cx-survey-grid");
      for (const e of items.slice().reverse()) {
        const card = el("article", "cx-survey");
        const top = el("div", "cx-survey-top");
        top.append(el("strong", "", e.reference || e.id), BW.ui.statusPill(human(e.state)));
        const meta = el("dl", "cx-meta");
        for (const [k, v] of [["Submitted", e.created_at ? BW.utils.formatDate(e.created_at) : ""], ["Revision", e.revision]]) {
          if (v === "" || v == null) continue;
          const r = el("div");
          r.append(el("dt", "", k), el("dd", "", String(v)));
          meta.append(r);
        }
        const note = {
          submitted: "Received. An engineer will be assigned.",
          assigned: "An engineer has been assigned to visit.",
          correction: "Returned for a corrected survey.",
          technical_approved: "Survey approved. Checking stock.",
          draft: "Stock confirmed. Your quotation is being priced.",
          priced: "Your quotation is being finalised.",
          under_review: "Stock check and pricing in progress.",
          issued: "Your quotation is ready.",
          accepted: "Quotation accepted.",
          declined: "Quotation declined.",
        }[e.state] || human(e.state);
        card.append(top, meta, el("p", `cx-survey-note ${e.state === "correction" ? "is-bad" : ""}`, note), BW.ui.button("Open", () => (location.href = quoteUrl(e.id)), "secondary-btn", "file-text"));
        cards.append(card);
      }
      list.append(cards);
    } catch (err) {
      list.append(el("p", "form-error", apiError(err) || "Your requests aren't available right now."));
    }
    if (location.hash === "#new") requestAnimationFrame(() => site.focus());
  }

  /* ================== 4. Installation & Warranty (hosted API) ================== */
  // GET /v1/projects, /v1/projects/{order_id}, /v1/installations/{work_order_id}
  // POST /v1/installations/{id}/signoff · GET /v1/warranties · GET /v1/service/equipment
  // GET/POST /v1/service-tickets · POST /v1/service-tickets/{id}/confirmation

  /** "expires_on" is the first day OUT of coverage: covered through the day before. */
  function coveredThrough(expiresOn) {
    if (!expiresOn) return null;
    const d = new Date(expiresOn + "T12:00:00");
    d.setDate(d.getDate() - 1);
    return BW.utils.formatDate(BW.utils.dateString(d));
  }
  const todayIndia = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

  async function postAction(action, path, body) {
    const key = BW.auth.idempotencyKey(action);
    try {
      const res = await BW.auth.request(path, { method: "POST", body, idempotencyKey: key });
      BW.auth.clearIdempotencyKey(action);
      return res;
    } catch (err) {
      if (err.status && err.status !== 503) BW.auth.clearIdempotencyKey(action);
      throw err;
    }
  }

  async function reportPhotos(paths, into) {
    for (const p of (paths || []).slice(0, 10)) {
      try {
        const blob = await BW.auth.storageDownload("installation-evidence", p);
        const img = el("img", "roof-preview");
        img.alt = "Installation photo";
        img.src = URL.createObjectURL(blob);
        into.append(img);
      } catch {
        into.append(el("small", "muted", "Photo unavailable"));
      }
    }
  }

  async function renderProject(root, projectSummary) {
    const orderId = projectSummary.id || projectSummary.order_id;
    let p;
    try {
      p = await BW.auth.request(`/v1/projects/${encodeURIComponent(orderId)}`);
    } catch (err) {
      if (err.status === 404) return deniedPanel(root, "Project");
      return errorPanel(root, apiError(err) || "This project isn't available.", () => renderWarranty());
    }
    const pnl = panel(`Installation · ${p.enquiry_reference || p.reference || String(orderId).slice(0, 8)}`, BW.ui.statusPill(human(p.work_state || "")));
    const workId = p.work_order_id;
    const meta = el("dl", "cx-meta");
    for (const [k, v] of [
      ["Site", p.site],
      ["Pick list", p.pick_state ? human(p.pick_state) : null],
      ["Shipment", p.shipment ? `${human(p.shipment.state)}${p.shipment.delivered_at ? " · " + BW.utils.formatDate(p.shipment.delivered_at) : p.shipment.dispatched_at ? " · " + BW.utils.formatDate(p.shipment.dispatched_at) : ""}` : "Not dispatched yet"],
      ["Work order", workId ? String(workId).slice(0, 8) : null],
    ]) {
      if (!v) continue;
      const r = el("div");
      r.append(el("dt", "", k), el("dd", "", String(v)));
      meta.append(r);
    }
    pnl.append(meta);

    if (workId) {
      try {
        const w = await BW.auth.request(`/v1/installations/${encodeURIComponent(workId)}`);
        const inst = w.installation || {};
        const state = w.work_state;
        const report = inst.report;
        const signoff = inst.signoff;
        const box = el("div", "cx-crew");
        box.append(el("h3", "", "Installation"));
        box.append(el("p", "cx-fine", {
          ready_to_schedule: "We're scheduling your installation crew.",
          scheduled: `Scheduled${w.scheduled_at ? " for " + new Date(w.scheduled_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}.`,
          test_failed: "The generation test didn't pass. Our technician will re-test.",
          awaiting_signoff: "Installation passed its test. Please review and sign off.",
          completed: "Installation completed and signed off.",
        }[state] || human(state)));
        if (report) {
          const rm = el("dl", "cx-meta");
          for (const [k, v] of [
            ["Generation test", human(report.generation_test)],
            ["System size", report.system_kw ? `${report.system_kw} kW` : null],
            ["Work time", report.started_at && report.ended_at ? `${new Date(report.started_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} – ${new Date(report.ended_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}` : null],
          ]) {
            if (!v) continue;
            const r = el("div");
            r.append(el("dt", "", k), el("dd", "", v));
            rm.append(r);
          }
          const photos = el("div", "evidence-photos");
          box.append(rm, photos);
          reportPhotos(report.photo_paths, photos);
        }
        if (signoff) {
          box.append(el("p", "cx-survey-note", `Signed off ${new Date(signoff.signed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`));
        } else if (state === "awaiting_signoff" && report?.id) {
          const msg = el("p", "form-error");
          msg.setAttribute("role", "alert");
          msg.hidden = true;
          const btn = BW.ui.button("Accept installation & sign off", async () => {
            const ok = await BW.ui.reasonModal({
              title: "Sign off installation",
              message: "You confirm the installation and the passing test report shown above. Type your full name to sign.",
              label: "Your full name",
              confirmLabel: "Sign off",
            });
            if (ok === null) return;
            btn.disabled = true;
            try {
              await postAction(`signoff:${workId}:${report.id}`, `/v1/installations/${encodeURIComponent(workId)}/signoff`, { report_id: report.id, accepted: true });
              BW.ui.toast("Installation signed off. Your warranty is active.");
              renderWarranty();
            } catch (err) {
              btn.disabled = false;
              msg.textContent = err.status === 409 ? `Can't sign off yet (${err.code}). Refresh to see the latest report.` : apiError(err) || "You can't sign off this installation.";
              msg.hidden = false;
            }
          }, "primary-btn", "check");
          box.append(btn, msg);
        }
        pnl.append(box);
      } catch (err) {
        pnl.append(el("p", "cx-fine", err.status === 404 ? "Installation details aren't available yet." : apiError(err) || ""));
      }
    }
    root.append(pnl);
  }

  function ticketForm(equipment) {
    const { dialog, body } = BW.ui.modal(`Raise a service claim · ${equipment.serial}`, "spotlight");
    const form = el("form");
    form.noValidate = true;
    const grid = el("div", "form-grid");
    const msg = el("p", "form-error");
    msg.setAttribute("role", "alert");
    msg.hidden = true;
    const fault = BW.ui.field(grid, { name: "fault", label: "What's wrong?", type: "textarea", required: true, placeholder: "e.g. The inverter shuts off after start-up." });
    fault.closest("label").classList.add("span-2");
    const covered = equipment.warranty_state ? equipment.warranty_state === "active" : equipment.expires_on ? equipment.expires_on > todayIndia() : null;
    const submit = BW.ui.button("Submit claim", null, "primary-btn", "wrench");
    submit.type = "submit";
    const actions = el("div", "modal-actions");
    actions.append(BW.ui.button("Cancel", () => dialog.close()), submit);
    form.append(
      el("p", "form-caption", covered === null ? "Coverage is checked when the claim opens." : covered ? "Under warranty: repairs are free." : "Warranty expired: repairs will be invoiced."),
      grid, msg, actions,
    );
    body.append(form);
    form.onsubmit = async (e) => {
      e.preventDefault();
      msg.hidden = true;
      if (fault.value.trim().length < 5) {
        msg.textContent = "Describe the fault in a few words.";
        msg.hidden = false;
        fault.classList.add("field-invalid");
        return;
      }
      submit.disabled = true;
      try {
        const t = await postAction(`ticket:${equipment.serial}`, "/v1/service-tickets", { serial: equipment.serial, fault: fault.value.trim() });
        dialog.close();
        BW.ui.toast(`Service claim ${t.reference || String(t.id).slice(0, 8)} opened`);
        renderWarranty();
      } catch (err) {
        submit.disabled = false;
        msg.textContent =
          err.code === "active_ticket_exists"
            ? "There's already an open claim for this equipment. Track it below."
            : err.code === "equipment_replaced"
              ? "This unit was replaced. Raise the claim on its replacement serial."
              : apiError(err) || "You can't open a claim for this equipment.";
        msg.hidden = false;
      }
    };
  }

  async function renderTickets(root) {
    const pnl = panel("Service claims");
    root.append(pnl);
    let tickets;
    try {
      tickets = (await BW.auth.request("/v1/service-tickets"))?.items || [];
    } catch (err) {
      pnl.append(el("p", "form-error", apiError(err) || "Service claims aren't available."));
      return;
    }
    if (!tickets.length) {
      pnl.append(el("p", "empty", "No service claims yet."));
      return;
    }
    const grid = el("div", "cx-survey-grid");
    for (const t of tickets) {
      const card = el("article", "cx-survey");
      const top = el("div", "cx-survey-top");
      top.append(el("strong", "", t.reference || String(t.id).slice(0, 8)), BW.ui.statusPill(human(t.state)));
      const meta = el("dl", "cx-meta");
      const add = (k, v) => {
        if (v == null || v === "") return;
        const r = el("div");
        r.append(el("dt", "", k), el("dd", "", String(v)));
        meta.append(r);
      };
      add("Serial", t.serial);
      add("Opened", t.opened_at || t.created_at ? BW.utils.formatDate(t.opened_at || t.created_at) : "");
      add("Coverage", t.coverage ? (t.coverage === "covered" ? "Under warranty" : human(t.coverage)) : null);
      card.append(top, meta);
      const detailBox = el("div");
      card.append(detailBox);
      card.append(BW.ui.button("Details", async () => {
        detailBox.replaceChildren(el("p", "muted", "Loading…"));
        try {
          const d = await BW.auth.request(`/v1/service-tickets/${encodeURIComponent(t.id)}`);
          detailBox.replaceChildren();
          const dm = el("dl", "cx-meta");
          const add2 = (k, v) => {
            if (v == null || v === "") return;
            const r = el("div");
            r.append(el("dt", "", k), el("dd", "", String(v)));
            dm.append(r);
          };
          add2("Fault", d.fault);
          add2("Diagnosis", d.resolution?.diagnosis);
          add2("Work done", d.resolution?.work_performed);
          add2("Customer charge", d.resolution ? paise(d.customer_charge_paise ?? 0) : null);
          if (d.invoice) {
            add2("Invoice", `${d.invoice.reference || ""} ${paise(d.invoice.total_paise)}`.trim());
            add2("Paid", paise(d.invoice.collected_paise ?? 0));
            add2("Balance due", paise(d.invoice.remaining_paise ?? d.invoice.total_paise - (d.invoice.collected_paise || 0)));
          }
          detailBox.append(dm);
          if (d.state === "awaiting_confirmation" && d.resolution?.id) {
            const b = BW.ui.button("Confirm repair & close claim", async () => {
              b.disabled = true;
              try {
                await postAction(`confirm:${d.id}:${d.resolution.id}`, `/v1/service-tickets/${encodeURIComponent(d.id)}/confirmation`, { resolution_id: d.resolution.id, accepted: true });
                BW.ui.toast("Claim closed. Thank you!");
                renderWarranty();
              } catch (err) {
                b.disabled = false;
                detailBox.append(el("p", "form-error", err.status === 409 ? `Can't confirm yet (${err.code}). Refresh the claim.` : apiError(err) || "You can't confirm this claim."));
              }
            }, "primary-btn", "check");
            detailBox.append(b);
          }
        } catch (err) {
          detailBox.replaceChildren(el("p", "form-error", err.status === 404 ? "This claim isn't available." : apiError(err) || ""));
        }
      }, "secondary-btn", "file-text"));
      grid.append(card);
    }
    pnl.append(grid);
  }

  async function renderWarranty() {
    const root = page("Installation & Warranty", "Track your installation, sign off the handover, and keep your equipment covered.");
    const loading = el("p", "muted", "Loading…");
    root.append(loading);
    const focusOrder = new URLSearchParams(location.search).get("order");
    try {
      const projects = (await BW.auth.request("/v1/projects"))?.items || [];
      loading.remove();
      if (!projects.length) {
        const p = panel("Installation");
        p.append(el("p", "empty", "Your installation starts once your advance payment is confirmed."));
        root.append(p);
      }
      const ordered = focusOrder ? projects.filter((p) => (p.id || p.order_id) === focusOrder).concat(projects.filter((p) => (p.id || p.order_id) !== focusOrder)) : projects;
      for (const pr of ordered.slice(0, 5)) await renderProject(root, pr);
    } catch (err) {
      loading.remove();
      errorPanel(root, apiError(err) || "Your projects aren't available right now.", () => renderWarranty());
      return;
    }

    // Warranties + equipment (for raising claims)
    const wp = panel("Equipment warranties");
    root.append(wp);
    try {
      const [warr, equip] = await Promise.all([
        BW.auth.request("/v1/warranties").then((r) => r?.items || []),
        BW.auth.request("/v1/service/equipment").then((r) => r?.items || []).catch(() => []),
      ]);
      if (!warr.length) wp.append(el("p", "empty", "Warranties start when your equipment is delivered."));
      const grid = el("div", "cx-warranty-grid");
      const today = todayIndia();
      for (const w of warr) {
        const active = w.state ? w.state === "active" : w.expires_on > today;
        const card = el("article", `cx-warranty ${active ? "" : "is-expired"}`);
        const top = el("div", "cx-warranty-top");
        const shield = el("span", `icon-tile ${active ? "green" : "slate"}`);
        shield.append(BW.ui.icon("shield-check"));
        top.append(shield, BW.ui.statusPill(active ? "Active" : "Expired"));
        const years = w.term_months ? (w.term_months % 12 === 0 ? `${w.term_months / 12}-Year` : `${w.term_months}-Month`) : "";
        const kind = /inverter/i.test(w.item_id) ? "Inverter" : /panel|module/i.test(w.item_id) ? "Panel" : /battery/i.test(w.item_id) ? "Battery" : "Equipment";
        card.append(
          top,
          el("h3", "", `${years} ${kind} Warranty`.trim()),
          el("p", "cx-serial", w.serial),
          el("small", "", active ? `Covered through ${coveredThrough(w.expires_on)}` : `Expired ${BW.utils.formatDate(w.expires_on)}`),
        );
        const eq = equip.find((e) => e.serial === w.serial) || { serial: w.serial, expires_on: w.expires_on, warranty_state: w.state };
        card.append(BW.ui.button("Raise service claim", () => ticketForm(eq), "secondary-btn", "wrench"));
        grid.append(card);
      }
      wp.append(grid);
    } catch (err) {
      wp.append(el("p", "form-error", apiError(err) || "Warranties aren't available right now."));
    }
    await renderTickets(root);
  }

  Object.assign(BW.controllers, {
    "My Solar Home": { render: renderHome },
    "Site Surveys": { render: renderSurveys },
    "My Quotations": { render: renderQuotations },
    "Installation & Warranty": { render: renderWarranty },
  });
})();
