// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 IKI-ZEN

import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, parseBody } from '../lib/http'

// ── Validation helpers ────────────────────────────────────────────────────────

const MAX_PROMPT_LEN   = 10_000
const MAX_TAGS         = 20
const MAX_TAG_LEN      = 64
const MAX_EXPORT_ROWS  = 10_000

function validateTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) throw new Error('tags must be an array')
  if (tags.length > MAX_TAGS) throw new Error(`tags must have at most ${MAX_TAGS} items`)
  for (const t of tags) {
    if (typeof t !== 'string') throw new Error('each tag must be a string')
    if (t.length > MAX_TAG_LEN) throw new Error(`each tag must be at most ${MAX_TAG_LEN} chars`)
  }
  return tags as string[]
}

function parseVaultRecord(body: unknown): {
  prompt: string
  response: string
  model: string
  temperature: number
  system_prompt: string
  tool: string
  metadata: object
  tags: string[]
} {
  if (typeof body !== 'object' || body === null) throw new Error('body must be a JSON object')
  const b = body as Record<string, unknown>

  const prompt = b.prompt
  if (typeof prompt !== 'string' || prompt.length === 0) throw new Error('prompt is required')
  if (prompt.length > MAX_PROMPT_LEN) throw new Error(`prompt must be at most ${MAX_PROMPT_LEN} chars`)

  const response      = typeof b.response      === 'string'  ? b.response      : ''
  const model         = typeof b.model         === 'string'  ? b.model         : ''
  const temperature   = typeof b.temperature   === 'number'  ? b.temperature   : 0.7
  const system_prompt = typeof b.system_prompt === 'string'  ? b.system_prompt : ''
  const tool          = typeof b.tool          === 'string'  ? b.tool          : ''
  const metadata      = (typeof b.metadata === 'object' && b.metadata !== null && !Array.isArray(b.metadata))
    ? b.metadata as object
    : {}
  const tags = b.tags !== undefined ? validateTags(b.tags) : []

  return { prompt, response, model, temperature, system_prompt, tool, metadata, tags }
}

function parseTagsBody(body: unknown): { tags: string[] } {
  if (typeof body !== 'object' || body === null) throw new Error('body must be a JSON object')
  const b = body as Record<string, unknown>
  return { tags: validateTags(b.tags) }
}

// ── Row helpers ───────────────────────────────────────────────────────────────

function parseRow(row: Record<string, unknown>) {
  let metadata: unknown = {}
  let tags: unknown     = []
  try { metadata = JSON.parse(row.metadata as string) } catch { metadata = {} }
  try { tags     = JSON.parse(row.tags     as string) } catch { tags     = [] }
  return { ...row, metadata, tags }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// POST /api/vault
const create: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseVaultRecord)
  if (!p.ok) return p.response
  const { prompt, response, model, temperature, system_prompt, tool, metadata, tags } = p.data
  try {
    const id         = crypto.randomUUID()
    const created_at = Date.now()
    await env.DB.prepare(
      `INSERT INTO vault_records (id, prompt, response, model, temperature, system_prompt, tool, metadata, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, prompt, response, model, temperature, system_prompt, tool,
      JSON.stringify(metadata), JSON.stringify(tags), created_at,
    ).run()
    return json(ok({ id, prompt, response, model, temperature, system_prompt, tool, metadata, tags, created_at }))
  } catch (e) {
    return json(err('Failed to create vault record', String(e)), 500)
  }
}

// GET /api/vault
const list: Handler = async (req: Request, env: Env) => {
  try {
    const url    = new URL(req.url)
    const model  = url.searchParams.get('model')  ?? null
    const tool   = url.searchParams.get('tool')   ?? null
    const tag    = url.searchParams.get('tag')    ?? null
    const since  = parseInt(url.searchParams.get('since') ?? '0', 10)
    const until  = parseInt(url.searchParams.get('until') ?? String(Date.now()), 10)
    const limitR = parseInt(url.searchParams.get('limit')  ?? '50', 10)
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
    const q      = url.searchParams.get('q') ?? null
    const limit  = Math.min(Math.max(1, isNaN(limitR) ? 50 : limitR), 200)

    const conditions: string[] = ['created_at >= ?', 'created_at <= ?']
    const params: unknown[]    = [since, until]

    if (model) { conditions.push('model = ?');                                                                           params.push(model) }
    if (tool)  { conditions.push('tool = ?');                                                                            params.push(tool)  }
    if (tag)   { conditions.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)');                              params.push(tag)   }
    if (q)     { conditions.push('(prompt LIKE ? OR response LIKE ?)'); params.push(`%${q}%`); params.push(`%${q}%`) }

    const where      = conditions.join(' AND ')
    const dataQuery  = `SELECT id, prompt, response, model, temperature, system_prompt, tool, metadata, tags, created_at
                        FROM vault_records
                        WHERE ${where}
                        ORDER BY created_at DESC
                        LIMIT ? OFFSET ?`
    const countQuery = `SELECT COUNT(*) as total FROM vault_records WHERE ${where}`

    const [dataResult, countResult] = await Promise.all([
      env.DB.prepare(dataQuery).bind(...params, limit, offset).all(),
      env.DB.prepare(countQuery).bind(...params).first<{ total: number }>(),
    ])

    const rows = (dataResult.results ?? []) as Record<string, unknown>[]
    const total = countResult?.total ?? 0
    const records = rows.map(parseRow)

    return json(ok({ records, total, limit, offset }))
  } catch (e) {
    return json(err('Failed to list vault records', String(e)), 500)
  }
}

// DELETE /api/vault/:id
const remove: Handler = async (req: Request, env: Env, params: Params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  try {
    const result = await env.DB.prepare('DELETE FROM vault_records WHERE id = ?').bind(id).run()
    if ((result.meta?.changes ?? 0) === 0) return json(err('Record not found'), 404)
    return json(ok({ deleted: true }))
  } catch (e) {
    return json(err('Failed to delete vault record', String(e)), 500)
  }
}

// POST /api/vault/:id/tags
const updateTags: Handler = async (req: Request, env: Env, params: Params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  const p = await parseBody(req, parseTagsBody)
  if (!p.ok) return p.response
  const { tags } = p.data
  try {
    const result = await env.DB.prepare(
      'UPDATE vault_records SET tags = ? WHERE id = ?',
    ).bind(JSON.stringify(tags), id).run()
    if ((result.meta?.changes ?? 0) === 0) return json(err('Record not found'), 404)
    return json(ok({ id, tags }))
  } catch (e) {
    return json(err('Failed to update tags', String(e)), 500)
  }
}

// GET /api/vault/export.jsonl
// Streams matching records as newline-delimited JSON (JSONL / NDJSON).
const exportJsonl: Handler = async (req: Request, env: Env) => {
  try {
    const url    = new URL(req.url)
    const model  = url.searchParams.get('model')  ?? null
    const tool   = url.searchParams.get('tool')   ?? null
    const tag    = url.searchParams.get('tag')    ?? null
    const since  = parseInt(url.searchParams.get('since') ?? '0', 10)
    const until  = parseInt(url.searchParams.get('until') ?? String(Date.now()), 10)
    const q      = url.searchParams.get('q') ?? null

    const conditions: string[] = ['created_at >= ?', 'created_at <= ?']
    const params: unknown[]    = [since, until]

    if (model) { conditions.push('model = ?');                                                   params.push(model) }
    if (tool)  { conditions.push('tool = ?');                                                    params.push(tool)  }
    if (tag)   { conditions.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)');      params.push(tag)   }
    if (q)     { conditions.push('(prompt LIKE ? OR response LIKE ?)'); params.push(`%${q}%`); params.push(`%${q}%`) }

    const where = conditions.join(' AND ')
    const batchSize = 100

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const enc    = new TextEncoder()

    ;(async () => {
      try {
        let offset = 0
        let fetched = 0

        while (fetched < MAX_EXPORT_ROWS) {
          const batchLimit = Math.min(batchSize, MAX_EXPORT_ROWS - fetched)
          const query = `SELECT id, prompt, response FROM vault_records WHERE ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`
          const result = await env.DB.prepare(query).bind(...params, batchLimit, offset).all()
          const rows = (result.results ?? []) as Array<{ id: string; prompt: string; response: string }>

          for (const row of rows) {
            const line = JSON.stringify({
              messages: [
                { role: 'user',      content: row.prompt   },
                { role: 'assistant', content: row.response },
              ],
            })
            await writer.write(enc.encode(line + '\n'))
          }

          fetched += rows.length
          offset  += rows.length

          // Stop if we got fewer rows than requested — end of data
          if (rows.length < batchLimit) break
        }
      } finally {
        await writer.close()
      }
    })()

    return new Response(readable, {
      headers: {
        'Content-Type':        'application/x-ndjson',
        'Content-Disposition': 'attachment; filename="vault-export.jsonl"',
        'Cache-Control':       'no-store',
      },
    })
  } catch (e) {
    return json(err('Export failed', String(e)), 500)
  }
}

export const vaultRoutes: Array<[string, string, Handler]> = [
  ['POST',   '/api/vault',             create],
  ['GET',    '/api/vault/export.jsonl', exportJsonl],  // must come before /api/vault/:id
  ['GET',    '/api/vault',             list],
  ['DELETE', '/api/vault/:id',         remove],
  ['POST',   '/api/vault/:id/tags',    updateTags],
]
