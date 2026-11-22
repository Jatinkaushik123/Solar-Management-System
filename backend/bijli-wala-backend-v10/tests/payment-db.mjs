import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";

const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = await import(pathToFileURL(require.resolve("embedded-postgres")));
const { Pool } = require("pg");
const free = createServer();
await new Promise(ok => free.listen(0,"127.0.0.1",ok));
const port = free.address().port;
await new Promise(ok => free.close(ok));
const cluster = new EmbeddedPostgres({databaseDir:await mkdtemp(join(tmpdir(),"solar-m3-")),port,
  user:"postgres",password:crypto.randomUUID(),persistent:false,onLog:()=>{},onError:()=>{}});
await cluster.initialise();
await cluster.start();
const original = cluster.getPgClient();
const pool = new Pool(original.connectionParameters);
const db = (sql, args=[]) => pool.query(sql,args);
const uuid = () => crypto.randomUUID();
async function rpc(name, args) {
  const values = Object.values(args);
  const names = Object.keys(args);
  assert.match(name,/^solar_[a-z_]+$/);
  assert.ok(names.every(key=>/^[a-z_]+$/.test(key)));
  const statement = 'select public.'+name+'('+names.map((k,i)=>k+' => $'+(i+1)).join(',')+') result';
  return (await db(statement,values)).rows[0].result;
}
async function check(name,work) { await work(); console.log("PASS "+name); }

// New accepted fixtures with independent owners and stock. SQL uses the real quote
// schema and foreign keys. Supabase Auth is represented only at its database boundary.
async function fixture(item,quantity=1,lines=[{item_id:item,quantity,name:item,unit_paise:16500000}]) {
  const user=uuid(), site=uuid(), enquiry=uuid(), quote=uuid(), approval=uuid();
  await db("insert into auth.users(id,email) values($1,$2)",[user,user+"@example.test"]);
  await db("insert into solar_private.sites(id,owner_id,address) values($1,$2,'M3 test roof')",[site,user]);
  await db(`insert into solar_private.enquiries(id,customer_id,site_id,contact_email,recipient_email,requirements,roof_space_m2,monthly_bill_paise,grid_details,state,revision)
    values($1,$2,$3,'demo@example.test','demo@example.test','Fixture',40,450000,'grid','accepted',1)`,[enquiry,user,site]);
  await db("insert into solar_private.designs values($1,1,now(),'South',20,10,$2,now())",[enquiry,user]);
  await db("insert into solar_private.equipment_lines select $1,1,l.item_id,l.quantity from jsonb_to_recordset($2::jsonb) l(item_id text, quantity integer)",
    [enquiry,JSON.stringify(lines)]);
  await db("insert into solar_private.stock_checks(id,enquiry_id,revision,actor_id,outcome,lines) values($1,$2,1,$3,'approved','[]')",[approval,enquiry,user]);
  await db(`insert into solar_private.quotes(id,enquiry_id,design_revision,stock_check_id,revision,state,lines,total_paise,advance_paise,issued_at,decided_at)
      values ($1,$2,1,$3,1,'accepted',$4,16500000,3300000,now(),now())`,[quote,enquiry,approval,JSON.stringify(lines)]);
  return {user,quote,enquiry};
}
const start=(f,choice="advance",k=uuid())=>rpc("solar_checkout_begin",{actor:f.user,target:f.quote,choice,k});
let serviceFixture;
try {
  await db(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text,metadata jsonb);
    alter table storage.objects enable row level security;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),is_anonymous boolean default false,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('test.session',true))$$;`);
  for(const file of (await readdir("supabase/migrations")).filter(f=>f.endsWith(".sql")).sort()) {
    await db(await readFile(join("supabase/migrations",file),"utf8"));
  }
  await db("insert into solar_private.stock_items values('QA-LAST','Last demo inverter',1,16500000)");
  const a=await fixture("QA-LAST"), b=await fixture("QA-LAST");
  let winner, loser, first;
  await check("two customers compete for one inverter and the winner reuses one hold",async()=>{
    const outcomes=await Promise.allSettled([start(a),start(b)]);
    const successes=outcomes.filter(x=>x.status==="fulfilled");
    if(successes.length===0) throw outcomes[0].reason;
    assert.equal(successes.length,1);
    assert.equal(outcomes.find(x=>x.status==="rejected").reason.message,"stock_shortage");
    const i=outcomes.findIndex(x=>x.status==="fulfilled");
    winner=[a,b][i]; loser=[b,a][i]; first=outcomes[i].value;
    assert.equal(first.amount_paise,3300000);assert.equal(first.create_order,true);
    const key=uuid();
    const retries=await Promise.all([start(winner,"advance",key),start(winner,"advance",key)]);
    for(const retry of retries){assert.equal(retry.id,first.id);assert.equal(retry.create_order,false);}
    await assert.rejects(()=>start(winner,"full",key),/idempotency_conflict/);
    assert.equal((await db("select available from solar_private.stock_availability where item_id='QA-LAST'")).rows[0].available,0);
  });
  const bind=(c,order)=>rpc("solar_checkout_bind",{target:c.id,provider_order:order,public_key:"rzp_test_fixture"});
  const snap=(order,payment,amount,status="captured")=>({orderId:order,paymentId:payment,amountPaise:amount,status,currency:"INR"});
  const observe=(target,event_id,snapshot)=>rpc("solar_payment_observe",{target,event_id,snapshot});
  const summary=f=>rpc("solar_payment_read",{actor:f.user,target:f.quote});
  await check("duplicate captures and late authorization leave one advance receipt, order, pick list and installation",async()=>{
    await bind(first,"order_first");
    assert.equal((await start(winner)).provider_order_id,"order_first");
    await assert.rejects(()=>rpc("solar_payment_read",{actor:loser.user,target:winner.quote}),/quote_not_found/);
    const capture=snap("order_first","pay_first",3300000);
    await Promise.all([observe(first.id,null,capture), observe(null,"evt-first",capture), observe(null,"evt-first",capture)]);
    await observe(null,"evt-authorized-late",{...capture,status:"authorized"});
    const result=await summary(winner);
    assert.equal(result.state,"confirmed"); assert.equal(result.collected_paise,3300000); assert.equal(result.remaining_paise,13200000);
    assert.equal(result.receipts.length,1);assert.ok(result.order.pick_list_id);assert.ok(result.order.work_order_id);
    assert.deepEqual(result.choices,["full"]);
    const balance=await start(winner,"full");assert.equal(balance.amount_paise,13200000);
    await bind(balance,"order_balance");await observe(balance.id,null,snap("order_balance","pay_balance",13200000));
    const full=await summary(winner);assert.equal(full.remaining_paise,0);assert.equal(full.receipts.length,2);
    assert.deepEqual(full.order,result.order);assert.deepEqual(full.choices,[]);
    assert.equal((await db("select reserved from solar_private.stock_availability where item_id='QA-LAST'")).rows[0].reserved,1);
  });
  await db("insert into solar_private.stock_items values('QA-LATE','Late capture kit',1,100),('QA-FAIL','Rollback kit',2,100)");
  const old=await fixture("QA-LATE"), next=await fixture("QA-LATE");
  await check("expired stock is released; a late full capture is receipted and reconciled after the other hold expires",async()=>{
    const attempt=await start(old,"full");await bind(attempt,"order_late");
    await db("update solar_private.checkout_attempts set expires_at=now()-interval '1 second' where id=$1",[attempt.id]);
    const active=await start(next);assert.equal(active.create_order,true);
    const capture=snap("order_late","pay_late",16500000);
    const delayed=await observe(null,"evt-late",capture);
    assert.equal(delayed.state,"under_review");assert.equal(delayed.collected_paise,16500000);assert.equal(delayed.order,null);
    await db("update solar_private.checkout_attempts set expires_at=now()-interval '1 second' where id=$1",[active.id]);
    const recovered=await observe(null,"evt-late",capture);
    assert.equal(recovered.state,"confirmed");assert.equal(recovered.receipts.length,1);assert.equal(recovered.remaining_paise,0);
  });
  await check("work-order insertion failure rolls back receipt, order, reservation, event and pick list; retry completes all",async()=>{
    const f=await fixture("QA-FAIL"),c=await start(f,"full");await bind(c,"order_rollback");
    const capture=snap("order_rollback","pay_rollback",16500000);
    await db(`create function public.qa_fail_work() returns trigger language plpgsql as $$begin raise exception 'injected work-order failure';end$$;
      create trigger qa_failure before insert on solar_private.installation_work_orders for each row execute function public.qa_fail_work()`);
    await assert.rejects(()=>observe(c.id,"evt-rollback",capture),/injected work-order failure/);
    const pending=await summary(f);assert.equal(pending.order,null);assert.equal(pending.collected_paise,0);
    assert.equal((await db("select count(*)::int n from solar_private.gateway_events where event_id='evt-rollback'")).rows[0].n,0);
    assert.equal((await db("select count(*)::int n from solar_private.sales_orders where quote_id=$1",[f.quote])).rows[0].n,0);
    await db("drop trigger qa_failure on solar_private.installation_work_orders");
    const ok=await observe(c.id,"evt-rollback",capture);assert.ok(ok.order.pick_list_id);assert.ok(ok.order.work_order_id);
  });
  await check("wrong amount, currency, or stored order creates no credit",async()=>{
    const f=await fixture("QA-FAIL"), c=await start(f);await bind(c,"order_wrong");
    for(const [idx,patch] of [{amountPaise:12},{currency:"USD"},{orderId:"order_another"}].entries()){
      const result=await observe(c.id,null,{...snap("order_wrong","pay_bad"+idx,3300000),...patch});
      assert.equal(result.state,"under_review");assert.equal(result.collected_paise,0);assert.equal(result.order,null);
    }
  });
  await check("the checkout handler uses the gateway once across retries and verifies the callback and signed raw webhook",async()=>{
    const {runGatewayJourney}=await import("./payment-gateway-scenario.mjs");
    await runGatewayJourney({fixture,rpc,db,uuid});
  });
  await check("a worker claims a delayed provider lookup only once; captured facts finish the existing attempt",async()=>{
    await db("insert into solar_private.stock_items values('QA-JOB','Delayed capture kit',1,16500000)");
    const f=await fixture("QA-JOB"),c=await start(f,"full");await bind(c,"order_job");
    await rpc("solar_expect_payment",{target:c.id,payment_id:"pay_job"});
    const ticket=uuid();
    await db("insert into solar_private.worker_credentials(name,token_hash) values('payment_lookup',encode(extensions.digest($1,'sha256'),'hex'))",[ticket]);
    await db("update solar_private.payment_observations set next_lookup_at=now() where attempt_id=$1",[c.id]);
    await assert.rejects(()=>rpc("solar_claim_lookups",{ticket:"invalid"}),/forbidden/);
    const claim=()=>rpc("solar_claim_lookups",{ticket});
    const batches=await Promise.all([claim(),claim()]);
    const jobs=batches.flat().filter(j=>j.attempt_id===c.id);
    assert.equal(jobs.length,1);assert.equal(jobs[0].payment_id,"pay_job");
    const result=await observe(c.id,null,snap("order_job","pay_job",16500000));assert.equal(result.state,"confirmed");
  });
  await check("the delivered Razorpay adapter verifies signed callback and webhook bytes across the payment handler",async()=>{
    const {runAdapterJourney}=await import("./payment-gateway-scenario.mjs");
    await runAdapterJourney({fixture,rpc,db,uuid});
  });
  await check("serial receipt, competing dispatches, warranty and signed installation use the confirmed order", async () => {
    const item = "DEMO-INVERTER";
    const a = await fixture(item), b = await fixture(item);
    const orders = [];
    for (const [index, f] of [a, b].entries()) {
      const attempt = await start(f);
      const orderId = "order_warehouse" + index;
      await bind(attempt, orderId);
      const payment = await observe(attempt.id, null, snap(orderId, "pay_warehouse" + index, 3300000));
      orders.push(payment.order);
    }
    const run = async (name, args) => {
      const placeholders = args.map((_, index) => "$" + (index + 1)).join(",");
      return (await db("select solar_private." + name + "(" + placeholders + ") as result", args)).rows[0].result;
    };
    const serial = "QA-RECEIVED-SERIAL";
    const receipt = await run("receive_stock", [a.user, {item_id: item, quantity: 1, serials: [serial]}]);
    assert.equal(receipt.delta, 1);
    const manifest = {lines: [{item_id: item, quantity: 1, serials: [serial]}]};
    const results = await Promise.allSettled(orders.map(o => run("dispatch_stock", [a.user, o.pick_list_id, manifest])));
    const index = results.findIndex(result => result.status === "fulfilled");
    if (index < 0) throw results[0].reason;
    assert.match(results[1-index].reason.message, /serial_unavailable/);
    const order = orders[index], owner = [a, b][index];
    const shipment = results[index].value;
    assert.equal((await run("dispatch_stock", [a.user, order.pick_list_id, manifest])).id, shipment.id);
    const delivery = await run("deliver_shipment", [a.user, shipment.id, {}]);
    assert.equal((await run("deliver_shipment", [a.user, shipment.id, {}])).delivered_at, delivery.delivered_at);
    assert.equal((await db("select term_months from solar_private.warranties where serial=$1", [serial])).rows[0].term_months, 60);
    const tech = [a, b][1-index];
    await db("insert into solar_private.staff_assignments(user_id,role) values($1,'technician')", [tech.user]);
    await run("schedule_installation", [a.user, order.work_order_id, {
      technician_id: tech.user, scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    }]);
    const photo = order.work_order_id + "/" + uuid() + ".png";
    await db("insert into storage.objects(bucket_id,name,metadata) values('installation-evidence',$1,$2)", [photo, {mimetype:"image/png"}]);
    const startTime = new Date(Date.parse(order.confirmed_at) + 1).toISOString();
    const report = await run("record_installation", [tech.user, order.work_order_id, {
      started_at: startTime, ended_at: new Date().toISOString(), system_kw: 3.25, generation_test: "pass", photo_paths: [photo],
    }]);
    assert.equal(report.work_order.state, "awaiting_signoff");
    const signature = await run("signoff_installation", [owner.user, order.work_order_id, {report_id: report.report.id, accepted: true}]);
    assert.equal(signature.state, "completed");
    serviceFixture = { owner: owner.user, tech: tech.user, order, serial, run };
  });
  await check("dispatch supports the quote design's full 100-line kit", async () => {
    const lines = Array.from({length: 100}, (_, i) => ({
      item_id: "QA-DESIGN-" + String(i).padStart(3, "0"), quantity: 1, serials: [],
    }));
    await db("insert into solar_private.stock_items(item_id,name,on_hand,suggested_unit_paise) select sku,sku,1,100 from unnest($1::text[]) sku",
      [lines.map(line => line.item_id)]);
    const f = await fixture(lines[0].item_id, 1, lines.map(line => ({
      item_id: line.item_id, quantity: line.quantity, name: line.item_id, unit_paise: 165000,
    })));
    const attempt = await start(f);
    await bind(attempt, "order_designlimit");
    const payment = await observe(attempt.id, null, snap("order_designlimit", "pay_designlimit", 3300000));
    const result = await db("select solar_private.dispatch_stock($1,$2,$3) shipment",
      [f.user, payment.order.pick_list_id, {lines}]);
    assert.equal(result.rows[0].shipment.lines.length, 100);
    assert.deepEqual(result.rows[0].shipment.lines, lines);
  });
  await check("covered service snapshots costs, preserves serial history, and reconciles the management report", async () => {
    const {owner, tech, order, serial, run} = serviceFixture;
    const admin = uuid(), session = uuid();
    await db("insert into auth.users(id,email) values($1,$2)", [admin, admin + "@example.test"]);
    await db("insert into solar_private.staff_assignments(user_id,role) values($1,'admin')", [admin]);
    await db("insert into auth.sessions(id,user_id) values($1,$2)", [session,admin]);
    const date = (await db("select solar_private.india_date(now())::text as business_day")).rows[0].business_day;
    const report = async () => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('test.uid',$1,true),set_config('test.session',$2,true)", [admin,session]);
        return (await client.query("select public.solar_management_report($1,$1) report", [date])).rows[0].report.metrics;
      } finally {
        await client.query("rollback");
        client.release();
      }
    };
    const before = await report();
    await run("set_material_rate", [admin,{item_id:"DEMO-INVERTER",unit_cost_paise:50000}]);
    await run("set_technician_rate", [admin,{technician_id:tech,hourly_paise:12000}]);
    const opened = await run("open_service", [owner,{serial,fault:"Synthetic diagnostic"}]);
    assert.equal(opened.coverage,"covered");
    const withOpen = await report();
    assert.equal(withOpen.open_service_tickets,before.open_service_tickets+1);
    await db("select solar_private.assign_service($1,t,$3) from solar_private.service_tickets t where t.id=$2",
      [admin,opened.id,{technician_id:tech}]);
    const resolution = {diagnosis:"Failed inverter",work_performed:"Swapped unit",worked_on:date,minutes:30,labour_charge_paise:0,
      parts:[{item_id:"DEMO-INVERTER",quantity:1,unit_charge_paise:0,serials:["OPENING-DEMO-INVERTER-1"]}]};
    const command = (name,actor,body) => db("select solar_private." + name + "($1,t,$3) result from solar_private.service_tickets t where t.id=$2",
      [actor,opened.id,body]).then(r=>r.rows[0].result);
    await assert.rejects(()=>command("resolve_service",tech,{...resolution,labour_charge_paise:1}),/covered_charge_forbidden/);
    const fixed = await command("resolve_service",tech,resolution);
    assert.equal(fixed.invoice,null);
    assert.equal(fixed.replacement.old_serial,serial);
    assert.equal(fixed.replacement.new_serial,"OPENING-DEMO-INVERTER-1");
    const closed = await command("confirm_service",owner,{resolution_id:fixed.resolution.id,accepted:true});
    assert.equal(closed.state,"closed");
    assert.equal(closed.order_id,order.id);
    const after = await report();
    assert.equal(after.open_service_tickets,before.open_service_tickets);
    assert.equal(BigInt(after.material_cost_paise)-BigInt(before.material_cost_paise),50000n);
    assert.equal(BigInt(after.labour_cost_paise)-BigInt(before.labour_cost_paise),6000n);
    assert.equal(BigInt(after.margin_paise)-BigInt(before.margin_paise),-56000n);
  });
} finally { await pool.end(); await cluster.stop(); }
