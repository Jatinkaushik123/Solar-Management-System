# Warehouse, projects, installation and warranty

Use the [hosted API base](https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api) and the caller’s Supabase Auth session. The confirmed payment response supplies the order, pick list and installation work order IDs. This workflow uses those records and the exact quantities from the confirmed reservation. [Sign-in and request helper](./identity-client.mjs) · [Checkout handoff](./checkout-workflow.md)

Use `Authorization: Bearer <access token>` and the project’s publishable `apikey`. Send JSON and a UUID `Idempotency-Key` on every API POST. Save the key with the submitted action and reuse it after a network failure. A different body with the same key returns `409 idempotency_conflict`.

## Inventory and projects

| Method and path | Caller and result |
| --- | --- |
| `GET /v1/inventory/items` | Inventory, technician, admin. Existing stock list includes `on_hand`, `held`, `reserved`, `available`, `serialized` and `warranty_months`. |
| `GET /v1/inventory/serials?item_id=DEMO-INVERTER` | Inventory, admin. Returns `{items:[{serial,item_id,receipt_id}]}` for unshipped units of that SKU. Use `after` with the last serial when there are 50 results. |
| `POST /v1/inventory/receipts` | Inventory. Receives one catalogue SKU. Returns a positive stock movement with `id`, `item_id`, `delta`, `actor_id`, `occurred_at` and `serials`. |
| `GET /v1/projects` | Customer sees own; technician sees assigned installations; sales sees assigned sales projects; inventory and admin see all. Returns `{items:[...]}`, up to 50, ordered by UUID. Use `after` with the last item ID. |
| `GET /v1/projects/{order_id}` | Same scope as the list. Returns site, order reference, linked task IDs and states, `pick_lines`, and `shipment` when dispatched. |
| `POST /v1/pick-lists/{pick_list_id}/dispatch` | Inventory. Sends all reserved SKU quantities as one shipment. Returns a shipment with `id`, `pick_list_id`, `state`, `lines`, `dispatched_by` and `dispatched_at`. |
| `POST /v1/shipments/{shipment_id}/delivery` | Inventory. Send `{}`. Returns the same shipment with `state:"delivered"`, `delivered_by` and `delivered_at`. |

This example receives one serialized unit using the scanned label.

```json
{"item_id":"DEMO-INVERTER","quantity":1,"serials":["WAREHOUSE-DEMO-001"]}
```

Send `serials:[]` for a nonserialized SKU. Dispatch uses one line per reserved SKU. This example ships five panels and one inverter.

```json
{
  "lines":[
    {"item_id":"DEMO-INVERTER","quantity":1,"serials":["WAREHOUSE-DEMO-001"]},
    {"item_id":"DEMO-PANEL","quantity":5,"serials":[]}
  ]
}
```

Serials are stored exactly as scanned and unique across this catalogue. Each serialized line requires one valid, unshipped, matching serial per unit. A receipt can include up to 1,000 units. Dispatch supports up to 100 distinct SKUs, matching the equipment design limit. The unshipped serial list includes units that may already contribute to reservations. Use the project’s `pick_lines` to determine what to scan. Dispatch consumes that order’s reservation and decreases on-hand stock by the same quantity, preserving availability for other orders. Repeating the same manifest returns the existing shipment. Delivery starts eligible warranty coverage once, using the date in India and the product’s term in months. `expires_on` is the first day outside coverage. The demo inverter has 60 months and the demo battery has 24 months.

| Operational state | API signal or action |
| --- | --- |
| Ready to pick | `pick_state:"ready_to_pick"`. Inventory scans the approved quantities and serials. |
| Receipt needs correction | `400 invalid_serial_count`, `400 invalid_serial`, `409 duplicate_serial` or `409 serial_already_registered`. |
| Dispatch needs correction | `409 reservation_mismatch`, `409 serial_unavailable` or `409 stock_shortage`. Refresh the project and serial list. |
| Already dispatched | Use the existing shipment when the manifest matches. A different manifest returns `409 already_dispatched`. |
| Dispatched or delivered | Track shipment timestamps. Retrying delivery preserves its original time and warranty dates. |

## Installation and handover

| Method and path | Caller and result |
| --- | --- |
| `GET /v1/installations/{work_order_id}` | Same project scope as above. The owner, assigned technician and admin receive `installation.report` and `installation.signoff` when available. |
| `POST /v1/installations/{work_order_id}/schedule` | Admin. Assign an active technician from `GET /v1/staff/assignees`. Returns the existing work order in `scheduled`. |
| `POST /v1/installations/{work_order_id}/reports` | Assigned technician. Returns `{work_order, report}`; the work order becomes `test_failed` or `awaiting_signoff`. A later passing report can follow a failed report. |
| `POST /v1/installations/{work_order_id}/signoff` | Owning customer. Sends the passing report ID and explicit acceptance. Returns `{work_id,report_id,customer_id,signed_at,state:"completed"}`. |

Schedule with a future date and time with offset.

```json
{"technician_id":"<technician UUID>","scheduled_at":"2026-12-01T09:30:00+05:30"}
```

The technician first uploads each JPEG, PNG or WebP image (up to 8 MiB) to the private `installation-evidence` bucket. Use the object path `{work_order_uuid}/{new_photo_uuid}.png`, with a matching extension and MIME type. Use the session-scoped Storage client. Each object path is write-once.

```js
const path = `${workOrderId}/${crypto.randomUUID()}.png`;
const bucket = supabase.storage.from("installation-evidence");
const { error } = await bucket.upload(path, photoFile, {
  contentType: "image/png", upsert: false,
});
if (error) throw error;

// Download a submitted report's photo using the viewer's authenticated session.
const { data: photo, error: downloadError } = await bucket.download(report.photo_paths[0]);
if (downloadError) throw downloadError;
```

The assigned technician and admin can read photos for the project. The customer can read their attached report photos. Keep download requests authenticated and avoid publishing photo URLs. [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

Submit actual installation times and one to ten uploaded photos.

```json
{
  "started_at":"2026-12-01T09:45:00+05:30",
  "ended_at":"2026-12-01T13:15:00+05:30",
  "system_kw":3.25,
  "generation_test":"pass",
  "photo_paths":["<work-order UUID>/<photo UUID>.png"]
}
```

The customer reads and accepts the passing report with `{"report_id":"<report UUID>","accepted":true}`. Sign-off records their authenticated identity and the exact report. Only this action completes the work order.

| Work state or error | UI handling |
| --- | --- |
| `ready_to_schedule`, `scheduled` | Admin assigns the technician. Technician can upload and submit the report once delivery is recorded. |
| `test_failed` | Show the failed outcome and allow the technician to record a fresh test and report. |
| `awaiting_signoff` | Show the passing report and enable sign-off for the owner. |
| `completed` | Show the signed report with its original acceptance timestamp. |
| `409 delivery_required`, `400 evidence_required`, `409 invalid_evidence` | Check delivery, attach the uploaded project files and retry. |
| `409 signoff_prerequisites`, `409 installation_locked` | Refresh the work order for the passing report or completed state. |
| `409 technician_unavailable` | Refresh the assignee list. |

## Warranties

Use the [warranty service handoff](./service-reporting.md) for owned equipment, replacement history and service tickets.

`GET /v1/warranties?serial=<scanned serial>` finds coverage by exact serial. Omit `serial` to browse up to 50 visible warranties and use `after=<last warranty UUID>` to continue. `GET /v1/warranties/{warranty_id}` reads the individual record. Customers see only their own delivered equipment, technicians see equipment on their assigned jobs, and inventory and admin can search all coverage.

```json
{
  "items":[{
    "id":"<warranty UUID>",
    "serial":"WAREHOUSE-DEMO-001",
    "item_id":"DEMO-INVERTER",
    "order_reference":"ORD-<order UUID>",
    "term_months":60,
    "starts_on":"2026-12-01",
    "expires_on":"2031-12-01",
    "state":"active"
  }]
}
```

All successful API operations return 200. Handle 401 by refreshing the session. A disallowed role receives 403. An unknown or inaccessible project, installation or direct warranty ID receives 404. Searches return an empty list when the caller has no matching record.

## Rehearse on the hosted API

With Test Mode unconfigured, run the [hosted checkout check](../tests/checkout-hosted.mjs) with `SOLAR_QA_SITE` set to `M4 synthetic fulfilment <fresh identifier>` and `SOLAR_QA_QUOTES` unset. Pipe in the existing synthetic account array from the [identity handoff](./README.md). Confirm that the checkout-unavailable check passed. An operator then sets `solar.qa_quotes` to the two returned quote UUIDs as a PostgreSQL UUID array and runs the [trusted SQL setup](../tests/fulfilment-hosted-setup.sql) in the same request. This creates two expressly synthetic confirmed orders with the real reservation and task records.

Set `SOLAR_QA_QUOTES` to the JSON array printed by the checkout check. Pipe the same account array to `node --use-system-ca tests/fulfilment-hosted.mjs`. The hosted checks use distinct role sessions and print the completed order reference, work order and warranty. [Hosted fulfilment checks](../tests/fulfilment-hosted.mjs)

The hosted fixture for ENQ-30 completed as `ORD-bd51d9dd-6f10-4772-8338-55e64a85f8a6`. Its companion ENQ-31 tested a competing scan, then shipped with a second serial. To verify the completed fixture and safely replay dispatch, delivery and sign-off after a deployment, rerun the test with those same quote UUIDs and `--verify-completed`.
