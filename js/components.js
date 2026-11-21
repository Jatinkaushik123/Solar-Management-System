(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  function icon(name, size = 18) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [k, v] of Object.entries({
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    }))
      n.setAttribute(k, v);
    n.innerHTML = iconPaths[name] || iconPaths["file-text"];
    return n;
  }
  function button(text, fn, cls = "secondary-btn", glyph) {
    const b = el("button", cls);
    b.type = "button";
    if (glyph) b.append(icon(glyph));
    b.append(document.createTextNode(text));
    b.onclick = fn;
    return b;
  }
  function heading(title, description, action, fn) {
    const root = el("div", "page-heading"),
      box = el("div");
    box.append(el("h1", "", title), el("p", "", description));
    root.append(box, button(action, fn, "primary-btn", "plus"));
    return root;
  }
  function kpis(cards) {
    const root = el("div", "kpis");
    for (const {
      label,
      value,
      detail,
      icon: glyph,
      color = "teal",
      unit = "",
    } of cards) {
      const card = el("article", "kpi"),
        top = el("div", "kpi-top"),
        tile = el("span", "icon-tile " + color),
        strong = el("strong"),
        num = el("span", "", value);
      tile.append(icon(glyph));
      top.append(el("span", "", label), tile);
      num.dataset.count = value;
      num.setAttribute("aria-hidden", "true");
      strong.append(
        el("span", "sr-only", value),
        num,
        " ",
        el("small", "", unit),
      );
      card.append(top, strong, el("p", "", detail));
      root.append(card);
    }
    queueMicrotask(() => BW.animateNumbers(root));
    return root;
  }
  const tones = {
    "In progress": "teal",
    Completed: "green",
    Planning: "blue",
    "On hold": "amber",
    Qualified: "green",
    Approved: "green",
    Accepted: "green",
    Commissioned: "green",
    Active: "teal",
    "In stock": "green",
    "Low stock": "amber",
    "Out of stock": "red",
    "Claim open": "amber",
    Scheduled: "blue",
    "On site": "teal",
  };
  function table(module, rows, fields) {
    const wrap = el("div", "table-scroll"),
      t = el("table"),
      head = t.createTHead().insertRow(),
      body = t.createTBody();
    for (const label of ["Record ID", ...fields, "Status", "Actions"]) {
      const th = el("th");
      th.scope = "col";
      th.append(el("span", label === "Actions" ? "sr-only" : "", label));
      head.append(th);
    }
    for (const r of rows) {
      const row = body.insertRow(),
        open = () => edit(module, r);
      row.onclick = (e) => {
        if (!e.target.closest("button")) open();
      };
      row.insertCell().append(button(r.id, open, "id-link"));
      fields.forEach((f, i) => {
        const td = row.insertCell();
        td.textContent = BW.displayValue(f, r[f]);
        if (!i) td.className = "primary-cell";
      });
      const badge = el("span", "badge " + (tones[r.status] || "slate"));
      badge.append(el("i"), r.status);
      row.insertCell().append(badge);
      const arrow = button("", open, "row-btn", "chevron-right");
      arrow.setAttribute("aria-label", "Open " + r.id);
      row.insertCell().append(arrow);
    }
    BW.staggerRows(body);
    wrap.append(t);
    if (!rows.length)
      wrap.append(
        el("p", "empty", "No matching records. Try another search or status."),
      );
    return wrap;
  }
  function modal(title, variant = "drawer") {
    const d = el("dialog", "modal " + variant),
      body = el("div", "modal-inner"),
      head = el("header"),
      close = button("", () => d.close(), "icon-btn", "x");
    close.setAttribute("aria-label", "Close dialog");
    head.append(el("h2", "", title), close);
    body.append(head);
    d.append(body);
    d.setAttribute("aria-label", title);
    document.body.append(d);
    d.addEventListener("close", () => d.remove(), { once: true });
    d.onclick = (e) => {
      if (e.target === d) d.close();
    };
    d.showModal();
    return { dialog: d, body };
  }
  function toast(message) {
    document.querySelector(".toast")?.remove();
    const t = el("div", "toast");
    t.setAttribute("role", "status");
    t.append(icon("circle-check"), message, el("i"));
    document.body.append(t);
    setTimeout(() => t.remove(), 3500);
  }
  function input(grid, name, value = "", type = "text", options) {
    const label = el("label", "", name),
      field = el(options ? "select" : "input");
    field.name = name;
    field.required = true;
    if (options) for (const text of options) field.add(new Option(text, text));
    else field.type = type;
    field.value = value ?? "";
    label.append(field);
    grid.append(label);
    return field;
  }
  function workflow(body, label, actions) {
    const row = el("div", "workflow");
    row.append(el("small", "", label), ...actions);
    body.append(row);
  }
  const nextStep = {
    Enquiries: ["Qualified", "Surveys", "Schedule survey"],
    Surveys: ["Approved", "Quotations", "Prepare quotation"],
    Quotations: ["Accepted", "Projects", "Create project"],
    Projects: ["In progress", "Installations", "Schedule installation"],
    Installations: ["Commissioned", "Warranty", "Register warranty"],
  };
  function edit(module, record = {}) {
    const schema = BW.schemas[module],
      ctl = BW.controllers[module] || {},
      isNew = !record.id,
      { dialog, body } = modal(
        isNew ? "New " + schema.single : record.id,
        isNew && module === "Enquiries" ? "spotlight" : "drawer",
      ),
      form = el("form"),
      grid = el("div", "form-grid"),
      fields = {},
      error = el("p", "form-error"),
      actions = el("div", "modal-actions"),
      saveBtn = el("button", "primary-btn", "Save " + schema.single);
    error.setAttribute("role", "alert");
    form.append(
      el(
        "p",
        "form-caption",
        (isNew ? "Enter " : "Edit ") +
          schema.single +
          " details" +
          (record.sourceId ? " · From " + record.sourceId : ""),
      ),
      grid,
      error,
      actions,
    );
    body.append(form);
    for (const f of schema.fields) {
      const numeric = /Capacity|Amount|Stock|Reorder/.test(f),
        type = numeric
          ? "number"
          : f.includes("date")
            ? "date"
            : f === "Phone"
              ? "tel"
              : "text";
      const field = input(grid, f, record[f], type);
      fields[f] = field;
      if (numeric) {
        field.min = f.includes("Capacity") ? "0.01" : "0";
        field.step = /Capacity|Amount/.test(f) ? "0.01" : "1";
      }
      if (type === "tel") field.pattern = "[+]?[0-9 ]{10,15}";
    }
    if (module !== "Inventory")
      fields.status = input(
        grid,
        "Status",
        record.status || schema.statuses[0],
        "text",
        schema.statuses,
      );
    const extras = {};
    let pending = false;
    const read = () => ({
      ...record,
      ...Object.fromEntries(
        Object.entries(fields).map(([f, n]) => [f, n.value.trim()]),
      ),
      ...extras,
    });
    async function save(overrides = {}, message) {
      if (pending || !form.reportValidity()) return;
      const r = { ...read(), ...overrides };
      if (schema.fields.some((f) => !String(r[f] ?? "").trim())) {
        error.textContent = "Complete all fields.";
        return;
      }
      pending = true;
      saveBtn.disabled = true;
      try {
        BW.data = await BW.api.save(module, r);
        dialog.close();
        BW.render();
        toast(
          message ||
            schema.single[0].toUpperCase() +
              schema.single.slice(1) +
              (isNew ? " created" : " updated"),
        );
      } catch (e) {
        error.textContent = e.message;
      } finally {
        pending = false;
        saveBtn.disabled = false;
      }
    }
    actions.append(
      button("Cancel", () => dialog.close()),
      saveBtn,
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      save();
    };
    ctl.decorate?.({
      module,
      record,
      body,
      dialog,
      grid,
      fields,
      extras,
      read,
      save,
      error,
    });
    const next = nextStep[module];
    if (record.id && next && record.status === next[0]) {
      const existing = BW.data[next[1]].find((x) => x.sourceId === record.id),
        name = record.Customer || record["Project name"] || record["Site name"];
      const action = button(existing ? "Open " + existing.id : next[2], () => {
        dialog.close();
        edit(
          next[1],
          existing || {
            sourceId: record.id,
            Customer: name,
            "Project name": name,
            "Site name": name,
            City: record.City,
            "Capacity (kW)": record["Capacity (kW)"],
            "Survey date": BW.dateString(new Date()),
            "Installation date": BW.dateString(new Date()),
          },
        );
      });
      form.addEventListener("input", () => {
        action.disabled = true;
      });
      workflow(body, "Next step", [action]);
    }
  }
  function registerPage() {
    const m = BW.page,
      s = BW.schemas[m],
      rows = BW.data[m],
      root = BW.main,
      ctl = BW.controllers[m],
      panel = el("section", "panel"),
      head = el("div", "panel-heading"),
      count = el("span", "muted"),
      filters = el("div", "filters"),
      search = el("label", "search-box"),
      q = el("input"),
      status = el("select");
    q.placeholder = "Search " + m.toLowerCase() + "…";
    q.setAttribute("aria-label", "Search " + m);
    status.setAttribute("aria-label", "Filter by status");
    for (const v of ["All statuses", ...s.statuses])
      status.add(new Option(v, v));
    search.append(icon("search", 17), q);
    filters.append(search, status);
    head.append(
      el("h2", "", m === "Inventory" ? "Stock register" : m + " register"),
      count,
    );
    panel.append(head, filters);
    const title = heading(m, s.description, "New " + s.single, () => edit(m));
    root.replaceChildren(title, el("div", "kpis"), panel);
    ctl?.toolbar?.(filters);
    const state = (BW.filters ||= {});
    q.value = state.query || "";
    status.value = state.status || "All statuses";
    function filter() {
      state.query = q.value;
      state.status = status.value;
      const needle = q.value.trim().toLowerCase(),
        filtered = rows.filter(
          (r) =>
            (status.value === "All statuses" || status.value === r.status) &&
            [r.id, r.status, ...s.fields.map((f) => r[f])]
              .join(" ")
              .toLowerCase()
              .includes(needle),
        );
      root
        .querySelector(".kpis")
        .replaceWith(
          kpis([
            {
              label:
                "Total " +
                (m === "Warranty"
                  ? "warranties"
                  : m === "Inventory"
                    ? "items"
                    : m.toLowerCase()),
              value: filtered.length,
              detail:
                needle || status.selectedIndex
                  ? "Matching records"
                  : "All records",
              icon: "layers",
              color: "blue",
            },
            ...s.statuses
              .slice(0, 3)
              .map((st, i) => ({
                label: st,
                value: filtered.filter((r) => r.status === st).length,
                detail:
                  s.single[0].toUpperCase() + s.single.slice(1) + " records",
                icon: ["activity", "clipboard-list", "list-checks"][i],
                color: ["teal", "amber", "purple"][i],
              })),
          ]),
        );
      count.textContent = filtered.length + " records";
      panel.querySelector(".table-scroll")?.remove();
      panel.append(table(m, filtered, s.fields));
    }
    q.oninput = filter;
    status.onchange = filter;
    filter();
  }
  Object.assign(BW, {
    el,
    icon,
    button,
    heading,
    kpis,
    table,
    modal,
    toast,
    input,
    workflow,
    edit,
    registerPage,
  });
})();
