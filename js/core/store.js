/**
 * Bijli Wala SIMS — Deep-Cloned State Store & LocalStorage Persistence
 * Manages collections, schema validation, immutable transactions, serial dispatching, and demo reset.
 */
window.BW = window.BW || {};

(() => {
  "use strict";

  const STORAGE_KEY = "bijli-wala.sims.v6";

  // Drop data left behind by older storage versions so it never piles up.
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("bijli-wala.") && k !== STORAGE_KEY) {
        localStorage.removeItem(k);
      }
    }
  } catch (e) {
    // Storage unavailable (private mode): nothing to clean.
  }

  const SCHEMAS = {
    Users: {
      prefix: "USR",
      single: "user",
      fields: ["name", "email", "role", "status"],
      description: "Manage staff accounts and permissions.",
    },
    Surveys: {
      prefix: "SRV",
      single: "survey",
      fields: ["Customer", "City", "Roof type", "Survey date"],
      extra: [
        "Surveyor",
        "Roof Direction",
        "Grid suitability",
        "Tilt (0–90°)",
        "Cable Distance (m)",
        "Notes",
      ],
      statuses: ["Scheduled", "Surveyed", "Approved", "Rejected"],
      description: "Schedule rooftop assessments and technical feasibility surveys.",
    },
    Quotations: {
      prefix: "QTN",
      single: "quotation",
      fields: ["Customer", "City", "Capacity (kW)", "Amount (₹)"],
      extra: ["System type", "Subsidy scheme"],
      statuses: ["Draft", "Sent", "Accepted", "Revision Required", "Rejected", "On Hold", "Cancelled"],
      description: "Selective solar kit configurations and customer price proposals.",
    },
    Inventory: {
      prefix: "INV",
      single: "item",
      fields: ["Item name", "Category", "Brand", "Stock (units)", "Reorder level"],
      extra: ["Unit", "Unit price (₹)"],
      statuses: ["In Stock", "Low stock", "Out of stock"],
      description: "Stock tracking, bill-of-materials verification, and serial dispatches.",
    },
    Projects: {
      prefix: "PRJ",
      single: "project",
      fields: ["Project name", "City", "Capacity (kW)", "Lead engineer"],
      extra: ["Crew lead", "System type", "Subsidy scheme"],
      statuses: ["Planning", "In progress", "Completed", "On hold"],
      description: "End-to-end solar installation tracking from procurement to commissioning.",
    },
    Warranty: {
      prefix: "WAR",
      single: "warranty",
      fields: ["Customer", "Component", "Serial number", "Expiry date"],
      statuses: ["Active", "Claim open", "Closed"],
      description: "Equipment warranty ledger, serial lookup, and service ticket billing.",
    },
  };

  function createSeedData() {
    const today = new Date();
    const rel = (d) => BW.utils.relativeDate(d);

    const inventorySeed = [
      {
        id: "INV-1001",
        "Item name": "Waaree 540W Mono PERC panel",
        Category: "Solar Panel",
        Brand: "Waaree",
        "Stock (units)": 142,
        "Reorder level": 20,
        Unit: "Nos",
        "Unit price (₹)": 14500,
        status: "In Stock",
        dispatches: [
          { serial: "WAA-540-8801", project: "PRJ-1001", date: rel(-45) },
          { serial: "WAA-540-8802", project: "PRJ-1001", date: rel(-45) },
        ],
      },
      {
        id: "INV-1002",
        "Item name": "Tata Power 550W Bifacial panel",
        Category: "Solar Panel",
        Brand: "Tata Power",
        "Stock (units)": 88,
        "Reorder level": 25,
        Unit: "Nos",
        "Unit price (₹)": 16200,
        status: "In Stock",
        dispatches: [
          { serial: "TATA-550-9101", project: "PRJ-1002", date: rel(-20) },
        ],
      },
      {
        id: "INV-1003",
        "Item name": "Growatt 3kW On-Grid inverter",
        Category: "Inverter",
        Brand: "Growatt",
        "Stock (units)": 14,
        "Reorder level": 5,
        Unit: "Nos",
        "Unit price (₹)": 32000,
        status: "In Stock",
        dispatches: [
          { serial: "GW-3K-7711", project: "PRJ-1001", date: rel(-45) },
        ],
      },
      {
        id: "INV-1004",
        "Item name": "Sungrow 5kW On-Grid inverter",
        Category: "Inverter",
        Brand: "Sungrow",
        "Stock (units)": 4,
        "Reorder level": 5,
        Unit: "Nos",
        "Unit price (₹)": 48500,
        status: "Low stock",
        dispatches: [
          { serial: "SG-5K-4001", project: "PRJ-1002", date: rel(-20) },
        ],
      },
      {
        id: "INV-1005",
        "Item name": "Exide 200Ah solar battery",
        Category: "Battery",
        Brand: "Exide",
        "Stock (units)": 0,
        "Reorder level": 8,
        Unit: "Nos",
        "Unit price (₹)": 18500,
        status: "Out of stock",
        dispatches: [],
      },
      {
        id: "INV-1006",
        "Item name": "Luminous 150Ah Tall Tubular battery",
        Category: "Battery",
        Brand: "Luminous",
        "Stock (units)": 18,
        "Reorder level": 6,
        Unit: "Nos",
        "Unit price (₹)": 14800,
        status: "In Stock",
        dispatches: [],
      },
      {
        id: "INV-1007",
        "Item name": "Standard GI Elevated Stand + BOS",
        Category: "Mounting Structure",
        Brand: "Bijli Wala Fabrication",
        "Stock (units)": 45,
        "Reorder level": 10,
        Unit: "Set",
        "Unit price (₹)": 12000,
        status: "In Stock",
        dispatches: [],
      },
      {
        id: "INV-1008",
        "Item name": "DC Solar Cable 4 sq mm (Red/Black)",
        Category: "BOS & Wiring",
        Brand: "Polycab",
        "Stock (units)": 450,
        "Reorder level": 100,
        Unit: "Meters",
        "Unit price (₹)": 65,
        status: "In Stock",
        dispatches: [],
      },
    ];

    const surveysSeed = [
      {
        id: "SRV-1001",
        Customer: "Amit Kumar",
        customerEmail: "customer@bijliwala.in",
        City: "Pune",
        "Roof type": "RCC terrace",
        "Survey date": rel(-15),
        Surveyor: "Sneha Rao",
        "Roof Direction": "South",
        "Grid suitability": "Suitable",
        "Tilt (0–90°)": 22,
        "Cable Distance (m)": 14,
        Notes: "Clear southern exposure with minimal shading. Easy stairway access.",
        status: "Approved",
        created: rel(-18),
      },
      {
        id: "SRV-1002",
        Customer: "Sunrise Textiles Ltd",
        City: "Surat",
        "Roof type": "Metal sheet",
        "Survey date": rel(-5),
        Surveyor: "Ramesh Patil",
        "Roof Direction": "South-east",
        "Grid suitability": "Suitable",
        "Tilt (0–90°)": 18,
        "Cable Distance (m)": 28,
        Notes: "Factory roof with sturdy purlins. Heavy machinery harmonics require SPD kit.",
        status: "Approved",
        created: rel(-7),
      },
      {
        id: "SRV-1003",
        Customer: "Shah Bungalow",
        City: "Ahmedabad",
        "Roof type": "Tiled roof",
        "Survey date": rel(2),
        Surveyor: "Farhan Qureshi",
        "Roof Direction": "South-west",
        "Grid suitability": "Needs Upgrade",
        "Tilt (0–90°)": 30,
        "Cable Distance (m)": 20,
        Notes: "Customer requested site visit for 5kW off-grid hybrid system.",
        status: "Scheduled",
        created: rel(-1),
      },
      {
        id: "SRV-1004",
        Customer: "Patel Farmhouse",
        City: "Vadodara",
        "Roof type": "RCC terrace",
        "Survey date": rel(-2),
        Surveyor: "Kiran Desai",
        "Roof Direction": "South",
        "Grid suitability": "Suitable",
        "Tilt (0–90°)": 24,
        "Cable Distance (m)": 12,
        Notes: "Survey completed. Awaiting technical assessment review.",
        status: "Surveyed",
        created: rel(-4),
      },
      {
        id: "SRV-1005",
        Customer: "Greenview Cooperative Society",
        City: "Nashik",
        "Roof type": "RCC terrace",
        "Survey date": rel(-10),
        Surveyor: "Ramesh Patil",
        "Roof Direction": "North",
        "Grid suitability": "Unsuitable",
        "Tilt (0–90°)": 15,
        "Cable Distance (m)": 40,
        Notes: "Roof is shaded by adjacent 14-story residential tower. Poor solar irradiance.",
        rejectionReason: "Heavy permanent shadow from adjacent high-rise; insufficient sun hours for ROI.",
        status: "Rejected",
        created: rel(-12),
      },
    ];

    const quotationsSeed = [
      {
        id: "QTN-1001",
        Customer: "Amit Kumar",
        customerEmail: "customer@bijliwala.in",
        City: "Pune",
        "Capacity (kW)": 3,
        "System type": "On-Grid",
        "Subsidy scheme": "PM Surya Ghar Subsidy",
        "Amount (₹)": 161840,
        status: "Accepted",
        sourceSurveyId: "SRV-1001",
        created: rel(-12),
        kit: {
          panelId: "waaree-540",
          inverterId: "growatt-3",
          mountingId: "gi-std",
          installRatePerKw: 4500,
        },
        totals: {
          // ₹1,31,000 equipment + ₹13,500 installation (3 kW × ₹4,500)
          // = ₹1,44,500 taxable; 12% composite GST = ₹17,340;
          // gross ₹1,61,840 − ₹78,000 PM Surya Ghar subsidy = ₹83,840 net.
          equipmentSubtotal: 131000,
          installationSubtotal: 13500,
          gst: 17340,
          gstRate: 12,
          grossTotal: 161840,
          subsidy: 78000,
          netCustomerPayable: 83840,
        },
      },
      {
        id: "QTN-1002",
        Customer: "Sunrise Textiles Ltd",
        City: "Surat",
        "Capacity (kW)": 5,
        "System type": "On-Grid",
        "Subsidy scheme": "Commercial / Non-Subsidy",
        "Amount (₹)": 285000,
        status: "Sent",
        sourceSurveyId: "SRV-1002",
        created: rel(-3),
        kit: {
          panelId: "tata-550",
          inverterId: "sungrow-5",
          mountingId: "hdg-heavy",
          installRatePerKw: 4500,
        },
        totals: {
          equipmentSubtotal: 228500,
          installationSubtotal: 22500,
          grossTotal: 285000,
          subsidy: 0,
          netCustomerPayable: 285000,
        },
      },
      {
        id: "QTN-1003",
        Customer: "Desai Villa",
        City: "Rajkot",
        "Capacity (kW)": 2,
        "System type": "On-Grid",
        "Subsidy scheme": "PM Surya Ghar Subsidy",
        "Amount (₹)": 115000,
        status: "Draft",
        created: rel(-1),
        kit: {
          panelId: "waaree-540",
          inverterId: "growatt-3",
          mountingId: "gi-std",
          installRatePerKw: 4500,
        },
        totals: {
          equipmentSubtotal: 90000,
          installationSubtotal: 9000,
          grossTotal: 115000,
          subsidy: 60000,
          netCustomerPayable: 55000,
        },
      },
    ];

    const projectsSeed = [
      {
        id: "PRJ-1001",
        "Project name": "Amit Kumar Residence",
        customerEmail: "customer@bijliwala.in",
        City: "Pune",
        "Capacity (kW)": 3,
        "Lead engineer": "Priya Shah",
        "Crew lead": "Vikram Singh (Crew Alpha)",
        "System type": "On-Grid",
        "Subsidy scheme": "PM Surya Ghar Subsidy",
        stage: "Installation",
        status: "In progress",
        materialsCost: 84000,
        labourCost: 12000,
        revenue: 161840,
        sourceQuotationId: "QTN-1001",
        created: rel(-10),
      },
      {
        id: "PRJ-1002",
        "Project name": "Sunrise Textiles Plant",
        City: "Surat",
        "Capacity (kW)": 5,
        "Lead engineer": "Dev Patel",
        "Crew lead": "Manoj Verma (Crew Beta)",
        "System type": "On-Grid",
        "Subsidy scheme": "Commercial / Non-Subsidy",
        stage: "Procurement",
        status: "In progress",
        materialsCost: 140000,
        labourCost: 20000,
        revenue: 285000,
        created: rel(-14),
      },
      {
        id: "PRJ-1003",
        "Project name": "Shah Bungalow Solar System",
        City: "Ahmedabad",
        "Capacity (kW)": 4,
        "Lead engineer": "Neha Joshi",
        "Crew lead": "Suresh Nair (Crew Gamma)",
        "System type": "On-Grid",
        "Subsidy scheme": "PM Surya Ghar Subsidy",
        stage: "Planning",
        status: "Planning",
        materialsCost: null,
        labourCost: null,
        revenue: 196000,
        created: rel(-4),
      },
      {
        id: "PRJ-1004",
        "Project name": "Aarav Industries Rooftop",
        City: "Pune",
        "Capacity (kW)": 10,
        "Lead engineer": "Aarav Desai",
        "Crew lead": "Deepak Yadav (Crew Delta)",
        "System type": "On-Grid",
        "Subsidy scheme": "Commercial / Non-Subsidy",
        stage: "Commissioning",
        status: "Completed",
        materialsCost: 280000,
        labourCost: 40000,
        revenue: 490000,
        created: rel(-60),
        handover: {
          customer: "Aarav Desai (Director)",
          date: rel(-30),
          start: "09:30",
          end: "14:00",
          generationTest: "Pass",
          signature: "Aarav Desai (Verified)",
        },
      },
    ];

    const warrantySeed = [
      {
        id: "WAR-1001",
        Customer: "Amit Kumar Residence",
        customerEmail: "customer@bijliwala.in",
        Component: "Waaree 540W Mono PERC panel",
        "Serial number": "WAA-540-8801",
        coverageStart: rel(-45),
        "Expiry date": BW.utils.relativeDate(365 * 20 - 45),
        coverageYears: 20,
        sourceId: "INV-1001",
        projectId: "PRJ-1001",
        status: "Active",
        history: [
          {
            date: rel(-45),
            title: "Warranty registered",
            detail: "Waaree 540W Mono PERC · 20-year panel warranty",
          },
        ],
        tickets: [],
      },
      {
        id: "WAR-1002",
        Customer: "Amit Kumar Residence",
        customerEmail: "customer@bijliwala.in",
        Component: "Growatt 3kW On-Grid inverter",
        "Serial number": "GW-3K-7711",
        coverageStart: rel(-45),
        "Expiry date": BW.utils.relativeDate(365 * 2 - 45),
        coverageYears: 2,
        sourceId: "INV-1003",
        projectId: "PRJ-1001",
        status: "Active",
        history: [
          {
            date: rel(-45),
            title: "Warranty registered",
            detail: "Growatt 3kW On-Grid inverter · 2-year inverter warranty",
          },
        ],
        tickets: [],
      },
      {
        id: "WAR-1003",
        Customer: "Mehta Residence",
        Component: "Growatt 3kW String Inverter",
        "Serial number": "BW-240038",
        coverageStart: rel(-800),
        "Expiry date": rel(-70), // Expired!
        coverageYears: 2,
        status: "Active",
        history: [
          {
            date: rel(-800),
            title: "Warranty registered",
            detail: "Initial 2-year warranty issued on commissioning",
          },
        ],
        tickets: [
          {
            id: "WAR-1003-T1",
            opened: rel(-20),
            closed: rel(-15),
            parts: 800,
            labour: 350,
            note: "Replaced blown AC surge protector diode. Inverter operational.",
          },
        ],
      },
      {
        id: "WAR-1004",
        Customer: "Aarav Industries",
        Component: "Sungrow 10kW On-Grid inverter",
        "Serial number": "SG-10K-9902",
        coverageStart: rel(-30),
        "Expiry date": BW.utils.relativeDate(365 * 2 - 30),
        coverageYears: 2,
        status: "Claim open",
        history: [
          {
            date: rel(-30),
            title: "Warranty registered",
            detail: "Sungrow 10kW system commissioned",
          },
          {
            date: rel(-2),
            title: "Claim opened",
            detail: "Error code 043: Grid over-voltage disconnect",
          },
        ],
        tickets: [
          {
            id: "WAR-1004-T1",
            opened: rel(-2),
            parts: 0,
            labour: 0,
            note: "Technician dispatched to inspect DISCOM distribution transformer tap setting.",
          },
        ],
      },
    ];

    return {
      Users: BW.auth.defaultUsers,
      Surveys: surveysSeed,
      Quotations: quotationsSeed.map(withCalculatedTotals),
      Inventory: inventorySeed,
      Projects: projectsSeed,
      Warranty: warrantySeed,
    };
  }

  function loadState() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      // LocalStorage unavailable
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.Users && parsed.Surveys) {
          return parsed;
        }
      } catch (err) {
        // Fallback on corrupt JSON
      }
    }
    const seed = createSeedData();
    saveState(seed);
    return seed;
  }

  function saveState(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("LocalStorage quota exceeded or unavailable:", e);
    }
  }

  const listeners = new Set();
  function notify() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
  }

  function getAll() {
    return BW.utils.deepClone(loadState());
  }

  function get(module) {
    const state = loadState();
    return BW.utils.deepClone(state[module] || []);
  }

  function lockedFields(module, record) {
    if (!record || !record.id) return [];
    if (module === "Quotations" && (record.status === "Accepted" || record.prevStatus === "Accepted")) {
      return [
        "Customer",
        "City",
        "Capacity (kW)",
        "Amount (₹)",
        "System type",
        "Subsidy scheme",
        "status",
      ];
    }
    if (module === "Inventory" && record.dispatches && record.dispatches.length > 0) {
      return ["Item name", "Category", "Brand"];
    }
    if (module === "Warranty" && record.sourceId) {
      return ["Serial number", "Component"];
    }
    return [];
  }

  function validate(module, record, previous) {
    const schema = SCHEMAS[module];
    if (!schema) return;

    for (const f of schema.fields) {
      const val = record[f];
      if (val == null || String(val).trim() === "") {
        throw new Error(`${f} is required.`);
      }
      if (/Capacity|Amount|Stock|Reorder|price|Cost/i.test(f)) {
        const n = Number(val);
        if (Number.isNaN(n)) throw new Error(`${f} must be a number.`);
        if (n < 0) throw new Error(`${f} cannot be negative.`);
        if (/Capacity/i.test(f) && n <= 0) {
          throw new Error("Capacity must be greater than 0 kW.");
        }
      }
    }

    // Forward-looking dates must be today or later when newly set or changed.
    const FUTURE_DATES = { Surveys: ["Survey date"] };
    for (const f of FUTURE_DATES[module] || []) {
      if (previous && previous[f] === record[f]) continue;
      const msg = BW.utils.validateFutureOrTodayDate(record[f], f.replace(/^./, (c) => c.toUpperCase()));
      if (msg) throw new Error(msg);
    }

    if (record.Phone && !BW.utils.phoneOk(record.Phone)) {
      throw new Error("Phone must be a valid 10-digit Indian mobile starting with 6–9.");
    }

    if (module === "Warranty") {
      const code = String(record["Serial number"] || "").trim().toUpperCase();
      const allWarranties = get("Warranty");
      if (
        allWarranties.some(
          (w) => w.id !== record.id && String(w["Serial number"]).toUpperCase() === code,
        )
      ) {
        throw new Error(`Serial number ${code} is already registered.`);
      }
    }

    const locked = lockedFields(module, previous);
    const changedLocked = locked.filter(
      (f) => f in record && String(record[f] ?? "") !== String(previous?.[f] ?? ""),
    );
    if (changedLocked.length > 0) {
      throw new Error(`Locked: ${changedLocked.join(", ")} cannot be modified.`);
    }
  }

  function coerce(module, record) {
    const schema = SCHEMAS[module];
    if (!schema) return record;
    for (const f of [...schema.fields, ...(schema.extra || [])]) {
      if (/Capacity|Amount|Stock|Reorder|price|Cost|Tilt|Cable/i.test(f)) {
        if (record[f] !== "" && record[f] != null && !Number.isNaN(Number(record[f]))) {
          record[f] = Number(record[f]);
        }
      }
    }
    return record;
  }

  /* ---------- Quotation stock gate ---------- */
  // A fingerprint of everything Inventory must re-check if it changes.
  function kitKey(q) {
    const k = q.kit || {};
    return JSON.stringify([
      Number(q["Capacity (kW)"]) || 0,
      q["System type"] || "On-Grid",
      k.panelId || "",
      Number(k.panelQty) || 0,
      k.inverterId || "",
      q["System type"] === "Off-Grid" ? k.batteryId || "" : "",
      k.mountingId || "",
    ]);
  }

  // Seed quotations: totals always derived from the kit calculator so the
  // stored amounts match what the builder and customer pages compute.
  function withCalculatedTotals(q) {
    const calc = BW.catalog.calculateKit({
      capacityKw: q["Capacity (kW)"],
      systemType: q["System type"],
      subsidyScheme: q["Subsidy scheme"],
      ...q.kit,
    });
    const confirmed = ["Sent", "Accepted"].includes(q.status);
    return {
      ...q,
      "Amount (₹)": calc.grossTotal,
      kit: { ...q.kit, panelQty: calc.finalPanelQty },
      totals: {
        equipmentSubtotal: calc.equipmentSubtotal,
        installationSubtotal: calc.installationSubtotal,
        gst: Math.round(calc.totalGst),
        gstRate: 12,
        grossTotal: calc.grossTotal,
        subsidy: calc.subsidy,
        netCustomerPayable: calc.netCustomerPayable,
      },
      stockStatus: confirmed ? "Confirmed" : "Pending",
      ...(confirmed ? { stockKitKey: kitKey({ ...q, kit: { ...q.kit, panelQty: calc.finalPanelQty } }), stockConfirmedBy: "Imran Khan" } : {}),
    };
  }

  /** Inventory / Admin confirms warehouse stock for a quotation's exact kit. */
  function confirmStock(quoteId) {
    const role = BW.auth?.current()?.role;
    if (!["inventory", "admin"].includes(role)) throw new Error("Only Inventory or Admin can confirm stock.");
    const q = get("Quotations").find((x) => x.id === quoteId);
    if (!q) throw new Error(`Quotation ${quoteId} not found.`);
    return save("Quotations", {
      ...q,
      stockStatus: "Confirmed",
      stockKitKey: kitKey(q),
      stockConfirmedBy: BW.auth.current().name,
      stockConfirmedOn: BW.utils.getTodayISO(),
    }, { system: true });
  }

  function save(module, record, options = {}) {
    const schema = SCHEMAS[module];
    if (!schema) throw new Error(`Unknown module: ${module}`);

    const state = loadState();
    const rows = state[module] || [];
    const incoming = BW.utils.deepClone(record);
    const hasId = typeof incoming.id === "string" && incoming.id !== "";
    const prev = hasId ? rows.find((r) => r.id === incoming.id) : undefined;

    const finalRecord = { ...BW.utils.deepClone(prev || {}), ...incoming };

    if (module === "Quotations" && !options.system) {
      const key = kitKey(finalRecord);
      if (!prev) finalRecord.stockStatus = "Pending";
      else if (prev.stockStatus === "Confirmed" && prev.stockKitKey !== key) {
        // Equipment changed after Inventory confirmed it: must be re-checked,
        // and an un-accepted quote can no longer be "Sent" on stale stock.
        finalRecord.stockStatus = "Re-verification Required";
        if (finalRecord.status === "Sent") finalRecord.status = "Draft";
      }
      const goingOut = ["Sent", "Accepted"].includes(finalRecord.status) && finalRecord.status !== prev?.status;
      if (goingOut && finalRecord.stockStatus !== "Confirmed") {
        throw new Error(
          finalRecord.stockStatus === "Re-verification Required"
            ? "Equipment changed after stock confirmation. Inventory must re-verify stock before this quotation can be sent."
            : "Inventory has not confirmed stock yet. A quotation can only be sent after stock confirmation.",
        );
      }
    }
    if (!options.system) {
      validate(module, finalRecord, prev);
    }
    coerce(module, finalRecord);

    if (!finalRecord.id) {
      finalRecord.id = BW.utils.generateId(schema.prefix, rows);
    }
    if (!finalRecord.created) {
      finalRecord.created = BW.utils.todayISO();
    }

    if (module === "Inventory") {
      const stock = Number(finalRecord["Stock (units)"] || 0);
      const reorder = Number(finalRecord["Reorder level"] || 0);
      finalRecord.status =
        stock === 0 ? "Out of stock" : stock <= reorder ? "Low stock" : "In Stock";
    }

    if (prev) {
      state[module] = rows.map((r) => (r.id === finalRecord.id ? finalRecord : r));
    } else {
      state[module] = [finalRecord, ...rows];
    }

    saveState(state);
    notify();
    return BW.utils.deepClone(finalRecord);
  }

  function remove(module, id) {
    const state = loadState();
    const rows = state[module] || [];
    state[module] = rows.filter((r) => r.id !== id);
    saveState(state);
    notify();
  }

  function reset() {
    const fresh = createSeedData();
    saveState(fresh);
    notify();
    return BW.utils.deepClone(fresh);
  }

  function dispatchSerial(itemId, serial, projectId) {
    const state = loadState();
    const code = String(serial || "").trim().toUpperCase();
    if (!code) throw new Error("Please enter a valid serial number.");

    const item = state.Inventory.find((i) => i.id === itemId);
    if (!item) throw new Error("Inventory item not found.");
    if (Number(item["Stock (units)"]) < 1) {
      throw new Error("No stock available for dispatch for this item.");
    }

    // Uniqueness checks across all dispatches and warranties
    const alreadyDispatched = state.Inventory.some((inv) =>
      inv.dispatches?.some((d) => String(d.serial).toUpperCase() === code),
    );
    const warrantyExists = state.Warranty.some(
      (w) => String(w["Serial number"]).toUpperCase() === code,
    );

    if (alreadyDispatched || warrantyExists) {
      throw new Error(`Serial number ${code} has already been dispatched or registered.`);
    }

    // Decrement stock
    item["Stock (units)"] = Number(item["Stock (units)"]) - 1;
    const stock = item["Stock (units)"];
    item.status =
      stock === 0 ? "Out of stock" : stock <= Number(item["Reorder level"]) ? "Low stock" : "In Stock";

    item.dispatches = item.dispatches || [];
    item.dispatches.unshift({
      serial: code,
      project: projectId,
      date: BW.utils.todayISO(),
    });

    // Coverage calculation: 20 years for panels, 2 years for inverters/batteries
    const cat = String(item.Category + " " + item["Item name"]).toLowerCase();
    let years = 0;
    if (cat.includes("panel") || cat.includes("module")) years = 20;
    else if (cat.includes("inverter") || cat.includes("batter")) years = 2;

    let warrantyRecord = null;
    if (years > 0) {
      const project = state.Projects.find((p) => p.id === projectId);
      const customerName = project ? project["Project name"] : "Dispatched Installation";
      const customerEmail = project ? project.customerEmail || "" : "";

      warrantyRecord = {
        id: BW.utils.generateId("WAR", state.Warranty),
        Customer: customerName,
        customerEmail,
        Component: item["Item name"],
        "Serial number": code,
        coverageStart: BW.utils.todayISO(),
        // Whole calendar years (365 × n days drifts by a day per leap year).
        "Expiry date": (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() + years);
          return BW.utils.dateString(d);
        })(),
        coverageYears: years,
        sourceId: item.id,
        projectId,
        status: "Active",
        history: [
          {
            date: BW.utils.todayISO(),
            title: "Warranty registered",
            detail: `${item["Item name"]} · Serial: ${code} · Dispatched to ${projectId}`,
          },
        ],
        tickets: [],
      };
      state.Warranty.unshift(warrantyRecord);
    }

    saveState(state);
    notify();
    return {
      inventoryItem: BW.utils.deepClone(item),
      warranty: warrantyRecord ? BW.utils.deepClone(warrantyRecord) : null,
    };
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  BW.schemas = SCHEMAS;
  /**
   * Rejects a survey and puts every not-yet-accepted quotation built from it
   * (and any project created from those quotations) on hold, so no stale
   * "approved" state survives anywhere the customer can see it.
   */
  function rejectSurvey(surveyId, reason) {
    const text = String(reason || "").trim();
    if (!text) throw new Error("A rejection reason is required.");
    const survey = get("Surveys").find((s) => s.id === surveyId);
    if (!survey) throw new Error(`Survey ${surveyId} not found.`);
    const today = BW.utils.getTodayISO();
    const saved = save("Surveys", {
      ...survey,
      status: "Rejected",
      rejectionReason: text,
      rejectedOn: today,
    }, { system: true });

    const held = [];
    for (const q of get("Quotations")) {
      if (q.sourceSurveyId !== surveyId || q.status === "Accepted") continue;
      save("Quotations", { ...q, status: "On Hold", holdReason: `Survey rejected: ${text}` }, { system: true });
      held.push(q.id);
    }
    for (const p of get("Projects")) {
      if (!held.includes(p.sourceQuotationId) || p.status === "Completed") continue;
      save("Projects", { ...p, status: "On hold", holdReason: `Survey ${surveyId} rejected` }, { system: true });
    }
    return { survey: saved, heldQuotations: held };
  }

  /**
   * Admin / Sales: put a quotation On Hold, cancel it, or resume a held one.
   * Status is the only thing that changes; prices stay locked. Linked projects
   * follow: held/cancelled quote -> project "On hold"; resume -> previous status.
   */
  function setQuotationHold(quoteId, action, reason = "") {
    const role = BW.auth?.current()?.role;
    if (!["admin", "sales"].includes(role)) throw new Error("Only Admin or Sales can change a quotation's hold status.");
    const quote = get("Quotations").find((q) => q.id === quoteId);
    if (!quote) throw new Error(`Quotation ${quoteId} not found.`);
    const linked = get("Projects").filter((p) => p.sourceQuotationId === quoteId);

    if (action === "resume") {
      if (quote.status !== "On Hold") throw new Error("Only an On Hold quotation can be resumed.");
      const restored = save("Quotations", {
        ...quote, status: quote.prevStatus || "Sent", holdReason: null, heldBy: null,
      }, { system: true });
      for (const p of linked) {
        if (p.status === "On hold" && p.heldBy === "quotation")
          save("Projects", { ...p, status: p.prevStatus || "Planning", holdReason: null, heldBy: null, prevStatus: null }, { system: true });
      }
      return restored;
    }

    if (!["On Hold", "Cancelled"].includes(action)) throw new Error(`Unknown action ${action}.`);
    if (quote.status === "Cancelled") throw new Error("This quotation is already cancelled.");
    const text = String(reason || "").trim();
    if (!text) throw new Error("A reason is required.");
    const saved = save("Quotations", {
      ...quote,
      status: action,
      // Keep the status it had before the first hold so a resume restores it.
      prevStatus: quote.status === "On Hold" ? quote.prevStatus : quote.status,
      holdReason: text,
      heldBy: "quotation",
    }, { system: true });
    for (const p of linked) {
      if (p.status === "Completed") continue;
      save("Projects", {
        ...p,
        status: "On hold",
        prevStatus: p.status === "On hold" ? p.prevStatus : p.status,
        holdReason: `Quotation ${quoteId} ${action === "Cancelled" ? "cancelled" : "on hold"}: ${text}`,
        heldBy: "quotation",
      }, { system: true });
    }
    return saved;
  }

  /**
   * Called after a project save: a project put On hold puts its accepted
   * quotation On Hold too (customer sees it), and taking the project off hold
   * restores a quotation that was held only because of the project.
   */
  function syncProjectHold(project, previousStatus) {
    if (!project?.sourceQuotationId || previousStatus === project.status) return;
    const quote = get("Quotations").find((q) => q.id === project.sourceQuotationId);
    if (!quote) return;
    if (project.status === "On hold" && quote.status === "Accepted") {
      save("Quotations", {
        ...quote, status: "On Hold", prevStatus: "Accepted",
        holdReason: `Project ${project.id} is on hold`, heldBy: "project",
      }, { system: true });
    } else if (previousStatus === "On hold" && quote.status === "On Hold" && quote.heldBy === "project") {
      save("Quotations", { ...quote, status: quote.prevStatus || "Accepted", holdReason: null, heldBy: null }, { system: true });
    }
  }

  BW.store = {
    schemas: SCHEMAS,
    rejectSurvey,
    confirmStock,
    kitKey,
    setQuotationHold,
    syncProjectHold,
    getAll,
    get,
    save,
    delete: remove,
    reset,
    dispatchSerial,
    lockedFields,
    validate,
    coerce,
    subscribe,
  };
})();
