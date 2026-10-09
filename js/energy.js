// ============================================================
//  SmartEnergy Monitor — Energy Calculation Module
//  js/energy.js
// ============================================================

export class EnergyCalculator {
  constructor(settings = {}) {
    this.powerFactor       = typeof settings.powerFactor === "number" ? settings.powerFactor : 0.98;
    this.ratePerUnit       = typeof settings.ratePerUnit === "number" ? settings.ratePerUnit : 5.00; // Default ₹5.00/kWh
    this.voltageMultiplier = typeof settings.voltageMultiplier === "number" ? settings.voltageMultiplier : 1.0;
    this.currentMultiplier = typeof settings.currentMultiplier === "number" ? settings.currentMultiplier : 1.0;
    this.voltageOffset     = typeof settings.voltageOffset === "number" ? settings.voltageOffset : 0.0;
    this.currentOffset     = typeof settings.currentOffset === "number" ? settings.currentOffset : 0.0;
    this.noiseCutoffAmps   = typeof settings.noiseCutoffAmps === "number" ? settings.noiseCutoffAmps : 0.04;
    this.sensorModel       = settings.sensorModel || "ACS712_05B";

    // Restore accumulated energy from localStorage across browser refreshes
    let savedWh = 0;
    try {
      savedWh = parseFloat(localStorage.getItem("smartenergy_accumulated_energy_wh")) || 0;
      if (!isFinite(savedWh) || savedWh < 0) savedWh = 0;
    } catch (_) {}

    this.energyWh        = savedWh; // Persistent Wh
    this.lastTimestamp   = null;    // Last calculation timestamp (ms)
    this.dailyData       = {};      // { "YYYY-MM-DD": { energyWh, maxPower, minPower, readings } }
    this.hourlyData      = {};      // { "YYYY-MM-DDTHH": energyWh }
  }

  // ── Apply Calibration (Single Execution Guard) ────────────────
  calibrate(rawVoltage, rawCurrent) {
    const rawV = (typeof rawVoltage === "number" && isFinite(rawVoltage)) ? rawVoltage : 0;
    const rawI = (typeof rawCurrent === "number" && isFinite(rawCurrent)) ? rawCurrent : 0;

    let calV = (rawV * this.voltageMultiplier) + this.voltageOffset;
    let calI = (rawI * this.currentMultiplier) + this.currentOffset;

    if (calV < 0 || !isFinite(calV)) calV = 0;
    if (calI < 0 || !isFinite(calI)) calI = 0;

    // Quiescent zero-current noise gate (ACS712 idle baseline)
    if (calI < this.noiseCutoffAmps) {
      calI = 0;
    }

    return {
      rawVoltage: rawV,
      rawCurrent: rawI,
      voltage:    Math.round(calV * 10) / 10,
      current:    Math.round(calI * 100) / 100
    };
  }

  // ── Power Calculations ─────────────────────────────────────────
  // 1. Apparent Power (VA) = V_rms * I_rms
  calculateApparentPower(voltage, current) {
    return Math.max(0, voltage * current);
  }

  // 2. Estimated Real Power (W) = V_rms * I_rms * PowerFactor
  calculatePower(voltage, current) {
    if (current <= 0) return 0;
    return Math.max(0, voltage * current * this.powerFactor);
  }

  // ── Accumulate Energy ─────────────────────────────────────────
  // Uses elapsed time between valid readings. Safe against gaps and refresh.
  accumulateEnergy(powerWatts, timestampMs = Date.now()) {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestampMs;
      return 0;
    }

    const deltaMs = timestampMs - this.lastTimestamp;
    this.lastTimestamp = timestampMs;

    // Reject duplicate packets (deltaMs <= 0) or huge gaps (> 60s during disconnect)
    if (deltaMs <= 0 || deltaMs > 60000 || !isFinite(powerWatts) || powerWatts < 0) {
      return 0;
    }

    // Energy Increment in Wh = Power(W) * deltaMs / 3600000
    const deltaWh = powerWatts * (deltaMs / 3600000.0);
    this.energyWh += deltaWh;

    // Persist to localStorage to survive browser refreshes
    try {
      localStorage.setItem("smartenergy_accumulated_energy_wh", this.energyWh.toFixed(5));
      localStorage.setItem("smartenergy_accumulated_energy_kwh", (this.energyWh / 1000).toFixed(6));
    } catch (_) {}

    // Track daily and hourly buckets
    const now     = new Date(timestampMs);
    const dayKey  = now.toISOString().substring(0, 10);
    const hourKey = now.toISOString().substring(0, 13);

    if (!this.dailyData[dayKey]) {
      this.dailyData[dayKey] = { energyWh: 0, maxPower: 0, minPower: Infinity, readings: [] };
    }
    this.dailyData[dayKey].energyWh  += deltaWh;
    this.dailyData[dayKey].maxPower   = Math.max(this.dailyData[dayKey].maxPower, powerWatts);
    this.dailyData[dayKey].minPower   = Math.min(this.dailyData[dayKey].minPower, powerWatts);
    this.dailyData[dayKey].readings.push({ timestampMs, power: powerWatts });

    if (!this.hourlyData[hourKey]) this.hourlyData[hourKey] = 0;
    this.hourlyData[hourKey] += deltaWh;

    return deltaWh;
  }

  // ── Reset Energy ──────────────────────────────────────────────
  resetEnergy() {
    this.energyWh = 0;
    this.lastTimestamp = null;
    try {
      localStorage.removeItem("smartenergy_accumulated_energy_wh");
      localStorage.setItem("smartenergy_accumulated_energy_kwh", "0.0000");
    } catch (_) {}
  }

  // ── Total Energy kWh ─────────────────────────────────────────
  getTotalKwh() {
    return this.energyWh / 1000.0;
  }

  // ── Estimated Cost ────────────────────────────────────────────
  getEstimatedCost(kwh = null) {
    const energy = kwh !== null ? kwh : this.getTotalKwh();
    return energy * this.ratePerUnit;
  }

  // ── Today's Stats ─────────────────────────────────────────────
  getTodayStats() {
    const today = new Date().toISOString().substring(0, 10);
    const d     = this.dailyData[today];
    if (!d) return null;

    // Find peak hour within today
    let peakHour = null, peakWh = 0, lowHour = null, lowWh = Infinity;
    for (const [key, wh] of Object.entries(this.hourlyData)) {
      if (!key.startsWith(today)) continue;
      if (wh > peakWh) { peakWh = wh; peakHour = key; }
      if (wh < lowWh)  { lowWh  = wh; lowHour  = key; }
    }

    return {
      energyKwh:  d.energyWh / 1000,
      cost:       this.getEstimatedCost(d.energyWh / 1000),
      maxPower:   d.maxPower,
      minPower:   d.minPower === Infinity ? 0 : d.minPower,
      peakHour:   peakHour ? peakHour.substring(11) + ":00" : "—",
      lowHour:    lowHour  ? lowHour.substring(11)  + ":00" : "—"
    };
  }

  // ── Hourly Breakdown for chart ────────────────────────────────
  getHourlyBreakdown(dateStr = null) {
    const day = dateStr || new Date().toISOString().substring(0, 10);
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const key = `${day}T${String(h).padStart(2, "0")}`;
      hours.push({ hour: h, energyWh: this.hourlyData[key] || 0 });
    }
    return hours;
  }

  // ── Reset energy counter ──────────────────────────────────────
  resetEnergy() {
    this.energyWh      = 0;
    this.lastTimestamp = null;
  }

  // ── Update settings ───────────────────────────────────────────
  updateSettings(settings) {
    if (settings.powerFactor       !== undefined) this.powerFactor       = settings.powerFactor;
    if (settings.ratePerUnit       !== undefined) this.ratePerUnit       = settings.ratePerUnit;
    if (settings.voltageMultiplier !== undefined) this.voltageMultiplier = settings.voltageMultiplier;
    if (settings.currentMultiplier !== undefined) this.currentMultiplier = settings.currentMultiplier;
    if (settings.voltageOffset     !== undefined) this.voltageOffset     = settings.voltageOffset;
    if (settings.currentOffset     !== undefined) this.currentOffset     = settings.currentOffset;
  }
}

// ── Anomaly Detection ─────────────────────────────────────────
export class AnomalyDetector {
  constructor(thresholds = {}) {
    this.maxPower   = thresholds.maxPower   || 3000;
    this.maxCurrent = thresholds.maxCurrent || 13;
    this.minVoltage = thresholds.minVoltage || 180;
    this.maxVoltage = thresholds.maxVoltage || 270;
  }

  check(reading) {
    const alerts = [];
    if (reading.power   > this.maxPower)   alerts.push({ type: "HIGH_POWER",   msg: `Power ${reading.power.toFixed(0)}W exceeds ${this.maxPower}W threshold` });
    if (reading.current > this.maxCurrent) alerts.push({ type: "HIGH_CURRENT", msg: `Current ${reading.current.toFixed(2)}A exceeds ${this.maxCurrent}A threshold` });
    if (reading.voltage < this.minVoltage) alerts.push({ type: "LOW_VOLTAGE",  msg: `Voltage ${reading.voltage.toFixed(1)}V below ${this.minVoltage}V` });
    if (reading.voltage > this.maxVoltage) alerts.push({ type: "HIGH_VOLTAGE", msg: `Voltage ${reading.voltage.toFixed(1)}V above ${this.maxVoltage}V` });
    return alerts;
  }

  updateThresholds(t) {
    if (t.maxPower   !== undefined) this.maxPower   = t.maxPower;
    if (t.maxCurrent !== undefined) this.maxCurrent = t.maxCurrent;
    if (t.minVoltage !== undefined) this.minVoltage = t.minVoltage;
    if (t.maxVoltage !== undefined) this.maxVoltage = t.maxVoltage;
  }
}

// ── Format helpers ────────────────────────────────────────────
export function fmt(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return Number(val).toFixed(decimals);
}

export function fmtCost(val, symbol = "₹") {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return `${symbol}${Number(val).toFixed(2)}`;
}

export function fmtKwh(val) {
  return `${fmt(val, 3)} kWh`;
}
