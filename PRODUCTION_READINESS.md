# Production Readiness Checklist

_Assessed: 2026-05-31_

**Legend:** ✅ Ready · ⚠️ Needs attention · ❌ Blocking · ℹ️ Informational

---

## 1. Secrets & Environment Variables

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 1.1 | No secrets hardcoded in source | ✅ | Grep across all `.ts` and `public/` finds zero API keys, tokens, or passwords. Secret patterns (`sk-`, `ghp_`, `sk-ant-`) are only referenced as detection regexes in `guard.ts`. |
| 1.2 | `.dev.vars` excluded from git | ✅ | `.gitignore` lists `.dev.vars`, `.dev.vars.local`, and `.env.local`. |
| 1.3 | All secrets delivered via `wrangler secret put` | ✅ | SETUP.md documents the `wrangler secret put` workflow. Runtime access is via `env.VAR_NAME` — never from files. |
| 1.4 | `.dev.vars.example` documents all variables | ✅ | 30 variables documented with inline comments explaining what each enables. |
| 1.5 | `wrangler.toml` contains only non-secret config | ⚠️ | `wrangler.toml` contains **placeholder resource IDs** (e.g. `id = "00000000000000000000000000000001"`) intended to be replaced during setup. These aren't secrets, but if left as-is and deployed they point to non-existent resources with no warning. |
| 1.6 | No `DISABLE_AUTH` escape hatch in code | ✅ | The only auth bypass is missing `CF_ACCESS_AUD` (documented as fail-open in SEC-01). No debug flags in source. |
| 1.7 | CORS locked down for production | ⚠️ | `ALLOWED_ORIGINS` defaults to `*` when not set. Must be set to the deployment domain before production exposure. Documented in SETUP.md but not enforced. |

**Next steps:**
- Set `ALLOWED_ORIGINS=https://yourworker.yourteam.workers.dev` as a Worker secret before go-live.
- Consider adding a pre-deploy check script that fails if KV/D1 IDs still match the placeholder pattern `000...`.

---

## 2. Deployment Configuration

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 2.1 | Cloudflare Workers deployment via `wrangler deploy` | ✅ | `npm run deploy` = `wrangler deploy`. Standard, well-tested path. |
| 2.2 | All bindings declared in `wrangler.toml` | ✅ | AI, 3 Durable Object classes, 2 KV namespaces, D1, R2, Queues, Vectorize, Analytics Engine, cron triggers all declared. |
| 2.3 | Durable Object migrations declared | ✅ | Three DO migration tags (`v1` SandboxDO, `v2` AppBuilderDO, `v3` AppStateDO) declared in `wrangler.toml`. New classes are automatically registered on first deploy. |
| 2.4 | Cron triggers configured | ✅ | Three cron expressions cover hourly, daily (09:00), and weekly (Monday 09:00) probe schedules. |
| 2.5 | No staging/preview environment | ⚠️ | `wrangler.toml` has no `[env.staging]` block. Every `wrangler deploy` goes directly to the production Worker. |
| 2.6 | Workers KV and D1 placeholder IDs | ❌ | `wrangler.toml` ships with placeholder IDs (`00000000...`). Deploying without replacing them causes runtime failures on any KV or D1 access. There is no deploy-time guard against this. |
| 2.7 | AI Search binding commented out | ℹ️ | `[[ai_search]]` block is commented out in `wrangler.toml`. The `env.AI_SEARCH` binding is correctly typed as optional and guarded with `if (!env.AI_SEARCH)` before use — safe as-is. |
| 2.8 | `VECTORS` and `JOB_QUEUE` typed as required | ⚠️ | In `src/types/env.d.ts`, `VECTORS: VectorizeIndex` and `JOB_QUEUE: Queue<WhisperJob>` are non-optional. If Vectorize or Queues haven't been provisioned, code that touches these bindings throws at runtime rather than returning a 503. Affects RAG (`runInSandboxWithRAG`) and document upload. |

**Next steps:**
- Before first production deploy: run all resource-creation commands from SETUP.md and replace all placeholder IDs.
- Consider adding a `[env.staging]` block pointing to separate KV/D1 resources for pre-production testing.
- Add a `null` guard or graceful 503 in `runInSandboxWithRAG` when `env.VECTORS` is unavailable.

---

## 3. Database & Migrations

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 3.1 | Migration files present and idempotent | ✅ | 12 migrations use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` equivalents. Safe to re-run. |
| 3.2 | SETUP.md migration list is stale | ✅ | Fixed — `0011_env_integration.sql` and `0012_assertions_atlas_env.sql` added to both `--remote` and `--local` command blocks in SETUP.md; count updated to "twelve". |
| 3.3 | No migration runner / version tracking | ⚠️ | There is no migration state table (like `schema_migrations` in Rails). Migrations must be applied manually in order. Rerunning a migration that uses `ALTER TABLE ... ADD COLUMN` without `IF NOT EXISTS` will fail on SQLite (though most do use `IF NOT EXISTS`). |
| 3.4 | No DOWN migrations | ⚠️ | Migrations are additive-only. There is no rollback path for a schema change — a bad migration that lands in production requires manual SQL to revert. |
| 3.5 | Local vs remote migration parity | ⚠️ | SETUP.md shows separate commands for `--local` and `--remote`. It's easy to run one but not the other. A developer whose local DB is on 0012 but whose production DB is only on 0010 will see silent discrepancies. |

**Next steps:**
- **Immediate:** Update SETUP.md to include migrations 0011 and 0012 in both the remote and local command lists.
- Add a simple `migrations/README.md` or a `scripts/migrate.sh` that runs all migrations in sequence, reducing human error.

---

## 4. CI / Automated Quality Gates

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 4.1 | TypeScript type-check runs on every push and PR | ✅ | `.github/workflows/typecheck.yml` runs `tsc --noEmit` on all branches and PRs. |
| 4.2 | Test workflow runs on every push and PR | ✅ | Fixed — `.github/workflows/test.yml` now runs `npm test` (all 184 tests via `src/**/*.test.ts` glob), replacing the hardcoded 2-file list. |
| 4.3 | Node version inconsistency in CI | ✅ | Fixed — `test.yml` updated to `node-version: '20'`, matching `typecheck.yml` and the documented minimum. |
| 4.4 | No deploy workflow | ℹ️ | There is no CI-triggered deploy. Production deploys are manual (`npm run deploy`). For a single-tenant tool this is acceptable, but means no deploy history or gated deploys. |
| 4.5 | PR template exists | ✅ | `.github/PULL_REQUEST_TEMPLATE.md` present. |
| 4.6 | Issue templates exist | ✅ | Bug report and feature request YAML templates present. |

**Next steps:**
- Fix `test.yml` to run all test files: change the explicit file list to the glob pattern `'src/**/*.test.ts'` (same as `package.json`).
- Align both workflows to the same Node version (20 is the documented minimum; use `20` in both).

---

## 5. Error Monitoring & Observability

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 5.1 | Structured error responses | ✅ | All route handlers return `{ ok: false, error: "...", detail?: ... }` JSON with appropriate HTTP status codes. |
| 5.2 | Request ID on every response | ✅ | The router adds `X-Request-ID: <uuid>` to every response via `addHeaders()`. Useful for correlating logs. |
| 5.3 | Scheduled and queue job error logging | ✅ | `console.error` in `src/index.ts` for cron failures and queue job failures. Queue failures are also written to `sandbox_events` D1 as `job_failed` events. |
| 5.4 | Route handler errors not logged | ⚠️ | When a route handler catches an exception and returns a 500, the error is returned to the caller but **never logged**. There is no centralized error tracking. Errors are only visible by querying D1 `sandbox_events` or checking Cloudflare's Workers Logs (if log drains are configured). |
| 5.5 | AI call telemetry via Analytics Engine | ✅ | `env.ANALYTICS.writeDataPoint()` is called on every AI completion with model, provider, sandbox ID, latency, token counts, and cost. The `ANALYTICS` binding is present in `wrangler.toml`. |
| 5.6 | No external error monitoring integration | ℹ️ | No Sentry, Datadog, Honeycomb, etc. By design (zero runtime npm deps). The `sandbox_events` D1 table + Cloudflare Analytics Engine is the full observability stack. This is viable for a single-tenant deployment but means no alerting on error spikes. |
| 5.7 | CSP violations logged | ✅ | `POST /api/csp-report` writes violations to `sandbox_events` as `csp_violation` events. |
| 5.8 | No uptime/availability alerting | ⚠️ | Cloudflare provides basic Worker health metrics in the dashboard, but there is no configured uptime monitor or alert for availability drops. |

**Next steps:**
- Add a Cloudflare Workers Tail Worker (or Log Drain) to capture 5xx responses and route them to an alerting channel (Slack, email, PagerDuty) — zero code change required, configured in the Cloudflare dashboard.
- Consider adding a Cloudflare Health Check to the `GET /api/health` endpoint for automated uptime monitoring.

---

## 6. Health Checks

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 6.1 | Health endpoint exists | ✅ | `GET /api/health` returns `{ ok: true, data: { status: "ok" } }`. |
| 6.2 | Health check is shallow (no dependency probing) | ⚠️ | The health endpoint only confirms the Worker is alive. It does **not** probe D1, KV, Vectorize, or Durable Object reachability. A healthy response doesn't mean the app is fully functional. |
| 6.3 | Discovery endpoint | ✅ | `GET /api` returns the API structure, name, version, and `status: "operational"`. |
| 6.4 | Version reported at health/discovery | ⚠️ | `version: '0.2.0'` is hardcoded in `src/index.ts` — it must be kept manually in sync with `package.json`. No automated sync. |

**Next steps (optional, not blocking):**
```typescript
// Deep health check — add as GET /api/health/deep
const checks = await Promise.allSettled([
  env.DB.prepare('SELECT 1').first(),
  env.SANDBOX_REGISTRY.get('__health_probe__'),
])
const dbOk  = checks[0].status === 'fulfilled'
const kvOk  = checks[1].status === 'fulfilled'
return json(ok({ status: dbOk && kvOk ? 'ok' : 'degraded', db: dbOk, kv: kvOk }))
```

---

## 7. Rollback Strategy

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 7.1 | Worker rollback via `wrangler rollback` | ✅ | Cloudflare Workers retains previous deployment versions. `wrangler rollback` reverts the Worker code and bindings configuration to the prior version. |
| 7.2 | Rollback procedure documented | ✅ | Fixed — "8. Deployment and rollback" section added to CONTRIBUTING.md with `wrangler rollback` and `wrangler deployments list` commands and a note on D1 migration handling. |
| 7.3 | D1 schema rollback | ❌ | There are no DOWN migrations. A deployed schema change cannot be automatically rolled back. `wrangler rollback` reverts the Worker code but the D1 schema stays at the new version — old code running against new schema can cause errors if columns are referenced. |
| 7.4 | Staged rollout / canary | ⚠️ | No canary or staged rollout configured. Every deploy is an instant 100% cutover. Cloudflare offers gradual rollouts (Durable Object migrations support phased migration) but they are not used here. |
| 7.5 | Durable Object migration safety | ✅ | DO class migrations use `new_classes` (not `renamed_classes` or `deleted_classes`). This is the safest migration type — existing DO instances are unaffected. |

**Next steps:**
- Add a **Rollback** section to CONTRIBUTING.md:
  ```bash
  wrangler rollback                  # revert Worker code to previous deploy
  wrangler deployments list          # see deployment history
  ```
- For any migration that could be destructive, add a note in the migration file's comment with the manual SQL to reverse it.

---

## 8. Dependency Management

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 8.1 | Zero runtime npm dependencies | ✅ | `package.json` has no `dependencies` — only `devDependencies`. All runtime logic uses Web Platform APIs. Supply chain attack surface is near-zero for the deployed Worker. |
| 8.2 | Dev dependencies are minimal and well-known | ✅ | 4 dev deps: `wrangler`, `typescript`, `tsx`, `@cloudflare/workers-types`. All are major, actively maintained tools. |
| 8.3 | `package-lock.json` committed | ✅ | Ensures reproducible installs across machines and CI. |
| 8.4 | `"private": true` in package.json | ✅ | Prevents accidental `npm publish`. |
| 8.5 | No automated dependency updates | ⚠️ | No Dependabot or Renovate configuration. Dev dependency updates (especially `wrangler`, which ships new Workers APIs) must be tracked and applied manually. |
| 8.6 | No `engines` field in package.json | ✅ | Fixed — `"engines": { "node": ">=20" }` added to `package.json`. |
| 8.7 | Wrangler version pinned loosely | ℹ️ | `"wrangler": "^4"` accepts any 4.x. Current lock: `4.92.0`. In practice Wrangler 4 has been stable, but a major version bump to 5 would require a `package-lock.json` update. |

**Next steps:**
- Add to `package.json`:
  ```json
  "engines": { "node": ">=20" }
  ```
- Consider adding a `.github/dependabot.yml` for weekly `npm` dependency checks.

---

## 9. "Works on My Machine" Gaps

Issues that work locally but could silently fail in a fresh production deployment:

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 9.1 | SETUP.md missing migrations 0011–0012 | ✅ | Fixed — both migrations added to SETUP.md remote and local command blocks. |
| 9.2 | Placeholder IDs in `wrangler.toml` | ❌ | KV namespace IDs (`00000000000000000000000000000001` etc.) and D1 database ID are placeholders. Deploying without replacing them causes every KV and D1 call to fail at runtime. There is no pre-deploy validation. |
| 9.3 | CI test workflow runs only 2 of 9 test files | ✅ | Fixed — `test.yml` now runs `npm test` (all 184 tests). |
| 9.4 | `VECTORS` unguarded when RAG is enabled | ⚠️ | `runInSandboxWithRAG` in `ai.ts:1268` calls `env.VECTORS.query()` with no null check. If `wrangler vectorize create` was not run, the Worker throws `TypeError: Cannot read properties of undefined` instead of a graceful 503. |
| 9.5 | `JOB_QUEUE` unguarded in documents.ts | ⚠️ | Document upload (`documents.ts:95`, `documents.ts:169`) calls `env.JOB_QUEUE.send()` with no null check. If Queues are not provisioned, uploads fail with an unhandled runtime error. |
| 9.6 | Node version mismatch across CI | ✅ | Fixed — `test.yml` now uses Node 20, matching `typecheck.yml` and the documented minimum. |
| 9.7 | Vectorize has no local simulator | ℹ️ | `npm run dev:local` (local mode) does not simulate Vectorize. Document upload and RAG retrieval silently fail or throw in local mode. Documented in SETUP.md troubleshooting, but new developers can be surprised. |
| 9.8 | `wrangler.toml` hardcodes `ENVIRONMENT = "production"` | ℹ️ | The `[vars]` section sets `ENVIRONMENT = "production"`. Local dev overrides this via `.dev.vars`. This is correct and documented — but it means `wrangler dev` (without a `.dev.vars`) will report as production unless the env file is present. |

---

## 10. Security Headers & CSP

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 10.1 | Security headers on all responses | ✅ | Router's `addHeaders()` sets: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-XSS-Protection: 0`. |
| 10.2 | No `Content-Security-Policy` header | ⚠️ | CSP violation reporting is wired up (`POST /api/csp-report`) but no CSP header is sent. The HTML pages (`pages.ts`) have inline `<meta http-equiv="Content-Security-Policy">` tags, but these are not present on API responses and are not set at the Worker level for the static assets. |
| 10.3 | CORS defaults to `*` | ⚠️ | Already noted in item 1.7. Without `ALLOWED_ORIGINS` set, any origin can make cross-origin API calls. |

---

## Summary: Go / No-Go

### Blocking before any production exposure

| ID | Issue | Fix |
|----|-------|-----|
| 2.6 | Placeholder IDs in `wrangler.toml` | Replace all `000...` IDs with real provisioned resource IDs |
| 3.2 | SETUP.md missing migrations 0011–0012 | Update SETUP.md to include both migrations |
| 7.2 | No rollback procedure documented | Add `wrangler rollback` to CONTRIBUTING.md |

### Should fix before go-live (not hard blockers)

| ID | Issue | Fix |
|----|-------|-----|
| 1.7 | CORS `*` default | Set `ALLOWED_ORIGINS` secret to deployment domain |
| 4.2 | CI only runs 2 of 9 test files | Fix `test.yml` glob to `'src/**/*.test.ts'` |
| 4.3 | Node version mismatch in CI | Align both workflows to Node 20 |
| 9.1 | SETUP.md missing migrations | _(same as 3.2 above)_ |
| 9.4 | `VECTORS` unguarded | Add null guard or graceful fallback |
| 9.5 | `JOB_QUEUE` unguarded | Add null guard or graceful fallback |
| 8.6 | No `engines` field | Add `"engines": { "node": ">=20" }` to package.json |

### Recommended post-launch improvements

| ID | Issue | Fix |
|----|-------|-----|
| 5.4 | Route errors not logged | Configure Cloudflare Tail Worker for 5xx alerting |
| 5.8 | No uptime alerting | Add Cloudflare Health Check on `/api/health` |
| 6.2 | Shallow health check | Add `/api/health/deep` that probes D1 + KV |
| 8.5 | No automated dependency updates | Add Dependabot for weekly npm checks |
| 2.5 | No staging environment | Add `[env.staging]` with separate resource IDs |
| 3.3 | No migration runner | Add `scripts/migrate.sh` to apply all migrations in order |
