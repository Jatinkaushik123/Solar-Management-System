// Uses the milestone 1 fixture array on stdin. Creates a fresh accepted quote for each customer.
import assert from "node:assert/strict";
import { API_BASE, SUPABASE_URL, PUBLISHABLE_KEY, request, signIn, signOut } from "../examples/identity-client.mjs";
const chunks=[];
for await(const c of process.stdin) chunks.push(c);
const accounts=JSON.parse(Buffer.concat(chunks).toString());
const sessions={};
const api=(who,path,body,key=crypto.randomUUID())=>request(API_BASE+"/v1"+path,{token:sessions[who].session.access_token,
  method:body?"POST":"GET",body,idempotencyKey:body?key:undefined});
async function prepare(customer,item,{expectShortage=false,issueOnly=false}={}) {
  const enq=await api(customer,"/enquiries",{site:process.env.SOLAR_QA_SITE || "M3 synthetic checkout rehearsal",contact_email:sessions[customer].me.email,
    requirements:"QA accepted rooftop",roof_space_m2:40,monthly_bill_paise:450000,grid_details:"Grid connected"});
  const p="/enquiries/"+enq.id;
  await api("admin",p+"/assignment",{technician_id:sessions.technician.me.id,salesperson_id:sessions.sales.me.id});
  await api("technician",p+"/designs",{base_revision:0,visited_at:new Date(Date.now()-86400000).toISOString(),roof_direction:"South",
    tilt_deg:18,cable_m:24.5,equipment:[{item_id:"DEMO-PANEL",quantity:5},{item_id:item,quantity:1}]});
  const check=await api("inventory",p+"/inventory-checks",{revision:1});
  if(expectShortage){
    const counts=(await api("inventory","/inventory/items")).find(row=>row.item_id===item);
    assert.equal(counts.on_hand,1);assert.equal(counts.available,0);assert.equal(counts.held,1);
    assert.equal(check.outcome,"shortage");assert.equal(check.quote_id,null);
    assert.equal(check.lines.find(row=>row.item_id===item).shortfall,1);
    return {reference:enq.reference,enquiry_id:enq.id};
  }
  assert.equal(check.outcome,"approved");
  const quote="/quotes/"+check.quote_id;
  await api("sales",quote+"/pricing",{price_version:0,unit_prices:{"DEMO-PANEL":2000000,[item]:5000000},installation_paise:2000000,
    discount_paise:500000,valid_until:new Date(Date.now()+30*86400000).toISOString().slice(0,10),advance_kind:"percentage",advance_value:2000});
  const issue = {price_version:1};
  if (issueOnly) {
    const key=crypto.randomUUID();
    const [issued,retry]=await Promise.all([api("sales",quote+"/issue",issue,key),api("sales",quote+"/issue",issue,key)]);
    assert.ok(issued.delivery.id);
    assert.equal(retry.delivery.id,issued.delivery.id);
    assert.equal((await api("sales",quote+"/issue",issue)).delivery.id,issued.delivery.id);
    const visible=await api(customer,quote);
    assert.equal(visible.state,"issued");
    assert.equal(visible.delivery,undefined);
    await assert.rejects(()=>api("customer_b",quote),e=>e.status===404);
    await assert.rejects(()=>request(API_BASE+"/v1"+quote),e=>e.status===401);
    return {quote:check.quote_id,reference:enq.reference,outbox:issued.delivery.id};
  }
  await api("sales",quote+"/issue",issue);
  const result=await api(customer,quote+"/decision",{decision:"accept"});assert.equal(result.advance_paise,3300000);
  return {quote:check.quote_id,reference:enq.reference,actor:sessions[customer].me.id};
}
async function verifyHosted() {
  const item=process.env.SOLAR_QA_ITEM || "DEMO-INVERTER";
  if(process.argv.includes("--issue-email")){
    console.log("EMAIL_FIXTURE "+JSON.stringify(await prepare("customer_a",item,{issueOnly:true})));
    return;
  }
  if(process.argv.includes("--held-stock")){
    assert.match(item,/^M3-QA-INVERTER-/);
    console.log("PASS hosted stock list and technical design check agree on the held unit",await prepare("customer_b",item,{expectShortage:true}));
    return;
  }
  const quotes=process.env.SOLAR_QA_QUOTES?JSON.parse(process.env.SOLAR_QA_QUOTES):await Promise.all(["customer_a","customer_b"].map(x=>prepare(x,item)));
  console.log("FIXTURES "+JSON.stringify(quotes));
  if(process.argv.includes("--prepare-only")) return;
  const path="/quotes/"+quotes[0].quote;
  const status=await api("customer_a",path+"/payment");assert.equal(status.advance_paise,3300000);assert.equal(status.total_paise,16500000);
  assert.equal(status.gateway_available,false);assert.equal(status.state,"checkout_unavailable");assert.equal(status.attempt,null);
  await assert.rejects(()=>api("customer_b",path+"/payment"),e=>e.status===404);
  await assert.rejects(()=>api("customer_b",path+"/checkout",{choice:"advance"}),e=>e.status===404);
  const key=crypto.randomUUID();
  for(let i=0;i<2;i++) await assert.rejects(()=>api("customer_a",path+"/checkout",{choice:"advance"},key),e=>e.status===503 && e.code==="checkout_unavailable");
  assert.equal((await api("customer_a",path+"/payment")).attempt,null);
  await assert.rejects(()=>request(SUPABASE_URL+"/rest/v1/rpc/solar_checkout_begin",{method:"POST",token:sessions.customer_a.session.access_token,
    body:{actor:sessions.customer_a.me.id,target:quotes[0].quote,choice:"advance",k:key}}),e=>[403,404].includes(e.status));
  const webhook=await fetch(API_BASE+"/v1/webhooks/razorpay",{method:"POST",headers:{apikey:PUBLISHABLE_KEY},body:"{}"});
  assert.equal(webhook.status,503);
  assert.ok(Array.isArray((await api("admin","/payments/reconciliation")).items));
  await assert.rejects(()=>api("customer_a","/payments/reconciliation"),e=>e.status===403);
  console.log("PASS hosted accepted totals, owner scope, unavailable retries without holds, private RPC, webhook and admin queue");
}
try {
  for(const a of accounts) sessions[a.label]=await signIn(a.label.startsWith("customer")?"customer":"staff",a.email,a.password);
  await verifyHosted();
} finally {await Promise.allSettled(Object.values(sessions).map(s=>signOut(s.session.access_token)));}
