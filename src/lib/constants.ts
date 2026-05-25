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
