/**
 * Bijli Wala SIMS — Deep-Cloned State Store & LocalStorage Persistence
 * Manages collections, schema validation, immutable transactions, serial dispatching, and demo reset.
 */
window.BW = window.BW || {};
const BW = window.BW;

(() => {
  "use strict";

  const STORAGE_KEY = "bijli-wala.sims.v3";

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
      statuses: ["Draft", "Sent", "Accepted"],
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
        "Amount (₹)": 165000,
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
          equipmentSubtotal: 131000,
          installationSubtotal: 13500,
          grossTotal: 165000,
          subsidy: 78000,
          netCustomerPayable: 87000,
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
        revenue: 165000,
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
        "Expiry date": BW.utils.relativeDate(365 * 25 - 45),
        coverageYears: 25,
        sourceId: "INV-1001",
        projectId: "PRJ-1001",
        status: "Active",
        history: [
          {
            date: rel(-45),
            title: "Warranty registered",
            detail: "Waaree 540W Mono PERC · 25-yr performance guarantee",
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
        "Expiry date": BW.utils.relativeDate(365 * 5 - 45),
        coverageYears: 5,
        sourceId: "INV-1003",
        projectId: "PRJ-1001",
        status: "Active",
        history: [
          {
            date: rel(-45),
            title: "Warranty registered",
            detail: "Growatt 3kW On-Grid inverter · 5-yr warranty",
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
        "Expiry date": BW.utils.relativeDate(365 * 5 - 30),
        coverageYears: 5,
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
      Quotations: quotationsSeed,
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
    if (module === "Quotations" && record.status === "Accepted") {
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

  function save(module, record, options = {}) {
    const schema = SCHEMAS[module];
    if (!schema) throw new Error(`Unknown module: ${module}`);

    const state = loadState();
    const rows = state[module] || [];
    const incoming = BW.utils.deepClone(record);
    const hasId = typeof incoming.id === "string" && incoming.id !== "";
    const prev = hasId ? rows.find((r) => r.id === incoming.id) : undefined;

    const finalRecord = { ...BW.utils.deepClone(prev || {}), ...incoming };

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
        "Expiry date": BW.utils.relativeDate(365 * years),
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
  BW.store = {
    schemas: SCHEMAS,
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
