(() => {
  const day = (v) => BW.displayValue("date", v.slice(0, 10));
  BW.controllers.Warranty = {
    toolbar(filters) {
      filters.querySelector("input").placeholder =
        "Search serial, customer or warranty…";
    },
    decorate({ body, record, grid, fields, save }) {
      const today = BW.dateString(new Date()),
        start = BW.input(
          grid,
          "Coverage start",
          record.coverageStart || (record.id ? "" : today),
          "date",
        );
      start.required = false;
      fields.coverageStart = start;
      const end = fields["Expiry date"];
      function range() {
        start.max = end.value;
        end.min = start.value;
      }
      start.oninput = end.oninput = range;
      range();
      if (!record.id) return;
      const section = BW.el("section", "warranty-detail"),
        expires = new Date(record["Expiry date"] + "T23:59:59"),
        began = new Date(record.coverageStart + "T00:00:00"),
        heading = BW.el("div", "coverage-heading");
      heading.append(
        BW.icon("shield-check"),
        BW.el("h3", "", "Warranty timeline"),
      );
      section.append(heading);
      if (expires > began) {
        const progress = BW.el("progress"),
          pct = Math.round(
            Math.max(0, Math.min(1, (Date.now() - began) / (expires - began))) *
              100,
          );
        progress.max = 100;
        progress.value = pct;
        progress.setAttribute("aria-label", "Warranty coverage elapsed");
        section.append(
          BW.el("div", "coverage-label", "Coverage elapsed · " + pct + "%"),
          progress,
        );
      }
      section.append(
        BW.el(
          "div",
          "coverage-label",
          (record.coverageStart
            ? day(record.coverageStart)
            : "Start unrecorded") +
            " — " +
            day(record["Expiry date"]),
        ),
        BW.el("h3", "", "Serial history"),
        BW.el("p", "serial-tag", record["Serial number"]),
      );
      const list = BW.el("ol");
      section.append(list);
      const events = BW.data.Warranty.filter(
        (r) => r["Serial number"] === record["Serial number"],
      )
        .flatMap((r) =>
          (r.history?.length
            ? r.history
            : [{ title: "Existing warranty", detail: r.status }]
          ).map((e) => ({ ...e, id: r.id })),
        )
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      for (const e of events) {
        const li = BW.el("li");
        li.append(
          BW.el("strong", "", e.title),
          BW.el(
            "small",
            "",
            (e.date ? day(e.date) : "Date unrecorded") + " · " + e.id,
          ),
          BW.el("p", "", e.detail),
        );
        list.append(li);
      }
      const tickets = record.tickets || [];
      if (record.status === "Active" && record["Expiry date"] >= today)
        BW.workflow(body, "Service ticket", [
          BW.button("Open claim", () =>
            save(
              {
                status: "Claim open",
                tickets: [
                  ...tickets,
                  {
                    id: record.id + "-T" + (tickets.length + 1),
                    opened: new Date().toISOString(),
                  },
                ],
              },
              "Service ticket opened",
            ),
          ),
        ]);
      else if (record.status === "Claim open")
        BW.workflow(body, "Service ticket", [
          BW.button("Resolve claim", () => {
            const closed = tickets.map((t) =>
              t.closed ? t : { ...t, closed: new Date().toISOString() },
            );
            return save(
              { status: "Active", tickets: closed },
              "Claim resolved",
            );
          }),
        ]);
      if (tickets.length) {
        section.append(BW.el("h3", "", "Service tickets"));
        tickets.forEach((t) =>
          section.append(
            BW.el(
              "p",
              "form-caption",
              t.id +
                " · " +
                (t.closed
                  ? "Resolved " + day(t.closed)
                  : "Opened " + day(t.opened)),
            ),
          ),
        );
      }
      body.append(section);
    },
  };
})();
