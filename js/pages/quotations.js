/**
 * Bijli Wala SIMS — Quotations Page Controller
 * Sales View: Selective Solar Kit Calculator + Custom ₹/kW Rate + Stock Check Gate [cite: 5].
 */
window.BW = window.BW || {};
window.BW.controllers = window.BW.controllers || {};

(() => {
  "use strict";

  let searchQuery = "";
  let statusFilter = "All Status";
  let locationFilter = "All Locations";

  function checkStockAvailability(kitConfig) {
    const inventory = BW.store.get("Inventory");
    const issues = [];

    // 1. Check Panel stock
    const panelItem = inventory.find((i) => i.id === "INV-1001" || i.Category === "Solar Panel");
    if (panelItem && Number(panelItem["Stock (units)"] || 0) < kitConfig.finalPanelQty) {
      issues.push({
        item: panelItem["Item name"],
        needed: kitConfig.finalPanelQty,
        available: Number(panelItem["Stock (units)"] || 0),
      });
    }

    // 2. Check Inverter stock
    const inverterItem = inventory.find(
      (i) => i.id === "INV-1003" || i.id === "INV-1004" || i.Category === "Inverter",
    );
    if (inverterItem && Number(inverterItem["Stock (units)"] || 0) < kitConfig.inverterQty) {
      issues.push({
        item: inverterItem["Item name"],
        needed: kitConfig.inverterQty,
        available: Number(inverterItem["Stock (units)"] || 0),
      });
    }

    // 3. Check Battery stock if Off-Grid
    if (kitConfig.systemType === "Off-Grid" && kitConfig.finalBatteryQty > 0) {
      const batteryItem = inventory.find((i) => i.Category === "Battery");
      if (!batteryItem || Number(batteryItem["Stock (units)"] || 0) < kitConfig.finalBatteryQty) {
        issues.push({
          item: batteryItem ? batteryItem["Item name"] : "Solar Battery",
          needed: kitConfig.finalBatteryQty,
          available: batteryItem ? Number(batteryItem["Stock (units)"] || 0) : 0,
        });
      }
    }

    return {
      ok: issues.length === 0,
      issues,
    };
  }

  function openQuotationBuilder(quote = null, onSaved, prefillSurvey = null) {
    const isNew = !quote || !quote.id;
    const canWrite = BW.auth.canWrite("Quotations");
    const isAccepted = quote?.status === "Accepted";

    const { dialog, body } = BW.ui.modal(
      isNew ? "New Solar Quotation Builder" : `Quotation Details · ${quote.id}`,
      "drawer",
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
        isAccepted
          ? "This quotation is Accepted & Locked. Parameters cannot be altered."
          : "Configure selective solar kits, adjust installation rates, and verify stock availability.",
      ),
      grid,
    );

    // Basic Fields
    const custField = BW.ui.field(grid, {
      name: "Customer",
      label: "Consumer Name",
      value: quote?.Customer || prefillSurvey?.Customer || "",
      required: true,
      readOnly: isAccepted || !canWrite,
    });

    const cityField = BW.ui.field(grid, {
      name: "City",
      label: "City / Location",
      options: BW.catalog.lists.cities,
      value: quote?.City || prefillSurvey?.City || "Pune",
      required: true,
      disabled: isAccepted || !canWrite,
    });

    const kwField = BW.ui.field(grid, {
      name: "Capacity (kW)",
      label: "System Capacity (kW)",
      options: BW.catalog.lists.capacities.map((k) => [k, `${k} kW`]),
      value: String(quote?.["Capacity (kW)"] || prefillSurvey?.["Capacity (kW)"] || "3"),
      required: true,
      disabled: isAccepted || !canWrite,
    });

    const systemField = BW.ui.field(grid, {
      name: "System type",
      label: "System Architecture",
      options: BW.catalog.lists.systemTypes,
      value: quote?.["System type"] || "On-Grid",
      required: true,
      disabled: isAccepted || !canWrite,
    });

    const schemeField = BW.ui.field(grid, {
      name: "Subsidy scheme",
      label: "Subsidy Scheme",
      options: BW.catalog.lists.subsidySchemes,
      value: quote?.["Subsidy scheme"] || "PM Surya Ghar Subsidy",
      required: true,
      disabled: isAccepted || !canWrite,
    });

    const statusField = BW.ui.field(grid, {
      name: "status",
      label: "Quotation Status",
      options: ["Draft", "Sent", "Accepted"],
      value: quote?.status || "Draft",
      required: true,
      disabled: isAccepted || !canWrite,
    });

    // Selective Kit Section
    const kitSection = BW.ui.el("section", "kit-calc");
    const kitHead = BW.ui.el("div", "kit-head");
    kitHead.append(
      BW.ui.el("h3", "", "Selective Solar Kit Calculator"),
      BW.ui.el(
        "small",
        "",
        "Select Tier-1 panels, inverters, and battery banks. Prices recompute live.",
      ),
    );

    const kitGrid = BW.ui.el("div", "form-grid");

    const panelSelect = BW.ui.field(kitGrid, {
      name: "panelId",
      label: "Solar Panel Module",
      options: BW.catalog.catalogue.panels.map((p) => [
        p.id,
        `${p.name} — ${BW.utils.formatINR(p.price)}/panel · ${p.warranty}`,
      ]),
      value: quote?.kit?.panelId || "waaree-540",
      disabled: isAccepted || !canWrite,
    });

    const panelQtyInput = BW.ui.field(kitGrid, {
      name: "panelQty",
      label: "Panel Quantity (Nos)",
      type: "number",
      value: quote?.kit?.panelQty || "",
      min: 1,
      placeholder: "Auto-calculated",
      readOnly: isAccepted || !canWrite,
      hint: "Leave blank for automated capacity sizing",
    });

    const inverterSelect = BW.ui.field(kitGrid, {
      name: "inverterId",
      label: "Solar Inverter",
      options: BW.catalog.catalogue.inverters.map((i) => [
        i.id,
        `${i.name} — ${BW.utils.formatINR(i.price)} · ${i.warranty}`,
      ]),
      value: quote?.kit?.inverterId || "growatt-3",
      disabled: isAccepted || !canWrite,
    });

    const batterySelect = BW.ui.field(kitGrid, {
      name: "batteryId",
      label: "Battery Bank (Off-Grid)",
      options: BW.catalog.catalogue.batteries.map((b) => [
        b.id,
        `${b.name} — ${BW.utils.formatINR(b.price)} · ${b.warranty}`,
      ]),
      value: quote?.kit?.batteryId || "luminous-150",
      disabled: isAccepted || !canWrite,
    });

    const mountingSelect = BW.ui.field(kitGrid, {
      name: "mountingId",
      label: "Mounting & BOS Structure",
      options: BW.catalog.catalogue.mounting.map((m) => [
        m.id,
        `${m.name} — ${BW.utils.formatINR(m.price)} · ${m.warranty}`,
      ]),
      value: quote?.kit?.mountingId || "gi-std",
      disabled: isAccepted || !canWrite,
    });

    // Custom Installation Rate input
    const rateInput = BW.ui.field(kitGrid, {
      name: "installRate",
      label: "Custom Installation Rate (₹/kW)",
      type: "number",
      value: quote?.kit?.installRatePerKw || 4500,
      min: 0,
      step: 100,
      readOnly: isAccepted || !canWrite,
      hint: "Default standard labour & civil rate is ₹4,500/kW",
    });

    // Stock Verification Gate Panel
    const stockGateBox = BW.ui.el("div", "stock-gate-box");

    // Live Totals Output Box
    const totalsBox = BW.ui.el("div", "kit-out");

    kitSection.append(kitHead, kitGrid, stockGateBox, totalsBox);
    form.append(kitSection, alertEl);

    let currentCalculatedTotals = null;

    function recalculate() {
      const kw = Number(kwField.value) || 3;
      const isManualPanel = panelQtyInput.value.trim() !== "";
      const isOffGrid = systemField.value === "Off-Grid";

      batterySelect.closest("label").hidden = !isOffGrid;

      const calc = BW.catalog.calculateKit({
        capacityKw: kw,
        systemType: systemField.value,
        subsidyScheme: schemeField.value,
        panelId: panelSelect.value,
        inverterId: inverterSelect.value,
        batteryId: batterySelect.value,
        mountingId: mountingSelect.value,
        panelQtyManual: isManualPanel,
        panelQty: Number(panelQtyInput.value),
        installRatePerKw: Number(rateInput.value) || 4500,
      });

      currentCalculatedTotals = calc;

      if (!isManualPanel) {
        panelQtyInput.placeholder = `Auto: ${calc.finalPanelQty} panels`;
      }

      // Stock Check Gate verification
      const stockCheck = checkStockAvailability(calc);
      stockGateBox.replaceChildren();

      if (stockCheck.ok) {
        const okBadge = BW.ui.el("div", "stock-badge stock-badge-ok");
        okBadge.append(BW.ui.icon("circle-check"), " Stock Check Gate: All equipment in stock in warehouse.");
        stockGateBox.append(okBadge);
      } else {
        const warnBadge = BW.ui.el("div", "stock-badge stock-badge-warn");
        const details = stockCheck.issues
          .map((i) => `${i.item} (Avail: ${i.available}, Req: ${i.needed})`)
          .join("; ");
        warnBadge.append(
          BW.ui.icon("alert-triangle"),
          ` Stock Shortage Warning: ${details}. Material procurement required!`,
        );
        stockGateBox.append(warnBadge);
      }

      // Render Price Breakdown
      totalsBox.innerHTML = `
        <div class="kit-totals">
          <div class="kit-total-row">
            <span>Equipment Subtotal (${calc.bomLines.length} line items):</span>
            <strong>${BW.utils.formatINR(calc.equipmentSubtotal)}</strong>
          </div>
          <div class="kit-total-row">
            <span>Installation & Commissioning (${calc.kw} kW @ ${BW.utils.formatINR(rateInput.value || 4500)}/kW):</span>
            <strong>${BW.utils.formatINR(calc.installationSubtotal)}</strong>
          </div>
          <div class="kit-total-row">
            <span>GST (5% Goods + 18% Services):</span>
            <strong>${BW.utils.formatINR(calc.totalGst)}</strong>
          </div>
          <div class="kit-total-row kit-gross-row">
            <span>Gross Total Quotation Amount:</span>
            <strong>${BW.utils.formatINR(calc.grossTotal)}</strong>
          </div>
          <div class="kit-total-row kit-subsidy-row">
            <span>Central Subsidy (PM Surya Ghar):</span>
            <strong style="color: #34D399">- ${BW.utils.formatINR(calc.subsidy)}</strong>
          </div>
          <div class="kit-total-row kit-net-row">
            <span>Net Customer Cost (Post-Subsidy):</span>
            <strong style="color: #F59E0B; font-size: 1.3rem;">${BW.utils.formatINR(calc.netCustomerPayable)}</strong>
          </div>
        </div>
      `;
    }

    [
      kwField,
      systemField,
      schemeField,
      panelSelect,
      inverterSelect,
      batterySelect,
      mountingSelect,
      panelQtyInput,
      rateInput,
    ].forEach((ctrl) => ctrl.addEventListener("input", recalculate));

    recalculate();

    const actions = BW.ui.el("div", "modal-actions");
    const closeBtn = BW.ui.button(canWrite && !isAccepted ? "Cancel" : "Close", () => dialog.close());
    actions.append(closeBtn);

    if (canWrite && !isAccepted) {
      const saveBtn = BW.ui.button(
        isNew ? "Create Quotation" : "Save Quotation",
        null,
        "primary-btn",
        "check",
      );
      saveBtn.type = "submit";
      actions.append(saveBtn);
    } else if (isAccepted) {
      actions.prepend(BW.ui.lockBadge(), " Accepted Quotations are Immutable");
    }

    form.append(actions);
    body.append(form);

    // Sales Workflow: Advance to Project if Accepted
    if (!isNew && quote.status === "Accepted") {
      const wf = BW.ui.el("div", "workflow");
      wf.append(BW.ui.el("small", "", "Next Stage:"));

      const projects = BW.store.get("Projects");
      const existingPrj = projects.find((p) => p.sourceQuotationId === quote.id);

      if (existingPrj) {
        const openPrjBtn = BW.ui.button(
          `Open Project ${existingPrj.id}`,
          () => {
            dialog.close();
            location.href = `projects.html#${existingPrj.id}`;
          },
          "primary-btn",
          "folder-kanban",
        );
        wf.append(openPrjBtn);
      } else {
        const createPrjBtn = BW.ui.button(
          "Create Project",
          () => {
            const newPrj = {
              "Project name": `${quote.Customer} Residence`,
              customerEmail: quote.customerEmail || "",
              City: quote.City,
              "Capacity (kW)": quote["Capacity (kW)"],
              "Lead engineer": "Priya Shah",
              "Crew lead": "Vikram Singh (Crew Alpha)",
              "System type": quote["System type"],
              "Subsidy scheme": quote["Subsidy scheme"],
              stage: "Planning",
              status: "Planning",
              revenue: quote["Amount (₹)"],
              sourceQuotationId: quote.id,
            };
            const savedPrj = BW.store.save("Projects", newPrj);
            dialog.close();
            BW.ui.toast(`Project ${savedPrj.id} created!`);
            location.href = `projects.html#${savedPrj.id}`;
          },
          "primary-btn",
          "plus",
        );
        wf.append(createPrjBtn);
      }
      body.append(wf);
    }

    form.onsubmit = (e) => {
      e.preventDefault();
      alertEl.hidden = true;

      try {
        const grossAmount = currentCalculatedTotals
          ? currentCalculatedTotals.grossTotal
          : Number(quote?.["Amount (₹)"]) || 165000;

        const record = {
          ...(quote || {}),
          Customer: custField.value.trim(),
          City: cityField.value,
          "Capacity (kW)": Number(kwField.value) || 3,
          "System type": systemField.value,
          "Subsidy scheme": schemeField.value,
          "Amount (₹)": grossAmount,
          status: statusField.value,
          sourceSurveyId: prefillSurvey?.id || quote?.sourceSurveyId || null,
          kit: {
            panelId: panelSelect.value,
            panelQty: currentCalculatedTotals?.finalPanelQty,
            inverterId: inverterSelect.value,
            batteryId: batterySelect.value,
            mountingId: mountingSelect.value,
            installRatePerKw: Number(rateInput.value) || 4500,
          },
          totals: currentCalculatedTotals,
        };

        BW.store.save("Quotations", record);
        dialog.close();
        BW.ui.toast(isNew ? "Quotation generated" : "Quotation updated");
        onSaved();
      } catch (err) {
        alertEl.textContent = err.message;
        alertEl.hidden = false;
      }
    };
  }

  function render() {
    const root = document.querySelector("#page-content");
    if (!root) return;
    root.replaceChildren();

    const quotations = BW.store.get("Quotations");
    const canCreate = BW.auth.canWrite("Quotations");

    const headingEl = BW.ui.heading(
      "Quotations",
      "Prepare solar kit estimates, adjust installation rates, verify warehouse stock, and follow customer approvals.",
      canCreate
        ? BW.ui.button(
            "New Quotation",
            () => openQuotationBuilder(null, render),
            "primary-btn",
            "plus",
          )
        : BW.ui.viewOnly(),
    );

    const filtered = quotations.filter((q) => {
      const matchesSearch =
        !searchQuery ||
        [q.id, q.Customer, q.City, q.status, q["System type"]]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "All Status" || q.status === statusFilter;

      const matchesLocation =
        locationFilter === "All Locations" || q.City === locationFilter;

      return matchesSearch && matchesStatus && matchesLocation;
    });

    const kpiCards = BW.ui.kpis([
      {
        label: "Total Quotations",
        value: quotations.length,
        icon: "file-text",
        color: "blue",
        detail: `${filtered.length} in current view`,
      },
      {
        label: "Draft",
        value: quotations.filter((q) => q.status === "Draft").length,
        icon: "activity",
        color: "teal",
        detail: "Estimates in progress",
      },
      {
        label: "Sent",
        value: quotations.filter((q) => q.status === "Sent").length,
        icon: "clipboard-list",
        color: "amber",
        detail: "Awaiting customer decision",
      },
      {
        label: "Accepted",
        value: quotations.filter((q) => q.status === "Accepted").length,
        icon: "circle-check",
        color: "green",
        detail: "Approved for build",
      },
    ]);

    const panel = BW.ui.el("section", "panel");
    const panelHead = BW.ui.el("div", "panel-heading");
    panelHead.append(
      BW.ui.el("h2", "", "Quotation Register"),
      BW.ui.el("span", "muted", `${filtered.length} proposals`),
    );

    const filterBar = BW.ui.el("div", "filters");

    // Search input
    const searchBox = BW.ui.el("label", "search-box");
    const searchInput = BW.ui.el("input");
    searchInput.placeholder = "Search by Consumer Name, ID, Location...";
    searchInput.value = searchQuery;
    searchInput.oninput = BW.utils.debounce(() => {
      searchQuery = searchInput.value.trim();
      render();
    }, 200);
    searchBox.append(BW.ui.icon("search", 16), searchInput);

    // Status filter
    const statusSelect = BW.ui.el("select");
    ["All Status", "Draft", "Sent", "Accepted"].forEach((st) => {
      statusSelect.add(new Option(st, st));
    });
    statusSelect.value = statusFilter;
    statusSelect.onchange = () => {
      statusFilter = statusSelect.value;
      render();
    };

    // Location filter
    const locSelect = BW.ui.el("select");
    locSelect.add(new Option("All Locations", "All Locations"));
    BW.catalog.lists.cities.forEach((c) => locSelect.add(new Option(c, c)));
    locSelect.value = locationFilter;
    locSelect.onchange = () => {
      locationFilter = locSelect.value;
      render();
    };

    filterBar.append(searchBox, statusSelect, locSelect);
    panel.append(panelHead, filterBar);

    // Table matching Frame 5
    const tableEl = BW.ui.table({
      module: "Quotations",
      rows: filtered,
      columns: [
        {
          key: "id",
          label: "Quotation ID",
          render: (id, row) => {
            return BW.ui.button(id, () => openQuotationBuilder(row, render), "id-link");
          },
        },
        { key: "Customer", label: "Consumer Name", className: "primary-cell" },
        {
          key: "Capacity (kW)",
          label: "System Size",
          render: (kw) => `${kw} kW`,
        },
        {
          key: "Amount (₹)",
          label: "Estimated Cost",
          format: "inr",
        },
        {
          key: "status",
          label: "Status",
          render: (st, r) => {
            const wrap = BW.ui.el("span", "status-cell-wrap");
            wrap.append(BW.ui.statusPill(st));
            if (st === "Accepted") wrap.append(" ", BW.ui.lockBadge());
            return wrap;
          },
        },
      ],
      onRowClick: (r) => openQuotationBuilder(r, render),
    });

    panel.append(tableEl);
    root.append(headingEl, kpiCards, panel);

    // Check hash anchor to auto-open quotation
    if (location.hash) {
      if (location.hash.startsWith("#new-from-survey=")) {
        const srvId = location.hash.split("=")[1];
        const surveys = BW.store.get("Surveys");
        const srv = surveys.find((s) => s.id === srvId);
        history.replaceState(null, "", location.pathname);
        openQuotationBuilder(null, render, srv);
      } else if (location.hash.startsWith("#QTN-")) {
        const qId = location.hash.slice(1);
        const q = quotations.find((item) => item.id === qId);
        if (q) {
          history.replaceState(null, "", location.pathname);
          openQuotationBuilder(q, render);
        }
      }
    }
  }

  BW.controllers.Quotations = { render };
})();
