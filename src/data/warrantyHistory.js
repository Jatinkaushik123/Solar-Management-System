export function captureWarranty(record, previous, today) {
  const date = new Date().toISOString();
  const start =
    record.coverageStart || previous?.coverageStart || (!previous ? today : "");
  const changes = Object.entries(record).filter(
    ([key, value]) =>
      [
        "Customer",
        "Component",
        "Serial number",
        "Expiry date",
        "status",
        "coverageStart",
      ].includes(key) &&
      previous &&
      previous[key] !== value,
  );
  const history = previous?.history ? [...previous.history] : [];
  if (previous && !history.length)
    history.push({
      date: null,
      title: "Previous record",
      detail: [
        previous["Serial number"],
        previous.Component,
        previous.status,
        previous["Expiry date"],
      ].join(" · "),
    });
  if (!previous || changes.length)
    history.push({
      date,
      title: !previous
        ? "Warranty registered"
        : previous.status !== record.status
          ? record.status === "Claim open"
            ? "Claim opened"
            : previous.status === "Claim open" && record.status === "Active"
              ? "Claim resolved"
              : "Warranty status updated"
          : "Equipment details updated",
      detail: previous
        ? changes
            .map(
              ([k, v]) => k + ": " + (previous[k] || "Unrecorded") + " → " + v,
            )
            .join(" · ")
        : [record["Serial number"], record.Component, record.Customer].join(
            " · ",
          ),
    });
  return { ...record, coverageStart: start, history };
}
