import type { Env } from '../types/env'
import { now } from './utils'

// Append a row to the sandbox_events audit table. Returns the D1 promise so callers
// keep their existing semantics — `void logSandboxEvent(...)` for fire-and-forget
// logging, or `await` where the write must complete before responding.
//
// `metadata` accepts an object (JSON-stringified here) or a pre-serialised string;
// it defaults to '{}'. `identity` defaults to null, `at` to now().
export function logSandboxEvent(env: Env, e: {
  sandboxId: string
  type: string
  metadata?: Record<string, unknown> | string
  identity?: string | null
  at?: number
}): Promise<D1Result> {
  const metadata = e.metadata === undefined
    ? '{}'
    : typeof e.metadata === 'string' ? e.metadata : JSON.stringify(e.metadata)
  return env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(e.sandboxId, e.type, metadata, e.identity ?? null, e.at ?? now()).run()
}
