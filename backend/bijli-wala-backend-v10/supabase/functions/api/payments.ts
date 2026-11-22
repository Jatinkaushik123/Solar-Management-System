import { ApiError, input, rawInput, uuid } from "./http.ts";
import type { Gateway, PaymentSnapshot } from "./gateway.ts";

type Params = Record<string, unknown>;
type Dependencies = {
  viewer: (bearer: string) => Promise<{id: string; role: string}>;
  // The only production implementation calls fixed, service-role-only PostgREST functions.
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, args: Params) => Promise<any>;
  gateway: () => Gateway | null;
};

function required(gateway: Gateway | null) {
  if (!gateway) throw new ApiError(503, "checkout_unavailable");
  return gateway;
}

async function provider<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (err) {
    const code = (err as {code?: string})?.code;
    if (code === "invalid_signature") throw new ApiError(401, "invalid_signature");
    if (code === "invalid_payload" || code === "invalid_input") throw new ApiError(400, "invalid_provider_payload");
    throw new ApiError(503, "gateway_unavailable");
  }
}
function validSnapshot(s: PaymentSnapshot, expectedId?: string) {
  if (!s || !/^pay_[A-Za-z0-9]{1,100}$/.test(s.paymentId) || (expectedId && s.paymentId !== expectedId)
      || !Number.isSafeInteger(s.amountPaise) || s.amountPaise < 0 || typeof s.currency !== "string" || !s.status) {
    throw new ApiError(502, "invalid_gateway_snapshot");
  }
}

async function webhook(req: Request, deps: Dependencies) {
  const gateway = required(deps.gateway());
  const signature = req.headers.get("x-razorpay-signature"), eventId = req.headers.get("x-razorpay-event-id");
  if (!signature || !eventId || eventId.length > 200) throw new ApiError(400, "missing_webhook_headers");
  const rawBody = await rawInput(req, 262144);
  const event = await provider(() => gateway.verifyWebhook({ rawBody, signature, eventId }));
  if (event.eventId !== eventId) throw new ApiError(400, "invalid_event_id");
  if (event.kind === "ignored") await deps.rpc("solar_ignored_event", { event_id: eventId, event_type: event.eventType });
  else {
    validSnapshot(event.payment);
    if (event.eventType !== "payment." + event.payment.status) throw new ApiError(400, "invalid_event_status");
    await deps.rpc("solar_payment_observe", { target: null, event_id: eventId, snapshot: event.payment });
  }
  return { received: true };
}

async function checkout(req: Request, deps: Dependencies, actor: string, target: string, k: string) {
  const { choice } = await input(req, ["choice"]);
  if (choice !== "advance" && choice !== "full") throw new ApiError(400, "invalid_checkout");
  await deps.rpc("solar_payment_read", { actor, target }); // Check ownership even when the gateway is unavailable.
  const gateway = required(deps.gateway());
  let attempt = await deps.rpc("solar_checkout_begin", { actor, target, choice, k });
  if (attempt.create_order) {
    try {
      const order = await gateway.createOrder({ checkoutRef: attempt.id, amountPaise: attempt.amount_paise });
      if (!/^order_[A-Za-z0-9]{1,100}$/.test(order.orderId) || !/^rzp_test_[A-Za-z0-9]+$/.test(order.keyId) ||
          order.amountPaise !== attempt.amount_paise || order.currency !== "INR") throw new Error("invalid order");
      const binding = { target: attempt.id, provider_order: order.orderId, public_key: order.keyId };
      try {
        attempt = await deps.rpc("solar_checkout_bind", binding);
      } catch (err) {
        if (err instanceof ApiError && err.status < 500) throw err;
        // The write may have committed before the response was lost. Binding
        // the same reference is idempotent, including on the next connection.
        attempt = await deps.rpc("solar_checkout_bind", binding);
      }
    } catch {
      // A timeout may follow a successful create. Keep its receipt reference for reconciliation.
      await deps.rpc("solar_checkout_uncertain", { target: attempt.id });
      throw new ApiError(503, "checkout_creation_uncertain");
    }
  }
  const summary = await deps.rpc("solar_payment_read", { actor, target });
  const { create_order: _internal, ...visible } = attempt;
  const ready = summary.state === "payment_pending" && visible.state === "ready" &&
    summary.attempt?.id === visible.id && summary.attempt?.state === "ready";
  return { ...summary, attempt: visible, checkout: ready ? { keyId: visible.key_id, orderId: visible.provider_order_id,
    amountPaise: visible.amount_paise, currency: visible.currency } : null };
}

export async function handlePayment(req: Request, path: string, deps: Dependencies) {
  if (path === "/v1/jobs/payment-reconciliation") {
    if (req.method !== "POST") throw new ApiError(405, "method_not_allowed");
    const ticket = /^Bearer ([0-9a-f]{64})$/i.exec(req.headers.get("Authorization") || "")?.[1];
    if (!ticket) throw new ApiError(403, "forbidden");
    const gateway = required(deps.gateway());
    const jobs: {attempt_id: string; payment_id: string}[] = await deps.rpc("solar_claim_lookups", { ticket });
    const results = await Promise.allSettled(jobs.map(async job => {
      const snapshot = await provider(() => gateway.fetchPayment(job.payment_id));
      validSnapshot(snapshot, job.payment_id);
      await deps.rpc("solar_payment_observe", { target: job.attempt_id, event_id: null, snapshot });
    }));
    return { claimed: jobs.length, completed: results.filter(r => r.status === "fulfilled").length };
  }
  const hook = path === "/v1/webhooks/razorpay", queue = path === "/v1/payments/reconciliation";
  const quote = /^\/v1\/quotes\/([^/]+)\/(checkout|payment)$/.exec(path);
  const attempt = /^\/v1\/checkouts\/([^/]+)\/(verify|reconcile)$/.exec(path);
  if (!hook && !queue && !quote && !attempt) return undefined;
  const method = queue || quote?.[2] === "payment" ? "GET" : "POST";
  if (req.method !== method) throw new ApiError(405, "method_not_allowed");
  if (hook) return webhook(req, deps);
  const bearer = req.headers.get("Authorization");
  if (!bearer || !/^Bearer [^\s]+$/i.test(bearer)) throw new ApiError(401, "unauthenticated");
  const actor = await deps.viewer(bearer);
  const admin = queue || attempt?.[2] === "reconcile";
  if (actor.role !== (admin ? "admin" : "customer")) throw new ApiError(403, "forbidden");
  if (queue) {
    const after = new URL(req.url).searchParams.get("after");
    if (after && !uuid.test(after)) throw new ApiError(400, "invalid_cursor");
    return { items: await deps.rpc("solar_reconciliation_queue", { actor: actor.id, after_id: after }) };
  }
  const target = (quote || attempt)![1];
  if (!uuid.test(target)) throw new ApiError(400, "invalid_id");
  if (method === "GET") {
    const status = await deps.rpc("solar_payment_read", { actor: actor.id, target });
    const configured = !!deps.gateway();
    return { ...status, gateway_available: configured,
      state: !configured && status.state === "checkout_available" ? "checkout_unavailable" : status.state };
  }
  const k = req.headers.get("Idempotency-Key");
  if (!k || !uuid.test(k)) throw new ApiError(400, "idempotency_key_required");
  if (quote) return checkout(req, deps, actor.id, target, k);
  const saved = await deps.rpc("solar_checkout_access", { actor: actor.id, target });
  const gateway = required(deps.gateway());
  const body = await input(req, admin ? ["payment_id"] : ["payment_id", "signature"]);
  if (!/^pay_[A-Za-z0-9]{1,100}$/.test(body.payment_id)) throw new ApiError(400, "invalid_payment_id");
  if (!saved.provider_order_id) throw new ApiError(409, "gateway_order_not_linked");
  if (!admin) {
    const valid = await provider(() => gateway.verifyCheckout({ storedOrderId: saved.provider_order_id,
      paymentId: body.payment_id, signature: body.signature }));
    if (!valid) throw new ApiError(401, "invalid_signature");
  }
  await deps.rpc("solar_payment_command_key", { actor: actor.id, target, operation: admin ? "reconcile" : "verify", k, fingerprint: body.payment_id });
  if (!admin) await deps.rpc("solar_expect_payment", { target, payment_id: body.payment_id });
  const snapshot = await provider(() => gateway.fetchPayment(body.payment_id));
  validSnapshot(snapshot, body.payment_id);
  return await deps.rpc("solar_payment_observe", { target, event_id: null, snapshot });
}
