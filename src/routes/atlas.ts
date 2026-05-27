import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody } from '../lib/http'
import { embed, kMeansClusters, cosineSimilarity } from '../lib/ai'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PROMPT_TEXT_LEN = 5000
const MAX_LABEL_LEN       = 128
const MAX_TAG_COUNT       = 10
const MAX_TAG_LEN         = 64
const LIBRARY_LIST_MAX    = 1000
const DEFAULT_LIST_LIMIT  = 200
const MAX_LIST_LIMIT      = 1000
const EMBED_BATCH_SIZE    = 50
const DEFAULT_K           = 3
const MAX_K               = 15
const DEFAULT_NEAREST     = 5
const MAX_NEAREST         = 20

// ── D1 row type ───────────────────────────────────────────────────────────────

interface PromptRow {
  id:              string
  text:            string
  label:           string
  tags:            string
  embedding_cache: string | null
  created_at:      number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function encodeEmbedding(vec: number[]): string {
  const buf = new Float32Array(vec).buffer
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function decodeEmbedding(b64: string): number[] {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return Array.from(new Float32Array(bytes.buffer))
}

function pca2d(matrix: number[][]): Array<[number, number]> {
  const n = matrix.length
  if (n === 0) return []
  const d = matrix[0].length

  // Center the matrix
  const mean = new Array<number>(d).fill(0)
  for (const row of matrix) for (let j = 0; j < d; j++) mean[j] += row[j] / n
  const centered = matrix.map(row => row.map((v, j) => v - mean[j]))

  // Power iteration for a single principal component, with optional deflation
  function powerIter(data: number[][], prevPC?: number[]): number[] {
    let v = new Array<number>(d).fill(0).map(() => Math.random() - 0.5)
    // Initial normalise
    {
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
      if (norm > 1e-10) for (let i = 0; i < d; i++) v[i] /= norm
    }
    for (let iter = 0; iter < 50; iter++) {
      // v = (data^T * data) * v / n
      const newV = new Array<number>(d).fill(0)
      for (const row of data) {
        const dot = row.reduce((s, x, i) => s + x * v[i], 0)
        for (let i = 0; i < d; i++) newV[i] += dot * row[i]
      }
      const norm = Math.sqrt(newV.reduce((s, x) => s + x * x, 0))
      if (norm < 1e-10) break
      for (let i = 0; i < d; i++) v[i] = newV[i] / norm
      if (prevPC) {
        // Gram-Schmidt: orthogonalise against prevPC
        const dot = v.reduce((s, x, i) => s + x * prevPC[i], 0)
        for (let i = 0; i < d; i++) v[i] -= dot * prevPC[i]
        const n2 = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
        if (n2 < 1e-10) break
        for (let i = 0; i < d; i++) v[i] /= n2
      }
    }
    return v
  }

  const pc1 = powerIter(centered)
  const pc2 = powerIter(centered, pc1)

  return centered.map(row => [
    row.reduce((s, x, i) => s + x * pc1[i], 0),
    row.reduce((s, x, i) => s + x * pc2[i], 0),
  ] as [number, number])
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseAddPrompt(body: unknown): { text: string; label: string; tags: string[] } {
  if (typeof body !== 'object' || body === null) throw new Error('Body must be an object')
  const b = body as Record<string, unknown>
  const text = typeof b.text === 'string' ? b.text.trim() : ''
  if (!text) throw new Error('text is required')
  if (text.length > MAX_PROMPT_TEXT_LEN) throw new Error(`text exceeds ${MAX_PROMPT_TEXT_LEN} characters`)
  const label = typeof b.label === 'string' ? b.label.slice(0, MAX_LABEL_LEN) : ''
  const rawTags = Array.isArray(b.tags) ? b.tags : []
  if (rawTags.length > MAX_TAG_COUNT) throw new Error(`tags must have at most ${MAX_TAG_COUNT} items`)
  const tags = rawTags.map((t: unknown) => {
    if (typeof t !== 'string') throw new Error('Each tag must be a string')
    if (t.length > MAX_TAG_LEN) throw new Error(`Each tag must be at most ${MAX_TAG_LEN} characters`)
    return t
  })
  return { text, label, tags }
}

function parseEmbedRequest(body: unknown): { k: number } {
  if (typeof body !== 'object' || body === null) return { k: DEFAULT_K }
  const b = body as Record<string, unknown>
  const k = typeof b.k === 'number' ? Math.min(Math.max(1, Math.floor(b.k)), MAX_K) : DEFAULT_K
  return { k }
}

function parseNearestRequest(body: unknown): { text: string; n: number } {
  if (typeof body !== 'object' || body === null) throw new Error('Body must be an object')
  const b = body as Record<string, unknown>
  const text = typeof b.text === 'string' ? b.text.trim() : ''
  if (!text) throw new Error('text is required')
  if (text.length > MAX_PROMPT_TEXT_LEN) throw new Error(`text exceeds ${MAX_PROMPT_TEXT_LEN} characters`)
  const n = typeof b.n === 'number' ? Math.min(Math.max(1, Math.floor(b.n)), MAX_NEAREST) : DEFAULT_NEAREST
  return { text, n }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const addPrompt: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseAddPrompt)
  if (!p.ok) return p.response
  const { text, label, tags } = p.data
  const id = crypto.randomUUID()
  const created_at = Date.now()
  try {
    await env.DB.prepare(
      'INSERT INTO prompt_library (id, text, label, tags, embedding_cache, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
    ).bind(id, text, label, JSON.stringify(tags), created_at).run()
    return json(ok({ id, text, label, tags, created_at }))
  } catch (e) {
    return json(err('Failed to insert prompt', String(e)), 500)
  }
}

const listPrompts: Handler = async (req: Request, env: Env) => {
  const url = new URL(req.url)
  const tag   = url.searchParams.get('tag') ?? ''
  const q     = url.searchParams.get('q') ?? ''
  const limit = Math.min(
    Math.max(1, parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIST_LIMIT), 10) || DEFAULT_LIST_LIMIT),
    MAX_LIST_LIMIT,
  )
  try {
    // Build query with optional filters
    let query = 'SELECT id, text, label, tags, created_at FROM prompt_library'
    const conditions: string[] = []
    const bindings: (string | number)[] = []

    if (q) {
      conditions.push("(text LIKE ? OR label LIKE ?)")
      const like = `%${q}%`
      bindings.push(like, like)
    }
    // Tag filter: tags is stored as a JSON array string — use LIKE for simple containment check
    if (tag) {
      conditions.push("tags LIKE ?")
      bindings.push(`%${tag.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`)
    }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
    query += ' ORDER BY created_at DESC LIMIT ?'
    bindings.push(limit)

    const stmt = env.DB.prepare(query)
    const result = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).all<Omit<PromptRow, 'embedding_cache'>>()
    const rows = result.results ?? []
    const prompts = rows.map(r => ({
      id: r.id,
      text: r.text,
      label: r.label,
      tags: (() => { try { return JSON.parse(r.tags) as string[] } catch { return [] } })(),
      created_at: r.created_at,
    }))
    return json(ok({ prompts, total: prompts.length }))
  } catch (e) {
    return json(err('Failed to list prompts', String(e)), 500)
  }
}

const getPrompt: Handler = async (req: Request, env: Env, params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  try {
    const row = await env.DB.prepare(
      'SELECT id, text, label, tags, created_at FROM prompt_library WHERE id = ?',
    ).bind(id).first<Omit<PromptRow, 'embedding_cache'>>()
    if (!row) return json(err('Prompt not found'), 404)
    return json(ok({
      id: row.id,
      text: row.text,
      label: row.label,
      tags: (() => { try { return JSON.parse(row.tags) as string[] } catch { return [] } })(),
      created_at: row.created_at,
    }))
  } catch (e) {
    return json(err('Failed to get prompt', String(e)), 500)
  }
}

const deletePrompt: Handler = async (req: Request, env: Env, params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  try {
    await env.DB.prepare('DELETE FROM prompt_library WHERE id = ?').bind(id).run()
    return json(ok({ deleted: true }))
  } catch (e) {
    return json(err('Failed to delete prompt', String(e)), 500)
  }
}

const embedAtlas: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseEmbedRequest)
  if (!p.ok) return p.response
  const { k } = p.data

  try {
    // 1. Load all prompts
    const result = await env.DB.prepare(
      'SELECT id, text, label, tags, embedding_cache FROM prompt_library ORDER BY created_at ASC LIMIT ?',
    ).bind(LIBRARY_LIST_MAX).all<PromptRow>()
    const prompts = result.results ?? []

    if (prompts.length === 0) {
      return json(ok({ points: [], clusters: [], k: 0, total: 0 }))
    }

    // 2. Compute missing embeddings in batches of EMBED_BATCH_SIZE
    const missing = prompts.filter(p => !p.embedding_cache)
    for (let i = 0; i < missing.length; i += EMBED_BATCH_SIZE) {
      const batch = missing.slice(i, i + EMBED_BATCH_SIZE)
      const vecs = await embed(env.AI, batch.map(p => p.text))
      // Write back to D1 and update in-memory cache field
      await Promise.all(batch.map(async (row, bi) => {
        const vec = vecs[bi]
        if (!vec) return
        const b64 = encodeEmbedding(vec)
        await env.DB.prepare('UPDATE prompt_library SET embedding_cache = ? WHERE id = ?').bind(b64, row.id).run()
        row.embedding_cache = b64
      }))
    }

    // 3. Decode all embeddings
    const embeddings: number[][] = prompts.map(p => {
      if (!p.embedding_cache) return []
      return decodeEmbedding(p.embedding_cache)
    }).filter(e => e.length > 0)

    // Only cluster the prompts that have valid embeddings
    const validPrompts = prompts.filter(p => p.embedding_cache)

    if (embeddings.length === 0) {
      return json(ok({ points: [], clusters: [], k: 0, total: prompts.length }))
    }

    // 4. K-means clustering
    const effectiveK = Math.min(k, embeddings.length)
    const { labels, centroids } = kMeansClusters(embeddings, effectiveK)

    // 5. PCA projection
    const projection = pca2d(embeddings)

    // 6. Build response
    const points = validPrompts.map((p, i) => ({
      id: p.id,
      text: p.text,
      label: p.label,
      tags: (() => { try { return JSON.parse(p.tags) as string[] } catch { return [] } })(),
      cluster: labels[i],
      x: projection[i]?.[0] ?? 0,
      y: projection[i]?.[1] ?? 0,
    }))

    return json(ok({
      points,
      clusters: centroids,
      k: effectiveK,
      total: prompts.length,
    }))
  } catch (e) {
    return json(err('Atlas embedding failed', String(e)), 500)
  }
}

const nearestPrompts: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseNearestRequest)
  if (!p.ok) return p.response
  const { text, n } = p.data

  try {
    // 1. Embed query text
    const [queryEmb] = await embed(env.AI, [text])
    if (!queryEmb) return json(err('Failed to compute query embedding'), 500)

    // 2. Load all prompts with embedding_cache
    const result = await env.DB.prepare(
      'SELECT id, text, label, tags, embedding_cache FROM prompt_library WHERE embedding_cache IS NOT NULL LIMIT ?',
    ).bind(LIBRARY_LIST_MAX).all<PromptRow>()
    const rows = result.results ?? []

    if (rows.length === 0) {
      return json(ok({ query: text, nearest: [] }))
    }

    // 3. Compute cosine similarities
    const scored = rows.map(row => {
      const emb = decodeEmbedding(row.embedding_cache!)
      const similarity = cosineSimilarity(queryEmb, emb)
      return {
        id: row.id,
        text: row.text,
        label: row.label,
        tags: (() => { try { return JSON.parse(row.tags) as string[] } catch { return [] } })(),
        similarity,
      }
    })

    // 4. Sort descending and return top N
    scored.sort((a, b) => b.similarity - a.similarity)
    const nearest = scored.slice(0, n)

    return json(ok({ query: text, nearest }))
  } catch (e) {
    return json(err('Nearest search failed', String(e)), 500)
  }
}

// ── Route table ───────────────────────────────────────────────────────────────

export const atlasRoutes: Array<[string, string, Handler]> = [
  ['POST',   '/api/atlas/library',      addPrompt],
  ['GET',    '/api/atlas/library',      listPrompts],
  ['GET',    '/api/atlas/library/:id',  getPrompt],
  ['DELETE', '/api/atlas/library/:id',  deletePrompt],
  ['POST',   '/api/atlas/embed',        embedAtlas],
  ['POST',   '/api/atlas/nearest',      nearestPrompts],
]
