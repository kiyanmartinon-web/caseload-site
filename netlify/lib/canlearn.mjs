// "Can I…?" — the learning loop that makes answers more accurate over time.
//
// How it learns
//  1. Every answer is filed under an *issue*: the short, neutral English description of
//     the legal question that the model writes itself (research_query, e.g. "recording a
//     phone call without the other party's consent"). Never the visitor's own words.
//  2. Issues are matched by TF-IDF cosine similarity, so different phrasings of the same
//     question ("tape a call", "record a phone conversation") land on the same issue.
//  3. For each issue and country we keep:
//       - what the model answered each time (verdict counts → shows when it is unstable),
//       - visitors' "Right / Wrong" ratings, and which countries they flagged as wrong,
//       - corrections from verified lawyers and the admin (the strongest signal).
//  4. When a new question matches an issue with a lawyer correction, repeated "wrong"
//     flags (Bayesian estimate, see disputed()), or unstable past verdicts, the model is
//     asked again with those notes, and a lawyer's verdict for a country always wins.
//
// What is stored (Netlify Blobs, store "canlearn"):
//   issue/<id>     { q, n, places:{IT:{yes,no,depends,unclear}}, fb, fixes, created, updated }
//   index          { <id>: [terms] } — for matching
//   day/<YYYY-MM-DD> daily totals for the admin charts (kept 180 days)
//   rl/<day>/<h>   per-connection daily counter for ratings (IP hashed with a one-day salt)
//   salt/<day>     that salt; rl/ and salt/ are deleted after two days
// No question text, no answer text, no account and no IP address is stored.
import crypto from "node:crypto";

let override = null;
export function _setTestStore(s) { override = s; }
async function store() {
  if (override) return override;
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name: "canlearn", consistency: "strong" });
}
const getJSON = async (k) => (await (await store()).get(k, { type: "json" })) || null;
const putJSON = async (k, v) => (await store()).setJSON(k, v);

export const PLACE_CODES = ["IT", "ES", "FR", "DE", "PT", "PL", "GB", "US"];
const VERDICTS = ["yes", "no", "depends", "unclear"];
export const MATCH_THRESHOLD = 0.6;    // cosine similarity to count as the same issue
export const STRICT_MATCH = 0.75;      // above this a lawyer's verdict is applied directly
export const MAX_ISSUES = 3000;
export const MAX_RATINGS_PER_DAY = 60;
const TOKEN_DAYS = 30;
const today = (now = new Date()) => now.toISOString().slice(0, 10);

/* ------------------------------------------------------------------ text → terms */
const STOP = new Set(("a an the and or of to in on for by with without from at as is are be been being it its this that these those " +
  "can could may might must should would will shall do does did done not no yes if when where who whom whose which what how " +
  "i me my we our you your he she they them their his her someone somebody something person people one other another " +
  "about into over under after before during than then there here also only just any some all each such own same so very " +
  "allowed legal legally lawful law laws rule rules permitted whether").split(/\s+/));

/** Light English stemmer: enough to join record/recording/recorded, tenant/tenants. */
export function stem(w) {
  if (w.length <= 4) return w;
  for (const [suf, rep] of [["ational", "ate"], ["ization", "ize"], ["iveness", "ive"], ["fulness", "ful"], ["ousness", "ous"],
    ["ations", "ate"], ["ation", "ate"], ["ments", ""], ["ment", ""], ["ings", ""], ["ing", ""], ["ies", "y"], ["ied", "y"],
    ["edly", ""], ["ed", ""], ["ers", "er"], ["es", "e"], ["s", ""]]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      let s = w.slice(0, -suf.length) + rep;
      if (/(.)\1$/.test(s) && !/(ll|ss|zz)$/.test(s)) s = s.slice(0, -1); // recorded→record, stopped→stop
      return s;
    }
  }
  return w;
}
// Everyday synonyms and spellings folded into one word, so paraphrases share terms.
const CANON = {};
for (const [to, from] of Object.entries({
  apartment: "flat flats apartments condo",
  record: "tape taping taped recording recorded records film filming filmed",
  call: "calls conversation conversations phonecall",
  phone: "telephone mobile cellphone",
  consent: "permission authorisation authorization agreement approval knowing",
  secret: "secretly covertly hidden",
  dismiss: "fire firing fired sack sacked sacking dismissing dismissal dismissed terminate terminating termination layoff",
  employee: "worker workers employees staff",
  employer: "boss employers",
  license: "licence licences licenses",
  eu: "europe european",
  us: "usa american america",
  uk: "britain british england",
  rent: "rented renting rental lease leased leasing tenancy",
  tenant: "tenants renter renters lodger",
  landlord: "landlords lessor",
  enter: "entering entered entry coming come",
  drive: "driving drove",
  vehicle: "car cars vehicles motorbike scooter",
  child: "children kid kids minor minors son daughter",
  photo: "photos photograph photographs picture pictures",
  cannabis: "weed marijuana hemp",
  firearm: "gun guns firearms weapon weapons",
  sick: "illness ill sickness",
  buy: "purchase purchasing buying bought",
  sell: "selling sold",
})) for (const w of from.split(" ")) CANON[w] = to;

export function terms(text) {
  const words = String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => CANON[w] || w).map((w) => CANON[stem(w)] || stem(w));
  const out = [...words];
  // two-word phrases help separate e.g. "phone call" from "call centre"
  for (let i = 0; i + 1 < words.length; i++) out.push(words[i] + "_" + words[i + 1]);
  return out;
}
const tf = (list) => list.reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {});

/** Pure: TF-IDF cosine similarity of a query against every indexed issue. Best first. */
export function rank(queryTerms, index) {
  const ids = Object.keys(index || {});
  if (!ids.length || !queryTerms.length) return [];
  const N = ids.length, df = {};
  for (const id of ids) for (const t of new Set(index[id])) df[t] = (df[t] || 0) + 1;
  const idf = (t) => Math.log((N + 1) / ((df[t] || 0) + 1)) + 1;
  const vec = (list) => { const v = {}; for (const [t, c] of Object.entries(tf(list))) v[t] = (1 + Math.log(c)) * idf(t) * (t.includes("_") ? 0.5 : 1); return v; };  // phrases count half
  const norm = (v) => Math.sqrt(Object.values(v).reduce((s, x) => s + x * x, 0)) || 1;
  const q = vec(queryTerms), qn = norm(q);
  return ids.map((id) => {
    const d = vec(index[id]); let dot = 0;
    for (const [t, w] of Object.entries(q)) if (d[t]) dot += w * d[t];
    return { id, score: dot / (qn * norm(d)) };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

/** Remove anything that could identify someone from the model-written issue text. */
export function cleanIssue(text) {
  return String(text || "")
    .replace(/\S+@\S+/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\+?\d[\d\s().-]{6,}\d/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 200);
}

/* ------------------------------------------------------------------ statistics */
/** Bayesian estimate that the answer for a place is wrong, with a uniform Beta(1,1) prior. */
export function wrongRate([up, down]) { return (down + 1) / (up + down + 2); }
/** A place is disputed when at least 3 ratings flag it and the estimated wrong-rate is ≥ 0.6. */
export function disputed(pair) { return !!pair && pair[1] >= 3 && wrongRate(pair) >= 0.6; }
/** Past verdicts disagree: at least 4 answers and the most common verdict has under 65%. */
export function unstable(counts) {
  const v = Object.values(counts || {}); const n = v.reduce((a, b) => a + b, 0);
  return n >= 4 && Math.max(...v) / n < 0.65;
}
export function majority(counts) {
  let best = null, bn = 0;
  for (const [k, n] of Object.entries(counts || {})) if (n > bn) { best = k; bn = n; }
  return best;
}

/** Pure: what the model should be told before answering this issue again. Empty = nothing to fix. */
export function notesFor(issue) {
  if (!issue) return [];
  const notes = [];
  const head = `These notes are about the question "${issue.q}". Use them only if it is the same legal question as the one asked; otherwise ignore them.`;
  for (const code of Object.keys(issue.fixes || {})) {
    const f = issue.fixes[code];
    notes.push(`${code}: a verified ${f.by === "admin" ? "Casebound editor" : "lawyer"} corrected this — the right verdict is "${f.verdict}"${f.note ? `. Their note: ${f.note}` : ""}. Follow it.`);
  }
  for (const [code, pair] of Object.entries((issue.fb && issue.fb.places) || {})) {
    if (issue.fixes && issue.fixes[code]) continue;
    if (disputed(pair)) notes.push(`${code}: ${pair[1]} of ${pair[0] + pair[1]} readers flagged the previous answer for this place as wrong (it said "${majority((issue.places || {})[code]) || "?"}"). Re-check it carefully; if you are not sure, use "unclear" and say what to check.`);
  }
  for (const [code, counts] of Object.entries(issue.places || {})) {
    if ((issue.fixes && issue.fixes[code]) || disputed(issue.fb && issue.fb.places && issue.fb.places[code])) continue;
    if (unstable(counts)) notes.push(`${code}: earlier answers disagreed (${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ")}). Decide carefully and state the condition that decides it.`);
  }
  return notes.length ? [head, ...notes] : [];
}

/** Pure: make sure a lawyer's correction wins, whatever the model wrote. */
export function applyFixes(answer, issue) {
  if (!issue || !issue.fixes) return answer;
  const places = (answer.places || []).map((p) => {
    const f = issue.fixes[p.code];
    return f ? { ...p, verdict: f.verdict, reviewed: true } : p;
  });
  return { ...answer, places };
}

/* ------------------------------------------------------------------ signed answer tokens */
// Ratings refer to an answer by a signed token, so nothing about the question needs storing.
function secret() {
  const s = process.env.LEARN_SECRET || process.env.ANTHROPIC_API_KEY || "casebound-dev";
  return crypto.createHash("sha256").update("casebound-learn|" + s).digest();
}
const b64 = (b) => Buffer.from(b).toString("base64url");
export function signToken(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = b64(crypto.createHmac("sha256", secret()).update(body).digest()).slice(0, 22);
  return `${body}.${mac}`;
}
export function readToken(tok, now = Date.now()) {
  const [body, mac] = String(tok || "").split(".");
  if (!body || !mac) return null;
  const want = b64(crypto.createHmac("sha256", secret()).update(body).digest()).slice(0, 22);
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p || typeof p.i !== "string" || now - p.t > TOKEN_DAYS * 86400e3) return null;
    return p;
  } catch { return null; }
}

/* ------------------------------------------------------------------ reading */
export async function findIssue(issueText) {
  const index = (await getJSON("index")) || {};
  const best = rank(terms(issueText), index)[0];
  if (!best || best.score < MATCH_THRESHOLD) return null;
  const issue = await getJSON(`issue/${best.id}`);
  return issue ? { issue, score: Math.round(best.score * 100) / 100 } : null;
}
export const getIssue = (id) => (/^[a-f0-9]{16}$/.test(String(id || "")) ? getJSON(`issue/${id}`) : null);

/** What the page shows next to an answer: lawyer-checked places and how readers rated this issue. */
export function trustFor(issue) {
  if (!issue) return { reviewed: [], up: 0, down: 0, answers: 0 };
  return {
    reviewed: Object.keys(issue.fixes || {}),
    up: Math.round((issue.fb && issue.fb.up) || 0), down: Math.round((issue.fb && issue.fb.down) || 0),
    answers: issue.n || 0,
  };
}

/* ------------------------------------------------------------------ writing */
const emptyFb = () => ({ up: 0, down: 0, places: {}, rev: [0, 0], plain: [0, 0] });

async function bumpDay(field, by = 1, now = new Date()) {
  const k = `day/${today(now)}`;
  const d = (await getJSON(k)) || { answers: 0, revised: 0, matched: 0, up: 0, down: 0, fixes: 0 };
  d[field] = Math.round(((d[field] || 0) + by) * 100) / 100;
  await putJSON(k, d);
}

/** File an answer under its issue (new or matched). Returns the token the page sends back with a rating. */
export async function recordAnswer(answer, match, { revised = false } = {}, now = new Date()) {
  const text = cleanIssue(answer.researchQuery);
  let issue = match && match.issue;
  if (!issue) {
    if (!text) return null;
    const id = crypto.createHash("sha256").update(text.toLowerCase() + "|" + now.toISOString()).digest("hex").slice(0, 16);
    issue = { id, q: text, n: 0, places: {}, fb: emptyFb(), fixes: {}, created: now.toISOString() };
    const index = (await getJSON("index")) || {};
    index[id] = terms(text);
    const ids = Object.keys(index);
    if (ids.length > MAX_ISSUES) {   // drop the oldest issue (insertion order)
      delete index[ids[0]];
      await (await store()).delete(`issue/${ids[0]}`).catch(() => {});
    }
    await putJSON("index", index);
  }
  issue.n = (issue.n || 0) + 1;
  for (const p of answer.places || []) {
    if (!PLACE_CODES.includes(p.code) || p.reviewed) continue;   // count what the model said, not the override
    const c = (issue.places[p.code] = issue.places[p.code] || {});
    c[p.verdict] = (c[p.verdict] || 0) + 1;
  }
  issue.updated = now.toISOString();
  await putJSON(`issue/${issue.id}`, issue);
  await bumpDay("answers", 1, now);
  if (match) await bumpDay("matched", 1, now);
  if (revised) await bumpDay("revised", 1, now);
  return signToken({ i: issue.id, r: revised ? 1 : 0, t: now.getTime() });
}

async function daySalt(day) {
  const k = `salt/${day}`;
  let s = await getJSON(k);
  if (!s) { s = { v: crypto.randomBytes(16).toString("hex") }; await putJSON(k, s); }
  return s.v;
}

/** A reader's rating: vote = 1 (right) or -1 (wrong), wrong = place codes flagged as wrong. */
export async function rate({ token, vote, wrong, weight = 1, ip }, now = new Date()) {
  const p = readToken(token, now.getTime());
  if (!p) return { error: "expired" };
  const v = Number(vote);
  if (v !== 1 && v !== -1) return { error: "invalid" };
  const flags = v < 0 && Array.isArray(wrong) ? [...new Set(wrong.filter((c) => PLACE_CODES.includes(c)))] : [];

  const day = today(now);
  const h = crypto.createHash("sha256").update((await daySalt(day)) + "|" + String(ip || "?")).digest("hex").slice(0, 32);
  const rlKey = `rl/${day}/${h}`;
  const rl = (await getJSON(rlKey)) || { count: 0, seen: {} };
  if (rl.count >= MAX_RATINGS_PER_DAY) return { error: "limit" };

  const issue = await getJSON(`issue/${p.i}`);
  if (!issue) return { error: "expired" };
  issue.fb = { ...emptyFb(), ...(issue.fb || {}) };
  // A changed mind (or adding countries) replaces this visitor's earlier rating of the same issue today.
  const prev = rl.seen[p.i];
  const apply = (r, sign) => {
    if (!r) return;
    const w = r.w * sign;
    if (r.v > 0) issue.fb.up += w; else issue.fb.down += w;
    const bucket = r.r ? "rev" : "plain";
    issue.fb[bucket] = issue.fb[bucket] || [0, 0];
    issue.fb[bucket][r.v > 0 ? 0 : 1] += w;
    const placesRight = r.v > 0 ? Object.keys(issue.places || {}) : [];
    for (const c of placesRight) { const pr = (issue.fb.places[c] = issue.fb.places[c] || [0, 0]); pr[0] += w; }
    for (const c of r.f) { const pr = (issue.fb.places[c] = issue.fb.places[c] || [0, 0]); pr[1] += w; }
  };
  const now_ = { v, f: flags, w: weight, r: p.r };
  apply(prev, -1);
  apply(now_, 1);
  const round = (x) => Math.max(0, Math.round(x * 100) / 100);
  issue.fb.up = round(issue.fb.up); issue.fb.down = round(issue.fb.down);
  for (const k of ["rev", "plain"]) issue.fb[k] = issue.fb[k].map(round);
  for (const c of Object.keys(issue.fb.places)) issue.fb.places[c] = issue.fb.places[c].map(round);
  await putJSON(`issue/${p.i}`, issue);

  if (!prev) rl.count++;
  rl.seen[p.i] = now_;
  await putJSON(rlKey, rl);
  if (prev) await bumpDay(prev.v > 0 ? "up" : "down", -prev.w, now);
  await bumpDay(v > 0 ? "up" : "down", weight, now);
  await cleanup(now).catch(() => {});
  return { ok: true, trust: trustFor(issue) };
}

/** A verified lawyer's or the admin's correction for one country. verdict "" removes it. */
export async function fix({ issueId, token, place, verdict, note, by }, now = new Date()) {
  const id = issueId || (readToken(token, now.getTime()) || {}).i;
  const issue = await getIssue(id);
  if (!issue) return { error: "Issue not found." };
  if (!PLACE_CODES.includes(place)) return { error: "Choose a country." };
  issue.fixes = issue.fixes || {};
  if (!verdict) delete issue.fixes[place];
  else {
    if (!VERDICTS.includes(verdict)) return { error: "Choose a verdict." };
    issue.fixes[place] = { verdict, note: String(note || "").replace(/\s+/g, " ").trim().slice(0, 400), by: by === "admin" ? "admin" : "lawyer", at: now.toISOString() };
    await bumpDay("fixes", 1, now);
  }
  issue.updated = now.toISOString();
  await putJSON(`issue/${issue.id}`, issue);
  return { ok: true, issue: summary(issue) };
}

/* ------------------------------------------------------------------ analytics (admin) */
export function summary(issue) {
  const fb = { ...emptyFb(), ...(issue.fb || {}) };
  const places = {};
  for (const code of PLACE_CODES) {
    const counts = (issue.places || {})[code];
    const pair = fb.places[code] || [0, 0];
    if (!counts && !pair[0] && !pair[1] && !(issue.fixes || {})[code]) continue;
    places[code] = {
      said: majority(counts), counts: counts || {}, right: pair[0], wrong: pair[1],
      wrongRate: Math.round(wrongRate(pair) * 100) / 100,
      disputed: disputed(pair), unstable: unstable(counts), fix: (issue.fixes || {})[code] || null,
    };
  }
  const flagged = Object.values(places).filter((p) => p.disputed || p.unstable).length;
  const attention = flagged * 2 + Math.max(0, fb.down - fb.up) / Math.max(1, fb.up + fb.down) + (fb.down >= 3 ? 1 : 0);
  return { id: issue.id, q: issue.q, n: issue.n, up: fb.up, down: fb.down, rev: fb.rev, plain: fb.plain, places, attention: Math.round(attention * 100) / 100, updated: issue.updated };
}

export async function insights(now = new Date()) {
  const s = await store();
  const { blobs } = await s.list({ prefix: "issue/" });
  const issues = [];
  for (let i = 0; i < blobs.length; i += 50) {
    const part = await Promise.all(blobs.slice(i, i + 50).map((b) => s.get(b.key, { type: "json" })));
    issues.push(...part.filter(Boolean).map(summary));
  }
  const byPlace = {};
  for (const code of PLACE_CODES) byPlace[code] = { right: 0, wrong: 0, fixes: 0, disputed: 0, unstable: 0 };
  let up = 0, down = 0, answers = 0; const rev = [0, 0], plain = [0, 0];
  for (const it of issues) {
    up += it.up; down += it.down; answers += it.n || 0;
    rev[0] += it.rev[0]; rev[1] += it.rev[1]; plain[0] += it.plain[0]; plain[1] += it.plain[1];
    for (const [code, p] of Object.entries(it.places)) {
      const b = byPlace[code]; if (!b) continue;
      b.right += p.right; b.wrong += p.wrong; if (p.fix) b.fixes++; if (p.disputed) b.disputed++; if (p.unstable) b.unstable++;
    }
  }
  const days = [];
  for (let d = 29; d >= 0; d--) {
    const day = today(new Date(now - d * 86400e3));
    days.push({ day, ...((await getJSON(`day/${day}`)) || { answers: 0, revised: 0, matched: 0, up: 0, down: 0, fixes: 0 }) });
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    issues: issues.length, answers, up: r2(up), down: r2(down),
    rightRate: up + down ? r2(up / (up + down)) : null,
    revisedRightRate: rev[0] + rev[1] ? r2(rev[0] / (rev[0] + rev[1])) : null,
    plainRightRate: plain[0] + plain[1] ? r2(plain[0] / (plain[0] + plain[1])) : null,
    byPlace, days,
    attention: issues.filter((i) => i.attention > 0).sort((a, b) => b.attention - a.attention).slice(0, 40),
    recent: issues.sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 25),
  };
}

async function cleanup(now) {
  const s = await store();
  const keep = new Set([today(now), today(new Date(now - 86400000))]);
  for (const prefix of ["rl/", "salt/"]) {
    const { blobs } = await s.list({ prefix });
    for (const b of blobs) if (!keep.has(b.key.split("/")[1])) await s.delete(b.key);
  }
  const oldest = today(new Date(now - 180 * 86400000));
  const { blobs } = await s.list({ prefix: "day/" });
  for (const b of blobs) if (b.key.slice(4) < oldest) await s.delete(b.key);
}
