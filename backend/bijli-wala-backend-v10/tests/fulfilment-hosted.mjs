import assert from "node:assert/strict";
import { API_BASE, SUPABASE_URL, PUBLISHABLE_KEY, request, signIn, signOut } from "../examples/identity-client.mjs";

const bytes = [];
for await (const part of process.stdin) bytes.push(part);
const accounts = JSON.parse(Buffer.concat(bytes).toString());
const quotes = JSON.parse(process.env.SOLAR_QA_QUOTES ?? "[]");
assert.equal(quotes.length, 2, "Supply the two synthetic confirmed quotes through SOLAR_QA_QUOTES");
const sessions = {};
const who = ["customer_a", "customer_b"];
const uuid = () => crypto.randomUUID();
const sku = "DEMO-INVERTER";
const id = uuid();
const serials = ["M4-" + id, "M4-" + id + "-ALT"];
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=", "base64");
const api = (role, path, body, key = uuid()) => request(API_BASE + "/v1" + path, {
  token: sessions[role].session.access_token, method: body === undefined ? "GET" : "POST",
  body, idempotencyKey: body === undefined ? undefined : key,
});
const rejected = (operation, status, code) => assert.rejects(operation, error => error.status === status && (!code || error.code === code));
const stock = async () => (await api("inventory", "/inventory/items")).find(({item_id}) => item_id === sku);
const picked = (project, serial) => ({ lines: project.pick_lines.map(({item_id, quantity, serialized}) => ({
  item_id, quantity, serials: serialized ? [serial] : [],
})) });
const bucket = "installation-evidence";
const storage = (role, path, action, flags = {}) => fetch(
  SUPABASE_URL + "/storage/v1/object/" + (action === "get" ? "authenticated/" : action === "public" ? "public/" : "") + bucket + "/" + path,
  { method: action === "upload" ? "POST" : "GET",
    headers: { apikey: PUBLISHABLE_KEY, ...(role ? { Authorization: "Bearer " + sessions[role].session.access_token } : {}),
      ...(action === "upload" ? { "Content-Type": "image/png" } : {}), ...flags },
    body: action === "upload" ? image : undefined },
);
async function storageDenied(response) {
  const reply = await response;
  const reason = await reply.text();
  assert.ok([400, 401, 403, 404].includes(reply.status), `Expected Storage denial, got ${reply.status}: ${reason}`);
}
let passed = 0;
function check(label) { passed++; console.log("PASS " + label); }

try {
  for (const {label,email,password} of accounts) sessions[label] = await signIn(label.startsWith("customer") ? "customer" : "staff", email, password);
  const payments = await Promise.all(quotes.map(({quote}, i) => api(who[i], "/quotes/" + quote + "/payment")));
  for (const payment of payments) { assert.equal(payment.state, "confirmed"); assert.equal(payment.gateway_available, false); }
  const projects = await Promise.all(payments.map(({order}, i) => api(who[i], "/projects/" + order.id)));
  if (process.argv.includes("--verify-completed")) {
    const index = projects.findIndex(p => p.work_state === "completed");
    assert.notEqual(index, -1, "A completed rehearsal order is required");
    const done = projects[index], owner = who[index], other = who[1-index];
    const install = "/installations/" + done.work_order_id;
    const {report, signoff} = done.installation;
    const shipment = done.shipment;
    assert.equal(shipment.id, done.shipment_id);
    assert.ok(signoff.signed_at && shipment.delivered_at);
    if (!process.argv.includes("--read-only")) {
      assert.equal((await api("inventory", "/pick-lists/" + done.pick_list_id + "/dispatch", {lines: shipment.lines})).id, shipment.id);
      assert.equal((await api("inventory", "/shipments/" + shipment.id + "/delivery", {})).delivered_at, done.delivered_at);
      assert.deepEqual(await api(owner, install + "/signoff", {report_id:report.id, accepted:true}), {...signoff,state:"completed"});
    }
    const serial = shipment.lines.flatMap(line => line.serials)[0];
    const query = "/warranties?serial=" + encodeURIComponent(serial);
    assert.equal((await api(owner, query)).items[0].order_id, done.id);
    assert.deepEqual((await api(other, query)).items, []);
    assert.ok((await storage(owner, report.photo_paths[0], "get")).ok);
    await storageDenied(storage(other, report.photo_paths[0], "get"));
    console.log("PASS completed order, shipment, warranty, sign-off and evidence persisted for " + done.reference);
  } else {
    for (let i = 0; i < projects.length; i++) {
      assert.equal(projects[i].work_order_id, payments[i].order.work_order_id);
      assert.equal(projects[i].pick_list_id, payments[i].order.pick_list_id);
      assert.equal(projects[i].work_state, "ready_to_schedule");
      assert.ok((await api(who[i], "/projects")).items.some(p => p.id === projects[i].id));
      await rejected(() => api(who[1-i], "/projects/" + projects[i].id), 404);
    }
    check("operator-created confirmed orders reuse both milestone 3 tasks and are owner-scoped");

    const before = await stock();
    const receiptInput = { item_id: sku, quantity: 2, serials };
    const receiptKey = uuid();
    await rejected(() => api("customer_a", "/inventory/receipts", receiptInput), 403);
    await rejected(() => api("inventory", "/inventory/receipts", {...receiptInput, quantity: 1}), 400, "invalid_serial_count");
    const receipts = await Promise.all([api("inventory","/inventory/receipts",receiptInput,receiptKey),
      api("inventory","/inventory/receipts",receiptInput,receiptKey)]);
    assert.equal(receipts[0].id, receipts[1].id);
    await rejected(() => api("inventory", "/inventory/receipts", receiptInput), 409, "serial_already_registered");
    const afterReceipt = await stock();
    assert.equal(afterReceipt.on_hand, before.on_hand + 2);
    assert.equal(afterReceipt.available, before.available + 2);
    assert.equal(afterReceipt.reserved, before.reserved);
    const available = (await api("inventory", "/inventory/serials?item_id=" + sku)).items;
    assert.ok(available.some(row => row.serial === serials[0] && row.receipt_id === receipts[0].id));
    check("serialized receipt is inventory-only, idempotent and visible in available stock");

    const dispatch = projects.map(p => "/pick-lists/" + p.pick_list_id + "/dispatch");
    const manifests = projects.map(p => picked(p, serials[0]));
    await rejected(() => api("inventory", dispatch[0], {lines: manifests[0].lines.slice(0, 1)}), 409, "reservation_mismatch");
    await rejected(() => api("inventory", dispatch[0], picked(projects[0], "UNKNOWN-" + id)), 409, "serial_unavailable");
    assert.equal((await stock()).on_hand, afterReceipt.on_hand);
    const keys = [uuid(), uuid()];
    const attempts = await Promise.allSettled(manifests.map((body, i) => api("inventory", dispatch[i], body, keys[i])));
    const winner = attempts.findIndex(r => r.status === "fulfilled");
    assert.notEqual(winner, -1, JSON.stringify(attempts.map(r => r.reason?.message)));
    const loser = 1 - winner;
    assert.equal(attempts[loser].status, "rejected");
    assert.equal(attempts[loser].reason.code, "serial_unavailable");
    const shipment = attempts[winner].value;
    const project = projects[winner], owner = who[winner], other = who[loser];
    const retries = await Promise.all([api("inventory", dispatch[winner], manifests[winner], keys[winner]),
      api("inventory", dispatch[winner], manifests[winner])]);
    for (const retry of retries) assert.equal(retry.id, shipment.id);
    const afterDispatch = await stock();
    assert.equal(afterDispatch.on_hand, afterReceipt.on_hand - 1);
    assert.equal(afterDispatch.reserved, afterReceipt.reserved - 1);
    assert.equal(afterDispatch.available, afterReceipt.available);
    check("partial and wrong-serial dispatch roll back; competing orders and retries issue the serial once");

    const altShipment = await api("inventory", dispatch[loser], picked(projects[loser], serials[1]));
    await api("inventory", "/shipments/" + altShipment.id + "/delivery", {});
    const install = "/installations/" + project.work_order_id;
    const scheduled = await api("admin", install + "/schedule", {
      technician_id: sessions.technician.me.id, scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(scheduled.state, "scheduled");
    assert.equal((await api("technician", install)).technician_id, sessions.technician.me.id);
    const photo = project.work_order_id + "/" + uuid() + ".png";
    const upload = await storage("technician", photo, "upload");
    assert.ok(upload.ok, await upload.text());
    await storageDenied(storage(owner, photo, "get"));
    await storageDenied(storage("technician", projects[loser].work_order_id + "/" + uuid() + ".png", "upload"));
    await storageDenied(storage("technician", photo, "upload", {"x-upsert": "true"}));
    const report = { started_at: new Date(Date.parse(project.confirmed_at) + 1).toISOString(), ended_at: new Date().toISOString(),
      system_kw: 3.25, generation_test: "pass", photo_paths: [photo] };
    await rejected(() => api("technician", install + "/reports", report), 409, "delivery_required");
    await rejected(() => api(owner, install + "/signoff", { accepted: true, report_id: uuid() }), 409, "signoff_prerequisites");
    check("admin schedules an existing work order and installation and sign-off wait for delivery");

    const delivery = "/shipments/" + shipment.id + "/delivery";
    const delivered = await api("inventory", delivery, {});
    const warrantyList = "/warranties?serial=" + encodeURIComponent(serials[0]);
    const { items: [warranty] } = await api(owner, warrantyList);
    assert.equal(warranty.serial, serials[0]); assert.equal(warranty.order_id, project.id);
    assert.equal(warranty.term_months, 60);
    assert.equal(warranty.state, "active");
    assert.ok(warranty.expires_on > warranty.starts_on);
    assert.equal((await api("inventory", delivery, {})).delivered_at, delivered.delivered_at);
    assert.deepEqual((await api(owner, warrantyList)).items, [warranty]);
    assert.equal((await api("technician", warrantyList)).items[0].id, warranty.id);
    assert.equal((await api("inventory", warrantyList)).items[0].id, warranty.id);
    assert.deepEqual((await api(other, warrantyList)).items, []);
    await rejected(() => api(other, "/warranties/" + warranty.id), 404);
    check("delivery retry preserves one warranty and its dates; warranty lookup is owner and role-scoped");

    await rejected(() => api("technician", install + "/reports", {...report,photo_paths: []}), 400, "evidence_required");
    await rejected(() => api("technician", install + "/reports", {...report,photo_paths: [photo.replace(".png", ".jpg")]}), 409, "invalid_evidence");
    const failed = await api("technician", install + "/reports", {...report,generation_test: "fail"});
    assert.equal(failed.work_order.state, "test_failed");
    await rejected(() => api(owner, install + "/signoff", { accepted: true, report_id: failed.report.id }), 409, "signoff_prerequisites");
    const passedReport = await api("technician", install + "/reports", report);
    assert.equal(passedReport.work_order.state, "awaiting_signoff");
    for (const role of [owner, "technician", "admin"]) {
      const photoResponse = await storage(role, photo, "get");
      assert.ok(photoResponse.ok, `Expected evidence download for ${role}, got ${photoResponse.status}`);
      assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()), image);
    }
    await storageDenied(storage(other, photo, "get"));
    await storageDenied(storage("inventory", photo, "get"));
    await storageDenied(storage(null, photo, "public"));
    await storageDenied(storage(owner, project.work_order_id + "/" + uuid() + ".png", "upload"));
    await rejected(() => api(other, install), 404);
    check("required photo and passing test gate completion; Storage authorizes only project evidence readers");

    const signature = { accepted: true, report_id: passedReport.report.id };
    await rejected(() => api(other, install + "/signoff", signature), 404);
    await rejected(() => api(owner, install + "/signoff", { ...signature, report_id: failed.report.id }), 409, "signoff_prerequisites");
    const signed = await api(owner, install + "/signoff", signature);
    const repeat = await api(owner, install + "/signoff", signature);
    assert.equal(signed.state, "completed"); assert.deepEqual(repeat, signed);
    const finished = await api(owner, "/projects/" + project.id);
    assert.equal(finished.work_state, "completed");
    assert.equal(finished.installation.signoff.signed_at, signed.signed_at);
    assert.equal(finished.installation.report.id, passedReport.report.id);
    check("only the owner can sign the passing revision; retry preserves the completed handover");
    console.log(JSON.stringify({passed, order: finished.reference, enquiry: finished.enquiry_reference,
      shipment_id: shipment.id, work_order_id: project.work_order_id, warranty_id: warranty.id,
      serial: warranty.serial, warranty_starts_on: warranty.starts_on, warranty_expires_on: warranty.expires_on,
      competing_order: projects[loser].reference}));
  }
} finally {
  await Promise.allSettled(Object.values(sessions).map(({session}) => signOut(session.access_token)));
}
