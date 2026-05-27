import type { Env, AetherLiteJob } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, checkRateLimit } from '../lib/http'
import { scan } from '../lib/guard'
import { newId, now } from '../lib/utils'
import { MAX_DOCUMENT_BYTES } from '../lib/constants'
import { sandboxExists } from './sandbox'

// ── Document metadata stored in R2 customMetadata ────────────────────────────

export interface DocumentMeta {
  docId: string
  sandboxId: string
  name: string
  mimeType: string
  size: number
  uploadedAt: number
  status: 'processing' | 'indexed' | 'error' | 'blocked'
}

// ── Allowed MIME types for upload ─────────────────────────────────────────────

const ALLOWED_TYPES = [
  'text/plain', 'text/markdown', 'text/csv', 'text/html',
  'text/x-markdown', 'application/json', 'application/pdf',
  'application/x-markdown',
]

function r2Key(sandboxId: string, docId: string): string {
  return `sandboxes/${sandboxId}/documents/${docId}`
}

// ── Upload handler ─────────────────────────────────────────────────────────────

const upload: Handler = async (req, env, params: Params) => {
  const sandboxId = params.id ?? ''
  if (!await sandboxExists(env, sandboxId)) return json(err('Sandbox not found'), 404)

  let formData: FormData
  try {
    formData = await req.formData()
  } catch (e) {
    return json(err('Expected multipart/form-data', String(e)), 400)
  }

  const fileField = formData.get('file')
  if (!fileField || typeof fileField === 'string') {
    return json(err("Missing 'file' field in form data"), 400)
  }
  const file = fileField as File

  if (file.size === 0) return json(err('File is empty'), 400)
  if (file.size > MAX_DOCUMENT_BYTES) return json(err('File too large (max 10 MB)'), 413)

  const mimeType = file.type || 'text/plain'
  if (!ALLOWED_TYPES.some(t => mimeType.startsWith(t))) {
    return json(err(`Unsupported file type: ${mimeType}. Allowed: text, markdown, csv, JSON, PDF`), 415)
  }

  // Run guard scan on text-extractable content (PDFs are scanned post-extraction in fileProcess)
  if (!mimeType.includes('pdf')) {
    try {
      const text = await file.text()
      const guard = scan(text.slice(0, 8192))
      if (guard.riskLevel === 'blocked') {
        return json(err('Document rejected: adversarial content detected', guard.patterns.join(', ')), 422)
      }
    } catch { /* binary content — guard scan runs in fileProcess after text extraction */ }
  }

  const docId = newId()
  const key = r2Key(sandboxId, docId)
  const buffer = await file.arrayBuffer()

  const meta: DocumentMeta = {
    docId, sandboxId,
    name:      file.name || 'untitled',
    mimeType,
    size:      file.size,
    uploadedAt: now(),
    status:    'processing',
  }

  await env.FILES.put(key, buffer, {
    httpMetadata:   { contentType: mimeType },
    customMetadata: meta as unknown as Record<string, string>,
  })

  // Enqueue background indexing job
  await env.JOB_QUEUE.send({
    type:      'file_process',
    sandboxId,
    payload:   { docId, key, mimeType },
    createdAt: now(),
  })

  return json(ok({ docId, name: meta.name, size: meta.size, status: 'processing' }), 201)
}

// ── List handler ──────────────────────────────────────────────────────────────

const list: Handler = async (_req, env, params: Params) => {
  const sandboxId = params.id ?? ''
  if (!await sandboxExists(env, sandboxId)) return json(err('Sandbox not found'), 404)

  const listed = await env.FILES.list({ prefix: `sandboxes/${sandboxId}/documents/` })
  const docs = listed.objects.map(obj => ({
    docId:      obj.key.split('/').pop() ?? obj.key,
    name:       (obj.customMetadata?.name as string | undefined) ?? 'untitled',
    mimeType:   (obj.customMetadata?.mimeType as string | undefined) ?? 'text/plain',
    size:       obj.size,
    uploadedAt: Number(obj.customMetadata?.uploadedAt ?? 0),
    status:     (obj.customMetadata?.status as string | undefined) ?? 'indexed',
  }))

  return json(ok({ docs, total: docs.length }))
}

// ── Delete handler ────────────────────────────────────────────────────────────

const del: Handler = async (_req, env, params: Params) => {
  const sandboxId = params.id ?? ''
  const docId = params.docId ?? ''
  if (!await sandboxExists(env, sandboxId)) return json(err('Sandbox not found'), 404)

  const key = r2Key(sandboxId, docId)
  const obj = await env.FILES.head(key)
  if (!obj) return json(err('Document not found'), 404)

  await env.FILES.delete(key)

  // Best-effort vector cleanup — delete all chunks for this document
  // Chunk IDs follow the pattern {sandboxId}_{docId}_{chunkIndex}
  // We attempt to delete up to 500 chunks (more than enough for any realistic document)
  const chunkIds = Array.from({ length: 500 }, (_, i) => `${sandboxId}_${docId}_${i}`)
  try {
    await env.VECTORS.deleteByIds(chunkIds)
  } catch { /* non-fatal — vectors may not exist yet if still processing */ }

  return json(ok({ deleted: true, docId }))
}

// ── Reindex handler ───────────────────────────────────────────────────────────

const reindex: Handler = async (req, env, params: Params) => {
  const sandboxId = params.id ?? ''
  if (!await sandboxExists(env, sandboxId)) return json(err('Sandbox not found'), 404)
  const rlRes = await checkRateLimit(`rl:reindex:${sandboxId}`, 5, 60_000, env, 'Reindex rate limit exceeded — try again in a minute.')
  if (rlRes) return rlRes

  let docIds: string[] | undefined
  try {
    const body = await req.json() as { docIds?: string[] }
    if (Array.isArray(body.docIds)) docIds = body.docIds
  } catch { /* no body = re-index all */ }

  const job: AetherLiteJob = {
    type: 'embedding_batch',
    sandboxId,
    payload: docIds ? { docIds } : {},
    createdAt: Date.now(),
  }
  await env.JOB_QUEUE.send(job)
  return json(ok({ queued: true, sandboxId }), 202)
}

// ── Route table ───────────────────────────────────────────────────────────────

export const documentRoutes: Array<[string, string, Handler]> = [
  ['POST',   '/api/sandbox/:id/documents',          upload],
  ['GET',    '/api/sandbox/:id/documents',          list],
  ['DELETE', '/api/sandbox/:id/documents/:docId',   del],
  ['POST',   '/api/sandbox/:id/documents/reindex',  reindex],
]
