/**
 * Bijli Wala SIMS — Hosted staff workflow (Supabase Edge Functions API)
 * Adds a "Hosted requests" panel above the existing page for signed-in staff:
 *   Surveys page    · Admin: assign technician + salesperson
 *                   · Technician: submit site visit & design, or return for correction
 *   Inventory page  · Inventory: stock check on the active design revision
 *   Quotations page · Sales: commercial pricing + issue to customer
 * Uses the record's allowed_actions when the API supplies them; every POST sends
 * a per-action UUID Idempotency-Key (reused on retry, cleared on a definite answer).
 */
window.BW = window.BW || {};

(() => {
  "use strict";

  const el = (...a) => BW.ui.el(...a);
  const human = (s) => String(s || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const paise = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const r = n / 100;
    return "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
  };
  // India date (validity must be on or after today in India).
  const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

  const PAGE_ROLES = {
    Surveys: ["admin", "tech"],
    Inventory: ["inventory", "admin"],
    Quotations: ["sales", "admin"],
  };

  function errorText(err) {
    if (err.status === 409) {
      return {
        stale_design: "Someone updated this request. Reload to get the latest revision.",
        stale_price_version: "The price was updated elsewhere. Reload and try again.",
        idempotency_key_reused: "This action was already sent with different details. Reload and try again.",
      }[err.code] || `Conflict (${err.code}): reload to see the latest state.`;
    }
    if (err.status === 403) return "Your role or assignment can't perform this action.";
    if (err.status === 404) return "This record is missing or not assigned to you.";
    if (err.status === 400 || err.status === 422) return `Invalid input (${err.code}). Check the fields and try again.`;
    if (err.status === 503) return "Service temporarily unavailable. Retry — the same request will be resent safely.";
    if (!err.status) return "Can't reach the server. Retry — the same request will be resent safely.";
    return `Request failed (${err.status} · ${err.code}).`;
  }

  /** POST with an idempotency key bound to this action; keep it only if the outcome is unknown. */
  async function post(action, path, body) {
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

  /** Allowed if the API lists a matching action; if it sends none, fall back to role. */
  function allowed(detail, pattern, roles) {
    const list = detail?.allowed_actions;
    if (Array.isArray(list)) return list.some((a) => pattern.test(String(a)));
    return roles.includes(BW.auth.current()?.role);
  }

  async function listAll() {
    const items = [];
    let after = 0;
    for (let i = 0; i < 10; i++) {
      const res = await BW.auth.request(`/v1/enquiries?after=${encodeURIComponent(after)}&limit=100`);
      items.push(...(res?.items || []));
      if (res?.next_after == null || !(res.items || []).length) break;
      after = res.next_after;
    }
    return items;
  }

  /* ---------------- shared modal form ---------------- */
  function formModal(title, caption, build, submitLabel, onSubmit) {
    const { dialog, body } = BW.ui.modal(title, "drawer");
    const form = el("form");
    form.noValidate = true;
    const grid = el("div", "form-grid");
    const msg = el("p", "form-error");
    msg.setAttribute("role", "alert");
    msg.hidden = true;
    const result = el("div");
    if (caption) form.append(el("p", "form-caption", caption));
    form.append(grid);
    const ctx = build(grid, form) || {};
    const submit = BW.ui.button(submitLabel, null, "primary-btn", "check");
    submit.type = "submit";
    const actions = el("div", "modal-actions");
    actions.append(BW.ui.button("Close", () => dialog.close()), submit);
    form.append(msg, result, actions);
    body.append(form);
    form.oninput = (e) => e.target.classList?.remove("field-invalid");
    form.onsubmit = async (e) => {
      e.preventDefault();
      msg.hidden = true;
      submit.disabled = true;
      try {
        await onSubmit({ ...ctx, dialog, result, submit, fail: (t, input) => {
          msg.textContent = t;
          msg.hidden = false;
          input?.classList.add("field-invalid");
          input?.focus();
          throw Object.assign(new Error("validation"), { handled: true });
        } });
      } catch (err) {
        if (!err.handled) {
          msg.textContent = errorText(err);
          msg.hidden = false;
        }
      } finally {
        submit.disabled = false;
      }
    };
    return { dialog };
  }

  /* ---------------- Admin: assignment ---------------- */
  async function assignModal(enq, detail, refresh) {
    let people = [];
    try {
      const res = await BW.auth.request("/v1/staff/assignees");
      people = Array.isArray(res) ? res : res?.items || res?.assignees || [];
    } catch (err) {
      BW.ui.toast(errorText(err), "error");
      return;
    }
    const of = (role) => people.filter((p) => String(p.role).toLowerCase() === role).map((p) => [p.id || p.user_id, p.display_name || p.email || p.id]);
    formModal(
      `Assign ${enq.reference}`,
      "Pick the technician who visits the site and the salesperson who prices the quotation.",
      (grid) => ({
        tech: BW.ui.field(grid, { name: "technician_id", label: "Technician", options: of("technician"), value: detail?.technician_id || "", placeholder: "Select technician", required: true }),
        sales: BW.ui.field(grid, { name: "salesperson_id", label: "Salesperson", options: of("sales"), value: detail?.salesperson_id || "", placeholder: "Select salesperson", required: true }),
      }),
      "Save assignment",
      async ({ tech, sales, dialog, fail }) => {
        if (!tech.value) fail("Choose a technician.", tech);
        if (!sales.value) fail("Choose a salesperson.", sales);
        await post(`assign:${enq.id}:${tech.value}:${sales.value}`, `/v1/enquiries/${enq.id}/assignment`, {
          technician_id: tech.value,
          salesperson_id: sales.value,
        });
        dialog.close();
        BW.ui.toast(`${enq.reference} assigned`);
        refresh();
      },
    );
  }

  /* ---------------- Technician: site visit & design ---------------- */
  async function designModal(enq, detail, refresh) {
    let catalogue = [];
    try {
      const res = await BW.auth.request("/v1/inventory/items");
      catalogue = Array.isArray(res) ? res : res?.items || [];
    } catch (err) {
      BW.ui.toast(`Equipment list unavailable: ${errorText(err)}`, "error");
      return;
    }
    const itemOptions = catalogue.map((i) => [i.id || i.item_id, `${i.name || i.id || i.item_id}${i.available != null ? ` · ${i.available} available` : ""}`]);
    const nowLocal = () => {
      const d = new Date();
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      return d.toISOString().slice(0, 16);
    };
    formModal(
      `Site visit · ${enq.reference}`,
      `Design revision ${detail.revision} → ${detail.revision + 1}. ${detail.site ? "Site: " + detail.site : ""}`,
      (grid, form) => {
        const visited = BW.ui.field(grid, { name: "visited_at", label: "Visit completed at", type: "datetime-local", value: nowLocal(), required: true });
        visited.max = nowLocal();
        const dir = BW.ui.field(grid, { name: "roof_direction", label: "Roof direction", options: BW.catalog.lists.roofDirections, value: "South", required: true });
        const tilt = BW.ui.field(grid, { name: "tilt_deg", label: "Tilt (°)", type: "number", min: 0, max: 90, step: 1, value: 18, required: true });
        const cable = BW.ui.field(grid, { name: "cable_m", label: "Cable run (m)", type: "number", min: 0, step: 0.5, value: 20, required: true });
        const eqBox = el("div", "span-2 equipment-lines");
        eqBox.append(el("strong", "", "Equipment"));
        const rows = el("div", "equipment-rows");
        const addRow = (itemId = "", qty = 1) => {
          const row = el("div", "equipment-row form-grid");
          const item = BW.ui.field(row, { name: "item", label: "Item", options: itemOptions, value: itemId, placeholder: "Select item", required: true });
          const q = BW.ui.field(row, { name: "qty", label: "Qty", type: "number", min: 1, step: 1, value: qty, required: true });
          const rm = BW.ui.button("Remove", () => row.remove(), "secondary-btn");
          row.append(rm);
          rows.append(row);
          return { item, q };
        };
        const add = BW.ui.button("Add item", () => addRow(), "secondary-btn", "plus");
        eqBox.append(rows, add);
        grid.append(eqBox);
        const panel = catalogue.find((i) => /panel/i.test(i.name || i.id || ""));
        const inverter = catalogue.find((i) => /inverter/i.test(i.name || i.id || ""));
        if (panel) addRow(panel.id || panel.item_id, 5);
        if (inverter) addRow(inverter.id || inverter.item_id, 1);
        if (!panel && !inverter) addRow();
        return { visited, dir, tilt, cable, rows };
      },
      "Approve site visit & design",
      async ({ visited, dir, tilt, cable, rows, dialog, result, fail }) => {
        if (!visited.value) fail("Enter when the visit was completed.", visited);
        const when = new Date(visited.value);
        if (when > new Date()) fail("The visit time must be in the past (a completed visit).", visited);
        const t = Number(tilt.value);
        if (!(t >= 0 && t <= 90)) fail("Tilt must be between 0 and 90°.", tilt);
        const c = Number(cable.value);
        if (!(c >= 0)) fail("Cable run can't be negative.", cable);
        const equipment = [...rows.querySelectorAll(".equipment-row")].map((r) => ({
          item_id: r.querySelector("[name=item]").value,
          quantity: Number(r.querySelector("[name=qty]").value),
        }));
        if (!equipment.length) fail("Add at least one equipment line.");
        for (const [i, line] of equipment.entries()) {
          if (!line.item_id) fail(`Choose the item on line ${i + 1}.`);
          if (!Number.isInteger(line.quantity) || line.quantity < 1) fail(`Quantity on line ${i + 1} must be a whole number of at least 1.`);
        }
        const body = {
          base_revision: detail.revision,
          visited_at: when.toISOString(),
          roof_direction: dir.value,
          tilt_deg: t,
          cable_m: c,
          equipment,
        };
        const res = await post(`design:${enq.id}:${detail.revision}`, `/v1/enquiries/${enq.id}/designs`, body);
        BW.ui.toast(`${enq.reference}: ${human(res.state)} · revision ${res.revision}`);
        dialog.close();
        refresh();
      },
    );
  }

  async function returnSurvey(enq, detail, refresh) {
    const reason = await BW.ui.reasonModal({
      title: `Return ${enq.reference} for correction`,
      message: "The customer sees this reason in the request history. The technician then submits a corrected visit.",
      label: "Reason",
      placeholder: "e.g. roof measurements missing, re-check shading on the east side",
      confirmLabel: "Return survey",
      danger: true,
    });
    if (reason === null) return;
    try {
      await post(`return:${enq.id}:${detail.revision}`, `/v1/enquiries/${enq.id}/return`, { base_revision: detail.revision, reason });
      BW.ui.toast(`${enq.reference} returned for correction`);
      refresh();
    } catch (err) {
      BW.ui.toast(errorText(err), "error");
    }
  }

  /* ---------------- Inventory: stock check ---------------- */
  async function stockCheck(enq, detail, refresh, out) {
    out.replaceChildren(el("p", "muted", "Checking stock…"));
    try {
      const res = await post(`inventory:${enq.id}:${detail.revision}`, `/v1/enquiries/${enq.id}/inventory-checks`, { revision: detail.revision });
      const box = el("div", `stock-badge ${res.outcome === "approved" ? "stock-badge-ok" : "stock-badge-warn"}`);
      box.append(
        BW.ui.icon(res.outcome === "approved" ? "circle-check" : "alert-triangle"),
        ` ${human(res.outcome)} · revision ${res.revision}${res.quote_id ? ` · draft quote ${String(res.quote_id).slice(0, 8)}` : " · no quote created"}`,
      );
      const ul = el("ul", "cx-items");
      for (const l of res.lines || []) {
        const li = el("li");
        const left = el("div");
        left.append(el("strong", "", l.item_id), el("span", "", `Required ${l.required} · Available ${l.available}`));
        li.append(left, el("b", "", l.shortfall ? `Short ${l.shortfall}` : "OK"));
        ul.append(li);
      }
      out.replaceChildren(box, ul);
      BW.ui.toast(res.outcome === "approved" ? "Stock approved, draft quote created" : "Stock shortage recorded");
      setTimeout(refresh, 1200);
    } catch (err) {
      out.replaceChildren(el("p", "form-error", errorText(err)));
    }
  }

  /* ---------------- Sales: pricing + issue ---------------- */
  async function pricingModal(enq, quoteId, refresh) {
    let q;
    try {
      q = await BW.auth.request(`/v1/quotes/${encodeURIComponent(quoteId)}`);
    } catch (err) {
      BW.ui.toast(errorText(err), "error");
      return;
    }
    const lines = q.lines || [];
    let priceVersion = q.price_version ?? 0;
    const canPrice = allowed(q, /pric/i, ["sales", "admin"]) && q.state !== "issued";
    const canIssue = (q) => allowed(q, /issue/i, ["sales", "admin"]) && q.state !== "issued" && (q.price_version ?? 0) > 0;
    const { dialog } = formModal(
      `Quotation · ${enq.reference}`,
      `${human(q.state)} · revision ${q.revision ?? "—"} · price version ${priceVersion}`,
      (grid) => {
        const prices = {};
        for (const l of lines) {
          prices[l.item_id] = BW.ui.field(grid, {
            name: `price_${l.item_id}`,
            label: `${l.quantity} × ${l.name || l.item_id} · unit price (₹)`,
            type: "number", min: 0, step: 1,
            value: l.unit_paise != null ? l.unit_paise / 100 : "",
            required: true,
          });
        }
        const install = BW.ui.field(grid, { name: "installation", label: "Installation (₹)", type: "number", min: 0, step: 1, value: q.installation_paise != null ? q.installation_paise / 100 : 20000, required: true });
        const discount = BW.ui.field(grid, { name: "discount", label: "Discount (₹)", type: "number", min: 0, step: 1, value: q.discount_paise != null ? q.discount_paise / 100 : 0, required: true });
        const valid = BW.ui.field(grid, { name: "valid_until", label: "Valid until", type: "date", value: q.valid_until || "", min: todayIST(), required: true });
        const kind = BW.ui.field(grid, { name: "advance_kind", label: "Advance type", options: [["percentage", "Percentage of total"], ["fixed", "Fixed amount"]], value: q.advance_kind || "percentage", required: true });
        const adv = BW.ui.field(grid, {
          name: "advance_value", label: "Advance (% or ₹)", type: "number", min: 0, step: 0.01,
          value: q.advance_value != null ? (q.advance_kind === "fixed" ? q.advance_value / 100 : q.advance_value / 100) : 20,
          required: true,
          hint: "Percentage: e.g. 20 for 20%. Fixed: rupees.",
        });
        [...grid.querySelectorAll("input,select")].forEach((n) => (n.disabled = !canPrice));
        return { prices, install, discount, valid, kind, adv };
      },
      canPrice ? "Save pricing" : "Close",
      async ({ prices, install, discount, valid, kind, adv, dialog, result, submit, fail }) => {
        if (!canPrice) return dialog.close();
        const unit_prices = {};
        for (const [id, input] of Object.entries(prices)) {
          const v = Number(input.value);
          if (input.value === "" || !(v >= 0)) fail("Enter a unit price of ₹0 or more for every item.", input);
          unit_prices[id] = Math.round(v * 100);
        }
        const inst = Number(install.value), disc = Number(discount.value), a = Number(adv.value);
        if (!(inst >= 0)) fail("Installation can't be negative.", install);
        if (!(disc >= 0)) fail("Discount can't be negative.", discount);
        if (!valid.value || valid.value < todayIST()) fail("Validity must be today or later (India date).", valid);
        if (!(a >= 0)) fail("Advance can't be negative.", adv);
        if (kind.value === "percentage" && a > 100) fail("A percentage advance can't exceed 100%.", adv);
        const body = {
          price_version: priceVersion,
          unit_prices,
          installation_paise: Math.round(inst * 100),
          discount_paise: Math.round(disc * 100),
          valid_until: valid.value,
          advance_kind: kind.value,
          // basis points for percentage (2000 = 20%), paise for fixed
          advance_value: kind.value === "percentage" ? Math.round(a * 100) : Math.round(a * 100),
        };
        const res = await post(`pricing:${quoteId}:${priceVersion}`, `/v1/quotes/${quoteId}/pricing`, body);
        priceVersion = res.price_version ?? priceVersion + 1;
        result.replaceChildren(
          el("p", "cx-success", `Priced: total ${paise(res.total_paise)} · advance ${paise(res.advance_paise)} · price version ${priceVersion}`),
        );
        submit.textContent = "Save pricing again";
        if (canIssue({ ...q, ...res, price_version: priceVersion })) {
          const issue = BW.ui.button(`Issue to customer (v${priceVersion})`, async () => {
            issue.disabled = true;
            try {
              const out = await post(`issue:${quoteId}:${priceVersion}`, `/v1/quotes/${quoteId}/issue`, { price_version: priceVersion });
              BW.ui.toast(`Issued ${String(quoteId).slice(0, 8)} · ${out.delivery?.status === "pending" ? "Delivery pending" : "Delivered"}`);
              dialog.close();
              refresh();
            } catch (err) {
              issue.disabled = false;
              result.append(el("p", "form-error", errorText(err)));
            }
          }, "primary-btn", "file-text");
          result.append(issue);
        }
      },
    );
    // Already priced draft: offer Issue straight away.
    if (canIssue(q)) {
      const form = dialog.querySelector("form");
      const issue = BW.ui.button(`Issue to customer (v${priceVersion})`, async () => {
        issue.disabled = true;
        try {
          const out = await post(`issue:${quoteId}:${priceVersion}`, `/v1/quotes/${quoteId}/issue`, { price_version: priceVersion });
          BW.ui.toast(`Issued · ${out.delivery?.status === "pending" ? "Delivery pending" : "Sent"}`);
          dialog.close();
          refresh();
        } catch (err) {
          issue.disabled = false;
          form.querySelector(".form-error").textContent = errorText(err);
          form.querySelector(".form-error").hidden = false;
        }
      }, "secondary-btn", "file-text");
      form.querySelector(".modal-actions").prepend(issue);
    }
  }

  /* ---------------- panel ---------------- */
  async function renderPanel(host) {
    const user = BW.auth.current();
    const pageName = BW.page;
    host.replaceChildren();
    const section = el("section", "panel live-panel");
    const head = el("div", "panel-heading");
    const titles = {
      admin: { Surveys: "Hosted requests · assignment", Inventory: "Hosted requests · stock checks", Quotations: "Hosted quotations · pricing" },
      tech: { Surveys: "My assigned site visits" },
      inventory: { Inventory: "Stock checks awaiting approval" },
      sales: { Quotations: "My draft quotations" },
    };
    head.append(el("h2", "", titles[user.role]?.[pageName] || "Hosted requests"), el("span", "badge teal", "Live API"));
    section.append(head);
    const body = el("div", "live-body");
    body.append(el("p", "muted", "Loading…"));
    section.append(body);
    host.append(section);
    const refresh = () => renderPanel(host);

    let items;
    try {
      items = await listAll();
    } catch (err) {
      body.replaceChildren(el("p", "form-error", errorText(err)), BW.ui.button("Retry", refresh, "secondary-btn"));
      return;
    }

    // Which requests matter on this page for this role
    const want = {
      "admin:Surveys": (s) => ["submitted", "assigned", "correction"].includes(s),
      "tech:Surveys": (s) => ["submitted", "assigned", "correction", "technical_approved"].includes(s),
      "inventory:Inventory": (s) => ["technical_approved", "under_review"].includes(s),
      "admin:Inventory": (s) => ["technical_approved", "under_review"].includes(s),
      // "draft" = stock approved, quote awaiting pricing (state after the inventory check)
      "sales:Quotations": (s) => ["draft", "priced", "under_review", "issued", "changes_requested"].includes(s),
      "admin:Quotations": (s) => ["draft", "priced", "under_review", "issued", "changes_requested"].includes(s),
    }[`${user.role}:${pageName}`] || (() => false);
    const rows = items.filter((e) => want(e.state)).reverse();
    if (!rows.length) {
      body.replaceChildren(el("p", "empty", "Nothing waiting for you right now."), BW.ui.button("Refresh", refresh, "secondary-btn"));
      return;
    }
    const list = el("div", "live-list");
    for (const e of rows) {
      const card = el("article", "cx-survey live-card");
      const top = el("div", "cx-survey-top");
      top.append(el("strong", "", e.reference || e.id), BW.ui.statusPill(human(e.state)));
      const meta = el("p", "cx-fine", `Revision ${e.revision ?? 0} · ${e.created_at ? BW.utils.formatDate(e.created_at) : ""}`);
      const actions = el("div", "cx-quote-actions");
      const out = el("div", "live-out");
      const open = BW.ui.button("Open", async () => {
        open.disabled = true;
        actions.replaceChildren(el("span", "muted", "Loading…"));
        let d;
        try {
          d = await BW.auth.request(`/v1/enquiries/${encodeURIComponent(e.id)}`);
        } catch (err) {
          actions.replaceChildren(el("p", "form-error", errorText(err)));
          return;
        }
        meta.textContent = [d.site, `Revision ${d.revision}`, d.roof_space_m2 ? `${d.roof_space_m2} m²` : null, d.grid_details].filter(Boolean).join(" · ");
        actions.replaceChildren();
        const r = user.role;
        if (pageName === "Surveys" && r === "admin" && allowed(d, /assign/i, ["admin"])) {
          actions.append(BW.ui.button("Assign", () => assignModal(e, d, refresh), "primary-btn", "users"));
        }
        if (pageName === "Surveys" && r === "tech") {
          if (allowed(d, /design|survey|visit/i, ["tech"]) && ["submitted", "assigned", "correction"].includes(d.state)) {
            actions.append(BW.ui.button(d.state === "correction" ? "Submit corrected visit" : "Submit site visit", () => designModal(e, d, refresh), "primary-btn", "clipboard-list"));
          }
        }
        if (pageName === "Surveys" && allowed(d, /return/i, [])) {
          actions.append(BW.ui.button("Return for correction", () => returnSurvey(e, d, refresh), "secondary-btn danger-btn", "x"));
        }
        if (pageName === "Inventory" && allowed(d, /inventory|stock|check/i, ["inventory"]) && d.state === "technical_approved") {
          actions.append(BW.ui.button(`Check stock (rev ${d.revision})`, () => stockCheck(e, d, refresh, out), "primary-btn", "boxes"));
        }
        if (pageName === "Quotations") {
          const refs = (d.quotes || []).filter((q) => q.id);
          for (const q of refs) {
            actions.append(BW.ui.button(`Quote rev ${q.revision ?? ""} · ${human(q.state)}`, () => pricingModal(e, q.id, refresh), q.state === "draft" ? "primary-btn" : "secondary-btn", "file-text"));
          }
          if (!refs.length) actions.append(el("span", "muted", "No draft yet: waiting for the stock check."));
        }
        if (!actions.children.length) actions.append(el("span", "muted", "No action available for your role on this request."));
      }, "secondary-btn", "chevron-right");
      actions.append(open);
      card.append(top, meta, actions, out);
      list.append(card);
    }
    body.replaceChildren(list);
  }

  function mount() {
    const user = BW.auth?.current();
    if (!user || !PAGE_ROLES[BW.page]?.includes(user.role)) return;
    const content = document.querySelector("#page-content");
    if (!content || document.querySelector("#live-workflow")) return;
    // Separate container: the page's own re-renders replace #page-content only.
    const host = el("div", "content live-content");
    host.id = "live-workflow";
    content.before(host);
    renderPanel(host);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(mount, 0));
})();
