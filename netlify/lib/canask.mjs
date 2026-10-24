// "Can I…?" — quick yes / no answers to everyday legal questions, with where it is
// allowed, where it isn't, and the conditions attached.
//
// The answer is written by Anthropic's Claude model (Netlify env ANTHROPIC_API_KEY).
// Optional env: CANI_MODEL (default below), CANI_DAILY_CAP (all users together,
// protects the API bill; default 400).
//
// What is stored (Netlify Blobs, store "canask"):
//   n/<day>/<who>   number of questions asked that day (<who> = account id, or a
//                   SHA-256 of the IP address with a salt that exists for one day only)
//   salt/<day>      that day's random salt
//   total/<day>     questions asked by everyone that day
// The question text and the answer are never stored by Casebound.
import crypto from "node:crypto";

let override = null;
export function _setTestStore(s) { override = s; }
async function store() {
  if (override) return override;
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name: "canask", consistency: "strong" });
}

export const LIMITS = { free: 5, pro: 5 };
export const MAX_QUESTION = 600;
export const DEFAULT_MODEL = "claude-sonnet-5-5";

// Places every answer covers (Casebound's languages), in this order.
export const PLACES = [
  ["IT", "Italy"], ["ES", "Spain"], ["FR", "France"], ["DE", "Germany"],
  ["PT", "Portugal"], ["PL", "Poland"], ["GB", "United Kingdom"], ["US", "United States"],
];
const PLACE_CODES = PLACES.map((p) => p[0]);
const LANG_NAMES = { en: "English", it: "Italian", es: "Spanish", fr: "French", de: "German", pt: "Portuguese (European)", pl: "Polish", ar: "Arabic (Modern Standard)" };

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

async function salt(s, day) {
  const k = `salt/${day}`;
  let v = await s.get(k, { type: "text" });
  if (!v) { v = crypto.randomBytes(16).toString("hex"); await s.set(k, v); }
  return v;
}

export async function whoKey(user, ip, day = today()) {
  if (user) return `u-${user.id}`;
  const s = await store();
  const h = crypto.createHash("sha256").update(`${await salt(s, day)}|${ip || "?"}`).digest("hex").slice(0, 32);
  return `ip-${h}`;
}

export async function usage(who, day = today()) {
  const s = await store();
  const n = Number(await s.get(`n/${day}/${who}`, { type: "text" })) || 0;
  const total = Number(await s.get(`total/${day}`, { type: "text" })) || 0;
  return { n, total };
}

export async function count(who, day = today()) {
  const s = await store();
  const { n, total } = await usage(who, day);
  await s.set(`n/${day}/${who}`, String(n + 1));
  await s.set(`total/${day}`, String(total + 1));
  // Tidy up the day before yesterday.
  const old = today(new Date(Date.parse(day) - 2 * 86400e3));
  try {
    const { blobs } = await s.list({ prefix: `n/${old}/` });
    await Promise.all(blobs.map((b) => s.delete(b.key)));
    await s.delete(`salt/${old}`);
    await s.delete(`total/${old}`);
  } catch { /* best effort */ }
  return n + 1;
}

export function cleanQuestion(q) {
  const t = String(q || "").replace(/\s+/g, " ").trim();
  if (t.length < 6) return { error: "short" };
  if (t.length > MAX_QUESTION) return { error: "long" };
  return { text: t };
}

const SYSTEM = `You are the "Can I…?" checker on Casebound, a legal research site. People ask everyday questions about whether something is legal or allowed ("Can I record a phone call?", "Can I sublet my flat?", "Can I drive in Europe with my US licence?").

Answer with the give_answer tool. Rules:
- Lead with a committed verdict: "yes", "no", "depends" (allowed only under conditions, or the answer splits by place) or "unclear" (the question is too vague to answer — then put one clarifying question in ask_back and still give what you can).
- Judge the verdict for the person's own country first (given below), then cover every place in the places list: Italy, Spain, France, Germany, Portugal, Poland, United Kingdom, United States — in that order — with a per-place verdict and one or two concrete sentences (name the rule, the age, the limit, the permit, the fine where you know it). For the US, say where states differ and name examples. Add up to 3 further places only if the question is about them.
- conditions: the stipulations that attach to doing it lawfully (permits, ages, consent, notice periods, limits, deadlines). Concrete, one per line.
- if_not: what can happen if someone does it where it isn't allowed (fines, nullity, eviction, criminal offence…), with figures where you know them.
- laws: the main statutes or articles the answer rests on (e.g. "Codice civile art. 1594", "GDPR art. 6"), only ones you are confident exist.
- next_steps: practical steps (where to apply, who to ask, what to keep in writing).
- Write plainly for a non-lawyer, in the requested language. Keep every item short. No hedging boilerplate: the page already says this is general information, not legal advice.
- If rules changed recently or you are unsure about a place, set that place's verdict to "unclear" rather than guessing, and say what to check.
- If the question asks how to harm someone, evade the police, or commit a crime, answer the legal question (usually "no") and the consequences, but give no practical help with the harmful act.
- research_query: a short neutral description of the legal issue (max 25 words, in English) for Casebound's research tool.`;

const TOOL = {
  name: "give_answer",
  description: "Return the structured answer to the user's 'Can I…?' question.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["yes", "no", "depends", "unclear"] },
      headline: { type: "string", description: "One sentence, starting with Yes / No / It depends (in the answer language)." },
      explanation: { type: "string", description: "2–4 plain sentences." },
      places: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: "string", description: "ISO 3166-1 alpha-2, e.g. IT, or a US state like US-CA" },
            name: { type: "string", description: "Place name in the answer language" },
            verdict: { type: "string", enum: ["yes", "no", "depends", "unclear"] },
            note: { type: "string" },
          },
          required: ["code", "name", "verdict", "note"],
        },
      },
      conditions: { type: "array", items: { type: "string" } },
      if_not: { type: "array", items: { type: "string" } },
      laws: { type: "array", items: { type: "string" } },
      next_steps: { type: "array", items: { type: "string" } },
      ask_back: { type: "string", description: "A clarifying question, or empty." },
      research_query: { type: "string" },
    },
    required: ["verdict", "headline", "explanation", "places", "conditions", "if_not", "laws", "next_steps", "ask_back", "research_query"],
  },
};

const V = ["yes", "no", "depends", "unclear"];
const str = (v, max = 600) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const list = (a, n = 8, max = 300) => (Array.isArray(a) ? a.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

/** Pure: validate the model's tool input into what the page shows. */
export function shapeAnswer(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const places = (Array.isArray(r.places) ? r.places : [])
    .map((p) => ({ code: str(p && p.code, 8).toUpperCase(), name: str(p && p.name, 60), verdict: V.includes(p && p.verdict) ? p.verdict : "unclear", note: str(p && p.note, 400) }))
    .filter((p) => p.code && p.name)
    .slice(0, 11);
  // Main places first, in the fixed order; any extras after.
  places.sort((a, b) => {
    const ia = PLACE_CODES.indexOf(a.code), ib = PLACE_CODES.indexOf(b.code);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return {
    verdict: V.includes(r.verdict) ? r.verdict : "unclear",
    headline: str(r.headline, 300),
    explanation: str(r.explanation, 1200),
    places,
    conditions: list(r.conditions),
    ifNot: list(r.if_not, 6),
    laws: list(r.laws, 8, 160),
    nextSteps: list(r.next_steps, 6),
    askBack: str(r.ask_back, 300),
    researchQuery: str(r.research_query, 200),
  };
}

export function isConfigured() { return !!process.env.ANTHROPIC_API_KEY; }

export async function ask({ question, lang, home }) {
  const homeName = (PLACES.find((p) => p[0] === home) || [null, home || "not given"])[1];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CANI_MODEL || DEFAULT_MODEL,
      max_tokens: 2500,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "give_answer" },
      messages: [{
        role: "user",
        content: `Answer language: ${LANG_NAMES[lang] || "English"}\nThe person is in: ${homeName}\nToday's date: ${today()}\n\nQuestion: ${question}`,
      }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const err = new Error(`anthropic ${res.status}: ${t.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const block = (data.content || []).find((c) => c.type === "tool_use");
  if (!block) throw new Error("no tool_use block");
  return shapeAnswer(block.input);
}
