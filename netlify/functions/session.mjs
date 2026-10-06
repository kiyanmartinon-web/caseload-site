// GET /api/session?id=cs_…  — confirms a finished checkout for the thank-you page.
// The checkout-session id is a long unguessable token that only the buyer receives.
import { isConfigured, stripe, json, failure } from "../lib/stripe.mjs";
import { currentUser, getUser, saveUser } from "../lib/auth.mjs";
import { rememberCheckout } from "../lib/subcache.mjs";

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!isConfigured()) return json({ error: "Subscriptions are not open yet." }, 503);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9_]{1,300}$/.test(id)) return json({ error: "Invalid session." }, 400);

  try {
    let s;
    try {
      s = await stripe("GET", `checkout/sessions/${id}`, { expand: ["line_items", "subscription"] });
    } catch (e) {
      if (e.status === 404) return json({ error: "Session not found." }, 404);
      if (e.status !== 403 && e.status !== 401) throw e;
      // Key can't read subscriptions: fetch the session without that part.
      s = await stripe("GET", `checkout/sessions/${id}`, { expand: ["line_items"] });
    }
    // Remember the Stripe customer on the account that started this checkout.
    if (s.status === "complete" && s.customer && s.client_reference_id) {
      const viewer = await currentUser(req);
      const owner = viewer && viewer.id === s.client_reference_id ? viewer : await getUser(s.client_reference_id);
      const cust = typeof s.customer === "string" ? s.customer : s.customer.id;
      if (owner && (owner.stripeCustomer !== cust || !owner.subCache || owner.subCache.checkoutSession !== s.id)) {
        owner.stripeCustomer = cust;
        await rememberCheckout(owner, s.id);
        await saveUser(owner);
      }
    }
    const item = s.line_items && s.line_items.data && s.line_items.data[0];
    const sub = s.subscription && typeof s.subscription === "object" ? s.subscription : null;
    return json({
      status: s.status, // "complete" | "open" | "expired"
      paymentStatus: s.payment_status, // "paid" | "unpaid" | "no_payment_required" (trial)
      email: (s.customer_details && s.customer_details.email) || "",
      plan: item ? item.description : "",
      subscriptionStatus: sub ? sub.status : "",
      trialEnd: sub && sub.trial_end ? sub.trial_end : null,
    });
  } catch (err) {
    return failure(err);
  }
};

export const config = { path: "/api/session" };
