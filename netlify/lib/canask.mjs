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

// Free: 5 questions a day. Pro: unlimited (null = no daily limit). A Pro account still
// has a silent fair-use ceiling (CANI_PRO_FAIR_USE, default 300 a day) so a leaked
// login or a script can't run up the API bill; no person asking by hand gets near it.
export const LIMITS = { free: 5, pro: null };
export const PRO_FAIR_USE = () => Number(process.env.CANI_PRO_FAIR_USE) || 300;
export const MAX_QUESTION = 2000;
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
  if (t.length < 3) return { error: "short" };
  if (t.length > MAX_QUESTION) return { error: "long" };
  return { text: t };
}

/** Pure: tidy the earlier exchange a follow-up refers to. */
export function cleanContext(c) {
  if (!c || typeof c !== "object") return null;
  const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
  const out = { question: clip(c.question, 700), understood: clip(c.understood, 300), headline: clip(c.headline, 300), askBack: clip(c.askBack, 300) };
  return out.question ? out : null;
}

const SYSTEM = `You are the "Can I…?" checker on Casebound, a legal research site. People ask everyday questions about whether something is legal or allowed ("Can I record a phone call?", "Can I sublet my flat?", "Can I drive in Europe with my US licence?").

Understanding the question comes first. People write the way they talk, so read generously:
- The box on the page starts with the words "Can I", so the text may just continue that ("sublet my flat?", "fire someone on maternity leave"), or be a full question of any shape ("is it legal to…", "am I allowed to…", "what happens if I…", "do I have to…", "can my landlord…", "can they make me…"), or a short story of what happened ending in a question, or no question at all ("my boss reads my work emails"). In every case work out what the person really wants to know and answer that.
- Fix typos, missing words, slang, abbreviations, voice-dictation errors and mixed languages silently. Understand questions written in any language, whatever the answer language.
- When the question is about what someone else may do to the person (landlord, employer, police, neighbour, ex-partner, school, airline, shop), the verdict is about whether THAT party is allowed, and conditions/if_not/next_steps tell the person what they can do about it.
- When the person describes a situation, pick out the legal question that matters most to them; put up to 3 other distinct questions they also asked or clearly need answered in also.
- If the question names a place (a city, region or country), that is where it applies: cover it first, even if it isn't in the places list, and judge the main verdict for it. Otherwise use where the person says they are.
- Use every detail they give (age, nationality, job, dates, amounts, who else is involved) to sharpen the answer, but never repeat names or identifying details back.
- understood: restate in one plain sentence, in the answer language, the question you are answering, as you understood it (start with "Can I…" / "Can my landlord…" etc. in that language), so the person can see you got it right.
- Only use verdict "unclear" with ask_back when the question genuinely can't be answered either way; when one missing fact would change the answer, still answer for the most likely case and put that fact in ask_back.

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
- research_query: a short neutral description of the legal issue (max 25 words, in English) for Casebound's research tool. Phrase it generically and canonically, so the same question asked in other words or languages gets the same description (e.g. "recording a phone call without the other party's consent"). Never include names, addresses, dates, amounts or any other detail about the person or anyone else.
- If the message includes "Notes from Casebound's review", they come from verified lawyers and from readers' ratings of earlier answers to this same question. Follow a lawyer's verdict for a place, and explain it in that place's note. Re-check anything flagged.`;

const TOOL = {
  name: "give_answer",
  description: "Return the structured answer to the user's 'Can I…?' question.",
  input_schema: {
    type: "object",
    properties: {
      understood: { type: "string", description: "The question as you understood it, one sentence in the answer language." },
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
      also: {
        type: "array",
        description: "Up to 3 other distinct questions the person asked or clearly needs answered, each with a short answer. Empty if none.",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question, one short sentence in the answer language." },
            verdict: { type: "string", enum: ["yes", "no", "depends", "unclear"] },
            answer: { type: "string", description: "One or two plain sentences." },
          },
          required: ["question", "verdict", "answer"],
        },
      },
      ask_back: { type: "string", description: "A clarifying question, or empty." },
      research_query: { type: "string" },
    },
    required: ["understood", "verdict", "headline", "explanation", "places", "conditions", "if_not", "laws", "next_steps", "ask_back", "research_query"],
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
    .slice(0, 12);
  // Extra places only appear when the question is about them, so they lead; then the fixed order.
  places.sort((a, b) => {
    const ia = PLACE_CODES.indexOf(a.code), ib = PLACE_CODES.indexOf(b.code);
    return (ia < 0 ? -1 : ia) - (ib < 0 ? -1 : ib);
  });
  const also = (Array.isArray(r.also) ? r.also : [])
    .map((x) => ({ question: str(x && x.question, 250), verdict: V.includes(x && x.verdict) ? x.verdict : "unclear", answer: str(x && x.answer, 500) }))
    .filter((x) => x.question && x.answer)
    .slice(0, 3);
  return {
    understood: str(r.understood, 300),
    verdict: V.includes(r.verdict) ? r.verdict : "unclear",
    headline: str(r.headline, 300),
    explanation: str(r.explanation, 1200),
    places,
    conditions: list(r.conditions),
    ifNot: list(r.if_not, 6),
    laws: list(r.laws, 8, 160),
    nextSteps: list(r.next_steps, 6),
    also,
    askBack: str(r.ask_back, 300),
    researchQuery: str(r.research_query, 200),
  };
}

// Where answers come from: ANTHROPIC_API_KEY (+ ANTHROPIC_BASE_URL when set). If no key is
// set in Netlify, Netlify's AI Gateway injects both automatically and bills Netlify credits.
const baseUrl = () => (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
export function isConfigured() { return !!process.env.ANTHROPIC_API_KEY; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One Messages API call with a time limit; retries once if the API is busy. */
async function callModel(body, { timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1000, deadline - Date.now()));
    let res;
    try {
      res = await fetch(`${baseUrl()}/v1/messages`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const err = new Error(e && e.name === "AbortError" ? "anthropic timeout" : `anthropic network: ${e && e.message}`);
      err.status = e && e.name === "AbortError" ? 504 : 502;
      throw err;
    } finally { clearTimeout(timer); }
    if (res.ok) return res.json();
    const t = await res.text().catch(() => "");
    const busy = res.status === 429 || res.status === 529 || res.status >= 500;
    if (busy && attempt === 0 && deadline - Date.now() > 20000) { await sleep(1500); continue; }
    const err = new Error(`anthropic ${res.status}: ${t.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
}

export async function ask({ question, lang, home, notes, context, timeoutMs }) {
  const homeName = (PLACES.find((p) => p[0] === home) || [null, home || "not given"])[1];
  const data = await callModel({
      model: process.env.CANI_MODEL || DEFAULT_MODEL,
      max_tokens: 3500,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "give_answer" },
      messages: [{
        role: "user",
        content: `Answer language: ${LANG_NAMES[lang] || "English"}\nThe person is in: ${homeName}\nToday's date: ${today()}\n\n` +
          (context
            ? `This is a follow-up. Earlier they asked: ${context.question}\n` +
              (context.understood ? `You understood it as: ${context.understood}\n` : "") +
              (context.headline ? `You answered: ${context.headline}\n` : "") +
              (context.askBack ? `You asked them: ${context.askBack}\n` : "") +
              `Now they add: ${question}\n\nAnswer the earlier question again with what they have now added (or their new question, if it is a different one), as one complete answer.`
            : `Question (what they typed after "Can I"): ${question}`) +
          (notes && notes.length ? `\n\nNotes from Casebound's review of earlier answers to this question:\n- ${notes.join("\n- ")}` : ""),
      }],
  }, { timeoutMs });
  const block = (data.content || []).find((c) => c.type === "tool_use");
  if (!block) {
    const err = new Error(`no tool_use block (stop_reason ${data.stop_reason})`);
    err.status = data.stop_reason === "refusal" ? 451 : 502;
    throw err;
  }
  return shapeAnswer(block.input);
}
