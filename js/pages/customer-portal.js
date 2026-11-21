/**
 * Bijli Wala SIMS — Customer Portal Controller
 * Dedicated Customer View: Submit Site Survey, Track Survey Status, View & Accept Approved Quotation, and Track Installation.
 */
window.BW = window.BW || {};
window.BW.controllers = window.BW.controllers || {};

(() => {
  "use strict";

  function getCustomerSurveys(user) {
    const all = BW.store.get("Surveys");
    return all.filter(
      (s) =>
        (s.customerEmail && s.customerEmail.toLowerCase() === user.email.toLowerCase()) ||
        s.Customer === user.name,
    );
  }

  function getCustomerQuotations(user) {
    const all = BW.store.get("Quotations");
    return all.filter(
      (q) =>
        (q.customerEmail && q.customerEmail.toLowerCase() === user.email.toLowerCase()) ||
        q.Customer === user.name,
    );
  }

  function getCustomerProjects(user) {
    const all = BW.store.get("Projects");
    return all.filter(
      (p) =>
        (p.customerEmail && p.customerEmail.toLowerCase() === user.email.toLowerCase()) ||
        p["Project name"] === user.name ||
        p["Project name"] === `${user.name} Residence`,
    );
  }

  function getCustomerWarranties(user) {
    const all = BW.store.get("Warranty");
    return all.filter(
      (w) =>
        (w.customerEmail && w.customerEmail.toLowerCase() === user.email.toLowerCase()) ||
        w.Customer === user.name ||
        w.Customer.includes(user.name),
    );
  }

  function renderSubmitSurveyModal(user, onComplete) {
    const { dialog, body } = BW.ui.modal("Submit Rooftop Site Survey", "drawer");
    const form = BW.ui.el("form");
    const grid = BW.ui.el("div", "form-grid");
    const alertEl = BW.ui.el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;

    form.append(
      BW.ui.el(
        "p",
        "form-caption",
        "Our certified solar engineers will inspect your rooftop structure, orientation, and shadow factors.",
      ),
      grid,
      alertEl,
    );

    const nameField = BW.ui.field(grid, {
      name: "Customer",
      label: "Full Name",
      value: user.name,
      readOnly: true,
      required: true,
    });

    const phoneField = BW.ui.field(grid, {
      name: "Phone",
      label: "10-Digit Mobile Number",
      type: "tel",
      value: user.phone || "",
      required: true,
      placeholder: "98XXXXXXXX",
      hint: "Enter 10-digit Indian mobile number",
    });

    const cityField = BW.ui.field(grid, {
      name: "City",
      label: "City",
      options: BW.catalog.lists.cities,
      value: user.city || "Pune",
      required: true,
    });

    const roofTypeField = BW.ui.field(grid, {
      name: "Roof type",
      label: "Roof Surface Type",
      options: BW.catalog.lists.roofTypes,
      value: "RCC terrace",
      required: true,
    });

    const capacityField = BW.ui.field(grid, {
      name: "Capacity (kW)",
      label: "Estimated Solar System Size",
      options: BW.catalog.lists.capacities.map((k) => [k, `${k} kW`]),
      value: "3",
      required: true,
    });

    const directionField = BW.ui.field(grid, {
      name: "Roof Direction",
      label: "Roof Direction (Orientation)",
      options: BW.catalog.lists.roofDirections,
      value: "South",
      required: true,
    });

    const billField = BW.ui.field(grid, {
      name: "Monthly Bill (₹)",
      label: "Average Monthly Electricity Bill",
      type: "number",
      value: "3500",
      placeholder: "₹ per month",
      min: 500,
    });

    const notesField = BW.ui.field(grid, {
      name: "Notes",
      label: "Site Address & Access Notes",
      type: "textarea",
      placeholder: "Mention floor number, terrace access, or any shading structures...",
      hint: "e.g. 3rd floor flat with open terrace, south-facing.",
    });

    const actions = BW.ui.el("div", "modal-actions");
    const cancelBtn = BW.ui.button("Cancel", () => dialog.close());
    const submitBtn = BW.ui.button(
      "Submit Survey Request",
      null,
      "primary-btn",
      "clipboard-list",
    );
    submitBtn.type = "submit";

    actions.append(cancelBtn, submitBtn);
    form.append(actions);
    body.append(form);

    form.onsubmit = (e) => {
      e.preventDefault();
      alertEl.hidden = true;

      const phone = phoneField.value.trim();
      if (!BW.utils.phoneOk(phone)) {
        alertEl.textContent = "Please enter a valid 10-digit Indian mobile number starting with 6–9.";
        alertEl.hidden = false;
        return;
      }

      try {
        const surveyRecord = {
          Customer: user.name,
          customerEmail: user.email,
          City: cityField.value,
          Phone: phone,
          "Roof type": roofTypeField.value,
          "Capacity (kW)": Number(capacityField.value) || 3,
          "Roof Direction": directionField.value,
          "Monthly Bill (₹)": Number(billField.value) || 0,
          Notes: notesField.value.trim(),
          "Survey date": BW.utils.relativeDate(2),
          status: "Scheduled",
          Surveyor: "Sneha Rao",
          "Grid suitability": "Suitable",
          "Tilt (0–90°)": 22,
          "Cable Distance (m)": 15,
        };

        BW.store.save("Surveys", surveyRecord);
        dialog.close();
        BW.ui.toast("Site survey request submitted successfully!");
        onComplete();
      } catch (err) {
        alertEl.textContent = err.message;
        alertEl.hidden = false;
      }
    };
  }

  function handleAcceptQuotation(quote, onComplete) {
    if (
      !confirm(
        `Accept Quotation ${quote.id} for ${quote["Capacity (kW)"]} kW system at net ${BW.utils.formatINR(
          quote.totals?.netCustomerPayable || quote["Amount (₹)"],
        )}? This will initiate your installation project!`,
      )
    ) {
      return;
    }

    try {
      // 1. Lock and update quotation to Accepted
      BW.store.save("Quotations", {
        ...quote,
        status: "Accepted",
      });

      // 2. Create linked Project in Planning stage
      const existingProjects = BW.store.get("Projects");
      const alreadyLinked = existingProjects.find((p) => p.sourceQuotationId === quote.id);

      if (!alreadyLinked) {
        const newProject = {
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
        };
        BW.store.save("Projects", newProject);
      }

      BW.ui.toast("🎉 Quotation accepted! Project created in Planning stage.");
      onComplete();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderRaiseTicketModal(warranty, onComplete) {
    const { dialog, body } = BW.ui.modal(`Raise Service Claim · ${warranty["Serial number"]}`, "spotlight");
    const form = BW.ui.el("form");
    const grid = BW.ui.el("div", "form-grid");
    const alertEl = BW.ui.el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;

    form.append(
      BW.ui.el("p", "form-caption", `Component: ${warranty.Component} · Serial: ${warranty["Serial number"]}`),
      grid,
      alertEl,
    );

    const issueField = BW.ui.field(grid, {
      name: "Issue",
      label: "Describe the Issue",
      type: "textarea",
      required: true,
      placeholder: "Describe error codes, generation drop, or inverter LED indicator behavior...",
    });

    const isCovered =
      warranty.status !== "Closed" &&
      String(warranty["Expiry date"] || "") >= BW.utils.todayISO();

    const coverageNotice = BW.ui.el(
      "div",
      "kit-totals",
      "",
    );
    coverageNotice.innerHTML = `
      <div class="kit-total-row">
        <span>Coverage Status:</span>
        <strong style="color: ${isCovered ? "#34D399" : "#F59E0B"}">${isCovered ? "Under Active Warranty" : "Warranty Expired"}</strong>
      </div>
      <div class="kit-total-row">
        <span>Estimated Service Charge:</span>
        <strong>${isCovered ? "₹0 (100% Free under Warranty)" : "Billable on inspection"}</strong>
      </div>
    `;
    form.append(coverageNotice);

    const actions = BW.ui.el("div", "modal-actions");
    const cancelBtn = BW.ui.button("Cancel", () => dialog.close());
    const submitBtn = BW.ui.button("Submit Service Claim", null, "primary-btn", "wrench");
    submitBtn.type = "submit";

    actions.append(cancelBtn, submitBtn);
    form.append(actions);
    body.append(form);

    form.onsubmit = (e) => {
      e.preventDefault();
      const issue = issueField.value.trim();
      if (!issue) {
        alertEl.textContent = "Please describe the issue.";
        alertEl.hidden = false;
        return;
      }

      try {
        const tickets = warranty.tickets || [];
        const newTicket = {
          id: `${warranty.id}-T${tickets.length + 1}`,
          opened: BW.utils.todayISO(),
          parts: 0,
          labour: 0,
          note: issue,
        };

        const updatedHistory = warranty.history || [];
        updatedHistory.unshift({
          date: BW.utils.todayISO(),
          title: "Service claim submitted by customer",
          detail: issue,
        });

        BW.store.save("Warranty", {
          ...warranty,
          status: "Claim open",
          tickets: [newTicket, ...tickets],
          history: updatedHistory,
        });

        dialog.close();
        BW.ui.toast("Service claim opened. Technician will be dispatched.");
        onComplete();
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

    const user = BW.auth.current();
    if (!user) return;

    const mySurveys = getCustomerSurveys(user);
    const myQuotes = getCustomerQuotations(user);
    const myProjects = getCustomerProjects(user);
    const myWarranties = getCustomerWarranties(user);

    // Page Heading with Submit Survey action
    const headingEl = BW.ui.heading(
      `Welcome, ${user.name}`,
      "Manage your rooftop solar journey: request site feasibility surveys, view quotations, and track installation milestones.",
      BW.ui.button(
        "Request Site Survey",
        () => renderSubmitSurveyModal(user, render),
        "primary-btn",
        "plus",
      ),
    );

    // Solar Journey Progress Bar
    const journeyPanel = BW.ui.el("section", "panel customer-journey-panel");
    const journeyHeading = BW.ui.el("div", "panel-heading");
    journeyHeading.append(BW.ui.el("h2", "", "Your Solar Installation Journey"));

    const steps = [
      { id: 1, label: "Site Survey", done: mySurveys.length > 0 },
      { id: 2, label: "Survey Approved", done: mySurveys.some((s) => s.status === "Approved") },
      {
        id: 3,
        label: "Quotation Accepted",
        done: myQuotes.some((q) => q.status === "Accepted") || myProjects.length > 0,
      },
      {
        id: 4,
        label: "Installation in Progress",
        done: myProjects.some((p) => p.status === "In progress" || p.status === "Completed"),
      },
      {
        id: 5,
        label: "Commissioned & Live",
        done: myProjects.some((p) => p.status === "Completed") || myWarranties.length > 0,
      },
    ];

    const stepper = BW.ui.el("ol", "stepper");
    steps.forEach((s) => {
      const li = BW.ui.el("li", s.done ? "done" : "");
      li.append(BW.ui.el("span", "", s.label));
      stepper.append(li);
    });

    journeyPanel.append(journeyHeading, stepper);

    // Section 1: My Site Surveys
    const surveySection = BW.ui.el("section", "panel");
    const surveyHead = BW.ui.el("div", "panel-heading");
    surveyHead.append(
      BW.ui.el("h2", "", "My Rooftop Site Surveys"),
      BW.ui.el("span", "muted", `${mySurveys.length} survey records`),
    );

    const surveyTable = BW.ui.table({
      module: "Surveys",
      rows: mySurveys,
      columns: [
        { key: "id", label: "Survey ID" },
        { key: "City", label: "City" },
        { key: "Roof type", label: "Roof Type" },
        { key: "Roof Direction", label: "Direction" },
        { key: "Survey date", label: "Scheduled Date", format: "date" },
        { key: "status", label: "Status" },
      ],
      actionsRenderer: (survey) => {
        if (survey.status === "Approved") {
          const pill = BW.ui.el("span", "badge green", "Ready to Quote");
          return pill;
        }
        if (survey.status === "Rejected") {
          const btn = BW.ui.button(
            "View Reason",
            () => {
              alert(`Rejection Reason: ${survey.rejectionReason || "Roof not viable for solar installation."}`);
            },
            "secondary-btn",
          );
          return btn;
        }
        return BW.ui.el("span", "muted", "In Review");
      },
    });

    surveySection.append(surveyHead, surveyTable);

    // Section 2: My Approved Quotations
    const quotesSection = BW.ui.el("section", "panel");
    const quotesHead = BW.ui.el("div", "panel-heading");
    quotesHead.append(
      BW.ui.el("h2", "", "My Solar System Quotations"),
      BW.ui.el("span", "muted", `${myQuotes.length} proposals`),
    );

    const quoteCardsWrap = BW.ui.el("div", "quotation-cards-grid");

    if (myQuotes.length === 0) {
      quoteCardsWrap.append(
        BW.ui.el(
          "p",
          "empty",
          "No quotation prepared yet. Once our engineers complete your site survey, your customized solar quotation will appear here.",
        ),
      );
    } else {
      myQuotes.forEach((quote) => {
        const card = BW.ui.el("article", "quotation-card");
        const cardTop = BW.ui.el("div", "quotation-card-top");

        const qTitle = BW.ui.el("h3", "", `${quote["Capacity (kW)"]} kW Rooftop Solar System`);
        cardTop.append(qTitle, BW.ui.statusPill(quote.status));

        const metaRow = BW.ui.el("div", "quotation-meta-row");
        metaRow.append(
          BW.ui.el("span", "", `Type: ${quote["System type"] || "On-Grid"}`),
          BW.ui.el("span", "", `Scheme: ${quote["Subsidy scheme"] || "PM Surya Ghar"}`),
          BW.ui.el("span", "", `Proposal: ${quote.id}`),
        );

        // Price breakdown box
        const breakdownBox = BW.ui.el("div", "quotation-breakdown");
        const totals = quote.totals || {
          equipmentSubtotal: quote["Amount (₹)"] * 0.8,
          installationSubtotal: quote["Amount (₹)"] * 0.2,
          grossTotal: quote["Amount (₹)"],
          subsidy: BW.catalog.subsidyFor(quote["Capacity (kW)"], quote["Subsidy scheme"], quote["System type"]),
          netCustomerPayable: Math.max(0, quote["Amount (₹)"] - BW.catalog.subsidyFor(quote["Capacity (kW)"], quote["Subsidy scheme"], quote["System type"])),
        };

        breakdownBox.innerHTML = `
          <div class="q-row">
            <span>Gross System Cost:</span>
            <strong>${BW.utils.formatINR(totals.grossTotal)}</strong>
          </div>
          <div class="q-row subsidy-row">
            <span>PM Surya Ghar Govt Subsidy:</span>
            <strong style="color: #34D399">- ${BW.utils.formatINR(totals.subsidy)}</strong>
          </div>
          <div class="q-row net-row">
            <span>Net Effective Price:</span>
            <strong style="color: #F59E0B; font-size: 1.25rem">${BW.utils.formatINR(totals.netCustomerPayable)}</strong>
          </div>
        `;

        const cardFooter = BW.ui.el("div", "quotation-card-footer");
        if (quote.status === "Accepted") {
          const acceptedTag = BW.ui.el("div", "accepted-badge");
          acceptedTag.append(BW.ui.icon("check"), " Accepted & Approved for Installation");
          cardFooter.append(acceptedTag);
        } else {
          const acceptBtn = BW.ui.button(
            "Accept Quotation & Proceed",
            () => handleAcceptQuotation(quote, render),
            "primary-btn",
            "check",
          );
          cardFooter.append(acceptBtn);
        }

        card.append(cardTop, metaRow, breakdownBox, cardFooter);
        quoteCardsWrap.append(card);
      });
    }

    quotesSection.append(quotesHead, quoteCardsWrap);

    // Section 3: My Active Projects & Warranties
    const projectSection = BW.ui.el("section", "panel");
    const projectHead = BW.ui.el("div", "panel-heading");
    projectHead.append(BW.ui.el("h2", "", "My Project & Warranty Status"));

    if (myProjects.length === 0 && myWarranties.length === 0) {
      projectSection.append(
        projectHead,
        BW.ui.el("p", "empty", "No active installations yet. Accept your quotation above to start your project!"),
      );
    } else {
      const projectTable = BW.ui.table({
        module: "Projects",
        rows: myProjects,
        columns: [
          { key: "id", label: "Project ID" },
          { key: "Project name", label: "Installation Site" },
          { key: "Capacity (kW)", label: "Size" },
          { key: "stage", label: "Current Stage" },
          { key: "Lead engineer", label: "Lead Engineer" },
          { key: "status", label: "Status" },
        ],
      });

      // Warranties List
      const warrantyBox = BW.ui.el("div", "customer-warranties-wrap");
      if (myWarranties.length > 0) {
        warrantyBox.append(BW.ui.el("h3", "", "Registered Component Warranties"));
        const warTable = BW.ui.table({
          module: "Warranty",
          rows: myWarranties,
          columns: [
            { key: "Component", label: "Equipment Component" },
            { key: "Serial number", label: "Serial Number" },
            { key: "Expiry date", label: "Warranty Expiry", format: "date" },
            { key: "status", label: "Coverage Status" },
          ],
          actionsRenderer: (war) => {
            const btn = BW.ui.button(
              "Raise Service Claim",
              () => renderRaiseTicketModal(war, render),
              "secondary-btn",
              "wrench",
            );
            return btn;
          },
        });
        warrantyBox.append(warTable);
      }

      projectSection.append(projectHead, projectTable, warrantyBox);
    }

    root.append(headingEl, journeyPanel, surveySection, quotesSection, projectSection);
  }

  BW.controllers["Customer Portal"] = { render };
})();
