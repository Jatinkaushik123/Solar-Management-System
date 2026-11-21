(() => {
  const key = "bijli-wala.records.v1";
  // Configure before loading api.js, or set BW.api.baseURL before the first request.
  const fileRoot = new URL(
    "../",
    new URL(
      "pages/",
      location.href.includes("/pages/")
        ? new URL("../", location.href)
        : location.href,
    ),
  ).href;
  const fileTag = "bijli-wala:" + fileRoot + "\n";
  function localData() {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch {}
    if (location.protocol === "file:" && window.name.startsWith(fileTag))
      raw = window.name.slice(fileTag.length);
    return Object.assign(
      JSON.parse(JSON.stringify(BW.mockSolarData)),
      raw ? JSON.parse(raw) : {},
    );
  }
  function persist(data) {
    const raw = JSON.stringify(data);
    try {
      localStorage.setItem(key, raw);
    } catch (error) {
      if (location.protocol !== "file:") throw error;
    }
    if (location.protocol === "file:") window.name = fileTag + raw;
  }
  async function request(path, method = "GET", body) {
    const response = await fetch(api.baseURL.replace(/\/$/, "") + "/" + path, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error("Request failed (" + response.status + ").");
    return response.status === 204 ? null : response.json();
  }
  function saveLocal(module, record) {
    const data = localData(),
      rows = data[module],
      prev = rows.find((r) => r.id === record.id),
      r = { ...prev, ...record };
    if (!r.id)
      r.id =
        BW.schemas[module].prefix +
        "-" +
        (Math.max(
          1000,
          ...rows.map((x) => Number(x.id.split("-").pop()) || 0),
        ) +
          1);
    if (module === "Inventory")
      r.status =
        Number(r["Stock (units)"]) === 0
          ? "Out of stock"
          : Number(r["Stock (units)"]) <= Number(r["Reorder level"])
            ? "Low stock"
            : "In stock";
    if (module === "Warranty")
      Object.assign(r, captureWarranty(r, prev, BW.dateString(new Date())));
    data[module] = [r, ...rows.filter((x) => x.id !== r.id)];
    persist(data);
    return data;
  }
  const locked = (fn) =>
    navigator.locks
      ? navigator.locks.request(key, fn)
      : Promise.resolve().then(fn);
  const api = {
    baseURL: window.BIJLI_API_BASE_URL || "",
    async list() {
      if (!this.baseURL) return localData();
      const pairs = await Promise.all(
        Object.keys(BW.schemas).map(async (m) => [
          m,
          await request(m.toLowerCase()),
        ]),
      );
      return Object.fromEntries(pairs);
    },
    async save(module, record) {
      if (!BW.schemas[module]) throw new Error("Unknown record type");
      if (!this.baseURL) return locked(() => saveLocal(module, record));
      await request(
        module.toLowerCase() +
          (record.id ? "/" + encodeURIComponent(record.id) : ""),
        record.id ? "PUT" : "POST",
        record,
      );
      return this.list();
    },
    async dispatch(id, serial, project) {
      if (this.baseURL) {
        await request(
          "inventory/" + encodeURIComponent(id) + "/dispatch",
          "POST",
          { serial, project },
        );
        return this.list();
      }
      return locked(() => {
        const data = localData(),
          item = data.Inventory.find((r) => r.id === id);
        if (!item || Number(item["Stock (units)"]) < 1)
          throw new Error("No stock available for dispatch.");
        if (
          data.Inventory.some((r) =>
            r.dispatches?.some((d) => d.serial === serial),
          )
        )
          throw new Error("This serial number has already been dispatched.");
        return saveLocal("Inventory", {
          ...item,
          "Stock (units)": Number(item["Stock (units)"]) - 1,
          dispatches: [
            ...(item.dispatches || []),
            { serial, project, date: new Date().toISOString() },
          ],
        });
      });
    },
  };
  BW.api = api;
  window.solarApi = api;
})();
function captureWarranty(record, previous, today) {
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
