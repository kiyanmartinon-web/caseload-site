// POST /api/checkout  { price: "price_…", lang: "en" | "it" }  →  { url }
// Opens a Stripe Checkout page for a subscription. Which payment methods appear
// (cards, Apple Pay, Google Pay, PayPal, SEPA, Satispay…) is decided by what you
// switch on in Stripe → Settings → Payment methods; nothing to change here.
import { isConfigured, stripe, json, siteOrigin, failure } from "../lib/stripe.mjs";
import { buildSessionParams } from "../lib/plans.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isConfigured()) return json({ error: "Subscriptions are not open yet." }, 503);

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
    const session = await stripe(
      "POST",
      "checkout/sessions",
      buildSessionParams(price, siteOrigin(req), body.lang === "it" ? "it" : "en")
    );
    return json({ url: session.url });
  } catch (err) {
    return failure(err);
  }
};

export const config = { path: "/api/checkout" };
