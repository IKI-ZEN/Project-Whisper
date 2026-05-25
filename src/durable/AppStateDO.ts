import type { Env } from '../types/env'
import { json, ok, err } from '../lib/http'

export class AppStateDO {
  private state: DurableObjectState
  private env: Env

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

  private async listAll(): Promise<Response> {
    const map     = await this.state.storage.list<string>()
    const entries = Array.from(map.entries()).map(([key, value]) => ({ key, value }))
    return json(ok({ entries }))
  }

  private async getKey(key: string): Promise<Response> {
    const value = await this.state.storage.get<string>(key)
    if (value === undefined) return json(err('Not found'), 404)
    return json(ok({ key, value }))
  }

  private async putKey(key: string, req: Request): Promise<Response> {
    let body: { value?: unknown }
    try { body = await req.json() as { value?: unknown } } catch { return json(err('Invalid JSON body'), 400) }
    if (typeof body?.value !== 'string') return json(err('Body must be { value: string }'), 422)
    await this.state.storage.put(key, body.value)
    return json(ok({ key, value: body.value }))
  }

  private async deleteKey(key: string): Promise<Response> {
    await this.state.storage.delete(key)
    return json(ok({ deleted: true, key }))
  }

  private async clearAll(): Promise<Response> {
    await this.state.storage.deleteAll()
    return json(ok({ cleared: true }))
  }
}
