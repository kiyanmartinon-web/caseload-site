// Accounts: password hashing, sessions and the login cookie.
// Passwords are hashed with scrypt; session tokens are random and only their
// SHA-256 hash is stored, so a leaked database can't be used to log in.
import crypto from "node:crypto";
import { getJSON, putJSON, del } from "./store.mjs";

const SESSION_DAYS = 30;
const MAX_FAILS = 8;
const LOCK_MINUTES = 15;
export const TERMS_VERSION = "2026-10-03";

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

export async function createUser({ email, password, name, lang }) {
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email,
    name: String(name || "").trim().slice(0, 100),
    passwordHash: await hashPassword(password),
    createdAt: now,
    termsAcceptedAt: now,
    termsVersion: TERMS_VERSION,
    lang: lang === "it" ? "it" : "en",
    stripeCustomer: "",
    failedLogins: 0,
    lockedUntil: 0,
  };
  await saveUser(user);
  await putJSON(emailKey(email), { id: user.id });
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
  await putJSON(`session/${sha(token)}`, { uid: userId, exp });
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
  return getUser(s.uid);
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
  return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt, lang: u.lang };
}
