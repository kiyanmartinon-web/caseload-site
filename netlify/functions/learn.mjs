// /api/learn — the self-improving part of the rankings.
//   GET  → the aggregated relevance model (which documents users found useful
//          for which legal concepts). Public, cached, contains no personal data.
//   POST → { v: <consent version>, events: [{ action: "vote"|"result_open", doc, q: [concept ids], vote: 1|-1 }] }
//          Only sent by the site when the visitor ticked "Help improve rankings".
import { record, model, CONSENT_VERSION } from "../lib/learn.mjs";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export default async (req, context) => {
  try {
    if (req.method === "GET") {
      return json(await model(), 200, { "Cache-Control": "public, max-age=120" });
    }
    if (req.method === "POST") {
      const len = Number(req.headers.get("content-length") || 0);
      if (len > 20000) return json({ error: "Too large" }, 413);
      let body;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      if (!body || body.v !== CONSENT_VERSION) return json({ error: "Consent version mismatch" }, 409);
      const res = await record(body.events, context && context.ip);
      return json(res, 200, { "Cache-Control": "no-store" });
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("learn", err);
    return json({ error: "Learning service unavailable" }, 503);
  }
};

export const config = { path: "/api/learn" };
