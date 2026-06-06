// In-memory test doubles for the Cloudflare bindings the route handlers and
// Durable Objects touch. These implement just the slice of each binding the
// code under test calls; the assembled object is cast to `Env` because
// implementing the full Workers type surface here would dwarf the tests.
//
// Used by the route-handler and DO unit tests (src/**/*.test.ts). Not shipped.

import type { Env } from '../types/env'
import type { Handler } from '../lib/http'

// ── KV ────────────────────────────────────────────────────────────────────────

export interface MockKV extends KVNamespace {
  store: Map<string, { value: string; metadata?: unknown }>
}

// Map-backed KV with prefix+cursor pagination (page size 1000, matching CF) and
// metadata support, covering get / getWithMetadata / put / delete / list.
export function mockKV(pageSize = 1000): MockKV {
  const store = new Map<string, { value: string; metadata?: unknown }>()

  const get = async (key: string, typeOrOpts?: unknown): Promise<unknown> => {
    const hit = store.get(key)
    if (hit === undefined) return null
    const type = typeof typeOrOpts === 'string' ? typeOrOpts : (typeOrOpts as { type?: string } | undefined)?.type
    return type === 'json' ? JSON.parse(hit.value) : hit.value
  }

  const getWithMetadata = async (key: string): Promise<{ value: unknown; metadata: unknown }> => {
    const hit = store.get(key)
    if (hit === undefined) return { value: null, metadata: null }
    return { value: hit.value, metadata: hit.metadata ?? null }
  }

  const put = async (key: string, value: string, opts?: { metadata?: unknown }): Promise<void> => {
    store.set(key, { value, metadata: opts?.metadata })
  }

  const del = async (key: string): Promise<void> => { store.delete(key) }

  const list = async (opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<unknown> => {
    const prefix = opts?.prefix ?? ''
    const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort()
    const start = opts?.cursor ? Number(opts.cursor) : 0
    const size = opts?.limit ?? pageSize
    const page = all.slice(start, start + size)
    const next = start + size
    const complete = next >= all.length
    return {
      keys: page.map(name => ({ name, metadata: store.get(name)?.metadata ?? undefined })),
      list_complete: complete,
      cursor: complete ? undefined : String(next),
    }
  }

  // Partial implementation cast to the full KVNamespace surface (see file header).
  return { store, get, getWithMetadata, put, delete: del, list } as unknown as MockKV
}

// ── R2 ────────────────────────────────────────────────────────────────────────

export interface MockR2 extends R2Bucket {
  store: Map<string, { body: ArrayBuffer; customMetadata?: Record<string, string>; httpMetadata?: unknown }>
}

// Map-backed R2 with prefix+cursor pagination. `pageSize` defaults to 1000 (the
// real R2 cap) so tests can seed >pageSize objects and verify listAllR2 paging.
export function mockR2(pageSize = 1000): MockR2 {
  const store = new Map<string, { body: ArrayBuffer; customMetadata?: Record<string, string>; httpMetadata?: unknown }>()

  const toObject = (key: string): R2Object => {
    const rec = store.get(key)!
    return {
      key,
      size: rec.body.byteLength,
      customMetadata: rec.customMetadata,
      httpMetadata: rec.httpMetadata,
    } as unknown as R2Object  // R2Object has many fields; tests read only these
  }

  const put = async (key: string, body: ArrayBuffer, opts?: { customMetadata?: Record<string, string>; httpMetadata?: unknown }) => {
    store.set(key, { body, customMetadata: opts?.customMetadata, httpMetadata: opts?.httpMetadata })
    return toObject(key)
  }

  const get = async (key: string): Promise<unknown> => {
    if (!store.has(key)) return null
    const rec = store.get(key)!
    return { ...toObject(key), body: rec.body }
  }

  const head = async (key: string): Promise<unknown> => (store.has(key) ? toObject(key) : null)

  const del = async (key: string | string[]): Promise<void> => {
    for (const k of Array.isArray(key) ? key : [key]) store.delete(k)
  }

  const list = async (opts?: { prefix?: string; cursor?: string }): Promise<unknown> => {
    const prefix = opts?.prefix ?? ''
    const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort()
    const start = opts?.cursor ? Number(opts.cursor) : 0
    const page = all.slice(start, start + pageSize)
    const next = start + pageSize
    const truncated = next < all.length
    return {
      objects: page.map(toObject),
      truncated,
      cursor: truncated ? String(next) : undefined,
    }
  }

  return { store, put, get, head, delete: del, list } as unknown as MockR2
}

// ── D1 ────────────────────────────────────────────────────────────────────────

// Records every executed statement and returns canned results from a responder.
// The responder receives the SQL and bound params and returns the value for the
// terminal call (.all / .first / .run). Defaults cover the common empty result.
export interface MockD1 extends D1Database {
  calls: Array<{ sql: string; binds: unknown[] }>
}

export function mockD1(responder?: (sql: string, binds: unknown[]) => unknown): MockD1 {
  const calls: Array<{ sql: string; binds: unknown[] }> = []
  const respond = responder ?? (() => undefined)

  const prepare = (sql: string) => {
    let binds: unknown[] = []
    const stmt = {
      bind: (...args: unknown[]) => { binds = args; return stmt },
      all: async () => {
        calls.push({ sql, binds })
        const r = respond(sql, binds)
        return { results: Array.isArray(r) ? r : (r ? [r] : []), success: true, meta: {} }
      },
      first: async () => {
        calls.push({ sql, binds })
        const r = respond(sql, binds)
        return r ?? null
      },
      run: async () => {
        calls.push({ sql, binds })
        const r = respond(sql, binds) as { changes?: number } | undefined
        return { success: true, meta: { changes: r?.changes ?? 0 }, results: [] }
      },
    }
    return stmt
  }

  return { calls, prepare } as unknown as MockD1
}

// ── Durable Object storage (for AppStateDO) ───────────────────────────────────

export interface MockDOStorage extends DurableObjectStorage {
  map: Map<string, unknown>
}

// Map-backed DO storage covering get / put / delete (single + array) / list
// (prefix + limit). Sufficient to drive AppStateDO directly.
export function mockDOStorage(): MockDOStorage {
  const map = new Map<string, unknown>()

  const get = async (key: string): Promise<unknown> => map.get(key)
  const put = async (key: string, value: unknown): Promise<void> => { map.set(key, value) }
  const del = async (key: string | string[]): Promise<number> => {
    let n = 0
    for (const k of Array.isArray(key) ? key : [key]) { if (map.delete(k)) n++ }
    return n
  }
  const list = async (opts?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>> => {
    const prefix = opts?.prefix ?? ''
    const out = new Map<string, unknown>()
    for (const k of [...map.keys()].sort()) {
      if (!k.startsWith(prefix)) continue
      out.set(k, map.get(k))
      if (opts?.limit && out.size >= opts.limit) break
    }
    return out
  }
  const deleteAll = async (): Promise<void> => { map.clear() }

  return { map, get, put, delete: del, list, deleteAll } as unknown as MockDOStorage
}

// ── Durable Object stub / namespace ───────────────────────────────────────────

// A DO stub whose .fetch() forwards to an in-memory handler, compatible with the
// `https://do/<path>` pseudo-protocol used by doFetch (src/routes/sandbox.ts).
export function mockDONamespace(handler: (req: Request) => Promise<Response>): DurableObjectNamespace {
  const stub = { fetch: (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input as RequestInfo, init)) }
  return {
    idFromName: (name: string) => ({ name }),
    get: () => stub,
  } as unknown as DurableObjectNamespace
}

// ── Route-table lookup ────────────────────────────────────────────────────────

// Pull a single handler out of an exported `[method, pathPattern, handler][]`
// route table so tests can invoke it directly with hand-built params.
export function findHandler(
  routes: Array<[string, string, Handler]>, method: string, pattern: string,
): Handler {
  const row = routes.find(([m, p]) => m === method && p === pattern)
  if (!row) throw new Error(`No route registered for ${method} ${pattern}`)
  return row[2]
}

// ── Env assembly ──────────────────────────────────────────────────────────────

// Builds a partial Env with in-memory defaults. Bindings absent from overrides
// stay undefined so "not configured" branches (e.g. missing SEND_EMAIL → 503)
// can be exercised. Cast to Env per the file header.
export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    SANDBOX_REGISTRY: mockKV(),
    RATE_LIMITS: mockKV(),
    FILES: mockR2(),
    DB: mockD1(),
    ...overrides,
  } as unknown as Env
}
