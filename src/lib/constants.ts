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

// Document route limits
export const GUARD_SCAN_SLICE_BYTES      = 8192    // max bytes fed to guard scan on upload
export const MAX_VECTOR_CHUNKS           = 500     // chunk IDs deleted on document delete
export const REINDEX_RATE_LIMIT_MAX      = 5       // reindex calls/min per sandbox
