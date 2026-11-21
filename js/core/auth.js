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
  const CLIENT_URL = new URL("./identity-client.mjs", document.currentScript?.src || location.href).href;
  let clientPromise = null;
  const client = () => (clientPromise ||= import(CLIENT_URL));

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
    if (sess) getStorage()?.setItem(SESSION_KEY, JSON.stringify(sess));
    else getStorage()?.removeItem(SESSION_KEY);
  }

  function sessionFromAuth(authSession, me, profile) {
    const expiresAt =
      authSession.expires_at || Math.floor(Date.now() / 1000) + Number(authSession.expires_in || 3600);
    return {
      access_token: authSession.access_token,
      refresh_token: authSession.refresh_token,
      expires_at: expiresAt,
      user: {
        id: me.id,
        email: me.email,
        name: profile?.display_name || me.display_name || me.email,
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
    const { signIn, getProfile } = await client();
    const { session, me } = await signIn(portal, String(email || "").trim(), password);
    const profile = await getProfile(session.access_token, me.id).catch(() => null);
    writeSession(sessionFromAuth(session, me, profile));
    return current();
  }

  /** Customer self-registration. Supabase requires email confirmation before sign-in. */
  async function signupCustomer({ name, email, password }) {
    const { signUpCustomer } = await client();
    return signUpCustomer(String(email || "").trim(), password, String(name || "").trim());
  }

  function loginUrl() {
    return location.pathname.includes("/pages/") ? "../index.html" : "index.html";
  }

  async function logout() {
    const sess = readSession();
    writeSession(null);
    if (sess?.access_token) {
      try {
        const { signOut } = await client();
        await signOut(sess.access_token);
      } catch {
        // Already expired or offline: the local session is cleared either way.
      }
    }
    location.href = loginUrl();
  }

  async function refreshSession(sess) {
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
    let sess = await validSession().catch(() => null);
    if (!sess) {
      writeSession(null);
      location.replace(loginUrl());
      throw Object.assign(new Error("not_signed_in"), { status: 401, code: "not_signed_in" });
    }
    const send = (token) => request(API_BASE + path, { method, token, body, idempotencyKey });
    try {
      return await send(sess.access_token);
    } catch (err) {
      if (err.status !== 401) throw err;
      try {
        sess = await refreshSession(sess);
        return await send(sess.access_token);
      } catch (retryErr) {
        if (retryErr.status === 401 || retryErr === err) {
          writeSession(null);
          location.replace(loginUrl());
        }
        throw retryErr;
      }
    }
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
      location.replace(loginUrl());
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
    idempotencyKey,
    clearIdempotencyKey,
    canWrite,
    can,
    getAccessibleModules,
    guard,
  };
})();
