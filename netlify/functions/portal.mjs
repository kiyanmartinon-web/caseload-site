// POST /api/portal  { session_id: "cs_…" }  →  { url }
// Straight after checkout, sends the subscriber to Stripe's customer portal
// (change card, switch plan, download invoices, cancel). Later visits use the
// STRIPE_PORTAL_LOGIN_URL link instead, where Stripe emails them a login code.
import { isConfigured, stripe, json, siteOrigin, portalLoginUrl, failure } from "../lib/stripe.mjs";
import { currentUser, sameOrigin } from "../lib/auth.mjs";
import { normLang, stripeLocale } from "../lib/plans.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isConfigured()) return json({ error: "Subscriptions are not open yet." }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  if (!sameOrigin(req)) return json({ error: "Request blocked." }, 403);
  const id = body && body.session_id;
  const user = await currentUser(req);

  try {
    let customer = user && user.stripeCustomer;
    if (!customer) {
      if (typeof id !== "string" || !/^cs_(test|live)_[A-Za-z0-9_]{1,300}$/.test(id)) {
        return json({ error: user ? "No subscription found on this account." : "Please sign in." }, user ? 404 : 401);
      }
      const s = await stripe("GET", `checkout/sessions/${id}`);
      if (s.status !== "complete" || !s.customer) return json({ error: "Checkout not completed." }, 400);
      customer = typeof s.customer === "string" ? s.customer : s.customer.id;
    }
    const lang = normLang(body.lang);
    const portal = await stripe("POST", "billing_portal/sessions", {
      customer,
      return_url: `${siteOrigin(req)}/account.html${lang === "en" ? "" : "?lang=" + lang}`,
      locale: stripeLocale(lang),
    });
    return json({ url: portal.url });
  } catch (err) {
    const fallback = portalLoginUrl();
    if (fallback) {
      console.error("[stripe] portal session failed, using login link", err && err.message);
      return json({ url: fallback });
    }
    return failure(err, "The billing portal is not available right now. Email admin@case-bound.com and we'll help.");
  }
};

export const config = { path: "/api/portal" };
