// GET /api/plans — the subscription plans you created in Stripe, ready for the pricing page.
// Every active recurring price on an active product is shown. Optional product metadata:
//   order        number used to sort plans (lowest first)
//   highlight    "true" to mark the plan as recommended
//   name_it, description_it, features_it (features separated by "|")  Italian copy
//   trial_days   free-trial length applied at checkout
//   hidden       "true" to keep a product off the pricing page
// order, highlight, trial_days and hidden can also be set on a single price
// (price metadata wins), e.g. highlight=true on the yearly price only.
import { isConfigured, isTestMode, stripe, json, portalLoginUrl, failure } from "../lib/stripe.mjs";
import { selectPlans } from "../lib/plans.mjs";

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const portalUrl = portalLoginUrl();
  if (!isConfigured()) return json({ enabled: false, plans: [], portalUrl });

  try {
    const prices = [];
    let startingAfter;
    for (let page = 0; page < 5; page++) {
      const res = await stripe("GET", "prices", {
        active: true,
        type: "recurring",
        limit: 100,
        expand: ["data.product"],
        starting_after: startingAfter,
      });
      prices.push(...res.data);
      if (!res.has_more || !res.data.length) break;
      startingAfter = res.data[res.data.length - 1].id;
    }
    return json(
      { enabled: true, testMode: isTestMode(), plans: selectPlans(prices), portalUrl },
      200,
      { "Cache-Control": "public, max-age=60" }
    );
  } catch (err) {
    return failure(err);
  }
};

export const config = { path: "/api/plans" };
