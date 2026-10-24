// /api/can-i/:action — how "Can I…?" answers get more accurate.
//   POST /api/can-i/rate  { token, vote: 1|-1, wrong: ["IT", …] }   anyone; the token came with the answer
//   POST /api/can-i/fix   { token | issueId, place, verdict, note }  verified lawyers and the admin; verdict "" removes
//   GET  /api/can-i/issue?id=…                                      admin: one issue's learning record
import { currentUser, sameOrigin, isAdmin, isVerifiedLawyer } from "../lib/auth.mjs";
import { json } from "../lib/stripe.mjs";
import { rate, fix, getIssue, summary } from "../lib/canlearn.mjs";

const bad = (error, status = 400) => json({ error }, status);

export default async (req, context) => {
  try {
    const action = (context && context.params && context.params.action) || new URL(req.url).pathname.split("/").pop();
    const user = await currentUser(req).catch(() => null);
    const expert = !!user && (isAdmin(user) || isVerifiedLawyer(user));

    if (req.method === "GET" && action === "issue") {
      if (!user || !isAdmin(user)) return bad("Not allowed.", 403);
      const issue = await getIssue(new URL(req.url).searchParams.get("id"));
      return issue ? json({ issue: summary(issue) }) : bad("Issue not found.", 404);
    }
    if (req.method !== "POST") return bad("Method not allowed", 405);
    if (!sameOrigin(req)) return bad("Request blocked.", 403);
    if (Number(req.headers.get("content-length") || 0) > 4000) return bad("Too large", 413);
    let b;
    try { b = await req.json(); } catch { return bad("Invalid request."); }
    if (!b) return bad("Invalid request.");

    if (action === "rate") {
      // Verified lawyers' ratings count three times as much as a visitor's.
      const r = await rate({ token: b.token, vote: b.vote, wrong: b.wrong, weight: expert ? 3 : 1, ip: context && context.ip });
      if (r.error) return bad(r.error, r.error === "limit" ? 429 : 400);
      return json(r, 200, { "Cache-Control": "no-store" });
    }
    if (action === "fix") {
      if (!expert) return bad("Only verified lawyers can correct answers.", 403);
      if (b.issueId && !isAdmin(user)) return bad("Not allowed.", 403);
      const r = await fix({ issueId: b.issueId, token: b.token, place: b.place, verdict: b.verdict || "", note: b.note, by: isAdmin(user) ? "admin" : "lawyer" });
      if (r.error) return bad(r.error);
      return json(r, 200, { "Cache-Control": "no-store" });
    }
    return bad("Not found", 404);
  } catch (err) {
    console.error("[can-i learn]", err && err.message);
    return bad("failed", 502);
  }
};

export const config = { path: "/api/can-i/:action" };
