import {
  LayoutDashboard,
  MessagesSquare,
  ClipboardList,
  FileText,
  FolderKanban,
  Boxes,
  Wrench,
  ShieldCheck,
  Sun,
  LogOut,
  X,
} from "lucide-react";
import { modules } from "../../data/mockSolarData";
export const icons = [
  LayoutDashboard,
  MessagesSquare,
  ClipboardList,
  FileText,
  FolderKanban,
  Boxes,
  Wrench,
  ShieldCheck,
];
export default function Sidebar({ page, navigate, open, close, name, logout }) {
  return (
    <>
      {open && (
        <button
          className="scrim"
          onClick={close}
          aria-label="Close navigation"
        />
      )}
      <aside className={"sidebar " + (open ? "visible" : "")}>
        <div className="brand">
          <span>
            <Sun size={25} strokeWidth={2.2} />
          </span>
          <div>
            Bijli Wala<small>SOLAR MANAGEMENT</small>
          </div>
          <button
            className="mobile icon-btn"
            onClick={close}
            aria-label="Close navigation"
          >
            <X />
          </button>
        </div>
        <div className="nav-label">Workspace</div>
        <nav>
          {modules.map((m, i) => {
            const Icon = icons[i];
            return (
              <a
                href={"#/" + m.toLowerCase()}
                key={m}
                aria-current={page === m ? "page" : undefined}
                className={page === m ? "selected" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(m);
                  close();
                }}
              >
                <Icon size={18} />
                {m}
                {page === m && <i />}
              </a>
            );
          })}
        </nav>
        <div className="account">
          <span className="avatar">
            {name
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div>
            {name}
            <small>Administrator</small>
          </div>
          <button className="icon-btn" aria-label="Sign out" onClick={logout}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
    </>
  );
}
