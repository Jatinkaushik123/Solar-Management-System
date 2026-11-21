# Bijli Wala SIMS — Backend handover

**Scope:** The multipage HTML, CSS and vanilla JavaScript application in `bijli-wala-sims/`. This handover reflects the working files on 21 November 2026, including `js/auth.js` and `js/store.js`.

## Start here

Open `index.html` for the local demo. For backend integration, serve this folder over HTTP and set `window.BIJLI_API_BASE_URL` before `js/api.js` loads on **every module page**. A shared configuration script is suitable. For example, use `window.BIJLI_API_BASE_URL = "/api/v1";` if the API is served from that prefix on the same origin. The prefix is configurable. An empty value selects the local demo.

The integration point is **`BW.api` in `js/api.js`** (also exposed as `window.solarApi`). Controllers await a mutation, assign its result to `BW.data`, and render from there. Keep the page controllers, DOM rendering and CSS in place when connecting the service.

| Source | Backend relevance |
|---|---|
| `js/data.js` | Exact collection names, field keys, statuses, record prefixes and sample records. |
| `js/store.js` | Required fields, master-list choices, coercion, field locks, kit catalogue and demo subsidy rules. |
| `js/auth.js` | Browser demo identity, role permissions and action gates. |
| `js/api.js` | Fetch contract, local persistence, serial dispatch and warranty history generation. |
| `js/components.js`, `js/pages/*.js` | Record editing, linked workflows, pricing, handover capture, ticket costs and dashboard calculations. |

## HTTP contract already used by the adapter

Use the collection paths **`enquiries`, `surveys`, `quotations`, `projects`, `inventory`, `installations`, `warranty`**. Dashboard charts use these records. Service tickets live inside warranty records.

| Call relative to the configured base | Request | Successful response |
|---|---|---|
| `GET /{collection}` | No body | A bare JSON array, including `[]` when empty. Return all records required by the dashboard, search and filters. |
| `POST /{collection}` | JSON record without an ID | Assign a unique string ID. Return JSON or HTTP 204. |
| `PUT /{collection}/{id}` | JSON record with its existing ID | Save the edit, including supported nested fields. Return JSON or HTTP 204. |
| `POST /inventory/{id}/dispatch` | JSON with `serial` and `project`, where `project` is the destination project ID | Commit the dispatch and any eligible warranty. Return JSON or HTTP 204. |

`list()` requests the seven collections concurrently and returns an object keyed by their title-case module names. Both remote `save()` and `dispatch()` discard the mutation response and call `list()` again. All seven GETs must succeed after a successful write. A 200 or 201 with an empty body causes a JSON parse error; use 204 for an empty success response. The adapter currently displays only the HTTP status on error. To show a server validation message, update the error branch in `request()` to read the error body.

Example dispatch request:

```http
POST /api/v1/inventory/INV-1027/dispatch
Content-Type: application/json

{"serial":"INV-PUNE-00042","project":"PRJ-1028"}
```

For a stocked inverter, the subsequent inventory GET should show one fewer unit and a new `dispatches[]` entry with `serial`, `project` and `date`. The warranty GET should contain the same serial, `sourceId` pointing to the inventory item, `projectId` pointing to the project, and two years of coverage.

## Record compatibility

The UI reads literal keys, including spaces, capitalization and units. Return those keys at the HTTP boundary even if the database uses different column names. Preserve optional fields on round-trip edits. Business dates use `YYYY-MM-DD`; events such as dispatch, ticket opening and handover use timestamps. Monetary fields are in INR rupees.

| Collection | Important wire keys |
|---|---|
| Enquiries · ENQ | `Customer`, `City`, `Capacity (kW)`, `Phone`, `Enquiry date`, `System type`, `Subsidy scheme`. Phone is a string. |
| Surveys · SRV | `Customer`, `City`, `Roof type`, `Survey date`, `Surveyor`, `Roof Direction`, `Grid suitability`. |
| Quotations · QTN | `Customer`, `City`, `Capacity (kW)`, `Amount (₹)`, system and subsidy choices. Preserve `kit`, `bom` and `totals` when present. |
| Projects · PRJ | `Project name`, `City`, `Capacity (kW)`, `Lead engineer`, `Crew lead`, system and subsidy choices, `stage` and `status`. |
| Inventory · INV | `Item name`, `Category`, `Brand`, `Stock (units)`, `Reorder level`, `Unit`, `Unit price (₹)` and `dispatches`. |
| Installations · INS | `Site name`, `City`, `Crew lead`, `Installation date`, `status`, and signed `handover` when present. |
| Warranty · WAR | `Customer`, `Component`, `Serial number`, `Expiry date`, `coverageStart`, `status`, `history` and `tickets`. Dispatch-generated records also carry `coverageYears`, `sourceId` and `projectId`. |

## Workflow rules the service must own

1. **Sales handoffs.** The UI offers Qualified enquiry → survey, Approved survey → quotation, Accepted quotation → project, In progress project → installation and Commissioned installation → warranty. It looks for a downstream record with the matching `sourceId` before opening a new form. Persist that link and guard against duplicate conversions on retry. A warranty's source can also be an inventory dispatch.
2. **Validation and locks.** Mirror the field choices and required values in `js/store.js`. Require positive capacity and a 10-digit Indian mobile number beginning with 6–9 after normalizing spaces and hyphens. Accepted quotation fields are locked. Inventory item name, category and brand lock after dispatch. Component and serial lock on linked warranties. The remote save path bypasses the local validation and coercion routines.
3. **Quote pricing.** The calculator selects equipment from the catalogue, computes quantities, adds installation, and calculates equipment and installation GST separately. `Amount (₹)` stores the rounded grand total **before subsidy**. The displayed net effective cost deducts the applicable subsidy. Preserve the accepted price breakdown. Treat the catalogue and subsidy settings as demo business inputs that require approval before live quoting.
4. **Stock dispatch.** Validate the destination project, positive available stock and serial uniqueness. Trim and uppercase the serial. Check both existing dispatches and warranties. Zero stock produces `Out of stock`; positive stock at or below reorder level produces `Low stock`; otherwise use `In Stock`. Panels/modules receive 20 years, inverters and batteries two years, and other items only a dispatch entry. The local implementation writes stock and warranty separately. Use one database transaction for both and make retries safe.
5. **Installation handover.** Commissioning through the handover form requires a customer name, end time later than start time, a passing generation test, one roof photo, and a drawn or typed signature. The current payload embeds `handover: {customer, date, start, end, generationTest, roofPhoto, signature}` in the installation PUT. The photo and PNG signature are data URLs. If using object storage, coordinate upload limits and adapt the upload and display paths together.
6. **Warranty and service costs.** Tickets are embedded in `Warranty.tickets[]` with `id`, `opened`, `parts`, `labour`, `note` and optional `closed`. Opening sets the warranty to `Claim open`; closing the ticket sets it to `Active`. The current UI evaluates coverage using today's date, an inclusive expiry date and status other than `Closed`. It sums costs across the warranty's tickets: covered shows ₹0 due, expired shows accumulated parts plus labour. **Billing decision:** if invoices must freeze the coverage decision and amount per ticket, agree that change with the frontend team before implementing invoicing.

## Identity and rollout

The current permissions are Admin / Director for all modules and finance, Area Manager for enquiry and quotation writes, Senior Engineer for survey, project, installation and warranty writes, and Warehouse Manager for inventory writes and dispatch. Enforce module and action permissions on the server. Demo identities and browser checks are for exercising the UI. The fetch adapter sends JSON headers and relies on browser-default credentials. A cross-origin credentialed API or bearer-token service needs an explicit integration change. Finance access also needs server-side protection of sensitive values returned in collection reads.

The demo uses browser storage key `bijli-wala.records.v2` and a `window.name` fallback for direct-file navigation. Remote list responses bypass local normalization, so return canonical status spellings and date fields. `BW.api.reset()` clears the local demo snapshot; it has no remote HTTP operation. Agree on whether local records should be imported and how IDs will be reconciled before switching an existing browser to remote mode.

## Acceptance checks for the first connected build

- Load a fresh session against the server. All seven GETs return arrays; dashboard counts, module filters and Ctrl+K search agree on the same records.
- Create an enquiry, reload, edit it, and save. The server-assigned ID survives and the edit affects exactly one row.
- Attempt a restricted write directly with an unauthorized account. The server rejects it even when the request bypasses the UI.
- Dispatch the last inverter twice with the same serial in different casing. Exactly one unit leaves stock and one warranty exists. A failed warranty insert rolls back the stock deduction.
- Verify an accepted quotation retains its original component prices and grand total after catalogue changes.
- Complete a signed installation handover and reopen it after reload. Both the photo and signature display. A failed handover save leaves the installation uncommissioned.
- Check covered and expired serials, save ticket costs, and close a ticket. For an expired warranty with one ticket containing ₹800 parts and ₹350 labour, lookup shows ₹1,150 due.
