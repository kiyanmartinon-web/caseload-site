// Risk check that learns from verified lawyers.
//
// The risk check in risk-check.html adds up penalty points for four factors (time limit,
// evidence, detail, amount): 3+ points = high risk, 1.5+ = medium, less = low. Those
// points started as hand-set rules. Every time a verified lawyer rates the strength of a
// published case (1–5 on the case board), that rating becomes a training example, and
// this file re-fits the points so the check agrees better with lawyers' judgement.
//
// The model is a ridge regression with the hand-set rules as its prior: with few ratings
// it stays at the rules, and it moves only as far as the evidence pushes it. It is only
// switched on when 5-fold cross-validation shows it predicts lawyers' ratings better than
// the rules (lower mean absolute error and at least as many low/medium/high levels right).
//
// What is stored (Netlify Blobs, store "learning"):
//   risk/row/<case id>/<h>  { f: factor codes, s: strength 1–5, q: evidence quality 1–5, d: decision, day }
//                           <h> is a one-way hash of lawyer + case; no text, no names.
//   risk/anon/<random>      the same rows once the case is deleted — no link to case, client or lawyer.
//   risk/model              the fitted model served to the site (rebuilt at most every 10 minutes).
import crypto from "node:crypto";

let override = null;
export function _setTestStore(s) { override = s; }
async function store() {
  if (override) return override;
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name: "learning", consistency: "strong" });
}
const getJSON = async (k) => (await (await store()).get(k, { type: "json" })) || null;
const putJSON = async (k, v) => (await store()).setJSON(k, v);

export const MIN_ROWS = 15;
const MAX_AGE_MS = 10 * 60 * 1000;
const LAMBDA = 3;        // prior strength: like 3 extra examples agreeing with the rules, per factor value

// Time limits in days per area — keep in step with AREAS in risk-check.html.
const AREAS = {
  dismissal: { days: 60 }, employment: { days: 1825 }, goods: { days: 365 }, contract: { days: 3650 }, injury: { days: 1825 },
  road: { days: 730 }, building: { days: 365 }, consumer: { days: 790 }, tenancy: { days: 1825 }, condo: { days: 30 },
  neighbours: { days: null, open: true }, medical: { days: 3650 }, insurance: { days: 730 }, travel: { days: 730 },
  family: { days: null, open: true }, inheritance: { days: 3650 }, injunction: { days: 40 }, fine: { days: 30 },
  tax: { days: 60 }, defamation: { days: 90 }, other: { days: null },
};

// The hand-set rules (penalty points) — the same numbers as check() in risk-check.html.
export const RULES = {
  time: { ok: 0, open: 0, ask: 0.5, unknown: 1, short: 1, expired: 3 },
  evidence: { strong: 0, moderate: 0, weak: 1, none: 2 },
  detail: { clear: 0, brief: 1 },
  amount: { large: 0, small: 0, none: 0.5 },
};
const COLS = [["bias", ""]].concat(...Object.entries(RULES).map(([g, vals]) => Object.keys(vals).map((k) => [g, k])));

// A lawyer's strength rating, as risk points on the same scale as the check.
export const STRENGTH_POINTS = { 1: 4.75, 2: 3.5, 3: 2.25, 4: 1, 5: 0.25 };
export const levelOfPoints = (p) => (p >= 3 ? "high" : p >= 1.5 ? "med" : "low");
export const levelOfStrength = (s) => (s <= 2 ? "high" : s === 3 ? "med" : "low");

/** Pure: the four factor codes of a case, as the client saw them when it was published. */
export function features(c) {
  const A = AREAS[c.area] || AREAS.other;
  let time;
  if (!A.days) time = A.open ? "open" : "ask";
  else if (!c.date) time = "unknown";
  else {
    const at = Date.parse(c.createdAt) || Date.now();
    const left = Math.round((Date.parse(c.date + "T00:00:00Z") + A.days * 86400e3 - at) / 86400e3);
    time = left < 0 ? "expired" : left <= 60 ? "short" : "ok";
  }
  const ev = c.evidenceLevel || (c.analysis && c.analysis.evidence && c.analysis.evidence.level) || "none";
  return {
    time,
    evidence: RULES.evidence[ev] !== undefined ? ev : "none",
    detail: String(c.facts || "").length < 160 ? "brief" : "clear",
    amount: !c.amount ? "none" : c.amount < 1000 ? "small" : "large",
  };
}

const xOf = (f) => COLS.map(([g, k]) => (g === "bias" ? 1 : f[g] === k ? 1 : 0));
const prior = () => COLS.map(([g, k]) => (g === "bias" ? 0 : RULES[g][k]));
export const rulePoints = (f) => Object.keys(RULES).reduce((s, g) => s + (RULES[g][f[g]] || 0), 0);

/** Solve A x = b by Gaussian elimination with partial pivoting (A is small and well-conditioned). */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      if (k) for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

/** Pure: ridge regression of risk points on factor codes, shrunk towards the rules. */
export function fit(rows, lambda = LAMBDA) {
  const d = COLS.length, th0 = prior();
  const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? lambda : 0)));
  const b = th0.map((v) => lambda * v);
  for (const r of rows) {
    const x = xOf(r.f), y = STRENGTH_POINTS[r.s];
    for (let i = 0; i < d; i++) { if (!x[i]) continue; b[i] += x[i] * y; for (let j = 0; j < d; j++) A[i][j] += x[i] * x[j]; }
  }
  return solve(A, b);
}
export const predict = (theta, f) => xOf(f).reduce((s, x, i) => s + x * theta[i], 0);

/** Pure: k-fold cross-validated error of the rules and of the learned model. */
export function crossValidate(rows, k = 5) {
  const out = { rule: { mae: 0, acc: 0 }, learned: { mae: 0, acc: 0 }, n: rows.length };
  if (!rows.length) return out;
  rows.forEach((r, i) => {
    const train = rows.filter((_, j) => j % k !== i % k);
    const th = fit(train), y = STRENGTH_POINTS[r.s], want = levelOfStrength(r.s);
    const pr = rulePoints(r.f), pl = predict(th, r.f);
    out.rule.mae += Math.abs(pr - y); out.learned.mae += Math.abs(pl - y);
    out.rule.acc += levelOfPoints(pr) === want ? 1 : 0; out.learned.acc += levelOfPoints(pl) === want ? 1 : 0;
  });
  for (const m of [out.rule, out.learned]) { m.mae = Math.round((m.mae / rows.length) * 100) / 100; m.acc = Math.round((m.acc / rows.length) * 100) / 100; }
  return out;
}

/** Pure: the model as the site uses it — a points table per factor plus a bias. */
export function build(rows, now = new Date()) {
  const theta = fit(rows), cv = crossValidate(rows);
  // on only if it beats the rules on both error and on the low/medium/high level people actually see
  const active = rows.length >= MIN_ROWS && cv.learned.mae < cv.rule.mae && cv.learned.acc >= cv.rule.acc;
  const table = {};
  COLS.forEach(([g, k], i) => { if (g !== "bias") (table[g] = table[g] || {})[k] = Math.round(Math.max(-2, Math.min(5, theta[i])) * 100) / 100; });
  const confusion = { low: { low: 0, med: 0, high: 0 }, med: { low: 0, med: 0, high: 0 }, high: { low: 0, med: 0, high: 0 } };
  for (const r of rows) confusion[levelOfStrength(r.s)][levelOfPoints(rulePoints(r.f))]++;   // lawyers' level × rule level
  return {
    updated: now.toISOString(), n: rows.length, minRows: MIN_ROWS, active,
    bias: Math.round(theta[0] * 100) / 100, table: active ? table : RULES, learnedTable: table, rules: RULES,
    metrics: cv, confusion,
  };
}

/* ------------------------------------------------------------------ storage */
const rowKey = (caseId, lawyerId) => `risk/row/${caseId}/${crypto.createHash("sha256").update(`${lawyerId}|${caseId}`).digest("hex").slice(0, 16)}`;

/** Called when a verified lawyer saves a review. A review without a strength rating removes the row. */
export async function recordReview(c, lawyerId, review) {
  const k = rowKey(c.id, lawyerId);
  const s = await store();
  if (!review || !STRENGTH_POINTS[review.strength]) { await s.delete(k); return; }
  await putJSON(k, { f: features(c), s: review.strength, q: review.quality || null, d: review.decision || null, day: new Date().toISOString().slice(0, 10) });
}

/** When a case is deleted, keep its ratings only as anonymous rows with no link to anyone. */
export async function anonymiseCase(caseId) {
  const s = await store();
  const { blobs } = await s.list({ prefix: `risk/row/${caseId}/` });
  for (const b of blobs) {
    const row = await s.get(b.key, { type: "json" });
    if (row) await s.setJSON(`risk/anon/${crypto.randomBytes(8).toString("hex")}`, { f: row.f, s: row.s, q: row.q, d: row.d, day: String(row.day || "").slice(0, 7) });
    await s.delete(b.key);
  }
}

export async function allRows() {
  const s = await store();
  const rows = [];
  for (const prefix of ["risk/row/", "risk/anon/"]) {
    const { blobs } = await s.list({ prefix });
    for (let i = 0; i < blobs.length; i += 50) {
      const part = await Promise.all(blobs.slice(i, i + 50).map((b) => s.get(b.key, { type: "json" })));
      rows.push(...part.filter((r) => r && r.f && STRENGTH_POINTS[r.s]));
    }
  }
  return rows;
}

export async function model(now = new Date(), { fresh = false } = {}) {
  const snap = await getJSON("risk/model");
  if (!fresh && snap && now - new Date(snap.updated) < MAX_AGE_MS) return snap;
  const out = build(await allRows(), now);
  await putJSON("risk/model", out);
  return out;
}

/** What the page downloads: points and whether they are switched on. No rows, no personal data. */
export const publicModel = (m) => ({ active: m.active, n: m.n, bias: m.active ? m.bias : 0, table: m.table, updated: m.updated });
