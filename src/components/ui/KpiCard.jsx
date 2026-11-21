export default function KpiCard({
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
        {value} <small>{unit}</small>
      </strong>
      <p>{detail}</p>
    </article>
  );
}
