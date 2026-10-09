// ============================================================
//  SmartEnergy Monitor — Firebase Configuration
//  js/firebase-config.js
//
//  IMPORTANT: Replace ALL placeholder values below with your
//  actual Firebase project configuration from:
//  Firebase Console → Project Settings → General → Your Apps
// ============================================================

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDGdIy8_j-6COJR82ivDui1DcFg7bzJyts",
  authDomain:        "mechproj1.firebaseapp.com",
  databaseURL:       "https://mechproj1-default-rtdb.firebaseio.com",
  projectId:         "mechproj1",
  storageBucket:     "mechproj1.firebasestorage.app",
  messagingSenderId: "601914312763",
  appId:             "1:601914312763:web:d358497b497acc2835341e"
};

// ── Initialize Firebase ──────────────────────────────────────
import { initializeApp }             from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }                   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase }               from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const app      = initializeApp(FIREBASE_CONFIG);
const auth     = getAuth(app);
const database = getDatabase(app);

export { app, auth, database };

// ── Database Path Helpers ────────────────────────────────────
export const DB_PATHS = {
  users:          (uid)                     => `users/${uid}`,
  userProfile:    (uid)                     => `users/${uid}/profile`,
  userRole:       (uid)                     => `users/${uid}/role`,
  userStatus:     (uid)                     => `users/${uid}/status`,
  deviceOwner:    (deviceId)                => `devices/${deviceId}/ownerId`,
  deviceStatus:   (deviceId)                => `devices/${deviceId}/status`,
  deviceLatest:   (deviceId)                => `devices/${deviceId}/latestReading`,
  allDevices:     ()                        => `devices`,
  allUsers:       ()                        => `users`,
  readings:       (uid, deviceId)           => `readings/${uid}/${deviceId}`,
  readingAt:      (uid, deviceId, ts)       => `readings/${uid}/${deviceId}/${ts}`,
  settings:       ()                        => `settings`,
  tariff:         ()                        => `settings/tariff`,
  calibration:    ()                        => `settings/calibration`,
  thresholds:     ()                        => `settings/thresholds`,
  alerts:         (uid)                     => `alerts/${uid}`,
};

// ── Roles ────────────────────────────────────────────────────
export const ROLES = {
  ADMIN: "admin",
  USER:  "user"
};

// ── Default Settings ─────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  tariff: {
    ratePerUnit:  5.00,     // Default prototype tariff in INR per kWh
    currency:     "INR",
    symbol:       "₹",
    consumerType: "domestic"
  },
  calibration: {
    voltageMultiplier:  1.000, // Configurable factor (default 1.000)
    voltageOffset:      0.0,   // Voltage offset in Volts
    currentMultiplier:  1.000, // ACS712 current multiplier
    currentOffset:      0.0,   // Current offset in Amperes
    powerFactor:        0.98,  // Typical domestic power factor (0.98 - 1.00)
    sensorModel:        "ACS712_05B", // Default 5A model (185 mV/A)
    referenceVoltage:   229.0, // Reference multimeter AC RMS voltage
    noiseCutoffAmps:    0.04   // Quiescent zero-current noise gate
  },
  thresholds: {
    maxPower:    3000,   // Watts — above this triggers HIGH POWER alert
    maxCurrent:  13,     // Amps
    minVoltage:  180,    // Volts
    maxVoltage:  270     // Volts
  }
};
