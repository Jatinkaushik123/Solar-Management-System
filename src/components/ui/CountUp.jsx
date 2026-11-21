import { useLayoutEffect, useRef } from "react";

export default function CountUp({ value, replay }) {
  const node = useRef(null);
  useLayoutEffect(() => {
    const element = node.current,
      preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const number = Number(String(value).replaceAll(",", "")),
      decimals = String(value).split(".")[1]?.length || 0;
    const format = new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: decimals,
    });
    let frame;
    function finish() {
      cancelAnimationFrame(frame);
      element.textContent = String(value);
    }
    function changed() {
      if (preference.matches) finish();
    }
    if (preference.matches || !Number.isFinite(number) || number === 0) {
      finish();
      return;
    }
    const start = performance.now();
    element.textContent = "0";
    function tick(now) {
      const t = Math.min(1, (now - start) / 600);
      element.textContent = format.format(number * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
      else finish();
    }
    frame = requestAnimationFrame(tick);
    preference.addEventListener("change", changed);
    return () => {
      cancelAnimationFrame(frame);
      preference.removeEventListener("change", changed);
    };
  }, [value, replay]);
  return (
    <>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" ref={node}>
        {value}
      </span>
    </>
  );
}
