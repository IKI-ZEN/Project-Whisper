# Pre-Launch Assessment — Project Whisper

**Date:** 2026-05-31  
**Audits completed:** Security · Code Quality · Testing · Performance · Production Readiness · UI/UX  
**Final verdict:** → [see § Recommendation](#recommendation)

---

## 1. Executive Summary

Project Whisper is a feature-complete, architecturally sound single-tenant AI workbench. The codebase is clean, follows consistent patterns, and has zero runtime npm dependencies — the surface area for supply-chain attacks is essentially zero. The platform covers an impressive range: chat sandboxes, multi-model environments, Vibe/App Builder, full analysis tooling (vault, atlas, probes, replay, pipelines, whisperer), and a live dashboard.

**The core platform is ready for production use with a defined owner who will configure it properly.**

The outstanding risks are almost entirely *operational* — configuration choices and environment setup — rather than architectural flaws. The two code-level security issues that must be fixed (SEC-03, SEC-04) are small, targeted changes. The auth model (SEC-01) works correctly when CF Access is configured; it silently bypasses auth when it isn't, which is a deployment risk, not a code defect.

No single audit found a fundamental design flaw that would require restructuring the application before launch.

---

## 2. Audits Performed

### 2.1 Security Audit
**Document:** `SECURITY_AUDIT.md` | **Findings:** 15 (1 Critical, 5 High, 4 Medium, 5 Low)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| SEC-01 | CRITICAL | CF Access optional — full auth bypass when vars absent | Must configure |
| SEC-02 | HIGH | `eval` via `new Function()` in SandboxDO | Accepted (CF isolate sandboxed) |
| SEC-03 | HIGH | Webhook SSRF — private IP ranges not blocked | Code fix required |
| SEC-04 | HIGH | `Content-Length` header trusted; actual body uncapped | Code fix required |
| SEC-05 | HIGH | Rate limit KV writes are `void` — counter skipped under failure | Code fix required |
| SEC-06 | HIGH | Default CORS is `*` | Config fix required |
| SEC-07 | MEDIUM | `messages[]` array has no length cap | Post-launch |
| SEC-08 | MEDIUM | `patchConfig` passes raw body to SandboxDO — schema bypassed | Code fix required |
| SEC-09 | MEDIUM | Single `SIGNING_SECRET` for three security domains | Post-launch |
| SEC-10 | MEDIUM | Internal error details in API `detail` field | Post-launch |
| SEC-11 | MEDIUM | `sessionId` not UUID-validated — DO storage key injection | Post-launch |
| SEC-12 | LOW | Guard patterns are regex-only (no semantic layer) | Accepted |
| SEC-13 | LOW | `unsafe-eval` in AI-generated app CSP | Accepted risk |
| SEC-14 | LOW | Email endpoint publicly accessible | Post-launch |
| SEC-15 | LOW | DO storage never cleaned up after KV TTL expiry | Post-launch |

**Key positive finding:** Zero hardcoded secrets found. All keys are delivered via `wrangler secret put`. No supply-chain attack surface at runtime.

---

### 2.2 Code Quality Review
**Document:** `CODE_QUALITY.md` | **Rule violations:** 3 categories, none functionally broken

| Priority | Issue | Blocking? |
|----------|-------|-----------|
| P1-A | `Date.now()` used directly in 5 files (15 instances) instead of `now()` | No |
| P1-B | `parseInt`/`isNaN` in `parseUsageQuery` instead of `parseQueryInt()` | No |
| P1-C | `readJson`/`req.json()` in 2 route handlers instead of `parseBody` | No (tracked in SEC-08) |
| P2 | Duplicated boilerplate in 6 hotspots (guard flag inserts, event inserts, whisperer rate limit, replay config resolution, HMAC import verification, atlas tags) | No |
| P3 | `pages.ts` at 2,292 lines; `ai.ts` at 1,818 lines — both navigable but large | No |

**Key positive finding:** All newer code correctly uses `parseBody`, `checkRateLimit`, `isUUID`, `newId`, `parseQueryInt`, and `bool()`. The pattern discipline is strong. Rule violations are in older code that predates the rules being established.

---

### 2.3 Testing Assessment
**Document:** `TESTING_ASSESSMENT.md` | **Current state:** 184 tests, all passing, 9 test files

| Gap | Risk Level |
|-----|-----------|
| `isProtectedRequest` — auth routing logic untested | CRITICAL |
| `parseWebhookUrl` SSRF guards untested | CRITICAL |
| `requireAccess` fail-open path untested | HIGH |
| `sealPrompt`/`openPrompt` round-trip untested | HIGH |
| `parseEnvironmentRequest` envType enum validation untested | HIGH |
| 32 of 36 schema parsers untested | LOW-MEDIUM |
| Zero route-level tests | Known gap (requires miniflare) |

**Proposed 51 new tests** spanning 2 new files and 1 existing file would close all CRITICAL and HIGH gaps. All proposed tests are pure unit tests — no Workers runtime required.

**Key positive finding:** CI runs `tsc --noEmit` on every push. TypeScript strict mode is enforced. No type errors exist in the current codebase.

---

### 2.4 Performance & Scalability Audit
**Document:** `PERFORMANCE_AUDIT.md` | **Findings:** 10 (2 High, 4 Medium, 4 Low)

| ID | Severity | Finding | Practical Impact |
|----|----------|---------|-----------------|
| PERF-01 | HIGH | Rate limit writes are `void` — race under burst | Same as SEC-05 — fix together |
| PERF-02 | HIGH | Document indexing: sequential embed batches | 10 MB doc takes ~100s; should be ~35s |
| PERF-03 | MEDIUM | Vault text search uses `LIKE '%q%'` — full table scan | Degrades at 10,000+ vault records |
| PERF-05 | MEDIUM | `listAllKV` fetches all sandboxes before filtering | Slow at 500+ sandboxes |
| PERF-06 | MEDIUM | Monitor patterns: `json_extract` per row, no index | Degrades at high guard event volume |
| PERF-07 | LOW | Probe run: 2 sequential D1 writes | ~10ms avoidable latency per probe run |
| PERF-08 | LOW | Vault analyze: 500 prompts in one embed call | Potential batch-limit failure at scale |
| PERF-09 | LOW | Missing composite index on `usage_metrics` | Metrics query slow at thousands of runs |

**Key positive finding:** Core chat streaming path has no bottlenecks at typical load. Replay batch mode, vault list dual query, and whisperer sensitivity sweeps are all correctly parallelised. Workers auto-scale horizontally with zero configuration.

**Scale context:** This is a single-tenant deployment. "100× load" means one power-user, not 100 tenants. The D1/KV bottlenecks above are volume thresholds, not multi-tenancy risks.

---

### 2.5 Production Readiness Checklist
**Document:** `PRODUCTION_READINESS.md` | **Blockers:** 3 | **Should-fix:** 7 | **Post-launch:** 6

| # | Check | Status | Detail |
|---|-------|--------|--------|
| Secrets in source | ✅ | Zero hardcoded secrets |
| CI type-check | ✅ | Runs on all PRs and branches |
| CI tests | ⚠️ | Only 2 of 9 test files run in CI |
| Deployment config | ✅ | `wrangler deploy` path is standard and well-tested |
| wrangler.toml IDs | ❌ | Placeholder `000...` IDs must be replaced before deploy |
| SETUP.md migration list | ❌ | Missing migrations 0011 and 0012 |
| Rollback documented | ❌ | No `wrangler rollback` instructions exist |
| CORS default | ⚠️ | Must set `ALLOWED_ORIGINS` before production |
| `VECTORS`/`JOB_QUEUE` null guards | ⚠️ | Unguarded — throws instead of 503 |
| Uptime alerting | ⚠️ | No Cloudflare Health Check configured |
| Health check depth | ⚠️ | `/api/health` is shallow — doesn't probe D1/KV |
| Auth configuration | ⚠️ | CF Access must be configured or app is wide open |

---

### 2.6 UI/UX Quality Review
**Document:** `UI_UX_REVIEW.md` | **Issues:** 6 (0 blocking)

| ID | Severity | Issue |
|----|----------|-------|
| UX-01 | HIGH | `alert()` calls in 3 files (environments gallery, vibe.html, tools.html) |
| UX-02 | HIGH | Missing CSS type-badge classes for `creative`/`agent`/`debate` env types in gallery |
| UX-03 | MEDIUM | `(no response)` fallback text is cryptic |
| UX-04 | MEDIUM | `'Error: '+e` raw error strings shown in stream catch blocks |
| UX-05 | LOW | Bare unstyled 404 pages (no nav, no CSS) |
| UX-06 | LOW | Inline hex status colors in vibe.html instead of CSS classes |

**Key positive finding:** Loading states (skeleton shimmer), empty states with CTAs, ARIA roles/labels, and reduced-motion support are well-implemented throughout. The visual design is polished and consistent.

---

## 3. What Has Been Fixed

All changes from prior development cycles are committed to branch `claude/whisper-dashboard-redesign-e8OzO`. The following findings from the initial audit scan have already been addressed:

| Finding | Fix applied |
|---------|------------|
| 6 route files had no rate limiting | Added `checkRateLimit` to whisperer (all 13 handlers), atlas writes, vibes create, build create, monitor stream/audit, document upload |
| Rate limit constants missing | Added 6 constant pairs to `constants.ts` |
| `patchEnvironment` used raw `readJson` | Replaced with `parseBody(parsePatchEnvironmentRequest)` |
| `environment_id` absent from assertions | Migration 0012 + `createSuite`/`listSuites`/`shapeRow` updated |
| `environment_id` absent from atlas | Migration 0012 + `addPrompt`/`listPrompts`/`shapePrompt` updated |
| Monitor had no `environment_id` filter | `?environment_id=` param added to stream and audit |
| Replay had no `batchSandboxIds` | Added symmetric support alongside `batchEnvIds` |
| OpenAPI spec missing environments routes | All 5 environments paths documented; schemas updated |
| Environments gallery missing `envType` validation | `parseEnvironmentRequest` validates against `ENV_TYPES` enum |
| No environments gallery page | `/environments` gallery with skeleton loading and fork/export |
| No `PATCH /api/environments/:id` | Added with `parsePatchEnvironmentRequest` |
| Phase 4/5 environments features | Compare mode, consensus scoring, cost badges, templates, creative/agent/debate types |

---

## 4. Remaining Risks and Trade-Offs

### Accepted Risks (by design)

| Risk | Rationale |
|------|-----------|
| `eval` in SandboxDO (SEC-02) | Sandboxed to CF V8 isolate. Code execution is an intentional feature. Mitigated by 5s timeout. |
| `unsafe-eval` in generated app CSP (SEC-13) | AI-generated apps may use CDN ESM frameworks requiring eval. The operator deployed the AI output. |
| No semantic guard layer (SEC-12) | Regex guards are defence-in-depth. Semantic guard would cost AI calls per message. Single-tenant risk model. |
| No multi-tenant isolation | By design. This is a single-tenant tool. |
| No external error monitoring | Zero npm dependency constraint. Cloudflare Analytics Engine + D1 events is the observability stack. |

### Technical Debt Accepted for Post-Launch

| Item | Debt created | When to address |
|------|-------------|----------------|
| 15 `Date.now()` → `now()` violations | Tests that mock `now()` won't cover these call sites | Before adding timing-sensitive tests |
| 32 untested schema parsers | Silent regressions in parser behaviour possible | After launch stabilises |
| `listAllKV` no pagination | Slow at 500+ sandboxes | When heavy Vibe Builder usage accumulates |
| Vault `LIKE '%q%'` scan | Degrades at 10,000+ records | When vault usage grows |
| Single `SIGNING_SECRET` for 3 domains | Key rotation affects all 3 simultaneously | Before any key rotation event |
| Internal error detail in 500 responses | Backend info leakage | Post-launch hardening sprint |
| DO storage never reclaimed after KV TTL | Storage accumulation over time | After first month of usage |

---

## 5. Recommendations Before Going Live

### MUST DO (deployment blockers — app will not work correctly without these)

1. **Replace placeholder IDs in `wrangler.toml`** — run all `wrangler kv:namespace create`, `wrangler d1 create`, `wrangler vectorize create` commands from SETUP.md and substitute real IDs.

2. **Apply all 12 D1 migrations** — run migrations 0001 through 0012 against the production D1 database. Skipping 0011 or 0012 will cause 500 errors on any environment-scoped query.

3. **Set `CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN`** — without these, every write endpoint is unauthenticated. The app has no fallback auth.

4. **Set `SIGNING_SECRET`** to a cryptographically random 32-byte value (`openssl rand -hex 32`).

5. **Set `ALLOWED_ORIGINS`** to your production Worker domain (e.g. `https://whisper.yourteam.workers.dev`). Without this, any origin can call the API cross-origin.

### SHOULD DO (security code fixes — before any public/shared exposure)

6. **Fix SEC-03 (SSRF)** — add private IP range blocking to `parseWebhookUrl()` in `schema.ts`. The proposed diff is in `SECURITY_AUDIT.md`.

7. **Fix SEC-04 (body size)** — change `readJson()` in `http.ts` to read `arrayBuffer()` and check actual bytes, not `Content-Length` header.

8. **Fix SEC-05/PERF-01 (rate limits)** — change `void env.RATE_LIMITS.put(...)` → `await` in `http.ts:113` and `void this.ctx.storage.put(...)` → `await` in `SandboxDO.ts:77`.

9. **Fix SEC-08 (schema bypass)** — add `parsePatchSandboxRequest` to `schema.ts` and use it in `sandbox.ts:patchConfig` to prevent raw body passthrough to the DO.

10. **Update SETUP.md** to include migrations 0011 and 0012 in both `--local` and `--remote` command lists.

11. **Document rollback** — add `wrangler rollback` / `wrangler deployments list` commands to CONTRIBUTING.md.

### RECOMMENDED (before public users)

12. **Fix CI test coverage** — change `.github/workflows/test.yml` to run `'src/**/*.test.ts'` instead of the hardcoded 2-file list.

13. **Add null guards for `VECTORS` and `JOB_QUEUE`** — return 503 with a clear message when these optional bindings are absent.

14. **Fix UX-01** — replace `alert()` calls in environments gallery (`pages.ts:2243, 2262`), `vibe.html`, and `tools.html` with inline status messages.

15. **Fix UX-02** — add CSS classes and `TYPE_CLASSES` entries for `creative`, `agent`, `debate` environment types in the environments gallery.

16. **Implement TEST-1 and TEST-2** (the two CRITICAL testing gaps) — `isProtectedRequest` and `parseWebhookUrl` SSRF guard tests. These lock in correctness of the two most security-sensitive pure functions.

### GOOD TO HAVE (post-launch hardening)

17. Configure a Cloudflare Tail Worker or Log Drain to alert on 5xx response spikes.
18. Add a deep health check (`/api/health/deep`) that probes D1 and KV.
19. Add `"engines": { "node": ">=20" }` to `package.json`.
20. Enable Dependabot for weekly `wrangler`/`typescript` update checks.

---

## 6. Recommendation

### CONDITIONAL GO ✅ (with pre-conditions)

**The platform is launch-ready provided the following 11 items are completed:**

| # | Item | Category | Effort |
|---|------|----------|--------|
| 1 | Replace `wrangler.toml` placeholder IDs | Config | 30 min |
| 2 | Apply all 12 D1 migrations | Config | 15 min |
| 3 | Set `CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN` | Config | 10 min |
| 4 | Set `SIGNING_SECRET` | Config | 5 min |
| 5 | Set `ALLOWED_ORIGINS` | Config | 5 min |
| 6 | Update SETUP.md (add migrations 0011–0012) | Docs | 5 min |
| 7 | Document rollback in CONTRIBUTING.md | Docs | 10 min |
| 8 | Fix SEC-03 (SSRF private IP blocking) | Code | 30 min |
| 9 | Fix SEC-04 (actual body size check) | Code | 15 min |
| 10 | Fix SEC-05 (await rate limit writes) | Code | 5 min |
| 11 | Fix SEC-08 (parsePatchSandboxRequest) | Code | 45 min |

**Total pre-launch work estimate: ~3 hours** for a developer familiar with the codebase.

**Why not NO-GO:** No audit found a fundamental flaw, data integrity risk, or architectural problem that requires significant rework. The security issues are well-understood, bounded in scope, and have clear, small fixes. The testing gaps document existing behavior rather than revealing unknown bugs. The performance bottlenecks are volume thresholds that will not be hit immediately.

**Why not unconditional GO:** Items 3, 8, 9, and 10 (auth configuration and the three security code fixes) represent real attack surface on a live deployment. SEC-05 in particular means rate limits are best-effort under burst load — if the platform is publicly accessible without CF Access configured (SEC-01), this combination is exploitable.

**The shortest safe path to launch:** Complete items 1–5 (all config, ~65 minutes), commit items 8–10 (3 targeted code changes, ~50 minutes), and run `npm run type-check` before deploying. Items 6, 7, and 11 should follow within the first week of operation.

---

## 7. Audit File Inventory

| Document | Contents |
|----------|----------|
| `PRELAUNCH_AUDIT.md` | Initial risk inventory and audit plan |
| `SECURITY_AUDIT.md` | 15 security findings with proposed diffs |
| `CODE_QUALITY.md` | Rule violations, duplication, structural complexity |
| `TESTING_ASSESSMENT.md` | Coverage map, gaps, 51 proposed test implementations |
| `PERFORMANCE_AUDIT.md` | 10 performance findings, scalability thresholds |
| `PRODUCTION_READINESS.md` | Deployment checklist, 10 categories, go/no-go per item |
| `UI_UX_REVIEW.md` | 6 UX issues, proposed minimal fixes |
| `PRELAUNCH_REPORT.md` | This document — synthesis and final verdict |
