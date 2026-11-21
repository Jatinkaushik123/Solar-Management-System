/**
 * Bijli Wala SIMS — Inventory Page Controller
 * Inventory Keeper View: Stock Verification against Quotations + Add Items + Dispatch Serials [cite: 7].
 */
window.BW = window.BW || {};
window.BW.controllers = window.BW.controllers || {};

(() => {
  "use strict";

  let searchQuery = "";
  let statusFilter = "All Status";
  let categoryFilter = "All Categories";

  function openAddItemModal(item = null, onSaved) {
    const isNew = !item || !item.id;
    const canWrite = BW.auth.can("addInventory") || BW.auth.canWrite("Inventory");
    const isLocked = item?.dispatches && item.dispatches.length > 0;

    const { dialog, body } = BW.ui.modal(
      isNew ? "Add Inventory Item" : `Edit Item · ${item.id}`,
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
        isNew
          ? "Add a new solar component, panel SKU, inverter or BOS material to warehouse inventory."
          : `Item SKU: ${item.id} · ${isLocked ? "Category & Brand locked after dispatch" : "Editable"}`,
      ),
      grid,
      alertEl,
    );

    const nameField = BW.ui.field(grid, {
      name: "Item name",
      label: "Component / Item Name",
      value: item?.["Item name"] || "",
      required: true,
      readOnly: isLocked || !canWrite,
    });

    const catField = BW.ui.field(grid, {
      name: "Category",
      label: "Category",
      options: BW.catalog.lists.categories,
      value: item?.Category || "Solar Panel",
      required: true,
      disabled: isLocked || !canWrite,
    });

    const brandField = BW.ui.field(grid, {
      name: "Brand",
      label: "Manufacturer / Brand",
      options: BW.catalog.lists.brands,
      value: item?.Brand || "Waaree",
      required: true,
      disabled: isLocked || !canWrite,
    });

    const stockField = BW.ui.field(grid, {
      name: "Stock (units)",
      label: isNew ? "Initial Stock Quantity" : "Current Stock (units)",
      type: "number",
      value: item?.["Stock (units)"] ?? 10,
      min: 0,
      required: true,
      readOnly: !canWrite,
    });

    const reorderField = BW.ui.field(grid, {
      name: "Reorder level",
      label: "Reorder Level (Threshold)",
      type: "number",
      value: item?.["Reorder level"] ?? 10,
      min: 1,
      required: true,
      readOnly: !canWrite,
    });

    const unitField = BW.ui.field(grid, {
      name: "Unit",
      label: "Measurement Unit",
      options: BW.catalog.lists.units,
      value: item?.Unit || "Nos",
      required: true,
      disabled: !canWrite,
    });

    const priceField = BW.ui.field(grid, {
      name: "Unit price (₹)",
      label: "Unit Purchase Price (₹)",
      type: "number",
      value: item?.["Unit price (₹)"] ?? 14500,
      min: 0,
      step: 10,
      required: true,
      readOnly: !canWrite,
    });

    // Display dispatch history if available
    if (item?.dispatches && item.dispatches.length > 0) {
      const histSec = BW.ui.el("div", "dispatch-history-wrap");
      histSec.append(BW.ui.el("h3", "", "Serial Dispatch History"));
      const ul = BW.ui.el("ul", "dispatch-list");

      item.dispatches.forEach((d) => {
        const li = BW.ui.el("li");
        li.append(
          BW.ui.el("code", "", d.serial),
          BW.ui.el("span", "", `${d.project} · ${BW.utils.formatDate(d.date)}`),
          BW.ui.lockBadge(),
        );
        ul.append(li);
      });
      histSec.append(ul);
      form.append(histSec);
    }

    const actions = BW.ui.el("div", "modal-actions");
    const closeBtn = BW.ui.button(canWrite ? "Cancel" : "Close", () => dialog.close());
    actions.append(closeBtn);

    if (canWrite) {
      const saveBtn = BW.ui.button(
        isNew ? "Add Item" : "Save Changes",
        null,
        "primary-btn",
        "check",
      );
      saveBtn.type = "submit";
      actions.append(saveBtn);
    }

    form.append(actions);
    body.append(form);

    form.onsubmit = (e) => {
      e.preventDefault();
      alertEl.hidden = true;

      try {
        const record = {
          ...(item || {}),
          "Item name": nameField.value.trim(),
          Category: catField.value,
          Brand: brandField.value,
          "Stock (units)": Number(stockField.value) || 0,
          "Reorder level": Number(reorderField.value) || 10,
          Unit: unitField.value,
          "Unit price (₹)": Number(priceField.value) || 0,
          dispatches: item?.dispatches || [],
        };

        BW.store.save("Inventory", record);
        dialog.close();
        BW.ui.toast(isNew ? "Inventory item added" : "Item updated");
        onSaved();
      } catch (err) {
        alertEl.textContent = err.message;
        alertEl.hidden = false;
      }
    };
  }

  function openStockVerificationModal() {
    const { dialog, body } = BW.ui.modal("Stock Verification against Quotations", "drawer");
    const quotations = BW.store.get("Quotations");
    const inventory = BW.store.get("Inventory");

    const content = BW.ui.el("div", "verification-content");
    content.append(
      BW.ui.el(
        "p",
        "form-caption",
        "Select an active or pending quotation to check if warehouse inventory has sufficient stock for all kit equipment.",
      ),
    );

    const selectRow = BW.ui.el("div", "form-grid");
    const quoteSelect = BW.ui.field(selectRow, {
      name: "quotationSelect",
      label: "Select Quotation to Verify",
      options: quotations.map((q) => [
        q.id,
        `${q.id} · ${q.Customer} (${q["Capacity (kW)"]} kW ${q["System type"] || "On-Grid"}) — Status: ${q.status}`,
      ]),
      value: quotations[0]?.id || "",
    });

    const resultsBox = BW.ui.el("div", "verification-results");
    content.append(selectRow, resultsBox);

    function runVerification() {
      resultsBox.replaceChildren();
      const selectedId = quoteSelect.value;
      const quote = quotations.find((q) => q.id === selectedId);
      if (!quote) return;

      const kw = Number(quote["Capacity (kW)"]) || 3;
      const isOffGrid = quote["System type"] === "Off-Grid";

      // BOM requirements
      const requiredPanels = Math.ceil((kw * 1000) / 540); // Standard 540W modules
      const requiredInverters = 1;
      const requiredBatteries = isOffGrid ? Math.max(1, Math.ceil(kw * 1)) : 0;
      const requiredMounting = 1;

      const itemsCheck = [
        {
          name: "Solar Panels (Waaree/Tata 540W+)",
          category: "Solar Panel",
          needed: requiredPanels,
          unit: "Nos",
        },
        {
          name: "Inverters (Growatt/Sungrow)",
          category: "Inverter",
          needed: requiredInverters,
          unit: "Nos",
        },
        ...(isOffGrid
          ? [
              {
                name: "Solar Batteries (Exide/Luminous)",
                category: "Battery",
                needed: requiredBatteries,
                unit: "Nos",
              },
            ]
          : []),
        {
          name: "Mounting Structure & BOS Kit",
          category: "Mounting Structure",
          needed: requiredMounting,
          unit: "Set",
        },
      ];

      const table = BW.ui.el("table", "verification-table");
      const thead = table.createTHead().insertRow();
      ["Component Category", "Required Qty", "Available in Warehouse", "Shortage", "Stock Gate Status"].forEach(
        (h) => {
          const th = BW.ui.el("th");
          th.textContent = h;
          thead.append(th);
        },
      );

      const tbody = table.createTBody();
      let allPassed = true;

      itemsCheck.forEach((chk) => {
        const inStockItems = inventory.filter((i) => i.Category === chk.category);
        const totalAvailable = inStockItems.reduce(
          (sum, i) => sum + Number(i["Stock (units)"] || 0),
          0,
        );
        const shortage = Math.max(0, chk.needed - totalAvailable);
        const isSufficient = totalAvailable >= chk.needed;
        if (!isSufficient) allPassed = false;

        const row = tbody.insertRow();
        row.insertCell().textContent = chk.name;
        row.insertCell().textContent = `${chk.needed} ${chk.unit}`;
        row.insertCell().textContent = `${totalAvailable} ${chk.unit}`;

        const shortageCell = row.insertCell();
        shortageCell.textContent = shortage > 0 ? `${shortage} ${chk.unit}` : "0";
        if (shortage > 0) shortageCell.style.color = "#EF4444";

        const statusCell = row.insertCell();
        statusCell.append(
          BW.ui.el(
            "span",
            `badge ${isSufficient ? "green" : "red"}`,
            isSufficient ? "Sufficient" : "Stock Shortage",
          ),
        );
      });

      table.append(tbody);

      const summaryCard = BW.ui.el(
        "div",
        `verification-summary ${allPassed ? "summary-passed" : "summary-failed"}`,
      );
      summaryCard.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <strong>${allPassed ? "✓ Stock Verification Passed" : "⚠️ Stock Shortage Alert"}</strong>
        </div>
        <p style="margin: 6px 0 0; font-size: 0.9rem; color: #c4d3e5;">
          ${
            allPassed
              ? "All required components for this quotation are available in stock. Ready to proceed with project dispatch!"
              : "Warehouse stock is insufficient to fulfill this quotation. Please issue procurement reorders before commissioning."
          }
        </p>
      `;

      resultsBox.append(table, summaryCard);
    }

    quoteSelect.onchange = runVerification;
    runVerification();

    const actions = BW.ui.el("div", "modal-actions");
    actions.append(BW.ui.button("Close", () => dialog.close(), "primary-btn"));
    content.append(actions);
    body.append(content);
  }

  function openDispatchScannerModal(prefillItem = null, onSaved) {
    const { dialog, body } = BW.ui.modal("Dispatch Serial Number to Project", "spotlight");
    const form = BW.ui.el("form");
    const grid = BW.ui.el("div", "form-grid");
    const inventory = BW.store.get("Inventory");
    const projects = BW.store.get("Projects");

    const alertEl = BW.ui.el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;

    form.append(
      BW.ui.el(
        "p",
        "form-caption",
        "Scan hardware serial barcode. Dispatching links the serial to destination project and registers warranty coverage.",
      ),
      grid,
      alertEl,
    );

    const itemSelect = BW.ui.field(grid, {
      name: "itemId",
      label: "Inventory Stock Item",
      options: inventory.map((i) => [
        i.id,
        `${i["Item name"]} · Stock: ${i["Stock (units)"]} ${i.Unit || "units"}`,
      ]),
      value: prefillItem?.id || inventory[0]?.id || "",
      required: true,
    });

    const serialInput = BW.ui.field(grid, {
      name: "serial",
      label: "Scan / Enter Hardware Serial Number",
      required: true,
      placeholder: "e.g. WAA-540-9901, GW-3K-8822",
      hint: "Trimmed and uppercased; verified for uniqueness across all warranties.",
    });

    const projectSelect = BW.ui.field(grid, {
      name: "projectId",
      label: "Destination Project",
      options: projects.map((p) => [p.id, `${p["Project name"]} (${p.id}) · ${p.City}`]),
      value: projects[0]?.id || "",
      required: true,
    });

    const actions = BW.ui.el("div", "modal-actions");
    const cancelBtn = BW.ui.button("Cancel", () => dialog.close());
    const submitBtn = BW.ui.button("Commit Dispatch", null, "primary-btn", "boxes");
    submitBtn.type = "submit";

    actions.append(cancelBtn, submitBtn);
    form.append(actions);
    body.append(form);

    serialInput.focus();

    form.onsubmit = (e) => {
      e.preventDefault();
      alertEl.hidden = true;

      const code = serialInput.value.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9-/]{3,}$/.test(code)) {
        alertEl.textContent =
          "Please enter a valid serial number (letters, digits, - or /; at least 4 characters).";
        alertEl.hidden = false;
        return;
      }

      try {
        const result = BW.store.dispatchSerial(
          itemSelect.value,
          code,
          projectSelect.value,
        );

        dialog.close();
        BW.ui.toast(
          result.warranty
            ? `Serial ${code} dispatched · Registered ${result.warranty.coverageYears}-year warranty ${result.warranty.id}`
            : `Serial ${code} dispatched to project ${projectSelect.value}`,
        );
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

    const inventory = BW.store.get("Inventory");
    const canDispatch = BW.auth.can("dispatch");
    const canAdd = BW.auth.can("addInventory") || BW.auth.canWrite("Inventory");

    const headerActions = BW.ui.el("div", "header-tools");
    headerActions.append(
      BW.ui.button(
        "Verify Against Quotations",
        () => openStockVerificationModal(),
        "secondary-btn",
        "file-text",
      ),
    );

    if (canDispatch) {
      headerActions.append(
        BW.ui.button(
          "Dispatch Serials",
          () => openDispatchScannerModal(null, render),
          "primary-btn",
          "boxes",
        ),
      );
    }

    if (canAdd) {
      headerActions.append(
        BW.ui.button(
          "Add Item",
          () => openAddItemModal(null, render),
          "secondary-btn",
          "plus",
        ),
      );
    }

    const headingEl = BW.ui.heading(
      "Inventory",
      "Warehouse stock tracking, bill-of-materials verification against quotations, and serial number dispatches.",
      headerActions,
    );

    const filtered = inventory.filter((item) => {
      const matchesSearch =
        !searchQuery ||
        [item.id, item["Item name"], item.Category, item.Brand, item.status]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "All Status" || item.status === statusFilter;

      const matchesCat =
        categoryFilter === "All Categories" || item.Category === categoryFilter;

      return matchesSearch && matchesStatus && matchesCat;
    });

    const totalOnHand = inventory.reduce(
      (sum, i) => sum + (Number(i["Stock (units)"]) || 0),
      0,
    );

    const kpiCards = BW.ui.kpis([
      {
        label: "Total Items",
        value: inventory.length,
        icon: "boxes",
        color: "blue",
        detail: `${filtered.length} matching current filter`,
      },
      {
        label: "In Stock",
        value: inventory.filter((i) => i.status === "In Stock").length,
        icon: "circle-check",
        color: "green",
        detail: "Above reorder threshold",
      },
      {
        label: "Low Stock / Out",
        value: inventory.filter((i) => i.status !== "In Stock").length,
        icon: "activity",
        color: "amber",
        detail: "Requires procurement order",
      },
      {
        label: "Units on Hand",
        value: totalOnHand,
        unit: "Units",
        icon: "layers",
        color: "purple",
        detail: "Across warehouse shelves",
      },
    ]);

    const panel = BW.ui.el("section", "panel");
    const panelHead = BW.ui.el("div", "panel-heading");
    panelHead.append(
      BW.ui.el("h2", "", "Stock Register"),
      BW.ui.el("span", "muted", `${filtered.length} items`),
    );

    const filterBar = BW.ui.el("div", "filters");

    // Search input
    const searchBox = BW.ui.el("label", "search-box");
    const searchInput = BW.ui.el("input");
    searchInput.placeholder = "Search item name, brand, SKU...";
    searchInput.value = searchQuery;
    searchInput.oninput = BW.utils.debounce(() => {
      searchQuery = searchInput.value.trim();
      render();
    }, 200);
    searchBox.append(BW.ui.icon("search", 16), searchInput);

    // Status filter
    const statusSelect = BW.ui.el("select");
    ["All Status", "In Stock", "Low stock", "Out of stock"].forEach((st) => {
      statusSelect.add(new Option(st, st));
    });
    statusSelect.value = statusFilter;
    statusSelect.onchange = () => {
      statusFilter = statusSelect.value;
      render();
    };

    // Category filter
    const catSelect = BW.ui.el("select");
    catSelect.add(new Option("All Categories", "All Categories"));
    BW.catalog.lists.categories.forEach((cat) => catSelect.add(new Option(cat, cat)));
    catSelect.value = categoryFilter;
    catSelect.onchange = () => {
      categoryFilter = catSelect.value;
      render();
    };

    filterBar.append(searchBox, statusSelect, catSelect);
    panel.append(panelHead, filterBar);

    // Table matching Frame 7
    const tableEl = BW.ui.table({
      module: "Inventory",
      rows: filtered,
      columns: [
        {
          key: "id",
          label: "Item ID",
          render: (id, row) => {
            return BW.ui.button(id, () => openAddItemModal(row, render), "id-link");
          },
        },
        { key: "Item name", label: "Item Name", className: "primary-cell" },
        { key: "Category", label: "Category" },
        { key: "Brand", label: "Brand" },
        {
          key: "Stock (units)",
          label: "Stock",
          render: (units, row) => `${units} ${row.Unit || "Nos"}`,
        },
        { key: "Unit price (₹)", label: "Unit Price", format: "inr" },
        { key: "status", label: "Status" },
      ],
      actionsRenderer: (row) => {
        const wrap = BW.ui.el("div", "row-actions");
        if (canDispatch && Number(row["Stock (units)"] || 0) > 0) {
          const dispatchBtn = BW.ui.button(
            "Dispatch",
            () => openDispatchScannerModal(row, render),
            "row-btn",
            "boxes",
          );
          dispatchBtn.title = "Dispatch serial number";
          wrap.append(dispatchBtn);
        }
        return wrap;
      },
    });

    panel.append(tableEl);
    root.append(headingEl, kpiCards, panel);
  }

  BW.controllers.Inventory = { render };
})();
