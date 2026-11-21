/**
 * Bijli Wala SIMS — Warranty & Service Tickets Controller
 * Hardware serial lookup, automated warranty coverage determination, and ticket billing [cite: 9, 14].
 */
window.BW = window.BW || {};
window.BW.controllers = window.BW.controllers || {};

(() => {
  "use strict";

  let searchQuery = "";
  let statusFilter = "All Status";
  let serialLookupQuery = "";

  function isCovered(warranty) {
    const today = BW.utils.todayISO();
    return warranty.status !== "Closed" && String(warranty["Expiry date"] || "") >= today;
  }

  function getTicketCharges(warranty) {
    const tickets = warranty.tickets || [];
    const parts = tickets.reduce((sum, t) => sum + (Number(t.parts) || 0), 0);
    const labour = tickets.reduce((sum, t) => sum + (Number(t.labour) || 0), 0);
    const covered = isCovered(warranty);
    return {
      parts,
      labour,
      total: parts + labour,
      due: covered ? 0 : parts + labour,
      covered,
    };
  }

  function openTicketModal(warranty, onComplete) {
    const isClaimOpen = warranty.status === "Claim open";
    const currentTicket = (warranty.tickets || []).find((t) => !t.closed);
    const covered = isCovered(warranty);

    const { dialog, body } = BW.ui.modal(
      isClaimOpen ? `Service Ticket · ${warranty["Serial number"]}` : `Open Service Ticket · ${warranty["Serial number"]}`,
      "spotlight",
    );

    const form = BW.ui.el("form");
    const grid = BW.ui.el("div", "form-grid");
    const alertEl = BW.ui.el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;

    form.append(
      BW.ui.el(
        "p",
        "form-caption",
        `Equipment: ${warranty.Component} · Customer: ${warranty.Customer}`,
      ),
      grid,
    );

    const partsField = BW.ui.field(grid, {
      name: "parts",
      label: "Replacement Parts Cost (₹)",
      type: "number",
      value: currentTicket?.parts ?? (covered ? 0 : 800),
      min: 0,
      step: 10,
      required: true,
      hint: covered ? "₹0 covered under active warranty guarantee" : "Billable to customer",
    });

    const labourField = BW.ui.field(grid, {
      name: "labour",
      label: "Technician Labour Cost (₹)",
      type: "number",
      value: currentTicket?.labour ?? (covered ? 0 : 350),
      min: 0,
      step: 10,
      required: true,
    });

    const noteField = BW.ui.field(grid, {
      name: "note",
      label: "Technician Service Notes",
      type: "textarea",
      value: currentTicket?.note || "",
      placeholder: "Describe root cause, diagnosis, parts replaced, and resolution...",
    });

    const billingBanner = BW.ui.el("div", "ticket-billing-box");

    function refreshBilling() {
      const parts = Number(partsField.value) || 0;
      const labour = Number(labourField.value) || 0;
      const total = parts + labour;
      const due = covered ? 0 : total;

      billingBanner.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Coverage Status:</span>
          <strong style="color: ${covered ? "#34D399" : "#F59E0B"}">
            ${covered ? "✓ Active Coverage (Amount Due: ₹0)" : "⚠️ Expired Warranty (Billable)"}
          </strong>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
          <span>Customer Payable:</span>
          <strong style="font-size: 1.2rem; color: ${covered ? "#34D399" : "#F59E0B"}">
            ${BW.utils.formatINR(due)}
          </strong>
        </div>
      `;
    }

    partsField.oninput = refreshBilling;
    labourField.oninput = refreshBilling;
    refreshBilling();

    form.append(billingBanner, alertEl);

    const actions = BW.ui.el("div", "modal-actions");
    actions.append(BW.ui.button("Cancel", () => dialog.close()));

    if (isClaimOpen) {
      const closeTicketBtn = BW.ui.button(
        "Close Ticket & Finalize",
        () => commitTicket(true),
        "secondary-btn",
        "check",
      );
      actions.append(closeTicketBtn);
    }

    const saveTicketBtn = BW.ui.button(
      isClaimOpen ? "Save Ticket Costs" : "Open Ticket",
      null,
      "primary-btn",
      "wrench",
    );
    saveTicketBtn.type = "submit";
    actions.append(saveTicketBtn);

    form.append(actions);
    body.append(form);

    function commitTicket(closeTicket = false) {
      const parts = Number(partsField.value);
      const labour = Number(labourField.value);

      if (Number.isNaN(parts) || Number.isNaN(labour) || parts < 0 || labour < 0) {
        alertEl.textContent = "Please enter non-negative numbers for parts and labour.";
        alertEl.hidden = false;
        return;
      }

      try {
        const tickets = [...(warranty.tickets || [])];
        const updatedTicket = {
          ...(currentTicket || {
            id: `${warranty.id}-T${tickets.length + 1}`,
            opened: BW.utils.todayISO(),
          }),
          parts,
          labour,
          note: noteField.value.trim(),
          ...(closeTicket ? { closed: BW.utils.todayISO() } : {}),
        };

        const nextTickets = currentTicket
          ? tickets.map((t) => (t.id === currentTicket.id ? updatedTicket : t))
          : [updatedTicket, ...tickets];

        const history = [...(warranty.history || [])];
        history.unshift({
          date: BW.utils.todayISO(),
          title: closeTicket ? "Service ticket resolved and closed" : "Service claim updated",
          detail: `Parts: ${BW.utils.formatINR(parts)} · Labour: ${BW.utils.formatINR(labour)} · Note: ${noteField.value.trim()}`,
        });

        BW.store.save("Warranty", {
          ...warranty,
          status: closeTicket ? "Active" : "Claim open",
          tickets: nextTickets,
          history,
        });

        dialog.close();
        BW.ui.toast(closeTicket ? "Service ticket closed." : "Ticket updated.");
        onComplete();
      } catch (err) {
        alertEl.textContent = err.message;
        alertEl.hidden = false;
      }
    }

    form.onsubmit = (e) => {
      e.preventDefault();
      commitTicket(false);
    };
  }

  function openWarrantyDetailModal(warranty, onSaved) {
    const { dialog, body } = BW.ui.modal(`Warranty Record · ${warranty.id}`, "drawer");
    const charges = getTicketCharges(warranty);
    const covered = charges.covered;

    const content = BW.ui.el("div", "warranty-drawer-content");

    content.innerHTML = `
      <div class="warranty-card-header">
        <div>
          <h3 style="margin: 0; font-size: 1.25rem;">${warranty.Component}</h3>
          <p style="margin: 4px 0 0; color: #a4b5c7;">Customer: <strong>${warranty.Customer}</strong></p>
        </div>
        <div>
          ${BW.ui.statusPill(warranty.status).outerHTML}
        </div>
      </div>

      <div class="warranty-meta-grid">
        <div class="meta-item">
          <span>Serial Number</span>
          <code>${warranty["Serial number"]}</code>
        </div>
        <div class="meta-item">
          <span>Coverage Period</span>
          <strong>${warranty.coverageYears || 2} Years</strong>
        </div>
        <div class="meta-item">
          <span>Registration Date</span>
          <strong>${BW.utils.formatDate(warranty.coverageStart)}</strong>
        </div>
        <div class="meta-item">
          <span>Expiry Date</span>
          <strong style="color: ${covered ? "#34D399" : "#EF4444"}">${BW.utils.formatDate(warranty["Expiry date"])}</strong>
        </div>
      </div>

      <div class="warranty-billing-summary ${covered ? "billing-covered" : "billing-expired"}">
        <div>
          <strong>Billing Summary:</strong>
          <span>${covered ? "Active Warranty · Amount Due: ₹0" : `Warranty Expired · Amount Due: ${BW.utils.formatINR(charges.due)}`}</span>
        </div>
        <small style="color: #cbd5e1;">(Accumulated Parts: ${BW.utils.formatINR(charges.parts)} + Labour: ${BW.utils.formatINR(charges.labour)})</small>
      </div>

      <h4 style="margin: 20px 0 10px;">Service History & Audit Trail</h4>
    `;

    // History Timeline
    const timeline = BW.ui.el("ul", "warranty-history-list");
    (warranty.history || []).forEach((h) => {
      const li = BW.ui.el("li");
      li.innerHTML = `
        <div class="hist-dot"></div>
        <div class="hist-content">
          <strong>${h.title}</strong>
          <small>${BW.utils.formatDate(h.date)}</small>
          <p>${h.detail}</p>
        </div>
      `;
      timeline.append(li);
    });
    content.append(timeline);

    const actions = BW.ui.el("div", "modal-actions");
    actions.append(BW.ui.button("Close", () => dialog.close()));

    const ticketBtn = BW.ui.button(
      warranty.status === "Claim open" ? "Manage Ticket Costs" : "Open Service Ticket",
      () => {
        dialog.close();
        openTicketModal(warranty, onSaved);
      },
      "primary-btn",
      "wrench",
    );
    actions.append(ticketBtn);

    content.append(actions);
    body.append(content);
  }

  function render() {
    const root = document.querySelector("#page-content");
    if (!root) return;
    root.replaceChildren();

    const warranties = BW.store.get("Warranty");

    const headingEl = BW.ui.heading(
      "Warranty",
      "Component warranty registry, hardware serial number lookup, and service claim cost tracking.",
    );

    // Instant Serial Lookup Widget
    const lookupPanel = BW.ui.el("section", "panel serial-lookup-panel");
    const lookupHead = BW.ui.el("div", "panel-heading");
    lookupHead.append(BW.ui.el("h2", "", "Hardware Serial Lookup & Billing Calculator"));

    const lookupInputWrap = BW.ui.el("label", "search-box serial-lookup-box");
    const lookupInput = BW.ui.el("input");
    lookupInput.placeholder = "Enter or scan serial barcode (e.g. BW-240038, WAA-540-8801, SG-10K-9902)...";
    lookupInput.value = serialLookupQuery;
    lookupInput.setAttribute("aria-label", "Search serial number");

    const lookupResultBox = BW.ui.el("div", "serial-lookup-result");

    function updateSerialLookup() {
      lookupResultBox.replaceChildren();
      const code = lookupInput.value.trim().toUpperCase();
      if (!code) {
        lookupResultBox.hidden = true;
        return;
      }
      lookupResultBox.hidden = false;

      const exact = warranties.find(
        (w) => String(w["Serial number"]).toUpperCase() === code,
      );

      if (exact) {
        const charges = getTicketCharges(exact);
        const covered = charges.covered;
        const box = BW.ui.el("div", `lookup-card ${covered ? "covered" : "expired"}`);
        box.innerHTML = `
          <div class="lookup-card-left">
            <strong>${exact["Serial number"]} · ${exact.Component}</strong>
            <p>Customer: ${exact.Customer} · Expiry: ${BW.utils.formatDate(exact["Expiry date"])}</p>
          </div>
          <div class="lookup-card-right">
            <span class="badge ${covered ? "green" : "amber"}">${covered ? "Covered" : "Expired"}</span>
            <strong style="font-size: 1.15rem; margin-left: 10px;">
              ${covered ? "Amount Due: ₹0" : `Due: ${BW.utils.formatINR(charges.due)}`}
            </strong>
          </div>
        `;

        const openTicketBtn = BW.ui.button(
          "Open Ticket",
          () => openTicketModal(exact, render),
          "primary-btn",
          "wrench",
        );
        box.append(openTicketBtn);
        lookupResultBox.append(box);
      } else {
        const partials = warranties.filter((w) =>
          String(w["Serial number"]).toUpperCase().includes(code),
        );
        if (partials.length > 0) {
          lookupResultBox.append(
            BW.ui.el("p", "muted", `${partials.length} matching serials found in registry. Refine search.`),
          );
        } else {
          lookupResultBox.append(
            BW.ui.el("p", "form-warning", `Serial number "${code}" is not registered in SIMS.`),
          );
        }
      }
    }

    lookupInput.oninput = BW.utils.debounce(() => {
      serialLookupQuery = lookupInput.value;
      updateSerialLookup();
    }, 150);

    lookupInputWrap.append(BW.ui.icon("search", 18), lookupInput);
    lookupPanel.append(lookupHead, lookupInputWrap, lookupResultBox);
    updateSerialLookup();

    // Filter calculations
    const filtered = warranties.filter((w) => {
      const matchesSearch =
        !searchQuery ||
        [w.id, w.Customer, w.Component, w["Serial number"], w.status]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "All Status" || w.status === statusFilter;

      return matchesSearch && matchesStatus;
    });

    const coveredCount = warranties.filter((w) => isCovered(w)).length;
    const expiredCount = warranties.filter((w) => !isCovered(w)).length;
    const openTicketsCount = warranties.filter((w) => w.status === "Claim open").length;

    const kpiCards = BW.ui.kpis([
      {
        label: "Total Warranties",
        value: warranties.length,
        icon: "shield-check",
        color: "blue",
        detail: "Registered solar hardware",
      },
      {
        label: "Active Coverage",
        value: coveredCount,
        icon: "circle-check",
        color: "green",
        detail: "Amount due ₹0 (Covered)",
      },
      {
        label: "Expired Coverage",
        value: expiredCount,
        icon: "activity",
        color: "amber",
        detail: "Parts & labour are billable",
      },
      {
        label: "Open Claims",
        value: openTicketsCount,
        icon: "wrench",
        color: "purple",
        detail: "Service tickets in progress",
      },
    ]);

    // Register Table Panel
    const panel = BW.ui.el("section", "panel");
    const panelHead = BW.ui.el("div", "panel-heading");
    panelHead.append(
      BW.ui.el("h2", "", "Warranty Ledger"),
      BW.ui.el("span", "muted", `${filtered.length} equipment records`),
    );

    const filterBar = BW.ui.el("div", "filters");

    const searchBox = BW.ui.el("label", "search-box");
    const searchInput = BW.ui.el("input");
    searchInput.placeholder = "Filter by Customer, Serial Number, Component...";
    searchInput.value = searchQuery;
    searchInput.oninput = BW.utils.debounce(() => {
      searchQuery = searchInput.value.trim();
      render();
    }, 200);
    searchBox.append(BW.ui.icon("search", 16), searchInput);

    const statusSelect = BW.ui.el("select");
    ["All Status", "Active", "Claim open", "Closed"].forEach((st) => {
      statusSelect.add(new Option(st, st));
    });
    statusSelect.value = statusFilter;
    statusSelect.onchange = () => {
      statusFilter = statusSelect.value;
      render();
    };

    filterBar.append(searchBox, statusSelect);
    panel.append(panelHead, filterBar);

    // Table matching Frame 9:
    // Warranty ID | Project ID / Customer | Product | Serial No. | Coverage Period | End Date | Status
    const tableEl = BW.ui.table({
      module: "Warranty",
      rows: filtered,
      columns: [
        {
          key: "id",
          label: "Warranty ID",
          render: (id, row) => {
            return BW.ui.button(id, () => openWarrantyDetailModal(row, render), "id-link");
          },
        },
        { key: "Customer", label: "Customer / Project", className: "primary-cell" },
        { key: "Component", label: "Product / Component" },
        {
          key: "Serial number",
          label: "Serial No.",
          render: (s) => BW.ui.el("code", "", s),
        },
        {
          key: "coverageYears",
          label: "Coverage",
          render: (y) => `${y || 2} Years`,
        },
        {
          key: "Expiry date",
          label: "End Date",
          format: "date",
        },
        {
          key: "status",
          label: "Status",
          render: (st, r) => {
            const covered = isCovered(r);
            const pill = BW.ui.el(
              "span",
              `badge ${st === "Claim open" ? "amber" : covered ? "green" : "red"}`,
              st === "Claim open" ? "Claim Open" : covered ? "Active" : "Expired",
            );
            return pill;
          },
        },
      ],
      actionsRenderer: (row) => {
        const btn = BW.ui.button(
          "Ticket",
          () => openTicketModal(row, render),
          "row-btn",
          "wrench",
        );
        btn.title = "Open / View Service Ticket";
        return btn;
      },
      onRowClick: (r) => openWarrantyDetailModal(r, render),
    });

    panel.append(tableEl);
    root.append(headingEl, lookupPanel, kpiCards, panel);
  }

  BW.controllers.Warranty = { render };
})();
