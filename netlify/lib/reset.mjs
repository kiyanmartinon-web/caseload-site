// One-time codes for "Forgot your password?".
// Only a hash of each code is stored, under reset/<sha256(email)> in the accounts store.
import crypto from "node:crypto";
import { getJSON, putJSON } from "./store.mjs";

const CODE_MINUTES = 15;   // a code works for 15 minutes
const MAX_TRIES = 5;       // wrong guesses before the code is burnt
const RESEND_SECONDS = 60; // at most one new code a minute…
const MAX_PER_HOUR = 5;    // …and five an hour, per email

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const key = (email) => `reset/${sha(email)}`;
const codeHash = (email, code) => sha(`${email}:${String(code).replace(/\D/g, "")}`);

// → {code} | {wait:true} | {limited:true}
export async function issueCode(email) {
  const now = Date.now();
  const prev = (await getJSON(key(email))) || {};
  const sent = (prev.sent || []).filter((t) => now - t < 3600e3);
  if (prev.sentAt && now - prev.sentAt < RESEND_SECONDS * 1000) return { wait: true };
  if (sent.length >= MAX_PER_HOUR) return { limited: true };
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  await putJSON(key(email), { hash: codeHash(email, code), exp: now + CODE_MINUTES * 60e3, tries: 0, sentAt: now, sent: [...sent, now] });
  return { code, minutes: CODE_MINUTES };
}

// → "ok" | "wrong" | "expired" | "locked"
export async function checkCode(email, code) {
  const r = await getJSON(key(email));
  if (!r || !r.hash || r.exp < Date.now()) return "expired";
  if (r.tries >= MAX_TRIES) return "locked";
  const a = Buffer.from(r.hash, "hex"), b = Buffer.from(codeHash(email, code), "hex");
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return "ok";
  r.tries = (r.tries || 0) + 1;
  await putJSON(key(email), r);
  return r.tries >= MAX_TRIES ? "locked" : "wrong";
}

// Burn the code once it has been used (keeps the send history for the hourly limit).
export async function useCode(email) {
  const r = (await getJSON(key(email))) || {};
  await putJSON(key(email), { sent: r.sent || [], sentAt: r.sentAt || 0 });
}
