import assert from "node:assert/strict";
import { API_BASE, PUBLISHABLE_KEY, signIn, signOut } from "../examples/identity-client.mjs";

// The second account is permanently disabled. Only explicitly disposable fixtures qualify.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { admin, disposable } = JSON.parse(Buffer.concat(chunks).toString());
assert.match(disposable.email, /^m2-disable-[a-f0-9]+@identity\.sunpower\.test$/);
const operator = await signIn("staff",admin.email,admin.password);
const member = await signIn("staff",disposable.email,disposable.password);
try {
  assert.equal(operator.me.role,"admin"); assert.equal(member.me.role,"technician");
  async function api(path,token,body) {
    const headers={ apikey:PUBLISHABLE_KEY, Authorization:"Bearer "+token };
    if (body) Object.assign(headers,{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()});
    return fetch(API_BASE+"/v1"+path,{method:body?"POST":"GET",headers,body:JSON.stringify(body)});
  }
  const oldToken = member.session.access_token;
  assert.equal((await api("/inventory/items",oldToken)).status,200);
  const disable = "/staff/"+member.me.id+"/disable";
  assert.equal((await api(disable,oldToken,{})).status,403);
  assert.equal((await api(disable,operator.session.access_token,{})).status,200);
  assert.equal((await api(disable,operator.session.access_token,{})).status,200);
  assert.equal((await api("/me?portal=staff",oldToken)).status,401);
  assert.equal((await api("/inventory/items",oldToken)).status,401);
  await assert.rejects(() => signIn("staff",disposable.email,disposable.password));
  console.log("PASS disposable technician: access 200 before disable, old token 401 on identity and stock, new password sign-in rejected");
} finally {
  await Promise.allSettled([signOut(operator.session.access_token),signOut(member.session.access_token)]);
}
