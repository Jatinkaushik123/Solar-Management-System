# Enquiry and quotation API

After acceptance, the customer portal uses the [checkout and order handoff](./checkout-workflow.md) for payment choices, receipts, order confirmation and fulfilment task IDs.

The hosted API base is `https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api`. Sign in on the appropriate portal and use the returned access token. The public client configuration and login example are in the [identity handoff](./README.md).

Send `apikey` and `Authorization: Bearer <session access token>` with each request. Every workflow POST takes a JSON object and an `Idempotency-Key` header containing a UUID. Generate the UUID when the user takes an action and keep it for retries. Reusing a key with a different path or payload returns 409. Authorization is checked again on replay. GET requests take neither a body nor an idempotency key.

## Screens and routes

| Screen or action | HTTP path | What to render |
| --- | --- | --- |
| Customer intake | `POST /v1/enquiries` | Request ID, reference, initial state and acknowledgement. The server derives the owner from the session. |
| Request list | `GET /v1/enquiries?after=0&limit=50` | `items` in ascending request-number order and `next_after`. Pass the returned cursor to load the next page. The default page size is 50 and the maximum is 100. |
| Request detail | `GET /v1/enquiries/{id}` | Current state, design revision, visible quote references, history and allowed actions. Technical and inventory records appear to authorized staff. Customers see published quote references. |
| Assignment picker | `GET /v1/staff/assignees` | An admin gets active technician and sales IDs, roles and display names. |
| Assign or reassign | `POST /v1/enquiries/{id}/assignment` | Supply `technician_id` and `salesperson_id` from the picker. Returns the request summary. |
| Return survey | `POST /v1/enquiries/{id}/return` | Supply `base_revision` and `reason`. State becomes `correction`. The customer sees the reason in history. The technician can submit the corrected visit. |
| Approve site visit and design | `POST /v1/enquiries/{id}/designs` | Supply the measurements and quantities below. Returns the new revision and `technical_approved`. Earlier active quotes become superseded. |
| Equipment catalogue and availability | `GET /v1/inventory/items` | Inventory, technician and admin get an array of item IDs, demo names, available quantities and suggested unit prices in paise. |
| Check stock | `POST /v1/enquiries/{id}/inventory-checks` | Supply `revision`. Returns item-level counts, `outcome`, `checked_at`, `actor_id`, `revision` and `quote_id`. Approval puts the staff enquiry in `draft` and returns one draft quote ID. A shortage puts it in `shortage` and returns HTTP 200 with `quote_id: null`. Customers see `under_review` in either case. |
| Quote detail | `GET /v1/quotes/{id}` | Assigned sales and admin can read draft revisions. The owning customer can read issued revisions. Use `allowed_actions` on the detail. |
| Set commercial terms | `POST /v1/quotes/{id}/pricing` | Supply the current `price_version`, one price per existing item and the terms below. Returns the repriced draft and incremented `price_version`. |
| Issue | `POST /v1/quotes/{id}/issue` | Supply the priced draft's `price_version`. Returns the frozen snapshot. Sales and admin see the outbox row and its delivery state. |
| Customer response | `POST /v1/quotes/{id}/decision` | Supply `{"decision":"accept"}`, `{"decision":"decline"}` or `{"decision":"request_changes","kind":"commercial","reason":"Use a percentage advance"}`. Use `kind:"technical"` to return work to the technician. |
| Disable staff | `POST /v1/staff/{id}/disable` | Admin sends `{}`. Returns `user_id`, `disabled_by` and `disabled_at`. The staff member's existing tokens lose access and password sign-in is blocked. |

The intake stores the supplied contact address. The quote recipient is the customer's confirmed account email at intake. Issuance checks that this address still belongs to their confirmed account. The form can display both addresses when they differ. Use `delivery.delivery_state` for staff delivery status. The deployed worker sends the email after sender and portal setup. [Backend release and sender setup](./backend-release.md)

## One reproducible journey

These request bodies show a 2.75 kW, five-panel demo. Substitute the IDs returned by this run. Use a completed visit time and a validity date on or after today in India. Success responses below show the fields a screen needs for its next action.

The frontend can call any workflow POST with the existing client. Keep the same key when a network failure leaves the outcome uncertain.

```js
import { API_BASE, request } from "./identity-client.mjs";

const submissionKey = crypto.randomUUID();
const submitEnquiry = () => request(API_BASE + "/v1/enquiries", {
  method: "POST", token: session.access_token, idempotencyKey: submissionKey, body: intakeForm,
});
const enquiry = await submitEnquiry();
const tracking = await request(API_BASE + "/v1/enquiries/" + enquiry.id, {
  token: session.access_token,
});
```

**1. Customer submits the site.** POST to `/v1/enquiries`.

```json
{"site":"Demo rooftop, Pune","contact_email":"customer@example.com","requirements":"On-grid rooftop installation","roof_space_m2":40,"monthly_bill_paise":450000,"grid_details":"Single phase"}
```

The response includes `id`, `reference`, `state:"submitted"`, `revision:0` and the acknowledgement “We’ve received your request. We’ll email your quotation once it’s approved.” Use that ID for the customer tracking screen.

**2. Admin assigns both owners.** POST `{"technician_id":"<technician UUID>","salesperson_id":"<sales UUID>"}` to `/v1/enquiries/{id}/assignment`. The assigned technician then POSTs this visit to `/v1/enquiries/{id}/designs`.

```json
{"base_revision":0,"visited_at":"2026-11-20T09:00:00Z","roof_direction":"South","tilt_deg":18,"cable_m":24.5,"equipment":[{"item_id":"DEMO-PANEL","quantity":5},{"item_id":"DEMO-INVERTER","quantity":1}]}
```

The response contains `state:"technical_approved"` and `revision:1`. Submitting a revised list uses the current revision as `base_revision`. Both the original measurements and the original approvals remain in history.

**3. Inventory checks the revision.** POST `{"revision":1}` to `/v1/enquiries/{id}/inventory-checks`. Read the current available quantities from the API. The counts below are illustrative. After approval, the sales queue should show the enquiry in `draft` with the returned quote ID. The customer still sees `under_review` and has no quote to open until sales issues it.

```json
{"outcome":"approved","revision":1,"quote_id":"<draft UUID>","lines":[{"item_id":"DEMO-INVERTER","required":1,"available":6,"shortfall":0},{"item_id":"DEMO-PANEL","required":5,"available":40,"shortfall":0}]}
```

To exercise a shortage, start with 999 panels or one demo battery. The response lists the shortfall. Submit a corrected design and check its new revision. Stock quantities stay the same throughout this milestone.

**4. Sales prices and issues the draft.** The five panels cost ₹1,00,000 and the inverter costs ₹50,000. Add ₹20,000 installation and subtract a ₹5,000 discount. POST to `/v1/quotes/{quote_id}/pricing`.

```json
{"price_version":0,"unit_prices":{"DEMO-PANEL":2000000,"DEMO-INVERTER":5000000},"installation_paise":2000000,"discount_paise":500000,"valid_until":"2026-12-31","advance_kind":"percentage","advance_value":2000}
```

The response includes `price_version:1`, `total_paise:16500000` and `advance_paise:3300000`. Percentages use basis points, with 10,000 representing 100%. Percentage advances round half up to a paisa. A fixed ₹25,000 advance uses `"advance_kind":"fixed","advance_value":2500000`. The unit-price map must contain exactly the design's item IDs. Equipment, quantity and total fields in the request are rejected.

POST `{"price_version":1}` to `/v1/quotes/{quote_id}/issue`. The staff response includes `state:"issued"`, `issued_at` and `delivery:{"id":"<email UUID>","status":"pending",...}`. The freeze and the single email row commit together.

**5. Customer accepts.** Read `/v1/enquiries/{id}`, open the issued quote and POST `{"decision":"accept"}` to `/v1/quotes/{quote_id}/decision`. The response includes `state:"accepted"`, `decided_at`, the frozen total and the advance. Refreshing the enquiry shows `accepted`. An accepted or declined request is closed. A commercial change request opens a new private quote revision against the approved design. A technical change requires a new site/design submission and inventory check.

## Allowed actions and errors

`GET /v1/me` returns role-level actions for navigation. Enquiry and quote detail return the actions currently available on that record. A customer owns the enquiry, the assigned technician owns the survey decision, inventory checks the active revision, and the assigned salesperson owns pricing and issuance. Admins see company records and assign the work. The customer can read an older issued revision after a change and see its recorded decision.

| Status | UI handling |
| --- | --- |
| 200 | Read the returned state or stock outcome. Repeated issue and acceptance preserve the original issue/decision timestamps. |
| 400 / 413 / 415 | Correct an invalid field, UUID, key, request size or JSON content type. |
| 401 | Sign in again or show that the account has been disabled. |
| 403 | The role cannot perform the operation. |
| 404 | The record is missing or hidden from this caller. This also applies to a customer's own unpublished draft by direct quote ID. |
| 405 | Use the documented HTTP method. |
| 409 | Reload after a stale design or price version. Check whether the quote expired, the work is already closed or the idempotency key was reused for another command. |
| 503 | A dependency is unavailable. Retry the original request with its original key. |

Error responses use `{"error":{"code":"stale_design"}}` and analogous machine-readable codes.

## Rerun the hosted demonstration

From the repository root, use the private fixture loader in the [identity handoff](./README.md) and replace its final command with the one below. Each run creates synthetic enquiries, prints the request reference and accepted quote UUID, and signs out its sessions. [Hosted journey test](../tests/quote-journey.mjs)

```powershell
ConvertTo-Json -InputObject @($accounts) -Compress | node --use-system-ca tests/quote-journey.mjs
```

On 22 November 2026 (India time), request `ENQ-10` completed the hosted demonstration. Five panels and one inverter on design revision 3 produced ₹1,65,000 after installation and discount. Quote revision 2 recorded a ₹25,000 fixed advance and the customer's request for a change. The customer accepted revision 3 with a ₹33,000 advance. Each issued revision has one pending email. Chrome also repeated the acceptance and received the original decision timestamp. [Authenticated enquiry](https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api/v1/enquiries/ea3a9697-5a11-469c-8d43-38c0f6ed58c3) · [Authenticated accepted quote](https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api/v1/quotes/d0819756-66b3-43e2-8fab-ac1518b0136d)

The separate staff-disable check takes confirmed synthetic staff credentials and an admin session's login credentials via standard input. It permanently disables the designated fixture. The hosted run reused its old bearer token immediately after disabling it and received 401 from both the identity and inventory endpoints. [Disposable-fixture test](../tests/disable-staff-hosted.mjs)
