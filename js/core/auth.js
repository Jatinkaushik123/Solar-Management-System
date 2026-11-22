/**
 * Bijli Wala SIMS — Supabase Authentication & RBAC Guard
 * Signs in through the hosted Supabase Auth + /v1/me portal gate
 * (js/core/identity-client.mjs), keeps the session (tokens + profile only,
 * never the password) in sessionStorage across page navigations, refreshes
 * the access token, and exposes an authorised API request helper.
 */
window.BW = window.BW || {};

(() => {
  "use strict";

  const ROLES = {
    admin: {
      role: "admin",
      label: "Admin",
      modules: [
        "Dashboard",
        "Surveys",
        "Quotations",
        "Inventory",
        "Projects",
        "Warranty",
        "Users",
      ],
      write: [
        "Dashboard",
        "Surveys",
        "Quotations",
        "Inventory",
        "Projects",
        "Warranty",
        "Users",
      ],
      actions: [
        "finance",
        "approveSurvey",
        "rejectSurvey",
        "assignCrew",
        "handover",
        "addInventory",
        "dispatch",
        "manageUsers",
        "createQuote",
        "resetDemo",
      ],
      defaultLanding: "dashboard.html",
    },
    tech: {
      role: "tech",
      label: "Technician",
      modules: ["Dashboard", "Surveys", "Projects", "Warranty"],
      write: ["Surveys", "Projects", "Warranty"],
      actions: ["approveSurvey", "rejectSurvey", "assignCrew", "handover"],
      defaultLanding: "surveys.html",
    },
    sales: {
      role: "sales",
      label: "Sales",
      modules: ["Dashboard", "Quotations", "Surveys", "Inventory", "Projects"],
      write: ["Quotations", "Surveys", "Projects"],
      actions: ["createQuote", "finance"],
      defaultLanding: "quotations.html",
    },
    inventory: {
      role: "inventory",
      label: "Inventory Keeper",
      modules: ["Dashboard", "Inventory", "Projects"],
      write: ["Inventory"],
      actions: ["addInventory", "dispatch"],
      defaultLanding: "inventory.html",
    },
    customer: {
      role: "customer",
      label: "Customer",
      modules: ["My Solar Home", "Site Surveys", "My Quotations", "Installation & Warranty"],
      write: ["My Solar Home", "Site Surveys", "My Quotations", "Installation & Warranty"],
      actions: ["submitSurvey", "acceptQuote", "viewPortal"],
      defaultLanding: "customer-overview.html",
    },
  };

  const DEFAULT_USERS = [
    {
      id: "USR-001",
      email: "admin@bijliwala.in",
      name: "Arjun Mehta",
      role: "admin",
      phone: "9820011223",
      city: "Ahmedabad",
      status: "Active",
      joinedDate: "2025-01-10",
    },
    {
      id: "USR-002",
      email: "tech@bijliwala.in",
      name: "Kavita Iyer",
      role: "tech",
      phone: "9820022334",
      city: "Surat",
      status: "Active",
      joinedDate: "2025-02-15",
    },
    {
      id: "USR-003",
      email: "sales@bijliwala.in",
      name: "Rajesh Sharma",
      role: "sales",
      phone: "9820033445",
      city: "Vadodara",
      status: "Active",
      joinedDate: "2025-03-01",
    },
    {
      id: "USR-004",
      email: "inventory@bijliwala.in",
      name: "Imran Khan",
      role: "inventory",
      phone: "9820044556",
      city: "Pune",
      status: "Active",
      joinedDate: "2025-03-12",
    },
    {
      id: "USR-005",
      email: "customer@bijliwala.in",
      name: "Amit Kumar",
      role: "customer",
      phone: "9820055667",
      city: "Pune",
      status: "Active",
      joinedDate: "2026-05-18",
    },
  ];

  // Session holds tokens and the server profile only. Passwords never touch storage.
  const SESSION_KEY = "bijli-wala.auth.v1";
  const REFRESH_MARGIN_S = 60;

  // identity-client.mjs sits next to this file; resolve it from this script's URL
  // so pages in /pages/ and the root login page both load it.
  const CLIENT_URL = new URL("./identity-client.mjs?v=2", document.currentScript?.src || location.href).href;
  let clientPromise = null;
  const loadModule = () => (clientPromise ||= import(CLIENT_URL));

  /* ---------- Backend target: hosted Supabase v10 by default ----------
     Optional local override (e.g. `supabase start` + `supabase functions serve`):
       window.__BW_SUPABASE__ = { url: "http://127.0.0.1:54321", publishableKey: "<local key>" }
     or, persisted for this browser:
       localStorage.setItem("bw_supabase_override", JSON.stringify({ url, publishableKey }))
     Only localhost / 127.0.0.1 URLs or the hosted project are accepted, so a stray value
     can't send tokens to another host. Remove the key to return to the hosted API. */
  const HOSTED_HOST = "ngutqpqlmzgxpwkamilj.supabase.co";
  function readOverride() {
    let o = window.__BW_SUPABASE__;
    if (!o) {
      try {
        o = JSON.parse(localStorage.getItem("bw_supabase_override") || "null");
      } catch {
        o = null;
      }
    }
    if (!o || typeof o.url !== "string" || typeof o.publishableKey !== "string" || !o.publishableKey) return null;
    let u;
    try {
      u = new URL(o.url);
    } catch {
      return null;
    }
    const local = u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname);
    const hosted = u.protocol === "https:" && u.hostname === HOSTED_HOST;
    if (!local && !hosted) {
      console.warn("[bijli-wala] Ignoring bw_supabase_override: only localhost or the hosted project are allowed.");
      return null;
    }
    return { url: u.origin, publishableKey: o.publishableKey };
  }

  /** Same contract as identity-client.mjs request(), with the active project's key. */
  function makeRequest(publishableKey) {
    return async function request(url, { method = "GET", token, body, idempotencyKey, signal } = {}) {
      const headers = { apikey: publishableKey };
      if (token) headers.Authorization = "Bearer " + token;
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(url, { method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const code = data?.error?.code || data?.error_code || (typeof data?.code === "string" ? data.code : "request_failed");
        throw Object.assign(new Error(code), { status: response.status, code });
      }
      return data;
    };
  }

  let configPromise = null;
  /** Active backend: { SUPABASE_URL, PUBLISHABLE_KEY, API_BASE, request, local }. */
  function client() {
    return (configPromise ||= loadModule().then((m) => {
      const o = readOverride();
      const SUPABASE_URL = o ? o.url : m.SUPABASE_URL;
      const PUBLISHABLE_KEY = o ? o.publishableKey : m.PUBLISHABLE_KEY;
      return {
        SUPABASE_URL,
        PUBLISHABLE_KEY,
        API_BASE: SUPABASE_URL + "/functions/v1/api",
        request: o ? makeRequest(PUBLISHABLE_KEY) : m.request,
        local: !!o,
      };
    }));
  }

  /** Auth helpers mirroring identity-client.mjs, bound to the active backend. */
  async function authApi() {
    const c = await client();
    const signOut = (token, signal = AbortSignal.timeout(2000)) =>
      c.request(c.SUPABASE_URL + "/auth/v1/logout?scope=local", { method: "POST", token, signal });
    const getMe = (token, portal) =>
      c.request(c.API_BASE + "/v1/me" + (portal ? "?portal=" + encodeURIComponent(portal) : ""), { token });
    return {
      signOut,
      getMe,
      signUpCustomer: (email, password, displayName = "") =>
        c.request(c.SUPABASE_URL + "/auth/v1/signup", { method: "POST", body: { email, password, data: { display_name: displayName } } }),
      async signIn(portal, email, password) {
        if (portal !== "customer" && portal !== "staff") throw new Error("invalid_portal");
        const session = await c.request(c.SUPABASE_URL + "/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } }).catch((error) => {
          // Older Auth responses may report invalid credentials with only a 400 status.
          if (error.status === 400 && error.code === "request_failed") error.code = "invalid_credentials";
          throw error;
        });
        try {
          return { session, me: await getMe(session.access_token, portal) };
        } catch (error) {
          await signOut(session.access_token).catch(() => {});
          throw error;
        }
      },
    };
  }

  /** The API's session-failure code. Business 401s (e.g. invalid_signature) are not session failures. */
  const isSessionFailure = (err) => err?.status === 401 && (err.code === "unauthenticated" || err.code === "not_signed_in");
  /** Auth refresh rejected (revoked/expired refresh token), as opposed to a network blip. */
  const isRefreshRejected = (err) => err?.status === 400 || err?.status === 401 || err?.code === "not_signed_in";

  /** Backend role -> UI role key. The one place this mapping lives. */
  const BACKEND_TO_UI_ROLE = { technician: "tech" };
  function toUiRole(backendRole) {
    const r = String(backendRole || "").toLowerCase();
    return BACKEND_TO_UI_ROLE[r] || (ROLES[r] ? r : "customer");
  }

  function getStorage() {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  }

  function readSession() {
    try {
      const raw = getStorage()?.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeSession(sess) {
    if (sess) {
      if (!loggingOut) getStorage()?.setItem(SESSION_KEY, JSON.stringify(sess));
    } else {
      getStorage()?.removeItem(SESSION_KEY);
    }
  }

  function sessionFromAuth(authSession, me) {
    const expiresAt =
      authSession.expires_at || Math.floor(Date.now() / 1000) + Number(authSession.expires_in || 3600);
    return {
      access_token: authSession.access_token,
      refresh_token: authSession.refresh_token,
      expires_at: expiresAt,
      user: {
        id: me.id,
        email: me.email,
        name: me.display_name || me.email,
        backendRole: me.role,
        role: toUiRole(me.role),
        portal: me.portal,
        actions: me.actions || [],
      },
    };
  }

  /** Synchronous current-user view used by every page (guard, layout, RBAC). */
  function current() {
    const sess = readSession();
    if (!sess?.user) return null;
    const roleDef = ROLES[sess.user.role] || ROLES.customer;
    return {
      id: sess.user.id,
      email: sess.user.email,
      name: sess.user.name,
      role: sess.user.role,
      backendRole: sess.user.backendRole,
      portal: sess.user.portal,
      serverActions: sess.user.actions,
      roleLabel: roleDef.label,
      phone: "",
      city: "",
      defaultLanding: roleDef.defaultLanding,
    };
  }

  /**
   * Sign in through a portal gate. portal: "customer" | "staff".
   * Throws an Error with .status/.code from the API on failure.
   */
  async function login(portal, email, password) {
    const { signIn } = await authApi();
    const { session, me } = await signIn(portal, String(email || "").trim(), password);
    writeSession(sessionFromAuth(session, me));
    return current();
  }

  /** Customer self-registration with the same portal gate as password sign-in. */
  async function signupCustomer({ name, email, password }) {
    const { signUpCustomer, getMe, signOut } = await authApi();
    const session = await signUpCustomer(String(email || "").trim(), password, String(name || "").trim());
    if (!session?.access_token) {
      const code = session?.identities?.length === 0 ? "user_already_exists" : "email_confirmation_required";
      throw Object.assign(new Error(code), { code });
    }
    try {
      const me = await getMe(session.access_token, "customer");
      writeSession(sessionFromAuth(session, me));
      return current();
    } catch (error) {
      await signOut(session.access_token).catch(() => {});
      throw error;
    }
  }

  function loginUrl() {
    return location.pathname.includes("/pages/") ? "../index.html" : "index.html";
  }

  /* ---------- Deep links survive sign-in ----------
     A signed-out visit to e.g. pages/customer-quotations.html?quote=<uuid> is sent
     to the login page with ?next=<that path>; the target is also kept in
     sessionStorage (bw_post_login_redirect). After sign-in the user lands there. */
  const REDIRECT_KEY = "bw_post_login_redirect";
  const SAFE_TARGET = /^pages\/[a-z0-9-]+\.html(\?[^#\s]*)?$/i;

  function currentTarget() {
    const m = location.pathname.match(/\/pages\/([a-z0-9-]+\.html)$/i);
    return m ? `pages/${m[1]}${location.search}` : null;
  }

  /** Go to the login page, remembering where the user was headed. */
  function sendToLogin() {
    if (loggingOut) return; // logout is already navigating to the login screen
    const target = currentTarget();
    let url = loginUrl();
    if (target) {
      getStorage()?.setItem(REDIRECT_KEY, target);
      url += "?next=" + encodeURIComponent(target);
    }
    location.replace(url);
  }

  /**
   * After sign-in: the saved target (from ?next= or sessionStorage), if it is a
   * same-site app page this role may open. Always clears the saved target.
   * Ownership (403/404) is still enforced by the API on the target page.
   */
  function takeRedirect(user) {
    const fromQuery = new URLSearchParams(location.search).get("next");
    const saved = getStorage()?.getItem(REDIRECT_KEY);
    getStorage()?.removeItem(REDIRECT_KEY);
    const target = fromQuery || saved;
    if (!target || !SAFE_TARGET.test(target) || !user) return null;
    const isCustomerPage = /^pages\/customer-/i.test(target);
    if ((user.role === "customer") !== isCustomerPage) return null; // wrong portal's page
    return target;
  }

  /* ---------- Logout ----------
     Always ends locally, whatever the network does:
       1. mark logging-out (in-flight API calls stop redirecting/saving targets),
       2. try the remote revoke for at most 2 s (expired token / offline / CORS ignored),
       3. finally clear every per-user key and replace the page with the login screen. */
  let loggingOut = false;

  /** Remove every per-user browser key (keeps local demo data and the dev override). */
  function clearUserState() {
    const userKey = (k) =>
      k === SESSION_KEY ||
      k === REDIRECT_KEY ||
      k.startsWith("bijli-wala.idem.") ||
      k.startsWith("bijli-wala.evidence.") ||
      /^(?:bw[_.-]|bijli-wala\.)(?:auth|session|user|redirect|post_login_redirect)(?:[_.-]|$)/i.test(k) ||
      k === "supabase.auth.token" ||
      /^sb-.+-auth-token/.test(k);
    for (const storageName of ["sessionStorage", "localStorage"]) {
      try {
        const store = window[storageName];
        for (const k of Object.keys(store)) if (userKey(k)) store.removeItem(k);
      } catch {
        /* storage unavailable */
      }
    }
  }

  async function logout() {
    if (loggingOut) return;
    loggingOut = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const sess = readSession();
      if (sess?.access_token) {
        // The clock includes loading the auth module as well as the network request.
        const aborted = new Promise((resolve) => controller.signal.addEventListener("abort", resolve, { once: true }));
        const revoke = authApi().then(({ signOut }) => signOut(sess.access_token, controller.signal));
        await Promise.race([revoke, aborted]);
      }
    } catch {
      // Expired token (401), offline, CORS or timeout: the local session still ends.
    } finally {
      clearTimeout(timeout);
      clearUserState();
      location.replace(loginUrl());
    }
  }

  window.addEventListener("pageshow", (event) => {
    // A protected page restored from the back-forward cache has already run its guard.
    if (event.persisted && currentTarget() && !readSession()) location.replace(loginUrl());
  });

  // Single-flight refresh: parallel requests near expiry share one refresh call,
  // because Supabase rotates refresh tokens and reusing an old one can revoke the session.
  let refreshing = null;
  function refreshSession(sess) {
    if (!refreshing) {
      refreshing = doRefresh(sess).finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function doRefresh(sess) {
    // Another tab may already have refreshed: use the newest stored token.
    const latest = readSession();
    if (latest?.refresh_token && latest.refresh_token !== sess.refresh_token && latest.expires_at - Date.now() / 1000 > REFRESH_MARGIN_S) {
      return latest;
    }
    const { SUPABASE_URL, request } = await client();
    const data = await request(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: sess.refresh_token },
    });
    const next = {
      ...sess,
      access_token: data.access_token,
      refresh_token: data.refresh_token || sess.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    };
    writeSession(next);
    return next;
  }

  async function validSession() {
    let sess = readSession();
    if (!sess) throw Object.assign(new Error("not_signed_in"), { status: 401, code: "not_signed_in" });
    if (sess.expires_at && sess.expires_at - Date.now() / 1000 < REFRESH_MARGIN_S) {
      sess = await refreshSession(sess);
    }
    return sess;
  }

  /**
   * Authorised call to the hosted API (path under API_BASE, e.g. "/v1/quotes/<id>").
   * Refreshes an expiring token, retries once after a 401, and sends the user back
   * to sign in if the session cannot be recovered.
   */
  async function apiRequest(path, { method = "GET", body, idempotencyKey } = {}) {
    const { API_BASE, request } = await client();
    let sess;
    try {
      sess = await validSession();
    } catch (err) {
      // Only a rejected/missing session signs the user out; a network error is just thrown.
      if (isRefreshRejected(err)) {
        writeSession(null);
        sendToLogin();
      }
      throw err;
    }
    const send = (token) => request(API_BASE + path, { method, token, body, idempotencyKey });
    try {
      return await send(sess.access_token);
    } catch (err) {
      // e.g. 401 invalid_signature from /verify is a business error, not an expired session.
      if (!isSessionFailure(err)) throw err;
      let fresh;
      try {
        fresh = await refreshSession(sess);
      } catch (refreshErr) {
        if (isRefreshRejected(refreshErr)) {
          writeSession(null);
          sendToLogin();
        }
        throw refreshErr;
      }
      try {
        return await send(fresh.access_token);
      } catch (retryErr) {
        if (isSessionFailure(retryErr)) {
          writeSession(null);
          sendToLogin();
        }
        throw retryErr;
      }
    }
  }

  /** Authorised raw fetch under API_BASE (e.g. CSV downloads). Returns the Response. */
  async function apiFetch(path) {
    const { API_BASE, PUBLISHABLE_KEY } = await client();
    const sess = await validSession();
    const res = await fetch(API_BASE + path, {
      headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + sess.access_token },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw Object.assign(new Error(data?.error?.code || "request_failed"), { status: res.status, code: data?.error?.code });
    }
    return res;
  }

  /**
   * Private Supabase Storage with the signed-in session (installation evidence).
   * upload: write-once object (x-upsert false). download: returns a Blob.
   */
  async function storageUpload(bucket, path, file) {
    const { SUPABASE_URL, PUBLISHABLE_KEY } = await client();
    const sess = await validSession();
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: "Bearer " + sess.access_token,
        "Content-Type": file.type,
        "x-upsert": "false",
      },
      body: file,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw Object.assign(new Error(data?.error || data?.message || "upload_failed"), { status: res.status, code: data?.error || "upload_failed" });
    }
    return path;
  }
  async function storageDownload(bucket, path) {
    const { SUPABASE_URL, PUBLISHABLE_KEY } = await client();
    const sess = await validSession();
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${path}`, {
      headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + sess.access_token },
    });
    if (!res.ok) throw Object.assign(new Error("download_failed"), { status: res.status });
    return res.blob();
  }

  /**
   * Idempotency keys: one UUID per user action, reused if that action is retried
   * (stored in sessionStorage under the action name), cleared after success.
   */
  function idempotencyKey(action) {
    const k = "bijli-wala.idem." + action;
    let key = getStorage()?.getItem(k);
    if (!key) {
      key = crypto.randomUUID();
      getStorage()?.setItem(k, key);
    }
    return key;
  }
  function clearIdempotencyKey(action) {
    getStorage()?.removeItem("bijli-wala.idem." + action);
  }

  function canWrite(module) {
    const user = current();
    if (!user) return false;
    const roleDef = ROLES[user.role];
    return roleDef ? roleDef.write.includes(module) : false;
  }

  function can(action) {
    const user = current();
    if (!user) return false;
    const roleDef = ROLES[user.role];
    return roleDef ? roleDef.actions.includes(action) : false;
  }

  function getAccessibleModules() {
    const user = current();
    if (!user) return [];
    const roleDef = ROLES[user.role];
    return roleDef ? roleDef.modules : [];
  }

  function guard(requiredModule) {
    const user = current();
    const inPages = location.pathname.includes("/pages/");

    if (!user) {
      sendToLogin();
      return false;
    }

    if (requiredModule) {
      const allowed = getAccessibleModules();
      if (!allowed.includes(requiredModule)) {
        // Redirect unauthorized user to their primary landing page
        const landing = user.defaultLanding || "dashboard.html";
        const redirectUrl = inPages ? landing : `pages/${landing}`;
        location.replace(redirectUrl);
        return false;
      }
    }
    return true;
  }

  BW.auth = {
    roles: ROLES,
    defaultUsers: DEFAULT_USERS,
    toUiRole,
    current,
    login,
    signupCustomer,
    logout,
    request: apiRequest,
    backend: () => client().then((c) => ({ supabaseUrl: c.SUPABASE_URL, apiBase: c.API_BASE, local: c.local })),
    fetchRaw: apiFetch,
    storageUpload,
    storageDownload,
    takeRedirect,
    idempotencyKey,
    clearIdempotencyKey,
    canWrite,
    can,
    getAccessibleModules,
    guard,
  };
})();
