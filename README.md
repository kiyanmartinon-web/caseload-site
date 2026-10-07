# Casebound — public site (case-bound.com)

Every push to `main` is published automatically by Netlify.

- `index.html` — the public research tool (no Intake / corpus admin).
- Matching (Finder list and the Atlas map's /25 component) is by **legal concepts**, not shared words: a multilingual (EN/IT/FR/DE) concept tree of ~165 concepts (including a General law & legal method area: sources, precedent, interpretation, retroactivity, legality, capacity, unjust enrichment, abuse of rights, international law) is embedded in `index.html`; each document carries curated `concepts` tags plus concepts detected in its text, and similarity is a rarity-weighted cosine over concept vectors, with broader parent concepts giving partial credit. The corpus and the concept tree are the `CORPUS` and `CONCEPTS` constants inside the Finder's `srcdoc` in `index.html`; a document's optional `concepts` array lists concept ids.
- **Case mindmap (Atlas pane)** — maps the case by legal concept: each concept recognised in the case is a *file* on the map that holds the documents sharing that concept (each document filed under its best-fitting concept, with "also in" cross-references). Users can open a file, move documents between files, take them out, add/remove concept files, and download the case file; the arrangement is saved per case in the browser. It reads the document pool and the concept reading of the case from the Finder (`window.CASEBOUND_STATE`), so both panes agree.
- `privacy.html`, `terms.html` — legal pages (EN/IT).
- `pricing.html`, `login.html`, `account.html` — plans, sign in / create account, and the account + subscription page.
- `risk-check.html` — **Pro feature.** A client describes a problem (type, facts, date, amount, evidence) and gets a Low / Medium / High risk rating with four factors: time limit (simplified Italian limitation periods in the `AREAS` table), evidence, detail and amount. Runs entirely in the browser; nothing is sent. Shown only when `/api/auth/me` returns `tier: "pro"`; everyone else sees what it does and a link to Plans. Starts empty: no example cases. "Find the law behind it" hands the facts to the research tool via `sessionStorage` (`casebound:prefill`). Gating is client-side, like the free-plan limits.
- **Client and lawyer profiles + lawyer connections.** Sign-up asks "client" or "lawyer" (`login.html`); lawyers add bar association, register number, city, areas and bio and start as `pending`. Profile type and lawyer details are edited on `account.html` (changing bar details sends a verified lawyer back to `pending`).
  - After a risk check, a Pro client can send the case to verified lawyers (`/api/cases/submit`, Pro checked server-side, max 5 open cases). Cases live in Netlify Blobs store `matches` (`case/<id>`).
  - `lawyers.html` — the case board for verified lawyers (`/api/cases/board`): client identity hidden; each lawyer rates strength/evidence privately and chooses I want this case / Ask for more / Pass, with an optional message. Empty until a client sends a case.
  - Clients follow replies on `account.html` (`/api/cases/mine`), see interested lawyers' profiles, and choose **Share my contact details** per lawyer (`/api/cases/share`); only then does that lawyer see the client's name and email. Clients can add details or withdraw.
  - **Verifying lawyers:** set Netlify env var `ADMIN_EMAILS` (comma-separated, e.g. `admin@case-bound.com`). Signed in with that email, `account.html` shows **Lawyers to verify** with Verify / Reject (`/api/cases/lawyers`, `/api/cases/verify`). Register that email yourself before anyone else can. Admin accounts always count as Pro (no subscription needed, `tierOf` in `lib/subscription.mjs`) and can read the lawyer board, but only verified lawyers can rate cases or contact clients.
  - **Admin: view pages as client or lawyer.** Signed in as an admin, Settings → *Admin · view pages as* switches between Admin / Client / Lawyer (kept in the browser, `casebound:viewAs`; `window.CBView` in `theme.js`). A strip under the top bar shows the preview and switches back. As lawyer, the board shows the full rating screen, but ratings stay in the browser and nothing reaches clients. As client, the risk check can really send a case (admins may send even with a lawyer profile), and verified lawyers will see it. The server still applies the admin's real permissions.
  - Deleting an account deletes the client's cases and the lawyer's reviews. Back end: `netlify/functions/cases.mjs`, `netlify/lib/matches.mjs`; subscription look-up shared in `netlify/lib/subscription.mjs`.
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
