import { Search } from "lucide-react";
export default function FilterBar({
  query,
  setQuery,
  status,
  setStatus,
  statuses,
  module,
}) {
  return (
    <div className="filters">
      <label className="search-box">
        <Search size={17} />
        <input
          aria-label={"Search " + module}
          placeholder={"Search " + module.toLowerCase() + "…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option>All statuses</option>
        {statuses.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}
