export interface AetherJob {
  type: 'ai_completion' | 'embedding_batch' | 'file_process'
  sandboxId: string
  payload: unknown
  createdAt: number
}

export interface Env {
  // Cloudflare Workers AI
  AI: Ai

  // Durable Object namespace — one instance per sandbox
  SANDBOX: DurableObjectNamespace

  // KV — sandbox registry + session state
  SANDBOX_REGISTRY: KVNamespace

  // D1 — audit logs, usage metrics
  DB: D1Database

  // R2 — file uploads (PDFs, images)
  FILES: R2Bucket

  // Queues — async AI jobs
  JOB_QUEUE: Queue<AetherJob>

  // Vectorize — per-sandbox RAG embeddings
  VECTORS: VectorizeIndex

  // Vars
  ENVIRONMENT: string
  CLOUDFLARE_ACCOUNT_ID?: string
  AI_GATEWAY_ID?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  GOOGLE_AI_KEY?: string
  SIGNING_SECRET?: string
  ALLOWED_ORIGINS?: string   // comma-separated origins, or '*' (default)
}
