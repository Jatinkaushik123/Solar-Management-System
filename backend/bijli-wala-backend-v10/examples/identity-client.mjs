// Browser ES module. Keep returned sessions in memory. Supply credentials from the form.
export const SUPABASE_URL = "https://ngutqpqlmzgxpwkamilj.supabase.co";
export const PUBLISHABLE_KEY = "sb_publishable_EOEwIjuoQkK1wiY8171xvQ_-O5EdpR1";
export const API_BASE = SUPABASE_URL + "/functions/v1/api";

export async function request(url, { method = "GET", token, body, idempotencyKey } = {}) {
  const headers = { apikey: PUBLISHABLE_KEY };
  if (token) headers.Authorization = "Bearer " + token;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code || data?.error_code || "request_failed";
    throw Object.assign(new Error(code), { status: response.status, code });
  }
  return data;
}

export function signUpCustomer(email, password, displayName = "") {
  return request(SUPABASE_URL + "/auth/v1/signup", {
    method: "POST", body: { email, password, data: { display_name: displayName } },
  });
}

function passwordSession(email, password) {
  return request(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST", body: { email, password },
  });
}

export function signOut(token) {
  return request(SUPABASE_URL + "/auth/v1/logout?scope=local", { method: "POST", token });
}

export function getMe(token, portal) {
  const query = portal ? "?portal=" + encodeURIComponent(portal) : "";
  return request(API_BASE + "/v1/me" + query, { token });
}

export async function signIn(portal, email, password) {
  if (portal !== "customer" && portal !== "staff") throw new Error("invalid_portal");
  const session = await passwordSession(email, password);
  try {
    const me = await getMe(session.access_token, portal);
    return { session, me };
  } catch (error) {
    await signOut(session.access_token).catch(() => {});
    throw error;
  }
}

export function getProfile(token, id) {
  return request(API_BASE + "/v1/profiles/" + encodeURIComponent(id), { token });
}

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

// Keep this secret until the administrator privately hands it to the invitee.
// Reuse the same secret when retrying a single invitation request.
export function newInvitationSecret() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function inviteStaff(adminToken, email, role, secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return request(API_BASE + "/v1/staff/invitations", {
    method: "POST", token: adminToken, body: { email, role, token_hash: hex(new Uint8Array(digest)) },
  });
}

// The invitee first registers and confirms the invited email with Supabase Auth.
// The onboarding screen uses a fresh session, before applying the staff portal gate.
export async function joinStaff(email, password, secret) {
  const session = await passwordSession(email, password);
  try {
    await request(API_BASE + "/v1/staff/invitations/accept", {
      method: "POST", token: session.access_token, body: { token: secret },
    });
    return { session, me: await getMe(session.access_token, "staff") };
  } catch (error) {
    await signOut(session.access_token).catch(() => {});
    throw error;
  }
}
