// POST /api/checkout  { price: "price_…", lang: "en" | "it" }  →  { url }
// Opens a Stripe Checkout page for a subscription. Which payment methods appear
// (cards, Apple Pay, Google Pay, PayPal, SEPA, Satispay…) is decided by what you
// switch on in Stripe → Settings → Payment methods; nothing to change here.
import { isConfigured, stripe, json, siteOrigin, failure } from "../lib/stripe.mjs";
import { buildSessionParams } from "../lib/plans.mjs";
import { currentUser, sameOrigin } from "../lib/auth.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isConfigured()) return json({ error: "Subscriptions are not open yet." }, 503);

  if (!sameOrigin(req)) return json({ error: "Request blocked." }, 403);
  // Subscriptions belong to an account, so the buyer must be signed in.
  const user = await currentUser(req);
  if (!user) return json({ error: "Please sign in or create an account first.", needLogin: true }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const priceId = body && body.price;
  if (typeof priceId !== "string" || !/^price_[A-Za-z0-9_]{1,200}$/.test(priceId)) {
    return json({ error: "Unknown plan." }, 400);
  }

  try {
    // Only allow prices that are really on sale — never trust the browser.
    let price;
    try {
      price = await stripe("GET", `prices/${priceId}`, { expand: ["product"] });
    } catch (e) {
      if (e.status === 404) return json({ error: "Unknown plan." }, 400);
      throw e;
    }
    const prod = price.product || {};
    if (!price.active || price.type !== "recurring" || !prod.active || (prod.metadata || {}).hidden === "true") {
      return json({ error: "This plan is no longer available." }, 400);
    }
    if (user.stripeCustomer) {
      // A failed look-up (e.g. a restricted key without Subscriptions read) must not block checkout.
      let existing = { data: [] };
      try {
        existing = await stripe("GET", "subscriptions", { customer: user.stripeCustomer, status: "all", limit: 10 });
      } catch (e) {
        console.error("[stripe] subscription look-up failed", e && e.message);
      }
      if (existing.data.some((s) => ["active", "trialing", "past_due", "unpaid"].includes(s.status))) {
        return json({ error: "You already have a subscription. Change plan from your account page.", hasSubscription: true }, 409);
      }
    }
    const params = buildSessionParams(price, siteOrigin(req), body.lang === "it" ? "it" : "en");
    params.client_reference_id = user.id;
    if (user.stripeCustomer) {
      params.customer = user.stripeCustomer;
      // Stripe requires this when collecting address / tax ID for an existing customer.
      params.customer_update = { name: "auto", address: "auto" };
    } else {
      params.customer_email = user.email;
    }
    const session = await stripe("POST", "checkout/sessions", params);
    return json({ url: session.url });
  } catch (err) {
    // Show Stripe's own reason so a configuration problem can be spotted and fixed.
    return failure(err, `Payments are temporarily unavailable (Stripe: ${err && err.message ? err.message : "unknown error"}).`);
  }
};

export const config = { path: "/api/checkout" };
