BW.animateNumbers = function (root) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  root.querySelectorAll("[data-count]").forEach((node) => {
    const target = Number(node.dataset.count),
      fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
    const start = performance.now();
    function tick(now) {
      if (!node.isConnected) return;
      const t = reduced.matches ? 1 : Math.min(1, (now - start) / 600);
      node.textContent = fmt.format(
        t < 1 ? Math.round(target * (1 - (1 - t) ** 3)) : target,
      );
      if (t < 1) requestAnimationFrame(tick);
    }
    if (!reduced.matches) node.textContent = "0";
    requestAnimationFrame(tick);
  });
};
BW.staggerRows = function (body) {
  Array.from(body.rows).forEach((row, i) =>
    row.style.setProperty("--row-delay", Math.min(i, 8) * 24 + "ms"),
  );
};
