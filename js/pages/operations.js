/**
 * Bijli Wala SIMS — Hosted operations (Supabase API v10)
 * Live staff panels mounted above each page's own content:
 *   Inventory  · fulfilment: receive stock, dispatch pick lists with serials, delivery
 *   Projects   · installations: admin schedules, technician reports (private photos), time
 *   Warranty   · warranty/equipment lookup, service tickets: assign, resolve, payments
 *   Dashboard  · admin management report (+ CSV) and payment reconciliation
 *   Users      · admin staff list and disable
 * Every POST sends a per-action UUID Idempotency-Key (kept for retry, cleared on a
 * definite answer). Amounts from the API are paise; the UI shows rupees.
 */
window.BW = window.BW || {};

(() => {
  "use strict";

  const el = (...a) => BW.ui.el(...a);
  const human = (s) => String(s || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const paise = (v) => {
    const n = Number(v);
    if (v == null || v === "" || !Number.isFinite(n)) return "—";
    const r = n / 100;
    return "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
  };
  const when = (v) => (v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const short = (id) => String(id || "").slice(0, 8);
  const isoLocal = (d) => {
    const x = new Date(d);
    x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
    return x.toISOString().slice(0, 16);
  };
  /** datetime-local value -> ISO with the viewer's offset (e.g. +05:30). */
  const withOffset = (local) => {
    const d = new Date(local);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
    return `${local.length === 16 ? local + ":00" : local}${sign}${pad(off / 60)}:${pad(off % 60)}`;
  };

  function errorText(err) {
    const known = {
      duplicate_serial: "That serial is already in this receipt.",
      serial_already_registered: "That serial is already registered in stock.",
      invalid_serial_count: "Enter exactly one serial per unit for serialized items.",
      invalid_serial: "One of the serials isn't valid.",
      reservation_mismatch: "Quantities must match the reserved pick list. Refresh the project.",
      serial_unavailable: "A serial isn't available (shipped or wrong SKU). Refresh the serial list.",
      stock_shortage: "Not enough stock. Receive stock first, then retry.",
      already_dispatched: "This pick list was already dispatched with a different manifest.",
      delivery_required: "Record delivery before submitting the installation report.",
      evidence_required: "Attach at least one installation photo.",
      invalid_evidence: "A photo path isn't valid for this work order. Re-upload the photos.",
      technician_unavailable: "That technician isn't available. Refresh the list.",
      installation_locked: "The installation is already completed.",
      invalid_installation_times: "Work times must be after delivery, end after start, and not in the future.",
      signoff_prerequisites: "Sign-off needs a passing report.",
      active_ticket_exists: "There's already an open ticket for this serial.",
      equipment_replaced: "This unit was replaced. Use the replacement serial.",
      replacement_sku_mismatch: "The replacement serial must be the same SKU.",
      material_rate_required: "An admin must record a material cost rate first.",
      technician_rate_required: "An admin must record this technician's hourly rate first.",
      covered_charge_forbidden: "Covered repairs must have ₹0 labour and part charges.",
      ticket_locked: "This ticket is already resolved. Reload it.",
      resolution_required: "Resolve the ticket before this step.",
      invoice_required: "There's no invoice on this ticket (covered repair).",
      payment_exceeds_balance: "The payment is more than the outstanding balance.",
      payment_reference_conflict: "That payment reference was already used.",
      idempotency_conflict: "This action was already sent with different details. Try again.",
    };
    if (known[err.code]) return `${known[err.code]} (${err.status} ${err.code})`;
    if (err.status === 403) return "Your role can't perform this action.";
    if (err.status === 404) return "Not found, or not visible to your account.";
    if (err.status === 400) return `Invalid input (${err.code}).`;
    if (err.status === 503) return "Service temporarily unavailable. Retry; the same request is resent safely.";
    if (!err.status) return "Can't reach the server. Retry; the same request is resent safely.";
    return `Request failed (${err.status} · ${err.code}).`;
  }

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
  const get = (path) => BW.auth.request(path);
  const items = (r) => (Array.isArray(r) ? r : r?.items || []);

  function panel(host, title, meta) {
    const section = el("section", "panel live-panel");
    const head = el("div", "panel-heading");
    head.append(el("h2", "", title), el("span", "badge teal", "Live API"));
    if (meta) head.append(meta);
    const body = el("div", "live-body");
    section.append(head, body);
    host.append(section);
    return body;
  }

  function dl(pairs) {
    const m = el("dl", "cx-meta");
    for (const [k, v] of pairs) {
      if (v == null || v === "") continue;
      const r = el("div");
      r.append(el("dt", "", k), el("dd", "", String(v)));
      m.append(r);
    }
    return m;
  }

  /** Drawer form with inline role="alert" errors; onSubmit(ctx) may call ctx.fail(). */
  function formModal(title, caption, build, submitLabel, onSubmit) {
    const { dialog, body } = BW.ui.modal(title, "drawer");
    const form = el("form");
    form.noValidate = true;
    const grid = el("div", "form-grid");
    const msg = el("p", "form-error");
    msg.setAttribute("role", "alert");
    msg.hidden = true;
    if (caption) form.append(el("p", "form-caption", caption));
    form.append(grid);
    const ctx = build(grid) || {};
    const submit = BW.ui.button(submitLabel, null, "primary-btn", "check");
    submit.type = "submit";
    const actions = el("div", "modal-actions");
    actions.append(BW.ui.button("Close", () => dialog.close()), submit);
    form.append(msg, actions);
    body.append(form);
    form.oninput = (e) => e.target.classList?.remove("field-invalid");
    const fail = (t, input) => {
      msg.textContent = t;
      msg.hidden = false;
      input?.classList.add("field-invalid");
      input?.focus();
      throw Object.assign(new Error("v"), { handled: true });
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      msg.hidden = true;
      submit.disabled = true;
      try {
        await onSubmit({ ...ctx, dialog, fail });
      } catch (err) {
        if (!err.handled) {
          msg.textContent = errorText(err);
          msg.hidden = false;
        }
      } finally {
        submit.disabled = false;
      }
    };
    return dialog;
  }

  async function technicians() {
    const r = await get("/v1/staff/assignees");
    return items(r).filter((p) => String(p.role).toLowerCase() === "technician").map((p) => [p.id || p.user_id, p.display_name || p.id]);
  }

  /* =================== Inventory · fulfilment =================== */
  async function receiveModal(refresh) {
    let catalogue;
    try {
      catalogue = items(await get("/v1/inventory/items"));
    } catch (err) {
      return BW.ui.toast(errorText(err), "error");
    }
    formModal("Receive stock", "Record units arriving at the warehouse. Serialized items need one scanned serial per unit.", (grid) => {
      const item = BW.ui.field(grid, { name: "item", label: "Item", options: catalogue.map((i) => [i.item_id, `${i.name} · ${i.on_hand ?? 0} on hand${i.serialized ? " · serialized" : ""}`]), placeholder: "Select item", required: true });
      const qty = BW.ui.field(grid, { name: "qty", label: "Quantity", type: "number", min: 1, max: 1000, step: 1, value: 1, required: true });
      const serials = BW.ui.field(grid, { name: "serials", label: "Serials (one per line, as scanned)", type: "textarea", required: false, placeholder: "WAREHOUSE-DEMO-001" });
      serials.closest("label").classList.add("span-2");
      return { item, qty, serials };
    }, "Receive", async ({ item, qty, serials, dialog, fail }) => {
      const sku = catalogue.find((i) => i.item_id === item.value);
      if (!sku) fail("Choose an item.", item);
      const q = Number(qty.value);
      if (!Number.isInteger(q) || q < 1 || q > 1000) fail("Quantity must be a whole number from 1 to 1,000.", qty);
      const list = serials.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (sku.serialized) {
        if (list.length !== q) fail(`Enter exactly ${q} serial${q > 1 ? "s" : ""} (one per unit). You entered ${list.length}.`, serials);
        const dup = list.find((s, i) => list.indexOf(s) !== i);
        if (dup) fail(`Serial ${dup} is entered twice.`, serials);
      } else if (list.length) fail("This item isn't serialized: leave serials empty.", serials);
      const res = await post(`receipt:${sku.item_id}:${q}:${list.join(",")}`, "/v1/inventory/receipts", { item_id: sku.item_id, quantity: q, serials: sku.serialized ? list : [] });
      BW.ui.toast(`Received ${res.delta ?? q} × ${sku.name}`);
      dialog.close();
      refresh();
    });
  }

  async function dispatchModal(project, refresh) {
    const lines = project.pick_lines || [];
    const serialOptions = {};
    try {
      for (const l of lines) {
        if (!l.serialized) continue;
        const r = await get(`/v1/inventory/serials?item_id=${encodeURIComponent(l.item_id)}`);
        serialOptions[l.item_id] = items(r).map((s) => s.serial);
      }
    } catch (err) {
      return BW.ui.toast(errorText(err), "error");
    }
    formModal(`Dispatch · ${project.enquiry_reference || project.reference || short(project.id)}`, "Scan one serial per serialized unit. Quantities come from the reserved pick list.", (grid) => {
      const inputs = [];
      for (const l of lines) {
        const qty = Number(l.quantity ?? l.reserved ?? l.required ?? 0);
        const box = el("div", "span-2 equipment-lines");
        box.append(el("strong", "", `${qty} × ${l.name || l.item_id}${l.serialized ? " · serialized" : ""}`));
        const serialInputs = [];
        if (l.serialized) {
          const listId = `serials-${l.item_id}`;
          const dlist = el("datalist");
          dlist.id = listId;
          for (const s of serialOptions[l.item_id] || []) dlist.append(new Option(s, s));
          box.append(dlist);
          for (let i = 0; i < qty; i++) {
            const inp = BW.ui.field(box, { name: `serial_${l.item_id}_${i}`, label: `Serial ${i + 1}`, required: true, placeholder: "Scan serial" });
            inp.setAttribute("list", listId);
            inp.value = (serialOptions[l.item_id] || [])[i] || "";
            serialInputs.push(inp);
          }
        }
        grid.append(box);
        inputs.push({ line: l, qty, serialInputs });
      }
      return { inputs };
    }, "Dispatch shipment", async ({ inputs, dialog, fail }) => {
      const all = [];
      const body = {
        lines: inputs.map(({ line, qty, serialInputs }) => {
          const serials = serialInputs.map((i) => i.value.trim());
          serialInputs.forEach((inp, i) => {
            if (!serials[i]) fail("Scan every serial.", inp);
            if (all.includes(serials[i])) fail(`Serial ${serials[i]} is used twice.`, inp);
            all.push(serials[i]);
          });
          return { item_id: line.item_id, quantity: qty, serials };
        }),
      };
      const pickId = project.pick_list_id;
      const res = await post(`dispatch:${pickId}:${JSON.stringify(body.lines)}`, `/v1/pick-lists/${encodeURIComponent(pickId)}/dispatch`, body);
      BW.ui.toast(`Dispatched · shipment ${short(res.id)}`);
      dialog.close();
      refresh();
    });
  }

  async function renderFulfilment(host) {
    host.replaceChildren();
    const refresh = () => renderFulfilment(host);
    const body = panel(host, "Fulfilment · confirmed orders", BW.ui.button("Receive stock", () => receiveModal(refresh), "secondary-btn", "plus"));
    body.append(el("p", "muted", "Loading…"));
    let projects;
    try {
      projects = items(await get("/v1/projects"));
    } catch (err) {
      body.replaceChildren(el("p", "form-error", errorText(err)));
      return;
    }
    body.replaceChildren();
    if (!projects.length) return body.append(el("p", "empty", "No confirmed orders yet."));
    const list = el("div", "live-list");
    for (const s of projects) {
      const card = el("article", "cx-survey live-card");
      const top = el("div", "cx-survey-top");
      top.append(el("strong", "", s.enquiry_reference || s.reference || short(s.id)), BW.ui.statusPill(human(s.pick_state || "")));
      const out = el("div");
      card.append(top, dl([["Order", s.reference], ["Site", s.site], ["Work", human(s.work_state || "")]]), out);
      const open = BW.ui.button("Open", async () => {
        out.replaceChildren(el("p", "muted", "Loading…"));
        try {
          const p = await get(`/v1/projects/${encodeURIComponent(s.id || s.order_id)}`);
          const ship = p.shipment;
          out.replaceChildren(dl([
            ["Pick list", `${short(p.pick_list_id)} · ${human(p.pick_state)}`],
            ["Lines", (p.pick_lines || []).map((l) => `${l.quantity} × ${l.item_id}${l.serialized ? " (serialized)" : ""}`).join(", ")],
            ["Shipment", ship ? `${human(ship.state)} · ${when(ship.delivered_at || ship.dispatched_at)}` : "Not dispatched"],
          ]));
          const actions = el("div", "cx-quote-actions");
          if (!ship && p.pick_state === "ready_to_pick") actions.append(BW.ui.button("Dispatch", () => dispatchModal(p, refresh), "primary-btn", "boxes"));
          if (ship && ship.state !== "delivered") {
            const b = BW.ui.button("Mark delivered", async () => {
              b.disabled = true;
              try {
                await post(`delivery:${ship.id}`, `/v1/shipments/${encodeURIComponent(ship.id)}/delivery`, {});
                BW.ui.toast("Delivered: warranty coverage started");
                refresh();
              } catch (err) {
                b.disabled = false;
                out.append(el("p", "form-error", errorText(err)));
              }
            }, "primary-btn", "check");
            actions.append(b);
          }
          out.append(actions);
        } catch (err) {
          out.replaceChildren(el("p", "form-error", errorText(err)));
        }
      }, "secondary-btn", "chevron-right");
      card.append(open);
      list.append(card);
    }
    body.append(list);
  }

  /* =================== Projects · installation =================== */
  async function scheduleModal(workId, refresh) {
    let techs;
    try {
      techs = await technicians();
    } catch (err) {
      return BW.ui.toast(errorText(err), "error");
    }
    formModal("Schedule installation", "Assign the installation technician and a future date and time.", (grid) => {
      const tech = BW.ui.field(grid, { name: "tech", label: "Technician", options: techs, placeholder: "Select technician", required: true });
      const at = BW.ui.field(grid, { name: "at", label: "Scheduled at", type: "datetime-local", required: true, value: isoLocal(Date.now() + 86400e3).slice(0, 11) + "09:30" });
      at.min = isoLocal(Date.now());
      return { tech, at };
    }, "Schedule", async ({ tech, at, dialog, fail }) => {
      if (!tech.value) fail("Choose a technician.", tech);
      if (!at.value || new Date(at.value) <= new Date()) fail("Choose a future date and time.", at);
      await post(`schedule:${workId}:${tech.value}:${at.value}`, `/v1/installations/${encodeURIComponent(workId)}/schedule`, { technician_id: tech.value, scheduled_at: withOffset(at.value) });
      BW.ui.toast("Installation scheduled");
      dialog.close();
      refresh();
    });
  }

  async function reportModal(workId, refresh, deliveredAt) {
    // Default work window: starts after delivery (the API rejects earlier times).
    const earliest = Math.max(Date.now() - 4 * 3600e3, deliveredAt ? Date.parse(deliveredAt) + 60e3 : 0);
    const startDefault = Math.min(earliest, Date.now() - 2 * 60e3);
    formModal("Installation report", "Record the actual work time, the generation test and 1–10 photos (JPEG, PNG or WebP, up to 8 MiB each). Photos are stored privately.", (grid) => {
      const started = BW.ui.field(grid, { name: "started", label: "Started at", type: "datetime-local", required: true, value: isoLocal(startDefault) });
      const ended = BW.ui.field(grid, { name: "ended", label: "Ended at", type: "datetime-local", required: true, value: isoLocal(Date.now() - 60e3) });
      if (deliveredAt) started.min = ended.min = isoLocal(Date.parse(deliveredAt));
      started.max = ended.max = isoLocal(Date.now());
      const kw = BW.ui.field(grid, { name: "kw", label: "System size (kW)", type: "number", min: 0.1, step: 0.01, value: 2.75, required: true });
      const test = BW.ui.field(grid, { name: "test", label: "Generation test", options: [["pass", "Pass"], ["fail", "Fail"]], value: "pass", required: true });
      const label = el("label", "span-2", "Photos");
      const photos = el("input");
      photos.type = "file";
      photos.accept = "image/jpeg,image/png,image/webp";
      photos.multiple = true;
      photos.name = "photos";
      label.append(photos);
      grid.append(label);
      return { started, ended, kw, test, photos };
    }, "Upload photos & submit report", async ({ started, ended, kw, test, photos, dialog, fail }) => {
      if (!started.value || !ended.value) fail("Enter the start and end time.");
      if (new Date(ended.value) <= new Date(started.value)) fail("End time must be after the start time.", ended);
      if (new Date(ended.value) > new Date()) fail("The end time can't be in the future.", ended);
      const k = Number(kw.value);
      if (!(k > 0)) fail("Enter the installed system size.", kw);
      const files = [...photos.files];
      if (files.length < 1 || files.length > 10) fail("Attach between 1 and 10 photos.", photos);
      const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      for (const f of files) {
        if (!ext[f.type]) fail(`${f.name} isn't a JPEG, PNG or WebP image.`, photos);
        if (f.size > 8 * 1024 * 1024) fail(`${f.name} is larger than 8 MiB.`, photos);
      }
      // Upload each photo (write-once path), keeping the paths for a retry of this report.
      const action = `report:${workId}`;
      const pathKey = `bijli-wala.evidence.${workId}`;
      let paths = JSON.parse(sessionStorage.getItem(pathKey) || "[]");
      if (paths.length !== files.length) {
        paths = [];
        for (const f of files) {
          const path = `${workId}/${crypto.randomUUID()}.${ext[f.type]}`;
          await BW.auth.storageUpload("installation-evidence", path, f);
          paths.push(path);
        }
        sessionStorage.setItem(pathKey, JSON.stringify(paths));
      }
      const res = await post(action, `/v1/installations/${encodeURIComponent(workId)}/reports`, {
        started_at: withOffset(started.value),
        ended_at: withOffset(ended.value),
        system_kw: k,
        generation_test: test.value,
        photo_paths: paths,
      });
      sessionStorage.removeItem(pathKey);
      BW.ui.toast(`Report submitted · ${human(res.work_order?.state || "")}`);
      dialog.close();
      refresh();
    });
  }

  async function timeModal(workId, refresh) {
    formModal("Log installation time", "Attach your time to the signed installation report.", (grid) => ({
      date: BW.ui.field(grid, { name: "date", label: "Worked on", type: "date", value: todayIST(), max: todayIST(), required: true }),
      mins: BW.ui.field(grid, { name: "mins", label: "Minutes", type: "number", min: 1, step: 1, value: 60, required: true }),
    }), "Log time", async ({ date, mins, dialog, fail }) => {
      const m = Number(mins.value);
      if (!Number.isInteger(m) || m < 1) fail("Minutes must be a whole number above 0.", mins);
      if (!date.value || date.value > todayIST()) fail("The work date can't be in the future.", date);
      await post(`time:${workId}:${date.value}:${m}`, `/v1/installations/${encodeURIComponent(workId)}/time`, { worked_on: date.value, minutes: m });
      BW.ui.toast("Time logged");
      dialog.close();
      refresh();
    });
  }

  async function renderInstallations(host) {
    host.replaceChildren();
    const refresh = () => renderInstallations(host);
    const role = BW.auth.current().role;
    const body = panel(host, role === "tech" ? "My installations" : "Installations · work orders");
    body.append(el("p", "muted", "Loading…"));
    let projects;
    try {
      projects = items(await get("/v1/projects"));
    } catch (err) {
      body.replaceChildren(el("p", "form-error", errorText(err)));
      return;
    }
    body.replaceChildren();
    if (!projects.length) return body.append(el("p", "empty", "No installations yet."));
    const list = el("div", "live-list");
    for (const s of projects) {
      const card = el("article", "cx-survey live-card");
      const top = el("div", "cx-survey-top");
      top.append(el("strong", "", s.enquiry_reference || s.reference || short(s.id)), BW.ui.statusPill(human(s.work_state || "")));
      const out = el("div");
      card.append(top, dl([["Order", s.reference], ["Site", s.site]]), out);
      card.append(BW.ui.button("Open", async () => {
        out.replaceChildren(el("p", "muted", "Loading…"));
        try {
          const p = await get(`/v1/projects/${encodeURIComponent(s.id || s.order_id)}`);
          const workId = p.work_order_id;
          const w = workId ? await get(`/v1/installations/${encodeURIComponent(workId)}`) : p;
          const inst = w?.installation || {};
          const state = w?.work_state || p.work_state;
          out.replaceChildren(dl([
            ["Work order", workId ? `${short(workId)} · ${human(state)}` : "—"],
            ["Scheduled", w?.scheduled_at ? when(w.scheduled_at) : null],
            ["Shipment", p.shipment ? `${human(p.shipment.state)} ${when(p.shipment.delivered_at || p.shipment.dispatched_at)}` : "Not dispatched"],
            ["Report", inst.report ? `${human(inst.report.generation_test)} · ${inst.report.system_kw} kW` : null],
            ["Sign-off", inst.signoff ? when(inst.signoff.signed_at) : null],
          ]));
          if (inst.report?.photo_paths?.length) {
            const photos = el("div", "evidence-photos");
            out.append(photos);
            for (const path of inst.report.photo_paths.slice(0, 4)) {
              BW.auth.storageDownload("installation-evidence", path).then((blob) => {
                const img = el("img", "roof-preview");
                img.alt = "Installation photo";
                img.src = URL.createObjectURL(blob);
                photos.append(img);
              }).catch(() => photos.append(el("small", "muted", "Photo unavailable")));
            }
          }
          const actions = el("div", "cx-quote-actions");
          if (role === "admin" && workId && ["ready_to_schedule", "scheduled"].includes(state)) actions.append(BW.ui.button(state === "scheduled" ? "Reschedule" : "Schedule technician", () => scheduleModal(workId, refresh), "primary-btn", "calendar-days"));
          if (role === "tech" && workId && ["scheduled", "test_failed"].includes(state)) actions.append(BW.ui.button(state === "test_failed" ? "Submit new test report" : "Submit installation report", () => reportModal(workId, refresh, p.delivered_at || p.shipment?.delivered_at), "primary-btn", "clipboard-list"));
          if (role === "tech" && workId && state === "completed") actions.append(BW.ui.button("Log time", () => timeModal(workId, refresh), "secondary-btn", "activity"));
          if (state === "awaiting_signoff") actions.append(el("span", "muted", "Waiting for the customer's sign-off."));
          out.append(actions);
        } catch (err) {
          out.replaceChildren(el("p", "form-error", errorText(err)));
        }
      }, "secondary-btn", "chevron-right"));
      list.append(card);
    }
    body.append(list);
  }

  /* =================== Warranty · lookup & service tickets =================== */
  async function resolutionModal(ticket, refresh) {
    let catalogue = [];
    try {
      catalogue = items(await get("/v1/inventory/items"));
    } catch {
      /* parts optional */
    }
    // API: coverage is "covered" | "expired" | ... ; covered repairs must charge ₹0.
    const covered = ticket.coverage === "covered";
    formModal(`Resolve ${ticket.reference || short(ticket.id)}`, covered ? "Covered repair: customer charges must be ₹0." : "Expired or uncovered: labour and parts are invoiced.", (grid) => {
      const diagnosis = BW.ui.field(grid, { name: "diagnosis", label: "Diagnosis", required: true });
      const work = BW.ui.field(grid, { name: "work", label: "Work performed", type: "textarea", required: true });
      work.closest("label").classList.add("span-2");
      const date = BW.ui.field(grid, { name: "date", label: "Worked on", type: "date", value: todayIST(), max: todayIST(), required: true });
      const mins = BW.ui.field(grid, { name: "mins", label: "Minutes", type: "number", min: 1, step: 1, value: 60, required: true });
      const labour = BW.ui.field(grid, { name: "labour", label: "Labour charge (₹)", type: "number", min: 0, step: 1, value: 0, required: true });
      if (covered) labour.disabled = true;
      const partItem = BW.ui.field(grid, { name: "part", label: "Part used (optional)", options: catalogue.map((i) => [i.item_id, i.name]), placeholder: "No parts", required: false });
      const partQty = BW.ui.field(grid, { name: "pqty", label: "Part quantity", type: "number", min: 1, step: 1, value: 1, required: false });
      const partCharge = BW.ui.field(grid, { name: "pcharge", label: "Part unit charge (₹)", type: "number", min: 0, step: 1, value: 0, required: false });
      if (covered) partCharge.disabled = true;
      const partSerials = BW.ui.field(grid, { name: "pserials", label: "Replacement serials (serialized parts, one per line)", type: "textarea", required: false });
      partSerials.closest("label").classList.add("span-2");
      return { diagnosis, work, date, mins, labour, partItem, partQty, partCharge, partSerials };
    }, "Finalise repair", async (c) => {
      if (!c.diagnosis.value.trim()) c.fail("Enter the diagnosis.", c.diagnosis);
      if (!c.work.value.trim()) c.fail("Describe the work performed.", c.work);
      const m = Number(c.mins.value);
      if (!Number.isInteger(m) || m < 1) c.fail("Minutes must be a whole number above 0.", c.mins);
      const lab = Number(c.labour.value);
      if (!(lab >= 0)) c.fail("Labour charge can't be negative.", c.labour);
      const parts = [];
      if (c.partItem.value) {
        const q = Number(c.partQty.value), ch = Number(c.partCharge.value);
        if (!Number.isInteger(q) || q < 1) c.fail("Part quantity must be at least 1.", c.partQty);
        if (!(ch >= 0)) c.fail("Part charge can't be negative.", c.partCharge);
        const sku = catalogue.find((i) => i.item_id === c.partItem.value);
        const serials = c.partSerials.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (sku?.serialized && serials.length !== q) c.fail(`Enter ${q} replacement serial${q > 1 ? "s" : ""}.`, c.partSerials);
        parts.push({ item_id: c.partItem.value, quantity: q, unit_charge_paise: covered ? 0 : Math.round(ch * 100), serials: sku?.serialized ? serials : [] });
      }
      const body = {
        diagnosis: c.diagnosis.value.trim(),
        work_performed: c.work.value.trim(),
        worked_on: c.date.value,
        minutes: m,
        labour_charge_paise: covered ? 0 : Math.round(lab * 100),
        parts,
      };
      await post(`resolve:${ticket.id}`, `/v1/service-tickets/${encodeURIComponent(ticket.id)}/resolution`, body);
      BW.ui.toast("Repair finalised: awaiting customer confirmation");
      c.dialog.close();
      refresh();
    });
  }

  async function ticketAssignModal(ticket, refresh) {
    let techs;
    try {
      techs = await technicians();
    } catch (err) {
      return BW.ui.toast(errorText(err), "error");
    }
    formModal(`Assign ${ticket.reference || short(ticket.id)}`, null, (grid) => ({
      tech: BW.ui.field(grid, { name: "tech", label: "Technician", options: techs, placeholder: "Select technician", required: true }),
    }), "Assign", async ({ tech, dialog, fail }) => {
      if (!tech.value) fail("Choose a technician.", tech);
      await post(`ticket-assign:${ticket.id}:${tech.value}`, `/v1/service-tickets/${encodeURIComponent(ticket.id)}/assignment`, { technician_id: tech.value });
      BW.ui.toast("Ticket assigned");
      dialog.close();
      refresh();
    });
  }

  async function paymentModal(ticket, refresh) {
    formModal(`Record payment · ${ticket.reference || short(ticket.id)}`, `Invoice ${ticket.invoice?.reference || ""} · balance due ${paise(ticket.invoice?.remaining_paise)}`, (grid) => ({
      amount: BW.ui.field(grid, { name: "amount", label: "Amount received (₹)", type: "number", min: 1, step: 1, required: true }),
      method: BW.ui.field(grid, { name: "method", label: "Method", options: [["bank", "Bank"], ["cash", "Cash"]], value: "bank", required: true }),
      ref: BW.ui.field(grid, { name: "ref", label: "Receipt reference", required: true, placeholder: "BANK-RECEIPT-123" }),
      date: BW.ui.field(grid, { name: "date", label: "Collected on", type: "date", value: todayIST(), max: todayIST(), required: true }),
    }), "Record payment", async ({ amount, method, ref, date, dialog, fail }) => {
      const a = Number(amount.value);
      if (!(a > 0)) fail("Enter the amount received.", amount);
      if (ticket.invoice?.remaining_paise != null && a * 100 > Number(ticket.invoice.remaining_paise)) fail("That's more than the outstanding balance.", amount);
      if (!ref.value.trim()) fail("Enter the receipt reference.", ref);
      await post(`ticket-pay:${ticket.id}:${ref.value.trim()}`, `/v1/service-tickets/${encodeURIComponent(ticket.id)}/payments`, {
        amount_paise: Math.round(a * 100), method: method.value, reference: ref.value.trim(), collected_on: date.value,
      });
      BW.ui.toast("Payment recorded");
      dialog.close();
      refresh();
    });
  }

  async function renderService(host) {
    host.replaceChildren();
    const refresh = () => renderService(host);
    const role = BW.auth.current().role;

    // Serial lookup
    const look = panel(host, "Warranty & equipment lookup");
    const row = el("form", "filters");
    row.noValidate = true;
    const box = el("label", "search-box");
    const input = el("input");
    input.placeholder = "Exact serial, e.g. WAREHOUSE-DEMO-001";
    input.setAttribute("aria-label", "Serial number");
    box.append(BW.ui.icon("search", 16), input);
    const go = BW.ui.button("Look up", null, "primary-btn", "search");
    go.type = "submit";
    row.append(box, go);
    const result = el("div");
    look.append(row, result);
    row.onsubmit = async (e) => {
      e.preventDefault();
      const serial = input.value.trim();
      if (!serial) return;
      result.replaceChildren(el("p", "muted", "Searching…"));
      try {
        const [w, eq] = await Promise.all([
          get(`/v1/warranties?serial=${encodeURIComponent(serial)}`).then(items),
          get(`/v1/service/equipment?serial=${encodeURIComponent(serial)}`).then(items).catch(() => []),
        ]);
        if (!w.length && !eq.length) return result.replaceChildren(el("p", "empty", `No warranty or equipment found for "${serial}".`));
        result.replaceChildren();
        const today = todayIST();
        for (const x of w) {
          const active = x.state ? x.state === "active" : x.expires_on > today;
          const card = el("article", `cx-warranty ${active ? "" : "is-expired"}`);
          const top = el("div", "cx-warranty-top");
          top.append(el("strong", "", x.serial), BW.ui.statusPill(active ? "Active" : "Expired"));
          card.append(top, dl([
            ["Item", x.item_id],
            ["Order", x.order_reference],
            ["Term", x.term_months ? `${x.term_months} months` : null],
            ["Coverage", `${BW.utils.formatDate(x.starts_on)} → ${BW.utils.formatDate(x.expires_on)} (first day out of cover)`],
          ]));
          result.append(card);
        }
        const e0 = eq[0];
        if (e0?.replacement_serial || e0?.predecessor_serial) result.append(el("p", "cx-fine", `Replacement history: ${e0.predecessor_serial ? "replaces " + e0.predecessor_serial : ""}${e0.replacement_serial ? " replaced by " + e0.replacement_serial : ""}`));
      } catch (err) {
        result.replaceChildren(el("p", "form-error", errorText(err)));
      }
    };

    if (role === "inventory") return; // inventory: lookup only
    const body = panel(host, role === "tech" ? "My service tickets" : "Service tickets");
    body.append(el("p", "muted", "Loading…"));
    let tickets;
    try {
      tickets = items(await get("/v1/service-tickets"));
    } catch (err) {
      body.replaceChildren(el("p", "form-error", errorText(err)));
      return;
    }
    body.replaceChildren();
    if (!tickets.length) return body.append(el("p", "empty", "No service tickets."));
    const list = el("div", "live-list");
    for (const t of tickets) {
      const card = el("article", "cx-survey live-card");
      const top = el("div", "cx-survey-top");
      top.append(el("strong", "", t.reference || short(t.id)), BW.ui.statusPill(human(t.state)));
      const out = el("div");
      card.append(top, dl([["Serial", t.serial], ["Opened", t.opened_at || t.created_at ? BW.utils.formatDate(t.opened_at || t.created_at) : null]]), out);
      card.append(BW.ui.button("Open", async () => {
        out.replaceChildren(el("p", "muted", "Loading…"));
        try {
          const d = await get(`/v1/service-tickets/${encodeURIComponent(t.id)}`);
          const inv = d.invoice;
          out.replaceChildren(dl([
            ["Fault", d.fault],
            ["Coverage", d.coverage ? `${human(d.coverage)}${d.warranty_expires_on ? " · cover ends " + BW.utils.formatDate(d.warranty_expires_on) : ""}` : null],
            ["Technician", d.technician_id ? short(d.technician_id) : "Unassigned"],
            ["Diagnosis", d.resolution?.diagnosis],
            ["Customer charge", d.resolution ? paise(d.customer_charge_paise ?? 0) : null],
            ["Invoice", inv ? `${inv.reference || ""} ${paise(inv.total_paise)} · paid ${paise(inv.collected_paise ?? 0)} · due ${paise(inv.remaining_paise)}` : d.resolution ? "None (covered)" : null],
          ]));
          const actions = el("div", "cx-quote-actions");
          if (role === "admin" && ["open", "assigned"].includes(d.state)) actions.append(BW.ui.button(d.state === "assigned" ? "Reassign" : "Assign technician", () => ticketAssignModal(d, refresh), "primary-btn", "users"));
          if (role === "tech" && d.state === "assigned") actions.append(BW.ui.button("Finalise repair", () => resolutionModal(d, refresh), "primary-btn", "wrench"));
          if (role === "admin" && inv && Number(inv.remaining_paise) > 0) actions.append(BW.ui.button("Record payment", () => paymentModal(d, refresh), "secondary-btn", "check"));
          if (d.state === "awaiting_confirmation") actions.append(el("span", "muted", "Waiting for the customer to confirm the repair."));
          out.append(actions);
        } catch (err) {
          out.replaceChildren(el("p", "form-error", errorText(err)));
        }
      }, "secondary-btn", "chevron-right"));
      list.append(card);
    }
    body.append(list);
  }

  /* =================== Dashboard · reporting & reconciliation =================== */
  const METRICS = [
    ["jobs_confirmed", "Jobs confirmed", "count"],
    ["contract_value_paise", "Contract value", "paise"],
    ["jobs_completed", "Jobs completed", "count"],
    ["jobs_unfinished", "Unfinished jobs", "count"],
    ["collected_paise", "Collected", "paise"],
    ["outstanding_paise", "Outstanding", "paise"],
    ["billed_service_paise", "Service billed", "paise"],
    ["open_service_tickets", "Open service tickets", "count"],
    ["material_cost_paise", "Material cost", "paise"],
    ["labour_cost_paise", "Labour cost", "paise"],
    ["technician_minutes", "Technician minutes", "count"],
    ["margin_paise", "Operating margin", "paise"],
  ];

  async function renderReporting(host) {
    host.replaceChildren();
    const body = panel(host, "Management report");
    const row = el("form", "filters");
    row.noValidate = true;
    const monthStart = todayIST().slice(0, 8) + "01";
    const from = el("input");
    from.type = "date";
    from.value = monthStart;
    from.setAttribute("aria-label", "From");
    const to = el("input");
    to.type = "date";
    to.value = todayIST();
    to.setAttribute("aria-label", "To");
    const go = BW.ui.button("Run report", null, "primary-btn", "activity");
    go.type = "submit";
    const csv = BW.ui.button("Download CSV", null, "secondary-btn", "file-text");
    const msg = el("p", "form-error");
    msg.setAttribute("role", "alert");
    msg.hidden = true;
    row.append(el("span", "muted", "From"), from, el("span", "muted", "To"), to, go, csv);
    const out = el("div");
    body.append(row, msg, out);
    const valid = () => {
      msg.hidden = true;
      if (!from.value || !to.value || from.value > to.value) {
        msg.textContent = "Choose a valid date range (From on or before To).";
        msg.hidden = false;
        return false;
      }
      return true;
    };
    const qs = () => `from=${from.value}&to=${to.value}`;
    const run = async () => {
      if (!valid()) return;
      out.replaceChildren(el("p", "muted", "Loading…"));
      try {
        const r = await get(`/v1/management/report?${qs()}`);
        const m = r.metrics || {};
        const cards = BW.ui.kpis(METRICS.filter(([k]) => k in m).map(([k, label, kind], i) => ({
          label: kind === "paise" ? `${label} (₹)` : label,
          value: kind === "paise" ? Math.round(Number(m[k]) / 100) : Number(m[k]),
          unit: "",
          detail: kind === "paise" ? paise(m[k]) : `${r.period?.from || from.value} → ${r.period?.to || to.value}`,
          icon: ["folder-kanban", "file-text", "circle-check", "activity", "zap", "layers", "wrench", "alert-triangle", "boxes", "hard-hat", "calendar-days", "shield-check"][i % 12],
          color: ["blue", "teal", "green", "amber", "purple"][i % 5],
        })));
        const extra = Object.entries(m).filter(([k]) => !METRICS.some(([mk]) => mk === k));
        out.replaceChildren(cards);
        if (extra.length) out.append(dl(extra.map(([k, v]) => [human(k), /_paise$/.test(k) ? paise(v) : String(v)])));
      } catch (err) {
        out.replaceChildren(el("p", "form-error", errorText(err)));
      }
    };
    row.onsubmit = (e) => {
      e.preventDefault();
      run();
    };
    csv.onclick = async () => {
      if (!valid()) return;
      try {
        const res = await BW.auth.fetchRaw(`/v1/management/report.csv?${qs()}`);
        const blob = await res.blob();
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `bijli-wala-report-${from.value}-to-${to.value}.csv` });
        document.body.append(a);
        a.click();
        a.remove();
      } catch (err) {
        msg.textContent = errorText(err);
        msg.hidden = false;
      }
    };
    run();

    // Payment reconciliation
    const rec = panel(host, "Payment reconciliation");
    rec.append(el("p", "muted", "Loading…"));
    try {
      const attempts = items(await get("/v1/payments/reconciliation"));
      rec.replaceChildren();
      if (!attempts.length) rec.append(el("p", "empty", "No outstanding payment attempts."));
      const list = el("div", "live-list");
      for (const a of attempts) {
        const card = el("article", "cx-survey live-card");
        const top = el("div", "cx-survey-top");
        top.append(el("strong", "", `Attempt ${short(a.id || a.attempt_id)}`), BW.ui.statusPill(human(a.state || "")));
        card.append(top, dl([
          ["Quote", short(a.quote_id)],
          ["Amount", paise(a.amount_paise)],
          ["Provider order", a.provider_order_id || a.order_id],
          ["Provider events", (a.observations || []).map((o) => `${o.status} ${o.payment_id}`).join(", ") || "None"],
          ["Created", a.created_at ? when(a.created_at) : null],
        ]));
        card.append(BW.ui.button("Reconcile with payment ID", async () => {
          formModal("Reconcile payment", "Fetch provider facts again for a known Razorpay payment ID.", (grid) => ({
            pid: BW.ui.field(grid, { name: "pid", label: "Razorpay payment ID", required: true, placeholder: "pay_…" }),
          }), "Reconcile", async ({ pid, dialog, fail }) => {
            if (!/^pay_[A-Za-z0-9]+$/.test(pid.value.trim())) fail("Enter a Razorpay payment ID (pay_…).", pid);
            const res = await post(`reconcile:${a.id || a.attempt_id}:${pid.value.trim()}`, `/v1/checkouts/${encodeURIComponent(a.id || a.attempt_id)}/reconcile`, { payment_id: pid.value.trim() });
            BW.ui.toast(`Reconciled · ${human(res.state || "updated")}`);
            dialog.close();
            renderReporting(host);
          });
        }, "secondary-btn", "check"));
        list.append(card);
      }
      rec.append(list);
    } catch (err) {
      rec.replaceChildren(el("p", "form-error", errorText(err)));
    }
  }

  /* =================== Users · staff =================== */
  async function renderStaff(host) {
    host.replaceChildren();
    const body = panel(host, "Hosted staff accounts");
    body.append(el("p", "cx-fine", "Active technicians and salespeople from the hosted API. Disabling revokes their sessions and blocks password sign-in."));
    try {
      const people = items(await get("/v1/staff/assignees"));
      const list = el("div", "live-list");
      for (const p of people) {
        const card = el("article", "cx-survey live-card");
        const top = el("div", "cx-survey-top");
        top.append(el("strong", "", p.display_name || p.id), BW.ui.roleBadge(BW.auth.toUiRole(p.role)));
        const out = el("div");
        const b = BW.ui.button("Disable account", async () => {
          const reason = await BW.ui.reasonModal({
            title: `Disable ${p.display_name || "staff member"}?`,
            message: "Their existing sessions lose access immediately and password sign-in is blocked. Type DISABLE to confirm.",
            label: "Confirmation",
            confirmLabel: "Disable account",
            danger: true,
          });
          if (reason === null) return;
          if (reason.trim().toUpperCase() !== "DISABLE") return BW.ui.toast("Not disabled: type DISABLE to confirm.", "error");
          b.disabled = true;
          try {
            const r = await post(`disable:${p.id}`, `/v1/staff/${encodeURIComponent(p.id)}/disable`, {});
            out.replaceChildren(el("p", "cx-fine", `Disabled ${when(r.disabled_at)}`));
          } catch (err) {
            b.disabled = false;
            out.replaceChildren(el("p", "form-error", errorText(err)));
          }
        }, "secondary-btn danger-btn", "x");
        card.append(top, dl([["ID", short(p.id)]]), b, out);
        list.append(card);
      }
      body.append(list);
    } catch (err) {
      body.append(el("p", "form-error", errorText(err)));
    }
  }

  /* =================== mount =================== */
  const ROUTES = {
    Inventory: { roles: ["inventory", "admin"], render: renderFulfilment },
    Projects: { roles: ["admin", "tech", "inventory", "sales"], render: renderInstallations },
    Warranty: { roles: ["admin", "tech", "inventory"], render: renderService },
    Dashboard: { roles: ["admin"], render: renderReporting },
    Users: { roles: ["admin"], render: renderStaff },
  };

  function mount() {
    const user = BW.auth?.current();
    const route = ROUTES[BW.page];
    if (!user || !route || !route.roles.includes(user.role)) return;
    const content = document.querySelector("#page-content");
    if (!content || document.querySelector("#live-ops")) return;
    const host = el("div", "content live-content");
    host.id = "live-ops";
    content.before(host);
    route.render(host);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(mount, 0));
})();
