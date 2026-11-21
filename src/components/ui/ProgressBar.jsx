export default function ProgressBar({ value, label }) {
  return (
    <div className="progress">
      <span>
        {label} · {value}%
      </span>
      <progress value={value} max={100} />
    </div>
  );
}
