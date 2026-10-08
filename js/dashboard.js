// ============================================================
//  SmartEnergy Monitor — Dashboard Controller
//  js/dashboard.js
// ============================================================

import { database, DB_PATHS, DEFAULT_SETTINGS } from "./firebase-config.js";
import {
  ref, onValue, set, push, serverTimestamp, get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { SerialManager }    from "./serial.js";
import { EnergyCalculator, AnomalyDetector, fmt, fmtCost, fmtKwh } from "./energy.js";
import { LiveChart }        from "./analytics.js";

// ── Toast helper ─────────────────────────────────────────────
export function showToast(msg, type = "info", duration = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || "ℹ️"}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── Update header time ────────────────────────────────────────
export function startClock(el) {
  const update = () => {
    const now = new Date();
    if (el) el.textContent = now.toLocaleString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      day: "2-digit",  month: "short",    year: "numeric"
    });
  };
  update();
  setInterval(update, 1000);
}

// ── Dashboard Manager ─────────────────────────────────────────
export class DashboardManager {
  constructor(config) {
    this.uid      = config.uid;
    this.deviceId = config.deviceId;
    this.settings = { ...DEFAULT_SETTINGS };
    this.serial   = null;
    this.calc     = null;
    this.anomaly  = null;
    this.liveChart = null;
    this.currentMetric = "power"; // voltage | current | power

    this.deviceOnlineTimeout = null;
    this.DEVICE_TIMEOUT = 8000;

    // Firebase refs
    this.latestRef = ref(database, DB_PATHS.deviceLatest(this.deviceId));
    this.readingsRef = ref(database, DB_PATHS.readings(this.uid, this.deviceId));
  }

  // ── Load settings from Firebase ───────────────────────────────
  async loadSettings() {
    try {
      const snap = await get(ref(database, DB_PATHS.settings()));
      if (snap.exists()) {
        const s = snap.val();
        if (s.tariff)      Object.assign(this.settings.tariff,      s.tariff);
        if (s.calibration) Object.assign(this.settings.calibration, s.calibration);
        if (s.thresholds)  Object.assign(this.settings.thresholds,  s.thresholds);
      }
    } catch (e) { console.warn("Could not load settings:", e); }

    // Initialize calculators
    this.calc = new EnergyCalculator({
      ...this.settings.calibration,
      ratePerUnit: this.settings.tariff.ratePerUnit
    });
    this.anomaly = new AnomalyDetector(this.settings.thresholds);
  }

  // ── Initialize Live Chart ─────────────────────────────────────
  initChart(canvas) {
    const colors = { voltage: "#00d4ff", current: "#f59e0b", power: "#ef4444" };
    this.liveChart = new LiveChart(canvas, 60, {
      datasets: [{
        label:           "Power (W)",
        data:            [],
        borderColor:     colors.power,
        backgroundColor: `${colors.power}18`,
        fill:            true,
        tension:         0.4,
        borderWidth:     2,
        pointRadius:     0
      }],
      yAxis: { beginAtZero: true }
    });
  }

  // ── Switch live chart metric ──────────────────────────────────
  switchMetric(metric) {
    const colors = { voltage: "#00d4ff", current: "#f59e0b", power: "#ef4444" };
    const labels = { voltage: "Voltage (V)", current: "Current (A)", power: "Power (W)" };
    this.currentMetric = metric;
    if (this.liveChart) {
      this.liveChart.setDataset(0, colors[metric]);
      this.liveChart.chart.data.datasets[0].label = labels[metric];
      this.liveChart.clear();
      this.liveChart.chart.update();
    }
  }

  // ── Handle incoming serial data ───────────────────────────────
  async handleSerialData(raw) {
    // Apply calibration
    const { voltage, current } = this.calc.calibrate(raw.voltage, raw.current);
    const power    = this.calc.calculatePower(voltage, current);
    const now      = Date.now();
    const deltaWh  = this.calc.accumulateEnergy(power, now);
    const energyKwh = this.calc.getTotalKwh();
    const cost     = this.calc.getEstimatedCost();

    const reading = {
      voltage, current, power,
      energy_kwh:     energyKwh,
      estimated_cost: cost,
      timestamp:      new Date().toISOString(),
      device_id:      raw.device_id || this.deviceId
    };

    // Update UI
    this.updateKPIs(reading);

    // Push to live chart
    if (this.liveChart) {
      const t = new Date().toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const val = reading[this.currentMetric === "voltage" ? "voltage" : this.currentMetric === "current" ? "current" : "power"];
      this.liveChart.push(t, val);
    }

    // Anomaly detection
    const alerts = this.anomaly.check(reading);
    this.updateAlerts(alerts);

    // Save to Firebase (every 30 seconds to avoid excess writes)
    if (!this._lastSaveTime || (now - this._lastSaveTime) >= 30000) {
      this._lastSaveTime = now;
      await this.saveToFirebase(reading);
    }

    // Update device online timeout
    this.resetDeviceTimeout();
  }

  // ── Save reading to Firebase ──────────────────────────────────
  async saveToFirebase(reading) {
    try {
      const ts = Date.now().toString();
      await set(ref(database, DB_PATHS.readingAt(this.uid, this.deviceId, ts)), reading);
      await set(this.latestRef, { ...reading, online: true });
    } catch (e) {
      console.warn("Firebase write error:", e);
    }
  }

  // ── Update KPI cards ──────────────────────────────────────────
  updateKPIs(reading) {
    const sym = this.settings.tariff.symbol || "₹";
    this._setEl("kpi-voltage",  `${fmt(reading.voltage, 1)}`);
    this._setEl("kpi-current",  `${fmt(reading.current, 2)}`);
    this._setEl("kpi-power",    `${fmt(reading.power, 1)}`);
    this._setEl("kpi-energy",   `${fmt(reading.energy_kwh, 3)}`);
    this._setEl("kpi-cost",     `${sym}${fmt(reading.estimated_cost, 2)}`);

    // Today stats
    const today = this.calc.getTodayStats();
    if (today) {
      this._setEl("today-energy", `${fmt(today.energyKwh, 3)} kWh`);
      this._setEl("today-cost",   `${sym}${fmt(today.cost, 2)}`);
      this._setEl("today-max",    `${fmt(today.maxPower, 0)} W`);
      this._setEl("today-min",    `${fmt(today.minPower, 0)} W`);
      this._setEl("today-peak",   today.peakHour);
      this._setEl("today-low",    today.lowHour);
    }
  }

  // ── Update alert banners ──────────────────────────────────────
  updateAlerts(alerts) {
    const banner = document.getElementById("alert-banner");
    if (!banner) return;
    if (alerts.length > 0) {
      banner.classList.remove("hidden");
      const msgEl = banner.querySelector(".alert-banner-text p");
      if (msgEl) msgEl.textContent = alerts.map(a => a.msg).join(" | ");
    } else {
      banner.classList.add("hidden");
    }
  }

  // ── Device online/offline ─────────────────────────────────────
  resetDeviceTimeout() {
    if (this.deviceOnlineTimeout) clearTimeout(this.deviceOnlineTimeout);
    this.setDeviceStatus(true);
    this.deviceOnlineTimeout = setTimeout(() => this.setDeviceStatus(false), this.DEVICE_TIMEOUT);
  }

  setDeviceStatus(online) {
    const el  = document.getElementById("device-status-text");
    const dot = document.getElementById("device-status-dot");
    const lastEl = document.getElementById("last-reading-time");

    if (el)  el.textContent = online ? "Connected" : "Offline";
    if (dot) {
      dot.className = "dot " + (online ? "dot-success pulse" : "dot-danger");
    }
    if (lastEl && online) {
      lastEl.textContent = this.serial ? (this.serial.timeSinceData() || "Just now") : "Just now";
    }
  }

  // ── Setup sidebar toggle (mobile) ─────────────────────────────
  static setupSidebar() {
    const toggle  = document.getElementById("menu-toggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");

    if (!toggle || !sidebar) return;

    toggle.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      if (overlay) overlay.classList.toggle("visible");
    });

    overlay?.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("visible");
    });
  }

  // ── Private helper ────────────────────────────────────────────
  _setEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
}

// ── Admin management helpers ──────────────────────────────────
export async function loadAllUsers() {
  const snap = await get(ref(database, DB_PATHS.allUsers()));
  if (!snap.exists()) return [];
  const users = [];
  snap.forEach((child) => {
    users.push({ uid: child.key, ...child.val() });
  });
  return users;
}

export async function loadUserWithLatest(uid) {
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), 1200));
    const userSnap = await Promise.race([get(ref(database, DB_PATHS.users(uid))), timeout]);
    if (!userSnap || !userSnap.exists()) return null;
    const data = userSnap.val();

    const deviceId = data.profile?.deviceId;
    if (deviceId) {
      try {
        const devTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), 800));
        const latestSnap = await Promise.race([get(ref(database, DB_PATHS.deviceLatest(deviceId))), devTimeout]);
        if (latestSnap && latestSnap.exists()) data.latest = latestSnap.val();
      } catch {}
    }
    return { uid, ...data };
  } catch {
    return null;
  }
}
