import type { Env, AetherLiteJob } from '../types/env'
import { embed } from '../lib/ai'

interface FileProcessPayload {
  docId: string
  key: string
  mimeType: string
}

function chunkText(text: string, size = 512, overlap = 64): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + size))
    i += size - overlap
  }
  return chunks
}

export async function processFile(job: AetherLiteJob, env: Env): Promise<void> {
  const { docId, key, mimeType } = job.payload as FileProcessPayload
  const { sandboxId } = job

  const obj = await env.FILES.get(key)
  if (!obj) throw new Error(`File not found in R2: ${key}`)

  const existingMeta = (obj.customMetadata ?? {}) as Record<string, string>
  const buf = await obj.arrayBuffer()

  let text: string
  if (mimeType.includes('pdf')) {
    // Naive text extraction: keep printable ASCII, collapse whitespace
    const bytes = new Uint8Array(buf)
    text = Array.from(bytes)
      .filter(b => b >= 32 && b < 127)
      .map(b => String.fromCharCode(b))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
  } else {
    text = new TextDecoder().decode(buf)
  }

  if (text.trim()) {
    const chunks = chunkText(text)
    const BATCH = 100 // 100 × 512 chars = 51,200 < MAX_EMBED_CHARS limit
    for (let start = 0; start < chunks.length; start += BATCH) {
      const batch = chunks.slice(start, start + BATCH)
      const vectors = await embed(env.AI, batch)
      await env.VECTORS.upsert(
        vectors.map((vec, j) => ({
          id:       `${sandboxId}_${docId}_${start + j}`,
          values:   vec,
          metadata: { sandboxId, docId, chunkIndex: start + j, text: batch[j] ?? '' },
        })),
      )
    }
  }

  // Re-put to mark status as indexed
  await env.FILES.put(key, buf, {
    httpMetadata:   { contentType: mimeType },
    customMetadata: { ...existingMeta, status: 'indexed' },
  })
}

export async function processEmbeddingBatch(_job: AetherLiteJob, _env: Env): Promise<void> {
  // Reserved for future bulk re-indexing
}
