import type { Env, WhisperJob } from '../types/env'
import { embed } from '../lib/ai'
import { scan } from '../lib/guard'
import { MAX_PDF_INFLATED } from '../lib/constants'

interface FileProcessPayload {
  docId: string
  key: string
  mimeType: string
}

// ── Z7: RFC 4180 CSV structured chunking ─────────────────────────────────────

function parseCsvRow(line: string): string[] {
  const fields: string[] = []
  let i = 0
  while (i <= line.length) {
    if (i === line.length) { fields.push(''); break }
    if (line[i] === '"') {
      let field = ''
      i++ // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2 }
        else if (line[i] === '"') { i++; break }
        else { field += line[i]; i++ }
      }
      fields.push(field)
      if (i < line.length && line[i] === ',') i++
    } else {
      const comma = line.indexOf(',', i)
      if (comma < 0) { fields.push(line.slice(i)); break }
      fields.push(line.slice(i, comma))
      i = comma + 1
    }
  }
  return fields
}

function parseAndChunkCSV(text: string): string[] {
  const rows = text.split(/\r?\n/).filter(r => r.trim() !== '')
  if (rows.length < 2) return [text]

  const headers  = parseCsvRow(rows[0])
  const dataRows = rows.slice(1)
  const ROWS_PER_CHUNK = 15
  const chunks: string[] = []

  for (let start = 0; start < dataRows.length; start += ROWS_PER_CHUNK) {
    const batch = dataRows.slice(start, start + ROWS_PER_CHUNK)
    const lines: string[] = []
    for (let j = 0; j < batch.length; j++) {
      const cells  = parseCsvRow(batch[j])
      const pairs  = headers.map((h, idx) => `${h}=${cells[idx] ?? ''}`).join(', ')
      lines.push(`Row ${start + j + 1}: ${pairs}`)
    }
    chunks.push(lines.join('\n'))
  }

  return chunks.length > 0 ? chunks : [text]
}

// ── Z9: DecompressionStream PDF text extraction ───────────────────────────────

async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  const bytes  = new Uint8Array(buf)
  const raw    = new TextDecoder('latin1').decode(bytes)
  const texts: string[] = []

  let pos = 0
  while (pos < raw.length) {
    const streamKw = raw.indexOf('stream', pos)
    if (streamKw < 0) break

    // Confirm 'stream' keyword is followed by \n or \r\n
    let dataStart = streamKw + 6
    if (raw[dataStart] === '\r') dataStart++
    if (raw[dataStart] === '\n') dataStart++
    else { pos = streamKw + 6; continue }

    const endKw = raw.indexOf('\nendstream', dataStart)
    if (endKw < 0) break

    // Check for /FlateDecode in the preceding dictionary
    const dictStart = raw.lastIndexOf('<<', streamKw)
    if (dictStart >= 0 && raw.slice(dictStart, streamKw).includes('/FlateDecode')) {
      let dataEnd = endKw
      if (dataEnd > 0 && raw[dataEnd - 1] === '\r') dataEnd--

      const streamData = bytes.slice(dataStart, dataEnd)
      try {
        const ds = new DecompressionStream('deflate-raw')
        const inflatedBuf = await new Response(
          new ReadableStream({
            start(c) { c.enqueue(streamData); c.close() },
          }).pipeThrough(ds),
        ).arrayBuffer()
        if (inflatedBuf.byteLength > MAX_PDF_INFLATED) { pos = endKw + 10; continue }
        const inflated = new TextDecoder('latin1').decode(inflatedBuf)

        // Extract text operators between BT / ET markers
        let btPos = 0
        while (btPos < inflated.length) {
          const bt = inflated.indexOf(' BT', btPos)
          const et = bt >= 0 ? inflated.indexOf(' ET', bt + 3) : -1
          if (bt < 0 || et < 0) break

          const block = inflated.slice(bt + 3, et)
          // Walk the block collecting (string) Tj / (string) TJ operands
          let bi = 0
          while (bi < block.length) {
            if (block[bi] !== '(') { bi++; continue }
            // Find matching close paren (handles \\-escapes)
            let end = bi + 1
            while (end < block.length) {
              if (block[end] === '\\') { end += 2; continue }
              if (block[end] === ')') break
              end++
            }
            if (end >= block.length) break
            const after = block.slice(end + 1).trimStart()
            if (after.startsWith('Tj') || after.startsWith('TJ')) {
              const t = block.slice(bi + 1, end)
                .replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\\t/g, '\t')
                .replace(/\\(.)/g, '$1')
              if (t.trim()) texts.push(t)
            }
            bi = end + 1
          }
          btPos = et + 3
        }
      } catch { /* inflate failed — skip stream */ }
    }

    pos = endKw + 10 // '\nendstream'.length
  }

  if (texts.length > 0) {
    return texts.join(' ').replace(/\s+/g, ' ').trim()
  }

  // Fallback: naive ASCII filter
  return Array.from(bytes)
    .filter(b => b >= 32 && b < 127)
    .map(b => String.fromCharCode(b))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Plain text chunker ────────────────────────────────────────────────────────

function chunkText(text: string, size = 512, overlap = 64): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + size))
    i += size - overlap
  }
  return chunks
}

// ── Job handlers ──────────────────────────────────────────────────────────────

export async function processFile(job: WhisperJob, env: Env): Promise<void> {
  const { docId, key, mimeType } = job.payload as FileProcessPayload
  const { sandboxId } = job

  const obj = await env.FILES.get(key)
  if (!obj) throw new Error(`File not found in R2: ${key}`)

  const existingMeta = (obj.customMetadata ?? {}) as Record<string, string>
  const buf          = await obj.arrayBuffer()

  let text: string
  if (mimeType.includes('pdf')) {
    text = await extractPdfText(buf)  // Z9
  } else {
    text = new TextDecoder().decode(buf)
  }

  // Guard scan on extracted text
  if (text.trim()) {
    const guardResult = scan(text.slice(0, 8192))
    if (guardResult.riskLevel === 'blocked') {
      await env.FILES.put(key, buf, {
        httpMetadata:   { contentType: mimeType },
        customMetadata: { ...existingMeta, status: 'blocked', blockReason: guardResult.patterns.join(',') },
      })
      return
    }
  }

  if (text.trim()) {
    // Z7: structured CSV chunks; plain text otherwise
    const chunks = mimeType.includes('csv') ? parseAndChunkCSV(text) : chunkText(text)
    const BATCH  = 100
    for (let start = 0; start < chunks.length; start += BATCH) {
      const batch   = chunks.slice(start, start + BATCH)
      const vectors = await embed(env.AI, batch, undefined, env)
      await env.VECTORS.upsert(
        vectors.map((vec, j) => ({
          id:       `${sandboxId}_${docId}_${start + j}`,
          values:   vec,
          metadata: { sandboxId, docId, chunkIndex: start + j, text: batch[j] ?? '' },
        })),
      )
    }
  }

  await env.FILES.put(key, buf, {
    httpMetadata:   { contentType: mimeType },
    customMetadata: { ...existingMeta, status: 'indexed' },
  })
}

interface EmbeddingBatchPayload {
  docIds?: string[]
}

export async function processEmbeddingBatch(job: WhisperJob, env: Env): Promise<void> {
  const { sandboxId } = job
  const { docIds } = (job.payload ?? {}) as EmbeddingBatchPayload

  const prefix = `sandboxes/${sandboxId}/documents/`
  const listed = await env.FILES.list({ prefix })

  const targets = docIds
    ? listed.objects.filter(o => docIds.includes(o.key.slice(prefix.length)))
    : listed.objects

  for (const obj of targets) {
    const meta = (obj.customMetadata ?? {}) as Record<string, string>
    const docId   = obj.key.slice(prefix.length)
    const mimeType = meta.mimeType ?? 'text/plain'
    await processFile(
      { type: 'file_process', sandboxId, payload: { docId, key: obj.key, mimeType }, createdAt: Date.now() },
      env,
    )
  }
}
