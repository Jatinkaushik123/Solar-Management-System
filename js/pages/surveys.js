BW.controllers.Surveys = {
  decorate({ record, body, save, grid, fields }) {
    fields["Survey notes"] = BW.input(
      grid,
      "Survey notes",
      record["Survey notes"] || "",
    );
    fields["Survey notes"].required = false;
    if (record.id && record.status !== "Approved")
      BW.workflow(body, "Site assessment", [
        BW.button("Approve survey", () =>
          save({ status: "Approved" }, "Survey approved"),
        ),
      ]);
  },
};
