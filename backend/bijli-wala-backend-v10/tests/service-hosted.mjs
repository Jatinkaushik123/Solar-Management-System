import assert from "node:assert/strict";
import { API_BASE, PUBLISHABLE_KEY, request, signIn, signOut } from "../examples/identity-client.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const accounts = JSON.parse(Buffer.concat(chunks).toString());
const quotes = JSON.parse(process.env.SOLAR_QA_QUOTES ?? "[]");
assert.equal(quotes.length, 2, "Set both M5 fixture quotes with SOLAR_QA_QUOTES");
const sessions = {};
const customers = ["customer_a", "customer_b"];
const uuid = () => crypto.randomUUID();
const day = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
const period = "?from=" + day + "&to=" + day;
const admin = "admin", tech = "technician", inventory = "inventory";
const api = (role, path, body, key = uuid()) => request(API_BASE + "/v1" + path, {
  token:sessions[role].session.access_token, method:body === undefined ? "GET" : "POST", body,
  idempotencyKey: body === undefined ? undefined : key,
});
const rejected = (op, status, code) => assert.rejects(op, e => e.status === status && (!code || e.code === code));
const report = () => api(admin, "/management/report" + period);
const lookup = (serial) => "/service/equipment?serial=" + encodeURIComponent(serial);
const ticketPath = id => "/service-tickets/" + id;
const check = (label) => { passed++; console.log("PASS " + label); };
let passed = 0;

async function verifyCsv(result) {
  const csv = await fetch(API_BASE+"/v1/management/report.csv"+period,{
    headers:{apikey:PUBLISHABLE_KEY,Authorization:"Bearer "+sessions[admin].session.access_token},
  });
  assert.equal(csv.status,200);
  assert.match(csv.headers.get("content-type"),/^text\/csv/);
  const [header,...rows] = (await csv.text()).trim().split(/\r?\n/);
  assert.equal(header,"from,to,timezone,currency,metric,value");
  const entries = rows.map(row=>{
    const [from,to,z,cc,metric,value]=row.split(",");
    assert.deepEqual([from,to,z,cc],[result.from,result.to,result.timezone,result.currency]);
    return [metric,value];
  });
  assert.deepEqual(Object.fromEntries(entries),Object.fromEntries(Object.entries(result.metrics).map(([k,v])=>[k,String(v)])));
}

async function verifyPreserved(covered, expired) {
  for (const [site,reference] of [[covered,"SVC-1"],[expired,"SVC-2"]]) {
    const {items} = await api(site.owner,"/service-tickets?serial="+encodeURIComponent(site.serial));
    assert.equal(items.length,1);
    assert.equal(items[0].reference,reference);
    const path = ticketPath(items[0].id);
    const ticket = await api(site.owner,path);
    assert.equal(ticket.state,"closed");
    assert.equal(ticket.coverage,site.asset.coverage);
    await rejected(()=>api(site.other,path),404,"ticket_not_found");
    assert.ok(!/unit_cost_paise|hourly_paise|earned_paise|unpaid_paise/.test(JSON.stringify(ticket)));
    if (site === covered) {
      assert.equal(ticket.customer_charge_paise,0);
      assert.equal(ticket.invoice,null);
      assert.equal(ticket.replacement.new_serial,site.asset.replacement_serial);
    } else {
      assert.equal(ticket.invoice.reference,"INV-1");
      assert.equal(ticket.invoice.total_paise,340000);
      assert.equal(ticket.invoice.collected_paise,80000);
      assert.equal(ticket.invoice.remaining_paise,260000);
    }
  }
  await rejected(()=>api(covered.owner,"/management/report"+period),403);
  await verifyCsv(await report());
  check("preserved service fixtures, owner isolation, original invoice, report and CSV");
}

try {
  for (const {label,email,password} of accounts) {
    sessions[label] = await signIn(label.startsWith("customer") ? "customer" : "staff", email, password);
  }
  const sites = await Promise.all(quotes.map(async ({quote}, index) => {
    const owner = customers[index], other = customers[1-index];
    const {order} = await api(owner, "/quotes/" + quote + "/payment");
    const project = await api(owner, "/projects/" + order.id);
    const serial = project.shipment.lines.flatMap(line => line.serials)[0];
    const {items: [asset]} = await api(owner, lookup(serial));
    assert.equal(asset.order_id, order.id);
    assert.deepEqual((await api(other, lookup(serial))).items, []);
    return {owner, other, order, project, serial, asset};
  }));
  const covered = sites.find(s => s.asset.coverage === "covered");
  const expired = sites.find(s => s.asset.coverage === "expired");
  assert.ok(covered && expired);
  assert.equal(covered.project.work_state, "completed");
  assert.equal(expired.project.work_state, "ready_to_schedule");
  if (process.argv.includes("--verify-preserved")) {
    await verifyPreserved(covered, expired);
  } else {
    const before = (await report()).metrics;
    assert.ok(before.jobs_completed >= 1);
    assert.ok(before.jobs_unfinished >= 1);
    assert.ok(BigInt(before.contract_value_paise) > BigInt(before.collected_project_paise));
    await rejected(() => api(covered.owner, "/management/report" + period), 403);
    await rejected(() => api(tech, "/management/report" + period), 403);
    await rejected(() => api(admin, "/management/report?from=" + day + "&to=2000-01-01"), 400, "invalid_period");
    check("fresh covered and expired assets have distinct owners; reporting is admin-only");

    for (const fixture of [covered, expired]) {
      const body = {serial:fixture.serial,fault:"M5 synthetic inverter fault " + uuid()};
      const key = uuid();
      await rejected(() => api(fixture.other, "/service-tickets", body), 404, "equipment_not_found");
      const [first, replay] = await Promise.all([api(fixture.owner,"/service-tickets",body,key),
        api(fixture.owner,"/service-tickets",body,key)]);
      assert.equal(first.id,replay.id);
      assert.equal((await api(fixture.owner,"/service-tickets",body)).id,first.id);
      assert.equal(first.coverage,fixture.asset.coverage);
      assert.equal(first.warranty_id,fixture.asset.warranty_id);
      assert.equal(first.warranty_expires_on,fixture.asset.expires_on);
      await rejected(() => api(fixture.other,ticketPath(first.id)),404,"ticket_not_found");
      assert.deepEqual((await api(fixture.other,"/service-tickets?serial="+encodeURIComponent(fixture.serial))).items,[]);
      await rejected(() => api(tech,ticketPath(first.id)),404,"ticket_not_found");
      const assignment = {technician_id:sessions[tech].me.id};
      await rejected(() => api(fixture.owner,ticketPath(first.id)+"/assignment",assignment),403);
      assert.equal((await api(admin,ticketPath(first.id)+"/assignment",assignment)).state,"assigned");
      assert.equal((await api(tech,ticketPath(first.id))).technician_id,sessions[tech].me.id);
      fixture.ticket = first;
      fixture.path = ticketPath(first.id);
    }
    assert.equal((await report()).metrics.open_service_tickets,before.open_service_tickets+2);
    check("customer retries create one ticket per serial, coverage is captured, and assignment gates technician access");

    const setMaterial = (item_id, unit_cost_paise) => api(admin,"/management/material-rates",{item_id,unit_cost_paise});
    await setMaterial("DEMO-INVERTER",800000);
    await setMaterial("DEMO-PANEL",45000);
    await api(admin,"/management/technician-rates",{technician_id:sessions[tech].me.id,hourly_paise:60000});
    assert.ok((await api(admin,"/management/cost-rates")).technician_rates.some(r=>r.technician_id===sessions[tech].me.id));
    await rejected(() => api(covered.owner,"/management/cost-rates"),403);
    const replacementSerial = "M5-REPLACEMENT-" + uuid();
    await api(inventory,"/inventory/receipts",{item_id:"DEMO-INVERTER",quantity:1,serials:[replacementSerial]});
    const work = {diagnosis:"Synthetic inverter fault isolated",work_performed:"Repaired and verified output",worked_on:day};
    const freeAction = {...work,minutes:45,labour_charge_paise:0,parts:[
      {item_id:"DEMO-INVERTER",quantity:1,unit_charge_paise:0,serials:[replacementSerial]},
    ]};
    await rejected(() => api(tech,covered.path+"/resolution",{...freeAction, labour_charge_paise:1}),409,"covered_charge_forbidden");
    await rejected(() => api(tech,covered.path+"/resolution",{...freeAction,parts:[
      {...freeAction.parts[0],serials:[expired.serial]},
    ]}),409,"serial_unavailable");
    const free = await api(tech,covered.path+"/resolution",freeAction);
    assert.equal(free.customer_charge_paise,0);
    assert.equal(free.invoice,null);
    assert.equal(free.replacement.old_serial,covered.serial);
    assert.equal(free.replacement.new_serial,replacementSerial);
    assert.ok(!(await api(inventory,"/inventory/serials?item_id=DEMO-INVERTER")).items.some(x=>x.serial===replacementSerial));
    const replaced = (await api(covered.owner,lookup(covered.serial))).items[0];
    const replacement = (await api(covered.owner,lookup(replacementSerial))).items[0];
    assert.equal(replaced.state,"replaced");
    assert.equal(replacement.previous_serial,covered.serial);
    assert.equal(replacement.expires_on,covered.asset.expires_on);
    assert.equal(replacement.warranty_id,covered.asset.warranty_id);
    assert.deepEqual((await api(covered.other,lookup(replacementSerial))).items,[]);
    check("covered replacement leaves zero customer charges, one stock issue and the original warranty expiry");

    const billedAction = {...work,minutes:90,labour_charge_paise:90000,parts:[
      {item_id:"DEMO-PANEL",quantity:2,unit_charge_paise:125000,serials:[]},
    ]};
    const billKey=uuid();
    const [bill,replayedBill] = await Promise.all([api(tech,expired.path+"/resolution",billedAction,billKey),
      api(tech,expired.path+"/resolution",billedAction,billKey)]);
    assert.equal(bill.invoice.id,replayedBill.invoice.id);
    assert.equal((await api(tech,expired.path+"/resolution",billedAction)).invoice.id,bill.invoice.id);
    assert.equal(bill.invoice.total_paise,340000);
    assert.equal(bill.invoice.parts_paise,250000);
    assert.equal(bill.invoice.labour_paise,90000);
    const archived = [];
    for (const [fixture, resolved] of [[covered,free],[expired,bill]]) {
      const confirm = {resolution_id:resolved.resolution.id,accepted:true};
      await rejected(() => api(fixture.other,fixture.path+"/confirmation",confirm),404,"ticket_not_found");
      const closed = await api(fixture.owner,fixture.path+"/confirmation",confirm);
      assert.equal(closed.state,"closed");
      assert.equal((await api(fixture.owner,fixture.path+"/confirmation",confirm)).closed_at,closed.closed_at);
      assert.deepEqual(closed.history.map(e=>e.action),["opened","assigned","resolved","confirmed"]);
      assert.ok(!/unit_cost_paise|hourly_paise|earned_paise|unpaid_paise/.test(JSON.stringify(closed)));
      archived.push(closed);
    }
    await rejected(() => api(tech,expired.path+"/resolution",{...billedAction,labour_charge_paise:1}),409,"ticket_locked");
    const payment = {amount_paise:80000,method:"bank",reference:"M5-QA-BANK-"+uuid(),collected_on:day};
    const collected = await api(admin,expired.path+"/payments",payment);
    assert.equal((await api(admin,expired.path+"/payments",payment)).invoice.collected_paise,80000);
    assert.equal(collected.invoice.remaining_paise,260000);
    assert.equal(collected.invoice.id,archived[1].invoice.id);
    assert.equal(collected.invoice.total_paise,archived[1].invoice.total_paise);
    check("expired repair posts one frozen invoice; only owner closes it and partial collection preserves billing");

    const financePath = "/management/projects/" + covered.order.id;
    const source = await api(admin,financePath);
    const installationIssue = source.stock_issues.find(x=>x.kind==="dispatch" && x.item_id==="DEMO-PANEL");
    await api(admin,"/management/material-costs",{movement_id:installationIssue.movement_id,unit_cost_paise:150000});
    const time = await api(tech,"/installations/"+covered.order.work_order_id+"/time",{worked_on:day,minutes:60});
    assert.equal(time.earned_paise,60000);
    assert.equal((await api(tech,"/installations/"+covered.order.work_order_id+"/time",{worked_on:day,minutes:60})).id,time.id);
    const logged = (await api(tech,"/technician/time"+period)).items;
    const payrollEntry = logged.find(t=>t.service_resolution_id===free.resolution.id);
    assert.equal(payrollEntry.earned_paise,45000);
    const payroll = {time_id:payrollEntry.id,amount_paise:20000,reference:"M5-QA-PAY-"+uuid(),paid_on:day};
    await api(admin,"/management/technician-payments",payroll);
    assert.equal((await api(admin,"/management/technician-payments",payroll)).time.unpaid_paise,25000);
    await rejected(() => api(covered.owner,"/technician/time"+period),403);
    await rejected(() => api(covered.owner,financePath),403);
    const subsidy = financePath+"/subsidy";
    const caseRef = "M5-QA-SUBSIDY-"+uuid();
    await rejected(() => api(admin,subsidy,{status:"received",amount_paise:300000,reference:caseRef}),409,"subsidy_transition_invalid");
    for (const status of ["applied","approved","received"]) {
      assert.equal((await api(admin,subsidy,{status,amount_paise:status==="applied"?0:300000,reference:caseRef})).status,status);
    }
    await setMaterial("DEMO-PANEL",46000);
    const records = await Promise.all([covered,expired].map(f=>api(admin,"/management/projects/"+f.order.id)));
    const movementCosts = records.flatMap(p=>p.stock_issues).filter(m=>m.cost).reduce((total,m)=>total+m.cost.total_paise,0);
    const recordedLabour = records.flatMap(p=>p.technician_time).reduce((total,t)=>total+t.earned_paise,0);
    assert.equal(movementCosts,1640000);
    assert.equal(recordedLabour,195000);
    assert.equal(records[0].subsidy_history.length,3);
    assert.equal(records[1].stock_issues.find(x=>x.kind==="service_issue").cost.unit_cost_paise,45000);
    check("admin records project cost, subsidy and pay; recorded costs retain their original rates");

    const result = await report();
    const after = result.metrics;
    const change = name => BigInt(after[name])-BigInt(before[name]);
    for (const [metric, expected] of Object.entries({
      jobs_confirmed:0,jobs_completed:0,jobs_unfinished:0,open_service_tickets:0,service_invoices:1,
      completed_jobs_without_time:-1,unpriced_material_movements:-1,contract_value_paise:0,collected_project_paise:0,
      billed_service_paise:340000,collected_service_paise:80000,collected_paise:80000,outstanding_service_paise:260000,
      outstanding_paise:260000,material_cost_paise:movementCosts,labour_cost_paise:recordedLabour,
      margin_paise:340000-movementCosts-recordedLabour,technician_minutes:195,technician_paid_paise:20000,
      technician_unpaid_paise:175000,subsidy_received:1,subsidy_received_paise:300000,
    })) assert.equal(change(metric),BigInt(expected),metric);
    const previousDay = new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"})
      .format(new Date(Date.now()-86400000));
    assert.equal((await api(admin,"/management/report?from="+previousDay+"&to="+previousDay)).metrics.billed_service_paise,"0");
    await verifyCsv(result);
    check("date-filtered management totals and every CSV metric reconcile to hosted source records");
    console.log(JSON.stringify({passed,day,covered:archived[0].reference,expired:archived[1].reference,
      coveredOrder:covered.project.enquiry_reference,expiredOrder:expired.project.enquiry_reference,
      invoice:bill.invoice.reference,replacementSerial,billed:340000,collections:80000,balance:260000,
      materialCost:movementCosts,labourCost:recordedLabour}));
  }
} finally {
  await Promise.allSettled(Object.values(sessions).map(({session})=>signOut(session.access_token)));
}
