(() => {
  const rates = {
    module: 12500,
    inverter: 12000,
    structure: 3800,
    protection: 4200,
    labour: 4000,
  };
  function kit(kw) {
    return [
      ["500 W PV module", kw * 2, rates.module],
      ["Grid-tied inverter · " + kw + " kW", 1, rates.inverter * kw],
      ["Roof mounting kit", kw, rates.structure],
      ["AC/DC protection set", 1, rates.protection],
      ["Installation per kW", kw, rates.labour],
    ];
  }
  function calculator(apply, initial) {
    const { dialog, body } = BW.modal("Solar kit calculator", "spotlight"),
      grid = BW.el("div", "form-grid"),
      power = BW.input(
        grid,
        "System size (kW)",
        String(Math.max(1, Math.min(5, Math.round(Number(initial) || 1)))),
        "text",
        ["1", "2", "3", "4", "5"],
      ),
      out = BW.el("div"),
      money = (n) => BW.displayValue("Amount (₹)", n);
    body.append(grid, out);
    function render() {
      const lines = kit(Number(power.value)),
        total = lines.reduce((s, [, qty, price]) => s + qty * price, 0),
        table = BW.el("table"),
        thead = table.createTHead().insertRow();
      ["Component", "Qty", "Subtotal"].forEach((s) =>
        thead.append(BW.el("th", "", s)),
      );
      const tbody = table.createTBody();
      for (const [name, qty, price] of lines) {
        const row = tbody.insertRow();
        [name, qty, money(qty * price)].forEach(
          (v) => (row.insertCell().textContent = v),
        );
      }
      const wrap = BW.el("div", "table-scroll");
      wrap.append(table);
      out.replaceChildren(
        wrap,
        BW.el("p", "form-caption", "Indicative kit estimate · " + money(total)),
        BW.button(
          "Apply to quotation",
          () => {
            dialog.close();
            apply(Number(power.value), total, lines);
          },
          "primary-btn",
        ),
      );
    }
    power.onchange = render;
    render();
  }
  BW.controllers.Quotations = {
    decorate({ fields, body, extras, record }) {
      BW.workflow(body, "Bill of materials", [
        BW.button("Calculate kit", () =>
          calculator((kw, total, lines) => {
            fields["Capacity (kW)"].value = kw;
            fields["Amount (₹)"].value = total;
            extras.bom = lines;
            fields["Capacity (kW)"].dispatchEvent(
              new Event("input", { bubbles: true }),
            );
          }, fields["Capacity (kW)"].value),
        ),
      ]);
      if (record.bom) {
        const list = BW.el("ul", "kit-list");
        record.bom.forEach(([name, qty]) =>
          list.append(BW.el("li", "", qty + " × " + name)),
        );
        body.append(list);
      }
    },
    toolbar(filters) {
      filters.append(
        BW.button("Kit calculator", () =>
          calculator((kw, total, bom) =>
            BW.edit("Quotations", {
              "Capacity (kW)": kw,
              "Amount (₹)": total,
              bom,
            }),
          ),
        ),
      );
    },
  };
})();
