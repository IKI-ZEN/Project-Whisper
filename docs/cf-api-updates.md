# Cloudflare API Updates — Working Notes

Scratch pad for reasoning through new CF documentation as it arrives.
Each entry records: what changed, what it breaks or enables in Project Whisper, and the recommended action.

---

## AI Search — Namespaces

**Source:** CF Namespaces docs (supplied 2026-06-11)
**Affects:** `src/types/env.d.ts`, `src/routes/vault.ts`, `src/routes/atlas.ts`, `wrangler.toml`

### What changed

1. **`search()` signature** — Old: `{ query: string; limit?: number; filters?: Record<string, string> }`.
   New: `{ messages: Array<{ role: string; content: string }> }`.
   It is now conversation-aware; the query is a messages array, not a plain string.

2. **New instance methods** — `chatCompletions()`, `info()`, `stats()`, `items` — none of these existed in the previous binding shape typed in `env.d.ts`.

3. **New namespace binding type** — `ai_search_namespaces` in `wrangler.toml`. Gives access to a *namespace handle*, not a single instance. Instances are resolved lazily via `env.AI_SEARCH.get("instance-name")`. Namespace-level operations: `list()`, `create()`, `delete()`.

4. **Direct instance binding** — `ai_search` (existing key, new semantics) binds to one pre-existing instance per entry. No `get()` call needed, but no `list()`/`create()`/`delete()` either.

5. **Minimum package versions required** — `@cloudflare/workers-types >= 4.20260304.0`, `wrangler >= 4.68.1`.

### What this breaks in Project Whisper

| Location | Issue |
|----------|-------|
| `src/types/env.d.ts:90-94` | `AI_SEARCH` typed with old `search({ query, limit, filters })` shape — wrong signature |
| `src/routes/vault.ts` — `search` handler | Calls `env.AI_SEARCH.search({ query: q, limit, filters })` — will break when binding upgrades |
| `src/routes/atlas.ts` — `nearest` handler | Same old `search()` signature |
| `wrangler.toml` | `ai_search` binding may need version bump in `@cloudflare/workers-types` |

The failure is silent: TypeScript will type-check against the stale interface in `env.d.ts` without error until `env.d.ts` is updated, but the runtime call will throw when the new binding rejects the old shape.

### What this enables for Project Whisper

**Per-sandbox AI Search instances (namespace model)**
Today the shared `AI_SEARCH` binding stores all vault records and atlas prompts in one flat index, scoped only by metadata filters (`{ tool, environment_id }`). The namespace binding allows:
- `env.AI_SEARCH.get(sandboxId)` — one index per sandbox
- True data isolation: a sandbox's RAG results cannot surface another sandbox's documents
- `create()` on sandbox creation, `delete()` on sandbox deletion — lifecycle matches the sandbox lifecycle

**`chatCompletions()` replaces the manual RAG pipeline**
The current document RAG flow in `SandboxDO` is: embed query → Vectorize search → inject chunks → `complete()`. If the per-sandbox AI Search instance handles this natively via `chatCompletions({ messages })`, the Vectorize binding + manual chunk injection can be retired for the document grounding path.

**Conversation-aware vault search**
The `messages` array on `search()` means the vault search at `GET /api/vault/search` can pass the full conversation context (not just the last query), returning results relevant to the thread rather than the last message alone.

### Recommended actions

**Immediate (safe, no infrastructure change):**
1. Update `env.d.ts` — retype `AI_SEARCH` to match the new `ai_search` direct-instance shape:
   - `search({ messages: Array<{ role: string; content: string }>, limit?: number })`
   - Add `chatCompletions()`, `info()`, `stats()`
   - Remove the old `upsert()` / `delete()` if those moved elsewhere (confirm from CF docs)
2. Update `vault.ts` and `atlas.ts` call sites to use the new `messages` shape.

**Medium-term (requires infra change):**
3. Evaluate switching to `ai_search_namespaces` for per-sandbox isolation.
   - Requires: `wrangler.toml` binding change, `create()` call in sandbox-create handler, `delete()` call in sandbox-delete handler.
   - Migration: existing flat index data needs re-indexing per sandbox (can be done lazily on first search hit).

**Defer until `chatCompletions()` docs are available:**
4. Assess replacing the Vectorize + manual RAG pipeline with `chatCompletions()` on per-sandbox instances.
   - Depends on: latency, context window behaviour, whether it supports the system-prompt injection pattern currently used in `SandboxDO`.

### Open questions

- Does the new `ai_search` binding retain `upsert()` / `delete()`? Not shown in namespace docs — need to check instance methods doc.
- What is the `chatCompletions()` signature? Does it accept a `system` field?
- Is `items` a property (array) or a method? The docs list it alongside methods but show no call signature.
- What are the rate limits and per-instance storage caps at the plan level?

---

_Entries added in chronological order as docs are supplied._
