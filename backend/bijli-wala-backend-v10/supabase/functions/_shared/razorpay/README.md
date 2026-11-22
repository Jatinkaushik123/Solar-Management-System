# Razorpay Test Mode gateway module

This folder is a self-contained Deno TypeScript module for server-side Razorpay
order creation, checkout and webhook signature verification, and payment lookup.
It has no third-party imports and does not log provider data.

## Runtime and offline tests

Checked with Deno 2.9.6 (stable, Windows x86_64). From the repository root:

```sh
deno check supabase/functions/_shared/razorpay/mod.ts supabase/functions/_shared/razorpay/mod_test.ts
deno test supabase/functions/_shared/razorpay/
```

The tests use fixtures and injected `fetch`; they do not need Razorpay
credentials or network access. If Deno is not installed, the equivalent commands
used for this rehearsal are:

```sh
npm exec --yes --package=deno -- deno check supabase/functions/_shared/razorpay/mod.ts supabase/functions/_shared/razorpay/mod_test.ts
npm exec --yes --package=deno -- deno test supabase/functions/_shared/razorpay/
```

## Configuration and import

Provide these server-side values through the runtime secret store:

- `RAZORPAY_KEY_ID` — a Test Mode key ID beginning with `rzp_test_`; live keys
  are rejected.
- `RAZORPAY_KEY_SECRET` — the matching API key secret.
- `RAZORPAY_WEBHOOK_SECRET` — the separate signing secret configured for the
  webhook endpoint in Razorpay Test Mode.

```ts
import { createRazorpayGateway } from "../_shared/razorpay/mod.ts";

const gateway = createRazorpayGateway({
  keyId: Deno.env.get("RAZORPAY_KEY_ID") ?? "",
  keySecret: Deno.env.get("RAZORPAY_KEY_SECRET") ?? "",
  webhookSecret: Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "",
});

const checkout = await gateway.createOrder({
  checkoutRef: attempt.reference,
  amountPaise: attempt.amountPaise,
});
// Persist checkout.orderId against the attempt before returning it to Checkout.
```

The caller must authorize the customer and load the frozen amount before calling
`createOrder`. Return only `keyId`, `orderId`, `amountPaise`, and `currency` to
the browser. The browser maps `keyId` to Checkout's `key`, `orderId` to
`order_id`, and `amountPaise` to `amount`. Keep the API key secret and webhook
secret server-side.

## Test Mode setup

1. In the Razorpay Dashboard, switch the account to **Test Mode** and create or
   copy its Test Mode API key pair. Configure `RAZORPAY_KEY_ID` and
   `RAZORPAY_KEY_SECRET` in the server secret store.
2. When Main Build supplies the shared webhook endpoint, add that endpoint while
   still in Test Mode. Set a webhook signing secret and store the same value as
   `RAZORPAY_WEBHOOK_SECRET`.
3. Subscribe the endpoint to `payment.authorized`, `payment.captured`, and
   `payment.failed`. The handler must pass the unchanged request bytes
   (`new Uint8Array(await request.arrayBuffer())`), the `X-Razorpay-Signature`
   header, and the `x-razorpay-event-id` header to `verifyWebhook`.
4. Exercise Standard Checkout with synthetic customer details and a Razorpay
   Test Mode payment method. Verify the browser callback against the persisted
   order ID. Independently fetch the payment and have the caller compare its
   saved order, amount, currency, and captured status before crediting it.

The module only confirms signature authenticity and returns provider facts. It
does not decide whether to credit a payment, deduplicate durable events,
reconcile quote amounts, or manage retries and fulfilment.

## Public methods

- `createOrder({ checkoutRef, amountPaise })` creates one INR order, rejects
  non-positive or unsafe amounts, and validates the provider ID, amount, and
  currency before returning it. References must be printable ASCII and at most
  40 characters; uniqueness is the caller's responsibility.
- `verifyCheckout({ storedOrderId, paymentId, signature })` verifies HMAC-SHA256
  over the exact `storedOrderId + "|" + paymentId` string using the API key
  secret. Invalid or mismatched signatures return `false`. A valid signature
  does not establish capture, amount, or currency.
- `verifyWebhook({ rawBody, signature, eventId })` verifies the original bytes
  using the webhook secret before JSON parsing. It normalizes the three payment
  events and returns a signed but unhandled event as `kind: "ignored"`. It
  preserves the supplied event ID on every result; replay safety and event
  ordering are owned by the caller.
- `fetchPayment(paymentId)` fetches provider facts and preserves a missing order
  as `null` and any currency or order mismatch for caller-side reconciliation.

`RazorpayError.code` is one of `invalid_input`, `invalid_signature`,
`invalid_payload`, `provider_error`, or `provider_unavailable`. Messages are
sanitized and do not include provider response bodies, authorization data, or
callback contents. No request is automatically retried. A `provider_unavailable`
from order creation, including a timeout, 5xx response, or unexpected create
response, is ambiguous: reconcile the receipt/order in Razorpay before retrying
to avoid duplicate payable orders. `provider_error` indicates a non-retryable
provider rejection or malformed payment lookup response; correct the input or
investigate the integration before retrying.

## Test Mode rehearsal status

The offline suite includes mocked checkout journeys at **3,300,000 paise INR**:

- Success fixture: the callback signature verified and the payment lookup
  returned `captured`.
- Failure fixture: the callback signature verified and the payment lookup
  returned `failed`.

These are mock results, not Razorpay provider transactions. A real Test Mode
checkout was **not run**: the available Razorpay dashboard session opened to the
login page, and no `RAZORPAY_*` environment values are configured. Successful
and failed provider outcomes therefore remain unverified. Supply the Test Mode
API key pair through a local secret store and complete the provider checkout
rehearsal with synthetic data; never commit or paste secret values into chat.
Webhook delivery to Main Build's hosted endpoint remains an integration check
for that team.
