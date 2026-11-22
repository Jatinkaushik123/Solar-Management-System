import assert from "node:assert/strict";
import { API_BASE, SUPABASE_URL, request, signIn, signOut } from "../examples/identity-client.mjs";

const bytes = [];
for await (const part of process.stdin) bytes.push(part);
const accounts = JSON.parse(Buffer.concat(bytes).toString());
const sessions = {};
const uuid = () => crypto.randomUUID();
const ack = "We’ve received your request. We’ll email your quotation once it’s approved.";
let count = 0;

async function call(label, path, body, key = uuid()) {
  return request(API_BASE + "/v1" + path, {
    method: body === undefined ? "GET" : "POST", token: sessions[label].token,
    body, idempotencyKey: body === undefined ? undefined : key,
  });
}
async function check(label, operation) {
  await operation();
  count++;
  console.log("PASS " + label);
}
const denied = (op, status) => assert.rejects(op, err => err.status === status);

try {
  for (const account of accounts) {
    const { session, me } = await signIn(account.label.startsWith("customer") ? "customer" : "staff", account.email, account.password);
    sessions[account.label] = { token: session.access_token, id: me.id, email: me.email };
  }
  const intake = { site: "Demo rooftop, Pune", contact_email: sessions.customer_a.email,
    requirements: "On-grid rooftop installation", roof_space_m2: 40, monthly_bill_paise: 450000, grid_details: "Single phase" };
  let enquiry;
  await check("intake derives customer ownership and stores one request on retry", async () => {
    const key = uuid();
    const [one, two] = await Promise.all([call("customer_a","/enquiries",intake,key),call("customer_a","/enquiries",intake,key)]);
    assert.equal(one.id,two.id); assert.ok(one.reference); assert.equal(one.acknowledgement,ack);
    enquiry = one;
    const saved = await call("customer_a","/enquiries/"+one.id);
    assert.equal(saved.site,intake.site); assert.equal(saved.monthly_bill_paise,450000);
    await denied(() => call("customer_b","/enquiries/"+one.id),404);
    await denied(() => call("customer_a","/enquiries",{...intake,customer_id:sessions.customer_b.id}),400);
    await denied(() => call("customer_a","/enquiries",{...intake,site:"Different site"},key),409);
  });
  const path = "/enquiries/" + enquiry.id;
  const review = (role, action, body, key) => call(role, path + "/" + action, body, key);
  const assignments = { technician_id: sessions.technician.id, salesperson_id: sessions.sales.id };
  await check("admin can select active assignees and customers cannot enumerate them",async()=>{
    const eligible=await call("admin","/staff/assignees");
    assert.ok(eligible.some(row=>row.id===assignments.technician_id && row.role==="technician"));
    assert.ok(eligible.some(row=>row.id===assignments.salesperson_id && row.role==="sales"));
    await denied(()=>call("customer_a","/staff/assignees"),403);
  });
  const design = (base_revision, quantity) => ({ base_revision, visited_at: new Date(Date.now()-86400000).toISOString(),
    roof_direction: "South", tilt_deg: 18, cable_m: 24.5, equipment: [
      { item_id: "DEMO-PANEL", quantity }, { item_id: "DEMO-INVERTER", quantity: 1 }] });
  let draft;
  await check("assignment and site visit require the correct actor and current revision", async () => {
    await denied(() => review("sales","assignment",assignments),403);
    await denied(() => review("technician","designs",design(0,5)),404);
    await review("admin","assignment",assignments);
    await review("technician","return",{base_revision:0,reason:"Repeat the roof measurements"});
    assert.equal((await call("customer_a",path)).state,"correction");
    await review("technician","designs",design(0,999));
    await denied(() => review("technician","designs",design(0,5)),409);
  });
  await check("a shortage blocks the draft and approval records exact stock without reserving it", async () => {
    const stock = await call("inventory","/inventory/items");
    const shortage = await review("inventory","inventory-checks",{revision:1});
    assert.equal(shortage.outcome,"shortage"); assert.equal(shortage.quote_id,null);
    assert.ok(shortage.lines.some(x=>x.required===999 && x.available<999));
    assert.deepEqual((await call("sales",path)).quotes,[]);
    await review("technician","designs",design(1,5));
    await denied(() => review("inventory","inventory-checks",{revision:1}),409);
    const answers = await Promise.all([1,2].map(()=>review("inventory","inventory-checks",{revision:2})));
    assert.equal(answers[0].quote_id,answers[1].quote_id); draft=answers[0].quote_id;
    assert.ok(draft); assert.equal(answers[0].revision,2); assert.equal(answers[0].actor_id,sessions.inventory.id);
    assert.ok(answers[0].checked_at); assert.equal(answers[0].outcome,"approved");
    assert.deepEqual(await call("inventory","/inventory/items"),stock);
    assert.deepEqual((await call("customer_a",path)).quotes,[]);
    await denied(() => call("customer_a","/quotes/"+draft),404);
    await denied(() => request(SUPABASE_URL+"/rest/v1/rpc/solar_quote",{
      method:"POST",token:sessions.customer_a.token,body:{target:draft}
    }),404);
  });
  const quote = (role,id,action,body,key) => call(role,"/quotes/"+id+"/"+action,body,key);
  const validity = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const commercial = (price_version,kind,value) => ({ price_version,
    unit_prices: {"DEMO-PANEL":2000000,"DEMO-INVERTER":5000000}, installation_paise:2000000,
    discount_paise:500000,valid_until:validity,advance_kind:kind,advance_value:value });
  await check("sales cannot change equipment, quantities, or a superseded quote", async () => {
    await denied(() => quote("sales",draft,"pricing",{...commercial(0,"fixed",2500000),equipment:[]}),400);
    await denied(() => quote("sales",draft,"pricing",{...commercial(0,"fixed",2500000),quantity:10}),400);
    await denied(() => review("sales","designs",design(2,10)),403);
    await denied(() => quote("sales",draft,"pricing",{...commercial(0,"fixed",2500000),unit_prices:{"DEMO-BATTERY":1}}),400);
    await denied(() => quote("sales",draft,"issue",{price_version:0}),409);
    await review("technician","designs",design(2,5));
    assert.equal((await call("sales","/quotes/"+draft)).state,"superseded");
    await denied(() => quote("sales",draft,"issue",{price_version:0}),409);
    await denied(() => review("inventory","inventory-checks",{revision:2}),409);
    assert.equal((await call("sales",path)).state,"technical_approved");
    const approved=await review("inventory","inventory-checks",{revision:3}); draft=approved.quote_id;
  });
  await check("fixed INR advance, private draft, frozen issuance and one queued email", async () => {
    const priced=await quote("sales",draft,"pricing",commercial(0,"fixed",2500000));
    assert.equal(priced.total_paise,16500000); assert.equal(priced.advance_paise,2500000);
    await denied(()=>quote("sales",draft,"pricing",commercial(0,"fixed",100)),409);
    await denied(()=>call("customer_a","/quotes/"+draft),404);
    const issued=await Promise.all([1,2].map(()=>quote("sales",draft,"issue",{price_version:1})));
    assert.equal(issued[0].issued_at,issued[1].issued_at);
    assert.equal(issued[0].delivery.status,"pending"); assert.equal(issued[0].delivery.id,issued[1].delivery.id);
    const own=await call("customer_a","/quotes/"+draft);
    assert.equal(own.advance_paise,2500000); assert.ok(!("delivery" in own));
    await denied(()=>call("customer_b","/quotes/"+draft),404);
    await denied(()=>quote("customer_b",draft,"decision",{decision:"accept"}),404);
    await denied(()=>quote("sales",draft,"pricing",commercial(1,"fixed",12000)),409);
  });
  let finalQuote;
  await check("a request for commercial changes preserves the issued revision and opens a private revision",async()=>{
    await quote("customer_a",draft,"decision",{decision:"request_changes",kind:"commercial",reason:"Use a percentage advance"});
    const salesView=await call("sales",path);
    finalQuote=salesView.quotes.find(q=>q.state==="draft").id;
    assert.notEqual(finalQuote,draft);
    assert.equal((await call("customer_a","/quotes/"+draft)).advance_paise,2500000);
    await denied(()=>call("customer_a","/quotes/"+finalQuote),404);
  });
  await check("20% of ₹1,65,000 is ₹33,000 and concurrent acceptance freezes one result",async()=>{
    const priced=await quote("sales",finalQuote,"pricing",commercial(0,"percentage",2000));
    assert.equal(priced.total_paise,16500000); assert.equal(priced.advance_paise,3300000);
    await quote("sales",finalQuote,"issue",{price_version:1});
    const accepted=await Promise.all([1,2].map(()=>quote("customer_a",finalQuote,"decision",{decision:"accept"})));
    assert.equal(accepted[0].state,"accepted"); assert.equal(accepted[0].decided_at,accepted[1].decided_at);
    await denied(()=>quote("customer_a",finalQuote,"decision",{decision:"decline"}),409);
    await denied(()=>review("technician","designs",design(3,1)),409);
    const final=await call("sales",path);
    assert.equal(final.state,"accepted"); assert.equal(final.history.filter(h=>h.action==="accepted").length,1);
    assert.equal(final.history.filter(h=>h.action==="quote_issued").length,2);
    console.log(JSON.stringify({accepted_quote:finalQuote,design_revision:3,total_paise:priced.total_paise,advance_paise:priced.advance_paise}));
  });
  const second = await call("customer_b","/enquiries",{...intake,contact_email:sessions.customer_b.email});
  const other = "/enquiries/"+second.id;
  await call("admin",other+"/assignment",assignments);
  const prepare = async (before) => {
    await call("technician",other+"/designs",design(before,5));
    return (await call("inventory",other+"/inventory-checks",{revision:before+1})).quote_id;
  };
  const first = await prepare(0);
  await check("frontend actions only enable issue after pricing",async()=>{
    assert.deepEqual((await call("sales",other)).allowed_actions,["pricing"]);
    assert.deepEqual((await call("sales","/quotes/"+first)).allowed_actions,["pricing"]);
  });
  await check("technical changes return to the technician and a subsequent issued revision can be declined", async()=>{
    const price = {...commercial(0,"percentage",5000),installation_paise:1,discount_paise:0};
    assert.equal((await quote("sales",first,"pricing",price)).advance_paise,7500001);
    await quote("sales",first,"issue",{price_version:1});
    await quote("customer_b",first,"decision",{decision:"request_changes",kind:"technical",reason:"Replace the roof layout"});
    const changed=await call("technician",other);
    assert.equal(changed.state,"changes_requested"); assert.ok(changed.allowed_actions.includes("designs"));
    await denied(()=>call("inventory",other+"/inventory-checks",{revision:1}),409);
    const replacement=await prepare(1);
    await quote("sales",replacement,"pricing",commercial(0,"fixed",2500000));
    const key=uuid();
    const issued=await quote("sales",replacement,"issue",{price_version:1},key);
    assert.deepEqual(await quote("sales",replacement,"issue",{price_version:1},key),issued);
    const declined=await quote("customer_b",replacement,"decision",{decision:"decline"});
    assert.equal(declined.state,"declined"); assert.equal((await call("customer_b",other)).state,"declined");
  });
  console.log(JSON.stringify({ passed: count, reference: enquiry.reference, enquiry_id: enquiry.id }));
} finally {
  await Promise.allSettled(Object.values(sessions).map(x => signOut(x.token)));
}
