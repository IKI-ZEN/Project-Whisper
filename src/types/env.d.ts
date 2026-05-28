export interface WhisperJob {
  type: 'ai_completion' | 'embedding_batch' | 'file_process' | 'replay'
  sandboxId: string
  payload: unknown
  createdAt: number
}

// ── Cloudflare Email binding ──────────────────────────────────────────────────

export interface SendEmailMessage {
  to: string
  from: string
  subject: string
  text?: string
  html?: string
}

export interface SendEmailBinding {
  send(message: SendEmailMessage): Promise<void>
}

// ── Worker environment ────────────────────────────────────────────────────────

export interface Env {
  // Cloudflare Workers AI
  AI: Ai

  // Durable Object namespace — one instance per sandbox
  SANDBOX: DurableObjectNamespace

  // Durable Object namespace — one instance per app build
  APP_BUILDER: DurableObjectNamespace

  // Durable Object namespace — one instance per app (persistent key-value state)
  APP_STATE: DurableObjectNamespace

  // KV — sandbox registry + build metadata
  SANDBOX_REGISTRY: KVNamespace

  // KV — rate limit state (separate from user data for independent rotation)
  RATE_LIMITS: KVNamespace

  // D1 — audit logs, usage metrics
  DB: D1Database

  // R2 — file uploads (PDFs, images)
  FILES: R2Bucket

  // Queues — async AI jobs
  JOB_QUEUE: Queue<WhisperJob>

  // Vectorize — per-sandbox RAG embeddings
  VECTORS: VectorizeIndex

  // Analytics Engine — time-series telemetry
  ANALYTICS?: AnalyticsEngineDataset

  // Email — Cloudflare Email Routing send binding (optional)
  SEND_EMAIL?: SendEmailBinding

  // Vars
  ENVIRONMENT: string
  CLOUDFLARE_ACCOUNT_ID?: string
  AI_GATEWAY_ID?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  GOOGLE_AI_KEY?: string
  SIGNING_SECRET?: string
  ALLOWED_ORIGINS?: string   // comma-separated origins, or '*' (default)

  // Cloudflare Access — Zero Trust identity-aware proxy
  CF_ACCESS_AUD?: string          // Access application audience tag (from the dashboard)
  CF_ACCESS_TEAM_DOMAIN?: string  // e.g. yourteam.cloudflareaccess.com

  // Cloudflare API token — required for Pages deployment
  CLOUDFLARE_API_TOKEN?: string

  // Outbound email from address — must match a verified sender in Email Routing
  EMAIL_FROM_ADDRESS?: string
}
