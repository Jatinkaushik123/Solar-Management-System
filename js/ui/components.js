/**
 * Bijli Wala SIMS — Reusable UI Components
 * Accessible modals, slide-over drawers, KPI cards, tables, alerts, toasts, and form fields.
 */
window.BW = window.BW || {};
window.BW.ui = window.BW.ui || {};

(() => {
  "use strict";

  const iconPaths = {
    "layout-dashboard":
      '<rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect>',
    "clipboard-list":
      '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path>',
    "file-text":
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
    "folder-kanban":
      '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path><path d="M8 10v4"></path><path d="M12 10v2"></path><path d="M16 10v6"></path>',
    boxes:
      '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"></path><path d="m7 16.5-4.74-2.85"></path><path d="m7 16.5 5-3"></path><path d="M7 16.5v5.17"></path><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"></path><path d="m17 16.5-5-3"></path><path d="m17 16.5 4.74-2.85"></path><path d="M17 16.5v5.17"></path><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"></path><path d="M12 8 7.26 5.15"></path><path d="m12 8 4.74-2.85"></path><path d="M12 13.5V8"></path>',
    wrench:
      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>',
    "shield-check":
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    user:
      '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
    sun:
      '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>',
    "log-out":
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" x2="9" y1="12" y2="12"></line>',
    x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    "panel-left":
      '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M9 3v18"></path>',
    "chevron-right": '<path d="m9 18 6-6-6-6"></path>',
    search:
      '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
    "calendar-days":
      '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path>',
    plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
    layers:
      '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"></path><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"></path><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"></path>',
    "list-checks":
      '<path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path>',
    activity:
      '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"></path>',
    "hard-hat":
      '<path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"></path><path d="M14 6a6 6 0 0 1 6 6v3"></path><path d="M4 15v-3a6 6 0 0 1 6-6"></path><rect x="2" y="15" width="20" height="4" rx="1"></rect>',
    zap:
      '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"></path>',
    mail:
      '<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>',
    eye:
      '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>',
    "eye-off":
      '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"></path><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"></path><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"></path><path d="m2 2 20 20"></path>',
    "lock-keyhole":
      '<circle cx="12" cy="16" r="1"></circle><rect x="3" y="10" width="18" height="12" rx="2"></rect><path d="M7 10V7a5 5 0 0 1 10 0v3"></path>',
    "circle-check":
      '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>',
    bell:
      '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>',
    "alert-triangle":
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    check: '<polyline points="20 6 9 17 4 12"></polyline>',
  };

  function el(tag, cls = "", text = "") {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== "") node.textContent = text;
    return node;
  }

  function icon(name, size = 18) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = iconPaths[name] || iconPaths["file-text"];
    return svg;
  }

  function button(text, onClick, cls = "secondary-btn", glyph = null) {
    const btn = el("button", cls);
    btn.type = "button";
    if (glyph) btn.append(icon(glyph));
    if (text) btn.append(document.createTextNode(text));
    if (onClick) btn.onclick = onClick;
    return btn;
  }

  function heading(title, description, action = null) {
    const root = el("div", "page-heading");
    const box = el("div");
    box.append(el("h1", "", title));
    if (description) box.append(el("p", "", description));
    root.append(box);
    if (action instanceof Node) {
      root.append(action);
    } else if (typeof action === "function") {
      root.append(button("New", action, "primary-btn", "plus"));
    }
    return root;
  }

  function kpis(cards) {
    const root = el("div", "kpis");
    for (const cardData of cards) {
      const {
        label,
        value,
        detail,
        icon: glyph,
        color = "teal",
        unit = "",
      } = cardData;

      const card = el("article", "kpi");
      const top = el("div", "kpi-top");
      const tile = el("span", `icon-tile ${color}`);
      if (glyph) tile.append(icon(glyph));

      top.append(el("span", "", label), tile);
      const strong = el("strong");
      const numSpan = el("span", "", String(value));
      numSpan.dataset.count = value;
      numSpan.setAttribute("aria-hidden", "true");

      strong.append(
        el("span", "sr-only", String(value)),
        numSpan,
        unit ? " " : "",
        unit ? el("small", "", unit) : "",
      );

      card.append(top, strong, el("p", "", detail || ""));
      root.append(card);
    }
    queueMicrotask(() => animateNumbers(root));
    return root;
  }

  const TONES = {
    "In progress": "teal",
    Completed: "green",
    Planning: "blue",
    "On hold": "amber",
    Approved: "green",
    Accepted: "green",
    Sent: "blue",
    Draft: "slate",
    Scheduled: "blue",
    Surveyed: "amber",
    Rejected: "red",
    "Revision Required": "amber",
    "On Hold": "amber",
    Cancelled: "red",
    Pending: "blue",
    Confirmed: "green",
    "Re-verification Required": "amber",
    Active: "teal",
    "In Stock": "green",
    "Low stock": "amber",
    "Out of stock": "red",
    "Claim open": "amber",
    Closed: "slate",
    Commissioned: "green",
  };

  function statusPill(status) {
    const tone = TONES[status] || "slate";
    const pill = el("span", `badge ${tone}`);
    pill.append(el("i"), status || "Unknown");
    return pill;
  }

  function lockBadge() {
    const b = el("span", "lock-badge");
    b.append(icon("lock-keyhole", 12), "Locked");
    return b;
  }

  function roleBadge(role) {
    const labels = {
      admin: "Admin",
      tech: "Technician",
      sales: "Sales",
      inventory: "Inventory",
      customer: "Customer",
    };
    return el("span", `role-badge role-${role}`, labels[role] || role);
  }

  function viewOnly(text = "View Only") {
    const pill = el("span", "view-only-pill");
    pill.append(icon("lock-keyhole", 14), text);
    return pill;
  }

  function table({
    module,
    rows = [],
    columns = [],
    onRowClick = null,
    actionsRenderer = null,
  }) {
    const wrap = el("div", "table-scroll");
    const t = el("table");
    const head = t.createTHead().insertRow();
    const body = t.createTBody();

    for (const col of columns) {
      const th = el("th");
      th.scope = "col";
      th.textContent = col.label;
      head.append(th);
    }
    if (actionsRenderer || onRowClick) {
      const th = el("th");
      th.scope = "col";
      th.append(el("span", "sr-only", "Actions"));
      head.append(th);
    }

    for (const r of rows) {
      const row = body.insertRow();
      if (onRowClick) {
        row.onclick = (e) => {
          if (!e.target.closest("button, a, input, select")) onRowClick(r);
        };
      }

      for (const col of columns) {
        const td = row.insertCell();
        if (col.className) td.className = col.className;

        if (col.render) {
          const rendered = col.render(r[col.key], r);
          if (rendered instanceof Node) td.append(rendered);
          else td.innerHTML = String(rendered ?? "");
        } else if (col.key === "status") {
          td.append(statusPill(r.status));
        } else if (col.format === "inr") {
          td.textContent = BW.utils.formatINR(r[col.key]);
        } else if (col.format === "date") {
          td.textContent = BW.utils.formatDate(r[col.key]);
        } else {
          td.textContent = r[col.key] ?? "—";
        }
      }

      if (actionsRenderer) {
        const actionsTd = row.insertCell();
        actionsTd.className = "table-actions-cell";
        actionsTd.append(actionsRenderer(r));
      } else if (onRowClick) {
        const arrowTd = row.insertCell();
        const arrowBtn = button("", () => onRowClick(r), "row-btn", "chevron-right");
        arrowBtn.setAttribute("aria-label", "View details");
        arrowTd.append(arrowBtn);
      }
    }

    staggerRows(body);
    wrap.append(t);

    if (!rows.length) {
      wrap.append(el("p", "empty", "No records found matching the criteria."));
    }
    return wrap;
  }

  function modal(title, variant = "drawer") {
    const dialog = el("dialog", `modal ${variant}`);
    const inner = el("div", "modal-inner");
    const head = el("header");
    const closeBtn = button("", () => dialog.close(), "icon-btn", "x");
    closeBtn.setAttribute("aria-label", "Close dialog");

    head.append(el("h2", "", title), closeBtn);
    inner.append(head);
    dialog.append(inner);
    document.body.append(dialog);

    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.onclick = (e) => {
      if (e.target === dialog) dialog.close();
    };

    dialog.showModal();
    return { dialog, body: inner, close: () => dialog.close() };
  }

  function toast(message, type = "success") {
    document.querySelector(".toast")?.remove();
    const t = el("div", `toast toast-${type}`);
    t.setAttribute("role", "status");
    const glyph = type === "error" ? "alert-triangle" : "circle-check";
    t.append(icon(glyph), document.createTextNode(message), el("i"));
    document.body.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  function field(grid, {
    name,
    label,
    type = "text",
    value = "",
    options = null,
    required = false,
    min = null,
    max = null,
    step = null,
    readOnly = false,
    disabled = false,
    placeholder = "",
    hint = "",
  }) {
    const wrap = el("label", "", label || name);
    let inputEl;

    if (options && Array.isArray(options)) {
      inputEl = el("select");
      if (placeholder) {
        inputEl.add(new Option(placeholder, ""));
      }
      for (const opt of options) {
        if (Array.isArray(opt)) {
          inputEl.add(new Option(opt[1], opt[0]));
        } else {
          inputEl.add(new Option(opt, opt));
        }
      }
      if (value !== undefined && value !== null) {
        inputEl.value = String(value);
      }
    } else if (type === "textarea") {
      inputEl = el("textarea");
      inputEl.value = value ?? "";
      if (placeholder) inputEl.placeholder = placeholder;
    } else {
      inputEl = el("input");
      inputEl.type = type;
      inputEl.value = value ?? "";
      if (placeholder) inputEl.placeholder = placeholder;
      if (min !== null) inputEl.min = String(min);
      if (max !== null) inputEl.max = String(max);
      if (step !== null) inputEl.step = String(step);
    }

    inputEl.name = name;
    if (required) inputEl.required = true;
    if (readOnly) inputEl.readOnly = true;
    if (disabled) inputEl.disabled = true;

    wrap.append(inputEl);
    if (hint) wrap.append(el("small", "field-hint", hint));
    grid.append(wrap);

    return inputEl;
  }

  /**
   * Styled replacement for window.prompt() when a reason is required.
   * Resolves with the trimmed reason, or null if the user cancels.
   */
  function reasonModal({
    title,
    message = "",
    label = "Reason",
    placeholder = "",
    confirmLabel = "Confirm",
    danger = false,
  }) {
    return new Promise((resolve) => {
      const { dialog, body } = modal(title, "spotlight reason-modal");
      const form = el("form");
      form.noValidate = true;
      const fieldLabel = el("label", "reason-label", label);
      const input = el("textarea", "reason-input");
      input.rows = 4;
      input.maxLength = 500;
      input.placeholder = placeholder;
      input.required = true;
      fieldLabel.append(input);
      const error = el("p", "form-error");
      error.setAttribute("role", "alert");
      error.hidden = true;
      const actions = el("div", "modal-actions");
      const confirmBtn = button(confirmLabel, null, danger ? "primary-btn danger-solid" : "primary-btn", danger ? "x" : "check");
      confirmBtn.type = "submit";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
        if (dialog.open) dialog.close();
      };
      actions.append(button("Cancel", () => finish(null)), confirmBtn);
      if (message) form.append(el("p", "form-caption", message));
      form.append(fieldLabel, error, actions);
      body.append(form);

      input.addEventListener("input", () => {
        input.classList.remove("field-invalid");
        error.hidden = true;
      });
      form.onsubmit = (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (value.length < 3) {
          error.textContent = "Please enter a reason (at least 3 characters).";
          error.hidden = false;
          input.classList.add("field-invalid");
          input.focus();
          return;
        }
        finish(value);
      };
      // Esc / backdrop click close the dialog without a value.
      dialog.addEventListener("close", () => finish(null));
      dialog.addEventListener("cancel", () => finish(null));
      requestAnimationFrame(() => input.focus());
    });
  }

  function alert(container, message, type = "error") {
    container.textContent = message;
    container.className = `form-error ${type === "warning" ? "form-warning" : ""}`;
    container.setAttribute("role", "alert");
    container.hidden = !message;
  }

  function animateNumbers(root) {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    root.querySelectorAll("[data-count]").forEach((node) => {
      const target = Number(node.dataset.count);
      if (Number.isNaN(target)) return;
      const fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
      const start = performance.now();

      function tick(now) {
        if (!node.isConnected) return;
        const progress = reduced.matches ? 1 : Math.min(1, (now - start) / 550);
        const current = progress < 1 ? Math.round(target * (1 - (1 - progress) ** 3)) : target;
        node.textContent = fmt.format(current);
        if (progress < 1) requestAnimationFrame(tick);
      }

      if (!reduced.matches) node.textContent = "0";
      requestAnimationFrame(tick);
    });
  }

  function staggerRows(tbody) {
    Array.from(tbody.rows).forEach((row, i) => {
      row.style.setProperty("--row-delay", `${Math.min(i, 8) * 24}ms`);
    });
  }

  Object.assign(BW.ui, {
    el,
    icon,
    button,
    heading,
    kpis,
    table,
    modal,
    toast,
    alert,
    reasonModal,
    field,
    statusPill,
    lockBadge,
    roleBadge,
    viewOnly,
    animateNumbers,
    staggerRows,
  });

  // Backward compatibility aliases on window.BW
  Object.assign(BW, {
    el,
    icon,
    button,
    heading,
    kpis,
    table,
    modal,
    toast,
    lockBadge,
    viewOnly,
  });
})();

