import { useState, useEffect, useRef } from "react";
import { Search, CornerDownLeft, FileText } from "lucide-react";
import { modules, schemas } from "../../data/mockSolarData";
import { icons } from "../layout/Sidebar";
import Modal from "./Modal";
export default function CommandPalette({ data, close, navigate, edit }) {
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0),
    list = useRef(null);
  const q = query.trim().toLowerCase();
  const jumps = modules
    .filter((m) => m.toLowerCase().includes(q))
    .map((m) => ({
      id: m,
      title: m,
      detail: "Go to module",
      Icon: icons[modules.indexOf(m)],
      run: () => navigate(m),
    }));
  const records = Object.entries(data).flatMap(([m, rows]) =>
    rows
      .filter((r) =>
        [r.id, r.status, ...schemas[m].fields.map((f) => r[f])]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .map((r) => ({
        id: r.id,
        title: r[schemas[m].fields[0]],
        detail: [r.id, m, r["Serial number"]].filter(Boolean).join(" · "),
        Icon: FileText,
        run: () => edit(m, r),
      })),
  );
  const results = [...jumps, ...records.slice(0, q ? 30 : 4)],
    active = results[index];
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);
  function choose(item) {
    if (item) {
      close();
      item.run();
    }
  }
  return (
    <Modal title="Search workspace" onClose={close}>
      <label className="search-box">
        <Search size={18} />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="command-options"
          aria-autocomplete="list"
          aria-activedescendant={active ? "option-" + active.id : undefined}
          aria-label="Search all records"
          placeholder="Find a module, customer or serial number…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              choose(active);
            } else if (
              results.length &&
              ["ArrowUp", "ArrowDown"].includes(e.key)
            ) {
              e.preventDefault();
              setIndex(
                (index + (e.key === "ArrowDown" ? 1 : -1) + results.length) %
                  results.length,
              );
            }
          }}
        />
      </label>
      <div
        id="command-options"
        className="results"
        role="listbox"
        aria-label="Workspace results"
        ref={list}
      >
        {results.map(({ id, title, detail, Icon }, i) => (
          <button
            key={id}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={index === i}
            id={"option-" + id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(results[i])}
          >
            <Icon size={17} />
            <span>
              {title}
              <small>{detail}</small>
            </span>
            {index === i && <CornerDownLeft size={14} />}
          </button>
        ))}
      </div>
      {!results.length && (
        <p className="empty">No matching records or modules.</p>
      )}
      <footer>↑ ↓ to navigate · Enter to open · Esc to close</footer>
    </Modal>
  );
}
