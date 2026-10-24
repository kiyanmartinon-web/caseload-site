// /api/can-i — the "Can I…?" checker (free for everyone, with a daily limit).
//   GET  → { configured, tier, limit, used }
//   POST { question, lang, home }  → { answer, used, limit }
//        home: where the person is (IT, ES, FR, DE, PT, PL, GB, US or "")
import { currentUser, sameOrigin } from "../lib/auth.mjs";
import { json } from "../lib/stripe.mjs";
import { normLang } from "../lib/plans.mjs";
import { subscriptionFor, tierOf } from "../lib/subscription.mjs";
import { LIMITS, PLACES, whoKey, usage, count, cleanQuestion, isConfigured, ask } from "../lib/canask.mjs";
import { findIssue, notesFor, applyFixes, recordAnswer, trustFor, STRICT_MATCH } from "../lib/canlearn.mjs";
import { isAdmin, isVerifiedLawyer } from "../lib/auth.mjs";

const bad = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

async function who(req, context) {
  const user = await currentUser(req).catch(() => null);
  let tier = "free";
  if (user) {
    try { tier = tierOf(user, await subscriptionFor(user)); } catch { tier = "free"; }
  }
  const key = await whoKey(user, context && context.ip);
  return { user, tier, key, limit: LIMITS[tier] };
}

export default async (req, context) => {
  try {
    if (req.method === "GET") {
      const w = await who(req, context);
      const { n } = await usage(w.key);
      return json({ configured: isConfigured(), tier: w.tier, signedIn: !!w.user, limit: w.limit, used: n }, 200, { "Cache-Control": "no-store" });
    }
    if (req.method !== "POST") return bad("Method not allowed", 405);
    if (!sameOrigin(req)) return bad("Request blocked.", 403);
    if (!isConfigured()) return bad("not_configured", 503);
    if (Number(req.headers.get("content-length") || 0) > 4000) return bad("long", 413);

    let b;
    try { b = await req.json(); } catch { return bad("Invalid request."); }
    const q = cleanQuestion(b && b.question);
    if (q.error) return bad(q.error);
    const lang = normLang(b.lang);
    const home = PLACES.some((p) => p[0] === b.home) ? b.home : "";

    const w = await who(req, context);
    const { n, total } = await usage(w.key);
    if (n >= w.limit) return bad("limit", 429, { used: n, limit: w.limit, tier: w.tier });
    const cap = Number(process.env.CANI_DAILY_CAP) || 400;
    if (total >= cap) return bad("busy", 429, { used: n, limit: w.limit, tier: w.tier });

    let answer = await ask({ question: q.text, lang, home });
    const used = await count(w.key);

    // Learning loop: if this issue has lawyer corrections, disputed or unstable countries,
    // answer again with those notes, then make sure a lawyer's verdict wins.
    let learn = null;
    try {
      const match = await findIssue(answer.researchQuery);
      const notes = match ? notesFor(match.issue) : [];
      let revised = false;
      if (notes.length) {
        try { answer = await ask({ question: q.text, lang, home, notes }); revised = true; }
        catch (e) { console.error("[can-i] revise", e && e.message); }
      }
      if (match && match.score >= STRICT_MATCH) answer = applyFixes(answer, match.issue);
      const token = await recordAnswer(answer, match, { revised });
      const canFix = !!w.user && (isAdmin(w.user) || isVerifiedLawyer(w.user));
      learn = token ? { token, revised, canFix, ...trustFor(match && match.issue) } : null;
    } catch (e) { console.error("[can-i] learn", e && e.message); }

    return json({ answer, learn, used, limit: w.limit, tier: w.tier }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("[can-i]", err && err.message);
    return bad("failed", 502);
  }
};

export const config = { path: "/api/can-i" };
