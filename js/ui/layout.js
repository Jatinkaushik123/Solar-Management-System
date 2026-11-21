/**
 * Bijli Wala SIMS — AppShell Layout & Navigation
 * Dynamic role-based sidebar with sunset scrim, top header, breadcrumbs, and Ctrl+K search palette.
 */
window.BW = window.BW || {};
const BW = window.BW;

(() => {
  "use strict";

  const MODULE_ICONS = {
    Dashboard: "layout-dashboard",
    "Customer Portal": "sun",
    Surveys: "clipboard-list",
    Quotations: "file-text",
    Projects: "folder-kanban",
    Inventory: "boxes",
    Warranty: "shield-check",
    Users: "users",
  };

  const MODULE_URLS = {
    Dashboard: "dashboard.html",
    "Customer Portal": "customer-portal.html",
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

  function renderShell() {
    const currentPage = BW.page || document.body.dataset.page;
    const workspace = document.querySelector("#workspace");
    if (!workspace) return;

    workspace.className = "shell";
    workspace.replaceChildren();

    const user = BW.auth.current();
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

    const nav = BW.ui.el("nav");
    const navIndicator = BW.ui.el("span", "nav-indicator");
    nav.append(navIndicator);

    const activeIndex = accessibleModules.indexOf(currentPage);
    if (activeIndex >= 0) {
      nav.style.setProperty("--active-index", activeIndex);
    }

    accessibleModules.forEach((modName, index) => {
      const isSelected = modName === currentPage;
      const link = BW.ui.el("a", isSelected ? "selected" : "");
      link.href = MODULE_URLS[modName] || "#";
      const iconGlyph = MODULE_ICONS[modName] || "file-text";

      link.append(BW.ui.icon(iconGlyph), modName);
      if (isSelected) {
        link.setAttribute("aria-current", "page");
        link.append(BW.ui.el("i"));
      }
      nav.append(link);
    });

    // Sidebar footer: User profile card + Admin Reset Demo
    const footer = BW.ui.el("div", "sidebar-footer");
    const accountCard = BW.ui.el("div", "account");

    const initials = (user?.name || "User")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    const avatar = BW.ui.el("span", "avatar", initials);
    const accountInfo = BW.ui.el("div", "account-name", user?.name || "Demo User");
    accountInfo.append(BW.ui.roleBadge(user?.role || "customer"));

    const logoutBtn = BW.ui.button(
      "",
      () => BW.auth.logout(),
      "icon-btn",
      "log-out",
    );
    logoutBtn.setAttribute("aria-label", "Log out of SIMS");
    logoutBtn.title = "Log out";

    accountCard.append(avatar, accountInfo, logoutBtn);

    const resetBtn = BW.ui.button(
      "Reset Demo Data",
      () => {
        if (confirm("Reset SIMS demo data back to factory defaults?")) {
          BW.store.reset();
          BW.ui.toast("Demo data reset successfully!");
          setTimeout(() => location.reload(), 400);
        }
      },
      "secondary-btn reset-demo",
    );
    resetBtn.hidden = user?.role !== "admin";

    footer.append(accountCard, resetBtn);
    sidebar.append(
      brand,
      BW.ui.el("div", "nav-label", user?.role === "customer" ? "Customer Portal" : "Workspace"),
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
      BW.ui.el("span", "", user?.role === "customer" ? "Portal" : "Workspace"),
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

    const dateSpan = BW.ui.el("span", "date");
    dateSpan.append(
      BW.ui.icon("calendar-days", 15),
      BW.utils.formatDate(new Date()),
    );

    const roleIndicator = BW.ui.roleBadge(user?.role || "customer");

    headerTools.append(searchBtn, dateSpan, roleIndicator);
    topHeader.append(hamburgerBtn, crumb, headerTools);

    const contentArea = BW.ui.el("main", "content");
    contentArea.id = "page-content";
    BW.main = contentArea;

    mainArea.append(topHeader, contentArea);
    workspace.append(scrim, sidebar, mainArea);

    function toggleMobile(open) {
      sidebar.classList.toggle("visible", open);
      scrim.hidden = !open;
      hamburgerBtn.setAttribute("aria-expanded", String(open));
      if (open) closeNavBtn.focus();
      else hamburgerBtn.focus();
    }

    // Ctrl+K keyboard shortcut listener
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        commandPalette();
      }
      if (e.key === "Escape" && sidebar.classList.contains("visible")) {
        toggleMobile(false);
      }
    });
  }

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
