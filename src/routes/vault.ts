import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, parseBody, rateLimitByIp, parseQueryInt } from '../lib/http'
import { newId, isUUID, now } from '../lib/utils'
import { embed, kMeansClusters, cosineSimilarity } from '../lib/ai'
import { parseVaultAnalyzeRequest } from '../lib/schema'
import {
  VAULT_ANALYZE_RATE_LIMIT_MAX, VAULT_ANALYZE_RATE_LIMIT_WINDOW,
  VAULT_WRITE_RATE_LIMIT_MAX, VAULT_WRITE_RATE_LIMIT_WINDOW,
  VAULT_SEARCH_RATE_LIMIT_MAX, VAULT_SEARCH_RATE_LIMIT_WINDOW,
  AI_SEARCH_MAX_RESULTS, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX,
} from '../lib/constants'

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
  environmentId: string | null
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
  const environmentId = typeof b.environmentId === 'string' ? b.environmentId : null

  return { prompt, response, model, temperature, system_prompt, tool, metadata, tags, environmentId }
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
  const rl = await rateLimitByIp(req, env, 'rl:vault-write', VAULT_WRITE_RATE_LIMIT_MAX, VAULT_WRITE_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseBody(req, parseVaultRecord)
  if (!p.ok) return p.response
  const { prompt, response, model, temperature, system_prompt, tool, metadata, tags, environmentId } = p.data
  try {
    const id         = newId()
    const created_at = now()
    await env.DB.prepare(
      `INSERT INTO vault_records (id, prompt, response, model, temperature, system_prompt, tool, metadata, tags, environment_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, prompt, response, model, temperature, system_prompt, tool,
      JSON.stringify(metadata), JSON.stringify(tags), environmentId ?? null, created_at,
    ).run()
    if (env.AI_SEARCH) {
      const aiMeta: Record<string, string> = { tool, model, ...(environmentId ? { environment_id: environmentId } : {}) }
      void env.AI_SEARCH.upsert([{ id, content: prompt, metadata: aiMeta }])
    }
    return json(ok({ id, prompt, response, model, temperature, system_prompt, tool, metadata, tags, environment_id: environmentId ?? null, created_at }))
  } catch (e) {
    return json(err('Failed to create vault record', String(e)), 500)
  }
}

// GET /api/vault
const list: Handler = async (req: Request, env: Env) => {
  try {
    const url           = new URL(req.url)
    const model         = url.searchParams.get('model')          ?? null
    const tool          = url.searchParams.get('tool')           ?? null
    const tag           = url.searchParams.get('tag')            ?? null
    const environmentId = url.searchParams.get('environment_id') ?? null
    const since  = parseQueryInt(url.searchParams, 'since', 0)
    const until  = parseQueryInt(url.searchParams, 'until', now())
    const limit  = parseQueryInt(url.searchParams, 'limit', LIST_LIMIT_DEFAULT, 1, LIST_LIMIT_MAX)
    const offset = parseQueryInt(url.searchParams, 'offset', 0)
    const q      = url.searchParams.get('q') ?? null

    const conditions: string[] = ['created_at >= ?', 'created_at <= ?']
    const params: unknown[]    = [since, until]

    if (model)         { conditions.push('model = ?');                                                                           params.push(model)         }
    if (tool)          { conditions.push('tool = ?');                                                                            params.push(tool)          }
    if (tag)           { conditions.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)');                              params.push(tag)           }
    if (environmentId) { conditions.push('environment_id = ?');                                                                  params.push(environmentId) }
    if (q)             { conditions.push('(prompt LIKE ? OR response LIKE ?)'); params.push(`%${q}%`); params.push(`%${q}%`) }

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
  if (!isUUID(id)) return json(err('Invalid id'), 422)
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
  if (!isUUID(id)) return json(err('Invalid id'), 422)
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
    const since  = parseQueryInt(url.searchParams, 'since', 0)
    const until  = parseQueryInt(url.searchParams, 'until', now())
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

// POST /api/vault/analyze — cluster vault records by prompt embedding similarity
const analyze: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:vault-analyze', VAULT_ANALYZE_RATE_LIMIT_MAX, VAULT_ANALYZE_RATE_LIMIT_WINDOW)
  if (rl) return rl

  const p = await parseBody(req, parseVaultAnalyzeRequest)
  if (!p.ok) return p.response
  const { k, limit, tool, since } = p.data

  try {
    const conditions: string[] = []
    const params: unknown[] = []
    if (tool)  { conditions.push('tool = ?');           params.push(tool) }
    if (since) { conditions.push('created_at >= ?');    params.push(since) }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await env.DB.prepare(
      `SELECT id, prompt, tool, model FROM vault_records ${where} ORDER BY created_at DESC LIMIT ?`,
    ).bind(...params, limit).all<{ id: string; prompt: string; tool: string; model: string }>()

    const records = rows.results ?? []
    if (records.length < 2) {
      return json(ok({ clusters: [], totalAnalysed: records.length, message: 'Not enough records to cluster (need at least 2)' }))
    }

    const prompts    = records.map(r => r.prompt)
    const embeddings = await embed(env.AI, prompts, undefined, env)

    // k-means: cap k to number of records
    const effectiveK = Math.min(k, records.length)
    const { labels } = kMeansClusters(embeddings, effectiveK)

    // Group records by cluster label
    const clusterMap = new Map<number, Array<{ id: string; prompt: string; tool: string; embedding: Float32Array }>>()
    for (let i = 0; i < records.length; i++) {
      const label = labels[i]
      if (!clusterMap.has(label)) clusterMap.set(label, [])
      clusterMap.get(label)!.push({ id: records[i].id, prompt: records[i].prompt, tool: records[i].tool, embedding: embeddings[i] })
    }

    const clusters = Array.from(clusterMap.entries()).map(([label, members]) => {
      // Find representative: highest average cosine similarity to all other members
      let bestIdx = 0
      let bestScore = -Infinity
      for (let i = 0; i < members.length; i++) {
        if (members.length === 1) { bestIdx = 0; break }
        let score = 0
        for (let j = 0; j < members.length; j++) {
          if (i !== j) score += cosineSimilarity(members[i].embedding, members[j].embedding)
        }
        score /= (members.length - 1)
        if (score > bestScore) { bestScore = score; bestIdx = i }
      }
      const tools = [...new Set(members.map(m => m.tool).filter(Boolean))]
      return {
        label,
        size:            members.length,
        representative:  members[bestIdx].prompt,
        tools,
        sampleIds:       members.slice(0, 3).map(m => m.id),
      }
    }).sort((a, b) => b.size - a.size)

    return json(ok({ clusters, totalAnalysed: records.length }))
  } catch (e) {
    return json(err('Vault analysis failed', String(e)), 500)
  }
}

// GET /api/vault/search — semantic search via Cloudflare AI Search binding
const search: Handler = async (req: Request, env: Env) => {
  if (!env.AI_SEARCH) return json(err('AI Search not configured'), 503)
  const url   = new URL(req.url)
  const q     = url.searchParams.get('q') ?? ''
  const limit = parseQueryInt(url.searchParams, 'limit', 20, 1, AI_SEARCH_MAX_RESULTS)
  const tool  = url.searchParams.get('tool') ?? undefined
  if (!q.trim()) return json(err('q is required'), 400)
  const rl = await rateLimitByIp(req, env, 'rl:vault-search', VAULT_SEARCH_RATE_LIMIT_MAX, VAULT_SEARCH_RATE_LIMIT_WINDOW)
  if (rl) return rl
  try {
    const filters = tool ? { tool } : undefined
    const { results: hits } = await env.AI_SEARCH.search({ query: q, limit, filters })
    const ids = hits.map(r => r.id)
    if (ids.length === 0) return json(ok({ query: q, results: [] }))
    const placeholders = ids.map(() => '?').join(',')
    const { results: rows } = await env.DB.prepare(
      `SELECT * FROM vault_records WHERE id IN (${placeholders})`,
    ).bind(...ids).all<Record<string, unknown>>()
    return json(ok({ query: q, results: (rows ?? []).map(parseRow) }))
  } catch (e) {
    return json(err('Vault search failed', String(e)), 500)
  }
}

export const vaultRoutes: Array<[string, string, Handler]> = [
  ['POST',   '/api/vault',              create],
  ['POST',   '/api/vault/analyze',      analyze],          // must come before /api/vault/:id
  ['GET',    '/api/vault/export.jsonl', exportJsonl],      // must come before /api/vault/:id
  ['GET',    '/api/vault/search',       search],           // must come before /api/vault/:id
  ['GET',    '/api/vault',              list],
  ['DELETE', '/api/vault/:id',         remove],
  ['POST',   '/api/vault/:id/tags',    updateTags],
]
