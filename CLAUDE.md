# CLAUDE.md

Guidance for Claude Code sessions on this repository.

## Commands

```bash
npm run dev           # wrangler dev (remote Workers AI — requires wrangler login)
npm run dev:local     # wrangler dev --local (local AI simulation, no login needed)
npm run deploy        # wrangler deploy
npm run type-check    # tsc --noEmit  ← run after every non-trivial change
```

No automated tests. `tsc --noEmit` must exit 0 before every commit.

## Request flow

```
Request → src/index.ts
  ├─ WebSocket upgrade (before router)
  │    ├─ /api/sandbox/:id/ws    → SandboxDO
  │    └─ /api/v2/build/:id/ws  → AppBuilderDO
  └─ Router (URLPattern, src/lib/http.ts)
       ├─ /api/ai/*             src/routes/ai.ts + src/routes/whisperer.ts
       ├─ /api/sandbox/*        src/routes/sandbox.ts
       ├─ /api/vibes/*          src/routes/vibes.ts
       ├─ /api/v2/build/*       src/routes/build.ts
       ├─ /api/app/*            src/routes/appstate.ts
       ├─ /api/vault/*          src/routes/vault.ts
       ├─ /api/replay/*         src/routes/replay.ts
       ├─ /api/assertions/*     src/routes/assertions.ts
       ├─ /api/atlas/*          src/routes/atlas.ts
       ├─ /api/probes/*         src/routes/probes.ts
       ├─ /api/pipelines/*      src/routes/pipelines.ts
       ├─ /api/monitor/*        src/routes/monitor.ts
       └─ /app/:id, /build/:id  src/routes/pages.ts
```

## Coding rules

These are hard rules, not style preferences.

**Zero runtime npm dependencies.** Nothing from npm at runtime. Use native Web Platform APIs: `URLPattern`, `ReadableStream`, `crypto.subtle`, `TextEncoder`, `DecompressionStream`, etc.

**All JSON-body parsing uses `parseBody` + a parser in `src/lib/schema.ts`.** Never call `req.json()` directly:
```typescript
const parsed = await parseBody(req, parseFooRequest)
if (!parsed.ok) return parsed.response
const { data } = parsed
```

**Magic numbers belong in `src/lib/constants.ts`.** Length limits, TTLs, rate limit windows — all named constants, no inline literals.

**Durable Objects are addressed by `idFromName()`, never generated IDs:**
```typescript
env.SANDBOX.get(env.SANDBOX.idFromName(sandboxId))   // correct
env.SANDBOX.get(env.SANDBOX.newUniqueId())            // wrong
```

**DO calls use `doFetch()` with the `https://do/` pseudo-protocol** (exported from `src/routes/sandbox.ts`). Do not construct raw `Request` objects against DO stubs.

**Use `newId()` from `src/lib/utils.ts`** for ID generation — not `crypto.randomUUID()` directly.

**Validate user-supplied `:id` params as UUIDs** before using them in R2 keys, DO stubs, or KV keys. See `appstate.ts` for the pattern.

**TypeScript `strict: true` — no `any` casts without an inline comment** explaining why.

## Adding a new route

1. Add the handler in the relevant file under `src/routes/`. Create a new file only if it is a genuinely new area.
2. Add a parser in `src/lib/schema.ts` if the route accepts a JSON body.
3. Add constants to `src/lib/constants.ts` for any new limits or thresholds.
4. Wire up the route in the route table of the relevant file.
5. Register in `src/index.ts` if you created a new route file.
6. Run `npm run type-check` and fix all errors before committing.

## Further reading

- **Setup & Cloudflare resource provisioning** — `SETUP.md`
- **PR process, branch naming, commit style** — `CONTRIBUTING.md`
- **Environment variables** — `.dev.vars.example`
- **Changelog** — `CHANGELOG.md`
