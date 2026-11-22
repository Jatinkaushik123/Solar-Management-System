/** Sign in or register through Supabase Auth and the server's portal gate. */
(() => {
  "use strict";

  const destination = (user) => BW.auth.takeRedirect(user) || `pages/${user.defaultLanding || "dashboard.html"}`;
  const currentUser = BW.auth.current();
  if (currentUser) {
    location.replace(destination(currentUser));
    return;
  }

  document.querySelectorAll("[data-icon]").forEach((node) => {
    node.replaceChildren(BW.ui.icon(node.dataset.icon));
  });

  const tabCustomer = document.querySelector("#tab-login");
  const tabStaff = document.querySelector("#tab-admin");
  const form = document.querySelector("#login-form");
  const customerName = document.querySelector("#customer-name");
  const nameInput = document.querySelector("#display-name");
  const emailInput = document.querySelector("#email");
  const passwordInput = document.querySelector("#password");
  const visibility = document.querySelector("#visibility");
  const errorMessage = document.querySelector(".login-error");
  const submit = form.querySelector(".login-submit");
  const customerDemo = document.querySelector("#customer-demo");
  const staffDemo = document.querySelector("#staff-demo");
  const demoCustomerEmail = "customer@bijliwala.in";
  const demoPassword = "Bijli@123";
  let portal;

  function setPortal(next) {
    if (portal && portal !== next) {
      emailInput.value = "";
      passwordInput.value = "";
    }
    portal = next;
    const isCustomer = next === "customer";
    tabCustomer.classList.toggle("active", isCustomer);
    tabStaff.classList.toggle("active", !isCustomer);
    tabCustomer.setAttribute("aria-selected", String(isCustomer));
    tabStaff.setAttribute("aria-selected", String(!isCustomer));
    customerName.hidden = customerDemo.hidden = !isCustomer;
    staffDemo.hidden = isCustomer;
    emailInput.placeholder = isCustomer ? "you@example.com" : "staff email";
    submit.textContent = isCustomer ? "Sign In / Quick Register" : "Sign In to Staff Portal";
    errorMessage.hidden = true;
  }

  tabCustomer.addEventListener("click", () => setPortal("customer"));
  tabStaff.addEventListener("click", () => setPortal("staff"));
  const next = new URLSearchParams(location.search).get("next");
  setPortal(next && !/^pages\/customer-/i.test(next) ? "staff" : "customer");

  function signInMessage(error) {
    if (error.code === "email_confirmation_required" || error.code === "email_not_confirmed") {
      return "This account is pending email confirmation. Check your inbox for a confirmation link.";
    }
    if (error.code === "weak_password") return "Choose a password with at least 6 characters.";
    if (error.code === "email_address_invalid") return "Enter a valid email address.";
    if (["invalid_credentials", "user_already_exists", "email_exists"].includes(error.code)) {
      return portal === "customer"
        ? "Check your email and password. Add your name if you're creating an account."
        : "Check your staff email and password.";
    }
    if (error.code === "wrong_portal") {
      return portal === "customer" ? "Use the Staff tab for this account." : "Use the Customer tab for this account.";
    }
    if (error.status === 429 && error.code === "over_email_send_rate_limit") {
      return "Signup email limit reached on the demo project. Click ‘Fill Sample Customer’ below to sign in instantly.";
    }
    if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (!error.status) return "Can't reach the sign-in service. Check your connection and try again.";
    return `Sign-in failed (${error.status}${error.code ? " · " + error.code : ""}).`;
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }

  visibility.addEventListener("click", () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    visibility.setAttribute("aria-label", show ? "Hide password" : "Show password");
    visibility.replaceChildren(BW.ui.icon(show ? "eye-off" : "eye"));
  });

  function fillDemo(email) {
    emailInput.value = email;
    passwordInput.value = demoPassword;
    errorMessage.hidden = true;
  }

  document.querySelector("#fill-customer").addEventListener("click", () => {
    nameInput.value = "";
    fillDemo(demoCustomerEmail);
    emailInput.focus();
  });

  staffDemo.querySelectorAll("[data-demo-role]").forEach((button) => {
    button.addEventListener("click", () => fillDemo(`${button.dataset.demoRole}@bijliwala.in`));
  });

  form.addEventListener("input", () => { errorMessage.hidden = true; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    errorMessage.hidden = true;
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const canRegister = portal === "customer" && !!name && email.toLowerCase() !== demoCustomerEmail;

    const controls = [tabCustomer, tabStaff, ...form.querySelectorAll("button, input")];
    controls.forEach((control) => { control.disabled = true; });
    const label = submit.textContent;
    submit.textContent = "Signing in…";
    try {
      const user = await BW.auth.login(portal, email, password).catch((error) => {
        if (!canRegister || error.code !== "invalid_credentials") throw error;
        if (password.length < 6) throw Object.assign(new Error("weak_password"), { code: "weak_password" });
        submit.textContent = "Creating account…";
        return BW.auth.signupCustomer({ name, email, password });
      });
      passwordInput.value = "";
      location.replace(destination(user));
    } catch (error) {
      showError(signInMessage(error));
      controls.forEach((control) => { control.disabled = false; });
      submit.textContent = label;
    }
  });
})();
