// Subscription status for an account (shared by /api/auth and /api/cases).
import { saveUser, isAdmin } from "./auth.mjs";
import { isConfigured, stripe } from "./stripe.mjs";
import { rememberCheckout } from "./subcache.mjs";

// If the buyer never landed back on the account page after paying, the Stripe
// customer was never linked. Find a completed checkout that THIS account started
// (client_reference_id = account id) and link it now. No email filter: the buyer
// may have typed a different email (or capitalisation) on Stripe's page.
async function linkFromCheckout(user) {
  if (user.stripeCustomer || !isConfigured()) return;
  try {
    let after;
    for (let page = 0; page < 3; page++) {
      const res = await stripe("GET", "checkout/sessions", { status: "complete", limit: 100, starting_after: after });
      const s = (res.data || []).find((x) => x.client_reference_id === user.id && x.customer);
      if (s) {
        user.stripeCustomer = typeof s.customer === "string" ? s.customer : s.customer.id;
        await rememberCheckout(user, s.id);
        await saveUser(user);
        return;
      }
      if (!res.has_more || !res.data.length) return;
      after = res.data[res.data.length - 1].id;
    }
  } catch (e) {
    console.error("[auth] checkout look-up failed", e && e.message);
  }
}

// What we can show from the account alone, when Stripe can't be asked about the
// subscription itself (e.g. a restricted key without "Subscriptions: read").
function fromCache(user, reason) {
  const c = user.subCache;
  if (!c) return { status: "unknown", reason };
  const ended = c.currentPeriodEnd && c.currentPeriodEnd * 1000 < Date.now() - 3 * 86400e3;
  return { ...c, status: ended ? "unknown" : "active", cached: true, reason };
}

export async function subscriptionFor(user) {
  await linkFromCheckout(user);
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
    const out = {
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
    return out;
  } catch (e) {
    console.error("[auth] subscription lookup failed", e && e.message);
    const reason = e && (e.status === 401 || e.status === 403) ? "permission" : "stripe";
    return fromCache(user, reason);
  }
}

// Paid features stay on during a trial and while Stripe retries a failed payment.
export function tierOf(user, subscription) {
  // Admin accounts (ADMIN_EMAILS) always have full Pro access, with no subscription needed.
  if (isAdmin(user)) return "pro";
  const st = subscription && subscription.status;
  return ["active", "trialing", "past_due"].includes(st) || (st === "unknown" && user.stripeCustomer) ? "pro" : "free";
}
