(() => {
  function scanner(item) {
    const { dialog, body } = BW.modal("Dispatch serial number", "spotlight"),
      form = BW.el("form"),
      grid = BW.el("div", "form-grid"),
      items = BW.data.Inventory,
      select = BW.input(
        grid,
        "Stock item",
        item?.id || items[0]?.id,
        "text",
        items.map((r) => r.id),
      ),
      serial = BW.input(grid, "Scan or enter serial number", "", "text"),
      project = BW.input(
        grid,
        "Destination project",
        BW.data.Projects[0]?.id,
        "text",
        BW.data.Projects.map((r) => r.id),
      ),
      error = BW.el("p", "form-error"),
      submit = BW.el("button", "primary-btn", "Dispatch item");
    [...select.options].forEach(
      (o, i) =>
        (o.textContent =
          items[i]["Item name"] + " · " + items[i]["Stock (units)"] + " units"),
    );
    [...project.options].forEach(
      (o, i) =>
        (o.textContent = BW.data.Projects[i]["Project name"] + " · " + o.value),
    );
    serial.autocomplete = "off";
    serial.maxLength = 100;
    error.setAttribute("role", "alert");
    form.append(grid, error, submit);
    body.append(form);
    serial.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      const code = serial.value.trim().toUpperCase();
      if (!code) {
        error.textContent = "Enter a serial number.";
        return;
      }
      submit.disabled = true;
      try {
        BW.data = await BW.api.dispatch(select.value, code, project.value);
        document.querySelectorAll("dialog[open]").forEach((d) => d.close());
        BW.render();
        BW.toast("Item dispatched");
      } catch (e) {
        error.textContent = e.message;
      } finally {
        submit.disabled = false;
      }
    };
  }
  BW.controllers.Inventory = {
    toolbar(filters) {
      filters.append(BW.button("Dispatch scanner", () => scanner()));
    },
    decorate({ record, body }) {
      if (!record.id) return;
      BW.workflow(body, "Warehouse", [
        BW.button("Dispatch serial", () => scanner(record)),
      ]);
      if (record.dispatches?.length) {
        body.append(BW.el("h3", "detail-title", "Dispatch history"));
        for (const d of record.dispatches)
          body.append(
            BW.el(
              "p",
              "form-caption",
              d.serial +
                " · " +
                d.project +
                " · " +
                new Date(d.date).toLocaleDateString("en-IN"),
            ),
          );
      }
    },
  };
})();
