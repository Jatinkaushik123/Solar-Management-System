# Checkout, payment status and confirmed orders

Use the signed-in customer's session and the application API base `https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api`. The quote ID comes from the accepted revision. Fetch payment status when opening the page, returning from Checkout, or resuming a pending payment. [Login and request helper](./identity-client.mjs) · [Quote acceptance](./quote-workflow.md)

After confirmation, open the order with the project ID in `order.id`. [Warehouse, installation and warranty handoff](./fulfilment-workflow.md)

## Hosted routes

| Method and path under the API base | Caller and contract |
| --- | --- |
| `GET /v1/quotes/{quote_id}/payment` | The owner reads the accepted quote's choices, totals, latest attempt, receipts, order and both task IDs. A different customer or an unpublished quote ID receives 404. |
| `POST /v1/quotes/{quote_id}/checkout` | The owner sends exactly `{"choice":"advance"}` or `{"choice":"full"}`. A ready response contains the attempt and `checkout` object. While creation is in progress, `checkout` can be null. |
| `POST /v1/checkouts/{attempt_id}/verify` | The owner sends `{"payment_id":"<razorpay_payment_id>","signature":"<razorpay_signature>"}` from Checkout. The server uses its stored order ID to check the signature and fetches the payment from Razorpay. Returns updated payment status. |
| `POST /v1/webhooks/razorpay` | Razorpay posts the original signed bytes with `X-Razorpay-Signature` and `x-razorpay-event-id`. Accepted and duplicate events receive `{"received":true}`. |
| `GET /v1/payments/reconciliation` | Admin reads up to 100 outstanding attempts and the observed provider facts. Pass `?after=<last attempt UUID>` for another page. |
| `POST /v1/checkouts/{attempt_id}/reconcile` | Admin sends `{"payment_id":"<provider payment ID>"}` to fetch provider facts again against the stored order. A previously credited late payment can create its order once stock becomes available. |
| `POST /v1/jobs/payment-reconciliation` | Internal scheduled worker. Claims due payment lookups using a dedicated Vault-backed credential. |

For customer and admin calls send `apikey` and `Authorization: Bearer <session access token>`. POST JSON commands also need `Content-Type: application/json` and a UUID `Idempotency-Key`. Use one key per action. Preserve that key for network retries, including a callback retry. Use a fresh key when deliberately starting another checkout after expiry. Changed input with a previously used key returns 409.

Successful requests return HTTP 200. The API returns 400 for malformed input or a missing idempotency key, 401 for a missing or invalid session or signature, 403 for an unauthorized role, 404 for a quote or attempt outside the caller's scope, and 405 for an unsupported method.

## Customer example

```js
import { API_BASE, request } from "./identity-client.mjs";

const path = API_BASE + "/v1/quotes/" + quoteId;
const token = session.access_token;
const getStatus = () => request(path + "/payment", { token });

// Generate one UUID per action and keep it for retries.
const startCheckout = (choice, idempotencyKey) =>
  request(path + "/checkout", {
    token, method: "POST", idempotencyKey, body: { choice },
  });

const verifyPayment = (attemptId, payment, idempotencyKey) =>
  request(API_BASE + "/v1/checkouts/" + attemptId + "/verify", {
    token, method: "POST", idempotencyKey,
    body: {
      payment_id: payment.razorpay_payment_id,
      signature: payment.razorpay_signature,
    },
  });
```

Call `getStatus()` to show the current state. When `gateway_available` is true, let the customer choose one of the returned payment options. Open Standard Checkout when `startCheckout` returns a non-null `checkout`. Map `checkout.keyId` to `key`, `checkout.orderId` to `order_id`, `checkout.amountPaise` to `amount`, and pass through `checkout.currency`. Keep the result's `attempt.id` for `verifyPayment`. After the callback or dismissal, refresh the payment status page. [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)

A ₹1,65,000 quote with a 20% advance produces **3,300,000 paise** for the advance and **16,500,000 paise** for a first full payment. After the advance, `full` requests the outstanding **13,200,000 paise**. The later capture adds a receipt to the existing order. When the advance equals the total, the choices array offers a single `full` option.

An unconfigured gateway has this status for a fresh accepted quote. The checkout POST returns HTTP 503 with `{"error":{"code":"checkout_unavailable"}}` before creating an attempt or holding equipment.

```json
{
  "state": "checkout_unavailable",
  "gateway_available": false,
  "total_paise": 16500000,
  "advance_paise": 3300000,
  "currency": "INR",
  "collected_paise": 0,
  "remaining_paise": 16500000,
  "choices": ["advance", "full"],
  "attempt": null,
  "receipts": [],
  "order": null
}
```

A confirmed advance returns the following fields. IDs in this example are placeholders.

```json
{
  "state": "confirmed",
  "collected_paise": 3300000,
  "remaining_paise": 13200000,
  "choices": ["full"],
  "receipts": [{
    "id": "<receipt UUID>",
    "attempt_id": "<attempt UUID>",
    "provider_payment_id": "<payment ID>",
    "amount_paise": 3300000,
    "currency": "INR",
    "credited_at": "<timestamp>"
  }],
  "order": {
    "id": "<order UUID>",
    "quote_id": "<accepted quote UUID>",
    "confirmation_receipt_id": "<receipt UUID>",
    "confirmed_at": "<timestamp>",
    "pick_list_id": "<pick list UUID>",
    "work_order_id": "<installation work order UUID>"
  }
}
```

## UI states

| API signal | Customer experience |
| --- | --- |
| `checkout_available` | Show the returned choices. Display server-derived amounts in INR. |
| HTTP 409 `stock_shortage` | Show “Equipment unavailable” and a retry action. The all-lines check failed before a gateway order could open. |
| HTTP 503 `checkout_unavailable` or status `checkout_unavailable` | Show “Checkout unavailable”. Keep the accepted quotation visible and disable payment entry. |
| `payment_pending` | Show “Payment pending”. Open a ready checkout once. After a callback send the verification command and refresh status. |
| HTTP 503 `gateway_unavailable` during verification | Keep the payment pending and refresh status. Retry verification with the same key. |
| `confirmed` | Show the order, receipts, collected amount and outstanding balance. Use the same order number after balance payment. |
| `under_review`, HTTP 409 `payment_under_review`, or HTTP 503 `checkout_creation_uncertain` | Show “Under review” and refresh status. An ambiguous provider create must be reconciled before creating a replacement. A matched late capture can already have a receipt while its order is awaiting stock. |
| `attempt.state = "expired"` | Refresh the quote status. If new checkout is available, start a fresh attempt when the customer chooses to retry. |
| 401, 403 or 404 | Reauthenticate for 401. A role or ownership denial should return the user to their own portal. |

## Stock, retries and reconciliation

A checkout holds every frozen equipment line for **15 minutes**. Available quantity is on-hand quantity less live holds and confirmed reservations. The stock list and design approval use this same calculation. Another customer competing for the final unit receives a shortage. Repeated checkout creation reuses the original attempt and known gateway order. An open attempt for a different payment choice returns `open_checkout_exists`.

Only a captured payment matching the stored order, currency and amount can create a credit. The receipt, firm reservation, order, pick list and installation work order commit together. Each distinct captured payment can post one credit. Late, duplicate and out-of-order notifications can be processed repeatedly. Mismatched or excess captures are retained for admin review. Item quantities are reserved against the order. Serial selection belongs to dispatch.

The scheduled worker checks for due lookups every minute. Verified callbacks and payment notifications provide the payment IDs. Up to five lookups can be claimed at once, with retries backing off to 30 minutes. An admin can also trigger a lookup for a known payment. A provider order that was created but never linked is identified by its checkout receipt reference, which equals the attempt UUID. A trusted operator must compare that reference, amount, currency and Test Mode account with the provider record before linking it via the service-only `solar_checkout_bind` operation. An unknown-order webhook receives 503 so the provider can redeliver. Only independent provider verification can credit the payment.

## Verification and external dependencies

- **Hosted HTTP and database.** The owner and cross-customer checks used fresh accepted quotes. Unconfigured checkout returned 503 on retry and created zero holds. Two independent database sessions competed for a dedicated demo inverter. Only one acquired it. The inventory screen showed zero available, and a fresh design received a one-unit shortage. The unit returned to availability at expiry. A separate operator-run SQL test supplied synthetic normalized capture facts, checked the advance and balance against a single order and both linked tasks, and rolled the entire test back. [Hosted HTTP tests](../tests/checkout-hosted.mjs) · [Transactional database test](../tests/payment-hosted-transaction.sql)
- **Automated tests with PostgreSQL 17 and a test double.** Eight test groups cover exact advance and full amounts, verified callbacks and webhooks, duplicate and out-of-order events, ambiguous creation, contention, expiry, mismatches, delayed lookups, and rollback and retry after failure during work-order creation. The delivered Razorpay adapter also passed 16 offline tests. An integration test uses the adapter's signature verification, the production handler, an isolated PostgreSQL database and mocked Razorpay HTTP responses. [Payment tests](../tests/payment-db.mjs) · [Gateway scenarios](../tests/payment-gateway-scenario.mjs) · [Adapter](../supabase/functions/_shared/razorpay/README.md)
- **Razorpay Test Mode.** ENQ-44 received verified failure and capture webhooks on the deployed API. The capture credited ₹33,000 and confirmed one order with both fulfilment tasks. The separate ENQ-45 decline posted ₹0 and created zero receipts, orders or fulfilment tasks. [Hosted rehearsal evidence](./backend-release.md#hosted-rehearsal-result)

Run the local suite with Node 24 from the repository root. Dependencies below are test-only and remain outside the application.

```powershell
$testDeps = Join-Path $env:TEMP 'sunpower-payment-tests'
npm.cmd install --prefix $testDeps --no-audit --no-fund embedded-postgres@17.12.0-beta.19 pg@8.16.3
$env:NODE_PATH = Join-Path $testDeps 'node_modules'
node --use-system-ca tests/payment-db.mjs
```

For the hosted unavailable-gateway check, load the synthetic accounts using the [identity handoff](./README.md) and pipe the same JSON array to `node --use-system-ca tests/checkout-hosted.mjs`. It creates fresh quotes and prints their references. The live webhook URL is [the hosted Razorpay webhook](https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api/v1/webhooks/razorpay).

For the advance-to-balance rehearsal, the hosted transaction test selects a synthetic accepted quote created with the dedicated QA inverter, opens a 3,300,000-paise advance, processes the capture twice, then opens and captures the 13,200,000-paise balance. It verifies two receipts, zero remaining, and one order with both linked tasks, then rolls the writes back. [Hosted transaction rehearsal](../tests/payment-hosted-transaction.sql)
