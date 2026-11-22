# Frontend identity handoff

The [backend release handoff](./backend-release.md) records the deployed release, hosted tests and owner setup for quote email, account confirmation and Razorpay Test Mode.

The [warranty service and reporting handoff](./service-reporting.md) covers service tickets, invoicing, technician pay, subsidy tracking and the dashboard export.

The [warehouse, installation and warranty handoff](./fulfilment-workflow.md) covers stock receipt through customer sign-off.

The [checkout and order handoff](./checkout-workflow.md) covers payment status, stock holds and the confirmed order.

The [enquiry and quote handoff](./quote-workflow.md) covers the hosted workflow from intake through customer acceptance, including role-specific actions and a repeatable demonstration.

The hosted project is `https://ngutqpqlmzgxpwkamilj.supabase.co`. The application API base is `https://ngutqpqlmzgxpwkamilj.supabase.co/functions/v1/api`. Use this browser publishable key for Supabase Auth and API requests.

```text
sb_publishable_EOEwIjuoQkK1wiY8171xvQ_-O5EdpR1
```

## Sign in and load the current user

Import the [browser ES module](./identity-client.mjs) into each login screen. This example runs with native fetch. The module sends the form credentials to Supabase Auth, then sends the returned access token to `GET /v1/me?portal=customer`. The staff screen calls the same function with `"staff"`. A mismatched portal returns HTTP 403 and the example signs out that session.

```js
import { signIn, getProfile, signOut } from "./identity-client.mjs";

const { session, me } = await signIn("customer", emailFromForm, passwordFromForm);
const profile = await getProfile(session.access_token, me.id);
// Use me.role for navigation and profile.display_name as plain text.
// On logout:
await signOut(session.access_token);
```

A customer response has the following shape. `actions` lists available operations. Access to individual records also depends on ownership and staff assignments.

```json
{
  "id": "3a0f96e7-ddbf-48a5-b83f-fc44ee4c82b6",
  "email": "m1-ad28f1cc810f-customer-a@identity.sunpower.test",
  "role": "customer",
  "display_name": "Milestone customer_a",
  "portal": "customer",
  "actions": ["profiles.read_self", "staff.accept_invitation", "enquiries.create", "enquiries.read_own", "quotes.decide", "projects.read_own", "installations.signoff", "warranties.read_own"]
}
```

For an existing Supabase client, use `auth.signInWithPassword({email, password})` and pass `data.session.access_token` to `getMe`. Let the Auth SDK manage refresh for a long-lived session. The standalone example keeps the session in memory.

## Customer registration and staff onboarding

1. The customer registration form calls `signUpCustomer(email, password, displayName)`. Supabase Auth requires email confirmation on this project. On acceptance, prompt the customer to follow the confirmation email and then sign in. On HTTP 429, show a retry-later state. The hosted verification run received `over_email_send_rate_limit` for a fresh synthetic signup. Receipt and redemption of a customer confirmation email remain open.
2. An admin calls `newInvitationSecret()` and `inviteStaff(adminToken, email, role, secret)`. Deliver the secret privately to the intended employee. The database stores its SHA-256 digest, the recipient, role, inviting admin and expiry. The invitation lasts 24 hours. Retrying with the same secret and role preserves the expiry. Creating a new secret replaces an outstanding invitation.
3. The employee registers or signs in with the exact verified email on the invitation. The staff onboarding screen calls `joinStaff(email, password, secret)`. It accepts the invitation, then reads the assigned role. Returning staff use the staff login. An active admin assignment and a valid invitation are checked in the database. Repeating acceptance as the same employee is safe.

The first admin is bootstrapped by a trusted project operator against a specific confirmed Auth user ID. This deployment has a bootstrapped synthetic admin. A new identity otherwise starts as a customer, including identities with a role in their user metadata.

## Hosted contract

Send `apikey` with the publishable key and `Authorization: Bearer <access_token>` on application API calls. POST requests use `Content-Type: application/json`. Each error has the shape `{"error":{"code":"..."}}`.

| Method and path under the application API base | Request and response |
| --- | --- |
| `GET /v1/me` | Returns `id`, `email`, `display_name`, `role`, `portal` and `actions`. Optional `portal=staff` or `portal=customer` enforces the login screen. Missing, invalid or signed-out sessions receive 401. A role mismatch receives 403. |
| `GET /v1/profiles/{uuid}` | Returns `id`, `display_name`, `created_at`. An active user can read their own profile. Admins can read company profiles. A hidden or missing profile receives 404. |
| `POST /v1/staff/invitations` | Admin sends `email`, `role` and `token_hash` (lowercase SHA-256 hex of the 64-character ASCII hex secret). Returns normalized email, role and `expires_at`. Supported staff roles are `technician`, `inventory`, `sales` and `admin`. Conflicting invitations and already-assigned staff receive 409. |
| `POST /v1/staff/invitations/accept` | Signed-in recipient sends `{"token":"<secret>"}`. Returns `{"role":"<assigned role>"}`. A mismatched recipient, expired or superseded secret receives 403. |

## Verification on 21 November 2026

The public-key [hosted test runner](../tests/identity-hosted.mjs) passed 22 grouped checks with six confirmed synthetic Auth accounts. A fresh run redeemed three admin-issued staff invitations. Its checks include both portal gates, missing and invalid credentials, customer metadata claiming admin, direct RPC authorization, profile ownership through both HTTP interfaces, invitation retries, rotation, concurrent acceptance, and access after logout. A separate Chrome run loaded the example from a loopback origin, signed in through both portals, read the correct profile and signed out.

The test runner accepts a JSON array on standard input with `label`, `email`, and `password` for `customer_a`, `customer_b`, `admin`, `technician`, `inventory` and `sales`. Fresh staff fixtures start as confirmed customers. On later runs it verifies the existing staff roles. Use synthetic accounts only. On the project owner's Windows machine, the private fixture file is protected by Windows DPAPI under the current user. To repeat the hosted checks from the repository root:

```powershell
$fixturePath = Join-Path $env:LOCALAPPDATA 'SunPowerSolutions\Identity\m1-ad28f1cc810f.clixml'
$accounts = Import-Clixml -LiteralPath $fixturePath | ForEach-Object {
    [pscustomobject]@{
        label = $_.label
        email = $_.email
        password = ([pscredential]::new($_.email, $_.secret)).GetNetworkCredential().Password
    }
}
ConvertTo-Json -InputObject @($accounts) -Compress | node --use-system-ca tests/identity-hosted.mjs
```

## New-customer confirmation email

The project has email/password registration enabled. Supabase asks a new customer to click a link before their first login. The six demo accounts were created as confirmed test users and can sign in immediately.

For a public registration rehearsal, configure the project's Auth email sender for customer addresses and use a test inbox the team can open. Register a new customer, open the confirmation link, and sign in on the customer screen. Supabase documents a team-address restriction and a two-message hourly limit for its built-in sender. [Project email settings](https://supabase.com/dashboard/project/ngutqpqlmzgxpwkamilj/auth/smtp) · [Supabase Auth SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp)
