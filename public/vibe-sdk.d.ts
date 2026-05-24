/**
 * vibeSDK TypeScript declarations
 * Project Aether-Lite
 */

// ── Shared types ──────────────────────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface CompleteOpts {
  model?: string
  prompt?: string
  messages?: Message[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

export interface ImageOpts {
  model?: string
  steps?: number
}

export interface SandboxMeta {
  id: string
  name: string
  description: string
  model: string
  createdAt: number
  fromVibe?: boolean
}

export interface CreateSandboxOpts {
  name: string
  description: string
  systemPrompt: string
  tools?: object[]
  model: string
  temperature: number
  maxTokens: number
}

export interface VibeTemplate {
  id: string
  name: string
  tags: string[]
  description: string
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class VibeError extends Error {
  readonly status: number
  readonly detail: unknown
  constructor(message: string, status?: number, detail?: unknown)
}

// ── AiClient ──────────────────────────────────────────────────────────────────

export class AiClient {
  complete(opts: CompleteOpts): Promise<string>
  stream(opts: CompleteOpts): AsyncGenerator<string>
  embed(text: string | string[], model?: string): Promise<number[][]>
  image(prompt: string, opts?: ImageOpts): Promise<string>
  transcribe(audio: File | Blob, model?: string): Promise<string>
}

// ── SandboxHandle ─────────────────────────────────────────────────────────────

export class SandboxHandle {
  readonly id: string
  readonly name: string
  readonly appUrl: string
  readonly shortLink: string

  run(message: string): Promise<string>
  stream(message: string): AsyncGenerator<string>
  history(): Promise<Message[]>
  update(patch: Partial<CreateSandboxOpts>): Promise<void>
  delete(): Promise<void>
}

// ── SandboxClient ─────────────────────────────────────────────────────────────

export class SandboxClient {
  list(): Promise<SandboxMeta[]>
  create(opts: CreateSandboxOpts): Promise<SandboxHandle>
  get(id: string): Promise<SandboxHandle>
  delete(id: string): Promise<void>
}

// ── VibeResult ────────────────────────────────────────────────────────────────

export class VibeResult {
  readonly sandboxId: string
  readonly name: string
  readonly description: string
  readonly model: string
  readonly appUrl: string
  readonly shortLink: string
  readonly embedCode: string
  readonly shortApi: { run: string; stream: string }
  readonly config: { systemPrompt: string; temperature: number; maxTokens: number }

  /** Return a SandboxHandle for this vibe's sandbox. */
  sandbox(): SandboxHandle
}

// ── VibesClient ───────────────────────────────────────────────────────────────

export class VibesClient {
  templates(): Promise<VibeTemplate[]>
  create(description: string, name?: string): Promise<VibeResult>
}

// ── VibeClient ────────────────────────────────────────────────────────────────

export class VibeClient {
  /**
   * @param baseUrl Base URL of the Aether-Lite Worker. Defaults to same origin ('').
   */
  constructor(baseUrl?: string)
  readonly ai: AiClient
  readonly sandbox: SandboxClient
  readonly vibes: VibesClient
}

// ── <vibe-chat> web component ─────────────────────────────────────────────────

/**
 * Drop-in chat widget. Renders in Shadow DOM.
 *
 * @example
 * <vibe-chat sandbox-id="abc123"></vibe-chat>
 * <vibe-chat sandbox-id="xyz" theme="dark" placeholder="Ask me..."></vibe-chat>
 */
export interface VibeChatAttributes {
  /** Required. ID of the sandbox to connect to. */
  'sandbox-id': string
  /** Base URL of the Worker. Defaults to same origin. */
  'base-url'?: string
  /** Input placeholder text. */
  placeholder?: string
  /** Color theme. */
  theme?: 'light' | 'dark'
}

declare global {
  interface HTMLElementTagNameMap {
    'vibe-chat': HTMLElement & VibeChatAttributes
  }
}
