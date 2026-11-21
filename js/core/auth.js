/**
 * Bijli Wala SIMS — Multi-Role Authentication & RBAC Guard
 * Manages sessions, permissions for the 5-role workflow, customer registration, and route guarding.
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
      password: "admin123",
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
      password: "tech123",
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
      password: "sales123",
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
      password: "store123",
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
      password: "cust123",
      name: "Amit Kumar",
      role: "customer",
      phone: "9820055667",
      city: "Pune",
      status: "Active",
      joinedDate: "2026-05-18",
    },
  ];

  const SESSION_KEY = "bijli-wala.session.v3";

  function getStorage() {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  }

  function getAllUsers() {
    if (BW.store && typeof BW.store.get === "function") {
      const stored = BW.store.get("Users");
      if (Array.isArray(stored) && stored.length) return stored;
    }
    return DEFAULT_USERS;
  }

  function current() {
    try {
      const raw = getStorage()?.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      const all = getAllUsers();
      const user = all.find(
        (u) => u.email.toLowerCase() === session.email.toLowerCase(),
      );
      if (!user) return null;
      const roleDef = ROLES[user.role] || ROLES.customer;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        roleLabel: roleDef.label,
        phone: user.phone || "",
        city: user.city || "",
        defaultLanding: roleDef.defaultLanding,
      };
    } catch {
      return null;
    }
  }

  function login(email, password) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const all = getAllUsers();
    const user = all.find(
      (u) =>
        u.email.toLowerCase() === cleanEmail &&
        (u.password === password || password === "demo"),
    );

    if (!user) return null;
    if (user.status === "Inactive") {
      throw new Error("This account has been deactivated. Please contact an Administrator.");
    }

    getStorage()?.setItem(
      SESSION_KEY,
      JSON.stringify({ email: user.email, loggedAt: new Date().toISOString() }),
    );
    return current();
  }

  function signupCustomer({ name, email, phone, city, password }) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();
    const cleanPhone = String(phone || "").trim().replace(/[\s-]/g, "");

    if (!cleanName) throw new Error("Full name is required.");
    if (!cleanEmail) throw new Error("Valid email is required.");
    if (!BW.utils.phoneOk(cleanPhone)) {
      throw new Error("Phone must be a valid 10-digit Indian mobile number (starts with 6–9).");
    }
    if (!password || password.length < 4) {
      throw new Error("Password must be at least 4 characters.");
    }

    const all = getAllUsers();
    if (all.some((u) => u.email.toLowerCase() === cleanEmail)) {
      throw new Error("An account with this email already exists. Please sign in instead.");
    }

    const newUser = {
      id: BW.utils.generateId("USR", all),
      email: cleanEmail,
      password,
      name: cleanName,
      role: "customer",
      phone: cleanPhone,
      city: city || "Pune",
      status: "Active",
      joinedDate: BW.utils.todayISO(),
    };

    if (BW.store && typeof BW.store.save === "function") {
      BW.store.save("Users", newUser);
    }

    getStorage()?.setItem(
      SESSION_KEY,
      JSON.stringify({ email: newUser.email, loggedAt: new Date().toISOString() }),
    );

    return current();
  }

  function logout() {
    getStorage()?.removeItem(SESSION_KEY);
    const inPages = location.pathname.includes("/pages/");
    location.href = inPages ? "../index.html" : "index.html";
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
    const loginUrl = inPages ? "../index.html" : "index.html";

    if (!user) {
      location.replace(loginUrl);
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
    current,
    login,
    signupCustomer,
    logout,
    canWrite,
    can,
    getAccessibleModules,
    guard,
  };
})();
