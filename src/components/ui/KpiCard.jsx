import CountUp from "./CountUp";
export default function KpiCard({
  replay,
  label,
  value,
  detail,
  icon: Icon,
  color = "teal",
  unit,
}) {
  return (
    <article className="kpi">
      <div className="kpi-top">
        <span>{label}</span>
        <span className={"icon-tile " + color}>
          <Icon size={19} />
        </span>
      </div>
      <strong>
        <CountUp value={value} replay={replay} /> <small>{unit}</small>
      </strong>
      <p>{detail}</p>
    </article>
  );
}
