import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import AppShell from "./components/layout/AppShell";
import Modal from "./components/ui/Modal";
import RecordEditor from "./components/ui/RecordEditor";
import { modules, schemas, solarApi } from "./data/mockSolarData";
import Dashboard from "./pages/Dashboard";
import Enquiries from "./pages/Enquiries";
import Surveys from "./pages/Surveys";
import Quotations from "./pages/Quotations";
import Projects from "./pages/Projects";
import Inventory from "./pages/Inventory";
import Installations from "./pages/Installations";
import Warranty from "./pages/Warranty";
import Login from "./pages/Login";
const screens = {
  Dashboard,
  Enquiries,
  Surveys,
  Quotations,
  Projects,
  Inventory,
  Installations,
  Warranty,
};
function current() {
  return (
    [...modules, "Login"].find(
      (m) => location.hash.toLowerCase() === "#/" + m.toLowerCase(),
    ) || "Dashboard"
  );
}
export default function App() {
  const [page, setPage] = useState(current),
    [data, setData] = useState(() => solarApi.list()),
    [editor, setEditor] = useState(null),
    [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState(""),
    [name, setName] = useState(
      () => sessionStorage.getItem("bw-user") ?? "Arjun Mehta",
    );
  function navigate(m) {
    location.hash = "/" + m.toLowerCase();
    setPage(m);
    window.scrollTo(0, 0);
  }
  function edit(module, record) {
    setEditor({ module, record });
  }
  function openSearch() {
    setQuery("");
    setSearch(true);
  }
  useEffect(() => {
    function change() {
      setPage(current());
      setEditor(null);
      setSearch(false);
    }
    function storage(e) {
      if (e.key === "bijli-wala.records.v1") setData(solarApi.list());
    }
    window.addEventListener("hashchange", change);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("storage", storage);
    };
  }, []);
  useEffect(() => {
    document.title = page + " | Bijli Wala";
    function keys(e) {
      if (
        name &&
        page !== "Login" &&
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        if (!editor) openSearch();
      }
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [page, name, editor]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  if (!name || page === "Login")
    return (
      <Login
        onLogin={(n) => {
          sessionStorage.setItem("bw-user", n);
          setName(n);
          navigate("Dashboard");
        }}
      />
    );
  const Screen = screens[page],
    matches = Object.entries(data)
      .flatMap(([m, rows]) =>
        rows
          .filter((r) =>
            [m, ...schemas[m].fields.map((f) => r[f]), r.id, r.status]
              .join(" ")
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          )
          .map((r) => ({ m, r })),
      )
      .slice(0, 25);
  return (
    <AppShell
      {...{ page, navigate, name }}
      search={openSearch}
      logout={() => {
        sessionStorage.setItem("bw-user", "");
        setName("");
        navigate("Login");
      }}
    >
      <Screen {...{ data, navigate, edit }} />
      {editor && (
        <RecordEditor
          key={editor.module + (editor.record?.id || "new")}
          {...editor}
          {...{ data, edit }}
          close={() => setEditor(null)}
          save={(m, r) => {
            setData(solarApi.save(m, r));
            setEditor(null);
            setNotice(
              schemas[m].single.charAt(0).toUpperCase() +
                schemas[m].single.slice(1) +
                " saved",
            );
          }}
        />
      )}
      {search && (
        <Modal title="Search workspace" onClose={() => setSearch(false)}>
          <label className="search-box">
            <Search size={17} />
            <input
              autoFocus
              placeholder="Search records, cities or customers…"
              aria-label="Search all records"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="results">
            {matches.map(({ m, r }) => (
              <button
                key={r.id}
                onClick={() => {
                  setSearch(false);
                  edit(m, r);
                }}
              >
                <span>{r[schemas[m].fields[0]]}</span>
                <small>
                  {m} · {r.id}
                </small>
              </button>
            ))}
            {!matches.length && <p>No matching records.</p>}
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </AppShell>
  );
}
