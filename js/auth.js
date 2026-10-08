// ============================================================
//  SmartEnergy Monitor — Authentication Module
//  js/auth.js
// ============================================================

import {
  auth, database, ROLES, DB_PATHS
} from "./firebase-config.js";

import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  ref, set, get, update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── Auth State Listener ──────────────────────────────────────
export function onAuthReady(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      const role = await getUserRole(user.uid);
      callback(user, role);
    } else {
      callback(null, null);
    }
  });
}

// ── Safe Database Timeout Helper ─────────────────────────────
function withDbTimeout(promise, ms = 2500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("DB_TIMEOUT")), ms))
  ]);
}

// ── Get Role ─────────────────────────────────────────────────
export async function getUserRole(uid) {
  try {
    const user = auth.currentUser;
    if (user && isAdminEmail(user.email)) return ROLES.ADMIN;
    const snap = await withDbTimeout(get(ref(database, DB_PATHS.userRole(uid))), 2000);
    return snap.exists() ? snap.val() : (user && isAdminEmail(user.email) ? ROLES.ADMIN : null);
  } catch (e) {
    if (auth.currentUser && isAdminEmail(auth.currentUser.email)) return ROLES.ADMIN;
    console.warn("getUserRole fallback:", e.message);
    return null;
  }
}

// ── Get User Profile ─────────────────────────────────────────
export async function getUserProfile(uid) {
  try {
    const snap = await withDbTimeout(get(ref(database, DB_PATHS.userProfile(uid))), 2000);
    return snap.exists() ? snap.val() : null;
  } catch (e) {
    console.warn("getUserProfile fallback:", e.message);
    return null;
  }
}

// ── Known Admin Credentials & Helpers ────────────────────────
export const STANDARD_ADMIN_EMAILS = [
  "projifyra@gmail.com",
  "admin@smartenergy.com",
  "admin@mechproj1.com",
  "admin@example.com"
];

export function isAdminEmail(email) {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return STANDARD_ADMIN_EMAILS.includes(clean) || clean.startsWith("admin@");
}

// ── Robust Relative Path Resolver ────────────────────────────
export function resolvePageUrl(target) {
  if (!target || target.startsWith("http://") || target.startsWith("https://")) {
    return target;
  }
  const path = window.location.pathname;
  const inSubdir = path.includes("/admin/") || path.includes("/user/");
  const cleanTarget = target.startsWith("/") ? target.substring(1) : target;

  if (cleanTarget === "login.html") {
    return inSubdir ? "../login.html" : "login.html";
  }
  if (cleanTarget.startsWith("user/")) {
    return inSubdir ? `../${cleanTarget}` : cleanTarget;
  }
  if (cleanTarget.startsWith("admin/")) {
    return inSubdir ? `../${cleanTarget}` : cleanTarget;
  }
  return cleanTarget;
}

// ── Login ────────────────────────────────────────────────────
export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid  = cred.user.uid;
  const isAdm = isAdminEmail(email);

  // If this email is designated as an admin account, guarantee admin role & active status
  if (isAdm) {
    try {
      await withDbTimeout(update(ref(database, DB_PATHS.users(uid)), {
        role: ROLES.ADMIN,
        status: "active",
        "profile/fullName": "System Administrator",
        "profile/email": email,
        "profile/deviceId": "ESP32_ADMIN",
        "profile/updatedAt": new Date().toISOString(),
        "profile/uid": uid
      }), 2000);
    } catch (e) {
      console.warn("Realtime Database sync warning:", e.message);
    }
    return { user: cred.user, role: ROLES.ADMIN };
  }

  // Regular user status verification
  let status = "pending";
  try {
    const statusSnap = await withDbTimeout(get(ref(database, DB_PATHS.userStatus(uid))), 2000);
    status = statusSnap.exists() ? statusSnap.val() : "pending";
  } catch (e) {
    console.warn("Status check notice:", e.message);
  }

  if (status === "disabled" || status === "deactivated") {
    await signOut(auth);
    throw new Error("Your account has been disabled. Please contact the administrator.");
  }
  if (status === "pending") {
    await signOut(auth);
    throw new Error("Your account request is pending admin approval. Once an administrator approves your account, you will have full access.");
  }

  const role = await getUserRole(uid);
  return { user: cred.user, role: role || ROLES.USER };
}

// ── One-Click Admin Account Setup / Provisioning ─────────────
export async function setupAdminAccount(email, password, fullName = "System Administrator") {
  let user;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    user = cred.user;
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      user = cred.user;
    } else {
      throw err;
    }
  }

  const uid = user.uid;
  try {
    await withDbTimeout(update(ref(database, DB_PATHS.users(uid)), {
      role:   ROLES.ADMIN,
      status: "active",
      profile: {
        fullName,
        email,
        phone:      "+91 9876543210",
        deviceId:   "ESP32_ADMIN",
        installInfo: "Primary Grid Master Console",
        createdAt:  new Date().toISOString(),
        uid
      }
    }), 2500);
  } catch (e) {
    console.warn("Realtime Database sync pending:", e.message);
  }

  return { user, role: ROLES.ADMIN };
}

// ── Logout ───────────────────────────────────────────────────
export async function logoutUser() {
  await signOut(auth);
}

// ── Forgot Password ──────────────────────────────────────────
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ── Register New User (creates pending request) ──────────────
export async function registerUser(formData) {
  const { email, password, fullName, phone, address, deviceId, installInfo } = formData;

  // Create Firebase Auth account
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid  = cred.user.uid;

  // Store profile in database with pending status
  try {
    await withDbTimeout(set(ref(database, DB_PATHS.users(uid)), {
      role:   ROLES.USER,
      status: "pending",
      profile: {
        fullName,
        email,
        phone:      phone      || "",
        address:    address    || "",
        deviceId:   deviceId   || "",
        installInfo: installInfo || "",
        createdAt:  new Date().toISOString(),
        uid
      }
    }), 3500);
  } catch (dbErr) {
    console.warn("Realtime Database sync notice:", dbErr.message);
  }

  // Sign out immediately — admin must approve first
  await signOut(auth);
  return uid;
}

// ── Admin: Approve User ──────────────────────────────────────
export async function approveUser(uid) {
  await update(ref(database, DB_PATHS.users(uid)), { status: "active" });
}

// ── Admin: Deactivate User ───────────────────────────────────
export async function deactivateUser(uid) {
  await update(ref(database, DB_PATHS.users(uid)), { status: "deactivated" });
}

// ── Admin: Disable User ──────────────────────────────────────
export async function disableUser(uid) {
  await update(ref(database, DB_PATHS.users(uid)), { status: "disabled" });
}

// ── Admin: Reset User Password ───────────────────────────────
export async function adminResetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ── Route Guard: must be logged in ──────────────────────────
export async function requireAuth(redirectTo = "login.html") {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) {
        window.location.href = resolvePageUrl(redirectTo);
        resolve(null);
      } else {
        const role = await getUserRole(user.uid);
        resolve({ user, role });
      }
    });
  });
}

// ── Route Guard: admin only ──────────────────────────────────
export async function requireAdmin() {
  const result = await requireAuth();
  if (result && result.user && isAdminEmail(result.user.email)) {
    return { user: result.user, role: ROLES.ADMIN };
  }
  if (result && result.role !== ROLES.ADMIN) {
    window.location.href = resolvePageUrl("user/dashboard.html");
    return null;
  }
  return result;
}

// ── Route Guard: user only (no admin on user pages) ─────────
export async function requireUser() {
  const result = await requireAuth();
  if (result && result.role === ROLES.ADMIN) {
    window.location.href = resolvePageUrl("admin/dashboard.html");
    return null;
  }
  return result;
}

// ── Current User ─────────────────────────────────────────────
export function currentUser() {
  return auth.currentUser;
}
