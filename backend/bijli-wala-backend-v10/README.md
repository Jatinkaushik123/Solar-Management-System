# Solar Installation Management System

SunPower Solutions needs to trace a rooftop installation from the first enquiry to the equipment still under warranty years later. The [hackathon brief](docs/Solar_Installation_Management_System.pdf) follows one company completing about 40 installations a month with 15 technicians. The target in five to six hours is a hosted, working backend that teammates can connect to their existing frontend. Odoo is optional. This document is the build plan.

## Agreed enquiry and quotation flow

1. The customer signs in through the customer login, submits the request and survey form, and supplies the email address for the quotation. The submission is saved and the customer sees “We’ve received your request. We’ll email your quotation once it’s approved.”
2. The assigned technician visits the site, verifies roof direction, tilt and cable distance, and approves the technical design or returns the survey for correction. Customer answers and verified measurements are separate. The technician selects the system, equipment and quantities.
3. Inventory checks availability against that exact equipment revision. A shortage is returned for restocking or a technician-approved alternative. Approval at this stage is a point-in-time stock check. A later technical revision requires a fresh inventory check and supersedes unaccepted quotes for the older revision.
4. Both approvals trigger a draft for sales. Sales controls prices, discounts, installation charges and commercial terms. Equipment IDs, quantities and the technical revision are read-only to sales. The API enforces these rules even if a client submits additional fields. Drafts are private.
5. Sales approval freezes the issued quotation and queues delivery to the customer's verified recipient email. The email includes the approved quotation and an authenticated portal link. The customer accepts, declines or requests a revision. A requested technical change returns to the technician. An accepted quote keeps its commercial and technical snapshot.
6. The customer's portal offers the sales-defined advance or full payment through Razorpay Test Mode. The backend derives both choices from the accepted revision. Once payment is verified and stock secured, the backend confirms one order and creates one warehouse pick list and one installation work order ready for scheduling.

## Existing database

Keep the hosted Supabase PostgreSQL project and redesign its application schema. A read-only inventory on 21 November 2026 verified PostgreSQL 17, zero tables in `public`, and 15 tables in `solar_app` matching the names in the four historical [migration files](supabase/migrations/). Live counts include three jobs, one order and one service ticket. Supabase Auth has zero users and Storage has zero buckets and objects. Legacy commissioning evidence is stored in Postgres. Supabase reports no tracked migrations, so establish a baseline before applying the redesigned schema.

Row-level security is disabled on all 15 legacy tables. The database roles `anon` and `authenticated` have no schema usage or table grants there. The server login `solar_runtime` can read all 15 and write to 13. The new design needs checks for each user's role and ownership of each record, including private drafts and commissioning evidence. Retain the old records while developing the replacement.

| Area | What the migrations describe | Decision for the rebuild |
| --- | --- | --- |
| Customers and sales | Jobs hold a customer name, phone, site, screening and survey fields. The catalogue seeds ten on-grid and off-grid demo packages. A job has one quote snapshot and can have one advance. | Define customer accounts, sites, assignments, revisions and payments. Identify which existing customers can be linked reliably. |
| Fulfilment and field work | Orders link to pick lists and crew jobs. Shipments track serials and delivery. The crew assignment holds a name and date. Commissioning stores one photo and one signature as database bytes. | Establish stock custody, technician identity, field evidence ownership and private file access. |
| Service and finance | Tickets link to serials and record coverage and closure. Job costs hold materials and labour totals. | Establish repair and replacement history, invoice and payment records, and the sources for each job's margin. |

The prior demo used shared operator and judge logins. Its source, tests, runbooks and database grant examples are recoverable at Git commit `c40f02c`. Its sample prices, parts lists and login roles are historical fixtures. The new backend needs its own approved contract.

## Workflow to design

| Business step | What a reviewer should be able to verify in the new backend |
| --- | --- |
| Enquiry, screening and survey | Trace a web or staff-entered enquiry to its owner and site. Identify who performed the survey and who approved it. An unapproved survey blocks issuing a quote. |
| Catalogue, quote and order | Represent hardware-only sales, 1–5 kW systems and installation service. Freeze the quoted parts, price and terms on the accepted revision. Handle advance or full payment per the agreed policy. Confirming the order twice creates one set of fulfilment tasks. |
| Stock and dispatch | Trace purchased or received equipment to available stock, reservation, serial scan, shipment and delivery. If two orders request the last inverter, only one can receive that unit. Delivery starts the applicable warranty once. |
| Installation and handover | Assign the crew to the correct site. Record times, system size, generation test, photos and customer sign-off. Preserve evidence and record who submitted and who accepted it. |
| Warranty and service | Find an installed unit by serial, establish coverage at claim time, trace a repair or replacement, bill eligible out-of-warranty parts and labour and capture customer confirmation. |
| Finance and reporting | Trace job revenue, stock costs, technician time, invoices, collections and outstanding amounts to their source records. Define how subsidies and technician pay are tracked. Reconcile daily, weekly and monthly figures and exports against the same jobs. |

## Roles and permissions

Customers and staff enter through separate login screens. Customers can register. An admin invites staff and assigns their role. Both login screens use the same identity service. The server resolves permissions from the verified identity and a protected staff assignment. Public signup cannot create staff access. Customers can hold multiple sites and requests.

| Role | Record scope | Actions |
| --- | --- | --- |
| Customer | Own sites, requests, issued quotes, receipts and installed assets | Submit, track, accept or request changes, pay, sign off, open a service ticket, confirm a repair |
| Technician | Assigned surveys, installations and service visits | Return or approve the survey after the site visit, specify equipment, record hours, tests, evidence and repair work |
| Inventory | Company stock and the fulfilment details needed for each job | Receive and count stock, approve availability, scan serials, dispatch, record delivery, process returns and replacements |
| Sales | Owned or assigned sales requests and related customer communications | Follow up, price an approved equipment list, issue revisions, track quote delivery, view associated payments and follow up on balances |
| Admin | Company-wide | Invite and disable staff, assign and reassign work, return items for correction, see financial reports, audit approvals and resolve exceptions |

Every approval records its actor, timestamp and affected revision. Returning work for correction preserves the original approval history. Customer requests for another customer's records, staff performing unassigned work, and sales attempts to alter equipment are covered by access tests.

## Frontend integration map

The ten supplied PNGs show the team's working design for Bijli Wala. Frames 1–9 show login and staff screens. Frame 10 is a background asset. The following are proposed reads under the versioned API. The team can change navigation, labels and charts while keeping the business operations stable.

| Frame and screen | Proposed read | Data needed from the backend |
| --- | --- | --- |
| 1 · Login | `GET /v1/me` after signing in | Identity, assigned role and available actions. Customer and staff have separate entry screens. The “Admin” selector in the sketch cannot grant access. The agreed login method uses email credentials. |
| 2 · Dashboard | `GET /v1/dashboard` | Project totals by stage, completed installations by month, recent projects and period bounds. Counts and lists use the same role scope. |
| 3 · Enquiries | `GET /v1/enquiries` | Reference, customer, permitted contact fields, location, submitted date and intake status. A converted enquiry links to its confirmed order. |
| 4 · Surveys | `GET /v1/surveys` | Site, assigned technician, scheduled visit, visit status and technical approval. Completing a visit and approving a design are distinct actions. |
| 5 · Quotations | `GET /v1/quotes` | Quote reference, revision, system size, total, validity and customer decision. Staff also see review and email delivery status. The customer's list exposes only their issued revisions. |
| 6 · Projects | `GET /v1/projects` | Confirmed order, customer/site, system size, start and completion dates, milestone and next action. Creating a project follows order confirmation. |
| 7 · Inventory | `GET /v1/inventory/items` | Item reference, category, brand, unit, on-hand, held, reserved and available quantities. “In stock” reflects available quantity. Kit approval checks each required line and quantity. |
| 8 · Installations | `GET /v1/work-orders?type=installation` | Project, site, size, crew, scheduled date, work status, commissioning evidence and sign-off state, scoped by assignment. |
| 9 · Warranty | `GET /v1/warranties` | Project, product, serial, delivery date, warranty term and expiry, coverage at the requested date and linked service tickets. |

List responses should support deterministic pagination and relevant search, status, location and date filters. Counters aggregate the same filtered records across all pages. The frontend translates status codes into labels. Module-specific summaries are derived from the corresponding records. Prototype counts, sample projects and sample prices are illustrative.

The customer portal also needs request tracking, a published quote detail with accept/decline/request changes, checkout and receipt status, owned warranties and repair confirmation. Staff need actions for technician submission, inventory approval or shortage, sales pricing and issuance, fulfilment and admin assignment. These flows come from the agreed requirements even where the mockups currently show only lists.

## Online payments and stock

The second backend developer owns the provider adapter under `supabase/functions/_shared/razorpay/`. Its [standalone handoff and import contract](docs/RAZORPAY_TEAMMATE_HANDOFF.md) defines the four methods, error codes and acceptance checks. Main Build owns the checkout and webhook routes, role checks, payment and event tables, reconciliation and order fulfilment. Identity, surveys, approvals, quotation delivery and post-installation modules can proceed independently.

Use Razorpay Standard Checkout in Test Mode. For each quote revision, sales chooses one advance rule: a fixed INR amount or a percentage of the final quoted total. The customer can pay the resulting advance or the full outstanding amount. For example, on a ₹1,65,000 issued quote, 20% gives an advance of ₹33,000 and leaves ₹1,32,000 after verified payment. Sales could instead specify a fixed ₹25,000 advance on that quote.

Proposed calculation rule: store fixed amounts in integer paise and percentages in basis points (100 basis points = 1%). At issuance, round the computed advance once to the nearest paisa, half up. Validate that the advance is at least one paisa and no larger than the total, and that any percentage is positive and at most 100%. Freeze the rule, resolved amount and total on the issued revision. Return them from the API so the email, portal and gateway request all use the same figures. When the advance equals the total, show a single full-payment choice. An already paid advance leaves only the outstanding balance payable.

1. On checkout, recheck the accepted revision, outstanding balance and stock. Place a short, expiring hold for the required quantities in a database transaction before creating the gateway order. If the kit is unavailable, show the shortage status and flag inventory before the customer enters payment. Concurrent attempts for the last item must result in one hold. A repeated checkout request should reuse the open attempt.
2. Present gateway-hosted checkout. The browser shows a pending result until the backend verifies capture. Match the provider order, amount and currency to the stored attempt. Authenticate webhooks over the original request body. Reconcile delayed notifications with a server-side provider lookup.
3. Record the verified payment once. Convert the hold to a firm allocation, confirm the order and create fulfilment tasks atomically. Duplicate callbacks and emails must never produce a second credit or order. Additional payments reduce the outstanding balance on the same order.
4. Failed or abandoned attempts release their holds at expiry. For a late capture, record the money received; recheck stock atomically. If replenished stock can satisfy the order, fulfil it. Otherwise show the customer a payment-under-review status and create a reconciliation or refund task for admin. Bank or cash receipts, if used, carry a distinct source, actor and reference.

Provider references: [Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/) and [webhook validation](https://razorpay.com/docs/webhooks/validate-test/).

## Proposed backend and records

Use one modular TypeScript HTTP API hosted on Supabase Edge Functions, with Supabase Auth, PostgreSQL and private Storage. Keeping those components in the existing project gives the frontend one hosted environment. Separate business operations by module, use transactions for contested writes and store jobs for email and payment reconciliation durably. A worker claims due jobs, retries failures and exposes their status to admin. [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

| Module | Main records and relationships |
| --- | --- |
| Identity and intake | Auth users link to customer or staff profiles, with protected staff role assignments. Customers own sites, each site can have several requests, and each request has assigned staff. |
| Surveys and quotations | A request has survey and design revisions. Each design has equipment lines and technician approval. Stock approvals reference the design revision. Quote revisions snapshot the approved equipment and prices. A delivery record tracks the issued revision and email attempts. |
| Warehouse and orders | Products can belong to package templates. Receipts, warehouse movements, holds, reservations and serialized units account for stock. One confirmed order references the accepted quote. Pick lists and shipment lines associate items and serials with that order and site. |
| Payments and finance | A quote has checkout attempts and a confirmed order has a payment ledger, invoices and allocations. Provider events reference attempts by gateway order and payment IDs. Actual material costs come from stock issues, labour costs from time entries and rates. Track job margin, collected cash and balance separately. |
| Installation and service | Work orders link a crew to a site and schedule. Commissioning ties evidence, test outcome and sign-off to the installation. Delivered serials carry warranty dates. Tickets link the affected asset to visits, parts, labour, replacements, service invoices and customer confirmation. |
| Operations and reporting | Track subsidy case status, document references, technician pay due and paid, audit events and pending notifications. Admin reports filter by business day, week or month and export the same totals. |

## Delivery checkpoints

Planning allocation for a six-hour session. The deployed backend queues one email for each issued quote and has a Resend delivery worker. Provider configuration and the separate Supabase Auth confirmation test are described in the [backend release handoff](examples/backend-release.md).

| Elapsed time | Deliverable | Evidence |
| --- | --- | --- |
| 0–45 min | Hosted API, versioned schema, login, roles and assignments | Frontend signs in against the hosted environment and calls `GET /v1/me`. Two distinct customers demonstrate record isolation. |
| 45–120 min | Enquiry, site visit, equipment revision, inventory approval, pricing and email | One request traverses three staff identities. Sales cannot change equipment. Customer receives the issued version in a test inbox. |
| 120–195 min | Checkout, verified payment, reservation, order and work creation | Provider test success, decline, repeated notification and competing stock requests leave the expected balances and tasks. |
| 195–265 min | Stock receiving and serial dispatch, delivery, warranty start, technician schedule and commissioning | Trace a serial to its site. Record photos, generation test and customer sign-off. |
| 265–315 min | Service and management reporting | Demonstrate a covered repair, an expired repair invoice, customer closure, subsidy status, time costs, job margin and a matching export. |
| 315–360 min | Frontend integration and mentor rehearsal | Teammates receive a hosted base URL, public auth configuration, role-specific demo access through a private handoff, an OpenAPI contract and a complete sample journey. Verify from a separate browser or client. |

Publish the first working URL and auth contract at the first checkpoint. If provider setup slips, record the blocked external check explicitly and continue with independent modules. Track actual completion against the table.

The guide chat owns discovery and the plan. Solar ERP · Main Build receives the approved scope one milestone at a time.

### First Main Build milestone

Build and deploy the identity and access foundation alongside the legacy schema. Provide customer signup, staff provisioning by admin, separate customer and staff login flows backed by Supabase Auth, and an authenticated `GET /v1/me` returning identity and assigned role. Verify all five roles, an unauthenticated request, a customer attempting to claim a staff role, and two customers accessing their own and each other's profiles. Hand the frontend team the hosted base URL, public auth configuration and one tested sign-in and API example. This milestone can run independently of email delivery and payment credentials.
