// Accounts: password hashing, sessions and the login cookie.
// Passwords are hashed with scrypt; session tokens are random and only their
// SHA-256 hash is stored, so a leaked database can't be used to log in.
import crypto from "node:crypto";
import { normLang } from "./plans.mjs";
import { getJSON, putJSON, del } from "./store.mjs";

const SESSION_DAYS = 30;
const MAX_FAILS = 8;
const LOCK_MINUTES = 15;
export const TERMS_VERSION = "2026-10-07";

const scrypt = (pw, salt) =>
  new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored || "").split("$");
  if (alg !== "scrypt" || !s || !k) return false;
  const expected = Buffer.from(k, "base64");
  const key = await scrypt(pw, Buffer.from(s, "base64"));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  return "";
}

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

// ---- users ----
export const userKey = (id) => `user/${id}`;
export const emailKey = (email) => `email/${sha(email)}`;

export async function findUserByEmail(email) {
  const idx = await getJSON(emailKey(email));
  return idx ? getJSON(userKey(idx.id)) : null;
}
export const getUser = (id) => getJSON(userKey(id));
export const saveUser = (u) => putJSON(userKey(u.id), u);

// ---- profile types: client (default) or lawyer ----
// Lawyers start "pending" and only see cases once the admin has verified them
// against the official register (albo). Any change to the bar details sends a
// verified lawyer back to "pending".
export const PRACTICE_AREAS = ["dismissal",  "employment",  "goods",  "contract",  "injury",  "road",  "building",  "consumer",  "tenancy",  "condo",  "neighbours",  "medical",  "insurance",  "travel",  "family",  "inheritance",  "injunction",  "fine",  "tax",  "defamation",  "other"];
const clip = (v, n) => String(v || "").trim().slice(0, n);

export function cleanLawyer(input, prev) {
  const i = input || {};
  const areas = Array.isArray(i.areas) ? [...new Set(i.areas.filter((a) => PRACTICE_AREAS.includes(a)))] : [];
  const out = {
    bar: clip(i.bar, 80),
    barNumber: clip(i.barNumber, 40),
    city: clip(i.city, 60),
    areas,
    bio: clip(i.bio, 600),
    status: (prev && prev.status) || "pending",
    submittedAt: (prev && prev.submittedAt) || new Date().toISOString(),
    verifiedAt: (prev && prev.verifiedAt) || null,
  };
  if (!out.bar) return { error: "Enter the bar association (Ordine degli Avvocati) you are registered with." };
  if (!out.barNumber) return { error: "Enter your registration number on the register of lawyers." };
  if (!out.areas.length) return { error: "Choose at least one area of practice." };
  if (prev && (prev.bar !== out.bar || prev.barNumber !== out.barNumber) && prev.status !== "pending") {
    out.status = "pending"; out.verifiedAt = null; out.submittedAt = new Date().toISOString();
  }
  if (prev && prev.status === "rejected" && (prev.bar !== out.bar || prev.barNumber !== out.barNumber)) out.status = "pending";
  return { lawyer: out };
}

export function isAdmin(u) {
  const list = String(process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!(u && list.includes(u.email));
}
export const isVerifiedLawyer = (u) => !!(u && u.role === "lawyer" && u.lawyer && u.lawyer.status === "verified");

export async function createUser({ email, password, name, lang, role, lawyer }) {
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email,
    name: String(name || "").trim().slice(0, 100),
    passwordHash: await hashPassword(password),
    createdAt: now,
    termsAcceptedAt: now,
    termsVersion: TERMS_VERSION,
    lang: normLang(lang),
    role: role === "lawyer" ? "lawyer" : "client",
    lawyer: role === "lawyer" ? lawyer : null,
    stripeCustomer: "",
    failedLogins: 0,
    lockedUntil: 0,
  };
  await saveUser(user);
  await putJSON(emailKey(email), { id: user.id });
  return user;
}

export async function changeEmail(user, email) {
  const old = user.email;
  user.email = email;
  await putJSON(emailKey(email), { id: user.id });
  await saveUser(user);
  if (old && old !== email) await del(emailKey(old));
  return user;
}

export async function changePassword(user, pw) {
  user.passwordHash = await hashPassword(pw);
  user.passwordChangedAt = new Date().toISOString();
  return revokeSessions(user);
}

// Ends every session that exists right now (all devices, including this one).
export async function revokeSessions(user) {
  user.sessionsValidAfter = Date.now();
  await saveUser(user);
  return user;
}

export async function deleteUser(user) {
  await del(emailKey(user.email));
  await del(userKey(user.id));
}

// Lockout after repeated wrong passwords, to slow down guessing.
export function isLocked(user) { return user.lockedUntil && user.lockedUntil > Date.now(); }
export async function recordFailure(user) {
  user.failedLogins = (user.failedLogins || 0) + 1;
  if (user.failedLogins >= MAX_FAILS) { user.lockedUntil = Date.now() + LOCK_MINUTES * 60e3; user.failedLogins = 0; }
  await saveUser(user);
}
export async function recordSuccess(user) {
  if (user.failedLogins || user.lockedUntil) { user.failedLogins = 0; user.lockedUntil = 0; }
  user.lastLoginAt = new Date().toISOString();
  await saveUser(user);
}

// ---- sessions ----
const COOKIE = "cb_session";

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const exp = Date.now() + SESSION_DAYS * 864e5;
  await putJSON(`session/${sha(token)}`, { uid: userId, exp, iat: Date.now() });
  return { token, exp };
}

function readCookie(req) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === COOKIE) return part.slice(i + 1);
  }
  return "";
}

export async function currentUser(req) {
  const token = readCookie(req);
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  const s = await getJSON(`session/${sha(token)}`);
  if (!s || s.exp < Date.now()) return null;
  const user = await getUser(s.uid);
  // "Sign out everywhere" and password changes invalidate every older session.
  if (user && user.sessionsValidAfter && (s.iat || 0) < user.sessionsValidAfter) return null;
  return user;
}

export async function endSession(req) {
  const token = readCookie(req);
  if (token) await del(`session/${sha(token)}`);
}

export function sessionCookie(req, token, exp) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  if (!token) return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((exp - Date.now()) / 1000)}${secure}`;
}

// Basic CSRF protection: state-changing requests must come from our own pages.
export function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

export function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, createdAt: u.createdAt, lang: u.lang,
    lastLoginAt: u.lastLoginAt || null, passwordChangedAt: u.passwordChangedAt || null,
    role: u.role === "lawyer" ? "lawyer" : "client",
    lawyer: u.role === "lawyer" ? u.lawyer || null : null,
    isAdmin: isAdmin(u),
  };
}
