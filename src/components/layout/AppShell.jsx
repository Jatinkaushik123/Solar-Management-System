import { useState } from "react";
import Sidebar from "./Sidebar";
import TopHeader from "./TopHeader";
export default function AppShell({
  page,
  navigate,
  name,
  logout,
  search,
  children,
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="shell">
      <Sidebar
        {...{ page, navigate, name, logout, open }}
        close={() => setOpen(false)}
      />
      <div className="main-area">
        <TopHeader {...{ page, search }} openNav={() => setOpen(true)} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
