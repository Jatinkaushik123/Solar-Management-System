/**
 * Bijli Wala SIMS — Login & Customer Sign-Up Controller
 * Signs in through the hosted Supabase Auth with a portal gate
 * ("customer" or "staff" via GET /v1/me?portal=...). Credentials come from the
 * form only and are never stored.
 */
(() => {
  "use strict";

  // Already signed in: go to this user's landing page.
  const currentUser = BW.auth.current();
  if (currentUser) {
    location.replace(`pages/${currentUser.defaultLanding || "dashboard.html"}`);
    return;
  }

  document.querySelectorAll("[data-icon]").forEach((node) => {
    node.replaceChildren(BW.ui.icon(node.dataset.icon));
  });

  const tabCustomer = document.querySelector("#tab-login");
  const tabStaff = document.querySelector("#tab-admin");
  const loginForm = document.querySelector("#login-form");
  const signupForm = document.querySelector("#signup-form");
  const toggleSignupBtn = document.querySelector("#toggle-signup");
  const backToLoginBtn = document.querySelector("#back-to-login");
  const signupPrompt = toggleSignupBtn?.closest(".signup-prompt");
  const emailInput = document.querySelector("#email");
  const passwordInput = document.querySelector("#password");
  const toggleVisibilityBtn = document.querySelector("#visibility");
  const loginError = document.querySelector(".login-error");
  const signupError = document.querySelector(".signup-error");
  const submitBtn = loginForm?.querySelector(".login-submit");

  let portal = "customer";

  function setPortal(next) {
    portal = next;
    const isCustomer = next === "customer";
    tabCustomer.classList.toggle("active", isCustomer);
    tabStaff.classList.toggle("active", !isCustomer);
    tabCustomer.setAttribute("aria-selected", String(isCustomer));
    tabStaff.setAttribute("aria-selected", String(!isCustomer));
    emailInput.placeholder = isCustomer ? "you@example.com" : "staff email";
    submitBtn.textContent = isCustomer ? "Sign in to customer portal" : "Sign in to staff portal";
    // Only customers can self-register; staff join by admin invitation.
    if (signupPrompt) signupPrompt.hidden = !isCustomer;
    loginError.hidden = true;
  }
  tabCustomer?.addEventListener("click", () => setPortal("customer"));
  tabStaff?.addEventListener("click", () => setPortal("staff"));
  setPortal("customer");

  function show(el, message) {
    el.textContent = message;
    el.hidden = false;
  }

  function signInMessage(err) {
    if (err.status === 400) return "Email or password is incorrect.";
    if (err.status === 401) return "This account cannot sign in. It may be disabled or unconfirmed.";
    if (err.status === 403) {
      return portal === "customer"
        ? "This is a staff account. Switch to the Staff tab to sign in."
        : "This account is not a staff account. Switch to the Customer tab to sign in.";
    }
    if (err.status === 429) return "Too many attempts. Please wait a minute and try again.";
    if (!err.status) return "Can't reach the sign-in service. Check your connection and try again.";
    return `Sign-in failed (${err.status}${err.code ? " · " + err.code : ""}).`;
  }

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

  toggleVisibilityBtn?.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    toggleVisibilityBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
    toggleVisibilityBtn.replaceChildren(BW.ui.icon(isPassword ? "eye-off" : "eye"));
  });

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    if (!emailInput.value.trim() || !passwordInput.value) {
      show(loginError, "Enter your email and password.");
      return;
    }
    submitBtn.disabled = true;
    const label = submitBtn.textContent;
    submitBtn.textContent = "Signing in…";
    try {
      const user = await BW.auth.login(portal, emailInput.value, passwordInput.value);
      passwordInput.value = "";
      location.assign(`pages/${user.defaultLanding || "dashboard.html"}`);
    } catch (err) {
      show(loginError, signInMessage(err));
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    }
  });

  loginForm?.addEventListener("input", () => {
    loginError.hidden = true;
  });

  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    signupError.hidden = true;
    const name = document.querySelector("#signup-name").value.trim();
    const email = document.querySelector("#signup-email").value.trim();
    const passField = document.querySelector("#signup-password");
    if (!name || !email || !passField.value) {
      show(signupError, "Enter your name, email and a password.");
      return;
    }
    if (passField.value.length < 6) {
      show(signupError, "Password must be at least 6 characters.");
      return;
    }
    const btn = signupForm.querySelector(".login-submit");
    btn.disabled = true;
    try {
      await BW.auth.signupCustomer({ name, email, password: passField.value });
      passField.value = "";
      signupError.classList.add("signup-success");
      show(signupError, `Account created. We've sent a confirmation link to ${email}. Confirm it, then sign in on the Customer tab.`);
    } catch (err) {
      signupError.classList.remove("signup-success");
      show(
        signupError,
        err.status === 429
          ? "Too many sign-up emails right now. Please try again in a few minutes."
          : err.status === 422 || err.status === 400
            ? "That email can't be registered (it may already have an account)."
            : `Sign-up failed (${err.status || "network"}${err.code ? " · " + err.code : ""}).`,
      );
    } finally {
      btn.disabled = false;
    }
  });
})();
