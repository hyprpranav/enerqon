// ============================================================
//  SmartEnergy Monitor — Analytics Module
//  js/analytics.js
// ============================================================

import { database, DB_PATHS } from "./firebase-config.js";
import {
  ref, query, orderByKey, startAt, endAt, get, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── Fetch readings for a date range ──────────────────────────
export async function fetchReadings(uid, deviceId, startDate, endDate) {
  try {
    const pathRef = ref(database, DB_PATHS.readings(uid, deviceId));
    const startTs = new Date(startDate).getTime().toString();
    const endTs   = new Date(endDate).getTime().toString();
    const q       = query(pathRef, orderByKey(), startAt(startTs), endAt(endTs));
    const snap    = await get(q);

    if (!snap.exists()) return [];

    const readings = [];
    snap.forEach((child) => readings.push({ ts: child.key, ...child.val() }));
    return readings;

  } catch (e) {
    console.error("fetchReadings:", e);
    return [];
  }
}

// ── Fetch today's readings ────────────────────────────────────
export async function fetchTodayReadings(uid, deviceId) {
  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return fetchReadings(uid, deviceId, today, tomorrow);
}

// ── Fetch last N readings ─────────────────────────────────────
export async function fetchLastN(uid, deviceId, n = 100) {
  try {
    const pathRef = ref(database, DB_PATHS.readings(uid, deviceId));
    const q       = query(pathRef, limitToLast(n));
    const snap    = await get(q);
    if (!snap.exists()) return [];
    const readings = [];
    snap.forEach((child) => readings.push({ ts: child.key, ...child.val() }));
    return readings;
  } catch (e) {
    console.error("fetchLastN:", e);
    return [];
  }
}

// ── Aggregate by day ──────────────────────────────────────────
export function aggregateByDay(readings) {
  const days = {};
  for (const r of readings) {
    const day = r.timestamp ? r.timestamp.substring(0, 10) : new Date(Number(r.ts)).toISOString().substring(0, 10);
    if (!days[day]) days[day] = { energyKwh: 0, cost: 0, count: 0, maxPower: 0, readings: [] };
    days[day].energyKwh += (r.energy_kwh || 0);
    days[day].cost       += (r.estimated_cost || 0);
    days[day].maxPower    = Math.max(days[day].maxPower, r.power || 0);
    days[day].count++;
    days[day].readings.push(r);
  }
  return days;
}

// ── Aggregate by hour ─────────────────────────────────────────
export function aggregateByHour(readings, dateStr) {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, "0")}:00`,
    energyKwh: 0,
    avgPower: 0,
    count: 0
  }));

  for (const r of readings) {
    const ts  = r.timestamp ? new Date(r.timestamp) : new Date(Number(r.ts));
    const day = ts.toISOString().substring(0, 10);
    if (dateStr && day !== dateStr) continue;
    const h = ts.getHours();
    hours[h].energyKwh += (r.energy_kwh || 0);
    hours[h].avgPower   += (r.power || 0);
    hours[h].count++;
  }

  for (const h of hours) {
    if (h.count > 0) h.avgPower = h.avgPower / h.count;
  }
  return hours;
}

// ── Find peak hour ────────────────────────────────────────────
export function findPeakHour(hourlyData) {
  let peak = { hour: null, energyKwh: 0 };
  for (const h of hourlyData) {
    if (h.energyKwh > peak.energyKwh) peak = h;
  }
  return peak;
}

// ── Find lowest hour ──────────────────────────────────────────
export function findLowestHour(hourlyData) {
  let low = { hour: null, energyKwh: Infinity };
  for (const h of hourlyData) {
    if (h.energyKwh < low.energyKwh && h.count > 0) low = h;
  }
  return low.hour !== null ? low : null;
}

// ── Chart.js helper — create line chart ──────────────────────
export function createLineChart(ctx, labels, datasets, options = {}) {
  return new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: { duration: 300 },
      plugins: {
        legend: { labels: { color: "#94a3b8", font: { size: 12, family: "Inter" } } },
        tooltip: {
          backgroundColor: "#222d42",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          titleColor: "#f1f5f9",
          bodyColor: "#94a3b8"
        }
      },
      scales: {
        x: {
          ticks: { color: "#64748b", font: { size: 11 }, maxRotation: 45 },
          grid:  { color: "rgba(255,255,255,0.04)" }
        },
        y: {
          ticks: { color: "#64748b", font: { size: 11 } },
          grid:  { color: "rgba(255,255,255,0.04)" },
          ...options.y
        }
      },
      ...options
    }
  });
}

// ── Chart.js helper — create bar chart ───────────────────────
export function createBarChart(ctx, labels, data, color = "#00d4ff", options = {}) {
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label:           options.label || "Energy (kWh)",
        data,
        backgroundColor: `${color}55`,
        borderColor:     color,
        borderWidth:     1.5,
        borderRadius:    4
      }]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#222d42",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          titleColor: "#f1f5f9",
          bodyColor: "#94a3b8"
        }
      },
      scales: {
        x: {
          ticks: { color: "#64748b", font: { size: 11 }, maxRotation: 45 },
          grid:  { display: false }
        },
        y: {
          ticks: { color: "#64748b", font: { size: 11 } },
          grid:  { color: "rgba(255,255,255,0.04)" }
        }
      }
    }
  });
}

// ── Live chart (fixed window) ─────────────────────────────────
export class LiveChart {
  constructor(ctx, windowSize = 60, options = {}) {
    this.windowSize = windowSize;
    this.labels     = [];
    this.datasets   = options.datasets || [
      { label: "Value", data: [], borderColor: "#00d4ff", backgroundColor: "rgba(0,212,255,0.1)", fill: true, tension: 0.4, borderWidth: 1.5, pointRadius: 0 }
    ];
    this.chart = new Chart(ctx, {
      type: "line",
      data: { labels: this.labels, datasets: this.datasets },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 200 },
        interaction:         { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#94a3b8", font: { size: 12 } } },
          tooltip: { backgroundColor: "#222d42", borderColor: "rgba(255,255,255,.1)", borderWidth: 1, titleColor: "#f1f5f9", bodyColor: "#94a3b8" }
        },
        scales: {
          x: { ticks: { color: "#64748b", font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,.04)" } },
          y: { ticks: { color: "#64748b", font: { size: 11 } }, grid: { color: "rgba(255,255,255,.04)" }, ...options.yAxis }
        }
      }
    });
  }

  // Push a new data point
  push(label, ...values) {
    this.labels.push(label);
    values.forEach((v, i) => {
      if (this.datasets[i]) this.datasets[i].data.push(v);
    });
    // Trim to window
    if (this.labels.length > this.windowSize) {
      this.labels.shift();
      this.datasets.forEach(ds => ds.data.shift());
    }
    this.chart.update("none");
  }

  setDataset(index, color) {
    if (this.datasets[index]) {
      this.datasets[index].borderColor     = color;
      this.datasets[index].backgroundColor = `${color}22`;
      this.chart.update();
    }
  }

  clear() {
    this.labels.length = 0;
    this.datasets.forEach(ds => ds.data.length = 0);
    this.chart.update();
  }

  destroy() { this.chart.destroy(); }
}
