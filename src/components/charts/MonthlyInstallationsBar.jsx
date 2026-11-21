import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
export default function MonthlyInstallationsBar({ rows }) {
  const [months, setMonths] = useState(6),
    now = new Date();
  const data = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - months + i + 1, 1);
    return {
      month: d.toLocaleDateString("en-IN", { month: "short" }),
      Installations: rows.filter((r) => {
        const date = new Date(r["Installation date"] + "T12:00:00");
        return (
          r.status === "Commissioned" &&
          date.getMonth() === d.getMonth() &&
          date.getFullYear() === d.getFullYear()
        );
      }).length,
    };
  });
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h2>Monthly installations</h2>
          <p>Commissioned solar systems</p>
        </div>
        <select
          aria-label="Chart period"
          value={months}
          onChange={(e) => setMonths(+e.target.value)}
        >
          <option value={6}>6 months</option>
          <option value={3}>3 months</option>
        </select>
      </div>
      <div className="bar-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: -24, bottom: 0 }}
          >
            <CartesianGrid
              stroke="#314054"
              strokeDasharray="3 5"
              vertical={false}
            />
            <XAxis
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              dataKey="month"
              tick={{ fill: "#afbdd0", fontSize: 12 }}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#afbdd0", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "#25364b" }}
              contentStyle={{
                background: "#142437",
                border: "1px solid #34445a",
                borderRadius: 8,
              }}
            />
            <Bar
              dataKey="Installations"
              fill="#f4b45e"
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
