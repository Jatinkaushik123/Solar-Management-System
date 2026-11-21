/**
 * Bijli Wala SIMS — Solar Kit & Component Catalog
 * Contains hardware catalogues, pricing standards, master dropdown choices, and subsidy logic.
 */
window.BW = window.BW || {};

(() => {
  "use strict";

  const lists = {
    cities: [
      "Ahmedabad",
      "Surat",
      "Vadodara",
      "Pune",
      "Rajkot",
      "Nashik",
      "Kochi",
      "Mumbai",
    ],
    capacities: [1, 2, 3, 4, 5, 8, 10],
    systemTypes: ["On-Grid", "Off-Grid"],
    subsidySchemes: ["PM Surya Ghar Subsidy", "Commercial / Non-Subsidy"],
    roofTypes: ["RCC terrace", "Metal sheet", "Tiled roof"],
    roofDirections: [
      "South",
      "South-east",
      "South-west",
      "East",
      "West",
      "North",
      "North-east",
      "North-west",
    ],
    gridSuitability: ["Suitable", "Needs Upgrade", "Unsuitable"],
    surveyors: ["Ramesh Patil", "Sneha Rao", "Farhan Qureshi", "Kiran Desai"],
    engineers: [
      "Priya Shah",
      "Dev Patel",
      "Neha Joshi",
      "Aarav Desai",
      "Isha Kulkarni",
      "Arjun Mehta",
    ],
    crewLeads: [
      "Vikram Singh (Crew Alpha)",
      "Manoj Verma (Crew Beta)",
      "Suresh Nair (Crew Gamma)",
      "Deepak Yadav (Crew Delta)",
    ],
    categories: [
      "Solar Panel",
      "Inverter",
      "Battery",
      "Mounting Structure",
      "BOS & Wiring",
    ],
    brands: [
      "Waaree",
      "Tata Power",
      "Adani",
      "Growatt",
      "Sungrow",
      "Luminous",
      "Exide",
      "Okaya",
      "Polycab",
      "Havells",
      "Bijli Wala Fabrication",
    ],
    units: ["Nos", "Set", "Meters"],
    projectStages: [
      "Planning",
      "Site assessment",
      "Design approval",
      "Procurement",
      "Installation",
      "Commissioning",
    ],
  };

  const catalogue = {
    panels: [
      {
        id: "waaree-540",
        name: "Waaree 540W Mono PERC",
        watt: 540,
        price: 14500,
        warranty: "20-yr panel warranty",
        brand: "Waaree",
      },
      {
        id: "tata-550",
        name: "Tata Power 550W Bifacial",
        watt: 550,
        price: 16200,
        warranty: "20-yr panel warranty",
        brand: "Tata Power",
      },
      {
        id: "adani-535",
        name: "Adani 535W TopCon",
        watt: 535,
        price: 15400,
        warranty: "20-yr panel warranty",
        brand: "Adani",
      },
    ],
    inverters: [
      {
        id: "growatt-3",
        name: "Growatt 3kW On-Grid",
        kw: 3,
        grid: "On-Grid",
        price: 32000,
        warranty: "2-yr warranty",
        brand: "Growatt",
      },
      {
        id: "sungrow-5",
        name: "Sungrow 5kW On-Grid",
        kw: 5,
        grid: "On-Grid",
        price: 48500,
        warranty: "2-yr warranty",
        brand: "Sungrow",
      },
      {
        id: "luminous-3h",
        name: "Luminous 3kW Hybrid/Off-Grid",
        kw: 3,
        grid: "Both",
        price: 38000,
        warranty: "2-yr warranty",
        brand: "Luminous",
      },
      {
        id: "sungrow-10",
        name: "Sungrow 10kW On-Grid",
        kw: 10,
        grid: "On-Grid",
        price: 78000,
        warranty: "2-yr warranty",
        brand: "Sungrow",
      },
    ],
    batteries: [
      {
        id: "luminous-150",
        name: "Luminous 150Ah Tall Tubular",
        price: 14800,
        warranty: "2-yr warranty",
        perKw: 1,
        brand: "Luminous",
      },
      {
        id: "exide-200",
        name: "Exide 200Ah Solar Battery",
        price: 18500,
        warranty: "2-yr warranty",
        perKw: 1,
        brand: "Exide",
      },
      {
        id: "okaya-5kwh",
        name: "Okaya 5kWh Lithium",
        price: 85000,
        warranty: "2-yr warranty",
        perKw: 0.2,
        brand: "Okaya",
      },
    ],
    mounting: [
      {
        id: "gi-std",
        name: "Standard GI Elevated Stand + BOS",
        price: 12000,
        warranty: "10-yr warranty",
        brand: "Bijli Wala Fabrication",
      },
      {
        id: "hdg-heavy",
        name: "Heavy-Duty Hot-Dip Galvanized + Surge Protection",
        price: 18500,
        warranty: "15-yr warranty",
        brand: "Bijli Wala Fabrication",
      },
    ],
    defaultInstallRatePerKw: 4500,
    // 12% composite GST on the full solar system (equipment + installation).
    gst: {
      equipment: 12,
      installation: 12,
    },
  };

  /**
   * PM Surya Ghar central subsidy calculation:
   * ₹30,000/kW for first 2 kW, ₹18,000 for the 3rd kW, capped at ₹78,000.
   * Applicable only for On-Grid residential schemes.
   */
  function subsidyFor(capacity, scheme, systemType) {
    if (scheme !== "PM Surya Ghar Subsidy" || systemType !== "On-Grid") return 0;
    const k = Math.max(0, Number(capacity) || 0);
    return Math.min(
      78000,
      Math.min(k, 2) * 30000 + Math.max(0, Math.min(k, 3) - 2) * 18000,
    );
  }

  function getPanel(id) {
    return catalogue.panels.find((p) => p.id === id) || catalogue.panels[0];
  }

  function getInverter(id) {
    return catalogue.inverters.find((i) => i.id === id) || catalogue.inverters[0];
  }

  function getBattery(id) {
    return catalogue.batteries.find((b) => b.id === id) || catalogue.batteries[0];
  }

  function getMounting(id) {
    return catalogue.mounting.find((m) => m.id === id) || catalogue.mounting[0];
  }

  /**
   * Calculates equipment BOM, labour, taxes, and net cost
   */
  function calculateKit({
    capacityKw = 3,
    systemType = "On-Grid",
    subsidyScheme = "PM Surya Ghar Subsidy",
    panelId = "waaree-540",
    inverterId = "growatt-3",
    batteryId = "luminous-150",
    mountingId = "gi-std",
    panelQtyManual = false,
    panelQty = null,
    batteryQtyManual = false,
    batteryQty = null,
    installRatePerKw = 4500,
  }) {
    const kw = Math.max(1, Number(capacityKw) || 1);
    const panel = getPanel(panelId);
    const inverter = getInverter(inverterId);
    const battery = getBattery(batteryId);
    const mounting = getMounting(mountingId);

    const autoPanels = Math.ceil((kw * 1000) / panel.watt);
    const finalPanelQty = panelQtyManual && Number(panelQty) > 0 ? Number(panelQty) : autoPanels;

    const inverterQty = Math.max(1, Math.ceil(kw / inverter.kw));
    const isOffGrid = systemType === "Off-Grid";

    const autoBatteries = isOffGrid ? Math.max(1, Math.ceil(kw * battery.perKw)) : 0;
    const finalBatteryQty = isOffGrid
      ? batteryQtyManual && Number(batteryQty) > 0
        ? Number(batteryQty)
        : autoBatteries
      : 0;

    const bomLines = [
      {
        slot: "Solar Panel Module",
        id: panel.id,
        name: panel.name,
        brand: panel.brand,
        qty: finalPanelQty,
        unit: "Nos",
        price: panel.price,
        total: finalPanelQty * panel.price,
        warranty: panel.warranty,
      },
      {
        slot: "Inverter",
        id: inverter.id,
        name: inverter.name,
        brand: inverter.brand,
        qty: inverterQty,
        unit: "Nos",
        price: inverter.price,
        total: inverterQty * inverter.price,
        warranty: inverter.warranty,
      },
      ...(isOffGrid
        ? [
            {
              slot: "Battery Bank",
              id: battery.id,
              name: battery.name,
              brand: battery.brand,
              qty: finalBatteryQty,
              unit: "Nos",
              price: battery.price,
              total: finalBatteryQty * battery.price,
              warranty: battery.warranty,
            },
          ]
        : []),
      {
        slot: "Mounting & BOS Kit",
        id: mounting.id,
        name: mounting.name,
        brand: mounting.brand,
        qty: 1,
        unit: "Set",
        price: mounting.price,
        total: mounting.price,
        warranty: mounting.warranty,
      },
    ];

    const equipmentSubtotal = bomLines.reduce((acc, line) => acc + line.total, 0);
    const installationSubtotal = kw * Number(installRatePerKw || 4500);

    const gstEquipment = (equipmentSubtotal * catalogue.gst.equipment) / 100;
    const gstInstallation = (installationSubtotal * catalogue.gst.installation) / 100;
    const totalGst = gstEquipment + gstInstallation;

    const grossTotal = Math.round(equipmentSubtotal + installationSubtotal + totalGst);
    const subsidy = subsidyFor(kw, subsidyScheme, systemType);
    const netCustomerPayable = Math.max(0, grossTotal - subsidy);

    return {
      kw,
      systemType,
      subsidyScheme,
      bomLines,
      finalPanelQty,
      autoPanels,
      inverterQty,
      finalBatteryQty,
      autoBatteries,
      actualArrayKwp: Math.round(((finalPanelQty * panel.watt) / 1000) * 100) / 100,
      equipmentSubtotal,
      installationSubtotal,
      gstEquipment,
      gstInstallation,
      totalGst,
      grossTotal,
      subsidy,
      netCustomerPayable,
    };
  }

  BW.catalog = {
    lists,
    catalogue,
    subsidyFor,
    getPanel,
    getInverter,
    getBattery,
    getMounting,
    calculateKit,
  };
})();
