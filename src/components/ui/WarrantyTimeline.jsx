import { ShieldCheck } from "lucide-react";
import { displayValue } from "../../data/mockSolarData";
export default function WarrantyTimeline({ record, data }) {
  const serial = record["Serial number"],
    related = data.Warranty.filter(
      (r) => r["Serial number"] === serial || r.id === record.id,
    );
  const events = related
    .flatMap((r) =>
      (r.history?.length
        ? r.history
        : [
            {
              date: null,
              title: "Existing warranty",
              detail: r.status + " · " + r.Component,
            },
          ]
      ).map((event) => ({ ...event, id: r.id })),
    )
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const start = Date.parse(record.coverageStart),
    end = Date.parse(record["Expiry date"] + "T23:59:59"),
    percent =
      end > start
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round((100 * (Date.now() - start)) / (end - start)),
            ),
          )
        : null;
  return (
    <section className="warranty-detail">
      <div className="coverage-heading">
        <ShieldCheck size={18} />
        <h3>Warranty timeline</h3>
      </div>
      {percent !== null ? (
        <>
          <div className="coverage-label">
            <span>Coverage elapsed</span>
            <b>{percent}%</b>
          </div>
          <progress
            aria-label="Warranty coverage elapsed"
            value={percent}
            max={100}
          />
        </>
      ) : (
        <p>Coverage start date unavailable</p>
      )}
      <div className="coverage-label">
        <span>
          {record.coverageStart
            ? displayValue("date", record.coverageStart)
            : "Start unrecorded"}
        </span>
        <span>{displayValue("date", record["Expiry date"])}</span>
      </div>
      <h3>Serial history</h3>
      <p className="serial-tag">{serial}</p>
      <ol>
        {events.map((e, i) => (
          <li key={i}>
            <strong>{e.title}</strong>
            <small>
              {e.date
                ? new Date(
                    e.date.length === 10 ? e.date + "T12:00:00" : e.date,
                  ).toLocaleDateString("en-IN", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "Date unrecorded"}{" "}
              · {e.id}
            </small>
            <p>{e.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
