/**
 * Bijli Wala SIMS — Login & Self Sign-Up Controller
 * Handles 5-role authentication, customer registration, Google Auth demo simulation, and quick role switching.
 */
(() => {
  "use strict";

  // If already logged in, redirect to user's landing page
  const currentUser = BW.auth.current();
  if (currentUser) {
    location.replace(`pages/${currentUser.defaultLanding || "dashboard.html"}`);
    return;
  }

  // Populate data-icon SVGs
  document.querySelectorAll("[data-icon]").forEach((node) => {
    node.replaceChildren(BW.ui.icon(node.dataset.icon));
  });

  const tabLogin = document.querySelector("#tab-login");
  const tabAdmin = document.querySelector("#tab-admin");
  const googleBtn = document.querySelector("#google-auth-btn");

  const loginForm = document.querySelector("#login-form");
  const signupForm = document.querySelector("#signup-form");
  const toggleSignupBtn = document.querySelector("#toggle-signup");
  const backToLoginBtn = document.querySelector("#back-to-login");

  const emailInput = document.querySelector("#email");
  const passwordInput = document.querySelector("#password");
  const toggleVisibilityBtn = document.querySelector("#visibility");
  const loginError = document.querySelector(".login-error");
  const signupError = document.querySelector(".signup-error");
  const demoPills = document.querySelector(".demo-pills");

  // Tab switching (Login vs Admin)
  tabLogin?.addEventListener("click", () => {
    tabLogin.classList.add("active");
    tabLogin.setAttribute("aria-selected", "true");
    tabAdmin.classList.remove("active");
    tabAdmin.setAttribute("aria-selected", "false");
    emailInput.placeholder = "Email or EmployeeID";
    emailInput.value = "";
    passwordInput.value = "";
  });

  tabAdmin?.addEventListener("click", () => {
    tabAdmin.classList.add("active");
    tabAdmin.setAttribute("aria-selected", "true");
    tabLogin.classList.remove("active");
    tabLogin.setAttribute("aria-selected", "false");
    emailInput.value = "admin@bijliwala.in";
    passwordInput.value = "admin123";
    loginError.hidden = true;
  });

  // Google OAuth demo simulation
  googleBtn?.addEventListener("click", () => {
    try {
      const user = BW.auth.login("customer@bijliwala.in", "cust123");
      if (user) {
        location.assign(`pages/${user.defaultLanding}`);
      }
    } catch (e) {
      loginError.hidden = false;
      loginError.textContent = e.message;
    }
  });

  // Toggle Signup Form
  toggleSignupBtn?.addEventListener("click", () => {
    loginForm.hidden = true;
    signupForm.hidden = false;
    signupError.hidden = true;
    document.querySelector("#signup-name")?.focus();
  });

  backToLoginBtn?.addEventListener("click", () => {
    signupForm.hidden = true;
    loginForm.hidden = false;
    loginError.hidden = true;
    emailInput.focus();
  });

  // Password visibility toggle
  toggleVisibilityBtn?.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    toggleVisibilityBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
    toggleVisibilityBtn.replaceChildren(BW.ui.icon(isPassword ? "eye-off" : "eye"));
  });

  // Login form submission
  loginForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    loginError.hidden = true;

    try {
      const user = BW.auth.login(emailInput.value, passwordInput.value);
      if (user) {
        location.assign(`pages/${user.defaultLanding || "dashboard.html"}`);
      } else {
        loginError.hidden = false;
        loginError.textContent =
          "Invalid email or password. Click one of the demo role cards below to sign in instantly.";
      }
    } catch (err) {
      loginError.hidden = false;
      loginError.textContent = err.message;
    }
  });

  loginForm?.addEventListener("input", () => {
    loginError.hidden = true;
  });

  // Customer Self Sign-up form submission
  signupForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    signupError.hidden = true;

    const name = document.querySelector("#signup-name").value;
    const email = document.querySelector("#signup-email").value;
    const phone = document.querySelector("#signup-phone").value;
    const city = document.querySelector("#signup-city").value;
    const password = document.querySelector("#signup-password").value;

    try {
      const user = BW.auth.signupCustomer({ name, email, phone, city, password });
      if (user) {
        location.assign(`pages/${user.defaultLanding || "customer-overview.html"}`);
      }
    } catch (err) {
      signupError.hidden = false;
      signupError.textContent = err.message;
    }
  });

  // Render 5 Demo Role Pills
  const rolesInfo = [
    {
      role: "admin",
      label: "Admin",
      email: "admin@bijliwala.in",
      pass: "admin123",
      name: "Arjun Mehta",
    },
    {
      role: "tech",
      label: "Technician",
      email: "tech@bijliwala.in",
      pass: "tech123",
      name: "Kavita Iyer",
    },
    {
      role: "sales",
      label: "Sales",
      email: "sales@bijliwala.in",
      pass: "sales123",
      name: "Rajesh Sharma",
    },
    {
      role: "inventory",
      label: "Inventory",
      email: "inventory@bijliwala.in",
      pass: "store123",
      name: "Imran Khan",
    },
    {
      role: "customer",
      label: "Customer",
      email: "customer@bijliwala.in",
      pass: "cust123",
      name: "Amit Kumar",
    },
  ];

  if (demoPills) {
    rolesInfo.forEach((item) => {
      const pill = BW.ui.el("button", "demo-pill");
      pill.type = "button";
      pill.setAttribute("aria-label", `Sign in as ${item.label} (${item.name})`);

      const topRow = BW.ui.el("div", "demo-pill-top");
      topRow.append(BW.ui.roleBadge(item.role), BW.ui.el("strong", "", item.name));

      const subRow = BW.ui.el("span", "demo-pill-meta", `${item.email}`);
      pill.append(topRow, subRow);

      pill.onclick = () => {
        try {
          const user = BW.auth.login(item.email, item.pass);
          if (user) {
            location.assign(`pages/${user.defaultLanding}`);
          }
        } catch (e) {
          loginError.hidden = false;
          loginError.textContent = e.message;
        }
      };

      demoPills.append(pill);
    });
  }
})();
