// Self-improving rankings: aggregated relevance feedback.
//
// What is stored (Netlify Blobs, store "learning"):
//   doc/<DOC-ID>   { c: { <concept id>: [positive, negative] }, n }   — running totals only
//   snapshot       the whole model as served to the site (rebuilt every few minutes)
//   rl/<day>/<h>   per-connection daily counter, to stop one visitor flooding votes.
//                  <h> is a SHA-256 of the IP address with a random salt that exists
//                  for one day only (salt/<day>), so it can't be linked across days;
//                  both are deleted after two days.
// No text the visitor typed, no account, no IP address is ever stored.
import crypto from "node:crypto";

let override = null;
export function _setTestStore(s) { override = s; }
let cached = null;
async function store() {
  if (override) return override;
  if (!cached) {
    const { getStore } = await import("@netlify/blobs");
    cached = getStore({ name: "learning", consistency: "strong" });
  }
  return cached;
}
const getJSON = async (k) => (await (await store()).get(k, { type: "json" })) || null;
const putJSON = async (k, v) => (await store()).setJSON(k, v);

export const CONSENT_VERSION = 2;
export const MAX_EVENTS_PER_REQUEST = 20;
export const MAX_EVENTS_PER_DAY = 150;
export const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const WEIGHT = { vote: 1, result_open: 0.25 };

const DOC_RE = /^[A-Z]{2,3}-\d{1,5}$/;
const CONCEPT_RE = /^[a-z][a-z0-9_]{1,31}$/;

/** Validate and normalise one incoming event; returns null if unusable. */
export function cleanEvent(e) {
  if (!e || typeof e !== "object") return null;
  const action = e.action;
  if (!(action in WEIGHT)) return null;
  const doc = typeof e.doc === "string" ? e.doc : e.doc_id;
  if (typeof doc !== "string" || !DOC_RE.test(doc)) return null;
  const q = Array.isArray(e.q) ? [...new Set(e.q.filter((c) => typeof c === "string" && CONCEPT_RE.test(c)))].slice(0, 12) : [];
  if (!q.length) return null;
  let s = action === "vote" ? Number(e.vote) : 1;
  if (s !== 1 && s !== -1) return null;
  return { action, doc, q, s, w: WEIGHT[action] };
}

/** Pure: add an event to a doc's running totals. */
export function applyEvent(rec, ev) {
  const out = rec && rec.c ? { c: { ...rec.c }, n: rec.n || 0 } : { c: {}, n: 0 };
  for (const c of ev.q) {
    const [p, n] = out.c[c] || [0, 0];
    out.c[c] = ev.s > 0 ? [round(p + ev.w), n] : [p, round(n + ev.w)];
  }
  out.n = round(out.n + ev.w);
  return out;
}
const round = (x) => Math.round(x * 100) / 100;

const today = (now = new Date()) => now.toISOString().slice(0, 10);

async function daySalt(day) {
  const k = `salt/${day}`;
  let s = await getJSON(k);
  if (!s) { s = { v: crypto.randomBytes(16).toString("hex") }; await putJSON(k, s); }
  return s.v;
}

/** Record events from one request. Returns {accepted, rejected}. */
export async function record(events, ip, now = new Date()) {
  const day = today(now);
  const clean = (Array.isArray(events) ? events : []).slice(0, MAX_EVENTS_PER_REQUEST).map(cleanEvent).filter(Boolean);
  if (!clean.length) return { accepted: 0, rejected: Array.isArray(events) ? events.length : 0 };

  const h = crypto.createHash("sha256").update((await daySalt(day)) + "|" + String(ip || "unknown")).digest("hex").slice(0, 32);
  const rlKey = `rl/${day}/${h}`;
  const rl = (await getJSON(rlKey)) || { count: 0, seen: [] };
  let accepted = 0;
  for (const ev of clean) {
    if (rl.count >= MAX_EVENTS_PER_DAY) break;
    // one vote per document and direction per visitor per day; opens count once too
    const dedupe = `${ev.action}|${ev.doc}|${ev.s}`;
    if (rl.seen.includes(dedupe)) continue;
    rl.seen.push(dedupe);
    rl.count++;
    const key = `doc/${ev.doc}`;
    await putJSON(key, applyEvent(await getJSON(key), ev));
    accepted++;
  }
  if (rl.seen.length > 400) rl.seen = rl.seen.slice(-400);
  await putJSON(rlKey, rl);
  return { accepted, rejected: clean.length - accepted };
}

/** The model the site downloads. Cached as a snapshot, rebuilt at most every few minutes. */
export async function model(now = new Date()) {
  const snap = await getJSON("snapshot");
  if (snap && now - new Date(snap.updated) < SNAPSHOT_MAX_AGE_MS) return snap;
  const s = await store();
  const docs = {};
  let events = 0;
  const { blobs } = await s.list({ prefix: "doc/" });
  for (const b of blobs) {
    const rec = await getJSON(b.key);
    if (!rec || !rec.c) continue;
    docs[b.key.slice(4)] = rec.c;
    events += rec.n || 0;
  }
  const out = { updated: now.toISOString(), events: round(events), docs };
  await putJSON("snapshot", out);
  await cleanup(now).catch(() => {});
  return out;
}

/** Delete rate-limit counters and salts older than yesterday. */
async function cleanup(now) {
  const s = await store();
  const keep = new Set([today(now), today(new Date(now - 86400000))]);
  for (const prefix of ["rl/", "salt/"]) {
    const { blobs } = await s.list({ prefix });
    for (const b of blobs) {
      const day = b.key.split("/")[1];
      if (!keep.has(day)) await s.delete(b.key);
    }
  }
}
