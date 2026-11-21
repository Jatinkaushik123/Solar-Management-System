/**
 * Bijli Wala SIMS — User Management Controller (Admin Only)
 * Manage staff accounts, assign 5 RBAC roles, and control account activation status.
 */
window.BW = window.BW || {};
window.BW.controllers = window.BW.controllers || {};

(() => {
  "use strict";

  let searchQuery = "";
  let roleFilter = "All Roles";
  let statusFilter = "All Status";

  function openUserModal(user = null, onSaved) {
    const isNew = !user || !user.id;
    const { dialog, body } = BW.ui.modal(
      isNew ? "Create Staff / Customer Account" : `Edit Account · ${user.name}`,
      "spotlight",
    );

    const form = BW.ui.el("form");
    const grid = BW.ui.el("div", "form-grid");
    const alertEl = BW.ui.el("p", "form-error");
    alertEl.setAttribute("role", "alert");
    alertEl.hidden = true;

    form.append(
      BW.ui.el(
        "p",
        "form-caption",
        isNew
          ? "Register a new staff member or customer and assign system permissions."
          : `Update credentials, role permissions, or account status for ${user.email}.`,
      ),
      grid,
      alertEl,
    );

    const nameField = BW.ui.field(grid, {
      name: "name",
      label: "Full Name",
      value: user?.name || "",
      required: true,
      placeholder: "e.g. Anish Jain",
    });

    const emailField = BW.ui.field(grid, {
      name: "email",
      label: "Email Address (Work/Personal)",
      type: "email",
      value: user?.email || "",
      required: true,
      placeholder: "user@bijliwala.in",
    });

    const roleOptions = [
      ["admin", "Admin (Full System & Finance Access)"],
      ["tech", "Technician (Surveys & Project Commissioning)"],
      ["sales", "Sales (Quotation Builder & Pricing)"],
      ["inventory", "Inventory Keeper (Stock & Dispatches)"],
      ["customer", "Customer (Self-Service Portal)"],
    ];

    const roleField = BW.ui.field(grid, {
      name: "role",
      label: "System Access Role",
      options: roleOptions,
      value: user?.role || "tech",
      required: true,
    });

    const phoneField = BW.ui.field(grid, {
      name: "phone",
      label: "10-Digit Mobile Number",
      type: "tel",
      value: user?.phone || "",
      placeholder: "98XXXXXXXX",
    });

    const cityField = BW.ui.field(grid, {
      name: "city",
      label: "Base City / Branch",
      options: BW.catalog.lists.cities,
      value: user?.city || "Pune",
      required: true,
    });

    // Sign-in accounts and passwords are managed by Supabase Auth (staff join by
    // admin invitation), so this local directory never stores a password.

    const statusField = BW.ui.field(grid, {
      name: "status",
      label: "Account Status",
      options: ["Active", "Inactive"],
      value: user?.status || "Active",
      required: true,
    });

    const actions = BW.ui.el("div", "modal-actions");
    actions.append(
      BW.ui.button("Cancel", () => dialog.close()),
      BW.ui.button(isNew ? "Create User" : "Save User", null, "primary-btn", "check"),
    );

    form.append(actions);
    body.append(form);

    form.onsubmit = (e) => {
      e.preventDefault();
      alertEl.hidden = true;

      const email = emailField.value.trim().toLowerCase();
      const phone = phoneField.value.trim().replace(/[\s-]/g, "");

      if (phone && !BW.utils.phoneOk(phone)) {
        alertEl.textContent = "Phone must be a valid 10-digit Indian mobile number (starts with 6–9).";
        alertEl.hidden = false;
        return;
      }

      // Check duplicate email
      const allUsers = BW.store.get("Users");
      if (
        isNew &&
        allUsers.some((u) => u.email.toLowerCase() === email)
      ) {
        alertEl.textContent = "An account with this email address already exists.";
        alertEl.hidden = false;
        return;
      }

      try {
        const record = {
          ...(user || {}),
          name: nameField.value.trim(),
          email,
          role: roleField.value,
          phone,
          city: cityField.value,
          status: statusField.value,
          joinedDate: user?.joinedDate || BW.utils.todayISO(),
        };

        BW.store.save("Users", record);
        dialog.close();
        BW.ui.toast(isNew ? "User account created" : "User updated successfully");
        onSaved();
      } catch (err) {
        alertEl.textContent = err.message;
        alertEl.hidden = false;
      }
    };
  }

  function render() {
    const root = document.querySelector("#page-content");
    if (!root) return;
    root.replaceChildren();

    const currentUser = BW.auth.current();
    if (currentUser?.role !== "admin") {
      root.append(
        BW.ui.heading(
          "Access Denied",
          "You must have Administrator privileges to manage staff accounts and roles.",
        ),
      );
      return;
    }

    const users = BW.store.get("Users");

    const headingEl = BW.ui.heading(
      "Users & Role Management",
      "Manage staff accounts, assign 5-role RBAC access privileges, and configure branch teams.",
      BW.ui.button(
        "Add User",
        () => openUserModal(null, render),
        "primary-btn",
        "plus",
      ),
    );

    const filtered = users.filter((u) => {
      const matchesSearch =
        !searchQuery ||
        [u.id, u.name, u.email, u.phone, u.city, u.role]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesRole =
        roleFilter === "All Roles" || u.role === roleFilter;

      const matchesStatus =
        statusFilter === "All Status" || u.status === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });

    const kpiCards = BW.ui.kpis([
      {
        label: "Total Accounts",
        value: users.length,
        icon: "users",
        color: "blue",
        detail: `${filtered.length} in current view`,
      },
      {
        label: "Technicians",
        value: users.filter((u) => u.role === "tech").length,
        icon: "clipboard-list",
        color: "teal",
        detail: "Field & survey engineers",
      },
      {
        label: "Sales Staff",
        value: users.filter((u) => u.role === "sales").length,
        icon: "file-text",
        color: "amber",
        detail: "Quotation & commercial team",
      },
      {
        label: "Inventory Keepers",
        value: users.filter((u) => u.role === "inventory").length,
        icon: "boxes",
        color: "purple",
        detail: "Warehouse & dispatches",
      },
    ]);

    const panel = BW.ui.el("section", "panel");
    const panelHead = BW.ui.el("div", "panel-heading");
    panelHead.append(
      BW.ui.el("h2", "", "User Accounts Register"),
      BW.ui.el("span", "muted", `${filtered.length} accounts`),
    );

    const filterBar = BW.ui.el("div", "filters");

    // Search input
    const searchBox = BW.ui.el("label", "search-box");
    const searchInput = BW.ui.el("input");
    searchInput.placeholder = "Search user by name, email, city...";
    searchInput.value = searchQuery;
    searchInput.oninput = BW.utils.debounce(() => {
      searchQuery = searchInput.value.trim();
      render();
    }, 200);
    searchBox.append(BW.ui.icon("search", 16), searchInput);

    // Role filter
    const roleSelect = BW.ui.el("select");
    roleSelect.add(new Option("All Roles", "All Roles"));
    roleSelect.add(new Option("Admin", "admin"));
    roleSelect.add(new Option("Technician", "tech"));
    roleSelect.add(new Option("Sales", "sales"));
    roleSelect.add(new Option("Inventory Keeper", "inventory"));
    roleSelect.add(new Option("Customer", "customer"));
    roleSelect.value = roleFilter;
    roleSelect.onchange = () => {
      roleFilter = roleSelect.value;
      render();
    };

    // Status filter
    const statusSelect = BW.ui.el("select");
    ["All Status", "Active", "Inactive"].forEach((st) => {
      statusSelect.add(new Option(st, st));
    });
    statusSelect.value = statusFilter;
    statusSelect.onchange = () => {
      statusFilter = statusSelect.value;
      render();
    };

    filterBar.append(searchBox, roleSelect, statusSelect);
    panel.append(panelHead, filterBar);

    const tableEl = BW.ui.table({
      module: "Users",
      rows: filtered,
      columns: [
        {
          key: "id",
          label: "User ID",
          render: (id, row) => {
            return BW.ui.button(id, () => openUserModal(row, render), "id-link");
          },
        },
        { key: "name", label: "Full Name", className: "primary-cell" },
        { key: "email", label: "Email Address" },
        {
          key: "role",
          label: "Assigned Role",
          render: (r) => BW.ui.roleBadge(r),
        },
        { key: "city", label: "Location" },
        {
          key: "status",
          label: "Status",
          render: (st) =>
            BW.ui.el(
              "span",
              `badge ${st === "Active" ? "green" : "red"}`,
              st,
            ),
        },
        {
          key: "joinedDate",
          label: "Joined",
          format: "date",
        },
      ],
      actionsRenderer: (row) => {
        const wrap = BW.ui.el("div", "row-actions");
        const editBtn = BW.ui.button(
          "Edit",
          () => openUserModal(row, render),
          "row-btn",
          "chevron-right",
        );
        editBtn.title = "Edit user role and credentials";
        wrap.append(editBtn);
        return wrap;
      },
      onRowClick: (r) => openUserModal(r, render),
    });

    panel.append(tableEl);
    root.append(headingEl, kpiCards, panel);
  }

  BW.controllers.Users = { render };
})();
