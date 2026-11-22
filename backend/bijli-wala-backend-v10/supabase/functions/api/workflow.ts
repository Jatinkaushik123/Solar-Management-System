type Route = { method: string; rpc: string; target?: string; action?: string; list?: boolean };
export function workflowRoute(path: string, method: string): Route | undefined {
  if (path === "/v1/enquiries") return method === "POST" ? { method, rpc: "solar_intake" } : { method: "GET", rpc: "solar_enquiries", list: true };
  if (path === "/v1/inventory/items") return { method: "GET", rpc: "solar_demo_stock" };
  if (path === "/v1/staff/assignees") return { method: "GET", rpc: "solar_assignees" };
  const match = /^\/v1\/(enquiries|quotes|staff)\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (!match) return;
  const [, resource, target, action] = match;
  if (resource === "staff") {
    if (action === "disable") return { method: "POST", rpc: "solar_disable_staff", target };
    return;
  }
  if (!action) return { method: "GET", rpc: resource === "quotes" ? "solar_quote" : "solar_enquiry", target };
  const permitted = resource === "enquiries" ? ["assignment", "designs", "return", "inventory-checks"] : ["pricing", "issue", "decision"];
  if (permitted.includes(action)) return { method: "POST", rpc: resource === "enquiries" ? "solar_review" : "solar_quote_command", target, action };
}

export const workflowActions: Record<string, string[]> = {
  customer: ["enquiries.create", "enquiries.read_own", "quotes.decide"],
  admin: ["enquiries.assign", "enquiries.read_all", "staff.disable"],
  technician: ["stock.read", "surveys.return", "designs.approve"],
  inventory: ["stock.read", "designs.check_stock"],
  sales: ["quotes.price", "quotes.issue"],
};
