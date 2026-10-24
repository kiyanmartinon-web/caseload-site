// /api/risk-model — the risk check's points, re-fitted from verified lawyers' ratings.
//   GET → { active, n, bias, table:{time:{…}, evidence:{…}, detail:{…}, amount:{…}}, updated }
// Public: it is the same for everyone and contains no personal data.
import { model, publicModel } from "../lib/riskmodel.mjs";

export default async () => {
  try {
    return new Response(JSON.stringify(publicModel(await model())), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    console.error("[risk-model]", err && err.message);
    return new Response(JSON.stringify({ active: false }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
};

export const config = { path: "/api/risk-model" };
