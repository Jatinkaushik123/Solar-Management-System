import { useState } from "react";
import Modal from "./Modal";
import WarrantyTimeline from "./WarrantyTimeline";
import ProgressBar from "./ProgressBar";
import { schemas, dateString } from "../../data/mockSolarData";
const nextStep = {
  Enquiries: ["Qualified", "Surveys", "Schedule survey"],
  Surveys: ["Approved", "Quotations", "Prepare quotation"],
  Quotations: ["Accepted", "Projects", "Create project"],
  Projects: ["In progress", "Installations", "Schedule installation"],
  Installations: ["Commissioned", "Warranty", "Register warranty"],
};
export default function RecordEditor({
  module,
  record,
  save,
  close,
  edit,
  data,
}) {
  const schema = schemas[module],
    [draft, setDraft] = useState(() => ({
      status: schema.statuses[0],
      ...record,
    })),
    [error, setError] = useState("");
  const step = nextStep[module],
    existing =
      step &&
      data[step[1]].find((r) => r.sourceId === record?.id && record?.id);
  function submit(e) {
    e.preventDefault();
    const clean = { ...draft };
    for (const field of schema.fields) {
      clean[field] = String(clean[field] ?? "").trim();
      if (!clean[field]) {
        setError("Complete all fields.");
        return;
      }
    }
    try {
      save(module, clean);
    } catch {
      setError(
        "Your browser could not save this record. Please check available storage and try again.",
      );
    }
  }
  function advance() {
    const next = step[1];
    if (existing) {
      edit(next, existing);
      return;
    }
    const name =
      record.Customer || record["Project name"] || record["Site name"];
    edit(next, {
      sourceId: record.id,
      Customer: name,
      "Project name": name,
      "Site name": name,
      City: record.City,
      "Capacity (kW)": record["Capacity (kW)"],
      "Survey date": dateString(new Date()),
      "Installation date": dateString(new Date()),
    });
  }
  return (
    <Modal
      variant="drawer"
      title={record?.id || "New " + schema.single}
      onClose={close}
    >
      <form onSubmit={submit}>
        <p className="form-caption">
          {record?.id
            ? "Edit " + schema.single + " details"
            : "Enter " + schema.single + " details"}
          {record?.sourceId ? " · From " + record.sourceId : ""}
        </p>
        <div className="form-grid">
          {schema.fields.map((f) => {
            const numeric = /Capacity|Amount|Stock|Reorder/.test(f);
            return (
              <label key={f}>
                {f}
                <input
                  required
                  type={
                    numeric
                      ? "number"
                      : f.includes("date")
                        ? "date"
                        : f === "Phone"
                          ? "tel"
                          : "text"
                  }
                  min={
                    f === "Expiry date"
                      ? draft.coverageStart ||
                        (!record?.id ? dateString(new Date()) : undefined)
                      : f.includes("Capacity")
                        ? "0.01"
                        : numeric
                          ? "0"
                          : undefined
                  }
                  step={
                    /Capacity|Amount/.test(f)
                      ? "0.01"
                      : numeric
                        ? "1"
                        : undefined
                  }
                  pattern={f === "Phone" ? "[+]?[0-9 ]{10,15}" : undefined}
                  value={draft[f] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                />
              </label>
            );
          })}
          {module === "Warranty" && (
            <label>
              Coverage start
              <input
                type="date"
                max={draft["Expiry date"] || undefined}
                value={
                  draft.coverageStart ??
                  (record?.id ? "" : dateString(new Date()))
                }
                onChange={(e) =>
                  setDraft({ ...draft, coverageStart: e.target.value })
                }
              />
            </label>
          )}
          {module !== "Inventory" && (
            <label>
              Status
              <select
                aria-label="Status"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                {schema.statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {module === "Projects" && (
          <ProgressBar
            value={
              {
                Planning: 10,
                "In progress": 50,
                "On hold": 25,
                Completed: 100,
              }[draft.status]
            }
            label="Stage estimate"
          />
        )}
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={close}>
            Cancel
          </button>
          <button className="primary-btn">Save {schema.single}</button>
        </div>
      </form>
      {record?.id &&
        ((module === "Warranty" && record.status !== "Closed") ||
          (module === "Installations" && record.status === "Scheduled")) && (
          <div className="workflow">
            <small>
              {module === "Warranty" ? "Claim management" : "Field operations"}
            </small>
            <button
              className="secondary-btn"
              disabled={
                Object.entries(draft).some(([k, v]) => v !== record[k]) ||
                (module === "Warranty" &&
                  record.status === "Active" &&
                  record["Expiry date"] < dateString(new Date()))
              }
              onClick={() => {
                try {
                  save(module, {
                    ...record,
                    status:
                      module === "Installations"
                        ? "On site"
                        : record.status === "Active"
                          ? "Claim open"
                          : "Active",
                  });
                } catch {
                  setError("Could not save this action. Try again.");
                }
              }}
            >
              {module === "Installations"
                ? "Dispatch crew"
                : record.status === "Active"
                  ? "Open claim"
                  : "Resolve claim"}
            </button>
          </div>
        )}
      {module === "Warranty" && record?.id && (
        <WarrantyTimeline record={record} data={data} />
      )}
      {record?.id && step && record.status === step[0] && (
        <div className="workflow">
          <small>Next step</small>
          <button
            className="secondary-btn"
            onClick={advance}
            disabled={Object.entries(draft).some(([k, v]) => v !== record[k])}
          >
            {existing ? "Open " + existing.id : step[2]}
          </button>
        </div>
      )}
    </Modal>
  );
}
