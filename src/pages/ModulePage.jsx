import { useState } from "react";
import {
  Plus,
  ListChecks,
  ClipboardList,
  Activity,
  Layers,
} from "lucide-react";
import KpiCard from "../components/ui/KpiCard";
import FilterBar from "../components/ui/FilterBar";
import DataTable from "../components/ui/DataTable";
import { schemas } from "../data/mockSolarData";
export default function ModulePage({ module, data, edit }) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("All statuses");
  const schema = schemas[module],
    rows = data[module],
    filtered = rows.filter(
      (r) =>
        (status === "All statuses" || r.status === status) &&
        Object.values(r)
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{module}</h1>
          <p>{schema.description}</p>
        </div>
        <button className="primary-btn" onClick={() => edit(module)}>
          <Plus size={17} />
          New {schema.single}
        </button>
      </div>
      <div className="kpis">
        <KpiCard
          label={
            "Total " +
            (module === "Inventory"
              ? "items"
              : module === "Warranty"
                ? "warranties"
                : module.toLowerCase())
          }
          value={filtered.length}
          replay={query + status}
          detail={
            query || status !== "All statuses"
              ? "Matching records"
              : "All records"
          }
          icon={Layers}
          color="blue"
        />
        {schema.statuses.slice(0, 3).map((s, i) => (
          <KpiCard
            key={s}
            label={s}
            value={filtered.filter((r) => r.status === s).length}
            replay={query + status}
            detail={
              schema.single.charAt(0).toUpperCase() +
              schema.single.slice(1) +
              " records"
            }
            icon={[Activity, ClipboardList, ListChecks][i]}
            color={["teal", "amber", "purple"][i]}
          />
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            {module === "Inventory" ? "Stock register" : module + " register"}
          </h2>
          <span className="muted">{filtered.length} records</span>
        </div>
        <FilterBar
          {...{ query, setQuery, status, setStatus, module }}
          statuses={schema.statuses}
        />
        <DataTable
          filterKey={query + status}
          rows={filtered}
          fields={schema.fields}
          onSelect={(r) => edit(module, r)}
        />
      </section>
    </>
  );
}
