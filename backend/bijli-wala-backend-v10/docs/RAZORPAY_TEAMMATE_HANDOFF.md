# Teammate handoff · Razorpay Test Mode

**Deliver one importable TypeScript module for the solar installation customer portal.** The module will run server-side in a Supabase Edge Function (Deno). You can build and test it on your own machine. You need access to a Razorpay **Test Mode** account for the gateway rehearsal. You do not need the team's Supabase login, database credentials, frontend frames or prior chat.

## Copy this prompt into your build chat

> Build the Razorpay Test Mode integration described in this handoff. Return one self-contained folder at `supabase/functions/_shared/razorpay/` with `mod.ts`, offline tests and a short integration README. Implement the four methods and public types below. Use the server-stored Razorpay order ID for checkout verification and the original request bytes for webhook verification. Return normalized provider facts so our main backend can decide whether to credit a payment.
>
> Run the offline tests, then exercise one successful and one failed Test Mode checkout. Report exactly what passed and any provider checks still pending. Keep all code and dependencies inside the assigned folder. The main backend team owns routes, authentication, quote calculations, database migrations, receipts, stock reservations and fulfilment. Return a PR or ZIP with the same folder structure. Keep account secrets local.

## Where your module fits

A technician approves the equipment list, inventory verifies availability, and sales issues a priced quotation. Sales chooses the advance as a fixed INR amount or a percentage. The customer accepts and chooses advance or full payment. Main Build computes and freezes the exact payable amount, creates a checkout attempt and briefly holds the stock.

For example, a ₹1,65,000 quote with a 20% advance gives your module **3,300,000 paise** for an advance checkout, or **16,500,000 paise** for a full checkout. Each checkout attempt uses its own unique internal reference. Create a Razorpay order for exactly the supplied amount. Treat a later balance payment as a separate checkout attempt.

| Your module owns | Main Build owns |
| --- | --- |
| Provider requests, signature verification, event parsing, payment lookup, sanitized provider errors | Authentication, authorization, quote revision and amount calculations, stock holds and public HTTP endpoints |
| Returning a provider order, verified event details and fetched payment details | Persisting IDs, deduplicating events and credits, reconciling amounts, issuing receipts, confirming orders, refunds and fulfilment |
| Offline tests and a Test Mode rehearsal using synthetic data | Hosted portal, shared webhook URL, secret configuration and integrated end-to-end rehearsal |

## Public interface to export from mod.ts

Use Deno-compatible TypeScript, Web Crypto and HTTPS fetch. Inject configuration and allow an optional fetch implementation for offline tests. The following declarations define the contract. Your returned folder supplies the implementation.

```ts
export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
}

export interface CheckoutOrder {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: "INR";
}

export interface PaymentSnapshot {
  paymentId: string;
  orderId: string | null;
  amountPaise: number;
  currency: string;
  status: string; // Provider value, e.g. "authorized", "captured", "failed".
}

export type VerifiedEvent =
  | { kind: "payment"; eventId: string; eventType: string; payment: PaymentSnapshot }
  | { kind: "ignored"; eventId: string; eventType: string };

export interface RazorpayGateway {
  createOrder(input: {
    checkoutRef: string;
    amountPaise: number;
  }): Promise<CheckoutOrder>;

  verifyCheckout(input: {
    storedOrderId: string;
    paymentId: string;
    signature: string;
  }): Promise<boolean>;

  verifyWebhook(input: {
    rawBody: Uint8Array;
    signature: string;
    eventId: string;
  }): Promise<VerifiedEvent>;

  fetchPayment(paymentId: string): Promise<PaymentSnapshot>;
}

export declare function createRazorpayGateway(config: RazorpayConfig): RazorpayGateway;
```

### Behavior Main Build will rely on

1. **Configuration.** Main Build supplies `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` from server-side secrets. Require a test key ID and reject a live-mode key. The webhook signing secret is configured separately in the Razorpay Test Mode dashboard. Only the public key ID, provider order ID, amount and currency go to Checkout.
2. **Create order.** Call the provider Orders API from the server. Use a positive safe integer amount in paise, INR and the caller's unique ASCII checkout reference (max 40 characters) as the receipt. Validate the returned ID, amount and currency against the request. Use a bounded timeout. If creation times out or the result is ambiguous, surface that for reconciliation. Creating another order automatically could leave two payable orders. [Create an order](https://razorpay.com/docs/api/orders/create/)
3. **Verify checkout.** Verify Razorpay's HMAC-SHA256 signature using the API key secret and the exact string `storedOrderId + "|" + paymentId`. Use Web Crypto verification or a timing-safe comparison. A missing, malformed or mismatched signature returns `false`. A valid result authenticates the callback. The caller still checks capture, order, amount and currency before recording payment. [Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
4. **Verify webhook.** The HTTP handler passes the raw bytes, `X-Razorpay-Signature` and `x-razorpay-event-id`. Verify the signature with the webhook secret before parsing JSON. Reject missing event IDs and malformed payloads. Normalize `payment.authorized`, `payment.captured` and `payment.failed` from the payment entity. Return `kind: "ignored"` for other correctly signed event types. Preserve the event ID on every success, including repeats. Main Build persists the event ID and uses a separate uniqueness check on the payment ID for crediting. [Webhook validation](https://razorpay.com/docs/webhooks/validate-test/)
5. **Fetch payment.** Use the server-side Payments API. Return the payment ID, linked order ID, original amount in paise, currency and provider status. Preserve a missing order as null. Return a sanitized error for failed requests or malformed responses. Keep provider secrets, authorization headers, raw callbacks and customer payment information out of logs and returned errors. [Fetch a payment](https://razorpay.com/docs/api/payments/fetch-with-id/)
6. **Errors.** Export a `RazorpayError` class with a stable `code` field. Use `invalid_input`, `invalid_signature`, `invalid_payload`, `provider_error` or `provider_unavailable`. The boolean checkout verification method is the single exception for bad signatures. Document which codes require reconciliation before retrying order creation. Main Build maps errors to HTTP responses.

### Example at the integration boundary

```ts
import { createRazorpayGateway } from "../_shared/razorpay/mod.ts";

// This code runs in the server handler. The caller has already authorized the
// customer, loaded the accepted quote, and created a checkout attempt.
const gateway = createRazorpayGateway(config);
const checkout = await gateway.createOrder({
  checkoutRef: attempt.reference,
  amountPaise: attempt.amountPaise,
});
// Persist checkout.orderId against the attempt before returning checkout to the UI.
```

The frontend maps `keyId` to Checkout's `key`, `orderId` to `order_id`, and `amountPaise` to `amount`. Main Build hands the unchanged webhook request bytes to your module using `new Uint8Array(await request.arrayBuffer())`. Main Build credits only a captured payment matching its saved provider order, expected amount and currency. Browser closure, a verified callback, delayed webhooks and multiple attempts are all possible.

## Acceptance checks

| Check | Evidence to return |
| --- | --- |
| Import and runtime | A clean Deno checkout can import `mod.ts`. Include the exact `deno check` and `deno test` commands. Offline tests use fixtures and injected fetch without provider credentials. |
| Order creation | Show the expected INR amount and receipt in a mocked request, a matching response, rejected invalid amounts, a rejected mismatched response and a timeout with only one create attempt. |
| Checkout verification | Test a known valid signature, a different server-stored order ID, and a malformed signature. |
| Webhook verification | Test valid raw bytes, a one-byte change, wrong secret, missing event ID, invalid JSON with a valid signature and a supported event lacking its payment details. Test a correctly signed unhandled event. |
| Replays and ordering | Replaying a capture returns the same event and payment IDs. An authorization arriving after capture still reports its own provider status. The caller owns durable deduplication and state ordering. |
| Payment lookup | Fixtures cover authorized, captured, failed and provider errors. A mismatched currency or order ID remains visible to the caller and cannot be mistaken for a matched payment. |
| Gateway rehearsal | In Test Mode, open Standard Checkout for a server-created order. Exercise one successful and one failed payment. For success, verify the checkout callback and fetch the captured payment. For failure, report the observed provider outcome. Record amount, currency, status and redacted references. Label webhook evidence as a signed local fixture or a real Test Mode delivery, whichever you actually observed. The shared hosted webhook test belongs to Main Build. |

## What to send back

- A PR URL and commit hash, or a ZIP rooted at `supabase/functions/_shared/razorpay/`. Include all imported local files. A clean copy must work without your machine's paths or uncommitted dependencies.
- Your README with the import example, Deno version tested, commands, environment variable names, and the four-method interface. Include how to select Test Mode, configure the webhook signing secret, and subscribe to the three payment events when Main Build supplies the shared endpoint.
- The offline test result and the successful/failed Test Mode observations. List any check you could not run and the specific missing dependency.
- Use synthetic customer information. Share only redacted evidence. Main Build will provision its own credentials through its secret store. Do not include secret values, database files or real payment details.

**Integration is complete** when Main Build can drop the folder into the repository, run the offline suite, and use the exported methods to verify a captured Test Mode payment for the exact order, currency and amount saved by the application.
