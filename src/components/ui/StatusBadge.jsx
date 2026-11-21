const tones = {
  "In progress": "teal",
  Completed: "green",
  Planning: "blue",
  "On hold": "amber",
  Qualified: "green",
  Approved: "green",
  Accepted: "green",
  Commissioned: "green",
  Active: "teal",
  "In stock": "green",
  "Low stock": "amber",
  "Out of stock": "red",
  "Claim open": "amber",
  Scheduled: "blue",
  "On site": "teal",
};
export default function StatusBadge({ status }) {
  return (
    <span className={"badge " + (tones[status] || "slate")}>
      <i />
      {status}
    </span>
  );
}
