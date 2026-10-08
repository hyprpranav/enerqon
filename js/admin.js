// ============================================================
//  SmartEnergy Monitor — Admin Module
//  js/admin.js
// ============================================================

import { database, DB_PATHS, DEFAULT_SETTINGS } from "./firebase-config.js";
import {
  ref, get, set, update, remove, onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  approveUser, deactivateUser, disableUser, adminResetPassword,
  getLocalUsers, saveLocalUsers,
  SMARTENERGY_USERS_KEY, SMARTENERGY_DEMO_CLEARED_KEY, ADMIN_DELETE_USERS_CODE
} from "./auth.js";
import { showToast } from "./dashboard.js";

export { ADMIN_DELETE_USERS_CODE };

// Firebase path for global demo-cleared flag
const FIREBASE_DEMO_CLEARED_PATH = "admin_flags/demo_cleared";

// ── Database Timeout Helper ──────────────────────────────────
function withDbTimeout(promise, ms = 1800) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("DB_TIMEOUT")), ms))
  ]);
}

// ── Initial Mock Demo Users (Disabled - clean real data only) ──
export function getInitialDemoUsers() {
  return [];
}

// ── Load all users (Cloud + Local Resilient Merge) ────────────
export async function adminLoadUsers() {
  const mergedMap = new Map();

  // 1. Fetch from localStorage
  const localList = getLocalUsers();
  localList.forEach(u => {
    if (u && (u.uid || u.profile?.email)) {
      const key = (u.uid || u.profile.email).toLowerCase();
      mergedMap.set(key, u);
    }
  });

  // 2. Fetch from Firebase Realtime Database
  let firebaseHasUsers = false;
  try {
    const snap = await withDbTimeout(get(ref(database, DB_PATHS.allUsers())), 1000);
    if (snap && snap.exists()) {
      firebaseHasUsers = true;
      snap.forEach(child => {
        const val = child.val();
        if (val) {
          const u = { uid: child.key, ...val };
          const key = (child.key || val.profile?.email || "").toLowerCase();
          if (key) mergedMap.set(key, u);
        }
      });
    }
  } catch (e) {
    console.warn("adminLoadUsers RTDB notice:", e.message);
  }

  const users = Array.from(mergedMap.values());

  // 3. Check demo clear flag — check both localStorage AND Firebase so it works across devices/browsers
  const localDemoCleared = localStorage.getItem(SMARTENERGY_DEMO_CLEARED_KEY) === "true";
  let firebaseDemoCleared = false;
  try {
    const flagSnap = await withDbTimeout(get(ref(database, FIREBASE_DEMO_CLEARED_PATH)), 800);
    if (flagSnap && flagSnap.exists() && flagSnap.val() === true) {
      firebaseDemoCleared = true;
      // Sync to localStorage so future checks are instant
      localStorage.setItem(SMARTENERGY_DEMO_CLEARED_KEY, "true");
    }
  } catch (_) {}

  const isDemoCleared = localDemoCleared || firebaseDemoCleared;

  return users;
}

// ── Watch all users in real time (Dual Sync) ─────────────────
export function adminWatchUsers(callback) {
  let isSubscribed = true;

  // 1. Instant local notification (0ms)
  try {
    const local = getLocalUsers();
    callback(local);
  } catch (_) {}

  const refreshAndEmit = async () => {
    if (!isSubscribed) return;
    try {
      const users = await adminLoadUsers();
      callback(users);
    } catch (e) {
      console.warn("adminWatchUsers refresh error:", e);
    }
  };

  // Cloud background refresh
  refreshAndEmit();

  // Listen to cross-tab storage changes
  const storageHandler = (e) => {
    if (!e || !e.key || e.key === SMARTENERGY_USERS_KEY || e.key === SMARTENERGY_DEMO_CLEARED_KEY) {
      refreshAndEmit();
    }
  };
  const customHandler = () => refreshAndEmit();

  window.addEventListener("storage", storageHandler);
  window.addEventListener("users-updated", customHandler);

  // Periodic poll to catch new registrations from other windows
  const intervalId = setInterval(refreshAndEmit, 2500);

  // Firebase Realtime Database onValue listener
  let unsub = null;
  try {
    unsub = onValue(ref(database, DB_PATHS.allUsers()), () => {
      refreshAndEmit();
    });
  } catch (e) {
    console.warn("Firebase onValue notice:", e.message);
  }

  return () => {
    isSubscribed = false;
    clearInterval(intervalId);
    window.removeEventListener("storage", storageHandler);
    window.removeEventListener("users-updated", customHandler);
    if (unsub) unsub();
  };
}

// ── Delete All Users with Passcode Verification ──────────────
export async function adminDeleteAllUsers() {
  // 1. Wipe from Firebase RTDB users node
  try {
    await withDbTimeout(remove(ref(database, DB_PATHS.allUsers())), 3000);
  } catch (e) {
    console.warn("Firebase users removal notice:", e.message);
  }

  // 2. Set permanent global demo-cleared flag in Firebase (works across ALL devices/browsers)
  try {
    await withDbTimeout(set(ref(database, FIREBASE_DEMO_CLEARED_PATH), true), 2000);
  } catch (e) {
    console.warn("Firebase demo-cleared flag notice:", e.message);
  }

  // 3. Wipe from localStorage and set local demo cleared flag
  localStorage.removeItem(SMARTENERGY_USERS_KEY);
  localStorage.setItem(SMARTENERGY_DEMO_CLEARED_KEY, "true");

  // 4. Dispatch sync events
  window.dispatchEvent(new Event("storage"));
  window.dispatchEvent(new CustomEvent("users-updated", { detail: [] }));

  return true;
}

export async function verifyAndDeleteAllUsers(inputCode) {
  const code = (inputCode || "").trim();
  if (code !== ADMIN_DELETE_USERS_CODE) {
    throw new Error("Invalid security authorization code. Action rejected.");
  }
  return await adminDeleteAllUsers();
}

// ── Quick Approve Helper ─────────────────────────────────────
window.adminQuickApprove = async function(uid) {
  try {
    await approveUser(uid);
    showToast("Consumer approved! The user can now log in.", "success");
    window.dispatchEvent(new Event("storage"));
  } catch (err) {
    showToast("Error approving user: " + err.message, "error");
  }
};

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
    pending:     '<span class="badge badge-warning">Pending Approval</span>',
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
      <div class="user-card-device font-mono" style="color:var(--clr-primary);font-weight:600;">${p.deviceId || "ESP32_001"}</div>
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
    <div style="font-size:.8rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;" title="${p.email || ""}">
      ${p.email || ""}
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      ${status === "pending" ? `<button class="btn btn-sm btn-success" onclick="adminQuickApprove('${user.uid}')" style="background:#10b981;color:#fff;border:none;font-weight:600;padding:0.3rem 0.6rem;font-size:0.75rem;">✅ Approve</button>` : ""}
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
  <td><span class="badge badge-${badgeClass}">${status === "pending" ? "Pending Approval" : status}</span></td>
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
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      ${status === "pending" ? `<button class="btn btn-sm btn-success" onclick="adminQuickApprove('${user.uid}')" style="background:#10b981;color:#fff;border:none;font-weight:600;padding:0.25rem 0.55rem;font-size:0.75rem;">Approve</button>` : ""}
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
  if (currentStatus === "pending")     actions.push({ label: "✅ Approve Request", fn: () => adminAction(uid, "approve") });
  if (currentStatus === "active")      actions.push({ label: "🔒 Deactivate",     fn: () => adminAction(uid, "deactivate") });
  if (currentStatus !== "disabled")    actions.push({ label: "🚫 Disable",        fn: () => adminAction(uid, "disable") });
  if (currentStatus === "deactivated" || currentStatus === "disabled")
    actions.push({ label: "✅ Re-Activate", fn: () => adminAction(uid, "approve") });
  actions.push({ label: "📧 Reset Password", fn: () => adminAction(uid, "resetpw") });
  actions.push({ label: "✏️ Edit Profile",  fn: () => window.location.href = `user-details.html?uid=${uid}&edit=1` });

  const choice = window.prompt(
    `Admin Actions for user ${uid.substring(0,8)}...\n\n` +
    actions.map((a, i) => `${i + 1}. ${a.label}`).join("\n") +
    "\n\nEnter action number (or cancel):"
  );
  const idx = parseInt(choice) - 1;
  if (!isNaN(idx) && actions[idx]) actions[idx].fn();
};

async function adminAction(uid, action) {
  try {
    switch (action) {
      case "approve":
        await approveUser(uid);
        showToast("User approved successfully.", "success");
        break;
      case "deactivate":
        await deactivateUser(uid);
        showToast("User deactivated.", "warning");
        break;
      case "disable":
        await disableUser(uid);
        showToast("User disabled.", "danger");
        break;
      case "resetpw": {
        const snap = await get(ref(database, DB_PATHS.userProfile(uid)));
        if (snap && snap.exists()) {
          await adminResetPassword(snap.val().email);
          showToast("Password reset email dispatched.", "info");
        } else {
          showToast("Reset password command registered.", "info");
        }
        break;
      }
    }
    window.dispatchEvent(new Event("storage"));
  } catch (e) {
    showToast(`Error: ${e.message}`, "error");
  }
}
