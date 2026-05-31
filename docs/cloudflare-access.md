# Cloudflare Access — Project Whisper Integration

This document covers Cloudflare Access as it is used in Project Whisper: how the Worker validates JWTs, which endpoints are protected, how to configure an Access application, and a reference for Access policy rules.

---

## Table of Contents

1. [How Project Whisper Uses Access](#1-how-project-whisper-uses-access)
2. [Environment Variables](#2-environment-variables)
3. [Protected vs. Public Endpoints](#3-protected-vs-public-endpoints)
4. [JWT Validation (`src/lib/access.ts`)](#4-jwt-validation-srclibaccess-ts)
5. [Access Policy Concepts](#5-access-policy-concepts)
   - 5.1 [Actions](#51-actions)
   - 5.2 [Rule Types](#52-rule-types)
   - 5.3 [Policy Execution Order](#53-policy-execution-order)
6. [Identity Selectors Reference](#6-identity-selectors-reference)
7. [Connection Context Settings](#7-connection-context-settings)
8. [Configuring an Access Application](#8-configuring-an-access-application)
9. [Service Tokens (Programmatic Access)](#9-service-tokens-programmatic-access)
10. [Common Misconfigurations](#10-common-misconfigurations)

---

## 1. How Project Whisper Uses Access

Cloudflare Access is **required**. If `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` are not set the Worker returns `503` and refuses all requests.

When both variables are set, every **state-mutation request** (`POST`, `PATCH`, `DELETE`, `PUT`) under `/api/` is gated. The Worker:

1. Reads the `Cf-Access-Jwt-Assertion` header (injected by the Access proxy for browser users) **or** `Authorization: Bearer <token>` (for programmatic clients).
2. Fetches the team's JWKS from `https://{teamDomain}/cdn-cgi/access/certs` (cached in isolate memory for 1 hour).
3. Validates the JWT signature (RS256), expiry, and audience claim.
4. Returns the caller's `{ email, sub }` identity to the handler, or a `401` if validation fails.

The Access check is **intentionally not a proxy** — the Worker validates the JWT itself, so it works whether or not the Access proxy is in front of the `workers.dev` URL.

---

## 2. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CF_ACCESS_AUD` | **Yes** | Audience tag from the Access application settings (a 64-char hex string). |
| `CF_ACCESS_TEAM_DOMAIN` | **Yes** | Your team domain, e.g. `yourteam.cloudflareaccess.com`. |

Set both in `.dev.vars` for local testing or as Worker secrets for production. The Worker returns `503` and serves no requests if either is absent.

---

## 3. Protected vs. Public Endpoints

`isProtectedRequest(method, pathname)` in `src/lib/access.ts` returns `true` for requests that require authentication:

**Protected** (requires valid Access JWT when Access is configured):
- Any `POST/PATCH/DELETE/PUT` under `/api/` not listed below.

**Always public** (Access check is skipped):
- `GET` and `HEAD` requests (all paths).
- `POST /api/sandbox/:id/run` and `/api/sandbox/:id/stream` — the core run API, designed for widget/embedded use.
- `POST /api/app/:id/images` and `/api/app/:id/email` — endpoints called by generated apps.
- `POST /api/csp-report` — browser CSP reporting sink.
- All paths under `/s/` — short public API.

---

## 4. JWT Validation (`src/lib/access.ts`)

The library performs these checks in order:

1. **Token presence** — reads `Cf-Access-Jwt-Assertion` first, then `Authorization: Bearer`.
2. **Structural validation** — JWT must have exactly three dot-separated parts.
3. **Expiry** — `payload.exp` must be in the future.
4. **Audience** — `payload.aud` must match `CF_ACCESS_AUD` (supports both string and array).
5. **Signature** — fetches the public key by `kid`, verifies RS256 signature using `crypto.subtle`.

On success returns `{ deny: null, identity: { email, sub } }`.
On any failure returns `{ deny: Response(401), identity: null }`.
When Access is unconfigured returns `{ deny: null, identity: null }` (passthrough).

The JWKS cache is a module-level `Map<string, CryptoKey>` with a 1-hour TTL, reset on key rotation automatically (a `kid` miss forces a fresh fetch).

---

## 5. Access Policy Concepts

### 5.1 Actions

Each Access policy has one **action** that determines what happens when a request matches.

| Action | Description |
|--------|-------------|
| **Allow** | Grants access. The user must satisfy the Include rules and pass any Require rules. |
| **Block** | Denies access unconditionally when the policy's Include rules match. Useful for blocklisting specific users or IP ranges. |
| **Bypass** | Skips Access authentication entirely for matching requests. Use with caution — traffic is not gated at all. |
| **Service Auth** | Intended for non-browser clients (machine-to-machine). Accepts service tokens; browser-based identity flows are disabled. Users who reach a Service Auth policy without a valid service token receive a 401 immediately (no login redirect). |

### 5.2 Rule Types

Within a single policy, rules are grouped into three categories that combine with boolean logic:

| Rule Type | Logic | Description |
|-----------|-------|-------------|
| **Include** | `OR` | The request must match **at least one** Include rule. This is the primary selector block — define who can access this policy. |
| **Require** | `AND` | After passing Include, the request must **also** match **all** Require rules. Use for additional constraints (e.g., require a specific country AND a valid certificate). |
| **Exclude** | `NOT` | Any request matching an Exclude rule is denied, even if it satisfied Include and Require. Use to carve out exceptions (e.g., exclude a specific email from an otherwise broad policy). |

**Combined evaluation**: `(at_least_one_Include) AND (all_Requires) AND NOT (any_Exclude)`.

### 5.3 Policy Execution Order

When multiple policies exist on an application they are evaluated **top to bottom**. The first matching policy wins:

1. **Service Auth** policies are checked first (regardless of dashboard ordering) — machine tokens are resolved before any browser flows.
2. **Bypass** policies are evaluated next.
3. **Block** and **Allow** policies are evaluated in the order they appear in the dashboard.

Drag-and-drop ordering in the Cloudflare dashboard controls the Block/Allow sequence. Put more specific Block policies above broader Allow policies.

---

## 6. Identity Selectors Reference

Selectors define the criteria used in Include / Require / Exclude rules. Many selectors are evaluated once at login; some are also re-evaluated continuously (marked **Continuous**).

| Selector | Description | Continuous |
|----------|-------------|------------|
| **Emails** | Exact email address match. | No |
| **Email domain** | `@example.com` suffix match. | No |
| **Email list** | Match against a list of email addresses uploaded to Access. | No |
| **Everyone** | Matches all authenticated users (useful for Allow-all with Require constraints). | No |
| **Country** | ISO 3166-1 alpha-2 country code derived from IP geolocation. | Yes |
| **IP ranges** | CIDR range match against the connecting IP. | Yes |
| **Service token** | Match by service token client ID/secret. | No |
| **Any valid service token** | Matches any configured service token in the account. | No |
| **Identity provider group** | Group membership from a connected IdP (Okta, Azure AD, Google Workspace, etc.). | No |
| **SAML attribute** | Key-value match on a SAML assertion attribute. | No |
| **OIDC claim** | Key-value match on an OIDC token claim. | No |
| **GitHub organization** | Membership in a specific GitHub org (requires GitHub OAuth IdP). | No |
| **GitHub team** | Membership in a specific GitHub team. | No |
| **Google Workspace group** | Membership in a Google Workspace group. | No |
| **Azure AD group** | Azure Active Directory group membership (object ID). | No |
| **Okta group** | Okta group membership. | No |
| **mTLS certificate** | Client certificate matches a configured CA. | Yes |
| **mTLS certificate thumbprint** | Specific certificate thumbprint match. | Yes |
| **Common name** | Certificate common name match. | Yes |
| **Access group** | Reusable named group of rules defined in Zero Trust > Access > Groups. | No |
| **Login method** | Which IdP or login method the user authenticated with. | No |
| **Warp** | User is connected via the Cloudflare WARP client. | Yes |
| **Device posture** | Device satisfies a posture check (disk encryption, firewall, OS version, etc.). | Yes |

**Continuous evaluation** selectors are re-checked on every request in an active session, not just at login. A session using a country selector can be terminated mid-session if the user's IP moves to a blocked country.

---

## 7. Connection Context Settings

These settings appear in the Access application configuration and apply to all policies on that application.

| Setting | Description |
|---------|-------------|
| **Session duration** | How long an authenticated session remains valid before re-authentication is required. Range: 15 minutes to 1 month. Default: 24 hours. |
| **Cookie settings** | `SameSite`, `HttpOnly`, and `Secure` flags on the Access session cookie. |
| **Additional hostnames** | Extra hostnames (CNAMEs) to which this Access application applies, in addition to the primary hostname. |
| **App launcher** | Whether the application is visible in the Cloudflare Access App Launcher for end-users. |
| **Tags** | Labels for filtering applications in the dashboard — no functional effect. |
| **CORS settings** | Allowed origins, methods, and headers for CORS preflight requests when Access is protecting an API. |
| **Skip identity provider selection** | When only one IdP is configured, redirect users directly to it instead of showing the identity provider selection screen. |

---

## 8. Configuring an Access Application

### Step 1 — Create an Access application

1. Log in to the Cloudflare Zero Trust dashboard.
2. Navigate to **Access > Applications > Add an application**.
3. Choose **Self-hosted**.
4. Set the **Application domain** to your Worker's hostname (e.g., `whisper.yourteam.workers.dev`).
5. Choose a **Session duration** (24 hours is suitable for most admin tools).

### Step 2 — Create a policy

1. Within the application, click **Add a policy**.
2. Set **Action** to **Allow**.
3. Under **Include**, add an **Email domain** rule with your team's domain (e.g., `yourteam.com`).
4. Optionally add a **Require** rule for **IP ranges** if you want to restrict to office or VPN addresses.
5. Save the policy.

### Step 3 — Wire up the Worker

1. In the application settings, copy the **Audience Tag** (AUD) — a 64-character hex string.
2. Add to your Worker environment:
   ```
   CF_ACCESS_AUD=<your-64-char-aud-tag>
   CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
   ```
3. The Worker reads these from `env.CF_ACCESS_AUD` and `env.CF_ACCESS_TEAM_DOMAIN`.

### Step 4 — Validate

Send a protected request without a token:
```
POST /api/sandbox
```
Expected: `401 {"ok":false,"error":"Authentication required — provide a Cloudflare Access token"}`.

Access the application via browser — you are redirected to the Access login page. After authentication, `Cf-Access-Jwt-Assertion` is injected and requests succeed.

---

## 9. Service Tokens (Programmatic Access)

For CI pipelines, automated scripts, or machine-to-machine calls, use a **service token** instead of a user JWT.

### Create a service token

1. In Zero Trust, navigate to **Access > Service tokens > Create a service token**.
2. Name it (e.g., `project-whisper-ci`). Set a token duration or leave indefinite.
3. Copy the **Client ID** and **Client Secret** immediately — the secret is shown only once.

### Add a Service Auth policy

In your Access application, add a second policy with:
- **Action**: Service Auth
- **Include**: Service token → select your token

Drag this policy to the **top** of the policy list so it is evaluated first.

### Calling a protected endpoint

```bash
curl -X POST https://whisper.yourteam.workers.dev/api/sandbox \
  -H "CF-Access-Client-Id: <client-id>" \
  -H "CF-Access-Client-Secret: <client-secret>" \
  -H "Content-Type: application/json" \
  -d '{"name":"CI Sandbox","model":"gpt-4o-mini"}'
```

The Worker also accepts `Authorization: Bearer <jwt>` if you have exchanged the service token credentials for a JWT via the Access token endpoint.

---

## 10. Common Misconfigurations

| Mistake | Effect | Fix |
|---------|--------|-----|
| Putting a broad Allow policy above a specific Block policy | The Allow matches first; Block is never reached. | Move the Block policy above the Allow in the dashboard. |
| Using Bypass on `/api/*` with a wildcard | All API traffic bypasses authentication entirely. | Scope Bypass rules to the minimum necessary paths. |
| Omitting Require rules on an email-domain Allow | Anyone who can log in with a matching email gains access, including external contractors who still have corporate email. | Add Require → Identity provider group or IP range to narrow access. |
| Forgetting to add a Service Auth policy for CI | CI pipelines cannot authenticate and fail with 401. | Add a Service Auth policy with the CI service token in Include. |
| Setting `CF_ACCESS_AUD` to the wrong application | JWT audience validation fails; all requests return 401 even with a valid token. | Copy the AUD from **Access > Applications > [app] > Settings > Application Audience**. |
| Using `workers.dev` subdomain without putting Access in front | The Access proxy is not in the request path; `Cf-Access-Jwt-Assertion` is never set for browser users. | Either place the Access application on the `workers.dev` URL, or add a custom domain and configure Access on that domain. The Worker's own JWT validation still works when the browser sends the token in `Authorization: Bearer`. |
| Continuous-evaluation selectors with split-tunnel VPN | A user connects via WARP, passes the WARP selector, then splits out — the WARP continuous check terminates their session mid-use. | Use session-duration settings to control re-auth frequency, or remove the WARP Require rule if split-tunnel is expected. |

---

## Further Reading

- **Project Whisper authentication code** — `src/lib/access.ts`
- **Protected route logic** — `src/lib/http.ts` (router integration)
- **Environment variable reference** — `.dev.vars.example`, `src/types/env.d.ts`
- **Cloudflare Zero Trust dashboard** — Zero Trust > Access > Applications
