import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, sseEvent, sseResponse } from '../lib/http'

// GET /api/monitor/stream
// SSE endpoint — returns all sandbox_events since `since` (default: last 60s),
// optionally filtered by sandbox_id. Clients use EventSource with Last-Event-ID
// for reconnect-based polling.
const stream: Handler = async (req: Request, env: Env) => {
  try {
    const url = new URL(req.url)
    const defaultSince = Date.now() - 60_000
    const sinceParam = url.searchParams.get('since')
    const since = sinceParam ? parseInt(sinceParam, 10) : defaultSince
    const sandboxId = url.searchParams.get('sandbox_id') ?? null

    let query: string
    let bindings: unknown[]

    if (sandboxId) {
      query = `SELECT id, sandbox_id, event_type, metadata, identity, created_at, request_id
               FROM sandbox_events
               WHERE created_at >= ? AND sandbox_id = ?
               ORDER BY created_at ASC`
      bindings = [since, sandboxId]
    } else {
      query = `SELECT id, sandbox_id, event_type, metadata, identity, created_at, request_id
               FROM sandbox_events
               WHERE created_at >= ?
               ORDER BY created_at ASC`
      bindings = [since]
    }

    const result = await (env.DB.prepare(query).bind(...bindings) as unknown as { all(): Promise<{ results: unknown[] }> }).all()
    const rows = (result.results ?? []) as Record<string, unknown>[]

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const enc = new TextEncoder()

    const write = (chunk: string) => writer.write(enc.encode(chunk))

    ;(async () => {
      try {
        for (const row of rows) {
          let metadata: unknown = {}
          try { metadata = JSON.parse(row.metadata as string) } catch { metadata = {} }
          const payload = {
            id:         row.id,
            sandbox_id: row.sandbox_id,
            event_type: row.event_type,
            metadata,
            identity:   row.identity ?? null,
            created_at: row.created_at,
            request_id: row.request_id ?? null,
          }
          write(sseEvent(payload))
        }
        write(sseEvent({ type: 'end' }))
      } finally {
        await writer.close()
      }
    })()

    return sseResponse(readable)
  } catch (e) {
    return json(err('Monitor stream failed', String(e)), 500)
  }
}

// GET /api/monitor/audit
// Paginated audit log reader with optional filters.
const audit: Handler = async (req: Request, env: Env) => {
  try {
    const url = new URL(req.url)
    const sandboxId  = url.searchParams.get('sandbox_id') ?? null
    const eventType  = url.searchParams.get('event_type') ?? null
    const since      = parseInt(url.searchParams.get('since')  ?? '0', 10)
    const until      = parseInt(url.searchParams.get('until')  ?? String(Date.now()), 10)
    const limitRaw   = parseInt(url.searchParams.get('limit')  ?? '50', 10)
    const offset     = parseInt(url.searchParams.get('offset') ?? '0', 10)
    const limit      = Math.min(Math.max(1, isNaN(limitRaw) ? 50 : limitRaw), 200)

    // Build WHERE clauses
    const conditions: string[] = ['created_at >= ?', 'created_at <= ?']
    const params: unknown[]    = [since, until]

    if (sandboxId) { conditions.push('sandbox_id = ?'); params.push(sandboxId) }
    if (eventType) { conditions.push('event_type = ?'); params.push(eventType) }

    const where = conditions.join(' AND ')

    const dataQuery  = `SELECT id, sandbox_id, event_type, metadata, identity, created_at, request_id
                        FROM sandbox_events
                        WHERE ${where}
                        ORDER BY created_at DESC
                        LIMIT ? OFFSET ?`
    const countQuery = `SELECT COUNT(*) as total FROM sandbox_events WHERE ${where}`

    const [dataResult, countResult] = await Promise.all([
      env.DB.prepare(dataQuery).bind(...params, limit, offset).all(),
      env.DB.prepare(countQuery).bind(...params).first<{ total: number }>(),
    ])

    const rows = (dataResult.results ?? []) as Record<string, unknown>[]
    const total = countResult?.total ?? 0

    const events = rows.map(row => {
      let metadata: unknown = {}
      try { metadata = JSON.parse(row.metadata as string) } catch { metadata = {} }
      return {
        id:         row.id,
        sandbox_id: row.sandbox_id,
        event_type: row.event_type,
        metadata,
        identity:   row.identity ?? null,
        created_at: row.created_at,
        request_id: row.request_id ?? null,
      }
    })

    return json(ok({ events, total, limit, offset }))
  } catch (e) {
    return json(err('Audit query failed', String(e)), 500)
  }
}

// GET /api/monitor/patterns
// Aggregated guard pattern frequency analysis.
const patterns: Handler = async (req: Request, env: Env) => {
  try {
    const url = new URL(req.url)
    const defaultSince = Date.now() - 7 * 24 * 60 * 60 * 1000
    const since      = parseInt(url.searchParams.get('since') ?? String(defaultSince), 10)
    const until      = parseInt(url.searchParams.get('until') ?? String(Date.now()), 10)
    const sandboxId  = url.searchParams.get('sandbox_id') ?? null

    let query: string
    let params: unknown[]

    if (sandboxId) {
      query = `SELECT
                 json_extract(metadata, '$.pattern') as pattern,
                 event_type,
                 COUNT(*) as count
               FROM sandbox_events
               WHERE event_type IN ('guard_flag', 'response_flag')
                 AND created_at >= ?
                 AND created_at <= ?
                 AND sandbox_id = ?
                 AND json_extract(metadata, '$.pattern') IS NOT NULL
               GROUP BY pattern, event_type
               ORDER BY count DESC
               LIMIT 50`
      params = [since, until, sandboxId]
    } else {
      query = `SELECT
                 json_extract(metadata, '$.pattern') as pattern,
                 event_type,
                 COUNT(*) as count
               FROM sandbox_events
               WHERE event_type IN ('guard_flag', 'response_flag')
                 AND created_at >= ?
                 AND created_at <= ?
                 AND json_extract(metadata, '$.pattern') IS NOT NULL
               GROUP BY pattern, event_type
               ORDER BY count DESC
               LIMIT 50`
      params = [since, until]
    }

    const result = await env.DB.prepare(query).bind(...params).all()
    const rows = (result.results ?? []) as Array<{ pattern: string; event_type: string; count: number }>

    return json(ok({ patterns: rows, since, until }))
  } catch (e) {
    return json(err('Patterns query failed', String(e)), 500)
  }
}

export const monitorRoutes: Array<[string, string, Handler]> = [
  ['GET', '/api/monitor/stream',   stream],
  ['GET', '/api/monitor/audit',    audit],
  ['GET', '/api/monitor/patterns', patterns],
]
