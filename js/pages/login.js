(() => {
  const legacy = BW.modules.find(
    (m) => location.hash.toLowerCase() === "#/" + m.toLowerCase(),
  );
  if (legacy) {
    location.replace("pages/" + legacy.toLowerCase() + ".html");
    return;
  }
  document
    .querySelectorAll("[data-icon]")
    .forEach((n) => n.append(BW.icon(n.dataset.icon)));
  const form = document.querySelector("#login-form"),
    password = document.querySelector("#password"),
    toggle = document.querySelector("#visibility"),
    error = document.querySelector(".login-error");
  function enter() {
    try {
      sessionStorage.setItem("bw-user", "Arjun Mehta");
    } catch {}
    location.href = "pages/dashboard.html";
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    if (
      document.querySelector("#email").value.trim().toLowerCase() ===
        "admin@bijliwala.in" &&
      password.value === "SolarDemo"
    )
      enter();
    else {
      error.hidden = false;
      error.textContent =
        "Use the demo credentials shown below to enter this workspace.";
    }
  };
  form.oninput = () => {
    error.hidden = true;
  };
  toggle.onclick = () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    toggle.replaceChildren(BW.icon(show ? "eye-off" : "eye"));
  };
  document.querySelector(".login-demo").onclick = enter;
})();
