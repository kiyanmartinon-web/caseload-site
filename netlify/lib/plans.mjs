// Pure helpers shared by the functions (kept separate so they can be unit-tested).

// Site languages (keep in step with /i18n.js).
export const LANGS = ["en", "it", "es", "fr", "de", "pt", "pl", "ar"];
export function normLang(l) {
  const c = String(l || "").toLowerCase().slice(0, 2);
  return LANGS.includes(c) ? c : "en";
}
// Stripe Checkout / Customer portal have no Arabic; "auto" lets Stripe use the browser language.
export function stripeLocale(l) {
  const c = normLang(l);
  return c === "ar" ? "auto" : c;
}
const splitList = (v) => (v || "").split("|").map((s) => s.trim()).filter(Boolean);

export function toPlan(price) {
  const p = price.product || {};
  const m = p.metadata || {};
  // Per-price metadata (set on one price, e.g. the yearly one) wins over product metadata.
  const pm = price.metadata || {};
  const pick = (k) => (pm[k] !== undefined && pm[k] !== "" ? pm[k] : m[k]);
  const r = price.recurring || {};
  return {
    id: price.id,
    productId: p.id,
    name: p.name || "",
    description: p.description || "",
    features: (p.marketing_features || []).map((f) => f.name).filter(Boolean),
    name_it: m.name_it || "",
    description_it: m.description_it || "",
    features_it: splitList(m.features_it),
    // Translations from product metadata: name_<lang>, description_<lang>, features_<lang> (separated by |).
    tr: Object.fromEntries(LANGS.filter((c) => c !== "en").map((c) => [c, {
      name: m["name_" + c] || "",
      description: m["description_" + c] || "",
      features: splitList(m["features_" + c]),
    }])),
    amount: price.unit_amount,
    currency: price.currency,
    interval: r.interval,
    intervalCount: r.interval_count || 1,
    trialDays: parseInt(pick("trial_days"), 10) > 0 ? parseInt(pick("trial_days"), 10) : 0,
    highlight: pick("highlight") === "true",
    order: Number.isFinite(parseFloat(pick("order"))) ? parseFloat(pick("order")) : 1e6,
  };
}

export function selectPlans(prices) {
  return prices
    .filter((pr) => pr.active && pr.type === "recurring" && typeof pr.unit_amount === "number")
    .filter((pr) => pr.product && typeof pr.product === "object" && pr.product.active && !pr.product.deleted)
    .filter((pr) => (pr.product.metadata || {}).hidden !== "true" && (pr.metadata || {}).hidden !== "true")
    .map(toPlan)
    .sort((a, b) => a.order - b.order || a.amount - b.amount)
    .map(autoHighlightYearly);
}

// If no plan is marked as recommended in Stripe, recommend the first yearly plan
// (only when there is also a shorter plan to compare it with).
function autoHighlightYearly(plan, i, all) {
  if (all.some((p) => p.highlight) || all.length < 2) return plan;
  const firstYearly = all.find((p) => p.interval === "year");
  return plan === firstYearly ? { ...plan, highlight: true } : plan;
}

export function buildSessionParams(price, origin, lang) {
  const m = (price.product && price.product.metadata) || {};
  const pm = price.metadata || {};
  const trial = parseInt(pm.trial_days || m.trial_days, 10);
  const l = normLang(lang);
  const q = l === "en" ? "" : `&lang=${l}`;
  const params = {
    mode: "subscription",
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: `${origin}/account.html?session_id={CHECKOUT_SESSION_ID}${q}`,
    cancel_url: `${origin}/pricing.html?canceled=1${q}`,
    locale: stripeLocale(l),
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    // No custom_text: it is not allowed when Stripe Managed Payments is on (the account default).
    subscription_data: trial > 0 ? { trial_period_days: trial } : undefined,
  };
  if (process.env.STRIPE_AUTOMATIC_TAX === "true") {
    params.automatic_tax = { enabled: true };
  }
  return params;
}

