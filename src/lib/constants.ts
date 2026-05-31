// Shared constants — single source of truth for magic values used across the codebase.

export const DEFAULT_TEMPERATURE   = 0.7
export const DEFAULT_MAX_TOKENS    = 1024
export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'
export const DEFAULT_MODEL         = '@cf/meta/llama-3.1-8b-instruct'

export const SANDBOX_KEY_PREFIX    = 'sandbox:'
export const SANDBOX_TTL           = 604800   // 7 days in seconds

export const EMBED_WIDTH           = 420
export const EMBED_HEIGHT          = 640

// 50 user + 50 assistant turns
export const MAX_MESSAGES          = 100

export const DO_STORAGE_KEY        = 'config'

// Sliding-window rate limit for sandbox run/stream calls
export const RATE_LIMIT_WINDOW_MS    = 60_000   // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 20

// IP-based sliding-window rate limit for /api/ai/* routes
export const AI_RATE_LIMIT_WINDOW_MS = 60_000   // 1 minute
export const AI_RATE_LIMIT_MAX       = 30        // 30 calls/min per IP

// Input length limits — defence against cost amplification and storage exhaustion
export const MAX_NAME_LEN            = 128
export const MAX_DESCRIPTION_LEN     = 512
export const MAX_SYSTEM_PROMPT_LEN   = 16_384   // 16 KB
export const MAX_VIBE_DESCRIPTION    = 5_000
export const MAX_EMBED_CHARS         = 100_000   // ~25k tokens
export const MAX_REQUEST_BODY        = 1_048_576 // 1 MB
export const MAX_AUDIO_BYTES         = 26_214_400 // 25 MB
export const MAX_DOCUMENT_BYTES      = 10_485_760 // 10 MB — R2 file upload limit

// Whisperer / pipeline limits
export const MAX_PIPELINE_NODES          = 20
export const MAX_PIPELINE_DEPTH          = 30
export const MAX_SENSITIVITY_VARIANTS    = 8
export const MAX_ENTROPY_SAMPLES         = 10
export const MAX_ARCHAEOLOGY_CANDIDATES  = 6
export const MAX_CLUSTER_TEXTS           = 50

// Per-user session limits
export const MAX_SESSION_ID_LEN          = 64
export const MAX_SESSIONS_PER_SANDBOX    = 100

// Code execution (run_code built-in tool)
export const CODE_EXEC_TIMEOUT_MS        = 5_000

// Custom app HTML from Vibe Builder
export const MAX_APP_HTML_LEN            = 51_200   // 50 KB

// App Builder (AppBuilderDO)
export const MAX_BUILD_DESCRIPTION_LEN   = 2_000
export const MAX_BUILD_FILES             = 6
export const MAX_FILE_BYTES              = 102_400  // 100 KB per generated file

// App images (E4)
export const IMAGE_MAX_BYTES             = 5 * 1024 * 1024  // 5 MB
export const ALLOWED_IMAGE_TYPES         = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

// App email (E5)
export const EMAIL_RATE_LIMIT_WINDOW_MS  = 60_000
export const EMAIL_RATE_LIMIT_MAX        = 5
export const MAX_EMAIL_SUBJECT_LEN       = 256
export const MAX_EMAIL_TEXT_LEN          = 16_384

// AppStateDO key/value bounds (E1)
export const MAX_APP_STATE_KEY_LEN       = 512
export const MAX_APP_STATE_VALUE_LEN     = 16_384
export const APP_STATE_KEY_RE            = /^[a-zA-Z0-9._\-/]+$/

// PDF decompression size guard (Z9)
export const MAX_PDF_INFLATED            = 50 * 1024 * 1024  // 50 MB

// App image upload rate limit (E4)
export const IMAGE_RATE_LIMIT_WINDOW_MS  = 60_000
export const IMAGE_RATE_LIMIT_MAX        = 20  // 20 uploads/min per app

// Build list (KV index mirrors sandbox pattern)
export const BUILD_KEY_PREFIX            = 'build:'
export const BUILD_TTL                   = 604800  // 7 days

// Auto-vault from whisperer tools
export const VAULT_AUTO_RESULT_MAX_BYTES = 10_240   // 10 KB — max JSON result stored in auto-vault

// Guard event metadata
export const GUARD_FLAG_INPUT_PREVIEW_CHARS = 200   // chars of flagged input stored in event metadata

// Guard Laboratory
export const MAX_GUARD_PROBE_CHARS       = 50_000  // max chars for guard-probe endpoint

// Prompt Ablation
export const MAX_ABLATION_CLAUSES        = 12

// Multi-Turn Drift
export const MAX_DRIFT_TURNS             = 20

// Context Stress Test
export const MAX_STRESS_LEVELS           = 8
export const STRESS_CHARS_PER_TOKEN      = 4

// Rubric Evaluator
export const MAX_RUBRIC_CRITERIA         = 8
export const MAX_RUBRIC_SAMPLES          = 5

// Document route limits
export const GUARD_SCAN_SLICE_BYTES      = 8192    // max bytes fed to guard scan on upload
export const MAX_VECTOR_CHUNKS           = 500     // chunk IDs deleted on document delete
export const REINDEX_RATE_LIMIT_MAX      = 5       // reindex calls/min per sandbox

// Manual probe/suite run rate limits (per IP)
export const PROBE_RUN_RATE_LIMIT_MAX    = 10      // 10 manual probe runs/min
export const SUITE_RUN_RATE_LIMIT_MAX    = 5       // 5 suite runs/min

// Assertion regex input cap — prevents ReDoS on long responses
export const MAX_ASSERTION_REGEX_INPUT   = 50_000

// App tokens — short-lived HMAC-signed credentials injected at page-serve time
export const APP_TOKEN_TTL_MS            = 3_600_000   // 1 hour
export const APP_TOKEN_STATE_RATE_LIMIT_MAX = 200      // state mutations per minute per app via token

// Probe webhook delivery
export const PROBE_WEBHOOK_TIMEOUT_MS    = 5_000       // 5 s hard timeout for webhook POST
export const MAX_WEBHOOK_URL_LEN         = 512

// Vault cluster analysis
export const VAULT_ANALYZE_RATE_LIMIT_MAX    = 3       // max per window
export const VAULT_ANALYZE_RATE_LIMIT_WINDOW = 300_000 // 5 minutes

// AI gateway outbound call timeout
export const AI_GATEWAY_TIMEOUT_MS           = 120_000 // 2 minutes

// Pipeline and vault write rate limits (per IP, for unauthenticated deployments)
export const PIPELINE_WRITE_RATE_LIMIT_MAX    = 30
export const PIPELINE_WRITE_RATE_LIMIT_WINDOW = 60_000
export const VAULT_WRITE_RATE_LIMIT_MAX       = 30
export const VAULT_WRITE_RATE_LIMIT_WINDOW    = 60_000

// Vision / multimodal input
export const MAX_IMAGE_BASE64_BYTES = 5_592_405  // ~4 MB binary after decoding base64
export const MAX_IMAGES_PER_MESSAGE = 5

// Structured output (OpenAI json_schema mode)
export const MAX_JSON_SCHEMA_BYTES  = 65_536     // 64 KB

// Azure OpenAI stable API version
export const AZURE_OPENAI_API_VERSION = '2024-02-01'

// Cartesia TTS API version header
export const CARTESIA_API_VERSION = '2024-06-10'

// TTS text input limit
export const MAX_TTS_TEXT_LEN = 5_000

// AI Search — semantic vault search
export const VAULT_SEARCH_RATE_LIMIT_MAX    = 20
export const VAULT_SEARCH_RATE_LIMIT_WINDOW = 60_000
export const AI_SEARCH_MAX_RESULTS         = 50

// Model fallback telemetry sentinel
export const FALLBACK_TELEMETRY_BLOB = 'fallback'

// OpenAPI spec version
export const API_VERSION = '1.0.0'

// Generic list pagination limits
export const LIST_LIMIT_DEFAULT = 50
export const LIST_LIMIT_MAX     = 200

// Monitor-specific pagination limits (higher ceiling for event stream)
export const MONITOR_LIMIT_DEFAULT = 50
export const MONITOR_LIMIT_MAX     = 500

// Sandbox creation rate limit (create/import/fork are DO-provisioning operations)
export const SANDBOX_CREATE_RATE_LIMIT_MAX    = 10
export const SANDBOX_CREATE_RATE_LIMIT_WINDOW = 60_000

// Pipeline execution rate limit (AI chain calls per IP)
export const PIPELINE_RUN_RATE_LIMIT_MAX    = 20
export const PIPELINE_RUN_RATE_LIMIT_WINDOW = 60_000

// Replay rate limit (multi-step AI completions per IP)
export const REPLAY_RATE_LIMIT_MAX    = 10
export const REPLAY_RATE_LIMIT_WINDOW = 60_000

// Usage analytics list
export const USAGE_LIMIT_DEFAULT = 100
export const USAGE_LIMIT_MAX     = 1000

// Chat environments
export const MAX_ENV_MODELS = 4
export const ENV_TYPES      = ['general', 'coding', 'research', 'structured'] as const
