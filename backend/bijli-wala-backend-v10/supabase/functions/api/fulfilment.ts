import { ApiError, objectInput, uuid } from "./http.ts";

const reads: Record<string, string> = {
  "/v1/projects": "projects",
  "/v1/warranties": "warranties",
  "/v1/inventory/serials": "serials",
};
const details: Record<string, string> = {
  projects: "project",
  installations: "installation",
  warranties: "warranty",
};
const commands: Record<string, string> = {
  "pick-lists/dispatch": "dispatch",
  "shipments/delivery": "deliver",
  "installations/schedule": "schedule",
  "installations/reports": "report",
  "installations/signoff": "signoff",
};
const bodyLimits: Record<string, number> = { dispatch: 2_100_000, receive: 110_000 };

export const fulfilmentActions: Record<string, string[]> = {
  customer: ["projects.read_own", "installations.signoff", "warranties.read_own"],
  technician: ["projects.read_assigned", "installations.report", "warranties.read_assigned"],
  inventory: ["projects.read_all", "stock.receive", "serials.read", "shipments.dispatch", "shipments.deliver", "warranties.read_all"],
  admin: ["projects.read_all", "installations.schedule", "serials.read", "warranties.read_all"],
  sales: ["projects.read_assigned"],
};

type Data = (path: string, bearer: string, args: Record<string, unknown>) => Promise<unknown>;

export async function handleFulfilment(req: Request, path: string, data: Data) {
  const targetPath = /^\/v1\/(projects|installations|warranties|pick-lists|shipments)\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  const [, collection, target, action] = targetPath ?? [];
  const resource = reads[path] ?? (!action ? details[collection] : undefined);
  const cmd = path === "/v1/inventory/receipts" ? "receive" : commands[collection + "/" + action];
  if (!resource && !cmd) return undefined;
  if (req.method !== (cmd ? "POST" : "GET")) throw new ApiError(405, "method_not_allowed");
  const bearer = req.headers.get("Authorization");
  if (!bearer || !/^Bearer [^\s]+$/i.test(bearer)) throw new ApiError(401, "unauthenticated");
  if (target && !uuid.test(target)) throw new ApiError(400, "invalid_id");
  if (cmd) {
    const k = req.headers.get("Idempotency-Key");
    if (!k || !uuid.test(k)) throw new ApiError(400, "idempotency_key_required");
    const body = await objectInput(req, bodyLimits[cmd] ?? 49_152);
    return await data("rpc/solar_fulfilment_command", bearer, { cmd, target: target ?? null, k, body });
  }
  const query = new URL(req.url).searchParams;
  const after = query.get("after");
  const paginated = resource === "projects" || resource === "warranties";
  if (paginated && after !== null && !uuid.test(after)) throw new ApiError(400, "invalid_cursor");
  return await data("rpc/solar_fulfilment_read", bearer, { resource, target: target ?? null,
    after_id: paginated ? after : null,
    item: resource === "serials" ? query.get("item_id") : null,
    serial_filter: resource === "warranties" ? query.get("serial") : null,
    after_serial: resource === "serials" ? after : null });
}
