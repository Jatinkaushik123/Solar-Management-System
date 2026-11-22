import { ApiError, objectInput, uuid } from "./http.ts";

const ticketCommands: Record<string, string> = {
  assignment: "assign", resolution: "resolve", confirmation: "confirm", payments: "collect",
};
const managementCommands: Record<string, string> = {
  "/v1/management/material-rates": "material_rate",
  "/v1/management/technician-rates": "technician_rate",
  "/v1/management/material-costs": "material_cost",
  "/v1/management/technician-payments": "technician_pay",
};
const managementReads: Record<string, string> = {
  "/v1/management/cost-rates": "rates",
  "/v1/management/time": "time",
  "/v1/technician/time": "own_time",
};
export const serviceActions: Record<string, string[]> = {
  customer: ["service.equipment.read_own", "service.tickets.open", "service.tickets.confirm_own"],
  technician: ["service.tickets.read_assigned", "service.tickets.resolve_assigned", "installations.time.record_assigned", "technician.time.read_own"],
  inventory: ["service.equipment.read_all"],
  admin: ["service.tickets.read_all", "service.tickets.assign", "service.invoices.record_collection", "management.report",
    "management.costs.record", "management.technician_pay.record", "management.subsidy.update"],
  sales: [],
};

type Data = (path: string, bearer: string, args: Record<string, unknown>) => Promise<unknown>;
type Report = { from: string; to: string; timezone: string; currency: string; metrics: Record<string, number | string> };
type Route = {
  method: "GET" | "POST";
  rpc: "service_read" | "service_command" | "management_read" | "management_command" | "management_report";
  args?: Record<string, unknown>;
};
const businessDate = /^\d{4}-\d{2}-\d{2}$/;

function routeFor(path: string, method: string): Route | undefined {
  if (path === "/v1/management/report" || path === "/v1/management/report.csv") {
    return { method: "GET", rpc: "management_report" };
  }
  if (path === "/v1/service-tickets" && method === "POST") return { method: "POST", rpc: "service_command", args: { cmd: "open" } };
  if (path === "/v1/service-tickets" || path === "/v1/service/equipment") {
    return { method: "GET", rpc: "service_read", args: { resource: path.endsWith("equipment") ? "equipment" : "tickets" } };
  }
  const ticket = /^\/v1\/service-tickets\/([^/]+)(?:\/(assignment|resolution|confirmation|payments))?$/.exec(path);
  if (ticket) {
    const [, target, action] = ticket;
    return action
      ? { method: "POST", rpc: "service_command", args: { cmd: ticketCommands[action], target } }
      : { method: "GET", rpc: "service_read", args: { resource: "ticket", target } };
  }
  const project = /^\/v1\/management\/projects\/([^/]+)(\/subsidy)?$/.exec(path);
  if (project) {
    return project[2]
      ? { method: "POST", rpc: "management_command", args: { cmd: "subsidy", target: project[1] } }
      : { method: "GET", rpc: "management_read", args: { resource: "project", target: project[1] } };
  }
  const work = /^\/v1\/installations\/([^/]+)\/time$/.exec(path);
  if (work) return { method: "POST", rpc: "management_command", args: { cmd: "installation_time", target: work[1] } };
  if (managementCommands[path]) return { method: "POST", rpc: "management_command", args: { cmd: managementCommands[path] } };
  if (managementReads[path]) return { method: "GET", rpc: "management_read", args: { resource: managementReads[path] } };
}

function csv(report: Report) {
  const rows = [["from", "to", "timezone", "currency", "metric", "value"]];
  for (const [metric, value] of Object.entries(report.metrics).sort(([a], [b]) => a.localeCompare(b))) {
    rows.push([report.from, report.to, report.timezone, report.currency, metric, String(value)]);
  }
  // These columns are fixed metric keys, ISO dates, the timezone, currency and numeric values.
  return rows.map(row => row.join(",")).join("\r\n") + "\r\n";
}

export async function handleService(req: Request, path: string, data: Data, cors: Record<string, string>) {
  const route = routeFor(path, req.method);
  if (!route) return undefined;
  if (req.method !== route.method) throw new ApiError(405, "method_not_allowed");
  const bearer = req.headers.get("Authorization");
  if (!bearer || !/^Bearer [^\s]+$/i.test(bearer)) throw new ApiError(401, "unauthenticated");
  const args = { target: null, ...route.args } as Record<string, unknown>;
  if (args.target !== null && !uuid.test(String(args.target))) throw new ApiError(400, "invalid_id");
  const query = new URL(req.url).searchParams;
  const after = query.get("after");
  const from = query.get("from"), to = query.get("to");
  const mandatoryDates = route.rpc === "management_report";
  if ((mandatoryDates && (!from || !to)) ||
      ([from, to].some(value => value !== null && !businessDate.test(value))) || (from && to && from > to)) {
    throw new ApiError(400, "invalid_period");
  }
  const rpc = "rpc/solar_" + route.rpc;
  if (mandatoryDates) {
    const report = await data(rpc, bearer, { from_day: from, to_day: to }) as Report;
    if (!path.endsWith(".csv")) return report;
    return new Response(csv(report), { headers: { ...cors, "Content-Type": "text/csv; charset=utf-8",
      "Access-Control-Expose-Headers": "Content-Disposition",
      "Content-Disposition": `attachment; filename="solar-report-${report.from}-${report.to}.csv"` } });
  }
  if (route.method === "POST") {
    const k = req.headers.get("Idempotency-Key");
    if (!k || !uuid.test(k)) throw new ApiError(400, "idempotency_key_required");
    return await data(rpc, bearer, { ...args, k, body: await objectInput(req, 32768) });
  }
  const afterId = args.resource !== "equipment" ? after : null;
  if (afterId !== null && !uuid.test(afterId)) throw new ApiError(400, "invalid_cursor");
  if (route.rpc === "service_read") return await data(rpc, bearer, { ...args, after_id: afterId,
    serial_filter: query.get("serial"), after_serial: args.resource === "equipment" ? after : null });
  return await data(rpc, bearer, { ...args, after_id: afterId, from_day: from, to_day: to });
}
