// "Connect with a lawyer" — cases sent by Pro clients to verified lawyers.
//
// Clients (signed in, Pro):
//   GET  /api/cases/mine                         → {cases:[…]} own cases + interested lawyers
//   POST /api/cases/submit   {area,areaOther,title,facts,date,amount,evidence,party,city,goal,consent:true}
//   POST /api/cases/share    {id, lawyerId}      share my name + email with that lawyer
//   POST /api/cases/addinfo  {id, text}          add details after a lawyer asked for more
//   POST /api/cases/withdraw {id}                delete the case for everyone
// Lawyers (verified only):
//   GET  /api/cases/board                        → {cases:[…]} open cases, client identity hidden
//   POST /api/cases/review   {id, strength, quality, decision, note}
//        decision: "interested" | "info" | "passed"
// Admin (ADMIN_EMAILS):
//   GET  /api/cases/lawyers                      → {lawyers:[…]} every lawyer profile
//   POST /api/cases/verify   {userId, status}    status: "verified" | "rejected" | "pending"
import { currentUser, sameOrigin, isAdmin, isVerifiedLawyer, getUser, saveUser } from "../lib/auth.mjs";
import { json } from "../lib/stripe.mjs";
import { subscriptionFor, tierOf } from "../lib/subscription.mjs";
import { getCase, saveCase, deleteCase, allCases, cleanCase, newCase, forClient, forLawyer } from "../lib/matches.mjs";
import { store as accountsStore } from "../lib/store.mjs";

const ok = (b) => json(b, 200);
const bad = (msg, status = 400) => json({ error: msg }, status);
const MAX_OPEN_PER_CLIENT = 5;

async function body(req) { try { return await req.json(); } catch { return null; } }

export default async (req, context) => {
  const action = (context && context.params && context.params.action) || new URL(req.url).pathname.split("/").pop();
  const user = await currentUser(req);
  if (!user) return bad("Please sign in.", 401);

  if (req.method === "GET") {
    if (action === "mine") {
      const mine = (await allCases()).filter((c) => c.clientId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return ok({ cases: await Promise.all(mine.map(forClient)) });
    }
    if (action === "board") {
      if (!isVerifiedLawyer(user) && !isAdmin(user)) return bad("Only verified lawyers can see cases.", 403);
      const open = (await allCases()).filter((c) => c.status === "open");
      return ok({ cases: await Promise.all(open.map((c) => forLawyer(c, user.id))) });
    }
    if (action === "lawyers") {
      if (!isAdmin(user)) return bad("Not allowed.", 403);
      const s = await accountsStore();
      const { blobs } = await s.list({ prefix: "user/" });
      const users = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
      const lawyers = users.filter((u) => u && u.role === "lawyer" && u.lawyer)
        .map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, ...u.lawyer }))
        .sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || String(b.submittedAt).localeCompare(String(a.submittedAt)));
      return ok({ lawyers });
    }
    return bad("Not found", 404);
  }

  if (req.method !== "POST") return bad("Method not allowed", 405);
  if (!sameOrigin(req)) return bad("Request blocked.", 403);
  const b = await body(req);
  if (!b) return bad("Invalid request.");

  if (action === "submit") {
    if (user.role === "lawyer") return bad("Switch your profile to client to send a case.", 403);
    const tier = tierOf(user, await subscriptionFor(user));
    if (tier !== "pro") return bad("Connecting with a lawyer is part of Casebound Pro.", 402);
    const mineOpen = (await allCases()).filter((c) => c.clientId === user.id && c.status === "open").length;
    if (mineOpen >= MAX_OPEN_PER_CLIENT) return bad(`You can have up to ${MAX_OPEN_PER_CLIENT} open cases. Withdraw one first.`, 409);
    const r = cleanCase(b);
    if (r.error) return bad(r.error);
    const c = newCase(user.id, r.data);
    await saveCase(c);
    return ok({ case: await forClient(c) });
  }

  if (action === "verify") {
    if (!isAdmin(user)) return bad("Not allowed.", 403);
    if (!["verified", "rejected", "pending"].includes(b.status)) return bad("Unknown status.");
    const u = await getUser(String(b.userId || ""));
    if (!u || u.role !== "lawyer" || !u.lawyer) return bad("Lawyer not found.", 404);
    u.lawyer.status = b.status;
    u.lawyer.verifiedAt = b.status === "verified" ? new Date().toISOString() : null;
    await saveUser(u);
    return ok({ ok: true });
  }

  const c = await getCase(b.id);
  if (!c) return bad("Case not found.", 404);

  if (["share", "addinfo", "withdraw"].includes(action)) {
    if (c.clientId !== user.id) return bad("Case not found.", 404);
    if (action === "withdraw") { await deleteCase(c.id); return ok({ ok: true }); }
    if (action === "share") {
      const r = c.reviews && c.reviews[String(b.lawyerId || "")];
      if (!r || (r.decision !== "interested" && r.decision !== "info")) return bad("That lawyer hasn't asked to connect.", 409);
      r.sharedAt = new Date().toISOString();
    }
    if (action === "addinfo") {
      const text = String(b.text || "").trim().slice(0, 2000);
      if (text.length < 5) return bad("Write the extra details first.");
      c.updates = (c.updates || []).concat([{ at: new Date().toISOString(), text }]).slice(-20);
    }
    c.updatedAt = new Date().toISOString();
    await saveCase(c);
    return ok({ case: await forClient(c) });
  }

  if (action === "review") {
    if (!isVerifiedLawyer(user)) return bad("Only verified lawyers can review cases.", 403);
    if (c.status !== "open") return bad("This case is closed.", 409);
    const n = (v) => { const x = Math.round(Number(v)); return x >= 1 && x <= 5 ? x : null; };
    const prev = (c.reviews || {})[user.id] || {};
    const decision = ["interested", "info", "passed"].includes(b.decision) ? b.decision : prev.decision || null;
    c.reviews = c.reviews || {};
    c.reviews[user.id] = {
      strength: b.strength !== undefined ? n(b.strength) : prev.strength ?? null,
      quality: b.quality !== undefined ? n(b.quality) : prev.quality ?? null,
      decision,
      note: b.note !== undefined ? String(b.note || "").trim().slice(0, 500) : prev.note || "",
      at: new Date().toISOString(),
      sharedAt: prev.sharedAt || null,
    };
    await saveCase(c);
    return ok({ case: await forLawyer(c, user.id) });
  }

  return bad("Not found", 404);
};

export const config = { path: "/api/cases/:action" };
