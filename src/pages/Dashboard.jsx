import { MessagesSquare, FolderKanban, HardHat, Zap, Plus } from "lucide-react";
import KpiCard from "../components/ui/KpiCard";
import DataTable from "../components/ui/DataTable";
import ProjectStatusDonut from "../components/charts/ProjectStatusDonut";
import MonthlyInstallationsBar from "../components/charts/MonthlyInstallationsBar";
export default function Dashboard({ data, navigate, edit }) {
  const p = data.Projects,
    ins = data.Installations;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>An overview of your solar installation operations.</p>
        </div>
        <button className="primary-btn" onClick={() => edit("Enquiries")}>
          <Plus size={17} />
          New enquiry
        </button>
      </div>
      <div className="kpis">
        <KpiCard
          label="Total enquiries"
          value={data.Enquiries.length}
          detail={
            data.Enquiries.filter((r) => r.status === "New").length +
            " awaiting contact"
          }
          icon={MessagesSquare}
          color="blue"
        />
        <KpiCard
          label="Active projects"
          value={p.filter((r) => r.status === "In progress").length}
          detail={p.length + " projects in portfolio"}
          icon={FolderKanban}
        />
        <KpiCard
          label="Installations"
          value={ins.filter((r) => r.status === "Commissioned").length}
          detail={
            ins.filter((r) => r.status === "Scheduled").length +
            " upcoming installations"
          }
          icon={HardHat}
          color="amber"
        />
        <KpiCard
          label="Project capacity"
          value={p
            .reduce((s, r) => s + Number(r["Capacity (kW)"]), 0)
            .toLocaleString("en-IN")}
          unit="kW"
          detail="Across all projects"
          icon={Zap}
          color="purple"
        />
      </div>
      <div className="charts">
        <ProjectStatusDonut projects={p} />
        <MonthlyInstallationsBar rows={ins} />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent projects</h2>
            <p>Latest project records and their current stage</p>
          </div>
          <button
            className="secondary-btn"
            onClick={() => navigate("Projects")}
          >
            View all projects
          </button>
        </div>
        <DataTable
          rows={p.slice(0, 5)}
          fields={["Project name", "City", "Capacity (kW)"]}
          onSelect={(r) => edit("Projects", r)}
        />
      </section>
    </>
  );
}
