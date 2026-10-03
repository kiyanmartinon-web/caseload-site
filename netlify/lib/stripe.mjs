// Tiny Stripe client for Netlify Functions — no npm dependencies, no build step.
// Configuration lives in Netlify → Project configuration → Environment variables:
//   STRIPE_SECRET_KEY        required  sk_… or rk_… (test or live). Without it the
//                                      pricing page shows "opening soon" and nothing breaks.
//   STRIPE_PORTAL_LOGIN_URL  optional  Stripe's no-code customer-portal login link, so
//                                      subscribers can manage/cancel at any time.
//   STRIPE_AUTOMATIC_TAX     optional  "true" once Stripe Tax is set up (adds VAT at checkout).
//   SITE_URL                 optional  e.g. https://case-bound.com (defaults to the request origin).

const API = "https://api.stripe.com/v1/";

export function secretKey() {
  return (process.env.STRIPE_SECRET_KEY || "").trim();
}

export function isConfigured() {
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey());
}

export function isTestMode() {
  return /^(sk|rk)_test_/.test(secretKey());
}

// Stripe expects application/x-www-form-urlencoded with bracketed nesting.
export function encodeForm(params, prefix = "", out = []) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") encodeForm(item, `${name}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${name}[]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      encodeForm(v, name, out);
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out.join("&");
}

export class StripeError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function stripe(method, path, params) {
  const body = params ? encodeForm(params) : "";
  let url = API + path;
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Stripe-Version": "2024-06-20",
    },
  };
  if (method === "GET") {
    if (body) url += (url.includes("?") ? "&" : "?") + body;
  } else {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = body;
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data && data.error ? data.error : {};
    throw new StripeError(e.message || `Stripe request failed (${res.status})`, res.status, e.code || e.type);
  }
  return data;
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function siteOrigin(req) {
  const fromEnv = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^/]+$/.test(fromEnv)) return fromEnv;
  return new URL(req.url).origin;
}

export function portalLoginUrl() {
  const u = (process.env.STRIPE_PORTAL_LOGIN_URL || "").trim();
  return /^https:\/\/billing\.stripe\.com\//.test(u) ? u : "";
}

// Log the detail server-side, give the browser a safe message.
export function failure(err, publicMessage = "Payments are temporarily unavailable. Please try again shortly.") {
  console.error("[stripe]", err && err.message, err && err.code);
  return json({ error: publicMessage }, 502);
}
