/* Static icon geometry. ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
const iconPaths = {
  "layout-dashboard":
    '<rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect>',
  "messages-square":
    '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"></path><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"></path>',
  "clipboard-list":
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path>',
  "file-text":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
  "folder-kanban":
    '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path><path d="M8 10v4"></path><path d="M12 10v2"></path><path d="M16 10v6"></path>',
  boxes:
    '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"></path><path d="m7 16.5-4.74-2.85"></path><path d="m7 16.5 5-3"></path><path d="M7 16.5v5.17"></path><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"></path><path d="m17 16.5-5-3"></path><path d="m17 16.5 4.74-2.85"></path><path d="M17 16.5v5.17"></path><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"></path><path d="M12 8 7.26 5.15"></path><path d="m12 8 4.74-2.85"></path><path d="M12 13.5V8"></path>',
  wrench:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>',
  "shield-check":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>',
  sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>',
  "log-out":
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" x2="9" y1="12" y2="12"></line>',
  x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  "panel-left":
    '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M9 3v18"></path>',
  "chevron-right": '<path d="m9 18 6-6-6-6"></path>',
  search:
    '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
  "calendar-days":
    '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path>',
  plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
  layers:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"></path><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"></path><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"></path>',
  "list-checks":
    '<path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path>',
  activity:
    '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"></path>',
  "hard-hat":
    '<path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"></path><path d="M14 6a6 6 0 0 1 6 6v3"></path><path d="M4 15v-3a6 6 0 0 1 6-6"></path><rect x="2" y="15" width="20" height="4" rx="1"></rect>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"></path>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>',
  "eye-off":
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"></path><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"></path><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"></path><path d="m2 2 20 20"></path>',
  "lock-keyhole":
    '<circle cx="12" cy="16" r="1"></circle><rect x="3" y="10" width="18" height="12" rx="2"></rect><path d="M7 10V7a5 5 0 0 1 10 0v3"></path>',
  "circle-check":
    '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>',
  "corner-down-left":
    '<polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path>',
};
(() => {
  const { el, button, icon } = BW,
    navIcons = [
      "layout-dashboard",
      "messages-square",
      "clipboard-list",
      "file-text",
      "folder-kanban",
      "boxes",
      "wrench",
      "shield-check",
    ];
  function pageURL(module) {
    return module.toLowerCase() + ".html";
  }
  function palette() {
    if (document.querySelector("dialog[open]")) return;
    const { dialog, body } = BW.modal("Search workspace", "spotlight"),
      search = el("label", "search-box"),
      input = el("input"),
      list = el("div", "results"),
      hint = el("footer", "", "↑ ↓ to navigate · Enter to open · Esc to close");
    list.id = "command-options";
    list.setAttribute("role", "listbox");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-label", "Search all records");
    input.placeholder = "Find a module, customer or serial number…";
    search.append(icon("search"), input);
    body.append(search, list, hint);
    let active = 0,
      items = [];
    function select(i) {
      if (!items.length) return;
      active = (i + items.length) % items.length;
      Array.from(list.children).forEach((b, j) =>
        b.setAttribute("aria-selected", j === active),
      );
      input.setAttribute("aria-activedescendant", "result-" + active);
      list.children[active]?.scrollIntoView({ block: "nearest" });
    }
    function choose(i) {
      const item = items[i];
      if (!item) return;
      dialog.close();
      if (item.record) BW.edit(item.module, item.record);
      else location.href = pageURL(item.module);
    }
    function update() {
      const q = input.value.trim().toLowerCase(),
        mods = BW.modules
          .filter((m) => m.toLowerCase().includes(q))
          .map((m) => ({ module: m, title: m, detail: "Go to module" })),
        records = Object.entries(BW.data).flatMap(([m, rows]) =>
          rows
            .filter((r) =>
              [r.id, r.status, ...BW.schemas[m].fields.map((f) => r[f])]
                .join(" ")
                .toLowerCase()
                .includes(q),
            )
            .map((r) => ({
              module: m,
              record: r,
              title: r[BW.schemas[m].fields[0]],
              detail: [r.id, m, r["Serial number"]].filter(Boolean).join(" · "),
            })),
        );
      items = [...mods, ...records.slice(0, q ? 30 : 4)];
      list.replaceChildren();
      items.forEach((item, i) => {
        const b = button("", () => choose(i), "");
        b.tabIndex = -1;
        b.id = "result-" + i;
        b.setAttribute("role", "option");
        const text = el("span", "", item.title);
        text.append(el("small", "", item.detail));
        b.append(
          icon(
            item.record
              ? "file-text"
              : navIcons[BW.modules.indexOf(item.module)],
          ),
          text,
        );
        list.append(b);
      });
      if (items.length) select(0);
      else {
        input.removeAttribute("aria-activedescendant");
        list.append(el("p", "", "No matching records or modules."));
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
  function shell() {
    const m = BW.page,
      root = document.querySelector("#workspace");
    root.className = "shell";
    const side = el("aside", "sidebar"),
      brand = el("div", "brand"),
      logo = el("span"),
      word = el("div", "", "Bijli Wala"),
      nav = el("nav"),
      account = el("div", "account"),
      area = el("div", "main-area"),
      header = el("header", "top-header"),
      tools = el("div", "header-tools"),
      crumb = el("div", "crumb"),
      shade = button("", () => mobile(false), "scrim");
    shade.hidden = true;
    shade.setAttribute("aria-label", "Close navigation");
    function mobile(open) {
      side.classList.toggle("visible", open);
      shade.hidden = !open;
      menu.setAttribute("aria-expanded", open);
      if (open) close.focus();
      else menu.focus();
    }
    function named(label, fn, glyph, cls) {
      const b = button("", fn, cls, glyph);
      b.setAttribute("aria-label", label);
      return b;
    }
    const close = named(
        "Close navigation",
        () => mobile(false),
        "x",
        "mobile icon-btn",
      ),
      menu = named(
        "Open navigation",
        () => mobile(true),
        "panel-left",
        "mobile icon-btn",
      );
    menu.setAttribute("aria-expanded", "false");
    word.append(el("small", "", "SOLAR MANAGEMENT"));
    logo.append(icon("sun", 25));
    brand.append(logo, word, close);
    nav.append(el("span", "nav-indicator"));
    const index = BW.modules.indexOf(m);
    nav.style.setProperty("--active-index", index);
    BW.modules.forEach((v, i) => {
      const a = el("a", v === m ? "selected" : "");
      a.href = pageURL(v);
      a.append(icon(navIcons[i]), v);
      if (v === m) {
        a.setAttribute("aria-current", "page");
        a.append(el("i"));
      }
      nav.append(a);
    });
    const name = el("div", "", "Arjun Mehta");
    name.append(el("small", "", "Administrator"));
    account.append(
      el("span", "avatar", "AM"),
      name,
      named(
        "Sign out",
        () => {
          try {
            sessionStorage.setItem("bw-user", "");
          } catch {}
          location.href = "../index.html";
        },
        "log-out",
        "icon-btn",
      ),
    );
    side.append(brand, el("div", "nav-label", "Workspace"), nav, account);
    crumb.append(el("span", "", "Workspace"), icon("chevron-right", 14), m);
    const find = named("Search workspace", palette, "search", "global-search");
    find.append(el("span", "", "Search workspace"), el("kbd", "", "Ctrl K"));
    const date = el("span", "date");
    date.append(
      icon("calendar-days", 15),
      new Date().toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    );
    tools.append(find, date);
    header.append(menu, crumb, tools);
    BW.main = el("main", "content");
    area.append(header, BW.main);
    root.append(shade, side, area);
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        palette();
      }
      if (e.key === "Escape" && side.classList.contains("visible"))
        mobile(false);
    });
    try {
      const prev = sessionStorage.getItem("bw-last-page");
      if (prev && BW.modules.includes(prev)) {
        nav.style.setProperty("--active-index", BW.modules.indexOf(prev));
        nav.getBoundingClientRect();
        nav.style.setProperty("--active-index", index);
      }
      sessionStorage.setItem("bw-last-page", m);
    } catch {}
  }
  document.addEventListener("DOMContentLoaded", async () => {
    BW.page = document.body.dataset.page;
    if (BW.page === "Login") return;
    let signedOut = false;
    try {
      signedOut = sessionStorage.getItem("bw-user") === "";
    } catch {}
    if (signedOut) {
      location.replace("../index.html");
      return;
    }
    shell();
    BW.render = () =>
      BW.page === "Dashboard"
        ? BW.controllers.Dashboard.render()
        : BW.registerPage();
    async function load() {
      try {
        BW.data = await BW.api.list();
        BW.render();
      } catch (error) {
        BW.main.replaceChildren(
          el("p", "empty", error.message),
          button("Try again", load),
        );
      }
    }
    await load();
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) load();
    });
    window.addEventListener("storage", (e) => {
      if (e.key === "bijli-wala.records.v1") load();
    });
  });
})();
