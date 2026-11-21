export const modules = [
  "Dashboard",
  "Enquiries",
  "Surveys",
  "Quotations",
  "Projects",
  "Inventory",
  "Installations",
  "Warranty",
];
export const schemas = {
  Enquiries: {
    prefix: "ENQ",
    single: "enquiry",
    fields: ["Customer", "City", "Capacity (kW)", "Phone"],
    statuses: ["New", "Contacted", "Qualified"],
    description:
      "Track new solar enquiries and qualify installation opportunities.",
  },
  Surveys: {
    prefix: "SRV",
    single: "survey",
    fields: ["Customer", "City", "Roof type", "Survey date"],
    statuses: ["Scheduled", "Surveyed", "Approved"],
    description: "Schedule site visits and record rooftop assessments.",
  },
  Quotations: {
    prefix: "QTN",
    single: "quotation",
    fields: ["Customer", "City", "Capacity (kW)", "Amount (₹)"],
    statuses: ["Draft", "Sent", "Accepted"],
    description: "Prepare solar estimates and follow customer approvals.",
  },
  Projects: {
    prefix: "PRJ",
    single: "project",
    fields: ["Project name", "City", "Capacity (kW)", "Lead engineer"],
    statuses: ["In progress", "Completed", "Planning", "On hold"],
    description: "Manage rooftop projects from planning through commissioning.",
  },
  Inventory: {
    prefix: "INV",
    single: "item",
    fields: ["Item name", "Category", "Stock (units)", "Reorder level"],
    statuses: ["In stock", "Low stock", "Out of stock"],
    description:
      "Monitor solar components, available stock and reorder levels.",
  },
  Installations: {
    prefix: "INS",
    single: "installation",
    fields: ["Site name", "City", "Crew lead", "Installation date"],
    statuses: ["Scheduled", "On site", "Commissioned"],
    description:
      "Coordinate field crews, installation dates and commissioning.",
  },
  Warranty: {
    prefix: "WAR",
    single: "warranty",
    fields: ["Customer", "Component", "Serial number", "Expiry date"],
    statuses: ["Active", "Claim open", "Closed"],
    description: "Manage equipment coverage and follow warranty claims.",
  },
};
const sites = [
  "Mehta Residence",
  "Sunrise Textiles",
  "Shah Bungalow",
  "Greenview Apartments",
  "Patel Farmhouse",
  "Aarav Industries",
  "Joshi Residence",
  "Lotus Heights",
  "Orchid School",
  "Desai Villa",
  "Narmada Dairy",
  "Surya Warehouse",
];
const cities = ["Ahmedabad", "Surat", "Vadodara", "Pune", "Rajkot", "Nashik"];
const people = [
  "Arjun Mehta",
  "Priya Shah",
  "Dev Patel",
  "Neha Joshi",
  "Aarav Desai",
  "Isha Kulkarni",
];
export const dateString = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
const today = new Date();
function relativeDate(days) {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  return dateString(d);
}
const initialProjects = [
  "In progress",
  "Completed",
  "Planning",
  "In progress",
  "On hold",
  "Completed",
  "In progress",
  "Planning",
  "Completed",
  "In progress",
  "In progress",
  "Completed",
];
function seed(module, i) {
  const schema = schemas[module],
    city = cities[i % 6],
    person = people[i % 6],
    site = sites[i % 12],
    capacity = [5, 40, 8, 25, 10, 60, 3, 30, 18, 6, 22, 45][i % 12];
  const installationDate =
    i < 4
      ? relativeDate(i + 1)
      : dateString(
          new Date(
            today.getFullYear(),
            today.getMonth() -
              [6, 11, 15, 18, 20, 22].findIndex((limit) => i - 4 < limit),
            Math.max(1, Math.min(today.getDate(), 4 + (i % 4) * 6)),
          ),
        );
  const stock = [84, 16, 5, 260, 0, 42][i % 6];
  const values = {
    Enquiries: [person, city, capacity, "98" + String(12057000 + i)],
    Surveys: [
      person,
      city,
      ["RCC terrace", "Metal sheet", "Tiled roof"][i % 3],
      relativeDate(i - 2),
    ],
    Quotations: [person, city, capacity, capacity * 49000],
    Projects: [site, city, capacity, people[(i + 1) % 6]],
    Inventory: [
      [
        "Waaree 540 Wp panel",
        "Sungrow 5 kW inverter",
        "AC distribution box",
        "DC solar cable (100 m)",
        "Earthing kit",
        "Mounting rail (3 m)",
      ][i % 6],
      ["PV module", "Inverter", "Protection", "Cabling", "Safety", "Structure"][
        i % 6
      ],
      stock,
      10,
    ],
    Installations: [site, city, person, installationDate],
    Warranty: [
      person,
      ["PV module", "String inverter", "Mounting structure"][i % 3],
      "BW-" + (240038 + i),
      dateString(new Date(today.getFullYear() + 2 + (i % 4), 5, i + 1)),
    ],
  }[module];
  let status = schema.statuses[i % 3];
  if (module === "Projects") status = initialProjects[i];
  if (module === "Inventory")
    status =
      stock === 0 ? "Out of stock" : stock <= 10 ? "Low stock" : "In stock";
  if (module === "Installations")
    status = i < 3 ? "Scheduled" : i === 3 ? "On site" : "Commissioned";
  return {
    id: schema.prefix + "-" + (1028 - i),
    status,
    ...Object.fromEntries(schema.fields.map((key, j) => [key, values[j]])),
  };
}
const counts = [10, 7, 8, 12, 6, 26, 8];
export const mockSolarData = Object.fromEntries(
  Object.keys(schemas).map((m, j) => [
    m,
    Array.from({ length: counts[j] }, (_, i) => seed(m, i)),
  ]),
);
const key = "bijli-wala.records.v1";
export const solarApi = {
  list() {
    const raw = localStorage.getItem(key);
    return raw
      ? { ...mockSolarData, ...JSON.parse(raw) }
      : structuredClone(mockSolarData);
  },
  save(module, record) {
    const data = this.list(),
      rows = data[module],
      schema = schemas[module];
    const normalized = { ...record };
    if (module === "Inventory")
      normalized.status =
        +record["Stock (units)"] === 0
          ? "Out of stock"
          : +record["Stock (units)"] <= +record["Reorder level"]
            ? "Low stock"
            : "In stock";
    if (!normalized.id)
      normalized.id =
        schema.prefix +
        "-" +
        (Math.max(1000, ...rows.map((r) => Number(r.id.split("-")[1]))) + 1);
    data[module] = [normalized, ...rows.filter((r) => r.id !== normalized.id)];
    localStorage.setItem(key, JSON.stringify(data));
    return data;
  },
};
export function displayValue(field, value) {
  if (field === "Amount (₹)")
    return "₹" + Number(value).toLocaleString("en-IN");
  if (field.includes("date"))
    return new Date(value + "T12:00:00").toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return value;
}
