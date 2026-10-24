// Cases that Pro clients send to verified lawyers ("Connect with a lawyer").
// Stored in Netlify Blobs, store "matches", key case/<id>. Visible in Netlify → Blobs.
//
// What each side sees:
//  - Lawyers (verified only) see the case without the client's name or email.
//  - When a lawyer marks a case "interested", the client sees that lawyer's profile.
//  - The client's name and email go to a lawyer only after the client presses
//    "Share my contact details" for that lawyer.
import crypto from "node:crypto";
import { getUser, PRACTICE_AREAS } from "./auth.mjs";
import { anonymiseCase } from "./riskmodel.mjs";

let override = null;
export function _setTestStore(s) { override = s; }
// A fresh store on every call: Netlify hands each request a short-lived access
// token, so a store kept from an earlier request fails with "Token expired".
async function store() {
  if (override) return override;
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name: "matches", consistency: "strong" });
}

const key = (id) => `case/${id}`;
export async function getCase(id) {
  if (!/^[A-Za-z0-9-]{8,60}$/.test(String(id || ""))) return null;
  const s = await store();
  return (await s.get(key(id), { type: "json" })) || null;
}
export async function saveCase(c) { const s = await store(); await s.setJSON(key(c.id), c); }
export async function deleteCase(id) {
  const s = await store(); await s.delete(key(id));
  // lawyers' ratings of this case stay only as anonymous training rows for the risk model
  await anonymiseCase(id).catch((e) => console.error("[risk model] anonymise", e && e.message));
}
export async function allCases() {
  const s = await store();
  const { blobs } = await s.list({ prefix: "case/" });
  const out = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return out.filter(Boolean);
}

const EVIDENCE = ["Contract", "Emails / messages", "Invoices / receipts", "Photos / video", "Witnesses", "Expert report", "Official report", "Payslips"];
const PARTIES = ["A company", "My employer", "A private person", "A landlord", "A public body"];
export const REGIONS = ["Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna", "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardia", "Marche", "Molise", "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana", "Trentino-Alto Adige", "Umbria", "Valle d'Aosta", "Veneto"];
const clip = (v, n) => String(v || "").trim().slice(0, n);

export function cleanCase(b) {
  const area = PRACTICE_AREAS.includes(b.area) ? b.area : "other";
  const facts = clip(b.facts, 5000);
  const title = clip(b.title, 120);
  if (title.length < 6) return { error: "Add a one-line summary of the problem." };
  if (facts.length < 40) return { error: "Describe what happened in a few sentences." };
  if (b.consent !== true) return { error: "Please confirm that verified lawyers may read your description." };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : null;
  const amount = Math.max(0, Math.min(1e9, Math.round(Number(b.amount) || 0)));
  const evidence = Array.isArray(b.evidence) ? [...new Set(b.evidence.filter((e) => EVIDENCE.includes(e)))] : [];
  return {
    data: {
      area, title, facts, date, amount, evidence,
      evidenceNote: clip(b.evidenceNote, 1000),
      areaOther: area === "other" ? clip(b.areaOther, 80) : "",
      party: PARTIES.includes(b.party) ? b.party : "",
      city: clip(b.city, 60),
      region: REGIONS.includes(b.region) ? b.region : "",
      checkLevel: ["low", "med", "high"].includes(b.checkLevel) ? b.checkLevel : "",
      evidenceLevel: ["strong", "moderate", "weak", "none"].includes(b.evidenceLevel) ? b.evidenceLevel : "",
      goal: clip(b.goal, 200),
      analysis: cleanAnalysis(b.analysis),
    },
  };
}

// The client's full risk-check result, generated in the browser when the case is published.
// Kept as plain text in the client's language (lawyers see what the client saw); everything is clipped.
const LANGS = ["en", "it", "es", "fr", "de", "pt", "pl", "ar"];
function cleanAnalysis(a) {
  if (!a || typeof a !== "object") return null;
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const pick = (v, list) => (list.includes(v) ? v : "");
  const level = pick(a.level, ["low", "med", "high"]);
  if (!level) return null;
  const ev = a.evidence && typeof a.evidence === "object" ? a.evidence : {};
  return {
    lang: pick(a.lang, LANGS) || "en",
    level, label: clip(a.label, 60), headline: clip(a.headline, 200),
    factors: arr(a.factors, 6).map((f) => ({ name: clip(f && f.name, 60), v: pick(f && f.v, ["ok", "warn", "bad"]) || "warn", label: clip(f && f.label, 80), tip: clip(f && f.tip, 400) })),
    evidence: {
      level: pick(ev.level, ["strong", "moderate", "weak", "none"]),
      label: clip(ev.label, 60), headline: clip(ev.headline, 200), text: clip(ev.text, 600),
      have: arr(ev.have, 15).map((h) => ({ name: clip(h && h.name, 80), strong: !!(h && h.strong), tip: clip(h && h.tip, 300) })),
      wantH: clip(ev.wantH, 160),
      want: arr(ev.want, 8).map((w) => ({ name: clip(w && w.name, 120), has: !!(w && w.has) })),
      warn: arr(ev.warn, 8).map((w) => clip(w, 300)).filter(Boolean),
    },
    note: clip(a.note, 400),
    at: new Date().toISOString(),
  };
}

export function newCase(clientId, data) {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), clientId, createdAt: now, updatedAt: now, status: "open", ...data, updates: [], reviews: {}, consentAt: now };
}

export function lawyerCard(u) {
  if (!u || !u.lawyer) return null;
  return { id: u.id, name: u.name || "", bar: u.lawyer.bar, city: u.lawyer.city, areas: u.lawyer.areas, bio: u.lawyer.bio };
}

// The client's own view: every lawyer who reviewed, and the profile of each interested one.
export async function forClient(c) {
  const lawyers = [];
  for (const [lid, r] of Object.entries(c.reviews || {})) {
    if (r.decision !== "interested" && r.decision !== "info") continue;
    const u = await getUser(lid);
    if (!u || u.role !== "lawyer") continue;
    lawyers.push({ ...lawyerCard(u), decision: r.decision, note: r.note || "", at: r.at, shared: !!r.sharedAt, email: r.sharedAt ? u.email : "" });
  }
  const { clientId, reviews, ...rest } = c;
  return { ...rest, lawyers, reviewCount: Object.keys(reviews || {}).length };
}

// A lawyer's view: no client identity unless the client chose to share it with this lawyer.
export async function forLawyer(c, lawyerId) {
  const mine = (c.reviews || {})[lawyerId] || null;
  let contact = null;
  if (mine && mine.sharedAt) {
    const client = await getUser(c.clientId);
    if (client) contact = { name: client.name || "", email: client.email };
  }
  const { clientId, reviews, ...rest } = c;
  const others = Object.entries(reviews || {}).filter(([k, r]) => k !== lawyerId && r.decision === "interested").length;
  return { ...rest, mine, contact, othersInterested: others };
}
