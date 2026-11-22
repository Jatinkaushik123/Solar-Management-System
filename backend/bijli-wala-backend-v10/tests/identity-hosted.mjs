// Node 22+. Read synthetic fixture credentials from stdin, never from command-line arguments.
import assert from "node:assert/strict";
import {
  API_BASE, SUPABASE_URL, getMe, getProfile, inviteStaff, joinStaff, newInvitationSecret,
  request, signIn, signOut,
} from "../examples/identity-client.mjs";

const input = [];
for await (const chunk of process.stdin) input.push(chunk);
const users = JSON.parse(Buffer.concat(input).toString("utf8"));
const fixtures = Object.fromEntries(users.map(user => [user.label, user]));
const sessions = new Set();
let passed = 0;
async function check(name, operation) {
  await operation();
  console.log("PASS " + name);
  passed++;
}
function denied(op, status, code) {
  return assert.rejects(op, error => error.status === status && (!code || error.code === code));
}
async function login(label, portal) {
  const user = fixtures[label];
  const result = await signIn(portal, user.email, user.password);
  sessions.add(result.session.access_token);
  return { token: result.session.access_token, me: result.me };
}
const post = (path, token, body) => request(API_BASE + path, { method: "POST", token, body });
const accept = (token, secret) => post("/v1/staff/invitations/accept", token, { token: secret });

try {
  await check("unauthenticated /me", () => denied(() => getMe(), 401, "unauthenticated"));
  await check("invalid bearer", () => denied(() => getMe("invalid"), 401));
  await check("browser CORS preflight", async () => {
    const r = await fetch(API_BASE + "/v1/me", { method: "OPTIONS", headers: {
      Origin: "http://localhost:5173", "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,apikey",
    } });
    assert.equal(r.status, 204);
    assert.ok(r.headers.get("access-control-allow-headers").includes("authorization"));
  });
  const [a, b, admin] = await Promise.all([login("customer_a", "customer"), login("customer_b", "customer"), login("admin", "staff")]);
  await check("two customer identities and bootstrap admin", async () => {
    assert.equal(a.me.role, "customer"); assert.equal(b.me.role, "customer"); assert.equal(admin.me.role, "admin");
    assert.notEqual(a.me.id, b.me.id);
  });
  await check("customer and staff login screens enforce the requested portal", async () => {
    await denied(() => login("customer_a", "staff"), 403, "wrong_portal");
    await denied(() => login("admin", "customer"), 403, "wrong_portal");
  });
  await check("each customer can read their own profile", async () => {
    for (const owner of [a, b]) assert.equal((await getProfile(owner.token, owner.me.id)).id, owner.me.id);
  });
  await check("cross-customer profile lookup is hidden in both directions", async () => {
    await denied(() => getProfile(a.token, b.me.id), 404, "profile_not_found");
    await denied(() => getProfile(b.token, a.me.id), 404, "profile_not_found");
  });
  await check("direct Data API enforces the same profile ownership", async () => {
    for (const owner of [a, b]) {
      const rows = await request(SUPABASE_URL + "/rest/v1/solar_profiles?select=id", { token: owner.token });
      assert.deepEqual(rows, [{ id: owner.me.id }]);
    }
    await denied(() => request(SUPABASE_URL + "/rest/v1/solar_profiles?id=eq." + b.me.id,
      { method: "PATCH", token: a.token, body: { display_name: "unauthorized" } }), 403);
  });
  await check("admin can read both customer profiles", async () => {
    for (const owner of [a, b]) assert.equal((await getProfile(admin.token, owner.me.id)).id, owner.me.id);
  });
  await check("editable Auth metadata cannot elevate a customer on either API", async () => {
    const user = await request(SUPABASE_URL + "/auth/v1/user", {
      method: "PUT", token: a.token, body: { data: { role: "admin", staff_role: "admin" } },
    });
    assert.equal(user.user_metadata.role, "admin");
    const fresh = await login("customer_a", "customer");
    assert.equal(fresh.me.role, "customer");
    await denied(() => inviteStaff(fresh.token, fixtures.customer_b.email, "admin", newInvitationSecret()), 403);
    await denied(() => request(SUPABASE_URL + "/rest/v1/rpc/solar_invite_staff", {
      method: "POST", token: fresh.token,
      body: { target_email: fixtures.customer_b.email, staff_role: "admin", digest_hex: "f".repeat(64) },
    }), 403);
  });
  await check("admin invitation validates the requested role", async () => {
    await denied(() => inviteStaff(admin.token, fixtures.customer_b.email, "owner", newInvitationSecret()), 400);
  });
  let newlyAssigned = 0;
  for (const role of ["technician", "inventory", "sales"]) {
    const user = fixtures[role];
    let existing;
    try { existing = await login(role, "staff"); }
    catch (e) { if (e.code !== "wrong_portal") throw e; }
    if (!existing) {
      const invitee = await login(role, "customer");
      const secret = newInvitationSecret();
      const old = newInvitationSecret();
      await check(role + " invitation replay, rotation and email binding", async () => {
        const original = await inviteStaff(admin.token, user.email, role, old);
        const retry = await inviteStaff(admin.token, user.email, role, old);
        assert.deepEqual(original, retry);
        await inviteStaff(admin.token, user.email, role, secret);
        await denied(() => accept(invitee.token, old), 403, "invitation_unavailable");
        await denied(() => accept(b.token, secret), 403, "invitation_unavailable");
      });
      await check(role + " invitation acceptance and same-user replay", async () => {
        const [joined, simultaneous] = await Promise.all([
          joinStaff(user.email, user.password, secret), accept(invitee.token, secret),
        ]);
        sessions.add(joined.session.access_token);
        assert.equal(joined.me.role, role);
        assert.equal(simultaneous.role, role);
        assert.equal((await accept(invitee.token, secret)).role, role);
      });
      newlyAssigned++;
    }
    const person = existing || await login(role, "staff");
    await check(role + " password login, /me and profile scope", async () => {
      assert.equal(person.me.role, role);
      assert.equal((await getProfile(person.token, person.me.id)).id, person.me.id);
      await denied(() => getProfile(person.token, a.me.id), 404);
      await denied(() => inviteStaff(person.token, fixtures.customer_b.email, "admin", newInvitationSecret()), 403);
    });
  }
  await check("invalid profile id and unsupported HTTP method", async () => {
    await denied(() => getProfile(a.token, "invalid"), 400);
    await denied(() => post("/v1/me", a.token, {}), 405);
  });
  await check("signed-out access token immediately loses profile access", async () => {
    await signOut(b.token); sessions.delete(b.token);
    await denied(() => getMe(b.token), 401);
    assert.deepEqual(await request(SUPABASE_URL + "/rest/v1/solar_profiles?select=id", { token: b.token }), []);
  });
  console.log(passed + " checks passed; " + newlyAssigned + " fresh staff invitations redeemed.");
} finally {
  await Promise.allSettled([...sessions].map(signOut));
}
