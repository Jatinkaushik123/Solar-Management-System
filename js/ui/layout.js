/**
 * Bijli Wala SIMS — AppShell Layout & Navigation
 * Dynamic role-based sidebar with sunset scrim, top header, breadcrumbs, and Ctrl+K search palette.
 */
window.BW = window.BW || {};

(() => {
  "use strict";

  const MODULE_ICONS = {
    Dashboard: "layout-dashboard",
    "My Solar Home": "sun",
    "Site Surveys": "clipboard-list",
    "My Quotations": "file-text",
    "Installation & Warranty": "shield-check",
    Surveys: "clipboard-list",
    Quotations: "file-text",
    Projects: "folder-kanban",
    Inventory: "boxes",
    Warranty: "shield-check",
    Users: "users",
  };

  const MODULE_URLS = {
    Dashboard: "dashboard.html",
    "My Solar Home": "customer-overview.html",
    "Site Surveys": "customer-surveys.html",
    "My Quotations": "customer-quotations.html",
    "Installation & Warranty": "customer-warranty.html",
    Surveys: "surveys.html",
    Quotations: "quotations.html",
    Projects: "projects.html",
    Inventory: "inventory.html",
    Warranty: "warranty.html",
    Users: "users.html",
  };

  function commandPalette() {
    if (document.querySelector("dialog[open]")) return;

    const { dialog, body } = BW.ui.modal("Search workspace", "spotlight");
    const searchBox = BW.ui.el("label", "search-box");
    const input = BW.ui.el("input");
    const list = BW.ui.el("div", "results");
    const hint = BW.ui.el("footer", "", "↑ ↓ to navigate · Enter to open · Esc to close");

    list.id = "command-options";
    list.setAttribute("role", "listbox");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-label", "Search workspace records");
    input.placeholder = "Find a module, customer, project or serial number…";

    searchBox.append(BW.ui.icon("search"), input);
    body.append(searchBox, list, hint);

    let active = 0;
    let items = [];

    function select(i) {
      if (!items.length) return;
      active = (i + items.length) % items.length;
      Array.from(list.children).forEach((child, j) => {
        child.setAttribute("aria-selected", String(j === active));
      });
      input.setAttribute("aria-activedescendant", `result-${active}`);
      list.children[active]?.scrollIntoView({ block: "nearest" });
    }

    function choose(i) {
      const item = items[i];
      if (!item) return;
      dialog.close();
      if (item.url) {
        location.href = item.url;
      } else if (item.action) {
        item.action();
      }
    }

    function update() {
      const q = input.value.trim().toLowerCase();
      const accessibleModules = BW.auth.getAccessibleModules();
      const allData = BW.store.getAll();

      // Module navigation matches
      const modMatches = accessibleModules
        .filter((m) => m.toLowerCase().includes(q))
        .map((m) => ({
          title: m,
          detail: "Go to module view",
          iconName: MODULE_ICONS[m] || "file-text",
          url: MODULE_URLS[m] || "dashboard.html",
        }));

      // Record matches across accessible data
      const recordMatches = [];
      for (const m of accessibleModules) {
        const rows = allData[m] || [];
        for (const row of rows) {
          const matchTarget = [
            row.id,
            row.status,
            row.Customer,
            row["Project name"],
            row["Item name"],
            row["Serial number"],
            row.City,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          if (matchTarget.includes(q)) {
            const title =
              row.Customer ||
              row["Project name"] ||
              row["Item name"] ||
              row["Serial number"] ||
              row.id;
            const detail = [row.id, m, row.status, row.City].filter(Boolean).join(" · ");

            recordMatches.push({
              title,
              detail,
              iconName: MODULE_ICONS[m] || "file-text",
              url: MODULE_URLS[m],
              action: () => {
                location.href = `${MODULE_URLS[m]}#${row.id}`;
              },
            });
          }
        }
      }

      items = [...modMatches, ...recordMatches.slice(0, q ? 25 : 6)];
      list.replaceChildren();

      items.forEach((item, i) => {
        const btn = BW.ui.button("", () => choose(i), "");
        btn.tabIndex = -1;
        btn.id = `result-${i}`;
        btn.setAttribute("role", "option");

        const textSpan = BW.ui.el("span", "", item.title);
        textSpan.append(BW.ui.el("small", "", item.detail));

        btn.append(BW.ui.icon(item.iconName), textSpan);
        list.append(btn);
      });

      if (items.length) {
        select(0);
      } else {
        input.removeAttribute("aria-activedescendant");
        list.append(BW.ui.el("p", "empty", "No matching records or navigation items."));
      }
    }

    input.oninput = update;
    input.onkeydown = (e) => {
      if (["ArrowUp", "ArrowDown", "Enter"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "Enter") choose(active);
        else select(active + (e.key === "ArrowDown" ? 1 : -1));
      }
    };

    update();
    input.focus();
  }

  /* ---------- Static solar backdrop behind the workspace ---------- */
  // One fixed, non-interactive layer: warm and teal radial light that the
  // frosted-glass cards blur and refract. No moving tiles or particles.
  function ambientBackground() {
    const bg = BW.ui.el("div", "solar-ambient-bg");
    bg.setAttribute("aria-hidden", "true");
    return bg;
  }

  /* ---------- Top-right circular avatar + dropdown menu ---------- */
  function avatarEl(initials, role, size = 40) {
    const a = BW.ui.el("span", `profile-avatar role-ring-${role || "customer"}`);
    a.style.setProperty("--avatar-size", `${size}px`);
    a.append(BW.ui.el("span", "profile-initials", initials));
    return a;
  }

  function profileMenu(user, initials) {
    const wrap = BW.ui.el("div", "profile-menu");
    const trigger = BW.ui.el("button", "profile-trigger");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", `Account menu for ${user?.name || "user"}`);
    const triggerAvatar = avatarEl(initials, user?.role);
    triggerAvatar.append(BW.ui.el("span", "online-dot"));
    trigger.append(triggerAvatar);

    const menu = BW.ui.el("div", "profile-dropdown");
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    const head = BW.ui.el("div", "profile-head");
    const who = BW.ui.el("div", "profile-who");
    who.append(
      BW.ui.el("strong", "", user?.name || user?.email || "Signed in"),
      BW.ui.el("span", "profile-email", user?.email || ""),
      BW.ui.roleBadge(user?.role || "customer"),
    );
    head.append(avatarEl(initials, user?.role, 48), who);

    const item = (label, glyph, onClick, cls = "") => {
      const b = BW.ui.button(label, onClick, `profile-item ${cls}`, glyph);
      b.setAttribute("role", "menuitem");
      return b;
    };

    const resetBtn = item("Reset Demo Data", "layers", () => {
      if (confirm("Reset SIMS demo data back to factory defaults?")) {
        BW.store.reset();
        BW.ui.toast("Demo data reset successfully!");
        setTimeout(() => location.reload(), 400);
      }
    });
    resetBtn.hidden = user?.role !== "admin";

    const logoutBtn = item("Log Out", "log-out", null, "profile-logout");
    logoutBtn.dataset.action = "logout";

    // Switching account = sign out and sign in again (Supabase session).
    // Admin also keeps Reset Demo Data for the local demo records.
    if (user?.role === "admin") {
      menu.append(head, BW.ui.el("hr"), resetBtn, BW.ui.el("hr"), logoutBtn);
    } else {
      menu.append(head, BW.ui.el("hr"), logoutBtn);
    }
    wrap.append(trigger, menu);

    const setOpen = (open) => {
      menu.hidden = !open;
      wrap.classList.toggle("open", open);
      trigger.setAttribute("aria-expanded", String(open));
    };
    trigger.onclick = (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
      if (!menu.hidden) menu.querySelector(".profile-item:not([hidden])")?.focus();
    };
    document.addEventListener("click", (e) => {
      if (!menu.hidden && !wrap.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        setOpen(false);
        trigger.focus();
      }
    });
    return wrap;
  }

  function renderShell() {
    const currentPage = BW.page || document.body.dataset.page;
    const workspace = document.querySelector("#workspace");
    if (!workspace) return;

    workspace.className = "shell";
    workspace.replaceChildren();

    const user = BW.auth.current();
    const isCustomer = user?.role === "customer";
    const accessibleModules = BW.auth.getAccessibleModules();

    // 1. Mobile Backdrop Scrim
    const scrim = BW.ui.button("", () => toggleMobile(false), "scrim");
    scrim.hidden = true;
    scrim.setAttribute("aria-label", "Close navigation drawer");

    // 2. Sidebar Navigation
    const sidebar = BW.ui.el("aside", "sidebar");
    const brand = BW.ui.el("div", "brand");
    const logo = BW.ui.el("span");
    logo.append(BW.ui.icon("sun", 24));

    const brandText = BW.ui.el("div", "", "Bijli Wala");
    brandText.append(BW.ui.el("small", "", "SOLAR MANAGEMENT"));

    const closeNavBtn = BW.ui.button(
      "",
      () => toggleMobile(false),
      "mobile icon-btn",
      "x",
    );
    closeNavBtn.setAttribute("aria-label", "Close navigation");

    brand.append(logo, brandText, closeNavBtn);

    // The active link is styled directly (no sliding indicator), so the
    // highlight always matches the link no matter how many links a role sees.
    const nav = BW.ui.el("nav");

    accessibleModules.forEach((modName, index) => {
      const isSelected = modName === currentPage;
      const link = BW.ui.el("a", isSelected ? "selected" : "");
      link.href = MODULE_URLS[modName] || "#";
      const iconGlyph = MODULE_ICONS[modName] || "file-text";

      const labelWrap = BW.ui.el("span", "nav-link-label");
      labelWrap.append(BW.ui.icon(iconGlyph), BW.ui.el("span", "", modName));
      link.append(labelWrap);
      if (isSelected) {
        link.setAttribute("aria-current", "page");
        link.append(BW.ui.el("i"));
      }
      nav.append(link);
    });

    // Sidebar footer intentionally empty: the profile lives in the top-right
    // avatar menu, so the sunset artwork shows cleanly.
    const footer = BW.ui.el("div", "sidebar-footer");
    const initials = (user?.name || "User")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    sidebar.append(
      brand,
      BW.ui.el("div", "nav-label", isCustomer ? "My Solar" : "Workspace"),
      nav,
      footer,
    );

    // 3. Main Area & TopHeader
    const mainArea = BW.ui.el("div", "main-area");
    const topHeader = BW.ui.el("header", "top-header");

    const hamburgerBtn = BW.ui.button(
      "",
      () => toggleMobile(true),
      "mobile icon-btn",
      "panel-left",
    );
    hamburgerBtn.setAttribute("aria-label", "Open navigation drawer");
    hamburgerBtn.setAttribute("aria-expanded", "false");

    const crumb = BW.ui.el("div", "crumb");
    crumb.append(
      BW.ui.el("span", "", isCustomer ? "My Solar" : "Workspace"),
      BW.ui.icon("chevron-right", 14),
      currentPage,
    );

    const headerTools = BW.ui.el("div", "header-tools");

    const searchBtn = BW.ui.button(
      "Search workspace",
      commandPalette,
      "global-search",
      "search",
    );
    searchBtn.append(BW.ui.el("kbd", "", "Ctrl K"));

    // Compact live clock, e.g. "21 Nov · 11:41:30 pm", ticking every second.
    const dateSpan = BW.ui.el("span", "date header-clock");
    const clockText = BW.ui.el("time", "");
    dateSpan.append(BW.ui.icon("calendar-days", 15), clockText);
    const tick = () => {
      const now = new Date();
      clockText.dateTime = now.toISOString();
      clockText.textContent =
        now.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) +
        " · " +
        now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };
    tick();
    clearInterval(BW.clockTimer);
    BW.clockTimer = setInterval(tick, 1000);
    window.addEventListener("pagehide", () => clearInterval(BW.clockTimer), { once: true });


    // Customers never see the internal staff search / Ctrl+K palette.
    const profile = profileMenu(user, initials);
    // Role is shown in the avatar menu and by the avatar's coloured ring.
    if (isCustomer) headerTools.append(dateSpan, profile);
    else headerTools.append(searchBtn, dateSpan, profile);
    topHeader.append(hamburgerBtn, crumb, headerTools);

    const contentArea = BW.ui.el("main", "content");
    contentArea.id = "page-content";
    BW.main = contentArea;

    mainArea.append(topHeader, contentArea);
    workspace.append(ambientBackground(), scrim, sidebar, mainArea);

    function toggleMobile(open) {
      sidebar.classList.toggle("visible", open);
      scrim.hidden = !open;
      hamburgerBtn.setAttribute("aria-expanded", String(open));
      if (open) closeNavBtn.focus();
      else hamburgerBtn.focus();
    }

    // Ctrl+K keyboard shortcut listener
    document.addEventListener("keydown", (e) => {
      if (!isCustomer && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        commandPalette();
      }
      if (e.key === "Escape" && sidebar.classList.contains("visible")) {
        toggleMobile(false);
      }
    });
  }

  document.addEventListener("click", (e) => {
    const target = e.target.closest?.('[data-action="logout"], #logout-btn, .logout-btn');
    if (!target) return;
    e.preventDefault();
    target.setAttribute("aria-disabled", "true");
    if (target.lastChild?.nodeType === Node.TEXT_NODE) target.lastChild.textContent = "Signing out…";
    BW.auth.logout();
  }, { capture: true });

  document.addEventListener("DOMContentLoaded", () => {
    BW.page = document.body.dataset.page;
    if (BW.page === "Login") return;

    // RBAC Route Guard
    if (!BW.auth.guard(BW.page)) return;

    renderShell();

    // Call page-specific controller if registered
    if (BW.controllers && typeof BW.controllers[BW.page]?.render === "function") {
      BW.controllers[BW.page].render();
    }
  });

  BW.ui.renderShell = renderShell;
  BW.ui.commandPalette = commandPalette;
})();
