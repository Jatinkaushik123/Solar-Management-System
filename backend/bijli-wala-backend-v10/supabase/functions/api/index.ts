import { workflowActions, workflowRoute } from "./workflow.ts";
import { ApiError, uuid, input, objectInput } from "./http.ts";
import { handlePayment } from "./payments.ts";
import { configuredGateway } from "./gateway.ts";
import { fulfilmentActions, handleFulfilment } from "./fulfilment.ts";
import { handleService, serviceActions } from "./service.ts";
import { configuredQuoteEmail, handleQuoteEmail } from "./quote-email.ts";

type Role = "customer" | "technician" | "inventory" | "sales" | "admin";
type Actor = { id: string; email: string; display_name: string; role: Role };

const projectUrl = Deno.env.get("SUPABASE_URL")!;
const publicKey = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default
  || Deno.env.get("SUPABASE_ANON_KEY");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, idempotency-key",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { ...cors, ...extra } });
}

async function data(path: string, bearer: string | null, payload?: Record<string, unknown>, apiKey = publicKey) {
  const resp = await fetch(projectUrl + "/rest/v1/" + path, {
    method: payload ? "POST" : "GET",
    headers: { apikey: apiKey, ...(bearer ? { Authorization: bearer } : {}), "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (resp.ok) return await resp.json();
  const failure = await resp.json().catch(() => ({}));
  if (/^PT(400|401|403|404|409|503)$/.test(failure.code) && /^[a-z_]{1,64}$/.test(failure.message)) {
    throw new ApiError(resp.status, failure.message);
  }
  if (failure.code === "22P02" || failure.code === "22007" || failure.code === "22008") throw new ApiError(400, "invalid_value");
  if (resp.status === 401) throw new ApiError(401, "unauthenticated");
  if (resp.status === 403) throw new ApiError(403,
    failure.message === "invitation_unavailable" ? "invitation_unavailable" : "forbidden");
  if (resp.status === 409) throw new ApiError(409,
    failure.message === "already_staff" ? "already_staff" : "invitation_conflict");
  if (failure.code === "22023") throw new ApiError(400, "invalid_invitation");
  throw new ApiError(503, "identity_service_unavailable");
}

const payments = {
  async viewer(bearer: string): Promise<Actor> {
    const [actor] = await data("rpc/solar_me", bearer, {});
    if (!actor) throw new ApiError(401, "unauthenticated");
    return actor;
  },
  rpc(name: string, payload: Record<string, unknown>) {
    const key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!key) throw new ApiError(503, "payment_service_unavailable");
    return data("rpc/" + name, key.startsWith("sb_secret_") ? null : "Bearer " + key, payload, key);
  },
  gateway: () => configuredGateway(name => Deno.env.get(name)),
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/(?:functions\/v1\/)?api(?=\/)/, "");
    if (path === "/v1/jobs/quote-email") {
      return json(await handleQuoteEmail(req, payments.rpc, configuredQuoteEmail(key => Deno.env.get(key))));
    }
    const payment = await handlePayment(req, path, payments);
    if (payment !== undefined) return json(payment);
    const fulfilment = await handleFulfilment(req, path, data);
    if (fulfilment !== undefined) return json(fulfilment);
    const service = await handleService(req, path, data, cors);
    if (service instanceof Response) return service;
    if (service !== undefined) return json(service);
    const profile = path.match(/^\/v1\/profiles\/([^/]+)$/);
    const invite = path === "/v1/staff/invitations";
    const accept = path === "/v1/staff/invitations/accept";
    const route = workflowRoute(path, req.method);
    if (!route && path !== "/v1/me" && !profile && !invite && !accept) throw new ApiError(404, "not_found");
    const method = route?.method ?? (invite || accept ? "POST" : "GET");
    if (req.method !== method) return json({ error: { code: "method_not_allowed" } }, 405, { Allow: method + ", OPTIONS" });
    const bearer = req.headers.get("Authorization");
    if (!bearer || !/^Bearer [^\s]+$/i.test(bearer)) throw new ApiError(401, "unauthenticated");
    if (route) {
      const args: Record<string, unknown> = {};
      if (route.target) {
        if (!uuid.test(route.target)) throw new ApiError(400, "invalid_id");
        args.target = route.target;
      }
      if (route.action) args.action = route.action;
      if (route.list) {
        args.after_serial = url.searchParams.get("after") ?? "0";
        args.page_size = url.searchParams.get("limit") ?? "50";
        if (!/^\d{1,16}$/.test(String(args.after_serial)) || !/^(?:[1-9]\d?|100)$/.test(String(args.page_size))) throw new ApiError(400, "invalid_page");
      }
      if (method === "POST") {
        const key = req.headers.get("Idempotency-Key");
        if (!key || !uuid.test(key)) throw new ApiError(400, "idempotency_key_required");
        args.k = key;
        args.body = await objectInput(req, 32768);
      }
      return json(await data("rpc/" + route.rpc, bearer, args));
    }
    const [actor]: Actor[] = await data("rpc/solar_me", bearer, {});
    if (!actor) throw new ApiError(401, "unauthenticated");

    if (path === "/v1/me") {
      const portal = url.searchParams.get("portal");
      if (portal !== null && portal !== "customer" && portal !== "staff") throw new ApiError(400, "invalid_portal");
      const assignedPortal = actor.role === "customer" ? "customer" : "staff";
      if (portal && assignedPortal !== portal) throw new ApiError(403, "wrong_portal");
      const actions = ["profiles.read_self"];
      if (actor.role === "admin") actions.push("profiles.read_all", "staff.invite");
      if (actor.role === "customer") actions.push("staff.accept_invitation");
      actions.push(...workflowActions[actor.role], ...fulfilmentActions[actor.role], ...serviceActions[actor.role]);
      return json({ ...actor, portal: assignedPortal, actions });
    }
    if (profile) {
      if (!uuid.test(profile[1])) throw new ApiError(400, "invalid_profile_id");
      const [row] = await data("solar_profiles?select=id,display_name,created_at&id=eq." + profile[1], bearer);
      if (!row) throw new ApiError(404, "profile_not_found");
      return json(row);
    }
    if (invite) {
      if (actor.role !== "admin") throw new ApiError(403, "forbidden");
      const body = await input(req, ["email", "role", "token_hash"]);
      const expires_at = await data("rpc/solar_invite_staff", bearer, {
        target_email: body.email, staff_role: body.role, digest_hex: body.token_hash,
      });
      return json({ email: body.email.trim().toLowerCase(), role: body.role, expires_at }, 200);
    }
    const { token } = await input(req, ["token"]);
    const role = await data("rpc/solar_accept_invitation", bearer, { invite_token: token });
    return json({ role });
  } catch (err) {
    const failure = err instanceof ApiError ? err : new ApiError(503, "identity_service_unavailable");
    return json({ error: { code: failure.message } }, failure.status);
  }
});
