# Warranty service and management reporting

Use the [hosted API base](https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api) and the signed-in user’s session. Send the publishable `apikey` and `Authorization: Bearer <access token>`. Every JSON POST requires a UUID `Idempotency-Key`. Reuse the key and payload when retrying the same action. [Sign-in and request helper](./identity-client.mjs) · [Warehouse and installation handoff](./fulfilment-workflow.md)

## Service and warranty

| Method and path | Caller and result |
| --- | --- |
| `GET /v1/service/equipment?serial=<serial>` | Customer sees own delivered units, technician sees assigned units, inventory and admin see all. Returns `{items:[...]}` with order and warranty IDs, coverage dates and any predecessor or replacement serial. Omit `serial` to browse. |
| `GET /v1/service-tickets?serial=<serial>` | Owner, assigned technician or admin. Returns `{items:[...]}` with ticket summaries. Filter by exact serial or omit it to list all visible tickets. |
| `GET /v1/service-tickets/{ticket_id}` | Same scope. Includes state, warranty snapshot, resolution, invoice, replacement and actor-stamped history. |
| `POST /v1/service-tickets` | Customer. Opens a ticket for their own delivered serial. Returns the ticket and its coverage snapshot. |
| `POST /v1/service-tickets/{ticket_id}/assignment` | Admin. Assigns an active technician or changes the assignment before resolution. |
| `POST /v1/service-tickets/{ticket_id}/resolution` | Assigned technician. Records diagnosis, repair, parts and time and freezes customer billing. |
| `POST /v1/service-tickets/{ticket_id}/confirmation` | Owner. Confirms the exact resolution and closes the ticket. |
| `POST /v1/service-tickets/{ticket_id}/payments` | Admin. Records an actual bank or cash receipt against the invoice. Returns the updated invoice and balance on the ticket. |

Both list endpoints return up to 50 items. For the next page, pass `after` with the last serial for equipment or the last ticket UUID for tickets. Equipment with a replacement retains its history. The successor keeps the original warranty dates. Customers open subsequent tickets on the successor serial.

Opening a ticket derives ownership and the linked order from the serial. Coverage is fixed using the India business date of opening. The start date is inclusive and the expiry date is exclusive. Covered work has `customer_charge_paise:0` and `invoice:null`. Expired or uncovered work posts one invoice. Ticket detail includes part quantities, customer charges and invoice collections. Company rates, cost and pay are only available through the authorized internal routes.

```json
{"serial":"DEMO-INVERTER-SERIAL","fault":"The inverter shuts off after start-up."}
```

Admin assigns with `{"technician_id":"<technician UUID>"}`. The assigned technician finalizes work with the body below. Use `parts:[]` when the work takes no stock. Nonserialized parts use `serials:[]`. A serialized replacement uses one available serial of the original SKU. Covered repairs require zero part and labour charges.

```json
{
  "diagnosis":"Contactor fault",
  "work_performed":"Replaced the affected parts and verified output.",
  "worked_on":"2026-11-22",
  "minutes":90,
  "labour_charge_paise":90000,
  "parts":[{"item_id":"DEMO-PANEL","quantity":2,"unit_charge_paise":125000,"serials":[]}]
}
```

This billable example posts 340,000 paise. Confirm with `{"resolution_id":"<resolution UUID>","accepted":true}`. If an 80,000-paise payment is actually received, admin can record `{"amount_paise":80000,"method":"bank","reference":"BANK-RECEIPT-123","collected_on":"2026-11-22"}`. The remaining balance is 260,000 paise.

| State or error | UI behavior |
| --- | --- |
| `open`, `assigned`, `awaiting_confirmation`, `closed` | Show assignment, repair, owner confirmation or archived billing as appropriate. |
| `409 active_ticket_exists`, `409 equipment_replaced` | Open the existing ticket or load the replacement serial. |
| `409 stock_shortage`, `409 serial_unavailable`, `409 replacement_sku_mismatch` | Refresh availability and correct the issue or replacement serial. Reserved and held stock is excluded from service availability. |
| `409 material_rate_required`, `409 technician_rate_required` | An admin records the missing internal rate before finalization. |
| `409 covered_charge_forbidden` | Set customer-facing labour and part charges to zero. |
| `409 ticket_locked`, `409 resolution_required` | Reload the ticket and its finalized resolution. Posted charges and closure time are retained on retries. |
| `409 invoice_required`, `409 payment_exceeds_balance`, `409 payment_reference_conflict` | Check the invoice, receipt reference and outstanding amount before recording collection. |

## Management, subsidy and technician time

| Method and path | Caller and request or result |
| --- | --- |
| `GET /v1/management/report?from=YYYY-MM-DD&to=YYYY-MM-DD` | Admin. Returns a period and a `metrics` object. |
| `GET /v1/management/report.csv?from=YYYY-MM-DD&to=YYYY-MM-DD` | Admin. Same metrics with `Content-Type: text/csv` and one row per metric. Download with authenticated fetch. |
| `GET /v1/management/projects/{order_id}` | Admin. Traces stock issues and their costs, subsidy history, and technician entries and pay for one order. |
| `GET /v1/management/cost-rates` | Admin. Lists current material and technician cost rates. |
| `POST /v1/management/material-rates` | Admin. `{"item_id":"DEMO-INVERTER","unit_cost_paise":800000}`. Future issues snapshot the rate. |
| `POST /v1/management/material-costs` | Admin. `{"movement_id":"<stock movement UUID>","unit_cost_paise":150000}`. Posts verified cost for an issue with no recorded cost. |
| `POST /v1/management/technician-rates` | Admin. `{"technician_id":"<technician UUID>","hourly_paise":60000}`. Future entries snapshot the rate. |
| `POST /v1/installations/{work_order_id}/time` | Assigned technician. `{"worked_on":"2026-11-22","minutes":60}`. Attaches one entry to the signed installation report. Service minutes come from the finalized repair. |
| `GET /v1/management/time`, `GET /v1/technician/time` | Admin sees all entries, technicians see their own. Optional `from`, `to` and `after=<time UUID>`. Returns `{items:[...]}` with minutes and earned, paid and unpaid paise. |
| `POST /v1/management/technician-payments` | Admin. `{"time_id":"<time entry UUID>","amount_paise":20000,"reference":"PAY-123","paid_on":"2026-11-22"}`. Records payout against earned pay. |
| `POST /v1/management/projects/{order_id}/subsidy` | Admin. `{"status":"applied","amount_paise":0,"reference":"SUB-123"}`. Progresses to `approved` or `rejected`, then from `approved` to `received`. Approved and received amounts are positive. |

On protected routes, 401 means reauthenticate, 403 means role denied and 404 hides inaccessible records. Use a new UUID for a separate mutation if a reused key produces `409 idempotency_conflict`. A management filter with invalid dates returns 400. A signed installation is required to log installation time. Locked cost or time entries and invalid subsidy transitions return 409.

### Report calculations

The inclusive `from` and `to` are calendar days in Asia/Kolkata. The CSV columns are `from,to,timezone,currency,metric,value`. JSON uses integer strings for paise totals so JavaScript clients retain precision. Counts and minutes are numbers. Use daily, weekly or monthly ranges with the same endpoints.

| Report measure | Source and date basis |
| --- | --- |
| `jobs_confirmed`, `contract_value_paise` | Confirmed orders and frozen quote totals, by order confirmation date. |
| `jobs_completed`, `completed_contract_value_paise` | Customer sign-offs and the corresponding contract value, by sign-off date. |
| `jobs_unfinished`, `open_service_tickets` | All confirmed jobs without sign-off and tickets without closure as of the end of `to`, including carry-over work. |
| `billed_service_paise` | Immutable service invoice totals posted in the period. Installation contract value has its own fields. |
| `collected_paise` | Verified project payment credits by credit date plus recorded service cash and bank receipts by receipt date. The separate project and service amounts are also returned. |
| `outstanding_paise` | End-of-period confirmed contract balances plus posted service invoice balances, net of receipts dated through `to`. |
| `material_cost_paise` | Recorded unit issue cost × issued quantity, by cost posting date. `unpriced_material_movements` counts issues in the date window that lacked a cost by its end. |
| `labour_cost_paise`, `technician_minutes` | Time entries by work date. Earned paise are rounded once per entry from minutes × hourly paise ÷ 60. See `completed_jobs_without_time` when installation entries are missing. |
| `technician_paid_paise`, `technician_unpaid_paise` | Payouts by paid date and earned pay less payouts through `to`. Backdated receipts, time, or payouts appear on their recorded business dates. |
| `subsidy_*` | Latest order status as of the period end and subsidy receipts posted in the period. These are tracked separately from customer collections. |
| `margin_paise` | Completed contract value + posted service bills − recorded material cost − earned labour cost. This is an operating measure based on recorded costs and excludes subsidy, tax and overhead. |

### Hosted rehearsal

The [hosted test](../tests/service-hosted.mjs) takes two fresh synthetic quote IDs in `SOLAR_QA_QUOTES` and the same synthetic credentials array used by the checkout and fulfilment tests. Complete handover on one and deliver the other using the [fulfilment rehearsal](./fulfilment-workflow.md) with fresh sites labelled `M5 synthetic service <identifier>`. A trusted operator runs the [expired-warranty fixture](../tests/service-hosted-expired.sql) on the delivered companion quote. The API exercise then tests both warranty outcomes, closure, source totals and CSV parity.

The hosted rehearsal used ENQ-37 / SVC-1 for the covered replacement and ENQ-38 / SVC-2 for the expired repair. INV-1 retained 340,000 paise billed, 80,000 collected and 260,000 outstanding after closure. The report and CSV both reflected 1,640,000 paise of recorded material costs and 195,000 paise of earned labour from the rehearsal, including the installation entries. All records in this rehearsal are synthetic.
