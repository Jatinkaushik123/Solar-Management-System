BW.controllers.Enquiries = {
  decorate({ fields }) {
    fields.Phone.autocomplete = "tel";
    fields.Customer.autocomplete = "name";
    fields.City.autocomplete = "address-level2";
  },
};
