import type { Env } from '../types/env'
import { readIdentity } from './http'
import { SANDBOX_KEY_PREFIX, SANDBOX_TTL } from './constants'

// ── Durable Object dispatch ───────────────────────────────────────────────────
// All DO stubs are addressed by idFromName() (never generated IDs) and called
// through doFetch() with the https://do/ pseudo-protocol.

export function stub(env: Env, sandboxId: string): DurableObjectStub {
  return env.SANDBOX.get(env.SANDBOX.idFromName(sandboxId))
}

export function appStateStub(env: Env, buildId: string): DurableObjectStub {
  return env.APP_STATE.get(env.APP_STATE.idFromName(buildId))
}

export function buildStub(env: Env, id: string): DurableObjectStub {
  return env.APP_BUILDER.get(env.APP_BUILDER.idFromName(id))
}

export async function doFetch(
  s: DurableObjectStub,
  path: string,
  method: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return s.fetch(`https://do/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export function identityHeader(req: Request): Record<string, string> {
  const id = readIdentity(req)
  return id ? { 'X-Whisper-Identity': id } : {}
}

// ── KV metadata shape (stored with each sandbox key) ─────────────────────────

export interface SandboxMeta {
  id: string
  name: string
  description: string
  model: string
  createdAt: number
  fromVibe?: boolean
  fromEnv?: boolean
  envType?: string
  envModels?: string[]
}

export async function sandboxExists(env: Env, id: string): Promise<boolean> {
  return (await env.SANDBOX_REGISTRY.get(`${SANDBOX_KEY_PREFIX}${id}`)) !== null
}

// ── KV helper — stores rich metadata for gallery listing ──────────────────────

export async function registerSandbox(
  env: Env,
  meta: SandboxMeta,
): Promise<void> {
  await env.SANDBOX_REGISTRY.put(
    `${SANDBOX_KEY_PREFIX}${meta.id}`,
    meta.id,   // value is the id — existence check remains simple
    { expirationTtl: SANDBOX_TTL, metadata: meta },
  )
}
