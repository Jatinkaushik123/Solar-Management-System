/**
 * Bijli Wala SIMS — Surveys Page Controller
 * Technician View: Review, Edit, Approve, or Reject Customer Site Surveys [cite: 4].
 */
window.BW = window.BW || {};
window.BW.controllers = window.BW.controllers || {};

(() => {
  "use strict";

  let searchQuery = "";
  let statusFilter = "All Status";
  let locationFilter = "All Locations";

  function openSurveyEditor(survey = null, onSaved) {
    const isNew = !survey || !survey.id;
    const canWrite = BW.auth.canWrite("Surveys");
    const { dialog, body } = BW.ui.modal(
      isNew ? "New Site Survey" : `Survey Details · ${survey.id}`,
      "drawer",
    );

    const form = BW.ui.el("form");
    // Checks run in onsubmit so errors show in the inline alert, and an unchanged
    // historical date is not rejected by the native min attribute.
    form.noValidate = true;
    const grid = BW.ui.el("div", "form-grid");
    const alertEl = BW.ui.el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;

    form.append(
      BW.ui.el(
        "p",
        "form-caption",
        isNew
          ? "Create a new rooftop feasibility survey request."
          : `Review technical parameters, shading analysis, and grid feasibility for ${survey.Customer}.`,
      ),
      grid,
      alertEl,
    );

    const custField = BW.ui.field(grid, {
      name: "Customer",
      label: "Consumer Name",
      value: survey?.Customer || "",
      required: true,
      readOnly: !canWrite,
    });

    const cityField = BW.ui.field(grid, {
      name: "City",
      label: "City / Location",
      options: BW.catalog.lists.cities,
      value: survey?.City || "Pune",
      required: true,
      disabled: !canWrite,
    });

    const roofTypeField = BW.ui.field(grid, {
      name: "Roof type",
      label: "Roof Type",
      options: BW.catalog.lists.roofTypes,
      value: survey?.["Roof type"] || "RCC terrace",
      required: true,
      disabled: !canWrite,
    });

    const roofDirField = BW.ui.field(grid, {
      name: "Roof Direction",
      label: "Roof Direction",
      options: BW.catalog.lists.roofDirections,
      value: survey?.["Roof Direction"] || "South",
      required: true,
      disabled: !canWrite,
    });

    const tiltField = BW.ui.field(grid, {
      name: "Tilt (0–90°)",
      label: "Tilt Angle (0–90°)",
      type: "number",
      value: survey?.["Tilt (0–90°)"] ?? 22,
      min: 0,
      max: 90,
      step: 1,
      required: true,
      readOnly: !canWrite,
      hint: "Optimal tilt is 15–28° for Western/Central India",
    });

    const cableField = BW.ui.field(grid, {
      name: "Cable Distance (m)",
      label: "Cable Run Distance (metres)",
      type: "number",
      value: survey?.["Cable Distance (m)"] ?? 15,
      min: 1,
      step: 0.5,
      required: true,
      readOnly: !canWrite,
    });

    const gridSuitField = BW.ui.field(grid, {
      name: "Grid suitability",
      label: "DISCOM Grid Suitability",
      options: BW.catalog.lists.gridSuitability,
      value: survey?.["Grid suitability"] || "Suitable",
      required: true,
      disabled: !canWrite,
    });

    const surveyorField = BW.ui.field(grid, {
      name: "Surveyor",
      label: "Assigned Surveyor",
      options: BW.catalog.lists.surveyors,
      value: survey?.Surveyor || "Sneha Rao",
      required: true,
      disabled: !canWrite,
    });

    const dateField = BW.ui.field(grid, {
      name: "Survey date",
      label: "Survey Date",
      type: "date",
      value: survey?.["Survey date"] || BW.utils.getTodayISO(),
      required: true,
      readOnly: !canWrite,
    });
    const checkSurveyDate = canWrite
      ? BW.utils.guardFutureDate(dateField, alertEl, "Survey date", survey?.["Survey date"] || "")
      : () => "";

    const statusField = BW.ui.field(grid, {
      name: "status",
      label: "Survey Status",
      options: ["Scheduled", "Surveyed", "Approved", "Rejected"],
      value: survey?.status || "Scheduled",
      required: true,
      disabled: !canWrite,
    });

    const notesField = BW.ui.field(grid, {
      name: "Notes",
      label: "Shading, Structure & Access Notes",
      type: "textarea",
      value: survey?.Notes || "",
      readOnly: !canWrite,
      placeholder: "Note shadow from parapet walls, trees, water tanks, cable conduits...",
    });

    // If survey is rejected, display rejection reason
    if (survey?.status === "Rejected" && survey.rejectionReason) {
      const rejBox = BW.ui.el("div", "form-warning");
      rejBox.textContent = `Rejection Reason: ${survey.rejectionReason}`;
      form.append(rejBox);
    }

    const actions = BW.ui.el("div", "modal-actions");
    const closeBtn = BW.ui.button(canWrite ? "Cancel" : "Close", () => dialog.close());
    actions.append(closeBtn);

    if (canWrite) {
      const saveBtn = BW.ui.button(
        isNew ? "Create Survey" : "Save Survey",
        null,
        "primary-btn",
        "check",
      );
      saveBtn.type = "submit";
      actions.append(saveBtn);
    }

    form.append(actions);
    body.append(form);

    // Technician Workflow Actions
    if (!isNew && canWrite && BW.auth.can("approveSurvey")) {
      const workflowRow = BW.ui.el("div", "workflow");
      workflowRow.append(BW.ui.el("small", "", "Technical Decision:"));

      if (survey.status !== "Approved") {
        const approveBtn = BW.ui.button(
          "Approve Survey",
          () => {
            const tiltVal = Number(tiltField.value);
            if (tiltVal < 0 || tiltVal > 90) {
              alertEl.textContent = "Tilt must be between 0 and 90 degrees.";
              alertEl.hidden = false;
              return;
            }
            BW.store.save("Surveys", {
              ...survey,
              Customer: custField.value.trim(),
              City: cityField.value,
              "Roof type": roofTypeField.value,
              "Roof Direction": roofDirField.value,
              "Tilt (0–90°)": tiltVal,
              "Cable Distance (m)": Number(cableField.value) || 15,
              "Grid suitability": gridSuitField.value,
              Surveyor: surveyorField.value,
              Notes: notesField.value.trim(),
              status: "Approved",
            });
            dialog.close();
            BW.ui.toast("Survey approved by technical team!");
            onSaved();
          },
          "primary-btn",
          "check",
        );
        workflowRow.append(approveBtn);
      }

      if (survey.status !== "Rejected") {
        const rejectBtn = BW.ui.button(
          "Reject Survey",
          async () => {
            const reason = await BW.ui.reasonModal({
              title: `Reject survey ${survey.id}`,
              message: "The customer will see this reason and be asked to resubmit.",
              label: "Technical reason for rejection",
              placeholder: "e.g. heavy shadow from water tank, weak roof structure…",
              confirmLabel: "Reject Survey",
              danger: true,
            });
            if (reason === null) return;
            const { heldQuotations } = BW.store.rejectSurvey(survey.id, reason);
            dialog.close();
            BW.ui.toast(
              heldQuotations.length
                ? `Survey rejected. ${heldQuotations.join(", ")} put on hold.`
                : "Survey marked as Rejected.",
              "error",
            );
            onSaved();
          },
          "secondary-btn",
          "x",
        );
        workflowRow.append(rejectBtn);
      }

      // Handoff to Quotations if approved
      if (survey.status === "Approved") {
        const quoteBtn = BW.ui.button(
          "Prepare Quotation",
          () => {
            dialog.close();
            location.href = `quotations.html#new-from-survey=${survey.id}`;
          },
          "secondary-btn",
          "file-text",
        );
        workflowRow.append(quoteBtn);
      }

      body.append(workflowRow);
    }

    form.onsubmit = (e) => {
      e.preventDefault();
      alertEl.hidden = true;

      const dateError = checkSurveyDate();
      if (dateError) {
        dateField.focus();
        return;
      }

      const tilt = Number(tiltField.value);
      if (Number.isNaN(tilt) || tilt < 0 || tilt > 90) {
        alertEl.textContent = "Tilt must be between 0 and 90 degrees.";
        alertEl.hidden = false;
        return;
      }

      try {
        const record = {
          ...(survey || {}),
          Customer: custField.value.trim(),
          City: cityField.value,
          "Roof type": roofTypeField.value,
          "Roof Direction": roofDirField.value,
          "Tilt (0–90°)": tilt,
          "Cable Distance (m)": Number(cableField.value) || 15,
          "Grid suitability": gridSuitField.value,
          Surveyor: surveyorField.value,
          "Survey date": dateField.value,
          status: statusField.value,
          Notes: notesField.value.trim(),
        };

        BW.store.save("Surveys", record);
        dialog.close();
        BW.ui.toast(isNew ? "Survey created" : "Survey updated");
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

    const surveys = BW.store.get("Surveys");
    const canCreate = BW.auth.canWrite("Surveys");

    // Header matching Frame 4
    const headingEl = BW.ui.heading(
      "Surveys",
      "Rooftop feasibility assessments, shading analysis, and grid suitability verification.",
      canCreate
        ? BW.ui.button("New Survey", () => openSurveyEditor(null, render), "primary-btn", "plus")
        : BW.ui.viewOnly(),
    );

    // Filtered data calculation
    const filtered = surveys.filter((s) => {
      const matchesSearch =
        !searchQuery ||
        [s.id, s.Customer, s.City, s.Surveyor, s["Roof type"], s.status]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "All Status" || s.status === statusFilter;

      const matchesLocation =
        locationFilter === "All Locations" || s.City === locationFilter;

      return matchesSearch && matchesStatus && matchesLocation;
    });

    // 4 Top KPIs matching Frame 4
    const kpiCards = BW.ui.kpis([
      {
        label: "Total Surveys",
        value: surveys.length,
        icon: "clipboard-list",
        color: "blue",
        detail: `${filtered.length} matching current filter`,
      },
      {
        label: "Scheduled",
        value: surveys.filter((s) => s.status === "Scheduled").length,
        icon: "calendar-days",
        color: "teal",
        detail: "Upcoming rooftop visits",
      },
      {
        label: "In progress",
        value: surveys.filter((s) => s.status === "Surveyed").length,
        icon: "activity",
        color: "amber",
        detail: "Awaiting technical approval",
      },
      {
        label: "Approved",
        value: surveys.filter((s) => s.status === "Approved").length,
        icon: "list-checks",
        color: "green",
        detail: "Ready for quotation generation",
      },
    ]);

    // Panel with Filters
    const panel = BW.ui.el("section", "panel");
    const panelHead = BW.ui.el("div", "panel-heading");
    panelHead.append(
      BW.ui.el("h2", "", "Survey Register"),
      BW.ui.el("span", "muted", `${filtered.length} records`),
    );

    const filterBar = BW.ui.el("div", "filters");

    // 1. Search box
    const searchBox = BW.ui.el("label", "search-box");
    const searchInput = BW.ui.el("input");
    searchInput.placeholder = "Search by Consumer Name, ID, Surveyor...";
    searchInput.value = searchQuery;
    searchInput.setAttribute("aria-label", "Search surveys");
    searchInput.oninput = BW.utils.debounce(() => {
      searchQuery = searchInput.value.trim();
      render();
    }, 200);
    searchBox.append(BW.ui.icon("search", 16), searchInput);

    // 2. Status Dropdown
    const statusSelect = BW.ui.el("select");
    statusSelect.setAttribute("aria-label", "Filter by status");
    ["All Status", "Scheduled", "Surveyed", "Approved", "Rejected"].forEach((st) => {
      statusSelect.add(new Option(st, st));
    });
    statusSelect.value = statusFilter;
    statusSelect.onchange = () => {
      statusFilter = statusSelect.value;
      render();
    };

    // 3. Location Dropdown
    const locSelect = BW.ui.el("select");
    locSelect.setAttribute("aria-label", "Filter by location");
    locSelect.add(new Option("All Locations", "All Locations"));
    BW.catalog.lists.cities.forEach((c) => locSelect.add(new Option(c, c)));
    locSelect.value = locationFilter;
    locSelect.onchange = () => {
      locationFilter = locSelect.value;
      render();
    };

    filterBar.append(searchBox, statusSelect, locSelect);
    panel.append(panelHead, filterBar);

    // Table matching Frame 4 columns:
    // Survey ID | Consumer Name | Location | Surveyor | Scheduled Date | Status | Action
    const tableEl = BW.ui.table({
      module: "Surveys",
      rows: filtered,
      columns: [
        {
          key: "id",
          label: "Survey ID",
          render: (id, row) => {
            const btn = BW.ui.button(id, () => openSurveyEditor(row, render), "id-link");
            return btn;
          },
        },
        { key: "Customer", label: "Consumer Name", className: "primary-cell" },
        { key: "City", label: "Location" },
        { key: "Surveyor", label: "Surveyor" },
        { key: "Roof Direction", label: "Direction" },
        { key: "Survey date", label: "Scheduled Date", format: "date" },
        { key: "status", label: "Status" },
      ],
      onRowClick: (r) => openSurveyEditor(r, render),
    });

    panel.append(tableEl);
    root.append(headingEl, kpiCards, panel);

    // Check hash anchor to auto-open specific record
    if (location.hash && location.hash.startsWith("#SRV-")) {
      const targetId = location.hash.slice(1);
      const target = surveys.find((s) => s.id === targetId);
      if (target) {
        history.replaceState(null, "", location.pathname);
        openSurveyEditor(target, render);
      }
    }
  }

  BW.controllers.Surveys = { render };
})();
