# Cloudflare Security Center — Reference

Cloudflare Security Center is a unified security intelligence dashboard that maps your attack surface, inventories internet-facing assets, identifies configuration risks, and enables threat investigation using Cloudflare's global network data.

> **Availability**: All plans. Scan frequency varies by plan. Manual scans require Business/Enterprise zone or Teams Standard/Enterprise.

---

## Table of Contents

1. [What It Is](#1-what-it-is)
2. [Main Features](#2-main-features)
3. [Availability by Plan](#3-availability-by-plan)
4. [How It Relates to Project Whisper](#4-how-it-relates-to-project-whisper)
5. [Email Security (Cloudflare One / Area 1)](#5-email-security-cloudflare-one--area-1)
6. [Further Reading](#6-further-reading)

---

## 1. What It Is

Security Center aggregates security-relevant data from across your Cloudflare account into one place:

- **Attack surface mapping** — which domains, DNS records, and IP addresses are internet-facing.
- **Configuration analysis** — automated scans that compare your settings against best-practice baselines and report findings with severity levels.
- **Threat intelligence** — Cloudflare's view of the internet: IP reputation, domain categorization, passive DNS, and abuse history.
- **Brand protection** — monitors for newly registered domains that may impersonate your brand.

---

## 2. Main Features

### Security Insights

Automated scans of your Cloudflare account configuration against ideal settings. Findings cover:

- DNS record exposure (DNSSEC, dangling CNAMEs, SPF/DKIM/DMARC)
- SSL/TLS certificate issues (expiry, weak ciphers, mixed content)
- WAF misconfiguration (disabled rules, overly permissive firewall policies)
- Access misconfiguration (applications without policies, Bypass rules with broad scope)

Each finding includes a severity level (Critical / High / Medium / Low / Informational) and a direct link to the setting that resolves it.

Scan frequency:
- Free, Pro, Business: every 7 days (automated)
- Enterprise: every 3 days (automated)
- Business zone or Teams Standard/Enterprise: on-demand manual scan

### Infrastructure

Lists domains, IP addresses, and other assets associated with your Cloudflare account. Useful for tracking what's exposed and spotting assets that shouldn't be public.

### Investigate

Look up any IP address, domain, or hostname for:

- **Category** — how Cloudflare classifies the asset (e.g., malware, phishing, legitimate business)
- **Country of origin**
- **Passive DNS** — historical DNS record associations
- **Threat score** — Cloudflare's assessment of the IP's abuse history

Useful for manually investigating suspicious IPs in Worker logs or `CF-Connecting-IP` headers.

### Security Reports (beta)

Account-wide visibility into requests blocked or challenged by:

- HTTP DDoS Protection
- WAF (Web Application Firewall)
- Bot Management

Covers traffic across all zones on the account, not just one domain.

### Brand Protection (beta)

Monitors newly registered domains for:

- **Typosquatting** — character substitutions (`whisper-ai.com` instead of `whisper.ai`)
- **Homoglyph attacks** — visually similar Unicode characters (`whísper.com`)
- **Service concatenation** — combining your brand with common words (`whisper-login.com`)

Alerts when a potentially impersonating domain appears. Useful for protecting end-user trust if your product has a public-facing brand.

---

## 3. Availability by Plan

| Feature | Free | Pro | Business | Enterprise |
|---------|------|-----|----------|------------|
| Security Insights (automated) | ✓ 7d | ✓ 7d | ✓ 7d | ✓ 3d |
| Security Insights (manual scan) | — | — | ✓ | ✓ |
| Infrastructure inventory | ✓ | ✓ | ✓ | ✓ |
| Investigate (threat lookup) | ✓ | ✓ | ✓ | ✓ |
| Security Reports (beta) | ✓ | ✓ | ✓ | ✓ |
| Brand Protection (beta) | — | — | ✓ | ✓ |

> **Access limitation**: Users with the Administrator Read Only role cannot access Security Center.

---

## 4. How It Relates to Project Whisper

### Security Insights findings to watch

When Project Whisper is deployed behind a custom domain or `workers.dev` URL, Security Center will surface findings for that hostname. Key findings to act on:

| Finding type | Likely cause | Fix |
|-------------|-------------|-----|
| Access application with no policy | A CF Access application was created but no Allow/Block policy was attached | Add an Allow policy (see `docs/cloudflare-access.md`) |
| Bypass rule with broad scope | A Bypass policy covers `/*` or `/api/*` | Narrow the scope or remove the Bypass if authentication is required |
| Missing DNSSEC | DNS zone not signed | Enable DNSSEC in DNS settings |
| Mixed content | Some assets served over HTTP while page is HTTPS | Audit asset URLs; enable Always Use HTTPS |
| SSL certificate expiring | Certificate renewal not triggering | Check Universal SSL or custom certificate configuration |
| Missing security headers | `X-Content-Type-Options`, `X-Frame-Options`, etc. absent | Already mitigated — all responses include these headers via `src/lib/http.ts` |

### Investigate for Worker security

If a Worker log shows an unexpected IP in `CF-Connecting-IP`, use Security Center → Investigate to look up that IP for category, threat score, and passive DNS. This is useful when diagnosing whether an unexpected probe against `/api/ai/complete` or `/api/sandbox` is a scanner, a misconfigured client, or a legitimate user with an unusual network path.

### Brand Protection

If the Project Whisper platform is deployed as a named product with a public brand, Brand Protection provides early warning when someone registers a lookalike domain to phish users or impersonate the service.

---

## 5. Email Security (Cloudflare One / Area 1)

> **Not a Workers binding.** Cloudflare Email Security is a separate Cloudflare One enterprise product, deployed at the email provider or MX layer. It has no `wrangler.toml` entries and never appears in `env.d.ts`. Document it here because it is part of the same security posture conversation as Security Center.

### What it is

AI-based threat analysis applied to every inbound email before delivery:

- Phishing, malware, spam detection
- BEC (Business Email Compromise) — attacker impersonates an executive or authority to commit fraud
- Vendor email fraud, suspicious links, malicious attachments
- Impersonation and display-name spoofing

Deployed via API integration at the provider (Gmail, Outlook), BCC/journaling, or as the MX record. Emails are classified before the downstream destination ever receives them.

### Why it matters for Project Whisper

Project Whisper's Email Service doc (`docs/cloudflare-email-service.md`) describes implementing an `email()` Worker handler that routes inbound email to sandbox runs. That creates a prompt injection surface: any sender who can reach the routing address can inject an AI prompt via email. Email Security is the upstream layer that neutralises known attacks before the Worker sees them.

```
Internet
  → Email Security (phishing / BEC / malware filter)
  → email() Worker handler
  → Whisper guard pipeline (injection detection, normalisation)
  → sandbox run
```

| Layer | What it catches |
|-------|----------------|
| Email Security | Known phishing, BEC, malware, impersonation at email level |
| Whisper guard (input) | Prompt injection, jailbreak attempts, invisible chars, encoding tricks in email body |
| Whisper guard (output) | Response leakage, unsafe content in AI reply |

**BEC relevance for AI sandboxes.** BEC attacks impersonate authority figures to manipulate recipients. An AI sandbox processing email is susceptible to the same class of attack — a crafted email claiming to be from an administrator could instruct the sandbox to override its system prompt, leak configuration, or act outside its scope. Email Security's impersonation registry + BEC detection provides first-line defence specifically against this.

### Deployment modes

| Email provider | Recommended mode |
|---------------|-----------------|
| Gmail | API or BCC setup |
| Microsoft 365 | Journaling or MX/Inline |
| Custom MX (routing domain) | MX/Inline — emails filtered pre-delivery; Worker never sees threats |

For the inbound email handler use case, MX/Inline is the strongest: threats are rejected before delivery, so the Worker's `email()` handler never receives them. BCC/journaling modes are post-delivery — the Worker receives the email first.

### Recommended actions

If inbound email is implemented:

1. Provision Email Security in Cloudflare One for the routing domain before exposing the `email()` handler publicly.
2. Use MX/Inline deployment so threats are rejected pre-delivery.
3. Register the sandbox routing address pattern in the impersonation registry to prevent BEC-style attacks claiming to be from the platform itself.
4. Add an email-origin guard in the `email()` Worker handler: validate `message.from` domain against a configurable allowlist before passing to the sandbox.

Independent of email implementation:

- Nothing to add to `wrangler.toml` or Worker code. This is a Cloudflare One provisioning item.

### Open questions

- Available plan level: Free/Paid Workers vs. Zero Trust Free vs. Enterprise? The overview says Email Routing is "Free and Paid" but Email Security (Area 1) appears to require a Zero Trust or Enterprise subscription.
- Does the quarantine API emit webhook events (e.g., "email quarantined")? If so, a `guard-rate`-style probe on quarantine rate would be more actionable than a dashboard metric.
- Retro Scan feature (mentioned in docs) can scan existing mailbox history — useful for establishing a threat baseline before enabling live filtering.

---

## 6. Further Reading

- **Email Security (Cloudflare One)**: `https://developers.cloudflare.com/email-security/`
- **Security Insights**: `https://developers.cloudflare.com/security/security-insights/`
- **Infrastructure**: `https://developers.cloudflare.com/security-center/infrastructure/`
- **Investigate**: `https://developers.cloudflare.com/security-center/investigate/`
- **Brand Protection**: `https://developers.cloudflare.com/security-center/brand-protection/`
- **Security Reports**: `https://developers.cloudflare.com/analytics/account-and-zone-analytics/app-security-reports/`
- **Scan frequency details**: `https://developers.cloudflare.com/security/security-insights/how-it-works/#scan-frequency`
- **Community forum**: `https://community.cloudflare.com/c/security/security-center/65`
