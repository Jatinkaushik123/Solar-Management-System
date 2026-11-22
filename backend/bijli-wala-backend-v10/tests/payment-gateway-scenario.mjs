import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handlePayment } from "../supabase/functions/api/payments.ts";
import { createRazorpayGateway } from "../supabase/functions/_shared/razorpay/mod.ts";
export async function runGatewayJourney({fixture,rpc,db,uuid}) {
  await db("insert into solar_private.stock_items values('QA-HTTP','HTTP kit',2,16500000)");
  const owner=await fixture("QA-HTTP"), other=await fixture("QA-HTTP");
  let creates=0, lookups=0, verifiedCallbacks=0, rawWebhooks=0;
  const capture={orderId:"order_adapter",paymentId:"pay_adapter",amountPaise:3300000,currency:"INR",status:"captured"};
  const gateway={
    async createOrder(input) { creates++;assert.equal(input.amountPaise,3300000);assert.ok(input.checkoutRef.length<=40);
      return {keyId:"rzp_test_fixture",orderId:capture.orderId,amountPaise:3300000,currency:"INR"}; },
    async verifyCheckout({storedOrderId,paymentId,signature}) {verifiedCallbacks++;return storedOrderId===capture.orderId && paymentId===capture.paymentId && signature==="signed-fixture";},
    async fetchPayment(id){lookups++;assert.equal(id,capture.paymentId);return {...capture};},
    async verifyWebhook({rawBody,signature,eventId}){rawWebhooks++;assert.equal(new TextDecoder().decode(rawBody),'{ "original" : true }');
      if(signature!=="signed-fixture") throw Object.assign(new Error(),{code:"invalid_signature"});
      return {kind:"payment",eventId,eventType:"payment.captured",payment:{...capture}};}
  };
  const deps={rpc, gateway:()=>gateway, viewer:async token=>({id:token==="Bearer owner"?owner.user:other.user,role:"customer"})};
  async function call(path,body,key=uuid(),bearer="owner") {
    const headers={Authorization:"Bearer "+bearer,"Content-Type":"application/json","Idempotency-Key":key};
    const req=new Request("https://example.invalid"+path,{method:body?"POST":"GET",headers,body:JSON.stringify(body)});
    return handlePayment(req,path,deps);
  }
  const path="/v1/quotes/"+owner.quote+"/checkout", k=uuid();
  const first=await call(path,{choice:"advance"},k);
  const retry=await call(path,{choice:"advance"},k);
  assert.equal(creates,1);assert.equal(first.checkout.orderId,capture.orderId);assert.deepEqual(first.checkout,retry.checkout);
  await assert.rejects(()=>call(path,{choice:"advance"},uuid(),"other"),/quote_not_found/);
  const verify="/v1/checkouts/"+first.attempt.id+"/verify";
  await assert.rejects(()=>call(verify,{payment_id:capture.paymentId,signature:"bad"}),/invalid_signature/);
  assert.equal(lookups,0);
  const receipt=await call(verify,{payment_id:capture.paymentId,signature:"signed-fixture"});
  assert.equal(receipt.state,"confirmed");assert.equal(verifiedCallbacks,2);assert.equal(lookups,1);
  const hook="/v1/webhooks/razorpay";
  const request=sig=>new Request("https://example.invalid"+hook,{method:"POST",headers:{"x-razorpay-signature":sig,"x-razorpay-event-id":"evt-raw"},body:'{ "original" : true }'});
  await assert.rejects(()=>handlePayment(request("bad"),hook,deps),/invalid_signature/);
  assert.deepEqual(await handlePayment(request("signed-fixture"),hook,deps),{received:true});
  assert.equal(rawWebhooks,2);
  assert.equal((await call("/v1/quotes/"+owner.quote+"/payment")).receipts.length,1);

  // The public client cannot supply a payment amount. The full checkout passes
  // only the quote's outstanding amount across the gateway boundary.
  const fullPath="/v1/quotes/"+other.quote+"/checkout", fullKey=uuid();
  gateway.createOrder=async ({amountPaise})=>{
    creates++; assert.equal(amountPaise,16500000);
    return {keyId:"rzp_test_fixture",orderId:"order_fullHTTP",amountPaise,currency:"INR"};
  };
  await assert.rejects(()=>call(fullPath,{choice:"full",amount:1},uuid(),"other"),/invalid_fields/);
  const full=await call(fullPath,{choice:"full"},fullKey,"other");
  assert.equal(full.checkout.amountPaise,16500000);
  const fullEvent={...capture,paymentId:"pay_fullHTTP",orderId:"order_fullHTTP",amountPaise:16500000};
  gateway.verifyWebhook=async ({eventId})=>({kind:"payment",eventId,eventType:"payment.captured",payment:fullEvent});
  await handlePayment(new Request("https://example.invalid"+hook,{method:"POST",
    headers:{"x-razorpay-signature":"fixture","x-razorpay-event-id":"evt-full"},body:"captured"}),hook,deps);
  const settled=await call("/v1/quotes/"+other.quote+"/payment",undefined,uuid(),"other");
  assert.equal(settled.state,"confirmed"); assert.equal(settled.remaining_paise,0);
  assert.ok(settled.order.pick_list_id && settled.order.work_order_id);

  await db("insert into solar_private.stock_items values('QA-AMBIG','Ambiguous create kit',1,16500000)");
  const uncertain=await fixture("QA-AMBIG");
  deps.viewer=async()=>({id:uncertain.user,role:"customer"});
  const uncertainPath="/v1/quotes/"+uncertain.quote+"/checkout", creationKey=uuid();
  let requests=0;
  gateway.createOrder=async()=>{requests++;throw new Error("provider timed out");};
  await assert.rejects(()=>call(uncertainPath,{choice:"advance"},creationKey),/checkout_creation_uncertain/);
  const repeated=await call(uncertainPath,{choice:"advance"},creationKey);
  assert.equal(requests,1);assert.equal(repeated.state,"under_review");assert.equal(repeated.checkout,null);

  await db("insert into solar_private.stock_items values('QA-BIND','Order persistence fixture',1,16500000)");
  const bindOwner=await fixture("QA-BIND");
  deps.viewer=async()=>({id:bindOwner.user,role:"customer"});
  let bindings=0, orderCreates=0;
  gateway.createOrder=async ({amountPaise})=>{
    orderCreates++;
    return {keyId:"rzp_test_fixture",orderId:"order_bind"+orderCreates,amountPaise,currency:"INR"};
  };
  deps.rpc=async (name,args)=>{
    if(name==="solar_checkout_bind" && ++bindings===1) throw new Error("temporary database connection loss");
    return rpc(name,args);
  };
  const bindPath="/v1/quotes/"+bindOwner.quote+"/checkout";
  const original=await call(bindPath,{choice:"advance"});
  assert.equal(orderCreates,1);assert.equal(original.checkout.orderId,"order_bind1");
  await db("update solar_private.checkout_attempts set expires_at=now()-interval '1 second' where id=$1",[original.attempt.id]);
  const again=uuid(),replacement=await call(bindPath,{choice:"advance"},again);
  assert.equal(replacement.checkout.orderId,"order_bind2");
  await rpc("solar_payment_observe",{target:original.attempt.id,event_id:null,
    snapshot:{...capture,orderId:"order_bind1",paymentId:"pay_wrongLate",amountPaise:1}});
  const onHold=await call(bindPath,{choice:"advance"},again);
  assert.equal(onHold.state,"under_review");assert.equal(onHold.checkout,null);
}

// Real adapter, real signature verification, real PostgreSQL. Only the remote
// Razorpay HTTP responses and session identity at the test boundary are supplied.
export async function runAdapterJourney({fixture,rpc,db,uuid}) {
  await db("insert into solar_private.stock_items values('QA-ADAPTER','Provider contract kit',1,16500000)");
  const customer=await fixture("QA-ADAPTER");
  const payment={id:"pay_adapterContract",order_id:"order_adapterContract",amount:3300000,currency:"INR",status:"authorized"};
  const keySecret=uuid(), webhookSecret=uuid();
  const sign=(key,message)=>createHmac("sha256",key).update(message).digest("hex");
  let reference,created=0;
  const gateway=createRazorpayGateway({
    keyId:"rzp_test_fixture",keySecret,webhookSecret,
    fetchImpl:async(url,options)=>{
      if(url==="https://api.razorpay.com/v1/orders" && options.method==="POST"){
        const payload=JSON.parse(options.body);
        assert.equal(payload.amount,3300000);assert.equal(payload.currency,"INR");
        reference=payload.receipt;created++;
        return Response.json({id:payment.order_id,amount:3300000,currency:"INR"});
      }
      assert.equal(url,"https://api.razorpay.com/v1/payments/"+payment.id);
      return Response.json(payment);
    },
  });
  const deps={rpc,viewer:async()=>({id:customer.user,role:"customer"}),gateway:()=>gateway};
  const post=(path,body,headers)=>handlePayment(new Request("https://example.invalid"+path,{
    method:"POST",headers,body}),path,deps);
  const headers={Authorization:"Bearer fixture","Content-Type":"application/json","Idempotency-Key":uuid()};
  const path="/v1/quotes/"+customer.quote+"/checkout";
  const checkout=await post(path,'{"choice":"advance"}',headers);
  await post(path,'{"choice":"advance"}',headers);
  assert.equal(checkout.attempt.id,reference);assert.equal(created,1);
  const marked=await post("/v1/checkouts/"+reference+"/verify",JSON.stringify({
    payment_id:payment.id,signature:sign(keySecret,payment.order_id+"|"+payment.id),
  }),{...headers,"Idempotency-Key":uuid()});
  assert.equal(marked.state,"payment_pending");assert.equal(marked.collected_paise,0);
  payment.status="captured";
  const raw=JSON.stringify({event:"payment.captured",payload:{payment:{entity:payment}}},null,2);
  const hook="/v1/webhooks/razorpay",signed={"x-razorpay-signature":sign(webhookSecret,raw),"x-razorpay-event-id":"evt-adapter-contract"};
  await assert.rejects(()=>post(hook,raw+" ",signed),/invalid_signature/);
  await post(hook,raw,signed);await post(hook,raw,signed);
  const status=await rpc("solar_payment_read",{actor:customer.user,target:customer.quote});
  assert.equal(status.state,"confirmed");assert.equal(status.receipts.length,1);assert.equal(status.remaining_paise,13200000);
  assert.ok(status.order.pick_list_id && status.order.work_order_id);
}
