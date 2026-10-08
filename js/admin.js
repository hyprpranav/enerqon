// ============================================================
//  SmartEnergy Monitor — Admin Module
//  js/admin.js
// ============================================================

import { database, DB_PATHS, DEFAULT_SETTINGS } from "./firebase-config.js";
import {
  ref, get, set, update, remove, onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  approveUser, deactivateUser, disableUser, adminResetPassword
} from "./auth.js";
import { showToast } from "./dashboard.js";

// ── Database Timeout Helper ──────────────────────────────────
function withDbTimeout(promise, ms = 1800) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("DB_TIMEOUT")), ms))
  ]);
}

// ── Load all users for admin table ────────────────────────────
export async function adminLoadUsers() {
  try {
    const snap = await withDbTimeout(get(ref(database, DB_PATHS.allUsers())), 2000);
    if (!snap || !snap.exists()) return [];
    const users = [];
    snap.forEach(child => users.push({ uid: child.key, ...child.val() }));
    return users;
  } catch (e) {
    console.warn("adminLoadUsers fallback:", e.message);
    return [];
  }
}

// ── Watch all users in real time ──────────────────────────────
export function adminWatchUsers(callback) {
  return onValue(ref(database, DB_PATHS.allUsers()), (snap) => {
    const users = [];
    if (snap.exists()) snap.forEach(c => users.push({ uid: c.key, ...c.val() }));
    callback(users);
  });
}

// ── User card renderer ────────────────────────────────────────
export function renderUserCard(user, thresholds = DEFAULT_SETTINGS.thresholds) {
  const p       = user.profile || {};
  const latest  = user.latest  || {};
  const status  = user.status  || "pending";
  const initials = (p.fullName || "?").split(" ").map(w => w[0]).join("").toUpperCase().substring(0, 2);

  const power   = latest.power   || 0;
  const voltage = latest.voltage || 0;
  const current = latest.current || 0;
  const isAlert = power > thresholds.maxPower || current > thresholds.maxCurrent ||
                  (voltage > 0 && (voltage < thresholds.minVoltage || voltage > thresholds.maxVoltage));
  const isOnline = latest.online === true;

  const statusBadge = {
    active:      '<span class="badge badge-success">Active</span>',
    pending:     '<span class="badge badge-warning">Pending</span>',
    deactivated: '<span class="badge badge-muted">Deactivated</span>',
    disabled:    '<span class="badge badge-danger">Disabled</span>'
  }[status] || '<span class="badge badge-muted">Unknown</span>';

  return `
<div class="user-card ${isAlert ? "alert" : ""}" id="user-card-${user.uid}">
  ${isAlert ? '<div class="badge badge-danger" style="position:absolute;top:12px;right:12px;font-size:.65rem;">⚠ ALERT</div>' : ""}
  <div class="user-card-header">
    <div class="user-card-avatar">${initials}</div>
    <div>
      <div class="user-card-name">${p.fullName || "Unknown User"}</div>
      <div class="user-card-device">${p.deviceId || "No Device"}</div>
    </div>
    <div style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
      ${statusBadge}
      <span class="status-indicator" style="font-size:.72rem;">
        <span class="dot ${isOnline ? "dot-success pulse" : "dot-muted"}"></span>
        ${isOnline ? "Online" : "Offline"}
      </span>
    </div>
  </div>
  <div class="user-card-stats">
    <div class="user-card-stat">
      <div class="user-card-stat-label">Voltage</div>
      <div class="user-card-stat-value">${voltage > 0 ? voltage.toFixed(1) + "V" : "—"}</div>
    </div>
    <div class="user-card-stat">
      <div class="user-card-stat-label">Current</div>
      <div class="user-card-stat-value">${current > 0 ? current.toFixed(2) + "A" : "—"}</div>
    </div>
    <div class="user-card-stat">
      <div class="user-card-stat-label">Power</div>
      <div class="user-card-stat-value">${power > 0 ? power.toFixed(0) + "W" : "—"}</div>
    </div>
  </div>
  <div class="user-card-footer">
    <div style="font-size:.8rem;color:var(--text-muted);">
      ${p.email || ""}
    </div>
    <div style="display:flex;gap:8px;">
      <a href="user-details.html?uid=${user.uid}" class="btn btn-primary btn-sm">View</a>
      <button class="btn btn-secondary btn-sm" onclick="adminUserMenu('${user.uid}','${status}')">⋯</button>
    </div>
  </div>
</div>`;
}

// ── User row for table ────────────────────────────────────────
export function renderUserRow(user, thresholds = DEFAULT_SETTINGS.thresholds) {
  const p       = user.profile || {};
  const latest  = user.latest  || {};
  const status  = user.status  || "pending";
  const power   = latest.power   || 0;
  const current = latest.current || 0;
  const voltage = latest.voltage || 0;
  const isAlert = power > thresholds.maxPower || current > thresholds.maxCurrent;
  const isOnline = latest.online === true;

  const statusColors = { active: "success", pending: "warning", deactivated: "muted", disabled: "danger" };
  const badgeClass = statusColors[status] || "muted";

  return `
<tr style="${isAlert ? "background:rgba(239,68,68,.08);" : ""}">
  <td>
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#00d4ff,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;color:#0a0e1a;flex-shrink:0;">
        ${(p.fullName || "?").split(" ").map(w => w[0]).join("").toUpperCase().substring(0, 2)}
      </div>
      <div>
        <div style="font-weight:600;font-size:.875rem;">${p.fullName || "Unknown"}</div>
        <div style="font-size:.75rem;color:var(--text-muted);">${p.email || ""}</div>
      </div>
    </div>
  </td>
  <td class="td-mono">${p.deviceId || "—"}</td>
  <td><span class="badge badge-${badgeClass}">${status}</span></td>
  <td class="td-mono">
    <span class="status-indicator">
      <span class="dot ${isOnline ? "dot-success" : "dot-muted"}"></span>
      ${isOnline ? "Online" : "Offline"}
    </span>
  </td>
  <td class="td-mono">${voltage > 0 ? voltage.toFixed(1) + "V" : "—"}</td>
  <td class="td-mono">${current > 0 ? current.toFixed(2) + "A" : "—"}</td>
  <td class="td-mono ${isAlert ? "text-danger" : ""}">${power > 0 ? power.toFixed(0) + "W" : "—"}</td>
  <td>
    ${isAlert ? '<span class="badge badge-danger">⚠ Alert</span>' : '<span class="badge badge-muted">Normal</span>'}
  </td>
  <td>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <a href="user-details.html?uid=${user.uid}" class="btn btn-sm btn-secondary">View</a>
      <button class="btn btn-sm btn-warning" onclick="adminUserMenu('${user.uid}','${status}')">Manage</button>
    </div>
  </td>
</tr>`;
}

// ── Save tariff settings ──────────────────────────────────────
export async function saveTariff(tariffData) {
  await set(ref(database, DB_PATHS.tariff()), tariffData);
}

// ── Save calibration settings ─────────────────────────────────
export async function saveCalibration(calData) {
  await set(ref(database, DB_PATHS.calibration()), calData);
}

// ── Save thresholds ───────────────────────────────────────────
export async function saveThresholds(thresholdData) {
  await set(ref(database, DB_PATHS.thresholds()), thresholdData);
}

// ── Load settings ─────────────────────────────────────────────
export async function loadSettings() {
  try {
    const snap = await withDbTimeout(get(ref(database, DB_PATHS.settings())), 1500);
    if (!snap || !snap.exists()) return DEFAULT_SETTINGS;
    const s = snap.val();
    return {
      tariff:      { ...DEFAULT_SETTINGS.tariff,      ...s.tariff },
      calibration: { ...DEFAULT_SETTINGS.calibration, ...s.calibration },
      thresholds:  { ...DEFAULT_SETTINGS.thresholds,  ...s.thresholds }
    };
  } catch (e) {
    console.warn("loadSettings fallback to defaults:", e.message);
    return DEFAULT_SETTINGS;
  }
}

// ── Admin action handler (global for inline buttons) ─────────
window.adminUserMenu = function(uid, currentStatus) {
  const actions = [];
  if (currentStatus === "pending")     actions.push({ label: "✅ Approve",    fn: () => adminAction(uid, "approve") });
  if (currentStatus === "active")      actions.push({ label: "🔒 Deactivate", fn: () => adminAction(uid, "deactivate") });
  if (currentStatus !== "disabled")    actions.push({ label: "🚫 Disable",    fn: () => adminAction(uid, "disable") });
  if (currentStatus === "deactivated" || currentStatus === "disabled")
    actions.push({ label: "✅ Activate",  fn: () => adminAction(uid, "approve") });
  actions.push({ label: "📧 Reset Password", fn: () => adminAction(uid, "resetpw") });
  actions.push({ label: "✏️ Edit Profile",  fn: () => window.location.href = `user-details.html?uid=${uid}&edit=1` });

  // Simple action picker via confirm
  const choice = window.prompt(
    `Admin Actions for user ${uid.substring(0,8)}...\n\n` +
    actions.map((a, i) => `${i + 1}. ${a.label}`).join("\n") +
    "\n\nEnter number (or cancel):"
  );
  const idx = parseInt(choice) - 1;
  if (!isNaN(idx) && actions[idx]) actions[idx].fn();
};

async function adminAction(uid, action) {
  try {
    switch (action) {
      case "approve":    await approveUser(uid);    showToast("User approved.", "success"); break;
      case "deactivate": await deactivateUser(uid); showToast("User deactivated.", "warning"); break;
      case "disable":    await disableUser(uid);    showToast("User disabled.", "danger"); break;
      case "resetpw": {
        const snap = await get(ref(database, DB_PATHS.userProfile(uid)));
        if (snap.exists()) {
          await adminResetPassword(snap.val().email);
          showToast("Password reset email sent.", "info");
        }
        break;
      }
    }
  } catch (e) {
    showToast(`Error: ${e.message}`, "error");
  }
}
