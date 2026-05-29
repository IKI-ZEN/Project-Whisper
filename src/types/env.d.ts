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
  GROQ_API_KEY?: string
  MISTRAL_API_KEY?: string
  DEEPSEEK_API_KEY?: string
  XAI_API_KEY?: string
  PERPLEXITY_API_KEY?: string
  ELEVENLABS_API_KEY?: string
  CF_AIG_TOKEN?: string          // AI Gateway auth token — used for authenticated gateways and Bedrock BYOK
  AZURE_OPENAI_API_KEY?: string
  BASETEN_API_KEY?: string
  CEREBRAS_API_KEY?: string
  OPENROUTER_API_KEY?: string
  COHERE_API_KEY?: string
  HUGGINGFACE_API_KEY?: string
  REPLICATE_API_KEY?: string
  PARALLEL_API_KEY?: string
  FAL_API_KEY?: string
  IDEOGRAM_API_KEY?: string
  CARTESIA_API_KEY?: string
  SIGNING_SECRET?: string
  ALLOWED_ORIGINS?: string   // comma-separated origins, or '*' (default)

  // AI Search — managed semantic search (optional; provisioned in CF dashboard)
  AI_SEARCH?: {
    search(opts: { query: string; limit?: number; filters?: Record<string, string> }): Promise<{ results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>
    upsert(records: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>): Promise<void>
    delete(ids: string[]): Promise<void>
  }

  // Cloudflare Access — Zero Trust identity-aware proxy
  CF_ACCESS_AUD?: string          // Access application audience tag (from the dashboard)
  CF_ACCESS_TEAM_DOMAIN?: string  // e.g. yourteam.cloudflareaccess.com

  // Cloudflare API token — required for Pages deployment
  CLOUDFLARE_API_TOKEN?: string

  // Outbound email from address — must match a verified sender in Email Routing
  EMAIL_FROM_ADDRESS?: string
}
