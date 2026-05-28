import type { Env } from '../types/env'
import { json, ok, err } from '../lib/http'
import { MAX_APP_STATE_KEY_LEN, MAX_APP_STATE_VALUE_LEN, APP_STATE_KEY_RE } from '../lib/constants'

export class AppStateDO {
  private state: DurableObjectState
  private env: Env

  // User KV entries are stored under this prefix so future DO metadata keys
  // are never accidentally wiped by the user-facing clear endpoint.
  private static readonly KV_PREFIX = 'kv/'

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env   = env
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url)
    const keyMatch     = pathname.match(/^\/kv\/(.+)$/)

    if (req.method === 'GET'    && pathname === '/kv') return this.listAll()
    if (req.method === 'DELETE' && pathname === '/')   return this.clearAll()
    if (!keyMatch) return json(err('Not found'), 404)

    const key = decodeURIComponent(keyMatch[1])
    if (req.method === 'GET')    return this.getKey(key)
    if (req.method === 'PUT')    return this.putKey(key, req)
    if (req.method === 'DELETE') return this.deleteKey(key)
    return json(err('Method not allowed'), 405)
  }

  private storedKey(key: string): string {
    return `${AppStateDO.KV_PREFIX}${key}`
  }

  private async listAll(): Promise<Response> {
    const map     = await this.state.storage.list<string>({ prefix: AppStateDO.KV_PREFIX })
    const entries = Array.from(map.entries()).map(([k, value]) => ({
      key: k.slice(AppStateDO.KV_PREFIX.length),
      value,
    }))
    return json(ok({ entries }))
  }

  private async getKey(key: string): Promise<Response> {
    const value = await this.state.storage.get<string>(this.storedKey(key))
    if (value === undefined) return json(err('Not found'), 404)
    return json(ok({ key, value }))
  }

  private async putKey(key: string, req: Request): Promise<Response> {
    if (key.length > MAX_APP_STATE_KEY_LEN)
      return json(err(`key must be <= ${MAX_APP_STATE_KEY_LEN} characters`), 422)
    if (!APP_STATE_KEY_RE.test(key))
      return json(err('key may only contain alphanumeric, dot, underscore, hyphen, or slash'), 422)
    let body: { value?: unknown }
    try { body = await req.json() as { value?: unknown } } catch { return json(err('Invalid JSON body'), 400) }
    if (typeof body?.value !== 'string') return json(err('Body must be { value: string }'), 422)
    if (body.value.length > MAX_APP_STATE_VALUE_LEN)
      return json(err(`value must be <= ${MAX_APP_STATE_VALUE_LEN} characters`), 422)
    await this.state.storage.put(this.storedKey(key), body.value)
    return json(ok({ key, value: body.value }))
  }

  private async deleteKey(key: string): Promise<Response> {
    await this.state.storage.delete(this.storedKey(key))
    return json(ok({ deleted: true, key }))
  }

  private async clearAll(): Promise<Response> {
    const map = await this.state.storage.list<string>({ prefix: AppStateDO.KV_PREFIX })
    if (map.size > 0) await this.state.storage.delete([...map.keys()])
    return json(ok({ cleared: true }))
  }
}
