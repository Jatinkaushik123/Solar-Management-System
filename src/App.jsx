import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import AppShell from "./components/layout/AppShell";
import CommandPalette from "./components/ui/CommandPalette";
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
  const Screen = screens[page];
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
            const type = schemas[m].single;
            const old = data[m].find((item) => item.id === r.id);
            const verb = !old
              ? "created"
              : m === "Installations" &&
                  old.status === "Scheduled" &&
                  r.status === "On site"
                ? "dispatched"
                : "updated";
            setNotice({
              id: performance.now(),
              text: type[0].toUpperCase() + type.slice(1) + " " + verb,
            });
          }}
        />
      )}
      {search && (
        <CommandPalette
          data={data}
          close={() => setSearch(false)}
          navigate={navigate}
          edit={edit}
        />
      )}
      {notice && (
        <div className="toast" key={notice.id} role="status">
          <CircleCheck size={18} />
          {notice.text}
          <i aria-hidden="true" />
        </div>
      )}
    </AppShell>
  );
}
