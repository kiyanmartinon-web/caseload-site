# Casebound — public site (case-bound.com)

Every push to `main` is published automatically by Netlify.

- `index.html` — the public research tool (no Intake / corpus admin).
- `privacy.html`, `terms.html` — legal pages (EN/IT).
- `pricing.html`, `login.html`, `account.html` — plans, sign in / create account, and the account + subscription page.
- `netlify/functions/` — back end: accounts (`/api/auth/register|login|logout|me|delete`) and Stripe (`/api/plans`, `/api/checkout`, `/api/session`, `/api/portal`).
- Accounts are stored in Netlify Blobs (store `accounts`): passwords hashed with scrypt, sessions in an HttpOnly cookie. Buying a plan requires an account; the Stripe customer is linked to it after checkout.

## Subscriptions (Stripe)

Plans, prices, trials and payment methods are all managed in the Stripe dashboard; the site reads them live.

Netlify environment variables:
- `STRIPE_SECRET_KEY` (required) — secret or restricted key. Restricted key needs: Products read, Prices read, Checkout Sessions write, Customer portal write.
- `STRIPE_PORTAL_LOGIN_URL` (recommended) — Stripe → Settings → Billing → Customer portal → login link.
- `STRIPE_AUTOMATIC_TAX` — set to `true` once Stripe Tax is configured.

Optional product metadata in Stripe: `order`, `highlight=true`, `trial_days`, `hidden=true`, `name_it`, `description_it`, `features_it` (separated by `|`).

Without `STRIPE_SECRET_KEY` the Plans page simply says paid plans are not available yet.
- The admin copy (`casebound-admin-LOCAL.html`) and `supabase-signals-setup.sql` are deliberately **not** in this repo.

To roll back: Netlify → Deploys → pick an earlier deploy → "Publish deploy".

This repository is public on purpose: it contains only files that are already served publicly on case-bound.com.
