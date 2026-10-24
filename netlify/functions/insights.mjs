// /api/insights — admin only: how accurate each part of Casebound is, and what it has learned.
//   GET → { canI, risk, finder }
import { currentUser, isAdmin } from "../lib/auth.mjs";
import { json } from "../lib/stripe.mjs";
import { insights as canIInsights } from "../lib/canlearn.mjs";
import { model as riskModel } from "../lib/riskmodel.mjs";
import { model as finderModel } from "../lib/learn.mjs";

function finderSummary(m) {
  const docs = Object.entries((m && m.docs) || {}).map(([id, c]) => {
    let up = 0, down = 0;
    for (const [p, n] of Object.values(c)) { up += p; down += n; }
    return { id, up: Math.round(up * 100) / 100, down: Math.round(down * 100) / 100, concepts: Object.keys(c).length };
  });
  const r = (x) => Math.round(x * 100) / 100;
  const up = docs.reduce((s, d) => s + d.up, 0), down = docs.reduce((s, d) => s + d.down, 0);
  return {
    events: (m && m.events) || 0, docs: docs.length, up: r(up), down: r(down),
    relevantRate: up + down ? r(up / (up + down)) : null,
    best: docs.filter((d) => d.up > d.down).sort((a, b) => b.up - b.down - (a.up - a.down)).slice(0, 10),
    worst: docs.filter((d) => d.down > d.up).sort((a, b) => b.down - b.up - (a.down - a.up)).slice(0, 10),
  };
}

export default async (req) => {
  const user = await currentUser(req).catch(() => null);
  if (!user || !isAdmin(user)) return json({ error: "Not allowed." }, 403);
  const safe = (p) => p.catch((e) => { console.error("[insights]", e && e.message); return null; });
  const [canI, risk, finder] = await Promise.all([
    safe(canIInsights()), safe(riskModel(new Date(), { fresh: true })), safe(finderModel()),
  ]);
  return json({ canI, risk, finder: finder ? finderSummary(finder) : null, at: new Date().toISOString() }, 200, { "Cache-Control": "no-store" });
};

export const config = { path: "/api/insights" };
