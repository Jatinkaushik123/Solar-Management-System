(() => {
  const stages = [
    "Planning",
    "Site assessment",
    "Design approval",
    "Procurement",
    "Installation",
    "Commissioning",
  ];
  BW.controllers.Projects = {
    decorate({ body, record, extras, fields }) {
      const index =
        record.status === "Completed"
          ? 5
          : Math.max(
              0,
              stages.indexOf(
                record.stage ||
                  (record.status === "In progress"
                    ? "Installation"
                    : "Planning"),
              ),
            );
      const box = BW.el("section", "warranty-detail"),
        list = BW.el("ol", "stepper"),
        progress = BW.el("progress");
      progress.max = 6;
      progress.setAttribute("aria-label", "Project stage");
      box.append(BW.el("h3", "", "Project stages"), progress, list);
      body.append(box);
      function select(i, manual) {
        extras.stage = stages[i];
        progress.value = i + 1;
        if (manual)
          fields.status.value =
            i === 5 ? "Completed" : i === 0 ? "Planning" : "In progress";
        Array.from(list.children).forEach((li, j) => {
          li.classList.toggle("done", j <= i);
          li.firstChild.setAttribute("aria-pressed", j === i);
        });
      }
      stages.forEach((s, i) => {
        const li = BW.el("li");
        li.append(BW.button(s, () => select(i, true)));
        list.append(li);
      });
      fields.status.onchange = () => {
        if (fields.status.value === "Completed") select(5, false);
        else if (fields.status.value === "Planning") select(0, false);
        else if (extras.stage === stages[5]) select(4, false);
      };
      select(index, false);
    },
  };
})();
