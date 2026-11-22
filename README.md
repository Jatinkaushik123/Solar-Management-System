# Bijli Wala — Solar Installation Management System

Vanilla HTML/CSS/JS frontend connected to the hosted **Supabase API v10** backend.

## Folder layout

```
bijli-wala-sims/                      ← this repo (frontend)
├── index.html                        ← login (Customer / Staff portals)
├── pages/*.html                      ← customer portal + staff workspace
├── css/*.css
├── js/
│   ├── core/
│   │   ├── identity-client.mjs       ← backend URL + publishable key (from the v10 handoff)
│   │   ├── auth.js                   ← session, refresh, API requests, optional local override
│   │   └── …                         ← utils, catalogue, local demo store
│   ├── ui/                           ← components, layout
│   └── pages/
│       ├── customer.js               ← My Solar pages (quotes, checkout, installation, warranty)
│       ├── workflow.js               ← staff: assignment, survey/design, stock check, pricing/issue
│       └── operations.js             ← staff: fulfilment, installations, service tickets, reporting
└── backend/bijli-wala-backend-v10/   ← Supabase backend (migrations + Edge Function `api`)
    └── supabase/
        ├── config.toml
        ├── functions/api/*.ts
        └── migrations/*.sql
```

The frontend never imports backend files; it talks to the backend over HTTP only.

## 1. Run the frontend locally

The pages load an ES module, so serve them over HTTP (opening `index.html` from disk won't work):

```bash
cd bijli-wala-sims
python -m http.server 8765        # or: npx serve -l 8765 .
```

Open http://localhost:8765/ and sign in on the **Customer** or **Staff** tab. Accounts live in Supabase Auth.

## 2. How it connects to the backend

| Setting | Value (from `js/core/identity-client.mjs`) |
| --- | --- |
| `SUPABASE_URL` | `https://ngutqpqlmzgxpwkamilj.supabase.co` |
| `PUBLISHABLE_KEY` | `sb_publishable_EOEwIjuoQkK1wiY8171xvQ_-O5EdpR1` (browser-safe publishable key) |
| `API_BASE` | `https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api` |

- Sign-in: Supabase Auth password grant, then `GET /v1/me?portal=customer|staff` (the portal gate).
- Every API call sends `apikey` + `Authorization: Bearer <access token>`; every POST sends a UUID `Idempotency-Key` (kept for retries of the same action).
- The session (tokens + profile only, never the password) lives in `sessionStorage`; the access token is refreshed before expiry (single-flight).

### Optional: point the frontend at a local Supabase

By default the frontend uses the hosted v10 project. To test against a local stack, set an override in the browser console (only `http://localhost` / `http://127.0.0.1` or the hosted project are accepted):

```js
localStorage.setItem("bw_supabase_override", JSON.stringify({
  url: "http://127.0.0.1:54321",
  publishableKey: "<publishable key printed by `supabase status`>"
}));
location.reload();
// back to hosted:
localStorage.removeItem("bw_supabase_override"); location.reload();
```

`window.__BW_SUPABASE__ = { url, publishableKey }` set before the scripts load does the same for one page load. `await BW.auth.backend()` shows the active target.

### Local backend (Supabase CLI)

```bash
cd backend/bijli-wala-backend-v10
supabase start                         # local Postgres, Auth, Storage on :54321
supabase db reset                      # apply supabase/migrations/*
supabase functions serve api --env-file supabase/.env.local
```

`supabase/.env.local` (git-ignored) holds the function secrets if you need payments/email locally:
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RESEND_API_KEY`, `QUOTE_EMAIL_FROM`, `QUOTE_PORTAL_URL`.

### Deploy the backend (project owner)

```bash
cd backend/bijli-wala-backend-v10
supabase link --project-ref ngutqpqlmzgxpwkamilj
supabase db push                                  # migrations
supabase functions deploy api                     # verify_jwt=false is set in config.toml
supabase secrets set RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=… \
  RESEND_API_KEY=… QUOTE_EMAIL_FROM=… QUOTE_PORTAL_URL=https://<frontend-host>/pages/customer-quotations.html
```

## 3. Quotation deep link (`QUOTE_PORTAL_URL`)

Set `QUOTE_PORTAL_URL` to the **HTTPS** quotation page of the deployed frontend (no `#fragment`):

```
https://<frontend-host>/pages/customer-quotations.html
```

The email worker appends `?quote_id=<quote UUID>`. The page accepts both `?quote_id=<uuid>` and `?quote=<uuid>`. A signed-out visitor is sent to the login page with `?next=…`; after the customer signs in they land on that quote. Another customer gets a 404 and an access-denied message.

## 4. Smoke check

```bash
python -m http.server 8765
# then open http://localhost:8765/ — an unauthenticated GET /v1/me returns 401, which proves the API is reachable.
```

## Never commit

Credential `.txt` files, `.env*`, keys, `node_modules/`, Supabase `.temp/` folders and the temporary handoff docs are git-ignored (see `.gitignore`).
