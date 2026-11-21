(() => {
  function handover(onSigned) {
    const { dialog, body } = BW.modal("Installation handover", "spotlight"),
      form = BW.el("form"),
      grid = BW.el("div", "form-grid"),
      name = BW.input(grid, "Customer name", "", "text"),
      canvas = BW.el("canvas", "signature-pad"),
      ctx = canvas.getContext("2d"),
      hint = BW.el(
        "p",
        "form-caption",
        "Draw a signature or use the customer’s typed name.",
      ),
      error = BW.el("p", "form-error"),
      actions = BW.el("div", "modal-actions");
    canvas.width = 720;
    canvas.height = 240;
    canvas.setAttribute("aria-label", "Customer signature pad");
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#182536";
    let pointer = null,
      ink = false;
    function point(e) {
      const box = canvas.getBoundingClientRect();
      return [
        ((e.clientX - box.left) * canvas.width) / box.width,
        ((e.clientY - box.top) * canvas.height) / box.height,
      ];
    }
    canvas.onpointerdown = (e) => {
      if (pointer !== null) return;
      canvas.setPointerCapture(e.pointerId);
      pointer = e.pointerId;
      const [x, y] = point(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 0.1, y + 0.1);
      ctx.stroke();
      ink = true;
    };
    canvas.onpointermove = (e) => {
      if (pointer === e.pointerId) {
        ctx.lineTo(...point(e));
        ctx.stroke();
      }
    };
    canvas.onlostpointercapture = () => (pointer = null);
    const clear = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ink = false;
    };
    const typed = BW.button("Use typed signature", () => {
      if (!name.value.trim()) {
        name.reportValidity();
        return;
      }
      clear();
      ctx.fillStyle = "#182536";
      ctx.font = "italic 48px Georgia";
      ctx.fillText(name.value.trim(), 20, 130, 680);
      ink = true;
    });
    const confirm = BW.el("button", "primary-btn", "Confirm handover");
    actions.append(BW.button("Clear", clear), typed, confirm);
    form.append(grid, hint, canvas, error, actions);
    body.append(form);
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!name.value.trim() || !ink) {
        error.textContent = "Enter the customer name and add a signature.";
        return;
      }
      dialog.close();
      onSigned({
        customer: name.value.trim(),
        date: new Date().toISOString(),
        signature: canvas.toDataURL("image/png"),
      });
    };
  }
  BW.controllers.Installations = {
    decorate({ record, body, save, fields }) {
      if (!record.id) return;
      const buttons = [];
      if (record.status === "Scheduled")
        buttons.push(
          BW.button("Dispatch crew", () =>
            save({ status: "On site" }, "Installation dispatched"),
          ),
        );
      if (!record.handover)
        buttons.push(
          BW.button("Capture handover", () => {
            if (fields.status.form.reportValidity())
              handover((handover) =>
                save({ status: "Commissioned", handover }, "Handover signed"),
              );
          }),
        );
      if (buttons.length) BW.workflow(body, "Field operations", buttons);
      if (record.handover) {
        const image = BW.el("img", "signature-pad");
        image.alt = "Customer handover signature";
        if (/^data:image\/png;base64,/.test(record.handover.signature))
          image.src = record.handover.signature;
        body.append(
          BW.el("h3", "detail-title", "Signed handover"),
          BW.el(
            "p",
            "form-caption",
            record.handover.customer +
              " · " +
              new Date(record.handover.date).toLocaleDateString("en-IN"),
          ),
          image,
        );
      }
    },
  };
})();
