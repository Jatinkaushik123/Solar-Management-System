/* global BW, Chart */
(() => {
  "use strict";

  const stages = ["In progress", "Completed", "Planning", "On hold"];
  const colors = ["#35cab3", "#76a5fb", "#f9bb68", "#8996b0"];
  let liveCharts = [];
  let selectedPeriod = 6;

  function section(title, subtitle, chart = false) {
    const panel = BW.el("section", chart ? "panel chart-panel" : "panel");
    const heading = BW.el("div", "panel-heading");
    const copy = BW.el("div");
    copy.append(BW.el("h2", "", title), BW.el("p", "", subtitle));
    heading.append(copy);
    panel.append(heading);
    return { panel, heading };
  }

  function canvas(label) {
    const element = BW.el("canvas");
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", label);
    return element;
  }

  function chartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#142437",
          borderColor: "#34445a",
          borderWidth: 1,
          padding: 10,
        },
      },
    };
  }

  function projectChart(charts, projects) {
    const { panel } = section(
      "Project status",
      "Portfolio breakdown by stage",
      true,
    );
    const body = BW.el("div", "donut-layout");
    const ring = BW.el("div", "donut");
    const plot = canvas(
      "Project status breakdown. Counts by stage appear in the legend.",
    );
    const center = BW.el("div", "donut-center");
    center.append(
      BW.el("strong", "", String(projects.length)),
      BW.el("span", "", "Projects"),
    );
    const legend = BW.el("div", "legend");
    const counts = stages.map((stage, index) => {
      const count = projects.filter(
        (project) => project.status === stage,
      ).length;
      const row = BW.el("div");
      const key = BW.el("i");
      key.style.backgroundColor = colors[index];
      row.append(key, BW.el("span", "", stage), BW.el("b", "", String(count)));
      legend.append(row);
      return count;
    });
    ring.append(plot, center);
    body.append(ring, legend);
    panel.append(body);
    charts.append(panel);
    liveCharts.push(
      new Chart(plot, {
        type: "doughnut",
        data: {
          labels: stages,
          datasets: [
            {
              data: counts,
              backgroundColor: colors,
              borderWidth: 0,
              spacing: 3,
            },
          ],
        },
        options: { ...chartOptions(), cutout: "73%" },
      }),
    );
  }

  function monthlyTotals(installations, months) {
    const now = new Date();
    return Array.from({ length: months }, (_, i) => {
      const date = new Date(
        now.getFullYear(),
        now.getMonth() - months + i + 1,
        1,
      );
      const prefix =
        date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
      const value = installations.filter(
        (item) =>
          item.status === "Commissioned" &&
          String(item["Installation date"]).startsWith(prefix + "-"),
      ).length;
      return {
        month: date.toLocaleDateString("en-IN", { month: "short" }),
        value,
      };
    });
  }

  function installationChart(charts, installations) {
    const { panel, heading } = section(
      "Monthly installations",
      "Commissioned solar systems",
      true,
    );
    const period = BW.el("select");
    period.setAttribute("aria-label", "Chart period");
    [6, 3].forEach((months) =>
      period.add(new Option(months + " months", String(months))),
    );
    period.value = String(selectedPeriod);
    heading.append(period);
    const wrap = BW.el("div", "bar-chart");
    wrap.style.position = "relative";
    const plot = canvas("Monthly installations");
    wrap.append(plot);
    panel.append(wrap);
    charts.append(panel);
    const totals = monthlyTotals(installations, selectedPeriod);
    function describe(items) {
      plot.setAttribute(
        "aria-label",
        "Monthly installations. " +
          items.map((item) => item.month + " " + item.value).join(", "),
      );
    }
    describe(totals);
    const chart = new Chart(plot, {
      type: "bar",
      data: {
        labels: totals.map((item) => item.month),
        datasets: [
          {
            label: "Installations",
            data: totals.map((item) => item.value),
            backgroundColor: "#f4b45e",
            maxBarThickness: 36,
            borderRadius: 4,
          },
        ],
      },
      options: {
        ...chartOptions(),
        layout: { padding: { top: 6, right: 8 } },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: "#afbdd0" },
          },
          y: {
            beginAtZero: true,
            suggestedMax: 1,
            grid: { color: "#314054", drawTicks: false },
            border: { display: false, dash: [3, 5] },
            ticks: {
              color: "#afbdd0",
              precision: 0,
              maxTicksLimit: 6,
              padding: 7,
            },
          },
        },
      },
    });
    liveCharts.push(chart);
    period.addEventListener("change", () => {
      selectedPeriod = Number(period.value);
      const items = monthlyTotals(installations, selectedPeriod);
      chart.data.labels = items.map((item) => item.month);
      chart.data.datasets[0].data = items.map((item) => item.value);
      describe(items);
      chart.update();
    });
  }

  function render() {
    liveCharts.forEach((chart) => chart.destroy());
    liveCharts = [];
    const {
      Projects: projects,
      Installations: installs,
      Enquiries: enquiries,
    } = BW.data;
    const heading = BW.heading(
      "Dashboard",
      "An overview of your solar installation operations.",
      "New enquiry",
      () => BW.edit("Enquiries"),
    );
    const cards = BW.kpis([
      {
        label: "Total enquiries",
        value: enquiries.length,
        icon: "messages-square",
        color: "blue",
        detail:
          enquiries.filter((item) => item.status === "New").length +
          " awaiting contact",
      },
      {
        label: "Active projects",
        value: projects.filter((item) => item.status === "In progress").length,
        icon: "folder-kanban",
        color: "teal",
        detail: projects.length + " projects in portfolio",
      },
      {
        label: "Installations",
        value: installs.filter((item) => item.status === "Commissioned").length,
        icon: "hard-hat",
        color: "amber",
        detail:
          installs.filter((item) => item.status === "Scheduled").length +
          " upcoming installations",
      },
      {
        label: "Project capacity",
        value: projects.reduce(
          (sum, item) => sum + Number(item["Capacity (kW)"]),
          0,
        ),
        unit: "kW",
        icon: "zap",
        color: "purple",
        detail: "Across all projects",
      },
    ]);
    const charts = BW.el("div", "charts");
    const recent = section(
      "Recent projects",
      "Latest project records and their current stage",
    );
    const viewAll = BW.el("a", "secondary-btn", "View all projects");
    viewAll.href = "projects.html";
    recent.heading.append(viewAll);
    recent.panel.append(
      BW.table("Projects", projects.slice(0, 5), [
        "Project name",
        "City",
        "Capacity (kW)",
      ]),
    );
    BW.main.replaceChildren(heading, cards, charts, recent.panel);
    projectChart(charts, projects);
    installationChart(charts, installs);
  }

  BW.controllers.Dashboard = { render };
})();
