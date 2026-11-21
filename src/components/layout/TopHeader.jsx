import { PanelLeft, ChevronRight, Search, CalendarDays } from "lucide-react";
export default function TopHeader({ page, openNav, search }) {
  return (
    <header className="top-header">
      <button
        className="mobile icon-btn"
        onClick={openNav}
        aria-label="Open navigation"
      >
        <PanelLeft size={20} />
      </button>
      <div className="crumb">
        <span>Workspace</span>
        <ChevronRight size={14} />
        {page}
      </div>
      <div className="header-tools">
        <button className="global-search" onClick={search}>
          <Search size={16} />
          <span>Search workspace</span>
          <kbd>Ctrl K</kbd>
        </button>
        <span className="date">
          <CalendarDays size={15} />
          {new Date().toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>
    </header>
  );
}
