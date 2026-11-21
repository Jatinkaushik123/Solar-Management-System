import { ChevronRight } from "lucide-react";
import StatusBadge from "./StatusBadge";
import { displayValue } from "../../data/mockSolarData";
export default function DataTable({ rows, fields, onSelect, filterKey }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Record ID</th>
            {fields.map((f) => (
              <th key={f}>{f}</th>
            ))}
            <th>Status</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody key={filterKey}>
          {rows.map((r, index) => (
            <tr
              key={r.id}
              style={{ "--row-delay": Math.min(index, 8) * 24 + "ms" }}
              onClick={(e) => {
                if (!e.target.closest("button")) onSelect(r);
              }}
            >
              <td>
                <button className="id-link" onClick={() => onSelect(r)}>
                  {r.id}
                </button>
              </td>
              {fields.map((f, i) => (
                <td key={f} className={i === 0 ? "primary-cell" : ""}>
                  {displayValue(f, r[f])}
                </td>
              ))}
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>
                <button
                  className="row-btn"
                  onClick={() => onSelect(r)}
                  aria-label={"Open " + r.id}
                >
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="empty">
          No matching records. Try another search or status.
        </p>
      )}
    </div>
  );
}
