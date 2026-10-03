// /api/auth/register  POST {email, password, name, acceptTerms, adult, lang}
// /api/auth/login     POST {email, password}
// /api/auth/logout    POST
// /api/auth/me        GET   → {user, subscription} or {user:null}
// /api/auth/delete    POST {password}
import {
  normEmail, validEmail, passwordProblem, findUserByEmail, createUser, verifyPassword,
  isLocked, recordFailure, recordSuccess, createSession, sessionCookie, currentUser,
  endSession, sameOrigin, publicUser, deleteUser,
} from "../lib/auth.mjs";
import { json, isConfigured, stripe } from "../lib/stripe.mjs";

const ok = (body, cookie) => json(body, 200, cookie ? { "Set-Cookie": cookie } : {});
const bad = (msg, status = 400) => json({ error: msg }, status);

async function body(req) {
  try { return await req.json(); } catch { return null; }
}

async function subscriptionFor(user) {
  if (!user.stripeCustomer || !isConfigured()) return null;
  try {
    const res = await stripe("GET", "subscriptions", {
      customer: user.stripeCustomer, status: "all", limit: 10, expand: ["data.items.data.price.product"],
    });
    const rank = { active: 0, trialing: 1, past_due: 2, unpaid: 3, incomplete: 4 };
    const live = res.data.filter((s) => s.status in rank).sort((a, b) => rank[a.status] - rank[b.status]);
    const s = live[0];
    if (!s) return { status: "none" };
    const item = s.items && s.items.data && s.items.data[0];
    const price = item && item.price;
    const product = price && typeof price.product === "object" ? price.product : null;
    return {
      status: s.status,
      plan: product ? product.name : "",
      plan_it: product && product.metadata ? product.metadata.name_it || "" : "",
      amount: price ? price.unit_amount : null,
      currency: price ? price.currency : "",
      interval: price && price.recurring ? price.recurring.interval : "",
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
      currentPeriodEnd: s.current_period_end || (item && item.current_period_end) || null,
      trialEnd: s.trial_end || null,
    };
  } catch (e) {
    console.error("[auth] subscription lookup failed", e && e.message);
    return { status: "unknown" };
  }
}

export default async (req, context) => {
  const action = (context && context.params && context.params.action) || new URL(req.url).pathname.split("/").pop();

  if (action === "me") {
    if (req.method !== "GET") return bad("Method not allowed", 405);
    const user = await currentUser(req);
    if (!user) return ok({ user: null });
    return ok({ user: publicUser(user), subscription: await subscriptionFor(user) });
  }

  if (req.method !== "POST") return bad("Method not allowed", 405);
  if (!sameOrigin(req)) return bad("Request blocked.", 403);

  if (action === "logout") {
    await endSession(req);
    return ok({ ok: true }, sessionCookie(req, ""));
  }

  const b = await body(req);
  if (!b) return bad("Invalid request.");

  if (action === "register") {
    const email = normEmail(b.email);
    if (!validEmail(email)) return bad("Enter a valid email address.");
    const pw = passwordProblem(b.password);
    if (pw) return bad(pw);
    if (b.acceptTerms !== true) return bad("Please accept the Terms of use.");
    if (b.adult !== true) return bad("You must be at least 18 to create an account.");
    if (await findUserByEmail(email)) return bad("An account with this email already exists. Sign in instead.", 409);
    const user = await createUser({ email, password: b.password, name: b.name, lang: b.lang });
    const s = await createSession(user.id);
    return ok({ user: publicUser(user) }, sessionCookie(req, s.token, s.exp));
  }

  if (action === "login") {
    const email = normEmail(b.email);
    const generic = "Wrong email or password.";
    if (!validEmail(email) || typeof b.password !== "string") return bad(generic, 401);
    const user = await findUserByEmail(email);
    if (!user) { await verifyPassword(b.password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"); return bad(generic, 401); }
    if (isLocked(user)) return bad("Too many attempts. Try again in 15 minutes.", 429);
    if (!(await verifyPassword(b.password, user.passwordHash))) { await recordFailure(user); return bad(generic, 401); }
    await recordSuccess(user);
    const s = await createSession(user.id);
    return ok({ user: publicUser(user) }, sessionCookie(req, s.token, s.exp));
  }

  if (action === "delete") {
    const user = await currentUser(req);
    if (!user) return bad("Please sign in again.", 401);
    if (!(await verifyPassword(String(b.password || ""), user.passwordHash))) return bad("Wrong password.", 401);
    const sub = await subscriptionFor(user);
    if (sub && ["active", "trialing", "past_due", "unpaid"].includes(sub.status) && !sub.cancelAtPeriodEnd) {
      return bad("Cancel your subscription first (Manage subscription), then delete the account.", 409);
    }
    await endSession(req);
    await deleteUser(user);
    return ok({ ok: true }, sessionCookie(req, ""));
  }

  return bad("Not found", 404);
};

export const config = { path: "/api/auth/:action" };
