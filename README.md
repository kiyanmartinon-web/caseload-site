# Casebound — public site (case-bound.com)

Every push to `main` is published automatically by Netlify.

- `index.html` — the public research tool (no Intake / corpus admin).
- Matching (Finder list and the Atlas map's /25 component) is by **legal concepts**, not shared words: a multilingual (EN/IT/FR/DE) concept tree of ~165 concepts (including a General law & legal method area: sources, precedent, interpretation, retroactivity, legality, capacity, unjust enrichment, abuse of rights, international law) is embedded in `index.html`; each document carries curated `concepts` tags plus concepts detected in its text, and similarity is a rarity-weighted cosine over concept vectors, with broader parent concepts giving partial credit. The corpus and the concept tree are the `CORPUS` and `CONCEPTS` constants inside the Finder's `srcdoc` in `index.html`; a document's optional `concepts` array lists concept ids.
- **Case mindmap (Atlas pane)** — maps the case by legal concept: each concept recognised in the case is a *file* on the map that holds the documents sharing that concept (each document filed under its best-fitting concept, with "also in" cross-references). Users can open a file, move documents between files, take them out, add/remove concept files, and download the case file; the arrangement is saved per case in the browser. It reads the document pool and the concept reading of the case from the Finder (`window.CASEBOUND_STATE`), so both panes agree.
- `privacy.html`, `terms.html` — legal pages (EN/IT).
- `pricing.html`, `login.html`, `account.html` — plans, sign in / create account, and the account + subscription page.
- `risk-check.html` — **Pro feature.** A client describes a problem (type, facts, date, amount, evidence) and gets a Low / Medium / High risk rating with four factors: time limit (simplified Italian limitation periods in the `AREAS` table), evidence, detail and amount. Runs entirely in the browser; nothing is sent. Shown only when `/api/auth/me` returns `tier: "pro"`; everyone else sees what it does and a link to Plans. Starts empty: no example cases. "Find the law behind it" hands the facts to the research tool via `sessionStorage` (`casebound:prefill`). Gating is client-side, like the free-plan limits.
- `theme.js` — light/dark/auto appearance (saved in the browser) and the Settings menu in the top bar of every page.
- **Self-improving rankings** — `netlify/functions/learn.mjs` (`/api/learn`). The Finder lets users rate results (Relevant / Not relevant) and correct the recognised concepts. Ratings and corrections act immediately in that browser (local storage); with the opt-in "Help improve rankings" box ticked, ratings and opened results are also sent as concept ids + document id and pooled into per-document totals in Netlify Blobs (store `learning`). Every visitor downloads the pooled model, which adds concepts users found a document useful for, demotes ones they rejected, and nudges scores by at most ±18 points. Taught words (vocabulary) never leave the browser. No env vars needed.
- `netlify/functions/` — back end: accounts (`/api/auth/register|login|logout|me|delete|update|email|password|logout-all|export`) and Stripe (`/api/plans`, `/api/checkout`, `/api/session`, `/api/portal`).
- Accounts are stored in Netlify Blobs (store `accounts`): passwords hashed with scrypt, sessions in an HttpOnly cookie. Buying a plan requires an account; the Stripe customer is linked to it after checkout.

## Subscriptions (Stripe)

Plans, prices, trials and payment methods are all managed in the Stripe dashboard; the site reads them live.

Netlify environment variables:
- `STRIPE_SECRET_KEY` (required) — secret or restricted key. Restricted key needs: Products read, Prices read, Checkout Sessions write, Customer portal write, **Subscriptions read** and **Customers write** (without Subscriptions read the account page can only show what was bought at checkout, not renewals or cancellations).
- `STRIPE_PORTAL_LOGIN_URL` (recommended) — Stripe → Settings → Billing → Customer portal → login link.
- `STRIPE_AUTOMATIC_TAX` — set to `true` once Stripe Tax is configured.

Optional product metadata in Stripe: `order`, `highlight=true`, `trial_days`, `hidden=true`, `name_it`, `description_it`, `features_it` (separated by `|`). `order`, `highlight`, `trial_days` and `hidden` can also be set on an individual **price** (it wins over the product), e.g. `highlight=true` on the yearly price only.

Without `STRIPE_SECRET_KEY` the Plans page simply says paid plans are not available yet.
- The admin copy (`casebound-admin-LOCAL.html`) and `supabase-signals-setup.sql` are deliberately **not** in this repo.

To roll back: Netlify → Deploys → pick an earlier deploy → "Publish deploy".

This repository is public on purpose: it contains only files that are already served publicly on case-bound.com.
