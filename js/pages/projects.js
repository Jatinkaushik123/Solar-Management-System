/**
 * Bijli Wala SIMS — Projects & Installation Tracker Controller
 * End-to-End Project Tracker: 6-stage lifecycle, field crew scheduling, and signed digital handover [cite: 6, 8].
 */
window.BW = window.BW || {};
window.BW.controllers = window.BW.controllers || {};

(() => {
  "use strict";

  let searchQuery = "";
  let statusFilter = "All Status";
  let locationFilter = "All Locations";

  const STAGES = [
    "Planning",
    "Site assessment",
    "Design approval",
    "Procurement",
    "Installation",
    "Commissioning",
  ];

  function openHandoverModal(project, onComplete) {
    const { dialog, body } = BW.ui.modal("Commissioning Handover & Generation Sign-Off", "spotlight");
    const form = BW.ui.el("form");
    const grid = BW.ui.el("div", "form-grid");

    const alertEl = BW.ui.el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;

    form.append(
      BW.ui.el(
        "p",
        "form-caption",
        `Verify grid synchronization and capture customer acceptance for ${project["Project name"]}.`,
      ),
      grid,
    );

    const custNameField = BW.ui.field(grid, {
      name: "custName",
      label: "Customer / Authorized Representative",
      value: project.handover?.customer || project["Project name"],
      required: true,
    });

    const startTimeField = BW.ui.field(grid, {
      name: "startTime",
      label: "Grid Synchronization Start Time",
      type: "time",
      value: project.handover?.start || "10:00",
      required: true,
    });

    const endTimeField = BW.ui.field(grid, {
      name: "endTime",
      label: "Testing Completion Time",
      type: "time",
      value: project.handover?.end || "12:30",
      required: true,
    });

    const testField = BW.ui.field(grid, {
      name: "testResult",
      label: "Generation / Export Test",
      options: ["Pass", "Fail"],
      value: project.handover?.generationTest || "Pass",
      required: true,
    });

    // Signature Pad Box
    const sigSection = BW.ui.el("div", "signature-section");
    sigSection.append(BW.ui.el("label", "", "Customer Signature"));

    const canvas = BW.ui.el("canvas", "signature-pad");
    canvas.width = 460;
    canvas.height = 140;
    canvas.style.width = "100%";
    canvas.style.height = "140px";
    canvas.setAttribute("aria-label", "Customer digital signature pad");

    const sigTools = BW.ui.el("div", "sig-tools");
    const clearBtn = BW.ui.button("Clear Signature", () => clearCanvas());
    const typeBtn = BW.ui.button("Use Typed Signature", () => useTypedSignature());
    sigTools.append(clearBtn, typeBtn);

    sigSection.append(canvas, sigTools);
    form.append(sigSection, alertEl);

    // Canvas drawing logic
    const ctx = canvas.getContext("2d");
    let isDrawing = false;
    let hasInk = false;

    function initCanvas() {
      if (!ctx) return;
      ctx.strokeStyle = "#F59E0B";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }

    function clearCanvas() {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasInk = false;
    }

    function useTypedSignature() {
      const name = custNameField.value.trim() || project["Project name"];
      clearCanvas();
      ctx.font = "italic 32px Georgia, serif";
      ctx.fillStyle = "#F59E0B";
      ctx.fillText(name, 25, 80);
      hasInk = true;
    }

    canvas.addEventListener("pointerdown", (e) => {
      isDrawing = true;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      ctx.beginPath();
      ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
      hasInk = true;
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!isDrawing) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      ctx.lineTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
      ctx.stroke();
    });

    const stopDrawing = () => {
      isDrawing = false;
    };
    canvas.addEventListener("pointerup", stopDrawing);
    canvas.addEventListener("pointercancel", stopDrawing);

    const actions = BW.ui.el("div", "modal-actions");
    actions.append(
      BW.ui.button("Cancel", () => dialog.close()),
      BW.ui.button("Confirm Handover & Commissioning", null, "primary-btn", "circle-check"),
    );
    form.append(actions);
    body.append(form);

    queueMicrotask(initCanvas);

    form.onsubmit = (e) => {
      e.preventDefault();
      alertEl.hidden = true;

      if (!hasInk && !project.handover?.signature) {
        useTypedSignature();
      }

      try {
        const handoverData = {
          customer: custNameField.value.trim(),
          date: BW.utils.todayISO(),
          start: startTimeField.value,
          end: endTimeField.value,
          generationTest: testField.value,
          signature: canvas.toDataURL(),
        };

        BW.store.save("Projects", {
          ...project,
          stage: "Commissioning",
          status: "Completed",
          handover: handoverData,
        });

        dialog.close();
        BW.ui.toast("🎉 Installation successfully commissioned and handed over!");
        onComplete();
      } catch (err) {
        alertEl.textContent = err.message;
        alertEl.hidden = false;
      }
    };
  }

  function openProjectTracker(project = null, onSaved) {
    const isNew = !project || !project.id;
    const canWrite = BW.auth.canWrite("Projects");

    const { dialog, body } = BW.ui.modal(
      isNew ? "Create New Project" : `Project Tracker · ${project.id}`,
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
          ? "Initialize a new rooftop solar deployment project."
          : `Monitor progression from procurement through commissioning for ${project["Project name"]}.`,
      ),
      grid,
      alertEl,
    );

    const nameField = BW.ui.field(grid, {
      name: "Project name",
      label: "Project Name / Site",
      value: project?.["Project name"] || "",
      required: true,
      readOnly: !canWrite,
    });

    const cityField = BW.ui.field(grid, {
      name: "City",
      label: "City / Location",
      options: BW.catalog.lists.cities,
      value: project?.City || "Pune",
      required: true,
      disabled: !canWrite,
    });

    const kwField = BW.ui.field(grid, {
      name: "Capacity (kW)",
      label: "Capacity (kW)",
      options: BW.catalog.lists.capacities.map((k) => [k, `${k} kW`]),
      value: String(project?.["Capacity (kW)"] || "3"),
      required: true,
      disabled: !canWrite,
    });

    const engineerField = BW.ui.field(grid, {
      name: "Lead engineer",
      label: "Lead Project Engineer",
      options: BW.catalog.lists.engineers,
      value: project?.["Lead engineer"] || "Priya Shah",
      required: true,
      disabled: !canWrite,
    });

    const crewField = BW.ui.field(grid, {
      name: "Crew lead",
      label: "Field Installation Crew Lead",
      options: BW.catalog.lists.crewLeads,
      value: project?.["Crew lead"] || "Vikram Singh (Crew Alpha)",
      required: true,
      disabled: !canWrite,
    });

    const statusField = BW.ui.field(grid, {
      name: "status",
      label: "Project Status",
      options: ["Planning", "In progress", "Completed", "On hold"],
      value: project?.status || "Planning",
      required: true,
      disabled: !canWrite,
    });

    // 6-Stage Stepper
    let currentStageIndex = STAGES.indexOf(project?.stage || "Planning");
    if (currentStageIndex < 0) currentStageIndex = 0;

    const stepperBox = BW.ui.el("div", "stepper-box");
    stepperBox.append(BW.ui.el("h3", "", "Project Lifecycle Stages"));

    const progressEl = BW.ui.el("progress");
    progressEl.max = STAGES.length;
    progressEl.value = currentStageIndex + 1;

    const stepperList = BW.ui.el("ol", "stepper");

    function renderStepper() {
      stepperList.replaceChildren();
      STAGES.forEach((stageName, i) => {
        const li = BW.ui.el("li");
        const btn = BW.ui.button(stageName, () => {
          if (!canWrite) return;
          currentStageIndex = i;
          progressEl.value = i + 1;
          renderStepper();
        });
        if (i <= currentStageIndex) li.classList.add("done");
        btn.setAttribute("aria-pressed", String(i === currentStageIndex));
        btn.disabled = !canWrite;
        li.append(btn);
        stepperList.append(li);
      });
    }

    renderStepper();
    stepperBox.append(progressEl, stepperList);
    form.append(stepperBox);

    // If Commissioned, display Handover details
    if (project?.handover) {
      const hBox = BW.ui.el("div", "handover-display-box");
      hBox.innerHTML = `
        <h3 style="margin-top:0;">Handover Sign-Off Completed</h3>
        <p><strong>Customer:</strong> ${project.handover.customer}</p>
        <p><strong>Handover Date:</strong> ${BW.utils.formatDate(project.handover.date)} (${project.handover.start} – ${project.handover.end})</p>
        <p><strong>Generation Test:</strong> <span class="badge green">${project.handover.generationTest}</span></p>
      `;
      if (project.handover.signature && project.handover.signature.startsWith("data:")) {
        const sigImg = BW.ui.el("img", "sig-preview");
        sigImg.src = project.handover.signature;
        sigImg.alt = "Customer signature";
        hBox.append(sigImg);
      }
      form.append(hBox);
    }

    const actions = BW.ui.el("div", "modal-actions");
    actions.append(BW.ui.button(canWrite ? "Cancel" : "Close", () => dialog.close()));

    if (canWrite) {
      const saveBtn = BW.ui.button(
        isNew ? "Create Project" : "Save Project",
        null,
        "primary-btn",
        "check",
      );
      saveBtn.type = "submit";
      actions.append(saveBtn);
    }

    form.append(actions);
    body.append(form);

    // Workflow actions
    if (!isNew && canWrite && BW.auth.can("handover")) {
      const wf = BW.ui.el("div", "workflow");
      wf.append(BW.ui.el("small", "", "Field Commissioning:"));

      if (project.status !== "Completed") {
        const handoverBtn = BW.ui.button(
          "Commission & Handover Form",
          () => {
            dialog.close();
            openHandoverModal(project, onSaved);
          },
          "primary-btn",
          "hard-hat",
        );
        wf.append(handoverBtn);
      }
      body.append(wf);
    }

    form.onsubmit = (e) => {
      e.preventDefault();
      alertEl.hidden = true;

      try {
        const chosenStage = STAGES[currentStageIndex];
        let derivedStatus = statusField.value;
        if (chosenStage === "Commissioning") derivedStatus = "Completed";
        else if (chosenStage === "Planning") derivedStatus = "Planning";
        else derivedStatus = "In progress";

        const record = {
          ...(project || {}),
          "Project name": nameField.value.trim(),
          City: cityField.value,
          "Capacity (kW)": Number(kwField.value) || 3,
          "Lead engineer": engineerField.value,
          "Crew lead": crewField.value,
          stage: chosenStage,
          status: derivedStatus,
        };

        BW.store.save("Projects", record);
        dialog.close();
        BW.ui.toast(isNew ? "Project created" : "Project updated");
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

    const projects = BW.store.get("Projects");
    const canCreate = BW.auth.canWrite("Projects");

    const headingEl = BW.ui.heading(
      "Projects",
      "End-to-end solar deployment tracking, multi-stage procurement progress, and commissioning handovers.",
      canCreate
        ? BW.ui.button("New Project", () => openProjectTracker(null, render), "primary-btn", "plus")
        : BW.ui.viewOnly(),
    );

    const filtered = projects.filter((p) => {
      const matchesSearch =
        !searchQuery ||
        [p.id, p["Project name"], p.City, p.status, p.stage, p["Lead engineer"]]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "All Status" || p.status === statusFilter;

      const matchesLocation =
        locationFilter === "All Locations" || p.City === locationFilter;

      return matchesSearch && matchesStatus && matchesLocation;
    });

    const kpiCards = BW.ui.kpis([
      {
        label: "Total Projects",
        value: projects.length,
        icon: "folder-kanban",
        color: "blue",
        detail: `${filtered.length} in current view`,
      },
      {
        label: "In Progress",
        value: projects.filter((p) => p.status === "In progress").length,
        icon: "activity",
        color: "teal",
        detail: "Active installation crews",
      },
      {
        label: "Planning",
        value: projects.filter((p) => p.status === "Planning").length,
        icon: "clipboard-list",
        color: "amber",
        detail: "Awaiting design/procurement",
      },
      {
        label: "Completed",
        value: projects.filter((p) => p.status === "Completed").length,
        icon: "circle-check",
        color: "green",
        detail: "Commissioned systems",
      },
    ]);

    const panel = BW.ui.el("section", "panel");
    const panelHead = BW.ui.el("div", "panel-heading");
    panelHead.append(
      BW.ui.el("h2", "", "Project & Installation Portfolio"),
      BW.ui.el("span", "muted", `${filtered.length} records`),
    );

    const filterBar = BW.ui.el("div", "filters");

    // Search input
    const searchBox = BW.ui.el("label", "search-box");
    const searchInput = BW.ui.el("input");
    searchInput.placeholder = "Search projects by Name, Engineer, City...";
    searchInput.value = searchQuery;
    searchInput.oninput = BW.utils.debounce(() => {
      searchQuery = searchInput.value.trim();
      render();
    }, 200);
    searchBox.append(BW.ui.icon("search", 16), searchInput);

    // Status filter
    const statusSelect = BW.ui.el("select");
    ["All Status", "Planning", "In progress", "Completed", "On hold"].forEach((st) => {
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

    // Table matching Frame 6 & Frame 8
    const tableEl = BW.ui.table({
      module: "Projects",
      rows: filtered,
      columns: [
        {
          key: "id",
          label: "Project ID",
          render: (id, row) => {
            return BW.ui.button(id, () => openProjectTracker(row, render), "id-link");
          },
        },
        { key: "Project name", label: "Consumer / Site Name", className: "primary-cell" },
        {
          key: "Capacity (kW)",
          label: "System Size",
          render: (kw) => `${kw} kW`,
        },
        { key: "City", label: "Location" },
        {
          key: "stage",
          label: "Current Stage",
          render: (stg) => BW.ui.el("span", "stage-pill", stg || "Planning"),
        },
        { key: "status", label: "Status" },
      ],
      actionsRenderer: (row) => {
        const wrap = BW.ui.el("div", "row-actions");
        if (row.status !== "Completed" && BW.auth.can("handover")) {
          const handoverBtn = BW.ui.button(
            "Commission",
            () => openHandoverModal(row, render),
            "row-btn",
            "hard-hat",
          );
          handoverBtn.title = "Record handover & commissioning";
          wrap.append(handoverBtn);
        }
        return wrap;
      },
      onRowClick: (r) => openProjectTracker(r, render),
    });

    panel.append(tableEl);
    root.append(headingEl, kpiCards, panel);

    // Hash anchor check
    if (location.hash && location.hash.startsWith("#PRJ-")) {
      const pId = location.hash.slice(1);
      const prj = projects.find((p) => p.id === pId);
      if (prj) {
        history.replaceState(null, "", location.pathname);
        openProjectTracker(prj, render);
      }
    }
  }

  BW.controllers.Projects = { render };
})();
