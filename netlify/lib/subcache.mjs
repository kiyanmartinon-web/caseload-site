// Keeps a small copy of what was bought (plan, price, renewal date) on the account,
// read from the completed Checkout Session. The account page can then show the
// subscription even if the Stripe key isn't allowed to read subscriptions.
import { stripe } from "./stripe.mjs";

export async function rememberCheckout(user, sessionId) {
  try {
    const s = await stripe("GET", `checkout/sessions/${sessionId}`, { expand: ["line_items.data.price.product"] });
    if (s.status !== "complete") return;
    const item = s.line_items && s.line_items.data && s.line_items.data[0];
    const price = item && item.price;
    const product = price && typeof price.product === "object" ? price.product : null;
    const interval = price && price.recurring ? price.recurring.interval : "";
    const count = (price && price.recurring && price.recurring.interval_count) || 1;
    const start = new Date((s.created || Date.now() / 1000) * 1000);
    const end = new Date(start);
    if (interval === "year") end.setUTCFullYear(end.getUTCFullYear() + count);
    else if (interval === "month") end.setUTCMonth(end.getUTCMonth() + count);
    else if (interval === "week") end.setUTCDate(end.getUTCDate() + 7 * count);
    else end.setUTCDate(end.getUTCDate() + count);
    user.subCache = {
      plan: product ? product.name : (item && item.description) || "",
      plan_it: product && product.metadata ? product.metadata.name_it || "" : "",
      amount: price ? price.unit_amount : item ? item.amount_total : null,
      currency: price ? price.currency : s.currency || "",
      interval,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: Math.floor(end.getTime() / 1000),
      trialEnd: null,
      checkoutSession: s.id,
    };
  } catch (e) {
    console.error("[subcache] could not read checkout", e && e.message);
  }
}
