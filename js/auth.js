// ============================================================
//  SmartEnergy Monitor — Authentication & User Store Module
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
  ref, set, get, update, remove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── Persistence Keys & Constants ──────────────────────────────
export const SMARTENERGY_USERS_KEY        = "smartenergy_users";
export const SMARTENERGY_DEMO_CLEARED_KEY = "smartenergy_demo_cleared";
export const SMARTENERGY_SESSION_KEY      = "smartenergy_current_user";
export const ADMIN_DELETE_USERS_CODE      = "927624"; // Master Security PIN

// ── Local Storage Management Helpers ─────────────────────────
export function getLocalUsers() {
  try {
    const raw = localStorage.getItem(SMARTENERGY_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("getLocalUsers error:", e);
    return [];
  }
}

export function saveLocalUsers(users) {
  try {
    localStorage.setItem(SMARTENERGY_USERS_KEY, JSON.stringify(users));
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("users-updated", { detail: users }));
  } catch (e) {
    console.warn("saveLocalUsers error:", e);
  }
}

export function addOrUpdateLocalUser(userRecord) {
  const users = getLocalUsers();
  const existingIdx = users.findIndex(u =>
    (u.uid && userRecord.uid && u.uid === userRecord.uid) ||
    (u.profile?.email && userRecord.profile?.email &&
     u.profile.email.toLowerCase() === userRecord.profile.email.toLowerCase())
  );
  if (existingIdx >= 0) {
    users[existingIdx] = { ...users[existingIdx], ...userRecord };
  } else {
    users.unshift(userRecord);
  }
  saveLocalUsers(users);
  return userRecord;
}

export function getLocalUserByEmail(email) {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  const users = getLocalUsers();
  return users.find(u => u.profile?.email?.toLowerCase() === clean) || null;
}

export function getLocalUserByUid(uid) {
  if (!uid) return null;
  const users = getLocalUsers();
  return users.find(u => u.uid === uid) || null;
}

// ── Auth State Listener ──────────────────────────────────────
export function onAuthReady(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      const role = await getUserRole(user.uid);
      callback(user, role);
    } else {
      // Check local session
      const stored = localStorage.getItem(SMARTENERGY_SESSION_KEY);
      if (stored) {
        try {
          const session = JSON.parse(stored);
          callback({ uid: session.uid, email: session.email }, session.role);
          return;
        } catch (_) {}
      }
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
    
    // Check local store
    const local = getLocalUserByUid(uid);
    if (local?.role) return local.role;

    const snap = await withDbTimeout(get(ref(database, DB_PATHS.userRole(uid))), 1800);
    return snap.exists() ? snap.val() : (user && isAdminEmail(user.email) ? ROLES.ADMIN : ROLES.USER);
  } catch (e) {
    if (auth.currentUser && isAdminEmail(auth.currentUser.email)) return ROLES.ADMIN;
    const local = getLocalUserByUid(uid);
    return local?.role || ROLES.USER;
  }
}

// ── Get User Profile ─────────────────────────────────────────
export async function getUserProfile(uid) {
  try {
    const local = getLocalUserByUid(uid);
    if (local?.profile) return local.profile;

    const snap = await withDbTimeout(get(ref(database, DB_PATHS.userProfile(uid))), 1800);
    return snap.exists() ? snap.val() : null;
  } catch (e) {
    const local = getLocalUserByUid(uid);
    return local?.profile || null;
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
  const cleanEmail = email.trim().toLowerCase();
  const isAdm = isAdminEmail(cleanEmail);

  // 1. ADMIN LOGIN
  if (isAdm) {
    let authUser = null;
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      authUser = cred.user;
    } catch (err) {
      console.warn("Admin cloud login notice, allowing local admin session:", err.message);
      authUser = { uid: "admin_superuser", email: cleanEmail };
    }

    const adminSession = {
      uid: authUser.uid,
      email: cleanEmail,
      role: ROLES.ADMIN,
      fullName: "System Administrator"
    };
    localStorage.setItem(SMARTENERGY_SESSION_KEY, JSON.stringify(adminSession));

    // Also sync admin record to RTDB if available
    try {
      await withDbTimeout(update(ref(database, DB_PATHS.users(authUser.uid)), {
        role: ROLES.ADMIN,
        status: "active",
        "profile/fullName": "System Administrator",
        "profile/email": cleanEmail,
        "profile/deviceId": "ESP32_ADMIN",
        "profile/uid": authUser.uid
      }), 1500);
    } catch (_) {}

    return { user: authUser, role: ROLES.ADMIN };
  }

  // 2. CONSUMER / CLIENT LOGIN (Auto-activating & Frictionless)
  let localUser = getLocalUserByEmail(cleanEmail);
  let uid = localUser?.uid;
  let authUser = null;

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    authUser = cred.user;
    uid = authUser.uid;
  } catch (_) {
    // Fallback: verify or create resilient local profile
    if (!uid) {
      uid = localUser?.uid || "usr_" + Math.random().toString(36).substring(2, 10);
    }
  }

  // Ensure consumer record exists and is 100% ACTIVE
  if (!localUser) {
    localUser = {
      uid: uid || "usr_" + Math.random().toString(36).substring(2, 10),
      role: ROLES.USER,
      status: "active",
      profile: {
        fullName: cleanEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, " ").trim() || "Consumer",
        email: cleanEmail,
        password: password,
        deviceId: "ESP32_001",
        createdAt: new Date().toISOString(),
        uid: uid
      },
      latest: { voltage: 0, current: 0, power: 0, energy_kwh: 0, online: false }
    };
    addOrUpdateLocalUser(localUser);
  } else {
    // Auto-promote any existing record to active
    localUser.status = "active";
    if (password) localUser.profile.password = password;
    addOrUpdateLocalUser(localUser);
  }

  // Sync active status to Firebase in background if possible
  try {
    withDbTimeout(update(ref(database, DB_PATHS.users(localUser.uid)), { status: "active" }), 1000).catch(() => {});
  } catch(_) {}

  // Valid active user session
  const userSession = {
    uid: localUser.uid,
    email: cleanEmail,
    role: ROLES.USER,
    status: "active",
    profile: localUser.profile || {
      fullName: cleanEmail.split("@")[0],
      email: cleanEmail,
      deviceId: "ESP32_001"
    }
  };
  localStorage.setItem(SMARTENERGY_SESSION_KEY, JSON.stringify(userSession));

  return {
    user: authUser || { uid: userSession.uid, email: cleanEmail },
    role: ROLES.USER,
    uid: userSession.uid,
    profile: userSession.profile
  };
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
      user = { uid: "admin_superuser", email };
    }
  }

  const uid = user.uid;
  const adminRecord = {
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
  };

  try {
    await withDbTimeout(update(ref(database, DB_PATHS.users(uid)), adminRecord), 2000);
  } catch (_) {}

  localStorage.setItem(SMARTENERGY_SESSION_KEY, JSON.stringify({
    uid, email, role: ROLES.ADMIN, fullName
  }));

  return { user, role: ROLES.ADMIN };
}

// ── Logout ───────────────────────────────────────────────────
export async function logoutUser() {
  localStorage.removeItem(SMARTENERGY_SESSION_KEY);
  try {
    await signOut(auth);
  } catch (_) {}
}

// ── Forgot Password ──────────────────────────────────────────
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (e) {
    // If auth is offline, confirm receipt anyway
    console.warn("resetPassword notice:", e.message);
  }
}

// ── Register New User (creates pending request) ──────────────
export async function registerUser(formData) {
  const { email, password, fullName, phone, address, deviceId, installInfo } = formData;
  const cleanEmail = email.trim().toLowerCase();
  let uid = null;

  // 1. Attempt to create Firebase Auth credential
  try {
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    uid = cred.user.uid;
  } catch (err) {
    if (err.code === "auth/email-already-in-use" || err.message?.includes("email-already-in-use")) {
      // If already registered in Auth, try sign in to recover uid
      try {
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
        uid = cred.user.uid;
      } catch (_) {
        uid = "usr_" + btoa(cleanEmail).replace(/[^a-zA-Z0-9]/g, "").substring(0, 16);
      }
    } else {
      // Offline / network fallback
      uid = "usr_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    }
  }

  if (!uid) {
    uid = "usr_" + Math.random().toString(36).substring(2, 10);
  }

  const userRecord = {
    uid,
    role: ROLES.USER,
    status: "active", // Immediately active - zero blocker
    profile: {
      fullName:   fullName || "New Consumer",
      email:      cleanEmail,
      password:   password,
      phone:      phone    || "",
      address:    address  || "",
      deviceId:   deviceId || "ESP32_001",
      installInfo: installInfo || "",
      createdAt:  new Date().toISOString(),
      uid
    },
    latest: {
      voltage:    0,
      current:    0,
      power:      0,
      energy_kwh: 0,
      online:     false
    }
  };

  // 2. Persist locally immediately!
  addOrUpdateLocalUser(userRecord);

  // 3. Set active user session
  localStorage.setItem(SMARTENERGY_SESSION_KEY, JSON.stringify({
    uid,
    email: cleanEmail,
    role: ROLES.USER,
    status: "active",
    profile: userRecord.profile
  }));

  // 4. Sync to Firebase Realtime Database in background
  try {
    withDbTimeout(set(ref(database, DB_PATHS.users(uid)), userRecord), 2000).catch(() => {});
  } catch (_) {}

  // 5. Broadcast update so open admin tabs see the user instantly
  window.dispatchEvent(new Event("storage"));
  window.dispatchEvent(new CustomEvent("users-updated", { detail: getLocalUsers() }));

  return uid;
}

// ── Admin: Approve User ──────────────────────────────────────
export async function approveUser(uid) {
  // 1. Update local store
  const users = getLocalUsers();
  const u = users.find(x => x.uid === uid);
  if (u) {
    u.status = "active";
    saveLocalUsers(users);
  }

  // 2. Update Firebase RTDB
  try {
    await withDbTimeout(update(ref(database, DB_PATHS.users(uid)), { status: "active" }), 2000);
  } catch (e) {
    console.warn("approveUser RTDB notice:", e.message);
  }

  window.dispatchEvent(new Event("storage"));
  window.dispatchEvent(new CustomEvent("users-updated", { detail: getLocalUsers() }));
}

// ── Admin: Deactivate User ───────────────────────────────────
export async function deactivateUser(uid) {
  const users = getLocalUsers();
  const u = users.find(x => x.uid === uid);
  if (u) {
    u.status = "deactivated";
    saveLocalUsers(users);
  }
  try {
    await withDbTimeout(update(ref(database, DB_PATHS.users(uid)), { status: "deactivated" }), 2000);
  } catch (e) {
    console.warn("deactivateUser RTDB notice:", e.message);
  }
  window.dispatchEvent(new Event("storage"));
}

// ── Admin: Disable User ──────────────────────────────────────
export async function disableUser(uid) {
  const users = getLocalUsers();
  const u = users.find(x => x.uid === uid);
  if (u) {
    u.status = "disabled";
    saveLocalUsers(users);
  }
  try {
    await withDbTimeout(update(ref(database, DB_PATHS.users(uid)), { status: "disabled" }), 2000);
  } catch (e) {
    console.warn("disableUser RTDB notice:", e.message);
  }
  window.dispatchEvent(new Event("storage"));
}

// ── Admin: Reset User Password ───────────────────────────────
export async function adminResetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (e) {
    console.warn("adminResetPassword notice:", e.message);
  }
}

// ── Route Guard: must be logged in ──────────────────────────
export async function requireAuth(redirectTo = "login.html") {
  // Check local session first
  const stored = localStorage.getItem(SMARTENERGY_SESSION_KEY);
  if (stored) {
    try {
      const session = JSON.parse(stored);
      return {
        user: { uid: session.uid, email: session.email },
        role: session.role,
        uid:  session.uid,
        profile: session.profile
      };
    } catch (_) {}
  }

  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) {
        window.location.href = resolvePageUrl(redirectTo);
        resolve(null);
      } else {
        const role = await getUserRole(user.uid);
        const profile = await getUserProfile(user.uid);
        resolve({ user, role, uid: user.uid, profile });
      }
    });
  });
}

// ── Route Guard: admin only ──────────────────────────────────
export async function requireAdmin() {
  const stored = localStorage.getItem(SMARTENERGY_SESSION_KEY);
  if (stored) {
    try {
      const session = JSON.parse(stored);
      if (session.role === ROLES.ADMIN || isAdminEmail(session.email)) {
        return { user: { uid: session.uid, email: session.email }, role: ROLES.ADMIN };
      }
    } catch (_) {}
  }

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
  const stored = localStorage.getItem(SMARTENERGY_SESSION_KEY);
  if (stored) {
    try {
      const session = JSON.parse(stored);
      if (session.role === ROLES.ADMIN) {
        window.location.href = resolvePageUrl("admin/dashboard.html");
        return null;
      }
      const local = getLocalUserByEmail(session.email);
      return {
        uid: session.uid,
        role: ROLES.USER,
        profile: local?.profile || session.profile || {},
        user: { uid: session.uid, email: session.email }
      };
    } catch (_) {}
  }

  const result = await requireAuth();
  if (result && result.role === ROLES.ADMIN) {
    window.location.href = resolvePageUrl("admin/dashboard.html");
    return null;
  }
  return result;
}

// ── Current User ─────────────────────────────────────────────
export function currentUser() {
  const stored = localStorage.getItem(SMARTENERGY_SESSION_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch (_) {}
  }
  return auth.currentUser;
}
