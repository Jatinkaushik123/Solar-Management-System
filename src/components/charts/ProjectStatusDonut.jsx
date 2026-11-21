import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { schemas } from "../../data/mockSolarData";
const colors = ["#35cab3", "#76a5fb", "#f9bb68", "#8996b0"];
export default function ProjectStatusDonut({ projects }) {
  const data = schemas.Projects.statuses.map((name, i) => ({
    name,
    value: projects.filter((p) => p.status === name).length,
    color: colors[i],
  }));
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h2>Project status</h2>
          <p>Portfolio breakdown by stage</p>
        </div>
      </div>
      <div className="donut-layout">
        <div className="donut">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius="73%"
                outerRadius="98%"
                startAngle={90}
                endAngle={-270}
                paddingAngle={3}
                stroke="none"
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "#142437",
                  border: "1px solid #34445a",
                }}
                itemStyle={{ color: "white" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <strong>{projects.length}</strong>
            <span>Projects</span>
          </div>
        </div>
        <div className="legend">
          {data.map((d) => (
            <div key={d.name}>
              <i style={{ background: d.color }} />
              <span>{d.name}</span>
              <b>{d.value}</b>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
