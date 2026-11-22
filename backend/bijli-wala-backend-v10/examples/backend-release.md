# Backend release

The integration target is the [hosted Supabase API v10](https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api). It adds the quote delivery worker to v9. The applied release migration is [20261121211042_quote_email_worker.sql](../supabase/migrations/20261121211042_quote_email_worker.sql). Use [identity](./README.md), [quotes](./quote-workflow.md), [checkout](./checkout-workflow.md), [fulfilment](./fulfilment-workflow.md), and [service and reporting](./service-reporting.md) for the API contracts.

## Verification recorded on 22 November 2026

| Check | Result |
| --- | --- |
| Hosted quote delivery | Fresh synthetic ENQ-43 produced one outbox record across concurrent issuance and repeat requests. The owner could access the quote; unauthenticated and unrelated users were denied. Hosted rollback rehearsal verified lease exclusion, frozen request reuse, stale lease rejection and one simulated provider acceptance, with zero committed attempts and zero provider calls. The actual authenticated worker reported `ready:false` and claimed zero messages. |
| Hosted backend regressions | 16 identity checks, disposable staff disable, 10 quote checks, checkout unavailable and ownership, rollback-only payment, ENQ-30 fulfilment/evidence, and ENQ-37/38 service, invoice and CSV checks passed. Before/after fingerprints of the protected enquiry, quote and selected fulfilment records matched for ENQ-10, ENQ-25, ENQ-30, ENQ-37 and ENQ-38. Their historical email rows remained pending. |
| Offline regressions | 11 embedded PostgreSQL scenarios and 19 Deno tests passed, including the Resend HTTP double and Razorpay adapter. Deno type checking passed. |
| Actual quote sender | Pending verified Resend sender, designated inbox and deployed portal entry URL. |
| Fresh customer signup email and first login | The hosted settings show email signup enabled and confirmation required. Inbox delivery, confirmation and first login remain pending an authorized mailbox and usable Auth SMTP. |
| Actual Razorpay Test Mode | Passed on 22 November 2026. ENQ-44 received verified failure, authorization and capture webhooks. The successful retry posted ₹33,000 and created one receipt, one order, one pick list and one installation work order. The separate ENQ-45 decline received verified failure webhooks and posted ₹0, with zero receipts, orders or fulfilment tasks. |

## Quote email worker

Issuing an approved quote commits a single `quote_emails` row with the issued snapshot. Retrying issuance preserves that row. The private worker leases the due row, persists the first Resend request, and retries with the same request and `quote-email/<outbox UUID>` provider idempotency key. Automatic retries stop after eight attempts or before the provider’s 24-hour deduplication window expires. Permanent errors and exhausted retries are held for staff review. Check Resend for an existing acceptance before arranging a manual resend. [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)

Existing outbox rows remain historical pending records. The worker enrolls quotes issued after its migration and skips synthetic recipient domains. It also checks that the recipient is still the customer’s confirmed Auth email and that the issued or accepted quote is still within its validity date. Portal access remains independent of delivery. The scheduled job `solar-quote-email` runs every minute and invokes the worker with its Vault-backed authorization.

Staff `GET /v1/quotes/{id}` includes `delivery.id`, `status`, `delivery_state`, `attempt_count`, `sent_at` and a sanitized `last_error`. `status:sent` and `delivery_state:provider_accepted` mean that Resend accepted the request. Inbox receipt is verified separately. Customers continue to see their issued quote through the existing authenticated endpoint.

### Owner setup for actual quote delivery

1. In Resend, open **Domains → Add Domain**, add a sending domain the project controls, and publish the SPF and DKIM records Resend displays. Wait for **Verified**. Open **API Keys → Create API Key**, choose **Sending access**, and scope the key to that verified domain. [Verify a domain](https://resend.com/docs/dashboard/domains/introduction) · [Sending access keys](https://resend.com/docs/dashboard/api-keys/introduction)
2. In Supabase project **Edge Functions → Secrets**, set the following values directly in the dashboard. [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)

   | Name | Value |
   | --- | --- |
   | `RESEND_API_KEY` | The quote sender’s Resend sending key. |
   | `QUOTE_EMAIL_FROM` | A sender on the verified domain, optionally formatted as `SunPower Solutions <quotes@your-domain>`. |
   | `QUOTE_PORTAL_URL` | The deployed HTTPS customer portal entry that accepts the `quote_id` query parameter and retains it across sign-in. |
   | `QUOTE_EMAIL_TEST_RECIPIENT` | The designated inbox the project owner can open. Set this during the rehearsal to restrict delivery to that address. |

3. Configure the portal entry to read `quote_id`, require sign-in, then call `GET /v1/quotes/{quote_id}` with the session. The link includes only the quote identifier. Supabase Auth confers access after sign-in; the wrong account receives 404.
4. Confirm the designated inbox as a customer account. Use the same synthetic QA account-array format described in the [identity handoff](./README.md). Replace the `customer_a` entry with the test inbox account in memory, keep the other QA accounts, and pipe the array to `node --use-system-ca tests/checkout-hosted.mjs --issue-email`. The test issues a fresh quote, retries it and prints `EMAIL_FIXTURE` with its enquiry, quote and outbox IDs. Use the persisted IDs to follow delivery.
5. Capture the Resend **Emails** record with provider message ID and delivery status, staff quote status with one outbox ID, and one message received in the designated inbox. Open the link in a signed-out browser, sign in as its owner and match the quote reference and amount. Check that a different customer cannot see the quote. Leave passwords, auth tokens and API keys out of the evidence.

Use Supabase **SQL Editor** to match the exact message ID to the outbox without exposing its recipient or body:

```sql
select id as outbox_id, status, attempt_count, provider_message_id, sent_at
from solar_private.quote_emails
where quote_id = '<fresh quote UUID>'::uuid;
```

### Separate Supabase Auth signup and confirmation

1. In Supabase **Authentication → Sign In / Providers → Email**, keep **Confirm email** enabled and allow new signups. In **Authentication → URL Configuration**, set **Site URL** and any allowed **Redirect URLs** to the customer portal and its confirmation landing route. [Redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls)
2. In **Authentication → Emails → SMTP Settings**, enable custom SMTP for an external test inbox. Use a verified From address, a separate Resend sending key for the SMTP password, `smtp.resend.com` on port `587`, and username `resend`. Check **Authentication → Rate Limits** and disable click tracking for Auth links. Supabase’s default sender is restricted to project team addresses and has a low sending limit. [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [Resend SMTP settings](https://resend.com/docs/send-with-smtp)
3. From a signed-out browser register a fresh customer inbox via the portal or `signUpCustomer` in the [identity client](./identity-client.mjs). Before clicking the link, verify that password sign-in is denied. Open the confirmation email, follow the link, and perform the first password sign-in. Verify `GET /v1/me?portal=customer` returns 200 and `role:"customer"`. Save the confirmation timestamp in **Authentication → Users**, redacted inbox evidence, and the before/after outcomes.

## Razorpay Test Mode owner setup

### Hosted rehearsal result

ENQ-44 used provider order `order_U31SBnnK7VFNt3`. The first failed event `U31TlLCkFajuLI` reached the hosted API at 05:57 IST. A read before retry verified zero receipts and orders. The successful retry used payment `pay_U31XcTar4uaoqG`. The capture event `U31XjmTGHJpLVv` reached the API at 06:00 IST and confirmed order `c30b81cc-f95a-427d-a997-e4381ab4d3a0`. The signed-in customer payment endpoint returned `confirmed` and one receipt. ₹1,32,000 remains due.

ENQ-45 used provider order `order_U31coACijyczrG`. The hosted API recorded two verified `failed` events, `U31d23TyppHDuG` and `U31dTiAtHXnGss`, at 06:05 and 06:06 IST. The provider payments were `pay_U31cyLdrjBzqnb` and `pay_U31dNQj8AkneBX`. The hosted records confirmed ₹0 credited and zero receipts, orders, pick lists and installation work orders. The stock hold had a scheduled expiry of 06:20 IST.

### Setup and repeatable checks

1. Sign in to Razorpay Dashboard and switch to **Test Mode**. In **Account & Settings → Website and app settings → API Keys**, generate the test key ID (prefix `rzp_test_`) and secret. In Supabase **Edge Functions → Secrets**, store them as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. [Razorpay test API keys](https://razorpay.com/docs/payments/dashboard/account-settings/api-keys)
2. In Razorpay **Account & Settings → Website and app settings → Webhooks → Add New Webhook**, register [the hosted webhook](https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api/v1/webhooks/razorpay). Select `payment.authorized`, `payment.captured`, and `payment.failed`. Set a webhook signing secret and enter the same value in Supabase as `RAZORPAY_WEBHOOK_SECRET`. Enable capture using the account’s **Payment Capture** setting for the success rehearsal. [Webhook setup](https://razorpay.com/docs/webhooks/setup-edit-payments) · [Payment capture settings](https://razorpay.com/docs/payments/payments/capture-settings/)
3. Unset `SOLAR_QA_QUOTES` and use `node --use-system-ca tests/checkout-hosted.mjs --prepare-only` with the existing synthetic QA array. It creates two fresh accepted quotes and prints their references. Use each quote’s owner and a separate UUID idempotency key to call the hosted checkout route. Check that the first advance on the ₹1,65,000 quote is 3,300,000 paise. Use the returned server order ID and public Test Mode key in Standard Checkout. [Checkout request and browser contract](./checkout-workflow.md) · [Razorpay Web Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
4. Complete the first payment using the Test Mode success path. To isolate webhook verification, skip the browser verification POST on this first run and poll the owner’s payment endpoint until it reports `confirmed`. For the second order choose the Test Mode failure path, such as **Failure** on the mock netbanking screen. Confirm the Razorpay Dashboard records the failed payment. The failed attempt can remain pending until the hold expires. [Test payments](https://razorpay.com/docs/payments/payments/test-card-details/)
5. Record the enquiry, quote, attempt, provider order, payment and webhook event IDs. Capture the Razorpay Dashboard delivery entries and hosted HTTP 2xx responses for `payment.captured` and `payment.failed`. In Supabase **SQL Editor**, run the [read-only operator evidence query](../tests/provider-payment-evidence.sql) after setting `solar.qa_success_quote` and `solar.qa_decline_quote` with `select set_config('<setting>', '<fresh quote UUID>', true)` at the start of the same request. Match the event IDs. The successful quote must show one receipt and one confirmed order. The declined quote must show zero receipts and orders. Record no private provider keys, signatures, card details or tokens.

## Repeatable checks

Use the existing synthetic account loader in the [identity handoff](./README.md) for `tests/identity-hosted.mjs`, `tests/quote-journey.mjs`, `tests/checkout-hosted.mjs`, `tests/fulfilment-hosted.mjs --verify-completed --read-only` and `tests/service-hosted.mjs --verify-preserved`. The last two read preserved fixture records when their quote IDs are provided through `SOLAR_QA_QUOTES`. For the worker, issue a fresh synthetic quote using `--issue-email` and a site beginning `Release synthetic mail `, then run the [rollback-only hosted queue check](../tests/quote-email-hosted-transaction.sql). It exercises the database claim, frozen request, reschedule, stale-lease rejection, and final state transition without a provider call.

```powershell
npx.cmd --offline deno test tests/quote-email.test.ts supabase/functions/_shared/razorpay/mod_test.ts
# Set NODE_PATH as documented in the checkout handoff before running the database suite.
node --use-system-ca tests/payment-db.mjs
```
